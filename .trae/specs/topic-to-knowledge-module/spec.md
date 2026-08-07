# 话题模块改造为知识模块 Spec

## Why

当前"话题模块"定位模糊——它混合了社交分享（published、likeCount、comments）和个人记录（content、myThoughts），但 CutShelter 本质是个人信息管理工具，不是社交平台。用户需要的是"知识的沉淀与整理"，而非"话题的发布与互动"。将话题模块改造为知识模块，使其成为剪藏→加工→归档流程的最终环节，承载结构化的个人知识。

## What Changes

- **BREAKING**: 移除社交属性字段（published、likeCount、comments），不再支持发布/点赞/评论
- **BREAKING**: 导航栏名称从"话题"改为"知识"
- 知识条目支持多来源剪藏关联（从单一的 sourceClipId 改为多来源）
- 知识条目之间支持双向链接 `[[条目名]]`，形成知识网络
- 新增知识图谱可视化页面（简单力导向图，展示知识条目间的关联）
- 增强列表页：从纯文字列表改为卡片+文字混合，支持知识条目互相引用展示
- 增强编辑器：复用现有编辑器模块的 Markdown 编辑能力，支持 `[[` 自动补全知识条目链接
- 新增 AI 知识合成能力：从多条剪藏一键生成知识条目
- 剪藏详情页增加"已关联知识"展示区

## Impact

- Affected specs: 无（话题模块为独立模块）
- Affected code:
  - `backend/.../model/Topic.java` → 重命名为 `Knowledge.java` 并重构字段
  - `backend/.../dto/TopicRequest.java` → 重命名为 `KnowledgeRequest.java`
  - `backend/.../dto/TopicResponse.java` → 重命名为 `KnowledgeResponse.java`
  - `backend/.../service/TopicService.java` → 重命名为 `KnowledgeService.java`
  - `backend/.../controller/TopicController.java` → 重命名为 `KnowledgeController.java`
  - `backend/.../service/FileStorageService.java` → 更新 Topic 存储方法引用
  - `frontend/topic.html` → 重命名为 `knowledge.html`
  - `frontend/topic.js` → 重命名为 `knowledge.js`
  - `frontend/topic-detail.html` → 重命名为 `knowledge-detail.html`
  - `frontend/topic-detail.js` → 重命名为 `knowledge-detail.js`
  - `frontend/topic-editor.html` → 重命名为 `knowledge-editor.html`
  - `frontend/topic-editor.js` → 重命名为 `knowledge-editor.js`
  - 新增 `frontend/knowledge-graph.html` + `knowledge-graph.js`（知识图谱页）
  - `frontend/index.html` → 更新导航栏和路由
  - `frontend/clip.html` → 增加"已关联知识"展示区
  - `frontend/clip.js` → 增加关联知识查询逻辑

## ADDED Requirements

### Requirement: 知识条目模型

系统 SHALL 提供知识条目模型，替换原有话题模型，作为个人知识管理的核心数据结构。

#### Scenario: 知识条目字段
- **WHEN** 创建或查看知识条目
- **THEN** 条目包含以下字段：id、title（标题）、summary（摘要）、content（Markdown 正文）、category（分类）、tags（标签列表）、sourceClipIds（来源剪藏 ID 列表，支持多个）、myThoughts（我的思考，Markdown 格式）、linkedKnowledgeIds（关联的知识条目 ID 列表）、createdAt、updatedAt

#### Scenario: 移除社交字段
- **WHEN** 系统处理知识条目
- **THEN** 不再包含 published、likeCount、comments 字段
- **AND** 现有数据中这些字段在迁移时忽略，不保留

### Requirement: 知识条目双向链接

系统 SHALL 支持知识条目之间通过 `[[条目名]]` 语法互相引用，形成知识网络。

#### Scenario: 创建双向链接
- **WHEN** 用户在知识条目编辑器中输入 `[[条目名]]`
- **THEN** 系统保存时解析 wikilink，自动建立 linkedKnowledgeIds 关联
- **AND** 被关联的条目也自动添加反向关联

#### Scenario: 删除关联
- **WHEN** 用户编辑条目移除某个 `[[条目名]]` 引用
- **THEN** 系统自动解除对应的 linkedKnowledgeIds 关联

#### Scenario: 编辑器中自动补全
- **WHEN** 用户在编辑器中输入 `[[`
- **THEN** 弹出知识条目搜索下拉列表，支持模糊搜索
- **AND** 选中后自动插入 `[[条目名]]` 并关闭补全面板

### Requirement: 多来源剪藏关联

系统 SHALL 支持知识条目关联多个来源剪藏，替代原有的单一 sourceClipId。

#### Scenario: 从剪藏创建知识条目
- **WHEN** 用户在剪藏详情页点击"创建知识条目"
- **THEN** 跳转到知识条目编辑器，自动预填标题和摘要，并关联该剪藏为来源

#### Scenario: 追加来源剪藏
- **WHEN** 用户编辑已有知识条目，从剪藏列表选择关联更多剪藏
- **THEN** 选中的剪藏 ID 追加到 sourceClipIds 列表

#### Scenario: 剪藏详情展示关联知识
- **WHEN** 用户查看剪藏详情
- **THEN** 页面底部展示"已关联知识"区域，列出引用该剪藏的所有知识条目
- **AND** 如果没有关联知识，显示"暂无关联知识"和"创建知识条目"按钮

### Requirement: 知识图谱可视化

系统 SHALL 提供知识图谱页面，以力导向图展示知识条目之间的关联网络。

#### Scenario: 图谱渲染
- **WHEN** 用户打开知识图谱页面
- **THEN** 系统以力导向图渲染所有知识条目：节点为条目（显示标题），连线为双向链接关系
- **AND** 节点大小按被引用次数缩放
- **AND** 支持拖拽节点、缩放、平移

#### Scenario: 图谱交互
- **WHEN** 用户点击图谱中的节点
- **THEN** 高亮该节点及其直接关联节点，弱化其他节点
- **AND** 显示侧边面板展示该条目的标题、摘要和标签
- **AND** 点击"查看详情"跳转到知识条目详情页

### Requirement: AI 知识合成

系统 SHALL 支持从多条剪藏一键生成知识条目，AI 自动提取关键信息并合成结构化知识。

#### Scenario: 从多条剪藏合成知识
- **WHEN** 用户在剪藏列表选中多条剪藏，点击"合成知识条目"
- **THEN** 系统将选中剪藏的内容发送给 AI，要求提取共同主题、关键概念、矛盾点
- **AND** AI 生成结构化的知识条目初稿（标题、摘要、Markdown 正文）
- **AND** 跳转到知识编辑器，预填 AI 生成的内容，用户可编辑后保存

#### Scenario: 合成失败处理
- **WHEN** AI 合成请求失败
- **THEN** 显示友好提示"AI 合成失败，请稍后重试或手动创建知识条目"

### Requirement: 知识列表增强

系统 SHALL 增强知识列表页，以卡片+文字混合布局展示，体现知识网络特征。

#### Scenario: 列表展示
- **WHEN** 用户打开知识列表页
- **THEN** 每条知识条目显示：标题、摘要（2行截断）、标签、来源剪藏数、关联知识数、更新时间
- **AND** 点击条目跳转到知识详情页

#### Scenario: 搜索与筛选
- **WHEN** 用户在搜索框输入关键词
- **THEN** 按标题和摘要搜索匹配条目
- **AND** 分类筛选标签支持按分类过滤

## MODIFIED Requirements

### Requirement: 导航栏（修改）

系统 SHALL 将导航栏中"话题"导航项改为"知识"，URL 路由从 `/topic` 改为 `/knowledge`。

#### Scenario: 导航跳转
- **WHEN** 用户点击导航栏"知识"
- **THEN** 加载 knowledge.html 页面，展示知识条目列表

## REMOVED Requirements

### Requirement: 话题社交功能
**Reason**: CutShelter 是个人知识管理工具，不需要社交互动功能
**Migration**: 现有数据中的 published、likeCount、comments 字段在迁移时忽略。API 路由 `/api/topic` 改为 `/api/knowledge`，旧路由不再支持。