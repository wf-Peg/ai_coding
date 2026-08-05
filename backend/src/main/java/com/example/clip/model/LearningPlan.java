package com.example.clip.model;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

public class LearningPlan {

    private Long id;
    private String title;
    private String level;
    private String goal;
    private int hoursPerWeek;
    private int totalWeeks;
    private List<Phase> phases = new ArrayList<>();
    private String mermaidDiagram;
    private String category;
    private List<String> tags = new ArrayList<>();
    private Integer mastery;
    private LocalDateTime nextReviewAt;
    private int reviewCount;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public LearningPlan() {
        this.createdAt = LocalDateTime.now();
        this.updatedAt = LocalDateTime.now();
    }

    public static class Phase {
        private int phaseNumber;
        private String title;
        private String goal;
        private int estimatedWeeks;
        private List<VideoResource> videos = new ArrayList<>();
        private List<QuizQuestion> knowledgeQuiz = new ArrayList<>();
        private List<PracticeTask> practiceTasks = new ArrayList<>();
        private int progress;
        private boolean completed;
        private LocalDateTime completedAt;
        private LocalDateTime reviewedAt;

        public int getPhaseNumber() { return phaseNumber; }
        public void setPhaseNumber(int phaseNumber) { this.phaseNumber = phaseNumber; }
        public String getTitle() { return title; }
        public void setTitle(String title) { this.title = title; }
        public String getGoal() { return goal; }
        public void setGoal(String goal) { this.goal = goal; }
        public int getEstimatedWeeks() { return estimatedWeeks; }
        public void setEstimatedWeeks(int estimatedWeeks) { this.estimatedWeeks = estimatedWeeks; }
        public List<VideoResource> getVideos() { return videos; }
        public void setVideos(List<VideoResource> videos) { this.videos = videos; }
        public List<QuizQuestion> getKnowledgeQuiz() { return knowledgeQuiz; }
        public void setKnowledgeQuiz(List<QuizQuestion> knowledgeQuiz) { this.knowledgeQuiz = knowledgeQuiz; }
        public List<PracticeTask> getPracticeTasks() { return practiceTasks; }
        public void setPracticeTasks(List<PracticeTask> practiceTasks) { this.practiceTasks = practiceTasks; }
        public int getProgress() { return progress; }
        public void setProgress(int progress) { this.progress = progress; }
        public boolean isCompleted() { return completed; }
        public void setCompleted(boolean completed) { this.completed = completed; }
        public LocalDateTime getCompletedAt() { return completedAt; }
        public void setCompletedAt(LocalDateTime completedAt) { this.completedAt = completedAt; }
        public LocalDateTime getReviewedAt() { return reviewedAt; }
        public void setReviewedAt(LocalDateTime reviewedAt) { this.reviewedAt = reviewedAt; }
    }

    public static class VideoResource {
        private String title;
        private String url;
        private String reason;
        private String source;
        private String snippet;

        public String getTitle() { return title; }
        public void setTitle(String title) { this.title = title; }
        public String getUrl() { return url; }
        public void setUrl(String url) { this.url = url; }
        public String getReason() { return reason; }
        public void setReason(String reason) { this.reason = reason; }
        public String getSource() { return source; }
        public void setSource(String source) { this.source = source; }
        public String getSnippet() { return snippet; }
        public void setSnippet(String snippet) { this.snippet = snippet; }
    }

    public static class QuizQuestion {
        private String type;
        private String question;
        private List<String> options = new ArrayList<>();

        public String getType() { return type; }
        public void setType(String type) { this.type = type; }
        public String getQuestion() { return question; }
        public void setQuestion(String question) { this.question = question; }
        public List<String> getOptions() { return options; }
        public void setOptions(List<String> options) { this.options = options; }
    }

    public static class PracticeTask {
        private String description;
        private int difficulty;
        private String acceptanceCriteria;

        public String getDescription() { return description; }
        public void setDescription(String description) { this.description = description; }
        public int getDifficulty() { return difficulty; }
        public void setDifficulty(int difficulty) { this.difficulty = difficulty; }
        public String getAcceptanceCriteria() { return acceptanceCriteria; }
        public void setAcceptanceCriteria(String acceptanceCriteria) { this.acceptanceCriteria = acceptanceCriteria; }
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getLevel() { return level; }
    public void setLevel(String level) { this.level = level; }
    public String getGoal() { return goal; }
    public void setGoal(String goal) { this.goal = goal; }
    public int getHoursPerWeek() { return hoursPerWeek; }
    public void setHoursPerWeek(int hoursPerWeek) { this.hoursPerWeek = hoursPerWeek; }
    public int getTotalWeeks() { return totalWeeks; }
    public void setTotalWeeks(int totalWeeks) { this.totalWeeks = totalWeeks; }
    public List<Phase> getPhases() { return phases; }
    public void setPhases(List<Phase> phases) { this.phases = phases; }
    public String getMermaidDiagram() { return mermaidDiagram; }
    public void setMermaidDiagram(String mermaidDiagram) { this.mermaidDiagram = mermaidDiagram; }
    public String getCategory() { return category; }
    public void setCategory(String category) { this.category = category; }
    public List<String> getTags() { return tags; }
    public void setTags(List<String> tags) { this.tags = tags; }
    public Integer getMastery() { return mastery; }
    public void setMastery(Integer mastery) { this.mastery = mastery; }
    public LocalDateTime getNextReviewAt() { return nextReviewAt; }
    public void setNextReviewAt(LocalDateTime nextReviewAt) { this.nextReviewAt = nextReviewAt; }
    public int getReviewCount() { return reviewCount; }
    public void setReviewCount(int reviewCount) { this.reviewCount = reviewCount; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}