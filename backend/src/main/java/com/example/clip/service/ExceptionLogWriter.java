package com.example.clip.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedWriter;
import java.io.IOException;
import java.io.StringWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 异常日志文件写入器
 * <p>
 * 将异常日志以 JSON Lines 格式写入 {@code {storagePath}/tmp/exception-logs/YYYY-MM/exception-YYYY-MM-dd.jsonl}。
 * 按天切分文件，按月归档目录，线程安全。
 * </p>
 */
public class ExceptionLogWriter {

    private static final Logger log = LoggerFactory.getLogger(ExceptionLogWriter.class);
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd");
    private static final DateTimeFormatter TS_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSS");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final Path baseDir;
    private final AtomicLong idCounter = new AtomicLong(1);
    private volatile LocalDate currentDate = null;
    private volatile Path currentFile = null;

    /**
     * @param storagePath 文件存储根路径（clip.storage.path）
     */
    public ExceptionLogWriter(String storagePath) {
        this.baseDir = Paths.get(storagePath, "tmp", "exception-logs");
        initDir();
    }

    private void initDir() {
        try {
            Files.createDirectories(baseDir);
        } catch (IOException e) {
            log.error("Failed to create exception log directory: {}", baseDir, e);
        }
    }

    /**
     * 写入一条异常日志
     *
     * @param source      异常来源（backend / electron / frontend）
     * @param sourceDetail 来源详细信息（类名.方法名）
     * @param message     异常消息
     * @param stackTrace  完整堆栈（可选）
     * @param level       日志级别（ERROR / WARN）
     * @param thread      线程名称（可选）
     * @param requestUri  请求路径（可选，仅后端）
     */
    public void write(String source, String sourceDetail, String message,
                      String stackTrace, String level, String thread, String requestUri) {
        try {
            Map<String, Object> entry = new LinkedHashMap<>();
            LocalDateTime now = LocalDateTime.now();
            LocalDate today = now.toLocalDate();

            entry.put("id", "err_" + today.format(DateTimeFormatter.ofPattern("yyyyMMdd")) + "_"
                    + String.format("%04d", idCounter.getAndIncrement()));
            entry.put("timestamp", now.format(TS_FMT));
            entry.put("level", level != null ? level : "ERROR");
            entry.put("source", source != null ? source : "unknown");
            entry.put("sourceDetail", sourceDetail != null ? sourceDetail : "");
            entry.put("message", message != null ? message : "");
            if (stackTrace != null && !stackTrace.isEmpty()) {
                entry.put("stackTrace", stackTrace);
            }
            if (thread != null && !thread.isEmpty()) {
                entry.put("thread", thread);
            }
            if (requestUri != null && !requestUri.isEmpty()) {
                entry.put("requestUri", requestUri);
            }

            String jsonLine = MAPPER.writeValueAsString(entry);
            Path file = getFile(today);
            Files.writeString(file, jsonLine + "\n", StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException e) {
            log.error("Failed to write exception log", e);
        }
    }

    /**
     * 从 Throwable 提取 stackTrace 字符串
     */
    public static String extractStackTrace(Throwable throwable) {
        if (throwable == null) return "";
        StringWriter sw = new StringWriter();
        java.io.PrintWriter pw = new java.io.PrintWriter(sw);
        throwable.printStackTrace(pw);
        pw.flush();
        return sw.toString();
    }

    /**
     * 从 Throwable 提取 sourceDetail（类名.方法名）
     */
    public static String extractSourceDetail(Throwable throwable) {
        if (throwable == null) return "";
        StackTraceElement[] stack = throwable.getStackTrace();
        if (stack.length > 0) {
            StackTraceElement top = stack[0];
            return top.getClassName() + "." + top.getMethodName() + "(" + top.getFileName() + ":" + top.getLineNumber() + ")";
        }
        return "";
    }

    private Path getFile(LocalDate date) {
        if (!date.equals(currentDate)) {
            synchronized (this) {
                if (!date.equals(currentDate)) {
                    String monthDir = date.format(DateTimeFormatter.ofPattern("yyyy-MM"));
                    Path dir = baseDir.resolve(monthDir);
                    try {
                        Files.createDirectories(dir);
                    } catch (IOException e) {
                        log.error("Failed to create month dir: {}", dir, e);
                    }
                    currentDate = date;
                    currentFile = dir.resolve("exception-" + date.format(DATE_FMT) + ".jsonl");
                }
            }
        }
        return currentFile;
    }

    /**
     * 获取异常日志目录路径
     */
    public Path getBaseDir() {
        return baseDir;
    }

    /**
     * 获取指定日期的日志文件路径
     */
    public Path getLogFile(LocalDate date) {
        String monthDir = date.format(DateTimeFormatter.ofPattern("yyyy-MM"));
        return baseDir.resolve(monthDir).resolve("exception-" + date.format(DATE_FMT) + ".jsonl");
    }
}