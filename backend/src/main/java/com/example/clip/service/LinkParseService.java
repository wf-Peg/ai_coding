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

/**
 * 链接解析服务
 * <p>
 * 负责爬取网页 URL 并提取正文内容。采用多级重试策略：
 * <ol>
 *   <li>直接连接获取 HTML</li>
 *   <li>失败后通过代理重试（127.0.0.1:7890）</li>
 *   <li>尝试添加 www 前缀</li>
 *   <li>尝试 HTTP → HTTPS 升级</li>
 *   <li>每级代理都有直连+代理两种尝试</li>
 * </ol>
 * 使用 Jsoup 解析 HTML，优先识别特定网站（微信公众号、知乎、CSDN 等）的内容区域，
 * 最终回退到 body 文本。支持自动检测网页编码（UTF-8/GBK/GB2312/Big5），
 * 避免中文乱码。结果限制 50000 字符。
 * </p>
 */
@Service
public class LinkParseService {

    private static final Logger log = LoggerFactory.getLogger(LinkParseService.class);

    /** 默认 WebClient，支持自动跟随重定向 */
    private final WebClient webClient;
    /** 可复用的 HttpClient 配置，跟随重定向 */
    HttpClient httpClient = HttpClient.create().followRedirect(true);

    /** 代理主机地址 */
    private static final String PROXY_HOST = "127.0.0.1";
    /** 代理端口 */
    private static final int PROXY_PORT = 7890;
    /** 请求超时时间 */
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(15);
    /** 解析总超时上限：所有重试累计不超过该时长，防止请求线程被长时间占用 */
    private static final Duration TOTAL_TIMEOUT = Duration.ofSeconds(30);
    /** 内存中最大响应大小 4MB */
    private static final int MAX_IN_MEMORY_SIZE = 4 * 1024 * 1024;
    /** 内容截断上限 */
    private static final int MAX_TEXT_LENGTH = 50000;
    /** 编码检测时检查的头部字节数 */
    private static final int CHARSET_DETECT_LIMIT = 4096;

    public LinkParseService() {
        this.webClient = WebClient.builder()
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .codecs(configurer -> configurer.defaultCodecs().maxInMemorySize(MAX_IN_MEMORY_SIZE))
                .build();
    }

    /**
     * 爬取 URL 并提取网页正文文本
     * <p>
     * 多级重试策略：直连 → 代理 → www 前缀直连 → www 前缀代理 → HTTPS 直连 → HTTPS 代理。
     * 如果所有尝试都失败，返回错误描述。
     * </p>
     *
     * @param url 要爬取的网页 URL
     * @return 提取的纯文本内容；若失败则返回错误描述
     */
    public String parseUrl(String url) {
        // 规范化 URL：确保有协议前缀
        url = normalizeUrl(url);
        // 记录起始时间，用于总超时断路器
        long deadlineNanos = System.nanoTime() + TOTAL_TIMEOUT.toNanos();

        // 1. 先尝试直连
        String html = tryRequest(url, false);

        // 2. 直连失败（超时、空内容、被拦截），尝试代理
        if ((html == null || html.isEmpty() || html.contains("系统找不到该页") || html.contains("403 Forbidden") || html.contains("Access Denied"))
                && !deadlineExceeded(deadlineNanos)) {
            log.info("[LinkParse] Direct failed, trying proxy...");
            html = tryRequest(url, true);
        }

        // 3. 仍然失败，尝试添加 www 前缀
        if ((html == null || html.isEmpty()) && !url.contains("://www.") && !deadlineExceeded(deadlineNanos)) {
            String wwwUrl = url.replace("://", "://www.");
            log.info("[LinkParse] Trying www prefix: {}", wwwUrl);
            html = tryRequest(wwwUrl, false);
            if ((html == null || html.isEmpty()) && !deadlineExceeded(deadlineNanos)) {
                html = tryRequest(wwwUrl, true);
            }
        }

        // 4. 仍然失败，尝试 HTTPS 升级
        if ((html == null || html.isEmpty()) && url.startsWith("http://") && !deadlineExceeded(deadlineNanos)) {
            String httpsUrl = url.replace("http://", "https://");
            log.info("[LinkParse] Trying HTTPS: {}", httpsUrl);
            html = tryRequest(httpsUrl, false);
            if ((html == null || html.isEmpty()) && !deadlineExceeded(deadlineNanos)) {
                html = tryRequest(httpsUrl, true);
            }
        }

        if (html == null || html.isEmpty()) {
            if (deadlineExceeded(deadlineNanos)) {
                return "[链接解析失败] 解析超时（累计超过 " + TOTAL_TIMEOUT.getSeconds() + " 秒），请稍后重试。";
            }
            return "[链接解析失败] 无法获取网页内容，请检查链接是否正确。";
        }
        return extractText(html);
    }

    /**
     * 判断是否已超过总解析超时上限（断路器）。
     *
     * @param deadlineNanos 截止时间（纳秒）
     * @return true 表示已超时，应停止后续重试
     */
    private boolean deadlineExceeded(long deadlineNanos) {
        return System.nanoTime() >= deadlineNanos;
    }

    /**
     * 规范化 URL：去除首尾空格，确保有协议前缀
     * <p>
     * 如果 URL 没有 http:// 或 https:// 前缀，默认添加 https://。
     * </p>
     *
     * @param url 原始 URL
     * @return 规范化后的 URL
     */
    private String normalizeUrl(String url) {
        url = url.trim();
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "https://" + url;
        }
        return url;
    }

    /**
     * 核心请求方法
     * <p>
     * 使用 WebClient 发送 GET 请求获取网页内容。
     * 如果 useProxy 为 true，则通过本地 SOCKS/HTTP 代理连接。
     * 模拟 Chrome 浏览器请求头，包括 User-Agent、Referer、Accept-Language 等。
     * 响应以字节数组形式获取，然后进行编码检测和解码，避免中文乱码。
     * </p>
     *
     * @param url      目标 URL
     * @param useProxy 是否使用代理
     * @return 解码后的 HTML 字符串；若失败返回 null
     */
    private String tryRequest(String url, boolean useProxy) {
        WebClient client;

        if (useProxy) {
            // 创建带代理的 HttpClient
            HttpClient proxyHttpClient = HttpClient.create()
                    .proxy(proxy -> proxy
                            .type(ProxyProvider.Proxy.HTTP)
                            .address(InetSocketAddress.createUnresolved(PROXY_HOST, PROXY_PORT))
                    )
                    .followRedirect(true)
                    .responseTimeout(REQUEST_TIMEOUT);

            client = WebClient.builder()
                    .clientConnector(new ReactorClientHttpConnector(proxyHttpClient))
                    .codecs(configurer -> configurer.defaultCodecs().maxInMemorySize(MAX_IN_MEMORY_SIZE))
                    .build();
        } else {
            // 直连，使用默认配置
            client = WebClient.builder()
                    .codecs(configurer -> configurer.defaultCodecs().maxInMemorySize(MAX_IN_MEMORY_SIZE))
                    .build();
        }

        try {
            return client.get()
                    .uri(url)
                    .headers(headers -> {
                        // 模拟最新版 Chrome 的 User-Agent
                        headers.set(HttpHeaders.USER_AGENT,
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36");

                        // 根据目标网站设置 Referer，提高反爬成功率
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

                        // 中文环境，优先中文内容
                        headers.set(HttpHeaders.ACCEPT_LANGUAGE, "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7");

                        // 支持压缩传输
                        headers.set(HttpHeaders.ACCEPT,
                                "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8");
                        headers.set(HttpHeaders.ACCEPT_ENCODING, "gzip, deflate, br");

                        // 保持长连接
                        headers.set(HttpHeaders.CONNECTION, "keep-alive");

                        // 禁用缓存
                        headers.set(HttpHeaders.CACHE_CONTROL, "max-age=0");

                        // Sec-Fetch 系列头部，模拟现代浏览器行为
                        headers.set("Sec-Fetch-Dest", "document");
                        headers.set("Sec-Fetch-Mode", "navigate");
                        headers.set("Sec-Fetch-Site", "none");
                        headers.set("Sec-Fetch-User", "?1");
                        headers.set("Upgrade-Insecure-Requests", "1");
                    })
                    .retrieve()
                    .bodyToMono(byte[].class)
                    .timeout(REQUEST_TIMEOUT)
                    .map(bytes -> detectAndDecode(bytes, url)) // 编码检测和解码
                    .onErrorResume(e -> {
                        // 错误时返回空 Mono，不中断流程
                        log.error("[LinkParse] Request error: {}", e.getMessage());
                        return Mono.empty();
                    })
                    .block(); // 阻塞等待结果（同步方式）

        } catch (Exception e) {
            log.error("[LinkParse] Unknown error: {}", e.getMessage());
            return null;
        }
    }

    /**
     * 检测 HTML 编码并解码为字符串
     * <p>
     * 编码检测策略：
     * <ol>
     *   <li>从 HTML meta 标签中检测 charset</li>
     *   <li>尝试 UTF-8 解码，检测是否有乱码</li>
     *   <li>尝试 GBK 解码</li>
     *   <li>尝试 GB2312 解码</li>
     *   <li>尝试 Big5 解码（繁体中文）</li>
     *   <li>最终回退到 UTF-8</li>
     * </ol>
     * 乱码检测通过统计 Unicode 替换字符（U+FFFD）的数量来判断。
     * </p>
     *
     * @param bytes HTML 字节数组
     * @param url   原始 URL（未使用，保留用于扩展）
     * @return 解码后的字符串
     */
    private String detectAndDecode(byte[] bytes, String url) {
        // 1. 从 HTML meta 标签中检测 charset
        Charset detectedCharset = detectCharsetFromBytes(bytes);

        // 2. 如果 meta 标签未指定编码，则尝试常见的中文编码
        if (detectedCharset == null) {
            // 先尝试 UTF-8（大多数现代网站使用）
            String utf8 = new String(bytes, StandardCharsets.UTF_8);
            if (!containsGarbledText(utf8)) {
                return utf8;
            }

            // 尝试 GBK（常见于旧版中文网站）
            try {
                String gbk = new String(bytes, Charset.forName("GBK"));
                if (!containsGarbledText(gbk)) {
                    return gbk;
                }
            } catch (Exception ignored) {}

            // 尝试 GB2312
            try {
                String gb2312 = new String(bytes, Charset.forName("GB2312"));
                if (!containsGarbledText(gb2312)) {
                    return gb2312;
                }
            } catch (Exception ignored) {}

            // 尝试 Big5（繁体中文）
            try {
                String big5 = new String(bytes, Charset.forName("Big5"));
                if (!containsGarbledText(big5)) {
                    return big5;
                }
            } catch (Exception ignored) {}

            // 最终回退到 UTF-8
            return utf8;
        }

        return new String(bytes, detectedCharset);
    }

    /**
     * 从 HTML 字节数组中检测编码
     * <p>
     * 只检查前 4096 字节（HTML 头部区域），通过正则匹配两种 meta 标签格式：
     * <ul>
     *   <li>{@code <meta charset="xxx">}</li>
     *   <li>{@code <meta http-equiv="Content-Type" content="text/html; charset=xxx">}</li>
     * </ul>
     * </p>
     *
     * @param bytes HTML 字节数组
     * @return 检测到的 Charset；若未检测到则返回 null
     */
    private Charset detectCharsetFromBytes(byte[] bytes) {
        // 只检查前 4096 字节，因为 meta 标签通常在 HTML 头部
        int limit = Math.min(bytes.length, CHARSET_DETECT_LIMIT);
        // 使用 ISO-8859-1 读取，这种编码不会丢失字节信息
        String head = new String(bytes, 0, limit, StandardCharsets.ISO_8859_1);

        // 模式1：<meta charset="xxx">
        Pattern charsetPattern = Pattern.compile("<meta[^>]+charset\\s*=\\s*[\"']?([^\"'\\s>]+)", Pattern.CASE_INSENSITIVE);
        Matcher matcher = charsetPattern.matcher(head);
        if (matcher.find()) {
            String charsetName = matcher.group(1).trim();
            try {
                return Charset.forName(charsetName);
            } catch (Exception ignored) {}
        }

        // 模式2：<meta http-equiv="Content-Type" content="text/html; charset=xxx">
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
     * 检测文本是否包含乱码字符
     * <p>
     * 通过统计前 500 个字符中 Unicode 替换字符（U+FFFD，）的数量来判断。
     * 如果超过 3 个替换字符，则认为文本包含乱码。
     * </p>
     *
     * @param text 待检测的文本
     * @return true 表示包含乱码，false 表示正常
     */
    private boolean containsGarbledText(String text) {
        // 只检查前 500 个字符，提高效率
        String sample = text.substring(0, Math.min(text.length(), 500));
        // 统计 Unicode 替换字符（U+FFFD = ）
        int replacementCount = 0;
        for (int i = 0; i < sample.length(); i++) {
            if (sample.charAt(i) == '\uFFFD') {
                replacementCount++;
            }
        }
        // 如果前 500 字符中有超过 3 个替换字符，判定为乱码
        if (replacementCount > 3) {
            return true;
        }
        return false;
    }

    /**
     * 从 HTML 中提取正文文本
     * <p>
     * 使用 Jsoup 解析 HTML，移除脚本、样式、导航、广告等非内容元素。
     * 优先按特定网站的内容区域选择器提取（微信公众号、知乎、CSDN、掘金、B站），
     * 然后回退到 HTML5 语义标签（article、main、role=main），
     * 最后回退到 body 文本。
     * 提取后清理空白并截断超长内容。
     * </p>
     *
     * @param html HTML 字符串
     * @return 提取的纯文本
     */
    private String extractText(String html) {
        Document doc = Jsoup.parse(html);

        // 移除非内容元素：脚本、样式、导航、页脚、侧边栏、广告等
        // 使用 CSS 选择器批量移除
        doc.select("script, style, nav, header, footer, aside, iframe, noscript, "
                + ".ad, .advertisement, .sidebar, .comment, .comments, .footer, .header, .nav, .menu, "
                + ".social-share, .share-bar, .related-posts, .recommend, .breadcrumb, "
                + ".pagination, .copyright, .modal, .popup, .toast, .notification, "
                + "[class*=ad-], [class*=sponsor], [id*=ad-], [id*=sponsor]").remove();

        // 按优先级尝试提取主要内容区域
        String text = null;

        // 微信公众号文章
        if (!doc.select("#js_content").isEmpty()) {
            text = doc.select("#js_content").first().text();
        }
        // 知乎文章
        else if (!doc.select(".RichText.ztext.Post-RichTextContainer").isEmpty()) {
            text = doc.select(".RichText.ztext.Post-RichTextContainer").first().text();
        }
        // CSDN 文章
        else if (!doc.select("#article_content").isEmpty()) {
            text = doc.select("#article_content").first().text();
        }
        // 掘金文章
        else if (!doc.select(".article-content").isEmpty()) {
            text = doc.select(".article-content").first().text();
        }
        // Bilibili 文章
        else if (!doc.select(".article-holder").isEmpty()) {
            text = doc.select(".article-holder").first().text();
        }
        // HTML5 语义标签：article
        else if (!doc.select("article").isEmpty()) {
            text = doc.select("article").first().text();
        }
        // HTML5 语义标签：main
        else if (!doc.select("main").isEmpty()) {
            text = doc.select("main").first().text();
        }
        // ARIA 角色：role=main
        else if (!doc.select("[role=main]").isEmpty()) {
            text = doc.select("[role=main]").first().text();
        }
        // 通用内容区域类名/ID
        else if (!doc.select(".content, .article, .post, .entry, #content, #article, .post-content, .article-body, .story-body").isEmpty()) {
            text = doc.select(".content, .article, .post, .entry, #content, #article, .post-content, .article-body, .story-body").first().text();
        }

        // 最终回退：使用 body 的全部文本（body 可能为 null，需判空）
        if ((text == null || text.isEmpty()) && doc.body() != null) {
            text = doc.body().text();
        }
        // 极端情况：body 也为空，回退为空字符串避免 NPE
        if (text == null || text.isEmpty()) {
            return "";
        }

        // 清理空白：合并连续空格/Tab，合并多余换行
        text = text.replaceAll("[ \\t]+", " ")     // 合并空格和 Tab
                   .replaceAll("\\n\\s*\\n+", "\n\n") // 合并多余换行
                   .trim();

        // 截断超长内容，避免 AI 处理时 token 超限
        if (text.length() > MAX_TEXT_LENGTH) {
            text = text.substring(0, MAX_TEXT_LENGTH) + "\n\n[内容过长，已截断]";
        }

        return text;
    }
}