# 项目基线与未开发项清单

## 1. 文档目的

本文件用于给后续 agent / 开发者提供一份“按当前仓库实际代码校准过”的项目说明。

它不是纯产品愿景文档，而是：

- 说明项目现在已经落地了什么
- 标出哪些内容仍停留在规划、半成品或文档层
- 避免把旧文档里的目标状态误判为已完成状态

---

## 2. 项目定位

这是一个个人信息剪藏与整理工具，核心目标是：

1. 采集信息：文本、网页、文档、图片等
2. AI 处理：摘要、分析、标签、分类
3. 本地沉淀：以本地文件为主进行存储
4. 再利用：搜索、日报整理、周报输出、待办联动、Git 同步

当前仓库由 4 个部分组成：

- `backend/`：Spring Boot 后端
- `frontend/`：HTML/CSS/JS 前端
- `browser-extension/`：浏览器插件
- `electron/`：Electron 桌面壳

---

## 3. 当前实际已实现内容

以下内容是结合仓库代码确认过的当前基线。

### 3.1 后端已实现

后端当前是 `Spring Boot + 本地文件存储 + DashScope AI` 架构。

已存在的主要接口：

- `POST /api/clip/add`
- `POST /api/clip/system`
- `POST /api/clip/generate-tags`
- `POST /api/clip/smart-organize`
- `GET /api/clip/categories`
- `GET /api/clip/category/{category}`
- `GET /api/clip/list`
- `DELETE /api/clip/{id}`
- `GET /api/clip/search`
- `GET /api/clip/search/category`
- `GET /api/clip/divergent-summary/{id}`
- `POST /api/clip/organize`
- `GET /api/clip/organize/status`
- `POST /api/clip/open-storage-folder`
- `POST /api/weekly-report/generate`
- `GET /api/weekly-report/status`
- `GET /api/todo/list`
- `GET /api/todo/{id}`
- `POST /api/todo/add`
- `PUT /api/todo/update`
- `PUT /api/todo/{id}/status`
- `DELETE /api/todo/{id}`
- `GET /api/git/config`
- `POST /api/git/config`
- `POST /api/git/test-connection`
- `POST /api/git/sync`

已具备的能力：

- 剪藏内容保存
- AI 摘要、分析、标签生成、分类辅助
- 链接解析与文档解析服务代码
- 图片 base64 上传入库
- 按分类和日期写入本地 JSON
- 内容搜索
- 每日整理
- 周报生成
- Git 配置和同步
- 待办事项基础 CRUD

### 3.2 存储层已实现

当前实际存储方式不是数据库或云存储，而是本地文件系统：

- 剪藏数据：按分类目录 + 日期 JSON 文件保存
- 待办数据：保存在 `todoList` 目录
- 整理结果：Markdown 文件
- 周报结果：Markdown 文件
- 图片：本地文件保存并记录相对路径

### 3.3 前端已实现

前端当前不是 React，而是原生 HTML 页面：

- `frontend/index.html`：左右分栏入口
- `frontend/todo.html`：待办页面
- `frontend/clip.html`：剪藏页面

当前前端基线能力：

- 待办与剪藏双栏展示
- 主题切换
- 剪藏录入
- 基础内容浏览
- 与后端接口联动

### 3.4 浏览器插件已实现

插件目前已经有可用雏形，不是空目录。

已具备：

- `manifest.json`
- 右键菜单入口
- 快捷键入口
- popup 手动编辑
- options 配置页
- 页面正文提取
- 发送到后端接口

已支持的采集动作：

- 剪藏整个页面
- 剪藏选中文本
- 右键剪藏图片入口
- 直接发送到后端

### 3.5 Electron 已实现

Electron 当前更像“桌面启动壳”，不是完整平台级集成层。

已具备：

- 启动窗口
- 配置页
- 本地配置文件读写
- 生成 `application.yml`
- 启动后端 JAR
- 端口检查
- 打包运行路径兼容处理

---

## 4. 当前文档与代码不一致的地方

下面这些内容在旧文档里被写成了既定架构或已实现能力，但从当前仓库代码看并不成立：

- 不是 `阿里云 RDS + OSS + Elasticsearch` 架构，当前是本地文件存储
- 前端不是 React 应用，当前是原生 HTML 页面
- 不存在完整的知识库 API 体系
- 不存在完整的信息导入 API 体系
- 旧测试报告里提到的部分 Todo / Git 扩展接口，当前仓库并没有对应实现

这意味着后续开发和排期，应以当前代码现状为准，而不是以旧报告或旧架构图为准。

---

## 5. 未开发或未完成内容

以下内容是结合 `README.md`、`PRD.md`、`BROWSER_EXTENSION_PLAN.md` 与实际代码对照后确认的“未开发项 / 半成品项 / 仅文档存在项”。

### 5.1 信息采集侧未完成

1. 系统级右键剪藏没有真正做成跨平台能力  
当前只有后端 `POST /api/clip/system` 接口，未看到 Windows Shell Extension、macOS Service、Linux 菜单扩展等完整实现。

2. 通用文件导入 API 未落地  
文档中有 `/api/import/file`，当前仓库没有对应 controller 接口。

3. 通用网页导入 API 未落地  
文档中有 `/api/import/web`，当前仓库没有对应 controller 接口。

4. 插件图片剪藏仍是半成品  
`browser-extension/background.js` 当前只是把图片 URL 作为文本发送，不是真正下载、编码、上传图片。

5. 插件页面截图剪藏未实现  
文档和插件 README 都把它列为后续项，当前代码没有截图链路。

6. 插件悬浮按钮功能未打通  
`content.js` 发送了 `clipCurrentPage` 消息，但 `background.js` 没有对应处理分支。

### 5.2 AI 加工与知识库侧未完成

1. 独立的内容处理 API 未落地  
文档中的以下接口目前不存在：
`/api/process/analyze`、`/api/process/classify`、`/api/process/extract`

2. 知识提取后的结构化知识库能力未落地  
当前有 AI 摘要/分析，但没有真正的“知识条目层”数据模型和管理流程。

3. 知识图谱未实现  
文档中有知识图谱模块与 `/api/knowledge/graph`，当前仓库没有相关实现。

4. 专门的知识检索 API 未实现  
文档中的 `/api/knowledge/search`、`/api/knowledge/categorize` 等接口不存在。

5. Elasticsearch 检索体系未实现  
当前搜索能力是本地服务实现，不是 Elasticsearch 索引方案。

### 5.3 周报与整理侧未完成

1. 自定义时间范围周报未实现  
当前是 `POST /api/weekly-report/generate` 直接生成，不是文档中带 `startDate/endDate` 的接口形式。

2. 多格式输出未实现  
文档写了支持 PDF、HTML、Markdown，当前实际落地以 Markdown 为主。

3. 更细粒度的整理状态与任务管理未实现  
目前有基础状态接口，但没有任务队列、历史任务记录、失败重试等完整机制。

### 5.4 待办与工作流联动未完成

1. “剪藏一键转待办”没有形成稳定能力  
规划文档多次提到，但当前没有明确的端到端入口。

2. 待办高级查询接口未实现  
旧报告中提到按日期、按分类查询的接口，但当前 `TodoController` 中没有这些接口。

3. 到期提醒与通知未实现  
PRD 与后续建议里提到待办提醒，但代码中未见调度或提醒机制。

### 5.5 浏览器插件产品化未完成

1. 插件与主应用地址耦合仍偏重  
方案文档已指出本地地址写死问题，当前仍需继续治理。

2. popup、右键、快捷键三条链路还没有完全统一  
当前内容提取逻辑在 `background.js` 与 `content.js` 中重复维护。

3. `inbox` 收件箱模型未建立  
规划里建议统一先进入 `inbox`，当前后端和插件未形成该模型。

4. `metadata` 扩展字段未落地  
规划里的 `siteName`、`selectedText`、`contextBefore`、`contextAfter`、`capturedAt` 等尚未形成正式后端协议。

5. 多后端配置未实现  
插件 README 中列为未来改进，当前没有完整支持。

6. 离线缓存与失败重试队列未实现  
当前发送失败后缺少可靠的本地待同步机制。

### 5.6 Electron 平台化未完成

1. Electron 目前只是启动壳，不是完整桌面工作台  
缺少系统托盘、后台任务管理、统一采集入口、系统级分享等更深层能力。

2. 平台级配置中心还不完整  
当前主要覆盖启动配置，尚未统一管理插件、同步、存储策略、任务策略等全局能力。

### 5.7 跨端与未来能力未完成

1. 移动端应用未开始
2. 多模态增强仍不完整  
虽然已有图片入库能力，但离“完整多模态工作流”还有差距。
3. 云端同步架构未实现  
当前主要依赖本地文件和 Git，同步策略还不是产品级方案。

---

## 6. 当前最值得优先开发的内容

如果后续继续推进，优先级建议如下：

1. 打通浏览器插件稳定采集链路  
统一 popup / 右键 / 快捷键 / 内容提取逻辑，补齐图片与失败反馈。

2. 建立 `inbox` 收件箱模型  
先采集、后整理，减少插件端复杂度。

3. 补齐结构化采集协议  
为标题、URL、上下文、站点名、采集时间等建立统一字段。

4. 明确知识库层模型  
把“AI 分析结果”升级为可检索、可归档、可关联的知识条目。

5. 补齐系统级采集与跨端同步策略  
再考虑 Electron 深化、移动端和更完整同步方案。

---

## 7. 给后续 Agent 的执行约束

后续若继续开发，请默认遵循以下判断：

1. 以当前仓库代码为准，不以旧架构图或旧测试报告为准
2. 当前存储是本地文件系统，不要误按云架构开发
3. 当前前端是原生 HTML，不要误按 React 项目改造
4. 浏览器插件是“已有雏形待收敛”，不是“从零开始”
5. `agent.md` 维护目标是“反映真实状态”，不是“重复 PRD 愿景”

---

## 8. 本次更新结论

截至 2026-04-27，这个项目已经完成了“本地剪藏 + AI 基础处理 + 日报/周报 + Git 同步 + 待办基础能力”的第一阶段基线，但距离“完整的平台端信息检索软件”还有明显差距。

最主要的未开发内容集中在：

- 平台级采集能力
- 知识库结构化能力
- 插件产品化稳定性
- 周报与工作流的深度联动
- 跨端与同步体系
