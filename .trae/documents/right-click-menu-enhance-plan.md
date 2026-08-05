# 右键菜单增强实施计划

## 一、概述

完成四个任务：
1. 修复右键「添加到词典库」无效（点击无反应）
2. AI搜索/在线翻译完成后自动将结果添加到词典
3. 右键菜单按功能分组排序，补齐缺失的图标
4. 扩充 DICT_CN 词典内容，增加常用词汇、软件开发、财务金融三类词汇

---

## 二、当前状态分析

### Task 1：添加到词典库无效

**根因：** `prompt()` 函数在 Electron 主窗口中不可用。

`electron/main.js` 配置了 `contextIsolation: true`，该设置下 Electron 会禁用 `window.prompt()` 原生对话框。`promptAddToDictLib` 函数（editor.js）调用 `prompt()` 时因函数未定义而静默失败，导致点击无反应。

### Task 2：AI搜索/在线翻译自动添加词典

现有流程：
- `aiSearch`（editor.js）：调用 `buildSearchPrompt(selectedText)` → `sendAiMessage(prompt)` → SSE 流式返回
- `onlineTranslate`（editor.js）：调用 `onlineTranslateText(selectedText)` → `sendAiMessage('一句话翻译：' + text)` → SSE 流式返回
- `sendAiMessage`（editor.js）内部处理 SSE 流式响应，`done` 事件后完成

需要：在 AI 回复完成后，自动提取助手回复内容，存入对应词典。

### Task 3：右键菜单分组

当前菜单（editor.html）顺序混乱，部分按钮缺少图标：

| 按钮 | 图标 | 分组 |
|------|------|------|
| 复制 | ✗ | 编辑操作 |
| 剪切 | ✗ | 编辑操作 |
| 粘贴 | ✗ | 编辑操作 |
| 全选 | ✗ | 编辑操作 |
| AI 搜索选中内容 | ✗ | AI 功能 |
| 📥 智能入库 | ✓ | AI 功能 |
| 🔑 AI 识别导入密码 | ✓ | AI 功能 |
| 📖 离线翻译 | ✓ | 翻译功能 |
| 🌐 在线翻译 | ✓ | 翻译功能 |
| 📝 添加自定义词典 | ✓ | 翻译功能 |
| 📚 添加词典库 | ✓ | 翻译功能 |
| 🤖 AI 分析上下文 | ✓ | AI 功能 |
| 📚 管理词典 | ✓ | 词典管理 |

### Task 4：DICT_CN 词典内容不足

`dict-offline.js` 中 DICT_CN（行 869-988）现有约 120 条中文→英文映射，以日常用语为主，缺少软件开发、财务金融等专业领域词汇，离线翻译对专业文本支持不足。

---

## 三、详细变更方案

### 变更 1：修复添加到词典库（点击无反应）

**文件：** `frontend/js/editor.js`

**方案：** 用自定义 HTML 模态对话框替换 `prompt()`，兼容 Electron contextIsolation 环境。

**具体修改：**

#### 1.1 新增 `showDictLibAddDialog` 函数

```js
/** 弹出词典库添加对话框（替代 window.prompt，兼容 Electron contextIsolation） */
function showDictLibAddDialog(sourceText) {
  var overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.style.cssText = 'display:flex;align-items:center;justify-content:center;z-index:10000';
  
  var dialog = document.createElement('div');
  dialog.className = 'modal-card';
  dialog.style.cssText = 'width:400px;padding:20px';
  
  dialog.innerHTML = '<div class="panel-header" style="margin-bottom:12px">'
    + '<div><h2>添加到词典库</h2><p style="font-size:12px;color:var(--app-text-muted);margin-top:4px">为 "' + escapeHtml(sourceText) + '" 添加翻译</p></div>'
    + '</div>'
    + '<label class="field-group wide" style="margin-bottom:12px">'
    + '<span class="field-label">翻译</span>'
    + '<input class="field-control" id="dictLibAddInput" placeholder="输入翻译" style="width:100%">'
    + '</label>'
    + '<div class="panel-actions" style="justify-content:flex-end;gap:8px">'
    + '<button class="tool-btn" id="dictLibAddCancelBtn">取消</button>'
    + '<button class="tool-btn primary" id="dictLibAddConfirmBtn">添加</button>'
    + '</div>';
  
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  
  var input = dialog.querySelector('#dictLibAddInput');
  var confirmBtn = dialog.querySelector('#dictLibAddConfirmBtn');
  var cancelBtn = dialog.querySelector('#dictLibAddCancelBtn');
  
  function close() { document.body.removeChild(overlay); }
  
  confirmBtn.addEventListener('click', function() {
    var translation = input.value.trim();
    if (translation) {
      if (addDictLibEntry(sourceText, translation)) {
        showToast('✅ 已添加到词典库: ' + sourceText + ' → ' + translation);
      }
    }
    close();
  });
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
  input.addEventListener('keydown', function(e) { if (e.key === 'Enter') confirmBtn.click(); });
  
  setTimeout(function() { input.focus(); }, 100);
}
```

#### 1.2 修改 `promptAddToDictLib`

```js
function promptAddToDictLib(sourceText) {
  showDictLibAddDialog(sourceText);
}
```

---

### 变更 2：AI搜索/在线翻译自动添加词典

**文件：** `frontend/js/editor.js`

**方案：** 在 `sendAiMessage` 的 SSE `done` 事件处理中，检查待处理的词典添加请求，若有则读取助手回复并自动存入词典。

#### 2.1 新增全局变量

```js
/** 待处理的词典自动添加（AI搜索/在线翻译完成后触发） */
var pendingDictAdd = null;
```

#### 2.2 修改 `aiSearch` 处理分支

```js
if (action === 'aiSearch') {
  const prompt = window.EditorAiChatCore.buildSearchPrompt(selectedText);
  if (prompt) {
    pendingDictAdd = { source: selectedText.trim(), type: 'mapping' };
    sendAiMessage(prompt);
  }
  return;
}
```

#### 2.3 修改 `onlineTranslateText` 函数

```js
function onlineTranslateText(text) {
  if (!text.trim()) return;
  var prompt = '一句话翻译：' + text.trim();
  pendingDictAdd = { source: text.trim(), type: 'lib' };
  showToast('🌐 正在通过 AI 翻译...');
  setAiChatPanelOpen(true);
  setTimeout(function() {
    sendAiMessage(prompt);
  }, 300);
}
```

#### 2.4 在 `sendAiMessage` 的 `done` 事件中插入自动添加逻辑

```js
} else if (event.event === 'done' || event.raw === '[DONE]') {
  request.completed = true;
  finishAiRequest(request, { type: 'done', assistantId: request.assistantId }, 'happy');
  // 自动添加词典：AI 回复完成后，将结果存入对应词典
  if (pendingDictAdd) {
    var addInfo = pendingDictAdd;
    pendingDictAdd = null;
    var messages = request.tab.aiChat.messages || [];
    var assistantMsg = null;
    for (var mi = messages.length - 1; mi >= 0; mi--) {
      if (messages[mi].role === 'assistant' && !messages[mi].streaming && messages[mi].content) {
        assistantMsg = messages[mi];
        break;
      }
    }
    if (assistantMsg) {
      var translation = assistantMsg.content.replace(/^["']|["']$/g, '').trim();
      if (translation) {
        if (addInfo.type === 'mapping') {
          if (addUserDictEntry(addInfo.source, translation)) {
            showToast('✅ 已自动添加到自定义映射: ' + addInfo.source + ' → ' + translation);
          }
        } else if (addInfo.type === 'lib') {
          if (addDictLibEntry(addInfo.source, translation)) {
            showToast('✅ 已自动添加到词典库: ' + addInfo.source + ' → ' + translation);
          }
        }
      }
    }
  }
}
```

---

### 变更 3：右键菜单按功能分组 + 补齐图标

**文件：** `frontend/editor.html`

**修改内容：** 重新排列右键菜单按钮顺序，补齐缺失的图标。

```html
<div class="editor-context-menu" id="editorContextMenu" hidden role="menu">
  <!-- ─── 编辑操作 ─── -->
  <button type="button" data-context-action="copy" role="menuitem">📋 复制</button>
  <button type="button" data-context-action="cut" role="menuitem">✂️ 剪切</button>
  <button type="button" data-context-action="paste" role="menuitem">📄 粘贴</button>
  <button type="button" data-context-action="selectAll" role="menuitem">🔍 全选</button>
  <div class="editor-context-divider"></div>

  <!-- ─── AI 功能 ─── -->
  <button type="button" data-context-action="aiSearch" role="menuitem" id="aiSearchContextBtn">🔎 AI 搜索选中内容</button>
  <button type="button" data-context-action="smartIngest" role="menuitem" id="smartIngestContextBtn">📥 智能入库</button>
  <button type="button" data-context-action="aiImportPassword" role="menuitem" id="aiImportPasswordContextBtn">🔑 AI 识别导入密码</button>
  <button type="button" data-context-action="aiContextAnalysis" role="menuitem" id="aiContextAnalysisContextBtn">🧠 AI 分析上下文</button>
  <div class="editor-context-divider"></div>

  <!-- ─── 翻译功能 ─── -->
  <button type="button" data-context-action="offlineTranslate" role="menuitem" id="offlineTranslateContextBtn">📖 离线翻译</button>
  <button type="button" data-context-action="onlineTranslate" role="menuitem" id="onlineTranslateContextBtn">🌐 在线翻译</button>
  <button type="button" data-context-action="addCustomMapping" role="menuitem" id="addCustomMappingContextBtn">📝 添加自定义词典</button>
  <button type="button" data-context-action="addToDictLib" role="menuitem" id="addToDictLibContextBtn">📚 添加词典库</button>
  <div class="editor-context-divider"></div>

  <!-- ─── 词典管理 ─── -->
  <button type="button" data-context-action="manageDictionary" role="menuitem" id="manageDictionaryContextBtn">📚 管理词典</button>
</div>
```

**文件：** `frontend/js/editor.js`

**修改分隔线显隐逻辑**（openEditorContextMenu 函数中）：
- 现有 4 条分隔线 → 变为 3 条分隔线
- 分隔线 0（编辑操作 ↔ AI 功能）：始终可见
- 分隔线 1（AI 功能 ↔ 翻译功能）：按选中状态显隐
- 分隔线 2（翻译功能 ↔ 词典管理）：按选中状态显隐

```js
// 分隔线显隐：共3条分隔线
const translateDivider = elements.editorContextMenu.querySelectorAll('.editor-context-divider');
translateDivider.forEach(function(div, idx) {
  div.hidden = (idx >= 1) ? !hasSelection : false;
});
```

---

### 变更 4：扩充 DICT_CN 词典内容

**文件：** `frontend/js/dict-offline.js`

**方案：** 在 DICT_CN 对象的末尾（`'算法': 'algorithm'` 之后、`};` 之前）插入三大类新增词汇，约 200 条。

#### 4.1 常用词汇（约 50 条）

涵盖日常交流、基本事物、常见动作等高频词汇，补充现有 DICT_CN 中缺失的日常用语。

#### 4.2 软件开发词汇（约 80 条）

涵盖编程语言、框架、工具、概念、开发流程等专业词汇，如：
- 编程语言：Java, Python, JavaScript, TypeScript, Go, Rust, C++, SQL, HTML, CSS
- 框架工具：React, Vue, Spring, Docker, Kubernetes, Git, Maven, Gradle, Webpack
- 概念术语：微服务, 容器化, 云计算, 持续集成, 持续部署, 敏捷开发, 版本控制, 代码审查, 单元测试, 集成测试, 端到端测试, 性能优化, 内存泄漏, 线程安全, 并发编程, 面向对象, 函数式编程, 设计模式, 重构, 技术债务
- 其他：API, RESTful, GraphQL, gRPC, WebSocket, JSON, XML, YAML, Markdown, Protobuf, Swagger, OpenAPI, 中间件, 负载均衡, 反向代理, 缓存, 消息队列, 搜索引擎, 日志收集, 监控告警

#### 4.3 财务金融词汇（约 70 条）

涵盖会计、投资、银行、保险、税务等专业词汇，如：
- 会计：资产负债表, 利润表, 现金流量表, 应收账款, 应付账款, 折旧, 摊销, 成本核算, 预算管理, 审计, 财务报表, 会计分录, 总账, 明细账, 试算平衡
- 投资：股票, 债券, 基金, 期货, 期权, 市盈率, 市净率, 股息率, 净资产收益率, 投资回报率, 风险投资, 私募股权, 首次公开募股, 资产配置, 分散投资, 定投
- 银行/保险：存款, 贷款, 利率, 汇率, 保险费, 理赔, 保单, 投保人, 受益人, 保额, 免赔额, 寿险, 财险, 健康险
- 税务：个人所得税, 企业所得税, 增值税, 营业税, 关税, 税收优惠, 纳税申报, 税务稽查, 避税, 税收筹划

---

## 四、涉及文件清单

| 文件 | 修改内容 |
|------|----------|
| `frontend/js/editor.js` | ①新增 `showDictLibAddDialog` 替代 `prompt()` ②新增 `pendingDictAdd` 变量 ③修改 `aiSearch`/`onlineTranslateText` 设置待处理标记 ④ `sendAiMessage` SSE done 事件中自动添加词典 ⑤分隔线显隐逻辑更新 |
| `frontend/editor.html` | 右键菜单重新分组排序，补齐缺失图标 |
| `frontend/js/dict-offline.js` | DICT_CN 新增约 200 条常用/软件开发/财务金融词汇 |

---

## 五、验证步骤

1. 右键选中文本 → 「添加词典库」→ 弹出输入框 → 输入翻译 → 确认 → 提示添加成功
2. 右键选中文本 → 「添加词典库」→ 弹出输入框 → 点取消/点击遮罩 → 关闭
3. 右键选中中文文本 → 「AI 搜索选中内容」→ AI 回复完成后 → 自动提示"已自动添加到自定义映射"
4. 右键选中中文文本 → 「在线翻译」→ AI 回复完成后 → 自动提示"已自动添加到词典库"
5. 右键菜单分组正确：编辑操作 → AI 功能 → 翻译功能 → 词典管理
6. 所有菜单项都有图标显示
7. AI 搜索/在线翻译失败时（网络错误），不触发自动添加
8. 选中软件开发相关中文（如"微服务"）→ 离线翻译 → 显示正确英文翻译
9. 选中财务金融相关中文（如"市盈率"）→ 离线翻译 → 显示正确英文翻译