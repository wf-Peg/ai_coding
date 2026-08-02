package com.example.clip.index;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class HabitProfileService {
    public HabitProfile aggregate(List<ActionEvent> events) {
        Map<String, Long> categories = new HashMap<>();
        Map<String, Long> tags = new HashMap<>();
        Map<String, Long> actions = new HashMap<>();
        Map<String, Long> directories = new HashMap<>();
        for (ActionEvent event : events == null ? List.<ActionEvent>of() : events) {
            count(actions, event.type());
            if (event.metadata() == null) continue;
            count(categories, event.metadata().get("category"));
            count(tags, event.metadata().get("tag"));
            count(directories, event.metadata().get("directory"));
        }
        return new HabitProfile(Map.copyOf(categories), Map.copyOf(tags), Map.copyOf(actions), Map.copyOf(directories));
    }

    private void count(Map<String, Long> target, String value) { if (value != null && !value.isBlank()) target.merge(value, 1L, Long::sum); }
}
