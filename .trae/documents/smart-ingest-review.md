# 智能入库代码审查与改进计划

## Summary

对本次智能入库（smart-ingest）功能的代码进行全面审查，发现 **4 个需修复的缺陷**、**4 个中等优先级改进项**，并提炼 **3 条核心架构洞见**。本计划聚焦于让已实现的功能正确、健壮地运行，不新增功能。

## Current State Analysis

本次修改涉及 12 个文件，已实现全链路：
- 后端 `POST /api/ingest`（IngestController + AiService 两个新方法）
- TRAE Agent Skill（SKILL.md）
- 浏览器插件（options/popup/background 5 文件）
- 前端 clip.html 入口按钮
- 接口文档附录

经逐文件审查，**整体架构正确、降级链路完整、原有接口未受影响**，但存在以下具体问题。

---

## 核心洞见

### 洞见 1：双 AI 路径的维护风险
系统现在有两条 AI 路径：
- **后端路径**：`/api/ingest` → `AiService.identifyIntent` + `extractFields` → 路由入库
- **Skill 路径**：Agent 自行做意图识别 + 字段提取 → curl 调用已有接口

意图分类规则同时写在 `AiService.java` 的 systemPrompt 和 `SKILL.md` 中。若规则变更，两处需同步修改，否则行为不一致。**建议**：在 SKILL.md 顶部加注释"意图规则需与 AiService.identifyIntent 保持同步"，作为维护提醒。

### 洞见 2：LLM 输出的"空值"不可信
`extractFields` 的 prompt 要求"无法确定的字段用 null"，但 LLM 实际常返回 `""`（空字符串）或 `"null"`（字符串）。当前 `getString()` 方法只判断 `val == null`，不处理空字符串，导致空标题、空 priority 等被存入库中。**这是最值得修复的缺陷**。

### 洞见 3：clip.html 的"智能入库"缺少加载反馈
`smartIngestClip()` 既不禁用按钮也不显示 loading，AI 处理需数秒，用户会以为卡死并重复点击，触发多次入库请求。popup.js 已有按钮 loading 态（"分析中..."），但 clip.html 未对齐。

---

## Proposed Changes

### 修复 1：`getString()` 空字符串降级（缺陷，高优先级）
- **文件**: [IngestController.java](file:///workspace/backend/src/main/java/com/example/clip/controller/IngestController.java#L221-L225)
- **问题**: LLM 返回 `{"title": ""}` 时，`getString` 返回 `""` 而非 defaultValue，导致空标题入库
- **改法**: trim 后若为空则返回 defaultValue
```java
private String getString(Map<String, Object> fields, String key, String defaultValue) {
    Object val = fields.get(key);
    if (val == null) return defaultValue;
    String s = val.toString().trim();
    return s.isEmpty() ? defaultValue : s;
}
```
- **注意**: 当 defaultValue 本身为 null 时（如 deadline），空字符串仍返回 null，行为正确

### 修复 2：IngestController 补设 capturedAt（缺陷，中优先级）
- **文件**: [IngestController.java](file:///workspace/backend/src/main/java/com/example/clip/controller/IngestController.java#L186-L196)
- **问题**: `saveAsClip` 未设置 `request.setCapturedAt(...)`，ClipService 第 253 行 `request.getCapturedAt()` 为 null，剪藏记录缺少采集时间
- **改法**: 在构建 ClipRequest 时加一行
```java
request.setCapturedAt(java.time.LocalDateTime.now().toString());
```
- **说明**: 现有 clip/add 流程由浏览器插件传入 capturedAt，ingest 接口无此参数，需后端自动填充

### 修复 3：clip.html 智能入库按钮加载态（缺陷，中优先级）
- **文件**: [clip.html](file:///workspace/frontend/clip.html#L2802-L2847)
- **问题**: `smartIngestClip()` 不禁用按钮、无 loading 指示，用户可能重复点击
- **改法**: 
  - 函数开始时禁用按钮并改文字为"分析中..."
  - finally 块中恢复按钮
  - 移除对不存在的 `#status-message` 元素引用（死代码）
```javascript
async function smartIngestClip() {
    const contentTextarea = document.getElementById('content');
    const text = contentTextarea ? contentTextarea.value.trim() : '';
    if (!text) { showToast('请输入内容'); return; }
    if (text.length < 5) { showToast('内容过短，请至少输入5个字符'); return; }

    const btn = event.target.closest('button');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '分析中...';

    try {
        const response = await fetch('/api/ingest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        const result = await response.json();
        if (result.success) {
            const intentLabel = result.intent === 'todo' ? '待办' : result.intent === 'topic' ? '话题' : '剪藏';
            const degradedNote = result.degraded ? ' (降级存储)' : '';
            showToast(`智能入库成功！识别为${intentLabel}${degradedNote}`);
            clearForm();
            if (typeof fetchClips === 'function') setTimeout(fetchClips, 500);
        } else {
            showToast(result.error || '智能入库失败');
        }
    } catch (error) {
        console.error('智能入库失败:', error);
        showToast('网络错误，请确认后端服务已启动');
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}
```

### 修复 4：popup.js 补长度校验（一致性，低优先级）
- **文件**: [popup.js](file:///workspace/browser-extension/popup.js#L136-L141)
- **问题**: `handleSmartIngest` 只检查空文本，不检查 `text.length < 5`，与后端校验和 clip.html 不一致
- **改法**: 在空值检查后增加长度检查
```javascript
if (text.length < 5) {
    showStatus('内容过短，请至少输入5个字符', 'error');
    return;
}
```

---

## 改进建议（可选，不阻塞）

### 改进 A：smartIngest 增加重试（中等优先级）
- **文件**: [background.js](file:///workspace/browser-extension/background.js#L521-L554)
- **现状**: `smartIngest` 函数无重试，而 `sendToBackendPromise` 有 `apiRetryCount` 重试。用户配置的重试次数对智能入库无效。
- **建议**: 复用 `apiRetryCount` 配置，在 fetch 失败时重试。或暂不实现，在文档中注明智能入库不重试。

### 改进 B：SKILL.md 加同步提醒注释（低优先级）
- **文件**: [SKILL.md](file:///workspace/.trae/skills/smart-ingest/SKILL.md#L12)
- **建议**: 在"意图识别规则"段落前加一行 `> ⚠️ 本规则需与后端 AiService.identifyIntent 的 systemPrompt 保持同步`，提醒维护者双路径一致性。

### 改进 C：saveAsClip 响应 title 用实际存储值（低优先级）
- **文件**: [IngestController.java](file:///workspace/backend/src/main/java/com/example/clip/controller/IngestController.java#L213)
- **现状**: `result.put("title", getString(fields, "title", truncate(rawText, 30)))` 返回 fields 中的 title，而非 `clip.getTitle()`。若 ClipService 规范化了标题，响应与实际存储不一致。
- **建议**: 改为 `result.put("title", clip.getTitle())`，与 saveAsTodo/saveAsTopic 保持一致。

### 改进 D：saveAsClip 的二次保存可优化（低优先级，不修改）
- **文件**: [IngestController.java](file:///workspace/backend/src/main/java/com/example/clip/controller/IngestController.java#L198-L211)
- **现状**: 先 `saveClip(request)` 创建记录，再 `saveClip(clip)` 更新 summary/analysis，两次文件写入。
- **结论**: 经验证 `FileStorageService.saveClip(ClipContent)` 是 upsert 逻辑（按 ID 匹配替换），不会产生重复记录。功能正确，仅效率略低。因 ClipRequest 无 summary/analysis 字段，此 workaround 当前可接受，暂不修改。

---

## Assumptions & Decisions

1. **不改变架构**：双 AI 路径（后端 /api/ingest + Skill 自行分析）是用户明确要求的设计，本次只修复实现缺陷，不重构架构。
2. **不新增功能**：本次仅修复 4 个缺陷 + 提供改进建议，不增加新的入库类型、新的接口参数。
3. **改进项 A-D 为可选**：若用户只要求修复核心缺陷，仅做修复 1-4 即可。
4. **`event.target` 传递**：修复 3 中 `smartIngestClip()` 依赖 `onclick="smartIngestClip()"` 的 event 隐式传递。若严格模式报错，可改为显式传 event 或通过 DOM 查询按钮。

## Verification Steps

1. **修复 1 验证**：POST `/api/ingest` 传 `{"text":"测试空标题场景"}`，若 LLM 返回 `{"title":""}`，确认响应 title 为截断的原文而非空字符串
2. **修复 2 验证**：入库后 GET `/api/clip/list`，确认新剪藏的 capturedAt 不为 null
3. **修复 3 验证**：在 clip.html 点击"智能入库"，确认按钮变为"分析中..."且不可重复点击，完成后恢复
4. **修复 4 验证**：在 popup 输入 3 个字符点智能入库，确认前端拦截提示"内容过短"
5. **回归验证**：原有 `/api/clip/add`、`/api/todo/add`、`/api/topic` 接口行为不变；插件原有剪藏表单功能正常
