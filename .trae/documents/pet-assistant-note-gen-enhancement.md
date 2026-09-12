# Pet 助手 NoteGen 化增强设计方案

## Context（为什么做）

用户希望按 NoteGen 的思路，把编辑器右下角的 **AI 看板娘宠物** 从"装饰 + 对话入口"升级为"AI 副驾驶"，强调 **视觉精致、能力好用、在场感** 三方面合一，并顺带收尾旧的 pet 优化文档。

**关键认知（务必先对齐，避免白做）：** 已核实最新代码，旧文档 `TODO/pet-icon-redesign-and-state-machine.md` 里描述的缺口**绝大部分已落地**：
- 四预设已重绘为圆润版（HTML 结构含 `ai-pet-glow/figure/face/eye/eye-highlight/blush/smile`）
- 状态机→动作联动已实现（`setPetState` + `updatePetActionImage`，L1358）
- sleeping 点击唤醒已实现（`toggleAiChatPanel` 先调 `setPetState('idle')`，L1423）
- 死代码 `@keyframes ai-pet-think` 已不存在（已被 `[data-action=think]` 替代）
- `error` 抖动、`thinking` 面部脉冲、`[data-action]` 六动作动画全部存在（editor.css L2090-2135）

**并且能力已演进超出文档**：宠物已从"状态栏内小按钮"变成**右下角悬浮宠物**（`.canvas-float`，editor.css L2319），还新增了 **per-action 图片序列系统**（`iconType='preset-images'`：`assets/mascot/{id}/{action}.png`；`iconType='upload'`：每动作可上传 PNG）、AI 代码块一键操作（apply/insert/replace-selection/diff）、右键菜单、斜杠命令菜单。

**所以本次真正要做的不是"收尾"，而是"新增三方向合一"**：以现有成熟的 AI 对话链路（`sendAiMessage(rawMessage)`，editor.js L1803，统一入口：自动开面板→push reducer→SSE 流式）为地基，给悬浮宠物加"副驾驶"能力。后端无需改动（沿用 `/api/ai/chat/stream`）。

## 方案总览（三方向合一）

| 方向 | 落地点 |
|---|---|
| A 视觉精致（NoteGen 极简克制） | 悬浮宠物 hover 微动效 + 点击涟漪 + idle 呼吸光 + AI 进行中"工作光晕" |
| B 能力增强（副驾驶快捷操作） | 悬停宠物弹出 Quick-menu，对选区/段落一键「解释/润色/翻译/总结/AI 搜索」，复用 `sendAiMessage` |
| C 在场感 | 状态气泡：idle 低频问候、thinking 显示"正在想…"；点击唤醒保留 |

## 建议改动文件

### 1. `frontend/editor.html`（在 `#aiPetBtn` 悬浮宠物附近新增两个 DOM）
- `#aiPetQuickMenu`（隐藏）：悬浮于宠物上方的快捷操作菜单，列表项：解释 / 润色 / 翻译成英文 / 总结要点 / 🔍 AI 搜索
- `#aiPetBubble`（隐藏）：状态气泡（问候/正在想），相对宠物定位
- 菜单项以 `button[data-act]` 渲染，结构对齐现有 `slash-menu`/`ctx-menu` 风格

### 2. `frontend/js/editor.js`（新增交互逻辑，约清单）
- `openPetQuickMenu()` / `closePetQuickMenu()`：定位在宠物上方、`Esc`/点击外部/滚轮关闭、↑↓ 键导航 + Enter 触发
- 菜单项 prompt 映射（复用现有右键 AI 搜索套路，直接 `sendAiMessage(prompt)`）：
  - 解释 → `通俗解释一下：{目标}`
  - 润色 → `润色这段文本：{目标}`
  - 翻译成英文 → `把下面内容翻译成英文：{目标}`
  - 总结要点 → `用要点概括：{目标}`
  - 🔍 AI 搜索 → `一句话描述这个词：{目标}`
- 目标文本获取：复用现有 `getTargetRangeAndText()`（有选区用选区，无选区回退光标段落，nil 则提示不发送）
- 菜单触发后先 `setPetState('thinking')`（由 `sendAiMessage` 内部状态机接管）
- 在场气泡：`setIdleBubbleTimer()` 低频轮换问候文案；AI 请求期间气泡切"正在想…"，完成后 2s 隐去
- AI 进行中给 `#aiPetBtn` 叠加 `.thinking` 即可触发已有 CSS 光效联动（无需新状态机）

### 3. `frontend/styles/editor.css`（样式，沿用 `--app-*` 主题变量，保持 NoteGen 极简）
- `.ai-pet-button.canvas-float`：hover 微上浮过渡 + `:active` 涟漪；idle 呼吸光（`::after` 柔光 keyframe）
- `.ai-pet-button.thinking .ai-pet-active-glow`：进行中工作光晕（在已有 thinking 动画基础上叠加柔和泛光）
- `#aiPetQuickMenu`：弹层样式（对齐 `slash-menu`：圆角/边框/投影/动画），包含 `data-act` 项 hover/focused 高亮
- `#aiPetBubble`：气泡样式（小圆角、文字 muted、淡入淡出）
- `prefers-reduced-motion: reduce` 分支统一关掉新增动画

### 涉及文件小结
`frontend/editor.html`、`frontend/js/editor.js`、`frontend/styles/editor.css` 三处。**不改** settings 模块（预设/上传/动作/历史已完善）、不改后端。旧文档 `TODO/pet-icon-redesign-and-state-machine.md` 的缺口已落地，本次不重复；实施时可顺带 grep 确认 `generateMascotIcon` 等如无引用再删（可选，不强求）。

## 复用与不重复造轮子
- `sendAiMessage`（editor.js L1803）：唯一发送入口，自动开面板 + reducer + SSE，快捷项直接调用
- `getTargetRangeAndText`：既有选区读取，避免重复实现
- `setPetState` / `updatePetActionImage`：状态机已完整，只用其 idle/thinking 触发
- 样式对齐 `slash-menu` / `ctx-menu`：视觉语言统一，不加新体系

## 验证
1. `node --check frontend/js/editor.js`（语法）
2. 手动（浏览器打开编辑器）：
   - 悬停右下角宠物 → Quick-menu 弹出，动画自然
   - 选中一段文字 → 点「总结要点」→ AI 面板打开、宠物 thinking（进行中光晕）、收到流式要点
   - 无选中点「🔍 AI 搜索」→ 按提示不发送（或回退段落），不报错
   - idle 挂机 → 气泡出现低频问候；发请求 → 气泡"正在想…"
   - 开启系统"减弱动态效果" → 新增动画关闭，功能不受影响
3. 回归：上传/预设宠物、历史使用/删除、右键 AI 搜索不受影响

## 风险
- 无后端改动，风险集中在前端交互与样式；Quick-menu 与外弹层的遮挡（z-index）、越界定位需按 `slash-menu` 处理
- 保持克制：不做花哨动效堆叠，避免偏离 NoteGen 极简风