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
4. **端口约定**：后端 8081，前端 3001（application_templete.yml 模板与 Electron 默认一致；独立运行时保持与扩展/前端硬编码一致）
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

每次完成一个需求或子任务后，**必须自动执行** `product-dev-archive` skill，将需求的全流程数据按约定格式写入 `TODO/{需求中文概述}/` 目录。后端启动时扫描 TODO 目录，解析 `feature-points.json`，自动落库为剪藏和待办，通过产品开发工作台规则筛选展示。

### 核心链路

```
Agent 完成编码任务
    ↓ 自动调用 product-dev-archive skill
写入 TODO/{需求中文概述}/
    ├── feature-points.json     ← ★ 核心约定文件
    ├── 01-需求分析.md          ← → 剪藏
    ├── 02-设计文档.md          ← → 剪藏
    ├── 03-实施任务.md          ← → 待办
    └── 04-验收清单.md          ← → 待办
    ↓ 后端启动时扫描
自动落库到剪藏和待办模块
    ↓
产品开发工作台（规则: tag=product-dev）展示
```

### 归档时机

- **每个子任务完成时**：增量归档当前子任务，追加 featurePoints、更新待办状态
- **整个需求完成时**：归档完整需求，更新 phase 为 `completed`
- **Bug 修复完成时**：在对应需求目录下追加修复记录

### TODO 目录规范

```
TODO/
├── {需求中文概述}/                    # 子目录名即需求概述
│   ├── feature-points.json          # ★ 核心约定文件（前后端共享解析规则）
│   ├── 01-需求分析.md              # 原始需求、分析结论、会话摘要
│   ├── 02-设计文档.md              # 技术方案、架构设计、接口定义
│   ├── 03-实施任务.md              # 可拆分的子任务列表
│   ├── 04-验收清单.md              # 验收项 checklist
│   └── .imported                    # 导入标记文件（后端写入）
├── bugs/
│   └── bug-history.md
└── ... (其他存量目录)
```

### feature-points.json 核心结构

详见 `.trae/skills/product-dev-archive/SKILL.md`，关键字段：

- `requirement`：需求元信息（title, tags, phase, createdAt, completedAt）
- `featurePoints[]`：功能点列表，每个功能点含 id, name, layer, clips[], todos[]
- `config`：落库配置（clipCategory, todoCategory, autoTag）
- **所有 tags 必须包含 `"product-dev"`**

### 归档约束

1. **功能点拆分**：大需求按功能点拆分为多个 featurePoints，每个功能点独立产出剪藏和待办。id 格式 `fp-001`，按数字递增。
2. **内容文件**：按类型写入对应 md 文件（01-需求分析、02-设计文档、03-实施任务、04-验收清单），文件内按功能点分章节。
3. **剪藏**：做源内容存储，不做 AI 自动分析。`contentFile` 指向同目录 md 文件，`section` 可选指定章节。
4. **待办**：使用计划模式，开发完成后标记 `status: "done"`。
5. **标签预留**：`featurePoints[].tags` 为后续自动整合为知识做铺垫，本期不开发。
6. **存量迁移**：首次使用时通过 `product-dev-history-migrate` skill 为存量 TODO 目录生成 `feature-points.json`。

### 关联技能

- `.trae/skills/product-dev-archive/` — 每次任务完成后自动执行的归档 skill
- `.trae/skills/product-dev-history-migrate/` — 处理历史存量需求文档的迁移 skill