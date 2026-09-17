# Git 同步功能优化：免账号密码 + 本地仓库自动检测（对齐 NoteGen）

## Summary

当前 Git 同步的「账号/密码」配置是**虚假/有害**的：`password` 字段从未被任何 git 命令使用（纯死代码），`username` 只被用于 `git config user.name`，会**覆盖用户本机已配好的 git 身份**。同时配置入口分散在剪藏页弹窗（`clip.html`）和设置页（`settings.html`）两处，字段语义不一致。

本轮方案**对齐 NoteGen 的 local-first + 免强制配置**理念：

1. **认证字段「两者都要」**：默认完全靠本机 git（SSH / 凭据管理器 / 全局 git 身份），不存放任何凭据；在「高级」折叠区保留一个可选的 `Token` 作为兜底（仅当用户主动填写时，拼进 HTTPS 远程地址）。
2. **检测优先、不强制配置**：后端自动检测存储目录是否已是 git 仓库、是否已有远程、是否已配好 commit 身份；检测到就**直接用**，不再覆盖 `user.name/email`、不再强制填账号密码。
3. **删除死字段**：`GitConfig.username/password` 与 `AppConfig.gitUsername/gitPassword` 统一改为单个 `token`。
4. **同步状态面板**：新增「本地仓库已检测 / 远程已检测 / 认证方式（本机 git vs Token）/ 提交身份是否就绪」展示。

> 面向「不会 git 的用户」的**一键初始化 + 自动建私有仓库**向导，本轮**不做**（下轮），本轮只做「检测 + 不强制配置」。

---

## Current State Analysis

- 后端 `GitService.executeGitOperations()`（`backend/src/main/java/com/example/clip/service/GitService.java:92-185`）当前逻辑：
  - `remoteComplete = gitConfig != null && gitConfig.isComplete()`（`isComplete()` 只要求 remoteUrl+branch 非空，见 `GitConfig.java:133-136`）。
  - 配置完整 → 调 `configureRemoteRepository()` 强制 `git config user.name`（把 `username` 写进去）、`git remote add/set-url`、`fetch`、`--set-upstream-to`。
  - 配置不完整 → 只做 `add + commit`，**不 pull/push**（即用户本机已 `git init` 并配好 remote，只要不在应用里填配置，就永远推不上去）。
- `configureRemoteRepository()`（`GitService.java:318-357`）：
  - 用 `gitConfig.getUsername()` 设置 `user.name`，若含 `@` 再设 `user.email` —— **会覆盖本机身份**。
  - **`password` 全程未使用**（只存于 config，不进入任何命令）。
- 配置双重存储/同步：
  - `GitConfig`（`git-config.json`）+ 剪藏页弹窗 `/api/git/config`。
  - `AppConfig.gitRemoteUrl/gitUsername/gitPassword/gitBranch`（`app-config.json`）+ 设置页；`AppConfigService.syncToGitConfig()`（`AppConfigService.java:245-259`）双向同步。
- 前端现状：
  - 剪藏页弹窗 `clip.html:613-646` 四字段：remoteUrl / username / password / branch。
  - 设置页 `settings.html:1496-1523` 四字段：gitRemoteUrl / gitUsername / gitPassword / gitBranch。
  - `clip-sync.js`（`loadGitConfig/saveGitConfig/testGitConnection`）与 `settings.js`（`testGit`/save）分别读写 username/password。
- 同步状态面板：`GitSyncProvider.getStatus()/buildFields()`（`GitSyncProvider.java:65-117`）当前只回 `remoteUrl/branch/workingDir/dirs`，`isReady()` 仅判断 `.git` 是否存在，**不判断远程/分支/身份**。

---

## Proposed Changes

### A. 后端：模型与检测逻辑

#### A1. `backend/.../config/GitConfig.java` — 字段语义修正
- 删除 `username`、`password` 字段及其 getter/setter。
- 新增 `private String token;`（可选访问令牌）+ getter/setter。
- 构造函数由 `(remoteUrl, username, password, branch)` 改为 `(remoteUrl, token, branch)`。
- `isComplete()` 保持「remoteUrl + branch 非空」，**token 不算**（有 token 无 remote 也不成立）。
- 更新类 Javadoc（说明 token 可选、仅兜底认证）。

#### A2. `backend/.../config/AppConfig.java` — 同步字段
- 删除 `gitUsername`、`gitPassword` 字段及 getter/setter；新增 `private String gitToken = "";` + getter/setter（保持 `gitRemoteUrl`、`gitBranch` 不变）。

#### A3. `backend/.../service/AppConfigService.java` — 同步/迁移对齐
- `syncToGitConfig()`：`new GitConfig(config.getGitRemoteUrl(), config.getGitToken(), config.getGitBranch())`。
- `migrateFromLegacy()` 的 Git 迁移段（`:292-305`）：把 `setGitUsername/setGitPassword` 改为 `setGitToken(gc.getToken() ...)`。

#### A4. `backend/.../service/GitService.java` — 核心：检测优先 + 不覆盖身份 + token 兜底

1. **删除身份覆盖**：从 `configureRemoteRepository()` 移除 `git config user.name/user.email` 两段（不再写任何身份）。缺失身份时让 git 自然报错，由同步分步结果透出（本轮不自动兜底身份，身份兜底归入下轮向导）。
2. **`configureRemoteRepository(directory, remoteUrl, branch)` 重构**：
   - 签名改为显式传参（不再读 `gitConfig` 内部字段拼接）。
   - 若 `gitConfig.token` 非空 → 构造带认证的 HTTPS 地址 `scheme://<token>@<host>/<path>`（仅对 https/http 生效；对 `git@` 的 SSH 地址不加 token）。
   - 检查本地远程：无 `origin` → `remote add`；有且与目标不同 → `remote set-url`（仅当显式配置了 remoteUrl 才走到这，属用户主动意图）。
   - 保留 `fetch` + `--set-upstream-to origin/<branch>`。
3. **`executeGitOperations()` 检测分流**：
   - 计算：`hasRepo`（`.git` 存在）、`localRemote`（`git remote get-url origin`，失败为空）、`localBranch`（`git symbolic-ref --short HEAD`，失败为空）。
   - 有效远程/分支：`effectiveRemote = (cfgRemote 非空) ? cfgRemote : localRemote`；`effectiveBranch = (cfgBranch 非空) ? cfgBranch : (localBranch 非空 ? localBranch : "main")`。
   - `wantRemote = effectiveRemote 非空`。仅 `wantRemote` 时：调 `configureRemoteRepository(dir, effectiveRemote, effectiveBranch)`；否则跳过远程配置（等价旧「仅本地提交」，但现在**只要检测到 localRemote 就算 wantRemote**，所以本机仓库也能 push）。
   - `fetch` 仍非致命；`pull`/`push` 在 `wantRemote` 且用 `effectiveBranch` 时执行。
4. **新增检测方法**（供 status 面板复用，public）：
   - `String getLocalRemoteUrl(Path dir)`：`git remote get-url origin`，空串表示无。
   - `String getLocalBranch(Path dir)`：`git symbolic-ref --short HEAD`，空串表示无。
   - `boolean hasLocalIdentity(Path dir)`：`git config user.name` 与 `git config user.email` 均非空（判断 commit 是否可用）。
5. **`testGitConnection()`**：放宽 `config.isComplete()` 前置 —— 若 config 不完整但本地检测到 `localRemote`，也允许 `fetch origin`（返回成功），否则维持「配置不完整」提示。

#### A5. `backend/.../service/sync/GitSyncProvider.java` — status/fields 增强
- `getStatus()` / `buildFields()` 追加：
  - `detectedRemoteUrl`：`gitService.getLocalRemoteUrl(parent)`。
  - `localBranch`：`gitService.getLocalBranch(parent)`。
  - `identityConfigured`：`gitService.hasLocalIdentity(parent)`。
  - `authMode`：`"token"`（配置 token 非空）/ `"local"`（检测到本地远程）/ `"none"`。
- `isReady()` 语义不变（`.git` 存在），远程/身份信息靠 `fields` 承载（不扩接口）。

### B. 前端：简化字段 + 面板状态

#### B1. `frontend/clip.html` — 剪藏页配置弹窗
- 字段改为：`远程仓库URL`、`分支名称`、折叠「高级（可选）→ 访问令牌 Token」。
- 删除 `username`、`password` 两个输入框；新增 `token`（`type="password"`，置于折叠区内，默认收起）。

#### B2. `frontend/js/clip-sync.js`
- `loadGitConfig()`：读 `remoteUrl/branch/token`，回填对应 input。
- `saveGitConfig()` / `testGitConnection()`：post 体改为 `{ remoteUrl, branch, token }`。
- `renderSyncPanel()` 连接状态 badge 逻辑增强：
  - `!ready` → 「仓库尚未初始化（缺少 .git）」。
  - `ready && configured` → 「已配置远程仓库」（`authMode==='token'` 时追加 「（Token 认证）」）。
  - `ready && !configured && fields.detectedRemoteUrl` → 「已检测到本地 Git 仓库（直接用本地配置）」。
  - `ready && !configured && !detectedRemoteUrl` → 「本地仓库已初始化，但未配置远程」。
- 「仓库信息」卡片追加显示 `detectedRemoteUrl`（本地检测到的远程）、`localBranch`、`identityConfigured`（提交身份是否就绪）。

#### B3. `frontend/settings.html` + `frontend/js/settings.js`
- Git 区字段同步收敛为 `remoteUrl + branch + token(折叠)`；删除 username/password 输入。
- `settings.js` 读取/保存键由 `gitUsername/gitPassword` 改为 `gitToken`；`testGit()` 相应去掉 username/password。

---

## Assumptions & Decisions

- **认证默认走本机 git**：不存、不强制任何凭据；SSH/凭据管理器/全局身份由 git 自身处理。
- **Token 仅兜底**：用户主动填 Token 才会将其嵌入 HTTPS 远程地址；SSH 地址（`git@`）不注入 token。已知取舍：Token 会以明文写入本地 `.git/config`（本地仓库，可接受；下轮向导若做「自动建库」再评估更安全注入方式）。
- **不覆盖本机 git 身份**：彻底移除 `git config user.name/email` 调用（这是用户本次痛点的根因）。
- **检测到本地 remote 即视为可远程同步**：`executeGitOperations` 对「未在应用内配置、但本机已 `git init + remote`」的用户，也能 pull/push（不再卡「仅本地提交」）。
- **身份兜底、一键初始化、自动建私有库 = 下轮**：本轮不实现（遵循用户「检测+不强制配置，向导下轮」+「做核心功能」）。
- **保留旧 API 兼容**：`GET/POST /api/git/config`、`POST /api/git/sync`、`POST /api/git/test-connection` 保持路径不变（`password` 旧 JSON 字段因 `@JsonIgnoreProperties(ignoreUnknown=true)` 被安全忽略）。
- **字段命名统一为 `token`**：`GitConfig.token` 与 `AppConfig.gitToken` 全链路一致。

---

## Verification

1. 后端编译：`cd backend && mvn -q -o compile`，exit 0。
2. 前端语法：`node --check frontend/js/clip-sync.js`、`node --check frontend/js/settings.js` 通过。
3. 手动（已有本机 git 仓库、未在应用填配置）：
   - `GET /api/sync-provider/git/status` 返回 `fields.detectedRemoteUrl` 非空、`authMode=local`、`identityConfigured=true`。
   - `POST /api/git/sync` 能完成 fetch→pull→add→commit→push（不再报「仅本地提交」）。
   - 本机 `git config user.name/email` **未被覆盖**（执行前后一致）。
4. 手动（填写 token + remote）：
   - `POST /api/git/config` 保存 `{remoteUrl, branch, token}` 成功；`GET /api/git/config` 返回 `token`，无 username/password 字段。
   - `POST /api/git/test-connection` 在 token 时走带认证地址、成功。
5. 剪藏页弹窗：仅见 `远程仓库URL / 分支 / 高级(Token)` 三组，无账号/密码；折叠区默认收起。
6. 设置页 Git 区：同样无账号/密码，Token 收进折叠；保存后 `gitToken` 正确回显。
7. 同步状态面板：正确渲染「已检测到本地 Git 仓库」/「已配置远程(Token)」/「未配置远程」三态，以及本地分支/提交身份信息。