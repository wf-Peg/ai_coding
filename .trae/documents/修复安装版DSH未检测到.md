# 修复：安装版应用"未检测到 DSH"，牛马模块无法打开

## 一、问题现象

- `npm start`（开发模式）打开应用 → 牛马模块（DSH Agent 面板）正常。
- 安装版（electron-builder 打包产物）打开应用 → 牛马模块提示 **"未检测到 DeepSeek Harness（DSH）。请按说明自助安装后重试。"**，无法使用。

## 二、根因分析（已通过代码与 git 历史确认）

牛马模块 = DSH Web sidecar（`electron/main.js` 的 `startDshAgent` + 前端 Agent 视图）。启动前先调 `resolveDshBin(config)` 解析 dsh CLI 入口，找不到就广播 `need-install` 并返回上述报错文案（[main.js L1420-1431](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/electron/main.js#L1420-L1431)）。

`resolveDshBin` 候选路径（[main.js L1188-1219](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/electron/main.js#L1188-L1219)）：
1. 配置 `dshBinPath`
2. 环境变量 `DSH_BIN`
3. `APP_DIR/node_modules/@deepseek-ai/dsh/lib/bin.js`（开发模式命中，devDependencies）
4. `process.resourcesPath/node_modules/@deepseek-ai/dsh/lib/bin.js`
5. `process.resourcesPath/dsh-offline/node_modules/@deepseek-ai/dsh/lib/bin.js`（**打包模式的离线兜底，目标路径**）
6. npx 缓存扫描（硬编码路径）

### 主因：打包配置丢失离线 DSH 闭包（合并被覆盖）

历史提交 `039b74d`（"AI 干活内嵌 DSH 面板（sidecar 启动/进度/离线闭包）"）时 [package.json](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/package.json) 的配置：
- `prebuild` 包含 `node scripts/build-dsh-offline.mjs`（把 `@deepseek-ai/dsh` 依赖闭包复制到 `dist-dsh-offline/node_modules`）
- `extraResources` 有 `{"from": "dist-dsh-offline", "to": "dsh-offline", "filter": ["node_modules/**/*"]}` → 安装后落在 `resources/dsh-offline/node_modules/...`，正好命中候选路径 5

当前 [package.json](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/package.json#L26-L110)：
- `prebuild` 被替换为 `prebuild-integrations.mjs`（`520fc22` 引入），**`build-dsh-offline` 丢失**
- `extraResources` **丢失 `dist-dsh-offline → dsh-offline` 映射**

结果：安装版 `resources` 下根本没有 `dsh-offline` 目录 → 候选路径 5 永远落空 → `mode: 'missing'` → 报错。`npm start` 因候选路径 3（仓库 `node_modules`）命中而正常，与用户现象完全吻合。

### 次因：npx 缓存动态解析被覆盖

历史提交 `c9f4d3e`（8/27，"修复DSH检测自定义npx缓存"）曾把 `resolveDshBin`/`persistDshBinIfNpx` 改为 async，通过 `resolveNpmCacheDir()`（`npm config get cache`，含 `npm_config_cache` 环境变量优先）动态解析 npx 缓存目录 `_npx`。合并后回归为同步 + 硬编码路径（当前 [main.js L1202-1207](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/electron/main.js#L1202-L1207)、[L1342-1347](file:///f:/30_Projects%20(行动项目)/31_Work%20(主要工作)/ai_coding/electron/main.js#L1342-L1347)）。

当前用户 npm cache 为自定义路径 `D:\develop\node\node-v20.11.0-win-x64\node_cache`（`npm config get cache` 实测），硬编码的 `%LOCALAPPDATA%\npm-cache\_npx` 扫不到 → 即使 npx 缓存里有 dsh 也误报未安装。

### 附带：现有离线包产物残缺

`dist-dsh-offline/.progress.log` 显示上次构建时 `@deepseek-ai/*` 包全部 MISS（构建失败），`dist-dsh-offline/node_modules` 下无 `@deepseek-ai` 目录。根 `node_modules/@deepseek-ai/dsh` 当前完整（package.json 存在），重建可成功。

## 三、修复方案

### 改动 1：`package.json` — 恢复离线闭包构建与打包（主修复）

1. `prebuild` 脚本（L26）在 `prebuild-integrations.mjs` 前加回 `node scripts/build-dsh-offline.mjs`：
   ```
   "prebuild": "node scripts/generate-icons.js && node scripts/prebuild-clean.js && node scripts/build-dsh-offline.mjs && node scripts/prebuild-integrations.mjs"
   ```
2. `extraResources`（L68-110）在 `integrations/dsh` 条目后加回：
   ```json
   {
     "from": "dist-dsh-offline",
     "to": "dsh-offline",
     "filter": ["node_modules/**/*"]
   }
   ```

### 改动 2：`electron/main.js` — 恢复动态 npx 缓存解析（次修复）

参考 `git show c9f4d3e:electron/main.js` 恢复（`execAsync` 已在 L742 存在）：

1. 在 `resolveDshBin` 前新增：
   - `resolveNpmCacheDir()`：Promise 缓存；优先 `process.env.npm_config_cache`，否则 `execAsync("\"<npmBin>\" config get cache", { timeout: 5000 })`（npmBin 经 `findNodeDir()` 解析，win 为 `npm.cmd`）。
   - `resolveNpxRoots()`：Set 合并 4 个硬编码兜底路径 + `path.join(cache, '_npx')`。
2. `resolveDshBin(config)` 改为 `async`（L1189）：
   - npx 扫描段（L1201-1217）改用 `const npxRoots = await resolveNpxRoots();`
   - npx 缓存命中时返回 `{ mode: 'npx', node: findNodeExe(), script: p }`（历史契约，供 `persistDshBinIfNpx` 固化）
3. `persistDshBinIfNpx`（L1338）改为 `async`，内部硬编码 `npxRoots` 改用 `await resolveNpxRoots()`。
4. 更新调用点加 `await`：
   - L1388：`detectDshVersion(await resolveDshBin(config), config)`（已在 async `startDshAgent`）
   - L1420：`const bin = await resolveDshBin(config);`
   - L2702 / L2706：`detectDshVersion(await resolveDshBin(config), config)`（均在 async ipc handler）
   - L2890：`const bin = await resolveDshBin(config);`（在 async `dsh-agent:skin-install`）
   - L1542：`await persistDshBinIfNpx(bin, config);`

### 改动 3：日志与注释

- 上述函数沿用现有中文注释风格，补充"恢复历史优化（合并被覆盖）"说明，便于后续排查。

## 四、验证步骤

1. **离线闭包构建**：`npm run build-dsh-offline` → 确认 `dist-dsh-offline/node_modules/@deepseek-ai/dsh/lib/bin.js` 存在、`dist-dsh-offline/node_modules/@deepseek-ai` 目录完整。
2. **打包验证**：`npx electron-builder --win --dir --x64`（复用现有 jar/jre，仅验证目录结构）→ 确认 `dist-electron/win-unpacked/resources/dsh-offline/node_modules/@deepseek-ai/dsh/lib/bin.js` 存在。
3. **运行验证**：启动 `dist-electron/win-unpacked/CutShelter.exe` → 进入牛马模块 → 应能正常装载 DSH 面板（不再提示"未检测到 DSH"），日志出现 `resolved dsh bin: mode=node script=...dsh-offline...`。
4. **npm start 回归**：`npm start` → 牛马模块仍正常。

## 五、假设与注意事项

- 现有 `dist-electron` 已有构建产物，验证步骤 2 用 `--dir` 增量打包，不重跑 maven/jlink，加快验证。
- 若步骤 2 因 electron-builder 要求重跑 prebuild 而自动重建离线闭包（会因闭包较大耗时数分钟），属预期。
- 修复后安装版优先命中 `resources/dsh-offline/...` 离线闭包；npx 缓存动态解析作为第二保险，覆盖"用户本地 npx 已装过 dsh"的场景。
- 涉及 `git commit` 时，按项目规则同步追加 `commit_history.log` 记录。
