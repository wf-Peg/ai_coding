# 剪藏平台二阶段开发记录（2026-04-27）

## 1. 转待办逻辑（当前实现）

### 1.1 触发入口
- `frontend/clip.html` 每条剪藏卡片提供 `更多功能 -> ✅ 转待办`
- Electron 渲染层优先走 `window.electronAPI.clipToTodo(payload)`
- 非 Electron 场景自动回退 HTTP：`POST /api/clip/to-todo`

### 1.2 入参与映射
- 最小入参：`clipId`
- 标题优先级：`selectedText -> summary -> title -> 默认文案`
- 后端创建 `TodoContent`，映射：
  - `title`：由上游计算或请求覆盖
  - `priority`：默认 `medium`
  - `category`：请求值优先，否则沿用剪藏分类，兜底 `inbox`
  - `sourceClipId`：强制保存来源剪藏 ID
  - `sourceUrl`：保留来源 URL

### 1.3 用户可见结果
- 剪藏页顶部提示：已转为待办
- 待办页会显示 `剪藏#ID` 标签（来源回链）
- 勾选完成、编辑保存后，`sourceClipId/sourceUrl` 不会丢失

### 1.4 核心接口
- `POST /api/clip/to-todo`
- `GET /api/todo/list`
- `PUT /api/todo/update`

---

## 2. 今日改动内容逻辑（按层）

### 2.1 采集协议与数据模型
- `ClipRequest` 新增结构化字段：
  - `contextBefore`
  - `contextAfter`
  - `target`
- `ClipContent` 对应持久化字段补齐：
  - `contextBefore`
  - `contextAfter`
- `ClipService`：
  - 结构化请求保存链路写入上下文字段
  - `captureMethod` 规范化到约定值集合

### 2.2 插件采集链路
- `content.js`：新增选区上下文提取（前后文窗口）
- `background.js`：上下文字段进入统一 payload
- `popup.js`：最终提交体透传 `contextBefore/contextAfter/target`

### 2.3 Inbox 与快捷接口
- `ClipController` 新增 `GET /api/clip/inbox`
- 继续保持默认采集进入 `inbox` 的行为（与既有实现一致）

### 2.4 轻量知识条目
- 新模型：`KnowledgeEntry`
- 新服务：`KnowledgeService`（剪藏派生、列表、检索、按来源回查）
- 新控制器：`KnowledgeController`
  - `POST /api/knowledge/derive/{clipId}`
  - `GET /api/knowledge/list`
  - `GET /api/knowledge/search`
  - `GET /api/knowledge/{id}`
  - `GET /api/knowledge/source/{clipId}`
- 存储层新增 `clip-storage/knowledge` 目录

### 2.5 Electron 统一入口能力
- 新增 backend 请求封装
- 新增 IPC：
  - `clip-to-todo`
  - `derive-knowledge`
- `preload.js` 暴露 API：
  - `clipToTodo(payload)`
  - `deriveKnowledge(clipId, asyncMode)`

### 2.6 前端交互重构（本次）
- 剪藏列表动作从“多按钮平铺”改为“`更多功能`菜单”
- 点击触发动画展开动作列表，点击空白自动收起
- 可选动作：
  - 快速 AI 整理
  - 编辑分类/标签
  - 转待办
  - 生成知识
  - 发散总结（非 store-only）
  - 删除（非搜索页）

---

## 3. 测试与验收

### 3.1 已执行
- 后端测试：`mvn test`
- 结果：`14` 个测试全部通过（`ClipControllerTest + KnowledgeControllerTest`）

### 3.2 建议手工验收路径（用户视角）
1. 在剪藏页加载列表，确认操作区只显示 `更多功能 + 展开`，不再按钮拥挤。
2. 点击 `更多功能`，确认面板动画展开；点击空白处自动收起。
3. 选一条点击 `转待办`，左侧待办新增记录并显示 `剪藏#ID`。
4. 在待办中编辑或勾选完成，刷新后 `剪藏#ID` 仍存在。
5. 选一条点击 `生成知识`，收到成功提示；随后可通过 `GET /api/knowledge/source/{clipId}` 验证派生结果。

