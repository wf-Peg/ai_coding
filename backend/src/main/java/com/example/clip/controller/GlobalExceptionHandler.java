package com.example.clip.controller;

import com.example.clip.service.ExceptionLogService;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 全局异常处理器
 * <p>
 * 统一捕获所有 Controller 抛出的未处理异常，记录到异常日志文件，
 * 同时返回友好的错误响应。
 * </p>
 */
@ControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    private final ExceptionLogService exceptionLogService;

    public GlobalExceptionHandler(ExceptionLogService exceptionLogService) {
        this.exceptionLogService = exceptionLogService;
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleException(Exception ex, HttpServletRequest request) {
        // 记录到异常日志
        exceptionLogService.record(ex, "backend", request.getRequestURI());

        // 控制台日志
        log.error("Unhandled exception for request {}: {}", request.getRequestURI(), ex.getMessage(), ex);

        // 返回友好错误响应
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", "error");
        body.put("message", "服务器内部错误，已记录异常日志");
        body.put("error", ex.getClass().getSimpleName() + ": " + ex.getMessage());
        return ResponseEntity.internalServerError().body(body);
    }
}