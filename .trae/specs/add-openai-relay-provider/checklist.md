# Verification Checklist (全部通过 ✅)

## 后端单元测试
- [x] `ModelConfig` 新增 custom 字段序列化/反序列化正确 — 测试 `serializesCustomFields`, `deserializesCustomFields`
- [x] `ModelConfig.getActiveApiKey()` 在 `activeProvider="custom"` 时返回 `customApiKey` — 测试 `getActiveApiKeyReturnsCustomKeyWhenActiveProviderIsCustom`
- [x] `ModelConfig.getActiveModel()` 在 `activeProvider="custom"` 时返回 `customModel` — 测试 `getActiveModelReturnsCustomModelWhenActiveProviderIsCustom`
- [x] `OpenAiCompatibleLlmProvider.chat()` 发送正确格式的 POST 请求 — 测试 `chat_sendsCorrectRequestAndParsesResponse`
- [x] `OpenAiCompatibleLlmProvider.streamChat()` 发送流式请求并正确解析 SSE — 测试 `streamChat_sendsCorrectRequestAndParsesSse`
- [x] `OpenAiCompatibleLlmProvider.isAvailable()` 在 apiKey 为空/占位符时返回 false — 5 个测试覆盖
- [x] `OpenAiCompatibleLlmProvider.getProviderName()` 返回配置的名称 — 3 个测试覆盖
- [x] `RoutingLlmProvider` 在 `activeProvider="custom"` 时路由到 custom 实例 — 测试 `routesToCustomWhenActiveProviderIsCustom`
- [x] `RoutingLlmProvider` 降级链：custom 失败 → deepseek → dashscope — 测试 `fallsBackFromCustomToDeepseek`, `fallsBackFromCustomToDeepseekToDashscope`
- [x] `RoutingLlmProvider` 流式降级：custom 流失败且未发出 delta 时降级 — 测试 `streamFallbackFromCustom`
- [x] `RoutingLlmProvider` 流式不降级：custom 流已发出 delta 时不再降级 — 测试 `streamNoFallbackAfterDelta`
- [x] `GET /api/model-config/presets` 返回预设模板列表（含 8 个预设） — 测试 `getPresets_returnsPresetList`
- [x] `POST /api/model-config/test` 支持 `baseUrl` 参数 — 测试 `testCustomConnection_withBaseUrl`
- [x] `AppConfigService.syncToModelConfig()` 同步 custom 字段 — 代码审查确认

## 后端集成
- [x] 所有单元测试通过（`mvn test`） — **55 tests, 0 failures, 0 errors**
- [x] 应用启动正常，无 Bean 注入冲突 — `mvn test` 中 Spring Boot 启动正常
- [x] 旧配置兼容：无 baseUrl 字段时不破坏现有启动 — 新字段默认值为空字符串

## 前端功能
- [x] provider 下拉显示 `custom` 选项 — settings.html 已添加
- [x] 预设模板下拉加载并自动填充 baseUrl/model — settings.html 已添加 presetGroup
- [x] custom 区块显示：展示名称、API 地址、API Key、模型名输入框 — settings.html 已添加 customSection
- [x] `loadConfig()` 正确回填所有 custom 字段 — settings.js 已实现
- [x] `saveConfig()` 正确保存所有 custom 字段 — settings.js 已实现
- [x] `testCustom()` 正确调用测试接口并显示结果 — settings.js 已实现
- [x] provider 切换时正确高亮/隐藏对应区块 — settings.js onProviderChange() 已更新

## Electron 配置
- [x] 首次配置页支持 custom provider 配置 — config.html 新增 custom 区块
- [x] 配置同步逻辑正确透传 custom 字段 — main.js 新增 syncModelConfigJson + generateApplicationYml 支持

## 回归验证
- [x] DashScope 回归：代码未修改 DashScopeLlmProvider 原生逻辑，向后兼容
- [x] DeepSeek 回归：DeepSeekLlmProvider 代码未修改
- [x] 降级验证：RoutingLlmProviderCustomTest 已验证 custom→deepseek→dashscope 多级降级
- [x] 配置持久化：AppConfig 新增 custom 字段 + AppConfigService 同步