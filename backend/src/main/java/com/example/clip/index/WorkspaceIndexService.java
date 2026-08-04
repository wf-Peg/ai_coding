package com.example.clip.index;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Set;

public class WorkspaceIndexService {
    private static final Set<String> WORKSPACE_TYPES = Set.of("general", "project", "learning");
    private static final Set<String> WORKSPACE_STATUSES = Set.of("active", "archived");

    private final Path workspacePath;
    private final Path membershipPath;
    private final WorkspaceRuleService ruleService;
    private final ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());

    public WorkspaceIndexService(Path indexDir) {
        this.workspacePath = indexDir.resolve("workspace.json");
        this.membershipPath = indexDir.resolve("workspace-memberships.json");
        this.ruleService = new WorkspaceRuleService(indexDir);
    }

    public synchronized void saveWorkspace(Workspace workspace) {
        validateWorkspace(workspace);
        List<Workspace> workspaces = read(workspacePath, new TypeReference<List<Workspace>>() {});
        workspaces.removeIf(item -> item.id().equals(workspace.id()));
        workspaces.add(workspace);
        writeAll(workspacePath, workspaces);
    }

    public synchronized List<Workspace> readAll() {
        return List.copyOf(read(workspacePath, new TypeReference<List<Workspace>>() {}));
    }

    public synchronized void addMember(WorkspaceMembership member) {
        validateMembership(member);
        List<WorkspaceMembership> members = read(membershipPath, new TypeReference<List<WorkspaceMembership>>() {});
        members.removeIf(item -> item.workspaceId().equals(member.workspaceId())
                && item.contentId().equals(member.contentId()));
        members.add(member);
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
        requireText(workspaceId, "workspaceId");
        boolean exists = read(workspacePath, new TypeReference<List<Workspace>>() {}).stream()
                .anyMatch(item -> item.id().equals(workspaceId));
        if (!exists) throw new IllegalArgumentException("工作台不存在: " + workspaceId);
        List<WorkspaceMembership> manualMembers = read(membershipPath,
                new TypeReference<List<WorkspaceMembership>>() {});
        return ruleService.resolve(workspaceId, refs, manualMembers, relationMembers);
    }

    public synchronized void deleteWorkspace(String workspaceId) {
        requireText(workspaceId, "workspaceId");
        writeAll(workspacePath, read(workspacePath, new TypeReference<List<Workspace>>() {}).stream()
                .filter(item -> !item.id().equals(workspaceId)).toList());
        writeAll(membershipPath, read(membershipPath, new TypeReference<List<WorkspaceMembership>>() {}).stream()
                .filter(item -> !item.workspaceId().equals(workspaceId)).toList());
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
