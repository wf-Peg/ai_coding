package com.example.clip.index;

public final class EventTypes {
    public static final int SCHEMA_VERSION = 1;

    public static final String CONTENT_CREATED = "content_created";
    public static final String CONTENT_OPENED = "content_opened";
    public static final String CONTENT_EDITED = "content_edited";
    public static final String CONTENT_DELETED = "content_deleted";
    public static final String CONTENT_TAGGED = "content_tagged";

    public static final String TODO_CREATED = "todo_created";
    public static final String TODO_COMPLETED = "todo_completed";
    public static final String TODO_EDITED = "todo_edited";
    public static final String TODO_DELETED = "todo_deleted";

    public static final String WORKSPACE_VIEWED = "workspace_viewed";
    public static final String WORKSPACE_MEMBER_ADDED = "workspace_member_added";
    public static final String WORKSPACE_MEMBER_REMOVED = "workspace_member_removed";
    public static final String WORKSPACE_EXCLUDED = "workspace_excluded";
    public static final String BOARD_COLUMN_CHANGED = "board_column_changed";

    public static final String SUGGESTION_SHOWN = "suggestion_shown";
    public static final String SUGGESTION_ACCEPTED = "suggestion_accepted";
    public static final String SUGGESTION_IGNORED = "suggestion_ignored";
    public static final String SUGGESTION_REJECTED = "suggestion_rejected";

    // ===== 桌面系统级集成事件 =====
    public static final String FILE_ASSOCIATION_OPEN = "file_association_open";
    public static final String CONTEXT_MENU_CLIP = "context_menu_clip";
    public static final String CONTEXT_MENU_AI_CLIP = "context_menu_ai_clip";
    public static final String CONTEXT_MENU_OPEN_EDITOR = "context_menu_open_editor";
    public static final String CONTEXT_MENU_PDF_OCR = "context_menu_pdf_ocr";
    public static final String CONTEXT_MENU_SETTINGS = "context_menu_settings";
    public static final String CONTEXT_MENU_REGISTER = "context_menu_register";
    public static final String PDF_OCR_RESULT = "pdf_ocr_result";
    public static final String TRAY_OPEN_SETTINGS = "tray_open_settings";
    public static final String TRAY_OPEN_CLIP_INBOX = "tray_open_clip_inbox";

    private EventTypes() {}
}