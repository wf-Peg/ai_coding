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

    private EventTypes() {}
}