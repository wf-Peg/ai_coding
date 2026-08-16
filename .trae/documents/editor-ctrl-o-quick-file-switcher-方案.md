# 编辑器 Ctrl+O 全局文件快速搜索（Obsidian Quick Switcher 风格）

## 一、需求概述

仿照 Obsidian 的 **Ctrl+O 快速切换器（Quick Switcher）**，在编辑器内实现"全局文件搜索"：
- 按 `Ctrl+O` 唤起一个浮层搜索框，从**知识库全局文件索引**中模糊搜索文件。
- 搜索数据源与编辑器 `[[` 双链补全**复用同一套索引**（`wikilinkState.targets`），即"把 `[[` 出双向链接的能力做进搜索"。
- 列表中选中某文件 → 在**新标签页**打开（复用现有 `openWikilinkByPath` → `openFileDataInNewTab` 逻辑）。
- 支持 `↑↓` 导航、`Enter` 打开、`Esc` 关闭，与命令面板（Ctrl+P）交互一致。

## 二、当前状态分析（探索结论）

- **文件索引**：`wikilinkState.targets`（[editor.js L5214](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L5214-L5269)）由 `buildLinkIndex()` 从 Electron `api.listWikilinkTargets()` 加载，元素结构为 `{absolutePath, fileName, basename, relativePath, moduleId, moduleName}`，覆盖 md/txt/sql/json/xml/csv/log/yaml/yml/ini/conf 等可链接文件（多模块，含 `clip-organized`、`obsidian-vault` 等）。
- **新标签打开**：`openWikilinkByPath(resolved)`（[editor.js L5321](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L5321-L5337)）→ `api.openFileByPath(resolved.absolutePath)` → `openFileDataInNewTab(result)`（[editor.js L2707](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L2707-L2729)），正是"选中新标签打开"的现成实现。
- **浮层交互范式**：命令面板（Ctrl+P）已实现输入框 + 列表 + 键盘导航 + 点击外部关闭，位于 [editor.html L447](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/editor.html#L447-L454)、[editor.js L5990-L6068](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L5990-L6068)、样式 [editor.css L3383-L3467](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/styles/editor.css#L3383-L3467)。
- **现有 Ctrl+O 绑定**：`modifier && event.key.toLowerCase() === 'o'` → `openMainFile()`（原生文件对话框，[editor.js L3194-L3196](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L3194-L3196)）。原生"打开"仍可通过工具栏按钮与命令面板"打开文件…"（L5975）使用，故可安全覆盖快捷键。

## 三、方案设计

### 3.1 交互与数据源
- 数据源 = `wikilinkState.targets`（与 `[[` 补全一致）。若尚未加载（`wikilinkState.loaded === false`），唤起时先 `await buildLinkIndex()` 再渲染。
- 搜索匹配字段：`basename`、`fileName`、`relativePath`、`moduleName`（子串包含即可，Obsidian 也按文件名+路径匹配）。
- 每行展示：文件图标/名称 + 右侧 meta（`moduleName/relativePath`），与 `[[` 补全的 meta 一致，便于定位同名文件。
- 选中即打开：每行对应一个**已解析的具体 target**，直接 `openWikilinkByPath(target)`，无歧义，无需弹选择框。

### 3.2 代码改动

**1) `frontend/editor.html`（改）**
- 在命令面板 DOM（L447-454）之后新增快速搜索浮层，结构参照命令面板：
  ```html
  <!-- 全局文件快速搜索（Ctrl+O） -->
  <div class="quick-switcher" id="quickSwitcher" hidden aria-hidden="true">
    <div class="quick-switcher-input-wrap">
      <span class="quick-switcher-prompt">🔍</span>
      <input class="quick-switcher-input" id="quickSwitcherInput" placeholder="输入文件名/路径搜索…" autocomplete="off" spellcheck="false">
    </div>
    <div class="quick-switcher-list" id="quickSwitcherList"></div>
    <div class="quick-switcher-hint">↑↓ 导航 · Enter 打开 · Esc 关闭</div>
  </div>
  ```

**2) `frontend/styles/editor.css`（改）**
- 新增 `.quick-switcher` 等样式，复用 `.command-palette*` 的视觉变量（同款定位、输入框、列表项、active 高亮、入场动画）。

**3) `frontend/js/editor.js`（改）**
- 新增状态与函数：
  - `var quickOpenVisible = false; var quickIndex = 0; var quickFiltered = [];`
  - `async function openQuickSwitcher()`：设置可见、焦点、`quickIndex=0`；若 `!wikilinkState.loaded` 先 `await buildLinkIndex()`；`renderQuickList('')`。
  - `function closeQuickSwitcher()`：隐藏并归还焦点到编辑器。
  - `function renderQuickList(query)`：按 basename/fileName/relativePath/moduleName 过滤 `wikilinkState.targets`，渲染列表行（名称 + meta），高亮 active。
  - `function setQuickIndex(i)` / `function executeQuickOpen(i)`：执行即 `openWikilinkByPath(quickFiltered[i])` 并 `closeQuickSwitcher()`。
  - 事件绑定：`quickSwitcherInput` 的 `input`/`keydown`（Esc/↑↓/Enter）；点击外部关闭。
- 修改快捷键：将 L3194-3196 的 `openMainFile()` 改为 `openQuickSwitcher()`。
- 命令面板注册新命令（在 L5984 附近）：`registerCommand('quick-open', '快速打开文件 (Ctrl+O)', '🔍', function() { openQuickSwitcher(); });`

## 四、假设与决策

| 决策 | 结论 |
|------|------|
| 搜索范围 | 复用 `wikilinkState.targets`（知识库全局可链接文件索引），与 `[[` 补全一致，非全盘扫描 |
| 匹配方式 | 子串包含（basename/fileName/relativePath/moduleName），不区分大小写 |
| 打开行为 | 直接打开该行对应的具体 target（新标签），因每行已含相对路径故无同名歧义 |
| Ctrl+O 覆盖 | 覆盖原生"打开文件"对话框快捷；原生打开仍由工具栏按钮与该命令保留 |
| 交互冲突 | 与命令面板（Ctrl+P）互斥，打开一个时关闭另一个；ACE 编辑区内不冲突 |

## 五、验证步骤

1. `node --check` 校验 `frontend/js/editor.js` 语法。
2. 运行中前端（3001 热更新）验证：
   - Ctrl+O 唤起搜索浮层，输入关键词可模糊过滤知识库文件。
   - 搜索结果含 relativePath/meta，能区分同名文件。
   - ↑↓ 导航、Enter 在**新标签页**打开对应文件、Esc 关闭。
   - 点击浮层外部关闭；再按 Ctrl+P 命令面板仍正常、互不干扰。
   - 命令面板中"快速打开文件"命令可唤起搜索。
3. 回归：原有 `[[` 补全、`openMainFile`（工具栏/命令面板）、命令面板、多标签切换不受影响。

## 六、影响文件

- `frontend/editor.html`（新增浮层 DOM）
- `frontend/styles/editor.css`（新增搜索浮层样式）
- `frontend/js/editor.js`（新增逻辑 + 改 Ctrl+O 绑定 + 注册命令）