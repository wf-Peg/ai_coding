# 知识详情页 [[知识标题]] 渲染美化计划

## Summary

美化知识详情页中 `[[知识标题]]` 的渲染效果，使其像 Obsidian 一样以蓝色链接样式显示，支持点击跳转到对应知识详情页，同时保留完整的 Markdown 渲染能力。

## Current State Analysis

### 当前数据流

```
后端 API 返回 knowledgeData
 ├── content: "这是一段内容 [[某知识]] 更多内容"   ← 原始 Markdown 文本
 ├── linkedKnowledgeIds: [123, 456]              ← 后端已解析的关联 ID 列表
 └── title, summary, tags, ...
         │
         ▼
renderDetail(knowledge)
 ├── marked.parse(content) → HTML                ← [[某知识]] 被当作纯文本渲染
 └── 渲染到 .topic-content 容器
         │
         ▼
renderLinkedKnowledge(knowledge)                 ← 独立区域，底部展示关联知识
 └── 遍历 linkedKnowledgeIds → fetch 标题 → 渲染可点击列表
```

### 问题

1. `[[知识标题]]` 在内容区域显示为纯文本 `[[某知识]]`，没有任何样式区分
2. 无法点击跳转——用户必须滚动到底部"关联知识"区域才能跳转
3. 与 Obsidian 的 wikilink 体验差距大

### 关键文件

| 文件 | 作用 |
|------|------|
| `frontend/knowledge-detail.js` | 知识详情页渲染逻辑，`renderDetail` 函数（第31-73行） |
| `frontend/knowledge-detail.html` | 知识详情页 HTML/CSS 样式 |
| `frontend/libs/marked.min.js` | Markdown 解析库 |

## Proposed Changes

### 1. `knowledge-detail.js` — 构建标题→ID 映射表并预处理 `[[wikilink]]`

**位置**：`renderDetail` 函数，第44-54行

**改动**：在 `marked.parse()` 之前，利用 `knowledgeData.linkedKnowledgeIds` 获取每个关联知识的标题，构建 `titleToId` 映射表。然后用正则将 `[[知识标题]]` 替换为带 CSS class 的 HTML 链接标签，再交给 `marked.parse()` 渲染。

**关键逻辑**：

```javascript
// 1. 构建 titleToId 映射（从 linkedKnowledgeIds 获取标题）
const titleToIdMap = {};
if (knowledge.linkedKnowledgeIds && knowledge.linkedKnowledgeIds.length > 0) {
  await Promise.all(knowledge.linkedKnowledgeIds.map(async (id) => {
    try {
      const resp = await fetch(`${API_BASE}/${id}`);
      if (resp.ok) {
        const k = await resp.json();
        titleToIdMap[k.title] = id;
      }
    } catch { /* ignore */ }
  }));
}

// 2. 预处理 content：将 [[Title]] 替换为 HTML 链接
let processedContent = knowledge.content;
if (Object.keys(titleToIdMap).length > 0) {
  processedContent = processedContent.replace(
    /\[\[([^\]]+)\]\]/g,
    (match, title) => {
      const id = titleToIdMap[title.trim()];
      if (id) {
        return `<a class="wikilink" href="javascript:void(0)" onclick="navigateToKnowledge(${id})" data-knowledge-id="${id}">${escapeHtml(title.trim())}</a>`;
      }
      return match; // 未匹配到的保留原文
    }
  );
}

// 3. marked.parse(processedContent)
```

**注意**：`renderDetail` 当前是同步函数，需要改为 `async`。

### 2. `knowledge-detail.html` — 添加 Obsidian 风格 wikilink CSS

**位置**：`<style>` 标签内，`.topic-content a` 附近

**新增样式**：

```css
/* Wikilink 样式 — Obsidian 风格 */
.wikilink {
    color: var(--primary);
    text-decoration: none;
    border-bottom: 1px dashed var(--primary);
    padding: 0 2px;
    border-radius: 2px;
    transition: all 0.15s ease;
    cursor: pointer;
}
.wikilink:hover {
    background: rgba(63, 140, 255, 0.08);
    border-bottom-style: solid;
}
.wikilink:visited {
    color: #7c3aed;  /* 已访问过的链接变为紫色 */
}
.wikilink::before {
    content: "[[";
    color: var(--text-muted);
    font-size: 0.85em;
    opacity: 0.6;
}
.wikilink::after {
    content: "]]";
    color: var(--text-muted);
    font-size: 0.85em;
    opacity: 0.6;
}

/* 深色主题 */
html[data-theme="dark"] .wikilink:hover {
    background: rgba(86, 156, 255, 0.12);
}
html[data-theme="dark"] .wikilink:visited {
    color: #a78bfa;
}

/* Notion 主题 */
html[data-theme="notion"] .wikilink {
    color: #2383e2;
    border-bottom-color: #2383e2;
}
html[data-theme="notion"] .wikilink:hover {
    background: rgba(35, 131, 226, 0.08);
}
html[data-theme="notion"] .wikilink:visited {
    color: #7c3aed;
}
```

### 3. `knowledge-detail.js` — `renderDetail` 改为 async

**位置**：第31行函数签名

**改动**：`function renderDetail(knowledge)` → `async function renderDetail(knowledge)`，并在 `fetchKnowledgeDetail` 中 `await renderDetail(knowledgeData)`。

## Assumptions & Decisions

- **wikilink HTML 在 marked.parse 前注入**：marked.js 会将 `<a>` 标签原样保留（不转义），所以 wikilink 替换后不会被 marked 转义。这是最轻量的方案，无需修改 marked 库。
- **未匹配的 wikilink 保留原文**：如果 `[[某标题]]` 在 `linkedKnowledgeIds` 中找不到对应项，保留原始文本 `[[某标题]]`。
- **`navigateToKnowledge` 函数已存在**：已在之前的修复中添加（knowledge-detail.js 第118-121行），通过 `postMessage` 通知父窗口导航。
- **三个主题（Regular、Dark、Notion）均需适配**：CSS 变量 + 主题选择器覆盖。

## Verification Steps

1. 打开一条有 `[[知识标题]]` 引用的知识详情页
2. 确认 `[[知识标题]]` 渲染为蓝色虚线链接样式，不再是纯文本
3. 点击 wikilink，确认跳转到对应的知识详情页
4. 切换 Dark/Notion 主题，确认 wikilink 颜色跟随主题变化
5. 确认普通 Markdown 内容（标题、列表、代码块等）渲染不受影响
6. 确认 `myThoughts` 区域中的 `[[wikilink]]` 也正确渲染