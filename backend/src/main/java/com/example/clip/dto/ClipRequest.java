package com.example.clip.dto;

import java.util.List;

/**
 * 剪藏请求对象
 */
public class ClipRequest {
    private String content;
    private String type;
    private String source;
    private String category;
    private List<String> tags;
    private Boolean useAiTags;
    private String fileData;
    private String fileName;
    private List<ImageData> imageDataList;

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

    public String getFileData() {
        return fileData;
    }

    public void setFileData(String fileData) {
        this.fileData = fileData;
    }

    public String getFileName() {
        return fileName;
    }

    public void setFileName(String fileName) {
        this.fileName = fileName;
    }

    public List<ImageData> getImageDataList() {
        return imageDataList;
    }

    public void setImageDataList(List<ImageData> imageDataList) {
        this.imageDataList = imageDataList;
    }

    /**
     * 图片数据对象
     */
    public static class ImageData {
        private String base64Data;
        private String fileName;

        public String getBase64Data() {
            return base64Data;
        }

        public void setBase64Data(String base64Data) {
            this.base64Data = base64Data;
        }

        public String getFileName() {
            return fileName;
        }

        public void setFileName(String fileName) {
            this.fileName = fileName;
        }
    }
}
