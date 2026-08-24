# 编辑模块 AI 对话助手 + 宠物模块 设计文档

> **状态**：后续开发计划（本次只做设计，不开发）
> **创建日期**：2026-08-01
> **目标读者**：后续接手实施的开发者

---

## 1. 概述

### 1.1 目标

为编辑模块新增 AI 对话能力，包含三个部分：

1. **右下角宠物模块**：在状态栏"桌面模式"文字上方放置一个**能动的小机器人宠物**（参考 codex 宠物风格），点击可唤醒 AI 对话。
2. **右侧 AI 对话面板**：内嵌在编辑区右侧的 grid 面板（约 360px），支持**多轮流式对话**（SSE）。
3. **选中文本右键 AI 搜索**：编辑区选中文本后右键唤起自定义菜单，点击"AI 搜索"把 **"一句话描述这个词：" + 选中词** 发送到右侧对话面板。

### 1.2 本次已确认决策

| 决策项 | 结论 |
|---|---|
| 面板形态 | **右侧内嵌 grid 面板**（editor-workspace 增加第三列，约 360px，与编辑区同高，左边界可拖拽调宽） |
| 右键菜单 | **自定义菜单含常用项**（复制/剪切/粘贴/全选 + 分隔线 + AI 搜索选中内容） |
| 对话深度 | **多轮对话 + 流式输出**（SSE），右键搜索作为带前缀的一条消息注入会话 |
| 宠物模块 | **可动小机器人**（SVG + CSS 动画，参考 codex 宠物风格，有 idle/thinking/happy 等状态） |
| 文档位置 | 项目根目录 `TODO/` 文件夹 |

---

## 2. 现状分析（已探索确认）

### 2.1 前端编辑模块

- 编辑器为 ACE（`frontend/libs/ace/ace.js`），`mainEditor` 单实例（[editor.js L96-L97](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L96-L97)）
- 状态栏 `#runtimeStatus`（"桌面模式/浏览器模式"文本，[editor.js L1615](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L1615)）；文件/历史/最近三个按钮是**动态创建**的 `status-btn`，插入到 `runtimeStatus` 之前
- `editor-workspace` 是 CSS Grid（[editor.css L304-L310](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/styles/editor.css#L304-L310)），面板开关通过 `show-*` class 切换列数：`show-filetree`(220px 左列)、`show-history`(280px)、`show-recent`(280px)，**三个面板互斥**（[toggleFileTree](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L1875-L1890)、[toggleHistoryPanel](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L2304-L2319)）
- **无任何 contextmenu 监听**（右键目前是 ACE 默认行为），需自行挂载
- 已有成熟选区读取模式 [getTargetRangeAndText()](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L654-L665)：有选区返回 `{range, text, selection:true}`，无选区回退全文
- 右侧滑出面板有现成模板 `side-panel#transformPanel`（[editor.css L749-L769](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/styles/editor.css#L749-L769)），但本次采用**内嵌 grid 面板**形态，不复用 side-panel

### 2.2 后端 AI 服务

- 全链路**同步非流式**：`LlmProvider.chat(String systemPrompt, String userMessage)`（[LlmProvider.java L36-L57](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/core/LlmProvider.java#L36-L57)）
  - [DashScopeLlmProvider](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/core/DashScopeLlmProvider.java#L84-L118)：DashScope SDK `Generation.call(param)` 同步
  - [DeepSeekLlmProvider](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/core/DeepSeekLlmProvider.java#L89-L165)：RestTemplate + `stream=false`
- **无 SseEmitter / Flux / StreamingResponseBody / SSE 接口**；`ModelConfigController` 仅配置读写与连接测试
- [RoutingLlmProvider](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/core/RoutingLlmProvider.java#L75-L100) 按 `activeProvider` 路由并自动降级

### 2.3 Electron 代理（对 SSE 透明的关键利好）

[startFrontendServer](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/electron/main.js#L810-L857) 中 `/api/*` 请求用 **pipe 流式转发**到后端（`proxyRes.pipe(res)`），**SSE 可直接穿透，无需改动**。

---

## 3. 总体架构

```
┌────────────────────────── 前端 editor.html ──────────────────────────┐
│                                                                      │
│  [宠物按钮🤖] 状态栏 #runtimeStatus(桌面模式)上方                      │
│     └─ 点击 toggle AI 对话面板                                        │
│                                                                      │
│  editor-workspace (grid 三列)                                         │
│  ┌──────────┬──────────┬──────────────┐                              │
│  │ 左面板    │ 编辑区    │ AI 对话面板   │ ← .show-ai-chat 增加右列     │
│  │(文件/历史  │ (ACE)    │ (360px 可拖)  │    360px                    │
│  │ /最近)    │          │              │                              │
│  └──────────┴──────────┴──────────────┘                              │
│                                                                      │
│  右键菜单 (contextmenu) → "AI 搜索选中内容"                           │
│     └─ 打开面板 + 发送 "一句话描述这个词：<选中词>"                      │
└──────────────────────────────────────────────────────────────────────┘
                            │ fetch + ReadableStream 解析 SSE
                            ▼
┌────────────────────────── 后端 Spring Boot ──────────────────────────┐
│  POST /api/ai/chat/stream (SSE, text/event-stream)                   │
│    └─ AiChatController → AiChatService                                │
│          └─ LlmProvider.streamChat(...)  ← 新增流式方法               │
│                ├─ DashScopeLlmProvider: Generation.streamCall()       │
│                └─ DeepSeekLlmProvider: stream=true + SSE 解析          │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 4. UI 设计

### 4.1 右下角宠物模块（能动的机器人）

**位置**：状态栏右侧，`#runtimeStatus` 之前（与"文件/历史/最近"按钮同一区域，宠物放最右，紧贴"桌面模式"文字左侧）。

**形态**：`<button class="pet-avatar" id="aiPetBtn">`，内嵌 SVG 机器人，用 CSS 关键帧动画实现"能动"，**零外部依赖**（不引入 Lottie）。

**宠物状态机**（JS 切换 class）：

| 状态 | 触发时机 | 动画效果（CSS） |
|---|---|---|
| `idle` | 默认 / 面板关闭 | 轻微上下浮动（呼吸感）+ 天线左右摆动 + 间隔眨眼 |
| `thinking` | 消息发出后等待回复 | 头部轻微旋转 + 眼睛注视光点循环 + 天线高频摆动 |
| `happy` | 收到完整回复 | 跳跃 + 眼睛变弯（微笑）+ 光晕闪烁 |
| `sleep` | 闲置 5 分钟（可选） | 半闭眼 + 缓慢起伏 + 呼噜泡泡 |

**SVG 结构**（示意）：
```html
<svg class="pet-svg" viewBox="0 0 64 64">
  <!-- 天线（动画：transform-origin 底部，左右摆动） -->
  <g class="pet-antenna"><line .../><circle class="pet-antenna-tip" r="3"/></g>
  <!-- 头（圆角方形） -->
  <rect class="pet-head" .../>
  <!-- 眼睛（两组：开眼椭圆 / 闭眼直线，blink 动画切换） -->
  <g class="pet-eye"><ellipse/></g><g class="pet-eye-closed"><line/></g>
  <!-- 嘴（idle 直线 / happy 弧线，class 切换） -->
  <path class="pet-mouth" .../>
  <!-- 身体 + 底盘 -->
  <rect class="pet-body"/><path class="pet-base"/>
</svg>
```

**动画要点**：
- `@keyframes petFloat`：`translateY(0↔-3px)` 循环 3s，`animation: petFloat 3s ease-in-out infinite`
- `@keyframes petBlink`：每 4s 眨眼一次（`.pet-eye-closed` 短暂 opacity 1）
- `@keyframes petWiggle`：天线 `rotate(-8deg↔8deg)` 1.5s
- `.thinking` 时 JS 把 `#aiPetBtn` 的 class 换掉，CSS 切换动画组
- 宠物在**浏览器模式**下也可显示（无 Electron 依赖）

**交互**：
- 点击 → `toggleAiChatPanel()`（与文件树/历史/最近相同 toggle 模式）
- 面板打开且正在流式输出时，宠物显示 `thinking`；输出完成显示 `happy`（2s 后回 idle）

### 4.2 右侧 AI 对话面板（内嵌 grid，360px，可拖拽）

#### 4.2.1 布局接入

- 新增 `div.editor-pane.ai-chat-pane#aiChatPane`（放在 workspace 子项**最后**，即第 3 列右侧）
- 新增 CSS：`.editor-workspace.show-ai-chat { grid-template-columns: minmax(0, 1fr) 360px; }`
- **与文件/历史/最近互斥**：打开 AI 面板时关闭其他三个；`toggleAiChatPanel()` 与现有 toggle 对称
- **宽度可拖拽**：`#aiChatPane` 左侧加一个拖拽把手（`resize: horizontal` 或 JS mousedown 拖拽改 `grid-template-columns` 第二列宽度），宽度范围 280px~560px，状态存 localStorage

#### 4.2.2 面板结构

```html
<div class="editor-pane ai-chat-pane" id="aiChatPane" hidden>
  <div class="ai-chat-header">
    <span class="ai-chat-title">🤖 AI 助手</span>
    <span class="ai-chat-model" id="aiChatModel">qwen-plus</span>
    <div class="ai-chat-actions">
      <button id="aiChatClearBtn" title="清空会话">清空</button>
      <button id="aiChatCloseBtn" title="关闭">×</button>
    </div>
  </div>
  <div class="ai-chat-messages" id="aiChatMessages">
    <!-- 聊天气泡：消息由 JS 追加 -->
  </div>
  <div class="ai-chat-input-area">
    <textarea id="aiChatInput" placeholder="输入问题，Enter 发送，Shift+Enter 换行"></textarea>
    <button id="aiChatSendBtn">发送</button>
  </div>
</div>
```

#### 4.2.3 聊天气泡（消息渲染）

| 类型 | 对齐 | 样式 |
|---|---|---|
| 用户消息 | 右侧 | 主色底圆角气泡，白字 |
| 助手消息 | 左侧 | 浅色底气泡，**支持 Markdown 渲染**（复用 `frontend/libs/marked.min.js`，高亮可用 `highlight.js` 或简化为纯文本代码块样式） |
| 助手流式中 | 左侧 | 气泡内容**逐字追加**，末尾显示闪烁光标 `▍` |
| 系统提示 | 居中 | 灰色小字（如"连接失败"） |

每条助手消息提供"复制"按钮；流式结束后可点击"停止"取消生成（若有剩余 token 未输出）。

#### 4.2.4 输入区交互

- `Enter` 发送，`Shift+Enter` 换行
- 发送后清空输入框、禁用发送按钮，显示"停止"按钮
- 支持 Ctrl/Cmd+Enter 等价发送

### 4.3 右键菜单（contextmenu）

#### 4.3.1 交互规则

- 在 `mainEditor.container` 上挂 `contextmenu` 监听（`e.preventDefault()`）
- **有选中文本**（`mainEditor.getSelectedText()` 非空）：显示完整菜单 = 复制 / 剪切 / 粘贴 / 全选 + 分隔线 + **🔍 AI 搜索「前 12 字…」**
- **无选中文本**：仅显示 复制 / 粘贴 / 全选（不显示 AI 项）
- 点击菜单外部 / Esc / 滚动 → 关闭菜单
- 菜单定位：相对鼠标坐标，超出窗口边缘时自动翻转

#### 4.3.2 菜单结构

```html
<div class="ctx-menu" id="aiCtxMenu" hidden>
  <button data-act="copy">复制</button>
  <button data-act="cut">剪切</button>
  <button data-act="paste">粘贴</button>
  <button data-act="selectAll">全选</button>
  <div class="ctx-menu-divider"></div>
  <button data-act="aiSearch" id="aiSearchBtn">🔍 AI 搜索选中内容</button>
</div>
```

#### 4.3.3 AI 搜索行为（核心需求）

点击"AI 搜索选中内容"：
1. 读取 `getTargetRangeAndText()` 的 `text`（选中文本，截断到 2000 字符防超长）
2. 打开 AI 对话面板（若未打开）
3. 构造消息并追加到会话：**system** `你是一个专业代码编辑助手，回答需简洁准确。`；**user** `一句话描述这个词：{选中文本}`
4. 发送 SSE 请求，流式渲染回复到面板

> 提示词前缀固定为 **"一句话描述这个词："** + 右键选中的词（用户明确指定）。

---

## 5. 后端流式对话设计

### 5.1 接口定义

**新增 Controller：`AiChatController`**，`@RequestMapping("/api/ai/chat")`

```
POST /api/ai/chat/stream        → SseEmitter (text/event-stream)
请求体:
{
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user",   "content": "一句话描述这个词：xxx" }
  ]
}
响应: SSE 事件流
  data: {"type":"delta","content":"..."}   // 增量 token
  data: {"type":"done"}                     // 完成
  data: {"type":"error","message":"..."}    // 错误
```

- `role` 支持 `system` / `user` / `assistant`（多轮历史）
- 会话历史由**前端维护**并在请求中携带（无状态后端，简单可靠）
- 可选 `POST /api/ai/chat/stop` 取消（按 sessionId），首期可省略

### 5.2 LlmProvider 增加流式方法

```java
public interface LlmProvider {
    String chat(String systemPrompt, String userMessage);              // 保留
    StreamResult streamChat(List<ChatMessage> messages);               // 新增
    String getProviderName();
    boolean isAvailable();
}
```

`StreamResult`：`Consumer<String> onDelta` + `onDone` / `onError` 回调，或返回 `Flowable`/`Iterator<String>`。推荐**回调式**（对两种实现都简单）。

**DashScopeLlmProvider**：DashScope SDK 支持 `Generation.streamCall(param, callback)`（`GenerationParam.builder().incrementalOutput(true)`），把增量文本转发到 onDelta。
**DeepSeekLlmProvider**：请求体 `stream=true`，用 `RestTemplate` 的 `extract` 流式读取 SSE（或改用 `WebClient`），解析 `data: {...}` 行的 `choices[0].delta.content` 转发 onDelta。注意 DeepSeek 端点的 `BASE_URL` 目前是硬编码常量（[DeepSeekLlmProvider L54-L58](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/core/DeepSeekLlmProvider.java#L54-L58)），流式改造时顺带参数化为配置可读。
**RoutingLlmProvider**：`streamChat` 同样按 `activeProvider` 路由 + 降级。

### 5.3 SSE 实现要点

- Controller 返回 `SseEmitter`，超时设 60s~120s（`SseEmitter(long timeout)`），`send()` 增量推送，`complete()` 结束
- **错误处理**：provider 抛异常时 `emitter.completeWithError()` 并发送 `error` 事件
- **并发安全**：SseEmitter 非线程安全，多线程回调需 `synchronized` 包裹 send
- **Electron 代理穿透**：`/api/*` 是 pipe 流式转发，SSE 无需改 main.js

### 5.4 前端 SSE 消费

- 用 `fetch` + `ReadableStream`（POST 请求无法用 EventSource）：
  ```javascript
  const res = await fetch('/api/ai/chat/stream', { method:'POST', body: JSON.stringify({messages}), headers:{'Content-Type':'application/json'} });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  // 循环读取，按行解析 "data: {...}"，每收到 delta 就 append 到当前气泡
  ```
- 流式期间宠物进入 `thinking`，完成进 `happy`
- 失败时气泡追加系统提示"AI 连接失败：..."，宠物回 idle

---

## 6. 数据流（右键 AI 搜索完整链路）

```
用户选中文本 "Dijkstra"
  → 右键 → 点击 "🔍 AI 搜索选中内容"
  → openAiChatPanel()  (若未打开)
  → messages = [{role:'system', content:'你是一个专业代码编辑助手...'},
               {role:'user', content:'一句话描述这个词：Dijkstra'}]
  → appendUserBubble("一句话描述这个词：Dijkstra")  (立即显示)
  → fetch POST /api/ai/chat/stream (SSE)
  → 宠物 thinking
  → 逐 delta append 到 assistant 气泡 + 闪烁光标
  → done → 宠物 happy(2s) → idle
```

---

## 7. 实现步骤

| 步骤 | 内容 | 涉及文件 |
|---|---|---|
| 1 | 后端：`LlmProvider` 增加 `streamChat` + `ChatMessage`/`StreamResult` 模型 | `LlmProvider.java`、新增 `ChatMessage.java`、`StreamResult.java` |
| 2 | 后端：DashScope 流式实现（`streamCall` + `incrementalOutput`） | `DashScopeLlmProvider.java` |
| 3 | 后端：DeepSeek 流式实现（`stream=true` + SSE 解析，baseUrl 参数化） | `DeepSeekLlmProvider.java` |
| 4 | 后端：`RoutingLlmProvider.streamChat` 路由 + 降级 | `RoutingLlmProvider.java` |
| 5 | 后端：新增 `AiChatController`（SSE 端点）+ 组装 messages | 新增 `AiChatController.java` |
| 6 | 前端：editor.html 增加宠物按钮 + AI 面板 + 右键菜单 DOM | `editor.html` |
| 7 | 前端：editor.css 增加宠物动画 + AI 面板 grid 布局 + 右键菜单样式 + 拖拽 | `editor.css` |
| 8 | 前端：editor.js 增加 toggle 面板（互斥）+ 宠物状态机 + 右键菜单 + SSE 消费 + 拖拽 | `editor.js` |
| 9 | 前端：Markdown 渲染气泡（marked.min.js 复用） | `editor.js` |
| 10 | 联调验证（见 §8） | — |

---

## 8. 验证方式

1. **宠物模块**：编辑器打开，右下角机器人有浮动/眨眼动画；点击 toggle 面板开关正常
2. **面板互斥**：开 AI 面板 → 文件/历史/最近面板自动关闭；反向同理
3. **多轮流式对话**：输入问题 → SSE 逐字输出 → 气泡闪烁光标 → 完成后"停止"消失、可继续追问（上下文衔接）
4. **右键 AI 搜索**：选中文本 → 右键 → 点"AI 搜索" → 面板打开且发送 **"一句话描述这个词：{选中词}"** → 收到回答
5. **无选中右键**：仅复制/粘贴/全选，无 AI 项
6. **宠物联动**：发送消息时宠物 thinking，回复完成 happy
7. **降级容错**：停掉后端 → 发送消息 → 气泡报"连接失败"、宠物回 idle、不卡死 UI
8. **Electron 桌面模式**：SSE 经 `/api` 代理穿透正常；浏览器模式同样可用
9. **宽度拖拽**：拖拽 AI 面板左边界调整宽度，编辑区自适应重排（`mainEditor.resize()`）

---

## 9. 风险与注意事项

- **SSE 与代理**：Electron `/api/*` 是 pipe 转发，SSE 天然穿透；但需注意 `timeout: 30000` 是**请求读取超时**（[main.js startFrontendServer](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/electron/main.js#L810-L857)），流式输出期间若 30s 无数据可能被截断——SSE 有周期性 heartbeat 或 token 持续输出可规避
- **DeepSeek 流式解析**：SSE 行解析需处理 `data:` 前缀、`[DONE]` 结束标记、多行 data 合并；RestTemplate 流式读取较繁琐，必要时换 `WebClient`/`HttpURLConnection`
- **DashScope 流式**：`streamCall` 回调线程需注意 SseEmitter 并发安全（`synchronized`）
- **右键菜单体验**：需处理菜单越界翻转、点击外部关闭、与 ACE 内置右键（若有）冲突
- **长文本**：选中文本超长时截断（建议 2000 字符），避免请求体过大
- **多轮上下文长度**：前端应限制 messages 条数（如保留最近 20 条），防止 token 超限
- **Markdown 渲染安全**：`marked.min.js` 需配置 sanitize/防 XSS（渲染模型输出）
- **API Key 泄露**：`application.yml` 中现有真实 DashScope Key 与 SMTP 授权码（与本次无关但需留意轮换）

---

## 10. 参考

- OpenAI Codex CLI 宠物特性（宠物动画风格参考）
- IDEA ProxyAI 插件（右侧工具窗 + 流式对话 + 右键 AI 操作参考）
- OpenAI Chat Completions 流式规范：`stream=true` + `data:` 行 + `[DONE]`
- 本项目现有面板互斥模式（`show-filetree/show-history/show-recent` + grid 列）
- 本项目现有选区读取：`getTargetRangeAndText()`（[editor.js L654-L665](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L654-L665)）
- 本项目 Electron `/api` 流式代理：[main.js startFrontendServer](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/electron/main.js#L810-L857)


---

# 2026-08-02 更新：实现基线与后续计划

> 本节在原始设计基础上补充当前实现状态，不删除前文设计内容。

## 已完成实现

- 右侧看板娘对话面板已接入编辑器，支持多轮 SSE 流式对话、停止、清空、Markdown 安全渲染和复制。
- 编辑器选中文本右键支持 AI 搜索，固定前缀为“ 一句话描述这个词：”加选中文本。
- 前端纯逻辑模块已拆分为 `frontend/js/editor-ai-chat-core.js`，覆盖 reducer、Prompt、SSE parser。
- 后端新增 `/api/ai/chat/stream`、DTO、Controller、Service、可取消流式 Provider 和 OpenAI 兼容 SSE 解析器。
- DashScope、DeepSeek、Routing Provider 已统一流式事件模型；无 API Key 时不阻塞应用启动。
- 旧剪藏 JSON、历史 Git 字段和配置目录迁移已增加兼容处理。
- 应用配置统一到 `~/.cut-shelter/config/`，业务数据继续使用用户选择的 `storagePath`。
- 看板娘支持四个内置图标、用户上传图标、动作预览、历史筛选/使用/删除和跨页面同步。

## 看板娘产品规则

### 图标

默认图标为：蓝色机器人、活力电气鼠、薄荷小恐龙、紫色小猫。用户可上传 PNG/JPG/WebP/GIF/SVG，建议透明背景、128×128、不超过 1MB。

配置使用浏览器本地键 `cut_shelter_mascot_v1`，必须保存完整的 `iconType`、`iconId`、`iconSvg`、`iconDataUrl`、`action` 和 `history`。历史记录点击“使用”时，设置页预览和编辑器入口必须同时更新，不能只更新颜色或动作。

### 动作状态机

| 状态 | 触发条件 | 动作 |
|---|---|---|
| `idle` | 默认、完成动画后 | 轻微呼吸/浮动 |
| `thinking` | AI 请求发送到完成 | 奔跑，表示正在工作 |
| `happy` | AI 完整回答结束 | 开心跳跃约 1.8 秒 |
| `sleeping` | 2 分钟没有编辑器或对话操作 | 打盹，降低透明度 |
| `error` | 请求失败 | 错误色并恢复可操作 |

所有操作必须清理并重置闲置计时器；设置页动作预览与编辑器使用相同状态命名。开启 `prefers-reduced-motion: reduce` 时关闭位移动画。

### 图片生成边界

当前不伪装调用图像 AI：设置页提供内置图标和上传入口，并给出“主体 + 动作 + 风格 + 透明背景”的提示词指导。未来若接入图像模型，应使用独立图片 Provider，执行大小、格式、透明背景、SVG 安全清洗后再保存。

提示词模板：

> 主体：可爱的小恐龙/机器人/电气鼠；动作：奔跑、挥手或跳跃；风格：圆润、扁平、透明背景、粗线条、适合 128×128 图标。

## 后续 TDD 开发计划

### Phase 1：先写失败测试

- Prompt：固定前缀、空选区、首尾空白、Unicode 截断。
- Reducer：发送、助手占位、delta、完成、失败、取消、清空、标签隔离和流式防重入。
- SSE：跨网络分片、中文 UTF-8、heartbeat、done、error、`[DONE]` 和断流。
- 看板娘：预设切换、上传大小限制、完整图标历史、使用/删除、跨窗口同步。
- 动作：thinking、happy、sleeping 超时、操作唤醒和 reduced-motion。
- 后端 Controller：合法 SSE、400 校验、事件顺序和 Provider 异常。
- Provider：主备降级、首 delta 后不重试、cancel 释放底层流。

### Phase 2：后端流式链路

1. 完成 DTO、事件对象、流式 Provider 接口和取消句柄。
2. 完成请求校验、system prompt、SseEmitter 资源清理。
3. 完成 DashScope/DeepSeek 适配器和通用 SSE 解析。
4. 完成 Routing Provider 降级策略。
5. 使用 MockMvc、Mockito 和 Provider 单元测试覆盖异常路径。

### Phase 3：前端交互

1. 让 `editor-ai-chat-core.js` 纯逻辑测试保持通过。
2. 接入 ACE 选区快照、标签会话、ReadableStream 和 AbortController。
3. 完成看板娘预设、上传、历史和实时同步。
4. 完成动作状态机、2 分钟闲置打盹和回答完成跳跃。
5. 验证 Markdown 安全渲染、复制、停止、清空、窄屏和可访问性。

### Phase 4：集成回归

- Electron Mock SSE 代理与浏览器直连双模式。
- 文件树、历史、最近、Markdown、对比与 AI 面板组合。
- 后端完整测试、编辑器测试、打包启动冒烟测试。
- 手工验收预设图标、上传图标、历史使用/删除、动作变化和无 Key 启动。

## 当前验收标准

- 原设计的右侧面板、选区搜索和流式对话能力保持不变。
- 任意内置或上传图标在设置页和编辑器中一致。
- 历史版本使用后不丢失图标数据。
- AI 回答中奔跑、完成后跳跃、闲置两分钟打盹。
- 无 API Key 不阻塞启动，AI 请求显示明确错误。
- 不提交用户本地配置、缓存和运行日志。
