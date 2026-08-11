package com.example.clip.index;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public class WorkspaceIndexService {
    private static final Logger log = LoggerFactory.getLogger(WorkspaceIndexService.class);
    private static final Set<String> WORKSPACE_TYPES = Workspace.TYPES;
    private static final Set<String> WORKSPACE_STATUSES = Set.of("active", "archived");

    private static final List<DefaultColumnDef> DEFAULT_COLUMNS = List.of(
            new DefaultColumnDef("todo", "收集", 0),
            new DefaultColumnDef("in_progress", "处理中", 1),
            new DefaultColumnDef("done", "已完成", 2)
    );

    private static final List<DefaultColumnDef> LEARNING_COLUMNS = List.of(
            new DefaultColumnDef("learning", "学习中", 0),
            new DefaultColumnDef("review", "待复习", 1),
            new DefaultColumnDef("mastered", "已掌握", 2)
    );
    record DefaultColumnDef(String key, String name, int position) {}

    private final Path workspacePath;
    private final Path membershipPath;
    private final Path columnsPath;
    private final WorkspaceRuleService ruleService;
    private final ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());

    public WorkspaceIndexService(Path indexDir) {
        this.workspacePath = indexDir.resolve("workspace.json");
        this.membershipPath = indexDir.resolve("workspace-memberships.json");
        this.columnsPath = indexDir.resolve("workspace-columns.json");
        this.ruleService = new WorkspaceRuleService(indexDir);
    }

    public synchronized void saveWorkspace(Workspace workspace) {
        validateWorkspace(workspace);
        boolean isNew = read(workspacePath, new TypeReference<List<Workspace>>() {}).stream()
                .noneMatch(item -> item.id().equals(workspace.id()));
        List<Workspace> workspaces = read(workspacePath, new TypeReference<List<Workspace>>() {});
        workspaces.removeIf(item -> item.id().equals(workspace.id()));
        workspaces.add(workspace);
        writeAll(workspacePath, workspaces);
        if (isNew) {
            initDefaultColumns(workspace.id(), workspace.type());
        }
    }

    public synchronized List<Workspace> readAll() {
        return List.copyOf(read(workspacePath, new TypeReference<List<Workspace>>() {}));
    }

    public synchronized void reorderWorkspaces(List<String> workspaceIds) {
        if (workspaceIds == null || workspaceIds.isEmpty()) return;
        List<Workspace> all = new ArrayList<>(read(workspacePath, new TypeReference<List<Workspace>>() {}));
        LocalDateTime now = LocalDateTime.now();
        for (int i = 0; i < workspaceIds.size(); i++) {
            String id = workspaceIds.get(i);
            for (int j = 0; j < all.size(); j++) {
                Workspace w = all.get(j);
                if (w.id().equals(id) && w.sortOrder() != i) {
                    all.set(j, new Workspace(w.id(), w.name(), w.description(), w.color(), w.type(), w.status(),
                            w.matchAll(), w.isDefault(), i, w.createdAt(), now));
                    break;
                }
            }
        }
        writeAll(workspacePath, all);
    }

    // ── Board Column CRUD ──

    public synchronized void initDefaultColumns(String workspaceId, String type) {
        requireText(workspaceId, "workspaceId");
        List<BoardColumn> existing = read(columnsPath, new TypeReference<List<BoardColumn>>() {});
        if (existing.stream().anyMatch(c -> c.workspaceId().equals(workspaceId))) {
            return;
        }
        LocalDateTime now = LocalDateTime.now();
        List<DefaultColumnDef> defs = "learning".equals(type) ? LEARNING_COLUMNS : DEFAULT_COLUMNS;
        for (DefaultColumnDef def : defs) {
            BoardColumn col = new BoardColumn(UUID.randomUUID().toString(), workspaceId, def.key, def.name,
                    def.position, def.position == 0, now, now);
            existing.add(col);
        }
        writeAll(columnsPath, existing);
    }

    public synchronized List<BoardColumn> columns(String workspaceId) {
        requireText(workspaceId, "workspaceId");
        return read(columnsPath, new TypeReference<List<BoardColumn>>() {}).stream()
                .filter(item -> item.workspaceId().equals(workspaceId))
                .sorted((a, b) -> Integer.compare(a.position(), b.position()))
                .toList();
    }

    public synchronized void saveColumn(BoardColumn column) {
        column.validate();
        List<BoardColumn> values = read(columnsPath, new TypeReference<List<BoardColumn>>() {});
        values.removeIf(item -> item.id().equals(column.id()));
        values.add(column);
        writeAll(columnsPath, values);
    }

    public synchronized void deleteColumn(String columnId) {
        requireText(columnId, "columnId");
        writeAll(columnsPath, read(columnsPath, new TypeReference<List<BoardColumn>>() {}).stream()
                .filter(item -> !item.id().equals(columnId)).toList());
    }

    public synchronized void deleteWorkspaceColumns(String workspaceId) {
        requireText(workspaceId, "workspaceId");
        writeAll(columnsPath, read(columnsPath, new TypeReference<List<BoardColumn>>() {}).stream()
                .filter(item -> !item.workspaceId().equals(workspaceId)).toList());
    }

    // ── Membership with board column ──

    public synchronized void addMember(WorkspaceMembership member) {
        validateMembership(member);
        List<WorkspaceMembership> members = read(membershipPath, new TypeReference<List<WorkspaceMembership>>() {});
        members.removeIf(item -> item.workspaceId().equals(member.workspaceId())
                && item.contentId().equals(member.contentId()));
        members.add(member);
        writeAll(membershipPath, members);
    }

    public synchronized void moveMember(String workspaceId, String contentId, String boardColumnId, int position) {
        requireText(workspaceId, "workspaceId");
        requireText(contentId, "contentId");
        List<WorkspaceMembership> members = read(membershipPath, new TypeReference<List<WorkspaceMembership>>() {});
        boolean found = false;
        for (int i = 0; i < members.size(); i++) {
            WorkspaceMembership m = members.get(i);
            if (m.workspaceId().equals(workspaceId) && m.contentId().equals(contentId)) {
                members.set(i, new WorkspaceMembership(workspaceId, contentId, m.source(), m.reason(),
                        m.confidence(), boardColumnId, position, m.createdAt(), LocalDateTime.now()));
                found = true;
                break;
            }
        }
        if (!found) {
            // 规则匹配/关系匹配的内容首次拖拽到看板列时，自动创建成员关系
            LocalDateTime now = LocalDateTime.now();
            WorkspaceMembership newMember = new WorkspaceMembership(workspaceId, contentId, "manual",
                    "看板拖拽", 1.0, boardColumnId, position, now, now);
            members.add(newMember);
            log.info("event=moveMember.auto_created workspaceId={} contentId={} boardColumnId={}",
                    workspaceId, contentId, boardColumnId);
        }
        writeAll(membershipPath, members);
    }

    public synchronized void removeMember(String workspaceId, String contentId) {
        requireText(workspaceId, "workspaceId");
        requireText(contentId, "contentId");
        writeAll(membershipPath, read(membershipPath, new TypeReference<List<WorkspaceMembership>>() {}).stream()
                .filter(item -> !(item.workspaceId().equals(workspaceId) && item.contentId().equals(contentId)))
                .toList());
    }

    public synchronized List<WorkspaceMembership> members(String workspaceId) {
        requireText(workspaceId, "workspaceId");
        return read(membershipPath, new TypeReference<List<WorkspaceMembership>>() {}).stream()
                .filter(item -> item.workspaceId().equals(workspaceId)).toList();
    }

    public synchronized WorkspaceResolution resolveWorkspace(String workspaceId, Collection<ContentRef> refs,
                                                              Collection<WorkspaceMembership> relationMembers) {
        long startedAt = System.nanoTime();
        int refCount = refs == null ? 0 : refs.size();
        int relationMemberCount = relationMembers == null ? 0 : relationMembers.size();
        log.info("event=resolveWorkspace.start workspaceId={} refCount={} relationMemberCount={}",
                workspaceId, refCount, relationMemberCount);
        try {
            requireText(workspaceId, "workspaceId");
            boolean exists = read(workspacePath, new TypeReference<List<Workspace>>() {}).stream()
                    .anyMatch(item -> item.id().equals(workspaceId));
            if (!exists) {
                log.warn("event=resolveWorkspace.workspace_missing workspaceId={}", workspaceId);
                throw new IllegalArgumentException("工作台不存在: " + workspaceId);
            }
            List<WorkspaceMembership> manualMembers = read(membershipPath,
                    new TypeReference<List<WorkspaceMembership>>() {});
            log.info("event=resolveWorkspace.members.read workspaceId={} manualMemberCount={}",
                    workspaceId, manualMembers.size());
            // Build board column info
            List<BoardColumn> cols = columns(workspaceId);
            Map<String, String> memberColumnMap = new LinkedHashMap<>();
            for (WorkspaceMembership m : manualMembers) {
                if (workspaceId.equals(m.workspaceId()) && m.boardColumnId() != null) {
                    memberColumnMap.put(m.contentId(), m.boardColumnId());
                }
            }
            WorkspaceResolution resolution = ruleService.resolve(workspaceId, refs, manualMembers, relationMembers);
            log.info("event=resolveWorkspace.rules.resolved workspaceId={} ruleMatchedCount={} manualCount={} relationCount={} excludedCount={}",
                    workspaceId, resolution.ruleMatchedCount(), resolution.manualCount(), resolution.relationCount(),
                    resolution.excludedCount());
            log.info("event=resolveWorkspace.completed workspaceId={} visibleCount={} durationMs={}", workspaceId,
                    resolution.visibleCount(), (System.nanoTime() - startedAt) / 1_000_000);
            return new WorkspaceResolution(resolution.visible(), resolution.ruleMatchedCount(),
                    resolution.manualCount(), resolution.relationCount(), resolution.excludedCount(),
                    resolution.visibleCount(), cols, memberColumnMap, resolution.contentSources());
        } catch (RuntimeException error) {
            log.error("event=resolveWorkspace.exception workspaceId={} errorType={}", workspaceId,
                    error.getClass().getSimpleName());
            throw error;
        }
    }

    public synchronized void deleteWorkspace(String workspaceId) {
        requireText(workspaceId, "workspaceId");
        writeAll(workspacePath, read(workspacePath, new TypeReference<List<Workspace>>() {}).stream()
                .filter(item -> !item.id().equals(workspaceId)).toList());
        writeAll(membershipPath, read(membershipPath, new TypeReference<List<WorkspaceMembership>>() {}).stream()
                .filter(item -> !item.workspaceId().equals(workspaceId)).toList());
        deleteWorkspaceColumns(workspaceId);
        ruleService.deleteWorkspaceData(workspaceId);
    }

    private void validateWorkspace(Workspace workspace) {
        if (workspace == null) throw new IllegalArgumentException("workspace 不能为空");
        requireText(workspace.id(), "workspace.id");
        requireText(workspace.name(), "workspace.name");
        if (!WORKSPACE_TYPES.contains(workspace.type())) {
            throw new IllegalArgumentException("workspace.type 非法: " + workspace.type());
        }
        if (!WORKSPACE_STATUSES.contains(workspace.status())) {
            throw new IllegalArgumentException("workspace.status 非法: " + workspace.status());
        }
        if (workspace.createdAt() == null || workspace.updatedAt() == null) {
            throw new IllegalArgumentException("workspace 时间字段不能为空");
        }
    }

    private void validateMembership(WorkspaceMembership member) {
        if (member == null) throw new IllegalArgumentException("membership 不能为空");
        requireText(member.workspaceId(), "membership.workspaceId");
        requireText(member.contentId(), "membership.contentId");
        if (Double.isNaN(member.confidence()) || member.confidence() < 0 || member.confidence() > 1) {
            throw new IllegalArgumentException("membership.confidence 必须在 0 到 1 之间");
        }
        if (member.createdAt() == null || member.updatedAt() == null) {
            throw new IllegalArgumentException("membership 时间字段不能为空");
        }
    }

    private void requireText(String value, String field) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(field + " 不能为空");
    }

    private <T> List<T> read(Path path, TypeReference<List<T>> type) {
        if (!Files.exists(path)) return new ArrayList<>();
        try {
            List<T> values = objectMapper.readValue(path.toFile(), type);
            return values == null ? new ArrayList<>() : values;
        } catch (IOException | RuntimeException error) {
            throw new IllegalStateException("无法读取工作台索引: " + path, error);
        }
    }

    private void writeAll(Path path, List<?> values) {
        try {
            Files.createDirectories(path.getParent());
            objectMapper.writerWithDefaultPrettyPrinter().writeValue(path.toFile(), values);
        } catch (IOException error) {
            throw new IllegalStateException("无法写入工作台索引: " + path, error);
        }
    }
}