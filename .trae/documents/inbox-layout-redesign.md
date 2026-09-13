# 收件箱布局重设计：折叠式记录条 + 列表为主区，并同步官网

## Summary

重设计剪藏页（收件箱）布局：把恒展开、占据首屏的大表单（`#add-clip-section`）默认折叠成一条「记录入口」（compose 记录条 + 快速记录按钮），点击后表单在页面内原位平滑展开、列表被推下，可一键收起；提交成功后自动收起回到列表。目标：**高频场景与入口（快速记录、每日回看、收件箱列表、批量操作）成为主显示区**。随后同步更新官网 `website/index.html`（Hero mock + 文档文案 + 版本号）。

形态经用户确认：**原位折叠记录条**（参考 Notion/Logseq compose 风格）。

## 当前状态分析（Phase 1 探索结论）

页面纵向结构（frontend/clip.html）：

1. `header`（L213-269）：标题 + 4 组动作按钮 + Web Clipper 同步 + 切换「添加剪藏/信息检索」
2. `#quickRecordBar`（L272-294）：快速记录 5 按钮（文本/插图/链接/待办/OCR）——已是高频入口，保留
3. `#add-clip-section`（L323-400）：大表单**恒展开**，含内容/类型/来源/分类/标签/我的思考/操作按钮（清空·智能入库·添加剪藏）+ 图片上传区——约 500-600px 高，把列表挤出首屏。**这是要折叠的主体**
4. `#search-section`（隐藏）、每日回看横幅（L425）、`#clip-list`（L437-452，主列表）、浮动批量操作栏（L463）

关键逻辑：

- `quickRecord(mode)`（frontend/js/clip-form.js L54-87）：已做「预置类型 + scrollIntoView + 聚焦」，只需补「先展开表单」
- `toggleMode()`（frontend/js/clip-list.js L51-77）：display 切换添加/检索，与折叠无关，无需改动
- 提交成功收尾 `finishAddClip()`（frontend/js/clip-shared.js L732-756）：刷新列表并滚动到列表——在此补「收起表单」即可形成「提交后回列表」闭环
- DOMContentLoaded 初始化（clip-shared.js L585+）不依赖表单可见性，安全

官网 website/index.html：

- Hero 收件箱 mock（L444-485）：侧栏 + 列表卡片 + 浮动操作条，无「记录入口」层
- 文档：快速上手 ②（L674-676）、收件箱与整理（L728-755）需要与新布局对齐
- Footer 版本号 `v1.0.14`（L908）

## 变更内容

### A. frontend/clip.html

1. **新增记录入口容器**：将 `#quickRecordBar` 所在的 L272-294 块替换为：

   - 外层 `<div class="record-entry" id="recordEntry">`
   - 其下新增**compose 记录条** `<button class="compose-entry" id="composeEntry" type="button" onclick="expandForm('store-only')">`
     - 左侧铅笔 SVG 图标
     - 文案 `写点什么… 输入或粘贴内容，一键记录`（复用 `--app-text-muted` 色，占位样式）
     - 右侧提示徽标 `⌘V 粘贴即存`
   - 保留原有 quick-record 5 个按钮（类名/onclick/图标不变），换 4 个按钮 SVG 尺寸统一 13px

2. **表单默认折叠**：`#add-clip-section` 增加初始 class `form-collapsed`（`<div id="add-clip-section" class="form-collapsed">`），CSS 层实现隐藏。

3. **表单头部新增「收起」控件**：`.clip-form` 顶部（`#success-message` 之前）插入：

   ```html
   <div class="form-head">
     <h3 class="form-title">新建剪藏</h3>
     <button class="form-collapse-btn" type="button" onclick="collapseForm()" title="收起表单">
       <svg ...chevron-up/> 收起
     </button>
   </div>
   ```

### B. frontend/js/clip-form.js

1. 新增 `expandForm(preType)` / `collapseForm()`：

   - `expandForm`：移除 `form-collapsed` class → 重新触发 `fadeInUp` 动画（先 `animation: none` 强制重排再恢复）；若传 `preType` 则设置 type 并 `handleTypeChange()`；`section.scrollIntoView({behavior:'smooth', block:'start'})`；`setTimeout(→ content.focus(), 250)`
   - `collapseForm`：加回 `form-collapsed` class，滚动列表不强制（自然回到列表位置）

2. `quickRecord(mode)`：函数体首行调用 `expandForm(mode 映射的 type)`（内部已处理滚动与聚焦），删除原有单独的 `scrollIntoView` 与 `setTimeout` 聚焦（避免重复），保留其余逻辑。注意：`ocr` 分支仍走「展开 + 点击文件选择」逻辑。

3. 新增 `#composeEntry` 绑定（inline onclick 已指向 `expandForm('store-only')`，无需额外监听）。

### C. frontend/styles/clip.css

1. `.form-collapsed { display: none; }`
2. `.clip-form` 展开动画处理：扩展示通过 `.clip-form` 已有 `fadeInUp`；为避免 class 移除后动画不重放，用 `.clip-form` 上加 `form-expanded` 辅助 class 触发（或 JS 重置 animation）。实现选择：JS 里 `el.style.animation='none'; void el.offsetWidth; el.style.animation='';` 方式最简单，CSS 不动动画。
3. 新增 `.record-entry`（内联 flex 容器，gap 8px，padding `8px 24px 12px`）与 `.compose-entry` 样式：
   - 宽度 100%、圆角、`1px solid var(--border)`、背景 `var(--surface)`、`box-shadow var(--shadow)`
   - hover：`border-color var(--primary)`、背景 `var(--primary-light)`、轻微上浮 `translateY(-1px)`，过渡用 `var(--app-duration-fast) var(--app-ease-smooth)`（对齐项目动画 token 约定）
   - placeholder 色 `var(--text-muted)`；右侧 `.compose-kbd` 用 `var(--app-surface-hover)` 底 + `border` 圆角小 KBD 样式
4. `.quick-record-bar`：保留原样式，微调为在 `.record-entry` 内换行右对齐/左对齐（保持 `flex-wrap`），无需大改。
5. 新增 `.form-head` / `.form-collapse-btn` 样式（与 modal-header 统一的轻量样式：标题 1rem 600，按钮 text-secondary hover primary）。
6. 响应式：`.record-entry` 与 `.compose-entry` 在 ≤768px/≤480px 下保持不溢出（KBD 可隐藏）。

### D. 提交成功后自动收起 frontend/js/clip-shared.js

在 `finishAddClip()`（L732-756）内 `await fetchClips()` 之后、`scrollIntoView` 之前插入：

```js
if (typeof collapseForm === 'function') collapseForm();
```

形成「提交 → 列表刷新 → 表单收起 → 滚动到列表」闭环（跨文件调用用 typeof 守卫）。

### E. frontend/js/clip-list.js

`toggleMode()` 无需改动（表单折叠与显示切换互不影响；切回添加模式默认显示记录条）。

### F. website/index.html（官网同步）

1. **Hero mock 增加记录入口层**（对齐新布局）：
   - CSS 新增 `.mock-compose` 样式（仿 compose pill：`display:flex; padding:8px 12px; border:1px solid var(--app-border); border-radius:var(--app-radius-sm); background:var(--app-surface); gap:8px`，左侧小铅笔 icon，中间 `#C0C0C0` 占位字「写点什么…」，右侧 KBD 小块 `⌘V`）
   - 在 `.mock-main` 内 `.mock-head` 之前插入一行 `.mock-compose`
2. **文档文案对齐**：
   - 快速上手 ②（L674-676）改为：在「剪藏」页顶部点「快速记录」可一键发起（文本 / 插图 / 链接 / 待办 / OCR），或点记录条展开完整表单
   - 收件箱与整理（L728-755）`doc-grid` 增加一条：**折叠式记录入口**——默认只显示记录条，表单按需展开、提交后自动收起，列表始终是主显示区
3. **版本号**：footer `v1.0.14` → `v1.0.15`（与产品版本节奏一致）

## 范围外（明确不做）

- `website/demo.html`：已是「+ 快速记录按钮 + 列表为主区」的原型形态，语义已一致，不改
- header 四组动作按钮、后端、编辑器/画布/知识图谱：不受影响
- 折叠状态持久化：不做（每次进入默认收起，会话内手动展开）

## 假设与决策

- 默认折叠、无 localStorage 持久化；交互展开后保持到页面会话；提交成功后自动收起（轻量 UX 增强）
- compose 记录条是「假输入框按钮」：点击仅原位展开表单（列表被推下），符合用户选择的形态
- 折叠/展开使用现有主题动画 token（`--app-duration-normal`、`--app-ease-smooth`、`fadeInUp`），不引入新动画系统

## 验证步骤

1. 语法检查：`node --check frontend/js/clip-form.js && node --check frontend/js/clip-shared.js`
2. 浏览器打开 `frontend/clip.html`（本地静态服务）：
   - 首屏默认：记录条 + 5 快速按钮 + 每日回看 + 列表；表单折叠，列表靠近首屏 ✓
   - 点 compose 记录条 → 表单原位展开、滚动、聚焦内容框；点「收起」→ 表单隐藏 ✓
   - 逐个点 5 个快速记录按钮 → 均展开对应类型并聚焦（含 OCR 触发文件选择）✓
   - 提交一条 store-only → 成功后表单自动收起、列表刷新并滚动到列表 ✓
   - 切换「信息检索/添加剪藏」→ 行为正常；删除动画+撤销、批量整理/删除、每日回看、AI 问答弹窗回归正常 ✓
3. 浏览器打开 `website/index.html`：Hero mock 显示记录入口层；文档文案与版本号已更新；640px 响应式不溢出 ✓