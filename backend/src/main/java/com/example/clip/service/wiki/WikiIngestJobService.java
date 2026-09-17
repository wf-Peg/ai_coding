package com.example.clip.service.wiki;

import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Wiki 入库异步任务服务（异步外壳）。
 * <p>
 * 入库（ingestBatch）内部包含多次串行 LLM 调用，同步执行会阻塞 HTTP 请求线程，
 * 前端只能干等转圈。本服务把入库提交为后台任务：
 * <ul>
 *   <li>{@link #submit(List, String)} 立即返回 jobId（HTTP 层秒回 202）</li>
 *   <li>单线程 worker（wiki-ingest-worker，daemon）串行执行，天然排队不打架</li>
 *   <li>job 状态机：queued → running → completed / failed，内存保留最近 {@value #MAX_JOBS} 条</li>
 *   <li>{@link #getJob(String)} 供轮询查询进度与最终统计</li>
 * </ul>
 * 后端重启后内存 job 表清空（查询返回 null），对应前端轮询提示任务状态丢失，
 * 文件由 VaultWatchService 的已处理标记机制兜底（未完成的源文件会重新入队）。
 * </p>
 */
@Service
public class WikiIngestJobService {

    private static final Logger log = LoggerFactory.getLogger(WikiIngestJobService.class);

    /** 内存保留的最近 job 数量上限，超出淘汰最旧 */
    private static final int MAX_JOBS = 100;

    private final BatchIngestService batchIngestService;

    /** 单线程执行器：保证同一时刻只有一个入库任务在跑 */
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "wiki-ingest-worker");
        t.setDaemon(true);
        return t;
    });

    /** jobId → job 状态 */
    private final Map<String, IngestJob> jobs = new ConcurrentHashMap<>();

    /** jobId 提交顺序队列（用于淘汰最旧） */
    private final ConcurrentLinkedDeque<String> jobOrder = new ConcurrentLinkedDeque<>();

    /**
     * 构造器注入。
     *
     * @param batchIngestService 批量入库服务
     */
    public WikiIngestJobService(BatchIngestService batchIngestService) {
        this.batchIngestService = batchIngestService;
    }

    /**
     * 提交一个入库任务，立即返回 jobId。
     *
     * @param files  待入库的源文件列表
     * @param source 触发来源描述（manual-trigger / trigger-batch / quick）
     * @return jobId（8 位短 UUID）
     */
    public String submit(List<Path> files, String source) {
        String jobId = UUID.randomUUID().toString().substring(0, 8);
        IngestJob job = new IngestJob(jobId, source, files.size());
        jobs.put(jobId, job);
        jobOrder.addLast(jobId);
        // 淘汰最旧 job，控制内存占用
        while (jobOrder.size() > MAX_JOBS) {
            String oldest = jobOrder.pollFirst();
            if (oldest != null) {
                jobs.remove(oldest);
            }
        }
        worker.execute(() -> runJob(job, files));
        log.info("[Wiki] Ingest job {} submitted ({}) with {} file(s)", jobId, source, files.size());
        return jobId;
    }

    /**
     * 查询 job 状态视图。
     *
     * @param jobId job ID
     * @return 状态 Map（jobId/status/source/fileCount/时间戳/stats/error）；不存在返回 null
     */
    public Map<String, Object> getJob(String jobId) {
        IngestJob job = jobs.get(jobId);
        if (job == null) {
            return null;
        }
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("jobId", job.jobId);
        view.put("status", job.status);
        view.put("source", job.source);
        view.put("fileCount", job.fileCount);
        view.put("submittedAt", job.submittedAt);
        view.put("startedAt", job.startedAt);
        view.put("finishedAt", job.finishedAt);
        view.put("stats", job.stats);
        view.put("error", job.error);
        return view;
    }

    /**
     * 后台执行入库：更新状态机并记录耗时。
     */
    private void runJob(IngestJob job, List<Path> files) {
        job.status = "running";
        job.startedAt = System.currentTimeMillis();
        log.info("[Wiki] Ingest job {} started, {} file(s)", job.jobId, job.fileCount);
        try {
            Map<String, Object> stats = batchIngestService.ingestBatch(files);
            job.stats = stats;
            job.status = "completed";
        } catch (Exception e) {
            job.status = "failed";
            job.error = e.getMessage();
            log.error("[Wiki] Ingest job {} failed: {}", job.jobId, e.getMessage(), e);
        }
        job.finishedAt = System.currentTimeMillis();
        log.info("[Wiki] Ingest job {} finished with status {} in {}ms",
                job.jobId, job.status, job.finishedAt - job.startedAt);
    }

    /**
     * 容器销毁时关闭 worker，避免线程泄漏。
     */
    @PreDestroy
    public void destroy() {
        worker.shutdown();
        log.info("[Wiki] Ingest job worker shut down");
    }

    /**
     * 单个入库任务的状态载体。
     * <p>
     * 除不变字段（jobId/source/fileCount/submittedAt）外均 volatile，
     * 保证 worker 线程写入后查询线程立即可见。
     * </p>
     */
    private static class IngestJob {
        final String jobId;
        final String source;
        final int fileCount;
        final long submittedAt = System.currentTimeMillis();
        volatile String status = "queued";
        volatile long startedAt = 0;
        volatile long finishedAt = 0;
        volatile Map<String, Object> stats = null;
        volatile String error = null;

        IngestJob(String jobId, String source, int fileCount) {
            this.jobId = jobId;
            this.source = source;
            this.fileCount = fileCount;
        }
    }
}