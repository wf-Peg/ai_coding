package com.example.clip.service.sync;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 一次同步/备份操作的执行结果。
 * <p>
 * 跨方案统一结果结构：{@code ok / message / steps}。
 * {@code steps} 为步骤明细列表，每步含 {@code name / ok / files / message}，
 * 与 Git 同步现有分步结果保持一致，供前端「同步状态」面板展示。
 * </p>
 *
 * @see SyncProvider
 */
public class SyncResult {

    /** 整体是否成功 */
    private boolean ok;
    /** 整体结果摘要 */
    private String message;
    /** 步骤明细列表（name / ok / files / message） */
    private List<Map<String, Object>> steps = new ArrayList<>();

    public boolean isOk() {
        return ok;
    }

    public void setOk(boolean ok) {
        this.ok = ok;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public List<Map<String, Object>> getSteps() {
        return steps;
    }

    public void setSteps(List<Map<String, Object>> steps) {
        this.steps = steps == null ? new ArrayList<>() : steps;
    }

    /** 便捷工厂：构造一个成功结果 */
    public static SyncResult ok(String message) {
        SyncResult r = new SyncResult();
        r.setOk(true);
        r.setMessage(message);
        return r;
    }

    /** 便捷工厂：构造一个失败结果 */
    public static SyncResult fail(String message) {
        SyncResult r = new SyncResult();
        r.setOk(false);
        r.setMessage(message);
        return r;
    }

    /** 便捷工厂：由通用 Map 结果（ok/steps/message）转换为 SyncResult */
    public static SyncResult from(Map<String, Object> result) {
        if (result == null) {
            return fail("同步结果为空");
        }
        SyncResult r = new SyncResult();
        r.setOk(Boolean.TRUE.equals(result.get("ok")));
        r.setMessage((String) result.getOrDefault("message", ""));
        Object steps = result.get("steps");
        if (steps instanceof List) {
            List<Map<String, Object>> list = new ArrayList<>();
            for (Object s : (List<?>) steps) {
                if (s instanceof Map) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> step = (Map<String, Object>) s;
                    Map<String, Object> copy = new LinkedHashMap<>(step);
                    list.add(copy);
                }
            }
            r.setSteps(list);
        }
        return r;
    }
}