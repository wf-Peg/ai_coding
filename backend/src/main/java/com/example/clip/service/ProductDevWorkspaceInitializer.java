package com.example.clip.service;

import com.example.clip.index.ContentIndexService;
import com.example.clip.index.RuleExpression;
import com.example.clip.index.RuleGroup;
import com.example.clip.index.Workspace;
import com.example.clip.index.WorkspaceIndexService;
import com.example.clip.index.WorkspaceRule;
import com.example.clip.index.WorkspaceRuleService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 产品开发工作台初始化器（唯一）
 * <p>
 * 应用启动时执行：
 * <ol>
 *   <li>扫描 TODO 目录，导入剪藏和待办</li>
 *   <li>确保产品开发工作台（pd-builtin）作为系统内置工作台存在</li>
 *   <li>确保工作台三条内置规则存在（tag equals / type in / category contains）</li>
 * </ol>
 * 属性与规则定义以 spec.md 5.1 / 5.2 和 product-dev-workspace-builtin-rules.md 为准。
 * </p>
 */
@Component
public class ProductDevWorkspaceInitializer implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(ProductDevWorkspaceInitializer.class);

    /**
     * 系统内置产品开发工作台固定 ID
     */
    public static final String PD_BUILTIN_WORKSPACE_ID = "pd-builtin";

    private static final String PD_WORKSPACE_NAME = "产品开发";
    private static final String PD_WORKSPACE_DESC = "系统自带的产品开发工作区，自动归集每次编码任务的产出";
    private static final String PD_WORKSPACE_COLOR = "#2383e2";
    private static final String PD_WORKSPACE_TYPE = "project";
    private static final String PD_TAG = "product-dev";

    private final TodoScannerService todoScannerService;
    private final AppConfigService appConfigService;
    private final FileStorageService fileStorageService;

    public ProductDevWorkspaceInitializer(
            TodoScannerService todoScannerService,
            AppConfigService appConfigService,
            FileStorageService fileStorageService) {
        this.todoScannerService = todoScannerService;
        this.appConfigService = appConfigService;
        this.fileStorageService = fileStorageService;
    }

    @Override
    public void run(String... args) {
        log.info("[ProductDevWorkspaceInitializer] 开始初始化...");

        // 1. 扫描 TODO 目录并导入
        try {
            TodoScannerService.ScanResult scanResult = todoScannerService.scanAndImport();
            log.info("[ProductDevWorkspaceInitializer] TODO 扫描结果: {}", scanResult);
        } catch (Exception e) {
            log.error("[ProductDevWorkspaceInitializer] TODO 扫描异常", e);
        }

        // 2. 重建内容索引，确保导入的数据立即可见
        try {
            Path indexDir = Path.of(appConfigService.getConfigDirPath(), "index");
            ContentIndexService indexService = new ContentIndexService(indexDir.resolve("content-index.json"));
            indexService.rebuildFromStorage(fileStorageService);
            log.info("[ProductDevWorkspaceInitializer] 内容索引已重建");
        } catch (Exception e) {
            log.error("[ProductDevWorkspaceInitializer] 索引重建异常", e);
        }

        // 3. 确保产品开发工作台存在
        try {
            ensureBuiltinWorkspace();
        } catch (Exception e) {
            log.error("[ProductDevWorkspaceInitializer] 创建工作台异常", e);
        }

        log.info("[ProductDevWorkspaceInitializer] 初始化完成");
    }

    /**
     * 确保产品开发工作台作为系统内置工作台存在
     * <p>
     * 如果 pd-builtin 工作台已存在，跳过创建；
     * 否则创建新的工作台并添加三条内置规则。
     * </p>
     */
    private void ensureBuiltinWorkspace() {
        Path indexDir = Path.of(appConfigService.getConfigDirPath(), "index");
        WorkspaceIndexService wsService = new WorkspaceIndexService(indexDir);
        WorkspaceRuleService ruleService = new WorkspaceRuleService(indexDir);

        // 检查是否已存在
        List<Workspace> existing = wsService.readAll();
        boolean exists = existing.stream()
                .anyMatch(w -> PD_BUILTIN_WORKSPACE_ID.equals(w.id()));

        if (exists) {
            log.info("[ProductDevWorkspaceInitializer] 产品开发工作台已存在，跳过创建");
            // 规则自愈：内置规则缺失时补回（指定目标分组，确保落入 pd-group-1/pd-group-2）
            ensureBuiltinRules(ruleService);
            // 表达式缺失或缺少默认分组（pd-group-1/pd-group-2）时恢复默认两组；
            // 分组结构完整的自定义修改则保留，避免每次启动强制覆盖
            RuleExpression expr = ruleService.getExpression(PD_BUILTIN_WORKSPACE_ID);
            if (expr == null || !hasDefaultGroups(expr)) {
                ensureBuiltinExpression(ruleService);
            }
            return;
        }

        // 创建工作台
        LocalDateTime now = LocalDateTime.now();
        Workspace workspace = new Workspace(
                PD_BUILTIN_WORKSPACE_ID,
                PD_WORKSPACE_NAME,
                PD_WORKSPACE_DESC,
                PD_WORKSPACE_COLOR,
                PD_WORKSPACE_TYPE,
                "active",
                false,
                false,
                0,
                now,
                now
        );

        wsService.saveWorkspace(workspace);
        log.info("[ProductDevWorkspaceInitializer] 产品开发工作台已创建: id={}", PD_BUILTIN_WORKSPACE_ID);

        // 创建内置规则
        ensureBuiltinRules(ruleService);
        ensureBuiltinExpression(ruleService);
    }

    /**
     * 判断表达式是否包含默认分组结构（pd-group-1 / pd-group-2）。
     * 分组结构完整时视为默认结构，用户修改保留；否则恢复默认两组。
     */
    private boolean hasDefaultGroups(RuleExpression expr) {
        if (expr == null || expr.groups() == null) return false;
        List<String> groupIds = expr.groups().stream().map(RuleGroup::id).toList();
        return groupIds.contains("pd-group-1") && groupIds.contains("pd-group-2");
    }

    /**
     * 写入内置规则表达式（SQL 式两级分组）：
     * (tag equals "product-dev" OR category contains "product-dev") AND type in ("clip,todo")
     * <p>
     * 效果：todo（无 tag）经 category 规则命中组1、type 命中组2 → 可见；clip 全命中 → 可见。
     * 以 workspaceId 为 key 覆盖写，重复启动幂等安全。
     * </p>
     */
    private void ensureBuiltinExpression(WorkspaceRuleService ruleService) {
        RuleExpression builtin = new RuleExpression(
                PD_BUILTIN_WORKSPACE_ID, "AND",
                List.of(
                        new RuleGroup("pd-group-1", "OR", List.of("pd-rule-tag", "pd-rule-category")),
                        new RuleGroup("pd-group-2", "AND", List.of("pd-rule-type"))));
        ruleService.saveExpression(builtin);
        log.info("[ProductDevWorkspaceInitializer] 内置规则表达式已写入: {}", builtin);
    }

    /**
     * 确保三条内置规则存在（与 spec.md 5.2 一致），并按固定 ID 检测缺失，指定目标分组补回。
     * <ol>
     *   <li>pd-rule-tag：tag equals "product-dev" → 分组 pd-group-1（核心筛选规则）</li>
     *   <li>pd-rule-type：type in "clip,todo" → 分组 pd-group-2（限定内容类型）</li>
     *   <li>pd-rule-category：category contains "product-dev" → 分组 pd-group-1（限定分类）</li>
     * </ol>
     */
    private void ensureBuiltinRules(WorkspaceRuleService ruleService) {
        List<WorkspaceRule> existingRules = ruleService.rules(PD_BUILTIN_WORKSPACE_ID);
        LocalDateTime now = LocalDateTime.now();

        // 规则 1: tag equals "product-dev"
        if (existingRules.stream().noneMatch(r -> "pd-rule-tag".equals(r.id()))) {
            ruleService.saveRule(new WorkspaceRule(
                    "pd-rule-tag", PD_BUILTIN_WORKSPACE_ID,
                    "tag", "equals", PD_TAG,
                    true, now, now), "pd-group-1");
            log.info("[ProductDevWorkspaceInitializer] 内置规则已创建: tag equals \"{}\" → pd-group-1", PD_TAG);
        }

        // 规则 2: type in "clip,todo" - 限定内容类型
        if (existingRules.stream().noneMatch(r -> "pd-rule-type".equals(r.id()))) {
            ruleService.saveRule(new WorkspaceRule(
                    "pd-rule-type", PD_BUILTIN_WORKSPACE_ID,
                    "type", "in", "clip,todo",
                    true, now, now), "pd-group-2");
            log.info("[ProductDevWorkspaceInitializer] 内置规则已创建: type in \"clip,todo\" → pd-group-2");
        }

        // 规则 3: category contains "product-dev"
        if (existingRules.stream().noneMatch(r -> "pd-rule-category".equals(r.id()))) {
            ruleService.saveRule(new WorkspaceRule(
                    "pd-rule-category", PD_BUILTIN_WORKSPACE_ID,
                    "category", "contains", PD_TAG,
                    true, now, now), "pd-group-1");
            log.info("[ProductDevWorkspaceInitializer] 内置规则已创建: category contains \"{}\" → pd-group-1", PD_TAG);
        }
    }
}
