# 编辑器选中逻辑优化计划

## 摘要

优化编辑器选中行为，使空行在多行选区中也能正确显示选中高亮，借鉴 VS Code / Monaco 等优秀开源项目的实现方式。

## 现状分析

### 当前选中逻辑

[editor.js](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/editor.js#L63-L82) 中 `createEditor()` 创建 Ace 编辑器时，**未设置 `selectionStyle` 选项**，使用 Ace 默认值 `'text'`：

```javascript
editor.setOptions({
  fontSize: '13px',
  showPrintMargin: false,
  displayIndentGuides: true,
  highlightActiveLine: !readOnly,
  highlightSelectedWord: true,
  // ... selectionStyle 未设置 → 默认 'text'
});
```

### 当前行为的问题

Ace 的 `selectionStyle` 有两种模式：

| 值 | 行为 | 空行表现 |
|---|---|---|
| `'text'`（默认） | 仅高亮实际字符 | 空行无任何高亮，视觉上选区"断裂" |
| `'line'` | 整行高亮 | 空行也显示完整行宽高亮 |

**当前使用 `'text'`，导致**：当用户跨多行选中文本时，空行（无字符的行）没有任何高亮显示，选区在视觉上不连续，体验不佳。

### 相关代码

- `getTargetRangeAndText()`（line 296-307）：格式化/转换操作获取选区，无选区时回退到全文
- `syncSelectedWord()`（line 516-524）：双击选词同步
- `updateCursorStatus()`（line 526-532）：状态栏更新
- CSS 选中样式（[editor.css](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/styles/editor.css#L255-L261)）：已定义 `.ace_selection` 颜色

### 优秀开源项目参考

**VS Code / Monaco Editor** 的做法：
- 选区在数据层面始终是**按字符范围**存储的（精确到行列位置）
- 但在渲染层面，选区以**整行块**方式高亮 — 空行也显示完整行宽的选中背景色
- 复制/剪切时仍然只取实际字符，不受渲染影响

**Ace 的 `selectionStyle: 'line'`** 正是对此行为的原生支持：
- 渲染时：整行高亮（含空行），视觉连续
- 操作时：选区范围仍是字符级，复制/剪切不受影响
- 这是 Ace 官方推荐的「现代编辑器」风格

## 修改方案

### 唯一修改：`frontend/js/editor.js`

在 `createEditor()` 的 `setOptions()` 中增加一行：

```diff
 editor.setOptions({
   fontSize: '13px',
   showPrintMargin: false,
   displayIndentGuides: true,
   highlightActiveLine: !readOnly,
   highlightSelectedWord: true,
+  selectionStyle: 'line',
   enableBasicAutocompletion: false,
   enableLiveAutocompletion: false,
   useWorker: true,
   readOnly,
   scrollPastEnd: 0.3,
   wrap: false
 });
```

**同时应用于主编辑器和对比编辑器**（两者共用同一个 `createEditor()` 函数）。

### 为什么这是正确的方案

1. **`selectionStyle` 仅影响渲染**：Ace 的选区模型始终是字符级 Range，`selectionStyle` 只改变视觉高亮方式，不影响复制/剪切/格式化等操作
2. **与 VS Code 行为一致**：空行在多行选区中显示完整行宽高亮
3. **已有 CSS 兼容**：`.ace_selection` 样式已定义，`'line'` 模式下会应用到整行，视觉效果更好
4. **改动最小**：仅一行配置变更，零风险

### 预期效果

- **修改前**：选中跨多行时，空行无高亮，选区视觉断裂
- **修改后**：空行也显示完整行宽高亮，选区视觉连续，与 VS Code 行为一致

## 验证步骤

1. 打开编辑器，输入多行文本，中间包含空行
2. 鼠标拖拽选中跨多行（含空行）
3. 确认空行也显示选中高亮背景色
4. 复制选中内容，确认仅复制实际字符（不含空行多余内容）
5. 在对比模式下也验证同样行为