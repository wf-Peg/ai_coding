package com.example.clip;

import com.example.clip.controller.WorkspaceController;
import com.example.clip.index.ContentIndexService;
import com.example.clip.index.ContentRef;
import com.example.clip.index.Project;
import com.example.clip.index.ProjectIndexService;
import com.example.clip.index.Workspace;
import com.example.clip.index.WorkspaceIndexService;
import com.example.clip.index.WorkspaceRule;
import com.example.clip.service.FeaturePointsService;
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
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.times;
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

        var response = controller().overview(null, List.of("clip"), "后端");

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
    void rulesCanBeCreatedAndReturnedWithServerOwnedFields() {
        WorkspaceIndexService indexService = new WorkspaceIndexService(tempDir.resolve("index"));
        LocalDateTime now = LocalDateTime.now();
        indexService.saveWorkspace(new Workspace("ws-1", "工作台", "", "#fff", "general", "active", false, false, 0, now, now));

        var response = controller().createRule("ws-1", new WorkspaceController.RuleRequest("tag", "contains", "Java", true, null, null));

        assertEquals(201, response.getStatusCode().value());
        assertNotNull(response.getBody());
        WorkspaceRule rule = (WorkspaceRule) response.getBody();
        assertEquals("ws-1", rule.workspaceId());
        assertFalse(rule.id().isBlank());
        assertNotNull(rule.createdAt());
        assertNotNull(rule.updatedAt());
    }

    @Test
    void invalidRuleReturnsUnifiedBadRequest() {
        LocalDateTime now = LocalDateTime.now();
        new WorkspaceIndexService(tempDir.resolve("index")).saveWorkspace(
                new Workspace("ws-1", "工作台", "", "#fff", "general", "active", false, false, 0, now, now));
        var response = controller().createRule("ws-1", new WorkspaceController.RuleRequest("invalid", "contains", "Java", true, null, null));

        assertEquals(400, response.getStatusCode().value());
        Map<String, Object> body = (Map<String, Object>) response.getBody();
        assertEquals("error", body.get("status"));
        assertTrue(body.containsKey("message"));
    }

    @Test
    void resolutionOmitsContentBodiesAndIncludesStatistics() {
        Path indexDir = tempDir.resolve("index");
        LocalDateTime now = LocalDateTime.now();
        new WorkspaceIndexService(indexDir).saveWorkspace(new Workspace("ws-1", "工作台", "", "#fff", "general", "active", false, false, 0, now, now));
        new ContentIndexService(indexDir.resolve("content-index.json")).rebuild(List.of(
                new ContentRef("clip:1", "clip", "1", "Java", "", List.of(), "clips/1.json", now, now, "正文")
        ));
        controller().createRule("ws-1", new WorkspaceController.RuleRequest("type", "equals", "clip", true, null, null));

        var response = controller().resolution("ws-1");

        assertEquals(200, response.getStatusCode().value());
        Map<String, Object> body = (Map<String, Object>) response.getBody();
        assertEquals(1, ((List<?>) body.get("contents")).size());
        assertFalse(body.toString().contains("正文"));
        assertEquals(1, body.get("visibleCount"));
    }

    @Test
    void missingWorkspaceReturnsNotFound() {
        var response = controller().rules("missing");

        assertEquals(404, response.getStatusCode().value());
        Map<String, Object> body = (Map<String, Object>) response.getBody();
        assertEquals("error", body.get("status"));
    }

    @Test
    void overviewReturnsEmptyDataWhenIndexesDoNotExist() {
        var response = controller().overview(null, List.of(), "");

        assertEquals(200, response.getStatusCode().value());
        assertEquals(0, response.getBody().get("count"));
        assertTrue(contents(response.getBody()).isEmpty());
        assertTrue(projects(response.getBody()).isEmpty());
    }

    @Test
    void overviewWithWorkspaceIdReturnsContentStats() {
        Path indexDir = tempDir.resolve("index");
        LocalDateTime now = LocalDateTime.now();
        ContentIndexService contentIndex = new ContentIndexService(indexDir.resolve("content-index.json"));
        contentIndex.rebuild(List.of(
                new ContentRef("clip:1", "clip", "1", "需求", "产品", List.of("product-dev"), "clips/1.json", now, now, "body"),
                new ContentRef("todo:1", "todo", "1", "买咖啡", "生活", List.of("life"), "todos/1.json", now, now, "body"),
                new ContentRef("knowledge:1", "knowledge", "1", "架构", "技术", List.of("arch"), "knowledge/1.json", now, now, "body")
        ));
        WorkspaceIndexService indexService = new WorkspaceIndexService(indexDir);
        indexService.saveWorkspace(new Workspace("ws-1", "工作台", "", "#fff", "general", "active", false, false, 0, now, now));
        // 建一条规则匹配所有内容
        controller().createRule("ws-1", new WorkspaceController.RuleRequest("type", "in", "clip,todo,knowledge", true, null, null));

        var response = controller().overview("ws-1", null, "");

        assertEquals(200, response.getStatusCode().value());
        Map<String, Object> body = response.getBody();
        assertNotNull(body);
        assertTrue((Boolean) body.get("scoped"));
        assertEquals("ws-1", body.get("workspaceId"));
        // 内容维度统计
        @SuppressWarnings("unchecked")
        Map<String, Object> summary = (Map<String, Object>) body.get("workspaceSummary");
        assertNotNull(summary);
        assertEquals(3, summary.get("total"));
        // typeDistribution: clip=1, todo=1, knowledge=1
        @SuppressWarnings("unchecked")
        Map<String, Long> typeDist = (Map<String, Long>) summary.get("typeDistribution");
        assertNotNull(typeDist);
        assertEquals(1L, typeDist.get("clip"));
        assertEquals(1L, typeDist.get("todo"));
        assertEquals(1L, typeDist.get("knowledge"));
        // sourceDistribution: 规则命中，来源应为 rule
        @SuppressWarnings("unchecked")
        Map<String, Long> sourceDist = (Map<String, Long>) summary.get("sourceDistribution");
        assertNotNull(sourceDist);
        assertEquals(3L, sourceDist.get("rule"));
        assertEquals(3, summary.get("ruleMatched"));
    }

    @Test
    void fieldValuesIncludesWorkspaceIds() {
        Path indexDir = tempDir.resolve("index");
        LocalDateTime now = LocalDateTime.now();
        WorkspaceIndexService indexService = new WorkspaceIndexService(indexDir);
        indexService.saveWorkspace(new Workspace("ws-1", "工作台A", "", "#fff", "general", "active", false, false, 0, now, now));
        indexService.saveWorkspace(new Workspace("ws-2", "工作台B", "", "#000", "general", "active", false, false, 0, now, now));

        var response = controller().fieldValues();

        assertEquals(200, response.getStatusCode().value());
        Map<String, List<String>> body = response.getBody();
        assertNotNull(body);
        assertTrue(body.containsKey("workspace"));
        assertTrue(body.get("workspace").contains("ws-1"));
        assertTrue(body.get("workspace").contains("ws-2"));
    }

    @Test
    void overviewReportsServiceUnavailableWhenContentIndexCannotBeRead() throws Exception {
        Path indexDir = tempDir.resolve("index");
        Files.createDirectories(indexDir);
        Files.writeString(indexDir.resolve("content-index.json"), "not-json");

        var response = controller().overview(null, List.of(), "");

        assertEquals(503, response.getStatusCode().value());
        assertEquals("error", response.getBody().get("status"));
    }

    private WorkspaceController controller() {
        AppConfigService configService = mock(AppConfigService.class);
        FeaturePointsService fpService = mock(FeaturePointsService.class);
        when(configService.getConfigDirPath()).thenReturn(tempDir.toString());
        return new WorkspaceController(configService, fpService);
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
