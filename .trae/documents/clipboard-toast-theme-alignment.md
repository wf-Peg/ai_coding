# 剪贴板复制提示贴合全局主题 + 通知类弹层对齐

## Summary
浏览器插件端（clip.html + clip-main.js）的「已复制到剪贴板」提示及同类的通知/错误提示，目前存在与全局主题（Project 主题 primary 蓝色系）不一致的问题。本计划把这三类提示统一收敛到主题变量上，使其风格对齐、好看且可维护。

## Current State Analysis

### 全局主题变量（来源）
- 剪藏页 [clip.html](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/browser-extension/clip.html#L15-L43) 内联 `:root` 定义了主题变量：
  `--primary:#3f8cff`、`--primary-light:#73b2ff`、`--primary-dark:#2f72d8`、`--surface:#ffffff`、`--text:#1f2937`、`--text-secondary:#6b7280`、`--border:#e5e7eb`、`--success`、`--error`、`--radius:8px`、`--shadow`、`--shadow-hover`、`--transition` 等。
- Notion 风格通过 [clip-theme-notion.css](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/browser-extension/styles/clip-theme-notion.css#L271-L281) 做 `disabled` 覆盖（`applyTheme` 动态开关）。
- 提示所用的 `--card` / `--fg` 变量在剪藏页 inline `:root` 中 **并未定义**（只在 theme-regular.css / theme-notion.css 中存在），这是 toast 回退成深色 `#1e1e1e/#d4d4d4` 而脱主题的根因。

### 待对齐的提示元素
1. **复制 Toast** — `showToast(msg)`（clip-main.js:1071-1080）
   - 纯 `style.cssText` 内联，引用不存在的 `var(--card)`/`var(--fg)`，需重构为基于 `:root` 主题变量的类样式。
   - 被多处复用：复制成功「已复制到剪贴板！」、表单校验「请输入内容/链接URL」「请上传文件」等。
   - 动画 keyframes `extSlideIn/extSlideOut` 已存在于 clip.html:1705-1706。
   - 注意：`t.textContent = msg` 会清空 innerHTML，图标需用 CSS `::before` 实现，避免丢失（符合项目既有经验）。

2. **顶部通知栏** — `notification-bar`（clip.html:1884-1896）
   - 背景渐变 `linear-gradient(135deg, var(--primary), var(--accent))`，其中 `--accent` 为绿 `#10b981`，偏离蓝色主色系 → 改为 `var(--primary) → var(--primary-dark)`。
   - 内联按钮 `open-folder-btn`、`close-notification-btn` 为内联样式，改为基于主题变量的类/保留内联但收敛到主题 token。

3. **错误提示** — `showError(title, message)`（clip-main.js:1164- 起）
   - 硬编码红色 `rgba(239,68,68,0.95)`、内联排版，与主题风格割裂 → 收敛到 `var(--error)` / `var(--surface)` 等 token，统一圆角/阴影/动效口径。

### 不在本次改动范围
- `success-message`（表单提交中的琥珀色“处理中”状态）属于提交态视觉，非全局通知，暂不调整（如需可后续单列）。

## Proposed Changes

### 1. clip.html — 新增 Toast 主题化样式类（去掉硬编码）
在 `<style>` 内（`@keyframes extSlideIn/extSlideOut` 附近）增加：
- `.ext-toast`：固定定位 `top:20px; right:20px`，`display:flex; align-items:center; gap:8px`，背景 `var(--surface)`，文字 `var(--text)`，边框 `var(--border)`，圆角 `var(--radius)`，阴影 `var(--shadow-hover)`，字体 `13px; font-weight:500`，`animation: extSlideIn 0.3s ease-out`。
- `.ext-toast--success / --error / --info`：通过 `::before` 绘制左侧图标（圆形底色 + 对号/叹号），图标色用 `var(--primary)` / `var(--error)` / `var(--text-secondary)`，底色用同色系浅色（沿用 blue 族，`--primary-light` 或新增 `--primary-soft:#e6f0ff`）。
- `extSlideOut` 沿用已有 keyframes。

### 2. clip-main.js — 重构 `showToast`
- 增加可选类型参数 `showToast(msg, type = 'info')`。
- 用 `t.classList.add('ext-toast', 'ext-toast--' + type)`，不再使用 `style.cssText`。
- `t.textContent = msg` 保持（图标由 `::before` 承担，不丢）。
- 复制成功场景改为 `showToast('已复制到剪贴板！', 'success')`；表单校验类保持 `showToast('请输入内容')`（info）或显式传 `type`。

### 3. clip.html — 顶部通知栏渐变对齐蓝色主色系
- `notification-bar` 内联 `background: linear-gradient(135deg, var(--primary), var(--accent))` → `linear-gradient(135deg, var(--primary), var(--primary-dark))`。
- `open-folder-btn` / `close-notification-btn` 内联色值收敛到主题 token（white + `var(--primary)`），保持功能不变。

### 4. clip-main.js — `showError` 对齐主题
- 背景由 `rgba(239,68,68,0.95)` → `var(--error)`（或保留语义红，但圆角/阴影/字号沿用 `var(--radius)` / `var(--shadow-hover)`）。
- 内部排版微调为与 toast/alarm 一致的口径（图标、间距、关闭按钮 hover），不改变调用方。

### 5. 边界确认
- 仅在浏览器插件端生效，不涉及 frontend/桌面端（桌面端已有独立 theme-tokens，`ui-common.css` 已对齐）。
- 改动后回归验证 regular 与 notion 两种主题下 toast/通知栏/错误提示均显示正常。

## Assumptions & Decisions
- **不新增色相**：错误仍用语义红（`--error`），成功/信息用 primary 蓝色系（符合 Project 硬性约束「不引入新色相」）。
- **图标用 CSS `::before`**：规避 `textContent` 重置导致图标丢失（对应当前已知经验）。
- **改用主题变量优先**：删除/替换 `--card`、`--fg` 这类在剪藏页未定义的变量引用。

## Verification
1. 打开浏览器插件剪藏页，复制一段内容 → 触发「已复制到剪贴板！」toast，肉眼确认背景为白/浅色、图标为 primary 蓝、从右侧滑入。
2. 提交表单留空 → 触发「请输入内容」info toast，类型区分正确。
3. 触发一次错误（如无内容快速整理）→ `showError` 红色提示风格与主题一致。
4. 切换 Notion 风格（`themeToggle`）→ 三组提示均随主题自适应，`clip-theme-notion.css` 的通知栏覆盖仍生效。
5. 浏览控制台无 CSS 变量报错（`--card/--fg` 不再被引用）。