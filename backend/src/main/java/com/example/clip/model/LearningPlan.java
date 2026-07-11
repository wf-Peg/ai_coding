package com.example.clip.model;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 学习计划模型。
 * <p>
 * 用户输入学习主题和参数后，AI 自动生成分阶段学习路线图。
 * 每个计划包含多个学习阶段，支持进度跟踪。
 * </p>
 */
public class LearningPlan {

    /** 唯一标识 */
    private Long id;
    /** 学习主题，如 "Python 机器学习" */
    private String title;
    /** 当前水平：zero / beginner / intermediate */
    private String level;
    /** 学习目标：intro / project / job / portfolio */
    private String goal;
    /** 每周投入小时数 */
    private int hoursPerWeek;
    /** 预计总周数 */
    private int totalWeeks;
    /** 学习阶段列表 */
    private List<Phase> phases = new ArrayList<>();
    /** Mermaid 可视化路径图 */
    private String mermaidDiagram;
    /** 创建时间 */
    private LocalDateTime createdAt;
    /** 最后更新时间 */
    private LocalDateTime updatedAt;

    public LearningPlan() {
        this.createdAt = LocalDateTime.now();
        this.updatedAt = LocalDateTime.now();
    }

    // ===== 嵌套类 =====

    /** 学习阶段 */
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
    }

    /** 推荐视频资源 */
    public static class VideoResource {
        private String title;
        private String url;
        private String reason;

        public String getTitle() { return title; }
        public void setTitle(String title) { this.title = title; }
        public String getUrl() { return url; }
        public void setUrl(String url) { this.url = url; }
        public String getReason() { return reason; }
        public void setReason(String reason) { this.reason = reason; }
    }

    /** 知识作业题目 */
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

    /** 实战任务 */
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

    // ===== Getters / Setters =====

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
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}