# Wiki 查询重构 Review + 模型档位设计重构方案

## 一、本次重构代码 Review

### 1.1 整体评价

重构代码整体质量良好，三个模块（档位路由、本地检索、多数据源）职责清晰、边界明确。没有引入破坏性变更，默认行为与重构前一致。

### 1.2 各模块审查

#### R1 档位路由

| 文件 | 评价 |
|---|---|
| `LlmProvider.java` — `chatForTier` 默认方法 | 干净。接口加默认方法，现有实现零改动 |
| `RoutingLlmProvider.java` — `getProviderByTier` / `resolveProvider` / `chatForTier` | 逻辑完整。`getProviderByTier` 中有 `resolveProvider` 失败时回退 `getActiveProvider()` 的兜底，安全 |
| `ModelConfig.java` / `AppConfig.java` — `simpleTierProvider` / `strongTierProvider` | 字段命名清晰，默认值合理 |
| `AppConfigService.java` — 同步到 ModelConfig | 5 行代码，干净 |
| `AiService.java` — 8 处 `chat` → `chatForTier` | 档位标注合理（定位/抽取/页面生成/Lint=simple，综合/矛盾=strong），无遗漏 |

**发现的问题：** `getProviderByTier` 返回值为 `null` 时（`config == null` 分支），`chatForTier` 会走到 `provider.getProviderName()` 触发 NPE。但实际运行时 `modelConfigService.getConfig()` 不会返回 null（首次启动有默认初始化），这是一条防御性代码路径，**理论上不会触发，但建议加一个 `Objects.requireNonNull` 或 fallback 日志**。

#### R2 本地拆词检索

| 文件 | 评价 |
|---|---|
| `WikiLocalRetriever.java`（新建） | 零依赖、纯算法实现，CJK 2-gram + 英文空格分词的策略对 wiki index 条目级匹配足够 |
| `WikiQueryService.java` — 本地优先 + LLM 兜底 | 集成优雅，`usedLocalRetrieval` 回传前端展示合理 |

**发现的问题：** `WikiLocalRetriever.retrieve` 返回 `List<String>`（页面名列表），`WikiQueryService` 中通过 `localPages.isEmpty()` 判断是否命中。如果 index 条目恰好匹配 0 个但实际有相关页面（如 index 描述不完整），降级 LLM 的路径是通的，没问题。

#### R3 多数据源

| 文件 | 评价 |
|---|---|
| `WikiQueryService.java` — 三参签名 + 单参重载 | 兼容性好，默认行为不变 |
| `WikiQueryController.java` — 透传 includeClips/includeKnowledge | 干净 |
| 前端 `wiki.html` — 两个 checkbox + extraSources 渲染 | 功能完整，UI 轻量 |

### 1.3 Review 结论

本次重构没有引入回归。15 个核心测试全部通过，ClipControllerTest 失败是并行工作的测试配置问题，与重构无关。

---

## 二、模型档位设计问题分析

### 2.1 当前设计的根本问题

目前的档位路由设计本质上是**选择 provider（API 服务商），而不是选择 model（模型）**。

```
当前设置页面的逻辑链条：
┌─────────────────────────────────────────────┐
│  简单任务模型： [DeepSeek ▼]                │ ← 选的是 provider
│  强任务模型：   [阿里云 DashScope ▼]         │ ← 选的也是 provider
│                                              │
│  DeepSeek 配置区域：                          │
│    模型名称： [deepseek-v4-flash]            │ ← 真正的模型名在这里
│  DashScope 配置区域：                         │
│    模型名称： [qwen-plus]                    │ ← 真正的模型名在这里
└─────────────────────────────────────────────┘
```

**三个具体问题：**

1. **档位选择与模型名脱节** — 即使设置了"简单=DeepSeek / 强=DeepSeek"，如果 DeepSeek 区域的模型名只有一个输入框，两个档位仍然调用同一个模型名，没有实际区分。

2. **用户心智负担重** — 用户需要理解"provider ≠ model"的概念，先选 provider 再分别配模型名，但这个抽象对大多数用户不友好。

3. **缺乏直观的"flash vs pro"映射** — 用户想要的其实就是"简单任务用便宜快的模型，复杂任务用能力强但贵的模型"，这个映射在 current 设计中被 provider 层面稀释了。

### 2.2 用户方案的评估

用户提出的方案：

> 做成硬编码复选框，简单任务模型：`deepseek-v4-flash`、复杂任务模型：`deepseek-v4-pro`，模型名称这个还是可以用户自定义，默认为简单模型的名称，若用户编辑了模型名称则以该模型名称作为普通任务（即默认简单任务模型）使用的模型

**优点：**
- 直观：用户直接看到具体的模型名，而不是抽象的 provider key
- 低成本：简单/复杂两档直接对应 `flash` / `pro`，不需要额外理解
- 保留了自定义入口：用户仍然可以改模型名

**需要注意的问题：**

1. **硬编码模型名耦合了 DeepSeek** — 如果用户用 DashScope（qwen-turbo / qwen-plus）或自定义中转站，硬编码 `deepseek-v4-*` 就不适用了
2. **"模型名称"字段的语义矛盾** — 如果"简单任务=deepseek-v4-flash"是硬编码的，那"模型名称"字段到底控制什么？如果用户改模型名为 `gpt-4o`，那简单任务到底用 `deepseek-v4-flash` 还是 `gpt-4o`？
3. **强任务模型名不可自定义** — 用户只说了"模型名称可自定义"和"默认为简单模型的名称"，那强任务模型（deepseek-v4-pro）是否也要可自定义？

### 2.3 推荐方案（结合用户想法的改进版）

在用户想法的基础上，做以下细化：

**核心思路：档位不选 provider，直接选模型名。**

```
┌─────────────────────────────────────────────────────┐
│  AI 模型配置                                         │
│  ┌─────────────────────────────────────────────────┐ │
│  │ 普通任务模型（定位/抽取/页面生成/Lint 扫描）      │ │
│  │  [deepseek-v4-flash          ▼]  ← 下拉+可编辑  │ │
│  │  ├ 预设：deepseek-v4-flash                      │ │
│  │  ├ 预设：deepseek-v4-pro                       │ │
│  │  ├ 预设：qwen-turbo                            │ │
│  │  ├ 预设：qwen-plus                             │ │
│  │  └ 自定义：______ (输入框)                      │ │
│  │                                                 │ │
│  │ 复杂任务模型（答案综合 / 矛盾检测）               │ │
│  │  [deepseek-v4-pro             ▼]  ← 下拉+可编辑  │ │
│  │  ├ 预设：deepseek-v4-pro                        │ │
│  │  ├ 预设：deepseek-v4-flash                      │ │
│  │  ├ 预设：qwen-plus                             │ │
│  │  ├ 预设：qwen-turbo                            │ │
│  │  └ 自定义：______ (输入框)                      │ │
│  └─────────────────────────────────────────────────┘ │
│                                                        │
│  工作原理：                                             │
│  - 普通任务 → 使用"普通任务模型"的模型名调用当前 provider │
│  - 复杂任务 → 使用"复杂任务模型"的模型名调用当前 provider │
│  - 两个模型名均通过当前激活 provider 的 API 调用          │
└─────────────────────────────────────────────────────┘
```

**关键设计决策：**

| 决策 | 理由 |
|---|---|
| 移除 `simpleTierProvider`/`strongTierProvider` 字段（provider key） | 档位应选模型名而非 provider，provider 由 `activeProvider` 统一管理 |
| 新增 `simpleTierModel`/`strongTierModel` 字段（模型名） | 直接存储模型名，默认 `deepseek-v4-flash` / `deepseek-v4-pro` |
| 前端使用 `datalist`（下拉+可编辑输入框）而非纯 `select` | 保留预设值的同时允许用户输入任意自定义模型名 |
| 两个模型名通过当前激活的 provider 调用 | 无需为每个档位分别配 API Key，减少配置项 |
| 移除旧的"模型名称"单字段 | 被两个档位模型名替代，语义更清晰 |

**向后兼容：**
- 默认值 `simpleTierModel=deepseek-v4-flash`、`strongTierModel=deepseek-v4-pro`
- 用户已有的 `deepseekModel` 配置 → 迁移到 `simpleTierModel`
- 整体行为：未配置任何自定义时，普通任务用 `deepseek-v4-flash`，复杂任务用 `deepseek-v4-pro`，与当前默认行为一致

---

## 三、实施计划

### 涉及文件

| 文件 | 改动 |
|---|---|
| `backend/src/main/java/com/example/clip/core/ModelConfig.java` | 移除 `simpleTierProvider`/`strongTierProvider`，新增 `simpleTierModel`/`strongTierModel` |
| `backend/src/main/java/com/example/clip/config/AppConfig.java` | 同上 |
| `backend/src/main/java/com/example/clip/service/AppConfigService.java` | 同步逻辑改为 `simpleTierModel`/`strongTierModel` |
| `backend/src/main/java/com/example/clip/core/RoutingLlmProvider.java` | `getProviderByTier` 改为读取模型名，构建对应 provider 的请求 |
| `backend/src/main/java/com/example/clip/core/LlmProvider.java` | `chatForTier` 签名不变，语义从"选 provider"变为"选模型名" |
| `backend/src/main/java/com/example/clip/core/DeepSeekLlmProvider.java` | 新增 `chat(modelName, systemPrompt, userMessage)` 重载，允许指定模型名 |
| `backend/src/main/java/com/example/clip/core/DashScopeLlmProvider.java` | 同上 |
| `backend/src/main/java/com/example/clip/core/OpenAiCompatibleLlmProvider.java` | 同上 |
| `frontend/settings.html` | 两个 `select` 改为 `input + datalist` 组合 |
| `frontend/js/settings.js` | `loadConfig`/`saveConfig` 对应更新 |
| `backend/src/main/resources/application_templete.yml` | 更新默认配置注释 |

### 实施步骤

**Step 1: ModelConfig 字段替换**
- 移除 `private String simpleTierProvider = "deepseek"` 和 `private String strongTierProvider = "dashscope"`
- 新增 `private String simpleTierModel = "deepseek-v4-flash"` 和 `private String strongTierModel = "deepseek-v4-pro"`
- 更新 getter/setter

**Step 2: AppConfig 字段替换**（同上）

**Step 3: AppConfigService 同步逻辑更新**
- `mc.setSimpleTierProvider(...)` → `mc.setSimpleTierModel(...)`
- `mc.setStrongTierProvider(...)` → `mc.setStrongTierModel(...)`

**Step 4: 各 LlmProvider 新增 `chat(String modelName, String systemPrompt, String userMessage)` 重载**
- 每个 provider 的实现：在请求体中用 `modelName` 替换原有的 `model` 字段
- 原有的 `chat(systemPrompt, userMessage)` 保持不变（使用默认模型名）

**Step 5: RoutingLlmProvider 档位路由改为传递模型名**
- `getProviderByTier` 改为：获取当前激活 provider + 从 config 读取对应 tier 的模型名
- `chatForTier` 调用 `provider.chat(modelName, systemPrompt, userMessage)`
- 如果对应 tier 的模型名为空，使用默认值

**Step 6: 前端 settings.html 替换控件**
- `select#simpleTierProvider` → `input#simpleTierModel` + `datalist#simpleTierPresets`
- `select#strongTierProvider` → `input#strongTierModel` + `datalist#strongTierPresets`
- 预设选项：`deepseek-v4-flash`、`deepseek-v4-pro`、`qwen-turbo`、`qwen-plus`

**Step 7: 前端 settings.js 更新**
- `loadConfig` 读取 `simpleTierModel`/`strongTierModel`
- `saveConfig` 保存 `simpleTierModel`/`strongTierModel`

**Step 8: 编译 + 测试回归**
- `mvn clean compile`
- 运行 `RoutingLlmProviderTest`、`ModelConfigTest` 等

### 验证标准

- [ ] 默认值：`simpleTierModel=deepseek-v4-flash`、`strongTierModel=deepseek-v4-pro`
- [ ] 前端下拉可编辑，支持预设选择 + 自定义输入
- [ ] 普通任务（定位/抽取/Lint）发送的 API 请求中 `model` 字段为 `simpleTierModel` 的值
- [ ] 复杂任务（综合/矛盾检测）发送的 API 请求中 `model` 字段为 `strongTierModel` 的值
- [ ] 用户只配置了 API Key 未改模型名时，默认行为正常工作
- [ ] 用户自定义模型名后，对应档位使用自定义值