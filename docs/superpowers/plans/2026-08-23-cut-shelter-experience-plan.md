# CutShelter Global Experience and Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 CutShelter 的六套全局主题、统一页面骨架和柔和动效落地到所有模块，同时保持 Electron/浏览器模式、业务状态和现有 iframe 架构兼容。

**Architecture:** 保留主页面与 iframe 的过渡架构，以纯逻辑主题核心统一主题名称、动效偏好和消息契约；主页面负责持久化与广播，子页面负责应用令牌。共享 UI CSS 负责基础控件和状态，页面迁移只处理布局与特殊组件，避免继续复制主题分支。

**Tech Stack:** 原生 HTML/CSS/JavaScript、CSS Custom Properties、Electron、Node.js built-in `node:test`、现有 `ui-common.css`、现有 `design-tokens.css`。

**Spec:** `docs/superpowers/specs/2026-08-23-cut-shelter-experience-design.md`

## Global Constraints

- 全局主题集合固定为 `regular`、`notion`、`dark`、`focus`、`calm`、`studio`。
- 主题切换必须同步所有已打开 iframe，Electron 与浏览器模式使用同一消息协议。
- 主题只保存名称和动效偏好，不保存页面临时状态，不触发业务数据重载或索引重建。
- 默认动效为“柔和有感”，标准过渡 180–240ms；编辑器输入、滚动和长文阅读不使用持续动画。
- 必须尊重 `prefers-reduced-motion: reduce`，减少动效时保留必要状态反馈。
- 页面组件使用语义令牌，不新增页面级主题色值分支。
- 每批迁移完成后运行定向测试、`node --check` 和现有前端 smoke；不得修改用户业务数据。
- 不引入 UI 框架、动画依赖或新的运行时服务。

## File Map

- Create: `frontend/js/theme-core.js` — 可在浏览器和 Node 测试中运行的主题规范化、持久化值和消息契约纯逻辑。
- Create: `frontend/js/theme-bridge.js` — 页面初始化、`postMessage`/`storage` 同步和 DOM 主题应用。
- Create: `electron/theme-core.test.js` — 主题核心纯逻辑测试。
- Modify: `frontend/styles/design-tokens.css` — 六套主题和组件语义令牌。
- Modify: `frontend/styles/ui-common.css` — 共享控件、面板状态和动效令牌消费。
- Modify: `frontend/index.html` — 全局主题启动、iframe 广播、统一应用壳和导航状态。
- Modify: `frontend/js/settings.js`, `frontend/settings.html` — 主题选择卡片、动效偏好和全局反馈。
- Modify: all module entry HTML files — 在页面业务脚本前接入主题桥接和共享 UI 样式。
- Modify: module-specific CSS/JS — 只迁移布局、状态和例外组件，删除硬编码主题分支。
- Create/Modify: `scripts/smoke-theme.js` — 六主题入口、静态资源和消息契约 smoke。

### Task 1: Theme Core Contract

**Files:**
- Create: `frontend/js/theme-core.js`
- Create: `electron/theme-core.test.js`
- Modify: `package.json` — add `test:theme` script

**Interfaces:**
- Produces `normalizeTheme(value): string`, returning one of `regular|notion|dark|focus|calm|studio`, defaulting to `notion`.
- Produces `normalizeMotion(value): string`, returning `full|reduced`, defaulting to `full`.
- Produces `resolveAppearance(appearance, systemPrefersDark): string`, where `system` maps to `dark` or `notion` and explicit theme values remain unchanged.
- Produces `buildThemeMessage(theme, motion): { action: "themeChange", theme: string, motion: string }`.
- Produces `readStoredTheme(storage): string` and `readStoredMotion(storage): string`, reading `app_theme_v1` and `app_motion_v1` with safe fallbacks.
- Exports the same functions through `module.exports` in Node and `window.CutShelterThemeCore` in browsers.

- [ ] **Step 1: Write failing normalization tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../frontend/js/theme-core.js');

test('normalizes the six supported themes and falls back safely', () => {
  assert.equal(core.normalizeTheme('studio'), 'studio');
  assert.equal(core.normalizeTheme('unknown'), 'notion');
  assert.equal(core.normalizeTheme(''), 'notion');
});

test('resolves system appearance without exposing system as a DOM theme', () => {
  assert.equal(core.resolveAppearance('system', true), 'dark');
  assert.equal(core.resolveAppearance('system', false), 'notion');
  assert.equal(core.resolveAppearance('focus', true), 'focus');
});

test('builds a version-independent themeChange message', () => {
  assert.deepEqual(core.buildThemeMessage('calm', 'reduced'), {
    action: 'themeChange', theme: 'calm', motion: 'reduced'
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm run test:theme`

Expected: FAIL because `frontend/js/theme-core.js` and the `test:theme` script do not exist.

- [ ] **Step 3: Implement the minimal pure core**

Use constant sets for the six themes and two motion modes. Keep browser globals behind `typeof window !== 'undefined'`; do not access `localStorage`, `matchMedia`, or the DOM in this file.

- [ ] **Step 4: Run focused and syntax checks**

Run: `npm run test:theme` and `node --check frontend/js/theme-core.js`

Expected: all theme core tests pass.

- [ ] **Step 5: Commit the contract**

```bash
git add frontend/js/theme-core.js electron/theme-core.test.js package.json
git commit -m "feat(theme): add global theme core contract"
```

### Task 2: Global Theme Bridge and Settings

**Files:**
- Create: `frontend/js/theme-bridge.js`
- Modify: `frontend/index.html`
- Modify: `frontend/settings.html`
- Modify: `frontend/js/settings.js`
- Modify: `frontend/styles/design-tokens.css`
- Test: `electron/theme-core.test.js` — extend pure persistence/message cases

**Interfaces:**
- `window.CutShelterThemeBridge.init({ root, storage, matchMedia })` applies the stored theme before page initialization.
- `window.CutShelterThemeBridge.apply(theme, motion, { persist })` updates `data-theme`, `data-motion`, and broadcasts `{ action: "themeChange", theme, motion }`.
- The parent frame remains the source of truth; child frames acknowledge with `{ type: "themeReady", theme }`.

- [ ] **Step 1: Add failing bridge contract tests**

Test pure adapter helpers extracted from the bridge: storage keys `app_theme_v1` and `app_motion_v1`, invalid values falling back to `notion/full`, and message payload including both `theme` and `motion`.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `npm run test:theme`

Expected: FAIL for the new storage and motion cases.

- [ ] **Step 3: Implement bridge initialization and parent broadcast**

Move duplicated theme resolution from `frontend/index.html` and `frontend/js/settings.js` into the bridge. Apply the theme synchronously in the document head path, then let the parent broadcast after each iframe load and after each setting change. Keep `system` as an appearance preference only; DOM values must be one of the six theme names.

- [ ] **Step 4: Add settings cards and reduced-motion control**

Replace the single appearance select with six preview cards plus a “跟随系统” option and a “减少动效” switch. Selecting a card updates all frames without reload and shows a shared success Toast.

- [ ] **Step 5: Verify bridge behavior**

Run: `npm run test:theme`, `node --check frontend/js/theme-bridge.js`, `node --check frontend/js/settings.js`, and `node scripts/smoke-theme.js`.

Expected: theme state survives refresh, child frames receive the same payload, and invalid stored values use `notion/full`.

- [ ] **Step 6: Commit global synchronization**

```bash
git add frontend/js/theme-bridge.js frontend/index.html frontend/settings.html frontend/js/settings.js frontend/styles/design-tokens.css electron/theme-core.test.js
git commit -m "feat(theme): synchronize global appearance and motion"
```

### Task 3: Semantic Tokens and Shared Interaction Language

**Files:**
- Modify: `frontend/styles/design-tokens.css`
- Modify: `frontend/styles/ui-common.css`
- Modify: `frontend/js/ui-common.js`
- Test: `scripts/smoke-theme.js`

**Interfaces:**
- All shared components consume `--app-*` semantic variables; no component reads a theme-specific hex value.
- Motion classes use `--app-duration-fast`, `--app-duration-normal`, `--app-duration-panel`, `--app-ease-smooth` and `[data-motion="reduced"]` overrides.
- Shared UI exposes existing Toast/confirm behavior without changing current call sites.

- [ ] **Step 1: Add static token assertions**

Create `scripts/smoke-theme.js` that reads CSS/HTML text and asserts the six theme selectors, semantic variables, `prefers-reduced-motion`, and `theme-bridge.js` script references exist. It must exit non-zero with a descriptive message when a required token is absent.

- [ ] **Step 2: Run the smoke before implementation**

Run: `node scripts/smoke-theme.js`

Expected: FAIL for missing theme selectors and motion attributes.

- [ ] **Step 3: Extend the token matrix**

Add the spec’s color, surface, typography, spacing, radius, shadow, control, editor, drawer, and AI semantic variables for `focus`, `calm`, and `studio`. Keep the existing three themes functional while mapping legacy aliases such as `--background`, `--surface`, `--text`, and `--border` to the new `--app-*` values.

- [ ] **Step 4: Standardize shared states**

Update shared buttons, inputs, cards, modals, drawers, Toasts, empty states, loading states, focus rings, and disabled states to use semantic tokens. Add reduced-motion overrides that remove transforms and infinite animation but retain opacity/color state changes.

- [ ] **Step 5: Run static and syntax validation**

Run: `node scripts/smoke-theme.js`, `node --check frontend/js/ui-common.js`, `git diff --check`.

Expected: smoke passes and no shared component contains new hardcoded theme colors.

- [ ] **Step 6: Commit the design system layer**

```bash
git add frontend/styles/design-tokens.css frontend/styles/ui-common.css frontend/js/ui-common.js scripts/smoke-theme.js
git commit -m "feat(ui): add semantic theme tokens and motion language"
```

### Task 4: Core Workflow Page Migration

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/editor.html`, `frontend/styles/editor.css`, `frontend/js/editor.js`
- Modify: `frontend/workspace.html`, `frontend/styles/workspace.css`, `frontend/js/workspace.js`
- Modify: `frontend/clip.html`, `frontend/styles/clip.css`, `frontend/styles/clip-theme-notion.css`
- Modify: `frontend/settings.html`, `frontend/styles/theme-regular.css`, `frontend/styles/theme-notion.css`
- Test: `scripts/smoke-theme.js`, `electron/editor-ai-chat-core.test.js`

**Interfaces:**
- Each migrated page loads `design-tokens.css`, `ui-common.css`, `theme-core.js`, and `theme-bridge.js` before business scripts.
- Existing editor AI, workspace, clip, and settings behavior remains unchanged; only visual tokens, shared states, and shell integration change.

- [ ] **Step 1: Add page coverage assertions**

Extend `scripts/smoke-theme.js` to assert the four core pages include the shared scripts and contain no `html[data-theme="focus"]`/`calm`/`studio` page-specific override requirement.

- [ ] **Step 2: Run the page smoke to verify missing coverage**

Run: `node scripts/smoke-theme.js`

Expected: FAIL for at least the pages that do not yet load the bridge or shared styles.

- [ ] **Step 3: Migrate the application shell**

Replace duplicated theme initialization in `frontend/index.html` with the bridge, preserve existing frame load broadcasts, and apply the shared top bar/sidebar states. Ensure navigation active state, collapsed sidebar state, global search and notifications use tokens.

- [ ] **Step 4: Migrate editor and AI panel**

Map editor panels, tabs, status bar, context menu, modal, AI chat, streaming state, mascot state, and markdown preview to semantic variables. Keep Ace editor syntax themes separate from application themes; only map editor chrome and selection colors.

- [ ] **Step 5: Migrate workspace and clip**

Map workspace sidebar, overview cards, rules, exclusions, suggestions, kanban columns, drag state, clip forms, clip list, metadata tags, and empty/error states to shared components. Remove duplicated dark-only overrides where a semantic token can represent the same state.

- [ ] **Step 6: Verify core behavior and visuals**

Run: `node scripts/smoke-theme.js`, `npm run test:editor-ai`, `node --check frontend/js/editor.js`, `node --check frontend/js/workspace.js`, `node --check frontend/js/settings.js`.

Manually verify all six themes in Electron and browser mode for navigation, editor typing, streaming AI, workspace drag/drop, clip creation, settings persistence, and no white flash.

- [ ] **Step 7: Commit core migration**

```bash
git add frontend/index.html frontend/editor.html frontend/styles/editor.css frontend/js/editor.js frontend/workspace.html frontend/styles/workspace.css frontend/js/workspace.js frontend/clip.html frontend/styles/clip.css frontend/styles/clip-theme-notion.css frontend/settings.html frontend/styles/theme-regular.css frontend/styles/theme-notion.css scripts/smoke-theme.js
git commit -m "feat(ui): migrate core workflow pages to global themes"
```

### Task 5: Knowledge, Learning, Tools, and Observability Migration

**Files:**
- Modify: `frontend/knowledge.html`, `frontend/knowledge-detail.html`, `frontend/knowledge-editor.html`, `frontend/knowledge-graph.html`
- Modify: `frontend/learning-plan.html`
- Modify: `frontend/pdf.html`, `frontend/tools.html`, `frontend/data-observability.html`, `frontend/vault.html`, `frontend/wiki.html`, `frontend/todo.html`
- Modify: related JS files and `frontend/styles/theme-vault-notion.css`, `frontend/styles/tools.css`
- Test: `scripts/smoke-theme.js`

**Interfaces:**
- Every module uses the same six theme names and shared motion preference.
- Existing module-specific behavior, API endpoints, editor links, charts, graph rendering, and password/vault flows remain unchanged.

- [ ] **Step 1: Enumerate page entry contracts**

Add every module entry HTML and its script/style dependencies to `scripts/smoke-theme.js`. The check must report the exact missing file when a page lacks the bridge or token stylesheet.

- [ ] **Step 2: Run the expanded smoke and capture the migration list**

Run: `node scripts/smoke-theme.js`

Expected: FAIL with the remaining pages and no silent omissions.

- [ ] **Step 3: Migrate knowledge and graph pages**

Replace page-local light/dark colors with semantic variables; preserve graph node palette as data visualization colors, but make canvas background, toolbars, cards, and dialogs theme-aware.

- [ ] **Step 4: Migrate learning and task pages**

Map learning progress, timeline, task states, tags, editors, and link pickers to semantic controls. Ensure learning-specific status colors remain distinguishable in `dark`, `focus`, and `studio`.

- [ ] **Step 5: Migrate tools, PDF, vault, wiki, and observability**

Map charts, code blocks, import panels, password forms, tables, exception logs, and diagnostic modals. Keep data visualization hues accessible against each theme surface.

- [ ] **Step 6: Verify all module scripts and states**

Run: `node scripts/smoke-theme.js`, `node --check frontend/js/data-observability.js`, `node --check frontend/js/tools-core.js`, `node --check frontend/knowledge.js`, `node --check frontend/knowledge-detail.js`, `node --check frontend/knowledge-graph.js`.

Manually verify loading, empty, error, modal, form focus, chart, and narrow-screen states for all six themes.

- [ ] **Step 7: Commit secondary migration**

```bash
git add frontend/knowledge.html frontend/knowledge-detail.html frontend/knowledge-editor.html frontend/knowledge-graph.html frontend/learning-plan.html frontend/pdf.html frontend/tools.html frontend/data-observability.html frontend/vault.html frontend/wiki.html frontend/todo.html frontend/js frontend/styles
git commit -m "feat(ui): migrate knowledge learning and tools pages"
```

### Task 6: Accessibility, Visual Regression, and Release Verification

**Files:**
- Modify: `scripts/smoke-theme.js`
- Create: `docs/superpowers/self-test/global-theme-ux-checklist.md`
- Modify: `docs/superpowers/specs/2026-08-23-cut-shelter-experience-design.md` — record final acceptance evidence
- Test: `electron/theme-core.test.js`, existing editor tests, backend regression suite

**Interfaces:**
- The checklist becomes the release gate for six themes, two runtimes, reduced motion, and core state transitions.
- No visual regression command may mutate business storage or application indexes.

- [ ] **Step 1: Add reduced-motion and accessibility assertions**

Extend the smoke to assert the reduced-motion media query, visible focus styles, labels/aria attributes on theme cards, and a keyboard path from navigation to theme selection.

- [ ] **Step 2: Run accessibility smoke and verify any failures**

Run: `node scripts/smoke-theme.js`

Expected: FAIL until all theme cards and shared controls expose labels and focus states.

- [ ] **Step 3: Write the manual visual checklist**

Record a matrix for `regular`, `notion`, `dark`, `focus`, `calm`, `studio` across desktop/browser and these flows: open app, switch page, open editor tab, type, open AI panel, stream response, open workspace, drag kanban card, create clip, open settings, switch theme, trigger error, use reduced motion.

- [ ] **Step 4: Run the complete validation suite**

Run: `node scripts/smoke-theme.js`, `npm run test:editor-all`, `npm run test:editor`, `mvn -q test` from `backend/`, and `git diff --check`.

Expected: theme smoke and JavaScript tests pass; any pre-existing unrelated backend failure must be recorded instead of hidden.

- [ ] **Step 5: Perform Electron/browser smoke**

Launch the desktop app and browser frontend separately. Verify theme synchronization across already-open iframes, refresh persistence, no white flash, sidebar collapse, modal focus trap, reduced motion, and AI/editor behavior.

- [ ] **Step 6: Update acceptance evidence and commit**

```bash
git add scripts/smoke-theme.js docs/superpowers/self-test/global-theme-ux-checklist.md docs/superpowers/specs/2026-08-23-cut-shelter-experience-design.md
git commit -m "test(ui): add global theme and motion acceptance checks"
```

## Completion Criteria

- All six themes render across every module entry page.
- Theme choice and motion preference persist across refresh, Electron restart, and browser mode.
- All open iframe pages receive the same `themeChange` payload.
- Core controls and state feedback use semantic tokens, with no new page-specific theme branches.
- Reduced motion works through both system preference and application setting.
- Core editor/workspace/clip/settings behavior remains functional.
- Theme smoke, JavaScript tests, backend regression, and manual Electron/browser checks are recorded in the acceptance checklist.
