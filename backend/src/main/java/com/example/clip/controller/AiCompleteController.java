package com.example.clip.controller;

import com.example.clip.core.LlmProvider;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * AI 同步补全 REST 控制器。
 * <p>
 * 提供一次性（非流式）的 LLM 对话接口，供知识图谱等页面
 * 「生成 Mermaid 流程图 / 增补节点」等需要完整返回后立刻渲染的场景使用。
 * 复用 {@link LlmProvider#chatForTier(String, String, String)} 的多级降级能力，
 * 失败时返回统一的错误结构便于前端提示。
 * </p>
 */
@RestController
@RequestMapping("/api/ai/complete")
@CrossOrigin(origins = "*")
public class AiCompleteController {

    private final LlmProvider llmProvider;

    public AiCompleteController(LlmProvider llmProvider) {
        this.llmProvider = llmProvider;
    }

    /**
     * 同步调用 LLM 并返回完整回复。
     *
     * <pre>
     * POST /api/ai/complete
     * {
     *   "systemPrompt": "...",
     *   "userMessage":  "...",
     *   "tier": "strong"          // 可选，默认 strong；可用 simple / strong
     * }
     * ---
     * 200 { "success": true,  "content": "..." , "provider": "..." }
     * 200 { "success": false, "message": "..." }  （未配置模型 / 调用失败）
     * </pre>
     */
    @PostMapping
    public ResponseEntity<Map<String, Object>> complete(@RequestBody Map<String, String> body) {
        String systemPrompt = body.getOrDefault("systemPrompt", "");
        String userMessage = body.get("userMessage");
        String tier = body.getOrDefault("tier", "strong");
        Map<String, Object> result = new LinkedHashMap<>();

        if (userMessage == null || userMessage.isBlank()) {
            result.put("success", false);
            result.put("message", "userMessage 不能为空");
            return ResponseEntity.badRequest().body(result);
        }
        if (llmProvider == null || !llmProvider.isAvailable()) {
            result.put("success", false);
            result.put("code", "NOT_CONFIGURED");
            result.put("message", "未配置可用的 AI 模型，请先在设置中配置并测试模型连接");
            return ResponseEntity.ok(result);
        }

        try {
            String tierName = "simple".equalsIgnoreCase(tier) ? "simple" : "strong";
            String content = llmProvider.chatForTier(systemPrompt, userMessage, tierName);
            result.put("success", true);
            result.put("content", content);
            result.put("provider", llmProvider.getProviderName());
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            result.put("success", false);
            result.put("code", "PROVIDER_ERROR");
            result.put("message", e.getMessage() == null || e.getMessage().isBlank()
                    ? "AI 调用失败" : e.getMessage());
            return ResponseEntity.ok(result);
        }
    }
}