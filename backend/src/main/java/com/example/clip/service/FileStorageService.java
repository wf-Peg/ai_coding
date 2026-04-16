package com.example.clip.service;

import com.example.clip.core.AiService;
import com.example.clip.model.ClipContent;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
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

@Service
public class FileStorageService {

    private final ObjectMapper objectMapper;
    private final Path storagePath;
    private final AtomicLong idGenerator = new AtomicLong(1);
    private static final DateTimeFormatter DATE_FORMATTER = DateTimeFormatter.ofPattern("yyMMdd");

    public FileStorageService(@Value("${clip.storage.path:./clip-storage}") String storagePath) {
        this.objectMapper = new ObjectMapper();
        this.objectMapper.registerModule(new JavaTimeModule());
        this.objectMapper.configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        this.storagePath = Paths.get(storagePath);
        initStorage();
        initIdGenerator();
    }

    private void initStorage() {
        try {
            if (!Files.exists(storagePath)) {
                Files.createDirectories(storagePath);
            }
            // 为每个一级分类创建目录
            for (Map<String, Object> cat : AiService.CATEGORY_TREE) {
                Files.createDirectories(storagePath.resolve(cat.get("value").toString()));
            }
            Files.createDirectories(storagePath.resolve("default"));
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    /**
     * 初始化ID生成器，扫描已有数据中的最大ID，避免ID冲突
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
     * 将category value映射为文件系统目录路径
     * 例如: "work-company" → "work/公司事务"
     *       "work" → "work"
     *       null/空 → "default"
     * @param category 分类值
     * @return 目录路径
     */
    private Path getCategoryPath(String category) {
        // 处理空分类，默认为"default"
        String cat = (category != null && !category.isEmpty()) ? category : "default";

        // 查找一级分类目录名
        for (Map<String, Object> topCat : AiService.CATEGORY_TREE) {
            String topValue = topCat.get("value").toString();

            if (topValue.equals(cat)) {
                // 一级分类: 直接用value作为目录名
                return storagePath.resolve(topValue);
            }

            // 检查二级分类
            List<Map<String, Object>> children = (List<Map<String, Object>>) topCat.get("children");
            if (children != null) {
                for (Map<String, Object> child : children) {
                    if (child.get("value").toString().equals(cat)) {
                        // 二级分类: 一级目录/二级中文名
                        return storagePath.resolve(topValue).resolve(child.get("label").toString());
                    }
                }
            }
        }

        // 兼容旧数据: 直接用category value作为目录名
        return storagePath.resolve(cat);
    }

    /**
     * 获取分类目录下当天的日期文件路径
     * 例如: clip-storage/work/公司事务/260414.json
     */
    private Path getDateFilePath(String category) {
        String dateStr = LocalDate.now().format(DATE_FORMATTER);
        return getCategoryPath(category).resolve(dateStr + ".json");
    }

    // ==================== 文件读写 ====================

    /**
     * 获取所有 json 文件（递归遍历）
     */
    private List<Path> getAllJsonFiles() throws IOException {
        List<Path> files = new ArrayList<>();
        if (!Files.exists(storagePath)) {
            return files;
        }
        Files.walk(storagePath)
                .filter(Files::isRegularFile)
                .filter(path -> path.toString().endsWith(".json"))
                .forEach(files::add);
        return files;
    }

    /**
     * 从文件中读取 JSONArray 为 ClipContent 列表
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
     * 将 ClipContent 列表写入文件
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
     * 保存剪藏：追加到对应分类的当天日期文件中
     */
    public ClipContent saveClip(ClipContent clip) {
        try {
            if (clip.getId() == null) {
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

            // 检查是否已存在相同ID（更新场景）
            boolean updated = false;
            for (int i = 0; i < clips.size(); i++) {
                if (clips.get(i).getId() != null && clips.get(i).getId().equals(clip.getId())) {
                    clips.set(i, clip);
                    updated = true;
                    break;
                }
            }

            if (!updated) {
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
     * 获取所有剪藏
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
     * 根据ID查找剪藏
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
     * 删除剪藏：只从 JSONArray 中移除对应ID的元素，不删除文件
     */
    public void deleteClip(Long id) {
        try {
            List<Path> jsonFiles = getAllJsonFiles();
            for (Path path : jsonFiles) {
                List<ClipContent> clips = readClipArrayFromFile(path);
                boolean found = false;

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
                    break;
                }
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    /**
     * 按分类获取剪藏
     * 支持一级和二级分类查询
     */
    public List<ClipContent> getClipsByCategory(String category) {
        List<ClipContent> clips = new ArrayList<>();
        try {
            Path categoryPath = getCategoryPath(category);
            if (!Files.exists(categoryPath)) {
                return clips;
            }

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
}
