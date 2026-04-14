package com.example.clip.controller;

import com.example.clip.core.AiService;
import com.example.clip.model.ClipContent;
import com.example.clip.service.ClipService;
import com.example.clip.service.ContentOrganizeService;
import com.example.clip.service.SearchService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/clip")
@CrossOrigin(origins = "http://localhost:3000")
public class ClipController {

    private final ClipService clipService;
    private final SearchService searchService;
    private final AiService aiService;
    private final ContentOrganizeService contentOrganizeService;

    @Autowired
    public ClipController(ClipService clipService, SearchService searchService, AiService aiService, ContentOrganizeService contentOrganizeService) {
        this.clipService = clipService;
        this.searchService = searchService;
        this.aiService = aiService;
        this.contentOrganizeService = contentOrganizeService;
    }

    @PostMapping("/add")
    public ResponseEntity<?> addClip(@RequestBody ClipRequest request) {
        ClipContent clip = clipService.saveClip(request.getContent(), request.getType(), request.getSource(), request.getCategory());
        if (request.getUseAiTags() != null && request.getUseAiTags()) {
            List<String> tags = aiService.generateTags(request.getContent());
            clip.setTags(tags);
            clipService.saveClip(clip);
        } else if (request.getTags() != null && !request.getTags().isEmpty()) {
            clip.setTags(request.getTags());
            clipService.saveClip(clip);
        }
        return ResponseEntity.ok(new ClipResponse(clip.getId(), "success"));
    }

    @PostMapping("/system")
    public ResponseEntity<?> systemClip(@RequestBody ClipRequest request) {
        ClipContent clip = clipService.saveClip(request.getContent(), request.getType(), request.getSource(), request.getCategory());
        return ResponseEntity.ok(new ClipResponse(clip.getId(), "success"));
    }

    @PostMapping("/generate-tags")
    public ResponseEntity<List<String>> generateTags(@RequestBody TagRequest request) {
        List<String> tags = aiService.generateTags(request.getContent());
        return ResponseEntity.ok(tags);
    }

    @PostMapping("/smart-organize")
    public ResponseEntity<Map<String, Object>> smartOrganize(@RequestBody TagRequest request) {
        Map<String, Object> result = aiService.smartOrganize(request.getContent());
        return ResponseEntity.ok(result);
    }

    @GetMapping("/categories")
    public ResponseEntity<List<Map<String, Object>>> getCategories() {
        return ResponseEntity.ok(AiService.CATEGORY_TREE);
    }

    @GetMapping("/category/{category}")
    public ResponseEntity<List<ClipContent>> getClipsByCategory(@PathVariable String category) {
        List<ClipContent> clips = clipService.getClipsByCategory(category);
        return ResponseEntity.ok(clips);
    }

    @GetMapping("/list")
    public ResponseEntity<List<ClipContent>> getClipList() {
        List<ClipContent> clips = clipService.getAllClips();
        return ResponseEntity.ok(clips);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteClip(@PathVariable Long id) {
        clipService.deleteClip(id);
        return ResponseEntity.ok(new ClipResponse(null, "success"));
    }

    @GetMapping("/search")
    public ResponseEntity<List<ClipContent>> search(@RequestParam String query, @RequestParam(defaultValue = "5") int topK) {
        List<ClipContent> results = searchService.search(query, topK);
        return ResponseEntity.ok(results);
    }

    @GetMapping("/search/category")
    public ResponseEntity<List<ClipContent>> searchByCategory(@RequestParam String query, @RequestParam String category, @RequestParam(defaultValue = "5") int topK) {
        List<ClipContent> results = searchService.searchByCategory(query, category, topK);
        return ResponseEntity.ok(results);
    }

    @GetMapping("/divergent-summary/{id}")
    public ResponseEntity<String> getDivergentSummary(@PathVariable Long id) {
        ClipContent clip = clipService.getClipById(id);
        if (clip == null) {
            return ResponseEntity.notFound().build();
        }
        
        String summary = aiService.generateDivergentSummary(clip.getContent(), clip.getCategory(), clip.getTags());
        return ResponseEntity.ok(summary);
    }

    @PostMapping("/organize")
    public ResponseEntity<?> organizeContent() {
        return ResponseEntity.ok(contentOrganizeService.organizeContent());
    }

    @GetMapping("/organize/status")
    public ResponseEntity<?> getOrganizeStatus() {
        java.util.Map<String, Object> status = new java.util.HashMap<>();
        status.put("status", contentOrganizeService.getLastOrganizeStatus());
        status.put("message", contentOrganizeService.getLastOrganizeMessage());
        status.put("storagePath", contentOrganizeService.getOrganizedStoragePath());
        return ResponseEntity.ok(status);
    }

    // Request and Response classes
    public static class ClipRequest {
        private String content;
        private String type;
        private String source;
        private String category;
        private List<String> tags;
        private Boolean useAiTags;

        // Getters and Setters
        public String getContent() {
            return content;
        }

        public void setContent(String content) {
            this.content = content;
        }

        public String getType() {
            return type;
        }

        public void setType(String type) {
            this.type = type;
        }

        public String getSource() {
            return source;
        }

        public void setSource(String source) {
            this.source = source;
        }

        public String getCategory() {
            return category;
        }

        public void setCategory(String category) {
            this.category = category;
        }

        public List<String> getTags() {
            return tags;
        }

        public void setTags(List<String> tags) {
            this.tags = tags;
        }

        public Boolean getUseAiTags() {
            return useAiTags;
        }

        public void setUseAiTags(Boolean useAiTags) {
            this.useAiTags = useAiTags;
        }
    }

    public static class TagRequest {
        private String content;

        public String getContent() {
            return content;
        }

        public void setContent(String content) {
            this.content = content;
        }
    }

    public static class ClipResponse {
        private Long id;
        private String status;

        public ClipResponse(Long id, String status) {
            this.id = id;
            this.status = status;
        }

        // Getters and Setters
        public Long getId() {
            return id;
        }

        public void setId(Long id) {
            this.id = id;
        }

        public String getStatus() {
            return status;
        }

        public void setStatus(String status) {
            this.status = status;
        }
    }
}