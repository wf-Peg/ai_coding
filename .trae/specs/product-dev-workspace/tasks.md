# 产品开发工作台 — 实施任务（MVP 重写）

> 本文档与 `spec.md`（MVP 重写版）配套。原版 tasks 引用已废弃的独立 ProductDevController 数据源，本版聚焦：Agent 归档 → 后端扫描落库 → 工作台规则展示。

## 任务 1：后端扫描落库（TodoScannerService）

### 1.1 feature-points.json 解析
- [ ] 解析 `requirement` 对象（title/summary/tags/phase），兼容缺失时降级为目录名
- [ ] 解析 `featurePoints[].clips[]`，字段约定：`title` / `contentFile` / `section`（可选）/ `category` / `tags`
- [ ] 解析 `featurePoints[].todos[]`，字段约定：`title` / `priority` / `status`（`todo` / `done`）
- [ ] 读取 `config`（clipCategory / todoCategory / autoTag），缺失时默认 `product-dev`
- [ ] `section` 指定时按章节截取 md 内容，章节不存在时降级为全文

### 1.2 落库逻辑
- [ ] 剪藏：`ClipService.saveClip()`，type=`text`，source=`product-dev-archive`，category 取 clipDef.category 或 config.clipCategory
- [ ] 剪藏标签 = autoTag + requirement.tags + clipDef.tags（去重）
- [ ] 待办：`TodoService.saveTodo()`，status=`done` 映射 `completed=true`
- [ ] 待办 category 取 config.todoCategory

### 1.3 重复导入防护（增量）
- [ ] `.imported` 标记写入 JSON：`{ importedAt, featurePointIds[] }`
- [ ] 按 `featurePoints[].id` 幂等去重，已导入的功能点跳过
- [ ] 旧版纯文本 `.imported` 解析失败时视为全新导入
- [ ] 扫描结果记录：扫描/导入/跳过目录数、剪藏/待办创建数、错误列表

### 1.4 配置
- [ ] `application_templete.yml` 增加 `product-dev.todo-dir`（默认 `./TODO`）
- [ ] Electron `main.js` `generateApplicationYml()` 注入 `product-dev.todo-dir = {APP_DIR}/TODO`

## 任务 2：内置工作台初始化（唯一初始化器）

- [ ] 保留 `ProductDevWorkspaceInitializer`（CommandLineRunner），删除 `ProductDevStartupInitializer`
- [ ] 工作台属性对齐 spec 5.1：id=`pd-builtin`、name=`产品开发`、color=`#2383e2`、type=`project`、desc=系统内置描述
- [ ] 三条内置规则对齐 spec 5.2：`tag equals product-dev`、`type in clip,todo`、`category contains product-dev`
- [ ] 幂等：工作台已存在时仅补齐缺失规则
- [ ] `Workspace.TYPES` 保持 `general/project/learning`（不新增 product-dev 类型）

## 任务 3：前端改造（workspace.html）

### 3.1 视图结构
- [ ] `product-dev-view` 移入 `.main-area` 内部，改为普通视图显隐切换（`display:none` / `.visible`）
- [ ] 删除 `position: fixed; inset: 0; z-index: 60` 全屏覆盖
- [ ] 绑定 `pdSidebarToggle` 按钮事件（移动端抽屉）
- [ ] 统一 `showView(view)` 切换逻辑（overview / product-dev / detail）

### 3.2 数据源切换
- [ ] `loadProductDev()` 改用 `/api/workspace/{pd-builtin}/resolve` 获取数据
- [ ] 移除对 `/api/product-dev/*`（旧独立接口）的 9 个 fetch 调用
- [ ] 仪表盘统计卡片从 `WorkspaceResolution` 解析结果计算
- [ ] 看板从 `WorkspaceMembership.boardColumnId` 映射
- [ ] 归档列表改为展示最近导入的 TODO 目录（可通过后端扫描接口或解析结果推导）
- [ ] 标签筛选条改为对 resolve 结果本地过滤（`activePdTag`）

### 3.3 二期功能隐藏
- [ ] 知识图谱 tab 隐藏（`display: none`）
- [ ] 甘特图 tab 隐藏（`display: none`）

## 任务 4：旧体系清理

- [ ] 评估 `ProductDevController` / `ProductDevService` / `ProductDevRecord` 是否存在其他引用
- [ ] 确认前端无 `/api/product-dev/*` 调用后，删除旧 Controller/Service/Model（或标注废弃）
- [ ] 回归验证：工作台其余交互不受影响

## 任务 5：文档同步

- [ ] `todo-directory-specification.md` 的 `.imported` 格式与实现一致（JSON）
- [ ] `product-dev-workspace-builtin-rules.md` 规则与 spec 5.2 / 初始化器一致
- [ ] `agent.md` 归档约束与 SKILL.md 一致
- [ ] 补 wiki 模块现状说明、学习模块边界声明（参考审阅评估文档）

## 任务 6：全链路验证

- [ ] 构造最小 `feature-points.json` 示例（含 requirement 对象、1 个 featurePoint、1 clip + 1 todo）
- [ ] 启动后端，确认扫描落库成功（剪藏 + 待办创建）
- [ ] 再次启动，确认幂等跳过（不重复导入）
- [ ] 修改 json 新增功能点，确认增量导入生效
- [ ] 确认 `pd-builtin` 工作台自动创建、三条规则存在
- [ ] 前端产品开发视图显示导入的剪藏和待办
