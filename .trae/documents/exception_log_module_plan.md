# 异常日志模块设计方案

## 一、概述

为项目设计统一的异常日志模块，将客户端（Electron 主进程）、前端（浏览器渲染进程）、后端（Java Spring Boot）三端产生的异常统一写入文件存储路径下的 `tmp/exception-logs/` 目录，使用统一的 JSON 格式记录，并在"数据观测"模块中提供前端可视化查看能力。

## 二、当前状态分析

### 现有日志体系（分散、不统一）

| 端 | 日志位置 | 格式 | 问题 |
|---|---|---|---|
| **后端 (logback)** | `~/.cut-demo/logs/` | 文本格式 | 路径与存储路径无关，非结构化，无统一异常聚合 |
| **Electron 主进程** | `app.log`（项目根目录） | 文本格式 | 单文件无滚动，无异常聚合 |
| **前端 logger.js** | 控制台 + IPC 到 Electron | 文本格式 | 仅转发，无独立异常文件，无后端异常采集 |

### 存储路径

- `clip.storage.path` = `L:\归档\40_Knowledge (知识金库)\41_Vaults (知识库核心)\剪藏收集\剪藏内容\Clip_Bed\clip-storage`（在 application.yml 中配置）
- `{clip.storage.path}/tmp/` 目录目前不存在，需新建

### 观察模块

- 后端：`DataObservabilityController` (`/api/data/*`)，提供 overview/habits/insights/trends 等接口
- 前端：`data-observability.html` + `data-observability.js`，展示统计卡片和趋势图

## 三、统一异常日志格式

每条异常日志为单行 JSON，格式如下：

```json
{
  "id": "err_20260808_001",
  "timestamp": "2026-08-08 14:30:15.123",
  "level": "ERROR",
  "source": "backend|electron|frontend",
  "sourceDetail": "类名.方法名(文件名:行号)",
  "message": "异常简要描述",
  "stackTrace": "完整堆栈信息（多行转义）",
  "thread": "线程名称",
  "requestUri": "请求路径（仅后端）",
  "appVersion": "应用版本号"
}
```

文件存储策略：
- 文件路径：`{clip.storage.path}/tmp/exception-logs/YYYY-MM/exception-YYYY-MM-dd.jsonl`
- 格式：JSON Lines（每行一条 JSON）
- 滚动：按天切分，按月归档目录
- 清理：保留最近 90 天，超期可手动清理（在观察模块中提供）

## 四、具体改动

### 4.1 后端（Java Spring Boot）

#### 新增文件

| 文件 | 说明 |
|---|---|
| `backend/src/main/java/com/example/clip/service/ExceptionLogService.java` | 异常日志写入与读取服务 |
| `backend/src/main/java/com/example/clip/service/ExceptionLogWriter.java` | 低层文件写入器（线程安全、异步批量写入） |

#### 修改文件

| 文件 | 改动 |
|---|---|
| `backend/src/main/java/com/example/clip/config/AppConfig.java` | 新增 `getStoragePath()` 衍生 `getExceptionLogDir()` 方法（或直接使用 AppConfigService） |
| `backend/src/main/java/com/example/clip/controller/DataObservabilityController.java` | 新增 `/api/data/exception-logs` 端点（列表、详情、按日期范围过滤） |
| `backend/src/main/java/com/example/clip/core/AiService.java` | 在 try-catch 中调用 ExceptionLogService 记录异常 |
| `backend/src/main/java/com/example/clip/service/FileStorageService.java` | 在 try-catch 中调用 ExceptionLogService 记录异常 |
| `backend/src/main/java/com/example/clip/core/DashScopeLlmProvider.java` | 在 try-catch 中调用 ExceptionLogService 记录异常 |
| `backend/src/main/java/com/example/clip/core/DeepSeekLlmProvider.java` | 在 try-catch 中调用 ExceptionLogService 记录异常 |
| `backend/src/main/java/com/example/clip/core/OpenAiCompatibleLlmProvider.java` | 在 try-catch 中调用 ExceptionLogService 记录异常 |
| `backend/src/main/java/com/example/clip/core/RoutingLlmProvider.java` | 在 try-catch 中调用 ExceptionLogService 记录异常 |

**关键设计**：
- `ExceptionLogService` 作为 Spring `@Service`，注入 `AppConfigService` 获取 `storagePath`，日志文件路径 = `{storagePath}/tmp/exception-logs/`
- 写入方式：使用 `BufferedWriter` + 定时 flush（每 5 秒），避免频繁 I/O
- 提供一个 `record(Exception)` 重载方法，自动提取堆栈、线程等信息
- 使用 `@Async` 异步写入，不阻塞业务线程
- 所有现有 Controller 和方法上不做侵入式改动——通过 **Spring `@ControllerAdvice` 全局异常处理器** 统一捕获所有未处理异常并写入

#### Spring 全局异常处理器

新增 `GlobalExceptionHandler`（`@ControllerAdvice`），自动捕获所有 Controller 抛出的异常并记录到异常日志。

#### 存储路径获取

`ExceptionLogService` 从 `AppConfigService` 获取 `storagePath`，然后拼接 `tmp/exception-logs/`。`AppConfigService` 中已有 `@Value("${clip.storage.path}")` 注入的 `storagePath`。

### 4.2 Electron 主进程

#### 修改文件

| 文件 | 改动 |
|---|---|
| `electron/logger.js` | 新增异常日志写入 tmp 目录功能，捕获 `uncaughtException`/`unhandledRejection` 写入统一格式到 `{storagePath}/tmp/exception-logs/` |
| `electron/main.js` | 将 `uncaughtException`/`unhandledRejection` 处理改为调用新的 exception logger |

**关键设计**：
- Electron 需知道 `storagePath`，通过 IPC 从后端获取（调用 `/api/config/path` 获得 `clip.storage.path`）
- 在 Electron 启动时缓存 `storagePath`，后续异常日志直接写入
- 日志格式与后端一致，`source` 字段为 `"electron"`

### 4.3 前端（浏览器渲染进程）

#### 修改文件

| 文件 | 改动 |
|---|---|
| `frontend/js/logger.js` | 增强 `error` 级别日志，除现有 IPC 外，新增 HTTP 调用将异常发送到后端 `POST /api/data/exception-logs` |
| `frontend/data-observability.html` | 新增"异常日志"面板区域 |
| `frontend/js/data-observability.js` | 新增异常日志列表渲染、筛选、查看详情、清理功能 |

**关键设计**：
- 前端异常通过 `POST /api/data/exception-logs` 写入后端，后端统一持久化
- 前端观察模块新增 `/api/data/exception-logs` 的 GET 请求获取异常列表
- 支持按日期、来源、级别筛选

### 4.4 观察模块可视化

在 `data-observability.html` 中新增"异常日志"面板，包含：

1. **统计卡片**：今日异常数、近7天异常数、各来源分布
2. **异常列表**：分页列表，显示时间、来源、级别、消息摘要
3. **筛选栏**：按来源（backend/electron/frontend）、级别（ERROR/WARN）、日期范围筛选
4. **详情弹窗**：点击异常条目弹窗显示完整堆栈信息
5. **清理按钮**：清理指定天数前的异常日志
6. **异常趋势图**：近7天异常数量趋势柱状图

## 五、改动文件清单

### 新增文件（3个）

```
backend/src/main/java/com/example/clip/service/ExceptionLogService.java
backend/src/main/java/com/example/clip/service/ExceptionLogWriter.java
backend/src/main/java/com/example/clip/controller/GlobalExceptionHandler.java
```

### 修改文件（6个）

```
backend/src/main/java/com/example/clip/controller/DataObservabilityController.java
electron/logger.js
electron/main.js
frontend/js/logger.js
frontend/data-observability.html
frontend/js/data-observability.js
```

## 六、实现步骤

### Step 1: 后端异常日志写入服务
- 创建 `ExceptionLogWriter.java`：底层文件写入器，管理 JSON Lines 文件的写入、按天滚动
- 创建 `ExceptionLogService.java`：Spring Service，封装 `ExceptionLogWriter`，提供 `record()` 方法
- 创建 `GlobalExceptionHandler.java`：`@ControllerAdvice`，全局捕获异常并记录

### Step 2: 后端异常日志查询 API
- 在 `DataObservabilityController` 中新增：
  - `GET /api/data/exception-logs?date=2026-08-08&source=backend&page=1&size=20` - 分页查询
  - `GET /api/data/exception-logs/stats` - 统计信息（总数、来源分布、近期趋势）
  - `GET /api/data/exception-logs/{id}` - 获取单条详情
  - `DELETE /api/data/exception-logs?days=90` - 清理过期日志

### Step 3: Electron 端异常日志
- 修改 `electron/logger.js`，新增导入 `ExceptionLogWriter` 类似逻辑，写入同目录
- 修改 `electron/main.js`，启动时通过 IPC 获取 `storagePath`，初始化异常日志路径
- 将 `uncaughtException`/`unhandledRejection` 处理改为写入统一异常日志

### Step 4: 前端异常日志接入
- 修改 `frontend/js/logger.js`，`error` 级别日志增加向后端 `POST /api/data/exception-logs` 的上报

### Step 5: 观察模块可视化
- 修改 `data-observability.html`，新增异常日志面板 HTML 结构
- 修改 `data-observability.js`，实现异常日志列表渲染、筛选、详情弹窗、趋势图、清理功能

## 七、假设与决策

1. **日志文件格式**：使用 JSON Lines（`.jsonl`）而非纯文本，便于程序化解析和前端展示
2. **日志位置**：`{clip.storage.path}/tmp/exception-logs/`，与现有数据存储隔离，便于管理
3. **文件滚动**：按天拆分文件，按月归档目录，避免单文件过大
4. **写入方式**：后端使用异步批量写入（5秒间隔 flush），平衡实时性和 I/O 性能；Electron 使用同步追加写入（异常低频，直接写入即可）
5. **全局异常捕获**：后端通过 `@ControllerAdvice` 统一捕获，无需侵入每个 Controller
6. **前端异常上报**：通过 HTTP 调用后端 API，后端统一持久化，确保所有异常集中存储
7. **不侵入现有日志系统**：logback 和 electron-log 继续保留，新增的异常日志作为补充

## 八、验证步骤

1. 后端启动后，`{clip.storage.path}/tmp/exception-logs/` 目录自动创建
2. 手动触发一个后端异常（如请求不存在的 API），检查异常日志文件是否写入
3. Electron 进程 `uncaughtException` 触发后，检查异常日志文件是否写入
4. 前端 `FrontendLogger.error()` 调用后，检查异常日志是否通过后端 API 写入
5. 观察模块"异常日志"面板能正确展示异常列表、筛选、详情查看
6. 清理功能能正确删除指定天数前的日志文件