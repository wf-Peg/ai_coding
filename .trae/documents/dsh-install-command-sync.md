# dsh 安装命令在线同步（npm 优先 + GitHub README 兜底）

## 一、需求与背景（你问的两个问题）

**Q1：为什么工具里的命令是 `npx @deepseek-ai/dsh@0.1.0-rc.7 web`，而 GitHub README 是 `npx @deepseek-ai/dsh web`？是否影响？**

- 原因：`@0.1.0-rc.7` 是当初集成（patch、mcp-client 桥、clip-capture 插件）做 E2E 验证时固定死的**测试版本**，用于保证确定性、可复现。`DSH_NPX_SPEC` 环境变量可覆盖它。
- 影响：**不破坏启动**。自 v1.0.9 改「用户自助安装」后，固定版本只用于**展示给用户的引导文字**；真正启动是按端口 3081 + `resolveDshBin` 扫 npx 缓存里**任意已装的 dsh**（版本无关）。所以打头命令不会导致启动失败。
- 隐患（本次要修的）：引导命令钉死旧 RC，与官方 README / `npx @deepseek-ai/dsh web`（实际拉最新）不一致——会误导用户装旧版，错过新特性/修复；且若官方启动命令形态未来变化，这条硬编码会永久失效。

**Q2：检测/重试可否探测 GitHub 说明做实时同步？**

- 可以，但要选可靠来源。你已确认：**npm registry 拿最新版号优先，GitHub README 解析兜底**；推荐命令**固定到最新版号 `@x.y.z`**。

## 二、现状分析（勘察结论）

硬编码 `0.1.0-rc.7` 出现的位置（改动都汇集到一个 helper 由各点调用）：

| 文件 | 位置 | 作用 |
|---|---|---|
| `electron/main.js` | `startDshAgent` L1037-1039 | need-install 广播的安装命令 |
| `electron/main.js` | `dsh-agent:check-install` IPC L2111-2113 | 返回给前端「检测」的命令 |
| `electron/main.js` | `buildDshFailMessage` L966 | 失败提示里的 `npm i --save-dev @deepseek-ai/dsh@0.1.0-rc.7` |
| `frontend/tools.html` | L34 输入框静态 `value` | 浮层里的初始占位值 |
| `frontend/js/tools-core.js` | L444、L462 | 无 IPC/兜底时用的命令 |
| `frontend/index.html` | L1133 | 纯浏览器兜底（已是 `npx @deepseek-ai/dsh web`，无需改） |

网络先例：`electron/main.js` 已有全局 `fetch`（L3327 用于 `http://127.0.0.1`，可处理 https）与 GitHub 请求兜底模式（L3571-3604）。注意 `httpGet` 用 `http.request`，**不能走 https**，必须用全局 `fetch`。

## 三、方案设计

新增**单一命令解析器**（主进程），统一 питание所有展示点；npm registry 优先、README 兜底、环境变量/配置覆盖、6h 缓存 + 「检测/重试」force 刷新、全程失败非致命降级。

### 3.1 命令解析优先级
```
1. 环境变量 DSH_NPX_SPEC           →  verbatim，`npx -y <spec> web`（最高优先，研发用）
2. 配置缓存 dshSync（TTL 内，非 force）→  `npx @deepseek-ai/dsh@<ver> web`
3. npm registry latest（TTL 过期或 force）→  `npx @deepseek-ai/dsh@<ver> web`
4. GitHub README raw 解析（npm 失败时）→  用解析出的 version/command
5. 全部失败               →  配置 dshAgentNpxSpec 默认值（兜底）
TTL = 6h
```

### 3.2 缓存模型
写入 config.json：`dshSync: { version, command?, ts }`。读取时 `Date.now() - ts < 6h` 视为有效；「检测/重试」按钮以 `force:true` 绕过 TTL 强制刷新。

## 四、改动清单（按文件）

### 1. `electron/main.js`
- 在 dsh 配置区（默认配置附近）新增：
  ```js
  const DEFAULT_DSH_SPEC = '@deepseek-ai/dsh@0.1.0-rc.7';   // 最后的兜底固定版本
  const DSH_SYNC_TTL = 6 * 3600 * 1000;                    // 6h 在线同步缓存
  let dshCmdPromise = null;                                // 并发去重
  ```
- 新增三个纯函数（全部 try/catch、失败返回 null，不抛出）：
  - `async function fetchLatestDshVersionFromNpm()`：`fetch('https://registry.npmjs.org/@deepseek-ai/dsh/latest', { signal })`（`AbortController` 8s 超时）→ `JSON.parse` → 返回 `data.version`。
  - `async function fetchDshHintFromReadme()`：`fetch('https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/main/README.md')` → 正则提取 `dsh(?:@([\w.\-]+))?\s+web` 的第一个命中的 version（无则 command `npx @deepseek-ai/dsh web`）→ 返回 `{version?, command?}`。
  - `async function getDshInstallCommand(force = false)`：按 3.1 优先级组装，产出去重 + 缓存读写，返回 `{ command, source, version }`。
  - `getCachedDshSync(config)` / `cacheDshSync(config, {version, command})`（用现有 `saveConfig`）。
- `dsh-agent:check-install` IPC（L2107-2122）：接收 `args`，改为
  ```js
  ipcMain.handle('dsh-agent:check-install', async (ev, args) => {
    const config = loadConfig();
    const port = config.dshPort || 3081;
    const installed = await checkHttpPort(port);
    const { command, source, version } = await getDshInstallCommand(!!(args && args.force));
    return { installed, port, command, source, version,
      hint: installed ? `DeepSeek Harness 已就绪（端口 ${port}），可直接使用`
                      : `未检测到 DeepSeek Harness，请自行安装后再激活。命令：${command}` };
  });
  ```
- `startDshAgent` 的 need-install 分支（L1037-1047）：把命令计算移进该分支，改
  ```js
  const { command: DSH_INSTALL_CMD } = await getDshInstallCommand();
  // 删除原来的两行 DSH_INSTALL_CMD 硬编码（L1037-1039）
  broadcastDshProgress('need-install', '未检测到…安装命令：' + DSH_INSTALL_CMD);
  return { success:false, needInstall:true, installed:false, port, command:DSH_INSTALL_CMD, message:'…' };
  ```
- `buildDshFailMessage`（L966）：把提示里的 `@deepseek-ai/dsh@0.1.0-rc.7` 改为不固定版本写法 `@deepseek-ai/dsh`（引导拉最新）。

### 2. `electron/preload.js`
- L500 `checkDshInstall: (force) => ipcRenderer.invoke('dsh-agent:check-install', { force })`（透传 force）。

### 3. `frontend/js/tools-core.js`
- L444：兜底命令 `'npx @deepseek-ai/dsh@0.1.0-rc.7 web'` → `'npx @deepseek-ai/dsh web'`。
- L462（复制按钮兜底）：同样改为 `'npx @deepseek-ai/dsh web'`。
- L475「检测/重试」：`api.checkDshInstall()` → `api.checkDshInstall(true)`（force 刷新版本，保证实时）。
- 初始打开 `openModuleAgent` 的 L436 保持非 force（用缓存，秒开）。

### 4. `frontend/tools.html`
- L34 输入框静态 `value` 占位 `npx @deepseek-ai/dsh@0.1.0-rc.7 web` → `npx @deepseek-ai/dsh web`（打开后会被主进程返回的真实命令覆盖）。

### 5. `electron/main.js` 默认配置
- 新增持久化键 `dshAgentNpxSpec`（默认 `DEFAULT_DSH_SPEC`）作为最后的固定兜底，便于用户/设置页覆盖。

### 6. 文档同步（轻量）
- `TODO/DSH（DeepSeek Harness）集成/02-设计文档.md`：CLI 解析优先级增加「npm registry latest 在线同步 + 6h 缓存 + README 兜底」。
- `TODO/DSH（DeepSeek Harness）集成/04-验收清单.md`：新增 fp：命令在线同步（npm 优先/README 兜底/6h 缓存/force 刷新/失败降级）。
- `docs/DSH体验测试指南.md` 步骤 5 / 故障排查：把固定版本描述改为「启动命令由应用按 npm 最新版在线解析，检测/重试会刷新」。

## 五、假设与决策
- 在线同步失败（断网/被墙/GitHub 不可达）时**绝不阻断**，自动降级 缓存→默认，且不报错、不弹网络错误。
- 仅改变「展示给用户的命令」，不改动真正的启动逻辑（resolveDshBin / 端口扫描）。
- 「检测/重试」= force 刷新；自动 need-install 广播与初始打开 = 走缓存（避免每次联网）。
- 固定版本兜底保留为 `0.1.0-rc.7`，除非用户或设置页显式配置 `dshAgentNpxSpec`/`DSH_NPX_SPEC` 覆盖。

## 六、验证步骤
1. `node --check electron/main.js`、`node --check electron/preload.js`、`node --check frontend/js/tools-core.js` 全通过。
2. 联调 `dsh-agent:check-install`（无 force）：若 npm 可达，返回 `command` 含 `@<最新版>`、`source:'npm'`；再点一次（TTL 内）返回 `source:'cache'`。
3. 点「检测/重试」（force）：返回 `source:'npm'`（或 'readme'/'default'）。
4. 断网场景：返回 `command` 回落到缓存/默认，界面正常，无崩溃。
5. 未装 dsh 时启动 need-install 广播文案命令 = 解析后的最新命令。
6. 设置页/`DSH_NPX_SPEC` 覆盖仍生效。