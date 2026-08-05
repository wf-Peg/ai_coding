package com.example.clip.index;

import java.util.List;
import java.util.Map;

public record WorkspaceResolution(List<ContentRef> visible, int ruleMatchedCount, int manualCount,
                                  int relationCount, int excludedCount, int visibleCount,
                                  List<BoardColumn> columns, Map<String, String> memberColumnMap,
                                  Map<String, String> contentSources) {
    public WorkspaceResolution {
        visible = List.copyOf(visible);
        columns = columns == null ? List.of() : List.copyOf(columns);
        memberColumnMap = memberColumnMap == null ? Map.of() : Map.copyOf(memberColumnMap);
        contentSources = contentSources == null ? Map.of() : Map.copyOf(contentSources);
    }
}