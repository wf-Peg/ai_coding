package com.example.clip.controller;

import com.example.clip.service.WeeklyReportService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/weekly-report")
@CrossOrigin(origins = "*")  // 允许所有跨域请求，包括浏览器扩展
public class WeeklyReportController {

    private static final Logger log = LoggerFactory.getLogger(WeeklyReportController.class);

    private final WeeklyReportService weeklyReportService;

    @Autowired
    public WeeklyReportController(WeeklyReportService weeklyReportService) {
        this.weeklyReportService = weeklyReportService;
    }

    @PostMapping("/generate")
    public ResponseEntity<Map<String, Object>> generateWeeklyReport() {
        log.info("[API] /weekly-report/generate called");
        Map<String, Object> result = weeklyReportService.generateWeeklyReport();
        return ResponseEntity.ok(result);
    }

    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> getReportStatus() {
        Map<String, Object> status = new java.util.HashMap<>();
        status.put("status", weeklyReportService.getLastReportStatus());
        status.put("message", weeklyReportService.getLastReportMessage());
        status.put("storagePath", weeklyReportService.getWeeklyReportPath());
        return ResponseEntity.ok(status);
    }
}
