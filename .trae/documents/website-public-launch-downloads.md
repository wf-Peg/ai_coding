# 官网免费上线公网 + 下载区（从 Git 仓库取最新版安装包）

## Summary

把 `website/` 官网免费部署到 **Cloudflare Pages**（免费子域名 `cutshelter.pages.dev`），并在官网新增「下载」板块，提供 **Windows / macOS(Apple Silicon, Intel) / 浏览器插件端** 下载。安装包与插件 zip 均存放于 **GitHub Release（仓库 `wf-Peg/ai_coding`）**，官网下载按钮在前端通过 GitHub 最新 Release API 动态解析出「当前最新版本」的直接下载链接，实现「从 Git 仓库取最新版本安装包」。

现有链路（无需重构）：`npm run build:*` (electron-builder) → `dist-electron/` → `scripts/release.sh` 用 `gh release create` 上传到 GitHub Releases。本计划只做**增量**：① 把 `browser-extension/` 插件打进 Release；② 官网加下载区（含动态取版本）；③ Cloudflare Pages 部署。

## 现状分析（已勘察）

- 官网 = `website/index.html`（单文件，样式/脚本全部内联，`:root` 自带 `--app-*` token）+ `website/demo.html`（**纯静态、无任何网络请求**，可在 pages.dev 上直接渲染）。footer 文案「官网为离线页面，双击即可打开」在上线公网后已过时，需改。
- 安装包产物（`package.json` build 配置 + `scripts/release.sh`）：
  - Win：`CutShelter-Setup-{version}.exe`（nsis 安装版）、`CutShelter-portable-{version}-win-x64.exe`（便携版）
  - Mac：`CutShelter-{version}-arm64.dmg`、`CutShelter-{version}-x64.dmg`（另有对应 `.zip`）
  - Linux：`*.AppImage`
- 发布链路：`scripts/release.sh`（`TOTAL_STEPS=9`）构建 → `dist-electron/` → 将 `*.exe/*.dmg/*.AppImage/*.zip/*.sha256` 作为 release 资产 `gh release create v{version}` 上传。**「Git 仓库取最新包」即 GitHub Releases，URL：`https://api.github.com/repos/wf-Peg/ai_coding/releases/latest`（CORS 开放，前端可直接 fetch）**。
- 插件：`browser-extension/` 为 Manifest V3 未打包扩展（含 `icons/icon-16/32/48/128.png`、`background.js`、`content.js`、`popup.html`、`options.html` 等），当前**未**打进 Release。
- 环境：`gh`（v2.89）已装；`zip` 可用；`wrangler` 未安装（部署用 `npx wrangler`）。Git remote = `https://github.com/wf-Peg/ai_coding.git`，分支 `main`。
- 无任何 CI workflow（`.github/workflows/` 不存在）。

## 变更内容

### A. 插件端打进 GitHub Release

**新增 `scripts/package-extension.js`（Node，跨 win/mac/linux 用系统 zip 能力）**
- 读 `package.json` 的 `version`。
- 对 `browser-extension/` 目录打 zip → 输出 `dist-electron/CutShelter-webclipper-{version}.zip`（**输出到 dist-electron 以便复用 release.sh 现有 `*.zip` 上传循环**，无需改 release 上传逻辑）。
- 排除：`node_modules/`、`*.zip`、`.DS_Store`、任何 `dist*` 临时产物；保留 `README.md`、icons、源码。
- 实现：优先用 `child_process.execSync('zip', …)`（win 回退 `powershell Compress-Archive`），目录设为 `browser-extension`、产出去到上层 `dist-electron/`。成功打印文件路径与大小，失败 `process.exit(1)`。

**`package.json` 新增 script**：`"package:extension": "node scripts/package-extension.js"`

**`scripts/release.sh` 接入（增量，不破坏现有流程）**
- 在 step 7「创建更新包」之后新增一步：`node scripts/package-extension.js`（失败仅 `log_warn`，不阻断）。
- 现有 step 8/9 的资产循环已含 `"$DIST_DIR"/*.zip`，因此插件 zip 会自动随 `gh release create` 上传，无需改动上传逻辑。
- （可选，保持最小）注释更新 REPO 说明。

### B. 官网新增「下载」区（自动取 GitHub 最新版）

**`website/index.html`：**

1. **导航**：`nav-links` 增加 `<a href="#download">下载</a>`；Hero 的 CTA 增加一个主按钮 `立即下载`（`href="#download"`，沿用 `.btn.btn-primary`）。

2. **新增区块**（放在 Hero 之后、`#experience` 之前，`<section class="section" id="download">`）：
   - `sec-kicker: Download` / `sec-title: 下载` / `sec-desc`（说明：桌面端与插件均托管于 GitHub Release，按钮自动指向当前最新稳定版）。
   - 三张下载卡（用现有 `.feature` / `.download-card` 语义，新增轻量 `.dl-card` 样式，配色沿用 `--app-*` token）：
     - **Windows**：主按钮「下载 Windows 安装版」→ Setup exe；副按钮「便携版（免安装）」→ portable exe
     - **macOS**：主按钮「Apple 芯片（M 系列）」→ `-arm64.dmg`；副按钮「Intel」→ `-x64.dmg`
     - **浏览器插件**：按钮「下载 Web Clipper 插件 (.zip)」→ 插件 zip；下方小字「Chrome/Edge：chrome://extensions → 开发者模式 → 加载已解压的扩展程序」教程；加 `doc-note` 提示需配合桌面端 API `http://127.0.0.1:8081`。
   - 每张卡一个 `<span class="dl-ver">` 用于回填当版本号，一个不可用的降级链接兜底。
   - 底部 `doc-note`：「全部安装包托管于 GitHub Releases，点击即跳转，若下载失败可前往 `/releases/latest` 手动选择。」——链接 `https://github.com/wf-Peg/ai_coding/releases/latest`。

3. **下载解析脚本**（HTML 底部 `<script>`，活动；与现有锚点平滑滚动脚本并存）：
   ```
   1) fetch('https://api.github.com/repos/wf-Peg/ai_coding/releases/latest', {headers:{Accept:'application/vnd.github+json'}})
   2) 取 data.tag_name（去掉 v 前缀 = 版本号）+ data.assets 数组
   3) 按 assets.name 正则匹配写 each 下载按钮的 href：
        Setup:    /CutShelter-Setup-.*\.exe/
        portable: /CutShelter-portable-.*win-x64\.exe/
        mac-arm:  /CutShelter-.*arm64\.dmg/
        mac-x64:  /CutShelter-.*x64\.dmg/
        clipper:  /CutShelter-webclipper-.*\.zip/
   4) href = https://github.com/wf-Peg/ai_coding/releases/download/{tag_name}/{name}
   5) 把去 v 的版本号与各文件大小写进 .dl-ver / 卡片文案
   6) 任一环节失败（离线/限流）：给所有下载按钮 href 统一指向 .../releases/latest，并在 .dl-ver 显示「前往 Releases 查看」；不 show 错误。
   ```
   - 使用**硬编码仓库**地址常量 `REPO='wf-Peg/ai_coding'`，避免拼接错误。
   - 优先给**鼠标** friendly：先设按钮下载链接，失败再统一回退。

4. **footer 文案修正**：`「官网为离线页面，双击即可打开」` → `「本地优先 · 数据 100% 属于你」`（因为已上公网，不再强调离线单页）。

**不改动** `design-tokens.css` / `ui-common.css`，保持官网自含 `:root` token。

### C. Cloudflare Pages 免费部署

上线方式（免费子域名 `cutshelter.pages.dev`）：

- **执行路径（我可在实现阶段执行，仅需你 OAuth 登录一次）**：
  1. 你运行 `npx wrangler login`（浏览器 OAuth 授权 Cloudflare 账号）。
  2. 执行 `npx wrangler pages project create cutshelter`（若项目不存在）。
  3. 执行 `npm run deploy:site` 部署 `website/`。
- `package.json` 新增 script：`"deploy:site": "npx wrangler pages deploy website --project-name=cutshelter --branch=main"`（输出 `https://cutshelter.pages.dev`）。
- **（可选，推荐长期自动部署）** Cloudflare Pages **Git 集成**：控制台 → Workers & Pages → Create Project → 连接 GitHub 仓库 `wf-Peg/ai_coding` → Build output directory 填 `website`、Build command 留空（纯静态）→ 之后每次 `git push` 自动发布。此为一站式人工配置（需你授权 CF 访问该仓库），非代码实现。

## 决策与假设

- 采用 **Cloudflare Pages**（用户已选），免费子域名 `cutshelter.pages.dev`，无独立域名。
- 安装包沿用已有 **GitHub Release** 链路，不做私有对象存储/CDN；下载直连 `github.com/.../releases/download/...`。
- 插件以 **zip 随 Release 供「加载已解压扩展」**（用户已选），不做 Chrome 商店上架。
- 官网下载区用 **前端 fetch GitHub latest API** 动态解析，离线时自动降级到 Release 页（不报错），因此官网即使断网也能给出手动入口。
- 插件 zip 与各安装包的命名含版本号，靠「当前最新 tag」确定性定位；每次新建发布同步更新。
- 不引入新 npm 依赖（`wrangler` 走 `npx`，不打进 dependencies/devDependencies；插件打包用系统 zip/powershell，不加包）。
- GitHub API 未认证时可能存在速率限制；已通过降级兜底处理，并且浏览器端访问 api.github.com 走 IP 白名单、无需 token。

## 验证步骤

1. 语法：`node --check scripts/package-extension.js`
2. 插件打包单测：`node scripts/package-extension.js` → `dist-electron/CutShelter-webclipper-<ver>.zip` 存在且内容含 `manifest.json`、`icons/`（解压抽查）。
3. 本地官网回归（http://127.0.0.1:8099/website/index.html，联网）：
   - 导航/hero 出现「下载」入口；滚动到 `#download` 看到三张卡。
   - 下载按钮 `href` 指向当前最新 tag 的资产 URL；`.dl-ver` 显示版本号。
   - 断网/屏蔽 api.github.com 时（可临时在 DevTools Network 阻断），按钮回退到 `/releases/latest`，无 JS 报错。
4. 顶部锚点平滑滚动、`demo.html` iframe 在线体验、`.reveal` 渐入仍正常。
5. 部署：`npx wrangler login` → `npm run deploy:site` → 打开 `https://cutshelter.pages.dev`，复跑步骤 3 的关键项，确认下载区 + demo 可用。
6. （若启用 Git 集成）`git push` 后确认 Pages 自动重新构建发布。