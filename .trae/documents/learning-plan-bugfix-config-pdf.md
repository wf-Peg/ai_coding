# 学习计划模块 Bug 修复 — API Key 缓存 + PDF 导出乱码

## 一、问题摘要

| # | 问题 | 根因 | 影响 |
|---|------|------|------|
| 1 | 新建学习计划提示"apikey额度用完"，设置页重新保存后恢复正常 | `AppConfigService.loadConfig()` 启动时不调用 `syncToModelConfig()`，导致 `ModelConfigService` 缓存的 API Key 与 `app-config.json` 不一致 | 首次启动后 AI 调用失败，需手动保存设置才能修复 |
| 2 | Exa 搜索在 Electron 模式下始终不可用 | `main.js` 的 `generateApplicationYml()` 不生成 `exa` 配置段，`ExaSearchService` 的 `@Value("${exa.api-key:}")` 读到空字符串 | 学习资源降级为 AI 生成，无法使用 Exa 真实搜索 |
| 3 | 导出 PDF 中文乱码 | `exportPdf()` 使用 `window.open` + `document.write(html)`，在 Electron 中不保证 UTF-8 编码 | 导出的 PDF 中文全部乱码 |

## 二、根因深度分析

### 2.1 问题 1：API Key 启动缓存不一致

**配置加载链路（启动时）：**

```
Spring 启动
  → AppConfigService.@PostConstruct init()
    → loadConfig()
      → 读取 ~/.clip-demo/config/app-config.json（含正确 API Key）
      → cachedConfig = config  ✅ AppConfigService 缓存正确
      → ❌ 没有调用 syncToModelConfig()！

  → LearningPlanService.createPlan()
    → llmProvider.chat()
      → RoutingLlmProvider.getActiveProvider()
        → modelConfigService.getConfig()
          → cachedConfig == null → loadConfig()
            → 读取 clip-storage/model-config.json（可能含旧 Key 或空）
          → 返回旧配置  ❌
```

**保存设置后的链路（正常）：**

```
PUT /api/config → AppConfigService.saveConfig()
  → 写 app-config.json ✅
  → cachedConfig = config ✅
  → syncToModelConfig(config)  ✅ 关键！
    → ModelConfigService.saveConfig(mc)
      → 写 model-config.json ✅
      → cachedConfig = mc  ✅ 缓存更新
```

**结论：** `loadConfig()` 缺少 `syncToModelConfig()` 调用，导致启动时两个配置服务的缓存不一致。

### 2.2 问题 2：Exa 配置在 Electron 中缺失

**Electron 启动链路：**

```
main.js → generateApplicationYml(config)
  → 生成 spring.ai.dashscope / spring.ai.openai / server / clip.*
  → ❌ 没有生成 exa.api-key / exa.enabled

后端启动 → ExaSearchService 构造函数
  → @Value("${exa.api-key:}") → 读到空字符串 ""
  → enabled = false
  → Exa 搜索永久关闭
```

`application_templete.yml` 中有 `exa` 配置，但 Electron 模式下使用的是 `main.js` 动态生成的 `application.yml`，两者不匹配。

### 2.3 问题 3：PDF 导出乱码

**当前实现（learning-plan.html L1289-1404）：**

```javascript
const win = window.open('', '_blank');
win.document.write(html);   // ← 根因：document.write 不保证 UTF-8
win.print();
```

`document.write()` 写入的内容在 Electron/Chromium 中可能以系统默认编码（如 GBK）解析，而非 UTF-8。HTML 中的 `<meta charset="UTF-8">` 在 `document.write` 场景下可能来不及生效。

## 三、修复方案

### 修复 1：AppConfigService 启动时同步配置到 ModelConfigService

**文件：** `backend/src/main/java/com/example/clip/service/AppConfigService.java`

**改动：** 在 `loadConfig()` 方法末尾、`return config` 前添加 `syncToModelConfig(config)` 调用。

```java
public synchronized AppConfig loadConfig() {
    // ... 现有加载逻辑 ...
    config = fillStoragePaths(config);
    cachedConfig = config;
    syncToModelConfig(config);  // ← 新增：启动时同步到 ModelConfigService
    return config;
}
```

**原理：** `syncToModelConfig()` 已在 `saveConfig()` 中使用，会调用 `ModelConfigService.saveConfig()` 更新其缓存。在 `loadConfig()` 中添加同样的调用，确保启动时两个缓存一致。

### 修复 2：ExaSearchService 改为从 AppConfigService 运行时读取

**涉及文件：**
1. `backend/src/main/java/com/example/clip/config/AppConfig.java` — 新增 `exaApiKey`、`exaEnabled` 字段
2. `backend/src/main/java/com/example/clip/service/ExaSearchService.java` — 改为从 `AppConfigService` 读取配置
3. `backend/src/main/java/com/example/clip/service/AppConfigService.java` — `syncToModelConfig` 旁新增 `syncToExa` 方法
4. `frontend/settings.html` — 新增 Exa API Key 配置区域
5. `frontend/settings.js` — 加载/保存 Exa 配置

**AppConfig.java 新增字段：**

```java
// ===== Exa 搜索配置 =====
private String exaApiKey = "";
private boolean exaEnabled = true;
// + getter/setter
```

**ExaSearchService.java 改造：**

```java
@Service
public class ExaSearchService {
    private final AppConfigService appConfigService;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    public ExaSearchService(AppConfigService appConfigService) {
        this.appConfigService = appConfigService;
        // ...
    }

    /** 每次搜索时从 AppConfigService 读取最新配置 */
    private String getApiKey() {
        return appConfigService.getConfig().getExaApiKey();
    }

    private boolean isEnabled() {
        AppConfig config = appConfigService.getConfig();
        return config.isExaEnabled() &&
               config.getExaApiKey() != null &&
               !config.getExaApiKey().isBlank();
    }

    public List<VideoResource> searchResources(String topic, String phaseGoal, int numResults) {
        if (!isEnabled()) {
            log.debug("[Exa] disabled, skip search");
            return Collections.emptyList();
        }
        // ... 后续逻辑使用 getApiKey() 替代 this.apiKey
    }
}
```

**AppConfigService.java 新增 Exa 同步：**

在 `saveConfig()` 方法中，`syncToModelConfig(config)` 之后添加 Exa 日志输出（Exa 现在通过 `AppConfigService.getConfig()` 运行时读取，无需额外同步）。

**settings.html 新增 Exa 配置区域：**

在 AI 模型配置区块后新增一个子区域，包含：
- Exa API Key 输入框（password 类型 + 显示按钮）
- Exa 启用/禁用开关
- 说明文字："用于学习计划模块搜索真实学习资源，从 https://dashboard.exa.ai/api-keys 获取"

**settings.js 加载/保存 Exa 配置：**

```javascript
// loadConfig() 中新增
document.getElementById('exaApiKey').value = config.exaApiKey || '';
document.getElementById('exaEnabled').checked = config.exaEnabled !== false;

// saveConfig() 中新增
exaApiKey: document.getElementById('exaApiKey').value,
exaEnabled: document.getElementById('exaEnabled').checked,
```

### 修复 3：PDF 导出改用 Blob URL + 隐藏 iframe（保证 UTF-8）

**文件：** `frontend/learning-plan.html`

**改动：** 重写 `exportPdf()` 函数，将 `window.open` + `document.write` 替换为 Blob URL + 隐藏 iframe。

```javascript
function exportPdf() {
    const plan = plans.find(p => p.id === currentPlanId);
    if (!plan) return;

    // ... 现有 HTML 生成逻辑不变 ...

    // 新增：@page 和 @media print CSS（参考 Obsidian 打印样式）
    html += `<style>
        @page { size: A4; margin: 15mm; }
        @media print {
            body { padding: 0; }
            .phase { page-break-inside: avoid; }
            h2 { page-break-after: avoid; }
        }
    </style>`;

    // 关键修复：用 Blob URL 保证 UTF-8 编码
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    // 用隐藏 iframe 替代 window.open（Electron 中更可靠）
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:none;opacity:0;';
    document.body.appendChild(iframe);

    iframe.onload = function() {
        setTimeout(() => {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
            setTimeout(() => {
                document.body.removeChild(iframe);
                URL.revokeObjectURL(url);
            }, 1000);
        }, 500);
    };
    iframe.src = url;
}
```

**原理：**
1. `new Blob([html], { type: 'text/html;charset=utf-8' })` — Blob 的 MIME type 显式声明 `charset=utf-8`，浏览器解析时强制使用 UTF-8
2. `URL.createObjectURL(blob)` — 生成 `blob:` 协议 URL，内容编码已固定
3. 隐藏 iframe 加载 Blob URL — 不弹出新窗口，在当前页面内静默打印
4. `@page { size: A4; margin: 15mm }` — 打印页面尺寸和边距（参考 Obsidian）
5. `page-break-inside: avoid` — 阶段卡片不被分页截断

## 四、文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/.../service/AppConfigService.java` | 修改 | `loadConfig()` 末尾添加 `syncToModelConfig(config)` |
| `backend/.../config/AppConfig.java` | 修改 | 新增 `exaApiKey`、`exaEnabled` 字段 + getter/setter |
| `backend/.../service/ExaSearchService.java` | 修改 | 改为从 `AppConfigService` 运行时读取配置 |
| `frontend/settings.html` | 修改 | AI 模型配置后新增 Exa 搜索配置子区域 |
| `frontend/settings.js` | 修改 | `loadConfig`/`saveConfig` 新增 Exa 字段读写 |
| `frontend/learning-plan.html` | 修改 | 重写 `exportPdf()` 使用 Blob URL + 隐藏 iframe |

## 五、验证步骤

### 5.1 API Key 缓存修复验证

1. 在设置页面配置 DashScope API Key → 保存 → 关闭应用
2. 重新启动应用
3. 直接进入学习计划 → 新建计划 → 生成学习路径
4. **预期：** 不再提示"apikey额度用完"，正常生成学习计划
5. 检查后端日志：`AppConfigService` 加载配置后应输出 `Synced to ModelConfigService`

### 5.2 Exa 搜索配置验证

1. 进入设置页面 → 找到 Exa 搜索配置区域
2. 输入 Exa API Key → 启用 → 保存
3. 新建学习计划 → 生成学习路径
4. **预期：** 学习资源来源标记为"Exa 搜索"（绿色标签），而非"AI 推荐"
5. 检查后端日志：`[ExaSearchService]` 应输出搜索结果数量

### 5.3 PDF 导出验证

1. 打开任意学习计划详情
2. 点击"导出PDF"按钮
3. **预期：** 系统打印对话框弹出，预览中中文显示正常（不乱码）
4. 选择"另存为 PDF" → 保存文件
5. 打开保存的 PDF 文件 → 确认所有中文内容（标题、阶段、资源、作业）均正确显示
6. 确认阶段卡片未被分页截断
7. 确认页面边距合理（A4 大小，15mm 边距）

## 六、假设与决策

1. **不修改 `generateApplicationYml()`**：Exa 配置改由 `AppConfigService` 运行时管理，不再依赖 `application.yml`。`ExaSearchService` 不再使用 `@Value` 注入。
2. **不添加 Electron IPC 打印**：Blob URL + 隐藏 iframe 方案足以解决编码问题，且不需要修改 `main.js`/`preload.js`。如后续需要直接生成 PDF 文件（不经过打印对话框），可再添加 `webContents.printToPDF()` IPC。
3. **Exa 配置在设置页面 UI 中可配置**：与 AI 模型配置同一区域，保持风格一致。
4. **`syncToModelConfig` 在 `loadConfig` 中调用是安全的**：Spring 的 `@PostConstruct` 在所有 `@Autowired` 字段注入完成后才执行，`modelConfigService` 此时已可用。