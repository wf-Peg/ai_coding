package com.example.clip.index;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

public class WorkspaceSuggestionService {
    private static final Logger log = LoggerFactory.getLogger(WorkspaceSuggestionService.class);
    private static final double THRESHOLD = 0.55;
    private static final int COOLDOWN_DAYS = 7;
    private static final int MAX_SUGGESTIONS = 20;

    private final Path suggestionsPath;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    public WorkspaceSuggestionService(Path indexDir) {
        this.suggestionsPath = indexDir.resolve("workspace-suggestions.json");
    }

    public synchronized List<SuggestionCandidate> generateSuggestions(String workspaceId,
                                                                       Collection<ContentRef> allRefs,
                                                                       List<WorkspaceMembership> members,
                                                                       Collection<ContentRef> ruleMatchedRefs,
                                                                       HabitProfile profile) {
        if (workspaceId == null) return List.of();

        Set<String> memberIds = new LinkedHashSet<>();
        Set<String> memberCategories = new LinkedHashSet<>();
        Set<String> memberTags = new LinkedHashSet<>();
        Set<String> memberDirectories = new LinkedHashSet<>();

        for (WorkspaceMembership m : members) {
            if (!workspaceId.equals(m.workspaceId())) continue;
            memberIds.add(m.contentId());
        }

        for (ContentRef ref : allRefs) {
            if (ref == null || ref.id() == null) continue;
            if (!memberIds.contains(ref.id())) continue;
            if (ref.category() != null) memberCategories.add(ref.category().toLowerCase());
            if (ref.tags() != null) {
                for (String tag : ref.tags()) {
                    if (tag != null) memberTags.add(tag.toLowerCase());
                }
            }
            if (ref.sourcePath() != null) memberDirectories.add(ref.sourcePath().toLowerCase());
        }

        // 规则命中的内容作为辅助画像来源：规则匹配到的特征应提升同特征候选的评分
        Set<String> ruleCategories = new LinkedHashSet<>();
        Set<String> ruleTags = new LinkedHashSet<>();
        Set<String> ruleDirectories = new LinkedHashSet<>();
        Set<String> ruleMatchedIds = new LinkedHashSet<>();
        if (ruleMatchedRefs != null) {
            for (ContentRef ref : ruleMatchedRefs) {
                if (ref == null || ref.id() == null) continue;
                ruleMatchedIds.add(ref.id());
                if (ref.category() != null) ruleCategories.add(ref.category().toLowerCase());
                if (ref.tags() != null) {
                    for (String tag : ref.tags()) {
                        if (tag != null) ruleTags.add(tag.toLowerCase());
                    }
                }
                if (ref.sourcePath() != null) ruleDirectories.add(ref.sourcePath().toLowerCase());
            }
        }

        List<SuggestionCandidate> existing = readAll();
        Set<String> cooldownIds = new LinkedHashSet<>();
        Set<String> rejectedIds = new LinkedHashSet<>();
        LocalDateTime now = LocalDateTime.now();

        for (SuggestionCandidate s : existing) {
            if (!workspaceId.equals(s.workspaceId())) continue;
            if ("rejected".equals(s.status())) {
                rejectedIds.add(s.contentId());
            } else if ("accepted".equals(s.status())) {
                memberIds.add(s.contentId());
            } else if ("ignored".equals(s.status()) && s.expiresAt() != null && now.isBefore(s.expiresAt())) {
                cooldownIds.add(s.contentId());
            }
        }

        List<SuggestionCandidate> candidates = new ArrayList<>();
        for (ContentRef ref : allRefs) {
            if (ref == null || ref.id() == null) continue;
            if (memberIds.contains(ref.id())) continue;
            if (rejectedIds.contains(ref.id())) continue;
            if (cooldownIds.contains(ref.id())) continue;

            SuggestionCandidate scored = scoreCandidate(workspaceId, ref, memberCategories, memberTags,
                    memberDirectories, memberIds, allRefs, profile, ruleCategories, ruleTags,
                    ruleDirectories, ruleMatchedIds);
            if (scored != null) {
                candidates.add(scored);
            }
        }

        candidates.sort(Comparator.<SuggestionCandidate>comparingDouble(c -> c.score()).reversed());
        if (candidates.size() > MAX_SUGGESTIONS) {
            candidates = candidates.subList(0, MAX_SUGGESTIONS);
        }
        return candidates;
    }

    public synchronized List<SuggestionCandidate> pendingSuggestions(String workspaceId) {
        LocalDateTime now = LocalDateTime.now();
        return readAll().stream()
                .filter(s -> workspaceId.equals(s.workspaceId()) && "pending".equals(s.status())
                        && (s.expiresAt() == null || !now.isAfter(s.expiresAt())))
                .sorted(Comparator.<SuggestionCandidate>comparingDouble(c -> c.score()).reversed())
                .toList();
    }

    /**
     * 当前处于冷却期的建议（被忽略且冷却期未到）。用于前端展示“已忽略，7 天内不再推荐”并可恢复。
     */
    public synchronized List<SuggestionCandidate> cooldownSuggestions(String workspaceId) {
        LocalDateTime now = LocalDateTime.now();
        return readAll().stream()
                .filter(s -> workspaceId.equals(s.workspaceId()) && "ignored".equals(s.status())
                        && s.expiresAt() != null && now.isBefore(s.expiresAt()))
                .sorted(Comparator.<SuggestionCandidate>comparingDouble(c -> c.score()).reversed())
                .toList();
    }

    /**
     * 撤销忽略，把冷却中的建议恢复为可再次推荐（重置为 pending、清除冷却截止）。
     * @return 被恢复的建议，或 null 如果不存在或不在冷却期。
     */
    public synchronized SuggestionCandidate restore(String suggestionId) {
        List<SuggestionCandidate> all = readAll();
        for (int i = 0; i < all.size(); i++) {
            SuggestionCandidate s = all.get(i);
            if (s.id().equals(suggestionId) && "ignored".equals(s.status())) {
                SuggestionCandidate restored = new SuggestionCandidate(s.id(), s.workspaceId(),
                        s.contentId(), s.score(), s.reasons(), s.createdAt(), null, "pending",
                        s.type(), s.title(), s.suggestedField(), s.suggestedValue());
                all.set(i, restored);
                writeAll(all);
                return restored;
            }
        }
        return null;
    }

    public synchronized SuggestionCandidate ignore(String suggestionId) {
        List<SuggestionCandidate> all = readAll();
        LocalDateTime cooldownEnd = LocalDateTime.now().plusDays(COOLDOWN_DAYS);
        for (int i = 0; i < all.size(); i++) {
            if (all.get(i).id().equals(suggestionId) && "pending".equals(all.get(i).status())) {
                SuggestionCandidate target = all.get(i);
                all.set(i, new SuggestionCandidate(suggestionId, target.workspaceId(),
                        target.contentId(), target.score(), target.reasons(),
                        target.createdAt(), cooldownEnd, "ignored",
                        target.type(), target.title(), target.suggestedField(), target.suggestedValue()));
                writeAll(all);
                return target;
            }
        }
        return null;
    }

    public synchronized SuggestionResult acceptSuggestion(String suggestionId) {
        List<SuggestionCandidate> all = readAll();
        for (int i = 0; i < all.size(); i++) {
            if (all.get(i).id().equals(suggestionId) && "pending".equals(all.get(i).status())) {
                SuggestionCandidate target = all.get(i);
                all.set(i, new SuggestionCandidate(suggestionId, target.workspaceId(),
                        target.contentId(), target.score(), target.reasons(),
                        target.createdAt(), target.expiresAt(), "accepted",
                        target.type(), target.title(), target.suggestedField(), target.suggestedValue()));
                writeAll(all);
                return new SuggestionResult(true, target);
            }
        }
        return new SuggestionResult(false, null);
    }

    public synchronized SuggestionCandidate reject(String suggestionId) {
        List<SuggestionCandidate> all = readAll();
        for (int i = 0; i < all.size(); i++) {
            if (all.get(i).id().equals(suggestionId) && "pending".equals(all.get(i).status())) {
                SuggestionCandidate target = all.get(i);
                all.set(i, new SuggestionCandidate(suggestionId, target.workspaceId(),
                        target.contentId(), target.score(), target.reasons(),
                        target.createdAt(), null, "rejected",
                        target.type(), target.title(), target.suggestedField(), target.suggestedValue()));
                writeAll(all);
                return target;
            }
        }
        return null;
    }

    /**
     * 基于排除内容生成规则建议。
     * 聚合排除内容的 tag 频次，出现 >= 2 次的 tag 生成规则建议（过滤已有规则）。
     */
    public synchronized List<SuggestionCandidate> generateRuleSuggestions(
            String workspaceId,
            Collection<ContentRef> allRefs,
            List<WorkspaceExclusion> exclusions,
            List<WorkspaceRule> existingRules) {

        // 1. 建立 contentId → ContentRef 映射
        Map<String, ContentRef> refMap = allRefs.stream()
                .filter(r -> r != null && r.id() != null)
                .collect(Collectors.toMap(ContentRef::id, r -> r, (a, b) -> a));

        // 2. 聚合排除内容的 tag 频次
        Map<String, Long> tagCounts = new HashMap<>();
        for (WorkspaceExclusion exclusion : exclusions) {
            if (!workspaceId.equals(exclusion.workspaceId())) continue;
            ContentRef ref = refMap.get(exclusion.contentId());
            if (ref != null && ref.tags() != null) {
                for (String tag : ref.tags()) {
                    if (tag != null) tagCounts.merge(tag.toLowerCase(), 1L, Long::sum);
                }
            }
        }

        // 3. 过滤已有规则（避免重复建议）
        Set<String> existingTagRules = existingRules.stream()
                .filter(r -> "tag".equals(r.field()) && r.enabled())
                .map(WorkspaceRule::value)
                .map(String::toLowerCase)
                .collect(Collectors.toSet());

        // 4. 检查冷却/已拒绝状态
        List<SuggestionCandidate> existing = readAll();
        Set<String> cooldownTags = new LinkedHashSet<>();
        Set<String> rejectedTags = new LinkedHashSet<>();
        LocalDateTime now = LocalDateTime.now();
        for (SuggestionCandidate s : existing) {
            if (!workspaceId.equals(s.workspaceId()) || !"rule-suggestion".equals(s.type())) continue;
            if ("rejected".equals(s.status())) {
                rejectedTags.add(s.suggestedValue());
            } else if ("ignored".equals(s.status()) && s.expiresAt() != null && now.isBefore(s.expiresAt())) {
                cooldownTags.add(s.suggestedValue());
            }
        }

        // 5. 生成规则建议
        List<SuggestionCandidate> candidates = new ArrayList<>();
        for (Map.Entry<String, Long> entry : tagCounts.entrySet()) {
            String tag = entry.getKey();
            long count = entry.getValue();
            if (count < 2) continue;
            if (existingTagRules.contains(tag)) continue;
            if (cooldownTags.contains(tag)) continue;
            if (rejectedTags.contains(tag)) continue;

            double score = Math.min(1.0, count / 10.0);
            candidates.add(new SuggestionCandidate(
                    deterministicId("rs", workspaceId, tag),
                    workspaceId, null, score,
                    List.of("该标签在排除内容中出现 " + count + " 次"),
                    now, now.plusDays(COOLDOWN_DAYS), "pending",
                    "rule-suggestion",
                    "建议添加标签规则：" + tag,
                    "tag", tag));
        }
        return candidates;
    }

    /**
     * 接受规则建议，自动创建规则。
     * @return 被接受的建议（可用于读取 suggestedField/suggestedValue），或 null 如果找不到对应建议
     */
    public synchronized SuggestionCandidate acceptRuleSuggestion(String suggestionId) {
        List<SuggestionCandidate> all = readAll();
        for (int i = 0; i < all.size(); i++) {
            SuggestionCandidate s = all.get(i);
            if (s.id().equals(suggestionId) && "pending".equals(s.status())
                    && "rule-suggestion".equals(s.type())) {
                all.set(i, new SuggestionCandidate(s.id(), s.workspaceId(), s.contentId(),
                        s.score(), s.reasons(), s.createdAt(), s.expiresAt(), "accepted",
                        s.type(), s.title(), s.suggestedField(), s.suggestedValue()));
                writeAll(all);
                return s;
            }
        }
        return null;
    }

    public synchronized void saveSuggestions(String workspaceId, List<SuggestionCandidate> candidates) {
        List<SuggestionCandidate> all = readAll();
        all.removeIf(s -> workspaceId.equals(s.workspaceId()) && "pending".equals(s.status()));
        all.addAll(candidates);
        writeAll(all);
    }

    private SuggestionCandidate scoreCandidate(String workspaceId, ContentRef candidate,
                                                Set<String> memberCategories,
                                                Set<String> memberTags,
                                                Set<String> memberDirectories,
                                                Set<String> memberIds,
                                                Collection<ContentRef> allRefs,
                                                HabitProfile profile,
                                                Set<String> ruleCategories,
                                                Set<String> ruleTags,
                                                Set<String> ruleDirectories,
                                                Set<String> ruleMatchedIds) {
        List<String> reasons = new ArrayList<>();
        double score = 0;

        if (candidate.category() != null && memberCategories.contains(candidate.category().toLowerCase())) {
            score += 0.25;
            reasons.add("category-match");
        }
        if (candidate.tags() != null && !candidate.tags().isEmpty()) {
            long matched = candidate.tags().stream()
                    .filter(t -> t != null && memberTags.contains(t.toLowerCase()))
                    .count();
            if (matched > 0) {
                score += Math.min(0.35, matched * 0.12);
                reasons.add("tag-match");
            }
        }
        if (candidate.sourcePath() != null) {
            String path = candidate.sourcePath().toLowerCase();
            boolean dirMatch = memberDirectories.stream().anyMatch(path::contains);
            if (dirMatch) {
                score += 0.20;
                reasons.add("directory-match");
            }
        }
        if (candidate.category() != null) {
            boolean patternMatch = allRefs.stream()
                    .filter(r -> r != null && r.id() != null && memberIds.contains(r.id()))
                    .anyMatch(r -> candidate.category().equalsIgnoreCase(r.category()));
            if (patternMatch) {
                score += 0.10;
                reasons.add("member-pattern");
            }
        }
        if (profile != null && candidate.category() != null
                && profile.categories().getOrDefault(candidate.category(), 0L) > 0) {
            score += 0.10;
            reasons.add("habit-category");
        }

        // 规则命中特征作为辅助信号：与规则命中的内容共享分类/标签/目录时加分（权重低于成员画像）
        if (ruleMatchedIds.contains(candidate.id())) {
            score += 0.20;
            reasons.add("rule-explicit");
        }
        if (candidate.category() != null && ruleCategories.contains(candidate.category().toLowerCase())) {
            score += 0.12;
            reasons.add("rule-category");
        }
        if (candidate.tags() != null) {
            long ruleTagMatched = candidate.tags().stream()
                    .filter(t -> t != null && ruleTags.contains(t.toLowerCase()))
                    .count();
            if (ruleTagMatched > 0) {
                score += Math.min(0.15, ruleTagMatched * 0.07);
                reasons.add("rule-tag");
            }
        }
        if (candidate.sourcePath() != null) {
            String path = candidate.sourcePath().toLowerCase();
            boolean ruleDirMatch = ruleDirectories.stream().anyMatch(path::contains);
            if (ruleDirMatch) {
                score += 0.10;
                reasons.add("rule-directory");
            }
        }

        if (score < THRESHOLD) return null;

        LocalDateTime now = LocalDateTime.now();
        return new SuggestionCandidate(
                deterministicId("s", workspaceId, candidate.id()),
                workspaceId, candidate.id(), Math.min(1.0, score), reasons,
                now, now.plusDays(COOLDOWN_DAYS), "pending",
                "content-suggestion", candidate.title(), null, null);
    }

    /** 基于 workspaceId 与内容/tag 生成确定性 ID，保证同一建议在多次读取间身份稳定。 */
    static String deterministicId(String prefix, String workspaceId, String value) {
        String slug = String.format("%08x", workspaceId.hashCode());
        return prefix + "_" + slug + "_" + value;
    }

    public synchronized SuggestionCandidate findById(String suggestionId) {
        return readAll().stream()
                .filter(s -> s.id().equals(suggestionId))
                .findFirst()
                .orElse(null);
    }

    /** 输出建议漏斗统计：展示/采纳/忽略/拒绝及采纳率。 */
    public synchronized Map<String, Object> suggestionStats(String workspaceId) {
        List<SuggestionCandidate> candidates = readAll().stream()
                .filter(s -> workspaceId.equals(s.workspaceId()))
                .toList();
        long shown = candidates.size();
        long accepted = candidates.stream().filter(s -> "accepted".equals(s.status())).count();
        long ignored = candidates.stream().filter(s -> "ignored".equals(s.status())).count();
        long rejected = candidates.stream().filter(s -> "rejected".equals(s.status())).count();
        long decided = accepted + ignored + rejected;
        double acceptanceRate = decided == 0 ? 0.0 : (double) accepted / decided;
        LocalDateTime nowStats = LocalDateTime.now();
        long inCooldown = candidates.stream().filter(s -> "ignored".equals(s.status())
                && s.expiresAt() != null && nowStats.isBefore(s.expiresAt())).count();
        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("workspaceId", workspaceId);
        stats.put("shown", shown);
        stats.put("accepted", accepted);
        stats.put("ignored", ignored);
        stats.put("rejected", rejected);
        stats.put("inCooldown", inCooldown);
        stats.put("acceptanceRate", Math.round(acceptanceRate * 1000) / 10.0);
        return stats;
    }

    private List<SuggestionCandidate> readAll() {
        if (!Files.exists(suggestionsPath)) return new ArrayList<>();
        try {
            List<SuggestionCandidate> values = objectMapper.readValue(suggestionsPath.toFile(),
                    new TypeReference<List<SuggestionCandidate>>() {});
            return values == null ? new ArrayList<>() : values;
        } catch (IOException error) {
            log.warn("Failed to read suggestions: {}", error.getMessage());
            return new ArrayList<>();
        }
    }

    private void writeAll(List<SuggestionCandidate> candidates) {
        try {
            Files.createDirectories(suggestionsPath.getParent());
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(suggestionsPath.toFile(), candidates);
        } catch (IOException error) {
            log.warn("Failed to write suggestions: {}", error.getMessage());
        }
    }

    public record SuggestionResult(boolean success, SuggestionCandidate suggestion) {}
}