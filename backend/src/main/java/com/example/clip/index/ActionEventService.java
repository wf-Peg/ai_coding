package com.example.clip.index;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

public class ActionEventService {
    private static final Logger log = LoggerFactory.getLogger(ActionEventService.class);
    private final Path eventPath;
    private final ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());
    private final AtomicLong skippedLineCount = new AtomicLong();

    public ActionEventService(Path eventPath) { this.eventPath = eventPath; }

    public synchronized void record(ActionEvent event) {
        try {
            createParentDirectory();
            Files.writeString(eventPath, objectMapper.writeValueAsString(event) + System.lineSeparator(),
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException error) {
            log.warn("Failed to write action event: {}", error.getMessage());
        }
    }

    public synchronized List<ActionEvent> readAll() {
        if (!Files.exists(eventPath)) return List.of();
        List<ActionEvent> events = new ArrayList<>();
        try {
            for (String line : Files.readAllLines(eventPath)) {
                if (line.isBlank()) continue;
                try {
                    events.add(objectMapper.readValue(line, ActionEvent.class));
                } catch (Exception error) {
                    skippedLineCount.incrementAndGet();
                    log.debug("Skipped bad event line: {}", error.getMessage());
                }
            }
        } catch (IOException error) {
            log.warn("Failed to read action events: {}", error.getMessage());
        }
        return events;
    }

    public synchronized void pruneBefore(LocalDateTime cutoff) {
        List<ActionEvent> kept = readAll().stream()
                .filter(event -> event.createdAt() == null || !event.createdAt().isBefore(cutoff)).toList();
        try {
            createParentDirectory();
            if (kept.isEmpty()) {
                Files.writeString(eventPath, "");
            } else {
                StringBuilder sb = new StringBuilder();
                for (ActionEvent event : kept) {
                    sb.append(objectMapper.writeValueAsString(event)).append(System.lineSeparator());
                }
                Files.writeString(eventPath, sb.toString());
            }
        } catch (IOException error) {
            log.warn("Failed to prune action events: {}", error.getMessage());
        }
    }

    public long skippedLineCount() {
        return skippedLineCount.get();
    }

    private void createParentDirectory() throws IOException {
        if (eventPath.getParent() != null) Files.createDirectories(eventPath.getParent());
    }
}