package com.example.clip;

import com.example.clip.controller.ClipController;
import com.example.clip.core.AiService;
import com.example.clip.model.ClipContent;
import com.example.clip.service.ClipService;
import com.example.clip.service.ContentOrganizeService;
import com.example.clip.service.PromptConfigService;
import com.example.clip.service.SearchService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Collections;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
}
