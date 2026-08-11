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
            // 仍然确保规则存在（可能被误删）
            ensureBuiltinRules(ruleService);
            ensureBuiltinExpression(ruleService);
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
     * 确保三条内置规则存在（与 spec.md 5.2 一致）
     * <ol>
     *   <li>tag equals "product-dev" （核心筛选规则）</li>
     *   <li>type in "clip,todo" （限定内容类型）</li>
     *   <li>category contains "product-dev" （限定分类）</li>
     * </ol>
     */
    private void ensureBuiltinRules(WorkspaceRuleService ruleService) {
        List<WorkspaceRule> existingRules = ruleService.rules(PD_BUILTIN_WORKSPACE_ID);
        LocalDateTime now = LocalDateTime.now();

        // 规则 1: tag equals "product-dev"
        if (existingRules.stream().noneMatch(r -> "tag".equals(r.field()) && "equals".equals(r.operator()) && PD_TAG.equals(r.value()))) {
            WorkspaceRule rule1 = new WorkspaceRule(
                    "pd-rule-tag", PD_BUILTIN_WORKSPACE_ID,
                    "tag", "equals", PD_TAG,
                    true, now, now
            );
            ruleService.saveRule(rule1);
            log.info("[ProductDevWorkspaceInitializer] 内置规则已创建: tag equals \"{}\"", PD_TAG);
        }

        // 规则 2: type in "clip,todo" - 限定内容类型
        if (existingRules.stream().noneMatch(r -> "type".equals(r.field()) && "in".equals(r.operator()) && "clip,todo".equals(r.value()))) {
            WorkspaceRule rule2 = new WorkspaceRule(
                    "pd-rule-type", PD_BUILTIN_WORKSPACE_ID,
                    "type", "in", "clip,todo",
                    true, now, now
            );
            ruleService.saveRule(rule2);
            log.info("[ProductDevWorkspaceInitializer] 内置规则已创建: type in \"clip,todo\"");
        }

        // 规则 3: category contains "product-dev"
        if (existingRules.stream().noneMatch(r -> "category".equals(r.field()) && "contains".equals(r.operator()) && PD_TAG.equals(r.value()))) {
            WorkspaceRule rule3 = new WorkspaceRule(
                    "pd-rule-category", PD_BUILTIN_WORKSPACE_ID,
                    "category", "contains", PD_TAG,
                    true, now, now
            );
            ruleService.saveRule(rule3);
            log.info("[ProductDevWorkspaceInitializer] 内置规则已创建: category contains \"{}\"", PD_TAG);
        }
    }
}
