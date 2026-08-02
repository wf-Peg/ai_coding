package com.example.clip;

import com.example.clip.controller.AiChatController;
import com.example.clip.core.ChatMessage;
import com.example.clip.core.LlmProvider;
import com.example.clip.dto.AiChatRequest;
import com.example.clip.service.AiChatService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(AiChatController.class)
class AiChatControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private AiChatService aiChatService;

    @MockBean
    private LlmProvider llmProvider;

    @Test
    void rejectsInvalidChatRequestAsBadRequest() throws Exception {
        when(aiChatService.validateAndBuildMessages(any(AiChatRequest.class)))
                .thenThrow(new IllegalArgumentException("messages 不能为空"));

        mockMvc.perform(post("/api/ai/chat/stream")
                        .contentType(APPLICATION_JSON)
                        .content("{\"requestId\":\"r1\",\"messages\":[]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("INVALID_REQUEST"));
    }

    @Test
    void acceptsValidatedRequestAsSseResponse() throws Exception {
        when(aiChatService.validateAndBuildMessages(any(AiChatRequest.class)))
                .thenReturn(List.of(new ChatMessage("system", "system"), new ChatMessage("user", "hello")));

        mockMvc.perform(post("/api/ai/chat/stream")
                        .contentType(APPLICATION_JSON)
                        .accept("text/event-stream")
                        .content("{\"requestId\":\"r1\",\"messages\":[{\"role\":\"user\",\"content\":\"hello\"}]}"))
                .andExpect(status().isOk())
                .andExpect(status().is2xxSuccessful());
    }
}
