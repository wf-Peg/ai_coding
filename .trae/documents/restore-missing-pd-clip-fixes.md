# 从历史提交恢复回退遗漏的产品概览与剪藏修复

## Summary

用户确认这 4 项均已在历史提交中修复成功，要求**从历史提交找回原实现恢复**，而非重新设计。已逐一在 git 历史中定位到原始修复提交并提取完整 diff：

| #    | 问题                                              | 历史修复提交                                | 恢复方式                             |
| ---- | ----------------------------------------------- | ------------------------------------- | -------------------------------- |
| 1    | 产品概览「待完成」假待办/无标题任务                              | 一次性数据脚本（无源码 commit）                   | 提供规范化脚本 + 保留前端兜底                 |
| 2    | 剪藏图片上传：上传按钮不生效 + 删除叉号无效                         | `28e68c2` (fix(clip) 剪藏上传图片按钮与删除图标修复) | 按 commit diff 恢复                 |
| 3    | 剪藏原文 markdown 超高折叠/点击展开                         | `d2dfbfe` (剪藏原文省略增强)                  | 按 commit diff 恢复                 |
| 4    | 产品概览「牛马记录」删除失效                                  | `1c6223f` (DSH统一管理/产品概览记录)            | 按 commit diff 恢复                 |
| 5(A) | 设置页「插件市场状态」留空（`dsh-agent:market-status` IPC 缺失） | `28b81a6` (feat)                      | 从 commit 恢复 main.js/preload.js 端 |
| 6(B) | 强刷后滚动位置丢失（scroll-restore/CutShelterScroll 缺失）   | `347ee9b` (feat)                      | 从 commit 恢复若干前端文件                |

前一轮已在前端 [workspace.js](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/frontend/js/workspace.js) 做了任务标题兜底（工作区未提交），保留并与第 1 项数据修复叠加。

***

## Current State Analysis（现状均处于"修复前"状态）

### 第 2 项 — 剪藏图片上传（当前 3 处均为修复前缺陷）

- [clip-shared.js](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/frontend/js/clip-shared.js#L454) `handleImageFiles` 用 `files.filter(...)` → FileList 无 `filter` 方法，**上传按钮（传入** **`input.files`）点击即报错不生效**，而 Ctrl+V 走 `extractImageFiles` 返回数组不受影响。

- [clip-shared.js](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/frontend/js/clip-shared.js#L416) `removeUploadedImage` 删除引用正则 `'!\\[^\\]]*\\]\('` 少了一对 `\[`，**点击删除叉号无法移除 content 里的 markdown 引用**。

- [clip.html](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/frontend/clip.html#L232) 上传按钮仍是 `<button on...`，靠 `input.click()`（Electron 内 `display:none` 的 file input 调用 `click()` 可能不弹窗）。

### 第 3 项 — 剪藏原文折叠（当前只有纯 CSS line-clamp，无点击展开交互）

- [clip-list.js](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/frontend/js/clip-list.js#L377/L401) 只加 `.truncated`，**缺少"点击展开全文"的委托**（`d2dfbfe` 新增的 document click handler 已丢失）。

- [clip.css](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/frontend/styles/clip.css#L1996-L2001) `.content-text.truncated` 仅 3 行 `line-clamp`，**缺少**：`position:relative; cursor:pointer`、`::after` 底部渐变遮罩、`.expanded` 展开态、子元素 `margin:0`、`pre/pre code` 换行回退（markdown 是块级子元素时 line-clamp 不显示省略号）。

### 第 4 项 — 牛马删除（删除按钮渲染但无处理）

- 渲染于 [workspace.js](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/frontend/js/workspace.js#L2505) `<button class="pd-ai-del" data-ai-del="{id}">`。

- 全局委托 [L2658-L2689](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/frontend/js/workspace.js#L2658-L2689) 只处理 `data-iter-delete`（且依赖 `currentPdReqId`），**`data-ai-del`** **分支丢失**。

- 后端删除接口存在：`DELETE /api/workspace/feature-points/iterations/{id}`（[WorkspaceController.java](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/backend/src/main/java/com/example/clip/controller/WorkspaceController.java#L1124-L1127)）。

***

## Proposed Changes（均从历史 commit 恢复原实现）

### 1) 任务数据规范化脚本（一次性，继承历史做法）

历史实现（用户口径）为"一次性脚本把 4 个文件的 tasks 统一为规范 `{title,status}`"；该模式未作为源码 commit 入库。据此新建一次性 Node 脚本，遍历 `TODO/*/feature-points.json`：

- 元素为**字符串** → `{ "title": 原字符串, "status": "done" }`

- 对象且 `status === "completed"` → `"done"`；`status === "pending"` → `"todo"`

- 其余不动；探测原换行（CRLF/LF）保持，保留缩进，仅改 `tasks`。

运行后重跑"空标题任务"扫描 = 0。**保留**上轮前端兜底（[workspace.js](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/frontend/js/workspace.js#L2179-L2187) + 渲染兜底），实现双保险。

### 2) 剪藏图片上传 — 恢复 commit `28e68c2` 的 diff

- [frontend/clip.html](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/frontend/clip.html#L232)：`<button type="button" class="image-upload-btn" id="image-upload-btn" ...>` → `<label class="image-upload-btn" id="image-upload-btn" for="image-input" ...>`（原生弹出文件选择）。

- [frontend/js/clip-shared.js](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/frontend/js/clip-shared.js)：

  - `handleImageFiles`：`files.filter(...)` → `Array.from(files).filter(...)`（FileList 兼容，修上传按钮不生效）。

  - `removeUploadedImage`：删除正则 `'!\\[^\\]]*\\]\('` → `'!\\[[^\\]]*\\]\\('`（修删除叉号无效）。

  - `bindImageEvents`：移除 `btn.addEventListener('click', () => input.click())`（改 label 后靠 `for` 原生触发）。

- [frontend/styles/clip.css](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/frontend/styles/clip.css#L2216) `.image-upload-btn`：加 `display:inline-block; font-family:inherit; user-select:none`。

- **浏览器扩展同步**：[browser-extension/clip-main.js](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/browser-extension/clip-main.js)、[browser-extension/clip.html](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/browser-extension/clip.html) 应用同 3 处改动（保持双端一致）。

### 3) 剪藏原文折叠 — 恢复 commit `d2dfbfe` 的 diff

- [frontend/js/clip-list.js](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/frontend/js/clip-list.js)（在 `document.getElementById('search-form')...` 前）新增全局委托：

  ```js
  // 原文多行省略：点击展开/收起全文
  document.addEventListener('click', (e) => {
      const el = e.target.closest('.content-text.truncated');
      if (!el) return;
      if (window.getSelection && window.getSelection().toString()) return; // 拖选文本忽略
      el.classList.toggle('expanded');
  });
  ```

- [frontend/styles/clip.css](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/frontend/styles/clip.css#L1996) `.content-text.truncated` 块：按 `d2dfbfe` 追加 —— 加 `position:relative; cursor:pointer`；新增 `::after` 底部渐变遮罩、`.expanded` 展开态、`.truncated > * { margin:0 }`、`.truncated pre, .truncated pre code { white-space:pre-wrap; word-break:break-word }`。

### 4) 牛马记录删除 — 恢复 commit `1c6223f` 的 data-ai-del 分支

在 [workspace.js](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/frontend/js/workspace.js#L2658-L2689) 全局点击委托中，`data-iter-delete` 分支之后、`compareBtn` 之前插入：

```js
var aiDel = e.target.closest && e.target.closest('[data-ai-del]');
if (aiDel) {
  var aiDelId = aiDel.getAttribute('data-ai-del');
  if (!aiDelId) return;
  $('confirmTitle').textContent = '删除牛马记录';
  $('confirmMessage').textContent = '确定删除这条牛马记录吗？删除后不可恢复。';
  var confirmActionBtn = $('confirmAction');
  confirmActionBtn.onclick = async function() {
    hideModal(confirmModal);
    try {
      var r = await fetch('/api/workspace/feature-points/iterations/' + encodeURIComponent(aiDelId), { method: 'DELETE' });
      if (!r.ok) { alert('删除失败，请重试'); return; }
      var iterRes = await fetch('/api/workspace/feature-points/iterations').catch(function() { return { ok: false }; });
      pdIterations = iterRes && iterRes.ok ? (await iterRes.json().catch(function() { return []; })) : [];
      renderPdAiArchive();
    } catch (err) { alert('删除失败，请重试'); }
  };
  showModal(confirmModal);
  return;
}
```

（复用现有 `confirmModal`/`showModal`/`hideModal`/`confirmTitle`/`confirmMessage`/`confirmAction`，已确认存在。）

***

## 遗漏根因与系统性审计结论

**根因**：`ed81494`（editor/settings/页面重构）与 `c05301b` Merge 用**远端版本整体覆盖**了本地一批前端文件里的历史修复；此前恢复流程只针对"已识别"的契约断层/覆盖项逐块回填（`362e3dd`/`994cdca`），未做全量 diff 核对，导致局部小修复散落在已被重写的大文件中成为漏网之鱼（共同特征：改动小、无强契约、散落在大文件）。

**系统性审计结论**（遍历 `ed81494` 覆盖的全部前端文件 + 对每个候选 fix 提交核对"修复后"形态）：

- 修复(fix)性质：除本次 本计划 第 2/3/4 项外，**无其它明确缺失**（settings/editor/knowledge-detail/main.js/preload.js 等均已恢复）。

- 另有 2 处 **非 fix 但同因被覆盖而缺失** 的功能（可选补充项，来源为 feat 提交）：

| 项 | 缺失内容                                                                                                                                | 后果                                                            | 来源              |
| - | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------- |
| A | `dsh-agent:market-status` IPC 及 preload 暴露（main.js/preload.js）                                                                      | 设置页「插件市场状态」永久留空（settings.js 的 refreshMarketStatus 有守卫，不报错但空白） | `28b81a6`（feat） |
| B | `CutShelterScroll`/`hardRefresh`/scroll-restore 强刷保留滚动（涉及 workspace/settings/tools-core/clip-list/clip.css/index.html/knowledge.js） | 强刷后滚动位置丢失                                                     | `347ee9b`（feat） |

> 补充项 A/B 是否纳入由用户决定；本计划正文侧重已确认的 4 项修复性遗漏。

### 5) 设置页「插件市场状态」IPC — 恢复 `28b81a6`

`settings.js` 的 `refreshMarketStatus()` 调用 `api.dshAgentMarketStatus`，但 `main.js`/`preload.js` 未暴露（仅存空守卫）。从 commit `28b81a6` 恢复对应实现：

- [electron/main.js](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/electron/main.js)：`ipcMain.handle('dsh-agent:market-status', ...)`（查询 DSH 插件市场状态）及必要依赖。

- [electron/preload.js](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/electron/preload.js)：暴露 `dshAgentMarketStatus`。

- 以 `git show 28b81a6` 为准；若与现网 DSH 契约已变，仅恢复暴露通道、保留 `settings.js` 现有守卫与 UI。

### 6) 强刷保留滚动 — 恢复 `347ee9b`

- 恢复 `scroll-restore`（`CutShelterScroll`/`hardRefresh` 相关）实现，涉及 [workspace.js](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/frontend/js/workspace.js)、[settings.js](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/frontend/js/settings.js)、[tools-core.js](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/frontend/js/tools-core.js)、[clip-list.js](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/frontend/js/clip-list.js)、[knowledge.js](file:///l:/归档/30_Projects%20\(行动项目\)/31_Work%20\(主要工作\)/code/ai_coding/frontend/js/knowledge.js) 及其 CSS/引用（index.html/clip.css）。

- 具体以 `git show 347ee9b --stat` 界定文件范围，并按该提交 diff 恢复"强刷前保存滚动 + 重建后还原"逻辑。

***

## Assumptions & Decisions

- 第 2、3、4 项严格按历史 commit 的 diff 恢复，不新增/不改变语义。

- 第 1 项历史为一次性数据脚本（无源码 commit），恢复方案为同一思想的规范化脚本；前端兜底（上轮+本轮验证）作展示层保险，二者皆留。

- 第 2 项浏览器扩展端同步应用，与主应用保持一致（历史 commit 也同步了扩展）。

- `d2dfbfe` 同名提交里另含 DSH 版本对齐/缺 UI 提示等改动（main.js、index.html），非本次范围，**不**纳入。

## Verification

1. `node --check` 校验改动 JS：`frontend/js/workspace.js`、`frontend/js/clip-shared.js`、`frontend/js/clip-list.js`、`browser-extension/clip-main.js`。
2. 运行数据规范化脚本 → 重扫"空标题任务" = 0，`done`/`todo` 计数符合预期。
3. 剪藏页：点「上传图片」能弹出文件选择并上传回填；点击删除叉号能同时移除预览与 content 内 markdown 引用；Ctrl+V 拖拽均正常。
4. 剪藏列表：原文超 3 行折叠并显示渐变遮罩，点击展开全文、再点收起；短内容不截断；代码块正常换行。
5. 产品概览牛马列表：点删除 → 二次确认 → 记录消失且列表刷新；既不依赖需求详情打开态。
6. 回归：`npm start` 本地启动，后端(8081)+前端(3001)+DSH(3081) 正常，产品概览/剪藏页面无报错。

