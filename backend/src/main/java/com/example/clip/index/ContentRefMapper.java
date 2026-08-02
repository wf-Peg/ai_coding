package com.example.clip.index;

import com.example.clip.model.ClipContent;
import com.example.clip.model.KnowledgeEntry;
import com.example.clip.model.TodoContent;

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
                clip.getTitle(),
                clip.getCategory(),
                safeTags(clip.getTags()),
                clip.getSourceFilePath(),
                clip.getCreatedAt(),
                null,
                null
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
                knowledge.getTitle(),
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
                todo.getTitle(),
                todo.getCategory(),
                List.of(),
                null,
                todo.getCreatedAt(),
                null,
                null
        );
    }

    private static String typedId(String type, Long id) {
        return type + ":" + id;
    }

    private static List<String> safeTags(List<String> tags) {
        return tags == null ? List.of() : tags.stream().filter(tag -> tag != null && !tag.isBlank()).toList();
    }
}
