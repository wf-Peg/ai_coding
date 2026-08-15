package com.example.clip.service;

import com.example.clip.config.PromptConfig;
import com.example.clip.config.PromptTemplate;
import com.example.clip.core.LlmProvider;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 提示词库服务 —— 管理用户可收藏、分类、复用的提示词模板。
 * <p>
 * 存储于 {@code ~/.cut-shelter/prompts/library.json}：
 * <ul>
 *   <li>内置模板：首次启动由 {@link PromptConfigService} 的当前系统 Prompt 预置（builtin=true，不可删除）</li>
 *   <li>用户模板：可新建、编辑、删除、收藏</li>
 *   <li>应用槽位：将模板内容写入对应系统 Prompt 槽位（复用 PromptConfigService 保存逻辑）</li>
 *   <li>LangGPT：支持结构化提示词的解析导入与分段编辑</li>
 * </ul>
 * </p>
 */
@Service
public class PromptLibraryService {

    private static final Logger log = LoggerFactory.getLogger(PromptLibraryService.class);

    /** 提示词库存储根目录（相对用户主目录） */
    private static final String LIBRARY_DIR = ".cut-shelter/prompts";

    /** 库文件名 */
    private static final String LIBRARY_FILE = "library.json";

    private final ObjectMapper objectMapper;
    private final PromptConfigService promptConfigService;
    private final LlmProvider llmProvider;

    public PromptLibraryService(PromptConfigService promptConfigService, LlmProvider llmProvider) {
        ObjectMapper mapper = new ObjectMapper();
        mapper.enable(SerializationFeature.INDENT_OUTPUT);
        this.objectMapper = mapper;
        this.promptConfigService = promptConfigService;
        this.llmProvider = llmProvider;
    }

    // ==================== 系统槽位元数据 ====================

    /**
     * 系统 Prompt 槽位元数据：slot key → {field(对应 PromptConfig 字段), title, hint}。
     * 顺序即前端展示顺序。
     */
    private static final Map<String, Map<String, String>> SLOT_META = buildSlotMeta();

    private static Map<String, Map<String, String>> buildSlotMeta() {
        Map<String, Map<String, String>> m = new LinkedHashMap<>();
        m.put("clip", slot("clipAnalyzeSystemPrompt", "添加剪藏 AI Prompt", "剪藏分析时的 AI 角色定义（Role + Goal + Constraints），不含任务格式"));
        m.put("clipTaskFormat", slot("clipAnalyzeTaskFormat", "剪藏分析任务格式", "任务描述、JSON 输出格式、分类树约束，支持 {{category_tree}}"));
        m.put("daily", slot("dailyOrganizeSystemPrompt", "整理收件箱 Prompt", "整理收件箱日报的系统提示词，支持 {{category}} {{date}} {{count}}"));
        m.put("weekly", slot("weeklyReportSystemPrompt", "周报总结 Prompt", "生成周报总结的系统提示词，支持 {{week_range}}，期望 JSON 输出"));
        m.put("analyzeContent", slot("analyzeContentPrompt", "深度内容分析 Prompt", "analyzeContent() 使用，输出 Markdown"));
        m.put("generateSummary", slot("generateSummaryPrompt", "摘要生成 Prompt", "generateSummary() 使用，输出不超过 100 字"));
        m.put("generateTags", slot("generateTagsPrompt", "标签提取 Prompt", "generateTags() 使用，输出逗号分隔标签"));
        m.put("smartOrganize", slot("smartOrganizePrompt", "智能分类 Prompt", "smartOrganize() 使用，支持 {{category_tree}}，期望 JSON"));
        m.put("generateSynonyms", slot("generateSynonymsPrompt", "同义词生成 Prompt", "generateSynonyms() 使用，输出逗号分隔同义词"));
        m.put("divergentRoleMap", slot("divergentSummaryRoleMap", "发散总结角色映射", "各分类对应的专家角色（JSON 格式）"));
        m.put("wikiBatchExtract", slot("wikiBatchExtractPrompt", "Wiki 批量抽取 Prompt", "批量提取实体/概念"));
        m.put("wikiGenEntity", slot("wikiGenerateEntityPagePrompt", "Wiki 实体页 Prompt", "生成/更新实体页面"));
        m.put("wikiGenConcept", slot("wikiGenerateConceptPagePrompt", "Wiki 概念页 Prompt", "生成/更新概念页面"));
        m.put("wikiGenSource", slot("wikiGenerateSourcePagePrompt", "Wiki 源页 Prompt", "生成源文档页面"));
        m.put("wikiDetectContradiction", slot("wikiDetectContradictionPrompt", "Wiki 矛盾检测 Prompt", "检测页面间事实矛盾"));
        m.put("wikiQueryIndex", slot("wikiQueryIndexPrompt", "Wiki 查询索引 Prompt", "查询时路由相关页面"));
        m.put("wikiQuerySynthesis", slot("wikiQuerySynthesisPrompt", "Wiki 查询综合 Prompt", "综合多页答案"));
        m.put("wikiLint", slot("wikiLintPrompt", "Wiki Lint Prompt", "健康检查：矛盾/过时/孤儿/缺失"));
        return m;
    }

    private static Map<String, String> slot(String field, String title, String hint) {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("field", field);
        m.put("title", title);
        m.put("hint", hint);
        return m;
    }

    /** 模板分类 → 名称（用于内置模板分组） */
    private static final String CATEGORY_SYSTEM = "系统模板";

    // ==================== 初始化 ====================

    /**
     * 初始化：确保存储目录存在；库为空时用系统当前 Prompt 预置内置模板。
     */
    @PostConstruct
    public void init() {
        try {
            Files.createDirectories(getLibraryDir());
        } catch (IOException e) {
            log.warn("[PromptLibrary] Failed to create dir: {}", e.getMessage());
        }
        List<PromptTemplate> prompts = loadLibrary();
        if (prompts.isEmpty()) {
            seedBuiltinTemplates();
            log.info("[PromptLibrary] Seeded {} builtin prompt templates", SLOT_META.size());
        } else {
            log.info("[PromptLibrary] Loaded {} prompt templates", prompts.size());
        }
    }

    /**
     * 用系统当前 Prompt 配置预置 18 个内置模板（快照）。
     */
    private void seedBuiltinTemplates() {
        PromptConfig cfg = promptConfigService.getPromptConfig();
        List<PromptTemplate> builtins = new ArrayList<>();
        for (Map.Entry<String, Map<String, String>> e : SLOT_META.entrySet()) {
            String slotKey = e.getKey();
            String field = e.getValue().get("field");
            String content = readField(cfg, field);
            if (content == null || content.trim().isEmpty()) {
                continue;
            }
            PromptTemplate t = new PromptTemplate();
            t.setId("sys-" + slotKey);
            t.setName(e.getValue().get("title"));
            t.setCategory(CATEGORY_SYSTEM);
            t.setDescription(e.getValue().get("hint"));
            t.setContent(content);
            t.setTags(new ArrayList<>());
            t.setFavorite(false);
            t.setSlot(slotKey);
            t.setLanggpt(false);
            t.setBuiltin(true);
            String now = now();
            t.setCreatedAt(now);
            t.setUpdatedAt(now);
            builtins.add(t);
        }
        saveLibrary(builtins);
    }

    private String readField(PromptConfig cfg, String field) {
        switch (field) {
            case "clipAnalyzeSystemPrompt": return cfg.getClipAnalyzeSystemPrompt();
            case "dailyOrganizeSystemPrompt": return cfg.getDailyOrganizeSystemPrompt();
            case "weeklyReportSystemPrompt": return cfg.getWeeklyReportSystemPrompt();
            case "clipAnalyzeTaskFormat": return cfg.getClipAnalyzeTaskFormat();
            case "analyzeContentPrompt": return cfg.getAnalyzeContentPrompt();
            case "generateSummaryPrompt": return cfg.getGenerateSummaryPrompt();
            case "generateTagsPrompt": return cfg.getGenerateTagsPrompt();
            case "smartOrganizePrompt": return cfg.getSmartOrganizePrompt();
            case "generateSynonymsPrompt": return cfg.getGenerateSynonymsPrompt();
            case "divergentSummaryRoleMap": return cfg.getDivergentSummaryRoleMap();
            case "wikiBatchExtractPrompt": return cfg.getWikiBatchExtractPrompt();
            case "wikiGenerateEntityPagePrompt": return cfg.getWikiGenerateEntityPagePrompt();
            case "wikiGenerateConceptPagePrompt": return cfg.getWikiGenerateConceptPagePrompt();
            case "wikiGenerateSourcePagePrompt": return cfg.getWikiGenerateSourcePagePrompt();
            case "wikiDetectContradictionPrompt": return cfg.getWikiDetectContradictionPrompt();
            case "wikiQueryIndexPrompt": return cfg.getWikiQueryIndexPrompt();
            case "wikiQuerySynthesisPrompt": return cfg.getWikiQuerySynthesisPrompt();
            case "wikiLintPrompt": return cfg.getWikiLintPrompt();
            default: return null;
        }
    }

    // ==================== 存储读写 ====================

    private Path getLibraryDir() {
        String userHome = System.getProperty("user.home");
        if (userHome == null || userHome.isEmpty()) {
            userHome = ".";
        }
        return Paths.get(userHome, LIBRARY_DIR);
    }

    private Path getLibraryPath() {
        return getLibraryDir().resolve(LIBRARY_FILE);
    }

    @SuppressWarnings("unchecked")
    private List<PromptTemplate> loadLibrary() {
        Path path = getLibraryPath();
        if (!Files.exists(path)) {
            return new ArrayList<>();
        }
        try {
            String content = Files.readString(path, StandardCharsets.UTF_8);
            Map<String, Object> root = objectMapper.readValue(content, LinkedHashMap.class);
            Object prompts = root.get("prompts");
            if (prompts instanceof List) {
                return objectMapper.convertValue(prompts, new TypeReference<List<PromptTemplate>>() {});
            }
            return new ArrayList<>();
        } catch (Exception e) {
            log.warn("[PromptLibrary] Failed to load library, using empty: {}", e.getMessage());
            return new ArrayList<>();
        }
    }

    private void saveLibrary(List<PromptTemplate> prompts) {
        try {
            Map<String, Object> root = new LinkedHashMap<>();
            root.put("version", 1);
            root.put("prompts", prompts);
            Files.writeString(getLibraryPath(), objectMapper.writeValueAsString(root), StandardCharsets.UTF_8);
        } catch (IOException e) {
            log.error("[PromptLibrary] Failed to save library: {}", e.getMessage());
        }
    }

    private String now() {
        return LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
    }

    // ==================== 业务方法 ====================

    /**
     * 列出全部模板（收藏优先，其次更新时间倒序）。
     */
    public List<PromptTemplate> listPrompts() {
        List<PromptTemplate> prompts = loadLibrary();
        prompts.sort(Comparator
                .comparing(PromptTemplate::isFavorite, Comparator.reverseOrder())
                .thenComparing(Comparator.comparing(PromptTemplate::getUpdatedAt, Comparator.nullsLast(String::compareTo)).reversed()));
        return prompts;
    }

    /**
     * 列出系统槽位元数据。
     */
    public List<Map<String, Object>> listSlots() {
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map.Entry<String, Map<String, String>> e : SLOT_META.entrySet()) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("key", e.getKey());
            item.put("title", e.getValue().get("title"));
            item.put("hint", e.getValue().get("hint"));
            result.add(item);
        }
        return result;
    }

    /**
     * 新建模板。
     */
    public PromptTemplate createPrompt(String name, String category, String description, String content,
                                       List<String> tags, String slot, boolean langgpt, Map<String, String> sections) {
        if (name == null || name.trim().isEmpty()) {
            throw new IllegalArgumentException("模板名称不能为空");
        }
        PromptTemplate t = new PromptTemplate();
        t.setId("pm-" + UUID.randomUUID().toString().substring(0, 8));
        t.setName(name.trim());
        t.setCategory(normalize(category, "通用"));
        t.setDescription(normalize(description, ""));
        t.setContent(normalize(content, ""));
        t.setTags(tags == null ? new ArrayList<>() : tags);
        t.setFavorite(false);
        t.setSlot(slot != null && !slot.isEmpty() ? slot : null);
        t.setLanggpt(langgpt);
        t.setSections(sections == null ? new LinkedHashMap<>() : sections);
        t.setBuiltin(false);
        String now = now();
        t.setCreatedAt(now);
        t.setUpdatedAt(now);

        List<PromptTemplate> prompts = loadLibrary();
        prompts.add(t);
        saveLibrary(prompts);
        return t;
    }

    /**
     * 更新模板。
     */
    public PromptTemplate updatePrompt(String id, String name, String category, String description, String content,
                                       List<String> tags, String slot, boolean langgpt, Map<String, String> sections) {
        List<PromptTemplate> prompts = loadLibrary();
        for (PromptTemplate t : prompts) {
            if (id.equals(t.getId())) {
                if (name != null && !name.trim().isEmpty()) {
                    t.setName(name.trim());
                }
                if (category != null) t.setCategory(normalize(category, "通用"));
                if (description != null) t.setDescription(description);
                if (content != null) t.setContent(content);
                if (tags != null) t.setTags(tags);
                if (slot != null) t.setSlot(slot.isEmpty() ? null : slot);
                t.setLanggpt(langgpt);
                if (sections != null) t.setSections(sections);
                t.setUpdatedAt(now());
                saveLibrary(prompts);
                return t;
            }
        }
        throw new IllegalArgumentException("模板不存在: " + id);
    }

    /**
     * 删除模板（内置不可删除）。
     */
    public boolean deletePrompt(String id) {
        List<PromptTemplate> prompts = loadLibrary();
        PromptTemplate target = null;
        for (PromptTemplate t : prompts) {
            if (id.equals(t.getId())) {
                target = t;
                break;
            }
        }
        if (target == null) {
            return false;
        }
        if (target.isBuiltin()) {
            throw new IllegalArgumentException("内置模板不可删除");
        }
        prompts.remove(target);
        saveLibrary(prompts);
        return true;
    }

    /**
     * 设置收藏状态。
     */
    public PromptTemplate toggleFavorite(String id, boolean favorite) {
        List<PromptTemplate> prompts = loadLibrary();
        for (PromptTemplate t : prompts) {
            if (id.equals(t.getId())) {
                t.setFavorite(favorite);
                t.setUpdatedAt(now());
                saveLibrary(prompts);
                return t;
            }
        }
        throw new IllegalArgumentException("模板不存在: " + id);
    }

    /**
     * 将模板内容应用到指定系统槽位。
     * <p>复用 PromptConfigService 的读取/保存逻辑，保证与剪藏模块共用同一份配置。</p>
     *
     * @param id   模板 id
     * @param slot 目标槽位 key
     * @return 应用后的模板
     */
    public PromptTemplate applyToSlot(String id, String slot) {
        if (slot == null || !SLOT_META.containsKey(slot)) {
            throw new IllegalArgumentException("无效的槽位: " + slot);
        }
        PromptTemplate template = findById(id);
        if (template == null) {
            throw new IllegalArgumentException("模板不存在: " + id);
        }
        String content = template.getContent();
        if (content == null || content.trim().isEmpty()) {
            throw new IllegalArgumentException("模板内容为空，无法应用");
        }
        String field = SLOT_META.get(slot).get("field");

        // 读取当前配置，写入目标字段，保存
        PromptConfig cfg = promptConfigService.getPromptConfig();
        setField(cfg, field, content);
        promptConfigService.savePromptConfig(cfg);

        // 回写模板的槽位关联
        if (!slot.equals(template.getSlot())) {
            List<PromptTemplate> prompts = loadLibrary();
            for (PromptTemplate t : prompts) {
                if (id.equals(t.getId())) {
                    t.setSlot(slot);
                    t.setUpdatedAt(now());
                    break;
                }
            }
            saveLibrary(prompts);
        }
        log.info("[PromptLibrary] Applied template {} to slot {}", id, slot);
        return template;
    }

    private void setField(PromptConfig cfg, String field, String value) {
        switch (field) {
            case "clipAnalyzeSystemPrompt": cfg.setClipAnalyzeSystemPrompt(value); break;
            case "dailyOrganizeSystemPrompt": cfg.setDailyOrganizeSystemPrompt(value); break;
            case "weeklyReportSystemPrompt": cfg.setWeeklyReportSystemPrompt(value); break;
            case "clipAnalyzeTaskFormat": cfg.setClipAnalyzeTaskFormat(value); break;
            case "analyzeContentPrompt": cfg.setAnalyzeContentPrompt(value); break;
            case "generateSummaryPrompt": cfg.setGenerateSummaryPrompt(value); break;
            case "generateTagsPrompt": cfg.setGenerateTagsPrompt(value); break;
            case "smartOrganizePrompt": cfg.setSmartOrganizePrompt(value); break;
            case "generateSynonymsPrompt": cfg.setGenerateSynonymsPrompt(value); break;
            case "divergentSummaryRoleMap": cfg.setDivergentSummaryRoleMap(value); break;
            case "wikiBatchExtractPrompt": cfg.setWikiBatchExtractPrompt(value); break;
            case "wikiGenerateEntityPagePrompt": cfg.setWikiGenerateEntityPagePrompt(value); break;
            case "wikiGenerateConceptPagePrompt": cfg.setWikiGenerateConceptPagePrompt(value); break;
            case "wikiGenerateSourcePagePrompt": cfg.setWikiGenerateSourcePagePrompt(value); break;
            case "wikiDetectContradictionPrompt": cfg.setWikiDetectContradictionPrompt(value); break;
            case "wikiQueryIndexPrompt": cfg.setWikiQueryIndexPrompt(value); break;
            case "wikiQuerySynthesisPrompt": cfg.setWikiQuerySynthesisPrompt(value); break;
            case "wikiLintPrompt": cfg.setWikiLintPrompt(value); break;
            default: break;
        }
    }

    private PromptTemplate findById(String id) {
        for (PromptTemplate t : loadLibrary()) {
            if (id.equals(t.getId())) {
                return t;
            }
        }
        return null;
    }

    // ==================== LangGPT 解析 ====================

    /** LangGPT 分段标题（忽略大小写，去空格） */
    private static final List<String> LANG_GPT_SECTIONS = List.of(
            "Role", "Profile", "Skills", "Rules", "Workflow", "Initialization", "Commands", "Reminder");

    private static final Pattern HEADING = Pattern.compile("^(#{1,2})\\s*([^#].*)$");

    /**
     * 解析 LangGPT 结构化提示词文本。
     * <p>识别一级/二级标题（Role/Profile/Skills/Rules/Workflow/Initialization/Commands/Reminder）
     * 分段，写入 sections；若不存在这些标题，则视为普通提示词（langgpt=false）。</p>
     *
     * @param rawText 原始文本
     * @return 解析后的模板结构（name/content/sections/langgpt）
     */
    public Map<String, Object> parseLangGpt(String rawText) {
        if (rawText == null || rawText.trim().isEmpty()) {
            throw new IllegalArgumentException("内容不能为空");
        }
        String text = rawText.trim();
        Map<String, String> sections = new LinkedHashMap<>();
        String roleName = null;

        // 第一遍：按标题切分，同时从标题行内联提取名称（如 "# Role: 逻辑学家"）
        String[] lines = text.split("\r?\n");
        StringBuilder current = null;
        String currentKey = null;
        for (String line : lines) {
            String trimmed = line.trim();
            Matcher m = HEADING.matcher(trimmed);
            if (m.matches()) {
                String title = m.group(2).trim();
                String key = normalizeSectionKey(title);
                if (key != null && LANG_GPT_SECTIONS.contains(key)) {
                    // 标题行内联名称（":" 之后的部分）
                    if ("Role".equals(key) && roleName == null) {
                        int colon = title.indexOf(':');
                        if (colon != -1) {
                            String inline = title.substring(colon + 1).trim();
                            if (!inline.isEmpty()) {
                                roleName = inline;
                            }
                        }
                    }
                    if (currentKey != null) {
                        sections.put(currentKey, current.toString().trim());
                    }
                    currentKey = key;
                    current = new StringBuilder();
                    continue;
                }
            }
            if (current != null) {
                current.append(line).append('\n');
            }
        }
        if (currentKey != null) {
            sections.put(currentKey, current.toString().trim());
        }

        // 名称兜底：Role 段无内联名时，取 Role 段首行
        if (roleName == null) {
            String roleSection = sections.get("Role");
            if (roleSection != null) {
                String firstLine = roleSection.split("\r?\n")[0].replace("#", "").trim();
                if (!firstLine.isEmpty()) {
                    roleName = firstLine;
                }
            }
        }

        // 内联 Role 名（如 "# Role: 逻辑学家"）无 body 时，把名称回填到 Role 段，保证分段编辑时 Role 非空
        if (roleName != null && !roleName.isEmpty()) {
            String role = sections.get("Role");
            if (role == null || role.trim().isEmpty()) {
                sections.put("Role", roleName);
            }
        }

        boolean langgpt = !sections.isEmpty();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("name", roleName);
        result.put("langgpt", langgpt);
        result.put("sections", sections);
        // 拼装 content：langgpt 时按标准格式重建，否则保留原文
        result.put("content", langgpt ? buildLangGptContent(roleName, sections) : text);
        return result;
    }

    private String normalizeSectionKey(String title) {
        String t = title.replace("#", "").trim();
        // 去掉冒号后的内容（如 "Role: 逻辑学家" → "Role"）
        int colon = t.indexOf(':');
        if (colon != -1) {
            t = t.substring(0, colon);
        }
        t = t.replaceAll("\\s+", "");
        for (String s : LANG_GPT_SECTIONS) {
            if (s.equalsIgnoreCase(t)) {
                return s;
            }
        }
        return null;
    }

    /**
     * 按 LangGPT 标准格式重建结构化提示词正文。
     */
    private String buildLangGptContent(String roleName, Map<String, String> sections) {
        StringBuilder sb = new StringBuilder();
        String role = sections.get("Role");
        if (roleName != null && !roleName.isEmpty()) {
            boolean hasRoleBody = role != null && !role.trim().isEmpty();
            String firstLine = hasRoleBody ? role.trim().split("\r?\n")[0].replace("#", "").trim() : "";
            boolean nameAlreadyInBody = hasRoleBody && roleName.equals(firstLine);
            sb.append("# Role");
            if (!nameAlreadyInBody) {
                sb.append(": ").append(roleName);
            }
            sb.append('\n');
            if (hasRoleBody) {
                sb.append(role.trim()).append('\n');
            }
        } else if (role != null && !role.trim().isEmpty()) {
            sb.append("# Role").append('\n').append(role.trim()).append('\n');
        }
        for (String key : LANG_GPT_SECTIONS) {
            if ("Role".equals(key)) continue;
            String body = sections.get(key);
            if (body != null && !body.trim().isEmpty()) {
                sb.append('\n').append("## ").append(key).append('\n');
                sb.append(body.trim()).append('\n');
            }
        }
        return sb.toString().trim();
    }

    private String normalize(String value, String def) {
        return value == null || value.trim().isEmpty() ? def : value.trim();
    }

    // ==================== AI 辅助生成/改写 ====================

    /**
     * AI 辅助生成 / 改写提示词。
     * <p>
     * mode=generate：根据用户描述生成一份 LangGPT 结构化提示词；
     * mode=rewrite：将已有提示词改写为更规范的 LangGPT 结构化提示词。
     * 使用 simple 模型档位，输出经 {@link #parseLangGpt} 解析后返回。
     * </p>
     *
     * @param mode        generate | rewrite
     * @param description 生成模式下的角色/用途描述
     * @param existingText 改写模式下的已有提示词文本
     * @return 解析结果 {name, langgpt, sections, content}
     */
    public Map<String, Object> aiAssist(String mode, String description, String existingText) {
        String m = normalize(mode, "generate");
        boolean rewrite = "rewrite".equalsIgnoreCase(m);

        String systemPrompt;
        String userMessage;
        if (rewrite) {
            systemPrompt = "你是提示词优化专家。请将用户提供的提示词改写为更规范、更清晰、更可复用的 LangGPT 结构化提示词，必须包含以下分段：\n"
                    + "# Role（角色名）\n"
                    + "## Profile\n- Author: LangGPT\n- Version: 1.0\n- Language: 中文\n- Description: 一句话概述角色核心能力\n"
                    + "## Skills（具体技能）\n"
                    + "## Rules（边界与约束）\n"
                    + "## Workflow（交互流程）\n"
                    + "## Initialization（开场与初始化）\n"
                    + "要求：尽量保留原意并补齐缺失分段，删除冗余表述，语言精炼。\n"
                    + "只输出 LangGPT 提示词正文，不要输出任何解释、前缀或额外文字。";
            userMessage = existingText == null || existingText.trim().isEmpty() ? "请改写你的提示词" : existingText.trim();
        } else {
            systemPrompt = "你是 LangGPT 结构化提示词生成器。请根据用户描述的角色或用途，生成一份可直接使用的 LangGPT 结构化提示词，必须包含以下分段：\n"
                    + "# Role（角色名）\n"
                    + "## Profile\n- Author: LangGPT\n- Version: 1.0\n- Language: 中文\n- Description: 一句话概述角色核心能力\n"
                    + "## Skills（具体技能，2-4 条）\n"
                    + "## Rules（边界与约束，2-4 条）\n"
                    + "## Workflow（交互流程，3-5 步）\n"
                    + "## Initialization（开场与初始化）\n"
                    + "要求：内容具体、可执行、贴合用户描述的场景。\n"
                    + "只输出 LangGPT 提示词正文，不要输出任何解释、前缀或额外文字。";
            userMessage = description == null || description.trim().isEmpty() ? "请描述你想要的提示词角色或用途" : description.trim();
        }

        String raw = llmProvider.chatForTier(systemPrompt, userMessage, "simple");
        if (raw == null || raw.trim().isEmpty()) {
            throw new IllegalStateException("AI 未返回内容，请重试");
        }
        // 剥离可能的 markdown 代码块包裹
        String cleaned = raw.trim();
        if (cleaned.startsWith("```")) {
            int firstNl = cleaned.indexOf('\n');
            int lastIdx = cleaned.lastIndexOf("```");
            if (firstNl != -1 && lastIdx > firstNl) {
                cleaned = cleaned.substring(firstNl + 1, lastIdx).trim();
            }
        }
        Map<String, Object> parsed = parseLangGpt(cleaned);
        if (Boolean.FALSE.equals(parsed.get("langgpt"))) {
            // AI 未按结构输出时仍返回原文，交由前端以普通模板落库
            parsed.put("content", cleaned);
        }
        return parsed;
    }

    /**
     * 批量从 GitHub raw URL 抓取并导入 LangGPT 提示词。
     * <p>逐个抓取 .md 原文，解析后以指定分类入库（默认「LangGPT 模板库」）。单个失败不影响其他。</p>
     *
     * @param urls     raw.githubusercontent.com 的 .md 地址列表
     * @param category 统一分类（为空默认「LangGPT 模板库」）
     * @return {imported, failed, results:[{name, ok, error?}]}
     */
    public Map<String, Object> importBatch(List<String> urls, String category) {
        String cat = normalize(category, "LangGPT 模板库");
        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
        List<Map<String, Object>> results = new ArrayList<>();
        int imported = 0, failed = 0;
        for (String url : urls) {
            String base = url == null ? "" : url.trim();
            String name = deriveName(base);
            try {
                HttpRequest req = HttpRequest.newBuilder(URI.create(base))
                        .timeout(Duration.ofSeconds(25))
                        .header("User-Agent", "Mozilla/5.0")
                        .GET().build();
                HttpResponse<String> resp = client.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
                if (resp.statusCode() != 200) {
                    throw new IOException("HTTP " + resp.statusCode());
                }
                Map<String, Object> parsed = parseLangGpt(resp.body());
                Object parsedName = parsed.get("name");
                if (parsedName != null && !parsedName.toString().trim().isEmpty()) {
                    name = parsedName.toString().trim();
                }
                @SuppressWarnings("unchecked")
                Map<String, String> sections = (Map<String, String>) parsed.get("sections");
                createPrompt(name, cat, "来自 LangGPT 官方提示词库", (String) parsed.get("content"),
                        new ArrayList<>(), null, Boolean.TRUE.equals(parsed.get("langgpt")), sections);
                imported++;
                results.add(Map.of("name", name, "ok", true));
            } catch (Exception e) {
                log.warn("[PromptLibrary] 批量导入失败 {}: {}", base, e.getMessage());
                failed++;
                results.add(Map.of("name", name, "ok", false, "error", e.getMessage()));
            }
        }
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("imported", imported);
        r.put("failed", failed);
        r.put("results", results);
        return r;
    }

    /** 从 raw URL 提取文件名（去 .md 后缀与路径）作为默认名称。 */
    private String deriveName(String url) {
        if (url == null || url.isEmpty()) return "LangGPT 提示词";
        String f = url;
        int q = f.indexOf('?');
        if (q != -1) f = f.substring(0, q);
        int slash = f.lastIndexOf('/');
        if (slash != -1) f = f.substring(slash + 1);
        if (f.endsWith(".md")) f = f.substring(0, f.length() - 3);
        if (f.endsWith(".")) f = f.substring(0, f.length() - 1);
        return f.replaceAll("_+", " ").trim().isEmpty() ? "LangGPT 提示词" : f;
    }
}