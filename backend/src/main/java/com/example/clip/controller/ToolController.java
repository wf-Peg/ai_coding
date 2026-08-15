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

import javax.imageio.ImageIO;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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
     * <p>上传自包含 HTML 页面 + 元数据，写入注册表与用户工具目录。</p>
     *
     * @param html        自包含 HTML 页面文件
     * @param name        工具名称
     * @param category    分类
     * @param description 一句话描述
     * @param prompt      开发需求提示词
     * @return 新工具元数据
     */
    @PostMapping
    public ResponseEntity<?> importTool(
            @RequestParam("html") MultipartFile html,
            @RequestParam(value = "name", required = false) String name,
            @RequestParam(value = "category", required = false) String category,
            @RequestParam(value = "description", required = false) String description,
            @RequestParam(value = "prompt", required = false) String prompt) {
        logger.info("[ToolController] 导入工具: {}", name);
        try {
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