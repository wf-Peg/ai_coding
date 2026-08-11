package com.example.clip.index;

import com.example.clip.model.ClipContent;
import com.example.clip.model.KnowledgeEntry;
import com.example.clip.model.TodoContent;
import com.example.clip.model.LearningPlan;

import java.util.List;

/** Converts existing business entities into metadata-only index references. */
public class ContentRefMapper {

    public ContentRef fromClip(ClipContent clip) {
        if (clip == null || clip.getId() == null) {
            throw new IllegalArgumentException("clip and clip id are required");
        }
        return new ContentRef(
                typedId("clip", clip.getId()),
                "clip",
                String.valueOf(clip.getId()),
                resolveTitle(clip.getTitle(), clip.getContent(), "clip", clip.getId()),
                clip.getCategory(),
                safeTags(clip.getTags()),
                clip.getSourceFilePath(),
                clip.getCreatedAt(),
                null,
                null,
                clip.getWorkflowStatus()
        );
    }

    public ContentRef fromKnowledge(KnowledgeEntry knowledge) {
        if (knowledge == null || knowledge.getId() == null) {
            throw new IllegalArgumentException("knowledge and knowledge id are required");
        }
        return new ContentRef(
                typedId("knowledge", knowledge.getId()),
                "knowledge",
                String.valueOf(knowledge.getId()),
                resolveTitle(knowledge.getTitle(), null, "knowledge", knowledge.getId()),
                knowledge.getCategory(),
                safeTags(knowledge.getTags()),
                null,
                knowledge.getCreatedAt(),
                null,
                null
        );
    }

    public ContentRef fromTodo(TodoContent todo) {
        if (todo == null || todo.getId() == null) {
            throw new IllegalArgumentException("todo and todo id are required");
        }
        return new ContentRef(
                typedId("todo", todo.getId()),
                "todo",
                String.valueOf(todo.getId()),
                resolveTitle(todo.getTitle(), null, "todo", todo.getId()),
                todo.getCategory(),
                List.of(),
                null,
                todo.getCreatedAt(),
                null,
                null
        );
    }

    public ContentRef fromLearningPlan(LearningPlan plan) {
        if (plan == null || plan.getId() == null) {
            throw new IllegalArgumentException("learning plan and plan id are required");
        }
        return new ContentRef(
                typedId("learning-plan", plan.getId()),
                "learning-plan",
                String.valueOf(plan.getId()),
                resolveTitle(plan.getTitle(), null, "learning-plan", plan.getId()),
                plan.getCategory(),
                safeTags(plan.getTags()),
                null,
                plan.getCreatedAt(),
                plan.getUpdatedAt(),
                null
        );
    }

    private static String resolveTitle(String title, String content, String entityType, Long id) {
        if (title != null && !title.isBlank()) {
            return title;
        }
        if (content != null && !content.isBlank()) {
            String truncated = content.replaceAll("<[^>]+>", "").trim();
            if (truncated.length() > 60) {
                truncated = truncated.substring(0, 60) + "...";
            }
            if (!truncated.isBlank()) {
                return truncated;
            }
        }
        String label = switch (entityType) {
            case "clip" -> "剪藏";
            case "todo" -> "待办事项";
            case "knowledge" -> "知识条目";
            case "learning-plan" -> "学习计划";
            default -> "内容";
        };
        return label + " #" + id;
    }

    private static String typedId(String type, Long id) {
        return type + ":" + id;
    }

    private static List<String> safeTags(List<String> tags) {
        return tags == null ? List.of() : tags.stream().filter(tag -> tag != null && !tag.isBlank()).toList();
    }
}
