package com.example.clip.service.wiki;

import com.example.clip.config.WikiConfig;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Wiki 正文倒排索引（借鉴 KaaS 调研中 tgrep 的思路，本地轻量实现）。
 * <p>
 * 解决 {@code WikiQueryService} 旧实现「正文兜底时每次全库扫描」的万级问题：
 * build 阶段把每页正文切成 gram（中文 2-gram / 英文词，复用 {@link WikiLocalRetriever#tokenize}），
 * 构造「gram → 页面」反向索引并<b>按页面类型分片落盘</b>（{@code wiki/.search/<type>.json}）；
 * 查询时只命中最多 {@value MAX_CANDIDATES} 个候选页，再按命中 gram 数排序取 topK——
 * 与 tgrep「先靠索引缩小候选集、只读候选子集」的取舍一致，避免全库扫盘。
 * </p>
 * <p>
 * 约束：单页正文最多索引前 {@value INDEX_BODY_MAX_CHARS} 字符（控内存与构建成本），
 * 中文 2-gram 天然适合查中文词面；英文按词。gram 与索引侧用同一套 tokenize，保证查询一致。
 * 索引懒构建：首次调用 {@link #softRecall} 时才构建（个人库毫秒级）；{@link #markDirty()}
 * 可在批量入库后触发重建，下次查询时生效。落盘失败不影响内存检索（仅告警）。
 * </p>
 */
@Component
public class WikiSearchIndex {

    private static final Logger log = LoggerFactory.getLogger(WikiSearchIndex.class);

    /** 单页参与索引的正文最大字符数（超出截断，够召回即可） */
    private static final int INDEX_BODY_MAX_CHARS = 4000;

    /** 软召回候选页上限（只读候选页正文做精排，杜绝全库扫） */
    private static final int MAX_CANDIDATES = 300;

    /** 索引分片文件名 */
    private static final String REGISTRY_DIR = ".search";

    private final WikiConfig config;
    private final WikiPageService pageService;
    private final WikiLocalRetriever retriever;
    private final ObjectMapper mapper = new ObjectMapper();

    /** gram → 出现页面集合（内存反向索引，查询时用） */
    private final Map<String, Set<String>> gramToPages = new HashMap<>();
    /** 页面名 → gram 列表（落盘/恢复用） */
    private final Map<String, List<String>> pageToGrams = new HashMap<>();

    /** 是否已构建（懒构建互斥锁） */
    private boolean built = false;
    private boolean dirty = false;

    /**
     * 构造器注入。
     *
     * @param config    Wiki 配置
     * @param pageService Wiki 页面服务（列出页面/读正文）
     * @param retriever 本地检索器（复用 tokenize 拆词）
     */
    public WikiSearchIndex(WikiConfig config, WikiPageService pageService, WikiLocalRetriever retriever) {
        this.config = config;
        this.pageService = pageService;
        this.retriever = retriever;
    }

    /**
     * 正文软召回：按问题 gram 命中计数选候选页，返回 topK 个页面名。
     * <p>
     * 与旧「全库 grep」语义对齐：兜底覆盖「知识点只在正文深处、目录摘要未体现」的场景。
     * 未命中或索引不可用时返回空列表（调用方降级到 LLM 选页）。
     * </p>
     *
     * @param question 用户问题
     * @param topK     最多返回条数
     * @param minHits  达标最小命中 gram 数（与 body 兜底语义一致，自动至少 1）
     * @return 页面名列表，按命中数降序；无匹配返回空列表
     */
    public synchronized List<String> softRecall(String question, int topK, int minHits) {
        if (question == null || question.trim().isEmpty()) {
            return List.of();
        }
        ensureBuilt();
        List<String> qGrams = retriever.tokenize(question);
        if (qGrams.isEmpty()) {
            return List.of();
        }

        // 1. 候选页：union 所有命中 gram 的页面，并记录命中 gram 数
        Map<String, Integer> hits = new HashMap<>();
        for (String gram : qGrams) {
            Set<String> pages = gramToPages.get(gram);
            if (pages == null) {
                continue;
            }
            for (String page : pages) {
                hits.merge(page, 1, Integer::sum);
            }
        }
        if (hits.isEmpty()) {
            return List.of();
        }

        // 2. 达标过滤 + 排序（命中 gram 数降序，同分按页面名）
        int threshold = Math.max(1, minHits - 1);
        List<Map.Entry<String, Integer>> entries = new ArrayList<>(hits.entrySet());
        entries.removeIf(e -> e.getValue() < threshold);
        entries.sort((a, b) -> {
            int cmp = Integer.compare(b.getValue(), a.getValue());
            return cmp != 0 ? cmp : a.getKey().compareTo(b.getKey());
        });

        List<String> result = new ArrayList<>();
        for (Map.Entry<String, Integer> e : entries) {
            result.add(e.getKey());
            if (result.size() >= topK) {
                break;
            }
        }
        log.debug("[WikiSearchIndex] softRecall returned {} pages ({} candidates, gram={})",
                result.size(), entries.size(), qGrams);
        return result;
    }

    /**
     * 标记索引过期（批量入库/页面变更后调用），下次查询前自动重建。
     * <p>重建为同步执行且受限为单线程，个人库规模毫秒级；万级时首次重建秒级但可接受。</p>
     */
    public synchronized void markDirty() {
        dirty = true;
    }

    /**
     * 强制立即重建并落盘（供测试/维护接口调用）。
     */
    public synchronized void rebuild() {
        built = false;
        dirty = false;
        gramToPages.clear();
        pageToGrams.clear();
        ensureBuilt();
    }

    /**
     * 构建倒排索引（首次或脏重建）。
     * <p>先尝试从分片落盘恢复（快速启动），恢复不到再全量扫描页面构建。</p>
     */
    private void ensureBuilt() {
        if (built && !dirty) {
            return;
        }
        if (!built) {
            // 优先从落盘恢复，降低启动构建成本
            if (loadFromDisk()) {
                built = true;
                dirty = false;
                return;
            }
        }
        try {
            for (String pageType : config.getPageTypes()) {
                for (Path pagePath : pageService.listPages(pageType)) {
                    String name = pagePath.getFileName().toString().replaceFirst("\\.md$", "");
                    String content = pageService.readPage(pagePath);
                    indexPage(name, content);
                }
            }
            built = true;
            dirty = false;
            persistToDisk();
            log.info("[WikiSearchIndex] Built index: {} pages, {} grams",
                    pageToGrams.size(), gramToPages.size());
        } catch (Exception e) {
            log.error("[WikiSearchIndex] Build failed: {}", e.getMessage(), e);
        }
    }

    /**
     * 将单页正文切 gram 并入内存索引。
     *
     * @param name    页面名（不含扩展名）
     * @param content 页面正文
     */
    private void indexPage(String name, String content) {
        if (name == null || content == null) {
            return;
        }
        String body = content;
        if (body.length() > INDEX_BODY_MAX_CHARS) {
            body = body.substring(0, INDEX_BODY_MAX_CHARS);
        }
        List<String> grams = retriever.tokenize(body);
        if (grams.isEmpty()) {
            return;
        }
        pageToGrams.put(name, grams);
        for (String gram : grams) {
            gramToPages.computeIfAbsent(gram, k -> new HashSet<>()).add(name);
        }
    }

    /**
     * 分片落盘：{@code {vault}/{wikiDir}/.search/<type>.json}，
     * 每个类型目录一个文件（对应 C 的「按模块分片」），原子写（tmp + rename）。
     */
    private void persistToDisk() {
        try {
            Path searchDir = getSearchDir();
            Files.createDirectories(searchDir);
            for (String pageType : config.getPageTypes()) {
                Path file = searchDir.resolve(pageType + ".json");
                Map<String, Object> shard = new LinkedHashMap<>();
                shard.put("v", 1);
                Map<String, Object> pages = new LinkedHashMap<>();
                // 仅收录该类型目录下的页面
                Set<String> typePages = new HashSet<>();
                for (Path p : pageService.listPages(pageType)) {
                    typePages.add(p.getFileName().toString().replaceFirst("\\.md$", ""));
                }
                for (Map.Entry<String, List<String>> e : pageToGrams.entrySet()) {
                    if (typePages.contains(e.getKey())) {
                        pages.put(e.getKey(), e.getValue());
                    }
                }
                shard.put("pages", pages);
                Path tmp = searchDir.resolve(pageType + ".json.tmp");
                Files.writeString(tmp, mapper.writeValueAsString(shard));
                Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            }
            log.info("[WikiSearchIndex] Persisted shards to {}", searchDir);
        } catch (Exception e) {
            log.warn("[WikiSearchIndex] Persist failed (in-memory only): {}", e.getMessage());
        }
    }

    /**
     * 从分片落盘恢复内存索引；任一有效分片即返回 true。
     *
     * @return true 表示至少恢复了一个分片
     */
    private boolean loadFromDisk() {
        boolean loadedAny = false;
        try {
            Path searchDir = getSearchDir();
            if (!Files.isDirectory(searchDir)) {
                return false;
            }
            for (String pageType : config.getPageTypes()) {
                Path file = searchDir.resolve(pageType + ".json");
                if (!Files.exists(file)) {
                    continue;
                }
                Map<String, Object> shard = mapper.readValue(file.toFile(), new TypeReference<>() {});
                Object pagesObj = shard.get("pages");
                if (!(pagesObj instanceof Map)) {
                    continue;
                }
                @SuppressWarnings("unchecked")
                Map<String, List<String>> pages = (Map<String, List<String>>) pagesObj;
                for (Map.Entry<String, List<String>> e : pages.entrySet()) {
                    if (e.getValue() == null) {
                        continue;
                    }
                    pageToGrams.put(e.getKey(), e.getValue());
                    for (String gram : e.getValue()) {
                        gramToPages.computeIfAbsent(gram, k -> new HashSet<>()).add(e.getKey());
                    }
                }
                loadedAny = true;
            }
            if (loadedAny) {
                log.info("[WikiSearchIndex] Loaded {} pages from disk shards", pageToGrams.size());
            }
        } catch (IOException e) {
            log.warn("[WikiSearchIndex] Load from disk failed: {}", e.getMessage());
        }
        return loadedAny;
    }

    private Path getSearchDir() {
        return Paths.get(config.getVaultPath()).resolve(config.getWikiDirName()).resolve(REGISTRY_DIR);
    }
}