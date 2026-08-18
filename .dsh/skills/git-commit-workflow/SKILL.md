---
name: "git-commit-workflow"
description: "按项目规范执行 git 提交与推送。当用户说「提交」「推送」「commit」「push」「提交代码」等关键词时触发。自动编译验证、生成 conventional commit 消息、更新 commit_history.log、推送到远程。"
---

# Git Commit Workflow（项目规范提交）

按项目 `agent.md` 约束规则执行完整的 git 提交与推送流程，包括编译验证、commit 消息生成、`commit_history.log` 更新和远程推送。

## 提交规范

### Conventional Commit 格式

```
<type>[optional scope]: <description>
```

### 常用类型

| 类型       | 用途             |
|------------|------------------|
| `feat`     | 新功能           |
| `fix`      | Bug 修复         |
| `docs`     | 文档             |
| `refactor` | 重构             |
| `perf`     | 性能优化         |
| `test`     | 测试             |
| `chore`    | 维护/杂项        |
| `style`    | 样式/格式调整    |

### 项目特有约束

- **描述**：使用中文，缩写核心改动，30 字以内
- **多轮提交合并**：同一功能多次提交的注释合并为一条，如"工作台规则弹窗UI优化（多轮提交合并）"
- **scope**：使用模块名（如 `workspace`, `clip`, `todo`, `editor`, `wiki` 等）

## 完整工作流

### 1. 分析变更

```bash
# 查看未暂存变更
git diff --stat

# 查看已暂存变更
git diff --staged --stat

# 查看完整状态（含未跟踪文件）
git status --porcelain
```

### 2. 编译验证（后端）

提交前必须确保后端编译通过：

```bash
# 使用项目已配置的 Maven
$env:JAVA_HOME='K:\jdk\jdk-21.0.10'
& 'K:\apache-maven-3.5.4\bin\mvn.cmd' compile -q
```

注意：`git` 和 `mvn` 命令不在系统 PATH 中，必须使用完整路径：
- Git: `& 'K:\Git\bin\git.exe'`
- Maven: `& 'K:\apache-maven-3.5.4\bin\mvn.cmd'`

### 3. 暂存文件

```bash
# 暂存所有变更（排除临时目录）
& 'K:\Git\bin\git.exe' add -A ':!.editor-file-test-*' ':!.tmp'
```

### 4. 生成 Commit 消息

根据 diff 分析确定：
- **type**：变更类型（feat/fix/refactor/chore/docs 等）
- **scope**：影响模块
- **description**：中文描述，30 字以内浓缩核心改动

一行消息格式：
```
<type>(<scope>): <中文描述>
```

变更较多时，消息体列出关键变更点（bullet points），每个点 10 字以内。

### 5. 执行提交

```bash
& 'K:\Git\bin\git.exe' commit -m "<type>(<scope>): <description>" -m "- 要点1\n- 要点2"
```

### 6. 更新 commit_history.log

**此为必须步骤，不可遗漏。**

在项目根目录 `commit_history.log` 末尾追加一行：

```
YYYY-MM-DD HH:MM | <提交说明>
```

- 日期时间格式：`2026-08-11 17:04`
- 说明：30 字以内浓缩核心改动
- 多轮提交合并：标注"（多轮提交合并）"
- 使用 `commit_history.log` 文件中已有的最新记录时间作为参考，取当前时间

### 7. 推送远程

```bash
& 'K:\Git\bin\git.exe' -c http.sslVerify=false push origin <当前分支名>
```

推送到当前所在分支。SSL 验证问题已通过 `-c http.sslVerify=false` 绕过。

### 8. 最终检查

确认推送成功后，恢复 SSL 验证设置：

```bash
& 'K:\Git\bin\git.exe' config --global http.sslVerify true
```

## 触发条件

当用户说出以下任何关键词时，应触发本 skill：
- 「提交」「提交代码」「commit」
- 「推送」「push」「推送到远程」
- 「提交并推送」「提交+推送」
- 「提交规范」「按规范提交」

## 注意事项

1. 提交前必须编译验证，编译失败不提交
2. 暂存时排除 `.editor-file-test-*` 和 `.tmp` 目录
3. `commit_history.log` 更新必须紧跟在 git commit 之后，不可遗漏
4. 说明务必浓缩到 30 字以内，突出功能点而非技术细节
5. 同一功能多轮提交的注释合并为一条
6. 所有路径使用绝对路径，避免 `cd` 切换目录