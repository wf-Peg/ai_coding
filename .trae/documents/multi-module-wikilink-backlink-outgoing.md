# 多模块 + 多类型双向链接（双链/反链/出链）优化计划

## 一、背景与目标

当前反链/双链（wikilink/backlink）只识别单一根目录 `clip-organized` 下产出的 `.md`，存在四类问题：

1. **代码 Review 发现若干 bug**（详见「三」），需一并修复。
2. **只支持 clip-organized 的 md**：知识库里实际还有 `clip-weekly-report`、`obsidian-vault` 等多个含 .md 的模块，跨模块互引、反链识别均失效，无法实现「多级互引」。
3. **不支持非 md 文件**：编辑器默认保存目录为 `{storagePath}/tmp`，会存放用户新建/另存的 `.txt/.sql/.json/.xml` 等文件，目前完全无法被 `[[链接]]` 引用。
4. **体验未对齐 Obsidian**：反链/出链面板的交互样式需向 Obsidian 看齐，做精致。

目标（已与用户确认）：
- **模块来源**：自动发现——扫描知识库父目录（`config.storagePath`）下所有含可链接文本文件的一级子目录作为独立模块，每个模块各自维护索引（系统维护不同索引）。
- **目标文件类型**：md + 编辑器可打开的文本类型（txt/sql/json/xml/csv/log/yaml/yml/ini/conf）；自动跳过 `clip-storage` 原始存档目录与 `.` 开头目录。
- **真正双向**：所有被索引的文本文件都解析 `[[...]]`，txt/sql 内部的双链同样产生反链与出链。
- **同名跳转**：就近优先（当前文件同模块优先 → 相对路径短者优先），仍有歧义才弹同名选择列表。
- **正向链接**：新增「出链」面板，显示当前文件引用了哪些目标、是否断链；与「反链」构成完整双向链接。
- **体验对齐 Obsidian**：面板 tab、数量徽标、条目卡片、行号 + 高亮、断链样式、选择弹窗等交互样式向 Obsidian 看齐。

## 二、现状分析

### 当前实现（单一根、仅 md 索引）
- `electron/main.js`（L2064-L2223）：
  - `resolveVaultRoot(config)` 优先 `config.organizedPath`（= `剪藏收集/clip-organized`），回退 `storagePath/clip-organized`、`storagePath`。**仅此一个根。**
  - `buildWikilinkIndex(vaultRoot)`：遍历该根下全部 `.md`（L2102 `!/\.md$/i.test(entry.name) continue`），收集 `targets`（basename/fileName/relativePath/absolutePath）与按链接 basename 建的反向 `reverse`。
  - `setupWikilinkWatcher`：对该根 `fs.watch(recursive)` + 500ms 防抖重建；不可用则 TTL 3s 兜底。
  - IPC：`editor-list-wikilink-targets` → `{targets}`；`editor-find-backlinks(basename)` → `{backlinks: reverse[key]}`；`editor-save-to-vault`（写 `{vaultRoot}/notes/{base}.md`）。
- `frontend/js/editor.js`（L5127-L5478）：
  - `wikilinkState = { targets, loaded }`；`buildLinkIndex()` 拉 targets。
  - `resolveWikilink(target)`：相对路径精确 → basename 精确；命中多个返回数组。
  - `openWikilink` → 多命中 `showWikilinkPicker`；`openWikilinkByPath` 用 absolutePath 打开。
  - `buildBacklinks()` 渲染反链面板；`scheduleBacklinksRefresh` 400ms 防抖；`toggleBacklinks` 打开面板时 `buildLinkIndex()`+`buildBacklinks()`。
  - `registerWikilinkCompleter`：`identifierRegexps` 单字符 `/\[[a-zA-Z0-9\u4e00-\u9fff._\/\-]*/`，`getCompletions` 判断光标行 `[[` 上下文，`seen[basename]` 去重。
- `electron/preload.js`（L330-L353）：`openFileByPath`、`listWikilinkTargets()`、`findBacklinks(basename)`。
- 反链面板 DOM：`frontend/editor.html` L114-L123（`backlinksPane` → 标题+count+存入知识库+关闭+`backlinksList`），**无出链 tab**。
- 当前文件绝对路径：`state.displayPath`（desktop 模式，见 `openFileDataInNewTab` L2705 附近 / `setEditorContent` L705），可用于模块归属与就近优先。

### 知识库实际结构（已勘察）
`config.storagePath` = `L:\归档\40_Knowledge (知识金库)\41_Vaults (知识库核心)\剪藏收集`：
- `clip-organized/`（md，含 default/finance/hobby/life/study/work 及 notes/）
- `clip-weekly-report/`（周报 md）
- `obsidian-vault/`（wiki 概念/实体/MOC md）
- `tmp/`（编辑器默认保存目录，txt/sql 等）→ **本次新增纳管**
- `clip-storage/`（原始剪藏 json 存档）→ **自动排除**
- `.tmp/`（编辑器缓存，点开头）→ **自动排除**
- `.git/` 等 → 自动排除

## 三、代码 Review 发现的 Bug（本次一并修复）

1. **反链条目点击打开错误文件/误触发同名弹窗**：`editor.js` L5380-L5382 `item.addEventListener('click', () => openWikilink(b.basename))`。`b` 已携带 `absolutePath`，按 basename 重新解析可能命中别的同名文件或误弹选择框。→ 改为 `openWikilinkByPath(b)` 直接打开精确文件。
2. **自引用误入反链**：Obsidian 语义中文件引用自身不算反链。当前后端未按当前文件路径过滤。→ `find-backlinks` 传入 `currentPath` 后排除 `absolutePath === currentPath` 的条目。
3. **仅索引 .md → 非 md 完全不可链接**：`main.js` L2102 硬编码 `\.md$`。tmp 目录的 txt/sql 等无法被 `[[...]]` 引用、补全、跳转。→ 改为 `LINKABLE_EXT_RE`（md + 编辑器文本类型）。
4. **反链查询键单一，非 md 反链漏查**：`find-backlinks` 只按 basename 查 `reverse[key]`。当前文件为 `query.sql` 时，若别处写 `[[query.sql]]`，reverse 键为 `query.sql` 而 basename 查的是 `query`，漏查。→ 基于 `currentPath` 同时查 `basename` 与 `fileName`（含扩展名）两个键并合并去重。
5. **无模块信息、无法就近优先**：`resolveVaultRoot` 单根、targets 无 `moduleId`，前端 `resolveWikilink` 无就近优先。多模块改造后 targets/reverse 条目均带 `moduleId/moduleName`，`resolveWikilink(target, currentPath)` 就近排序。
6. **resolveVaultRoot 顺序隐患**：当前优先 `config.organizedPath`，若配置为过时的 `Clip_Bed` 路径会解析错根。多模块改造后索引根改为 `storagePath` 自动发现（天然正确）；`resolveVaultRoot` 仅保留给「存入知识库」，且改为优先使用发现的 `clip-organized` 模块根，找不到再回退。
7. **切换文件后反链/出链未及时刷新**：程序化 `setValue` 触发 `session.on('change')` 语义不够可靠。→ 在 `openFileDataInNewTab`/`setEditorContent` 载入新文件后，若面板可见则显式 `scheduleBacklinksRefresh()`。
8. **补全无法区分同名/多类型**：completer 用 `seen[basename]` 去重，`foo.md` 与 `foo.sql` 同名时只能补出第一个。→ meta 展示 `模块名/相对路径`；同名冲突额外提供 `[[相对路径]]` 候选用于歧义消除。
9. **scheduleBacklinksRefresh 只刷反链**：新增出链 tab 后需刷新当前激活 tab。
10. **面板标题对非 md 显示不准确**：`buildBacklinks` 用 `getCurrentBasename()`（去扩展名）显示标题/查询。非 md 文件（如 `query.sql`）标题应显示真实文件名（含扩展名）。→ 标题取 `state.fileName`；查询键由后端基于 `currentPath` 推导。
11. **（复核确认非 bug，不改动）** 反链行高亮 `escapeHtml(m.text)` 先转义再 `replace` 插入 `<span class="bl-hl">$1</span>`，`$1` 来自已转义文本，无 XSS 风险（editor.js L5374-L5377）。

## 四、多模块 + 多类型索引设计

### 后端（electron/main.js）

**可链接扩展名集**（目标 + 反链扫描均用）：
```js
const LINKABLE_EXT_RE = /\.(md|mdown|markdown|txt|sql|json|xml|csv|log|yaml|yml|ini|conf)$/i;
```
**排除模块常量**：`const EXCLUDED_MODULE_DIRS = ['clip-storage'];`（原始存档，避免补全被海量 json 污染；可由注释说明按需增删）。

**模块发现** `discoverLinkModules()`：
- 基目录 = `config.storagePath`。
- 遍历一级子目录：跳过 `.` 开头；跳过 `EXCLUDED_MODULE_DIRS` 中目录；递归检查是否含 ≥1 个 `LINKABLE_EXT_RE` 文件，含则视为模块。
- 模块结构 `{ id, name, root, targets, reverse, builtAt, watcher, watchTimer }`，`id`=目录名。
- 兜底：若无任何模块，回退 `resolveVaultRoot(config)` 单一模块，保证兼容。

**逐模块构建** `buildModuleIndex(mod)`（沿用现解析逻辑，改造后）：
- `targets.push({ moduleId, moduleName, basename, fileName, relativePath, absolutePath })`（非 md 同样以去扩展名 basename 索引）。
- 解析该文件内所有 `[[链接]]`（对所有可链接文本文件都扫，实现真正双向）；去别名/锚点；按链接 basename（`t.split('/').pop().toLowerCase()`）建 reverse，键同时保留扩展名形式（如 `[[query.sql]]` → 键 `query.sql`）。
- 同文件多行匹配合并到一条；加**大小守卫**：文件 > 10MB 跳过反链扫描（仅作目标），避免超大 log/csv 拖慢构建。
- 条目携带 `moduleId/moduleName`；**自引用不在此处处理**（由 find-backlinks 按 currentPath 过滤）。

**逐模块监听**：每个模块根各 `fs.watch(root,{recursive:true})`，500ms 防抖仅重建该模块；监听不可用该模块走 TTL(3s) 兜底。模块根变化（新增/删除模块）时重建模块清单。

**聚合接口**：
- `editor-list-wikilink-targets` → `{ targets: 各模块合并(含 moduleId/moduleName/basename/fileName/relativePath/absolutePath), modules: [{id,name,root}] }`。
- `editor-find-backlinks(currentPath)`：由 `currentPath` 推导 `basename`（去扩展名）与 `fileName`（含扩展名）；聚合各模块 `reverse[basename.toLowerCase()]` 与 `reverse[fileName.toLowerCase()]`，按 absolutePath 去重；过滤 `absolutePath === currentPath`；排序：当前文件所在模块优先 → relativePath 短者优先。返回条目含 `moduleId/moduleName/basename/fileName/absolutePath/relativePath/matches`。
- 新增 `editor-find-outgoing(currentPath)`：读当前文件内容，解析 `[[链接]]`；对每个链接用「相对路径精确 → basename（就近优先）→ fileName 匹配」解析到多模块 targets，返回 `[{ target, resolved: {...}|null, missing }]`；文件读失败返回 `{ message }`。
- `editor-save-to-vault`：改为优先使用发现的 `clip-organized` 模块根（`{clip-organizedRoot}/notes/{base}.md`），找不到回退 `resolveVaultRoot`。

### 前端（frontend/js/editor.js + editor.html + editor.css）

- `wikilinkState` → `{ targets, modules, loaded }`；`buildLinkIndex` 兼容新返回结构。
- `getModuleIdByPath(currentPath)`：在 `targets` 中找 `absolutePath === currentPath` 的 `moduleId`；找不到返回 `null`（未保存/未纳管文件 → 无就近优先级）。
- `resolveWikilink(target, currentPath)`：
  1. 含 `/` → `relativePath` 精确匹配（唯一即返回；多个返回数组）；
  2. `fileName`（含扩展名）精确匹配（支持 `[[query.sql]]` 显式消歧）；
  3. `basename` 匹配 → 就近优先排序（同模块优先 → relativePath 短者优先）→ 唯一返回，多个返回数组。
- `openWikilink`/`openWikilinkByPath` 传入 `state.displayPath`；`showWikilinkPicker` 列表项显示 `fileName` + `模块名/相对路径`（Obsidian 风格）。
- `buildBacklinks`：标题显示 `state.fileName`；点击用 `openWikilinkByPath(b)`（修复 Bug 1）；条目显示模块小标签。
- **新增出链面板**：`backlinksPane` 头部加标签栏「反链 | 出链」；`currentLinkTab` 状态；`buildOutgoing()` 调 `findOutgoing(state.displayPath)` 渲染：每条显示 `[[target]]` + 解析结果（模块/相对路径），断链加 `wikilink-missing` 样式并点击无动作，已解析项点击打开。`scheduleBacklinksRefresh` 刷新当前激活标签（修复 Bug 9）。
- 刷新时机：打开面板 / 打开新文件（`openFileDataInNewTab`、`setEditorContent` 载入后若面板可见显式刷新，修复 Bug 7）/ 存入知识库。
- `markWikilinkStatus`（预览区断链标红）改用多模块 `resolveWikilink(target, state.displayPath)`。
- `registerWikilinkCompleter`：去重改为 `seen[basename+ext]`（`query.md` 与 `query.sql` 可分别补出）；meta 显示 `模块名/相对路径`；同名冲突额外生成 `[[相对路径]]` 候选（修复 Bug 8）。

## 五、Obsidian 对齐的产品/交互（用户指定）

- **面板结构**：`backlinksPane` 顶部标题「双向链接」（或按当前 tab 显示「反链 N」/「出链 N」），数量徽标用 Obsidian 式 pill；tab 为分段控件（`反链 | 出链`）。
- **反链条目**：来源文件名加粗 + 模块小标签（muted chip）+ 相对路径（小字灰）；下方最多 3 行匹配行，每行 `行号(小号胶囊) + 文本`，匹配到的 `[[target]]` 用主题色背景 pill 高亮；整项 hover 背景渐变；点击打开来源文件。
- **出链条目**：`[[目标]]`（等宽/正常体）+ 右侧解析结果（模块/相对路径，灰）；断链 → 目标文字标红、右侧「未找到目标」灰红；已解析可点击。
- **同名选择弹窗**：Obsidian 式 suggest 列表，条目为 `文件名 + 模块/相对路径`，hover 高亮、点击打开。
- **空状态**：`暂无反链` / `暂无出链`，带引导文案（沿用现有风格微调）。
- 全部沿用 CSS 变量（`--app-*` / `--app-primary` 等），暗色主题自动适配；面板开合沿用现有抽屉动画。
- 不做「未链接提及 (unlinked mentions)」、悬停预览等超范围功能（保持核心、不过度复杂）。

## 六、变更明细（按文件）

| 文件 | 改动 | 说明 |
|------|------|------|
| `electron/main.js` | 重写 wikilink 索引区块（L2064-L2223） | 多模块发现/构建/逐模块监听/聚合；`LINKABLE_EXT_RE` + 非 md 目标与全量扫描；`EXCLUDED_MODULE_DIRS`；`find-backlinks(currentPath)` 多键查+去自引用+就近排序；新增 `editor-find-outgoing`；`save-to-vault` 用 clip-organized 模块根 |
| `electron/preload.js` | `findBacklinks(currentPath)`；新增 `findOutgoing(currentPath)` | 桥接新接口（L339/L353 附近） |
| `frontend/js/editor.js` | 双链区块重构（L5127-L5478） | `wikilinkState` 结构、`getModuleIdByPath`、`resolveWikilink` 就近优先+fileName 匹配、反链点击修复+模块标签+标题显示 fileName、出链面板 `buildOutgoing`、`scheduleBacklinksRefresh` 按激活 tab、新文件载入后刷新、`markWikilinkStatus` 传 currentPath、completer 消歧 |
| `frontend/editor.html` | 反链面板加标签栏与出链列表（L114-L123） | `反链/出链` tab + `outgoingList` 元素 |
| `frontend/styles/editor.css` | 新增样式 | 分段 tab、模块小标签、出链条目、断链(missing)、Obsidian 式行号/高亮/徽标（沿用主题变量） |

不改后端 Java、不改配置结构（模块为自动发现，不落盘）。

## 七、假设与决策

- 模块 = `storagePath` 下一级、递归含 ≥1 个可链接文本文件的非隐藏目录，且不在 `EXCLUDED_MODULE_DIRS`（默认仅 `clip-storage`）中；`.tmp`、`.git` 等点开头自动排除。
- 可链接类型 = `LINKABLE_EXT_RE`（md + 编辑器文本类型）；超大文件（>10MB）只作目标、不扫反链。
- 就近优先规则：同模块 > relativePath 短者；仍有歧义 → 同名选择弹窗（列表项带模块名/相对路径）。
- 真正双向：所有被索引文本文件都参与 `[[...]]` 反链/出链扫描（含 txt/sql），符合用户选择。
- 断链定义：当前文件内的 `[[target]]` 在多模块索引中解析不到任何目标。
- 出链面板与反链共用 `backlinksPane` 抽屉（tab 切换），不新增抽屉布局改动。
- 补全 meta 显示「模块名/相对路径」；同名冲突额外给出 `[[相对路径]]` 候选；`[[fileName]]`（含扩展名）可显式消歧。
- 性能：现单模块 82 文件约 12ms，多模块 + 非 md 合计仍为毫秒级；每模块独立 watcher，变更只重建对应模块；加入 10MB 守卫防超大文件拖慢。

## 八、验证步骤

1. `node --check electron/main.js electron/preload.js frontend/js/editor.js`。
2. 临时脚本（`.trae` 或临时目录，用后删除）：对真实知识库跑 `discoverLinkModules` + `buildModuleIndex`，断言模块列表 ≈ `[clip-organized, clip-weekly-report, obsidian-vault, tmp]`，且**不含** `clip-storage`、`.tmp`、`.git`；抽查一条跨模块反链、一条 tmp 内 `[[xxx.txt/sql]]` 的反链、同名就近排序结果。
3. 临时脚本：对样例文件调 `find-outgoing` 解析逻辑，验证断链标记与就近优先、fileName 匹配。
4. 启动应用（`npm start`）：反链面板出现「反链/出链」tab；打开 clip-organized 内 md 验证反链含模块标签、出链正确、断链标红、同名弹窗就近排序；**新建/打开 tmp 下 `test.txt`/`test.sql`，用 `[[test]]`、`[[test.txt]]` 链接并跳转，验证补全、反链、出链均生效**；打开 obsidian-vault 内文件验证其双链也能补全/跳转/反链。
5. 回归：Ctrl+Shift+B 开关、`[[` 补全（含同名消歧候选）、存入知识库后索引刷新、同名选择弹窗、Markdown 预览断链标红仍正常。
