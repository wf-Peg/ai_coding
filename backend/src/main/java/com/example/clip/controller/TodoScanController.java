package com.example.clip.controller;

import com.example.clip.service.TodoScannerService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * TODO 目录扫描触发接口
 * <p>
 * 手动触发 product-dev-archive 落库扫描。正常流程下后端启动时自动扫描，
 * 此接口用于前端「立即扫描」按钮，在 Agent 增量归档后无需重启即可落库。
 * </p>
 */
@RestController
@RequestMapping("/api/todo-scan")
@CrossOrigin(origins = "*")
public class TodoScanController {

    private static final Logger log = LoggerFactory.getLogger(TodoScanController.class);

    private final TodoScannerService todoScannerService;

    public TodoScanController(TodoScannerService todoScannerService) {
        this.todoScannerService = todoScannerService;
    }

    @PostMapping
    public Map<String, Object> scan() {
        log.info("[TodoScanController] 收到手动扫描请求");
        TodoScannerService.ScanResult result = todoScannerService.scanAndImport();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("dirsScanned", result.dirsScanned());
        body.put("dirsImported", result.dirsImported());
        body.put("dirsSkipped", result.dirsSkipped());
        body.put("clipsCreated", result.clipsCreated());
        body.put("todosCreated", result.todosCreated());
        body.put("errors", result.errors());
        body.put("message", "扫描完成：" + result);
        return body;
    }
}
