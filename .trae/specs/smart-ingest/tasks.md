# Tasks

- [x] Task 1: 确认原有接口兼容性（只读检查，不修改）
  - [x] 1.1 确认 `POST /api/clip/add` 请求体和响应格式
  - [x] 1.2 确认 `POST /api/todo/add` 请求体和响应格式
  - [x] 1.3 确认 `POST /api/topic` 请求体和响应格式
  - [x] 1.4 确认浏览器插件 `sendToBackendPromise` 的响应判断逻辑
  - [x] 1.5 确认前端 `clip.html` 的提交逻辑

- [x] Task 2: AiService 新增意图识别和字段提取方法
  - [x] 2.1 新增 `identifyIntent(String text)` → String (clip/todo/topic/null)
  - [x] 2.2 新增 `extractFields(String text, String intent)` → Map<String, Object>/null
  - [x] 2.3 两个方法均需 try-catch 包裹，异常时返回 null（调用方降级）

- [x] Task 3: 新增 IngestController（最小 MVP）
  - [x] 3.1 创建 `IngestController.java`，`POST /api/ingest`
  - [x] 3.2 参数校验：text 缺失/空/< 5 字 → 400
  - [x] 3.3 意图识别 → 降级处理
  - [x] 3.4 字段提取 → 降级处理
  - [x] 3.5 路由入库：clip/todo/topic 分别调用对应 Service
  - [x] 3.6 统一响应格式 `{ success, intent, id, title, redirect }`

- [x] Task 4: 编译验证后端
  - [x] 4.1 `mvn compile` 通过，无编译错误

- [x] Task 5: 整理接口文档
  - [x] 5.1 在 spec.md 附录中完善接口文档（请求/响应/curl 示例/errorType 枚举）

- [x] Task 6: 创建 TRAE Agent Skill
  - [x] 6.1 创建 `.trae/skills/smart-ingest/SKILL.md`
  - [x] 6.2 包含意图识别规则、字段提取指令、curl 模板、异常处理

- [x] Task 7: 浏览器插件重构
  - [x] 7.1 `options.js` DEFAULT_CONFIG 新增 `ingestUrl`
  - [x] 7.2 `options.html` 新增智能入库 API 地址配置项
  - [x] 7.3 `popup.html` 新增"智能入库"按钮
  - [x] 7.4 `popup.js` 新增 `handleSmartIngest()` 函数
  - [x] 7.5 `background.js` 新增 `smartIngest` message handler，适配 `{ success }` 响应

- [x] Task 8: 前端 clip.html 入口
  - [x] 8.1 textarea 区域增加"智能入库"按钮，调用 `/api/ingest`

- [ ] Task 9: 提交推送

# Task Dependencies

- Task 2 依赖 Task 1（确认接口格式后再写 AI prompt）
- Task 3 依赖 Task 2（Controller 调用 AiService 新方法）
- Task 4 依赖 Task 3
- Task 5 依赖 Task 3（接口定型后写文档）
- Task 6 依赖 Task 5（文档确认后再写 Skill）
- Task 7 依赖 Task 3（接口就绪后重构插件）
- Task 8 依赖 Task 3
- Task 6, 7, 8 可并行执行
- Task 9 依赖所有前序任务