package com.example.clip.index;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WorkspaceIndexServiceTest {
    @TempDir Path tempDir;

    @Test
    void persistsWorkspaceAndMembershipsIdempotentlyAndDeletesInIsolation() throws Exception {
        LocalDateTime now = LocalDateTime.now();
        WorkspaceIndexService service = new WorkspaceIndexService(tempDir);
        Workspace first = new Workspace("workspace-1", "Java", "学习", "#569cff", "project", "active", now, now);
        Workspace second = new Workspace("workspace-2", "生活", "", "#ff9f43", "general", "active", now, now);
        WorkspaceMembership member = new WorkspaceMembership(first.id(), "clip:1", "manual", "用户手动加入", 1, now, now);
        WorkspaceMembership otherMember = new WorkspaceMembership(second.id(), "clip:2", "manual", "用户手动加入", 1, now, now);

        service.saveWorkspace(first);
        service.saveWorkspace(second);
        service.addMember(member);
        service.addMember(member);
        service.addMember(otherMember);

        assertEquals(2, service.readAll().size());
        assertEquals(1, service.members(first.id()).size());
        assertTrue(Files.exists(tempDir.resolve("workspace.json")));
        assertTrue(Files.exists(tempDir.resolve("workspace-memberships.json")));

        service.deleteWorkspace(first.id());

        assertEquals(1, service.readAll().size());
        assertEquals(0, service.members(first.id()).size());
        assertEquals(1, service.members(second.id()).size());
        assertTrue(Files.exists(tempDir.resolve("workspace-memberships.json")));
    }

    @Test
    void rejectsInvalidValuesWithoutWriting() {
        WorkspaceIndexService service = new WorkspaceIndexService(tempDir);
        LocalDateTime now = LocalDateTime.now();

        assertThrows(IllegalArgumentException.class,
                () -> service.saveWorkspace(new Workspace("", "名称", "", "", "general", "active", now, now)));
        assertThrows(IllegalArgumentException.class,
                () -> service.saveWorkspace(new Workspace("id", "", "", "", "general", "active", now, now)));
        assertThrows(IllegalArgumentException.class,
                () -> service.saveWorkspace(new Workspace("id", "名称", "", "", "invalid", "active", now, now)));
        assertThrows(IllegalArgumentException.class,
                () -> service.saveWorkspace(new Workspace("id", "名称", "", "", "general", "invalid", now, now)));
        assertFalse(Files.exists(tempDir.resolve("workspace.json")));
    }

    @Test
    void missingFilesAreEmptyAndCorruptJsonFailsClearly() throws Exception {
        WorkspaceIndexService service = new WorkspaceIndexService(tempDir);
        assertEquals(0, service.readAll().size());
        assertEquals(0, service.members("workspace-1").size());

        Files.writeString(tempDir.resolve("workspace.json"), "not-json");
        IllegalStateException error = assertThrows(IllegalStateException.class, service::readAll);
        assertTrue(error.getMessage().contains("工作台索引"));
    }
}
