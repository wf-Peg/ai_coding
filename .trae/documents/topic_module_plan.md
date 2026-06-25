# 话题模块（Topic）开发计划

## 1. 概述

基于 xiaodao.cool 的设计理念，结合现有"剪藏"系统的功能，新增"话题"模块。核心定位：**分享有价值的 AI 对话，记录 AI 对话，收藏优质内容，分享你的发现**。

当前分支：`feature-topic-module`（已创建）

## 2. xiaodao.cool 分析

### 2.1 核心特征
- **卡片流布局**：每个话题以卡片形式展示，包含封面图、标题、摘要、日期、互动数
- **精编对话**：将冗长的 AI 对话提炼为可阅读的精华内容
- **话题分类**：涵盖哲学、技术、生活、游戏等多领域
- **互动机制**：点赞/评论计数展示
- **简洁设计**：类 Notion 风格，图文并茂

### 2.2 可借鉴的设计
| 特征 | xiaodao.cool 实现 | 当前系统可复用 |
|------|------------------|---------------|
| 封面图 | 每篇对话生成封面 | 新增 AI 生成封面 |
| 卡片流 | 响应式网格布局 | 新建 topic.html |
| 精编对话 | 提炼对话精华 | 复用现有 AI 分析能力 |
| 互动计数 | 点赞/评论数 | 简化为本地收藏计数 |
| 话题分类 | 多领域标签 | 复用现有分类+标签体系 |

## 3. 当前系统架构分析

### 3.1 现有模型
- `ClipContent`：剪藏内容（id, content, type, source, category, tags, summary, analysis, createdAt...）
- `KnowledgeEntry`：知识条目（id, sourceClipId, title, summary, insight, tags, keywords...）
- `TodoContent`：待办事项

### 3.2 现有前端
- `index.html`：双栏布局（todo + clip iframe）→ 已改为左侧导航栏切换
- `clip.html`：剪藏管理（添加/列表/搜索/分析）
- `todo.html`：待办事项

### 3.3 现有后端
- `ClipController`：`/api/clip` CRUD + AI 分析 + 整理
- `KnowledgeController`：`/api/knowledge` 知识衍生
- `TodoController`：`/api/todo` 待办管理

## 4. 方案设计

### 4.1 Topic 模型

```java
// backend/.../model/Topic.java
public class Topic {
    private Long id;              // 话题ID
    private String title;         // 话题标题
    private String summary;       // 一句话摘要
    private String content;       // 完整的AI对话内容（Markdown）
    private String coverImage;    // 封面图路径（可选，AI自动生成）
    private String category;      // 分类
    private List<String> tags;    // 标签
    private Long sourceClipId;    // 来源剪藏ID（可选，从已有剪藏创建）
    private boolean published;    // 是否发布
    private int likeCount;        // 点赞数（本地）
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
```

### 4.2 后端模块

| 文件 | 路径 | 说明 |
|------|------|------|
| `Topic.java` | `backend/.../model/Topic.java` | 话题数据模型 |
| `TopicRequest.java` | `backend/.../dto/TopicRequest.java` | 创建/更新请求DTO |
| `TopicResponse.java` | `backend/.../dto/TopicResponse.java` | 响应DTO |
| `TopicService.java` | `backend/.../service/TopicService.java` | 话题业务逻辑 |
| `TopicController.java` | `backend/.../controller/TopicController.java` | REST API |
| `FileStorageService.java` | `backend/.../service/FileStorageService.java` | 已修改：增加Topic存储方法 |

### 4.3 API 设计

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/topic` | 创建新话题 |
| `GET` | `/api/topic/list` | 获取话题列表（分页、分类筛选） |
| `GET` | `/api/topic/{id}` | 获取话题详情 |
| `PUT` | `/api/topic/{id}` | 更新话题 |
| `DELETE` | `/api/topic/{id}` | 删除话题 |
| `POST` | `/api/topic/{id}/like` | 点赞 |
| `POST` | `/api/topic/from-clip/{clipId}` | 从剪藏创建话题 |
| `GET` | `/api/topic/search` | 搜索话题 |

### 4.4 前端页面

| 文件 | 路径 | 说明 |
|------|------|------|
| `topic.html` | `frontend/topic.html` | 话题列表页（卡片流） |
| `topic.js` | `frontend/topic.js` | 话题列表页逻辑 |
| `topic-detail.html` | `frontend/topic-detail.html` | 话题详情页 |
| `topic-detail.js` | `frontend/topic-detail.js` | 话题详情页逻辑 |
| `topic-editor.html` | `frontend/topic-editor.html` | 话题编辑器（新建/编辑） |
| `topic-editor.js` | `frontend/topic-editor.js` | 话题编辑器逻辑 |

### 4.5 导航整合

已修改 `index.html`：
- 左侧增加导航栏（`nav-sidebar`），包含"首页"和"话题"两个导航项
- 点击"话题"时，通过 iframe 加载 `topic.html`
- 全局 `.app-layout` flex 布局，`.main-content` 为内容区

### 4.6 页面布局设计

#### 话题列表页（topic.html）
```
┌──────────────────────────────────────────────┐
│  🔍 搜索话题...    [+ 新建话题]  [分类筛选▼]  │
├──────────────────────────────────────────────┤
│  ┌────────┐ ┌────────┐ ┌────────┐           │
│  │ 封面图  │ │ 封面图  │ │ 封面图  │           │
│  │ 标题    │ │ 标题    │ │ 标题    │           │
│  │ 摘要    │ │ 摘要    │ │ 摘要    │           │
│  │ 标签    │ │ 标签    │ │ 标签    │           │
│  │ ♥12    │ │ ♥8     │ │ ♥23    │           │
│  └────────┘ └────────┘ └────────┘           │
└──────────────────────────────────────────────┘
```

#### 话题详情页（topic-detail.html）
```
┌──────────────────────────────────────────────┐
│  ← 返回列表    标题    编辑  删除             │
├──────────────────────────────────────────────┤
│         [封面大图 - AI生成]                    │
│  标题                                         │
│  标签  分类  ·  创建时间                       │
│  ── 摘要 ──                                   │
│  ── AI对话内容 ──                              │
│  ♥ 点赞  ☆ 收藏                               │
└──────────────────────────────────────────────┘
```

#### 话题编辑器（topic-editor.html）
```
┌──────────────────────────────────────────────┐
│  新建话题                      [保存] [发布]  │
├──────────────────────────────────────────────┤
│  标题 / 摘要 / 分类 / 标签                     │
│  ── AI对话内容 ──                              │
│  [Markdown编辑器]                              │
│  [从已有剪藏导入]  [AI生成封面]                │
└──────────────────────────────────────────────┘
```

## 5. 实现状态

| 步骤 | 内容 | 状态 |
|------|------|------|
| Step 1 | 创建 `feature-topic-module` 分支 | ✅ 已完成 |
| Step 2 | 后端 - 模型与DTO（Topic.java, TopicRequest.java, TopicResponse.java） | ✅ 已完成 |
| Step 3 | 后端 - Service 与 FileStorageService（TopicService.java, FileStorageService.java） | ✅ 已完成 |
| Step 4 | 后端 - Controller（TopicController.java） | ✅ 已完成 |
| Step 5 | 前端 - 话题列表页（topic.html + topic.js） | ✅ 已完成 |
| Step 6 | 前端 - 话题详情页（topic-detail.html + topic-detail.js） | ✅ 已完成 |
| Step 7 | 前端 - 话题编辑器（topic-editor.html + topic-editor.js） | ✅ 已完成 |
| Step 8 | 前端 - 导航整合（index.html 左侧导航栏） | ✅ 已完成 |
| Step 9 | 浏览器扩展 - 话题支持 | ⬜ 待实现 |
| Step 10 | Electron 集成 | ⬜ 待实现 |

## 6. 待实现任务

### Step 9：浏览器扩展 - 增加话题支持

#### 9.1 背景
`popup.html` 和 `popup.js` 已添加"话题"入口链接，`manifest.json` 已包含 topic 页面资源。但 `background.js` 的右键菜单中还没有"剪藏到话题"选项。

#### 9.2 修改文件
- `browser-extension/background.js`

#### 9.3 具体修改
在 `createContextMenus()` 函数中，`clip-separator` 之后、`clip-ai-text` 之前，新增一个"剪藏到话题"菜单项：

```javascript
chrome.contextMenus.create({
    id: 'clip-to-topic',
    parentId: 'clip-main',
    title: '剪藏到话题',
    contexts: ['page', 'selection']
});
```

在 `handleContextMenuClick()` 的 switch 中，新增处理分支：

```javascript
case 'clip-to-topic':
    await clipToTopic(tab, info);
    break;
```

新增 `clipToTopic()` 函数：
- 获取页面内容或选中文本
- 打开 topic-editor.html 并预填内容（通过 URL 参数传递）
- 或者：先保存为剪藏，再跳转到 topic-editor.html 的"从剪藏导入"流程

**推荐方案**：获取选中内容/页面内容后，打开 `topic-editor.html?fromClip=1&title=xxx&content=xxx`，在编辑器页面接收参数并预填表单。

### Step 10：Electron 集成验证

#### 10.1 背景
Electron 主进程通过静态文件服务器（`serve-static`）加载 `frontend/` 目录。`index.html` 已包含话题导航，通过 iframe 加载 `topic.html`。理论上话题页面已可在 Electron 中正常访问。

#### 10.2 验证要点
- 启动 Electron 应用后，点击左侧"话题"导航，确认 `topic.html` 能正常加载
- 确认话题列表、详情、编辑器页面在 Electron 的 webview 中运行正常
- 确认话题 API 调用（`127.0.0.1:8080/api/topic/*`）在 Electron 环境中无 CORS 问题

#### 10.3 可能需要的修改
- 无需修改 `electron/main.js`（前端静态文件服务已覆盖所有 HTML 页面）
- 如果 iframe 中 topic 页面无法访问后端 API（CORS），需要确保 `TopicController` 已添加 `@CrossOrigin(origins = "*")` 注解

## 7. 文件变更清单

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 新增 | `backend/.../model/Topic.java` | 话题数据模型 |
| 新增 | `backend/.../dto/TopicRequest.java` | 创建/更新请求DTO |
| 新增 | `backend/.../dto/TopicResponse.java` | 响应DTO |
| 新增 | `backend/.../service/TopicService.java` | 话题业务逻辑 |
| 新增 | `backend/.../controller/TopicController.java` | REST API |
| 修改 | `backend/.../service/FileStorageService.java` | 增加Topic存储方法 |
| 新增 | `frontend/topic.html` | 话题列表页 |
| 新增 | `frontend/topic.js` | 话题列表页逻辑 |
| 新增 | `frontend/topic-detail.html` | 话题详情页 |
| 新增 | `frontend/topic-detail.js` | 话题详情页逻辑 |
| 新增 | `frontend/topic-editor.html` | 话题编辑器 |
| 新增 | `frontend/topic-editor.js` | 话题编辑器逻辑 |
| 修改 | `frontend/index.html` | 增加左侧导航栏 |
| 修改 | `browser-extension/background.js` | 增加"剪藏到话题"右键菜单 |
| 修改 | `browser-extension/popup.html` | 增加话题入口 |
| 修改 | `browser-extension/popup.js` | 增加话题页面跳转函数 |
| 修改 | `browser-extension/manifest.json` | 新增话题页面资源 |

## 8. 验证方式

1. 启动后端：`cd backend && mvn spring-boot:run`
2. 启动前端：`cd frontend && python3 -m http.server 3000`
3. 访问 `http://127.0.0.1:3000`，验证导航栏切换到"话题"
4. 测试创建话题（手动 + 从剪藏导入）
5. 测试话题列表展示、搜索、分类筛选
6. 测试点赞、收藏功能
7. 测试浏览器扩展右键菜单"剪藏到话题"
8. 测试 Electron 应用中话题页面加载