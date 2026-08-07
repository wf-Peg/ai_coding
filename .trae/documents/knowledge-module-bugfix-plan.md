# 知识模块 Bug 修复计划

## 摘要

修复知识模块的三个问题：
1. 来源剪藏点击后编辑器打开为空，且导航栏重复渲染
2. 评论区加载和发布均报错（"加载评论失败" / "Failed to fetch"）
3. 关联知识和知识图谱功能使用说明不清晰

---

## 当前状态分析

### Bug 1 根因：来源剪藏导航到不存在的页面

**问题代码**：[knowledge-detail.js#L89](file:///L:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/knowledge-detail.js#L89)

```javascript
onclick="location.href='clip-detail.html?id=${escapeHtml(id)}'"
```

- `clip-detail.html` 文件不存在，未创建过
- `knowledge-detail.html` 在 iframe（knowledgeFrame）中加载，`location.href` 改变的是 iframe 的 URL
- 静态文件服务器对不存在的 SPA 路由返回 `index.html`，导致主应用被嵌套渲染在 iframe 内，出现导航栏重复

**正确的剪藏查看方式**：剪藏详情通过 `clip.html`（剪藏列表页）内的 `.clip-detail` 内联展开区域展示，没有独立的 clip-detail 页面。

### Bug 2 根因：评论 API 端点不存在

**问题代码**：[knowledge-detail.js#L234](file:///L:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/knowledge-detail.js#L234) 和 [knowledge-detail.js#L278](file:///L:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/knowledge-detail.js#L278)

```javascript
fetch(`${API_BASE}/${knowledgeId}/comments`)  // GET - 不存在
fetch(`${API_BASE}/${knowledgeId}/comments`, { method: 'POST' })  // POST - 不存在
```

- [KnowledgeController.java](file:///L:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/controller/KnowledgeController.java) 中没有评论相关的任何端点
- [Knowledge.java](file:///L:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/model/Knowledge.java) 模型中也没有评论字段
- [FileStorageService.java](file:///L:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/FileStorageService.java) 中没有评论存储逻辑

### Bug 3 现状：关联和知识图谱功能已实现但缺少使用指引

- 双向链接已通过 `[[wikilink]]` 语法实现：[KnowledgeService.java#L253-L300](file:///L:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/KnowledgeService.java#L253-L300)
- 知识图谱页面已实现：[knowledge-graph.html](file:///L:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/knowledge-graph.html) + [knowledge-graph.js](file:///L:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/knowledge-graph.js)，使用 D3.js 力导向图
- 知识列表页有"知识图谱"按钮入口：[knowledge.js#L129-L131](file:///L:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/knowledge.js#L129-L131)
- 关联知识在详情页展示（仅显示 ID）：[knowledge-detail.js#L96-L113](file:///L:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/knowledge-detail.js#L96-L113)
- 问题：用户不知道如何创建关联，详情页的关联知识只显示 ID 而非标题

---

## 修改方案

### 修改 1：修复来源剪藏点击（Bug 1）

**文件**：[knowledge-detail.js](file:///L:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/knowledge-detail.js)

**改动**：修改 `renderSourceClips` 函数，将来源剪藏改为内联展示（从后端 API 获取剪藏标题和摘要），不再导航到不存在的页面。

**具体修改**：
- 点击来源剪藏时，通过 `fetch('http://127.0.0.1:8081/api/clips/${clipId}')` 获取剪藏内容
- 在内联弹窗/展开区域中显示剪藏的标题和摘要
- 如需查看完整剪藏，提供跳转到剪藏视图的链接（使用 `window.parent.location.href = '/clip'`）

**文件**：[knowledge-detail.html](file:///L:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/knowledge-detail.html)

**改动**：添加来源剪藏详情弹窗的 HTML 结构和 CSS 样式。

---

### 修改 2：实现评论功能（Bug 2）

#### 2a. 后端：添加评论模型

**新建文件**：`backend/src/main/java/com/example/clip/model/Comment.java`

```java
public class Comment {
    private Long id;
    private Long knowledgeId;
    private String author;
    private String content;
    private LocalDateTime createdAt;
    // getters/setters
}
```

#### 2b. 后端：添加评论存储

**文件**：[FileStorageService.java](file:///L:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/FileStorageService.java)

**改动**：添加评论的 JSON 文件读写方法：
- `saveComment(Comment comment)`：保存评论到 `{knowledgeDir}/comments/{id}.json`
- `getCommentsByKnowledgeId(Long knowledgeId)`：读取某知识的所有评论
- `deleteCommentsByKnowledgeId(Long knowledgeId)`：删除知识时清理评论

#### 2c. 后端：添加评论 API 端点

**文件**：[KnowledgeController.java](file:///L:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/controller/KnowledgeController.java)

**改动**：添加两个端点：
- `GET /api/knowledge/{id}/comments`：获取评论列表
- `POST /api/knowledge/{id}/comments`：发布新评论（body: `{author, content}`）

#### 2d. 前端：无需改动

前端代码 [knowledge-detail.js#L229-L314](file:///L:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/knowledge-detail.js#L229-L314) 已经正确实现了评论加载和提交逻辑，只需后端 API 就位即可正常工作。

---

### 修改 3：改进关联知识展示和使用指引（Bug 3）

#### 3a. 详情页关联知识展示优化

**文件**：[knowledge-detail.js](file:///L:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/knowledge-detail.js)

**改动**：修改 `renderLinkedKnowledge` 函数，通过 API 获取关联知识的标题（而非仅显示 ID）。

```javascript
// 改为：通过 fetch 获取每个关联知识的标题
for (const id of linkedIds) {
  const resp = await fetch(`${API_BASE}/${id}`);
  const k = await resp.json();
  // 渲染为可点击的标题链接
}
```

#### 3b. 添加使用说明

**文件**：[knowledge-detail.html](file:///L:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/knowledge-detail.html)

**改动**：在"关联知识"区域添加使用提示：
- 当没有关联知识时，显示提示："在知识内容中使用 `[[知识标题]]` 语法可创建双向链接"
- 点击关联知识时，使用 `window.parent.location.href` 导航到对应知识详情

#### 3c. 知识图谱入口说明

**文件**：[knowledge-detail.html](file:///L:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/knowledge-detail.html)

**改动**：在关联知识区域底部添加"查看知识图谱"链接按钮，跳转到知识图谱页面。

---

## 假设与决策

1. **评论存储**：评论以 JSON 文件形式存储在知识存储目录下（`{knowledgeDir}/comments/`），与知识文件的存储方式一致，保持轻量级设计
2. **来源剪藏展示**：采用内联弹窗方式展示剪藏详情，而非跳转到 clip 视图，避免 iframe 嵌套导航问题
3. **关联知识**：关联知识展示改为显示标题（通过 API 获取），不再仅显示 ID

## 验证步骤

1. **Bug 1 验证**：
   - 创建一条知识，关联某个来源剪藏
   - 打开知识详情页，点击来源剪藏
   - 确认：弹出内联窗口显示剪藏标题和摘要，无导航栏重复

2. **Bug 2 验证**：
   - 打开知识详情页，评论区应显示"暂无评论，来说点什么吧"
   - 输入昵称和评论内容，点击"发布评论"
   - 确认：评论成功发布，列表刷新显示新评论
   - 再次打开该知识详情页，确认评论持久化

3. **Bug 3 验证**：
   - 在知识编辑器中，内容区域使用 `[[另一条知识标题]]` 语法
   - 保存后，打开知识详情页，确认"关联知识"区域显示链接
   - 点击"知识图谱"按钮，确认图谱页面显示节点和连线
   - 在图谱中拖拽节点、滚轮缩放、点击节点查看详情