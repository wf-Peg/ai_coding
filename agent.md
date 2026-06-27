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
- API 调用：`fetch('http://127.0.0.1:8080/api/...')`
- 每个页面独立 HTML 文件，逻辑内嵌或独立 JS 文件

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
11. 重要的代码要增加日志与代码注释，清晰且方便问题排查
12. **SPA 路由约定**：新增页面（如 `topic.html`）必须在 `index.html` 中做两件事：(a) 在 `VIEW_IFRAME` 注册映射；(b) 在 `pathToView()` 注册 URL path。导航用 `history.pushState`，监听 `popstate` 支持前进/后退。所有静态服务器必须启用 SPA fallback（`npx serve --single`，Python 需自定义 SPAHandler，Electron 设 `serve-static` 的 `fallthrough: false` + `onerror` 回退到 `index.html`）。`index.html` 是唯一入口，禁止 `window.location.href` 跳转。