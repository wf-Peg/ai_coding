package com.example.clip;

import com.example.clip.controller.KnowledgeController;
import com.example.clip.model.KnowledgeEntry;
import com.example.clip.service.KnowledgeService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Collections;
import java.util.List;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(KnowledgeController.class)
public class KnowledgeControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private KnowledgeService knowledgeService;

    @Test
    public void testDeriveKnowledgeSync() throws Exception {
        KnowledgeEntry entry = new KnowledgeEntry();
        entry.setId(100L);
        entry.setSourceClipId(1L);
        when(knowledgeService.deriveFromClip(1L)).thenReturn(entry);

        mockMvc.perform(post("/api/knowledge/derive/1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("success"))
                .andExpect(jsonPath("$.knowledgeId").value(100L))
                .andExpect(jsonPath("$.sourceClipId").value(1L));
    }

    @Test
    public void testDeriveKnowledgeAsync() throws Exception {
        mockMvc.perform(post("/api/knowledge/derive/1").param("async", "true"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("accepted"))
                .andExpect(jsonPath("$.clipId").value(1L));
    }

    @Test
    public void testListKnowledge() throws Exception {
        when(knowledgeService.listAll()).thenReturn(Collections.emptyList());

        mockMvc.perform(get("/api/knowledge/list"))
                .andExpect(status().isOk());
    }

    @Test
    public void testSearchKnowledge() throws Exception {
        when(knowledgeService.search(eq("java"), eq("work-company"), anyInt())).thenReturn(Collections.emptyList());

        mockMvc.perform(get("/api/knowledge/search")
                        .param("query", "java")
                        .param("category", "work-company")
                        .param("topK", "5"))
                .andExpect(status().isOk());
    }

    @Test
    public void testGetKnowledgeByIdNotFound() throws Exception {
        when(knowledgeService.getById(1L)).thenReturn(null);

        mockMvc.perform(get("/api/knowledge/1"))
                .andExpect(status().isNotFound());
    }

    @Test
    public void testGetKnowledgeBySourceClip() throws Exception {
        KnowledgeEntry entry = new KnowledgeEntry();
        entry.setId(5L);
        entry.setSourceClipId(2L);
        when(knowledgeService.getBySourceClipId(2L)).thenReturn(List.of(entry));

        mockMvc.perform(get("/api/knowledge/source/2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(5L))
                .andExpect(jsonPath("$[0].sourceClipId").value(2L));
    }
}
