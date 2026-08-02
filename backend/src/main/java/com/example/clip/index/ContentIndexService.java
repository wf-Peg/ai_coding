package com.example.clip.index;

import com.example.clip.service.FileStorageService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Rebuildable metadata index; business files remain the source of truth. */
public class ContentIndexService {

    private final ObjectMapper objectMapper;
    private final Path indexPath;

    public ContentIndexService(Path indexPath) {
        this.indexPath = indexPath;
        this.objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());
    }

    public synchronized void rebuild(Collection<ContentRef> refs) {
        Map<String, ContentRef> unique = new LinkedHashMap<>();
        if (refs != null) {
            for (ContentRef ref : refs) {
                if (ref == null || ref.id() == null || ref.id().isBlank()) {
                    continue;
                }
                unique.put(ref.id(), ref);
            }
        }
        writeAtomically(new ArrayList<>(unique.values()));
    }

    public synchronized void rebuildFromStorage(FileStorageService storageService) {
        if (storageService == null) {
            throw new IllegalArgumentException("storage service is required");
        }
        ContentRefMapper mapper = new ContentRefMapper();
        List<ContentRef> refs = new ArrayList<>();
        storageService.getAllClips().forEach(item -> refs.add(mapper.fromClip(item)));
        storageService.getAllKnowledgeEntries().forEach(item -> refs.add(mapper.fromKnowledge(item)));
        storageService.getAllTodos().forEach(item -> refs.add(mapper.fromTodo(item)));
        storageService.getAllLearningPlans().forEach(item -> refs.add(mapper.fromLearningPlan(item)));
        rebuild(refs);
    }

    public synchronized List<ContentRef> readAll() {
        if (!Files.exists(indexPath)) {
            return List.of();
        }
        try {
            return objectMapper.readValue(indexPath.toFile(), new TypeReference<List<ContentRef>>() {});
        } catch (IOException error) {
            throw new IllegalStateException("无法读取内容索引: " + indexPath, error);
        }
    }

    private void writeAtomically(List<ContentRef> refs) {
        try {
            Path parent = indexPath.getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            Path tempPath = indexPath.resolveSibling(indexPath.getFileName() + ".tmp");
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(tempPath.toFile(), refs);
            try {
                Files.move(tempPath, indexPath, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException ignored) {
                Files.move(tempPath, indexPath, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException error) {
            throw new IllegalStateException("无法写入内容索引: " + indexPath, error);
        }
    }
}
