package com.example.clip.service.wiki;

import com.example.clip.config.WikiConfig;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.stream.Stream;

/**
 * 已编译语料注册表 —— 增量编译（内容校验和去重）的核心。
 * <p>
 * KaaS 借鉴项 5.1：编译按<b>内容校验和</b>增量进行，已编译过的语料不再重复付费/重编。
 * 本服务对每个源文件计算 SHA-256 内容哈希，持久化到
 * {@code {vaultPath}/{wikiDirName}/.compiled.json}（每行一个校验和），
 * 命中即跳过 LLM 重编。
 * </p>
 *
 * <p>
 * <b>铁律</b>：文件为真、库为缓存——这里只是跳过 AI 重编，<b>绝不删除</b>
 * 原始源文件数据。
 * </p>
 */
@Service
public class CompiledCorpusRegistry {

    private static final Logger log = LoggerFactory.getLogger(CompiledCorpusRegistry.class);

    /** 注册表文件名 */
    private static final String REGISTRY_FILE = ".compiled.json";

    private final WikiConfig config;

    /** 已编译内容校验和集合（启动时从磁盘加载，运行时内存更新，入库完成后落盘） */
    private final Set<String> compiledHashes =
            Collections.synchronizedSet(new HashSet<>());

    /** 本次 ingest 因内容未变化而跳过的源文件数 */
    private int dedupSkipped = 0;

    /**
     * 构造器注入。
     *
     * @param config Wiki 配置
     */
    public CompiledCorpusRegistry(WikiConfig config) {
        this.config = config;
    }

    /**
     * 服务启动后加载已编译注册表。
     */
    @PostConstruct
    public void init() {
        load();
    }

    /**
     * 计算源文件内容的 SHA-256 十六进制校验和。
     * <p>
     * 哈希对象为文件的<b>正文内容</b>（不含 frontmatter），排除日期等易变字段，
     * 确保仅当真正信息变化时才触发重编。
     * </p>
     *
     * @param rawContent 源文件原始内容
     * @return 40 位十六进制校验和；计算失败时返回 null
     */
    public String checksum(String rawContent) {
        if (rawContent == null) {
            return null;
        }
        String body = stripFrontmatter(rawContent);
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(body.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                sb.append(String.format("%02x", b & 0xff));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            log.error("[Wiki] SHA-256 not available: {}", e.getMessage());
            return null;
        }
    }

    /**
     * 去掉内容开头的 YAML frontmatter（{@code --- ... ---}），只对正文计算哈希。
     *
     * @param content 原始内容
     * @return 去除 frontmatter 后的正文
     */
    private String stripFrontmatter(String content) {
        if (content == null || !content.startsWith("---")) {
            return content == null ? "" : content;
        }
        int firstIdx = content.indexOf("---");
        if (firstIdx < 0) {
            return content;
        }
        int secondIdx = content.indexOf("---", firstIdx + 3);
        if (secondIdx < 0) {
            return content;
        }
        // 返回 frontmatter 结束后的正文（含换行）
        return content.substring(secondIdx + 3);
    }

    /**
     * 判断某内容校验和是否已编译过（内容未变化）。
     *
     * @param hash 内容校验和
     * @return true 表示已编译过，应跳过 LLM 重编
     */
    public boolean isCompiled(String hash) {
        return hash != null && compiledHashes.contains(hash);
    }

    /**
     * 当前是否已加载注册表。
     *
     * @return true 表示已从磁盘加载
     */
    public boolean isLoaded() {
        return !compiledHashes.isEmpty();
    }

    /**
     * 将某内容校验和登记为已编译。
     *
     * @param hash 内容校验和
     */
    public void markCompiled(String hash) {
        if (hash != null) {
            compiledHashes.add(hash);
        }
    }

    /**
     * 标记本次 ingest 跳过数 +1。用于统计。
     */
    public synchronized void incrementDedupSkipped() {
        dedupSkipped++;
    }

    /**
     * 返回本次 ingest 因内容未变化而跳过的源文件数。
     *
     * @return 跳过数
     */
    public synchronized int getDedupSkipped() {
        return dedupSkipped;
    }

    /**
     * 重置本次 ingest 的跳过计数（在 ingest 批次开始时调用）。
     */
    public synchronized void resetDedupSkipped() {
        dedupSkipped = 0;
    }

    /**
     * 启动时从磁盘加载已编译校验和集合。幂等。
     */
    public void load() {
        Path store = getRegistryPath();
        if (!Files.exists(store)) {
            log.info("[Wiki] No compiled registry found at {}", store);
            return;
        }
        int before = compiledHashes.size();
        try (Stream<String> lines = Files.lines(store, StandardCharsets.UTF_8)) {
            lines.map(String::trim)
                    .filter(line -> !line.isEmpty())
                    .forEach(compiledHashes::add);
            log.info("[Wiki] Loaded {} compiled corpus hash(es) from {} (added {})",
                    compiledHashes.size(), store, compiledHashes.size() - before);
        } catch (IOException e) {
            log.error("[Wiki] Failed to load compiled registry: {}", e.getMessage(), e);
        }
    }

    /**
     * 将编译注册表落盘。全部内容重写（校验和数量可控）。
     */
    public synchronized void persist() {
        try {
            Path store = getRegistryPath();
            Path parent = store.getParent();
            if (parent != null && !Files.exists(parent)) {
                Files.createDirectories(parent);
            }
            StringBuilder sb = new StringBuilder();
            sb.append("{\n  \"compiled\": [");
            synchronized (compiledHashes) {
                boolean first = true;
                for (String hash : compiledHashes) {
                    if (!first) {
                        sb.append(", ");
                    }
                    sb.append("\"").append(hash).append("\"");
                    first = false;
                }
            }
            sb.append("]\n}\n");
            Files.writeString(store, sb.toString(), StandardCharsets.UTF_8);
            log.info("[Wiki] Persisted compiled registry ({} hash(es)) to {}",
                    compiledHashes.size(), store);
        } catch (IOException e) {
            log.error("[Wiki] Failed to persist compiled registry: {}", e.getMessage(), e);
        }
    }

    /**
     * 返回注册表持久化文件路径。
     *
     * @return {@code {vaultPath}/{wikiDirName}/.compiled.json}
     */
    private Path getRegistryPath() {
        return Paths.get(config.getVaultPath())
                .resolve(config.getWikiDirName())
                .resolve(REGISTRY_FILE);
    }
}