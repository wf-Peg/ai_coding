package com.example.clip.service;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.springframework.http.HttpHeaders;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import reactor.netty.http.client.HttpClient;
import reactor.netty.transport.ProxyProvider;

import java.net.InetSocketAddress;
import java.time.Duration;

@Service
public class LinkParseService {
    private final WebClient webClient;
    // 1. 创建支持重定向的 HttpClient
    HttpClient httpClient = HttpClient.create().followRedirect(true);


    public LinkParseService() {
        // 2. 将其注入到 WebClient 中
        this.webClient = WebClient.builder()
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .build();
    }

    /**
     * 爬取URL并提取网页正文文本
     *
     * @param url 网页链接
     * @return 提取的纯文本内容
     */
    public String parseUrl(String url) {
        // 1. 先尝试无代理请求（带上完整 Headers）
        String html = tryRequest(url, false);

        // 2. 如果失败（超时或内容为空），尝试走代理
        if (html == null || html.contains("系统找不到该页") || html.contains("403 Forbidden")) {
            System.out.println("[LinkParse] 直连失败或触发风控，尝试使用 Clash 代理...");
            html = tryRequest(url, true);
        }

        // 3. 处理结果
        if (html == null || html.isEmpty()) {
            return "[链接解析失败] 无法获取网页内容，请检查链接是否正确。";
        }
        return extractText(html);
    }


    /**
     * 核心请求方法
     *
     * @param url      目标网址
     * @param useProxy 是否使用代理
     */
    private String tryRequest(String url, boolean useProxy) {
        WebClient webClient;

        // --- 配置 WebClient ---
        if (useProxy) {
            // 配置代理的 HttpClient
            HttpClient httpClient = HttpClient.create()
                    .proxy(proxy -> proxy
                            .type(ProxyProvider.Proxy.HTTP)
                            .address(InetSocketAddress.createUnresolved("127.0.0.1", 7890)) // 确保 Clash 端口是 7890
                    )
                    .followRedirect(true); // 代理模式下开启重定向

            webClient = WebClient.builder()
                    .clientConnector(new ReactorClientHttpConnector(httpClient))
                    .codecs(configurer -> configurer.defaultCodecs().maxInMemorySize(2 * 1024 * 1024)) // 增加缓冲区防止大页面报错
                    .build();
        } else {
            // 无代理模式
            webClient = WebClient.builder()
                    .codecs(configurer -> configurer.defaultCodecs().maxInMemorySize(2 * 1024 * 1024))
                    .build();
        }

        // 2. 执行请求
        try {
            return webClient.get()
                    .uri(url)
                    // --- 核心修改：注入更真实的浏览器指纹 ---
                    .headers(headers -> {
                        // 1. User-Agent：模拟最新的 Chrome 浏览器
                        headers.set(HttpHeaders.USER_AGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36");

                        // 2. Referer：伪装成从微信或百度搜索进来的，这对微信文章很重要
                        if (url.contains("mp.weixin.qq.com")) {
                            headers.set(HttpHeaders.REFERER, "https://mp.weixin.qq.com/");
                        } else {
                            headers.set(HttpHeaders.REFERER, "https://www.google.com/");
                        }

                        // 3. Accept-Language：模拟中文环境
                        headers.set(HttpHeaders.ACCEPT_LANGUAGE, "zh-CN,zh;q=0.9,en;q=0.8");

                        // 4. Accept：告诉服务器我们支持压缩
                        headers.set(HttpHeaders.ACCEPT, "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8");
                        headers.set(HttpHeaders.ACCEPT_ENCODING, "gzip, deflate, br");
                    })
                    .retrieve()
                    .bodyToMono(String.class)
                    .timeout(Duration.ofSeconds(15)) // 15秒超时
                    .onErrorResume(e -> {
                        // 捕获超时或连接错误
                        System.err.println("[LinkParse] 请求异常: " + e.getMessage());
                        return Mono.empty();
                    })
                    .block(); // 阻塞等待结果

        } catch (Exception e) {
            System.err.println("[LinkParse] 发生未知错误: " + e.getMessage());
            return null;
        }
    }

    /**
     * 从HTML中提取正文文本
     */
    private String extractText(String html) {
        Document doc = Jsoup.parse(html);

        // Remove non-content tags
        doc.select("script, style, nav, header, footer, aside, iframe, noscript, .ad, .advertisement, .sidebar, .comment, .comments, .footer, .header, .nav, .menu").remove();

        // Try to find main content area
        String text;
        if (!doc.select("article").isEmpty()) {
            text = doc.select("article").first().text();
        } else if (!doc.select("main").isEmpty()) {
            text = doc.select("main").first().text();
        } else if (!doc.select("[role=main]").isEmpty()) {
            text = doc.select("[role=main]").first().text();
        } else if (!doc.select(".content, .article, .post, .entry, #content, #article").isEmpty()) {
            text = doc.select(".content, .article, .post, .entry, #content, #article").first().text();
        } else {
            text = doc.body().text();
        }

        // Clean up whitespace
        text = text.replaceAll("\\s+", " ").trim();

        // Truncate if too long (limit to ~50000 chars for AI processing)
        if (text.length() > 50000) {
            text = text.substring(0, 50000) + "\n\n[内容过长，已截断]";
        }

        return text;
    }
}
