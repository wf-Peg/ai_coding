package com.example.clip.model;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.UUID;

/**
 * 网页标注（Annotation）模型。
 * <p>
 * 标注是剪藏条目下挂载的「高亮 + 想法」记录，一次设计、两端共用：
 * <ul>
 *   <li><b>打标（写入方）</b>：浏览器插件在网页上高亮文字、写想法，随剪藏一并入库</li>
 *   <li><b>看标（只读方）</b>：知识模块二期做标注透视列表，按颜色/来源/时间筛选</li>
 * </ul>
 * </p>
 *
 * <h3>字段约定</h3>
 * <ul>
 *   <li>{@code id}：标注唯一标识，插件侧生成 UUID；缺省时由模型自动补
 *       一个 UUID，反序列化不受影响；</li>
 *   <li>{@code text}：原文片段（高亮的文字）；</li>
 *   <li>{@code note}：想法笔记，可空，上限 1000 字；</li>
 *   <li>{@code color}：高亮颜色枚举，黄色（yellow）、绿色（green）、
 *       蓝色（blue）、紫色（purple）四种；</li>
 *   <li>{@code source}：来源固定为 "extension"（浏览器插件）；</li>
 *   <li>{@code sourceUrl}/{@code sourceTitle}：来源网页链接与页面标题，
 *       用于剪藏详情「跳回原网页」；</li>
 *   <li>{@code createdAt}/{@code updatedAt}：创建/更新时间，
 *       格式 yyyy-MM-dd HH:mm:ss。</li>
 * </ul>
 *
 * <h3>兼容规则</h3>
 * 历史剪藏条目没有 annotations 字段时视为空列表，不迁移、不补写；
 * JSON 反序列化遇到未知字段直接忽略，不会损坏老库。
 *
 * @see ClipContent 标注挂载于剪藏条目下
 */
public class Annotation {

    /** 时间格式：yyyy-MM-dd HH:mm:ss */
    private static final DateTimeFormatter TIME_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    /** 标注唯一标识（缺省自动补 UUID） */
    private String id;

    /** 原文片段（高亮的文字） */
    private String text;

    /** 想法笔记（可为空，上限 1000 字） */
    private String note;

    /** 高亮颜色：yellow/green/blue/purple */
    private String color;

    /** 来源网页链接 */
    private String sourceUrl;

    /** 来源页面标题 */
    private String sourceTitle;

    /** 创建时间（yyyy-MM-dd HH:mm:ss） */
    private String createdAt;

    /** 更新时间（yyyy-MM-dd HH:mm:ss） */
    private String updatedAt;

    /** 标注来源，固定为 "extension" */
    private String source;

    /**
     * 无参构造函数。
     * <p>
     * 自动补全 ID（UUID）、来源（extension）与创建/更新时间，保证：
     * <ul>
     *   <li>插件侧不带 id 提交时仍能得到唯一标识；</li>
     *   <li>Jackson 反序列化时 JSON 中已有的字段会覆盖此处的默认值。</li>
     * </ul>
     */
    public Annotation() {
        this.id = UUID.randomUUID().toString();
        this.source = "extension";
        String now = LocalDateTime.now().format(TIME_FORMATTER);
        this.createdAt = now;
        this.updatedAt = now;
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = (id == null || id.isBlank()) ? UUID.randomUUID().toString() : id;
    }

    public String getText() {
        return text;
    }

    public void setText(String text) {
        this.text = text;
    }

    public String getNote() {
        return note;
    }

    public void setNote(String note) {
        this.note = note;
    }

    public String getColor() {
        return color;
    }

    public void setColor(String color) {
        this.color = color;
    }

    public String getSourceUrl() {
        return sourceUrl;
    }

    public void setSourceUrl(String sourceUrl) {
        this.sourceUrl = sourceUrl;
    }

    public String getSourceTitle() {
        return sourceTitle;
    }

    public void setSourceTitle(String sourceTitle) {
        this.sourceTitle = sourceTitle;
    }

    public String getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(String createdAt) {
        this.createdAt = createdAt;
    }

    public String getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(String updatedAt) {
        this.updatedAt = updatedAt;
    }

    public String getSource() {
        return source;
    }

    public void setSource(String source) {
        this.source = source;
    }
}