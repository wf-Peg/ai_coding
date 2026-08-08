# AGENT.MD — 剪藏（Clip）项目 AI 编程约束

## 项目概述

剪藏（Clip）是本地优先的个人信息管理工具，支持剪藏、AI分析、专题管理、待办时间线、日报/周报、Git同步、Electron桌面打包。

## 技术栈

| 层   | 技术                             |
| --- | ------------------------------ |
| 后端  | Spring Boot 3.2.0, Java 17     |
| 前端  | HTML5 + CSS3 + JS (ES6+)，无框架   |
| AI  | DashScope SDK + DeepSeek API   |
| 存储  | 本地文件系统（JSON），无数据库              |
| 桌面  | Electron 28+, electron-builder |
| 构建  | Maven (后端) + npm (Electron)    |

## 目录结构

```
backend/     → Spring Boot，入口: ClipDemoApplication.java
frontend/    → 纯静态 HTML/CSS/JS，无构建工具
electron/    → Electron 主进程
```

## 构建与运行

```bash
# 后端编译
cd backend && mvn clean package -DskipTests

# 后端运行（JAR）
java -jar backend/target/clip-demo-0.0.1-SNAPSHOT.jar

# 后端运行（开发）
cd backend && mvn spring-boot:run

# 前端开发
npx serve frontend -l 3000

# 一键启动
start.bat       # Windows
./start.sh      # macOS/Linux

# 桌面打包
build.bat       # Windows
./build.sh      # macOS/Linux
```

## 代码约束

### 后端（Java）

- 包结构：`com.example.clip.{controller,service,model,dto,config,core,utils}`
- Controller 用 `@RestController` + `@RequestMapping`，路径统一 `/api/xxx`
- Service 之间可互相注入，但避免循环依赖
- 数据持久化：通过 `FileStorageService` 读写本地 JSON，**不使用数据库**
- ID 生成：`FileStorageService.idGenerator` 原子自增，启动时扫描已有数据最大值
- 配置：`application.yml` 在 `backend/src/main/resources/` 下，通过 `@Value` 注入
- Controller 放在 `controller/` 包下，确保被 `@SpringBootApplication` 扫描

### 前端（HTML/CSS/JS）

- 纯静态文件，无 npm 构建，无框架，直接操作 DOM
- 样式：内联 `<style>` 或 `styles/` 目录下独立 CSS 文件
- 主题：`theme-notion.css`（Notion风格）、`theme-regular.css`（常规）
- Markdown 渲染：`libs/marked.min.js`
- API 调用：`fetch('http://127.0.0.1:8081/api/...')`
- 每个页面独立 HTML 文件，逻辑内嵌或独立 JS 文件
- 设计上参考obsidian，notion等，做出高级感并贴合全局主题

### LLM 提供者

- 接口：`LlmProvider`（`core/` 包下）
- 实现：`DashScopeLlmProvider`、`DeepSeekLlmProvider`
- 路由：`RoutingLlmProvider` 按场景分发
- 配置：`ModelConfig` + `ModelConfigService` 支持运行时切换

## 约束规则

1. **不引入新框架**：前端不用 React/Vue，后端不用 MyBatis/JPA
2. **不引入数据库**：存储仅用本地 JSON 文件系统
3. **API 前缀**：所有后端接口统一 `/api/` 开头，`@CrossOrigin(origins = "*")`
4. **端口约定**：后端 8080，前端 3000
5. **文件编码**：UTF-8
6. **配置模板**：`application_templete.yml` 是模板，`application.yml` 是实际配置（已在 .gitignore）
7. **新增页面**：HTML 文件放 `frontend/`，样式放 `frontend/styles/`，JS 逻辑内嵌或独立文件
8. **新增后端模块**：按现有包结构放置，Controller/Service/Model 各司其职
9. **Electron 改动**：仅修改 `electron/` 目录，不耦合业务逻辑
10. **兼容性**：不破坏现有 API 接口和前端页面
11. **重要的**：代码要增加日志与代码注释，清晰且方便问题排查
12. **SPA 路由约定**：新增页面（如 `topic.html`）必须在 `index.html` 中做两件事：(a) 在 `VIEW_IFRAME` 注册映射；
(b) 在 `pathToView()` 注册 URL path。导航用 `history.pushState`，监听 `popstate` 支持前进/后退。
所有静态服务器必须启用 SPA fallback（`npx serve --single`，Python 需自定义 SPAHandler，Electron 设 `serve-static` 的 `fallthrough: false` + `onerror` 回退到 `index.html`）。
`index.html` 是唯一入口，禁止 `window.location.href` 跳转。
13. **提交历史记录**：每次 `git commit` 后，必须同步追加一条记录到项目根目录的 `commit_history.log`。
    - 格式：`YYYY-MM-DD HH:MM | 提交说明`（日期时间 + 竖线 + 改动摘要）
    - 说明要求：浓缩核心改动内容，30字以内，突出功能点而非技术细节
    - 重复提交合并：若同一功能多次提交注释，合并为一条（如"后端项目代码注释完善（多轮提交合并）"）
    - git 操作后立即执行，不可遗漏

## 需求开发流程

### TODO/ 目录规范

```
TODO/
├── <中长需求目录>/           # 如"工作台与数据层重构需求"
│   ├── 01-<主线任务说明>.md   # 总计划，含分阶段任务和勾选状态
│   ├── 02-<子任务规格>.md     # 每个子任务的 spec
│   ├── 03-<子任务实施任务>.md  # 每个子任务的 tasks
│   └── 04-<子任务验收清单>.md  # 每个子任务的 checklist
├── <其他需求>/...
└── bugs/
    └── bug-history.md        # bug 历史记录，供 AI 和开发者参考
```

### 开发步骤

1. **识别子任务**：从 TODO 中长需求目录的 `01-主线任务说明.md` 中识别当前要做的子任务。
2. **编写 spec**：在 `.trae/specs/<change-id>/` 下创建 spec.md、tasks.md、checklist.md。
3. **实现与验证**：按 tasks.md 逐项实现，完成后勾选，通过 checklist 逐项验证。
4. **归档**：将 spec 文件复制到 TODO 中长需求目录，中文命名按编号排列。
5. **更新主线**：勾选 `01-主线任务说明.md` 中对应子任务，追加"落地状态"章节记录完成情况。
6. **提交与推送**：commit + push，同步更新 `commit_history.log`。

### 验收标准

- 所有 checklist 项必须勾选通过
- 后端全量测试通过（`mvn test`）
- 前端脚本语法检查通过
- 桌面/浏览器冒烟测试通过
- 不破坏现有 API 接口和前端页面
- 不损坏现有业务 JSON 数据

### Bug 历史管理

- 路径：`TODO/bugs/bug-history.md`
- 记录内容：现象、原因、修复方式、经验教训
- 记录时机：每次 bug 修复完成后立即追加
- 用途：后续可依据 bug 历史更新 agent.md 约束，避免同类问题重复出现

## 产品开发归档

### 概述

每次完成一个需求或子任务后，**必须自动执行** `product-dev-archive` skill，将需求的全流程数据按固定格式写入本地文件。后端启动时扫描该目录，自动解析为产品开发工作区的结构化数据。

### 归档约束

1. **归档时机**：每个子任务完成时立即归档当前知识点和待办状态；整个需求完成时归档完整需求链。
2. **归档格式**：遵循 `product-dev-archive/SKILL.md` 中定义的 JSON 结构，写入 `{storagePath}/product-dev/archives/{yyMMdd-HHmmss}-{需求标识}.json`。
3. **内容要求**：
   - 需求分析阶段：归档需求描述、分析结论、相关链接
   - 设计阶段：归档技术方案、架构设计、接口定义
   - 实现阶段：归档核心代码逻辑、关键决策、遇到的问题和解决方案
   - 测试阶段：归档测试方案、测试结果、验收清单
   - 完成阶段：归档完整的知识总结、待办完成情况
4. **接口调用**：每次归档后，调用后端 API 通知索引更新：
   - `POST /api/product-dev/archive` — 创建归档条目（若需求大则拆分为多条剪藏）
   - `POST /api/knowledge/add` — 将知识整合为一条知识条目
   - `POST /api/todo/update` — 完成待办时调用接口标记完成
5. **历史迁移**：当用户执行"历史迁移"操作时，调用 `POST /api/product-dev/migrate` 触发后端扫描 TODO/ 和 .trae/specs/ 目录。

### 关联技能

- `.trae/skills/product-dev-archive/` — 每次任务完成后自动执行的归档 skill
- `.trae/skills/product-dev-history-migrate/` — 处理历史存量需求文档的迁移 skill