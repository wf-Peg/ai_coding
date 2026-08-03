package com.example.clip;

import com.example.clip.controller.WorkspaceController;
import com.example.clip.index.ContentIndexService;
import com.example.clip.index.ContentRef;
import com.example.clip.index.Project;
import com.example.clip.index.ProjectIndexService;
import com.example.clip.service.AppConfigService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class WorkspaceControllerTest {
    @TempDir
    Path tempDir;

    @Test
    void overviewFiltersSearchesAndOmitsContentBodies() {
        Path indexDir = tempDir.resolve("index");
        ContentIndexService contentIndexService = new ContentIndexService(indexDir.resolve("content-index.json"));
        contentIndexService.rebuild(List.of(
                new ContentRef("clip:1", "clip", "1", "Java 入门", "编程", List.of("后端"), "clips/1.json", LocalDateTime.now(), LocalDateTime.now(), "不得返回的正文"),
                new ContentRef("todo:1", "todo", "1", "购买咖啡", "生活", List.of("采购"), "todos/1.json", LocalDateTime.now(), LocalDateTime.now(), "不得返回的待办详情")
        ));
        new ProjectIndexService(indexDir).saveProject(new Project("project:1", "Java 项目", "只读摘要", "#569cff", "active", LocalDateTime.now(), LocalDateTime.now()));

        var response = controller().overview(List.of("clip"), "后端");

        assertEquals(200, response.getStatusCode().value());
        assertNotNull(response.getBody());
        assertEquals(1, response.getBody().get("count"));
        List<Map<String, Object>> contents = contents(response.getBody());
        assertEquals("clip:1", contents.get(0).get("id"));
        assertFalse(contents.get(0).containsKey("content"));
        assertEquals(1, projects(response.getBody()).size());
        assertTrue(((List<?>) response.getBody().get("contentTypes")).contains("learning-plan"));
    }

    @Test
    void overviewReturnsEmptyDataWhenIndexesDoNotExist() {
        var response = controller().overview(List.of(), "");

        assertEquals(200, response.getStatusCode().value());
        assertEquals(0, response.getBody().get("count"));
        assertTrue(contents(response.getBody()).isEmpty());
        assertTrue(projects(response.getBody()).isEmpty());
    }

    @Test
    void overviewReportsServiceUnavailableWhenContentIndexCannotBeRead() throws Exception {
        Path indexDir = tempDir.resolve("index");
        Files.createDirectories(indexDir);
        Files.writeString(indexDir.resolve("content-index.json"), "not-json");

        var response = controller().overview(List.of(), "");

        assertEquals(503, response.getStatusCode().value());
        assertEquals("error", response.getBody().get("status"));
    }

    private WorkspaceController controller() {
        AppConfigService configService = mock(AppConfigService.class);
        when(configService.getConfigDirPath()).thenReturn(tempDir.toString());
        return new WorkspaceController(configService);
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> contents(Map<String, Object> body) {
        return (List<Map<String, Object>>) body.get("contents");
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> projects(Map<String, Object> body) {
        return (List<Map<String, Object>>) body.get("projects");
    }
}
