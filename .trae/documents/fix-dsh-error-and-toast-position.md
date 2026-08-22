# 修复：DSH 启动报错文案 + Toast 弹窗位置不统一

## 摘要
排查并修复两个问题：
1. 设置页启动 DSH 后弹窗显示"启动失败：DSH process exited before ready"，文案过于笼统，未透传真实报错原因。
2. 弹窗提示（Toast）每次出现的位置都不统一（不止 DSH 报错这一个，全应用通用通知都存在），需要排查统一。

已定位两处根因（见下），均为真实缺陷，直接修复即可，无需用户额外输入。

---

## 现状分析

### 问题 2 根因：Toast 位置漂移（先修这个，独立且确凿）
所有页面都加载 `frontend/js/ui-common.js`，通知走共享的 `UI.toast`（`window.UI.toast`）。其实现里：

- [ui-common.js:29](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/ui-common.js#L29) 定义模块级 `var toastCount = 0;`，**只增不减、永不重置**。
- [ui-common.js:39](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/ui-common.js#L39) 每次调用 `++toastCount`。
- [ui-common.js:58-59](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/ui-common.js#L58-L59)：`var offset = 16 + (toastCount % 6) * 64; el.style.top = offset + 'px';`

由于 toast 是短暂自消（约 2s）且 `toastCount` 全局累计，**每次新 toast 都会落在 Slot 0→5 中不同的纵向位置**（16/80/144/208/272/336px）。即便界面同时只弹一个（如 DSH 报错），也会随调用次数在 6 个位置间漂移 —— 这就是"每次弹窗位置不统一"。

此外各页面还有多套**重复的 `showToast` 兜底实现**，位置样式各不相同，进一步放大不一致（详见改动清单）。

### 问题 1 根因：DSH 失败文案被硬编码
[main.js:1258-1261](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js#L1258-L1261)：
- 子进程退出、端口未就绪时，真正有用的原因由 `buildDshFailMessage(recentTail)` 提炼（含 `MODULE_NOT_FOUND`/`ERR_`/`Cannot find module` 等真实报错），但它只传给了 `failNow()`（广播到面板），**返回值却硬编码成英文 `'DSH process exited before ready'`**。
- 设置页 [settings.js:1753](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/js/settings.js#L1753) 展示的正是 `r.message`，于是用户只看到笼统文案，看不到真实原因。
- 同函数超时分支 [main.js:1283](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js#L1283) 返回的也是英文 `'DSH Agent startup timeout on port ...'`，同样笼统。

---

## 改动方案

### A. 统一 Toast 位置（核心修复）
文件：`frontend/js/ui-common.js`

1. 将 `var toastCount = 0;` 改名为 `var toastSeq = 0;`（仅用于生成唯一 `id`，不再参与位置计算）。
2. 新增堆叠辅助函数：
   ```js
   function repositionToasts(root) {
     var list = root.querySelectorAll('.ui-toast');
     var top = 16;
     for (var i = 0; i < list.length; i++) { list[i].style.top = top + 'px'; top += 64; }
   }
   ```
3. 删除 `var offset = 16 + (toastCount % 6) * 64; el.style.top = offset + 'px';`，改为在 `r.appendChild(el)` 之后调用 `repositionToasts(r);`。
4. 在 `dismiss()` 的 `finish()`（`el.remove()` 之后）调用 `repositionToasts(r);`，收起后回收槽位、重排剩余。

效果：单个 toast 始终固定顶部居中 16px；多个同时显示时自上而下整齐堆叠；消掉后其余自动上移，位置完全一致。由于所有页面共用 `UI.toast`，全应用一次性统一。

### B. 统一各页面兜底 `showToast`（消除位置差异）
以下页面的 `showToast` 均改造为：`if (window.UI && UI.toast) { UI.toast(...); }`，删除各自不一致的 `.toast` 兜底 DOM 实现，统一走 `ui-common.js`（这些页面均已加载 ui-common.js）：
- `frontend/js/settings.js:835-850`
- `frontend/js/knowledge-detail.js:418`
- `frontend/vault.html:1910`
- `frontend/index.html:1594`（含 `systemToast` 底部居中兜底，删除）
- `frontend/workspace.js:1484`、`frontend/js/clip-sync.js:404`、`frontend/js/tools-core.js:143`（本就走 UI.toast，仅清理兜底）

**knowledge-editor 特殊处理**：`frontend/knowledge-editor.js:531` 的 `showToast` **未检查 `window.UI`**，且 `knowledge-editor.html` **未加载 ui-common.js**（[knowledge-editor.html:761](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/knowledge-editor.html#L761) 只有 `knowledge-editor.js`），其 `.toast` 是无定位样式（[theme-vault-notion.css:285](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/styles/theme-vault-notion.css#L285) 仅有配色无 `position`），会渲染在正文流顶部左上角。改为：
- `knowledge-editor.html` 页面底部追加 `<script src="js/ui-common.js"></script>`（`ensureRoot`/UI 均为按需懒建，无副作用）。
- `knowledge-editor.js` 的 `showToast` 改为与其它页一致（委托 `UI.toast`；兜底分支保留给注释即可，实际不会触发）。

> 决策：所有目标页面均已/将加载 `ui-common.js`，`window.UI.toast` 稳定存在，因此直接收敛到共享实现，删除冗余的 `.toast` 兜底，是风险最低、收益最大的方案。

### C. 透传 DSH 真实报错文案
文件：`electron/main.js`

1. [main.js:1258-1261](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js#L1258-L1261) 返回值改为真实原因：
   ```js
   if (processExited && !(await checkHttpPort(port))) {
     const msg = buildDshFailMessage(recentTail);
     log.warn(`[DSH Agent] tail: ${recentTail.slice(-15).join(' ｜ ')}`);
     failNow(msg);
     return { success: false, message: msg };
   }
   ```
2. 超时分支 [main.js:1283](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/electron/main.js#L1283) 返回值与面板文案一致（中文 + 真实原因 + 超时时长）。
3. （可选，增强诊断）在 `close` 回调记录退出码 `exitCode`，并纳入失败日志/文案，便于后续定位真正的启动失败原因（如 `MODULE_NOT_FOUND`、Node 版本、脚本入口等）。

效果：设置页 toast 和 AI 干活面板展示同一份**可操作的中文真实报错**（含自愈指引），不再是笼统英文。暴露后被隐藏的失败原因即浮出，可据此继续修复 DSH 本体问题。

---

## 假设与决策
- 统一采用 `ui-common.js` 的 `UI.toast` 作为全应用唯一通知实现；删除 `settings.js`/`vault.html`/`index.html`/`knowledge-detail.js`/`knowledge-editor.js` 的独立 `.toast` 兜底。
- Toast 锚点统一为顶部居中（沿用现 CSS `left:50%; top:16px; transform:translateX(-50%)`）。
- DSH 真实验证需在用户实际环境复现；本次先透传真实报错，拿到原因后再针对性修 DSH 本体。

---

## 验证步骤
1. 重新加载前端（dev 模式直接刷新；若为打包版需重启应用）：
   - 连续触发多次 `showToast`（如反复"保存配置""复制提示词"），确认单条 toast 始终固定在顶部居中 16px，位置不再漂移。
   - 同时触发多条 toast，确认自上而下整齐堆叠、收起后剩余自动上移。
   - 依次打开 index / vault / todo / settings / knowledge 页面重复上述操作，确认位置一致。
2. 重启 electron 应用后，到设置页启动 DSH，复现失败：确认 toast 显示**真实中文报错 + 自愈指引**（如 `Cannot find module ...`），而非"DSH process exited before ready"；查看主进程日志确认 `recentTail` 已落日志。
3. 依据暴露的真实错误修复 DSH 本体后，确认正常环境 DSH 能成功启动（端口就绪），回归通过。