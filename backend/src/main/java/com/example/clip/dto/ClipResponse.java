package com.example.clip.dto;

/**
 * 剪藏响应对象
 */
public class ClipResponse {
    private Long id;
    private String status;

    public ClipResponse(Long id, String status) {
        this.id = id;
        this.status = status;
    }

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
