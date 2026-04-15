package com.example.clip.service;

import com.example.clip.core.AiService;
import com.example.clip.model.ClipContent;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.Base64;
import java.util.List;

@Service
public class ClipService {

    private final FileStorageService storageService;
    private final AiService aiService;
    private final LinkParseService linkParseService;
    private final DocumentParseService documentParseService;

    @Autowired
    public ClipService(FileStorageService storageService, AiService aiService,
                       LinkParseService linkParseService, DocumentParseService documentParseService) {
        this.storageService = storageService;
        this.aiService = aiService;
        this.linkParseService = linkParseService;
        this.documentParseService = documentParseService;
    }

    public ClipContent saveClip(String content, String type, String source, String category,
                                 String fileData, String fileName) {
        ClipContent clipContent = new ClipContent(content, type, source, category);

        switch (type != null ? type : "ai-text") {
            case "store-only":
                // Only store content, no AI processing
                clipContent.setSummary(content != null ? content : "");
                clipContent.setAnalysis("");
                break;

            case "link-ai":
                // Crawl link content, then AI process
                String crawledText = linkParseService.parseUrl(content);
                clipContent.setContent(crawledText);
                processWithAi(clipContent);
                break;

            case "doc-ai":
                // Parse document, then AI process
                try {
                    byte[] fileBytes = Base64.getDecoder().decode(fileData);
                    String parsedText = documentParseService.parseDocument(fileBytes, fileName);
                    clipContent.setContent(parsedText);
                    processWithAi(clipContent);
                } catch (Exception e) {
                    System.err.println("[ClipService] Document parse failed: " + e.getMessage());
                    clipContent.setSummary("[文档解析失败] " + e.getMessage());
                    clipContent.setAnalysis("");
                }
                break;

            case "ai-text":
            default:
                // Original logic: AI text processing
                processWithAi(clipContent);
                break;
        }

        ClipContent savedClip = storageService.saveClip(clipContent);
        return savedClip;
    }

    /**
     * AI processing: generate summary and analysis
     */
    private void processWithAi(ClipContent clipContent) {
        try {
            String summary = aiService.generateSummary(clipContent.getContent());
            String analysis = aiService.analyzeContent(clipContent.getContent());
            clipContent.setSummary(summary);
            clipContent.setAnalysis(analysis);
        } catch (Exception e) {
            e.printStackTrace();
            clipContent.setSummary("摘要生成失败");
            clipContent.setAnalysis("分析生成失败");
        }
    }

    // Keep backward-compatible overload
    public ClipContent saveClip(String content, String type, String source, String category) {
        return saveClip(content, type, source, category, null, null);
    }

    public ClipContent saveClip(ClipContent clipContent) {
        return storageService.saveClip(clipContent);
    }

    public List<ClipContent> getAllClips() {
        return storageService.getAllClips();
    }

    public ClipContent getClipById(Long id) {
        return storageService.getClipById(id.toString());
    }

    public void deleteClip(Long id) {
        storageService.deleteClip(id);
    }

    public List<ClipContent> getClipsByCategory(String category) {
        return storageService.getClipsByCategory(category);
    }

    @Async
    public void processClipAsync(Long clipId) {
        try {
            Thread.sleep(1000);
            ClipContent clip = storageService.getClipById(clipId.toString());
            if (clip != null) {
                String summary = aiService.generateSummary(clip.getContent());
                String analysis = aiService.analyzeContent(clip.getContent());
                clip.setSummary(summary);
                clip.setAnalysis(analysis);
                storageService.saveClip(clip);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
