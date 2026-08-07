# Tasks

- [x] Task 1: 后端模型重构 — Topic → Knowledge
  - [x] 1.1 新建 `Knowledge.java` 模型，字段：id, title, summary, content, category, tags, sourceClipIds(List), myThoughts, linkedKnowledgeIds(List), createdAt, updatedAt
  - [x] 1.2 新建 `KnowledgeRequest.java` 和 `KnowledgeResponse.java` DTO
  - [x] 1.3 新建 `KnowledgeService.java`，实现 CRUD + 双向链接管理 + 多来源关联 + 按剪藏ID反查关联知识
  - [x] 1.4 新建 `KnowledgeController.java`，路由 `/api/knowledge`，接口：POST /（创建）、GET /list（列表+搜索+分类筛选）、GET /{id}（详情）、PUT /{id}（更新）、DELETE /{id}（删除）、GET /by-clip/{clipId}（按剪藏查关联知识）、POST /synthesize（AI 知识合成）
  - [x] 1.5 更新 `FileStorageService.java`：Topic 存储方法改为 Knowledge 存储方法
  - [x] 1.6 删除旧文件：Topic.java、TopicRequest.java、TopicResponse.java、TopicService.java、TopicController.java、Comment.java
  - [x] 1.7 编译验证：`mvn clean compile -DskipTests`（BUILD SUCCESS）

- [x] Task 2: 前端知识列表页 & 详情页
  - [x] 2.1 重命名 `topic.html` → `knowledge.html`，`topic.js` → `knowledge.js`，更新 API 路径和页面标题
  - [x] 2.2 增强列表展示：显示来源剪藏数、关联知识数、更新时间；保持纯文字列表风格
  - [x] 2.3 重命名 `topic-detail.html` → `knowledge-detail.html`，`topic-detail.js` → `knowledge-detail.js`
  - [x] 2.4 详情页增强：展示"来源剪藏"列表（可点击跳转剪藏详情）、"关联知识"列表（可点击跳转）、"我的思考"区域

- [x] Task 3: 知识编辑器增强
  - [x] 3.1 重命名 `topic-editor.html` → `knowledge-editor.html`，`topic-editor.js` → `knowledge-editor.js`
  - [x] 3.2 集成 Markdown 编辑器（复用现有编辑器模块），替换当前纯 textarea
  - [x] 3.3 实现 `[[` 自动补全：输入 `[[` 时弹出知识条目搜索下拉，选中后插入 `[[条目名]]`
  - [x] 3.4 支持多来源剪藏选择：编辑器中增加"关联来源"区域，从剪藏列表搜索并添加
  - [x] 3.5 保存时解析 wikilink，自动建立双向链接

- [x] Task 4: 知识图谱页面
  - [x] 4.1 新建 `knowledge-graph.html` + `knowledge-graph.js`
  - [x] 4.2 使用 D3.js 实现力导向图渲染
  - [x] 4.3 节点交互：点击高亮、侧边面板展示摘要、跳转详情
  - [x] 4.4 支持拖拽节点、缩放、平移

- [x] Task 5: AI 知识合成
  - [x] 5.1 后端实现 `POST /api/knowledge/synthesize`：接收 clipIds 列表，调用 AI 合成知识条目初稿
  - [x] 5.2 剪藏列表页增加批量选择和"合成知识条目"按钮
  - [x] 5.3 合成成功后跳转到知识编辑器，预填 AI 生成内容

- [x] Task 6: 剪藏详情集成
  - [x] 6.1 剪藏详情页底部增加"已关联知识"区域
  - [x] 6.2 展示引用该剪藏的所有知识条目，点击可跳转
  - [x] 6.3 无关联时显示"创建知识条目"入口按钮

- [x] Task 7: 导航与路由更新
  - [x] 7.1 `index.html`：导航栏"话题"→"知识"，URL 路由 `/topic` → `/knowledge`
  - [x] 7.2 知识列表页 header 增加"知识图谱"入口按钮
  - [x] 7.3 删除旧 topic 文件（topic.html/js/detail/editor）

# Task Dependencies

- Task 2 依赖 Task 1（需要后端 API 就绪）
- Task 3 依赖 Task 1（需要后端 API 就绪）
- Task 4 依赖 Task 1（需要后端 API 就绪）
- Task 5 依赖 Task 1（需要后端 API 就绪）
- Task 6 依赖 Task 1（需要后端 API 就绪）
- Task 7 无依赖，可与 Task 1 并行