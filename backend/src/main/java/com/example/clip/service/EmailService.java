package com.example.clip.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import jakarta.mail.internet.MimeMessage;

/**
 * 邮件发送服务
 * <p>
 * 负责发送整理结果通知、周报通知等 HTML 格式邮件。
 * 使用 Spring Mail 的 {@link JavaMailSender} 发送邮件，支持异步发送以避免阻塞主流程。
 * 邮件功能为可选功能，若未配置邮件服务则静默跳过。
 * </p>
 */
@Service
public class EmailService {

    private static final Logger log = LoggerFactory.getLogger(EmailService.class);

    /**
     * Spring 邮件发送器，required=false 表示邮件服务为可选组件。
     * 若未配置 spring.mail.* 相关属性，此字段为 null。
     */
    @Autowired(required = false)
    private JavaMailSender mailSender;

    /** 发件人邮箱地址，从配置文件 spring.mail.username 读取，默认为空 */
    @Value("${spring.mail.username:}")
    private String mailFrom;

    /** 邮件服务器主机地址，从配置文件 spring.mail.host 读取，用于判断是否已配置邮件 */
    @Value("${spring.mail.host:}")
    private String mailHost;

    /**
     * 检查邮件服务是否已正确配置
     * <p>
     * 需同时满足三个条件：mailSender 不为空、mailHost 已配置、mailFrom 已配置。
     * </p>
     *
     * @return true 表示邮件已配置可用，false 表示未配置
     */
    public boolean isEmailConfigured() {
        return mailSender != null
                && mailHost != null && !mailHost.isEmpty()
                && mailFrom != null && !mailFrom.isEmpty();
    }

    /**
     * 获取发件人邮箱地址
     *
     * @return 发件人邮箱地址字符串
     */
    public String getMailFrom() {
        return mailFrom;
    }

    /**
     * 异步发送整理结果邮件
     * <p>
     * 使用 {@link Async} 注解异步执行，避免阻塞主业务流程。
     * 发送前会检查邮件配置，若未配置则静默跳过。
     * 邮件内容为 HTML 格式，发送给发件人自身（即通知自己）。
     * </p>
     *
     * @param to          收件人邮箱地址（通常与发件人相同）
     * @param subject     邮件主题
     * @param htmlContent HTML 格式的邮件正文
     */
    @Async
    public void sendOrganizeResult(String to, String subject, String htmlContent) {
        if (!isEmailConfigured()) {
            log.info("[Email] Email not configured, skip sending");
            return;
        }

        try {
            // 创建 MIME 消息，支持 HTML 和 UTF-8 编码
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
            helper.setFrom(mailFrom);
            helper.setTo(to);
            helper.setSubject(subject);
            // 第二个参数 true 表示内容是 HTML 格式
            helper.setText(htmlContent, true);
            mailSender.send(message);
            log.info("[Email] Organize result sent to {}", to);
        } catch (Exception e) {
            // 邮件发送失败不影响主流程，仅记录错误日志
            log.error("[Email] Failed to send email: {}", e.getMessage());
        }
    }
}