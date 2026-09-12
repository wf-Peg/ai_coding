package com.example.clip.controller;

import com.example.clip.service.ToolRegistryService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import jakarta.servlet.http.HttpServletRequest;
import javax.imageio.ImageIO;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.URLDecoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 工具模块（Tools Hub）REST API 控制器
 * <p>
 * 提供工具注册表管理（列表 / 页面 / 提示词 / 导入 / 删除），
 * 以及首批文件处理类小工具的后端支撑（图片转换、CSV↔JSON 互转）。
 * </p>
 *
 * @see ToolRegistryService
 */
@RestController
@RequestMapping("/api/tools")
@CrossOrigin(origins = "*")
public class ToolController {

    private static final Logger logger = LoggerFactory.getLogger(ToolController.class);

    private final ToolRegistryService toolRegistryService;
    private final ObjectMapper objectMapper;

    public ToolController(ToolRegistryService toolRegistryService) {
        this.toolRegistryService = toolRegistryService;
        this.objectMapper = new ObjectMapper();
    }

    /**
     * 列出全部工具元数据。
     *
     * @return 工具列表
     */
    @GetMapping
    public ResponseEntity<Map<String, Object>> listTools() {
        logger.info("[ToolController] 列出工具");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("tools", toolRegistryService.listTools());
        return ResponseEntity.ok(result);
    }

    /**
     * 读取工具页面 HTML 内容。
     *
     * @param id 工具 id
     * @return HTML 内容；工具不存在返回 404
     */
    @GetMapping("/{id}/page")
    public ResponseEntity<?> getToolPage(@PathVariable String id) {
        String content = toolRegistryService.getToolPage(id);
        if (content == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "工具不存在: " + id));
        }
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType("text/html;charset=UTF-8"));
        return new ResponseEntity<>(content, headers, HttpStatus.OK);
    }

    /**
     * 读取工具开发提示词。
     *
     * @param id 工具 id
     * @return 提示词字符串；工具不存在返回 404
     */
    @GetMapping("/{id}/prompt")
    public ResponseEntity<?> getToolPrompt(@PathVariable String id) {
        String prompt = toolRegistryService.getToolPrompt(id);
        if (prompt == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "工具不存在: " + id));
        }
        return ResponseEntity.ok(Map.of("id", id, "prompt", prompt));
    }

    /**
     * 导入一个新工具。
     * <p>支持两种入口：
     * <ul>
     *   <li>type=html（默认）：上传自包含 HTML 页面 + 元数据；</li>
     *   <li>type=url（灵感橱窗）：提供网站地址，注册元数据，页面由 Electron 主进程克隆缓存。</li>
     * </ul></p>
     *
     * @param html        自包含 HTML 页面文件（type=html 时必填）
     * @param name        工具名称
     * @param category    分类
     * @param description 一句话描述
     * @param prompt      开发需求提示词
     * @param type        工具类型：html | url
     * @param url         网站地址（type=url 时必填，http/https）
     * @param embeddable  内嵌可用性探测结果（type=url 可选）
     * @return 新工具元数据
     */
    @PostMapping
    public ResponseEntity<?> importTool(
            @RequestParam(value = "html", required = false) MultipartFile html,
            @RequestParam(value = "name", required = false) String name,
            @RequestParam(value = "category", required = false) String category,
            @RequestParam(value = "description", required = false) String description,
            @RequestParam(value = "prompt", required = false) String prompt,
            @RequestParam(value = "type", required = false, defaultValue = "html") String type,
            @RequestParam(value = "url", required = false) String url,
            @RequestParam(value = "embeddable", required = false) Boolean embeddable) {
        logger.info("[ToolController] 导入工具: {} type={}", name, type);
        try {
            if ("url".equalsIgnoreCase(type)) {
                String normalized = normalizeUrl(url);
                if (normalized == null) {
                    return ResponseEntity.badRequest().body(Map.of("error", "请输入有效的网站地址（http/https）"));
                }
                Map<String, Object> tool = toolRegistryService.importToolWithUrl(
                        name, category, description, prompt, normalized, embeddable);
                return ResponseEntity.ok(tool);
            }
            if (html == null || html.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("error", "请上传工具 HTML 文件"));
            }
            String htmlContent = new String(html.getBytes(), java.nio.charset.StandardCharsets.UTF_8);
            Map<String, Object> tool = toolRegistryService.importTool(name, category, description, prompt, htmlContent);
            return ResponseEntity.ok(tool);
        } catch (Exception e) {
            logger.error("[ToolController] 导入工具失败: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", "导入失败: " + e.getMessage()));
        }
    }

    /**
     * 探测网站地址的内嵌可用性（无状态，导入时调用）。
     * <p>GET /api/tools/probe?url=...，检查 {@code x-frame-options} 与 CSP {@code frame-ancestors}，
     * 并尽力提取 {@code <title>} 供导入自动填名。</p>
     *
     * @param url 目标网站地址
     * @return {embeddable, status, finalUrl, title?}
     */
    @GetMapping("/probe")
    public ResponseEntity<?> probeUrl(@RequestParam("url") String url) {
        String normalized = normalizeUrl(url);
        if (normalized == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "请输入有效的网站地址（http/https）"));
        }
        logger.info("[ToolController] 探测内嵌可用性: {}", normalized);
        Map<String, Object> result = probeRemote(normalized);
        return ResponseEntity.ok(result);
    }

    /**
     * 重新探测已存在 URL 工具的内嵌可用性并写回注册表。
     *
     * @param id 工具 id
     * @return 探测结果；工具不存在返回 404
     */
    @PostMapping("/{id}/probe")
    public ResponseEntity<?> reProbeUrl(@PathVariable String id) {
        Map<String, Object> tool = findToolById(id);
        if (tool == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "工具不存在: " + id));
        }
        Object url = tool.get("url");
        if (!(url instanceof String) || url.toString().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "该工具不是网站地址类工具"));
        }
        Map<String, Object> result = probeRemote(url.toString());
        Object embeddable = result.get("embeddable");
        if (embeddable instanceof Boolean) {
            toolRegistryService.updateToolEmbeddable(id, (Boolean) embeddable);
        }
        result.put("id", id);
        return ResponseEntity.ok(result);
    }

    /**
     * 更新工具缓存状态（克隆结果写回）。
     * <p>PATCH /api/tools/{id}/cache，JSON 体：{cached: true|false, cachedAt?: "yyyy-MM-dd HH:mm:ss"}。</p>
     *
     * @param id   工具 id
     * @param body 请求体
     * @return 更新后的工具元数据；工具不存在返回 404
     */
    @PatchMapping("/{id}/cache")
    public ResponseEntity<?> updateToolCache(@PathVariable String id, @RequestBody Map<String, Object> body) {
        Object cachedObj = body.get("cached");
        if (!(cachedObj instanceof Boolean)) {
            return ResponseEntity.badRequest().body(Map.of("error", "cached 字段必须为布尔值"));
        }
        String cachedAt = body.get("cachedAt") == null ? null : body.get("cachedAt").toString();
        Map<String, Object> tool = toolRegistryService.updateToolCache(id, (Boolean) cachedObj, cachedAt);
        if (tool == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "工具不存在: " + id));
        }
        return ResponseEntity.ok(tool);
    }

    /**
     * 静态伺服 URL 工具的「克隆缓存页面」。
     * <p>GET /api/tools/{id}/cache/{path}：入口 {@code index.html} 自动注入主题桥脚本；
     * 其余资源（snapshot_files/…）按扩展名返回。全程路径穿越防护。</p>
     *
     * @param id      工具 id
     * @param request 请求（提取 cache 之后的相对路径）
     * @return 缓存内容；未缓存/越界返回 404
     */
    @GetMapping("/{id}/cache/**")
    public ResponseEntity<?> getToolCacheResource(@PathVariable String id, HttpServletRequest request) {
        String uri = request.getRequestURI();
        String marker = "/api/tools/" + id + "/cache/";
        int idx = uri.indexOf(marker);
        String relative = idx >= 0 ? uri.substring(idx + marker.length()) : "";
        try {
            relative = URLDecoder.decode(relative, StandardCharsets.UTF_8.name());
        } catch (Exception e) {
            logger.warn("[ToolController] cache path decode failed: {}", relative);
        }
        // 显式拒绝路径穿越：解码后仍含 .. 段的一律 404（容器归一化之外的纵深防御）
        if (containsParentSegment(relative)) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "非法路径"));
        }
        if (relative.isEmpty() || "/".equals(relative)) {
            relative = "index.html";
        }
        if ("index.html".equals(relative)) {
            // 入口页：注入主题桥后返回
            String entry = toolRegistryService.getToolCacheEntry(id);
            if (entry == null) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "该工具尚未缓存页面"));
            }
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.parseMediaType("text/html;charset=UTF-8"));
            return new ResponseEntity<>(entry, headers, HttpStatus.OK);
        }
        Path file = toolRegistryService.resolveCachePath(id, relative);
        if (file == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "缓存资源不存在"));
        }
        try {
            byte[] bytes = Files.readAllBytes(file);
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.parseMediaType(mimeFor(relative)));
            return new ResponseEntity<>(bytes, headers, HttpStatus.OK);
        } catch (IOException e) {
            logger.error("[ToolController] 读取缓存资源失败: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", "读取缓存资源失败"));
        }
    }

    /** 判断路径中是否含父级跨越段（..）。 */
    private boolean containsParentSegment(String path) {
        if (path == null) {
            return false;
        }
        for (String seg : path.split("/+")) {
            if ("..".equals(seg)) {
                return true;
            }
        }
        return false;
    }

    /** 依据扩展名返回 MIME 类型（缓存静态资源）。 */
    private String mimeFor(String path) {
        String lower = path.toLowerCase();
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html;charset=UTF-8";
        if (lower.endsWith(".css")) return "text/css;charset=UTF-8";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript;charset=UTF-8";
        if (lower.endsWith(".json")) return "application/json;charset=UTF-8";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".ico")) return "image/x-icon";
        if (lower.endsWith(".avif")) return "image/avif";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".ttf")) return "font/ttf";
        if (lower.endsWith(".otf")) return "font/otf";
        if (lower.endsWith(".mp4")) return "video/mp4";
        if (lower.endsWith(".webm")) return "video/webm";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".wav")) return "audio/wav";
        if (lower.endsWith(".txt")) return "text/plain;charset=UTF-8";
        if (lower.endsWith(".pdf")) return "application/pdf";
        return "application/octet-stream";
    }

    /** 归一化 URL：缺 scheme 时补 https://，非 http(s) 返回 null。 */
    private String normalizeUrl(String url) {
        if (url == null) {
            return null;
        }
        String u = url.trim();
        if (u.isEmpty()) {
            return null;
        }
        if (!u.matches("^[a-zA-Z][a-zA-Z0-9+.-]*:.*")) {
            u = "https://" + u;
        }
        if (!u.matches("^https?://.*")) {
            return null;
        }
        return u;
    }

    /** 探测远程页面内嵌可用性（X-Frame-Options / CSP frame-ancestors）+ 提取 title。 */
    private Map<String, Object> probeRemote(String url) {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            HttpClient client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(15))
                    .followRedirects(HttpClient.Redirect.NORMAL)
                    .build();
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(30))
                    .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")
                    .header("Accept", "text/html,application/xhtml+xml,*/*")
                    .GET()
                    .build();
            HttpResponse<String> resp = client.send(req, HttpResponse.BodyHandlers.ofString());
            result.put("status", resp.statusCode());
            result.put("finalUrl", resp.uri().toString());
            boolean embeddable = true;
            String blockReason = null;
            String xfo = firstHeader(resp, "x-frame-options");
            if (xfo != null) {
                String v = xfo.trim().toUpperCase();
                if (v.equals("DENY") || v.equals("SAMEORIGIN")) {
                    embeddable = false;
                    blockReason = "X-Frame-Options: " + xfo;
                }
            }
            String csp = firstHeader(resp, "content-security-policy");
            if (embeddable && csp != null) {
                String fa = extractFrameAncestors(csp);
                if (fa != null) {
                    String faLower = fa.toLowerCase();
                    if (faLower.contains("'none'")) {
                        embeddable = false;
                        blockReason = "CSP frame-ancestors: " + fa.trim();
                    }
                }
            }
            result.put("embeddable", embeddable);
            if (blockReason != null) {
                result.put("blockReason", blockReason);
            }
            String contentType = firstHeader(resp, "content-type");
            if (contentType != null && contentType.toLowerCase().contains("text/html")) {
                String title = extractTitle(resp.body());
                if (title != null) {
                    result.put("title", title);
                }
            }
        } catch (Exception e) {
            // 探测失败（超时/网络/证书等）：保守视为可内嵌，交由前端 iframe 尝试 + 克隆兜底
            result.put("embeddable", true);
            result.put("status", 0);
            result.put("error", e.getMessage() == null ? "探测失败" : e.getMessage());
        }
        return result;
    }

    /** 取响应头首个值（大小写不敏感）。 */
    private String firstHeader(HttpResponse<?> resp, String name) {
        java.util.Optional<String> v = resp.headers().firstValue(name);
        return v.orElse(null);
    }

    private static final Pattern CSP_FRAME_ANCESTORS = Pattern.compile("frame-ancestors\\s+([^;]*)", Pattern.CASE_INSENSITIVE);
    private static final Pattern TITLE_TAG = Pattern.compile("<title[^>]*>(.*?)</title>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);

    /** 提取 CSP 的 frame-ancestors 指令值。 */
    private String extractFrameAncestors(String csp) {
        Matcher m = CSP_FRAME_ANCESTORS.matcher(csp);
        return m.find() ? m.group(1).trim() : null;
    }

    /** 尽力提取 HTML <title>。 */
    private String extractTitle(String body) {
        if (body == null || body.isEmpty()) {
            return null;
        }
        Matcher m = TITLE_TAG.matcher(body);
        if (m.find()) {
            String t = m.group(1).replaceAll("\\s+", " ").trim();
            return t.isEmpty() ? null : (t.length() > 60 ? t.substring(0, 60) : t);
        }
        return null;
    }

    /** 读取注册表中的工具元数据（不存在返回 null）。 */
    @SuppressWarnings("unchecked")
    private Map<String, Object> findToolById(String id) {
        List<Map<String, Object>> tools = toolRegistryService.listTools();
        for (Map<String, Object> t : tools) {
            if (id.equals(t.get("id"))) {
                return t;
            }
        }
        return null;
    }

    /**
     * 删除一个工具（内置工具不可删除）。
     *
     * @param id 工具 id
     * @return 删除结果
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteTool(@PathVariable String id) {
        logger.info("[ToolController] 删除工具: {}", id);
        try {
            boolean deleted = toolRegistryService.deleteTool(id);
            if (!deleted) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "工具不存在: " + id));
            }
            return ResponseEntity.ok(Map.of("success", true, "id", id));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            logger.error("[ToolController] 删除工具失败: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", "删除失败: " + e.getMessage()));
        }
    }

    /**
     * 启用或禁用指定工具。
     * <p>PATCH /api/tools/{id}/enabled，JSON 体：{enabled: true|false}。禁用后卡片灰显且不可打开，但仍保留在注册表中。</p>
     *
     * @param id   工具 id
     * @param body 请求体，需含 enabled 布尔字段
     * @return 更新后的工具元数据；工具不存在返回 404
     */
    @PatchMapping("/{id}/enabled")
    public ResponseEntity<?> setToolEnabled(@PathVariable String id, @RequestBody Map<String, Object> body) {
        logger.info("[ToolController] {} 工具: {}", Boolean.TRUE.equals(body.get("enabled")) ? "启用" : "禁用", id);
        try {
            Object enabledObj = body.get("enabled");
            if (!(enabledObj instanceof Boolean)) {
                return ResponseEntity.badRequest().body(Map.of("error", "enabled 字段必须为布尔值"));
            }
            Map<String, Object> tool = toolRegistryService.setToolEnabled(id, (Boolean) enabledObj);
            if (tool == null) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "工具不存在: " + id));
            }
            return ResponseEntity.ok(tool);
        } catch (Exception e) {
            logger.error("[ToolController] 设置工具状态失败: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", "操作失败: " + e.getMessage()));
        }
    }

    /**
     * 重排工具顺序（拖拽排序后持久化）。
     * <p>PUT /api/tools/reorder，JSON 体：{ids: [工具id按新顺序]}。仅重排已注册工具，系统工具不纳入。</p>
     *
     * @param body 请求体，需含 ids 数组
     * @return {ok: true}
     */
    @PutMapping("/reorder")
    public ResponseEntity<?> reorderTools(@RequestBody Map<String, Object> body) {
        try {
            Object idsObj = body.get("ids");
            if (!(idsObj instanceof List)) {
                return ResponseEntity.badRequest().body(Map.of("error", "ids 字段必须为数组"));
            }
            @SuppressWarnings("unchecked")
            List<String> ids = (List<String>) idsObj;
            boolean ok = toolRegistryService.reorderTools(ids);
            return ok ? ResponseEntity.ok(Map.of("ok", true))
                      : ResponseEntity.internalServerError().body(Map.of("error", "重排工具顺序失败"));
        } catch (Exception e) {
            logger.error("[ToolController] 重排工具顺序失败: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", "操作失败: " + e.getMessage()));
        }
    }

    /**
     * 图片格式转换与压缩。
     * <p>POST /api/tools/image/convert，multipart：file + format(png/jpg/webp/gif) + quality(0-100)。</p>
     *
     * @param file    原始图片
     * @param format  目标格式（png/jpg/webp/gif）
     * @param quality 压缩质量（jpg/webp 有效，0-100）
     * @return 转换后的图片字节流
     */
    @PostMapping("/image/convert")
    public ResponseEntity<?> convertImage(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "format", required = false, defaultValue = "png") String format,
            @RequestParam(value = "quality", required = false, defaultValue = "90") Integer quality) {
        logger.info("[ToolController] 图片转换: {} -> {}", file.getOriginalFilename(), format);
        try {
            if (file == null || file.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("error", "请上传图片文件"));
            }
            BufferedImage image = ImageIO.read(new ByteArrayInputStream(file.getBytes()));
            if (image == null) {
                return ResponseEntity.badRequest().body(Map.of("error", "无法解析图片，请上传有效的图片文件"));
            }

            String targetFormat = format.toLowerCase();
            if (!java.util.Arrays.asList("png", "jpg", "jpeg", "webp", "gif").contains(targetFormat)) {
                targetFormat = "png";
            }
            if ("jpeg".equals(targetFormat)) {
                targetFormat = "jpg";
            }

            // 重新绘制以支持 jpg 无透明通道输出
            int type = ("jpg".equals(targetFormat)) && image.getColorModel().hasAlpha()
                    ? BufferedImage.TYPE_INT_RGB : image.getType();
            if (type == BufferedImage.TYPE_CUSTOM || type == 0) {
                type = BufferedImage.TYPE_INT_RGB;
            }
            BufferedImage out = image;
            if ("jpg".equals(targetFormat) && image.getColorModel().hasAlpha()) {
                out = new BufferedImage(image.getWidth(), image.getHeight(), BufferedImage.TYPE_INT_RGB);
                Graphics2D g = out.createGraphics();
                g.setColor(java.awt.Color.WHITE);
                g.fillRect(0, 0, out.getWidth(), out.getHeight());
                g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
                g.drawImage(image, 0, 0, null);
                g.dispose();
            }

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            boolean written;
            if ("jpg".equals(targetFormat)) {
                written = ImageIO.write(out, "jpg", baos);
            } else {
                written = ImageIO.write(out, targetFormat, baos);
            }
            if (!written) {
                return ResponseEntity.internalServerError().body(Map.of("error", "转换失败：不支持的输出格式"));
            }

            String baseName = stripExtension(file.getOriginalFilename());
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.IMAGE_PNG);
            headers.add(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + baseName + "." + targetFormat + "\"");
            return new ResponseEntity<>(baos.toByteArray(), headers, HttpStatus.OK);
        } catch (Exception e) {
            logger.error("[ToolController] 图片转换失败: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", "转换失败: " + e.getMessage()));
        }
    }

    /**
     * CSV 与 JSON 互转。
     * <p>POST /api/tools/csv-json，JSON 体：{direction, content, delimiter}。</p>
     *
     * @param body 转换请求
     * @return 转换结果
     */
    @PostMapping("/csv-json")
    public ResponseEntity<?> csvJson(@RequestBody Map<String, Object> body) {
        String direction = body.get("direction") == null ? "csvToJson" : body.get("direction").toString();
        String content = body.get("content") == null ? "" : body.get("content").toString();
        String delimiter = body.get("delimiter") == null ? "," : body.get("delimiter").toString();
        if (delimiter.isEmpty()) {
            delimiter = ",";
        }
        logger.info("[ToolController] CSV↔JSON 转换: {}", direction);
        try {
            if (content.trim().isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("error", "内容不能为空"));
            }
            String result;
            if ("jsonToCsv".equalsIgnoreCase(direction)) {
                result = jsonToCsv(content, delimiter);
            } else {
                result = csvToJson(content, delimiter);
            }
            return ResponseEntity.ok(Map.of("result", result));
        } catch (Exception e) {
            logger.error("[ToolController] CSV↔JSON 转换失败: {}", e.getMessage(), e);
            return ResponseEntity.badRequest().body(Map.of("error", "转换失败: " + e.getMessage()));
        }
    }

    /**
     * CSV 转 JSON 数组。
     */
    private String csvToJson(String csv, String delimiter) throws IOException {
        List<String> lines = new ArrayList<>();
        for (String line : csv.split("\\r?\\n")) {
            if (!line.trim().isEmpty()) {
                lines.add(line);
            }
        }
        if (lines.isEmpty()) {
            throw new IllegalArgumentException("CSV 内容为空");
        }
        String[] headers = splitCsvLine(lines.get(0), delimiter);
        List<Map<String, Object>> rows = new ArrayList<>();
        for (int i = 1; i < lines.size(); i++) {
            String[] cells = splitCsvLine(lines.get(i), delimiter);
            Map<String, Object> row = new LinkedHashMap<>();
            for (int c = 0; c < headers.length; c++) {
                String value = c < cells.length ? trimQuote(cells[c]) : "";
                row.put(headers[c].trim(), parseValue(value));
            }
            rows.add(row);
        }
        return objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(rows);
    }

    /**
     * JSON 数组转 CSV。
     */
    private String jsonToCsv(String json, String delimiter) throws IOException {
        Object parsed = objectMapper.readValue(json, Object.class);
        if (!(parsed instanceof List)) {
            throw new IllegalArgumentException("仅支持 JSON 数组转 CSV");
        }
        List<?> list = (List<?>) parsed;
        if (list.isEmpty()) {
            return "";
        }
        // 收集所有列（保持出现顺序）
        List<String> headers = new ArrayList<>();
        for (Object item : list) {
            if (item instanceof Map) {
                for (Object key : ((Map<?, ?>) item).keySet()) {
                    if (!headers.contains(key.toString())) {
                        headers.add(key.toString());
                    }
                }
            }
        }
        StringBuilder sb = new StringBuilder();
        sb.append(String.join(delimiter, headers)).append("\r\n");
        for (Object item : list) {
            List<String> cells = new ArrayList<>();
            if (item instanceof Map) {
                Map<?, ?> map = (Map<?, ?>) item;
                for (String h : headers) {
                    Object v = map.get(h);
                    cells.add(escapeCsv(v == null ? "" : v.toString(), delimiter));
                }
            }
            sb.append(String.join(delimiter, cells)).append("\r\n");
        }
        return sb.toString();
    }

    /** 简单 CSV 行拆分（支持引号包裹的字段）。 */
    private String[] splitCsvLine(String line, String delimiter) {
        List<String> result = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean inQuotes = false;
        for (int i = 0; i < line.length(); i++) {
            char ch = line.charAt(i);
            if (inQuotes) {
                if (ch == '"') {
                    if (i + 1 < line.length() && line.charAt(i + 1) == '"') {
                        cur.append('"');
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    cur.append(ch);
                }
            } else {
                if (ch == '"') {
                    inQuotes = true;
                } else if (line.startsWith(delimiter, i)) {
                    result.add(cur.toString());
                    cur.setLength(0);
                    i += delimiter.length() - 1;
                } else {
                    cur.append(ch);
                }
            }
        }
        result.add(cur.toString());
        return result.toArray(new String[0]);
    }

    private String trimQuote(String s) {
        s = s.trim();
        if (s.length() >= 2 && s.startsWith("\"") && s.endsWith("\"")) {
            return s.substring(1, s.length() - 1);
        }
        return s;
    }

    private Object parseValue(String s) {
        if (s.isEmpty()) {
            return "";
        }
        if ("true".equalsIgnoreCase(s) || "false".equalsIgnoreCase(s)) {
            return Boolean.parseBoolean(s);
        }
        try {
            if (s.matches("-?\\d+")) {
                return Long.parseLong(s);
            }
            if (s.matches("-?\\d+\\.\\d+")) {
                return Double.parseDouble(s);
            }
        } catch (NumberFormatException ignore) {
            // 不是数字，保留字符串
        }
        return s;
    }

    private String escapeCsv(String value, String delimiter) {
        boolean needQuote = value.contains(delimiter) || value.contains("\"") || value.contains("\n") || value.contains("\r");
        if (needQuote) {
            return "\"" + value.replace("\"", "\"\"") + "\"";
        }
        return value;
    }

    private String stripExtension(String filename) {
        if (filename == null) {
            return "image";
        }
        int idx = filename.lastIndexOf('.');
        return idx > 0 ? filename.substring(0, idx) : filename;
    }
}