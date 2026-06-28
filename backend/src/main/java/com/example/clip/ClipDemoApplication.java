package com.example.clip;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * CLIP 应用主启动类。
 * <p>
 * 基于 Spring Boot 框架的内容收集与智能整理应用（CLIP = Content Library & Intelligent Processing）。
 * 核心功能：
 * <ul>
 *   <li>碎片内容的快速收集与存储</li>
 *   <li>基于 AI 的内容摘要、分析、标签生成和分类</li>
 *   <li>定时自动整理每日内容并归档到知识库</li>
 *   <li>支持多 LLM 提供者（DashScope / DeepSeek）热切换</li>
 * </ul>
 * </p>
 *
 * <h3>关键注解说明</h3>
 * <ul>
 *   <li>{@code @SpringBootApplication}：组合注解，包含
 *       {@code @Configuration}、{@code @EnableAutoConfiguration}、
 *       {@code @ComponentScan}，启用 Spring Boot 自动配置和组件扫描</li>
 *   <li>{@code @EnableAsync}：启用 Spring 的异步方法执行能力，
 *       允许使用 {@code @Async} 注解将方法标记为异步执行</li>
 *   <li>{@code @EnableScheduling}：启用 Spring 的定时任务调度能力，
 *       允许使用 {@code @Scheduled} 注解定义定时任务</li>
 * </ul>
 *
 * <p>
 * 启动方式：运行 {@code main} 方法，或通过 {@code java -jar} 命令启动打包后的 jar 文件。
 * </p>
 */
@SpringBootApplication
@EnableAsync       // 启用 @Async 异步方法支持，用于提升 AI 调用等耗时操作的响应性能
@EnableScheduling  // 启用 @Scheduled 定时任务支持，用于每日自动内容整理
public class ClipDemoApplication {

    /**
     * 应用入口方法。
     * <p>
     * 调用 {@link SpringApplication#run(Class, String...)} 启动 Spring Boot 应用，
     * 该方法会：
     * <ol>
     *   <li>创建 Spring 应用上下文（ApplicationContext）</li>
     *   <li>触发自动配置（AutoConfiguration）</li>
     *   <li>扫描并注册所有 Bean（ComponentScan）</li>
     *   <li>启动内嵌 Web 服务器（默认 Tomcat）</li>
     *   <li>初始化定时任务调度器</li>
     * </ol>
     * </p>
     *
     * @param args 命令行参数，传递给 Spring Boot 应用
     */
    public static void main(String[] args) {
        SpringApplication.run(ClipDemoApplication.class, args);
    }

}