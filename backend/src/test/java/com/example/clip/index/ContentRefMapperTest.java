package com.example.clip.index;

import com.example.clip.model.ClipContent;
import com.example.clip.model.TodoContent;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ContentRefMapperTest {

    private ContentRefMapper mapper;

    @BeforeEach
    void setUp() {
        mapper = new ContentRefMapper();
    }

    @Test
    void mapsClipWithNullTitleUsingContentFallback() {
        ClipContent clip = new ClipContent();
        clip.setId(1003L);
        clip.setContent("这是一段很长的剪藏内容正文，用于测试标题为空时的内容回退策略");

        ContentRef ref = mapper.fromClip(clip);

        assertEquals("clip:1003", ref.id());
        assertEquals("这是一段很长的剪藏内容正文，用于测试标题为空时的内容回退策略", ref.title());
    }

    @Test
    void mapsClipWithNullTitleAndNullContentUsingIdFallback() {
        ClipContent clip = new ClipContent();
        clip.setId(1004L);

        ContentRef ref = mapper.fromClip(clip);

        assertEquals("clip:1004", ref.id());
        assertEquals("剪藏 #1004", ref.title());
    }

    @Test
    void mapsTodoWithNullTitleUsingIdFallback() {
        TodoContent todo = new TodoContent();
        todo.setId(3002L);

        ContentRef ref = mapper.fromTodo(todo);

        assertEquals("todo:3002", ref.id());
        assertEquals("待办事项 #3002", ref.title());
    }

    @Test
    void mapsClipWithTitlePriority() {
        ClipContent clip = new ClipContent();
        clip.setId(1005L);
        clip.setTitle("已有标题");
        clip.setContent("这是正文内容，不应该被使用");

        ContentRef ref = mapper.fromClip(clip);

        assertEquals("已有标题", ref.title());
    }
}