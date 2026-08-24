# 新增 OpenAI 兼容中转站 Provider Spec

## Why

当前后端 AI 服务仅支持 DashScope（原生 SDK）和 DeepSeek（硬编码 URL），用户无法接入其他 OpenAI 兼容 API 服务（如中转站、OpenRouter、硅基流动等）。需要扩展支持的 provider 类型，让用户可配置自定义 `base-url + api-key + model`。

## What Changes

### 后端

1. **新增 `OpenAiCompatibleLlmProvider`** — 将 DeepSeek 的 RestTemplate OpenAI 兼容调用逻辑泛化为通用 provider，支持运行时指定 baseUrl/apiKey/model
2. **改造 `RoutingLlmProvider`** — 新增 `custom` 路由分支，扩展降级链为 `custom → deepseek → dashscope`
3. **扩展 `ModelConfig`** — 新增 `customProviderName`、`customBaseUrl`、`customApiKey`、`customModel` 四个字段
4. **扩展 `AppConfig`** — 同步新增上述 4 个 custom 字段
5. **扩展 `AppConfigService.syncToModelConfig()`** — 同步 custom 字段到 ModelConfig
6. **扩展 `ModelConfigController` 测试接口** — 增加 `baseUrl` 参数，所有 provider 统一走 OpenAI 兼容测试
7. **新增 `GET /api/model-config/presets` 接口** — 返回内置预设模板列表

### 前端

8. **更新 `settings.html`** — provider 下拉新增 `custom` 选项 + 预设模板下拉 + API 地址输入框
9. **更新 `settings.js`** — 新增 `loadPresets()`、`onPresetChange()`、`testCustom()` 方法，`loadConfig`/`saveConfig` 扩展 custom 字段

### Electron

10. **更新 `electron/main.js` 或 `electron/config.html`** — 首次配置页支持 custom provider 配置

## Impact

- Affected specs: AI 模型配置、连接测试、provider 路由
- Affected code:
  - 新增: `OpenAiCompatibleLlmProvider.java`
  - 修改: `ModelConfig.java`, `RoutingLlmProvider.java`, `AppConfig.java`, `AppConfigService.java`, `ModelConfigController.java`, `LlmProviderConfig.java`
  - 修改: `settings.html`, `settings.js`
  - 修改: `electron/config.html`, `electron/main.js`
  - 新增测试: `OpenAiCompatibleLlmProviderTest.java`, `RoutingLlmProviderCustomTest.java`, `ModelConfigControllerCustomTest.java`

## ADDED Requirements

### Requirement: OpenAiCompatibleLlmProvider

The system SHALL provide a new `OpenAiCompatibleLlmProvider` that implements `LlmProvider` interface using OpenAI Chat Completions protocol.

#### Scenario: Basic chat with custom baseUrl
- **WHEN** `chat(systemPrompt, userMessage)` is called with a configured baseUrl, apiKey, and model
- **THEN** it sends POST `{baseUrl}/chat/completions` with Bearer auth and returns the model's response

#### Scenario: Stream chat with SSE
- **WHEN** `streamChat(messages, listener)` is called
- **THEN** it sends POST `{baseUrl}/chat/completions` with `stream: true` and parses SSE responses via `OpenAiSseParser`

#### Scenario: isAvailable checks apiKey
- **WHEN** `isAvailable()` is called
- **THEN** it returns `true` only if the provider's apiKey is non-blank and not a placeholder

#### Scenario: getProviderName returns instance name
- **WHEN** `getProviderName()` is called
- **THEN** it returns the configured provider name (e.g., "dashscope", "deepseek", "custom")

### Requirement: RoutingLlmProvider custom branch

The system SHALL support routing to a `custom` provider.

#### Scenario: Route to custom when activeProvider is "custom"
- **WHEN** `activeProvider = "custom"` and custom apiKey is configured
- **THEN** `getActiveProvider()` returns the custom instance

#### Scenario: Fallback from custom to deepseek to dashscope
- **WHEN** custom provider fails (throws exception) and deepseek is available
- **THEN** `chat()` falls back to deepseek provider
- **WHEN** deepseek also fails and dashscope is available
- **THEN** `chat()` falls back to dashscope provider
- **WHEN** all providers fail
- **THEN** `chat()` throws a combined exception

### Requirement: ModelConfig extended fields

The system SHALL support custom provider configuration fields.

#### Scenario: Custom fields serialization
- **WHEN** ModelConfig is serialized to JSON with custom fields set
- **THEN** the JSON contains `customProviderName`, `customBaseUrl`, `customApiKey`, `customModel`

### Requirement: Presets API endpoint

The system SHALL provide a list of built-in presets for OpenAI-compatible services.

#### Scenario: GET /api/model-config/presets
- **WHEN** a GET request is made to `/api/model-config/presets`
- **THEN** it returns a JSON array of preset objects with `id`, `name`, `baseUrl`, `defaultModel`

### Requirement: Test connection with baseUrl

The system SHALL support testing connection with a custom baseUrl.

#### Scenario: Test custom provider connection
- **WHEN** POST `/api/model-config/test` with `{ provider: "custom", baseUrl: "...", apiKey: "...", model: "..." }`
- **THEN** it sends a test message to the specified baseUrl and returns success/failure

## MODIFIED Requirements

### Requirement: ModelConfig save/load

The model config service SHALL preserve the new `custom*` fields through save/load cycles.

### Requirement: AppConfigService sync

`AppConfigService.syncToModelConfig()` SHALL also sync `customProviderName`, `customBaseUrl`, `customApiKey`, `customModel` fields.

## REMOVED Requirements

None.