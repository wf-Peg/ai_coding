# 首装上手引导卡 + 设置页重构 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把首装自带的 config 窗口升级为 V3 风格的「清单式上手引导卡」（存储路径唯一必填红、AI Key 可跳过后补、端口收进高级折叠卡），并把设置页左栏重构为置顶「工作区」分组 + 其余分组按优先级重排 + 必填标红 + 随时可重播引导。

**Architecture:** 抽一个自包含、无依赖、自带注入 `<style>` 的共享引导渲染器 `frontend/js/guide-core.js`（暴露 `window.CutShelterGuide.render(container, spec)`），同时被首装窗口 `electron/config.html`（file://，随 `.` 同源加载）与设置页 `frontend/settings.html`（http://）复用，规避跨 source 主题/样式漂移。设置页重构完全基于「移动 DOM 分组 + 增删 data-driven 导航项」，因导航绑定与 settings.js 字段绑定都靠固定 id，移动不破坏逻辑。

**Tech Stack:** 原生 HTML/CSS/JS（ES5，无依赖）；Electron BrowserWindow（config 窗口）；既有 `--app-*` 设计令牌 + `html[data-theme]` 主题体系；`api.*` preload 通道（保持现有 IPC 契约不变）。

---

## 任务总览

| # | 交付 | 文件 |
|---|------|------|
| 1 | 共享引导渲染器 guide-core.js | 新增 `frontend/js/guide-core.js` |
| 2 | 首装窗口 V3 化 + 卡片化（含主题、必填红、AI 卡、高级端口卡） | 改造 `electron/config.html` |
| 3 | 设置页置顶「工作区」分组 + 必填标红 + 引导重播横幅（阶段 1 最小闭环） | 改造 `frontend/settings.html` |
| 4 | 设置页完整 8 分组重排 + AI 与模型/集成拆分（阶段 2） | 改造 `frontend/settings.html` + 微调 `frontend/js/settings.js` |
| 5 | 提交推送 + commitment 历史 | git + `commit_history.log` |

---

### Task 1: 共享引导渲染器 `guide-core.js`

**Files:**
- Create: `frontend/js/guide-core.js`
- 只读参考：`frontend/styles/design-tokens.css`（令牌名）、`frontend/styles/ui-common.css`（已封装的组件样式可读但本组件自包含）

渲染器必须自包含：**依赖零、自带注入 `<style>`、ES5**，使其在 config.html（file://）与 settings.html（http://）两处表现一致，并只消费 `--app-*` 令牌与 `html[data-theme]`。

- [ ] **Step 1: 编写 `guide-core.js`**

接口契约（后续 Task 2/4 均按此调用）：

```js
window.CutShelterGuide = {
  // 渲染清单卡集合。spec 形如：
  // {
  //   title: '欢迎使用碎碎记',
  //   subtitle: '配好存储目录即可开始，AI 可稍后再添加。',
  //   stepText: '第 1 步 · 共 2 步',
  //   progress: [ {state:'current'}, {state:'pending'} ],  // state: done|current|pending
  //   cards: [ { id, icon, label, required, badge, badgeOpt, desc,
  //              status: {text, tone:'danger'|'muted'|'ok'},
  //              open:true, fieldsHtml:fn(){return '<div>…</div>'},  // DOM string
  //              actions: fn(){return '<button…/ >'} },
  //            … ],
  //   footerNote: '内容 100% 存本机 · 随时可迁移',
  //   onDone: function(canProceed){...}  // 每次卡片展开/状态变化后回调，用于主按钮可用性
  // }
  render: function (container, spec) { /* 实现见下 */ },
  // 便捷：根据当前 cards 中 required 卡片是否落定，决定主按钮可用
  resolveCanProceed: function (spec) {
    return spec.cards.every(function (c) { return !c.required || c.status.tone === 'ok'; });
  }
};
```

核心实现要点（提供完整代码，长度以可执行为准）：
- 注入一段 `<style>` 到 `<head>`（带 `data-guide-core` 标记，幂等不重复注入），样式仅用 `var(--app-*)`；暖色点缀用随 `data-theme` 分组的 `--warm-*` 局部变量（见 Step 2 的令牌段）。圆角/阴影/动效用 `--app-radius-*`、`--app-shadow-*`、`--app-duration-*`。
- 卡片结构：左上图标、标签 + 徽章（`required`→红色「必填」角标，`badgeOpt`→蓝色「稍后可配」）、描述；状态药丸（danger/muted/ok 三色）；`open` 时并入 `fieldsHtml()`；底部动作区（`actions()` 返回 HTML，可含「跳过」）。
- 卡片点击切换 `open`；每次切换后统一调用 `onDone(CutShelterGuide.resolveCanProceed(spec))`。
- 图标用 emoji（📂/🧠）与暖色小 SVG 点缀，规避外部资源依赖。

- [ ] **Step 2: 校验令牌与暖色变量齐全**

在文件内注入的 `<style>` 顶部写入令牌映射（与 design-tokens.css 对齐的关键子集 + 暖色局部变量），并保留 `html[data-theme="dark"]` 覆盖：

```css
[data-guide-core] .g-root{
  --app-bg:#f7f7f5; --app-surface:#fff; --app-surface-subtle:#f1f1ef;
  --app-border:#e3e3df; --app-border-strong:#d2d2cd;
  --app-text:#2f3437; --app-text-secondary:#6b6f76; --app-text-muted:#92969d;
  --app-primary:#2383e2; --app-primary-hover:#1f76c9;
  --app-primary-soft:rgba(35,131,226,.10);
  --app-success:#238b63; --app-success-soft:rgba(35,139,99,.10);
  --app-danger:#d14343; --app-danger-soft:rgba(209,67,67,.10);
  --app-radius-sm:6px; --app-radius:9px; --app-radius-lg:12px;
  --app-shadow-sm:0 1px 3px rgba(15,23,42,.06);
  --app-shadow-md:0 4px 6px rgba(15,23,42,.06);
  --app-ease-smooth:cubic-bezier(.22,1,.36,1); --app-duration-normal:200ms;
  /* 暖色点缀（引导卡专属 accent，不进全局令牌） */
  --warm-bg:#fff8f1; --warm-ink:#5b4636; --warm-accent:#e8871e; --warm-accent-soft:rgba(232,135,30,.14); --warm-sun:#ffd9a0;
}
html[data-theme="dark"] [data-guide-core] .g-root{
  --app-bg:#1e1e1e; --app-surface:#282828; --app-surface-subtle:#323232;
  --app-border:#414141; --app-border-strong:#525252;
  --app-text:#dedede; --app-text-secondary:#aaa; --app-text-muted:#777;
  --app-primary:#61a6ff; --app-primary-hover:#7bb5ff;
  --app-primary-soft:rgba(97,166,255,.14); --app-success:#56c997; --app-success-soft:rgba(86,201,151,.14);
  --app-danger:#ef7777; --app-danger-soft:rgba(239,119,119,.12);
  --warm-bg:#2b2522; --warm-ink:#e8d9c9; --warm-accent:#ffb25e; --warm-accent-soft:rgba(255,178,94,.16); --warm-sun:#7a6235;
}
```

- [ ] **Step 3: 浏览器/Node 冒烟校验（非 Electron 上下文可独立测）**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('frontend/js/guide-core.js','utf8');if(!s.includes('window.CutShelterGuide')||!s.includes('.g-root'))throw new Error('missing api/css');console.log('guide-core ok',s.length,'bytes')"`
Expected: 输出 `guide-core ok <字节数>`，无 throw。

- [ ] **Step 4: Commit**

```bash
git add frontend/js/guide-core.js
git commit -m "feat: 新增共享上手引导渲染器 guide-core"
```

---

### Task 2: 首装窗口 V3 化 + 卡片化（`electron/config.html`）

**Files:**
- Modify: `electron/config.html`（整文件重构）
- Modify: `electron/main.js:320-360`（可选：首启窗口尺寸调整，参见 spec §10.4）

**关键约束：保持 `electronAPI` 全部 IPC 契约不变**。页面仍依赖 `api.onLoadConfig / onFirstRun / onStartupProgress / onStartupError / configDone / restartBackend / selectDirectory / quitApp / window.close`。只改视觉与结构，不改 preload / 主进程通道名。

- [ ] **Step 1: 引入主题令牌 + 深浅色切换 + 加载 guide-core**

在 `<head>` 补 `data-theme`、并复用 Task 1 的令牌（`[data-guide-core] .g-root` 由 guide-core 自注入，config.html 只需要保证按钮/标题栏/页面骨架消费令牌）：

```html
<html lang="zh-CN" data-theme="light">
```
- `<head>` 追加：`<script src="../frontend/js/guide-core.js"></script>`（file:// 相对解析；若打包受限，按 spec §10 回退「复制一份到 electron/」）。
- 标题栏 `<div class="titlebar">` 换为令牌驱动背景（`linear-gradient` 用主色令牌 + dark 覆盖），右侧加一个浅/深切换 `<button id="themeToggle">`。
- 顶部加 `<style>`（仅覆盖页面骨架：标题栏、容器、状态栏、actions），全部引用 `--app-*`，暗色用 `html[data-theme="dark"]` 覆盖。删除旧的硬编码 `#f5f7fa/#333/#667eea/#764ba2`。

- [ ] **Step 2: 用 guide-core 渲染 `<main id="onboardRoot">`，替换旧 body 各区块**

保留标题栏、`startupOverlay`、`statusBar` 壳；把「端口配置 / 存储目录 / 操作按钮」三个 `.section` 整体替换为：

```html
<div class="g-root">
  <div id="onboardRoot"></div>
  <!-- 全局底部动作：由 guide.render 的 footerNote 区承载「开始使用」 -->
</div>
```

页面逻辑重写为：
- `api.onLoadConfig` 时：`loadedConfig = config`；`recommendedPath = config.storagePath || ''`；**仅首装时 `storagePath` 回填空**（见 Step 3）。
- `api.onFirstRun` 时：`isFirstRun = true`；设标题「碎碎记 - 初始设置」；隐藏「退出应用」，显示「开始使用」。
- `onboardRoot` 调用 `window.CutShelterGuide.render(onboardRoot, spec)`，spec 的两张卡片见 Step 3/4；`onDone` 里同步「开始使用」主按钮 `disabled = !canProceed`（首装）或「保存并重启」（非首装根据 `resolveCanProceed` 控制）。

- [ ] **Step 3: 存储路径卡（唯一必填红）+ 「一键填充推荐路径」**

cards 第一张：

```js
{ id:'store', icon:'📂', label:'工作区存储路径', required:true, badge:'必填', badgeOpt:false,
  desc:'所有剪藏、整理、周报数据存放的根目录。',
  status:{ text:'未设置', tone:'danger' },
  open:true,
  fieldsHtml: function(){ return ''+
    '<div class="g-field">'+
      '<label class="g-label">存储总目录</label>'+
      '<div class="g-path-row">'+
        '<input type="text" id="gStoragePath" placeholder="选择数据存放根目录">'+
        '<button type="button" id="gBrowseBtn">浏览</button>'+
      '</div>'+
      '<button type="button" class="g-ghost" id="gFillBtn">一键填充推荐路径</button>'+
      '<div class="g-hint">子目录 clip-storage / clip-organized / weekly-report 将自动派生</div>'+
    '</div>'; },
  actions: function(){ return '' ; }
}
```

JS 绑定：
- `api.onLoadConfig`：若 `recommendedPath` 非空则由「一键填充」写入 `#gStoragePath`；首装不再自动回填（保持空）。
- `#gBrowseBtn` → `api.selectDirectory()` 写 `#gStoragePath`。
- `#gFillBtn` → 写 `recommendedPath`。
- 存储路径每次变化 → `spec.cards[0].status = value.trim() ? {text:'已就绪',tone:'ok'} : {text:'未设置',tone:'danger'}`，重刷该卡状态药丸并调 `onDone`。

- [ ] **Step 4: AI 卡（可选，可跳过）+ 高级端口卡（折叠）**

cards 第二张（可选）：

```js
{ id:'ai', icon:'🧠', label:'主 AI 模型 · API Key', required:false, badge:'稍后可配', badgeOpt:true,
  desc:'为整理、问答、写作等提供 AI 能力，可稍后在设置中补配。',
  status:{ text:'稍后配置', tone:'muted' }, open:false,
  fieldsHtml: function(){ return ''+
    '<label class="g-label">服务商</label>'+
    '<select id="gProvider"><option value="deepseek">DeepSeek</option><option value="dashscope">阿里云 DashScope</option><option value="custom">自定义 OpenAI 兼容</option></select>'+
    '<label class="g-label">API Key</label>'+
    '<input type="password" id="gApiKey" placeholder="sk-…">'; },
  actions: function(){ return ''+
    '<button type="button" class="g-ghost g-danger" data-g-skip="ai">跳过，稍后配置</button>'+
    '<button type="button" class="g-primary" data-g-save="ai">保存并测试</button>'; }
}
```

卡片集合底部在 spec `actions` 提供：「开始使用」（首装）主按钮，其 `disabled` 绑 `CutShelterGuide.resolveCanProceed(spec)`。

- [ ] **Step 5: 保存逻辑改造（首装/非首装保持原通道）**

在既有 `btnSave` 逻辑不变的前提下（`backendPort/frontendPort/storagePath` 校验 + `configDone`|`restartBackend`），新增：把 `#gProvider/#gApiKey` 合并进 `newConfig`（写 `activeProvider` + 对应 provider key，如 `provider==='deepseek'` → `deepseekApiKey`，`dashscope` → `dashscopeApiKey`，`custom` → `customApiKey`；与 settings.js 命名对齐，见 Task 4 步骤）。端口读自高级卡内 `backendPort/frontendPort`，保持 `===` 校验。

- [ ] **Step 6: 校验（运行 Electron 或静态检查）**

静态检查：
Run: `node -e "const fs=require('fs');['electron/config.html'].forEach(f=>{const s=fs.readFileSync(f,'utf8');if(!/data-theme/.test(s))throw new Error(f+' missing data-theme');if(!s.includes('window.CutShelterGuide'))throw new Error(f+' missing guide-core');if(!s.includes('configDone'))throw new Error(f+' missing configDone');console.log(f,'ok')})"`
Expected: `electron/config.html ok`。

- [ ] **Step 7: Commit**

```bash
git add electron/config.html
git commit -m "feat: 首装窗口升级为 V3 上手引导卡（必填存储+可选 AI+高级端口）"
```

---

### Task 3: 设置页置顶「工作区」分组 + 必填标红 + 引导重播（阶段 1）

**Files:**
- Modify: `frontend/settings.html`
- Modify: `frontend/js/settings.js`（仅新增一个非常小的引导重播封装，不触碰现有 id 绑定）
- Modify: `frontend/settings.html`（head 引入 `guide-core.js`）

导航绑定在 `settings.html` 内联脚本（`:1910-1951`）为 data-driven：`.settings-nav-item[data-target] → #id`。settings.js 各函数按固定 field id 绑定，**移动分组 DOM 不改变 id 即安全**。

- [ ] **Step 1: 在 head 引入 guide-core，并新增「工作区」导航项**

在 `/styles/design-tokens.css` 与 `/js/theme-bridge.js` 之后追加：
```html
<script src="js/guide-core.js"></script>
<!-- index body 前端原生设置 so 无需额外 -->
```
在导航列表顶部（原 825 行「个性化」项之前）插入：
```html
<a class="settings-nav-item active" data-target="group-workspace"><span class="nav-icon">🗂️</span>工作区<span class="req-tag">必填</span></a>
```
把原「个性化」的 `active` 移除。新增 `.req-tag` 与 `.req-tag` 的红色小样式（放 `settings.html` 顶部 `<style>`）。

- [ ] **Step 2: 新增 `group-workspace` 段，迁入存储相关内容（移动 DOM，保 id）**

在 `<section group-appearance>` 之前插入新的顶格分组，把原来 `group-ai` 内「存储路径」「知识库目录规范」「本地配置文件」「统一保存按钮」整个搬运进来（`#storagePath / derivedClipPath / derivedOrganizedPath / derivedWeeklyPath / searchZoneResult / storageInspectResult / configFilePath / electronConfigPath / reindexKbBtn / saveBtn …` 全部原样保留 id），并在分组头部加「上手引导」横幅：

```html
<section class="settings-group" id="group-workspace">
  <div class="settings-group-title"><span class="group-icon">🗂️</span>工作区<span class="req-tag">必填</span></div>
  <div class="help-banner" id="guideReplayBanner">
    <span>🎓</span><span><b>上手引导</b> · 重播首次引导卡 / 逐步学习存储、AI Key、进阶集成</span>
    <button class="btn btn-primary" id="guideReplayBtn">播放引导</button>
  </div>
  <!-- ↓ 以下为从原 group-ai 迁入的存储/目录规范/本地配置/保存按钮，id 不变 -->
  <!-- 存储路径 config-subsection → 目录规范 → 本地配置文件 → 统一保存按钮 saveBtn -->
</section>
```
「工作区」存储根目录行应用红色必填强调：给 `#storagePath` 所在 `form-group` 加类，引用 `--app-danger*` 令牌，输入前置红 `*`。删除旧 `group-ai` 段末尾同样的存储/保存块。

- [ ] **Step 3: settings.js 追加引导重播封装（新函数，不改旧函数）**

在 `settings.js` 末尾添加：

```js
function openGuideReplay(){
  var host = document.createElement('div');
  host.id = 'guideReplayHost';
  document.body.appendChild(host);
  window.CutShelterGuide.render(host, {
    title:'上手引导', subtitle:'分步了解关键配置', stepText:'重播模式',
    progress:[ {state:'done'},{state:'done'} ],
    cards: window.CutShelterGuide ? window.__cutShelterGuideReplayCards() : [],
    onDone: function(){}
  });
}
```
`__cutShelterGuideReplayCards()` 复用 Task 2 存储/AI 两张卡片 spec（存储`required`由「是否已配」决定 tone；AI key 已配显 ok）。
在 `DOMContentLoaded`（`:986` 块）追加绑定：
```js
document.getElementById('guideReplayBtn')?.addEventListener('click', openGuideReplay);
```
（沿用现有严格可选链风格，与 `mascotAction` 等写法一致。）

- [ ] **Step 4: 校验**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('frontend/settings.html','utf8');if(!s.includes('id=\"group-workspace\"'))throw new Error('missing group-workspace');if(!s.includes('guideReplayBtn'))throw new Error('missing replay btn');if(!s.includes('js/guide-core.js'))throw new Error('missing guide-core');['storagePath','derivedClipPath','searchZoneResult','saveBtn'].forEach(id=>{if(!s.includes('id=\"'+id+'\"'))throw new Error('missing id '+id)});console.log('settings.html ok')"`
Expected: `settings.html ok`

- [ ] **Step 5: Commit**

```bash
git add frontend/settings.html frontend/js/settings.js
git commit -m "feat: 设置页置顶工作区分组，存储路径必填红+引导重播横幅"
```

---

### Task 4: 设置页完整 8 分组重排（阶段 2）

**Files:**
- Modify: `frontend/settings.html`
- Modify: `frontend/js/settings.js`（仅若需要新增分组间公共 helper；不改字段 id）

**原则（spec §5.5 硬约束）：只移动 DOM 分组、只改导航项 `data-target` / 分组标题文字；不重命名任何字段 id。**

- [ ] **Step 1: 拆分原 `group-ai`（1042-1663）为「AI 与模型」+「集成」**

目标分组（新旧 data-target 映射）：

| 新导航项 | data-target | 迁入内容（原归属） |
|----------|-------------|--------------------|
| 工作区 | group-workspace | 已由 Task 3 完成 |
| AI 与模型 | group-ai-models | dashscope/deepseek 提供方卡、Exa 搜索、PDF OCR（原 group-ai 内 1239-1443） |
| 集成（新增） | group-integrations | DSH Agent、MCP 接入、Git 远程仓库、邮件通知（原 group-ai 内 1045-1131、1453-1524） |
| 外观 | group-appearance | 原样（个性化） |
| 通用 | group-general | 原样 |
| 快捷操作 | group-shortcuts | 原样 |
| 数据与隐私 | group-data | 原样 |
| 系统 | group-system | 原样 |

具体：把 `group-ai` 拆成两个 `<section>`：`group-ai-models`（标题「AI 与模型」）承载 提供方/OCR/Exa；`group-integrations`（标题「集成」）承载 DSH/MCP/Git/邮件。**所有被迁移块的子元素 id（`dshAgentEnabled / dshPort / dshBinPath / mcpClaudeCmd / mcpCodexCmd / dashscopeApiKey / deepseekApiKey / dashscopeModel / deepseekModel / exaEnabled / exaApiKey / pdfOcrEnabled / pdfOcrBaseUrl / pdfOcrApiKey / pdfOcrModel / mailEnabled / mailHost / mailPort / mailUsername / mailPassword / gitRemoteUrl / gitBranch / gitToken / testGitBtn` 等）一律不动。**

- [ ] **Step 2: 重写导航列表为 8 项（含数据：顺序）**

将 825-830 导航 `<a>` 替换为（顺序即 §5.2）：
```html
<a data-target="group-workspace">🗂️ 工作区<span class="req-tag">必填</span></a>
<a data-target="group-ai-models">🤖 AI 与模型</a>
<a data-target="group-integrations">🔌 集成</a>
<a data-target="group-appearance">🎨 外观</a>
<a data-target="group-general">⚙️ 通用</a>
<a data-target="group-shortcuts">⌨️ 快捷操作</a>
<a data-target="group-data">🔒 数据与隐私</a>
<a data-target="group-system">🛠️ 系统</a>
```
`group-gpu`（渲染性能）不新增导航项，保持现状锚定于通用之后（spec §10 说明，不改动）。

- [ ] **Step 3: 检查 settings.js 是否依赖 group-ai 容器 id 或分组名**

Run: `grep -nE "group-ai|group-data|group-general|group-appearance|group-system|group-shortcuts|group-gpu" frontend/js/settings.js`
若仅出现在注释/不影响逻辑，则无需改；若某字段依赖这些 id，记录到 Step 4。Expected: 无必须改的硬引用（导航与字段绑定均已由 Step 2 保证）。

- [ ] **Step 4: 校验最终设置页**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('frontend/settings.html','utf8');['group-workspace','group-ai-models','group-integrations','group-appearance','group-general','group-shortcuts','group-data','group-system'].forEach(id=>{if(!s.includes('id=\"'+id+'\"'))throw new Error('missing '+id)});['dashscopeApiKey','dshAgentEnabled','mcpClaudeCmd','mailEnabled','gitRemoteUrl','exaApiKey','pdfOcrEnabled'].forEach(id=>{if(!s.includes('id=\"'+id+'\"'))throw new Error('missing field '+id)});console.log('8 groups ok')"`
Expected: `8 groups ok`

- [ ] **Step 5: Commit**

```bash
git add frontend/settings.html
git commit -m "feat: 设置页 8 分组重排，拆 AI 与模型/集成，按优先级排序"
```

---

### Task 5: 推送 + commit_history

- [ ] **Step 1: 追加 commit_history.log**

每一条前述 commit 均已按约定在各自 commit 前 append。末条追加：
```bash
printf '2026-09-19 %s | 首装引导卡+设置页8分组重构(多轮提交合并)\n' "$(date +%H:%M)" >> commit_history.log
git add commit_history.log
git commit -m "docs: 追加 commit_history.log 引导与设置重构记录"
```

- [ ] **Step 2: 合并推送**

Run: `git log --oneline -8`（确认提交序列）→ `git push origin trae/agent-Q9iuWU`
Expected: 全部新提交推送到 `wf-Peg/ai_coding`，显示 `trae/agent-Q9iuWU -> ...` 且无失败。

---

## 验收汇总（对照 spec §7）

- [ ] 首装入口为 V3 卡片：存储必填红、AI 可跳过、端口在高级折叠卡。
- [ ] 存储首装留空、可「一键填充推荐路径」；落定后主按钮可用。
- [ ] `configured=true` 后不再弹引导。
- [ ] 设置页 8 分组按 §5.2 顺序；存储路径置顶标红必填。
- [ ] 工作区分组「播放引导」可重播。
- [ ] guide-core 在 config.html(file://) 与 settings.html(http://) 两处主题一致，深浅色可切。
- [ ] 全程未改动任何字段 element id，`settings.js` 字段绑定未破坏。

## 明确不做（spec §8）
- 手机端引导、严格多步 Stepper、引导完成度持久化、后端接口改动。

## 风险与回退（spec §10）
- config.html file:// 加载 guide-core 若受 asar 限制 → 复制 `guide-core.js` 至 `electron/` 并在 config.html 改为相对引用；或由 main.js 注入。
- 「一键填充推荐路径」首装 `loadedConfig.storagePath` 为空时为 undefined，可直接隐藏该按钮并提示「请浏览选择」。
- settings.js 若有个别函数按「group-ai」容器查找子字段（Step 3 验证），需把对容器 id 的引用同步改到新容器 id，但不改动字段 id。