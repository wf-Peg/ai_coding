package com.example.clip.util;

import com.example.clip.index.ContentIndexService;
import com.example.clip.index.ContentRef;
import com.example.clip.index.WorkspaceIndexService;
import com.example.clip.index.WorkspaceResolution;
import com.example.clip.service.AppConfigService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 工作台筛选工具类。
 * <p>
 * 提供通用的根据工作台规则筛选列表的方法，避免在多个 Controller 中重复实现相同逻辑。
 * 所有 Controller 共享同一个筛选逻辑，减少代码重复。
 * </p>
 */
public class WorkspaceFilterUtils {

    private static final Logger log = LoggerFactory.getLogger(WorkspaceFilterUtils.class);

    /**
     * 根据工作台规则筛选内容列表。
     * <p>
     * 通用算法：读取 content-index.json → 解析工作台可见内容 → 获取允许的 ID → 过滤输入列表。
     * </p>
     *
     * @param items         原始内容列表
     * @param workspaceId   工作台 ID
     * @param appConfigService 应用配置服务，用于获取配置目录路径
     * @param idExtractor   从内容对象提取 ID 的函数（item → id）
     * @param <T>           内容类型
     * @return 筛选后的内容列表
     */
    public static <T> List<T> filterByWorkspace(
            List<T> items,
            String workspaceId,
            AppConfigService appConfigService,
            Function<T, Long> idExtractor) {
        try {
            Path indexDir = Path.of(appConfigService.getConfigDirPath(), "index");
            ContentIndexService contentIndexService = new ContentIndexService(indexDir.resolve("content-index.json"));
            List<ContentRef> allRefs = contentIndexService.readAll();
            WorkspaceResolution resolution = new WorkspaceIndexService(indexDir)
                    .resolveWorkspace(workspaceId, allRefs, List.of());
            Set<String> allowedIds = resolution.visible().stream()
                    .map(ContentRef::id)
                    .collect(Collectors.toSet());
            return items.stream()
                    .filter(item -> {
                        Long id = idExtractor.apply(item);
                        if (id == null) {
                            return false;
                        }
                        // 猜测类型前缀：clip/todo/knowledge/learning-plan
                        // 根据命名惯例推断前缀
                        String typePrefix = item.getClass().getSimpleName();
                        if (typePrefix.equals("ClipContent")) {
                            typePrefix = "clip";
                        } else if (typePrefix.equals("TodoContent")) {
                            typePrefix = "todo";
                        } else if (typePrefix.equals("Knowledge")) {
                            typePrefix = "knowledge";
                        } else if (typePrefix.equals("LearningPlan")) {
                            typePrefix = "learning-plan";
                        } else {
                            // 小写转换
                            typePrefix = typePrefix.substring(0, 1).toLowerCase() + typePrefix.substring(1);
                        }
                        return allowedIds.contains(typePrefix + ":" + id);
                    })
                    .collect(Collectors.toList());
        } catch (Exception e) {
            log.warn("Workspace filter failed for workspaceId={}: {}", workspaceId, e.getMessage());
            return List.of();
        }
    }

    private WorkspaceFilterUtils() {
        // 工具类不允许实例化
    }
}
