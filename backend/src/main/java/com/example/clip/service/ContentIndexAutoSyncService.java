package com.example.clip.service;

import com.example.clip.index.ContentIndexService;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.nio.file.Path;

/** Keeps the rebuildable index eventually consistent with the business JSON files. */
@Service
public class ContentIndexAutoSyncService {
    private static final Logger log = LoggerFactory.getLogger(ContentIndexAutoSyncService.class);
    private final AppConfigService appConfigService;
    private final FileStorageService fileStorageService;

    public ContentIndexAutoSyncService(AppConfigService appConfigService, FileStorageService fileStorageService) {
        this.appConfigService = appConfigService;
        this.fileStorageService = fileStorageService;
    }

    @PostConstruct
    public void rebuildAtStartup() {
        rebuildSafely("startup");
    }

    @Scheduled(fixedDelayString = "${clip.index.rebuild-delay-ms:300000}", initialDelayString = "${clip.index.initial-delay-ms:30000}")
    public void rebuildPeriodically() {
        rebuildSafely("scheduled");
    }

    private void rebuildSafely(String reason) {
        try {
            Path path = Path.of(appConfigService.getConfigDirPath(), "index", "content-index.json");
            new ContentIndexService(path).rebuildFromStorage(fileStorageService);
            log.debug("Content index rebuilt ({})", reason);
        } catch (Exception error) {
            log.warn("Content index rebuild skipped ({}): {}", reason, error.getMessage());
        }
    }
}
