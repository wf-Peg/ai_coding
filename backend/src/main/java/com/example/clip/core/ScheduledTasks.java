package com.example.clip.core;

import com.example.clip.service.ContentOrganizeService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 定时任务类
 * 执行定时的内容整理任务
 */
@Component
public class ScheduledTasks {

    /**
     * 内容整理服务
     */
    private final ContentOrganizeService contentOrganizeService;

    /**
     * 构造函数
     * @param contentOrganizeService 内容整理服务
     */
    @Autowired
    public ScheduledTasks(ContentOrganizeService contentOrganizeService) {
        this.contentOrganizeService = contentOrganizeService;
    }

    /**
     * 每日内容整理任务
     * 每天17:20执行
     */
    @Scheduled(cron = "0 20 17 * * ?")
    public void dailyContentOrganize() {
        System.out.println("开始执行每日内容整理任务...");
        contentOrganizeService.organizeContent();
        System.out.println("每日内容整理任务执行完成");
    }
}
