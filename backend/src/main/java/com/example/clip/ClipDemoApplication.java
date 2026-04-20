package com.example.clip;

/**
 * 应用主类
 * 启动Spring Boot应用，启用异步处理和定时任务
 */

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 应用主类
 * 启动Spring Boot应用，启用异步处理和定时任务
 */
@SpringBootApplication
@EnableAsync  // 启用异步处理
@EnableScheduling  // 启用定时任务
public class ClipDemoApplication {

    /**
     * 应用入口方法
     * @param args 命令行参数
     */
    public static void main(String[] args) {
        SpringApplication.run(ClipDemoApplication.class, args);
    }

}