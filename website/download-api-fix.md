# 官网下载区 403 问题与修复方案（待开发）

> 状态：已排查定位，暂不改动线上，供后续开发实施。

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

### 方案 C：A + B 结合（最稳）

- Pages 函数为主，页面内保留一张"当前版本直链"作为函数失败时的兜底，双保险。

## 待办（后续开发）

- [ ] 选定方案并实施到 `website/`
- [ ] 重新部署官网（`npm run deploy:site`，需 `CLOUDFLARE_API_TOKEN`）
- [ ] 验证 PC/手机不同网络条件下下载 Windows 免安装版均能直接触发下载