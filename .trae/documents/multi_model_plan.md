# 多模型接入计划：DeepSeek + 阿里云 DashScope

## 1. 概述

在不影响现有阿里云 DashScope 模型功能的前提下，新增 DeepSeek 模型接入。用户可配置模型名称、API Key 等信息后自由选择，**Web 端和 Electron 桌面端均支持**。

## 2. 当前架构分析

### 2.1 后端 AI 调用
- 所有 AI 调用集中在 [AiService.java](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/backend/src/main/java/com/example/clip/core/AiService.java)，通过阿里云 `dashscope-sdk-java` 的 `Generation` 类直接调用
- 配置硬编码在 [DashScopeConfig.java](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/backend/src/main/java/com/example/clip/core/DashScopeConfig.java)，读取 `application.yml` 中的 `spring.ai.dashscope.api-key` 和 `spring.ai.dashscope.chat.options.model`
- 所有 9 个 AI 方法都直接构建 `GenerationParam` 并调用 `generation.call(param)`

### 2.2 已有依赖
- `spring-ai-openai:0.8.1` — 已存在，可直接用于调用 DeepSeek（OpenAI 兼容 API）
- `dashscope-sdk-java:2.16.0` — 当前阿里云 SDK
- `spring-boot-starter-web` — 提供 `RestTemplate`，可用于 HTTP 调用

### 2.3 DeepSeek API 特点
- 完全兼容 OpenAI Chat Completions API 格式
- 端点：`https://api.deepseek.com/v1`
- 认证方式：`Authorization: Bearer <api_key>`
- **Spring AI 原生支持**：只需配置 `spring.ai.openai.base-url=https://api.deepseek.com`，`OpenAiChatModel` 即可直接调用

### 2.4 Electron 桌面端已有配置系统
- [electron/main.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js#L21-L37)：`config.json` 存储用户配置，含 `apiKey` 字段
- `generateApplicationYml()` 将配置写入 `application.yml` 后启动后端
- [electron/config.html](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/config.html)：桌面端配置窗口，有 API Key 输入等界面
- 启动流程：`config.json` → `application.yml` → Spring Boot 读取配置

### 2.5 调用方
`AiService` 被 3 处调用：
| 调用方 | 用途 |
|--------|------|
| [ClipController.java](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/backend/src/main/java/com/example/clip/controller/ClipController.java) | 生成标签、智能整理、发散性总结 |
| [ContentOrganizeService.java](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/backend/src/main/java/com/example/clip/service/ContentOrganizeService.java) | 内容整理为知识库 |
| [WeeklyReportService.java](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/backend/src/main/java/com/example/clip/service/WeeklyReportService.java) | 生成周报 |

## 3. 设计方案

### 3.1 核心思路

**使用 Spring AI 框架作为统一的 LLM 调用层**，而非自己写 HTTP 调用。Spring AI 的 `ChatModel` 接口已内置模型抽象，`OpenAiChatModel` 可直接对接 DeepSeek（只需改 base-url）。

```
AiService (不变更公开方法签名)
  └── LlmProvider (轻量接口)
        ├── DashScopeLlmProvider (封装现有 Generation SDK)
        └── DeepSeekLlmProvider (封装 Spring AI OpenAiChatModel)
```

### 3.2 为什么用 Spring AI 而非自己写 HTTP

| 对比 | 自己写 HTTP | Spring AI |
|------|-----------|-----------|
| 代码量 | 需要处理请求构建、响应解析、错误处理 | 0 行，配置即可 |
| 重试/容错 | 需自己实现 | 内置 retry 模板 |
| 流式响应 | 复杂 | 内置支持 |
| 统一抽象 | 需自己定义接口 | `ChatModel` 接口已有 |
| 项目依赖 | 0 额外依赖 | `spring-ai-openai` 已存在 |

### 3.3 新增文件

| 文件 | 路径 | 说明 |
|------|------|------|
| `LlmProvider.java` | `backend/.../core/LlmProvider.java` | LLM 提供者接口 |
| `DashScopeLlmProvider.java` | `backend/.../core/DashScopeLlmProvider.java` | 阿里云实现（迁移现有逻辑） |
| `DeepSeekLlmProvider.java` | `backend/.../core/DeepSeekLlmProvider.java` | DeepSeek 实现（封装 OpenAiChatModel） |
| `ModelConfig.java` | `backend/.../core/ModelConfig.java` | 模型配置数据类 |
| `ModelConfigService.java` | `backend/.../service/ModelConfigService.java` | 配置持久化 JSON 读写 |
| `ModelConfigController.java` | `backend/.../controller/ModelConfigController.java` | 配置 REST API |
| `settings.html` | `frontend/settings.html` | Web 端设置页面 |
| `settings.js` | `frontend/settings.js` | 设置页面逻辑 |

### 3.4 修改文件

| 文件 | 修改内容 |
|------|---------|
| [AiService.java](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/backend/src/main/java/com/example/clip/core/AiService.java) | 内部通过 `LlmProvider` 调用，不再直接依赖 `Generation` |
| [DashScopeConfig.java](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/backend/src/main/java/com/example/clip/core/DashScopeConfig.java) | 保留，作为 `DashScopeLlmProvider` 的配置源 |
| [application_templete.yml](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/backend/src/main/resources/application_templete.yml) | 新增 `spring.ai.openai` 配置段（DeepSeek） |
| [electron/main.js](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js) | 扩展配置和 `generateApplicationYml()` |
| [electron/config.html](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/config.html) | 增加模型选择 UI |
| [index.html](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/index.html) | 左侧导航栏增加"设置"入口 |
| [browser-extension/manifest.json](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/browser-extension/manifest.json) | 新增 settings.html 资源 |

### 3.5 LlmProvider 接口

```java
public interface LlmProvider {
    /** 调用 LLM 对话 */
    String chat(String systemPrompt, String userMessage);
    /** 提供者名称 */
    String getProviderName();
    /** 是否可用（API Key 已配置） */
    boolean isAvailable();
}
```

### 3.6 DeepSeekLlmProvider 实现（Spring AI 方式）

```java
@Component
public class DeepSeekLlmProvider implements LlmProvider {
    private OpenAiChatModel chatModel;
    private String apiKey;
    private String model;

    public DeepSeekLlmProvider(ModelConfigService configService) {
        // 从配置读取 API Key 和 model
        // 动态构建 OpenAiChatModel:
        //   new OpenAiApi("https://api.deepseek.com", apiKey)
        //   -> new OpenAiChatModel(openAiApi, options)
    }

    @Override
    public String chat(String systemPrompt, String userMessage) {
        ChatResponse response = chatModel.call(
            new Prompt(List.of(
                new Message(Role.SYSTEM, systemPrompt),
                new Message(Role.USER, userMessage)
            ))
        );
        return response.getResult().getOutput().getContent();
    }
}
```

**注意**：由于 `OpenAiChatModel` 在构造时就需要 API Key，而 API Key 是运行时配置的，因此不能直接用 `@Bean` 注入。采用 `ModelConfigService` 动态读取配置后构造。

### 3.7 ModelConfig 配置管理

```java
// 存储为 JSON 文件：./clip-storage/model-config.json
public class ModelConfig {
    private String activeProvider = "dashscope";  // "dashscope" | "deepseek"
    private String deepseekApiKey = "";
    private String deepseekModel = "deepseek-chat";
    private String dashscopeApiKey = "";
    private String dashscopeModel = "qwen-plus";
}
```

**配置优先级**：`model-config.json` > `application.yml` > 默认值

### 3.8 Configuration 支持运行时切换

```java
@Configuration
public class LlmProviderConfig {
    
    @Bean
    @Primary
    public LlmProvider llmProvider(ModelConfigService configService) {
        // 返回一个代理，每次调用时根据 activeProvider 路由到正确实现
        return new RoutingLlmProvider(configService, 
            dashScopeProvider(), deepSeekProvider(configService));
    }
}
```

`RoutingLlmProvider` 在每次 `chat()` 调用时检查 `activeProvider` 并委托给对应实现，实现**热切换，无需重启**。

### 3.9 Electron 桌面端配置扩展

**现有的 `config.json` 结构**（`userData/config/config.json`）：
```json
{
  "apiKey": "sk-xxx",
  "backendPort": 8080,
  "configured": true,
  ...
}
```

**扩展后**：
```json
{
  "apiKey": "sk-xxx",
  "activeProvider": "dashscope",
  "deepseekApiKey": "",
  "deepseekModel": "deepseek-chat",
  "dashscopeModel": "qwen-plus",
  "backendPort": 8080,
  "configured": true,
  ...
}
```

**`generateApplicationYml()` 扩展**：新增 DeepSeek 配置段写入 `application.yml`：
```yaml
spring:
  ai:
    dashscope:
      api-key: ${apiKey}
      chat:
        options:
          model: ${dashscopeModel}
    openai:
      api-key: ${deepseekApiKey}
      base-url: https://api.deepseek.com
      chat:
        options:
          model: ${deepseekModel}
```

**`config.html` 扩展**：在现有 API Key 区域下方增加模型选择区域：
```
┌──────────────────────────────────┐
│  当前使用模型：[DashScope ▼]      │
│                                  │
│  ── 阿里云 DashScope ──          │
│  API Key：[sk-xxx...]  [👁]      │
│  模型：  [qwen-plus ▼]           │
│                                  │
│  ── DeepSeek ──                  │
│  API Key：[sk-xxx...]  [👁]      │
│  模型：  [deepseek-chat ▼]       │
│  [测试连接]                       │
└──────────────────────────────────┘
```

### 3.10 Web 端设置页面

新增 `frontend/settings.html`，通过 index.html 左侧导航栏的"设置"入口访问。页面内容与 Electron `config.html` 类似，但数据通过后端 API 读写。

## 4. 实现步骤

### Step 1：创建 LlmProvider 接口
- 新建 `LlmProvider.java`，定义 `chat()`、`getProviderName()`、`isAvailable()` 方法

### Step 2：创建 ModelConfig + ModelConfigService
- 新建 `ModelConfig.java` 数据类
- 新建 `ModelConfigService.java`，JSON 文件读写（参考 `PromptConfigService` 模式）

### Step 3：创建 DashScopeLlmProvider
- 新建 `DashScopeLlmProvider.java`，将 AiService 中现有 DashScope 调用逻辑迁移至此
- 保留 `Generation` Bean 注入

### Step 4：创建 DeepSeekLlmProvider
- 新建 `DeepSeekLlmProvider.java`，使用 Spring AI 的 `OpenAiApi` + `OpenAiChatModel` 调用 DeepSeek
- 动态构造（API Key 来自运行时配置）

### Step 5：创建 RoutingLlmProvider + LlmProviderConfig
- 新建 `RoutingLlmProvider.java`，根据 `activeProvider` 动态路由
- 新建 `LlmProviderConfig.java`，注册 Bean

### Step 6：重构 AiService
- 移除直接依赖 `Generation` 和 `DashScopeConfig`
- 注入 `LlmProvider`，所有 `generation.call(param)` 替换为 `llmProvider.chat(systemPrompt, userMessage)`

### Step 7：创建 ModelConfigController
- 新建 `ModelConfigController.java`
- 端点：`GET /api/model-config`、`POST /api/model-config`、`POST /api/model-config/test`

### Step 8：创建 Web 端设置页面
- 新建 `frontend/settings.html` + `settings.js`
- 模型选择、API Key 配置、测试连接

### Step 9：导航整合
- `index.html` 左侧导航栏增加"设置"入口
- `manifest.json` 增加 settings.html 资源

### Step 10：Electron 桌面端集成
- 扩展 `electron/main.js` 的 `DEFAULT_CONFIG` 字段
- 扩展 `generateApplicationYml()` 生成 DeepSeek 配置
- 扩展 `electron/config.html` 增加模型选择 UI

## 5. 关键决策

| 决策 | 方案 | 理由 |
|------|------|------|
| DeepSeek 调用方式 | **Spring AI `OpenAiChatModel`** | 项目已有 `spring-ai-openai` 依赖，零额外成本，内置重试/容错/响应解析 |
| 接口抽象层 | 自定义 `LlmProvider`（非 Spring AI 的 `ChatModel`） | 当前 Spring AI 是 0.8.1 版本，API 较不稳定，自定义接口可避免升级兼容问题 |
| DashScope 保留 | 继续用 `dashscope-sdk-java` | 不引入兼容风险，功能稳定 |
| 配置存储 | JSON 文件 (`model-config.json`) | 与现有 PromptConfig 模式一致，无需数据库 |
| 运行时切换 | 支持热切换 | `RoutingLlmProvider` 每次调用动态路由，无需重启 |
| 桌面端配置 | 扩展 `config.json` + `generateApplicationYml()` | 复用现有 Electron 配置体系，启动时写入 `application.yml` |
| 旧代码兼容 | 保留 `DashScopeConfig` | 作为默认配置源，不影响现有启动流程 |

## 6. 验证方式

1. 启动后端，`GET /api/model-config` 获取默认配置（activeProvider=dashscope）
2. 通过 API 配置 DeepSeek API Key，`POST /api/model-config/test` 测试连接
3. 切换到 DeepSeek，剪藏页面测试 AI 分析是否正常
4. 切换回 DashScope，验证原有功能不受影响
5. Web 端设置页面保存配置，刷新后配置持久化
6. Electron 桌面端 config 窗口配置模型，重启后验证 `application.yml` 正确生成