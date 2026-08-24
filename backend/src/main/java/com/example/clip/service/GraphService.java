package com.example.clip.service;

import com.example.clip.index.ContentIndexService;
import com.example.clip.index.ContentRef;
import com.example.clip.index.ContentRelation;
import com.example.clip.index.RelationIndexService;
import com.example.clip.model.Knowledge;
import com.example.clip.model.LearningPlan;
import com.example.clip.model.LearningPlan.Phase;
import org.springframework.stereotype.Service;

import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 图谱服务
 * <p>
 * 把「剪藏 → 知识(derived_from)」与「知识 → 知识(linked_to)」统一建模为带类型的
 * {@link ContentRelation}，持久化到 {@code relation-index.json}（relation-index 是
 * {@code sourceClipIds}/{@code linkedKnowledgeIds} 权威字段的可查询投影）。
 * 并对外提供 `GET /api/graph` 的统一图谱数据源，使前端图谱能同时渲染剪藏与知识两类节点。
 * </p>
 */
@Service
public class GraphService {

    private final AppConfigService appConfigService;
    private final FileStorageService storageService;

    public GraphService(AppConfigService appConfigService, FileStorageService storageService) {
        this.appConfigService = appConfigService;
        this.storageService = storageService;
    }

    private Path getIndexDir() {
        return Path.of(appConfigService.getConfigDirPath(), "index");
    }

    private Path getRelationIndexPath() {
        return getIndexDir().resolve("relation-index.json");
    }

    private Path getContentIndexPath() {
        return getIndexDir().resolve("content-index.json");
    }

    /**
     * 记录一条知识的所有关系（幂等：先移除该知识旧关系，再统一写入）。
     * <ul>
     *   <li>derived_from：{@code clip:{cid} → knowledge:{kid}}（来源剪藏）</li>
     *   <li>linked_to：{@code knowledge:{kid} → knowledge:{lid}}（双向链接）</li>
     * </ul>
     */
    public void recordKnowledgeRelations(Knowledge knowledge) {
        if (knowledge == null || knowledge.getId() == null) return;
        RelationIndexService relationIndex = new RelationIndexService(getRelationIndexPath());
        String kid = "knowledge:" + knowledge.getId();

        List<ContentRelation> existing = relationIndex.readAll();
        for (ContentRelation r : existing) {
            if (r.fromId().equals(kid) || r.toId().equals(kid)) {
                relationIndex.remove(r.fromId(), r.toId(), r.relationType());
            }
        }

        LocalDateTime now = LocalDateTime.now();
        if (knowledge.getSourceClipIds() != null) {
            for (Long clipId : knowledge.getSourceClipIds()) {
                if (clipId != null) {
                    relationIndex.add(new ContentRelation("clip:" + clipId, kid,
                            "derived_from", "clip_to_knowledge", 1.0, now));
                }
            }
        }
        if (knowledge.getLinkedKnowledgeIds() != null) {
            for (Long linkedId : knowledge.getLinkedKnowledgeIds()) {
                if (linkedId != null && !linkedId.equals(knowledge.getId())) {
                    relationIndex.add(new ContentRelation(kid, "knowledge:" + linkedId,
                            "linked_to", "wikilink", 1.0, now));
                }
            }
        }
    }

    /**
     * 移除某条知识的所有关系（用于删除知识时清理）。
     */
    public void removeKnowledgeRelations(Long knowledgeId) {
        if (knowledgeId == null) return;
        RelationIndexService relationIndex = new RelationIndexService(getRelationIndexPath());
        String kid = "knowledge:" + knowledgeId;
        List<ContentRelation> existing = relationIndex.readAll();
        for (ContentRelation r : existing) {
            if (r.fromId().equals(kid) || r.toId().equals(kid)) {
                relationIndex.remove(r.fromId(), r.toId(), r.relationType());
            }
        }
    }

    /**
     * 记录一个学习计划的所有关联（幂等：先移除该计划旧关系，再统一写入）。
     * <p>
     * 每个阶段关联的知识/剪藏聚合为 plan 级 {@code plan_links} 边：
     * <ul>
     *   <li>{@code learning-plan:{id} → knowledge:{kid}}（阶段关联知识）</li>
     *   <li>{@code learning-plan:{id} → clip:{cid}}（阶段关联剪藏）</li>
     * </ul>
     */
    public void recordPlanRelations(LearningPlan plan) {
        if (plan == null || plan.getId() == null) return;
        RelationIndexService relationIndex = new RelationIndexService(getRelationIndexPath());
        String pid = "learning-plan:" + plan.getId();

        List<ContentRelation> existing = relationIndex.readAll();
        for (ContentRelation r : existing) {
            if (r.fromId().equals(pid) || r.toId().equals(pid)) {
                relationIndex.remove(r.fromId(), r.toId(), r.relationType());
            }
        }

        LocalDateTime now = LocalDateTime.now();
        if (plan.getPhases() != null) {
            for (Phase phase : plan.getPhases()) {
                if (phase.getLinkedKnowledgeIds() != null) {
                    for (Long kid : phase.getLinkedKnowledgeIds()) {
                        if (kid != null) {
                            relationIndex.add(new ContentRelation(pid, "knowledge:" + kid,
                                    "plan_links", "learning_plan_link", 1.0, now));
                        }
                    }
                }
                if (phase.getSourceClipIds() != null) {
                    for (Long cid : phase.getSourceClipIds()) {
                        if (cid != null) {
                            relationIndex.add(new ContentRelation(pid, "clip:" + cid,
                                    "plan_links", "learning_plan_link", 1.0, now));
                        }
                    }
                }
            }
        }
    }

    /**
     * 移除某个学习计划的所有关系（用于删除计划时清理）。
     */
    public void removePlanRelations(Long planId) {
        if (planId == null) return;
        RelationIndexService relationIndex = new RelationIndexService(getRelationIndexPath());
        String pid = "learning-plan:" + planId;
        List<ContentRelation> existing = relationIndex.readAll();
        for (ContentRelation r : existing) {
            if (r.fromId().equals(pid) || r.toId().equals(pid)) {
                relationIndex.remove(r.fromId(), r.toId(), r.relationType());
            }
        }
    }

    /**
     * 全量重建关系索引：以 JSON 权威字段（sourceClipIds / linkedKnowledgeIds）为唯一真源，
     * 幂等覆盖 relation-index.json。
     */
    public void syncRelations() {
        new RelationIndexService(getRelationIndexPath()).clear();
        for (Knowledge knowledge : storageService.getAllKnowledge()) {
            recordKnowledgeRelations(knowledge);
        }
        for (LearningPlan plan : storageService.getAllLearningPlans()) {
            recordPlanRelations(plan);
        }
    }

    /**
     * 组装图谱数据。
     *
     * @param includeTypes 要包含的节点类型集合（如 clip、knowledge），null 表示全部
     * @return {@code { nodes:[{id,type,sourceId,title,summary,category,tags,linkedCount,sourceCount}],
     *         links:[{source,target,type}] }}
     */
    public Map<String, Object> getGraph(Set<String> includeTypes) {
        List<ContentRef> refs = new ContentIndexService(getContentIndexPath()).readAll();

        Map<Long, Knowledge> knowledgeById = new HashMap<>();
        for (Knowledge knowledge : storageService.getAllKnowledge()) {
            if (knowledge.getId() != null) knowledgeById.put(knowledge.getId(), knowledge);
        }

        Map<Long, LearningPlan> planById = new HashMap<>();
        for (LearningPlan plan : storageService.getAllLearningPlans()) {
            if (plan.getId() != null) planById.put(plan.getId(), plan);
        }

        List<ContentRelation> relations = new RelationIndexService(getRelationIndexPath()).readAll();
        if (relations.isEmpty()) {
            relations = deriveRelationsFromKnowledge(knowledgeById.values(), planById.values());
        }

        List<Map<String, Object>> nodes = new ArrayList<>();
        Set<String> nodeIds = new LinkedHashSet<>();
        for (ContentRef ref : refs) {
            if (includeTypes != null && !includeTypes.contains(ref.type())) continue;
            Map<String, Object> node = new LinkedHashMap<>();
            node.put("id", ref.id());
            node.put("type", ref.type());
            node.put("sourceId", ref.sourceId());
            node.put("title", ref.title());
            node.put("category", ref.category());
            node.put("tags", ref.tags());
            if ("knowledge".equals(ref.type()) && ref.sourceId() != null) {
                Knowledge knowledge = knowledgeById.get(Long.valueOf(ref.sourceId()));
                node.put("summary", knowledge != null ? knowledge.getSummary() : null);
                node.put("linkedCount", knowledge != null && knowledge.getLinkedKnowledgeIds() != null
                        ? knowledge.getLinkedKnowledgeIds().size() : 0);
                node.put("sourceCount", knowledge != null && knowledge.getSourceClipIds() != null
                        ? knowledge.getSourceClipIds().size() : 0);
            } else if ("learning-plan".equals(ref.type()) && ref.sourceId() != null) {
                LearningPlan plan = planById.get(Long.valueOf(ref.sourceId()));
                node.put("summary", plan != null ? plan.getGoal() : null);
                int[] counts = plan != null ? countPlanLinks(plan) : new int[]{0, 0};
                node.put("linkedCount", counts[0]);
                node.put("sourceCount", counts[1]);
                node.put("phaseCount", plan != null && plan.getPhases() != null ? plan.getPhases().size() : 0);
            } else {
                node.put("summary", null);
                node.put("linkedCount", 0);
                node.put("sourceCount", 0);
            }
            nodeIds.add(ref.id());
            nodes.add(node);
        }

        List<Map<String, Object>> links = new ArrayList<>();
        for (ContentRelation relation : relations) {
            if (!nodeIds.contains(relation.fromId()) || !nodeIds.contains(relation.toId())) continue;
            Map<String, Object> link = new LinkedHashMap<>();
            link.put("source", relation.fromId());
            link.put("target", relation.toId());
            link.put("type", relation.relationType());
            links.add(link);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("nodes", nodes);
        result.put("links", links);
        return result;
    }

    /** 从权威字段派生关系（relation-index 为空时的兜底）。 */
    private List<ContentRelation> deriveRelationsFromKnowledge(Collection<Knowledge> knowledges,
                                                               Collection<LearningPlan> plans) {
        List<ContentRelation> relations = new ArrayList<>();
        LocalDateTime now = LocalDateTime.now();
        for (Knowledge knowledge : knowledges) {
            if (knowledge.getId() == null) continue;
            String kid = "knowledge:" + knowledge.getId();
            if (knowledge.getSourceClipIds() != null) {
                for (Long clipId : knowledge.getSourceClipIds()) {
                    if (clipId != null) {
                        relations.add(new ContentRelation("clip:" + clipId, kid,
                                "derived_from", "clip_to_knowledge", 1.0, now));
                    }
                }
            }
            if (knowledge.getLinkedKnowledgeIds() != null) {
                for (Long linkedId : knowledge.getLinkedKnowledgeIds()) {
                    if (linkedId != null && !linkedId.equals(knowledge.getId())) {
                        relations.add(new ContentRelation(kid, "knowledge:" + linkedId,
                                "linked_to", "wikilink", 1.0, now));
                    }
                }
            }
        }
        for (LearningPlan plan : plans) {
            if (plan.getId() == null) continue;
            String pid = "learning-plan:" + plan.getId();
            if (plan.getPhases() != null) {
                for (Phase phase : plan.getPhases()) {
                    if (phase.getLinkedKnowledgeIds() != null) {
                        for (Long kid : phase.getLinkedKnowledgeIds()) {
                            if (kid != null) {
                                relations.add(new ContentRelation(pid, "knowledge:" + kid,
                                        "plan_links", "learning_plan_link", 1.0, now));
                            }
                        }
                    }
                    if (phase.getSourceClipIds() != null) {
                        for (Long cid : phase.getSourceClipIds()) {
                            if (cid != null) {
                                relations.add(new ContentRelation(pid, "clip:" + cid,
                                        "plan_links", "learning_plan_link", 1.0, now));
                            }
                        }
                    }
                }
            }
        }
        return relations;
    }

    /** 统计学习计划各阶段关联的去重知识数/去重剪藏数。 */
    private int[] countPlanLinks(LearningPlan plan) {
        Set<Long> knowledgeIds = new LinkedHashSet<>();
        Set<Long> clipIds = new LinkedHashSet<>();
        if (plan.getPhases() != null) {
            for (Phase phase : plan.getPhases()) {
                if (phase.getLinkedKnowledgeIds() != null) knowledgeIds.addAll(phase.getLinkedKnowledgeIds());
                if (phase.getSourceClipIds() != null) clipIds.addAll(phase.getSourceClipIds());
            }
        }
        return new int[]{knowledgeIds.size(), clipIds.size()};
    }
}