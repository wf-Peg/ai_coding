package com.example.clip.service;

import com.example.clip.index.ContentIndexService;
import com.example.clip.index.ContentRef;
import com.example.clip.index.ContentRefMapper;
import com.example.clip.index.WorkspaceIndexService;
import com.example.clip.index.WorkspaceResolution;
import com.example.clip.index.WorkspaceRule;
import com.example.clip.index.WorkspaceRuleService;
import com.example.clip.model.ClipContent;
import com.example.clip.model.TodoContent;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 产品开发工作台内置规则筛选测试
 * <p>
 * 验证：tag equals product-dev / type in clip,todo / category contains product-dev
 * 三条规则能正确命中扫描落库的剪藏和待办（与 spec 5.2、初始化器对齐）。
 * </p>
 */
class ProductDevWorkspaceRulesTest {

    @TempDir
    Path tempDir;

    @Test
    void builtinRulesMatchImportedClipsAndTodos() {
        Path indexDir = tempDir.resolve("index");

        // 模拟扫描落库后的数据：剪藏带 product-dev 标签，待办 category=product-dev
        ClipContent clip = new ClipContent("设计内容", "text", "product-dev-archive", "product-dev/design");
        clip.setId(1L);
        clip.setTitle("设计文档-落库");
        clip.setTags(List.of("product-dev", "设计文档"));

        TodoContent todo = new TodoContent();
        todo.setId(2L);
        todo.setTitle("实现扫描服务");
        todo.setCategory("product-dev");
        todo.setCompleted(true);

        ContentRefMapper mapper = new ContentRefMapper();
        List<ContentRef> refs = List.of(mapper.fromClip(clip), mapper.fromTodo(todo));
        new ContentIndexService(indexDir.resolve("content-index.json")).rebuild(refs);

        // 创建 pd-builtin 工作台 + 三条内置规则（与初始化器一致）
        WorkspaceIndexService wsService = new WorkspaceIndexService(indexDir);
        WorkspaceRuleService ruleService = new WorkspaceRuleService(indexDir);
        wsService.saveWorkspace(new com.example.clip.index.Workspace(
                "pd-builtin", "产品开发", "系统自带的产品开发工作区",
                "#2383e2", "project", "active", false,
                java.time.LocalDateTime.now(), java.time.LocalDateTime.now()));
        java.time.LocalDateTime now = java.time.LocalDateTime.now();
        ruleService.saveRule(new WorkspaceRule("pd-rule-tag", "pd-builtin", "tag", "equals", "product-dev", true, now, now));
        ruleService.saveRule(new WorkspaceRule("pd-rule-type", "pd-builtin", "type", "in", "clip,todo", true, now, now));
        ruleService.saveRule(new WorkspaceRule("pd-rule-category", "pd-builtin", "category", "contains", "product-dev", true, now, now));

        WorkspaceResolution resolution = wsService.resolveWorkspace("pd-builtin", refs, List.of());

        // 剪藏和待办都应命中规则
        assertEquals(2, resolution.visibleCount(), "剪藏和待办都应被内置规则命中");
        List<String> visibleTypes = resolution.visible().stream().map(ContentRef::type).sorted().toList();
        assertEquals(List.of("clip", "todo"), visibleTypes);
        assertTrue(resolution.visible().stream().allMatch(ref ->
                "rule".equals(resolution.contentSources().get(ref.id()))), "两个内容都应来自规则命中");
    }

    @Test
    void builtinExpression_structureAndResolution() {
        Path indexDir = tempDir.resolve("index");
        WorkspaceIndexService wsService = new WorkspaceIndexService(indexDir);
        WorkspaceRuleService ruleService = new WorkspaceRuleService(indexDir);
        wsService.saveWorkspace(new com.example.clip.index.Workspace(
                "pd-builtin", "产品开发", "系统自带的产品开发工作区",
                "#2383e2", "project", "active", false,
                java.time.LocalDateTime.now(), java.time.LocalDateTime.now()));
        java.time.LocalDateTime now = java.time.LocalDateTime.now();
        ruleService.saveRule(new WorkspaceRule("pd-rule-tag", "pd-builtin", "tag", "equals", "product-dev", true, now, now));
        ruleService.saveRule(new WorkspaceRule("pd-rule-type", "pd-builtin", "type", "in", "clip,todo", true, now, now));
        ruleService.saveRule(new WorkspaceRule("pd-rule-category", "pd-builtin", "category", "contains", "product-dev", true, now, now));
        // 与 ProductDevWorkspaceInitializer 一致的内置表达式
        ruleService.saveExpression(new com.example.clip.index.RuleExpression("pd-builtin", "AND",
                List.of(
                        new com.example.clip.index.RuleGroup("pd-group-1", "OR", List.of("pd-rule-tag", "pd-rule-category")),
                        new com.example.clip.index.RuleGroup("pd-group-2", "AND", List.of("pd-rule-type")))));

        com.example.clip.index.RuleExpression expr = ruleService.getExpression("pd-builtin");
        assertEquals("AND", expr.relation());
        assertEquals(2, expr.groups().size());
        assertEquals("OR", expr.groups().get(0).relation());
        assertEquals(List.of("pd-rule-tag", "pd-rule-category"), expr.groups().get(0).ruleIds());
        assertEquals("AND", expr.groups().get(1).relation());
        assertEquals(List.of("pd-rule-type"), expr.groups().get(1).ruleIds());

        // todo 无 tag 但 category=product-dev、type=todo → 命中；clip tag+category+type 全命中
        List<ContentRef> refs = List.of(
                new ContentRef("clip:1", "clip", "1", "设计", "product-dev/design",
                        List.of("product-dev"), null, now, now, "body"),
                new ContentRef("todo:1", "todo", "1", "任务", "product-dev",
                        List.of(), null, now, now, "body"));
        WorkspaceResolution resolution = ruleService.resolve("pd-builtin", refs, List.of(), List.of());
        assertEquals(2, resolution.visibleCount(), "todo 经 category 规则命中，clip 全命中");
        assertEquals(List.of("clip:1", "todo:1"),
                resolution.visible().stream().map(ContentRef::id).sorted().toList());
    }
}
