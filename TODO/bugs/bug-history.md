# Bug 历史记录

> 记录每次 bug 的现象、原因、修复方式和经验教训，供 AI 和开发者参考。
> 后续可依据 bug 历史更新 agent.md 约束，避免同类问题重复出现。

## 格式

```markdown
### [日期] Bug 标题

- **现象**：
- **原因**：
- **修复方式**：
- **经验教训**：
- **相关文件**：
```

---

### [2026-09-17] 工作台组件面板「添加组件」列表为空

- **现象**：工作台「全部概览」→「自定义」→「添加组件」面板打开但列表为空；组件网格亦空白。
- **原因**：`frontend/workspace.html` 中 `workbench-widgets.js`（定义 `window.WB`）被放在 `workspace.js` **之后**。body 末尾脚本按顺序同步执行，`workspace.js` 的 `init()` 加载瞬间同步调用 `registerOverviewWidgets()` 时 `window.WB` 尚为 `undefined`，函数首行 `if (!window.WB) return;` 早退——组件从未注册/挂载，面板自然取不到任何组件。
- **修复方式**：将 `<script src="js/workbench-widgets.js">` 与 `<script src="js/anniversary-shared.js">` 前移到 `workspace.js` 之前；其余脚本顺序不变（workspace.js 本就先于 ui-common/logger 加载，无头部依赖）。
- **经验教训**：所有「挂载/注册」型引擎脚本必须在其消费方（页面逻辑 JS）**之前**引入。新增引擎模块时先核对 HTML 底部 script 顺序；此约束应写入 agent.md。
- **相关文件**：`frontend/workspace.html`（script 顺序）。

<!-- 新 bug 记录追加在此行之上 -->