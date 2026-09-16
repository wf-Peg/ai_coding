package com.example.clip.controller;

import com.example.clip.core.RoutingLlmProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * LLM 熔断（Circuit Breaker）管理 REST 控制器。
 * <p>
 * 对标 KaaS 借鉴项 5.2：当某模型档位（simple/strong）连续失败达到阈值后
 * 自动熔断冷却，避免反复重试烧钱。本控制器提供熔断状态查询与手动复位接口。
 * </p>
 *
 * <h3>接口列表</h3>
 * <ul>
 *   <li>{@code GET  /api/breakers/llm}         — 查询各档位熔断状态</li>
 *   <li>{@code POST /api/breakers/llm/reset}   — 手动复位熔断（可选 body.tier）</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/breakers/llm")
@CrossOrigin(origins = "*")
public class LlmBreakerController {

    private static final Logger log = LoggerFactory.getLogger(LlmBreakerController.class);

    private final RoutingLlmProvider routingLlmProvider;

    /**
     * 构造器注入。
     *
     * @param routingLlmProvider 路由 LLM 提供者（含熔断器）
     */
    public LlmBreakerController(RoutingLlmProvider routingLlmProvider) {
        this.routingLlmProvider = routingLlmProvider;
    }

    /**
     * 查询各档位熔断状态。
     *
     * @return {@code {"status":"success", tiers:{simple: {...}, strong: {...}}}}
     */
    @GetMapping
    public ResponseEntity<Map<String, Object>> status() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "success");
        result.put("tiers", routingLlmProvider.breakerStatus());
        return ResponseEntity.ok(result);
    }

    /**
     * 手动复位熔断器。
     *
     * @param body 可选 {@code tier}（simple / strong）；缺省复位所有档位
     * @return 复位结果
     */
    @PostMapping("/reset")
    public ResponseEntity<Map<String, Object>> reset(@RequestBody(required = false) Map<String, Object> body) {
        String tier = body != null ? (String) body.get("tier") : null;
        routingLlmProvider.resetBreaker(tier);
        log.info("[LLM][熔断] 手动复位请求，tier={}", tier != null ? tier : "all");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "success");
        result.put("message", "Breaker reset for " + (tier != null ? tier : "all tiers"));
        result.put("tiers", routingLlmProvider.breakerStatus());
        return ResponseEntity.ok(result);
    }
}