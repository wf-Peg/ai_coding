package com.example.clip.index;

import java.util.Map;

public record HabitProfile(Map<String, Long> categories, Map<String, Long> tags,
                           Map<String, Long> actions, Map<String, Long> directories) {}
