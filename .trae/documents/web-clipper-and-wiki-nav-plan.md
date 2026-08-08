# Web Clipper 同步优化 + LLM Wiki 导航集成方案

> **For agentic workers:** 请使用 subagent-driven-development 或 executing-plans skill 按任务逐步实施。步骤使用复选框 (`- [ ]`) 标记进度。

**目标：** 优化 Web Clipper 同步剪藏内容存储结构（保留 wiki-link 引用，新增 bodyContent 存正文），并在导航栏集成 LLM Wiki 入口。

**架构：** 后端 ClipContent 模型新增 `bodyContent` 字段，SourceSyncService 将 content 保留为 wiki-link、bodyContent 存储正文；前端 clip.html 展示 bodyContent 及源信息；index.html 导航栏新增 Wiki 按钮，通过 iframe 嵌入 wiki.html。

**Tech Stack:** Java 21 / Spring Boot, Jackson JSON, HTML/CSS/JS, iframe SPA

---

## 一、设计概述

### 变更说明

根据用户反馈，原方案「content 直接存储正文」需改为：

| 字段 | 原方案 | 新方案 |
|------|--------|--------|
| `content` | 存正文 | **保留 wiki-link**（`[[sources/文件名|标题]]`） |
| `bodyContent` | 不存在 | **新增字段**，存正文（不含 frontmatter） |
| 前端展示 | 显示 content | 显示 **bodyContent** + sourceUrl + sourceFilePath |

### LLM Wiki 入口位置

- 导航栏位置：**「知识」和「密码」之间**新增独立「Wiki」按钮
- 图标设计：参考 Obsidian 的书本/知识库图标风格
- 视图面板：通过 iframe 嵌入 wiki.html，保持与现有视图一致的切换逻辑

---

## 二、修改文件清单

| 文件 | 修改内容 | 类型 |
|------|---------|------|
| `backend/.../model/ClipContent.java` | 新增 `bodyContent` 字段 + getter/setter | 新增字段 |
| `backend/.../service/sync/SourceSyncService.java` | content 改回 wiki-link，bodyContent 存正文 | 修改逻辑 |
| `frontend/clip.html` | 展示 bodyContent、sourceUrl、sourceFilePath | 修改逻辑 |
| `frontend/index.html` | 新增 Wiki 导航按钮、视图面板、viewMap 注册、pathToView 路由 | 新增结构 |
| `frontend/wiki.html` | 适配 iframe 嵌入（移除 header sticky），优化视觉风格 | 修改样式 |

---

### Task 1: ClipContent 模型新增 `bodyContent` 字段

**文件：**
- Modify: `backend/src/main/java/com/example/clip/model/ClipContent.java`

- [ ] **Step 1: 在 `sourceFilePath` 字段之后新增 `bodyContent` 字段**

```java
    /**
     * Web Clipper 同步的原始正文内容（不含 frontmatter）。
     * <p>
     * 当剪藏来源于 Obsidian Web Clipper 同步时，存储 frontmatter 之后的
     * Markdown 正文内容，用于前端展示和 AI 分析。与 {@link #content} 不同，
     * content 保留 wiki-link 引用 {@code [[sources/文件名|标题]]} 用于 Obsidian
     * 集成，bodyContent 存储实际可读的正文内容。
     * </p>
     */
    private String bodyContent;
```

- [ ] **Step 2: 新增 getter 方法（放在 sourceFilePath getter 之后）**

```java
    /**
     * 返回 Web Clipper 同步的原始正文内容。
     *
     * @return 正文内容（不含 frontmatter）；非同步剪藏返回 null
     */
    public String getBodyContent() {
        return bodyContent;
    }
```

- [ ] **Step 3: 新增 setter 方法**

```java
    /**
     * 设置 Web Clipper 同步的原始正文内容。
     *
     * @param bodyContent 正文内容
     */
    public void setBodyContent(String bodyContent) {
        this.bodyContent = bodyContent;
    }
```

---

### Task 2: SourceSyncService 改为 content 存 wiki-link，bodyContent 存正文

**文件：**
- Modify: `backend/src/main/java/com/example/clip/service/sync/SourceSyncService.java`

- [ ] **Step 1: 修改 `syncSources()` 中的内容存储逻辑**

将当前已经改为存正文的代码改回 wiki-link，并新增 bodyContent 设置：

```java
// 修改 syncSources() 中第 185-189 行
// 当前代码（已修改为存正文）：
// String bodyContent = parser.extractBodyContent(content);
// String effectiveContent = (bodyContent != null && !bodyContent.isBlank())
//         ? bodyContent : clip.getSummary();
// clip.setContent(effectiveContent != null ? effectiveContent : "");

// 改为：
// content 保留 wiki-link 引用（用于 Obsidian 集成）
clip.setContent(buildWikiLink(fileName, clip.getTitle()));
// bodyContent 存储实际正文（不含 frontmatter），用于前端展示和 AI 分析
String bodyContent = parser.extractBodyContent(content);
if (bodyContent != null && !bodyContent.isBlank()) {
    clip.setBodyContent(bodyContent);
} else if (clip.getSummary() != null && !clip.getSummary().isBlank()) {
    clip.setBodyContent(clip.getSummary());
}
```

---

### Task 3: clip.html 前端展示优化

**文件：**
- Modify: `frontend/clip.html`

- [ ] **Step 1: 修改 `renderContent()` 函数（第 4214-4224 行）**

不再检测 wiki-link 格式并渲染为可点击链接，改为直接显示纯文本：

```javascript
// 修改后的 renderContent()
function renderContent(content) {
    if (!content) return '';
    // 直接显示纯文本内容，不再渲染 wiki-link 为可点击链接
    return escapeHtml(content);
}
```

- [ ] **Step 2: 在剪藏详情区域增加 `sourceUrl` 和 `sourceFilePath` 展示（Notion 风格）**

在 `clip-detail` 中原文区域下方（第 3938 行附近），增加。设计参考 Notion 的源信息样式——用小号字体、柔和颜色、hover 时链接变色：

```javascript
// 在原文区域和复制按钮之后，增加源信息展示
${clip.sourceUrl ? `
<div class="source-link" style="margin-top: 8px; transition: opacity 0.2s ease;">
    <a href="${escapeHtml(clip.sourceUrl)}" target="_blank" rel="noopener" style="font-size:0.85rem;color:var(--primary);text-decoration:none;display:inline-flex;align-items:center;gap:4px;transition:color 0.2s ease;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        查看原始网页
    </a>
</div>
` : ''}
${clip.sourceFilePath ? `
<div class="source-file" style="font-size:0.82rem;color:var(--text-secondary);margin-top:4px;display:flex;align-items:center;gap:4px;padding:2px 0;">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
    源文件: ${escapeHtml(clip.sourceFilePath)}
</div>
` : ''}
```

- [ ] **Step 3: 修改展示逻辑使用 `bodyContent` 而非 `content`**

在 `toggleDetail()` 函数中，找到使用 `originalContent` 的地方，确认优先使用 `bodyContent`：

```javascript
// 在 toggleDetail() 中，定义 originalContent 时：
// 优先使用 bodyContent（同步剪藏的正文），回退到 content
const originalContent = clip.bodyContent || clip.content || '';
```

（如果 `clip.bodyContent` 在 API 返回中不存在，兼容旧数据回退到 `clip.content`）

---

### Task 4: index.html 导航栏集成 Wiki 入口

**文件：**
- Modify: `frontend/index.html`

- [ ] **Step 1: 新增 Wiki 导航按钮（在「知识」和「密码」之间）**

在 `knowledge` 按钮之后、`vault` 按钮之前插入：

```html
<button class="nav-btn" data-view="wiki">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        <path d="M8 7h8M8 11h6M8 15h4"/>
    </svg>
    Wiki
</button>
```

- [ ] **Step 2: 新增 Wiki 视图面板（在 `knowledgeView` 之后、`vaultView` 之前）**

```html
<!-- Wiki 知识库 -->
<div class="view-panel view-panel-hidden" id="wikiView">
    <iframe id="wikiFrame" data-src="wiki.html" style="width:100%;height:100%;border:none;"></iframe>
</div>
```

- [ ] **Step 3: 获取 DOM 元素**

在 `const navBtns = ...` 附近的 DOM 获取中增加（在 `knowledgeView` 获取之后）：

```javascript
const wikiView = document.getElementById('wikiView');
const wikiFrame = document.getElementById('wikiFrame');
```

- [ ] **Step 4: 注册到 `viewMap`**

```javascript
const viewMap = {
    // ... 现有映射
    knowledge: knowledgeView,
    wiki: wikiView,  // 新增
    vault: vaultView,
    // ...
};
```

- [ ] **Step 5: 注册到 `VIEW_IFRAME`**

```javascript
const VIEW_IFRAME = {
    // ... 现有映射
    knowledge: [knowledgeFrame],
    wiki: [wikiFrame],  // 新增
    vault: [vaultFrame],
    // ...
};
```

- [ ] **Step 6: 更新 `broadcastThemeChange` 中的 iframe 列表**

```javascript
function broadcastThemeChange() {
    [editorFrame, workspaceFrame, todoFrame, clipFrame, knowledgeFrame, wikiFrame, vaultFrame, settingsFrame, learningPlanFrame, pdfFrame, dataObservabilityFrame].forEach(frame => {
        // ... 现有逻辑
    });
}
```

- [ ] **Step 7: 更新 `pathToView` 函数**

```javascript
if (clean === '/wiki') return 'wiki';
```

- [ ] **Step 8: 更新导航点击事件和 popstate 事件**

导航按钮点击事件（`data-view="wiki"`）和 popstate 路由已通过通用逻辑自动处理，无需额外修改。

---

### Task 5: wiki.html 适配 iframe 嵌入 + 视觉优化

**文件：**
- Modify: `frontend/wiki.html`

- [ ] **Step 1: 移除 header 的 sticky 定位**

将 header 的 sticky 定位改为普通定位，避免 iframe 内出现双滚动条：

```css
/* 修改前 */
.header {
    position: sticky;
    top: 0;
    z-index: 100;
    backdrop-filter: blur(10px);
    background: rgba(255,255,255,0.9);
}

/* 修改后 */
.header {
    position: relative;
    /* 去掉 sticky 和 top/z-index，保留其他样式 */
    backdrop-filter: blur(10px);
    background: rgba(255,255,255,0.9);
}
```

- [ ] **Step 2: 移除 max-width 容器限制，改为自适应**

将 container 的 max-width 限制放开，让内容在 iframe 中全宽展示：

```css
.container {
    max-width: 100%;  /* 改为 100% 而非固定 900px */
    margin: 0 auto;
    padding: 20px 24px 48px;
}
```

- [ ] **Step 3: 优化视觉风格（参考 Obsidian/Notion，增加动画和高级感）**

设计原则：
- 颜色、字体、间距与全局主题变量保持一致（使用 `var(--bg)`、`var(--card)`、`var(--border)` 等）
- 按钮和交互元素增加平滑过渡动画（`transition: all 0.2s ease`）
- 卡片 hover 增加微提升效果（`transform: translateY(-1px)` + 阴影变化）
- 表单输入框 focus 状态增加发光效果（`box-shadow: 0 0 0 3px var(--primary-glow)`）
- 滚动条样式统一（窄滚动条、圆角滑块、主题色一致）
- Tab 切换增加淡入动画（`opacity` + `transform` 过渡）
- 按钮点击增加微缩反馈（`active` 状态 `transform: scale(0.97)`）
- 查询结果区域增加骨架屏加载效果而非简单 spinner

调整卡片间距、圆角、阴影，使其与全局主题更贴合：

```css
.card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;  /* 从 12px 略微调小 */
    padding: 18px 22px;
    margin-bottom: 14px;
    transition: box-shadow 0.2s ease;
}
.card:hover {
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
}
```

- [ ] **Step 4: 适配主题变量**

确保 wiki.html 使用与 index.html 一致的主题变量体系（无需额外修改，已通过 `data-theme` 属性同步）。

---

## 三、边界情况

| 情况 | 行为 |
|------|------|
| 历史数据（content 是 wiki-link，无 bodyContent） | 前端回退展示 `clip.content` 作为纯文本 |
| 正文为空 | bodyContent 为空，回退到 `summary`（来自 frontmatter description） |
| sourceUrl 为空 | 不显示 URL 链接 |
| sourceFilePath 为空 | 不显示文件路径 |
| 非 Web Clipper 同步的剪藏 | bodyContent 为 null，clip.content 作为正文展示 |
| wiki.html 首次加载 | iframe 懒加载，不影响首页启动速度 |

## 四、验证步骤

1. `mvn compile` 确认后端编译通过
2. 放一个测试 .md 文件到 `sources/` 目录（含 frontmatter 和正文）
3. 点击「立即同步」，确认：
   - 剪藏列表中新增一条剪藏
   - 展开后「原文」区域显示的是文件正文内容，不是 wiki-link
   - 能看到原始 URL 链接（如果有 sourceUrl）
   - 能看到源文件路径
4. 导航栏中能看到 Wiki 按钮，点击后切换到 Wiki 页面
5. Wiki 页面中各 Tab 功能正常，无滚动条错乱
6. 回到「剪藏」视图，点击「快速AI整理」，确认 AI 能正常分析正文内容