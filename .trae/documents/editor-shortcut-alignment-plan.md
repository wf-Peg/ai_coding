# 编辑器快捷键与键盘模式说明对齐 方案（Ctrl+L 冲突修复）

## 摘要
将编辑器模块实际绑定的快捷键与「键盘模式快捷键说明」对齐。核心：把快捷键 **Ctrl/Cmd+L** 恢复为 ACE 标准「跳转到行（gotoline）」，将「格式化」迁移到 **Ctrl/Cmd+Shift+L**；同时处理发现的另一处真实冲突 **Ctrl+Shift+M（Markdown 预览 ↔ ACE 括号跳转）**。其余候选键经核对无 Win 平台冲突。

## 现状分析（探索结论）
1. **Ctrl+L 已被应用覆盖为「格式化」**
   - [editor.js L231-L239](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L231-L239)：用 ACE `addCommand('formatContent', bindKey{Ctrl-L})` 覆盖了 ACE 默认 `gotoline(Ctrl-L)`。因此编辑区内 Ctrl+L = 格式化，**不是**跳转到行——与用户预期、与 Ace 模式说明（"跳转到行 Ctrl+L"）**不一致**。
   - [editor.js L3571-L3576](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L3571-L3576)：文档级 keydown 对 Ctrl+L 做容器外兜底格式化。
2. **Ctrl+Shift+M 存在真实冲突**
   - ACE 默认 `Ctrl+Shift+M = "Expand to matching"`（jumpToMatching 括号跳转）。
   - 应用在 [editor.js L3577-3579](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L3577-L3579) 绑定 Ctrl+Shift+M = Markdown 预览。编辑区内触发时：ACE 先做括号跳转、再切预览 → 行为混杂。
3. **Ctrl+Shift+L 是 ACE 的 `expandtoline`**（expand selection to line）。若把格式化放到 Ctrl+Shift+L，将覆盖此命令（用户有明确偏好此键，须在方案中标注后果）。
4. 其余候选键均确认 Win 平台**无冲突**（经 ace.js 核对）：
   - 转换 `Ctrl+Shift+X`、全局搜索 `Ctrl+Shift+F`、快速打开 `Ctrl+Shift+O`、大纲/标签/反链/历史/最近/收藏/文件树 `Ctrl+Shift+D/T/B/H/N/A/E`、图片 `Ctrl+Shift+I`、终端 `Alt+T`、设置 `Ctrl+,`、放大/缩小 `Ctrl+= / Ctrl+-` 均未绑。
   - `F11`（全屏）与 ACE 全屏语义一致，不算冲突。
   - `Ctrl+Z / Ctrl+Shift+Z`（撤销/重做）、`Ctrl+F`（查找）、`Ctrl+H`（替换）与 ACE 语义相同，无需改动。

## 冲突矩阵与决策
| 键位 | 应用意图 | ACE 默认 | 结论 |
|------|---------|---------|------|
| Ctrl+L | 格式化（当前被覆盖） | 跳转到行 gotoline | **改为让位**：恢复 gotoline，格式化迁走 |
| Ctrl+Shift+L | （拟放格式化） | 展开到行 expandtoline | 采纳用户偏好放格式化，覆盖 expandtoline（标注） |
| Ctrl+Shift+M | Markdown 预览 | 括号跳转 expand-to-matching | 捕获阶段优先 App，保留原键 |
| Ctrl+Shift+X / F / O / D / T / B / H / N / A / E | 各种 | 未绑定 | 无冲突 |

## 方案（改动清单）
### A. `frontend/js/editor.js`
1. **恢复 Ctrl+L 为跳转行，格式化移到 Ctrl+Shift+L**
   - [L231-L239](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L231-L239)：`formatContent` 的 `bindKey` 改为 `{ win: 'Ctrl-Shift-L', mac: 'Command-Shift-L' }`，comment 更新为「覆盖 ACE 默认 Ctrl+Shift+L（展开到行），用于格式化」。
   - [L3571-L3576](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L3571-L3576)：该分支改为 `modifier && event.shiftKey && event.key.toLowerCase()==='l'`（Ctrl/Cmd+Shift+L），保留 `mainEditor.container.contains(event.target) return` 容器外兜底；删除原对齐 `!event.shiftKey && ...==='l'` 的格式化逻辑，让 Ctrl+L 回归 gotoline。
2. **Markdown 预览改为捕获阶段优先**
   - 参照图片插入（[L3300-L3310](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L3300-L3310)）新增一条 `window.addEventListener('keydown', ..., true)`：命中 `modifier && shiftKey && key==='m'` 时 `preventDefault + stopImmediatePropagation + toggleMarkdownPreview()`。
   - 删除 [L3577-L3579](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L3577-L3579) 旧 bubble 分支，避免双重触发。
3. **固定快捷键列表**[~L3030](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L3030)：`['格式化', 'Ctrl+L']` → `['格式化', 'Ctrl+Shift+L']`。
4. **Ace 模式说明表**[~L3074-L3077](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L3074-L3077)：删除错误的 `['选择当前行','Ctrl+L']`，仅保留 `['跳转到行','Ctrl+L']`（恢复后与运行时一致）。`ACE_CMD_KEYS` 已含 `gotoline/Ctrl+L`，无需改。
5. 命令面板 `markdown` 已用 `Ctrl+Shift+M`（[L6342](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L6342)）保持不变。

### B. `frontend/editor.html`
- [formatBtn 标题 L43](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/editor.html#L43)：`title="格式化 Ctrl+L"` → `title="格式化 Ctrl+Shift+L"`。
- markdownBtn 标题保持「Markdown 预览 Ctrl+Shift+M」不变。

## 假设与决策
- 采纳用户明确偏好：**格式化 → Ctrl+Shift+L**，接受因此覆盖 ACE `expandtoline`（展开整行选择）在该键上的默认；若用户更倾向不覆盖任何 ACE 命令，可选 **Alt+Shift+F**（已确认 ACE 未占用），实现上则改为文档级 keydown 处理、无需 ACE 覆盖。**默认采用 Ctrl+Shift+L。**
- Ctrl+L 恢复为「跳转到行」，容器外取消格式化兜底。
- Markdown 预览保留 Ctrl+Shift+M，用捕获阶段保证 App 优先；ACE 括号跳转失去该键。
- 不改 macOS 逻辑执行预期：Cmd 组合键由既有 `modifier=crtl||meta` 统一映射。

## 验证步骤
1. `node --check frontend/js/editor.js`。
2. 手动：编辑区内 Ctrl+L 弹出「跳转到行」；Ctrl+Shift+L 触发格式化且不弹跳转；Ctrl+Shift+M 只切换预览、不再括号跳转。
3. ⌨️ 速查弹窗：固定列表「格式化 Ctrl+Shift+L」；Ace 模式「跳转到行 Ctrl+L」。
4. 深浅主题下弹窗/工具栏 title 显示正常。