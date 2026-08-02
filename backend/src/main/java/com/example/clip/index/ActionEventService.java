package com.example.clip.index;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

public class ActionEventService {
    private final Path eventPath;
    private final ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());

    public ActionEventService(Path eventPath) { this.eventPath = eventPath; }

    public synchronized void record(ActionEvent event) {
        try {
            createParentDirectory();
            Files.writeString(eventPath, objectMapper.writeValueAsString(event) + System.lineSeparator(),
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException error) { throw new IllegalStateException("无法写入行为事件", error); }
    }

    public synchronized List<ActionEvent> readAll() {
        if (!Files.exists(eventPath)) return List.of();
        try {
            List<ActionEvent> events = new ArrayList<>();
            for (String line : Files.readAllLines(eventPath)) {
                if (!line.isBlank()) events.add(objectMapper.readValue(line, ActionEvent.class));
            }
            return events;
        } catch (IOException error) { throw new IllegalStateException("无法读取行为事件", error); }
    }

    public synchronized void pruneBefore(LocalDateTime cutoff) {
        List<ActionEvent> kept = readAll().stream().filter(event -> event.createdAt() == null || !event.createdAt().isBefore(cutoff)).toList();
        try {
            createParentDirectory();
            String content = kept.stream().map(event -> {
                try { return objectMapper.writeValueAsString(event); } catch (IOException e) { throw new IllegalStateException(e); }
            }).collect(java.util.stream.Collectors.joining(System.lineSeparator()));
            Files.writeString(eventPath, content.isEmpty() ? "" : content + System.lineSeparator());
        } catch (IOException error) { throw new IllegalStateException("无法清理行为事件", error); }
    }

    private void createParentDirectory() throws IOException {
        if (eventPath.getParent() != null) Files.createDirectories(eventPath.getParent());
    }
}
