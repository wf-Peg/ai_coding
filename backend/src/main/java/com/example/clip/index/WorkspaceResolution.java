package com.example.clip.index;

import java.util.List;

public record WorkspaceResolution(List<ContentRef> visible, int ruleMatchedCount, int manualCount,
                                  int relationCount, int excludedCount, int visibleCount) {
    public WorkspaceResolution {
        visible = List.copyOf(visible);
    }
}
