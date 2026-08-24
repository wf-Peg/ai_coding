# 编辑区 AI 宠物图标优化 + 动作×状态机联动 设计文档

> **状态**：后续开发计划（本次只做设计，不开发）
> **创建日期**：2026-08-01
> **目标读者**：后续接手实施的开发者
> **依据代码**：`frontend/settings.html`、`frontend/js/settings.js`、`frontend/editor.html`、`frontend/js/editor.js`、`frontend/styles/editor.css`

---

## 1. 概述

### 1.1 目标

1. **重绘四个默认预设图标**为可爱圆润风格（机器人/电气鼠/恐龙/猫），并优化设置页预览与选中态样式。
2. **检查并打通六个动作的触发逻辑**：确认 `run/wave/jump/think/sleep/celebrate` 的完整触发链路，补齐缺口。
3. **动作 × AI 状态机联动**（本次核心设计）：把设置页的"配置动作"与编辑器 AI 对话的"运行状态机"（idle/thinking/happy/error/sleeping）对应起来，让宠物在 AI 不同状态下**自动切换贴合的渲染**。
4. **简化动画**：每个动作以整图动画为主（1-2 个关键帧），不做繁琐的内部元素局部动画。

### 1.2 已确认决策

| 决策项 | 结论 |
|---|---|
| 预设重绘 | **四个全部重绘新版**（圆润可爱造型，保留现有色系） |
| 动作贴合渲染 | **简化：整图动画为主**（预设 SVG 不做内部 class 局部动画；眼睛等状态通过颜色/形状变化体现） |
| 动作数量 | **保留六动作 + 简化动画** |
| 状态机联动 | **六动作与 AI 运行状态机映射**（见 §4，核心） |
| 文档位置 | 项目根目录 `TODO/` 文件夹 |

---

## 2. 现状分析（已探索确认）

### 2.1 两套并行机制（当前割裂）

**A. 配置动作（`data-action`，6 个）** —— 用户从设置页选择，表示"宠物默认展示的动作"

| 值 | 中文 | CSS 动画 | 触发链路 |
|---|---|---|---|
| `run` | 奔跑 | `ai-pet-run` + `ai-dino-step`(腿) | ✅ 完整 |
| `wave` | 挥手 | `ai-dino-wave`(手臂) | ✅ 完整 |
| `jump` | 跳跃 | `ai-dino-jump` | ✅ 完整 |
| `think` | 思考 | `ai-dino-think` | ✅ 完整 |
| `sleep` | 打盹 | `ai-dino-sleep` | ✅ 完整 |
| `celebrate` | 庆祝 | `ai-dino-celebrate` | ✅ 完整 |

触发链路（六个动作**都已有触发逻辑**）：
```
设置页 select change → handleMascotActionChange → applyMascotConfig
  → localStorage('cut_shelter_mascot_v1') + 三重广播(storage/postMessage/BroadcastChannel)
  → editor.js applyMascotPreference → aiPetBtn.dataset.action = xxx
  → CSS [data-action="xxx"] 切换动画
```

**B. 运行状态机（JS class，5 个）** —— AI 对话生命周期驱动

| 状态 | class | 触发点 |
|---|---|---|
| `idle` | 无 | 初始化、happy 1.8s 后、取消请求 |
| `thinking` | `.thinking` | 发送消息等待回复 |
| `happy` | `.happy` | SSE done/[DONE] |
| `error` | `.error` | fetch 失败/HTTP 非 200 |
| `sleeping` | `.sleeping` | idle 后 2 分钟定时器 |

### 2.2 已发现的缺口（本次要修的）

| # | 缺口 | 位置 |
|---|---|---|
| 1 | **四个预设 SVG 造型不够圆润可爱**（线条偏硬、结构简单） | [settings.js buildMascotSvg L273-L281](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/settings.js#L273-L281) |
| 2 | **预设 SVG 无内部 class**，局部动画（腿/手臂/眼睛）只对默认恐龙生效，其他预设选 wave/think 等动作时无贴合的局部效果 | `settings.js` icons 对象（四段硬编码 SVG） |
| 3 | **配置动作与运行状态机完全割裂**：AI thinking 时，宠物仍在执行用户配置的动作（如 wave），不体现"思考/奔跑" | `setPetState` / `applyMascotPreference` |
| 4 | **`sleeping` 点击不唤醒**：点击 `#aiPetBtn` 只 `toggleAiChatPanel()`，不 `setPetState('idle')` | [editor.js L1150-L1152](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L1150-L1152) |
| 5 | 死代码 `@keyframes ai-pet-think`（未被引用） | [editor.css L1318](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/styles/editor.css#L1318) |
| 6 | 设置页 `.mascot-preset svg` 内联 fill 与 CSS `--mascot-color` 混用，预览与编辑器配色一致性弱 | [settings.html L500-L546](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/settings.html#L500-L546) |

### 2.3 关键已有资产

- 状态机入口 [setPetState()](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L907-L917)：切换 `thinking/happy/error/sleeping` class
- 配置应用入口 [applyMascotPreference()](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L82-L98)：读 localStorage → 设 `data-action` / `--mascot-color` / 注入 SVG
- 设置页 SVG 渲染 [buildMascotSvg()](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/settings.js#L273-L281) 与预览 `renderMascotPreview()`
- 设置页预设列表渲染 [renderMascotPresets()](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/settings.js#L181-L185)

---

## 3. 四个预设重绘（可爱圆润风格）

### 3.1 通用造型规范

统一 `viewBox="0 0 64 64"`，四只共用**圆润特征**：

| 特征 | 实现方式 |
|---|---|
| 圆胖身体 | 用椭圆/圆角矩形，避免尖锐折线（`rx` 大、`C` 曲线） |
| 短粗手脚 | 粗描边线条 + 圆头（`stroke-linecap:round`） |
| 大圆眼睛 | 大 `circle` + 高光小圆（白色小圆点） |
| 腮红 | 半透明粉色 `ellipse`（所有预设都有，增强可爱感） |
| 高光 | 身体上叠加半透明白色圆角块 |
| 描边圆角 | 统一 `stroke-linejoin:round` |

### 3.2 四个新造型设计

**① robot-blue 蓝色机器人（#569cff）**
```
圆头(带天线球) + 圆身体 + 两侧圆手 + 底盘
眼睛：两个大圆点 + 高光
胸口：圆点指示灯
```
- 身体主形状：两个同心大圆（头 + 身），天线小圆球 + 细杆
- 保留"科技感"但整体圆润（方角 → 圆角，直角臂 → 圆弧臂）

**② pikachu-yellow 活力电气鼠（#e5b93f）**
```
圆头 + 两只长圆尖耳(耳尖深色) + 胖圆身体 + 圆脚 + 尾巴闪电
眼睛：大圆 + 高光；腮红两团
```
- 耳朵用椭圆旋转，身体用大圆，尾巴用圆弧 + 圆头闪电

**③ dino-mint 薄荷小恐龙（#49b883）**
```
胖圆身体 + 圆口鼻 + 圆眼睛 + 短圆四肢 + 圆尾 + 背部小圆突
```
- 在现有恐龙基础上"圆化"：折线背棘 → 小圆珠；尖尾 → 圆头尾

**④ cat-violet 紫色小猫（#b477e8）**
```
圆脸 + 两只三角圆角耳 + 胖圆身体 + 圆爪 + 尾巴 + 胡须(细线)
眼睛：大圆 + 高光；小三角鼻 + W嘴
```

### 3.3 SVG 结构约定（简化版）

每个预设 SVG **只保留 3 个可动画元素**（整图动画为主，不做内部 class 局部动画）：

```html
<svg viewBox="0 0 64 64">
  <ellipse class="ai-pet-glow"/>   <!-- 底部光晕（共享） -->
  <g class="ai-pet-figure">        <!-- 主体：头+身+四肢+尾巴 全部在 g 内（整图动画） -->
    ...圆润造型元素（用 --mascot-color 着色）...
  </g>
  <g class="ai-pet-face">          <!-- 面部：眼睛+腮红+嘴（状态渲染：颜色/形状变化） -->
    <circle class="ai-pet-eye"/>
    <circle class="ai-pet-eye-highlight"/>
    <ellipse class="ai-pet-blush"/>
  </g>
</svg>
```

> 简化决策：不做 `.ai-dino-arm/.ai-dino-leg/.ai-dino-eye` 等逐元素局部动画 class；六个动作全部作用于 `.ai-pet-svg`（整图）或 `.ai-pet-face`（面部状态）。这样四个预设**天然全部支持**所有动作，无需各自维护内部 class。

### 3.4 着色约定

- SVG 内所有非描边元素用 `fill: var(--mascot-color, #xxx)`；描边用 `stroke: var(--mascot-color, #xxx)`
- 眼睛高光/腮红用固定色（白 / 半透明粉），不随 `--mascot-color` 变
- 编辑器注入时沿用 `applyMascotPreference` 的 `--mascot-color` 机制（预设默认色 + 用户可改色）

---

## 4. 核心设计：六动作 × AI 状态机映射

### 4.1 触发逻辑设计（回答"六个动作的触发逻辑 + 对应 AI 状态机"）

**设计原则：运行状态（class）优先级 > 配置动作（data-action）**

- `data-action`（设置页选择）= **空闲时的默认动作**，只在 `idle` 状态生效
- AI 运行状态一旦非 idle，**覆盖**默认动作，切换为贴合该状态的渲染
- 回到 `idle` 后，恢复用户配置的动作

### 4.2 映射表

| AI 运行状态 | 渲染动作 | 触发时机 | 动画效果（简化） |
|---|---|---|---|
| `idle` | **用户配置的 data-action**（run/wave/jump/think/sleep/celebrate） | 默认/空闲 | 按配置动作渲染 |
| `thinking` | **思考奔跑**（高频版 run + 面部脉冲） | 发送消息等待回复 | 整图高频浮动 + 眼睛闪烁 |
| `happy` | **庆祝**（celebrate） | SSE done/[DONE] | 整图跳跃，1.8s 后回 idle |
| `error` | **错误**（抖动 + 眼睛变红） | fetch 失败/HTTP 非 200 | 整图抖动 + 面部眼睛变红 |
| `sleeping` | **打盹**（sleep） | idle 后 2 分钟 | 整图下沉缩放 + 半透明 |

### 4.3 实现方案（CSS 优先级覆盖，改动最小）

**关键：运行状态 class 选择器比 `[data-action]` 选择器更高优先级，直接覆盖。**

```css
/* 现有：配置动作（空闲默认） */
.ai-pet-button[data-action="run"] .ai-pet-svg { animation: ai-pet-run 700ms steps(2, end) infinite; }
.ai-pet-button[data-action="wave"] .ai-pet-svg { animation: ai-dino-wave 600ms ease-in-out infinite; }
.ai-pet-button[data-action="jump"] .ai-pet-svg { animation: ai-dino-jump 900ms ease-in-out infinite; }
.ai-pet-button[data-action="think"] .ai-pet-svg { animation: ai-dino-think 1.8s ease-in-out infinite; }
.ai-pet-button[data-action="sleep"] .ai-pet-svg { animation: ai-dino-sleep 2.4s ease-in-out infinite; opacity:.8; }
.ai-pet-button[data-action="celebrate"] .ai-pet-svg { animation: ai-dino-celebrate 650ms ease-in-out infinite; }

/* 新增：运行状态覆盖（比上面多一个 class，优先级更高） */
.ai-pet-button.thinking .ai-pet-svg { animation: ai-pet-run 320ms steps(2, end) infinite; }   /* 高频奔跑 */
.ai-pet-button.thinking .ai-pet-face { animation: ai-pet-face-pulse 700ms ease-in-out infinite; } /* 面部脉冲 */
.ai-pet-button.happy .ai-pet-svg { animation: ai-pet-happy 500ms ease-in-out 3; }             /* 庆祝跳跃 */
.ai-pet-button.error .ai-pet-svg { animation: ai-pet-shake 300ms ease-in-out infinite; }      /* 抖动 */
.ai-pet-button.error .ai-pet-face { animation: none; }
.ai-pet-button.error .ai-pet-eye { fill: var(--app-danger); }                                /* 眼睛变红 */
.ai-pet-button.sleeping .ai-pet-svg { animation: ai-dino-sleep 2.4s ease-in-out infinite; opacity:.72; }
```

> 当前 CSS 已有一半规则（thinking 高频奔跑、happy、error 眼睛、sleeping），只需**统一补全** `error` 抖动、`thinking` 面部脉冲，并确保四预设共用 `.ai-pet-face` 结构。

### 4.4 状态机触发逻辑（editor.js 改动）

```javascript
function setPetState(nextState) {
  if (!elements.aiPetBtn) return;
  elements.aiPetBtn.classList.remove('thinking', 'happy', 'error', 'sleeping');
  if (nextState !== 'idle') elements.aiPetBtn.classList.add(nextState);
  // title 逻辑保留
  clearTimeout(petIdleTimer);
  if (nextState === 'idle') {
    petIdleTimer = setTimeout(() => setPetState('sleeping'), 2 * 60 * 1000);
  }
}
```

**改动点：**
1. `#aiPetBtn` 点击时（`toggleAiChatPanel` 入口）增加 `setPetState('idle')` → **修复 sleeping 点击不唤醒**（缺口 #4）
2. `setPetState('idle')` 时清除 `data-action` 之外的一切 → 恢复用户配置动作（CSS 自动处理，无需 JS）
3. 保留现有触发点：thinking（[sendAiMessage L1062](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L1062)）、happy（[finishAiRequest L1086](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L1084-L1089)）、error（[catch L1101-L1106](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L1101-L1106)）、sleeping（idle 定时器）

### 4.5 六个动作触发逻辑检查结论

| 动作 | 触发逻辑 | 状态机对应 |
|---|---|---|
| `run` 奔跑 | ✅ 设置页 select → 广播 → data-action | idle 默认 |
| `wave` 挥手 | ✅ 同上 | idle 默认 |
| `jump` 跳跃 | ✅ 同上 | idle 默认 |
| `think` 思考 | ✅ 同上 | idle 默认（用户选）**且** thinking 状态（自动） |
| `sleep` 打盹 | ✅ 同上 | idle 默认（用户选）**且** sleeping 状态（自动） |
| `celebrate` 庆祝 | ✅ 同上 | idle 默认（用户选）**且** happy 状态（自动） |

**结论：六个动作触发链路全部存在且完整 ✅；本次补上"运行状态自动切换到对应动作渲染"的联动，并修复 sleeping 点击唤醒。**

---

## 5. 设置页样式优化

### 5.1 预设卡片（mascot-preset）

```css
.mascot-preset {
  width: 64px; padding: 8px 4px 6px;
  border: 2px solid transparent;            /* 粗选中描边 */
  border-radius: 14px;                       /* 更圆 */
  background: var(--surface);
  transition: transform .15s ease, border-color .15s ease, box-shadow .15s ease;
}
.mascot-preset:hover { transform: translateY(-2px) scale(1.04); box-shadow: 0 4px 12px rgba(0,0,0,.08); }
.mascot-preset.active {
  border-color: var(--mascot-color);
  background: color-mix(in srgb, var(--mascot-color) 10%, var(--surface));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--mascot-color) 18%, transparent);
}
.mascot-preset svg { width: 36px; height: 36px; filter: drop-shadow(0 2px 3px rgba(0,0,0,.12)); }
```

### 5.2 预览区（mascot-preview）

- 预览区 `min-height` 略增（132px → 150px），居中
- 预览区背景加极淡的 `--mascot-color` 渐变底（增加展示质感）
- 预览的六个动作动画沿用现有 `mascot-bounce/wave/jump/think/sleep/celebrate` 关键帧（已存在，仅微调参数使其与编辑器一致）
- `#mascotActionLabel` 底部状态文案保留

### 5.3 清理死代码

- 删除 `@keyframes ai-pet-think`（[editor.css L1318](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/styles/editor.css#L1318)）
- 删除 `generateMascotIcon()` / `mascotPrompt` 遗留死代码（可选，本期不强求）

---

## 6. 涉及文件与改动清单

| 文件 | 改动 |
|---|---|
| `frontend/js/settings.js` | `buildMascotSvg()` 重写四个预设 SVG（圆润造型 + `ai-pet-figure`/`ai-pet-face` 结构）；`MASCOT_PRESETS` 配色保留 |
| `frontend/editor.html` | 宠物按钮默认 SVG 更新为新版恐龙造型（与预设一致）；`#aiPetBtn` 增加点击唤醒 |
| `frontend/js/editor.js` | `applyMascotPreference()` 兜底 SVG 同步更新；点击 `#aiPetBtn` 时 `setPetState('idle')`；确认 thinking/happy/error/sleeping 触发点保留 |
| `frontend/styles/editor.css` | 新增 `.ai-pet-face` 动画（面部脉冲）；补 `error` 抖动；`thinking` 面部脉冲；删 `ai-pet-think` 死代码；`.ai-pet-button` 尺寸微调（25→26px 可选） |
| `frontend/settings.html` | `.mascot-preset` / `.mascot-preview` 样式优化（圆角、选中态、hover、阴影） |

> 注意：`dist-electron/win-unpacked/resources/` 下存在同名构建副本，**生产环境需重新打包**才会生效（开发时改 `frontend/` 即可）。

---

## 7. 验证方式

1. **设置页四预设预览**：四个预设卡片圆润可爱、hover/选中态明显，预览区随动作切换动画
2. **编辑器应用**：设置页选择任意预设 → 编辑器宠物立即更换造型与配色
3. **六动作切换**：设置页切换六个动作 → 编辑器宠物 `data-action` 动画对应变化
4. **状态机联动**：
   - 发送 AI 消息 → 宠物进入 thinking（高频奔跑 + 面部脉冲）
   - 收到回复 → 宠物进入 happy（庆祝跳跃）1.8s 后回 idle
   - 停后端再发消息 → 宠物 error（抖动 + 眼睛变红）
   - 闲置 2 分钟 → sleeping（打盹）；**点击宠物 → 唤醒回 idle**（本次新增）
5. **四预设动作一致性**：四个预设在六个动作下都有贴合渲染（整图动画对全部预设生效）
6. **回归**：上传自定义图标（`iconType=upload`）不受影响；历史列表"使用/删除"正常

---

## 8. 风险与注意事项

- **SVG 重绘工作量**：四个 SVG 需手工调整路径，是本次主要工作量；建议在设置页预览直接肉眼验收
- **CSS 优先级**：运行状态覆盖选择器 `.ai-pet-button.thinking .ai-pet-svg`（2 个 class）天然高于 `[data-action]`（1 个 attribute），无需 `!important`；但需验证与 `happy`/`error`/`sleeping` 的叠加顺序
- **`--mascot-color` 兼容**：重绘 SVG 必须全部使用 `var(--mascot-color)` 才能被编辑器实时改色；纯色硬编码会失去配色联动
- **浏览器兼容**：`color-mix()` 需现代浏览器；已有代码在用，保持即可
- **生产打包**：改完需重新构建（`npm run build` / electron-builder）才能在桌面端生效

---

## 9. 参考

- 现状：`setPetState()`（[editor.js L907-L917](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L907-L917)）、`applyMascotPreference()`（[editor.js L82-L98](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L82-L98)）、`buildMascotSvg()`（[settings.js L273-L281](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/settings.js#L273-L281)）
- 现有宠物动画关键帧（[editor.css L1279-L1320](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/styles/editor.css#L1279-L1320)）
- 设置页预设/预览样式（[settings.html L500-L546](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/settings.html#L500-L546)）
