# 修复浏览器插件：剪藏列表显示「获取剪藏列表失败」

## 一、现状分析

**后端正常、桌面版正常，仅插件异常。**
- 生效存储路径为 `L:\归档\40_Knowledge...\剪藏收集\clip-storage`（`backend\application.yml` 指向该路径，桌面版即读取此处）。
- 该路径下剪藏数据存在：`inbox` 目录 4 条剪藏（均为 `type:"text"`，`content` 不含「待办/前完成」），`todoList` 目录 21 条待办。
- 旧路径 `剪藏内容\Clip_Bed\clip-storage` 的 `inbox` 与 `todoList` 均为空，可排除；运行中的后端必然读取新路径（否则待办也不会显示）。

**插件内「待办有、剪藏获取失败」的根本差异（关键发现）：**
- 插件主页面 `index.html` 用左右两个 iframe 分别加载 `todo.html` 与 `clip.html`。
- `todo.js`：API 地址**硬编码** `http://127.0.0.1:8081/api/todo`；且 `fetchTodos` 的 `catch` 会回退到 **3 条模拟待办**（`todo.js` L79-L91）。因此后端不可达/URL 不对时，待办面板仍显示“数据”。
- `clip-main.js`：API 地址为**可配置**项，默认 `http://127.0.0.1:8081/api/clip`，会被 `chrome.storage.local` 的 `apiUrl`（`options.js` 默认 `http://localhost:8081/api/clip/add`）异步覆盖（`clip-main.js` L8-L19）；`fetchClips` 的 `catch` 直接显示「获取剪藏列表失败」`clip-main.js` L365-L373。

**结论：** 用户看到的「待办是有」很可能是 todo 面板的**模拟数据兜底**掩盖了插件到后端连通性/API 配置问题；而剪藏面板如实上报了失败。若待办确实为真实数据，则剪藏失败来自 `fetchClips` 的请求或渲染被 catch 捕获——两种情形都被「获取剪藏列表失败」这一个报错掩盖，无法区分。

**附带的潜在缺陷（非本次直接根因，属回归排查发现）：**
- `clip-main.js` L320 过滤逻辑存在运算符优先级 bug：
  `return !clip.type || clip.type !== 'todo' && !clip.content?.includes('前完成') && !clip.content?.includes('待办');`
  实际含义是「剔除 content 含『前完成/待办』的非 todo 剪藏」，会**误删真实剪藏**。后端如今已正确排除待办目录，此前端文本嗅探应移除。

## 二、变更方案

### 文件 1：`browser-extension/clip-main.js`

1. **消除配置竞态**：首次 `fetchClips()`（当前在 DOMContentLoaded 里 L73）改为在 `chrome.storage.local.get(['apiUrl'])` 回调解析完成后再执行，确保请求使用最终 `API_BASE_URL`，避免首发请求用到还没覆盖的默认值。
2. **拆分错误报告**：把原单一 `try/catch` 拆开——
   - 网络/顶层逻辑错误：显示「获取剪藏列表失败」并打印 `error.message` + 请求 URL，便于回归定位；
   - `createClipItem` 渲染单独包一层 `try/catch`，单卡片渲染失败不中断整个列表，也不被误报为「获取失败」（打印具体卡片 id 与堆栈）。
3. **修正过滤逻辑**：将 L316-L320 替换为仅按类型过滤：
   `return clip.type !== 'todo';`
   删除基于 content 关键词的嗅探（后端已按目录排除待办，前端无需再嗅探文本）。
4. 保留 `window.API_BASE_URL` / `window.GIT_API_BASE_URL` 的暴露（上传与请求依赖）。

### 文件 2：`browser-extension/todo.js`（可选，小改）

- 将 `catch` 的「静默回退到模拟待办」改为「保留模拟数据，但顶部显示一个醒目的『未能连接后端，以下为示例数据』提示条」，并在控制台打印真实错误。
- 目的：回归时辨别「待办有」是真实数据还是兜底，避免再次误判；不改变成功路径、不影响正常使用。

## 三、假设与决策

- 假设用户插件 `options` 页 HAPI 地址可能被误配为非 127.0.0.1/localhost:8081 的地址，导致剪藏失败；由于无法读取运行时 `chrome.storage`，需在验证步骤人工核对。
- 决策：不对 todo 成功路径做任何改动；只把它失败的兜底从「静默」改为「可见」，以支持回归诊断。
- 决策：优先修复覆盖了「获取剪藏列表失败」这一确认失败模式的健壮性问题与潜在过滤 bug，最终根因由验证步骤定论。

## 四、验证步骤

1. 语法检查：`node --check browser-extension/clip-main.js`、`node --check browser-extension/todo.js`。
2. 打开插件 `options.html`，核对「API地址」字段 —— 应为 `http://localhost:8081/api/clip/add` 或 `http://127.0.0.1:8081/api/clip/add`；若指向其它不可达地址，即为连通性根因。
3. 启动后端（8081），重新加载未打包插件，进入 `index.html`：右侧剪藏面板应显示 4 条 inbox 剪藏，计数为 4；左侧待办正常。
4. 停止后端后刷新插件：剪藏面板显示明确失败信息；待办面板显示「未连接后端，以下为示例数据」提示条（若采用文件 2 改动）。
5. 在控制台确认第一条剪藏的 `GET /api/clip/list` 返回 200 且无红色异常。