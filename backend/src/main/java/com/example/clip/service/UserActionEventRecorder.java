package com.example.clip.service;

import com.example.clip.index.ActionEvent;
import com.example.clip.index.ActionEventService;
import com.example.clip.index.EventTypes;
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
        record(type, contentId, null, null, metadata);
    }

    public void record(String type, String contentId, String workspaceId, String source,
                       Map<String, String> metadata) {
        if (type == null || type.isBlank()) return;
        try {
            Path path = Path.of(appConfigService.getConfigDirPath(), "index", "action-events.jsonl");
            new ActionEventService(path).record(new ActionEvent("e_" + UUID.randomUUID(), type,
                    contentId, workspaceId, source, null,
                    metadata == null ? Map.of() : Map.copyOf(metadata),
                    LocalDateTime.now(), EventTypes.SCHEMA_VERSION));
        } catch (Exception error) {
            log.debug("Action event skipped: {}", error.getMessage());
        }
    }
}