#requires -version 5.1
<#
    一键提交推送脚本（git-commit-workflow 的核心执行体）
    把「暂存 → 编译验证 → commit → 追加 commit_history.log → push」固化为一次调用，
    减少 Agent 工具往返与 token 消耗。

    用法：
      powershell -ExecutionPolicy Bypass -File scripts/git-push.ps1 -Paths "文件1,文件2" -m "<消息>" [-Body "<正文>"] [-SkipCompile] [-WhatIf]
      powershell -ExecutionPolicy Bypass -File scripts/git-push.ps1 -All -m "<消息>" [-Body "<正文>"] [-SkipCompile] [-WhatIf]

    规则：
      - 默认仅按 -Paths 显式提交本次会话改动文件（逗号分隔；逐个 add，不带 -A）
      - -All 等同 add -A（排除临时目录），仅在用户明说「提交全部」时使用
      - 自动追加 commit_history.log：YYYY-MM-DD HH:MM | <消息第一行>
      - 不写全局 git config：push 用 -c http.sslVerify=false 临时参数

    注意：
      - powershell -File 模式不支持数组参数，故 -Paths 用逗号拼接的单字符串传入（文件名含逗号时改用 -All 或手动 git add）
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$m,
    [string]$Body,
    [string]$Paths,
    [switch]$All,
    [switch]$SkipCompile,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# ============ 常量（按本机环境调整） ============
$GIT        = 'K:\Git\bin\git.exe'
$MAVEN      = 'K:\apache-maven-3.5.4\bin\mvn.cmd'
$JAVA_HOME  = 'K:\jdk\jdk-21.0.10'
$REPO_ROOT  = Split-Path -Parent $PSScriptRoot
$LOG_FILE   = Join-Path $REPO_ROOT 'commit_history.log'
$EXCLUDE    = @(':!.editor-file-test-*', ':!.tmp')

function Write-Step([string]$text) {
    Write-Host "  > $text" -ForegroundColor Cyan
}

# ============ 参数校验 ============
$pathList = @()
if ($Paths) {
    $pathList = @($Paths -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
}
if (-not $All -and $pathList.Count -eq 0) {
    Write-Host "用法：" -ForegroundColor Yellow
    Write-Host "  git-push.ps1 -Paths ""文件1,文件2"" -m ""消息"" [-Body ""正文""] [-SkipCompile] [-WhatIf]"
    Write-Host "  git-push.ps1 -All -m ""消息"" [-Body ""正文""] [-SkipCompile] [-WhatIf]"
    Write-Host "说明：-All 仅在用户明说『提交全部』时使用；默认必须显式列出本次会话改动文件（-Paths，逗号分隔）"
    exit 2
}
if ($All -and $pathList.Count -gt 0) {
    Write-Host "[提示] -All 与 -Paths 同给，以 -All 为准"
}
if ([string]::IsNullOrWhiteSpace($m)) {
    Write-Host "错误：-m 提交消息不能为空" -ForegroundColor Red
    exit 2
}

Push-Location $REPO_ROOT
try {
    # ============ 1. 预检 ============
    $status = @(& $GIT status --porcelain)
    if ($status.Count -eq 0) {
        Write-Host "无变更，无需提交推送"
        exit 0
    }

    # ============ 2. 暂存 ============
    if ($All) {
        Write-Step "git add -A（排除临时目录）"
        if (-not $WhatIf) { & $GIT add -A $EXCLUDE }
    } else {
        Write-Step "git add <$($pathList.Count) 个会话文件>"
        if (-not $WhatIf) { foreach ($p in $pathList) { & $GIT add -- $p } }
    }

    # 已暂存为空（Paths 均为已提交/不存在）→ 不产生空提交
    if (-not $WhatIf) {
        & $GIT diff --cached --quiet
        if ($LASTEXITCODE -eq 0) {
            Write-Host "指定文件无实际变更，无内容可提交"
            exit 0
        }
    }

    # ============ 3. 后端编译验证 ============
    if (-not $SkipCompile) {
        Write-Step "mvn compile -q"
        if (-not $WhatIf) {
            $env:JAVA_HOME = $JAVA_HOME
            & $MAVEN compile -q
            if ($LASTEXITCODE -ne 0) {
                Write-Host "错误：后端编译失败，已中止，未提交" -ForegroundColor Red
                exit 1
            }
        }
    }

    # ============ 4. 提交 ============
    Write-Step "git commit -m <消息>"
    if (-not $WhatIf) {
        if ($Body) {
            & $GIT commit -m $m -m $Body
        } else {
            & $GIT commit -m $m
        }
        if ($LASTEXITCODE -ne 0) { exit 1 }
    }

    # ============ 5. 追加 commit_history.log ============
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm"
    $line = "$stamp | $m"
    Write-Step "append commit_history.log: $line"
    if (-not $WhatIf) {
        Add-Content -Path $LOG_FILE -Value $line -Encoding UTF8
    }

    # ============ 6. 推送 ============
    $branch = & $GIT rev-parse --abbrev-ref HEAD
    Write-Step "git push origin $branch"
    if (-not $WhatIf) {
        & $GIT -c http.sslVerify=false push origin $branch
        if ($LASTEXITCODE -ne 0) { exit 1 }
    }

    # ============ 7. 摘要 ============
    if ($WhatIf) {
        Write-Host "[WhatIf] 以上动作仅打印，未实际执行"
    } else {
        $hash = & $GIT rev-parse --short HEAD
        Write-Host "已提交并推送：$hash → $branch" -ForegroundColor Green
    }
} finally {
    Pop-Location
}
