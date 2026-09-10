# 提交推送 token 瘦身：一键脚本 + 技能瘦身方案

## 一、背景与目标

用户反馈：一次「提交+推送」消耗的 token 过多，询问是否走了 skill、能否固化成脚本减少消耗。

补充约束（用户确认）：**提交推送默认只针对本次会话上下文改动过的增量文件**，除非用户另作说明（如「提交全部」），不得 `add -A` 扫入无关文件（上次实操中工作区混入了其他会话的 editor.js 改动与 `.audit-clobber.tsv` 残留，需人工甄别，这正是 token 消耗与误提风险的一个来源）。

回答两个问题：
1. **是否走了 skill**：是。上一轮提交推送调用了 `git-commit-workflow` skill，加载了完整 SKILL.md。
2. **能否减少**：能。主因是工具往返次数多 + 大体积 diff 输出 + 手工甄别无关文件。把「按会话文件清单暂存→编译→提交→写日志→推送」固化为一次脚本调用即可大幅减少。

## 二、现状 token 消耗分析（实测路径）

上一轮提交推送的实际工具序列（17 次调用）：

| # | 操作 | 体积成本 |
|---|---|---|
| 1 | 加载 git-commit-workflow SKILL.md | ~1K token |
| 2-4 | `git status` / `git diff --stat` / `git log`（3 次往返） | 中 |
| 5-8 | Read .audit-clobber.tsv、`git diff editor.js \| Select -First 120`、`git ls-files`、`git diff commit_history.log` | **大**（editor.js diff ~4KB+） |
| 9-11 | Get-Date、node --check、Read commit_history.log 尾部 | 中 |
| 12-17 | 3 个 commit 各自 add+commit、Edit log、push、config+status | 高（6+ 次往返） |

结论：**可控大头 = 工具往返次数 + 全量 diff/文件读取**。skill 文件本身很小（~3.5KB），不是主要成本。真正省钱的手段是让一次脚本调用完成原来 10+ 次调用的事。

## 三、改动方案

### 1. 新增 `scripts/git-push.ps1`（一键提交推送脚本）★核心

**参数**：
- `-m <消息>`：提交消息（必填，同时作为 commit_history.log 记录行）
- `-Body <正文>`：可选，commit 正文（多要点，`-m` 之外的第二段）
- `-Paths <string[]>`：**默认模式**，显式列出本次会话改动过的文件（逐个 `git add`，不带 `-A`）
- `-All`：可选开关，等同 `git add -A`（排除临时目录）；**仅当用户明说「提交全部/全部推送」时使用**
- `-SkipCompile`：跳过后端编译验证（默认执行）
- `-WhatIf`：干跑，只打印将执行的动作

**路径与 `-All` 互斥校验**：两者都不给 → 打印用法并退出码 2（防止误扫）；两者都给了 → 以 `-All` 为准并提示。

**流程**（脚本内部顺序，全部一次调用完成）：
1. 预检：`git status --porcelain` 为空 → 打印「无变更」退出 0
2. 暂存：`-All` → `add -A ':!.editor-file-test-*' ':!.tmp'`；否则按 `-Paths` 逐个 `add`
3. 后端编译验证（`mvn compile -q`，JAVA_HOME 常量注入）；失败则中止不提交
4. `git commit -m <msg> [-m <body>]`
5. 追加 `commit_history.log`：`Get-Date -Format "yyyy-MM-dd HH:mm" | <msg 第一行>`（脚本自行追加，**不再需要 Read+Edit**）
6. 推送：`git -c http.sslVerify=false push origin <当前分支>`（用 `git rev-parse --abbrev-ref HEAD` 取分支）
7. 输出一行紧凑摘要：`commit <hash> → <branch> pushed`

**顶部常量**（便于迁移）：
```powershell
$GIT = 'K:\Git\bin\git.exe'
$MAVEN = 'K:\apache-maven-3.5.4\bin\mvn.cmd'
$JAVA_HOME = 'K:\jdk\jdk-21.0.10'
$REPO_ROOT = (Split-Path -Parent $PSScriptRoot)   # scripts/ 的上级 = 仓库根
```

**编码处理**：脚本文件存 UTF-8 with BOM（兼容 PS 5.1），脚本开头设置 `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8` 与 `$OutputEncoding = UTF8`，保证中文提交消息与 log 行不乱码（上一轮 `& git commit -m "中文"` 已验证可行）。

**不做的事**：不写全局 `git config`（原 SKILL 的「恢复 sslVerify」步骤删掉——push 用 `-c` 临时参数本身不持久化，且写 `C:\Users\...\.gitconfig` 在沙箱内会被拦截）。脚本只写仓库内文件（沙箱可写范围），零权限问题。

### 2. 瘦身 `.trae/skills/git-commit-workflow/SKILL.md`

由 ~100 行改为 ~25 行薄壳，保留规则、删除流程冗余：

- **保留**：触发关键词、Conventional Commit 格式与类型表、scope 用模块名、描述 30 字内、多轮合并要点、`commit_history.log` 格式
- **动作替换为 4 步**：
  1. 收集文件清单：从**本次会话实际改动**提取文件路径（不 `add -A`），可一次 `git status --porcelain` 核对工作区是否混入无关文件
  2. 依据本次会话实际改动写消息（30 字内）
  3. 执行：`powershell -ExecutionPolicy Bypass -File scripts/git-push.ps1 -Paths <文件1> <文件2> ... -m "<消息>" [-Body "..."]`；用户明说「提交全部」时改用 `-All`
  4. 校验脚本输出的一行摘要（commit hash + push 结果）
- **删除**：原「完整工作流」8 步长流程、逐命令粘贴、log 手动 Read/Edit 步骤（全部下沉到脚本）

### 3. agent.md 补充一行（低风险一致性）

在「约束规则 13 提交历史记录」下方追加一行：提交+推送统一走 `scripts/git-push.ps1`（默认只提交本次会话改动文件，需 `-Paths` 列出；用户说明「提交全部」时用 `-All`；脚本自动追加 commit_history.log 并推送）。便于后续会话默认走脚本且不误扫文件。

## 四、假设与决策

- 脚本语言用 PowerShell：Windows 环境 + `scripts/` 已有 `diagnose-windows.ps1` 先例；`release.bat` 等也印证仓库脚本习惯
- **默认只提交本次会话改动文件**（`-Paths` 显式列出，逐个 add）；`-All` 仅在用户明说「提交全部」时启用，防止混入无关文件
- 一个提交一次脚本调用；多功能分开提交则调用多次（上次场景 = 2 次脚本调用，各自带各自的文件清单）
- 提交消息仍由 Agent 根据会话改动生成（脚本无法替代语义判断），但其余全部机械步骤由脚本一次完成
- 编译验证默认开启（项目验收标准要求），`-SkipCompile` 留给纯文档/前端改动提速
- 分支默认推当前分支（与仓库实际工作流一致，均为 main）
- 不引入新依赖（node/npm 脚本虽可行，但 mvn 编译与 git 均为外部命令，PowerShell 直接调用最简）

## 五、预期收益

| 指标 | 现状 | 改后 |
|---|---|---|
| 工具调用次数 | ~17 | ~4（skill 加载、status 核对、脚本、回复） |
| 大体积输出 | 全量 diff / 文件读取多次 | 仅 `git status --porcelain`（紧凑） |
| log 维护 | Read + Edit 2 次 | 脚本自动追加，0 次 |
| 误提风险 | 需人工甄别无关文件 | 默认按会话清单提交，天然隔离 |
| 预估 token | ~15-20K / 次 | ~4-6K / 次（降约 70%） |

> 注：每轮固定的内存上下文注入（user_profile / project_memory / topics，约 5-8K token）与提交推送无关，不在此方案范围内。

## 六、验证步骤

1. 语法：`powershell -ExecutionPolicy Bypass -File scripts/git-push.ps1 -WhatIf -Paths a.txt -m "x"` 能打印动作清单
2. 参数校验：不带 `-Paths`/`-All` → 打印用法退出码 2；`-Paths` 与 `-All` 同给 → 以 `-All` 为准
3. 干跑：临时改一行代码 → `-WhatIf` 验证暂存/提交/推送动作打印正确、不实际执行
4. 实跑：改一行 → 实跑一次 → 验证 commit 生成、`commit_history.log` 追加格式 `YYYY-MM-DD HH:MM | 摘要`、push 成功、工作区干净
5. 无关文件隔离：工作区存在无关改动（如另一会话文件）时用 `-Paths` 实跑 → 确认只提交指定文件，无关文件仍留在工作区
6. 中文回归：含中文消息提交后 `git log -1` 显示正常
7. 空工作区：运行脚本提示「无变更」退出码 0，不报错
8. 技能瘦身：触发「提交推送」关键词 → 确认流程收敛为 4 步
9. 后端改动回归：带 Java 改动实跑 → 确认 mvn compile 执行且失败时不提交
