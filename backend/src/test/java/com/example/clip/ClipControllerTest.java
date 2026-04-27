package com.example.clip;

import com.example.clip.controller.ClipController;
import com.example.clip.core.AiService;
import com.example.clip.dto.ClipRequest;
import com.example.clip.model.ClipContent;
import com.example.clip.service.ClipService;
import com.example.clip.service.ContentOrganizeService;
import com.example.clip.service.PromptConfigService;
import com.example.clip.service.SearchService;
import com.example.clip.service.WeeklyReportService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Collections;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
}
