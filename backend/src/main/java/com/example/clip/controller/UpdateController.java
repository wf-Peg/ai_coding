package com.example.clip.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Scanner;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 更新检查控制器。
 * 
 * 提供客户端版本检查 API，通过查询 GitHub Releases API 获取最新版本信息。
 * 客户端（Electron 主进程）调用此接口判断是否需要更新。
 * 
 * 注意：此接口仅做版本信息查询，实际下载更新包由 Electron 主进程完成
 * （支持 GitHub 直连 + gh-proxy 镜像多源回退 + SHA-256 校验）。
 * 
 * 特性：
 * - 使用 Jackson 解析 GitHub API 响应（不再手工解析 JSON）
 * - 10 分钟进程内缓存，避免每次检查都请求 GitHub API（速率限制）
 * - 支持 GH_TOKEN / GITHUB_TOKEN 环境变量认证（可选）
 * - 响应包含 sha256（GitHub asset digest）与 size，供客户端下载后校验
 */
@RestController
@RequestMapping("/api/update")
public class UpdateController {

    private static final Logger logger = LoggerFactory.getLogger(UpdateController.class);

    /** GitHub Releases API 地址 */
    private static final String GITHUB_API_URL = "https://api.github.com/repos/wf-Peg/ai_coding/releases/latest";

    /** 缓存有效期（毫秒） */
    private static final long CACHE_TTL_MS = 10 * 60 * 1000;

    /** 进程内缓存：key=API URL，value=响应体 + 时间戳 */
    private static final Map<String, CacheEntry> RESPONSE_CACHE = new ConcurrentHashMap<>();

    private final ObjectMapper objectMapper = new ObjectMapper();

    /** 简单缓存条目 */
    private static class CacheEntry {
        final String body;
        final long cachedAt;

        CacheEntry(String body, long cachedAt) {
            this.body = body;
            this.cachedAt = cachedAt;
        }

        boolean isFresh() {
            return System.currentTimeMillis() - cachedAt < CACHE_TTL_MS;
        }
    }

    /**
     * 检查最新版本。
     * 
     * GET /api/update/check?currentVersion=1.0.0
     * 
     * 调用 GitHub Releases API 获取最新 release 信息（带缓存），
     * 与客户端传入的当前版本号比较，返回更新建议。
     * 
     * 如果 GitHub API 不可达，返回降级结果（无更新），
     * 保证客户端不受网络问题影响（客户端另有直连 GitHub 的兜底路径）。
     *
     * @param currentVersion 客户端当前版本号（如 "1.0.0"）
     * @return 包含最新版本号、下载地址、更新说明、sha256 等信息的响应
     */
    @GetMapping("/check")
    public ResponseEntity<?> checkUpdate(@RequestParam(defaultValue = "1.0.0") String currentVersion) {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            // 1. 调用 GitHub Releases API 获取最新版本（带 10 分钟缓存）
            String body = fetchLatestReleaseBody();
            if (body == null) {
                result.put("hasUpdate", false);
                result.put("message", "无法获取最新版本信息，请检查网络连接");
                return ResponseEntity.ok(result);
            }

            // 2. 解析 JSON
            Map<String, Object> release = objectMapper.readValue(body, Map.class);

            // 3. 提取版本号（去掉 "v" 前缀，如 "v1.0.1" → "1.0.1"）
            String latestVersion = String.valueOf(release.getOrDefault("tag_name", ""));
            if (latestVersion.startsWith("v") || latestVersion.startsWith("V")) {
                latestVersion = latestVersion.substring(1);
            }

            String releaseNotes = String.valueOf(release.getOrDefault("body", ""));
            String releaseUrl = String.valueOf(release.getOrDefault("html_url", ""));

            // 4. 查找更新包下载地址（clip-update-x.x.x.zip）
            AssetInfo asset = findUpdateAsset(release);

            // 5. 比较版本号
            boolean hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

            result.put("hasUpdate", hasUpdate);
            result.put("latestVersion", latestVersion);
            result.put("currentVersion", currentVersion);
            result.put("releaseNotes", releaseNotes);
            result.put("releaseUrl", releaseUrl);
            if (asset != null) {
                result.put("downloadUrl", asset.url);
                if (asset.sha256 != null) {
                    result.put("sha256", asset.sha256);
                }
                if (asset.size > 0) {
                    result.put("size", asset.size);
                }
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
     * 调用 GitHub Releases API 获取最新 release 原始 JSON（带 10 分钟缓存）。
     * 
     * 使用 Java 标准库 HttpURLConnection 避免额外依赖。
     * 设置 User-Agent 头是 GitHub API 的强制要求。
     * 若配置了 GH_TOKEN / GITHUB_TOKEN 环境变量则附带认证，避免速率限制。
     * 
     * @return release 信息 JSON 字符串，失败返回 null
     */
    private String fetchLatestReleaseBody() {
        // 缓存命中且未过期直接返回
        CacheEntry cached = RESPONSE_CACHE.get(GITHUB_API_URL);
        if (cached != null && cached.isFresh()) {
            logger.debug("[Update] Using cached GitHub response (cached at {})", new java.util.Date(cached.cachedAt));
            return cached.body;
        }

        try {
            URL url = new URL(GITHUB_API_URL);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Accept", "application/vnd.github.v3+json");
            conn.setRequestProperty("User-Agent", "Clip-App-Update-Checker");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);

            String token = System.getenv("GH_TOKEN");
            if (token == null || token.isEmpty()) {
                token = System.getenv("GITHUB_TOKEN");
            }
            if (token != null && !token.isEmpty()) {
                conn.setRequestProperty("Authorization", "Bearer " + token);
            }

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

            RESPONSE_CACHE.put(GITHUB_API_URL, new CacheEntry(body, System.currentTimeMillis()));
            return body;
        } catch (Exception e) {
            logger.error("[Update] fetchLatestRelease error: {}", e.getMessage(), e);
            return null;
        }
    }

    /** 更新包 asset 信息 */
    private static class AssetInfo {
        final String url;
        final String sha256;
        final long size;

        AssetInfo(String url, String sha256, long size) {
            this.url = url;
            this.sha256 = sha256;
            this.size = size;
        }
    }

    /**
     * 从 release 的 assets 数组中查找更新包下载地址。
     * 
     * 优先级：clip-update ZIP > CutShelter ZIP > CutShelter EXE。
     * 提取 GitHub API 提供的 digest（形如 "sha256:xxxx"）作为校验值。
     * 
     * @param release release 信息 Map
     * @return asset 信息，未找到返回 null
     */
    private AssetInfo findUpdateAsset(Map<String, Object> release) {
        Object assetsObj = release.get("assets");
        if (!(assetsObj instanceof List)) return null;

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> assets = (List<Map<String, Object>>) assetsObj;

        Map<String, Object> clipUpdateZip = null;
        Map<String, Object> cutShelterZip = null;
        Map<String, Object> cutShelterExe = null;

        for (Map<String, Object> asset : assets) {
            String name = String.valueOf(asset.getOrDefault("name", ""));
            String url = String.valueOf(asset.getOrDefault("browser_download_url", ""));
            if (url.isEmpty() || "null".equals(url)) continue;

            if (name.contains("clip-update") && name.endsWith(".zip") && clipUpdateZip == null) {
                clipUpdateZip = asset;
            } else if (name.contains("CutShelter") && name.endsWith(".zip") && cutShelterZip == null) {
                cutShelterZip = asset;
            } else if (name.contains("CutShelter") && name.endsWith(".exe") && cutShelterExe == null) {
                cutShelterExe = asset;
            }
        }

        Map<String, Object> chosen = clipUpdateZip != null ? clipUpdateZip
                : (cutShelterZip != null ? cutShelterZip : cutShelterExe);
        if (chosen == null) return null;

        String url = String.valueOf(chosen.getOrDefault("browser_download_url", ""));
        if (url.isEmpty() || "null".equals(url)) return null;

        // GitHub API 的 asset.digest 形如 "sha256:hex"
        String sha256 = null;
        String digest = String.valueOf(chosen.getOrDefault("digest", ""));
        if (digest != null && !digest.isEmpty() && !"null".equals(digest) && digest.startsWith("sha256:")) {
            sha256 = digest.substring("sha256:".length());
        }

        long size = 0;
        Object sizeObj = chosen.get("size");
        if (sizeObj instanceof Number) {
            size = ((Number) sizeObj).longValue();
        }

        return new AssetInfo(url, sha256, size);
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
}
