package com.example.clip.controller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Scanner;

/**
 * 更新检查控制器。
 * 
 * 提供客户端版本检查 API，通过查询 GitHub Releases API 获取最新版本信息。
 * 客户端（Electron 主进程）调用此接口判断是否需要更新。
 * 
 * 注意：此接口仅做版本信息查询，实际下载更新包由 Electron 主进程
 * 通过 update-manager 模块直接请求 GitHub API 完成。
 */
@RestController
@RequestMapping("/api/update")
public class UpdateController {

    private static final Logger logger = LoggerFactory.getLogger(UpdateController.class);

    /** GitHub Releases API 地址 */
    private static final String GITHUB_API_URL = "https://api.github.com/repos/wf-Peg/ai_coding/releases/latest";

    /**
     * 检查最新版本。
     * 
     * GET /api/update/check?currentVersion=1.0.0
     * 
     * 调用 GitHub Releases API 获取最新 release 信息，
     * 与客户端传入的当前版本号比较，返回更新建议。
     * 
     * 如果 GitHub API 不可达，返回降级结果（无更新），
     * 保证客户端不受网络问题影响。
     *
     * @param currentVersion 客户端当前版本号（如 "1.0.0"）
     * @return 包含最新版本号、下载地址、更新说明等信息的响应
     */
    @GetMapping("/check")
    public ResponseEntity<?> checkUpdate(@RequestParam(defaultValue = "1.0.0") String currentVersion) {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            // 1. 调用 GitHub Releases API 获取最新版本
            Map<String, Object> release = fetchLatestRelease();

            if (release == null) {
                result.put("hasUpdate", false);
                result.put("message", "无法获取最新版本信息，请检查网络连接");
                return ResponseEntity.ok(result);
            }

            // 2. 提取版本号（去掉 "v" 前缀，如 "v1.0.1" → "1.0.1"）
            String latestVersion = (String) release.getOrDefault("tag_name", "");
            if (latestVersion.startsWith("v") || latestVersion.startsWith("V")) {
                latestVersion = latestVersion.substring(1);
            }

            String releaseNotes = (String) release.getOrDefault("body", "");
            String releaseUrl = (String) release.getOrDefault("html_url", "");

            // 3. 查找更新包下载地址（clip-update-x.x.x.zip）
            String updateDownloadUrl = findUpdateAssetUrl(release);

            // 4. 比较版本号
            boolean hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

            result.put("hasUpdate", hasUpdate);
            result.put("latestVersion", latestVersion);
            result.put("currentVersion", currentVersion);
            result.put("releaseNotes", releaseNotes);
            result.put("releaseUrl", releaseUrl);
            if (updateDownloadUrl != null) {
                result.put("downloadUrl", updateDownloadUrl);
            }

            if (hasUpdate) {
                result.put("message", "发现新版本 v" + latestVersion);
            } else {
                result.put("message", "已是最新版本");
            }

        } catch (Exception e) {
            logger.error("[Update] check failed: {}", e.getMessage(), e);
            result.put("hasUpdate", false);
            result.put("message", "更新检查失败: " + e.getMessage());
        }

        return ResponseEntity.ok(result);
    }

    /**
     * 调用 GitHub Releases API 获取最新 release 信息。
     * 
     * 使用 Java 标准库 HttpURLConnection 避免额外依赖。
     * 设置 User-Agent 头是 GitHub API 的强制要求。
     * 
     * @return release 信息的 Map，失败返回 null
     */
    private Map<String, Object> fetchLatestRelease() {
        try {
            URL url = new URL(GITHUB_API_URL);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Accept", "application/vnd.github.v3+json");
            conn.setRequestProperty("User-Agent", "Clip-App-Update-Checker");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);

            int code = conn.getResponseCode();
            if (code != 200) {
                logger.warn("[Update] GitHub API returned HTTP {}", code);
                return null;
            }

            // 读取响应体
            String body;
            try (InputStream is = conn.getInputStream();
                 Scanner scanner = new Scanner(is, StandardCharsets.UTF_8)) {
                scanner.useDelimiter("\\A");
                body = scanner.hasNext() ? scanner.next() : "";
            }

            // 手动解析需要的字段（tag_name, body, html_url, assets）
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("tag_name", extractJsonString(body, "tag_name"));
            result.put("body", extractJsonString(body, "body"));
            result.put("html_url", extractJsonString(body, "html_url"));
            // 提取 assets 数组的原始 JSON 文本
            result.put("assets", extractJsonArray(body, "assets"));

            return result;
        } catch (Exception e) {
            logger.error("[Update] fetchLatestRelease error: {}", e.getMessage(), e);
            return null;
        }
    }

    /**
     * 从 release 的 assets 数组中查找更新包下载地址。
     * 
     * 在 assets JSON 数组中查找包含 "browser_download_url" 的条目，
     * 匹配 URL 中包含 "clip-update" 的 asset 并返回其下载地址。
     * 
     * @param release release 信息 Map
     * @return 下载 URL，未找到返回 null
     */
    private String findUpdateAssetUrl(Map<String, Object> release) {
        String assetsJson = (String) release.getOrDefault("assets", "");
        if (assetsJson == null || assetsJson.isEmpty()) return null;

        // 在 assets JSON 数组中查找 browser_download_url
        // 格式: [{"name":"xxx","browser_download_url":"https://..."}]
        int idx = 0;
        while ((idx = assetsJson.indexOf("\"browser_download_url\"", idx)) >= 0) {
            int colon = assetsJson.indexOf(":", idx);
            if (colon < 0) break;
            int startQuote = assetsJson.indexOf("\"", colon + 1);
            if (startQuote < 0) break;
            int endQuote = assetsJson.indexOf("\"", startQuote + 1);
            if (endQuote < 0) break;
            String url = assetsJson.substring(startQuote + 1, endQuote);
            // 检查是否包含 clip-update
            if (url.contains("clip-update")) {
                return url;
            }
            idx = endQuote + 1;
        }
        return null;
    }

    /**
     * 比较两个语义化版本号。
     * 
     * 支持格式：x.y.z，如 "1.0.1" vs "1.0.0"
     * 
     * @param v1 版本号 1
     * @param v2 版本号 2
     * @return 正数表示 v1 > v2，0 表示相等，负数表示 v1 < v2
     */
    private int compareVersions(String v1, String v2) {
        try {
            String[] parts1 = v1.split("\\.");
            String[] parts2 = v2.split("\\.");
            int len = Math.max(parts1.length, parts2.length);
            for (int i = 0; i < len; i++) {
                int n1 = i < parts1.length ? Integer.parseInt(parts1[i]) : 0;
                int n2 = i < parts2.length ? Integer.parseInt(parts2[i]) : 0;
                if (n1 != n2) return n1 - n2;
            }
            return 0;
        } catch (NumberFormatException e) {
            // 非标准版本号，回退到字符串比较
            return v1.compareTo(v2);
        }
    }

    /**
     * 从 JSON 字符串中提取指定字段的值（简单解析，不依赖 JSON 库）。
     * 
     * 仅支持顶层字符串字段，不支持嵌套对象和数组。
     * 
     * @param json  JSON 字符串
     * @param field 字段名
     * @return 字段值，未找到返回空字符串
     */
    private String extractJsonString(String json, String field) {
        // 查找 "field": 模式
        String key = "\"" + field + "\"";
        int keyIdx = json.indexOf(key);
        if (keyIdx < 0) return "";

        int colonIdx = json.indexOf(":", keyIdx + key.length());
        if (colonIdx < 0) return "";

        int startQuote = json.indexOf("\"", colonIdx + 1);
        if (startQuote < 0) return "";

        int endQuote = json.indexOf("\"", startQuote + 1);
        if (endQuote < 0) return "";

        return json.substring(startQuote + 1, endQuote)
                .replace("\\\"", "\"")
                .replace("\\n", "\n")
                .replace("\\t", "\t");
    }

    /**
     * 从 JSON 字符串中提取字段的原始 JSON 数组/对象文本。
     * 支持嵌套结构，通过括号匹配找到完整的值范围。
     * 
     * @param json  JSON 字符串
     * @param field 字段名
     * @return 原始 JSON 值文本，未找到返回空字符串
     */
    private String extractJsonArray(String json, String field) {
        String key = "\"" + field + "\"";
        int keyIdx = json.indexOf(key);
        if (keyIdx < 0) return "";

        int colonIdx = json.indexOf(":", keyIdx + key.length());
        if (colonIdx < 0) return "";

        // 跳过冒号后的空白
        int start = colonIdx + 1;
        while (start < json.length() && Character.isWhitespace(json.charAt(start))) {
            start++;
        }
        if (start >= json.length()) return "";

        char openChar = json.charAt(start);
        char closeChar;
        if (openChar == '[') closeChar = ']';
        else if (openChar == '{') closeChar = '}';
        else if (openChar == '"') closeChar = '"';
        else return "";

        // 括号匹配找到对应的闭合位置
        int depth = 1;
        int pos = start + 1;
        boolean inString = false;
        while (pos < json.length() && depth > 0) {
            char c = json.charAt(pos);
            if (c == '\\') {
                pos++; // 跳过转义字符
            } else if (c == '"') {
                inString = !inString;
            } else if (!inString) {
                if (c == openChar && openChar != '"') depth++;
                else if (c == closeChar) depth--;
            }
            pos++;
        }

        return json.substring(start, pos);
    }
}