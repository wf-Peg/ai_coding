package com.example.clip.service.wiki;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 本地拆词检索器：对 wiki/index.md 条目/正文做轻量 BM25 打分，替代/前置 LLM 定位。
 * <p>
 * 零依赖实现（阶段一 RAG，词法召回升级），相比纯命中计数更接近真实相关性：
 * <ul>
 *   <li><b>词形归一</b>：小写、按空白/标点拆词；英文做极轻度复数还原（去尾 s）；中文连续 CJK 段按 2-gram。</li>
 *   <li><b>停用词滤噪</b>：中英文口语化/高频提问词（的/了/吗/如何/怎么/请问、the/is/how/what 等）。</li>
 *   <li><b>标题加权</b>：页面名(title)命中权重高于摘要/正文(body)（title weight {@value TITLE_WEIGHT}）。</li>
 *   <li><b>BM25 打分</b>：词频(TF)+文档长度归一+逆文档频率(IDF)，在同一候选文档集内自包含计算。</li>
 * </ul>
 * 达标门槛仍以「命中的去重 query token 数」衡量（≥ minHits），保留既有降级语义：
 * 达标才在 {@code WikiQueryService} 阶段 1 复用，未达标自动走 {@code AiService.locateRelevantPages}。
 * </p>
 * <p>
 * 签名与 {@code WikiQueryService.query} 的调用约定保持不变；仅内部打分从「命中计数」升级为 BM25，
 * 对调用方透明。近义/同义词词典刻意不引入（对个人实词语料收益有限且易误召回），如确需可后续以
 * 配置化词典扩展。
 * </p>
 */
@Component
public class WikiLocalRetriever {

    private static final Logger log = LoggerFactory.getLogger(WikiLocalRetriever.class);

    private static final Pattern INDEX_ENTRY = Pattern.compile(
            "^- \\[\\[(.+?)\\]\\] — (.+?) \\(updated: .+?\\)$", Pattern.MULTILINE);

    private static final Pattern CJK_SEGMENT = Pattern.compile("[\\u4e00-\\u9fa5]+");

    /** 轻量 BM25 参数（Lucene 缺省 K1 / B） */
    private static final float K1 = 1.2f;
    private static final float B = 0.75f;
    /** 标题命中加权：页面名/条目名比正文更相关 */
    private static final float TITLE_WEIGHT = 2.0f;

    /** 中文高频/口语化提问词（无检索区分度） */
    private static final Set<String> ZH_STOPWORDS = Set.of(
            "一", "一个", "一些", "这个", "那个", "什么", "怎么", "为何", "为什么", "如何",
            "是否", "可以", "需要", "请问", "介绍", "简述", "解释", "区别", "对比", "哪些",
            "吗", "呢", "吧", "啊", "的", "了", "是", "和", "与", "或", "对于", "关于", "哪",
            "我", "你", "它", "让", "用", "及", "常用", "以及"
    );

    /** 英文停用词（Lucene EnglishAnalyzer 精简子集） */
    private static final Set<String> EN_STOPWORDS = Set.of(
            "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "by", "is", "are",
            "was", "were", "be", "been", "can", "could", "do", "does", "did", "how", "what", "when",
            "where", "which", "why", "who", "this", "that", "these", "those", "please", "explain"
    );

    /**
     * 拆词：小写、按空白/标点切分；英文极轻度复数还原；中文连续 CJK 段按 2-gram；
     * 过滤停用词与单字中文词。返回去重后的有效 token。
     */
    public List<String> tokenize(String text) {
        Set<String> tokens = new LinkedHashSet<>();
        if (text == null || text.trim().isEmpty()) {
            return new ArrayList<>(tokens);
        }
        String normalized = text.toLowerCase();
        for (String seg : normalized.split("[\\s\\p{Punct}]+")) {
            if (seg.isEmpty()) {
                continue;
            }
            collectTokens(seg, tokens);
        }
        return new ArrayList<>(tokens);
    }

    private static void collectTokens(String seg, Set<String> out) {
        Matcher cjk = CJK_SEGMENT.matcher(seg);
        int lastEnd = 0;
        while (cjk.find()) {
            if (cjk.start() > lastEnd) {
                addWord(seg.substring(lastEnd, cjk.start()), out);
            }
            String cjkText = cjk.group();
            if (cjkText.length() >= 2) {
                for (int i = 0; i + 2 <= cjkText.length(); i++) {
                    addWord(cjkText.substring(i, i + 2), out);
                }
            }
            lastEnd = cjk.end();
        }
        if (lastEnd < seg.length()) {
            addWord(seg.substring(lastEnd), out);
        }
    }

    private static void addWord(String w, Set<String> out) {
        if (w == null || w.isEmpty()) {
            return;
        }
        String t = w;
        // 极轻度英文复数还原（避开 -ss/-us/-is 规则型结尾），避免把真实词误折
        if (t.length() > 3 && t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us") && !t.endsWith("is")) {
            t = t.substring(0, t.length() - 1);
        }
        if (t.length() < 2) {
            return;
        }
        if (ZH_STOPWORDS.contains(t) || EN_STOPWORDS.contains(t)) {
            return;
        }
        out.add(t);
    }

    /** 候选文档：id 为页面名，title 为页面名，body 为摘要/正文。 */
    private record Candidate(String id, String title, String body) {}

    /** 打分中间项。 */
    private record Entry(String id, double score, int matched) {}

    private List<String> rank(String question, List<Candidate> candidates, int topK, int minHits) {
        List<String> qTokens = tokenize(question);
        if (qTokens.isEmpty() || candidates == null || candidates.isEmpty()) {
            return List.of();
        }
        int n = candidates.size();
        List<Map<String, Integer>> tfList = new ArrayList<>(n);
        int[] docLen = new int[n];
        double avgLen = 0;
        for (int i = 0; i < n; i++) {
            Candidate c = candidates.get(i);
            Map<String, Integer> tf = new HashMap<>();
            int dl = 0;
            for (String t : tokenize(c.title())) {
                int w = (int) Math.round(TITLE_WEIGHT);
                tf.merge(t, w, Integer::sum);
                dl += w;
            }
            for (String t : tokenize(c.body())) {
                tf.merge(t, 1, Integer::sum);
                dl += 1;
            }
            tfList.add(tf);
            docLen[i] = dl;
            avgLen += dl;
        }
        avgLen = n > 0 ? avgLen / n : 1.0;

        // df：每个 query token 在几条文档中出现
        Map<String, Integer> df = new HashMap<>();
        for (String t : qTokens) {
            int d = 0;
            for (Map<String, Integer> tf : tfList) {
                if (tf.containsKey(t)) {
                    d++;
                }
            }
            df.put(t, d);
        }

        List<Entry> entries = new ArrayList<>(n);
        for (int i = 0; i < n; i++) {
            Map<String, Integer> tf = tfList.get(i);
            double score = 0;
            int matched = 0;
            for (String t : qTokens) {
                int f = tf.getOrDefault(t, 0);
                if (f > 0) {
                    matched++;
                }
                int d = df.getOrDefault(t, 0);
                double idf = Math.log(1.0 + (n - d + 0.5) / (d + 0.5));
                double tfNorm = f * (K1 + 1.0) / (f + K1 * (1.0 - B + B * docLen[i] / avgLen));
                score += idf * tfNorm;
            }
            entries.add(new Entry(candidates.get(i).id(), score, matched));
        }
        entries.sort((a, b) -> {
            int cmp = Double.compare(b.score, a.score);
            return cmp != 0 ? cmp : a.id().compareTo(b.id());
        });

        List<String> result = new ArrayList<>();
        for (Entry e : entries) {
            if (e.matched() < minHits) {
                // 按 score 排序，matched 非单调 → 不能 break，只能跳过
                continue;
            }
            result.add(e.id());
            if (result.size() >= topK) {
                break;
            }
        }
        if (!result.isEmpty()) {
            log.debug("[WikiLocalRetriever] Ranked {} pages (minHits={}, topK={})",
                    result.size(), minHits, topK);
        }
        return result;
    }

    /**
     * 对 index.md 条目打分检索（页面名 + 摘要）。
     *
     * @param question    用户问题
     * @param indexContent wiki/index.md 全文
     * @param topK        最多返回条数
     * @param minHits     达标最小命中（去重 query token 数）
     * @return 达标页面名列表，按 BM25 分数倒序；未达标返回空列表
     */
    public List<String> retrieve(String question, String indexContent, int topK, int minHits) {
        if (indexContent == null || indexContent.isEmpty()) {
            return List.of();
        }
        List<Candidate> candidates = new ArrayList<>();
        Matcher matcher = INDEX_ENTRY.matcher(indexContent);
        while (matcher.find()) {
            String pageName = matcher.group(1);
            String summary = matcher.group(2);
            candidates.add(new Candidate(pageName, pageName, summary));
        }
        return rank(question, candidates, topK, minHits);
    }

    /**
     * 正文兜底检索：（页面名 → 正文）映射上的 BM25。
     * <p>
     * 目录摘要检索的补集：覆盖「知识点只在正文深处、标题摘要未体现」的 body-depth 召回缺口。
     * 正文信号弱于摘要，门槛取 {@code max(1, minHits - 1)}，仍要求至少命中 1 个有效 token。
     * </p>
     *
     * @param question   用户问题
     * @param nameToBody 页面名 → 正文内容映射
     * @param topK       最多返回条数
     * @param minHits    达标最小命中数
     * @return 达标页面名列表，按 BM25 分数倒序；无匹配返回空列表
     */
    public List<String> retrieveBodyMatches(String question, Map<String, String> nameToBody,
                                            int topK, int minHits) {
        if (nameToBody == null || nameToBody.isEmpty()) {
            return List.of();
        }
        int threshold = Math.max(1, minHits - 1);
        List<Candidate> candidates = new ArrayList<>();
        for (Map.Entry<String, String> entry : nameToBody.entrySet()) {
            candidates.add(new Candidate(entry.getKey(), entry.getKey(),
                    entry.getValue() != null ? entry.getValue() : ""));
        }
        return rank(question, candidates, topK, threshold);
    }
}