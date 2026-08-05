# 编辑器翻译与词典增强计划

## 摘要
对编辑器模块的翻译功能进行全面升级，实现中英文双向离线翻译、在线翻译改为AI对话方式、用户可自定义词典条目、编辑器输入时自动匹配词典内容提供候选词补全。

## 当前状态分析

### 现有架构
- **`dict-offline.js`**：`window.DICT = {英文单词: 中文释义}` 的扁平映射，约870个词条，仅支持英文→中文单向
- **`editor.js`**：右键菜单4个功能（离线翻译/在线翻译/添加英文翻译/AI分析上下文），`sendAiMessage()` 通过SSE流式调用后端AI API
- **ACE编辑器**：已开启 `enableBasicAutocompletion` 和 `enableLiveAutocompletion`，但未设置任何自定义 completer
- **localStorage**：统一使用 `_v1` 后缀存储用户设置（主题、工作区等）
- **Modal模式**：采用 `modal-backdrop` + `modal-card` 结构，`data-close-modal` 属性关闭

### 当前问题
1. 离线词典仅支持英文→中文，不支持中文→英文
2. 在线翻译依赖 MyMemory 第三方 API，有每日限流，且用户要求改为直接调用右侧AI
3. 无用户自定义词典功能
4. 编辑器输入时无词典自动补全

## 修改方案

### 1. 离线词典增强：支持中英文双向翻译

**涉及文件**：`/workspace/frontend/js/dict-offline.js`

**改动**：
- 在现有 `DICT` 对象基础上，新增 `DICT_CN` 对象存储中文→英文映射
- 导出 `window.DICT_CN` 和 `window.DICT` 
- 提供几个常用中文词映射（如 "你好" → "hello", "谢谢" → "thank you" 等）

**原因**：原词典只有英文→中文；用户需要中文也能查到英文。

### 2. 在线翻译改为AI对话方式

**涉及文件**：`/workspace/frontend/js/editor.js`

**改动**：
- 删除 `onlineTranslateText()` 中 MyMemory API 调用逻辑
- 改为调用 `sendAiMessage()` 发送提示词 `"一句话翻译：{text}"` 到右侧AI聊天面板
- 删除 `translateViaAi()` 函数（不再需要独立的AI翻译回退）
- 同时修改 `addEnglishTranslation()` 和 `addEnglishViaAi()` — 改为调用 `sendAiMessage()` 发送 `"一句话翻译：{text}"`，同时在编辑器光标位置插入翻译结果

**原因**：用户要求在线翻译走右侧AI面板，统一交互入口，不依赖第三方API。

### 3. 用户自定义词典添加功能

**涉及文件**：
- `/workspace/frontend/editor.html` — 新增词典管理弹窗HTML
- `/workspace/frontend/js/editor.js` — 新增词典管理逻辑
- `/workspace/frontend/styles/editor.css` — 弹窗样式

**改动**：
- **HTML**：新增 `dictModal` 弹窗，包含：
  - 输入框：源词（中文或英文）
  - 输入框：目标释义
  - 添加按钮
  - 已有词典列表展示
  - 删除按钮
- **JS**：
  - 新增 `window.USER_DICT` 对象，存储用户自定义映射（`localStorage` 持久化）
  - 新增 `loadUserDict()` / `saveUserDict()` 函数
  - 新增 `addUserDictEntry(source, target)` / `removeUserDictEntry(source)` 函数
  - 右键菜单新增"管理词典"菜单项
  - 词典查找时优先查 `USER_DICT`，再查 `DICT` / `DICT_CN`
- **CSS**：词典管理弹窗样式

**存储结构**（localStorage key: `editor_user_dict_v1`）：
```json
{
  "hello": "你好",
  "你好": "hello",
  "world": "世界",
  "世界": "world"
}
```

### 4. 编辑器输入时自动匹配词典

**涉及文件**：`/workspace/frontend/js/editor.js`

**改动**：
- 在 `createEditor()` 或 `initializeAiChat()` 中，为编辑器添加自定义 completer
- 使用 `ace.require("ace/ext/language_tools").addCompleter()` 或直接设置 `editor.completers`
- Completer 逻辑：
  - 获取当前输入的前缀（当前单词）
  - 在 `USER_DICT` + `DICT` + `DICT_CN` 中搜索匹配项
  - 返回匹配的候选词列表（`name` + `value`）
  - 类似 SQL 中 `S` → `SELECT` 的体验

**completer 实现**：
```javascript
var dictCompleter = {
  getCompletions: function(editor, session, pos, prefix, callback) {
    if (!prefix || prefix.length < 1) return callback(null, []);
    var results = [];
    var dict = Object.assign({}, window.DICT, window.DICT_CN, window.USER_DICT || {});
    var lower = prefix.toLowerCase();
    Object.keys(dict).forEach(function(key) {
      if (key.indexOf(lower) === 0 || key.toLowerCase().indexOf(lower) === 0) {
        results.push({
          caption: key,
          value: key,
          meta: '词典: ' + (dict[key] || '')
        });
      }
    });
    // 取前30个结果
    callback(null, results.slice(0, 30));
  }
};
```

## 涉及文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `frontend/js/dict-offline.js` | 修改 | 新增 DICT_CN 中文→英文映射 |
| `frontend/editor.html` | 修改 | 新增词典管理弹窗HTML |
| `frontend/js/editor.js` | 修改 | 在线翻译改为AI对话、用户词典管理、编辑器completer |
| `frontend/styles/editor.css` | 修改 | 词典管理弹窗样式 |

## 实现步骤

1. **增强 dict-offline.js**：新增 DICT_CN 对象，包含常用中文词→英文映射
2. **修改在线翻译逻辑**：`onlineTranslateText` 改为调用 `sendAiMessage("一句话翻译：" + text)`
3. **修改添加英文翻译逻辑**：`addEnglishTranslation` 改为调用 `sendAiMessage` + 插入编辑器
4. **新增词典管理功能**：弹窗HTML + JS逻辑（增删查） + localStorage持久化
5. **新增编辑器completer**：注册自定义completer，匹配词典内容
6. **更新右键菜单**：添加"管理词典"菜单项
7. **词典查找优化**：`lookupOfflineWord` 同时查 USER_DICT + DICT_CN + DICT

## 假设与决策

- 用户词典数据存储在 `localStorage`，key 为 `editor_user_dict_v1`
- ACE completer 的匹配策略：前缀匹配（prefix match），不区分大小写
- 自定义词典优先于内置词典
- 离线翻译结果显示时标注来源（内置词典/用户词典/词形变换）

## 验证步骤

1. 右键选中英文词 → 离线翻译 → 显示中文释义
2. 右键选中中文词 → 离线翻译 → 显示英文释义（需提前添加或使用内置DICT_CN）
3. 右键选中文本 → 在线翻译 → 右侧AI面板弹出并发送"一句话翻译：{text}"
4. 右键选中中文 → 添加英文翻译 → AI翻译后插入到编辑器
5. 右键菜单 → 管理词典 → 弹窗中添加/删除词条
6. 编辑器输入"hel" → 自动弹出"hello: 你好"等候选词
7. 验证用户词典持久化：刷新页面后自定义词条仍在