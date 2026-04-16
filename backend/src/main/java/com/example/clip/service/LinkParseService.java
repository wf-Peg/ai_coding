package com.example.clip.service;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import reactor.netty.http.client.HttpClient;
import reactor.netty.transport.ProxyProvider;

import java.net.InetSocketAddress;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class LinkParseService {

    private static final Logger log = LoggerFactory.getLogger(LinkParseService.class);

    private final WebClient webClient;
    HttpClient httpClient = HttpClient.create().followRedirect(true);

    public LinkParseService() {
        this.webClient = WebClient.builder()
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .codecs(configurer -> configurer.defaultCodecs().maxInMemorySize(4 * 1024 * 1024))
                .build();
    }

    /**
     * 爬取URL并提取网页正文文本
     */
    public String parseUrl(String url) {
        // Normalize URL
        url = normalizeUrl(url);

        // 1. Try direct connection first
        String html = tryRequest(url, false);

        // 2. If failed (timeout, empty, or blocked), try proxy
        if (html == null || html.isEmpty() || html.contains("系统找不到该页") || html.contains("403 Forbidden") || html.contains("Access Denied")) {
            log.info("[LinkParse] Direct failed, trying proxy...");
            html = tryRequest(url, true);
        }

        // 3. If still failed, try with www prefix
        if ((html == null || html.isEmpty()) && !url.contains("://www.")) {
            String wwwUrl = url.replace("://", "://www.");
            log.info("[LinkParse] Trying www prefix: {}", wwwUrl);
            html = tryRequest(wwwUrl, false);
            if (html == null || html.isEmpty()) {
                html = tryRequest(wwwUrl, true);
            }
        }

        // 4. If still failed, try https
        if ((html == null || html.isEmpty()) && url.startsWith("http://")) {
            String httpsUrl = url.replace("http://", "https://");
            log.info("[LinkParse] Trying HTTPS: {}", httpsUrl);
            html = tryRequest(httpsUrl, false);
            if (html == null || html.isEmpty()) {
                html = tryRequest(httpsUrl, true);
            }
        }

        if (html == null || html.isEmpty()) {
            return "[链接解析失败] 无法获取网页内容，请检查链接是否正确。";
        }
        return extractText(html);
    }

    /**
     * Normalize URL: ensure protocol, trim whitespace
     */
    private String normalizeUrl(String url) {
        url = url.trim();
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "https://" + url;
        }
        return url;
    }

    /**
     * Core request method
     */
    private String tryRequest(String url, boolean useProxy) {
        WebClient client;

        if (useProxy) {
            HttpClient proxyHttpClient = HttpClient.create()
                    .proxy(proxy -> proxy
                            .type(ProxyProvider.Proxy.HTTP)
                            .address(InetSocketAddress.createUnresolved("127.0.0.1", 7890))
                    )
                    .followRedirect(true)
                    .responseTimeout(Duration.ofSeconds(15));

            client = WebClient.builder()
                    .clientConnector(new ReactorClientHttpConnector(proxyHttpClient))
                    .codecs(configurer -> configurer.defaultCodecs().maxInMemorySize(4 * 1024 * 1024))
                    .build();
        } else {
            client = WebClient.builder()
                    .codecs(configurer -> configurer.defaultCodecs().maxInMemorySize(4 * 1024 * 1024))
                    .build();
        }

        try {
            return client.get()
                    .uri(url)
                    .headers(headers -> {
                        // User-Agent: simulate latest Chrome
                        headers.set(HttpHeaders.USER_AGENT,
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36");

                        // Referer: important for WeChat articles
                        if (url.contains("mp.weixin.qq.com")) {
                            headers.set(HttpHeaders.REFERER, "https://mp.weixin.qq.com/");
                        } else if (url.contains("zhihu.com")) {
                            headers.set(HttpHeaders.REFERER, "https://www.zhihu.com/");
                        } else if (url.contains("csdn.net")) {
                            headers.set(HttpHeaders.REFERER, "https://www.csdn.net/");
                        } else if (url.contains("juejin.cn")) {
                            headers.set(HttpHeaders.REFERER, "https://juejin.cn/");
                        } else if (url.contains("bilibili.com")) {
                            headers.set(HttpHeaders.REFERER, "https://www.bilibili.com/");
                        } else {
                            headers.set(HttpHeaders.REFERER, "https://www.google.com/");
                        }

                        // Accept-Language: Chinese environment
                        headers.set(HttpHeaders.ACCEPT_LANGUAGE, "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7");

                        // Accept: tell server we support compressed content
                        headers.set(HttpHeaders.ACCEPT,
                                "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8");
                        headers.set(HttpHeaders.ACCEPT_ENCODING, "gzip, deflate, br");

                        // Connection
                        headers.set(HttpHeaders.CONNECTION, "keep-alive");

                        // Cache-Control
                        headers.set(HttpHeaders.CACHE_CONTROL, "max-age=0");

                        // Sec-Fetch headers for modern browser simulation
                        headers.set("Sec-Fetch-Dest", "document");
                        headers.set("Sec-Fetch-Mode", "navigate");
                        headers.set("Sec-Fetch-Site", "none");
                        headers.set("Sec-Fetch-User", "?1");
                        headers.set("Upgrade-Insecure-Requests", "1");
                    })
                    .retrieve()
                    .bodyToMono(byte[].class)
                    .timeout(Duration.ofSeconds(15))
                    .map(bytes -> detectAndDecode(bytes, url))
                    .onErrorResume(e -> {
                        log.error("[LinkParse] Request error: {}", e.getMessage());
                        return Mono.empty();
                    })
                    .block();

        } catch (Exception e) {
            log.error("[LinkParse] Unknown error: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Detect charset from HTML content and decode bytes to String
     * Ensures Chinese and other multi-byte characters are not garbled
     */
    private String detectAndDecode(byte[] bytes, String url) {
        // 1. Try to detect charset from HTML meta tag
        Charset detectedCharset = detectCharsetFromBytes(bytes);

        // 2. Fallback: try common Chinese charsets
        if (detectedCharset == null) {
            // Try UTF-8 first (most modern sites)
            String utf8 = new String(bytes, StandardCharsets.UTF_8);
            if (!containsGarbledText(utf8)) {
                return utf8;
            }

            // Try GBK (common for older Chinese sites)
            try {
                String gbk = new String(bytes, Charset.forName("GBK"));
                if (!containsGarbledText(gbk)) {
                    return gbk;
                }
            } catch (Exception ignored) {}

            // Try GB2312
            try {
                String gb2312 = new String(bytes, Charset.forName("GB2312"));
                if (!containsGarbledText(gb2312)) {
                    return gb2312;
                }
            } catch (Exception ignored) {}

            // Try Big5 (Traditional Chinese)
            try {
                String big5 = new String(bytes, Charset.forName("Big5"));
                if (!containsGarbledText(big5)) {
                    return big5;
                }
            } catch (Exception ignored) {}

            // Final fallback: UTF-8
            return utf8;
        }

        return new String(bytes, detectedCharset);
    }

    /**
     * Detect charset from HTML meta tags
     */
    private Charset detectCharsetFromBytes(byte[] bytes) {
        // Only check first 4096 bytes for meta tags
        int limit = Math.min(bytes.length, 4096);
        String head = new String(bytes, 0, limit, StandardCharsets.ISO_8859_1);

        // Pattern 1: <meta charset="xxx">
        Pattern charsetPattern = Pattern.compile("<meta[^>]+charset\\s*=\\s*[\"']?([^\"'\\s>]+)", Pattern.CASE_INSENSITIVE);
        Matcher matcher = charsetPattern.matcher(head);
        if (matcher.find()) {
            String charsetName = matcher.group(1).trim();
            try {
                return Charset.forName(charsetName);
            } catch (Exception ignored) {}
        }

        // Pattern 2: <meta http-equiv="Content-Type" content="text/html; charset=xxx">
        Pattern httpEquivPattern = Pattern.compile("content\\s*=\\s*[\"'][^\"']*charset=([^\"'\\s;]+)", Pattern.CASE_INSENSITIVE);
        matcher = httpEquivPattern.matcher(head);
        if (matcher.find()) {
            String charsetName = matcher.group(1).trim();
            try {
                return Charset.forName(charsetName);
            } catch (Exception ignored) {}
        }

        return null;
    }

    /**
     * Check if text contains garbled characters (mojibake detection)
     */
    private boolean containsGarbledText(String text) {
        // Common garbled character patterns
        String sample = text.substring(0, Math.min(text.length(), 500));
        // Count replacement characters (U+FFFD)
        int replacementCount = 0;
        for (int i = 0; i < sample.length(); i++) {
            if (sample.charAt(i) == '\uFFFD') {
                replacementCount++;
            }
        }
        // If more than 3 replacement chars in first 500 chars, likely garbled
        if (replacementCount > 3) {
            return true;
        }
        return false;
    }

    /**
     * Extract main text content from HTML
     */
    private String extractText(String html) {
        Document doc = Jsoup.parse(html);

        // Remove non-content elements
        doc.select("script, style, nav, header, footer, aside, iframe, noscript, "
                + ".ad, .advertisement, .sidebar, .comment, .comments, .footer, .header, .nav, .menu, "
                + ".social-share, .share-bar, .related-posts, .recommend, .breadcrumb, "
                + ".pagination, .copyright, .modal, .popup, .toast, .notification, "
                + "[class*=ad-], [class*=sponsor], [id*=ad-], [id*=sponsor]").remove();

        // Try to find main content area (priority order)
        String text = null;

        // WeChat article specific
        if (!doc.select("#js_content").isEmpty()) {
            text = doc.select("#js_content").first().text();
        }
        // Zhihu article
        else if (!doc.select(".RichText.ztext.Post-RichTextContainer").isEmpty()) {
            text = doc.select(".RichText.ztext.Post-RichTextContainer").first().text();
        }
        // CSDN article
        else if (!doc.select("#article_content").isEmpty()) {
            text = doc.select("#article_content").first().text();
        }
        // Juejin article
        else if (!doc.select(".article-content").isEmpty()) {
            text = doc.select(".article-content").first().text();
        }
        // Bilibili article
        else if (!doc.select(".article-holder").isEmpty()) {
            text = doc.select(".article-holder").first().text();
        }
        // Generic: article tag
        else if (!doc.select("article").isEmpty()) {
            text = doc.select("article").first().text();
        }
        // Generic: main tag
        else if (!doc.select("main").isEmpty()) {
            text = doc.select("main").first().text();
        }
        // Generic: role=main
        else if (!doc.select("[role=main]").isEmpty()) {
            text = doc.select("[role=main]").first().text();
        }
        // Generic: common content class/id patterns
        else if (!doc.select(".content, .article, .post, .entry, #content, #article, .post-content, .article-body, .story-body").isEmpty()) {
            text = doc.select(".content, .article, .post, .entry, #content, #article, .post-content, .article-body, .story-body").first().text();
        }

        // Fallback: body text
        if (text == null || text.isEmpty()) {
            text = doc.body().text();
        }

        // Clean up whitespace but preserve paragraph structure
        text = text.replaceAll("[ \\t]+", " ")     // collapse spaces/tabs
                   .replaceAll("\\n\\s*\\n+", "\n\n") // collapse multiple newlines
                   .trim();

        // Truncate if too long
        if (text.length() > 50000) {
            text = text.substring(0, 50000) + "\n\n[内容过长，已截断]";
        }

        return text;
    }
}
