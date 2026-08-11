package com.example.clip.index;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 工作台内容自动关联（manual_input 来源）测试。
 * <p>
 * 验证：1. 创建 WorkspaceMembership 时 source="manual_input" 能正确持久化
 *       2. resolve() 方法能正确区分 "manual_input" 和 "manual" 来源
 *       3. contentSources 映射中标记为 "manual_input"
 * </p>
 */
class WorkspaceContentAutoAssociationTest {

    @TempDir
    Path tempDir;

    private final LocalDateTime now = LocalDateTime.of(2026, 8, 11, 10, 0);

    @Test
    void persistsAndResolvesManualInputMembership() {
        WorkspaceIndexService wsService = new WorkspaceIndexService(tempDir);
        WorkspaceRuleService ruleService = new WorkspaceRuleService(tempDir);

        // 创建测试工作台
        wsService.saveWorkspace(new Workspace("w1", "测试工作台", "测试", "#2383e2",
                "project", "active", false, false, 0, now, now));

        // 创建测试内容
        List<ContentRef> refs = List.of(
                ref("clip:1", "clip", "Java 开发", "开发", List.of("Java"), now),
                ref("clip:2", "clip", "Spring 学习", "学习", List.of("Spring"), now));

        // 添加 manual_input 成员关系（模拟工作台输入）
        wsService.addMember(new WorkspaceMembership("w1", "clip:1", "manual_input",
                "工作台输入", 1.0, null, 0, now, now));

        // 添加 manual 成员关系（模拟拖拽指派）
        wsService.addMember(new WorkspaceMembership("w1", "clip:2", "manual",
                "看板拖拽", 1.0, null, 0, now, now));

        // 验证成员关系已持久化
        List<WorkspaceMembership> members = wsService.members("w1");
        assertEquals(2, members.size());

        // 验证 resolve() 能正确区分来源
        WorkspaceResolution resolution = ruleService.resolve("w1", refs, members, List.of());
        assertEquals(2, resolution.visibleCount());

        // 验证 contentSources 标记
        assertEquals("manual_input", resolution.contentSources().get("clip:1"),
                "manual_input 来源应标记为 manual_input");
        assertEquals("manual", resolution.contentSources().get("clip:2"),
                "manual 来源应标记为 manual");
    }

    @Test
    void resolvesManualInputWithRuleMatchedContent() {
        WorkspaceIndexService wsService = new WorkspaceIndexService(tempDir);
        WorkspaceRuleService ruleService = new WorkspaceRuleService(tempDir);

        // 创建测试工作台
        wsService.saveWorkspace(new Workspace("w2", "混合工作台", "混合", "#2383e2",
                "project", "active", false, false, 0, now, now));

        // 创建测试内容：clip:1 规则命中，clip:2 manual_input，clip:3 manual
        List<ContentRef> refs = List.of(
                ref("clip:1", "clip", "Java 后端", "开发", List.of("Java"), now),
                ref("clip:2", "clip", "Python 学习", "学习", List.of("Python"), now),
                ref("clip:3", "clip", "Rust 项目", "开发", List.of("Rust"), now));

        // 添加规则：tag 包含 Java
        ruleService.saveRule(new WorkspaceRule("r1", "w2", "tag", "contains", "Java", true, now, now));

        // 添加成员关系
        List<WorkspaceMembership> members = List.of(
                new WorkspaceMembership("w2", "clip:2", "manual_input", "工作台输入", 1.0, null, 0, now, now),
                new WorkspaceMembership("w2", "clip:3", "manual", "看板拖拽", 1.0, null, 0, now, now));

        // 解析
        WorkspaceResolution resolution = ruleService.resolve("w2", refs, members, List.of());

        // 三种来源的内容都应可见
        assertEquals(3, resolution.visibleCount());

        // 验证来源标记
        assertEquals("rule", resolution.contentSources().get("clip:1"),
                "规则命中应标记为 rule");
        assertEquals("manual_input", resolution.contentSources().get("clip:2"),
                "工作台输入应标记为 manual_input");
        assertEquals("manual", resolution.contentSources().get("clip:3"),
                "拖拽指派应标记为 manual");
    }

    @Test
    void addMemberStoresSourceCorrectly() {
        WorkspaceIndexService wsService = new WorkspaceIndexService(tempDir);

        wsService.saveWorkspace(new Workspace("w3", "测试", "测试", "#2383e2",
                "project", "active", false, false, 0, now, now));

        // 添加 manual_input 成员
        wsService.addMember(new WorkspaceMembership("w3", "clip:1", "manual_input",
                "工作台输入", 1.0, null, 0, now, now));

        // 从文件中读取并验证
        List<WorkspaceMembership> members = wsService.members("w3");
        assertEquals(1, members.size());
        assertEquals("manual_input", members.get(0).source());
        assertEquals("clip:1", members.get(0).contentId());
        assertEquals("w3", members.get(0).workspaceId());
    }

    @Test
    void removeMemberCleansUpManualInput() {
        WorkspaceIndexService wsService = new WorkspaceIndexService(tempDir);

        wsService.saveWorkspace(new Workspace("w4", "测试", "测试", "#2383e2",
                "project", "active", false, false, 0, now, now));

        // 添加后删除
        wsService.addMember(new WorkspaceMembership("w4", "clip:1", "manual_input",
                "工作台输入", 1.0, null, 0, now, now));
        assertEquals(1, wsService.members("w4").size());

        wsService.removeMember("w4", "clip:1");
        assertTrue(wsService.members("w4").isEmpty());
    }

    private ContentRef ref(String id, String type, String title, String category, List<String> tags, LocalDateTime updatedAt) {
        return new ContentRef(id, type, id, title, category, tags, "source/" + id,
                updatedAt.minusDays(1), updatedAt, "body");
    }
}