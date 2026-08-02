package com.example.clip.index;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

public class ProjectIndexService {
    private final Path projectPath;
    private final Path membershipPath;
    private final ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());

    public ProjectIndexService(Path indexDir) {
        this.projectPath = indexDir.resolve("projects.json");
        this.membershipPath = indexDir.resolve("project-memberships.json");
    }

    public synchronized void saveProject(Project project) {
        List<Project> projects = read(projectPath, new TypeReference<List<Project>>() {});
        projects.removeIf(item -> item.id().equals(project.id()));
        projects.add(project);
        writeAll(projectPath, projects);
    }

    public synchronized void addMember(ProjectMembership member) {
        List<ProjectMembership> members = read(membershipPath, new TypeReference<List<ProjectMembership>>() {});
        if (!members.contains(member)) members.add(member);
        writeAll(membershipPath, members);
    }

    public synchronized void removeMember(String projectId, String contentId) {
        writeAll(membershipPath, read(membershipPath, new TypeReference<List<ProjectMembership>>() {}).stream()
                .filter(item -> !(item.projectId().equals(projectId) && item.contentId().equals(contentId))).toList());
    }

    public synchronized List<ProjectMembership> members(String projectId) {
        return read(membershipPath, new TypeReference<List<ProjectMembership>>() {}).stream()
                .filter(item -> item.projectId().equals(projectId)).toList();
    }

    private <T> List<T> read(Path path, TypeReference<List<T>> type) {
        if (!Files.exists(path)) return new ArrayList<>();
        try { return objectMapper.readValue(path.toFile(), type); }
        catch (IOException error) { throw new IllegalStateException("无法读取项目索引: " + path, error); }
    }

    private void writeAll(Path path, List<?> values) {
        try { Files.createDirectories(path.getParent()); objectMapper.writerWithDefaultPrettyPrinter().writeValue(path.toFile(), values); }
        catch (IOException error) { throw new IllegalStateException("无法写入项目索引: " + path, error); }
    }
}
