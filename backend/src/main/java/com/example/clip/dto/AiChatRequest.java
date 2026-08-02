package com.example.clip.dto;

import com.example.clip.core.ChatMessage;

import java.util.List;

/**
 * 编辑器 AI 对话请求。
 */
public record AiChatRequest(String requestId, List<ChatMessage> messages) {
}
