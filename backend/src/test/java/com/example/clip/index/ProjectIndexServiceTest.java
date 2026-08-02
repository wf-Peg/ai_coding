package com.example.clip.index;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ProjectIndexServiceTest {
    @TempDir Path tempDir;

    @Test
    void projectMembershipIsIdempotentAndDoesNotDeleteContent() {
        ProjectIndexService service = new ProjectIndexService(tempDir);
        Project project = new Project("project-java", "Java 学习", "", "#569cff", "active", LocalDateTime.now(), LocalDateTime.now());
        ProjectMembership member = new ProjectMembership(project.id(), "clip:1", "explicit", 1, "用户手动加入", LocalDateTime.now());

        service.saveProject(project);
        service.addMember(member);
        service.addMember(member);

        assertEquals(1, service.members(project.id()).size());
        service.removeMember(project.id(), "clip:1");
        assertEquals(0, service.members(project.id()).size());
    }
}
