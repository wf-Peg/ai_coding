package com.example.clip.service;

import com.example.clip.core.AiService;
import com.example.clip.model.ClipContent;
import com.example.clip.model.Knowledge;
import com.example.clip.model.SourceRef;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 知识业务服务
 * <p>
 * 提供知识（Knowledge）的 CRUD 操作、从剪藏创建知识、搜索知识、
 * 双向链接管理等功能。知识是个人知识管理的核心模块，
 * 支持 [[wikilink]] 双向链接关联其他知识条目。
 * 所有持久化操作委托给 {@link FileStorageService}。
 * </p>
 *
 * @see FileStorageService
 * @see ClipService
 */
@Service
public class KnowledgeService {

    private static final Logger log = LoggerFactory.getLogger(KnowledgeService.class);

    /** 底层文件存储服务 */
    private final FileStorageService storageService;
    /** 剪藏服务，用于从剪藏创建知识 */
    private final ClipService clipService;
    /** AI 服务，用于多剪藏知识合成 */
    private final AiService aiService;
    /** 图谱服务，用于把剪藏↔知识关系写入统一关系索引 */
    private final GraphService graphService;

    /**
     * 构造器注入
     *
     * @param storageService 文件存储服务
     * @param clipService    剪藏服务
     * @param aiService      AI 服务
     * @param graphService   图谱服务
     */
    public KnowledgeService(FileStorageService storageService, ClipService clipService,
                            AiService aiService, GraphService graphService) {
        this.storageService = storageService;
        this.clipService = clipService;
        this.aiService = aiService;
        this.graphService = graphService;
    }

    /**
     * 创建知识条目
     *
     * @param knowledge 知识对象
     * @return 保存后的知识（包含自动生成的 ID）
     */
    public Knowledge createKnowledge(Knowledge knowledge) {
        Knowledge saved = storageService.saveKnowledge(knowledge);
        if (saved != null) {
            manageBidirectionalLinks(saved);
            graphService.recordKnowledgeRelations(saved);
        }
        return saved;
    }

    /**
     * 更新知识条目
     * <p>
     * 先根据 ID 查找已有知识，若不存在则返回 null。
     * 更新时保留原 ID 和创建时间，只更新可编辑字段，
     * 并自动设置 updatedAt 为当前时间。
     * 更新后重新管理双向链接。
     * </p>
     *
     * @param knowledge 包含更新字段的知识对象（必须包含有效 ID）
     * @return 更新后的知识；若原知识不存在则返回 null
     */
    public Knowledge updateKnowledge(Knowledge knowledge) {
        Knowledge existing = storageService.getKnowledgeById(knowledge.getId());
        if (existing == null) return null;

        // 先清理旧的双向链接（从被链接的知识条目中移除当前知识）
        cleanOldBidirectionalLinks(existing);

        // 逐字段更新，保留 ID 和创建时间
        existing.setTitle(knowledge.getTitle());
        existing.setSummary(knowledge.getSummary());
        existing.setContent(knowledge.getContent());
        existing.setCategory(knowledge.getCategory());
        existing.setTags(knowledge.getTags());
        existing.setSourceClipIds(knowledge.getSourceClipIds());
        existing.setMyThoughts(knowledge.getMyThoughts());
        existing.setLinkedKnowledgeIds(knowledge.getLinkedKnowledgeIds());
        existing.setUpdatedAt(java.time.LocalDateTime.now());

        Knowledge saved = storageService.saveKnowledge(existing);

        // 重新建立双向链接
        if (saved != null) {
            manageBidirectionalLinks(saved);
            graphService.recordKnowledgeRelations(saved);
        }
        return saved;
    }

    /**
     * 获取所有知识条目
     * <p>
     * 返回结果按创建时间倒序排列（最新的在前）。
     * </p>
     *
     * @return 所有知识条目的列表
     */
    public List<Knowledge> getAllKnowledge() {
        return storageService.getAllKnowledge();
    }

    /**
     * 根据 ID 获取知识条目
     *
     * @param id 知识 ID
     * @return 匹配的知识；若未找到则返回 null
     */
    public Knowledge getKnowledgeById(Long id) {
        return storageService.getKnowledgeById(id);
    }

    /**
     * 删除知识条目
     * <p>
     * 删除前清理双向链接，从被链接的知识条目中移除当前知识。
     * </p>
     *
     * @param id 知识 ID
     */
    public void deleteKnowledge(Long id) {
        Knowledge knowledge = storageService.getKnowledgeById(id);
        if (knowledge != null) {
            cleanOldBidirectionalLinks(knowledge);
        }
        storageService.deleteKnowledge(id);
        graphService.removeKnowledgeRelations(id);
    }

    /**
     * 搜索知识
     * <p>
     * 支持按关键词（匹配标题、摘要、正文）和分类进行过滤。
     * 关键词和分类可以组合使用（AND 逻辑）。
     * 关键词匹配使用大小写不敏感的 contains 方式。
     * </p>
     *
     * @param keyword  搜索关键词（可为 null 或空，表示不按关键词过滤）
     * @param category 分类过滤（可为 null 或空，表示不按分类过滤）
     * @return 匹配的知识列表
     */
    public List<Knowledge> searchKnowledge(String keyword, String category) {
        List<Knowledge> all = storageService.getAllKnowledge();
        return all.stream()
                .filter(k -> {
                    boolean match = true;
                    // 关键词过滤：匹配标题、摘要或正文
                    if (keyword != null && !keyword.isEmpty()) {
                        String kw = keyword.toLowerCase();
                        match = (k.getTitle() != null && k.getTitle().toLowerCase().contains(kw))
                                || (k.getSummary() != null && k.getSummary().toLowerCase().contains(kw))
                                || (k.getContent() != null && k.getContent().toLowerCase().contains(kw));
                    }
                    // 分类过滤：精确匹配
                    if (match && category != null && !category.isEmpty()) {
                        match = category.equals(k.getCategory());
                    }
                    return match;
                })
                .toList();
    }

    /**
     * 根据来源剪藏 ID 查找关联的知识条目
     * <p>
     * 查找所有 sourceClipIds 中包含指定 clipId 的知识条目。
     * </p>
     *
     * @param clipId 来源剪藏 ID
     * @return 关联的知识条目列表
     */
    public List<Knowledge> getKnowledgeByClipId(Long clipId) {
        if (clipId == null) return new ArrayList<>();
        return storageService.getAllKnowledge().stream()
                .filter(k -> k.getSourceClipIds() != null && k.getSourceClipIds().contains(clipId))
                .toList();
    }

    /**
     * 从单个剪藏内容创建知识条目
     * <p>
     * 将剪藏记录的内容转化为知识，标题优先使用剪藏的标题，
     * 若剪藏无标题则使用默认标题"来自剪藏的知识"。
     * </p>
     *
     * @param clipId 源剪藏记录 ID
     * @return 创建的知识；若剪藏不存在则返回 null
     */
    public Knowledge createFromClip(Long clipId) {
        ClipContent clip = clipService.getClipById(clipId);
        if (clip == null) return null;

        Knowledge knowledge = new Knowledge();
        // 标题优先使用剪藏标题，否则使用默认标题
        knowledge.setTitle(clip.getTitle() != null ? clip.getTitle() : "来自剪藏的知识");
        knowledge.setSummary(clip.getSummary());
        knowledge.setContent(clip.getContent());
        knowledge.setCategory(clip.getCategory());
        knowledge.setTags(clip.getTags());

        // 设置来源剪藏 ID 列表
        List<Long> sourceClipIds = new ArrayList<>();
        sourceClipIds.add(clipId);
        knowledge.setSourceClipIds(sourceClipIds);

        // 记录来源剪藏溯源信息（provenance）
        List<SourceRef> sourceRefs = new ArrayList<>();
        sourceRefs.add(new SourceRef(clipId, clip.getTitle(), clip.getSourceUrl(),
                clip.getSiteName(), clip.getCapturedAt()));
        knowledge.setSourceRefs(sourceRefs);

        // 回填我的思考：优先使用剪藏的 myThoughts，其次使用 divergentSummary
        String thoughts = clip.getMyThoughts();
        if (thoughts == null || thoughts.isEmpty()) {
            thoughts = clip.getDivergentSummary();
        }
        knowledge.setMyThoughts(thoughts);

        Knowledge saved = storageService.saveKnowledge(knowledge);
        if (saved != null) {
            manageBidirectionalLinks(saved);
            graphService.recordKnowledgeRelations(saved);
        }
        return saved;
    }

    /**
     * 综合多个剪藏内容创建知识条目（仅生成草稿，不落库）。
     * <p>
     * 把 Controller 原有的 AI 合成逻辑收敛到 service 层：读取多个剪藏内容拼接，
     * 调用 AI 生成结构化知识（标题/摘要/Markdown 正文），并携带来源剪藏与溯源信息。
     * </p>
     *
     * @param clipIds 来源剪藏 ID 列表
     * @return 合成的知识条目草稿（未保存，无 ID）；若找不到有效剪藏或 AI 失败则返回 null
     */
    public Knowledge synthesizeKnowledge(List<Long> clipIds) {
        return synthesizeKnowledge(clipIds, false);
    }

    /**
     * 综合多个剪藏内容创建知识条目。
     *
     * @param clipIds 来源剪藏 ID 列表
     * @param persist 是否直接落库（true 保存并写关系；false 仅返回草稿）
     * @return 合成的知识条目；若找不到有效剪藏或 AI 失败则返回 null
     */
    public Knowledge synthesizeKnowledge(List<Long> clipIds, boolean persist) {
        if (clipIds == null || clipIds.isEmpty()) return null;

        StringBuilder combinedContent = new StringBuilder();
        List<SourceRef> sourceRefs = new ArrayList<>();
        for (int i = 0; i < clipIds.size(); i++) {
            ClipContent clip = clipService.getClipById(clipIds.get(i));
            if (clip == null) continue;
            if (combinedContent.length() > 0) {
                combinedContent.append("\n\n---\n\n");
            }
            combinedContent.append("### 剪藏 #").append(i + 1);
            if (clip.getTitle() != null && !clip.getTitle().isEmpty()) {
                combinedContent.append(": ").append(clip.getTitle());
            }
            combinedContent.append("\n");
            combinedContent.append(clip.getContent() != null ? clip.getContent() : "");
            sourceRefs.add(new SourceRef(clip.getId(), clip.getTitle(), clip.getSourceUrl(),
                    clip.getSiteName(), clip.getCapturedAt()));
        }

        if (combinedContent.isEmpty()) return null;

        Map<String, String> synthesized;
        try {
            synthesized = aiService.synthesizeKnowledgeContent(combinedContent.toString());
        } catch (Exception e) {
            log.error("[KnowledgeService] synthesizeKnowledge AI failed: {}", e.getMessage(), e);
            return null;
        }
        if (synthesized == null) return null;

        Knowledge knowledge = new Knowledge();
        knowledge.setTitle(synthesized.getOrDefault("title", ""));
        knowledge.setSummary(synthesized.getOrDefault("summary", ""));
        knowledge.setContent(synthesized.getOrDefault("content", ""));
        knowledge.setSourceClipIds(new ArrayList<>(clipIds));
        knowledge.setSourceRefs(sourceRefs);

        if (persist) {
            Knowledge saved = storageService.saveKnowledge(knowledge);
            if (saved != null) {
                manageBidirectionalLinks(saved);
                graphService.recordKnowledgeRelations(saved);
            }
            return saved;
        }
        return knowledge;
    }

    /**
     * 管理双向链接
     * <p>
     * 解析 content 中的 [[wikilink]] 模式，提取被引用的知识标题，
     * 查找匹配的知识条目，更新 linkedKnowledgeIds，
     * 并在被链接的知识条目中反向添加当前知识 ID。
     * </p>
     *
     * @param knowledge 当前知识条目
     */
    public void manageBidirectionalLinks(Knowledge knowledge) {
        if (knowledge == null || knowledge.getContent() == null) return;

        // 解析 [[wikilink]] 模式
        List<String> linkedTitles = extractWikilinks(knowledge.getContent());
        if (linkedTitles.isEmpty()) {
            // 如果没有 wikilink，清空 linkedKnowledgeIds
            if (knowledge.getLinkedKnowledgeIds() != null && !knowledge.getLinkedKnowledgeIds().isEmpty()) {
                knowledge.setLinkedKnowledgeIds(new ArrayList<>());
                storageService.saveKnowledge(knowledge);
            }
            return;
        }

        // 查找匹配的知识条目
        List<Long> newLinkedIds = new ArrayList<>();
        List<Knowledge> allKnowledge = storageService.getAllKnowledge();

        for (String title : linkedTitles) {
            for (Knowledge k : allKnowledge) {
                if (k.getId() != null && !k.getId().equals(knowledge.getId())
                        && k.getTitle() != null && k.getTitle().equals(title)) {
                    if (!newLinkedIds.contains(k.getId())) {
                        newLinkedIds.add(k.getId());
                    }
                    break;
                }
            }
        }

        // 更新当前知识的 linkedKnowledgeIds
        knowledge.setLinkedKnowledgeIds(newLinkedIds);
        storageService.saveKnowledge(knowledge);

        // 在被链接的知识条目中反向添加当前知识 ID
        for (Long linkedId : newLinkedIds) {
            Knowledge linked = storageService.getKnowledgeById(linkedId);
            if (linked != null) {
                if (linked.getLinkedKnowledgeIds() == null) {
                    linked.setLinkedKnowledgeIds(new ArrayList<>());
                }
                if (!linked.getLinkedKnowledgeIds().contains(knowledge.getId())) {
                    linked.getLinkedKnowledgeIds().add(knowledge.getId());
                    storageService.saveKnowledge(linked);
                }
            }
        }
    }

    /**
     * 从 Markdown 内容中提取 [[wikilink]] 标题
     *
     * @param content Markdown 内容
     * @return 提取的标题列表
     */
    private List<String> extractWikilinks(String content) {
        List<String> titles = new ArrayList<>();
        if (content == null) return titles;

        Pattern pattern = Pattern.compile("\\[\\[([^\\]]+)\\]\\]");
        Matcher matcher = pattern.matcher(content);
        while (matcher.find()) {
            String title = matcher.group(1).trim();
            if (!title.isEmpty() && !titles.contains(title)) {
                titles.add(title);
            }
        }
        return titles;
    }

    /**
     * 清理旧的双向链接
     * <p>
     * 从被链接的知识条目中移除当前知识的 ID。
     * </p>
     *
     * @param knowledge 当前知识条目
     */
    private void cleanOldBidirectionalLinks(Knowledge knowledge) {
        if (knowledge.getLinkedKnowledgeIds() == null || knowledge.getLinkedKnowledgeIds().isEmpty()) return;

        for (Long linkedId : knowledge.getLinkedKnowledgeIds()) {
            Knowledge linked = storageService.getKnowledgeById(linkedId);
            if (linked != null && linked.getLinkedKnowledgeIds() != null) {
                linked.getLinkedKnowledgeIds().remove(knowledge.getId());
                storageService.saveKnowledge(linked);
            }
        }
    }
}