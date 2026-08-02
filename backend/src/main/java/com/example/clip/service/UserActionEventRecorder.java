package com.example.clip.service;

import com.example.clip.index.ActionEvent;
import com.example.clip.index.ActionEventService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.Map;
import java.util.UUID;

/** Best-effort local event recorder; telemetry failures never block business operations. */
@Service
public class UserActionEventRecorder {
    private static final Logger log = LoggerFactory.getLogger(UserActionEventRecorder.class);
    private final AppConfigService appConfigService;

    public UserActionEventRecorder(AppConfigService appConfigService) {
        this.appConfigService = appConfigService;
    }

    public void record(String type, String contentId, Map<String, String> metadata) {
        if (type == null || type.isBlank()) return;
        try {
            Path path = Path.of(appConfigService.getConfigDirPath(), "index", "action-events.jsonl");
            new ActionEventService(path).record(new ActionEvent(UUID.randomUUID().toString(), type,
                    contentId, null, metadata == null ? Map.of() : Map.copyOf(metadata), LocalDateTime.now()));
        } catch (Exception error) {
            log.debug("Action event skipped: {}", error.getMessage());
        }
    }
}
