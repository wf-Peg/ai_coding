package com.example.clip.service;

import com.example.clip.core.ChatMessage;
import com.example.clip.dto.AiChatRequest;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * 编辑器 AI 对话的请求校验与上下文组装服务。
 */
@Service
public class AiChatService {

    public static final int MAX_MESSAGES = 20;
    public static final int MAX_TOTAL_CHARS = 32000;
    public static final String SYSTEM_PROMPT = "你是一个专业的代码与文本编辑助手。回答要简洁、准确、易于理解；" +
            "当用户询问术语或代码时，优先给出清晰定义，并在必要时补充一个简短例子。";

    public List<ChatMessage> validateAndBuildMessages(AiChatRequest request) {
        if (request == null || request.messages() == null || request.messages().isEmpty()) {
            throw new IllegalArgumentException("messages 不能为空");
        }
        if (request.messages().size() > MAX_MESSAGES) {
            throw new IllegalArgumentException("messages 最多支持 " + MAX_MESSAGES + " 条");
        }

        int totalChars = 0;
        List<ChatMessage> messages = new ArrayList<>();
        messages.add(new ChatMessage("system", SYSTEM_PROMPT));
        for (ChatMessage message : request.messages()) {
            if (message == null || message.role() == null || message.content() == null
                    || message.content().isBlank()) {
                throw new IllegalArgumentException("消息角色和内容不能为空");
            }
            if (!"user".equals(message.role()) && !"assistant".equals(message.role())) {
                throw new IllegalArgumentException("仅支持 user 和 assistant 消息");
            }
            totalChars += message.content().length();
            if (totalChars > MAX_TOTAL_CHARS) {
                throw new IllegalArgumentException("对话内容超过 " + MAX_TOTAL_CHARS + " 字符限制");
            }
            messages.add(message);
        }
        return List.copyOf(messages);
    }
}
