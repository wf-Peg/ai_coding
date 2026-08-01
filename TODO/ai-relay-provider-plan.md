# 后端 AI 服务支持「中转站 / 自定义 API 地址」开发计划（参考 ccswitch）

> **状态**：后续开发计划（本次不实施，仅存档）
> **创建日期**：2026-08-01
> **目标读者**：后续接手实施的开发者

---

## 1. 概述

### 1.1 目标

参考 ccswitch 的设计思路，让本项目的后端 AI 服务支持接入**中转站**或任意**提供 OpenAI 兼容 API 的服务地址**。用户可在设置页配置自定义 `base-url + api-key + 模型`，实现：

- 统一走 OpenAI Chat Completions 协议（覆盖 DashScope / DeepSeek / 自定义中转站）
- 内置常用厂商 / 中转站预设模板，降低配置成本
- 沿用现有 `RoutingLlmProvider` 自动降级机制
- Web 设置页 与 Electron 首次配置页均可配置

### 1.2 本次决策（已与需求方确认）

| 决策项 | 结论 |
|---|---|
| 改造形态 | **新增"通用 OpenAI 兼容 Provider"**（可配任意 base-url + api-key + 模型），与现有 DashScope/DeepSeek 并列 |
| 协议策略 | **统一走 OpenAI 兼容协议**（`POST {baseUrl}/chat/completions` + Bearer 认证） |
| 预设模板 | **内置常用预设**（DashScope 兼容模式 / DeepSeek / OpenRouter / 硅基流动 / GLM / Kimi / Ollama 等） |
| 故障降级 | **沿用现有 `RoutingLlmProvider` 自动降级**（激活 provider 失败 → 回退备用） |

---

## 2. ccswitch 调研结论

### 2.1 ccswitch 简介

[ccswitch](https://github.com/farion1231/ccswitch)（Tauri + Rust 桌面工具）核心能力：

- **多 Provider 管理**：50+ 内置预设中转节点 + 自定义节点
- **Provider 抽象**：`{ 名称, Base URL, API Key, 模型, API 协议格式 }`
- **API 协议格式选择**：OpenAI / Anthropic 可切换
- **一键切换 Provider**：配置后即时热切换
- **本地代理做协议转换**：内置 127.0.0.1 代理，把不同协议统一转成目标 CLI 需要的格式
- **自动故障转移**：主节点失败自动切备用节点
- **API 连接速度测试**：测各节点延迟
- **配置备份导出**

### 2.2 对本项目可借鉴 / 不必借鉴

| ccswitch 能力 | 本项目借鉴程度 | 理由 |
|---|---|---|
| Provider 抽象 + 自定义 base-url | ✅ 核心借鉴 | 中转站场景的本质需求 |
| 预设模板库 | ✅ 借鉴 | 降低配置成本 |
| 一键切换 + 热切换 | ✅ 已具备 | 现有 `RoutingLlmProvider` 已支持 |
| 自动故障转移 | ✅ 已具备 | 现有降级机制 |
| 连接测试 | ✅ 已具备 | `/api/model-config/test` 扩展 baseUrl 即可 |
| 本地代理协议转换 | ❌ 不需要 | 本项目是 Spring Boot 后端，直接 HTTP 调用即可，无需代理 |
| 多 Provider 列表管理 | ❌ 本期不做 | 先做单个自定义 provider，后续可演进为列表 |

---

## 3. 当前架构分析（现状）

### 3.1 后端 AI 调用链路

```
AiService (全部 AI 功能：摘要/标签/分类/周报)
  └── LlmProvider (接口)
        └── RoutingLlmProvider (按 ModelConfig.activeProvider 路由，失败自动降级)
              ├── DashScopeLlmProvider (dashscope-sdk-java 原生 SDK 直连阿里云)
              └── DeepSeekLlmProvider (RestTemplate，BASE_URL 硬编码)
```

### 3.2 现状问题

| 位置 | 现状 | 问题 |
|---|---|---|
| [DeepSeekLlmProvider.java](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/core/DeepSeekLlmProvider.java#L54-L58) | `BASE_URL` 为 `private static final` 常量 `https://api.deepseek.com` | 无法接入中转站 |
| [DashScopeLlmProvider.java](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/core/DashScopeLlmProvider.java) | DashScope SDK `Generation` 直连，endpoint 由 SDK 内置 | endpoint 不可配（SDK 构造器 `Generation(apiKey, baseUrl)` 可支持但未使用） |
| [ModelConfig.java](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/core/ModelConfig.java) | 仅 activeProvider / apiKey / model 字段 | **无 baseUrl 字段** |
| [ModelConfigController.java](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/controller/ModelConfigController.java#L97-L127) | `/api/model-config/test` 中 DeepSeek 地址写死 | 测试连接不覆盖中转站 |
| [settings.html](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/settings.html#L576-L626) | 仅 provider 下拉 + API Key + 模型名 | **无 API 地址 / 预设选择 UI** |
| [settings.js](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/settings.js) | `loadConfig`/`saveConfig`/`testDeepseek` 均无 baseUrl | 前端不透传 baseUrl |
| [AppConfigService.java](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/AppConfigService.java#L213-L227) | `syncToModelConfig` 仅同步 apiKey/model | 未同步 baseUrl |
| [electron/config.html](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/electron/config.html) | 首次配置页仅 provider + key + 模型 | 无 base-url |

### 3.3 关键已有资产（可复用）

- `LlmProvider` 接口与 `RoutingLlmProvider` 降级机制（无需改动）
- `DeepSeekLlmProvider` 的 RestTemplate OpenAI 兼容调用逻辑（可直接泛化复用）
- `ModelConfigService` JSON 持久化（`model-config.json`）
- `ModelConfigController` 的测试接口（扩展 baseUrl 即可）
- DashScope SDK 构造器 `Generation(String apiKey, String baseUrl)` 支持自定义地址（如需保留原生调用）

---

## 4. 设计方案

### 4.1 总体思路

**把 DeepSeek 的 RestTemplate 调用逻辑泛化为一个通用 `OpenAiCompatibleLlmProvider`**，DashScope、DeepSeek、自定义中转站三个"供应商"都是它的不同配置实例。`RoutingLlmProvider` 保持不变，只是多路由一个 `custom` 分支。

```
AiService
  └── LlmProvider
        └── RoutingLlmProvider (activeProvider: dashscope | deepseek | custom)
              ├── dashscope 实例 → OpenAiCompatibleLlmProvider(baseUrl=兼容模式地址, ...)
              ├── deepseek  实例 → OpenAiCompatibleLlmProvider(baseUrl=api.deepseek.com, ...)
              └── custom    实例 → OpenAiCompatibleLlmProvider(baseUrl=用户配置的中转站, ...)
```

### 4.2 数据模型扩展

**ModelConfig.java**（新增字段，保留旧字段向后兼容）：

```java
public class ModelConfig {
    private String activeProvider = "dashscope";   // "dashscope" | "deepseek" | "custom"
    private String deepseekApiKey = "";
    private String deepseekModel = "deepseek-chat";
    private String dashscopeApiKey = "";
    private String dashscopeModel = "qwen-plus";

    // ===== 新增：自定义 OpenAI 兼容 Provider（中转站） =====
    private String customProviderName = "自定义中转站";  // 展示名称
    private String customBaseUrl = "";                  // 如 https://one-api.example.com/v1
    private String customApiKey = "";
    private String customModel = "";
}
```

**AppConfig.java**：同步新增上述 4 个 custom 字段，并在 `AppConfigService.syncToModelConfig()` 中一并同步。

### 4.3 后端改动

#### 4.3.1 新增 `OpenAiCompatibleLlmProvider`（核心）

复用 DeepSeek 现有 RestTemplate 调用逻辑，把 `BASE_URL` 常量改为实例字段：

```java
@Component
public class OpenAiCompatibleLlmProvider implements LlmProvider {
    private final RestTemplate restTemplate;
    private final ModelConfigService modelConfigService;
    private final DashScopeConfig dashScopeConfig;   // yml 默认兜底

    // 三个预设 endpoint（可被用户配置覆盖）
    public static final String DASHSCOPE_COMPAT_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1";
    public static final String DEEPSEEK_BASE = "https://api.deepseek.com/v1";

    private String providerName;   // dashscope / deepseek / custom
    private String baseUrl;        // 运行时由配置决定

    public String chat(String systemPrompt, String userMessage) {
        // 通用 OpenAI Chat Completions 调用（复用现有 DeepSeek 逻辑）
        // POST {baseUrl}/chat/completions
        // Authorization: Bearer {apiKey}
        // model: {model}
    }
}
```

要点：
- `providerName` 字段区分三个实例（`dashscope` / `deepseek` / `custom`）
- `baseUrl` / `apiKey` / `model` 每次调用时从 `ModelConfig` 读取（优先）或 yml 兜底
- `getProviderName()` 返回实例名；`isAvailable()` 判断 apiKey 非空
- 默认 base-url 规则：dashscope → 兼容模式地址；deepseek → `https://api.deepseek.com/v1`；custom → 用户填的值

#### 4.3.2 改造 `RoutingLlmProvider`

- 新增 `custom` 分支，按 `activeProvider` 路由到对应的 `OpenAiCompatibleLlmProvider` 实例
- 降级顺序建议：`custom` → `deepseek` → `dashscope`（或按用户期望，实现时确认）

#### 4.3.3 改造 `DashScopeLlmProvider`

- 方案 A（推荐，契合"统一协议"决策）：直接复用 `OpenAiCompatibleLlmProvider`，DashScope 走官方**兼容模式**地址 `https://dashscope.aliyuncs.com/compatible-mode/v1`，删除 SDK 依赖调用
- 方案 B（保守）：保留 SDK 直连作为兜底，仅新增 custom provider 走兼容协议
- 实施时建议 A，若 DashScope 兼容模式存在功能差异再回退 B

#### 4.3.4 测试接口扩展

`ModelConfigController` 的 `POST /api/model-config/test`：
- 请求体增加 `baseUrl` 字段
- 所有 provider 统一走 OpenAI 兼容测试逻辑（POST `{baseUrl}/chat/completions` 最小请求）

#### 4.3.5 新增预设模板接口

`GET /api/model-config/presets` 返回内置预设列表，供前端下拉填充：

```json
[
  { "id": "dashscope", "name": "阿里云 DashScope", "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1", "defaultModel": "qwen-plus" },
  { "id": "deepseek", "name": "DeepSeek", "baseUrl": "https://api.deepseek.com/v1", "defaultModel": "deepseek-chat" },
  { "id": "openrouter", "name": "OpenRouter", "baseUrl": "https://openrouter.ai/api/v1", "defaultModel": "" },
  { "id": "siliconflow", "name": "硅基流动", "baseUrl": "https://api.siliconflow.cn/v1", "defaultModel": "" },
  { "id": "glm", "name": "智谱 GLM", "baseUrl": "https://open.bigmodel.cn/api/paas/v4", "defaultModel": "glm-4-flash" },
  { "id": "moonshot", "name": "月之暗面 Kimi", "baseUrl": "https://api.moonshot.cn/v1", "defaultModel": "moonshot-v1-8k" },
  { "id": "ollama", "name": "Ollama 本地", "baseUrl": "http://localhost:11434/v1", "defaultModel": "llama3" },
  { "id": "custom", "name": "自定义中转站 (one-api / new-api)", "baseUrl": "", "defaultModel": "" }
]
```

### 4.4 前端改动

#### 4.4.1 settings.html（Web 设置页）

在现有「AI 模型配置」区块（L576-L626）基础上扩展：
- provider 下拉增加选项：`<option value="custom">自定义 OpenAI 兼容（中转站）</option>`
- 新增「预设模板」下拉（选项来自 `/api/model-config/presets`），选中自动填充 base-url / 默认模型
- 新增「API 地址」输入框（`customBaseUrl`），placeholder 如 `https://one-api.example.com/v1`
- 新增 custom 区块：展示名称 + API 地址 + API Key + 模型名 + 「测试连接」
- `onProviderChange()` 同步高亮 custom 区块

#### 4.4.2 settings.js

- `loadConfig()`：回填 `customProviderName` / `customBaseUrl` / `customApiKey` / `customModel`
- `saveConfig()`：payload 增加上述 4 字段
- `testCustom()`：POST `{provider:'custom', baseUrl, apiKey, model}`
- `loadPresets()`：拉取预设填充下拉

#### 4.4.3 Electron 配置页

- `electron/config.html` + `electron/main.js`：同样增加 base-url 输入与 custom provider 切换
- `generateApplicationYml()` 或 config 同步逻辑需透传新字段（实施时按现有 config.json 流程扩展）

### 4.5 兼容与迁移

- **旧配置兼容**：已存在的 `model-config.json` / `app-config.json` 无 baseUrl 字段 → 读取时缺省为官方地址，不破坏现有启动
- **application.yml 兜底**：保留 `spring.ai.dashscope.api-key` 等作为默认值来源，行为不变
- **协议统一风险**：DashScope 原生 SDK 与兼容模式若输出格式有差异，以 `AiService` 各方法的单元/集成测试兜底验证

---

## 5. 实现步骤

| 步骤 | 内容 | 涉及文件 |
|---|---|---|
| 1 | 扩展 `ModelConfig` 增加 custom 4 字段 | `ModelConfig.java` |
| 2 | 新建通用 `OpenAiCompatibleLlmProvider`（迁移 DeepSeek 的 RestTemplate 逻辑 + baseUrl 参数化） | `OpenAiCompatibleLlmProvider.java` |
| 3 | 改造 `RoutingLlmProvider` 增加 custom 分支与降级 | `RoutingLlmProvider.java` |
| 4 | 决定 DashScope 走兼容模式（方案 A）或保留 SDK（方案 B） | `DashScopeLlmProvider.java` / `DashScopeConfig.java` |
| 5 | 扩展 `AppConfig` + `AppConfigService.syncToModelConfig` | `AppConfig.java` / `AppConfigService.java` |
| 6 | 扩展测试接口支持 baseUrl + 新增 presets 接口 | `ModelConfigController.java` |
| 7 | 前端设置页 UI 扩展（预设下拉 + API 地址输入） | `settings.html` / `settings.js` |
| 8 | Electron 配置页同步扩展 | `electron/config.html` / `electron/main.js` |
| 9 | 全量回归验证（见 §6） | — |

---

## 6. 验证方式

1. **Ollama 本地验证**（无需 API Key，最易验证）：
   - 设置 custom provider，base-url = `http://localhost:11434/v1`，api-key 任意非空，model = 本地已拉取模型
   - 测试连接通过 → 说明中转站接入链路打通
2. **真实中转站验证**：填入某 one-api / new-api 中转站地址 + key + 模型，测试连接 + 实际 AI 分析
3. **预设模板验证**：选择「硅基流动 / GLM」等预设，确认 base-url 自动填充、测试通过
4. **回归 DashScope**：activeProvider=dashscope，确认原有 AI 摘要/标签/分类/周报正常
5. **回归 DeepSeek**：activeProvider=deepseek，确认原有逻辑正常
6. **降级验证**：把 custom 地址填错，确认 `RoutingLlmProvider` 自动回退到 deepseek/dashscope
7. **配置持久化**：保存后查看 `model-config.json` / `app-config.json` 含 custom 字段；重启后端配置不丢
8. **Electron 桌面端**：首次配置页配置中转站 → 启动后端 → 正常调用

---

## 7. 风险与注意事项

- **API Key 泄露**：`application.yml` 当前已存在真实的 DashScope Key 与 SMTP 授权码（建议尽快轮换，与本次改造无关但需留意）
- **base-url 校验**：后端应对自定义 base-url 做基本校验（http/https、去除尾部 `/`），避免注入异常地址
- **超时设置**：中转站可能较慢，`RestTemplate` 需配置合理 connect/read timeout
- **DashScope 兼容模式差异**：如 qwen3.7-max 等模型在兼容模式下的参数（如 `enable_thinking`）可能与原生 SDK 不同，实施时用实际用例验证

---

## 8. 参考

- ccswitch 仓库：https://github.com/farion1231/ccswitch
- OpenAI Chat Completions 规范：https://platform.openai.com/docs/api-reference/chat
- DashScope OpenAI 兼容模式：https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope
- 本计划基于现有文件探索：
  - `backend/src/main/java/com/example/clip/core/{LlmProvider,RoutingLlmProvider,DashScopeLlmProvider,DeepSeekLlmProvider,ModelConfig,DashScopeConfig}.java`
  - `backend/src/main/java/com/example/clip/{service/ModelConfigService,service/AppConfigService,controller/ModelConfigController}.java`
  - `frontend/settings.html` / `frontend/js/settings.js`
  - `electron/config.html` / `electron/main.js`
