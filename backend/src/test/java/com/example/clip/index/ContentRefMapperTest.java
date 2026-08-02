package com.example.clip.index;

import com.example.clip.model.ClipContent;
import com.example.clip.model.KnowledgeEntry;
import com.example.clip.model.TodoContent;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class ContentRefMapperTest {

    private final ContentRefMapper mapper = new ContentRefMapper();

    @Test
    void mapsClipWithoutCopyingBody() {
        ClipContent clip = new ClipContent();
        clip.setId(1001L);
        clip.setTitle("Java Stream");
        clip.setCategory("study");
        clip.setTags(List.of("java", "stream"));
        clip.setContent("large body");

        ContentRef ref = mapper.fromClip(clip);

        assertEquals("clip:1001", ref.id());
        assertEquals("clip", ref.type());
        assertEquals("1001", ref.sourceId());
        assertEquals("Java Stream", ref.title());
        assertEquals("study", ref.category());
        assertEquals(List.of("java", "stream"), ref.tags());
        assertNull(ref.content());
    }

    @Test
    void mapsKnowledgeAndTodoToStableTypedIds() {
        KnowledgeEntry knowledge = new KnowledgeEntry();
        knowledge.setId(2001L);
        knowledge.setTitle("Streams are lazy");
        knowledge.setCategory("study");

        TodoContent todo = new TodoContent();
        todo.setId(3001L);
        todo.setTitle("Review streams");
        todo.setCategory("study");

        assertEquals("knowledge:2001", mapper.fromKnowledge(knowledge).id());
        assertEquals("todo:3001", mapper.fromTodo(todo).id());
    }

    @Test
    void mapsMissingOptionalFieldsWithoutThrowing() {
        ClipContent clip = new ClipContent();
        clip.setId(1002L);

        ContentRef ref = mapper.fromClip(clip);

        assertEquals("clip:1002", ref.id());
        assertEquals(List.of(), ref.tags());
        assertNull(ref.title());
    }
}
