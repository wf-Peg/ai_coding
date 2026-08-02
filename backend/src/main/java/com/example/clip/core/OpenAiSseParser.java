package com.example.clip.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.function.Consumer;

/**
 * 解析 OpenAI 兼容接口的 SSE 文本。输入可以是任意网络分片。
 */
public final class OpenAiSseParser {

    private final ObjectMapper objectMapper;
    private final Consumer<String> onDelta;
    private final Runnable onComplete;
    private final StringBuilder lineBuffer = new StringBuilder();
    private boolean completed;

    public OpenAiSseParser(ObjectMapper objectMapper, Consumer<String> onDelta, Runnable onComplete) {
        this.objectMapper = objectMapper;
        this.onDelta = onDelta;
        this.onComplete = onComplete;
    }

    public void accept(String chunk) {
        if (completed || chunk == null || chunk.isEmpty()) {
            return;
        }
        lineBuffer.append(chunk);
        int newline;
        while ((newline = lineBuffer.indexOf("\n")) >= 0) {
            String line = lineBuffer.substring(0, newline);
            lineBuffer.delete(0, newline + 1);
            consumeLine(line.endsWith("\r") ? line.substring(0, line.length() - 1) : line);
        }
    }

    public void finish() {
        if (lineBuffer.length() > 0) {
            consumeLine(lineBuffer.toString());
            lineBuffer.setLength(0);
        }
        complete();
    }

    private void consumeLine(String line) {
        if (line.isEmpty() || line.startsWith(":")) {
            return;
        }
        if (line.startsWith("event:")) {
            return;
        }
        if (!line.startsWith("data:")) {
            return;
        }

        String data = line.substring(5).trim();
        if (data.isEmpty()) {
            return;
        }
        if ("[DONE]".equals(data)) {
            complete();
            return;
        }

        try {
            JsonNode root = objectMapper.readTree(data);
            JsonNode choices = root.path("choices");
            if (!choices.isArray() || choices.isEmpty()) {
                return;
            }
            JsonNode choice = choices.get(0);
            JsonNode delta = choice.path("delta").path("content");
            if (delta.isTextual() && !delta.asText().isEmpty()) {
                onDelta.accept(delta.asText());
            }
        } catch (Exception error) {
            throw new IllegalArgumentException("无法解析 LLM SSE 数据", error);
        }
    }

    private void complete() {
        if (!completed) {
            completed = true;
            onComplete.run();
        }
    }
}
