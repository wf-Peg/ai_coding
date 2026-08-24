package com.example.clip.controller;

import com.example.clip.core.ChatMessage;
import com.example.clip.core.ChatStreamHandle;
import com.example.clip.core.ChatStreamListener;
import com.example.clip.core.LlmProvider;
import com.example.clip.dto.AiChatRequest;
import com.example.clip.service.AiChatService;
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
 * 编辑器 AI 对话流式接口。
 */
@RestController
@RequestMapping("/api/ai/chat")
@CrossOrigin(origins = "*")
public class AiChatController {

    private static final long STREAM_TIMEOUT_MS = 120_000L;
    private static final ScheduledExecutorService HEARTBEATS =
            Executors.newScheduledThreadPool(1, runnable -> {
                Thread thread = new Thread(runnable, "ai-chat-heartbeat");
                thread.setDaemon(true);
                return thread;
            });

    private final AiChatService aiChatService;
    private final LlmProvider llmProvider;

    public AiChatController(AiChatService aiChatService, LlmProvider llmProvider) {
        this.aiChatService = aiChatService;
        this.llmProvider = llmProvider;
    }

    @PostMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public ResponseEntity<SseEmitter> stream(@RequestBody AiChatRequest request) {
        List<ChatMessage> messages = aiChatService.validateAndBuildMessages(request);
        String requestId = request.requestId() == null || request.requestId().isBlank()
                ? "unknown" : request.requestId();
        SseEmitter emitter = new SseEmitter(STREAM_TIMEOUT_MS);
        StreamLifecycle lifecycle = new StreamLifecycle(emitter, requestId);
        ScheduledFuture<?> heartbeat = HEARTBEATS.scheduleAtFixedRate(
                lifecycle::sendHeartbeat, 15, 15, TimeUnit.SECONDS);
        lifecycle.setHeartbeat(heartbeat);

        emitter.onCompletion(lifecycle::close);
        emitter.onTimeout(() -> {
            lifecycle.sendError("TIMEOUT", "AI 响应超时");
            lifecycle.close();
        });
        emitter.onError(error -> lifecycle.close());

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
