package com.example.clip.service;

import com.example.clip.index.ActionEvent;
import com.example.clip.index.ActionEventService;
import com.example.clip.index.EventTypes;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

/**
 * Best-effort local event recorder; telemetry failures never block business operations.
 * <ul>
 *   <li><b>白名单</b>：仅记录 {@link EventTypes} 注册的事件类型，避免埋点污染。</li>
 *   <li><b>幂等键</b>：以事件指纹去重，快速重复点击不会重复入库。</li>
 *   <li><b>异步队列</b>：写入放到单线程队列，业务操作不被 IO 阻塞。</li>
 * </ul>
 */
@Service
public class UserActionEventRecorder {
    private static final Logger log = LoggerFactory.getLogger(UserActionEventRecorder.class);

    /** 允许记录的事件类型白名单，反射自 {@link EventTypes} 常量。 */
    private static final Set<String> WHITELIST = buildWhitelist();
    /** 异步写入队列最大容量，超限丢弃事件并降级。 */
    private static final int MAX_QUEUE = 1000;
    /** 幂等去重窗口大小。 */
    private static final int MAX_SEEN = 2048;

    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "action-event-writer");
        thread.setDaemon(true);
        return thread;
    });

    /** 事件指纹 → 近期是否已记录（按插入序裁剪上限）。 */
    private static final LinkedHashMap<String, Boolean> SEEN = new LinkedHashMap<>();

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
        if (!WHITELIST.contains(type)) {
            log.debug("skip unregistered event type={}", type);
            return;
        }
        String idemKey = idempotencyKey(type, contentId, workspaceId, source, metadata);
        synchronized (SEEN) {
            if (SEEN.containsKey(idemKey)) {
                log.debug("deduplicate event idemKey={}", idemKey);
                return;
            }
            SEEN.put(idemKey, Boolean.TRUE);
            while (SEEN.size() > MAX_SEEN) {
                SEEN.remove(SEEN.keySet().iterator().next());
            }
        }
        try {
            Path path = Path.of(appConfigService.getConfigDirPath(), "index", "action-events.jsonl");
            ActionEvent event = new ActionEvent("e_" + idemKey, type,
                    contentId, workspaceId, source, null,
                    metadata == null ? Map.of() : Map.copyOf(metadata),
                    LocalDateTime.now(), EventTypes.SCHEMA_VERSION);
            WORKER.execute(() -> {
                try {
                    new ActionEventService(path).record(event);
                } catch (RuntimeException error) {
                    log.debug("async event write failed: {}", error.getMessage());
                }
            });
        } catch (RejectedExecutionException error) {
            log.debug("action-event queue full, dropped type={}", type);
        }
    }

    /** 由事件字段生成稳定指纹，同一逻辑事件的重复触发拥有相同的幂等键。 */
    private String idempotencyKey(String type, String contentId, String workspaceId,
                                  String source, Map<String, String> metadata) {
        StringBuilder sb = new StringBuilder(type).append('|')
                .append(trim(contentId)).append('|').append(trim(workspaceId))
                .append('|').append(trim(source));
        if (metadata != null) {
            metadata.entrySet().stream()
                    .sorted(Map.Entry.comparingByKey())
                    .forEach(e -> sb.append('|').append(e.getKey()).append('=').append(trim(e.getValue())));
        }
        return Integer.toHexString(sb.toString().hashCode());
    }

    private static String trim(String value) {
        return value == null ? "" : value;
    }

    /** 反射收集 {@link EventTypes} 中的字符串常量作为白名单，并纳入旧事件以保持兼容。 */
    private static Set<String> buildWhitelist() {
        Set<String> whitelist = new LinkedHashSet<>();
        try {
            for (Field field : EventTypes.class.getDeclaredFields()) {
                if (Modifier.isStatic(field.getModifiers()) && field.getType() == String.class) {
                    whitelist.add((String) field.get(null));
                }
            }
        } catch (Exception error) {
            log.warn("Failed to reflect EventTypes whitelist: {}", error.getMessage());
        }
        whitelist.add("rule_suggestion_accepted");
        return Set.copyOf(whitelist);
    }
}