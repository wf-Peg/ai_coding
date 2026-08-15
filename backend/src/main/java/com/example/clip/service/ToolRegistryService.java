package com.example.clip.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 工具注册表服务 —— 管理工具模块（Tools Hub）内可拔插的小工具。
 * <p>
 * 每个小工具 = 一个自包含 HTML 页面 + 一条注册元数据（含开发提示词 prompt）。
 * 注册表与工具页面统一存储在 {@code ~/.cut-shelter/tools/} 目录下：
 * <ul>
 *   <li>{@code registry.json}：工具元数据注册表</li>
 *   <li>{@code <toolId>.html}：各工具自包含页面</li>
 * </ul>
 * 支持内置工具（builtin=true，不可删除）与用户导入工具（可删除）。
 * </p>
 */
@Service
public class ToolRegistryService {

    private static final Logger log = LoggerFactory.getLogger(ToolRegistryService.class);

    /** 工具存储根目录（相对用户主目录） */
    private static final String TOOLS_DIR = ".cut-shelter/tools";

    /** 注册表文件名 */
    private static final String REGISTRY_FILE = "registry.json";

    private final ObjectMapper objectMapper;

    public ToolRegistryService() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.enable(SerializationFeature.INDENT_OUTPUT);
        this.objectMapper = mapper;
    }

    /**
     * 内置工具定义。
     * <p>资源文件位于 classpath {@code resources/tools/} 下，首次启动时复制到用户工具目录并登记注册表。</p>
     */
    private static final List<Map<String, Object>> BUILTIN_TOOLS = builtinTools();

    private static List<Map<String, Object>> builtinTools() {
        List<Map<String, Object>> list = new ArrayList<>();
        list.add(tool("pdf-toolbox", "PDF 工具箱", "📄", "文件处理", "合并、拆分、提取文本与 OCR 识别 PDF 文档",
                Arrays.asList("pdf", "合并", "拆分", "ocr", "提取"),
                "开发一个 PDF 处理工具，支持：1) 合并多个 PDF；2) 按页/页码范围拆分（结果打包 zip）；3) 提取全文文本；4) OCR 识别。界面用卡片 + 拖拽上传，风格参考 Notion，使用 design-tokens 变量，自包含单 HTML。"));
        list.add(tool("batch-rename", "批量重命名", "🗂️", "文件处理", "按规则批量重命名指定目录下的文件，实时预览新文件名",
                Arrays.asList("重命名", "批量", "文件", "rename"),
                "开发一个批量重命名工具：通过 Electron IPC 选择目录并列出文件；支持前缀/后缀、替换文本、序号、大小写等规则；实时预览新文件名；一键执行。自包含单 HTML。"));
        list.add(tool("image-convert", "图片转换", "🖼️", "文件处理", "图片格式转换与压缩，支持 png/jpg/webp/gif 互转与质量调节",
                Arrays.asList("图片", "转换", "压缩", "格式"),
                "开发一个图片格式转换与压缩工具：上传图片，选择目标格式与压缩质量，调用后端 /api/tools/image/convert 转换并下载。自包含单 HTML。"));
        list.add(tool("csv-json", "CSV ↔ JSON", "🧾", "文件处理", "CSV 与 JSON 互转，支持自定义分隔符与缩进",
                Arrays.asList("csv", "json", "转换", "表格"),
                "开发一个 CSV 与 JSON 双向转换工具：粘贴或上传内容，选择转换方向与分隔符，调用后端 /api/tools/csv-json 转换。自包含单 HTML。"));
        return list;
    }

    private static Map<String, Object> tool(String id, String name, String icon, String category,
                                            String description, List<String> keywords, String prompt) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("name", name);
        m.put("icon", icon);
        m.put("category", category);
        m.put("description", description);
        m.put("keywords", keywords);
        m.put("file", id + ".html");
        m.put("prompt", prompt);
        m.put("builtin", true);
        m.put("createdAt", "builtin");
        return m;
    }

    /**
     * 初始化：确保内置工具页面与注册表项存在。
     * <p>类路径 {@code resources/tools/&lt;id&gt;.html} 不存在时，跳过该内置工具。</p>
     */
    @PostConstruct
    public void init() {
        Map<String, Object> registry = loadRegistry();
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> tools = registry.get("tools") instanceof List
                ? (List<Map<String, Object>>) registry.get("tools") : new ArrayList<>();

        boolean changed = false;
        for (Map<String, Object> builtin : BUILTIN_TOOLS) {
            String id = builtin.get("id").toString();
            String fileName = id + ".html";
            Path pagePath = getToolsDir().resolve(fileName);
            // 复制内置页面到用户目录（若缺失）
            if (!Files.exists(pagePath)) {
                copyBuiltinPage(id, fileName, pagePath);
            }
            // 注册表已有该 id 则跳过
            boolean exists = tools.stream().anyMatch(t -> id.equals(t.get("id")));
            if (!exists) {
                tools.add(builtin);
                changed = true;
            }
        }
        registry.put("tools", tools);
        if (changed) {
            saveRegistry(registry);
        }
        log.info("[ToolRegistry] Initialized with {} tools", tools.size());
    }

    /**
     * 从 classpath 复制内置工具页面到用户工具目录。
     *
     * @param id       工具 id
     * @param fileName 目标文件名
     * @param target   目标路径
     */
    private void copyBuiltinPage(String id, String fileName, Path target) {
        try {
            ClassPathResource resource = new ClassPathResource("tools/" + fileName);
            if (!resource.exists()) {
                log.warn("[ToolRegistry] Builtin page resource missing: tools/{}", fileName);
                return;
            }
            try (InputStream in = resource.getInputStream()) {
                Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
            }
            log.info("[ToolRegistry] Seeded builtin tool page: {}", fileName);
        } catch (IOException e) {
            log.warn("[ToolRegistry] Failed to seed builtin page {}: {}", fileName, e.getMessage());
        }
    }

    /**
     * 获取工具存储根目录，不存在则创建。
     *
     * @return 工具存储目录
     */
    private Path getToolsDir() {
        String userHome = System.getProperty("user.home");
        if (userHome == null || userHome.isEmpty()) {
            userHome = ".";
        }
        Path dir = Paths.get(userHome, TOOLS_DIR);
        try {
            Files.createDirectories(dir);
        } catch (IOException e) {
            log.warn("[ToolRegistry] Failed to create tools dir: {}", e.getMessage());
        }
        return dir;
    }

    /**
     * 获取注册表文件路径。
     *
     * @return registry.json 路径
     */
    private Path getRegistryPath() {
        return getToolsDir().resolve(REGISTRY_FILE);
    }

    /**
     * 读取注册表；文件不存在或解析失败时返回空注册表。
     *
     * @return 注册表 Map（含 tools 列表）
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> loadRegistry() {
        Path registryPath = getRegistryPath();
        if (!Files.exists(registryPath)) {
            Map<String, Object> empty = new LinkedHashMap<>();
            empty.put("version", 1);
            empty.put("tools", new ArrayList<Map<String, Object>>());
            return empty;
        }
        try {
            String content = Files.readString(registryPath, StandardCharsets.UTF_8);
            return objectMapper.readValue(content, LinkedHashMap.class);
        } catch (Exception e) {
            log.warn("[ToolRegistry] Failed to load registry, using empty: {}", e.getMessage());
            Map<String, Object> empty = new LinkedHashMap<>();
            empty.put("version", 1);
            empty.put("tools", new ArrayList<Map<String, Object>>());
            return empty;
        }
    }

    /**
     * 保存注册表到磁盘。
     *
     * @param registry 注册表 Map
     */
    private void saveRegistry(Map<String, Object> registry) {
        try {
            Files.writeString(getRegistryPath(), objectMapper.writeValueAsString(registry), StandardCharsets.UTF_8);
        } catch (IOException e) {
            log.error("[ToolRegistry] Failed to save registry: {}", e.getMessage());
        }
    }

    /**
     * 列出全部工具元数据（不含页面内容）。
     *
     * @return 工具列表
     */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> listTools() {
        Map<String, Object> registry = loadRegistry();
        Object toolsObj = registry.get("tools");
        return toolsObj instanceof List ? (List<Map<String, Object>>) toolsObj : new ArrayList<>();
    }

    /**
     * 导入一个新工具：写入 HTML 页面并登记元数据。
     *
     * @param name        工具名称
     * @param category    分类
     * @param description 一句话描述
     * @param prompt      开发需求提示词
     * @param htmlContent 自包含 HTML 页面内容
     * @return 新工具元数据
     */
    public Map<String, Object> importTool(String name, String category, String description,
                                          String prompt, String htmlContent) {
        String id = "tool-" + UUID.randomUUID().toString().substring(0, 8);
        String fileName = id + ".html";

        // 写入 HTML 页面
        try {
            Files.writeString(getToolsDir().resolve(fileName), htmlContent, StandardCharsets.UTF_8);
        } catch (IOException e) {
            log.error("[ToolRegistry] Failed to write tool page: {}", e.getMessage());
            throw new RuntimeException("写入工具页面失败: " + e.getMessage());
        }

        Map<String, Object> tool = new LinkedHashMap<>();
        tool.put("id", id);
        tool.put("name", name != null ? name : "未命名工具");
        tool.put("icon", "🧰");
        tool.put("category", category != null && !category.isEmpty() ? category : "其他");
        tool.put("description", description != null ? description : "");
        tool.put("keywords", new ArrayList<String>());
        tool.put("file", fileName);
        tool.put("prompt", prompt != null ? prompt : "");
        tool.put("builtin", false);
        tool.put("createdAt", LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")));

        Map<String, Object> registry = loadRegistry();
        Object toolsObj = registry.get("tools");
        List<Map<String, Object>> tools;
        if (toolsObj instanceof List) {
            tools = (List<Map<String, Object>>) toolsObj;
        } else {
            tools = new ArrayList<>();
            registry.put("tools", tools);
        }
        tools.add(tool);
        saveRegistry(registry);

        log.info("[ToolRegistry] Imported tool: {} ({})", name, id);
        return tool;
    }

    /**
     * 删除一个工具（内置工具不可删除）。
     *
     * @param id 工具 id
     * @return 是否删除成功
     */
    @SuppressWarnings("unchecked")
    public boolean deleteTool(String id) {
        Map<String, Object> registry = loadRegistry();
        Object toolsObj = registry.get("tools");
        List<Map<String, Object>> tools = toolsObj instanceof List
                ? (List<Map<String, Object>>) toolsObj : new ArrayList<>();

        Map<String, Object> target = null;
        for (Map<String, Object> t : tools) {
            if (id.equals(t.get("id"))) {
                target = t;
                break;
            }
        }
        if (target == null) {
            return false;
        }
        Object builtin = target.get("builtin");
        if (Boolean.TRUE.equals(builtin)) {
            log.warn("[ToolRegistry] Refuse to delete builtin tool: {}", id);
            throw new IllegalArgumentException("内置工具不可删除");
        }

        // 删除页面文件
        Object file = target.get("file");
        if (file != null) {
            try {
                Files.deleteIfExists(getToolsDir().resolve(file.toString()));
            } catch (IOException e) {
                log.warn("[ToolRegistry] Failed to delete tool page {}: {}", file, e.getMessage());
            }
        }
        tools.remove(target);
        saveRegistry(registry);
        log.info("[ToolRegistry] Deleted tool: {}", id);
        return true;
    }

    /**
     * 读取工具页面 HTML 内容。
     *
     * @param id 工具 id
     * @return HTML 内容；工具不存在返回 null
     */
    @SuppressWarnings("unchecked")
    public String getToolPage(String id) {
        Map<String, Object> registry = loadRegistry();
        Object toolsObj = registry.get("tools");
        if (!(toolsObj instanceof List)) {
            return null;
        }
        for (Map<String, Object> t : (List<Map<String, Object>>) toolsObj) {
            if (id.equals(t.get("id")) && t.get("file") != null) {
                Path page = getToolsDir().resolve(t.get("file").toString());
                if (Files.exists(page)) {
                    try {
                        return Files.readString(page, StandardCharsets.UTF_8);
                    } catch (IOException e) {
                        log.warn("[ToolRegistry] Failed to read tool page {}: {}", t.get("file"), e.getMessage());
                        return null;
                    }
                }
            }
        }
        return null;
    }

    /**
     * 读取工具的开发提示词。
     *
     * @param id 工具 id
     * @return 提示词；工具不存在返回 null
     */
    @SuppressWarnings("unchecked")
    public String getToolPrompt(String id) {
        Map<String, Object> registry = loadRegistry();
        Object toolsObj = registry.get("tools");
        if (!(toolsObj instanceof List)) {
            return null;
        }
        for (Map<String, Object> t : (List<Map<String, Object>>) toolsObj) {
            if (id.equals(t.get("id"))) {
                Object prompt = t.get("prompt");
                return prompt != null ? prompt.toString() : "";
            }
        }
        return null;
    }
}