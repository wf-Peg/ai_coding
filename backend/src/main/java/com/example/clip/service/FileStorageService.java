package com.example.clip.service;

import com.example.clip.model.ClipContent;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class FileStorageService {

    private final ObjectMapper objectMapper;
    private final Path storagePath;

    public FileStorageService(@Value("${clip.storage.path:./clip-storage}") String storagePath) {
        this.objectMapper = new ObjectMapper();
        this.objectMapper.registerModule(new JavaTimeModule());
        this.objectMapper.configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        this.storagePath = Paths.get(storagePath);
        initStorage();
    }

    private void initStorage() {
        try {
            if (!Files.exists(storagePath)) {
                Files.createDirectories(storagePath);
            }
            // 创建分类目录
            Files.createDirectories(storagePath.resolve("default"));
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    public ClipContent saveClip(ClipContent clip) {
        try {
            // 确保分类目录存在
            String category = clip.getCategory() != null ? clip.getCategory() : "default";
            Path categoryPath = storagePath.resolve(category);
            if (!Files.exists(categoryPath)) {
                Files.createDirectories(categoryPath);
            }

            // 查找是否已存在相同ID的文件
            Path existingFilePath = null;
            try {
                existingFilePath = Files.walk(storagePath, 2)
                        .filter(Files::isRegularFile)
                        .filter(path -> path.toString().endsWith(".json"))
                        .filter(path -> {
                            try {
                                ClipContent existingClip = objectMapper.readValue(path.toFile(), ClipContent.class);
                                return existingClip.getId() != null && existingClip.getId().equals(clip.getId());
                            } catch (IOException e) {
                                return false;
                            }
                        })
                        .findFirst()
                        .orElse(null);
            } catch (IOException e) {
                e.printStackTrace();
            }

            Path filePath;
            if (existingFilePath != null) {
                // 更新现有文件
                filePath = existingFilePath;
            } else {
                // 生成唯一文件名
                String fileName = UUID.randomUUID().toString() + ".json";
                filePath = categoryPath.resolve(fileName);
            }

            // 保存到文件
            objectMapper.writeValue(filePath.toFile(), clip);
            return clip;
        } catch (IOException e) {
            e.printStackTrace();
            return null;
        }
    }

    public List<ClipContent> getAllClips() {
        List<ClipContent> clips = new ArrayList<>();
        try {
            // 遍历所有分类目录
            Files.walk(storagePath, 2)
                    .filter(Files::isRegularFile)
                    .filter(path -> path.toString().endsWith(".json"))
                    .forEach(path -> {
                        try {
                            ClipContent clip = objectMapper.readValue(path.toFile(), ClipContent.class);
                            clips.add(clip);
                        } catch (IOException e) {
                            e.printStackTrace();
                        }
                    });
        } catch (IOException e) {
            e.printStackTrace();
        }
        return clips;
    }

    public ClipContent getClipById(String id) {
        try {
            // 遍历所有文件查找指定ID
            return Files.walk(storagePath, 2)
                    .filter(Files::isRegularFile)
                    .filter(path -> path.toString().endsWith(".json"))
                    .map(path -> {
                        try {
                            return objectMapper.readValue(path.toFile(), ClipContent.class);
                        } catch (IOException e) {
                            return null;
                        }
                    })
                    .filter(clip -> clip != null && clip.getId() != null && clip.getId().toString().equals(id))
                    .findFirst()
                    .orElse(null);
        } catch (IOException e) {
            e.printStackTrace();
            return null;
        }
    }

    public void deleteClip(Long id) {
        try {
            // 遍历所有文件查找并删除
            Files.walk(storagePath, 2)
                    .filter(Files::isRegularFile)
                    .filter(path -> path.toString().endsWith(".json"))
                    .forEach(path -> {
                        try {
                            ClipContent clip = objectMapper.readValue(path.toFile(), ClipContent.class);
                            if (clip.getId() != null && clip.getId().equals(id)) {
                                Files.delete(path);
                            }
                        } catch (IOException e) {
                            e.printStackTrace();
                        }
                    });
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    public List<ClipContent> getClipsByCategory(String category) {
        List<ClipContent> clips = new ArrayList<>();
        try {
            Path categoryPath = storagePath.resolve(category);
            if (Files.exists(categoryPath)) {
                Files.walk(categoryPath, 1)
                        .filter(Files::isRegularFile)
                        .filter(path -> path.toString().endsWith(".json"))
                        .forEach(path -> {
                            try {
                                ClipContent clip = objectMapper.readValue(path.toFile(), ClipContent.class);
                                clips.add(clip);
                            } catch (IOException e) {
                                e.printStackTrace();
                            }
                        });
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
        return clips;
    }
}
