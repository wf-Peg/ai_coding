# 收件箱页视觉重设计（借鉴 Cubox/NoteGen）+ 删除主题切换按钮与「待办」快捷记录

## Summary

收件箱页（frontend/clip.html，嵌入父窗口 index.html 的 iframe）目前视觉偏「工具感」：header 居中挤压、4 组大按钮噪音、列表为重边框大卡片（24px padding + meta pill 常驻），缺少内容层级与留白节奏。本次重设计对齐 Cubox 与 NoteGen：

- **布局形态**：单栏精致化（用户确认）——父窗口已有主导航，页内不再引入第二层侧边栏
- **视觉气质**：品牌蓝精致升级（用户确认）——保留 `--app-primary #2383e2`，只学 Cubox/NoteGen 的留白、圆角、阴影、排版节奏；**不动全局 design-tokens.css**，不影响其它模块 iframe
- **列表形态**：精简列表行（用户确认）——Cubox reader 式：类型/分类/状态徽标 + 摘要 + 来源时间一行 meta，悬停浮现操作按钮
- **删除**：① 剪藏区右上角「切换风格」按钮（`#themeToggle`）② 快速记录中的「待办」按钮
- **流程**：用户要求「设计页面先出让我评审」——先产出一份**独立设计评审原型页**，用户评审通过后再落地正式文件

## 当前状态分析（探索结论）

页面纵向结构（frontend/clip.html）：
1. `header` L212-269：居中 h1 + 副标题 + 4 组 `action-split-group`（Git配置/同步仓库、整理今日、周报、整理收件箱）+ web clipper 状态 + `#toggle-btn` 信息检索切换；右上角 `#themeToggle` 主题切换按钮（L214-216）
2. `#recordEntry`（L271-301）：compose 记录条 + 5 个快速记录按钮（文本/插图/链接/待办/OCR）
3. `#add-clip-section`（L323+）：默认折叠的大表单，`form-head` + 字段区 + 图片上传
4. `#daily-review`（L440-450）：每日回看横幅
5. `#clip-list`（L452-467）：list-header（问库按钮 + workflow-filter 下拉 + count）+ `#clip-items` 列表
6. 浮动批量操作栏 `#float-bar`（L478-499）

关键代码事实：
- `#themeToggle` 接线：[clip-shared.js L602-607](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/clip-shared.js#L602-L607) click 监听 → `applyTheme(getNextThemeId(currentTheme))`；`updateThemeToggleLabel()`（L270-276）内部有 `getElementById('themeToggle')` 空守卫，删除按钮后留函数体安全。`applyTheme` 的「从 localStorage 应用主题」逻辑需保留（用户已选主题仍生效），只是移除切换入口
- `quickRecord('todo')`：clip-form.js 中 `todo` 分支与按钮 onclick；删除按钮与分支后，store-only textarea 默认态不受影响（todo 与 store-only 同为 store-only type）
- `renderClipItem` 模板：[clip-list.js L436-600+](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/clip-list.js#L436-L600)。内部使用类名 `check-area / clip-actions / expand-btn / clip-summary / clip-meta / meta-item / tags-display / clip-detail` 均有 JS 事件钩子与 CSS 依赖。**落地时保留全部类名与 onclick，只重排 DOM 顺序与视觉类**
- 列表容器样式：clip.css L988-1040（.clip-list/.list-header/.list-controls/.clip-checkbox）、.clip-item L1332-1370（24px padding 白卡 + 边框 + hover 上浮）、.clip-meta pills L1400-1431、badges L1433+、status badge L3915-3940、每日回看 L3700-3752
- header 相关样式：clip.css L166-195（header/h1/subtitle/toggle-container）、.action-split-group L395-415、.clip-theme-toggle L357-393 及响应式 L521-529/L554-562
- 官网：website/index.html Hero mock L471-493、快速上手②文档、footer v1.0.15

## 变更内容

### 阶段 A —— 设计评审原型（先交付给用户评审）

新增 **`design-prototype/inbox-redesign-review.html`**（独立单文件，唯一新文件）：

- `<head>` 引正式变量：`../frontend/styles/design-tokens.css`（保证用真实 token，评审所见即落地所得）
- 顶部浮动评审工具条（透明底 pill）：标题「收件箱重设计 · 评审稿 v1」+ 主题切换（明亮 / 纸感 / 暗色）——用 `document.documentElement.setAttribute('data-theme', …)` 切换，验证三套主题下都成立
- 三个视图区块（纯静态 mock DOM + 少量原型 CSS，无业务 JS）：
  1. **主视图（默认折叠态）**：新 header（左对齐标题行 + 右对齐紧凑工具栏）+ compose 记录条 + 4 枚快速记录 chips + 每日回看横幅 + 精简列表行 ×5（含 hover 浮现操作、选中态、状态 badge 三色）
  2. **剪藏表单展开态**：form-head + 类型/来源/分类/标签/思考 + 图片上传占位
  3. **批量选择态**：行选中样式 + 底部浮动操作条
- 每视图旁加小字设计注记（改动点），方便评审逐项对
- 不修改任何正式文件

评审通过（用户确认）后进入阶段 B；若用户提出修改，先改原型再评审，直到通过。

### 阶段 B —— 落地正式文件

#### B1. 删除主题切换按钮（3 个文件联动）

**frontend/clip.html**
- 删除 L214-216 `<button class="clip-theme-toggle" id="themeToggle">…</button>`

**frontend/styles/clip.css**
- 删除 `.clip-theme-toggle` 基础样式块（L357-393）及其响应式块（L521-529、L554-562 中 `.clip-theme-toggle` 相关行）

**frontend/js/clip-shared.js**
- 删除 DOMContentLoaded 中 L602-607 的 `themeToggle` click 监听；`applyTheme`（L278-292）与 `updateThemeToggleLabel`（L270-276，含空守卫）原样保留，保证存储主题仍生效、切主题消息仍响应

#### B2. 删除「待办」快捷记录（2 个文件）

**frontend/clip.html**
- 删除 `record-entry` 内 `quickRecord('todo')` 按钮节点（clip.html L288-292 附近）

**frontend/js/clip-form.js**
- `quickRecord(mode)` 中删除 `else if (mode === 'todo')` 分支；保留 `store-only` 分支（待办与“稍后整理”同为 store-only 类型，合并后的分支已覆盖）

#### B3. Header 精致化（clip.html 结构调整 + clip.css 重写样式）

结构（功能按钮集合与 onclick 全部保留，仅重排与换视觉）：
1. `header` 改为**单行**：`header-main`（flex space-between，左品牌簇 .brand-cluster / 右工具栏 .action-row）：
   - **左侧（brand-cluster）**：`<h1>收件箱</h1>`（21px/700，左对齐）+ 右侧小 pill「碎碎记 · CutShelter」（bg surface-subtle、radius 999px、12px muted）；长 slogan（brand-sub）已删除，减少文字
   - **右侧（action-row）**：右对齐紧凑 ghost 工具栏：`整理收件箱`（文字主按钮）+ 三个功能组（`配置齿轮 + 功能按钮`）：`⚡整理` / `📄周报` / `🔄同步`（**图标+短文字标签**，保可读性，齿轮作为该功能 Prompt/配置入口)+ `ⓘ` 同步说明 + web clipper 状态点 pill + `#toggle-btn` 信息检索（28px 图标，置最右）
   - **主题令牌一致性**：工具栏全部颜色使用 `var(--app-*)`（primary/primary-soft/border/surface-subtle/text-*），无硬编码色值；toggle active 态用 `--app-primary-soft` 底 + `--app-primary` 字 + soft 外发光；`.action-row .btn-loading::after` spinner 用 `--app-border-strong`/`--app-primary` 令牌色
   - **修复全局 button 拉伸**：clip.css 存在全局 `button { flex:1 1 0%; min-width:140px }`，会让工具栏按钮被强制等宽拉长（每个 140px）→ 在 `.action-row button` 重置 `flex:0 0 auto; min-width:0` 保证内容尺寸单行紧凑
   - **响应式**：≤760px 时 header-main 转 column，品牌行在上、工具栏占满整行右对齐
2. `action-split-group` 保留 DOM 分组（JS 无依赖），视觉改为**无边框聚合**：整体 bg surface-subtle radius 10px 内嵌，内部按钮透明背景、hover 白底
3. 去掉 `.clip-theme-toggle` 占位（已删）；header 高度收敛，与内容间距收紧（margin-bottom 20px → 16px）

CSS 重写点（clip.css L166-195、L395-430 附近）：
- `header { text-align:left }`（覆盖 L172-179 的居中 h1/subtitle）
- `.action-split-group`：去 border/radius 溢出裁剪，改 `background: var(--app-surface-subtle); border-radius: 10px; padding: 3px;` 内嵌式
- `#toggle-btn` 去 `margin-left:auto`（动作行已右对齐），保留末位
- subtitle 13px muted 750 字重以内

#### B4. 记录入口升级（clip.css）

- `.compose-entry`：背景 `var(--app-surface-subtle)`、边框 `transparent`、radius 12px；hover：bg → surface、border → `var(--app-border)` + `box-shadow: var(--app-shadow-sm)`；保留右侧 kbd
- `.quick-record-btn` 改为 chip：radius `999px`、padding `7px 13px`、bg `var(--app-surface-subtle)`、border transparent、label 12.5px/500；hover：bg `var(--app-primary-soft)`、color `var(--app-primary)`、`translateY(-1px)`，过渡 `var(--app-duration-fast) var(--app-ease-smooth)`
- 间距：record-entry gap 8px 保持；chips gap 8px

#### B5. 列表改「精简列表行」（clip.css 主 + clip-list.js 模板微调）

**frontend/styles/clip.css**
- `#clip-items`/`.clip-items`：`display:flex; flex-direction:column; gap:8px`
- `.clip-item` 行式：
  - `padding: 14px 14px 14px 12px; border-radius: 12px; background: transparent; border: 1px solid transparent;`
  - 左侧指示条：`::before`（3px 宽、圆端渐变 `var(--app-primary)`、`opacity:0`、hover/selected `opacity:1`）
  - hover：`background: var(--app-surface-subtle)`，**去掉原 `translateY(-2px)` 上浮**（L1366-1370 改为平移动效弱化）
  - 选中态（含 dark 覆写 L3329-3330）：`background: var(--app-primary-soft)`
- `.clip-header` 改纵向堆叠不稳定：模板微调后 header 只保留**操作浮层**（见下）
- `.clip-summary`：字号 14.5px/600 标题感、`line-height 1.55`、2 行截断（`-webkit-line-clamp:2`），store-only 摘要降权（muted 500）
- `.clip-meta` 与 `.meta-item`：**去掉 pill 化**（不再 bg/border/radius16），改纯文本行：`font-size 12px; color var(--app-text-muted); gap 8px 12px`，与类型/状态/分类徽标区分
- `.clip-actions`：**悬停浮现**——默认 `opacity:0; transform: translateX(4px)`，`.clip-item:hover` 时 `opacity:1; translateX(0)`；保证触屏/窄屏下常显（≤768px `opacity:1`）
- `.category-badge/.thoughts-badge/.anno-badge/.knowledge-badge`：统一收敛为 12px chip（radius 999px、padding 3px 10px、bg surface-subtle），分类 chip 保 primary 浅蓝
- `.clip-thumb` 行样式：原横条（L537）在模板中改放行右侧
- 保留 `.clip-item-removing` 删除动画（L1342-1346）、`.clip-checkbox` 圆形选择（L1006-1040）
- 每日回看横幅（L3700-3752）：bg 改 `linear-gradient(90deg, var(--app-primary-soft), transparent 70%)`、border `var(--app-primary-soft)`、radius 14px，icon 圆底 primary
- 列表头 `list-header/list-controls`：`workflow-filter` 精致化（radius 10px、bg surface-subtle、border transparent、padding 7px 12px）+ `clip-count` 改 pill

**frontend/js/clip-list.js**（renderClipItem 模板 L507-546 微调，**保留全部类名与 onclick**）
- 模板重排为：
  - 首行（flex）：`check-area` + `clip-header-left`（类型 icon+label、category-badge、statusBadge、thoughts/anno/knowledge badge）；`clip-actions`（more-actions-wrapper + expand-btn，结构不动）
  - 内容行：右侧 `clip-thumb`（若 imagePaths 存在，48px 圆角缩略图）
  - `.clip-summary`（2 行 clamp）
  - `.clip-meta`（类型/流程/分类 → 保留字段但视觉即文本行；来源 + 创建时间）
  - `tagsHtml` / `clip-detail`（原样保留）
- 保持函数内所有 `querySelector('.clip-item')` 依赖的语义（删除/展开/更多/批量）不变

#### B6. 官网同步（website/index.html）

- Hero mock（L471-493）：`.mock-item` 从「带边框卡片」改为「无边框分隔行」——去 border+shadow，改 `border-bottom: 1px solid var(--app-border)` + 圆角 hover 底；`.mock-compose` 保留
- 快速上手 ② 文案：5 种 → 「文本 / 插图 / 链接 / OCR」
- footer 版本号 `v1.0.15` → `v1.0.16`

## 范围外（明确不做）

- 不动 `design-tokens.css` / `ui-common.css` 全局、不动其它模块 iframe
- 不改变按钮数量之外的交互结构：4 组动作按钮、信息检索切换、批量操作、删除动画/撤销、每日回看逻辑全部保留
- 不做列表/卡片视图切换开关、不做筛选 chips 的 JS 重构（workflow-filter 仅视觉精致化）
- 不改 backend；demo.html 不动（除 Hero mock 外）

## 假设与决策

- 主题切换入口删除后，用户已选主题继续从 localStorage 生效；「设置」页等其它入口不补开关（本次明确只删收件箱右上角按钮）
- 「待办」从快速记录删除后，剪藏页不再提供一键建待办入口（不影响 todo.html 独立模块）
- 行式列表的 hover 操作浮现仅桌面端生效；≤768px 常显操作按钮保证可用性
- 评审原型页保留在 design-prototype/ 作为设计档案，不删除

## 验证步骤

1. **阶段 A 验收**：浏览器打开 `design-prototype/inbox-redesign-review.html`，三主题下检查三视图渲染；交付用户评审，按反馈迭代
2. **阶段 B 落地后语法**：`node --check frontend/js/clip-form.js frontend/js/clip-list.js frontend/js/clip-shared.js`
3. **浏览器回归**（本地静态服务打开 `frontend/clip.html`，后端 8081 不可达的错误 toast 忽略）：
   - 主题切换按钮已消失；右上角布局整洁；快速记录只剩 4 枚（无「待办」）
   - 列表为行式：hover 浮现操作、选中样式、左侧指示条；状态 badge 三色正常
   - 折叠/展开表单、提交后自动收起、信息检索切换、批量整理/删除（撤销 toast、删除动画）、每日回看、AI 问库全链路正常；≤768px 操作按钮常显
   - 明亮/纸感/暗色三主题下视觉自检
4. **官网**：打开 `website/index.html`，Hero mock 行为、快速上手文案（4 种）、footer v1.0.16