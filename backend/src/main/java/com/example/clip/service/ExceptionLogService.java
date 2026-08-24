package com.example.clip.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * 异常日志服务
 * <p>
 * 提供异常日志的写入和查询功能。所有异常写入 {@code {clip.storage.path}/tmp/exception-logs/} 目录。
 * 写入操作异步执行，不阻塞业务线程。
 * </p>
 */
@Service
public class ExceptionLogService {

    private static final Logger log = LoggerFactory.getLogger(ExceptionLogService.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final ExceptionLogWriter writer;

    public ExceptionLogService(@Value("${clip.storage.path:./clip-storage}") String storagePath) {
        this.writer = new ExceptionLogWriter(storagePath);
        log.info("ExceptionLogService initialized, base dir: {}", writer.getBaseDir());
    }

    /**
     * 记录异常（异步）
     *
     * @param source      异常来源（backend / electron / frontend）
     * @param sourceDetail 来源详细信息
     * @param message     异常消息
     * @param stackTrace  完整堆栈
     * @param level       日志级别
     * @param thread      线程名称
     * @param requestUri  请求路径
     */
    @Async
    public void record(String source, String sourceDetail, String message,
                       String stackTrace, String level, String thread, String requestUri) {
        try {
            writer.write(source, sourceDetail, message, stackTrace, level, thread, requestUri);
        } catch (Exception e) {
            log.error("Failed to record exception log", e);
        }
    }

    /**
     * 从 Throwable 记录异常（异步）
     */
    @Async
    public void record(Throwable throwable, String source, String requestUri) {
        try {
            String message = throwable.getMessage() != null ? throwable.getMessage() : throwable.getClass().getName();
            String stackTrace = ExceptionLogWriter.extractStackTrace(throwable);
            String sourceDetail = ExceptionLogWriter.extractSourceDetail(throwable);
            String thread = Thread.currentThread().getName();
            writer.write(source, sourceDetail, message, stackTrace, "ERROR", thread, requestUri);
        } catch (Exception e) {
            log.error("Failed to record exception log", e);
        }
    }

    /**
     * 从 Throwable 记录异常，自动从 HttpServletRequest 提取 requestUri
     */
    @Async
    public void record(Throwable throwable, HttpServletRequest request) {
        String requestUri = request != null ? request.getRequestURI() : null;
        record(throwable, "backend", requestUri);
    }

    /**
     * 从 Throwable 记录异常（后端默认来源）
     */
    @Async
    public void record(Throwable throwable) {
        record(throwable, "backend", null);
    }

    // ===== 查询方法 =====

    /**
     * 获取异常日志统计信息
     */
    public Map<String, Object> getStats() {
        Map<String, Object> stats = new LinkedHashMap<>();
        try {
            List<Map<String, Object>> allLogs = readAllLogs();
            stats.put("totalCount", allLogs.size());

            // 来源分布
            Map<String, Long> sourceDist = allLogs.stream()
                    .collect(Collectors.groupingBy(
                            m -> (String) m.getOrDefault("source", "unknown"),
                            Collectors.counting()));
            stats.put("sourceDistribution", sourceDist);

            // 级别分布
            Map<String, Long> levelDist = allLogs.stream()
                    .collect(Collectors.groupingBy(
                            m -> (String) m.getOrDefault("level", "UNKNOWN"),
                            Collectors.counting()));
            stats.put("levelDistribution", levelDist);

            // 近7天趋势
            LocalDate today = LocalDate.now();
            Map<String, Long> dailyCount = new LinkedHashMap<>();
            for (int i = 6; i >= 0; i--) {
                LocalDate day = today.minusDays(i);
                String key = day.toString();
                long count = allLogs.stream()
                        .filter(m -> {
                            String ts = (String) m.get("timestamp");
                            return ts != null && ts.startsWith(key);
                        })
                        .count();
                dailyCount.put(key, count);
            }
            stats.put("dailyCount7d", dailyCount);

            // 今日异常数
            long todayCount = allLogs.stream()
                    .filter(m -> {
                        String ts = (String) m.get("timestamp");
                        return ts != null && ts.startsWith(today.toString());
                    })
                    .count();
            stats.put("todayCount", todayCount);

        } catch (Exception e) {
            log.warn("Failed to get exception log stats: {}", e.getMessage());
            stats.put("totalCount", 0);
        }
        return stats;
    }

    /**
     * 分页查询异常日志
     *
     * @param date   日期筛选（可选，yyyy-MM-dd）
     * @param source 来源筛选（可选）
     * @param level  级别筛选（可选）
     * @param page   页码（从1开始）
     * @param size   每页条数
     * @return 分页结果
     */
    public Map<String, Object> queryLogs(String date, String source, String level, int page, int size) {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            List<Map<String, Object>> allLogs = readAllLogs();
            Stream<Map<String, Object>> stream = allLogs.stream();

            if (date != null && !date.isEmpty()) {
                stream = stream.filter(m -> {
                    String ts = (String) m.get("timestamp");
                    return ts != null && ts.startsWith(date);
                });
            }
            if (source != null && !source.isEmpty()) {
                stream = stream.filter(m -> source.equals(m.get("source")));
            }
            if (level != null && !level.isEmpty()) {
                stream = stream.filter(m -> level.equals(m.get("level")));
            }

            List<Map<String, Object>> filtered = stream.collect(Collectors.toList());
            // 按时间降序
            filtered.sort((a, b) -> {
                String ta = (String) a.getOrDefault("timestamp", "");
                String tb = (String) b.getOrDefault("timestamp", "");
                return tb.compareTo(ta);
            });

            int total = filtered.size();
            int fromIndex = Math.min((page - 1) * size, total);
            int toIndex = Math.min(page * size, total);
            List<Map<String, Object>> pageItems = filtered.subList(fromIndex, toIndex);

            result.put("items", pageItems);
            result.put("total", total);
            result.put("page", page);
            result.put("size", size);
            result.put("totalPages", (int) Math.ceil((double) total / size));

        } catch (Exception e) {
            log.warn("Failed to query exception logs: {}", e.getMessage());
            result.put("items", List.of());
            result.put("total", 0);
            result.put("page", page);
            result.put("size", size);
            result.put("totalPages", 0);
        }
        return result;
    }

    /**
     * 清理指定天数前的异常日志文件
     *
     * @param days 保留天数
     * @return 清理结果
     */
    public Map<String, Object> pruneLogs(int days) {
        Map<String, Object> result = new LinkedHashMap<>();
        LocalDate cutoff = LocalDate.now().minusDays(days);
        int removedCount = 0;
        try {
            Path baseDir = writer.getBaseDir();
            if (Files.exists(baseDir)) {
                try (Stream<Path> dirs = Files.list(baseDir)) {
                    List<Path> monthDirs = dirs.filter(Files::isDirectory).collect(Collectors.toList());
                    for (Path monthDir : monthDirs) {
                        try (Stream<Path> files = Files.list(monthDir)) {
                            for (Path file : files.collect(Collectors.toList())) {
                                String fileName = file.getFileName().toString();
                                if (fileName.startsWith("exception-") && fileName.endsWith(".jsonl")) {
                                    String dateStr = fileName.replace("exception-", "").replace(".jsonl", "");
                                    try {
                                        LocalDate fileDate = LocalDate.parse(dateStr, DateTimeFormatter.ISO_LOCAL_DATE);
                                        if (fileDate.isBefore(cutoff)) {
                                            Files.deleteIfExists(file);
                                            removedCount++;
                                        }
                                    } catch (Exception ignored) {
                                    }
                                }
                            }
                        }
                        // 删除空目录
                        try (Stream<Path> remaining = Files.list(monthDir)) {
                            if (remaining.findAny().isEmpty()) {
                                Files.deleteIfExists(monthDir);
                            }
                        }
                    }
                }
            }
            result.put("success", true);
            result.put("removed", removedCount);
            result.put("message", "已清理 " + removedCount + " 个 " + days + " 天前的异常日志文件");
        } catch (IOException e) {
            log.warn("Failed to prune exception logs: {}", e.getMessage());
            result.put("success", false);
            result.put("removed", 0);
            result.put("message", "清理失败: " + e.getMessage());
        }
        return result;
    }

    /**
     * 读取所有异常日志（按时间倒序）
     */
    private List<Map<String, Object>> readAllLogs() {
        List<Map<String, Object>> allLogs = new ArrayList<>();
        try {
            Path baseDir = writer.getBaseDir();
            if (Files.exists(baseDir)) {
                try (Stream<Path> dirs = Files.list(baseDir)) {
                    List<Path> monthDirs = dirs.filter(Files::isDirectory)
                            .sorted(Comparator.reverseOrder())
                            .collect(Collectors.toList());
                    for (Path monthDir : monthDirs) {
                        try (Stream<Path> files = Files.list(monthDir)) {
                            List<Path> logFiles = files.filter(f -> f.getFileName().toString().endsWith(".jsonl"))
                                    .sorted(Comparator.reverseOrder())
                                    .collect(Collectors.toList());
                            for (Path file : logFiles) {
                                allLogs.addAll(readLogFile(file));
                            }
                        }
                    }
                }
            }
        } catch (IOException e) {
            log.warn("Failed to read exception logs: {}", e.getMessage());
        }
        return allLogs;
    }

    private List<Map<String, Object>> readLogFile(Path file) {
        List<Map<String, Object>> entries = new ArrayList<>();
        try (Stream<String> lines = Files.lines(file)) {
            lines.filter(line -> !line.isBlank()).forEach(line -> {
                try {
                    entries.add(MAPPER.readValue(line, new TypeReference<Map<String, Object>>() {}));
                } catch (IOException ignored) {
                }
            });
        } catch (IOException e) {
            log.warn("Failed to read log file: {}", file, e);
        }
        return entries;
    }
}