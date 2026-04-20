package com.example.clip.controller;

import com.example.clip.service.GitService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

@RestController
@RequestMapping("/api/git")
@CrossOrigin(origins = {"http://127.0.0.1:3000", "http://localhost:3000"})
public class GitController {

    private static final Logger log = LoggerFactory.getLogger(GitController.class);
    private final GitService gitService;

    @Autowired
    public GitController(GitService gitService) {
        this.gitService = gitService;
    }

    @PostMapping("/push")
    public ResponseEntity<Map<String, Object>> push() {
        log.info("[API] /git/push called");
        gitService.resetPushStatus();
        CompletableFuture<String> future = gitService.pushAsync();
        
        Map<String, Object> response = new HashMap<>();
        response.put("status", "started");
        response.put("message", "Git push 已开始");
        return ResponseEntity.ok(response);
    }

    @PostMapping("/pull")
    public ResponseEntity<Map<String, Object>> pull() {
        log.info("[API] /git/pull called");
        gitService.resetPullStatus();
        CompletableFuture<String> future = gitService.pullAsync();
        
        Map<String, Object> response = new HashMap<>();
        response.put("status", "started");
        response.put("message", "Git pull 已开始");
        return ResponseEntity.ok(response);
    }

    @GetMapping("/status/push")
    public ResponseEntity<Map<String, Object>> getPushStatus() {
        Map<String, Object> response = new HashMap<>();
        response.put("status", gitService.getPushStatus());
        response.put("message", gitService.getPushMessage());
        return ResponseEntity.ok(response);
    }

    @GetMapping("/status/pull")
    public ResponseEntity<Map<String, Object>> getPullStatus() {
        Map<String, Object> response = new HashMap<>();
        response.put("status", gitService.getPullStatus());
        response.put("message", gitService.getPullMessage());
        return ResponseEntity.ok(response);
    }
}
