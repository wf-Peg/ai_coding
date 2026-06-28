package com.example.clip.dto;

/**
 * 剪藏响应（ClipResponse）DTO。
 * <p>
 * 用于剪藏创建/更新操作后的简化响应，仅返回剪藏 ID 和操作状态。
 * 适用于只需确认操作结果而不需要返回完整剪藏数据的场景。
 * </p>
 */
public class ClipResponse {

    /** 剪藏 ID */
    private Long id;

    /** 操作状态，如 "ok"、"error" 等 */
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
