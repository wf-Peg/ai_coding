package com.example.clip;

import com.example.clip.controller.ClipController;
import com.example.clip.core.AiService;
import com.example.clip.dto.ClipRequest;
import com.example.clip.model.ClipContent;
import com.example.clip.model.TodoContent;
import com.example.clip.service.ClipService;
import com.example.clip.service.ContentOrganizeService;
import com.example.clip.service.PromptConfigService;
import com.example.clip.service.SearchService;
import com.example.clip.service.ExceptionLogService;
import com.example.clip.service.WeeklyReportService;
import com.example.clip.service.TodoService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Collections;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * ClipController测试类
 */
@WebMvcTest(ClipController.class)
public class ClipControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ClipService clipService;

    @MockBean
    private SearchService searchService;

    @MockBean
    private AiService aiService;

    @MockBean
    private ContentOrganizeService contentOrganizeService;

    @MockBean
    private PromptConfigService promptConfigService;

    @MockBean
    private WeeklyReportService weeklyReportService;

    @MockBean
    private TodoService todoService;

    @MockBean
    private ExceptionLogService exceptionLogService;

    /**
     * 测试获取分类列表
     */
    @Test
    public void testGetCategories() throws Exception {
        mockMvc.perform(get("/api/clip/categories"))
                .andExpect(status().isOk());
    }

    /**
     * 测试获取剪藏列表
     */
    @Test
    public void testGetClipList() throws Exception {
        when(clipService.getAllClips()).thenReturn(Collections.emptyList());
        
        mockMvc.perform(get("/api/clip/list"))
                .andExpect(status().isOk());
    }

    /**
     * 测试搜索功能
     */
    @Test
    public void testSearch() throws Exception {
        when(searchService.search("test", 5)).thenReturn(Collections.emptyList());
        
        mockMvc.perform(get("/api/clip/search")
                .param("query", "test")
                .param("topK", "5"))
                .andExpect(status().isOk());
    }

    @Test
    public void testAddClipDefaultsToInboxAndAcceptsStructuredFields() throws Exception {
        ClipContent clip = new ClipContent();
        clip.setId(1L);
        clip.setCategory("inbox");

        when(clipService.saveClip(any(ClipRequest.class))).thenReturn(clip);

        String body = """
                {
                  "type": "ai-text",
                  "content": "test content",
                  "sourceUrl": "https://example.com/article",
                  "title": "Example title",
                  "siteName": "example.com",
                  "capturedAt": "2026-04-27T12:00:00+08:00",
                  "selectedText": "selected text",
                  "contextBefore": "before",
                  "contextAfter": "after",
                  "captureMethod": "shortcut"
                }
                """;

        mockMvc.perform(post("/api/clip/add")
                .contentType("application/json")
                .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("success"))
                .andExpect(jsonPath("$.id").value(1L));
    }

    @Test
    public void testOrganizeInbox() throws Exception {
        when(clipService.organizeInbox(any())).thenReturn(Map.of(
                "status", "success",
                "mode", "auto",
                "organizedCount", 2
        ));

        mockMvc.perform(post("/api/clip/organize-inbox")
                        .contentType("application/json")
                        .content("{\"mode\":\"auto\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("success"))
                .andExpect(jsonPath("$.mode").value("auto"))
                .andExpect(jsonPath("$.organizedCount").value(2));
    }

    @Test
    public void testOrganizeSingleClip() throws Exception {
        when(clipService.organizeClip(eq(1L), any())).thenReturn(Map.of(
                "status", "success",
                "mode", "manual",
                "clipId", 1
        ));

        mockMvc.perform(post("/api/clip/organize/1")
                        .contentType("application/json")
                        .content("{\"mode\":\"manual\",\"type\":\"ai-text\",\"category\":\"work-company\",\"tags\":[\"a\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("success"))
                .andExpect(jsonPath("$.mode").value("manual"))
                .andExpect(jsonPath("$.clipId").value(1));
    }

    @Test
    public void testGetInboxClips() throws Exception {
        when(clipService.getClipsByWorkflowStatus("inbox")).thenReturn(Collections.emptyList());

        mockMvc.perform(get("/api/clip/inbox"))
                .andExpect(status().isOk());
    }

    @Test
    public void testGetClipByIdForEditor() throws Exception {
        ClipContent clip = new ClipContent();
        clip.setId(3L);
        clip.setContent("{\"ok\":true}");
        clip.setContentFormat("json");
        when(clipService.getClipById(3L)).thenReturn(clip);

        mockMvc.perform(get("/api/clip/3"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(3L))
                .andExpect(jsonPath("$.contentFormat").value("json"));
    }

    @Test
    public void testUpdateClipFromEditor() throws Exception {
        ClipContent clip = new ClipContent();
        clip.setId(3L);
        when(clipService.updateClipFromEditor(eq(3L), any())).thenReturn(clip);

        mockMvc.perform(put("/api/clip/3/editor-content")
                        .contentType("application/json")
                        .content("{\"content\":\"updated\",\"title\":\"Editor\",\"contentFormat\":\"text\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("success"))
                .andExpect(jsonPath("$.id").value(3L));
    }

    @Test
    public void testClipToTodo() throws Exception {
        ClipContent clip = new ClipContent();
        clip.setId(1L);
        clip.setTitle("source title");
        clip.setSourceUrl("https://example.com/article");
        clip.setCategory("work-company");
        when(clipService.getClipById(1L)).thenReturn(clip);

        TodoContent todo = new TodoContent();
        todo.setId(9L);
        when(todoService.saveTodo(any(TodoContent.class))).thenReturn(todo);

        mockMvc.perform(post("/api/clip/to-todo")
                        .contentType("application/json")
                        .content("{\"clipId\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("success"))
                .andExpect(jsonPath("$.todoId").value(9))
                .andExpect(jsonPath("$.sourceClipId").value(1));
    }

    @Test
    public void testDivergentSummaryGeneratedAndPersisted() throws Exception {
        ClipContent clip = new ClipContent();
        clip.setId(1L);
        clip.setContent("source content");
        clip.setCategory("work-company");
        when(clipService.getClipById(1L)).thenReturn(clip);
        when(aiService.generateDivergentSummary(eq("source content"), eq("work-company"), any())).thenReturn("new divergent");

        mockMvc.perform(get("/api/clip/divergent-summary/1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").value("new divergent"));

        verify(clipService).saveClip(clip);
    }

    @Test
    public void testDivergentSummaryReturnsCachedValue() throws Exception {
        ClipContent clip = new ClipContent();
        clip.setId(1L);
        clip.setDivergentSummary("cached divergent");
        when(clipService.getClipById(1L)).thenReturn(clip);

        mockMvc.perform(get("/api/clip/divergent-summary/1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").value("cached divergent"));

        verify(aiService, never()).generateDivergentSummary(any(), any(), any());
        verify(clipService, never()).saveClip(any(ClipContent.class));
    }
}
