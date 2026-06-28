package com.example.clip.core;

import com.example.clip.service.ContentOrganizeService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 定时任务调度组件。
 * <p>
 * 使用 Spring 的 {@link Scheduled} 注解实现定时任务调度。
 * 当前包含一个每日内容整理任务，自动将当天收集的碎片内容
 * 整理为结构化知识并存入知识库。
 * </p>
 *
 * <h3>任务说明</h3>
 * <ul>
 *   <li><b>每日内容整理</b>：每天 17:20 自动执行，调用 {@link ContentOrganizeService#organizeContent()}
 *       对当天收集的内容进行 AI 整理、分类和归档</li>
 * </ul>
 *
 * <p>
 * 定时任务功能需要主类上标注 {@code @EnableScheduling} 才能生效。
 * 参见 {@link com.example.clip.ClipDemoApplication}。
 * </p>
 *
 * <p>
 * 注意：Spring 的定时任务默认使用单线程执行，如果任务执行时间较长，
 * 可能会影响其他定时任务的准时执行。如果未来需要添加更多定时任务，
 * 建议配置自定义线程池。
 * </p>
 */
@Component
public class ScheduledTasks {

    private static final Logger log = LoggerFactory.getLogger(ScheduledTasks.class);

    /** 内容整理服务，负责具体的整理逻辑 */
    private final ContentOrganizeService contentOrganizeService;

    /**
     * 构造器注入内容整理服务。
     *
     * @param contentOrganizeService 内容整理服务实例，由 Spring 自动注入
     */
    @Autowired
    public ScheduledTasks(ContentOrganizeService contentOrganizeService) {
        this.contentOrganizeService = contentOrganizeService;
    }

    /**
     * 每日内容整理定时任务。
     * <p>
     * Cron 表达式 {@code "0 20 17 * * ?"} 表示每天 17:20:00 执行。
     * 选择这个时间点是为了在一天工作即将结束时自动整理当天的碎片内容。
     * </p>
     *
     * <p>
     * Cron 字段说明（从左到右）：
     * <ul>
     *   <li>秒：0（在第 0 秒触发）</li>
     *   <li>分：20（在第 20 分钟触发）</li>
     *   <li>时：17（下午 5 点）</li>
     *   <li>日：*（每天）</li>
     *   <li>月：*（每月）</li>
     *   <li>星期：?（不指定，与"日"字段互斥）</li>
     * </ul>
     * </p>
     */
    @Scheduled(cron = "0 20 17 * * ?")
    public void dailyContentOrganize() {
        log.info("开始执行每日内容整理任务...");
        // 调用整理服务执行实际的内容整理逻辑
        contentOrganizeService.organizeContent();
        log.info("每日内容整理任务执行完成");
    }
}