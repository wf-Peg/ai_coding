package com.example.clip.controller;

import com.example.clip.service.WeeklyReportService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 周报 REST 控制器
 * <p>
 * 提供周报生成与状态查询的 API 接口：
 * <ul>
 *   <li>生成周报：基于本周剪藏内容，调用 AI 生成结构化周报</li>
 *   <li>查询状态：获取最近一次周报生成的状态、消息和存储路径</li>
 * </ul>
 * 所有接口均映射到 {@code /api/weekly-report} 路径下，并允许跨域访问。
 * </p>
 *
 * @see WeeklyReportService
 */
@RestController
@RequestMapping("/api/weekly-report")
@CrossOrigin(origins = "*")  // 允许所有来源的跨域请求，包括浏览器扩展
public class WeeklyReportController {

    private static final Logger log = LoggerFactory.getLogger(WeeklyReportController.class);

    /** 周报生成核心业务服务 */
    private final WeeklyReportService weeklyReportService;

    /**
     * 构造函数，通过依赖注入初始化服务组件
     *
     * @param weeklyReportService 周报服务
     */
    @Autowired
    public WeeklyReportController(WeeklyReportService weeklyReportService) {
        this.weeklyReportService = weeklyReportService;
    }

    /**
     * 生成周报
     * <p>
     * POST /api/weekly-report/generate
     * <p>
     * 调用周报服务，基于本周收集的剪藏内容生成一份 AI 驱动的结构化周报。
     * 生成结果包含周报文本内容和文件存储路径。
     *
     * @return 包含 status、content、storagePath 等字段的 Map
     */
    @PostMapping("/generate")
    public ResponseEntity<Map<String, Object>> generateWeeklyReport() {
        log.info("[API] /weekly-report/generate called");
        // 调用服务层生成周报，返回结果中包含状态、内容、路径等信息
        Map<String, Object> result = weeklyReportService.generateWeeklyReport();
        return ResponseEntity.ok(result);
    }

    /**
     * 获取周报生成状态
     * <p>
     * GET /api/weekly-report/status
     * <p>
     * 查询最近一次周报生成操作的状态，用于前端轮询或展示生成进度。
     *
     * @return 包含 status（状态）、message（消息）、storagePath（存储路径）的 Map
     */
    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> getReportStatus() {
        // 构建状态信息 Map
        Map<String, Object> status = new java.util.HashMap<>();
        status.put("status", weeklyReportService.getLastReportStatus());
        status.put("message", weeklyReportService.getLastReportMessage());
        status.put("storagePath", weeklyReportService.getWeeklyReportPath());
        return ResponseEntity.ok(status);
    }
}