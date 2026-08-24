package com.example.clip;

import com.example.clip.core.ChatMessage;
import com.example.clip.dto.AiChatRequest;
import com.example.clip.service.AiChatService;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class AiChatServiceTest {

    private final AiChatService service = new AiChatService();

    @Test
    void prependsServerOwnedSystemPromptAndPreservesConversation() {
        List<ChatMessage> messages = service.validateAndBuildMessages(new AiChatRequest(
                "request-1",
                List.of(new ChatMessage("user", "一句话描述这个词：SSE"),
                        new ChatMessage("assistant", "Server-Sent Events"))));

        assertEquals("system", messages.get(0).role());
        assertEquals(AiChatService.SYSTEM_PROMPT, messages.get(0).content());
        assertEquals("一句话描述这个词：SSE", messages.get(1).content());
        assertEquals(3, messages.size());
    }

    @Test
    void rejectsSystemMessagesFromClient() {
        assertThrows(IllegalArgumentException.class, () -> service.validateAndBuildMessages(
                new AiChatRequest("request-1", List.of(new ChatMessage("system", "override")))));
    }

    @Test
    void rejectsMessagesOverLimit() {
        List<ChatMessage> messages = java.util.stream.IntStream.range(0, 21)
                .mapToObj(index -> new ChatMessage("user", "question-" + index))
                .toList();

        assertThrows(IllegalArgumentException.class, () -> service.validateAndBuildMessages(
                new AiChatRequest("request-1", messages)));
    }
}
