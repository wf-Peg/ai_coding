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

**发现的问题：** `getProviderByTier` 返回值为 `null` 时（`config == null` 分支），`chatForTier` 会走到 `provider.getProviderName()` 触发 NPE。但实际运行时 `modelConfigService.getConfig()` 不会返回 null（首次启动有默认初始化），这是一条防御性代码路径，**理论上不会触发，但建议加一个 fallback 逻辑**。

#### R2 本地拆词检索

| 文件 | 评价 |
|---|---|
| `WikiLocalRetriever.java`（新建） | 零依赖、纯算法实现，CJK 2-gram + 英文空格分词的策略对 wiki index 条目级匹配足够 |
| `WikiQueryService.java` — 本地优先 + LLM 兜底 | 集成优雅，`usedLocalRetrieval` 回传前端展示合理 |

#### R3 多数据源

| 文件 | 评价 |
|---|---|
| `WikiQueryService.java` — 三参签名 + 单参重载 | 兼容性好，默认行为不变 |
| `WikiQueryController.java` — 透传 includeClips/includeKnowledge | 干净 |
| 前端 `wiki.html` — 两个 checkbox + extraSources 渲染 | 功能完整，UI 轻量 |

### 1.3 Review 结论

本次重构没有引入回归。15 个核心测试全部通过，ClipControllerTest 失败是并行工作的测试配置问题，与重构无关。

---

## 二、模型档位设计问题分析（重要）

### 2.1 当前设计的根本问题

目前的档位路由设计本质上是**选择 provider（API 服务商），而不是选择 model（模型名）**。

```
当前设置页面的逻辑链条：
┌─────────────────────────────────────────────┐
│  简单任务模型： [DeepSeek ▼]                │ ← 选的是 provider key
│  强任务模型：   [阿里云 DashScope ▼]         │ ← 选的也是 provider key
│                                              │
│  DeepSeek 配置区域：                          │
│    模型名称： [deepseek-v4-flash]            │ ← 真正的模型名在这里
│  DashScope 配置区域：                         │
│    模型名称： [qwen-plus]                    │ ← 真正的模型名在这里
└─────────────────────────────────────────────┘
```

**三个具体问题：**

1. **档位选择与实际模型名脱节** — 即使设置了"简单=DeepSeek / 强=DeepSeek"，如果 DeepSeek 区域的模型名只有一个输入框，两个档位仍然调用同一个模型名，没有实际区分简单和复杂任务。

2. **用户心智负担重** — 用户需要理解"provider ≠ model"的概念，先选 provider 再分别配模型名，但这个抽象层对大多数用户不友好。

3. **缺乏直观的"便宜 vs 强"映射** — 用户想要的其实就是"简单任务用便宜快的模型，复杂任务用能力强但贵的模型"，这个映射在 current 设计中被 provider 层面稀释了。

### 2.2 用户方案分析：硬编码复选框 + 可自定义模型名

用户提出的方案：

> 做成硬编码复选框，简单任务模型：`deepseek-v4-flash`、复杂任务模型：`deepseek-v4-pro`，模型名称这个还是可以用户自定义，默认为简单模型的名称，若用户编辑了模型名称则以该模型名称作为普通任务（即默认简单任务模型）使用的模型

#### 2.2.1 方案解读

我理解用户的方案结构如下：

```
┌──────────────────────────────────────────────────┐
│  ── 任务模型分级 ──                                │
│                                                    │
│  简单任务模型: deepseek-v4-flash  (硬编码默认值)     │
│  复杂任务模型: deepseek-v4-pro   (硬编码默认值)      │
│                                                    │
│  模型名称: [deepseek-v4-flash          ]            │
│  (可自定义文本输入，默认=简单任务模型名)              │
│  * 若编辑了此字段，则覆盖简单任务模型使用的模型名      │
└──────────────────────────────────────────────────┘
```

关键设计点：
- **硬编码复选框**：两个档位的**默认模型名**是硬编码的（`deepseek-v4-flash` / `deepseek-v4-pro`），用户不需要配置，开箱即用
- **模型名称自定义**：一个单独的文本输入框，默认填充简单任务模型的名称
- **覆盖规则**：如果用户编辑了"模型名称"，则那个值成为简单任务（普通任务）使用的模型名
- **复杂任务模型名**：没有单独的自定义入口，始终使用 `deepseek-v4-pro`（或等价的硬编码值）

#### 2.2.2 适合性分析

**适合的理由：**

| 角度 | 分析 |
|---|---|
| **用户心智模型** | 用户只需要记住"简单=flash，复杂=pro"，不需要关心 provider 是什么。这直接映射到实际使用场景 |
| **开箱即用** | 默认值硬编码，用户不需要额外配置就获得分级效果 |
| **自定义逃逸口** | 最可能需要自定义的是"简单任务模型"（因为普通任务使用最频繁），模型名称字段提供了这个能力 |
| **复杂度控制** | 只暴露一个自定义字段，不会让用户面对两个空的模型名输入框不知所措 |
| **与当前设计兼容** | 当前 `deepseek-v4-flash` 已经是默认模型名，`deepseek-v4-pro` 是合理的复杂模型选择 |

**需要注意的问题：**

| 问题 | 影响 | 缓解方案 |
|---|---|---|
| 复杂任务模型名不可自定义 | 如果用户想自定义复杂任务模型名，没有入口 | 可以在模型名称字段旁加一个**切换按钮**（"↑ 展开高级设置"），展开后出现第二个模型名输入框 |
| 硬编码模型名耦合 DeepSeek | 如果用户使用 DashScope（qwen-turbo/qwen-plus）或自定义中转站，硬编码的 `deepseek-v4-*` 不适用 | 但"模型名称"字段就是用来覆盖这个的。用户可以在模型名称字段输入 `qwen-turbo`，复杂任务默认仍用 `deepseek-v4-pro` 会有点奇怪，但复杂任务名不可自定义本身就是设计取舍 |
| 若用户只改模型名后缀但保留了前缀 | 用户可能输入 `gpt-4o` 作为模型名，此时简单任务用的模型名变成 `gpt-4o`，但复杂任务仍是 `deepseek-v4-pro`，跨 provider 混合调用 | 这是合理的——简单任务用自定模型，复杂任务还是 DeepSeek pro。API 层面各自独立，没有冲突 |
| `activeProvider` 字段仍然存在 | 用户还会困惑"我到底选 DeepSeek 还是 DashScope？" | 需要保持 `activeProvider` 字段，但可以在 UI 中弱化（放在高级设置中），让"模型名称"成为主要交互点 |

#### 2.2.3 结论：适合，但建议微调

**用户的方案整体上适合，是比当前设计更好的选择。** 核心原因是：它把"选择模型名"（用户真正关心的）和"选择 provider"（实现细节）分开了，前者作为主要交互，后者作为底层配置。

**建议的微调：**

1. **"模型名称"改为"简单任务模型名"** — 语义更精确，避免用户混淆"模型名称"到底控制什么
2. **复杂任务模型名也改为可编辑输入框**（但默认值硬编码）— 两个输入框对称，用户不编辑就使用默认值，编辑了就用自定义值。这样不会增加理解成本，但提供了完整灵活性
3. **`activeProvider` 移入高级设置折叠区域** — 让 90% 用户不需要看到它

```
┌──────────────────────────────────────────────────┐
│  ── 任务模型分级 ──                                │
│                                                    │
│  简单任务模型名:                                    │
│  [deepseek-v4-flash          ]                     │
│  (默认值，用于定位/抽取/Lint/页面生成)               │
│                                                    │
│  复杂任务模型名:                                    │
│  [deepseek-v4-pro           ]                      │
│  (默认值，用于答案综合/矛盾检测)                     │
│                                                    │
│  ── 高级设置 ──                                    │
│  ▼ 展开                                             │
│  当前 API 服务商: [DeepSeek ▼]                      │
│  API Key / 自定义地址等...                           │
└──────────────────────────────────────────────────┘
```

### 2.3 与当前实现的对比

| 维度 | 当前实现（重构后） | 用户方案（微调后） |
|---|---|---|
| 配置字段 | `simpleTierProvider` + `strongTierProvider`（provider key） | `simpleTierModel` + `strongTierModel`（模型名） |
| 默认值 | `deepseek` / `dashscope` | `deepseek-v4-flash` / `deepseek-v4-pro` |
| 自定义方式 | 下拉选 provider | 输入框可编辑（预设 + 自定义） |
| 用户理解成本 | 中（需理解 provider 概念） | 低（直接看到模型名） |
| 灵活度 | 中（provider 层面，但不能区分同 provider 不同模型） | 高（可直接指定任意模型名） |
| 后端改动量 | 小（已有 chatForTier 接口） | 小（只需改字段 + 路由逻辑） |

---

## 三、实施计划（基于用户方案微调版）

### 设计决策

| 决策 | 方案 | 理由 |
|---|---|---|
| 字段命名 | `simpleTierModel` / `strongTierModel` | 语义清晰，存储的是模型名而非 provider key |
| 默认值 | `deepseek-v4-flash` / `deepseek-v4-pro` | 与用户方案一致 |
| 前端控件 | 两个可编辑输入框（`<input>` + `<datalist>` 预设） | 默认值硬编码，但允许用户自由输入自定义模型名 |
| API 调用方式 | 当前 provider（`activeProvider`） + 当前 tier 的模型名 | 模型名与 provider 解耦，模型名只决定 HTTP 请求体中的 `model` 字段 |
| 兼容旧配置 | 用户已有的 `deepseekModel` 配置 → 迁移到 `simpleTierModel` | 平滑升级 |

### 涉及文件

| 文件 | 改动 |
|---|---|
| **后端** | |
| `ModelConfig.java` | 移除 `simpleTierProvider`/`strongTierProvider`，新增 `simpleTierModel`/`strongTierModel` |
| `AppConfig.java` | 同上 |
| `AppConfigService.java` | 同步逻辑改为 `simpleTierModel`/`strongTierModel` |
| `RoutingLlmProvider.java` | `getProviderByTier` 改为：获取当前 active provider + 读取对应 tier 的模型名，构建调用 |
| `LlmProvider.java` | 新增 `chat(String modelName, String systemPrompt, String userMessage)` 重载，允许指定模型名 |
| `DeepSeekLlmProvider.java` | 实现 `chat(modelName, ...)` 重载：请求体中使用 `modelName` 替代原模型名 |
| `DashScopeLlmProvider.java` | 同上 |
| `OpenAiCompatibleLlmProvider.java` | 同上 |
| **前端** | |
| `settings.html` | 两个 `select` 替换为 `input + datalist`；`activeProvider` 移入高级设置 |
| `js/settings.js` | `loadConfig`/`saveConfig` 对应更新 |
| **配置模板** | |
| `application_templete.yml` | 更新默认配置注释 |

### 实施步骤

**Step 1: ModelConfig 字段替换**
- 移除 `simpleTierProvider`、`strongTierProvider` 字段
- 新增 `simpleTierModel = "deepseek-v4-flash"`、`strongTierModel = "deepseek-v4-pro"`
- 更新 getter/setter

**Step 2: AppConfig 字段替换**（同上）

**Step 3: AppConfigService 同步逻辑更新**
- `mc.setSimpleTierProvider(...)` → `mc.setSimpleTierModel(...)`
- `mc.setStrongTierProvider(...)` → `mc.setStrongTierModel(...)`

**Step 4: LlmProvider 接口新增 `chat(modelName, systemPrompt, userMessage)` 重载**
- 默认实现：`chat(modelName, systemPrompt, userMessage) → chat(systemPrompt, userMessage)`（忽略 modelName）
- 各 provider 覆盖此方法，在请求体中使用 `modelName`

**Step 5: DeepSeekLlmProvider 实现 `chatWithModel`**
- 在 `chat` 方法基础上，增加 `model` 参数替换逻辑
- 原有的 `chat(systemPrompt, userMessage)` 保持不变

**Step 6: DashScopeLlmProvider / OpenAiCompatibleLlmProvider 同上**

**Step 7: RoutingLlmProvider 档位路由改为传递模型名**
- `getProviderByTier` 改为：获取当前 active provider + 从 config 读取 tier 对应的模型名
- `chatForTier` 调用 `provider.chat(modelName, systemPrompt, userMessage)`
- 如果模型名为空，使用默认值

**Step 8: 前端 settings.html 替换控件**
- 移除 `select#simpleTierProvider`、`select#strongTierProvider`
- 新增 `input#simpleTierModel` + `datalist#simpleTierPresets`（预设：`deepseek-v4-flash`、`deepseek-v4-pro`、`qwen-turbo`、`qwen-plus`）
- 新增 `input#strongTierModel` + `datalist#strongTierPresets`（同上）
- `activeProvider` 下拉移入"高级设置"折叠区域

**Step 9: 前端 settings.js 更新**
- `loadConfig` 读取 `simpleTierModel`/`strongTierModel`
- `saveConfig` 保存 `simpleTierModel`/`strongTierModel`

**Step 10: 编译 + 测试回归**
- `mvn clean compile`
- 运行 `RoutingLlmProviderTest`、`ModelConfigTest` 等

### 验证标准

- [ ] 默认值：`simpleTierModel=deepseek-v4-flash`、`strongTierModel=deepseek-v4-pro`
- [ ] 前端两个输入框默认填充 `deepseek-v4-flash` 和 `deepseek-v4-pro`
- [ ] 预设下拉提供 `deepseek-v4-flash`、`deepseek-v4-pro`、`qwen-turbo`、`qwen-plus` 等选项
- [ ] 用户可自由输入任意模型名
- [ ] 简单任务（定位/抽取/Lint）发送的 API 请求中 `model` 字段为 `simpleTierModel` 的值
- [ ] 复杂任务（综合/矛盾检测）发送的 API 请求中 `model` 字段为 `strongTierModel` 的值
- [ ] 用户只配置了 API Key 未改模型名时，默认行为正常工作
- [ ] 用户自定义模型名后，对应档位使用自定义值
- [ ] `activeProvider` 移入高级设置后，初级用户不需要关心这项配置