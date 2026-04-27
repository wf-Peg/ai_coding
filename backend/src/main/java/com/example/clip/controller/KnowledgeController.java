package com.example.clip.controller;

import com.example.clip.model.KnowledgeEntry;
import com.example.clip.service.KnowledgeService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 知识条目控制器
 */
@RestController
@RequestMapping("/api/knowledge")
@CrossOrigin(origins = "*")
public class KnowledgeController {

    private final KnowledgeService knowledgeService;

    public KnowledgeController(KnowledgeService knowledgeService) {
        this.knowledgeService = knowledgeService;
    }

    @PostMapping("/derive/{clipId}")
    public ResponseEntity<?> deriveFromClip(@PathVariable Long clipId,
                                            @RequestParam(name = "async", defaultValue = "false") boolean async) {
        try {
            if (async) {
                knowledgeService.deriveFromClipAsync(clipId);
                return ResponseEntity.ok(Map.of(
                        "status", "accepted",
                        "clipId", clipId
                ));
            }
            KnowledgeEntry entry = knowledgeService.deriveFromClip(clipId);
            return ResponseEntity.ok(Map.of(
                    "status", "success",
                    "knowledgeId", entry.getId(),
                    "sourceClipId", entry.getSourceClipId()
            ));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of(
                    "status", "error",
                    "message", e.getMessage()
            ));
        }
    }

    @GetMapping("/list")
    public ResponseEntity<List<KnowledgeEntry>> list() {
        return ResponseEntity.ok(knowledgeService.listAll());
    }

    @GetMapping("/search")
    public ResponseEntity<List<KnowledgeEntry>> search(@RequestParam(required = false) String query,
                                                        @RequestParam(required = false) String category,
                                                        @RequestParam(defaultValue = "10") int topK) {
        return ResponseEntity.ok(knowledgeService.search(query, category, topK));
    }

    @GetMapping("/{id}")
    public ResponseEntity<KnowledgeEntry> getById(@PathVariable Long id) {
        KnowledgeEntry entry = knowledgeService.getById(id);
        if (entry == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(entry);
    }

    @GetMapping("/source/{clipId}")
    public ResponseEntity<List<KnowledgeEntry>> getBySourceClip(@PathVariable Long clipId) {
        return ResponseEntity.ok(knowledgeService.getBySourceClipId(clipId));
    }
}
