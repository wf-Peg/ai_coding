package com.example.clip.controller;

import com.example.clip.model.DispatchRecord;
import com.example.clip.service.DispatchService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 内容分发 REST 控制器（MVP）。
 * <p>
 * 提供"剪藏一键投递到内部模型目标"与"多答案汇总蒸馏"两类接口：
 * <ul>
 *   <li>GET  /api/dispatch/targets —— 内置投递目标 + 当前模型信息</li>
 *   <li>POST /api/dispatch/{targetId} —— 执行投递（body: {"clipId": 123}）</li>
 *   <li>GET  /api/dispatch/records?clipId= —— 某剪藏的投递历史</li>
 *   <li>POST /api/dispatch/distill —— 汇总蒸馏（body: {"clipId": 123}）</li>
 * </ul>
 * 所有接口允许跨域（浏览器扩展访问）。成功/失败统一由返回 Map 的 success 字段标识，
 * 失败时 error 字段携带明确原因。
 * </p>
 *
 * @see DispatchService
 */
@RestController
@RequestMapping("/api/dispatch")
@CrossOrigin(origins = "*")
public class DispatchController {

    private static final Logger log = LoggerFactory.getLogger(DispatchController.class);

    private final DispatchService dispatchService;

    public DispatchController(DispatchService dispatchService) {
        this.dispatchService = dispatchService;
    }

    /**
     * 获取投递目标与当前模型信息。
     *
     * @return {currentModel: {provider, model}, targets: [{id,name,description}]}
     */
    @GetMapping("/targets")
    public ResponseEntity<Map<String, Object>> getTargets() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("currentModel", dispatchService.getCurrentModel());
        result.put("targets", dispatchService.getTargets());
        return ResponseEntity.ok(result);
    }

    /**
     * 执行一次投递。
     *
     * @param targetId 目标标识（path）
     * @param body     {"clipId": 123}
     * @return {success, result, targetId, targetName, dispatchedAt} 或 {success:false, error}
     */
    @PostMapping("/{targetId}")
    public ResponseEntity<Map<String, Object>> dispatch(@PathVariable String targetId,
                                                        @RequestBody(required = false) Map<String, Object> body) {
        log.info("[API] /dispatch/{} called", targetId);
        Long clipId = body == null ? null : toLong(body.get("clipId"));
        if (clipId == null) {
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("success", false);
            err.put("error", "缺少 clipId");
            return ResponseEntity.ok(err);
        }
        return ResponseEntity.ok(dispatchService.dispatch(clipId, targetId));
    }

    /**
     * 获取某剪藏的投递历史（含蒸馏记录）。
     *
     * @param clipId 剪藏 ID
     * @return List&lt;DispatchRecord&gt;
     */
    @GetMapping("/records")
    public ResponseEntity<List<DispatchRecord>> getRecords(@RequestParam Long clipId) {
        return ResponseEntity.ok(dispatchService.getRecords(clipId));
    }

    /**
     * 汇总蒸馏：将某剪藏的全部投递结果蒸馏为一份精炼总结。
     *
     * @param body {"clipId": 123}
     * @return {success, result, targetId, targetName, dispatchedAt} 或 {success:false, error}
     */
    @PostMapping("/distill")
    public ResponseEntity<Map<String, Object>> distill(@RequestBody(required = false) Map<String, Object> body) {
        log.info("[API] /dispatch/distill called");
        Long clipId = body == null ? null : toLong(body.get("clipId"));
        if (clipId == null) {
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("success", false);
            err.put("error", "缺少 clipId");
            return ResponseEntity.ok(err);
        }
        return ResponseEntity.ok(dispatchService.distill(clipId));
    }

    private Long toLong(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Number n) {
            return n.longValue();
        }
        try {
            return Long.parseLong(String.valueOf(value));
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
