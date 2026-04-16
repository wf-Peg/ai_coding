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

@Service
public class EmailService {

    private static final Logger log = LoggerFactory.getLogger(EmailService.class);

    @Autowired(required = false)
    private JavaMailSender mailSender;

    @Value("${spring.mail.username:}")
    private String mailFrom;

    @Value("${spring.mail.host:}")
    private String mailHost;

    /**
     * Check if email is properly configured
     */
    public boolean isEmailConfigured() {
        return mailSender != null
                && mailHost != null && !mailHost.isEmpty()
                && mailFrom != null && !mailFrom.isEmpty();
    }

    public String getMailFrom() {
        return mailFrom;
    }

    /**
     * Send organize result email
     * @param to recipient email (same as sender)
     * @param subject email subject
     * @param htmlContent HTML content
     */
    @Async
    public void sendOrganizeResult(String to, String subject, String htmlContent) {
        if (!isEmailConfigured()) {
            log.info("[Email] Email not configured, skip sending");
            return;
        }

        try {
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
            helper.setFrom(mailFrom);
            helper.setTo(to);
            helper.setSubject(subject);
            helper.setText(htmlContent, true);
            mailSender.send(message);
            log.info("[Email] Organize result sent to {}", to);
        } catch (Exception e) {
            log.error("[Email] Failed to send email: {}", e.getMessage());
        }
    }
}
