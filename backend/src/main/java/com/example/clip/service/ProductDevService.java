package com.example.clip.service;

import com.example.clip.model.ProductDevRecord;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 产品开发工作区业务服务
 * <p>
 * 负责产品开发工作区的数据持久化、统计聚合、归档文件解析和历史迁移。
 * 数据存储使用本地 JSON 文件系统，存储路径为 {@code {storagePath}/product-dev/}。
 * </p>
 *
 * <h3>数据文件结构</h3>
 * <ul>
 *   <li><b>records.json</b>：所有 ProductDevRecord 的 JSON 数组文件</li>
 *   <li><b>archives/</b>：agent 自动写入的归档文件目录（{yyMMdd-HHmmss}-{标识}.json）</li>
 * </ul>
 *
 * @see ProductDevRecord
 * @see FileStorageService
 */
@Service
public class ProductDevService {

    private static final Logger log = LoggerFactory.getLogger(ProductDevService.class);

    /** JSON 序列化/反序列化工具 */
    private final ObjectMapper objectMapper;

    /** 产品开发数据存储根目录（相对于 storagePath） */
    private static final String PRODUCT_DEV_DIR = "product-dev";

    /** 主数据文件名 */
    private static final String RECORDS_FILE = "records.json";

    /** 归档文件子目录 */
    private static final String ARCHIVES_DIR = "archives";

    /** 文件存储服务，用于获取 storagePath */
    private final FileStorageService fileStorageService;

    /**
     * 构造器，初始化 Jackson ObjectMapper（注册 JavaTimeModule 支持 LocalDateTime）
     *
     * @param fileStorageService 文件存储服务
     */
    @Autowired
    public ProductDevService(FileStorageService fileStorageService) {
        this.fileStorageService = fileStorageService;
        this.objectMapper = new ObjectMapper();
        this.objectMapper.registerModule(new JavaTimeModule());
        this.objectMapper.configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        // 确保数据目录和归档目录存在
        ensureDirectories();
    }

    // ==================== 目录与文件路径 ====================

    /**
     * 获取产品开发数据目录路径
     * <p>
     * 即：{storagePath}/product-dev/
     * </p>
     *
     * @return 产品开发数据目录
     */
    private Path getProductDevDir() {
        return fileStorageService.getStoragePath().resolve(PRODUCT_DEV_DIR);
    }

    /**
     * 获取主数据文件路径
     * <p>
     * 即：{storagePath}/product-dev/records.json
     * </p>
     *
     * @return 主数据文件路径
     */
    private Path getRecordsFilePath() {
        return getProductDevDir().resolve(RECORDS_FILE);
    }

    /**
     * 获取归档文件目录路径
     * <p>
     * 即：{storagePath}/product-dev/archives/
     * </p>
     *
     * @return 归档文件目录路径
     */
    private Path getArchivesDir() {
        return getProductDevDir().resolve(ARCHIVES_DIR);
    }

    /**
     * 确保数据目录和归档目录存在，不存在则创建
     */
    private void ensureDirectories() {
        try {
            Files.createDirectories(getProductDevDir());
            Files.createDirectories(getArchivesDir());
            log.info("[ProductDevService] 数据目录已就绪: {}", getProductDevDir());
        } catch (IOException e) {
            log.error("[ProductDevService] 创建数据目录失败: {}", e.getMessage(), e);
        }
    }

    // ==================== 数据读写 ====================

    /**
     * 从 records.json 读取所有记录
     * <p>
     * 如果文件不存在或内容为空，返回空列表。
     * 使用 Jackson TypeReference 进行泛型反序列化。
     * </p>
     *
     * @return ProductDevRecord 列表（可能为空）
     */
    public List<ProductDevRecord> readAllRecords() {
        Path path = getRecordsFilePath();
        if (!Files.exists(path)) {
            return new ArrayList<>();
        }
        try {
            String content = Files.readString(path);
            if (content == null || content.trim().isEmpty()) {
                return new ArrayList<>();
            }
            List<ProductDevRecord> records = objectMapper.readValue(content, new TypeReference<List<ProductDevRecord>>() {});
            return records == null ? new ArrayList<>() : records;
        } catch (IOException e) {
            log.error("[ProductDevService] 读取记录文件失败: {}", e.getMessage(), e);
            return new ArrayList<>();
        }
    }

    /**
     * 将所有记录写入 records.json
     * <p>
     * 自动创建父目录，使用 pretty printer 格式化输出。
     * </p>
     *
     * @param records 要写入的记录列表
     */
    private synchronized void writeAllRecords(List<ProductDevRecord> records) {
        try {
            Path path = getRecordsFilePath();
            Files.createDirectories(path.getParent());
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(path.toFile(), records);
            log.debug("[ProductDevService] 已写入 {} 条记录到 {}", records.size(), path);
        } catch (IOException e) {
            log.error("[ProductDevService] 写入记录文件失败: {}", e.getMessage(), e);
        }
    }

    /**
     * 保存一条记录（新增或更新）
     * <p>
     * 如果 ID 为 null 则生成新 UUID；如果 ID 已存在则更新对应记录。
     * </p>
     *
     * @param record 产品开发记录
     * @return 保存后的记录；若失败返回 null
     */
    public synchronized ProductDevRecord saveRecord(ProductDevRecord record) {
        try {
            if (record.getId() == null || record.getId().isEmpty()) {
                // 新记录：生成 UUID 并设置时间戳
                record.setId(UUID.randomUUID().toString());
                record.setCreatedAt(LocalDateTime.now());
                record.setUpdatedAt(LocalDateTime.now());
            } else {
                // 更新场景：保留原有 createdAt
                ProductDevRecord existing = getRecordById(record.getId());
                if (existing != null && record.getCreatedAt() == null) {
                    record.setCreatedAt(existing.getCreatedAt());
                }
                record.setUpdatedAt(LocalDateTime.now());
            }

            // 补全默认值
            if (record.getType() == null) record.setType("requirement");
            if (record.getStatus() == null) record.setStatus("todo");
            if (record.getSource() == null) record.setSource("manual");

            List<ProductDevRecord> records = readAllRecords();
            boolean updated = false;
            for (int i = 0; i < records.size(); i++) {
                if (record.getId().equals(records.get(i).getId())) {
                    records.set(i, record);
                    updated = true;
                    break;
                }
            }
            if (!updated) {
                records.add(record);
            }
            writeAllRecords(records);
            log.info("[ProductDevService] 已保存记录: id={}, title={}, type={}", record.getId(), record.getTitle(), record.getType());
            return record;
        } catch (Exception e) {
            log.error("[ProductDevService] 保存记录失败: {}", e.getMessage(), e);
            return null;
        }
    }

    /**
     * 根据 ID 获取记录
     *
     * @param id 记录 ID
     * @return 匹配的记录；未找到返回 null
     */
    public ProductDevRecord getRecordById(String id) {
        if (id == null || id.isEmpty()) return null;
        return readAllRecords().stream()
                .filter(r -> id.equals(r.getId()))
                .findFirst()
                .orElse(null);
    }

    /**
     * 删除指定 ID 的记录
     *
     * @param id 要删除的记录 ID
     */
    public synchronized void deleteRecord(String id) {
        if (id == null || id.isEmpty()) return;
        List<ProductDevRecord> records = readAllRecords();
        boolean removed = records.removeIf(r -> id.equals(r.getId()));
        if (removed) {
            writeAllRecords(records);
            log.info("[ProductDevService] 已删除记录: id={}", id);
        }
    }

    // ==================== 归档文件解析 ====================

    /**
     * 解析归档文件
     * <p>
     * 扫描 {@code archives/} 目录下的所有 JSON 文件，解析为 ProductDevRecord。
     * 归档文件格式由 agent 的 product-dev-archive skill 在编码任务完成后自动写入。
     * </p>
     *
     * @return 解析出的记录列表
     */
    public List<ProductDevRecord> parseArchiveFiles() {
        List<ProductDevRecord> parsedRecords = new ArrayList<>();
        Path archivesDir = getArchivesDir();
        if (!Files.exists(archivesDir)) {
            log.warn("[ProductDevService] 归档目录不存在: {}", archivesDir);
            return parsedRecords;
        }
        try {
            List<File> archiveFiles = Files.walk(archivesDir, 1)
                    .filter(Files::isRegularFile)
                    .filter(p -> p.toString().endsWith(".json"))
                    .map(Path::toFile)
                    .sorted(File::compareTo)
                    .toList();

            for (File file : archiveFiles) {
                try {
                    // 读取归档文件，格式为 Map（包含 requirement、knowledge、todos 等字段）
                    Map<String, Object> archiveData = objectMapper.readValue(file, new TypeReference<Map<String, Object>>() {});
                    List<ProductDevRecord> records = parseArchiveEntry(archiveData, file.getName());
                    parsedRecords.addAll(records);
                    log.info("[ProductDevService] 已解析归档文件: {} → {} 条记录", file.getName(), records.size());
                } catch (IOException e) {
                    log.warn("[ProductDevService] 解析归档文件失败，跳过: {} - {}", file.getName(), e.getMessage());
                }
            }
        } catch (IOException e) {
            log.error("[ProductDevService] 扫描归档目录失败: {}", e.getMessage(), e);
        }
        return parsedRecords;
    }

    /**
     * 解析单条归档条目为 ProductDevRecord 列表
     * <p>
     * 归档文件结构：
     * <pre>
     * {
     *   "requirement": { "title": "...", "description": "...", "phase": "...", "tags": [...], "content": "..." },
     *   "knowledge": [ { "title": "...", "content": "...", "tags": [...] } ],
     *   "todos": [ { "title": "...", "description": "...", "status": "...", "priority": "..." } ]
     * }
     * </pre>
     * </p>
     *
     * @param archiveData 归档数据 Map
     * @param fileName    归档文件名
     * @return 解析出的记录列表
     */
    @SuppressWarnings("unchecked")
    private List<ProductDevRecord> parseArchiveEntry(Map<String, Object> archiveData, String fileName) {
        List<ProductDevRecord> records = new ArrayList<>();
        LocalDateTime now = LocalDateTime.now();

        // 解析 requirement 字段
        if (archiveData.containsKey("requirement")) {
            Map<String, Object> req = (Map<String, Object>) archiveData.get("requirement");
            String title = (String) req.getOrDefault("title", "未命名需求");
            String description = (String) req.getOrDefault("description", "");
            String phase = (String) req.getOrDefault("phase", "analysis");
            String content = (String) req.getOrDefault("content", "");
            List<String> tags = (List<String>) req.getOrDefault("tags", new ArrayList<String>());

            // 创建需求记录
            String reqId = UUID.randomUUID().toString();
            ProductDevRecord requirement = new ProductDevRecord(
                    reqId, "requirement", title, description,
                    phase, "in-progress", "archive", fileName,
                    tags, null, content, now, now
            );
            records.add(requirement);

            // 解析 knowledge 字段（关联到当前需求）
            if (archiveData.containsKey("knowledge")) {
                Object knowledgeObj = archiveData.get("knowledge");
                List<Map<String, Object>> knowledgeList;
                if (knowledgeObj instanceof List) {
                    knowledgeList = (List<Map<String, Object>>) knowledgeObj;
                } else if (knowledgeObj instanceof Map) {
                    knowledgeList = List.of((Map<String, Object>) knowledgeObj);
                } else {
                    knowledgeList = new ArrayList<>();
                }
                for (Map<String, Object> kn : knowledgeList) {
                    String knTitle = (String) kn.getOrDefault("title", "未命名知识");
                    String knContent = (String) kn.getOrDefault("content", "");
                    List<String> knTags = (List<String>) kn.getOrDefault("tags", new ArrayList<String>());
                    // 合并需求标签
                    List<String> mergedTags = new ArrayList<>(knTags);
                    for (String t : tags) {
                        if (!mergedTags.contains(t)) mergedTags.add(t);
                    }
                    ProductDevRecord knowledge = new ProductDevRecord(
                            UUID.randomUUID().toString(), "knowledge", knTitle, "",
                            phase, "done", "archive", fileName,
                            mergedTags, reqId, knContent, now, now
                    );
                    records.add(knowledge);
                }
            }

            // 解析 todos 字段（关联到当前需求）
            if (archiveData.containsKey("todos")) {
                List<Map<String, Object>> todosList = (List<Map<String, Object>>) archiveData.get("todos");
                for (Map<String, Object> td : todosList) {
                    String tdTitle = (String) td.getOrDefault("title", "未命名待办");
                    String tdDesc = (String) td.getOrDefault("description", "");
                    String tdStatus = (String) td.getOrDefault("status", "todo");
                    String tdPriority = (String) td.getOrDefault("priority", "medium");
                    // 将优先级信息放入 tags
                    List<String> tdTags = new ArrayList<>(tags);
                    tdTags.add("priority:" + tdPriority);
                    ProductDevRecord todo = new ProductDevRecord(
                            UUID.randomUUID().toString(), "todo", tdTitle, tdDesc,
                            phase, tdStatus, "archive", fileName,
                            tdTags, reqId, "", now, now
                    );
                    records.add(todo);
                }
            }
        }

        return records;
    }

    // ==================== 历史迁移 ====================

    /**
     * 执行历史迁移
     * <p>
     * 扫描项目根目录下的 TODO/ 和 .trae/specs/ 目录，将 markdown 文件解析为 ProductDevRecord。
     * TODO/ 目录下的文件使用编号前缀映射规则：
     * <ul>
     *   <li>01-* → 需求 + 知识</li>
     *   <li>02-* → 知识</li>
     *   <li>03-* → 待办</li>
     *   <li>04-* → 待办（验收项）</li>
     * </ul>
     * .trae/specs/ 目录下的文件：
     * <ul>
     *   <li>spec.md → 知识</li>
     *   <li>tasks.md → 待办</li>
     *   <li>checklist.md → 待办（验收项）</li>
     * </ul>
     * </p>
     *
     * @return 迁移结果摘要，包含各类型数量
     */
    public Map<String, Object> executeMigration() {
        log.info("[ProductDevService] 开始执行历史迁移...");
        Map<String, Object> result = new LinkedHashMap<>();
        List<ProductDevRecord> migratedRecords = new ArrayList<>();
        int totalRequirements = 0;
        int totalKnowledge = 0;
        int totalTodos = 0;
        int totalClips = 0;

        // 获取项目根目录（从 storagePath 的父目录推断）
        Path projectRoot = fileStorageService.getStoragePath().getParent();
        if (projectRoot == null) {
            projectRoot = Path.of(".");
        }
        log.info("[ProductDevService] 项目根目录: {}", projectRoot);

        // 1. 扫描 TODO/ 目录
        Path todoDir = projectRoot.resolve("TODO");
        if (Files.exists(todoDir) && Files.isDirectory(todoDir)) {
            log.info("[ProductDevService] 扫描 TODO/ 目录: {}", todoDir);
            try {
                List<Path> subDirs = Files.list(todoDir)
                        .filter(Files::isDirectory)
                        .toList();
                for (Path subDir : subDirs) {
                    String dirName = subDir.getFileName().toString();
                    // 跳过 bugs 目录，单独处理
                    if ("bugs".equals(dirName)) {
                        // 解析 bug-history.md 为剪藏
                        Path bugFile = subDir.resolve("bug-history.md");
                        if (Files.exists(bugFile)) {
                            String content = Files.readString(bugFile);
                            ProductDevRecord clip = new ProductDevRecord(
                                    UUID.randomUUID().toString(), "requirement", "Bug 记录 - " + dirName,
                                    "Bug 历史记录", "completed", "done", "migrate",
                                    subDir.toString(), List.of("bug", "history-migrate"),
                                    null, content, LocalDateTime.now(), LocalDateTime.now()
                            );
                            migratedRecords.add(clip);
                            totalClips++;
                        }
                        continue;
                    }

                    // 处理子目录中的 markdown 文件
                    List<Path> mdFiles = Files.list(subDir)
                            .filter(Files::isRegularFile)
                            .filter(p -> p.toString().endsWith(".md"))
                            .sorted()
                            .toList();

                    String reqId = null;
                    String reqTitle = dirName;
                    String reqDescription = "";
                    String reqContent = "";
                    boolean hasRequirement = false;
                    List<String> reqTags = List.of("history-migrate", "todo-migration");

                    for (Path mdFile : mdFiles) {
                        String fileName = mdFile.getFileName().toString();
                        String fileContent = Files.readString(mdFile);
                        LocalDateTime now = LocalDateTime.now();

                        if (fileName.startsWith("01-") || fileName.startsWith("01_")) {
                            // 主线任务说明 → 需求 + 知识
                            reqTitle = fileContent.lines().findFirst().orElse(dirName).replace("#", "").trim();
                            if (reqTitle.isEmpty()) reqTitle = dirName;
                            reqDescription = fileContent.length() > 200 ? fileContent.substring(0, 200) + "..." : fileContent;
                            reqContent = fileContent;
                            hasRequirement = true;
                            totalClips++;

                            // 同时创建知识条目
                            ProductDevRecord knowledge = new ProductDevRecord(
                                    UUID.randomUUID().toString(), "knowledge", "需求文档：" + reqTitle,
                                    "从 TODO/" + dirName + "/" + fileName + " 迁移", "completed", "done",
                                    "migrate", mdFile.toString(), reqTags, null, fileContent, now, now
                            );
                            migratedRecords.add(knowledge);
                            totalKnowledge++;
                        } else if (fileName.startsWith("02-") || fileName.startsWith("02_")) {
                            // 规格文档 → 知识
                            String knTitle = "规格文档：" + extractTitle(fileContent, dirName);
                            ProductDevRecord knowledge = new ProductDevRecord(
                                    UUID.randomUUID().toString(), "knowledge", knTitle,
                                    "从 TODO/" + dirName + "/" + fileName + " 迁移", "completed", "done",
                                    "migrate", mdFile.toString(), reqTags, null, fileContent, now, now
                            );
                            migratedRecords.add(knowledge);
                            totalKnowledge++;
                        } else if (fileName.startsWith("03-") || fileName.startsWith("03_")) {
                            // 实施任务 → 待办
                            List<String> todoItems = parseMarkdownTasks(fileContent);
                            for (String task : todoItems) {
                                ProductDevRecord todo = new ProductDevRecord(
                                        UUID.randomUUID().toString(), "todo", task,
                                        "从 TODO/" + dirName + "/" + fileName + " 迁移", "completed", "done",
                                        "migrate", mdFile.toString(), reqTags, reqId, "", now, now
                                );
                                migratedRecords.add(todo);
                                totalTodos++;
                            }
                        } else if (fileName.startsWith("04-") || fileName.startsWith("04_")) {
                            // 验收清单 → 待办（验收项）
                            List<String> checklistItems = parseMarkdownTasks(fileContent);
                            for (String item : checklistItems) {
                                List<String> checkTags = new ArrayList<>(reqTags);
                                checkTags.add("checklist");
                                ProductDevRecord todo = new ProductDevRecord(
                                        UUID.randomUUID().toString(), "todo", "[验收] " + item,
                                        "从 TODO/" + dirName + "/" + fileName + " 迁移", "completed", "done",
                                        "migrate", mdFile.toString(), checkTags, reqId, "", now, now
                                );
                                migratedRecords.add(todo);
                                totalTodos++;
                            }
                        } else {
                            // 其他 markdown 文件 → 知识
                            String knTitle = extractTitle(fileContent, fileName.replace(".md", ""));
                            ProductDevRecord knowledge = new ProductDevRecord(
                                    UUID.randomUUID().toString(), "knowledge", knTitle,
                                    "从 TODO/" + dirName + "/" + fileName + " 迁移", "completed", "done",
                                    "migrate", mdFile.toString(), reqTags, null, fileContent, now, now
                            );
                            migratedRecords.add(knowledge);
                            totalKnowledge++;
                        }
                    }

                    // 如果有需求，创建需求记录
                    if (hasRequirement) {
                        LocalDateTime now = LocalDateTime.now();
                        ProductDevRecord requirement = new ProductDevRecord(
                                UUID.randomUUID().toString(), "requirement", reqTitle, reqDescription,
                                "completed", "done", "migrate", subDir.toString(),
                                reqTags, null, reqContent, now, now
                        );
                        reqId = requirement.getId();
                        migratedRecords.add(requirement);
                        totalRequirements++;
                    }
                }
            } catch (IOException e) {
                log.error("[ProductDevService] 扫描 TODO/ 目录失败: {}", e.getMessage(), e);
            }
        }

        // 2. 扫描 .trae/specs/ 目录
        Path specsDir = projectRoot.resolve(".trae/specs");
        if (Files.exists(specsDir) && Files.isDirectory(specsDir)) {
            log.info("[ProductDevService] 扫描 .trae/specs/ 目录: {}", specsDir);
            try {
                List<Path> specDirs = Files.list(specsDir)
                        .filter(Files::isDirectory)
                        .toList();
                for (Path specSubDir : specDirs) {
                    String dirName = specSubDir.getFileName().toString();
                    LocalDateTime now = LocalDateTime.now();
                    List<String> specTags = List.of("history-migrate", "specs-migration");

                    Path specFile = specSubDir.resolve("spec.md");
                    Path tasksFile = specSubDir.resolve("tasks.md");
                    Path checklistFile = specSubDir.resolve("checklist.md");

                    // spec.md → 知识
                    if (Files.exists(specFile)) {
                        String content = Files.readString(specFile);
                        String title = "规格文档：" + extractTitle(content, dirName);
                        ProductDevRecord knowledge = new ProductDevRecord(
                                UUID.randomUUID().toString(), "knowledge", title,
                                "从 .trae/specs/" + dirName + "/spec.md 迁移", "completed", "done",
                                "migrate", specFile.toString(), specTags, null, content, now, now
                        );
                        migratedRecords.add(knowledge);
                        totalKnowledge++;
                    }

                    // tasks.md → 待办
                    if (Files.exists(tasksFile)) {
                        String content = Files.readString(tasksFile);
                        List<String> taskItems = parseMarkdownTasks(content);
                        for (String task : taskItems) {
                            ProductDevRecord todo = new ProductDevRecord(
                                    UUID.randomUUID().toString(), "todo", task,
                                    "从 .trae/specs/" + dirName + "/tasks.md 迁移", "completed", "done",
                                    "migrate", tasksFile.toString(), specTags, null, "", now, now
                            );
                            migratedRecords.add(todo);
                            totalTodos++;
                        }
                    }

                    // checklist.md → 待办（验收项）
                    if (Files.exists(checklistFile)) {
                        String content = Files.readString(checklistFile);
                        List<String> checkItems = parseMarkdownTasks(content);
                        for (String item : checkItems) {
                            List<String> checkTags = new ArrayList<>(specTags);
                            checkTags.add("checklist");
                            ProductDevRecord todo = new ProductDevRecord(
                                    UUID.randomUUID().toString(), "todo", "[验收] " + item,
                                    "从 .trae/specs/" + dirName + "/checklist.md 迁移", "completed", "done",
                                    "migrate", checklistFile.toString(), checkTags, null, "", now, now
                            );
                            migratedRecords.add(todo);
                            totalTodos++;
                        }
                    }
                }
            } catch (IOException e) {
                log.error("[ProductDevService] 扫描 .trae/specs/ 目录失败: {}", e.getMessage(), e);
            }
        }

        // 3. 将迁移记录写入主数据文件
        if (!migratedRecords.isEmpty()) {
            List<ProductDevRecord> existingRecords = readAllRecords();
            existingRecords.addAll(migratedRecords);
            writeAllRecords(existingRecords);
            log.info("[ProductDevService] 迁移完成：共 {} 条记录", migratedRecords.size());
        }

        // 构造结果摘要
        result.put("success", true);
        result.put("totalRequirements", totalRequirements);
        result.put("totalKnowledge", totalKnowledge);
        result.put("totalTodos", totalTodos);
        result.put("totalClips", totalClips);
        result.put("totalRecords", migratedRecords.size());
        result.put("message", "迁移完成：需求 " + totalRequirements + " 个，知识 " + totalKnowledge + " 条，待办 " + totalTodos + " 项，剪藏 " + totalClips + " 条");
        log.info("[ProductDevService] 迁移结果: {}", result.get("message"));
        return result;
    }

    /**
     * 从 Markdown 内容中提取标题（第一行 # 标题）
     *
     * @param content    Markdown 内容
     * @param defaultVal 默认标题
     * @return 提取的标题
     */
    private String extractTitle(String content, String defaultVal) {
        if (content == null || content.isEmpty()) return defaultVal;
        String firstLine = content.lines().findFirst().orElse("").trim();
        if (firstLine.startsWith("#")) {
            return firstLine.replaceAll("^#+\\s*", "").trim();
        }
        return defaultVal;
    }

    /**
     * 从 Markdown 内容中解析任务列表项
     * <p>
     * 支持格式：
     * <ul>
     *   <li>- [ ] 任务描述</li>
     *   <li>- [x] 已完成任务</li>
     *   <li>- 列表项</li>
     *   <li>1. 编号项</li>
     *   <li>## 标题行（作为任务）</li>
     * </ul>
     * </p>
     *
     * @param content Markdown 内容
     * @return 解析出的任务列表
     */
    private List<String> parseMarkdownTasks(String content) {
        List<String> tasks = new ArrayList<>();
        if (content == null || content.isEmpty()) return tasks;

        for (String line : content.split("\n")) {
            String trimmed = line.trim();
            // 跳过空行和纯标记
            if (trimmed.isEmpty() || trimmed.startsWith("```")) continue;

            // 匹配 - [ ] 或 - [x] 格式的任务项
            if (trimmed.matches("^- \\[[ x]\\].*")) {
                String task = trimmed.replaceAll("^- \\[[ x]\\]\\s*", "").trim();
                if (!task.isEmpty()) tasks.add(task);
            }
            // 匹配 - 开头的列表项
            else if (trimmed.startsWith("- ") && !trimmed.startsWith("- [") && trimmed.length() > 2) {
                String task = trimmed.substring(2).trim();
                if (!task.isEmpty()) tasks.add(task);
            }
            // 匹配数字编号列表项
            else if (trimmed.matches("^\\d+\\.\\s+.*")) {
                String task = trimmed.replaceAll("^\\d+\\.\\s+", "").trim();
                if (!task.isEmpty()) tasks.add(task);
            }
            // 匹配 ## 标题（作为任务分组）
            else if (trimmed.startsWith("##") && !trimmed.startsWith("###")) {
                String task = trimmed.replaceAll("^#+\\s*", "").trim();
                if (!task.isEmpty()) tasks.add(task);
            }
        }
        return tasks;
    }

    // ==================== 统计与仪表盘数据 ====================

    /**
     * 获取仪表盘统计数据
     * <p>
     * 返回总数、各阶段数量、归档数量、知识数量、待办数量等。
     * </p>
     *
     * @return 统计数据 Map
     */
    public Map<String, Object> getStats() {
        List<ProductDevRecord> records = readAllRecords();
        Map<String, Object> stats = new LinkedHashMap<>();

        long total = records.size();
        long requirements = records.stream().filter(r -> "requirement".equals(r.getType())).count();
        long knowledge = records.stream().filter(r -> "knowledge".equals(r.getType())).count();
        long todos = records.stream().filter(r -> "todo".equals(r.getType())).count();
        long archived = records.stream().filter(r -> "archived".equals(r.getStatus())).count();
        long inProgress = records.stream().filter(r -> "in-progress".equals(r.getStatus())).count();
        long done = records.stream().filter(r -> "done".equals(r.getStatus())).count();

        // 各阶段统计（仅 requirement 类型）
        Map<String, Long> phaseCounts = records.stream()
                .filter(r -> "requirement".equals(r.getType()))
                .collect(Collectors.groupingBy(
                        r -> r.getPhase() != null ? r.getPhase() : "unknown",
                        Collectors.counting()
                ));

        stats.put("total", total);
        stats.put("requirements", requirements);
        stats.put("knowledge", knowledge);
        stats.put("todos", todos);
        stats.put("archived", archived);
        stats.put("inProgress", inProgress);
        stats.put("done", done);
        stats.put("phaseCounts", phaseCounts);
        return stats;
    }

    /**
     * 获取各阶段需求分布
     * <p>
     * 按 phase 字段分组统计数量，用于柱状图展示。
     * </p>
     *
     * @return 阶段分布列表，每个元素包含 phase 名称和对应数量
     */
    public List<Map<String, Object>> getPhaseDistribution() {
        List<ProductDevRecord> records = readAllRecords();
        // 仅统计 requirement 类型，按 phase 分组
        Map<String, Long> phaseCounts = records.stream()
                .filter(r -> "requirement".equals(r.getType()))
                .filter(r -> r.getPhase() != null)
                .collect(Collectors.groupingBy(
                        ProductDevRecord::getPhase,
                        Collectors.counting()
                ));

        // 按预定义阶段顺序排列
        List<String> phaseOrder = List.of("analysis", "design", "implementation", "testing", "completed");
        List<Map<String, Object>> result = new ArrayList<>();
        for (String phase : phaseOrder) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("phase", phase);
            item.put("count", phaseCounts.getOrDefault(phase, 0L));
            result.add(item);
        }
        // 添加其他未匹配的阶段
        for (Map.Entry<String, Long> entry : phaseCounts.entrySet()) {
            if (!phaseOrder.contains(entry.getKey())) {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("phase", entry.getKey());
                item.put("count", entry.getValue());
                result.add(item);
            }
        }
        return result;
    }

    /**
     * 获取待办完成率
     * <p>
     * 统计所有 type=todo 的记录中，status=done 的比例。
     * </p>
     *
     * @return 待办完成率 Map（包含已完成数、总数、百分比）
     */
    public Map<String, Object> getTodoCompletion() {
        List<ProductDevRecord> records = readAllRecords();
        List<ProductDevRecord> todos = records.stream()
                .filter(r -> "todo".equals(r.getType()))
                .toList();

        long total = todos.size();
        long done = todos.stream().filter(r -> "done".equals(r.getStatus())).count();
        double percentage = total > 0 ? (double) done / total * 100 : 0.0;

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("completed", done);
        result.put("total", total);
        result.put("percentage", Math.round(percentage * 100.0) / 100.0);
        return result;
    }

    /**
     * 获取知识积累趋势
     * <p>
     * 按月统计 type=knowledge 的记录数量，用于折线图展示。
     * </p>
     *
     * @return 知识趋势列表，每个元素包含月份和数量
     */
    public List<Map<String, Object>> getKnowledgeTrend() {
        List<ProductDevRecord> records = readAllRecords();
        List<ProductDevRecord> knowledgeRecords = records.stream()
                .filter(r -> "knowledge".equals(r.getType()))
                .filter(r -> r.getCreatedAt() != null)
                .toList();

        // 按年月分组
        Map<String, Long> monthCounts = knowledgeRecords.stream()
                .collect(Collectors.groupingBy(
                        r -> r.getCreatedAt().format(DateTimeFormatter.ofPattern("yyyy-MM")),
                        Collectors.counting()
                ));

        // 按月份排序
        List<Map<String, Object>> result = new ArrayList<>();
        monthCounts.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .forEach(entry -> {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("month", entry.getKey());
                    item.put("count", entry.getValue());
                    result.add(item);
                });
        return result;
    }

    /**
     * 获取最近活动记录
     * <p>
     * 按 updatedAt 时间倒序排列，最多返回 20 条。
     * </p>
     *
     * @return 最近活动记录列表
     */
    public List<Map<String, Object>> getActivities() {
        List<ProductDevRecord> records = readAllRecords();
        return records.stream()
                .filter(r -> r.getUpdatedAt() != null)
                .sorted((a, b) -> b.getUpdatedAt().compareTo(a.getUpdatedAt()))
                .limit(20)
                .map(r -> {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("id", r.getId());
                    item.put("type", r.getType());
                    item.put("title", r.getTitle());
                    item.put("phase", r.getPhase());
                    item.put("status", r.getStatus());
                    item.put("source", r.getSource());
                    item.put("updatedAt", r.getUpdatedAt().toString());
                    return item;
                })
                .toList();
    }

    /**
     * 获取需求看板数据
     * <p>
     * 按 phase 分组，返回所有 type=requirement 的记录。
     * </p>
     *
     * @return 需求列表（按看板阶段分组）
     */
    public List<Map<String, Object>> getRequirements() {
        List<ProductDevRecord> records = readAllRecords();
        List<ProductDevRecord> requirements = records.stream()
                .filter(r -> "requirement".equals(r.getType()))
                .toList();

        // 按 phase 分组
        List<String> phaseOrder = List.of("analysis", "design", "implementation", "testing", "completed");
        Map<String, List<ProductDevRecord>> grouped = new LinkedHashMap<>();
        for (String phase : phaseOrder) {
            grouped.put(phase, new ArrayList<>());
        }
        for (ProductDevRecord req : requirements) {
            String phase = req.getPhase() != null ? req.getPhase() : "analysis";
            grouped.computeIfAbsent(phase, k -> new ArrayList<>()).add(req);
        }

        List<Map<String, Object>> result = new ArrayList<>();
        for (Map.Entry<String, List<ProductDevRecord>> entry : grouped.entrySet()) {
            Map<String, Object> group = new LinkedHashMap<>();
            group.put("phase", entry.getKey());
            group.put("count", entry.getValue().size());
            group.put("items", entry.getValue().stream().map(this::toRequirementSummary).toList());
            result.add(group);
        }
        return result;
    }

    /**
     * 将 ProductDevRecord 转换为需求摘要 Map
     *
     * @param record 产品开发记录
     * @return 摘要 Map
     */
    private Map<String, Object> toRequirementSummary(ProductDevRecord record) {
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("id", record.getId());
        summary.put("title", record.getTitle());
        summary.put("description", record.getDescription());
        summary.put("phase", record.getPhase());
        summary.put("status", record.getStatus());
        summary.put("source", record.getSource());
        summary.put("tags", record.getTags());
        summary.put("relatedId", record.getRelatedId());
        summary.put("createdAt", record.getCreatedAt() != null ? record.getCreatedAt().toString() : null);
        summary.put("updatedAt", record.getUpdatedAt() != null ? record.getUpdatedAt().toString() : null);
        return summary;
    }

    /**
     * 获取知识图谱节点和边数据
     * <p>
     * 将 requirement 和 knowledge 类型的记录构建为图节点，
     * 通过 relatedId 关联关系构建边。
     * </p>
     *
     * @return 图谱数据 Map（包含 nodes 和 edges）
     */
    public Map<String, Object> getGraph() {
        List<ProductDevRecord> records = readAllRecords();
        List<Map<String, Object>> nodes = new ArrayList<>();
        List<Map<String, Object>> edges = new ArrayList<>();

        // 收集所有节点（requirement 和 knowledge）
        int groupIndex = 0;
        Map<String, Integer> reqGroupMap = new LinkedHashMap<>();
        for (ProductDevRecord r : records) {
            if ("requirement".equals(r.getType()) || "knowledge".equals(r.getType())) {
                Map<String, Object> node = new LinkedHashMap<>();
                node.put("id", r.getId());
                node.put("label", r.getTitle());
                node.put("type", r.getType());
                node.put("phase", r.getPhase());

                // 同需求的 knowledge 和 requirement 归为一组
                if ("requirement".equals(r.getType())) {
                    groupIndex++;
                    reqGroupMap.put(r.getId(), groupIndex);
                    node.put("group", groupIndex);
                } else if (r.getRelatedId() != null && reqGroupMap.containsKey(r.getRelatedId())) {
                    node.put("group", reqGroupMap.get(r.getRelatedId()));
                } else {
                    node.put("group", 0);
                }
                nodes.add(node);
            }
        }

        // 构建边：relatedId 关联
        for (ProductDevRecord r : records) {
            if (r.getRelatedId() != null && !r.getRelatedId().isEmpty()) {
                Map<String, Object> edge = new LinkedHashMap<>();
                edge.put("source", r.getRelatedId());
                edge.put("target", r.getId());
                edge.put("relation", r.getType());
                edges.add(edge);
            }
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("nodes", nodes);
        result.put("edges", edges);
        return result;
    }

    /**
     * 获取时间线数据
     * <p>
     * 按 createdAt 时间排序的所有记录，用于甘特图展示。
     * </p>
     *
     * @return 时间线数据列表
     */
    public List<Map<String, Object>> getTimeline() {
        List<ProductDevRecord> records = readAllRecords();
        return records.stream()
                .filter(r -> r.getCreatedAt() != null)
                .sorted(Comparator.comparing(ProductDevRecord::getCreatedAt))
                .map(r -> {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("id", r.getId());
                    item.put("type", r.getType());
                    item.put("title", r.getTitle());
                    item.put("phase", r.getPhase());
                    item.put("status", r.getStatus());
                    item.put("source", r.getSource());
                    item.put("createdAt", r.getCreatedAt() != null ? r.getCreatedAt().toString() : null);
                    item.put("updatedAt", r.getUpdatedAt() != null ? r.getUpdatedAt().toString() : null);
                    return item;
                })
                .toList();
    }

    /**
     * 获取归档列表
     * <p>
     * 返回所有 source=archive 或 source=migrate 的记录，按更新时间倒序排列。
     * </p>
     *
     * @return 归档记录列表
     */
    public List<Map<String, Object>> getArchives() {
        List<ProductDevRecord> records = readAllRecords();
        return records.stream()
                .filter(r -> "archive".equals(r.getSource()) || "migrate".equals(r.getSource()))
                .sorted((a, b) -> {
                    if (a.getUpdatedAt() == null && b.getUpdatedAt() == null) return 0;
                    if (a.getUpdatedAt() == null) return 1;
                    if (b.getUpdatedAt() == null) return -1;
                    return b.getUpdatedAt().compareTo(a.getUpdatedAt());
                })
                .map(this::toRequirementSummary)
                .toList();
    }
}