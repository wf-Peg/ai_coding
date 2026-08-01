# CutShelter (碎碎记) — Code Wiki

> **版本**: 1.0.7  
> **架构**: Electron + Spring Boot + 原生 HTML/JS  
> **定位**: AI 驱动的全功能个人信息管理系统  

---

## 目录

- [1. 项目总览](#1-项目总览)
- [2. 系统架构](#2-系统架构)
- [3. 后端架构](#3-后端架构)
- [4. 前端架构](#4-前端架构)
- [5. Electron 桌面应用](#5-electron-桌面应用)
- [6. 浏览器扩展](#6-浏览器扩展)
- [7. 依赖关系](#7-依赖关系)
- [8. 项目运行方式](#8-项目运行方式)
- [9. 数据流与通信机制](#9-数据流与通信机制)
- [10. 竞品分析：YouMind vs CutShelter](#10-竞品分析youmind-vs-cutshelter)
- [11. 产品建议与新功能开发](#11-产品建议与新功能开发)

---

## 1. 项目总览

### 1.1 产品简介

CutShelter（碎碎记）是一款集**信息剪藏、知识管理、密码管理、学习规划、AI 分析**于一体的桌面端个人信息管理工具。核心特色：

- **AI 驱动**: 集成 DashScope（通义千问）和 DeepSeek 双 LLM，支持运行时热切换
- **本地优先**: 所有数据 JSON 文件存储，密码库 DES 加密，零云端依赖
- **多端覆盖**: Electron 桌面应用 + Chrome 浏览器扩展
- **全流程闭环**: 捕捉 → AI 分析 → 分类整理 → 周报/日报 → Git 同步

### 1.2 技术栈速览

| 层级 | 技术 | 版本 |
|------|------|------|
| 桌面框架 | Electron + electron-builder | 28+ / 24.9+ |
| 后端框架 | Spring Boot | 3.2.0 |
| 后端语言 | Java | 17（编译）/ 21（属性声明） |
| AI 框架 | Spring AI | 0.8.1 |
| LLM SDK | DashScope SDK | 2.16.0 |
| 前端 | 原生 HTML5 + CSS3 + JavaScript | - |
| Markdown 渲染 | Marked.js | 12+ |
| 图表渲染 | Mermaid.js | 10+ |
| 文档解析 | PDFBox / POI / Jsoup | 3.0.5 / 5.2.5 / 1.17.2 |
| 浏览器扩展 | Chrome Manifest V3 | - |

### 1.3 功能模块概览

| 模块 | 后端控制器 | 前端页面 | 核心能力 |
|------|-----------|---------|---------|
| 剪藏管理 | ClipController | clip.html | 内容收集、AI 分析、标签生成、发散性总结 |
| 待办管理 | TodoController | todo.html | 时间线视图、到期提醒、剪藏转待办 |
| 专题管理 | TopicController | topic*.html | 专题 CRUD、Markdown 编辑器、AI 知识生成 |
| 密码管理 | PasswordVaultController | vault.html | DES 加密、多密码库、安全审计、CSV 导入导出 |
| 学习计划 | LearningPlanController | learning-plan.html | AI 路线图、Mermaid 可视化、Exa 资源搜索 |
| 浏览器扩展 | — | background/content/popup | 右键剪藏、快捷键、智能内容提取 |
| 系统配置 | AppConfigController / ModelConfigController | settings.html / config.html | 模型配置、主题外观、快捷键、Git 同步 |
| 内容整理 | WeeklyReportController | — | 定时日报、周报、邮件通知 |
| Git 同步 | GitController | — | 远程仓库同步、配置管理 |
| 更新检查 | UpdateController | — | GitHub Releases 版本检查 |

---

## 2. 系统架构

### 2.1 三层进程架构

```
┌─────────────────────────────────────────────────────────┐
│                    Electron 主进程                       │
│  (electron/main.js — 2215 行)                            │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │ 窗口管理  │  │ 系统托盘  │  │ 全局快捷键│  │IPC 通信 │ │
│  ├──────────┤  ├──────────┤  ├──────────┤  ├─────────┤ │
│  │ 后端进程  │  │ 前端服务器│  │ 提醒调度器│  │更新检查  │ │
│  │ 管理     │  │ (静态托管)│  │ (30s轮询) │  │         │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │
│       │              │                                   │
│       ▼              ▼                                   │
│  ┌──────────┐  ┌──────────────────────────────────┐     │
│  │ Java JAR │  │ 前端 SPA (index.html shell)       │     │
│  │ Spring   │  │  ┌──────┐ ┌──────┐ ┌──────┐     │     │
│  │ Boot     │  │  │todo  │ │clip  │ │topic │ ... │     │
│  │ :8080    │  │  │.html │ │.html │ │.html │     │     │
│  │          │  │  └──┬───┘ └──┬───┘ └──┬───┘     │     │
│  │ H2 内存DB│  │     │postMessage│     │          │     │
│  │ JSON 文件│  │     └──────┴──────┘             │     │
│  └──────────┘  └──────────────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

### 2.2 架构特点

1. **无数据库**: 全部基于 JSON 文件系统持久化，按分类目录 + 日期文件组织
2. **iframe SPA**: index.html 作为 shell，各功能页面通过 iframe 加载，懒加载 + postMessage 通信
3. **进程托管**: Electron 主进程管理 Java 子进程和前端静态服务器，统一生命周期
4. **安全隔离**: `nodeIntegration: false` + `contextIsolation: true`，渲染进程只能通过 preload.js 暴露的安全 API 调用

---

## 3. 后端架构

### 3.1 分层结构

```
backend/src/main/java/com/example/clip/
├── ClipDemoApplication.java       # 主启动类 (@EnableAsync + @EnableScheduling)
├── config/                        # 配置层
│   ├── AppConfig.java             # 应用统一配置 POJO
│   ├── PromptConfig.java          # AI Prompt 模板配置
│   ├── GitConfig.java             # Git 配置 POJO
│   └── ClipImageStorageProperties.java  # 存储路径属性
├── controller/                    # 控制器层（11 个控制器）
│   ├── ClipController.java        # 剪藏核心（25+ 端点）
│   ├── TodoController.java        # 待办事项（8 端点）
│   ├── TopicController.java       # 话题管理（11 端点）
│   ├── LearningPlanController.java# 学习计划（6 端点）
│   ├── PasswordVaultController.java# 密码库（18 端点）
│   ├── AppConfigController.java   # 应用配置（4 端点）
│   ├── GitController.java         # Git 同步（4 端点）
│   ├── ModelConfigController.java # 模型配置（3 端点）
│   ├── WeeklyReportController.java# 周报（2 端点）
│   ├── HealthController.java      # 健康检查
│   └── UpdateController.java      # 更新检查
├── core/                          # 核心服务层
│   ├── AiService.java             # AI 统一入口
│   ├── LlmProvider.java           # LLM 提供者接口
│   ├── DashScopeLlmProvider.java  # 通义千问实现
│   ├── DeepSeekLlmProvider.java   # DeepSeek 实现
│   ├── RoutingLlmProvider.java    # 路由代理（@Primary）
│   ├── LlmProviderConfig.java     # Bean 配置
│   ├── DashScopeConfig.java       # DashScope SDK 配置
│   ├── ModelConfig.java           # 模型配置 POJO
│   ├── EmbeddingConfig.java       # 向量嵌入（已注释，预留）
│   └── ScheduledTasks.java        # 定时任务（每日 17:20 整理）
├── service/                       # 业务服务层（13+ 服务）
│   ├── ClipService.java           # 剪藏核心业务
│   ├── TodoService.java           # 待办业务
│   ├── TopicService.java          # 话题业务
│   ├── LearningPlanService.java   # 学习计划业务
│   ├── PasswordVaultService.java  # 密码库业务
│   ├── FileStorageService.java    # JSON 文件存储（替代数据库）
│   ├── ContentOrganizeService.java# 内容整理 + 日报
│   ├── WeeklyReportService.java   # 周报生成
│   ├── ExaSearchService.java      # Exa 语义搜索
│   ├── SearchService.java         # 全文搜索
│   ├── EmailService.java          # 邮件发送
│   ├── GitService.java            # Git 命令封装
│   ├── ModelConfigService.java    # 模型配置持久化
│   ├── PromptConfigService.java   # Prompt 模板管理
│   ├── AppConfigService.java      # 应用配置聚合
│   ├── LinkParseService.java      # 网页链接爬取
│   ├── DocumentParseService.java  # PDF/DOCX/TXT 解析
│   └── ...
├── model/                         # 数据模型
│   ├── ClipContent.java           # 剪藏内容
│   ├── TodoContent.java           # 待办事项
│   ├── Topic.java                 # 话题
│   ├── LearningPlan.java          # 学习计划（嵌套 Phase/VideoResource/QuizQuestion/PracticeTask）
│   ├── PasswordEntry.java         # 密码条目
│   ├── VaultData.java             # 密码库容器
│   ├── Comment.java               # 评论
│   └── KnowledgeEntry.java        # 知识条目
├── dto/                           # 数据传输对象
└── util/
    ├── DesEncryptionUtil.java     # DES 加密工具
    └── ImageUtils.java            # 图片验证与存储
```

### 3.2 关键类与函数说明

#### 3.2.1 ClipController — 剪藏核心控制器

**路径前缀**: `/api/clip`  
**文件**: [ClipController.java](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/backend/src/main/java/com/example/clip/controller/ClipController.java)

| 方法签名 | HTTP | 端点 | 职责 |
|---------|------|------|------|
| `addClip(ClipRequest)` | POST | `/add` | 添加剪藏，支持手动/AI标签开关 |
| `systemClip(ClipRequest)` | POST | `/system` | 系统内部剪藏，不做标签处理 |
| `generateTags(ClipRequest)` | POST | `/generate-tags` | AI 生成标签 |
| `smartOrganize(ClipRequest)` | POST | `/smart-organize` | AI 智能分类和标签 |
| `getCategories()` | GET | `/categories` | 获取预设分类树（6 一级 + 12 二级） |
| `getByCategory(String)` | GET | `/category/{category}` | 按分类获取剪藏 |
| `getList(String)` | GET | `/list` | 获取列表（支持工作流状态筛选） |
| `getInbox()` | GET | `/inbox` | 获取收件箱剪藏 |
| `deleteClip(Long)` | DELETE | `/{id}` | 删除剪藏 |
| `updateThoughts(Long, String)` | PUT | `/{id}/thoughts` | 更新"我的思考"字段 |
| `search(String, int)` | GET | `/search` | 全文语义搜索 |
| `getDivergentSummary(Long)` | GET | `/divergent-summary/{id}` | 获取发散性总结（打字机效果） |
| `organize()` | POST | `/organize` | 触发内容整理 |
| `organizeInbox(OrganizeInboxRequest)` | POST | `/organize-inbox` | 整理收件箱 |
| `toTodo(ClipToTodoRequest)` | POST | `/to-todo` | 剪藏转待办 |
| `generateWeeklyReport()` | POST | `/weekly-report` | 生成周报 |

#### 3.2.2 AiService — AI 统一入口

**文件**: [AiService.java](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/backend/src/main/java/com/example/clip/core/AiService.java)

通过 `LlmProvider` 抽象层调用大模型，不直接依赖具体厂商。

| 方法签名 | 职责 |
|---------|------|
| `processClipContent(String content)` | 一键生成摘要、分析、标签和分类 |
| `processClipContent(String, boolean, String)` | 带用户思考的"认知对话模式" |
| `analyzeContent(String)` | 深度分析（Markdown 格式） |
| `generateSummary(String)` | 生成简短摘要（≤100 字） |
| `generateTags(String)` | 提取关键词标签（≤10 个） |
| `smartOrganize(String)` | AI 驱动的分类和标签 |
| `generateDivergentSummary(String, String, List)` | 根据分类选择专家角色进行多角度分析 |
| `organizeContentForKnowledgeBase(String, String)` | 使用模板整理为知识库内容 |
| `generateSynonyms(String)` | 生成同义词/近义词（≤3 个） |
| `extractKnowledgePoints(String, String)` | 提取知识点用于周报 |
| `parsePasswordInfo(String)` | 从文本中智能提取密码条目（AI 自动填充） |

**预设分类树** (`CATEGORY_TREE`):
- 工作项目(work)、学习成长(study)、生活健康(life)、兴趣探索(hobby)、财务规划(finance)、人脉社交(social)

**错误处理策略**: 所有公开方法捕获异常，失败时返回降级结果（fallback），不抛出异常。

#### 3.2.3 LLM Provider 架构

```
              LlmProvider (接口)
              ┌─────────────┐
              │ + chat()    │
              │ + getProviderName() │
              │ + isAvailable()     │
              └──────┬──────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
  DashScope    DeepSeek     RoutingLlmProvider (@Primary)
  LlmProvider  LlmProvider  ┌──────────────────────────┐
  (SDK 调用)   (HTTP REST)  │ getActiveProvider()      │
                            │  1. 读 ModelConfig        │
                            │  2. deepseek 可用? → 用   │
                            │  3. 否则回退 DashScope    │
                            │  → 热切换 + 自动降级      │
                            └──────────────────────────┘
```

**设计优势**:
- 运行时热切换：修改配置后下次请求立即生效
- 自动回退：当前提供者不可用时自动降级
- 透明代理：上层 AiService 无需感知底层切换逻辑

**配置优先级**: 用户配置（`model-config.json`）> yml 默认配置（`DashScopeConfig`）

#### 3.2.4 FileStorageService — JSON 文件存储

**文件**: [FileStorageService.java](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/backend/src/main/java/com/example/clip/service/FileStorageService.java)

替代数据库，使用 JSON 文件系统持久化所有数据。

| 数据类型 | 存储路径 | 格式 |
|---------|---------|------|
| 剪藏内容 | `clip-storage/{category}/{date}.json` | 按分类目录 + 日期文件 |
| 待办事项 | `clip-storage/todoList/` | JSON 文件 |
| 知识条目 | `clip-storage/knowledge/` | JSON 文件 |
| 话题 | `clip-storage/topic/{date}.json` | yyyy-MM-dd 格式 |
| 学习计划 | `clip-storage/learning-plan/` | JSON 文件 |
| 密码库 | `clip-storage/vault/{name}/vault.enc` | DES 加密 |
| 配置 | `~/.clip-demo/` | JSON 文件 |

核心方法:
- `saveClip(ClipContent)` — 新增或更新（按分类+日期存储）
- `replaceClip(ClipContent)` — 跨分类更新（先删旧记录，再写新位置）
- `generateId()` — 全局唯一 ID（AtomicLong，启动时扫描已有数据初始化）

#### 3.2.5 PasswordVaultService — 密码库服务

**文件**: [PasswordVaultService.java](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/backend/src/main/java/com/example/clip/service/PasswordVaultService.java)

| 方法签名 | 职责 |
|---------|------|
| `generateKey()` | 生成随机 DES Key（SecureRandom，Base64 编码） |
| `init(String, String, String)` | 初始化密码库 |
| `unlock(String, String)` | 解锁（含旧版 hash 兼容迁移） |
| `lock()` | 锁定密码库 |
| `switchVault(String)` | 切换激活密码库 |
| `addEntry/updateEntry/deleteEntry` | 条目 CRUD |
| `search(String)` | 多字段模糊匹配搜索 |
| `audit()` | 安全审计（密码强度、重复密码、过期密码） |
| `importEntries(List)` | 批量导入（去重，限制 2000 条） |
| `generatePassword(int, ...)` | 生成随机强密码 |
| `autoFill(String)` | AI 自动填充密码字段 |

**加密架构**: DES/ECB/PKCS5Padding，密钥由用户持有（零知识架构），不持久化在服务端。

#### 3.2.6 LearningPlanService — 学习计划服务

**文件**: [LearningPlanService.java](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/backend/src/main/java/com/example/clip/service/LearningPlanService.java)

| 方法签名 | 职责 |
|---------|------|
| `createPlan(String, String, String, int, int)` | AI 生成学习路线 + Exa 搜索资源 |
| `generatePhaseStructure(...)` | 调用 AI 生成分阶段结构 + Mermaid 图 |
| `generateFallbackResources(String, String)` | Exa 不可用时 AI 降级生成资源 |
| `updatePhaseProgress(Long, int, int, boolean)` | 更新阶段进度和完成状态 |

**Exa 搜索策略**: 每个阶段执行中英文双向搜索，覆盖教程/文档/视频/论文，结果合并去重。

#### 3.2.7 ScheduledTasks — 定时任务

**文件**: [ScheduledTasks.java](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/backend/src/main/java/com/example/clip/core/ScheduledTasks.java)

```java
@Scheduled(cron = "0 20 17 * * ?")  // 每天 17:20
public void dailyContentOrganize() {
    contentOrganizeService.organizeContent();
}
```

整理流程: 筛选今日剪藏 → 按分类分组 → AI 整理 → 保存 Markdown → 发送邮件 → Git 同步

### 3.3 REST API 端点总览

| 控制器 | 路径前缀 | 端点数 | 核心功能 |
|--------|---------|--------|---------|
| ClipController | `/api/clip` | 25+ | 剪藏 CRUD、AI 分析、搜索、整理、周报 |
| TodoController | `/api/todo` | 8 | 待办 CRUD、到期提醒 |
| TopicController | `/api/topic` | 11 | 话题 CRUD、评论、从剪藏创建 |
| LearningPlanController | `/api/learning-plan` | 6 | 学习计划 CRUD、阶段进度 |
| PasswordVaultController | `/api/vault` | 18 | 密码库初始化/解锁、条目 CRUD、审计、导入导出 |
| AppConfigController | `/api/config` | 4 | 应用配置、邮件测试、存储迁移 |
| GitController | `/api/git` | 4 | Git 同步、配置管理 |
| ModelConfigController | `/api/model-config` | 3 | 模型配置、连接测试 |
| WeeklyReportController | `/api/weekly-report` | 2 | 周报生成、状态查询 |
| HealthController | `/health` | 1 | 健康检查 |
| UpdateController | `/api/update` | 1 | GitHub Releases 版本检查 |

---

## 4. 前端架构

### 4.1 页面总览

| 文件 | 用途 | 主题 |
|------|------|------|
| `index.html` | SPA 主框架（shell + 导航 + iframe 容器） | 全局主题 |
| `clip.html` | 剪藏列表与内容管理 | clip-theme-notion |
| `todo.html` | 待办时间线视图 | theme-notion / theme-regular |
| `topic.html` | 专题列表 | theme-notion |
| `topic-detail.html` | 专题详情 | theme-notion |
| `topic-editor.html` | 专题 Markdown 编辑器 | theme-notion |
| `vault.html` | 密码管理（锁屏 + 列表 + 详情 + 生成器） | theme-vault-notion |
| `learning-plan.html` | 学习计划（列表 + 详情 + 新建弹窗） | theme-notion |
| `settings.html` | 系统设置（模型配置 + 主题外观 + 快捷键） | theme-notion |

### 4.2 SPA 路由机制

**文件**: [index.html](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/index.html)

#### 视图面板结构

每个视图是一个绝对定位的 `.view-panel`，切换时通过 `view-panel-hidden` 类隐藏（`visibility: hidden`），**而非 `display: none`**，避免 iframe 重新加载：

```
homeView          → todoFrame + clipFrame (1:2 grid 布局)
topicView         → topicFrame
vaultView         → vaultFrame
learningPlanView  → learningPlanFrame
settingsView      → settingsFrame
```

#### 核心函数

| 函数 | 行号 | 职责 |
|------|------|------|
| `renderView(view)` | ~517 | 切换视图面板，更新 nav-btn active 状态 |
| `pathToView(path)` | ~546 | URL 路径映射到视图（`/topic` → `topic`） |
| `lazyLoadIframes()` | ~535 | 首次访问时将 `data-src` 赋值给 `src` 加载 iframe |
| `applyTheme()` | ~444 | 应用主题 + 向所有 iframe 广播 |

#### iframe 懒加载

```javascript
if (frame.dataset.src) {
    frame.src = frame.dataset.src;
    delete frame.dataset.src;
}
```

首页的 todoFrame/clipFrame 在后端就绪后立即加载。

### 4.3 主题系统

#### 三层主题模型

```
appearance (外观偏好)     →  effectiveTheme (有效主题)  →  dataTheme (DOM 属性)
app_appearance_v1          getEffectiveTheme()           data-theme="..."
值: regular|dark|notion|system
```

#### CSS 变量定义

| 主题 | 背景色 | 文字色 | 主色调 |
|------|--------|--------|--------|
| Notion (`:root`) | `#f7f7f5` | `#2f3437` | `#2383e2` |
| Regular | `#ecf5ff` | `#1f2937` | `#3f8cff` |
| Dark | `#1e1e1e` | `#d4d4d4` | `#569cff` |

#### 主题同步机制

1. **localStorage 持久化**: `app_theme_v1` + `app_appearance_v1`
2. **postMessage 广播**: 父框架 → 所有 iframe `{ action: 'themeChange' }`
3. **storage 事件**: 跨标签页同步
4. **matchMedia 监听**: 跟随系统主题（system 模式）

### 4.4 前端启动流程

```
index.html 加载
    ↓
显示启动遮罩（仅 Electron 环境）
    ↓
监听 electronAPI.onBackendReady
    ↓
后端就绪 → lazyLoadIframes() 加载首页
    ↓
用户点击导航 → renderView() → 懒加载对应 iframe
```

---

## 5. Electron 桌面应用

### 5.1 main.js 核心职责

**文件**: [main.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js)（2215 行）

| 职责 | 关键函数 | 说明 |
|------|---------|------|
| 路径解析 | `resolvePaths()` | 打包/开发模式路径判断 |
| 配置管理 | `loadConfig()` / `saveConfig()` | 读写 `config/config.json` |
| 后端进程管理 | `startBackend()` / `stopBackend()` | spawn Java 子进程，轮询健康检查 |
| 前端服务器 | `startFrontendServer()` | serve-static 托管 + API 代理 |
| 窗口管理 | `createMainWindow()` | 无边框窗口，自定义标题栏 |
| 系统托盘 | `createTray()` | 右键菜单，双击恢复 |
| IPC 通信 | `setupIPC()` | ~20 个 handler |
| 全局快捷键 | `registerShortcut()` | `CommandOrControl+Shift+Z` |
| 提醒调度 | `startReminderScheduler()` | 每 30s 轮询到期提醒 |
| 更新检查 | `checkForUpdates()` | GitHub Releases API |

### 5.2 后端进程管理

**启动流程** `startBackend(config)`:

1. `getJarPath()` — 查找 JAR 包（搜索 resources/backend、APP_DIR、Maven target）
2. `getJavaCommand()` — 查找 Java（嵌入式 JRE > 系统 java）
3. macOS `fixPermissionsRecursive()` — 修复 .dylib/.so 权限
4. `generateApplicationYml(config)` — 动态生成 Spring Boot 配置
5. `spawn(javaCmd, ['-Xms64m','-Xmx256m','-XX:+UseG1GC','-jar', jarPath])` — 启动子进程
6. 每 2 秒 `checkPort()` 检测后端就绪（HTTP /health + TCP socket），超时 120 秒

**停止流程** `stopBackend()`: SIGTERM 优雅关闭 → 3s 后 SIGKILL → 端口清理兜底

### 5.3 前端静态服务器

`startFrontendServer(config)` 关键特性:
- **API 代理**: `/api/*` 请求代理到 `127.0.0.1:backendPort`
- **SPA 路由回退**: 文件不存在时返回 index.html
- **安全**: 仅监听 `127.0.0.1`，不对外暴露

### 5.4 preload.js — 安全 API 桥接

**文件**: [preload.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/preload.js)

通过 `contextBridge.exposeInMainWorld('electronAPI', {...})` 暴露安全 API:

| 类型 | 方法 | 用途 |
|------|------|------|
| invoke | `saveConfig` / `getConfig` / `selectDirectory` | 配置管理 |
| invoke | `checkBackend` / `restartBackend` | 后端服务 |
| invoke | `clipToTodo` / `deriveKnowledge` | 业务操作 |
| invoke | `windowMinimize` / `windowMaximize` / `windowClose` | 窗口控制 |
| invoke | `getVersion` / `checkForUpdate` / `downloadAndApplyUpdate` | 更新管理 |
| invoke | `getShortcutConfig` / `setShortcutConfig` | 快捷键 |
| send | `configDone(config)` | 首次配置完成 |
| on | `onBackendReady` / `onBackendError` / `onBackendProgress` | 后端状态 |
| on | `onWindowMaximized` | 窗口状态 |
| on | `onUpdateProgress` / `onUpdateAvailable` / `onUpdateComplete` | 更新进度 |

### 5.5 首次启动流程

```
app.whenReady()
    ↓
检查 config.configured && config.apiKey
    ↓
├── 未配置 → 显示 config.html → 监听 config-done 事件
│                                ↓
│   用户填写 API Key / 存储路径 / 端口
│                                ↓
│   configDone(config) → 启动前端 → 启动后端 → 创建主窗口
│
└── 已配置 → 直接启动前端 + 后端 → 创建主窗口
                                         ↓
                              注册快捷键 + 启动提醒调度 + 更新检查
```

---

## 6. 浏览器扩展

### 6.1 结构概览

**目录**: `browser-extension/`

```
browser-extension/
├── manifest.json          # Manifest V3 配置
├── background.js          # Service Worker (747 行)
├── content.js             # 内容提取脚本 (232 行)
├── content.css            # 内容样式
├── popup.html / popup.js  # 剪藏弹窗
├── options.html / options.js  # 设置页
├── import-password.html / .js  # 密码导入弹窗
├── clip.html / clip.js / clip-main.js  # 独立剪藏页
├── todo.html / todo.js    # 独立待办页
├── index.html / index.js  # 扩展首页
├── styles/                # 共享主题 CSS
├── libs/                  # axios, html2canvas, marked
└── icons/                 # 4 种尺寸图标
```

### 6.2 manifest.json 关键配置

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 权限 | `contextMenus`, `storage`, `activeTab`, `scripting` | 右键菜单 + 存储 + 脚本注入 |
| host_permissions | `<all_urls>`, localhost:8081 | 所有页面 + 后端 API |
| commands | `clip-page` (Ctrl+Shift+S), `clip-selection` (Ctrl+Shift+V) | 快捷键 |
| content_scripts | `content.js` + `content.css`, `document_idle` | 内容脚本 |

### 6.3 核心流程

**剪藏流程**:
```
用户右键/快捷键
    ↓
background.js: clipPage()
    ↓
content.js: extractCapturePayload()  ← 提取选中文本/页面内容
    ↓
background.js: buildCapturePayload()  ← 可选 AI 内容清理
    ↓
popup.html: 展示编辑窗口
    ↓
用户确认 → sendToBackendPromise() → POST /api/clip/add
```

**智能内容提取**: 按选择器优先级提取正文: `article > main > .content > p标签 > body`

---

## 7. 依赖关系

### 7.1 Maven 依赖

**文件**: [pom.xml](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/backend/pom.xml)

| 依赖 | 版本 | 用途 |
|------|------|------|
| spring-boot-starter-web | 3.2.0 | Web 服务 |
| spring-boot-starter-mail | 父管理 | 邮件发送 |
| spring-boot-starter-webflux | 父管理 | WebClient 网页抓取 |
| spring-ai-core | 0.8.1 | AI 框架核心 |
| spring-ai-openai | 0.8.1 | OpenAI 兼容接入 (DeepSeek) |
| dashscope-sdk-java | 2.16.0 | 通义千问 SDK |
| jsoup | 1.17.2 | HTML 解析 |
| pdfbox | 3.0.5 | PDF 解析 |
| poi-ooxml | 5.2.5 | Office 文档解析 |
| spring-boot-starter-test | 父管理 (test) | 测试 |

### 7.2 npm 依赖

**文件**: [package.json](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/package.json)

| 依赖 | 版本 | 用途 |
|------|------|------|
| electron | ^28.0.0 | 桌面框架 |
| electron-builder | ^24.9.1 | 打包 |
| serve-static | - | 静态文件托管 |
| finalhandler | - | HTTP 中间件 |
| js-yaml | - | YAML 解析 |
| node-notifier | - | 系统通知 |

### 7.3 后端服务间依赖

```
ClipService ──────→ AiService ──────→ RoutingLlmProvider ──→ DashScopeLlmProvider
    │                   │                  │                 └──→ DeepSeekLlmProvider
    │                   │                  └──→ ModelConfigService ──→ model-config.json
    │                   └──→ PromptConfigService
    ├──→ FileStorageService
    ├──→ ContentOrganizeService ──→ EmailService + GitService
    ├──→ LinkParseService
    └──→ DocumentParseService

LearningPlanService ──→ AiService + ExaSearchService
PasswordVaultService ──→ DesEncryptionUtil + AiService (autoFill)
ScheduledTasks ──→ ContentOrganizeService
```

### 7.4 前端页面依赖

```
index.html (shell)
    ├── todo.html (iframe)
    ├── clip.html (iframe)
    ├── topic.html (iframe)
    ├── topic-detail.html (iframe)
    ├── topic-editor.html (iframe)
    ├── vault.html (iframe)
    ├── learning-plan.html (iframe)
    └── settings.html (iframe)

所有子页面通过 postMessage 与 index.html 通信
所有子页面共享 styles/theme-notion.css 等主题文件
```

---

## 8. 项目运行方式

### 8.1 开发模式运行

#### 方式一：一键脚本

```bash
# macOS/Linux
./start.sh

# Windows
start.bat
```

脚本自动完成: 检查环境 → 启动后端 JAR → 启动前端服务器 → 打开浏览器

#### 方式二：手动分步

```bash
# 1. 编译后端
cd backend
mvn clean package -DskipTests

# 2. 启动后端
java -jar target/clip-demo-0.0.1-SNAPSHOT.jar
# 后端运行在 http://127.0.0.1:8081

# 3. 启动前端
cd frontend
node server.js
# 前端运行在 http://127.0.0.1:3001

# 4. 打开浏览器访问 http://127.0.0.1:3001
```

#### 方式三：Electron 开发模式

```bash
# 安装依赖（首次）
npm install

# 启动 Electron（需先启动后端 + 前端）
npx electron electron/main.js
```

### 8.2 打包构建

#### 一键构建

```bash
# macOS
./build.sh

# Windows
build.bat
```

#### 按平台构建

```bash
# 编译后端 JAR
npm run build:jar

# 打包桌面应用
npm run build:mac     # macOS (dmg + zip, arm64 + x64)
npm run build:win     # Windows (nsis + portable)
npm run build:linux   # Linux (AppImage)
```

#### electron-builder 配置

| 配置项 | 值 |
|--------|-----|
| appId | `com.example.clip-demo` |
| productName | `CutShelter` |
| extraResources | `backend/target/*.jar`, `frontend/`, `jre/` |
| 输出目录 | `dist-electron/` |
| Windows | nsis（安装版）+ portable（便携版） |
| macOS | dmg + zip, `hardenedRuntime: true` |
| Linux | AppImage |

### 8.3 浏览器扩展安装

1. 打开 Chrome → `chrome://extensions`
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `browser-extension/` 目录
5. 在扩展设置中配置后端 API 地址

### 8.4 环境要求

| 依赖 | 最低版本 | 用途 |
|------|---------|------|
| Java (JDK) | 17 | 后端编译运行 |
| Maven | 3.6+ | 后端构建 |
| Node.js | 16+ | 前端 + Electron |
| npm | 8+ | 依赖管理 |

### 8.5 关键配置文件

| 文件 | 位置 | 用途 |
|------|------|------|
| `application.yml` | `backend/src/main/resources/` | Spring Boot 配置 |
| `application_templete.yml` | 同上 | 配置模板（含占位符） |
| `logback-spring.xml` | 同上 | 日志配置 |
| `config.json` | `userData/config/` | Electron 运行时配置 |
| `model-config.json` | `~/.clip-demo/` | AI 模型配置 |
| `app-config.json` | `{storagePath}/config/` | 应用统一配置 |
| `package.json` | 项目根目录 | Electron + 构建配置 |

---

## 9. 数据流与通信机制

### 9.1 请求数据流

```
用户操作（iframe 内）
    ↓
fetch('/api/...')
    ↓
Electron 前端服务器（:3001）
    ↓ API 代理
Spring Boot 后端（:8081）
    ↓
Controller → Service → FileStorageService
    ↓                    ↓
    ↓                    JSON 文件读写
    ↓
AI 调用（AiService → LlmProvider → DashScope/DeepSeek）
    ↓
返回 JSON 响应
    ↓
前端渲染更新
```

### 9.2 主题变更数据流

```
settings.html: 用户切换外观
    ↓
localStorage.setItem('app_appearance_v1', appearance)
    ↓
window.parent.postMessage({ type: 'appearanceChanged', appearance })
    ↓
index.html: applyTheme()
    ↓
document.documentElement.setAttribute('data-theme', dataTheme)
    ↓
广播: 所有 iframe.contentWindow.postMessage({ action: 'themeChange' })
    ↓
各子页面: applyTheme() 更新 CSS 变量
```

### 9.3 提醒数据流

```
Electron 主进程: startReminderScheduler()
    ↓ 每 30 秒
GET /api/todo/due-reminders
    ↓
有到期待办 →
    PUT /api/todo/{id}/reminder-fired  (标记已触发)
    ↓
showNotification() → 透明 BrowserWindow（380x160，右下角，滑入动画）
```

---

## 10. 竞品分析：YouMind vs CutShelter

### 10.1 YouMind 产品概览

YouMind 是由前阿里前端专家玉伯创立的 AI 创作平台，定位为"以输出为终点的创作操作系统"。核心理念是将"收藏夹地狱"变成"输出型天堂"，让每一次保存都直指成稿。

**核心特点**:
- 多模态素材收集（网页、视频、播客、PDF、图片）
- 多模型调度引擎（GPT-4 / Claude / Gemini / DeepSeek）
- Board（看板）式项目管理
- AI 辅助创作（自动补全、风格克隆、引用插入）
- 多格式再生产（学术论文 / LinkedIn / 小红书 / Newsletter）
- 溯源级引用（秒级视频时间戳 + PDF 页码）
- 隐私优先架构（边缘向量 + 云端推理）
- 协作 Branch（多人实时编辑 + Diff 视图）

### 10.2 功能对比矩阵

| 能力维度 | CutShelter | YouMind | 评价 |
|---------|-----------|---------|------|
| **信息收集** | | | |
| 网页剪藏 | ✅ 浏览器扩展 + 右键菜单 | ✅ 浏览器扩展 + iOS Share | 持平 |
| 视频/播客收集 | ❌ | ✅ 多模态提取 | YouMind 领先 |
| PDF/文档解析 | ✅ PDFBox + POI | ✅ | 持平 |
| 图片剪藏 | ✅ | ✅ | 持平 |
| AI 内容清理 | ✅ 有限 | ✅ 多 provider | YouMind 领先 |
| **知识管理** | | | |
| 分类体系 | ✅ 6 一级 + 12 二级分类 | ✅ Board 级自管理 | 各有特色 |
| 全文搜索 | ✅ | ✅ RAG 召回 | YouMind 领先 |
| 发散性总结 | ✅ 角色映射多角度分析 | ❌ 未提及 | CutShelter 独有 |
| 知识图谱 | ❌ | ✅ 研究脉络图 | YouMind 领先 |
| 思维导图 | ✅ Mermaid 学习路径 | ✅ SVG 思维导图 | 持平 |
| **AI 能力** | | | |
| 多 LLM 支持 | ✅ DashScope + DeepSeek | ✅ GPT-4/Claude/Gemini/DeepSeek | YouMind 范围更广 |
| LLM 热切换 | ✅ RoutingLlmProvider | ✅ 动态调度 | 持平 |
| AI 角色系统 | ✅ 分类角色映射 | ✅ Board 级 AI 角色 | YouMind 更灵活 |
| AI 自动填充 | ✅ 密码库自动填充 | ❌ | CutShelter 独有 |
| **内容输出** | | | |
| 日报/周报 | ✅ 定时自动生成 | ❌ | CutShelter 独有 |
| Markdown 编辑 | ✅ 专题编辑器 | ✅ AI Writer | YouMind 更强 |
| 多格式再生产 | ❌ | ✅ 论文/小红书/Newsletter | YouMind 领先 |
| 一键分享 | ❌ | ✅ 公开/私密链接 | YouMind 领先 |
| 溯源引用 | ❌ | ✅ 秒级视频时间戳 | YouMind 领先 |
| **特色模块** | | | |
| 密码管理 | ✅ DES 加密 + 多密码库 | ❌ | CutShelter 独有 |
| 学习计划 | ✅ AI 路线图 + Exa 搜索 | ❌ | CutShelter 独有 |
| 待办管理 | ✅ 时间线 + 提醒 | ❌ | CutShelter 独有 |
| Git 同步 | ✅ | ❌ | CutShelter 独有 |
| **协作能力** | | | |
| 多人协作 | ❌ | ✅ Branch + Diff | YouMind 领先 |
| 社区/发布 | ❌ | ✅ 创作者社区 | YouMind 领先 |
| **部署方式** | | | |
| 本地优先 | ✅ 完全本地 | ✅ 边缘向量 + 云端推理 | CutShelter 更彻底 |
| 桌面应用 | ✅ Electron 跨平台 | ❌ Web 应用 | CutShelter 独有 |
| 浏览器扩展 | ✅ Chrome MV3 | ✅ | 持平 |
| 数据主权 | ✅ 完全用户掌控 | ✅ 零训练零留存 | 持平 |

### 10.3 核心差异分析

#### CutShelter 的独有优势

1. **全功能集成**: 一个应用覆盖剪藏 + 待办 + 密码 + 学习计划 + Git 同步，YouMind 聚焦内容创作
2. **本地优先架构**: 完全本地存储，不依赖任何云端服务，数据主权 100% 用户掌控
3. **密码管理**: DES 加密密码库是独有的差异化能力，YouMind 完全没有
4. **学习计划 + Exa 搜索**: AI 生成学习路线图 + 真实资源搜索，是教育场景的独特应用
5. **定时整理**: 自动日报/周报 + 邮件通知 + Git 同步，形成完整的知识管理闭环
6. **桌面应用**: Electron 原生体验，系统托盘 + 全局快捷键 + 离线使用

#### YouMind 的领先优势

1. **多模态收集**: 视频/播客内容提取能力，CutShelter 目前仅支持文本和文档
2. **多格式再生产**: 同一素材可输出论文/小红书/Newsletter/播客脚本，CutShelter 仅 Markdown
3. **溯源引用**: 生成内容可精准溯源到原视频秒级/PDF 页码，解决 AI 幻觉问题
4. **协作能力**: 多人实时编辑 + Diff 视图 + AI 仲裁合并
5. **创作者社区**: 内置作品发布和社区传播能力
6. **知识图谱**: 自动生成研究脉络图，CutShelter 仅有 Mermaid 学习路径

---

## 11. 产品建议与新功能开发

### 11.1 战略定位建议

基于竞品分析，CutShelter 应发挥**全功能集成 + 本地优先**的差异化优势，同时吸收 YouMind 在**内容输出和多模态**方面的领先能力。建议定位为：

> **本地优先的全功能知识操作系统** — 不只是剪藏工具，而是"捕捉 → 思考 → 输出"的全链路知识管理平台

### 11.2 新功能开发建议（按优先级排序）

#### P0 — 核心竞争力提升

##### 1. 多模态素材收集（视频/播客转文字）

**借鉴 YouMind**: 支持从 YouTube/Bilibili 视频和播客提取内容

```
技术方案:
- 后端新增 MediaParseService
- 集成 Whisper API 或本地 whisper.cpp 做语音转文字
- 视频提取: yt-dlp 下载音频 → Whisper 转写 → AI 摘要
- 前端: clip.html 新增"视频/播客"类型，输入 URL 后自动提取
- 数据模型: ClipContent 新增 mediaTranscript 字段
```

##### 2. 知识图谱与关联可视化

**借鉴 YouMind**: 自动生成剪藏间的关联图谱

```
技术方案:
- 后端: AiService 新增 generateRelationGraph() 方法
- 前端: 新建 graph.html，使用 D3.js / vis.js 渲染力导向图
- 节点: 剪藏/话题/学习计划/待办
- 边: AI 自动识别的语义关联（相似主题、引用关系、时间序列）
- 交互: 点击节点跳转详情，拖拽调整布局
```

##### 3. AI 辅助内容创作（多格式输出）

**借鉴 YouMind**: 从"收集整理"升级为"内容输出"

```
技术方案:
- 新增 compose.html（创作工作台）
- AiService 新增方法:
  - generateArticle(clipIds[], style) — 从多个剪藏生成文章
  - generateNewsletter(clipIds[]) — 生成 Newsletter 格式
  - generateSocialPost(clipId, platform) — 小红书/微博/LinkedIn 格式
  - generateSlide(clipIds[]) — 生成幻灯片大纲
- 支持风格克隆: 提供用户已有文章作为风格参考
- 输出: Markdown + HTML 预览 + 一键复制
```

#### P1 — 差异化能力增强

##### 4. 溯源引用系统

**借鉴 YouMind**: 解决 AI 幻觉问题，增强可信度

```
技术方案:
- ClipContent 新增 sourceSegments 字段（引用片段列表）
- AI 生成内容时同步插入 [^1] [^2] 脚注标记
- 脚注链接到原始剪藏的具体段落
- 前端: 点击脚注弹出原文片段卡片
- 扩展到视频: 记录时间戳，点击跳转视频对应位置
```

##### 5. Board（看板）式项目管理

**借鉴 YouMind**: 将剪藏从"列表"升级为"看板"

```
技术方案:
- 新增 Board 实体（id, title, description, clipIds[], aiRole, outputGoal）
- 前端: 新建 board.html
  - 拖拽式看板布局（待处理/进行中/已完成列）
  - 每个卡片可拖拽分组
  - 侧栏 AI 助手（限定 Board 范围问答）
- 每个 Board 可设定 AI 角色（审稿人/爆款写手/学术润色）
- Board 级输出目标: Feynman Loop 提示"未来 7 天计划输出什么"
```

##### 6. 嵌入式语义搜索（RAG）

**借鉴 YouMind**: 当前 EmbeddingConfig 已注释，应启用

```
技术方案:
- 取消注释 EmbeddingConfig.java
- 集成本地嵌入模型（如 BGE-M3 或 text-embedding-3-small）
- FileStorageService 新增 embedding 索引管理
- 搜索时: 关键词搜索 → 向量检索 → 混合排序
- 本地向量数据库: 可选 sqlite-vss 或 hnswlib
- 优势: 完全本地运行，无需云端 API
```

#### P2 — 体验优化

##### 7. 协作与分享

**借鉴 YouMind**: 从单机工具升级为可分享/可协作

```
技术方案:
- 内容分享: 生成只读公开链接（后端新增 /api/share/{token} 端点）
- 分享页面: 独立的 share.html，无需登录即可查看
- 协作: 基于 Git 仓库的 Branch 模式（已有 Git 同步基础）
  - 多人各自本地编辑 → Git push → 冲突段落 AI 仲裁合并
- 权限: 公开/私密/密码访问三级
```

##### 8. 多格式导出

**借鉴 YouMind**: 同一内容多格式输出

```
技术方案:
- 后端新增 ExportService
- 支持导出格式:
  - Markdown（已有基础）
  - HTML（带样式）
  - PDF（通过 Puppeteer 或 wkhtmltopdf）
  - EPUB（电子书）
  - DOCX（Apache POI 已有依赖）
  - 幻灯片（reveal.js 格式 HTML）
- 前端: 详情页新增"导出"按钮，选择格式后下载
```

##### 9. iOS Share Extension（移动端收集）

**借鉴 YouMind**: 补齐移动端收集能力

```
技术方案:
- 开发 iOS Share Extension（Swift/React Native）
- 分享到 CutShelter → 发送到后端 API
- 或: 使用快捷指令（Shortcuts）+ Webhook 方案
- 后端新增 /api/clip/mobile 端点接收移动端数据
- 替代方案: 开发移动端 PWA 或 React Native App
```

#### P3 — 长期规划

##### 10. 插件市场

**借鉴 YouMind**: 开放自定义转换器

```
技术方案:
- 定义插件接口: ClipPlugin（name, type, execute）
- 插件类型: 内容转换器 / AI 角色 / 导出格式 / 主题
- 插件市场: 类似 Obsidian Community Plugins
- 插件用自然语言描述 + AI 生成代码（借鉴 YouMind 路线图）
```

##### 11. 端侧 LLM 支持

**借鉴 YouMind**: 隐私优先架构

```
技术方案:
- 集成 llama.cpp 或 Ollama
- 新增 LocalLlmProvider 实现 LlmProvider 接口
- 敏感内容自动路由到本地模型
- 模型: Qwen2-7B / Llama-3-8B / Phi-3-mini
- 优势: 完全离线、零成本、隐私保护
```

##### 12. 语音合成与播客生成

**借鉴 YouMind**: 文章 → 播客

```
技术方案:
- 集成 Edge-TTS 或 Azure Speech Service
- 新增 AudioService
- 将剪藏内容/周报/学习计划转换为播客音频
- 支持保留原声引用片段（视频时间戳 → 音频片段）
- 前端: 新增音频播放器组件
```

### 11.3 技术优化建议

| 优先级 | 优化项 | 现状 | 建议 |
|--------|--------|------|------|
| 高 | API Key 安全 | 明文存储在 application.yml | 迁移到环境变量或加密配置 |
| 高 | Java 版本统一 | properties 声明 21，编译器 17 | 统一为同一版本 |
| 高 | 日志路径 | 硬编码 Windows 路径 | 改为平台无关路径 |
| 中 | 配置文件对齐 | yml 与模板不一致 | 对齐邮件、Exa、DeepSeek 配置 |
| 中 | 启用嵌入 | EmbeddingConfig 已注释 | 取消注释，启用语义搜索 |
| 中 | 前端组件化 | 原生 HTML/JS | 可考虑迁移到 Svelte/Lit（渐进式） |
| 低 | 数据库 | JSON 文件 | 数据量增大后可迁移到 SQLite |

### 11.4 产品路线图建议

```
Phase 1 (近期): 核心体验提升
├── 多模态收集（视频/播客转文字）
├── 启用语义搜索（RAG）
├── 溯源引用系统
└── 技术优化（Key安全、版本统一、日志路径）

Phase 2 (中期): 内容输出能力
├── AI 辅助创作工作台
├── 多格式导出（PDF/DOCX/幻灯片）
├── Board 看板式项目管理
└── 内容分享（公开链接）

Phase 3 (远期): 协作与生态
├── 多人协作（Git Branch 模式）
├── 插件市场
├── 端侧 LLM 支持
├── 移动端收集
└── 语音合成/播客生成
```

### 11.5 一句话总结

CutShelter 的核心优势在于**全功能集成 + 本地优先 + AI 驱动**，已构建了从剪藏到密码管理的完整工具链。下一步应重点补齐**多模态收集**和**内容输出**两大短板，将产品从"信息管理工具"升级为"知识创作平台"，在保持本地优先和数据主权优势的同时，吸收 YouMind 在内容创作和多格式输出方面的领先能力。

---

> **文档生成日期**: 2026-07-11  
> **项目版本**: 1.0.7  
> **分析基于**: 当前代码库全量扫描 + youmind.com 产品调研
