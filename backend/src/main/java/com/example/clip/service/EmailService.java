package com.example.clip.service;

import com.example.clip.config.AppConfig;
import jakarta.mail.internet.MimeMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.Properties;

/**
 * 邮件发送服务
 * <p>
 * 负责发送整理结果通知、周报通知等 HTML 格式邮件。
 * 邮件配置从 {@link AppConfigService} 动态读取，支持运行时修改无需重启。
 * 邮件功能为可选功能，若未配置邮件服务则静默跳过。
 * </p>
 */
@Service
public class EmailService {

    private static final Logger log = LoggerFactory.getLogger(EmailService.class);

    private final AppConfigService appConfigService;

    /** 动态创建的邮件发送器，每次配置变更时重建 */
    private volatile JavaMailSenderImpl mailSender;

    public EmailService(AppConfigService appConfigService) {
        this.appConfigService = appConfigService;
    }

    /**
     * 检查邮件服务是否已正确配置
     *
     * @return true 表示邮件已配置可用
     */
    public boolean isEmailConfigured() {
        return ensureConfigured();
    }

    /**
     * 检查邮件服务是否已正确配置并创建 sender
     *
     * @return true 表示邮件已配置可用
     */
    private boolean ensureConfigured() {
        AppConfig config = appConfigService.getConfig();
        if (!config.isMailEnabled()) return false;
        if (config.getMailHost() == null || config.getMailHost().isEmpty()) return false;
        if (config.getMailUsername() == null || config.getMailUsername().isEmpty()) return false;

        // 如果 sender 未创建或配置已变更，重新创建
        if (mailSender == null || hasConfigChanged(config)) {
            synchronized (this) {
                if (mailSender == null || hasConfigChanged(config)) {
                    createMailSender(config);
                }
            }
        }
        return mailSender != null;
    }

    /**
     * 检查配置是否发生变更（简单比较 host/port/username）
     */
    private boolean hasConfigChanged(AppConfig config) {
        return !config.getMailHost().equals(mailSender.getHost())
                || config.getMailPort() != mailSender.getPort()
                || !config.getMailUsername().equals(mailSender.getUsername());
    }

    /**
     * 根据配置动态创建 JavaMailSenderImpl
     */
    private void createMailSender(AppConfig config) {
        log.info("Creating mail sender for {}:{}", config.getMailHost(), config.getMailPort());
        JavaMailSenderImpl sender = new JavaMailSenderImpl();
        sender.setHost(config.getMailHost());
        sender.setPort(config.getMailPort());
        sender.setUsername(config.getMailUsername());
        sender.setPassword(config.getMailPassword());

        Properties props = sender.getJavaMailProperties();
        props.put("mail.transport.protocol", "smtp");
        props.put("mail.smtp.auth", "true");
        if (config.getMailPort() == 465) {
            props.put("mail.smtp.ssl.enable", "true");
        } else {
            props.put("mail.smtp.starttls.enable", "true");
        }
        props.put("mail.smtp.connectiontimeout", "10000");
        props.put("mail.smtp.timeout", "10000");

        this.mailSender = sender;
    }

    /**
     * 获取发件人邮箱地址
     *
     * @return 发件人邮箱地址字符串
     */
    public String getMailFrom() {
        AppConfig config = appConfigService.getConfig();
        return config.getMailUsername();
    }

    /**
     * 异步发送整理结果邮件
     * <p>
     * 使用 {@link Async} 注解异步执行，避免阻塞主业务流程。
     * 发送前会检查邮件配置，若未配置则静默跳过。
     * </p>
     *
     * @param to          收件人邮箱地址
     * @param subject     邮件主题
     * @param htmlContent HTML 格式的邮件正文
     */
    @Async
    public void sendOrganizeResult(String to, String subject, String htmlContent) {
        if (!ensureConfigured()) {
            log.debug("[Email] Email not configured, skip sending");
            return;
        }

        try {
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
            helper.setFrom(getMailFrom());
            helper.setTo(to);
            helper.setSubject(subject);
            helper.setText(htmlContent, true);
            mailSender.send(message);
            log.info("[Email] Organize result sent to {}", to);
        } catch (Exception e) {
            log.error("[Email] Failed to send email: {}", e.getMessage());
        }
    }

    /**
     * 测试邮件连接
     * <p>
     * 使用给定的配置发送测试邮件到自身，验证 SMTP 配置是否正确。
     * </p>
     *
     * @param host     SMTP 服务器
     * @param port     SMTP 端口
     * @param username 发件邮箱
     * @param password SMTP 授权码
     * @return 测试结果消息
     */
    public String testConnection(String host, int port, String username, String password) {
        JavaMailSenderImpl testSender = new JavaMailSenderImpl();
        testSender.setHost(host);
        testSender.setPort(port);
        testSender.setUsername(username);
        testSender.setPassword(password);

        Properties props = testSender.getJavaMailProperties();
        props.put("mail.transport.protocol", "smtp");
        props.put("mail.smtp.auth", "true");
        if (port == 465) {
            props.put("mail.smtp.ssl.enable", "true");
        } else {
            props.put("mail.smtp.starttls.enable", "true");
        }
        props.put("mail.smtp.connectiontimeout", "5000");
        props.put("mail.smtp.timeout", "5000");

        try {
            testSender.testConnection();
            return "连接测试成功";
        } catch (Exception e) {
            throw new RuntimeException("连接测试失败: " + e.getMessage());
        }
    }
}