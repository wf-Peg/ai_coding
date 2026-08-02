package com.example.clip.index;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

public class RelationIndexService {
    private final Path indexPath;
    private final ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());

    public RelationIndexService(Path indexPath) { this.indexPath = indexPath; }

    public synchronized void add(ContentRelation relation) {
        List<ContentRelation> relations = readAll();
        if (!relations.contains(relation)) relations.add(relation);
        write(relations);
    }

    public synchronized void remove(String fromId, String toId, String relationType) {
        write(readAll().stream().filter(item -> !(item.fromId().equals(fromId)
                && item.toId().equals(toId) && item.relationType().equals(relationType))).toList());
    }

    public synchronized List<ContentRelation> findFor(String contentId) {
        return readAll().stream().filter(item -> item.fromId().equals(contentId) || item.toId().equals(contentId)).toList();
    }

    public synchronized List<ContentRelation> readAll() {
        if (!Files.exists(indexPath)) return new ArrayList<>();
        try { return new ArrayList<>(objectMapper.readValue(indexPath.toFile(), new TypeReference<List<ContentRelation>>() {})); }
        catch (IOException error) { throw new IllegalStateException("无法读取关系索引: " + indexPath, error); }
    }

    private void write(List<ContentRelation> relations) {
        try {
            if (indexPath.getParent() != null) Files.createDirectories(indexPath.getParent());
            Path temp = indexPath.resolveSibling(indexPath.getFileName() + ".tmp");
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(temp.toFile(), new ArrayList<>(relations));
            Files.move(temp, indexPath, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException error) { throw new IllegalStateException("无法写入关系索引: " + indexPath, error); }
    }
}
