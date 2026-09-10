# Git Commit Workflow（项目规范提交）

按项目 `agent.md` 约束执行 git 提交与推送。核心流程已固化为 `scripts/git-push.ps1`，本技能只负责「收集会话文件清单 + 写消息 + 调脚本」，减少工具往返与 token 消耗。

## 触发条件

用户说「提交」「推送」「commit」「push」「提交并推送」「提交全部」「提交规范」等关键词时触发。

## 提交规范

- 格式：`<type>[scope]: <中文描述>`，描述 30 字内
- type：`feat` / `fix` / `refactor` / `chore` / `docs` / `test` / `perf` / `style`
- scope：模块名（`clip` / `editor` / `workspace` / `wiki` / `backend` 等）
- 同一功能多轮提交合并为一条；`commit_history.log` 由脚本自动追加

## 执行流程（4 步）

1. **收集文件清单**：只取**本次会话实际改动**的文件路径（不 `add -A`）；可用一次 `git status --porcelain` 核对工作区是否混入无关文件
2. **写提交消息**：依据本次会话改动总结，30 字内
3. **执行一键脚本**：
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/git-push.ps1 -Paths <文件1> <文件2> ... -m "<消息>" [-Body "..."]
   ```
   - 用户明说「提交全部/全部推送」→ 改用 `-All`
   - 纯文档/前端改动 → 加 `-SkipCompile` 提速
   - 只想预览 → 加 `-WhatIf`
4. **校验摘要**：脚本输出 `已提交并推送：<hash> → <branch>` 即成功

## 注意事项

- 路径基于仓库根目录，脚本内置 `git`/`mvn` 完整路径（K:\...），不依赖系统 PATH
- 脚本只写仓库内文件、不写全局 git config（push 用 `-c http.sslVerify=false` 临时参数）
- 沙箱限制：若脚本因权限失败，需以沙箱外方式执行
