# Tasks

- [ ] Task 1: 扩展 ModelConfig 新增 custom 字段
  - [ ] 1.1 新增 `customProviderName`、`customBaseUrl`、`customApiKey`、`customModel` 字段 + getter/setter
  - [ ] 1.2 扩展 `getActiveApiKey()` 和 `getActiveModel()` 支持 `custom` 分支
  - [ ] 1.3 编写 `ModelConfigTest.java` 验证序列化/反序列化
  - 依赖: 无

- [ ] Task 2: 新建 OpenAiCompatibleLlmProvider（核心）
  - [ ] 2.1 编写测试 `OpenAiCompatibleLlmProviderTest.java`（Mock RestTemplate，验证 chat/streamChat/isAvailable/getProviderName）
  - [ ] 2.2 实现 `OpenAiCompatibleLlmProvider` — 从 DeepSeekLlmProvider 提取 RestTemplate 逻辑，baseUrl/apiKey/model 改为实例字段
  - [ ] 2.3 验证测试通过（`mvn test -Dtest=OpenAiCompatibleLlmProviderTest`）
  - 依赖: Task 1

- [ ] Task 3: 改造 RoutingLlmProvider 支持 custom 分支
  - [ ] 3.1 编写测试 `RoutingLlmProviderCustomTest.java`（路由到 custom、降级链 custom→deepseek→dashscope、流式降级）
  - [ ] 3.2 修改 `RoutingLlmProvider` — 注入 `OpenAiCompatibleLlmProvider` custom 实例，新增 custom 路由逻辑，扩展降级链
  - [ ] 3.3 修改 `LlmProviderConfig` — 注册三个 `OpenAiCompatibleLlmProvider` 实例（dashscope/deepseek/custom）+ 注入到 RoutingLlmProvider
  - [ ] 3.4 验证测试通过
  - 依赖: Task 2

- [ ] Task 4: 扩展 DashScopeLlmProvider 走兼容模式（方案 A）
  - [ ] 4.1 将 DashScope 也改为使用 `OpenAiCompatibleLlmProvider`（baseUrl = `https://dashscope.aliyuncs.com/compatible-mode/v1`）
  - [ ] 4.2 保留 `DashScopeConfig` 作为 yml 默认值兜底
  - [ ] 4.3 验证现有 DashScope 测试（若有）通过
  - 依赖: Task 2

- [ ] Task 5: 扩展 AppConfig + AppConfigService 同步 custom 字段
  - [ ] 5.1 AppConfig 新增 `customProviderName`、`customBaseUrl`、`customApiKey`、`customModel`
  - [ ] 5.2 `AppConfigService.syncToModelConfig()` 同步 custom 字段
  - [ ] 5.3 `AppConfigService.migrateFromLegacy()` 迁移时保留默认值
  - 依赖: Task 1

- [ ] Task 6: 扩展 ModelConfigController 测试接口 + presets 接口
  - [ ] 6.1 编写测试 `ModelConfigControllerCustomTest.java`（测试 presets 接口、测试 custom provider 连接）
  - [ ] 6.2 实现 `GET /api/model-config/presets` 返回预设模板列表
  - [ ] 6.3 扩展 `POST /api/model-config/test` 支持 `baseUrl` 参数，custom provider 走 RestTemplate 测试
  - [ ] 6.4 验证测试通过
  - 依赖: Task 5

- [ ] Task 7: 前端 settings.html 扩展 custom provider UI
  - [ ] 7.1 provider 下拉新增 `custom` 选项
  - [ ] 7.2 新增预设模板下拉（从 `/api/model-config/presets` 加载）
  - [ ] 7.3 新增 custom 区块：展示名称、API 地址、API Key、模型名输入框
  - [ ] 7.4 `onProviderChange()` 同步高亮 custom 区块
  - 依赖: Task 6

- [ ] Task 8: 前端 settings.js 扩展 custom 逻辑
  - [ ] 8.1 `loadConfig()` 回填 custom 字段
  - [ ] 8.2 `saveConfig()` payload 增加 custom 字段
  - [ ] 8.3 `loadPresets()` 拉取预设填充下拉 + `onPresetChange()` 自动填充 baseUrl/model
  - [ ] 8.4 `testCustom()` 调用测试接口
  - 依赖: Task 7

- [ ] Task 9: Electron 配置页同步扩展
  - [ ] 9.1 修改 `electron/config.html` 增加 base-url 输入与 custom provider 切换
  - [ ] 9.2 修改 `electron/main.js` config 同步逻辑透传 custom 字段
  - 依赖: Task 5

- [ ] Task 10: 全量回归验证
  - [ ] 10.1 运行 `mvn test` 确保所有测试通过
  - [ ] 10.2 手动验证：DashScope 回归（摘要/标签/分类正常）
  - [ ] 10.3 手动验证：DeepSeek 回归
  - [ ] 10.4 手动验证：custom provider（如 Ollama 本地）测试连接 + 实际调用
  - [ ] 10.5 手动验证：降级（custom 地址填错，自动回退 deepseek/dashscope）
  - 依赖: Task 1 ~ Task 9

# Task Dependencies
- Task 2 依赖 Task 1（ModelConfig 需先有 custom 字段定义）
- Task 3 依赖 Task 2（OpenAiCompatibleLlmProvider 需先实现）
- Task 4 依赖 Task 2（修改 DashScope 使用 OpenAiCompatibleLlmProvider）
- Task 5 依赖 Task 1（AppConfig 字段与 ModelConfig 对齐）
- Task 6 依赖 Task 5（测试接口需 AppConfig 同步完成）
- Task 7 依赖 Task 6（presets 接口需先实现）
- Task 8 依赖 Task 7（settings.js 与 settings.html 对应）
- Task 9 依赖 Task 5（Electron 配置同步需 AppConfig 完成）
- Task 10 依赖所有 Task

# 并行执行计划
- 第一波（可并行）: Task 1（独立，先完成）
- 第二波（依赖 Task 1）: Task 2, Task 5（可并行）
- 第三波（依赖 Task 2）: Task 3, Task 4, Task 6（可并行）
- 第四波（依赖 Task 6）: Task 7, Task 9（可并行）
- 第五波（依赖 Task 7）: Task 8
- 第六波: Task 10（全量回归）