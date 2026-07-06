package com.example.clip.service;

import com.example.clip.core.AiService;
import com.example.clip.model.ClipContent;
import com.example.clip.model.KnowledgeEntry;
import com.example.clip.model.TodoContent;
import com.example.clip.model.Topic;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 文件存储服务
 * <p>
 * 核心持久化层，使用 JSON 文件系统替代数据库存储，负责所有数据模型的 CRUD 操作。
 * 数据组织方式：
 * <ul>
 *   <li><b>剪藏内容</b>：按分类目录 + 日期文件（yyMMdd.json）存储，如 clip-storage/work/公司事务/260414.json</li>
 *   <li><b>待办事项</b>：统一存储在 todoList 目录下，按日期文件组织</li>
 *   <li><b>知识条目</b>：存储在 knowledge 目录下，按日期文件组织</li>
 *   <li><b>话题</b>：存储在 topic 目录下，按日期文件（yyyy-MM-dd.json）组织</li>
 * </ul>
 * 使用 {@link AtomicLong} 生成全局唯一 ID，启动时扫描已有数据避免 ID 冲突。
 * JSON 序列化使用 Jackson，注册了 JavaTimeModule 支持 Java 8 时间类型。
 * 文件内容为 JSON 数组格式，每个文件可包含多条记录。
 * </p>
 *
 * @see ClipService
 * @see TodoService
 * @see TopicService
 */
@Service
public class FileStorageService {

    private static final Logger log = LoggerFactory.getLogger(FileStorageService.class);
    /** JSON 序列化/反序列化工具 */
    private final ObjectMapper objectMapper;
    /** 存储根目录路径 */
    private final Path storagePath;
    /** 全局 ID 生成器，使用 AtomicLong 保证线程安全 */
    private final AtomicLong idGenerator = new AtomicLong(1);
    /** 日期格式化器，用于生成文件名（如 260414） */
    private static final DateTimeFormatter DATE_FORMATTER = DateTimeFormatter.ofPattern("yyMMdd");

    /**
     * 构造器初始化
     * <p>
     * 配置 Jackson ObjectMapper（注册 JavaTimeModule、忽略未知属性），
     * 初始化存储目录结构，扫描已有数据初始化 ID 生成器。
     * </p>
     *
     * @param storagePath 存储根目录路径（从配置读取，默认 ./clip-storage）
     */
    public FileStorageService(@Value("${clip.storage.path:./clip-storage}") String storagePath) {
        this.objectMapper = new ObjectMapper();
        // 注册 JavaTimeModule 以支持 LocalDateTime 等 Java 8 时间类型的序列化
        this.objectMapper.registerModule(new JavaTimeModule());
        // 忽略 JSON 中未知的属性，避免反序列化时因新增字段导致失败
        this.objectMapper.configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        this.storagePath = Paths.get(storagePath);
        initStorage();
        initIdGenerator();
    }

    /**
     * 生成全局唯一 ID，供外部服务（如 Comment）使用。
     *
     * @return 自增 ID
     */
    public long generateId() {
        return idGenerator.getAndIncrement();
    }

    /**
     * 初始化存储目录结构
     * <p>
     * 创建根目录、所有一级分类目录、inbox/default/todoList/knowledge/topic 等子目录。
     * 目录创建失败只打印日志，不抛出异常（可能因权限问题导致）。
     * </p>
     */
    private void initStorage() {
        try {
            if (!Files.exists(storagePath)) {
                Files.createDirectories(storagePath);
            }
            // 为每个一级分类创建目录（如 work、learning、life 等）
            for (Map<String, Object> cat : AiService.CATEGORY_TREE) {
                Files.createDirectories(storagePath.resolve(cat.get("value").toString()));
            }
            Files.createDirectories(storagePath.resolve(ClipService.INBOX_CATEGORY));
            Files.createDirectories(storagePath.resolve("default"));
            // 创建待办事项目录
            Files.createDirectories(storagePath.resolve("todoList"));
            // 创建知识条目目录
            Files.createDirectories(storagePath.resolve("knowledge"));
            // 创建话题目录
            Files.createDirectories(storagePath.resolve("topic"));
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    /**
     * 初始化 ID 生成器
     * <p>
     * 扫描所有 JSON 文件中已有的剪藏记录，找到最大 ID 值，
     * 将 ID 生成器的起始值设为 maxId + 1，避免 ID 冲突。
     * 注意：此方法仅扫描剪藏记录，不扫描待办/知识条目/话题的 ID。
     * 如果这些实体也使用 idGenerator，可能存在 ID 冲突风险。
     * </p>
     */
    private void initIdGenerator() {
        try {
            long maxId = 0;
            List<Path> jsonFiles = getAllJsonFiles();
            for (Path path : jsonFiles) {
                List<ClipContent> clips = readClipArrayFromFile(path);
                for (ClipContent clip : clips) {
                    if (clip.getId() != null && clip.getId() > maxId) {
                        maxId = clip.getId();
                    }
                }
            }
            idGenerator.set(maxId + 1);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    // ==================== Category → 目录路径映射 ====================

    /**
     * 将 category value 映射为文件系统目录路径
     * <p>
     * 映射规则：
     * <ul>
     *   <li>inbox → clip-storage/inbox</li>
     *   <li>一级分类（如 work）→ clip-storage/work</li>
     *   <li>二级分类（如 work-company）→ clip-storage/work/公司事务</li>
     *   <li>null/空 → clip-storage/default</li>
     *   <li>未匹配的分类 → clip-storage/{category}（兼容旧数据）</li>
     * </ul>
     * </p>
     *
     * @param category 分类值
     * @return 分类对应的目录路径
     */
    private Path getCategoryPath(String category) {
        // 处理空分类，默认为"default"
        String cat = (category != null && !category.isEmpty()) ? category : "default";

        if (ClipService.INBOX_CATEGORY.equals(cat)) {
            return storagePath.resolve(ClipService.INBOX_CATEGORY);
        }

        // 在 CATEGORY_TREE 中查找一级和二级分类
        for (Map<String, Object> topCat : AiService.CATEGORY_TREE) {
            String topValue = topCat.get("value").toString();

            if (topValue.equals(cat)) {
                // 一级分类：直接用 value 作为目录名
                return storagePath.resolve(topValue);
            }

            // 检查二级分类
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> children = (List<Map<String, Object>>) topCat.get("children");
            if (children != null) {
                for (Map<String, Object> child : children) {
                    if (child.get("value").toString().equals(cat)) {
                        // 二级分类：一级目录/二级中文名
                        return storagePath.resolve(topValue).resolve(child.get("label").toString());
                    }
                }
            }
        }

        // 兼容旧数据：直接用 category value 作为目录名
        return storagePath.resolve(cat);
    }

    /**
     * 获取分类目录下当天的日期文件路径
     * <p>
     * 例如：clip-storage/work/公司事务/260414.json
     * </p>
     *
     * @param category 分类值
     * @return 日期文件路径
     */
    private Path getDateFilePath(String category) {
        String dateStr = LocalDate.now().format(DATE_FORMATTER);
        return getCategoryPath(category).resolve(dateStr + ".json");
    }

    // ==================== 文件读写 ====================

    /**
     * 获取所有 JSON 文件（递归遍历）
     * <p>
     * 遍历 storagePath 下所有目录，过滤出 .json 文件。
     * 排除 todoList 和 knowledge 目录下的文件，避免与剪藏数据混淆。
     * </p>
     *
     * @return JSON 文件路径列表
     * @throws IOException 遍历文件系统可能的异常
     */
    private List<Path> getAllJsonFiles() throws IOException {
        List<Path> files = new ArrayList<>();
        if (!Files.exists(storagePath)) {
            return files;
        }
        Files.walk(storagePath)
                .filter(Files::isRegularFile)
                .filter(path -> path.toString().endsWith(".json"))
                .filter(path -> !path.toString().contains("todoList")) // 过滤待办事项目录
                .filter(path -> !path.toString().contains("knowledge")) // 过滤知识条目目录
                .filter(path -> !path.toString().contains("topic"))     // 过滤话题目录
                .filter(path -> !path.toString().contains("vault"))     // 过滤话题目录
                .forEach(files::add);
        return files;
    }

    /**
     * 从文件中读取 JSON 数组为 ClipContent 列表
     * <p>
     * 如果文件不存在或内容为空，返回空列表。
     * 使用 Jackson TypeReference 进行泛型反序列化。
     * </p>
     *
     * @param path JSON 文件路径
     * @return ClipContent 列表（可能为空）
     */
    private List<ClipContent> readClipArrayFromFile(Path path) {
        try {
            if (!Files.exists(path)) {
                return new ArrayList<>();
            }
            String content = Files.readString(path);
            if (content == null || content.trim().isEmpty()) {
                return new ArrayList<>();
            }
            return objectMapper.readValue(content, new TypeReference<List<ClipContent>>() {});
        } catch (IOException e) {
            e.printStackTrace();
            return new ArrayList<>();
        }
    }

    /**
     * 将 ClipContent 列表写入 JSON 文件
     * <p>
     * 自动创建父目录，使用 pretty printer 格式化输出。
     * 写入失败只打印日志，不抛出异常。
     * </p>
     *
     * @param path  目标文件路径
     * @param clips 要写入的剪藏列表
     */
    private void writeClipArrayToFile(Path path, List<ClipContent> clips) {
        try {
            Path parent = path.getParent();
            if (!Files.exists(parent)) {
                Files.createDirectories(parent);
            }
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(path.toFile(), clips);
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    // ==================== CRUD ====================

    /**
     * 保存剪藏内容（新增或更新）
     * <p>
     * 如果 ID 为 null 则生成新 ID；如果 ID 已存在则更新对应记录。
     * 根据分类写入对应目录的日期文件中。
     * 分类为空时默认归入 "default" 分类。
     * </p>
     *
     * @param clip 剪藏内容对象
     * @return 保存后的剪藏内容；若失败返回 null
     */
    public ClipContent saveClip(ClipContent clip) {
        try {
            if (clip.getId() == null) {
                // 新记录：分配全局唯一 ID
                clip.setId(idGenerator.getAndIncrement());
            }

            // category 为空时存到 default 目录
            String category = clip.getCategory();
            if (category == null || category.isEmpty()) {
                category = "default";
                clip.setCategory(category);
            }

            Path filePath = getDateFilePath(category);

            List<ClipContent> clips = readClipArrayFromFile(filePath);

            // 检查是否已存在相同 ID（更新场景），存在则替换
            boolean updated = false;
            for (int i = 0; i < clips.size(); i++) {
                if (clips.get(i).getId() != null && clips.get(i).getId().equals(clip.getId())) {
                    clips.set(i, clip);
                    updated = true;
                    break;
                }
            }

            if (!updated) {
                // 新增：追加到列表末尾
                clips.add(clip);
            }

            writeClipArrayToFile(filePath, clips);
            return clip;
        } catch (Exception e) {
            e.printStackTrace();
            return null;
        }
    }

    /**
     * 获取所有剪藏内容
     * <p>
     * 遍历所有 JSON 文件，读取并合并所有剪藏记录。
     * 注意：结果未排序，顺序取决于文件系统遍历顺序。
     * </p>
     *
     * @return 所有剪藏内容的列表
     */
    public List<ClipContent> getAllClips() {
        List<ClipContent> allClips = new ArrayList<>();
        try {
            List<Path> jsonFiles = getAllJsonFiles();
            for (Path path : jsonFiles) {
                List<ClipContent> clips = readClipArrayFromFile(path);
                allClips.addAll(clips);
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
        return allClips;
    }

    /**
     * 根据 ID 查找剪藏
     * <p>
     * 遍历所有文件查找匹配 ID 的记录，找到后立即返回。
     * 性能：O(n) 全表扫描，数据量大时可能需要优化。
     * </p>
     *
     * @param id 剪藏 ID（字符串形式）
     * @return 匹配的剪藏内容；未找到返回 null
     */
    public ClipContent getClipById(String id) {
        try {
            List<Path> jsonFiles = getAllJsonFiles();
            for (Path path : jsonFiles) {
                List<ClipContent> clips = readClipArrayFromFile(path);
                for (ClipContent clip : clips) {
                    if (clip.getId() != null && clip.getId().toString().equals(id)) {
                        return clip;
                    }
                }
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
        return null;
    }

    /**
     * 删除剪藏
     * <p>
     * 遍历所有文件，找到匹配 ID 的记录并移除，然后回写文件。
     * 使用 Iterator 安全删除。找到即停止，不继续遍历。
     * </p>
     *
     * @param id 要删除的剪藏 ID
     */
    public void deleteClip(Long id) {
        try {
            List<Path> jsonFiles = getAllJsonFiles();
            for (Path path : jsonFiles) {
                List<ClipContent> clips = readClipArrayFromFile(path);
                boolean found = false;

                // 使用 Iterator 安全删除，避免 ConcurrentModificationException
                Iterator<ClipContent> iterator = clips.iterator();
                while (iterator.hasNext()) {
                    ClipContent clip = iterator.next();
                    if (clip.getId() != null && clip.getId().equals(id)) {
                        iterator.remove();
                        found = true;
                        break;
                    }
                }

                if (found) {
                    writeClipArrayToFile(path, clips);
                    break; // 找到并删除后停止遍历
                }
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    /**
     * 替换剪藏（跨分类更新）
     * <p>
     * 先全量扫描所有文件，移除旧记录，再按当前分类重新写入。
     * 这解决了剪藏分类变更时需要在不同目录间移动的问题。
     * 使用 removeIf 简化删除逻辑。
     * </p>
     *
     * @param clip 更新后的剪藏内容（必须包含有效 ID）
     * @return 保存后的剪藏内容
     */
    public ClipContent replaceClip(ClipContent clip) {
        if (clip == null || clip.getId() == null) {
            return saveClip(clip);
        }
        try {
            List<Path> jsonFiles = getAllJsonFiles();
            for (Path path : jsonFiles) {
                List<ClipContent> clips = readClipArrayFromFile(path);
                // 使用 removeIf 移除匹配 ID 的记录
                boolean found = clips.removeIf(item -> item.getId() != null && item.getId().equals(clip.getId()));
                if (found) {
                    writeClipArrayToFile(path, clips);
                }
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
        return saveClip(clip);
    }

    /**
     * 按分类获取剪藏
     * <p>
     * 支持一级和二级分类查询。通过控制 walk 深度来限制遍历范围。
     * 一级分类深度为 2（storagePath/category/），二级分类深度为 3。
     * </p>
     *
     * @param category 分类值
     * @return 该分类下的剪藏列表
     */
    public List<ClipContent> getClipsByCategory(String category) {
        List<ClipContent> clips = new ArrayList<>();
        try {
            Path categoryPath = getCategoryPath(category);
            if (!Files.exists(categoryPath)) {
                return clips;
            }

            // 计算最大遍历深度：
            // 一级分类（如 work）：storagePath(0)/work(1) → 深度 2
            // 二级分类（如 work/公司事务）：storagePath(0)/work(1)/公司事务(2) → 深度 3
            int maxDepth = categoryPath.getNameCount() - storagePath.getNameCount() + 1;
            Files.walk(categoryPath, maxDepth)
                    .filter(Files::isRegularFile)
                    .filter(path -> path.toString().endsWith(".json"))
                    .forEach(path -> {
                        List<ClipContent> fileClips = readClipArrayFromFile(path);
                        clips.addAll(fileClips);
                    });
        } catch (IOException e) {
            e.printStackTrace();
        }
        return clips;
    }

    // ==================== 待办事项相关方法 ====================

    /**
     * 获取待办事项的日期文件路径
     * <p>
     * 格式：clip-storage/todoList/{yyMMdd}.json
     * </p>
     *
     * @return 待办事项日期文件路径
     */
    private Path getTodoDateFilePath() {
        String dateStr = LocalDate.now().format(DATE_FORMATTER);
        return storagePath.resolve("todoList").resolve(dateStr + ".json");
    }

    /**
     * 获取知识条目的日期文件路径
     * <p>
     * 格式：clip-storage/knowledge/{yyMMdd}.json
     * </p>
     *
     * @return 知识条目日期文件路径
     */
    private Path getKnowledgeDateFilePath() {
        String dateStr = LocalDate.now().format(DATE_FORMATTER);
        return storagePath.resolve("knowledge").resolve(dateStr + ".json");
    }

    /**
     * 从文件中读取待办事项列表
     * <p>
     * 如果文件不存在或内容为空，返回空列表。
     * </p>
     *
     * @param path JSON 文件路径
     * @return 待办事项列表
     */
    private List<TodoContent> readTodoArrayFromFile(Path path) {
        try {
            if (!Files.exists(path)) {
                return new ArrayList<>();
            }
            String content = Files.readString(path);
            if (content == null || content.trim().isEmpty()) {
                return new ArrayList<>();
            }
            return objectMapper.readValue(content, new TypeReference<List<TodoContent>>() {});
        } catch (IOException e) {
            e.printStackTrace();
            return new ArrayList<>();
        }
    }

    /**
     * 从文件中读取知识条目列表
     *
     * @param path JSON 文件路径
     * @return 知识条目列表
     */
    private List<KnowledgeEntry> readKnowledgeArrayFromFile(Path path) {
        try {
            if (!Files.exists(path)) {
                return new ArrayList<>();
            }
            String content = Files.readString(path);
            if (content == null || content.trim().isEmpty()) {
                return new ArrayList<>();
            }
            return objectMapper.readValue(content, new TypeReference<List<KnowledgeEntry>>() {});
        } catch (IOException e) {
            e.printStackTrace();
            return new ArrayList<>();
        }
    }

    /**
     * 将待办事项列表写入 JSON 文件
     * <p>
     * 自动创建父目录，使用 pretty printer 格式化。
     * </p>
     *
     * @param path  目标文件路径
     * @param todos 待办事项列表
     */
    private void writeTodoArrayToFile(Path path, List<TodoContent> todos) {
        try {
            Path parent = path.getParent();
            if (!Files.exists(parent)) {
                Files.createDirectories(parent);
            }
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(path.toFile(), todos);
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    /**
     * 将知识条目列表写入 JSON 文件
     *
     * @param path    目标文件路径
     * @param entries 知识条目列表
     */
    private void writeKnowledgeArrayToFile(Path path, List<KnowledgeEntry> entries) {
        try {
            Path parent = path.getParent();
            if (!Files.exists(parent)) {
                Files.createDirectories(parent);
            }
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(path.toFile(), entries);
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    /**
     * 保存待办事项（新增或更新）
     * <p>
     * 更新场景会先从所有文件中删除旧记录，再追加新记录。
     * 这样避免了跨文件查找的问题，但可能导致数据文件分布变化。
     * </p>
     *
     * @param todo 待办事项对象
     * @return 保存后的待办事项
     */
    public TodoContent saveTodo(TodoContent todo) {
        log.info("[FileStorageService] saveTodo called with todo: title={}, priority={}, deadline={}, completed={}, category={}", 
            todo.getTitle(), todo.getPriority(), todo.getDeadline(), todo.isCompleted(), todo.getCategory());
        try {
            Path filePath;
            if (todo.getId() == null) {
                // 新记录：分配全局唯一 ID
                todo.setId(idGenerator.getAndIncrement());
                filePath = getTodoDateFilePath();
                log.info("[FileStorageService] Generated new id: {}", todo.getId());
            } else {
                // 更新场景：先找到原始文件，再删除旧记录，保留 createdAt
                Path originalFile = findTodoFilePath(todo.getId());
                // 保护 createdAt：如果前端未传时间戳，从已有记录中读取
                TodoContent existing = getTodoByIdInternal(todo.getId());
                if (existing != null && todo.getCreatedAt() == null) {
                    todo.setCreatedAt(existing.getCreatedAt());
                }
                deleteTodoFromAllFiles(todo.getId());
                // 写回原始文件，找不到则用当天文件
                filePath = (originalFile != null) ? originalFile : getTodoDateFilePath();
                log.info("[FileStorageService] Deleted original todo, writing back to: {}", filePath);
            }

            log.info("[FileStorageService] Using file path: {}", filePath);
            List<TodoContent> todos = readTodoArrayFromFile(filePath);
            log.info("[FileStorageService] Read {} existing todos from file", todos.size());

            // 追加更新后的待办事项
            todos.add(todo);
            log.info("[FileStorageService] Added todo to list");

            writeTodoArrayToFile(filePath, todos);
            log.info("[FileStorageService] Successfully wrote todos to file");
            return todo;
        } catch (Exception e) {
            log.error("[FileStorageService] Exception while saving todo", e);
            e.printStackTrace();
            return null;
        }
    }

    /**
     * 查找指定待办所在的文件路径
     * <p>
     * 遍历 todoList 目录下所有 JSON 文件，找到包含指定 ID 的文件。
     * 用于更新场景：确保更新后的记录写回原始文件，而非当天文件。
     * </p>
     *
     * @param id 待办事项 ID
     * @return 包含该待办的文件路径，未找到返回 null
     */
    private Path findTodoFilePath(Long id) {
        try {
            Path todoPath = storagePath.resolve("todoList");
            if (!Files.exists(todoPath)) return null;
            try (var stream = Files.walk(todoPath)) {
                return stream
                    .filter(Files::isRegularFile)
                    .filter(p -> p.toString().endsWith(".json"))
                    .filter(p -> {
                        List<TodoContent> todos = readTodoArrayFromFile(p);
                        return todos.stream().anyMatch(t -> id.equals(t.getId()));
                    })
                    .findFirst()
                    .orElse(null);
            }
        } catch (Exception e) {
            log.warn("[FileStorageService] Failed to find todo file for id={}", id, e);
            return null;
        }
    }

    /**
     * 内部方法：根据 ID 获取待办事项（不走 controller 缓存）
     */
    private TodoContent getTodoByIdInternal(Long id) {
        try {
            Path todoPath = storagePath.resolve("todoList");
            if (!Files.exists(todoPath)) return null;
            try (var stream = Files.walk(todoPath)) {
                return stream
                    .filter(Files::isRegularFile)
                    .filter(p -> p.toString().endsWith(".json"))
                    .flatMap(p -> readTodoArrayFromFile(p).stream())
                    .filter(t -> id.equals(t.getId()))
                    .findFirst()
                    .orElse(null);
            }
        } catch (Exception e) {
            log.warn("[FileStorageService] Failed to get todo by id={}", id, e);
            return null;
        }
    }

    /**
     * 从所有待办事项文件中删除指定 ID 的待办事项
     * <p>
     * 遍历 todoList 目录下所有 JSON 文件，找到并移除匹配 ID 的记录。
     * 用于更新场景：先删除旧记录，再写入新记录。
     * </p>
     *
     * @param id 待删除的待办事项 ID
     */
    private void deleteTodoFromAllFiles(Long id) {
        try {
            Path todoPath = storagePath.resolve("todoList");
            if (!Files.exists(todoPath)) {
                return;
            }

            // 遍历所有待办事项 JSON 文件
            Files.walk(todoPath)
                    .filter(Files::isRegularFile)
                    .filter(path -> path.toString().endsWith(".json"))
                    .forEach(path -> {
                        List<TodoContent> todos = readTodoArrayFromFile(path);
                        boolean found = false;

                        // 使用 Iterator 安全删除
                        Iterator<TodoContent> iterator = todos.iterator();
                        while (iterator.hasNext()) {
                            TodoContent todo = iterator.next();
                            if (todo.getId() != null && todo.getId().equals(id)) {
                                iterator.remove();
                                found = true;
                                break;
                            }
                        }

                        if (found) {
                            writeTodoArrayToFile(path, todos);
                        }
                    });
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    /**
     * 获取所有待办事项
     * <p>
     * 遍历 todoList 目录下所有 JSON 文件，合并所有记录。
     * </p>
     *
     * @return 所有待办事项列表
     */
    public List<TodoContent> getAllTodos() {
        List<TodoContent> allTodos = new ArrayList<>();
        try {
            Path todoPath = storagePath.resolve("todoList");
            if (!Files.exists(todoPath)) {
                return allTodos;
            }

            Files.walk(todoPath)
                    .filter(Files::isRegularFile)
                    .filter(path -> path.toString().endsWith(".json"))
                    .forEach(path -> {
                        List<TodoContent> todos = readTodoArrayFromFile(path);
                        allTodos.addAll(todos);
                    });
        } catch (IOException e) {
            e.printStackTrace();
        }
        return allTodos;
    }

    /**
     * 根据 ID 获取单个待办事项
     * <p>
     * 遍历所有待办事项文件查找匹配 ID 的记录。
     * </p>
     *
     * @param id 待办事项 ID
     * @return 匹配的待办事项；未找到返回 null
     */
    public TodoContent getTodoById(Long id) {
        try {
            Path todoPath = storagePath.resolve("todoList");
            if (!Files.exists(todoPath)) {
                return null;
            }

            for (Path path : Files.walk(todoPath).filter(Files::isRegularFile).filter(path -> path.toString().endsWith(".json")).toList()) {
                List<TodoContent> todos = readTodoArrayFromFile(path);
                for (TodoContent todo : todos) {
                    if (todo.getId() != null && todo.getId().equals(id)) {
                        return todo;
                    }
                }
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
        return null;
    }

    /**
     * 删除待办事项
     * <p>
     * 遍历所有待办事项文件，找到并移除匹配 ID 的记录。
     * </p>
     *
     * @param id 待删除的待办事项 ID
     */
    public void deleteTodo(Long id) {
        try {
            Path todoPath = storagePath.resolve("todoList");
            if (!Files.exists(todoPath)) {
                return;
            }

            Files.walk(todoPath)
                    .filter(Files::isRegularFile)
                    .filter(path -> path.toString().endsWith(".json"))
                    .forEach(path -> {
                        List<TodoContent> todos = readTodoArrayFromFile(path);
                        boolean found = false;

                        Iterator<TodoContent> iterator = todos.iterator();
                        while (iterator.hasNext()) {
                            TodoContent todo = iterator.next();
                            if (todo.getId() != null && todo.getId().equals(id)) {
                                iterator.remove();
                                found = true;
                                break;
                            }
                        }

                        if (found) {
                            writeTodoArrayToFile(path, todos);
                        }
                    });
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    /**
     * 保存知识条目（新增或更新）
     * <p>
     * 如果 ID 为 null 则生成新 ID，如果 ID 已存在则更新对应记录。
     * </p>
     *
     * @param entry 知识条目对象
     * @return 保存后的知识条目；若失败返回 null
     */
    public KnowledgeEntry saveKnowledgeEntry(KnowledgeEntry entry) {
        try {
            if (entry.getId() == null) {
                entry.setId(idGenerator.getAndIncrement());
            }

            Path filePath = getKnowledgeDateFilePath();
            List<KnowledgeEntry> entries = readKnowledgeArrayFromFile(filePath);

            // 检查是否已存在相同 ID（更新场景）
            boolean updated = false;
            for (int i = 0; i < entries.size(); i++) {
                if (entries.get(i).getId() != null && entries.get(i).getId().equals(entry.getId())) {
                    entries.set(i, entry);
                    updated = true;
                    break;
                }
            }
            if (!updated) {
                // 新增：追加到列表末尾
                entries.add(entry);
            }

            writeKnowledgeArrayToFile(filePath, entries);
            return entry;
        } catch (Exception e) {
            log.error("Failed to save knowledge entry", e);
            return null;
        }
    }

    /**
     * 获取所有知识条目
     * <p>
     * 遍历 knowledge 目录下所有 JSON 文件，合并所有记录。
     * </p>
     *
     * @return 所有知识条目列表
     */
    public List<KnowledgeEntry> getAllKnowledgeEntries() {
        List<KnowledgeEntry> allEntries = new ArrayList<>();
        try {
            Path knowledgePath = storagePath.resolve("knowledge");
            if (!Files.exists(knowledgePath)) {
                return allEntries;
            }

            Files.walk(knowledgePath)
                    .filter(Files::isRegularFile)
                    .filter(path -> path.toString().endsWith(".json"))
                    .forEach(path -> allEntries.addAll(readKnowledgeArrayFromFile(path)));
        } catch (IOException e) {
            log.error("Failed to list knowledge entries", e);
        }
        return allEntries;
    }

    /**
     * 根据 ID 获取知识条目
     * <p>
     * 使用 Stream 流式过滤，获取所有条目后按 ID 匹配。
     * </p>
     *
     * @param id 知识条目 ID
     * @return 匹配的知识条目；未找到返回 null
     */
    public KnowledgeEntry getKnowledgeEntryById(Long id) {
        if (id == null) {
            return null;
        }
        return getAllKnowledgeEntries().stream()
                .filter(entry -> entry.getId() != null && entry.getId().equals(id))
                .findFirst()
                .orElse(null);
    }

    /**
     * 根据来源剪藏 ID 获取关联的知识条目
     * <p>
     * 用于查找从某个剪藏记录生成的所有知识条目。
     * </p>
     *
     * @param clipId 来源剪藏 ID
     * @return 关联的知识条目列表（可能为空）
     */
    public List<KnowledgeEntry> getKnowledgeEntriesBySourceClipId(Long clipId) {
        if (clipId == null) {
            return new ArrayList<>();
        }
        return getAllKnowledgeEntries().stream()
                .filter(entry -> entry.getSourceClipId() != null && entry.getSourceClipId().equals(clipId))
                .toList();
    }

    /**
     * 获取存储路径的父级目录
     * <p>
     * 用于 Git 操作：Git 仓库通常位于存储目录的父级。
     * </p>
     *
     * @return 存储路径的父级目录
     */
    public Path getStorageParentPath() {
        return storagePath.getParent();
    }

    /**
     * 获取存储根目录路径
     *
     * @return 存储路径
     */
    public Path getStoragePath() {
        return storagePath;
    }

    /**
     * 获取话题存储目录路径
     *
     * @return 话题存储路径（clip-storage/topic）
     */
    public Path getTopicStoragePath() {
        return storagePath.resolve("topic");
    }

    // ==================== Topic 存储 ====================

    /**
     * 获取话题的日期文件路径
     * <p>
     * 格式：clip-storage/topic/{yyyy-MM-dd}.json
     * 注意：话题使用 yyyy-MM-dd 格式（与剪藏的 yyMMdd 不同），
     * 这种格式更易读，但需注意不同格式导致的问题。
     * </p>
     *
     * @return 话题日期文件路径
     */
    private Path getTopicDateFilePath() {
        String date = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd"));
        return storagePath.resolve("topic").resolve(date + ".json");
    }

    /**
     * 从文件中读取话题列表
     *
     * @param path JSON 文件路径
     * @return 话题列表
     */
    private List<Topic> readTopicArrayFromFile(Path path) {
        try {
            if (!Files.exists(path)) {
                return new ArrayList<>();
            }
            String content = Files.readString(path);
            if (content == null || content.trim().isEmpty()) {
                return new ArrayList<>();
            }
            return objectMapper.readValue(content, new TypeReference<List<Topic>>() {});
        } catch (IOException e) {
            e.printStackTrace();
            return new ArrayList<>();
        }
    }

    /**
     * 将话题列表写入 JSON 文件
     *
     * @param path   目标文件路径
     * @param topics 话题列表
     */
    private void writeTopicArrayToFile(Path path, List<Topic> topics) {
        try {
            Path parent = path.getParent();
            if (!Files.exists(parent)) {
                Files.createDirectories(parent);
            }
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(path.toFile(), topics);
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    /**
     * 保存话题（新增或更新）
     * <p>
     * 如果 ID 为 null 则生成新 ID，如果 ID 已存在则更新对应记录。
     * </p>
     *
     * @param topic 话题对象
     * @return 保存后的话题
     */
    public Topic saveTopic(Topic topic) {
        try {
            if (topic.getId() == null) {
                topic.setId(idGenerator.getAndIncrement());
            }

            Path filePath = getTopicDateFilePath();
            List<Topic> topics = readTopicArrayFromFile(filePath);

            // 检查是否已存在相同 ID（更新场景）
            boolean updated = false;
            for (int i = 0; i < topics.size(); i++) {
                if (topics.get(i).getId() != null && topics.get(i).getId().equals(topic.getId())) {
                    topics.set(i, topic);
                    updated = true;
                    break;
                }
            }
            if (!updated) {
                topics.add(topic);
            }

            writeTopicArrayToFile(filePath, topics);
            return topic;
        } catch (Exception e) {
            log.error("Failed to save topic", e);
            return null;
        }
    }

    /**
     * 获取所有话题
     * <p>
     * 遍历 topic 目录下所有 JSON 文件，合并所有记录，
     * 并按创建时间倒序排列（最新的在前）。
     * </p>
     *
     * @return 所有话题列表（按创建时间倒序）
     */
    public List<Topic> getAllTopics() {
        List<Topic> allTopics = new ArrayList<>();
        try {
            Path topicPath = storagePath.resolve("topic");
            if (!Files.exists(topicPath)) {
                return allTopics;
            }

            Files.walk(topicPath)
                    .filter(Files::isRegularFile)
                    .filter(path -> path.toString().endsWith(".json"))
                    .forEach(path -> allTopics.addAll(readTopicArrayFromFile(path)));

            // 按创建时间倒序排列（最新的在前）
            allTopics.sort((a, b) -> {
                if (a.getCreatedAt() == null && b.getCreatedAt() == null) return 0;
                if (a.getCreatedAt() == null) return 1;   // null 排在后面
                if (b.getCreatedAt() == null) return -1;  // null 排在后面
                return b.getCreatedAt().compareTo(a.getCreatedAt());
            });
        } catch (IOException e) {
            log.error("Failed to list topics", e);
        }
        return allTopics;
    }

    /**
     * 根据 ID 获取话题
     * <p>
     * 使用 Stream 流式过滤，获取所有话题后按 ID 匹配。
     * </p>
     *
     * @param id 话题 ID
     * @return 匹配的话题；未找到返回 null
     */
    public Topic getTopicById(Long id) {
        if (id == null) return null;
        return getAllTopics().stream()
                .filter(t -> t.getId() != null && t.getId().equals(id))
                .findFirst()
                .orElse(null);
    }

    /**
     * 删除话题
     * <p>
     * 遍历所有话题文件，使用 removeIf 移除匹配 ID 的记录。
     * </p>
     *
     * @param id 要删除的话题 ID
     */
    public void deleteTopic(Long id) {
        if (id == null) return;
        try {
            Path topicPath = storagePath.resolve("topic");
            if (!Files.exists(topicPath)) return;

            Files.walk(topicPath)
                    .filter(Files::isRegularFile)
                    .filter(p -> p.toString().endsWith(".json"))
                    .forEach(path -> {
                        List<Topic> topics = readTopicArrayFromFile(path);
                        // 使用 removeIf 移除匹配 ID 的记录
                        boolean found = topics.removeIf(t -> t.getId() != null && t.getId().equals(id));
                        if (found) {
                            writeTopicArrayToFile(path, topics);
                        }
                    });
        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}
