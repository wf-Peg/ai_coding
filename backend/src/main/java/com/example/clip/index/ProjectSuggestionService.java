package com.example.clip.index;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Produces deterministic, explainable suggestions without mutating project membership. */
public class ProjectSuggestionService {
    public ProjectSuggestion score(Project project, ContentRef candidate,
                                    Set<String> projectCategories,
                                    Set<String> projectTags,
                                    Set<String> projectDirectories,
                                    List<ContentRef> members,
                                    HabitProfile profile) {
        if (project == null || candidate == null) {
            throw new IllegalArgumentException("project and candidate are required");
        }
        Set<String> categories = normalize(projectCategories);
        Set<String> tags = normalize(projectTags);
        Set<String> directories = normalize(projectDirectories);
        List<String> reasons = new ArrayList<>();
        double score = 0;

        if (candidate.category() != null && categories.contains(candidate.category().toLowerCase())) {
            score += 0.25;
            reasons.add("category-match");
        }
        if (!intersection(candidate.tags(), tags).isEmpty()) {
            score += 0.35;
            reasons.add("tag-match");
        }
        if (candidate.sourcePath() != null && directories.stream().anyMatch(candidate.sourcePath().toLowerCase()::contains)) {
            score += 0.20;
            reasons.add("directory-match");
        }
        if (members != null && candidate.category() != null && members.stream()
                .anyMatch(member -> candidate.category().equalsIgnoreCase(member.category()))) {
            score += 0.10;
            reasons.add("member-pattern");
        }
        if (profile != null && candidate.category() != null
                && profile.categories().getOrDefault(candidate.category(), 0L) > 0) {
            score += 0.10;
            reasons.add("habit-category");
        }
        return new ProjectSuggestion(project.id() + ":" + candidate.id(), project.id(), candidate.id(),
                Math.min(1.0, score), reasons, "pending");
    }

    private Set<String> normalize(Set<String> values) {
        Set<String> result = new HashSet<>();
        if (values != null) values.forEach(value -> {
            if (value != null && !value.isBlank()) result.add(value.toLowerCase());
        });
        return result;
    }

    private Set<String> intersection(List<String> values, Set<String> expected) {
        Set<String> result = new HashSet<>();
        if (values != null) values.forEach(value -> {
            if (value != null && expected.contains(value.toLowerCase())) result.add(value.toLowerCase());
        });
        return result;
    }
}
