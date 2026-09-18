package com.example.clip.controller;

import com.example.clip.core.ChatMessage;
import com.example.clip.core.ChatStreamHandle;
import com.example.clip.core.ChatStreamListener;
import com.example.clip.core.LlmProvider;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * AI 大纲流式生成接口（画布「智能创建」）。
 * <p>
 * 薄透传 {@code systemPrompt + userMessage}，绕过 {@code AiChatService}
 * 的固定 system 约束，直接将前端自定义的大纲生成提示词喂给
 * {@link LlmProvider#streamChat(List, ChatStreamListener)}，以 SSE 流式返回
 * {@code delta/done/error/heartbeat} 事件，便于前端逐块打字机展示。
 * </p>
 */
@RestController
@RequestMapping("/api/ai/outline")
@CrossOrigin(origins = "*")
public class AiOutlineController {

    private static final long STREAM_TIMEOUT_MS = 120_000L;
    private static final int MAX_SYSTEM_PROMPT_CHARS = 4000;
    private static final int MAX_USER_MESSAGE_CHARS = 2000;
    private static final ScheduledExecutorService HEARTBEATS =
            Executors.newScheduledThreadPool(1, runnable -> {
                Thread thread = new Thread(runnable, "ai-outline-heartbeat");
                thread.setDaemon(true);
                return thread;
            });

    private final LlmProvider llmProvider;

    public AiOutlineController(LlmProvider llmProvider) {
        this.llmProvider = llmProvider;
    }

    /**
     * 流式生成大纲。
     *
     * <pre>
     * POST /api/ai/outline/stream
     * {
     *   "systemPrompt": "只输出纯缩进式 Markdown 列表…",
     *   "userMessage":  "《三体》读书笔记",
     *   "requestId":    "可选，便于排查"
     * }
     * --- SSE
     * event: delta     { "requestId": ..., "content": "增量文本" }
     * event: done      { "requestId": ... }
     * event: heartbeat { "requestId": ... }          // 每 15s 心跳
     * event: error     { "requestId": ..., "code": ..., "message": ... }
     * </pre>
     */
    @PostMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public ResponseEntity<SseEmitter> stream(@RequestBody Map<String, String> body) {
        String systemPrompt = body.getOrDefault("systemPrompt", "");
        String userMessage = body.get("userMessage");
        String requestId = body.getOrDefault("requestId", "unknown");
        if (requestId.isBlank()) requestId = "unknown";

        if (systemPrompt == null || systemPrompt.isBlank()) {
            throw new IllegalArgumentException("systemPrompt 不能为空");
        }
        if (userMessage == null || userMessage.isBlank()) {
            throw new IllegalArgumentException("userMessage 不能为空");
        }
        if (systemPrompt.length() > MAX_SYSTEM_PROMPT_CHARS || userMessage.length() > MAX_USER_MESSAGE_CHARS) {
            throw new IllegalArgumentException("输入内容超出长度限制");
        }

        SseEmitter emitter = new SseEmitter(STREAM_TIMEOUT_MS);
        StreamLifecycle lifecycle = new StreamLifecycle(emitter, requestId);

        if (llmProvider == null || !llmProvider.isAvailable()) {
            lifecycle.sendError("NOT_CONFIGURED", "未配置可用的 AI 模型，请先在设置中配置并测试模型连接");
            lifecycle.close();
            return ResponseEntity.ok()
                    .contentType(MediaType.TEXT_EVENT_STREAM)
                    .body(emitter);
        }

        ScheduledFuture<?> heartbeat = HEARTBEATS.scheduleAtFixedRate(
                lifecycle::sendHeartbeat, 15, 15, TimeUnit.SECONDS);
        lifecycle.setHeartbeat(heartbeat);

        emitter.onCompletion(lifecycle::close);
        emitter.onTimeout(() -> {
            lifecycle.sendError("TIMEOUT", "AI 响应超时");
            lifecycle.close();
        });
        emitter.onError(error -> lifecycle.close());

        // 组装消息：system（前端自定义大纲约束）+ user（生成主题）。
        // 有意绕过 AiChatService 的固定 system/角色校验，以支持自定义 system prompt。
        List<ChatMessage> messages = new ArrayList<>();
        messages.add(new ChatMessage("system", systemPrompt));
        messages.add(new ChatMessage("user", userMessage));

        CompletableFuture.runAsync(() -> {
            try {
                ChatStreamHandle handle = llmProvider.streamChat(messages, lifecycle.listener());
                lifecycle.setHandle(handle);
            } catch (Exception error) {
                lifecycle.sendError("PROVIDER_ERROR", error.getMessage());
                lifecycle.close();
            }
        });

        return ResponseEntity.ok()
                .contentType(MediaType.TEXT_EVENT_STREAM)
                .body(emitter);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> handleBadRequest(IllegalArgumentException error) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", "INVALID_REQUEST");
        body.put("message", error.getMessage());
        return ResponseEntity.badRequest().body(body);
    }

    private static final class StreamLifecycle {
        private final SseEmitter emitter;
        private final String requestId;
        private final AtomicBoolean closed = new AtomicBoolean();
        private volatile ChatStreamHandle handle;
        private volatile ScheduledFuture<?> heartbeat;

        private StreamLifecycle(SseEmitter emitter, String requestId) {
            this.emitter = emitter;
            this.requestId = requestId;
        }

        private ChatStreamListener listener() {
            return new ChatStreamListener() {
                @Override
                public void onDelta(String content) {
                    send("delta", Map.of("requestId", requestId, "content", content));
                }

                @Override
                public void onComplete() {
                    send("done", Map.of("requestId", requestId));
                    close();
                }

                @Override
                public void onError(Throwable error) {
                    sendError("PROVIDER_ERROR", error == null ? "AI 服务调用失败" : error.getMessage());
                    close();
                }
            };
        }

        private synchronized void send(String event, Map<String, Object> data) {
            if (closed.get()) return;
            try {
                emitter.send(SseEmitter.event().name(event).data(data));
            } catch (IOException error) {
                close();
            }
        }

        private void sendHeartbeat() {
            send("heartbeat", Map.of("requestId", requestId));
        }

        private void sendError(String code, String message) {
            send("error", Map.of(
                    "requestId", requestId,
                    "code", code,
                    "message", message == null || message.isBlank() ? "AI 服务调用失败" : message));
        }

        private void setHandle(ChatStreamHandle value) {
            this.handle = value;
            if (closed.get() && value != null) value.cancel();
        }

        private void setHeartbeat(ScheduledFuture<?> value) {
            this.heartbeat = value;
        }

        private void close() {
            if (!closed.compareAndSet(false, true)) return;
            ScheduledFuture<?> heartbeatTask = heartbeat;
            if (heartbeatTask != null) heartbeatTask.cancel(false);
            ChatStreamHandle streamHandle = handle;
            if (streamHandle != null && !streamHandle.isCancelled()) streamHandle.cancel();
            try {
                emitter.complete();
            } catch (Exception ignored) {
                // 客户端已经断开时，complete 可能抛出异常；无需二次处理。
            }
        }
    }
}