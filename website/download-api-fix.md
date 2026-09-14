# 官网下载区 403 问题与修复方案

> 状态：已按方案 C（Pages Function 代理 + 内置直链兜底）完成代码实施并已部署线上，下载按钮在真实浏览器中验证可直接下载。

## 线上验证结果（2026-09-14）

- 已部署：`npm run deploy:site` 成功，`Uploading Functions bundle`，生产域 `cutshelter.pages.dev`。
- 实测：线上 `/api/releases` 也返回 `{"error":"github 403"}`（502）——**Cloudflare 出口 IP 同样被 GitHub 匿名限流**（正是方案 A 末尾警告的情况，CF 出口共享 IP 很容易打爆 60 次/小时限额）。
- 兜底生效：在 502 前提下，真实浏览器（线上）5 个下载按钮 href 仍均为 `releases/download/v1.0.14/<资产>` 直链，未回落到 releases 页，**可直接触发下载**。console 无错误。
- 结论：下载功能已止血（内置直链兜底保证可下载）。
- ⚠️ 遗留：`/api/releases` 因出口限流持续 502，「自动取最新版直链」的能力暂未生效，版本停在内置的 `v1.0.14`，需发版时手动同步 `BUILTIN`。若要让接口恢复实时新版，可在 CF Pages 配置 GitHub Token 环境变量（`GITHUB_TOKEN`）走认证 API（5000 次/小时）。

## 问题现象

- 官网下载区在部分用户浏览器（PC）点击「Windows 免安装版」时，页面报 **403**（F12 Network 可见 `Failed to load resource 403`），最终跳转到 GitHub `releases/tag/v1.0.14` 页面，无法触发直接下载。
- 而手机或其他 IP 访问时能正常跳转到直链下载。
- 现象取决于请求时是否被 GitHub 匿名限流，与设备类型无关。

## 根因

下载区是**纯前端运行时**解析 Asset 直链的（见 `website/index.html` 下载逻辑）：

```js
json('https://api.github.com/repos/wf-Peg/ai_coding/releases/latest')
  .then(function (latest) { match(latest); /* ...解析 asset 直链... */ })
  .catch(setFallback);   // 失败 → 全部按钮 href 回退 LATEST_PAGE → 跳 release 页
```

- 该 `api.github.com` 请求**不带 token**，GitHub 对匿名请求限流 **60 次 / 小时 / IP**。
- 被限流时该请求返回 **403** → 触发 `.catch(setFallback())` → 所有下载卡回退到 `/releases/latest` → GitHub 302 重定向到 `/releases/tag/v1.0.14`。
- 手机那次请求恰好未被限流 → 成功命中直链，所以表现正常。

## 影响范围

`website/index.html` 底部 `download` 区脚本（`RE`/`filled`/`apply`/`json` 相关逻辑），以及 `setFallback` 的兜底行为。

## 候选方案（择一实施，按推荐排序）

### 方案 A：Cloudflare Pages 同域函数代理（推荐，根治）

- 增加 `website/functions/api/releases.js`（Cloudflare Pages Function），由 Cloudflare 侧请求 GitHub API 并返回结果。
- 前端把 `fetch('https://api.github.com/...')` 改为 `fetch('/api/releases')`（同域，无访客 IP 匿名限流）。
- 优点：访客 IP 不再受限，发新版本无需改页面。
- 注意：Cloudflare 出口 IP 也可能有限流，可在函数内做简单缓存（如 KV/缓存头）进一步降低命中频率。

### 方案 B：硬编码最新版本直链（最简单）

- 把最新版本号（当前 `v1.0.14`）与各端直链直接写死进 `index.html`，去掉运行时 `api.github.com` 请求。
- 优点：彻底无 403、无依赖。
- 缺点：每次发新版本要手动更新一次页面并重新部署。

### 方案 C：A + B 结合（最稳）🔨 本次已实施

- Pages Function 为主（`website/functions/api/releases.js`，返回 `{latest, list}` 并带 `s-maxage` 边缘缓存），前端改走同域 `/api/releases`，访客 IP 不再受限；发新版本无需改页面。
- 页面内保留一张「当前版本直链」（`website/index.html` 的 `BUILTIN` map，当前为 `v1.0.14`）作为函数失败时的兜底，双保险。—— ⚠️ 发新版本时需手动同步 `BUILTIN_TAG` 与 `BUILTIN` 的资产名。

## 待办（后续开发）

- [x] 选定方案 C 并实施到 `website/`
- [x] 调整 `deploy:site`：改为 `cd website && wrangler pages deploy .`，确保 `functions/` 随部署收录
- [x] 本地 `wrangler pages dev` 冒烟验证：函数路由返回 JSON（GitHub 403 时透传 502，前端走内置直链），下载按钮 href 均解析为 `download/v1.0.14/<资产>` 直链
- [x] 重新部署官网（`npm run deploy:site`，已上线）
- [x] 验证下载 Windows 免安装版等：线上真实浏览器下按钮均解析为 `download/` 直链，可直接下载
- [ ]（可选）配置 CF Pages `GITHUB_TOKEN` 环境变量，使 `/api/releases` 走认证 API 恢复实时取最新版