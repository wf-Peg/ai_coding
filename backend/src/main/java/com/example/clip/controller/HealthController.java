package com.example.clip.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 健康检查端点。
 * <p>
 * Electron 主进程通过轮询 http://127.0.0.1:{port}/health 检测后端是否就绪。
 * 返回 200 表示服务已启动完成，可以接受请求。
 * </p>
 */
@RestController
public class HealthController {

    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "UP");
        result.put("timestamp", System.currentTimeMillis());
        return ResponseEntity.ok(result);
    }
}