package com.example.clip.index;

import java.util.List;

/**
 * PUT /{workspaceId}/rule-expression 请求体：{relation, groups:[{id, relation, ruleIds}]}
 */
public record RuleExpressionUpdateRequest(String relation, List<RuleGroup> groups) {
}
