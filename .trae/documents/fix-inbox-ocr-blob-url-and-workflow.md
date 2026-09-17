# 修复收件箱插图/添加剪藏 OCR "无图片数据" 与工作流完善

## Summary（结论先行）

收件箱（`clip.html`）图片 OCR 报「OCR 识别中…」后立刻「OCR 失败：无图片数据」的**根因已定位**：
- 当前会话上传图片时，`uploadedImages` 记录里的 `dataUrl` 字段存的是 `URL.createObjectURL(file)` 生成的 **`blob:` URL**，而非 `data:image/...` 的真 data URL（[clip-shared.js L494](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/frontend/js/clip-shared.js#L494)）。
- `runImageOcr()` 取 `img.dataUrl || loadImageDataUrl(img.path)`，因 blob 字符串为真值，**永远命中 `blob:` 分支**（[clip-form.js L162-165](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/frontend/js/clip-form.js#L162)）。
- `blob:` URL 只在**渲染进程**内可读，主进程 `nativeImage.createFromDataURL(blobUrl)` 解析不到任何像素 → `img.isEmpty()` → 返回「无图片数据」（[main.js L4734-4736](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/electron/main.js#L4734)）。

这部分功能**并非整块没做**——已保存剪藏的 OCR（`ocrClipImage`，走 `loadImageDataUrl(rel)` 生成真 data URL）是能工作的。真正断点仅在「当前会话刚上传、还没保存」的图片 OCR 入口，以及若干体验缺陷。

本方案修复核心 bug，并完善工作流（进度态、禁用态、更友好的状态提示、日志与注释），补齐工程规范性。

---

## Current State Analysis（现状 / 工作流梳理）

### 收件箱 OCR 完整工作流（两条入口）
```
入口A 折叠页「OCR」快速记录 → quickRecord('ocr') → 归一为 image → 自动打开选择器
入口B 「📷 上传图片」→ handleImageFiles → MediaKit.uploader.uploadFiles
        │   onStart → entry.dataUrl = URL.createObjectURL(file)  ← ❸ blob URL（根因）
        │   onSuccess → entry.status='done'; entry.path=resp.path  ← 此时有可靠相对路径
        ▼
「✨ OCR 提取文字」→ runImageOcr()
        img = uploadedImages.find(i => i.path || i.dataUrl)   ← 取到第一张
        dataUrl = img.dataUrl || loadImageDataUrl(img.path)   ← ❹ 命中 blob 分支
        ▼
recognizeImage(dataUrl)
        → api.ocrRecognize(dataUrl)  → ❺ 换到主进程
        ▼
main.js ocr:recognize → nativeImage.createFromDataURL(blob:) → isEmpty() → "无图片数据"  ← ❻ 报错
```

另一条**能工作**的入口：
```
选中已保存图片剪藏 → ocrClipImage()
        rel = imagePaths[0]（或 content 兜底）
        dataUrl = loadImageDataUrl(rel)     ← 走 fetch(mediaUrl) → blob → FileReader 真 dataURL ✓
        recognizeImage(dataUrl) → 识别后追加 content 并 POST /organize/{id} 落库
```

### 断点 / 缺陷明细
1. **（核心 bug）`runImageOcr` 用 `img.dataUrl`（blob:*）传给主进程** → 必现「无图片数据」。应优先用 `img.path`（上传完成后可靠）经 `loadImageDataUrl` 生成真 dataURL；无法生成时再用 blob 转换。
2. **`loadImageDataUrl` 不处理 `blob:` 前缀** → 即便想用 blob，也无法转回 dataURL（[clip-form.js L114-127](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/frontend/js/clip-form.js#L114)）。需补 `fetch(blob:) → blob → FileReader` 转换，形成兜底。
3. **`runImageOcr` 不检查上传状态**：上传中（compressing/uploading）也允许 OCR，此时 path 未生成 → OCR 必然失败；应禁用或提示「请等待上传完成」。
4. **OCR 成功/失败无明细日志**：不符合项目「增加日志与注释」约定；主进程 `ocr:recognize` 缺少失败原因落盘。
5. **提示文案不友好**：统一在 `recognizeImage` 内做 `ocrStatus` 预检 + 明确「未识别到文字」「网络端受控」等场景。

### 已知正常的环节（无需重构）
- 主进程 `ocr/ocr-status/ocr:recognize` IPC、preload 桥、（必需的 det/rec/字典）模型、`ocr-service.recognize()` 均正常（本会话已实测能跑通）。
- 已保存剪藏 OCR + AI 总结 + `POST /organize/{id}` 落库链路可复用。
- `quickRecord('ocr')` 归一为 `image` 类型的历史 bug 已修复，无需再动。

---

## Proposed Changes（改动方案）

### 1) 修复 `loadImageDataUrl` 支持 `blob:` → dataURL —— `frontend/js/clip-form.js`
- **做什么**：给 `loadImageDataUrl` 增加对 `blob:` 前缀的转换，作为兜底。
- **怎么改**：函数开头在既有 `relPath.indexOf('data:') === 0` 判断后，新增 `if (relPath.indexOf('blob:') === 0)` 分支：`await fetch(relPath)` → `resp.blob()` → `FileReader.readAsDataURL` 返回 dataURL；失败抛「图片读取失败」。保留原有 `data:` 直通与相对路径 fetch 逻辑。
- **为什么**：让 `runImageOcr` 无论拿到 `data:`/`blob:`/相对路径都能得到主进程可解析的 dataURL，消除「无图片数据」。
- **涉及**：`frontend/js/clip-form.js` `loadImageDataUrl()`。

### 2) 修复 `runImageOcr` 取图来源 + 上传状态守卫 —— `frontend/js/clip-form.js`
- **做什么**：优先使用上传完成（`status==='done'` 且有 `path`）的图片，经 `loadImageDataUrl(path)` 生成主进程可解析的 dataURL；仅当无 `path` 时才回退 blob 转换；并加「等待上传完成」守卫与日志。
- **怎么改**：
  - 取图改为 `uploadedImages` 中首个 `status==='done' && path` 的记录；若不存在但有 `dataUrl`（如刚选中还在压缩），提示「请等待图片上传完成后重试」并 `return`。
  - `const dataUrl = img.path ? await loadImageDataUrl(img.path) : (img.dataUrl ? await loadImageDataUrl(img.dataUrl) : null);`
  - `console.log('[OCR] 源类型=' + (img.path?'path':'blob') + ' 长度=' + (dataUrl?dataUrl.length:0));`
- **为什么**：`path` 存在即上传已落库，`loadImageDataUrl(path)` 走后端媒体接口，稳定生成 dataURL；同时拦截「上传中误点」。
- **涉及**：`frontend/js/clip-form.js` `runImageOcr()`。

### 3) 增强 `recognizeImage` 状态预检与提示 —— `frontend/js/clip-form.js`
- **做什么**：OCR 前预检改得更细、失败提示更明确；成功时记录字数日志。
- **怎么改**：
  - `ocrStatus` 预检：`available===false` 时按 `reason` 提示（现已是「OCR 不可用：{reason}」），并可增加对「模型缺失」给出「工具→截图工具→一键安装」引导。
  - 保留 `showToast('OCR 识别中…')`；成功后 `console.log('[OCR] 本次识别 '+text.length+' 字')`。
  - `res.status==='success'` 但 `text` 为空 → 提示「未识别到文字（可能图片无文本或过模糊）」。
- **为什么**：让用户能区分「引擎不可用 / 没识别到 / 数据为空」三种情况，避免一头雾水。
- **涉及**：`frontend/js/clip-form.js` `recognizeImage()`。

### 4) 主进程 `ocr:recognize` 失败日志落盘 —— `electron/main.js`
- **做什么**：在「无图片数据」分支和其它失败分支补日志（含 dataUrl 前缀/长度脱敏），符合项目日志规范。
- **怎么改**：在 `if (!img || img.isEmpty())` 分支前记录：
  ```
  console.log('[OCR] 输入 dataUrl 前缀=' + (payload && payload.dataUrl ? String(payload.dataUrl).slice(0,12) : 'none')
    + ' 长度=' + (payload && payload.dataUrl ? payload.dataUrl.length : 0));
  ```
  catch 分支已有 `err.message`；此处补成功分支日志 `console.log('[OCR] 识别成功 字数=' + (result&&result.text ? result.text.length : 0))`。
- **为什么**：下次遇到 OCR 问题只需看日志即可定位「数据为空/模型/引擎」。
- **涉及**：`electron/main.js` `ipcMain.handle('ocr:recognize', ...)`。

### 5) （可选，若按钮存在）OCR 按钮在无图时禁用态是已有逻辑，无需额外改 —— 跳过
- 确认 `runImageOcr` 已在 `img` 为空时提示「请先上传图片再执行 OCR」，维持现状，不做重复变更。

---

## Assumptions & Decisions（假设与决策）
- **假设**：用户触发的是「折叠页/普通表单上传图片 → ✨ OCR 提取文字」的当前会话链路（复现于 `blob:` 根因）；已保存剪藏 OCR 不在此 bug 范围。
- **决策**：不动主进程原生解析逻辑（`nativeImage.createFromDataURL` 无法支持 `blob:` 是 Electron 边界），改在前端把 blob 转成 dataURL，符合最小改动。
- **决策**：复用既有 `loadImageDataUrl` + `recognizeImage` + IPC，不新增接口/不新增后端字段，OCR 结果继续以「追加进 content + AI 总结可选」持久化（沿用现有逻辑）。
- **决策**：改动仅涉及前端 `clip-form.js` 与主进程 `main.js` 日志，改后刷新 `clip.html` 生效；`main.js` 改动需重启应用，属低风险日志补充。

---

## Verification（验证步骤）
1. **语法检查**：`node --check frontend/js/clip-form.js`；`node --check electron/main.js`。
2. **当前会话 OCR 回归**：桌面客户端 → 收件箱 → 折叠页「OCR」快速记录（或「📷 上传图片」）→ 选图 → 上传完成出现缩略图 → 点「✨ OCR 提取文字」→ 应得到识别文本填入内容（不再报「无图片数据」）。
3. **上传中守卫回归**：选图后立刻点 OCR → 提示「请等待图片上传完成后重试」，不崩溃。
4. **已保存剪藏 OCR 回归**：选中一条已保存图片剪藏 → OCR 正常识别并追加 content、可保存（确认未回归）。
5. **主进程日志**：OCR 成功/失败时 `app.log`/控制台出现 `[OCR] ...` 前缀日志（含输入长度）。
6. **无文本图兜底**：对纯色/空白图执行 OCR → 提示「未识别到文字…」，而非「无图片数据」。