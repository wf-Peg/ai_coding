# 快捷 OCR 一键安装：交互与兜底逻辑梳理 + 友好化

## Summary

用户反馈：工具模块进入「快捷 OCR」点「一键安装」，提示「模型缺失 …（模型目录 …\AppData\Local\CutShelter\ocr-models，可用一键安装），模型下载未完成：缺少 …」，下载详情全是 `[skip] … <- …`。

**根因（两处叠加）**：
1. **运行时选错模型目录**：`getModelsDir()` 直接命中空的 `userData/ocr-models`，而应用**源码里已随仓库携带全套 v5 模型**（`electron/screenshot/ocr-models/`，上次已拷贝），却从不启用 → 状态误报「缺失」。
2. **下载源在当前网络不可达**：一键安装只会联网下载（hf-mirror.com / huggingface.co），两个源都连不上 → 每个文件输出 `[skip]` 最终仍缺 → 报「下载未完成」。下载「detail」原始异常串被直接透出，难懂且无解决方案。

**目标**：把「一键安装」做成**优先复用本机已有模型（零网络）→ 缺失才联网下载 → 仍失败给可执行解决方案**的友好流程；并梳理其状态机与内部判断/兜底逻辑。

---

## 一、功能交互与产品使用逻辑梳理（状态机）

工具面板「OCR 组件」应按下述状态渲染，每个状态给出明确文案与主推动作：

| 状态 | 判定（内部） | 展示 | 主推动作 | 兜底 |
|---|---|---|---|---|
| 就绪 | `engineOk && 必需模型齐` | ✅ 离线 OCR 可用 | — | — |
| 仅引擎缺 | `!engineOk && 模型齐` | ⚠️ 推理引擎未装 | 「一键安装」复制安装命令 | 复制命令 / 打开目录 |
| 模型缺·本机有内置 | `!模型齐 && hasBuiltin` | ⚠️ 模型缺失，但本机已有内置可恢复 | 「🔄 从内置恢复（免网络）」 | 一键安装 / 打开目录 |
| 模型缺·需下载 | `!模型齐 && !hasBuiltin` | ⚠️ 需联网下载（约 16MB） | 「🌐 一键安装·下载」 | 复制命令 / 打开目录 |
| 下载失败 | 网络/源异常 | ⛔ 列出缺失文件 + 源错误摘要 | 重试 / 🔄 从内置恢复 / 打开目录 | 手动放置说明 |

**内部判断顺序（install-ocr）**：① onnxruntime 检测 → ② 目标目录缺哪几个必需文件 → ③ **先尝试从本机内置/源码/打包目录复制**（免网络）→ ④ 仍缺才联网下载 → ⑤ 复查仍缺则给出可执行方案。

**目录约定（关键兜底）**：
- `getModelsInstallDir()`：**可写**安装目录 = `userData/ocr-models`（下载/复制落点，打包 ASAR 内 `__dirname` 只读，不能当写入目标）。
- `findAllModelsDir()`：从索引 [打包 `resourcesPath/ocr-models` → 源码 `__dirname/ocr-models` → userData] 中返回**已含必需模型**的第一个目录（运行时读取优先）。
- `getModelsDir()`（状态/运行时，向后兼容）：`findAllModelsDir() || getModelsInstallDir()`。

---

## 二、Proposed Changes（变更方案）

### 后端：`electron/screenshot/screenshot-service.js`

1. **新增常量与目录解析**
   ```js
   const REQUIRED_MODELS = ['ch_PP-OCRv5_det_infer.onnx','ch_PP-OCRv5_rec_infer.onnx','ppocr_keys_v1.txt'];
   const CLS_MODEL = 'ch_ppocr_mobile_v2.0_cls_train.onnx';
   function modelCandidates() { /* resourcesPath → __dirname/ocr-models → userData, 保序去重 */ }
   function findAllModelsDir() { return modelCandidates().find(d => REQUIRED_MODELS.every(f => fs.existsSync(path.join(d,f)))); }
   function getModelsInstallDir() { return modelCandidates().slice(-1)[0]; }
   function getModelsDir() { return findAllModelsDir() || getModelsInstallDir(); }
   ```
   替换现有 `getModelsDir()`（L45-62）。注意读取候选时确保 userData 排在最后充当写入目标。

2. **新增 `copyBundledModels(target)` 助手**：遍历 `requireModels+cls+dict`，若 target 缺而某个候选目录有，则 `fs.copyFileSync` 复制；返回 `{ copied: string[], from: dir }`。用于「免网络恢复」。

3. **重写 `getOcrStatus()`（L792-798）**：复用 ocr-service.status() 结果，并**附加结构化字段**（非破坏）：
   ```js
   const st = ocrService.status(deps);
   return Object.assign(st, {
     engineOk: onnx 可 resolvable,
     modelsDir: getModelsDir(),
     installDir: getModelsInstallDir(),
     missing: REQUIRED_MODELS.filter(f => !fs.existsSync(path.join(getModelsDir(), f))),
     hasBuiltin: !!findAllModelsDir(),        // 本机已有一套完整模型可恢复
   });
   ```

4. **重写 `screenshot:install-ocr`（L1134-1169）**：
   ```
   ① engine 检测 → ② copyBundledModels(getModelsInstallDir())（免网络）
   ③ 剩余 missing 用 downloadModels(installDir) 补齐
   ④ 复查 missing：
       无 → status: engineOk?'done':'need-npm'
       有 → status:'error'，附 copied 数组 + 缺失文件 + 源错误（截断/合并）+ 解决方案列表
   ```
   返回含 `{ status, message, copied: string[], stillMissing: string[], engineOk, installDir }`，供前端友好渲染。

5. **下载详情友好化**：
   - `downloadModelsInline`（L841-867）：`Invoke-WebRequest` 失败行从 `  [skip] <file> <- <error>` 改为中文可读汇总（文件级只记最终成败，源错误按号缩进合并，避免一长串）。同样 `downloadModelsNode`（L923-938）。
   - `install-ocr` 组装错误文案：缺失文件、下载目录、网络提示（需访问 hf-mirror/huggingface，约 16MB）、以及「🔄 从内置恢复 / 打开模型目录 / 复制命令」等动作提示，避免笼统「建议检查网络后重试」。

6. **新增 IPC `screenshot:restore-ocr-models`**（纯复制、不联网）：返回 `{ status, copied, missing, installDir }`；供前端「🔄 从内置恢复」按钮使用。

### 预加载：`electron/preload.js`
- 新增暴露 `screenshotRestoreOcrModels: () => ipcRenderer.invoke('screenshot:restore-ocr-models')`（对齐既有 `screenshotInstallOcr` 命名风格）。其余保持不变。

### 前端：`frontend/js/tools-core.js`（OCR 配置面板）
1. `openSystemTool` 的 OCR 状态读取（L693-698）改为消费新增字段：`hasBuiltin` → 附带「本机已有内置模型」标识；状态行按第一节状态机展示。
2. 按钮区（L738-743）按状态动态主推：
   - `hasBuiltin && 缺失` → 显示并默认点亮「🔄 从内置恢复」
   - 否则 → 「⚡ 一键安装 OCR（下载）」
   - 保留「打开模型目录」「复制安装命令」。
3. 安装/恢复处理：`install` 与新增 `restore` 均有 busy 态；失败时在 `sysOcrMsg` 渲染 **解决方案列表**（缺失文件 / 目录 / 🔄从内置恢复 / 打开目录 / 网络提示），不再只回显原始 detail 串。

### 前端：`frontend/index.html`
- `showOcrSetupBar`（L2362-2373）：当带 `hasBuiltin=true` 时，引导文案改为「本机已有内置 OCR 模型，点击前往『从内置恢复』（免网络）」；否则保留「点击前往配置」。`checkOcrSetupNotice` 侧（screenshot-service L1206-1217）把 `hasBuiltin`/`installDir` 一并下发。

---

## 三、Assumptions & Decisions（假设与决策）

- **主内置源 = 源码 `electron/screenshot/ocr-models/`**（已随仓库携带完整 v5 模型）。打包场景优先 `resourcesPath/ocr-models`；两者皆无才落到联网下载。不引入任何远程 CDN。
- **写入目标恒为 `userData/ocr-models`**：避免向打包 ASAR 只读目录写入失败。运行时读取尽量用已含模型的目录（含源码），保证 dev 下开箱即用。
- **「从内置恢复」设计为独立动作 + 安装首步自动执行**：一键安装碰不到网络也能靠本机复制直接成功，符合「快、免网络」的核心诉求。
- 不改 ocr-service.js 的 `status()/MODELS_DIR` 语义（保持向后兼容），仅由上层 getModelsDir() 解析更聪明的默认值。
- 启动提示（checkOcrSetupNotice + setup bar）仅增强文案与下发字段，不改变触发时机。

---

## 四、Verification（验证）

1. **语法**：`node --check` 通过改动的 `screenshot-service.js`；`node --check` 通过 `preload.js`；抽取 `tools-core.js`/`index.html` 涉及片段做基本语法校验。
2. **本机已有模型 → 一键安装免网络成功**：在用户当前网络（hf 源不可达）下，工具面板点「一键安装 OCR」→ 应显示「本机已有内置模型」，经**无下载复制**后「✅ OCR 组件已就绪」；不再报「下载未完成 / [skip]」。
3. **状态正确**：面板「OCR 组件」行显示可用且目录为含模型目录；`打开模型目录` 打开的可写目标含全部模型。
4. **从内置恢复按钮**：点「🔄 从内置恢复」→ 提示已复制 N 个文件，状态转可用。
5. **下载仍失败时的友好提示**（模拟：临时把源码/打包资源模型改走，让 missing 有值且网络不通）→ 错误消息含缺失文件 + 目录 + 「重试 / 打开目录 / 复制命令」等方案，不含一长串原始 `[skip]`。
6. **启动引导**：清掉 `sessionStorage['ocr-setup-notified']` 后重启，未就绪时引导条按新文案显示。