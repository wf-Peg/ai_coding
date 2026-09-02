<#
.SYNOPSIS
CutShelter (Clip) Windows 启动诊断与验证脚本
.DESCRIPTION
静态校验安装目录关键资源（JRE / 后端 JAR / 前端）、实测 Java 版本、检查端口/残留进程/配置形态，
并在 -Launch 时拉起应用逐阶段探测（读取 app.log 阶梯标记 + 前端/后端 HTTP），输出 PASS/FAIL 报告。
适用于内网/离线环境："客户端没弹出来"时据此定位卡在哪一步。
.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts\diagnose-windows.ps1 -InstallDir "D:\soft\CutShelter"
powershell -ExecutionPolicy Bypass -File scripts\diagnose-windows.ps1 -InstallDir "D:\soft\CutShelter" -Launch
powershell -ExecutionPolicy Bypass -File scripts\diagnose-windows.ps1 -InstallDir "D:\soft\CutShelter" -Launch -OutFile report.txt
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDir,
    [switch]$Launch,
    [switch]$KeepRunning,
    [string]$OutFile = ""
)

# 显式 UTF-8 输出，规避中文乱码
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch { }

$script:Passed = 0
$script:Failed = 0
$script:Warned = 0
$script:ReportLines = New-Object System.Collections.Generic.List[string]

$BackendPort = 8081
$FrontendPort = 3001

function Write-Result {
    param([string]$Tag, [string]$Msg)
    $line = "[{0}] {1}" -f $Tag, $Msg
    switch ($Tag) {
        "PASS" { $script:Passed++;          Write-Host $line -ForegroundColor Green }
        "FAIL" { $script:Failed++;          Write-Host $line -ForegroundColor Red }
        "WARN" { $script:Warned++;          Write-Host $line -ForegroundColor Yellow }
        "INFO" {                             Write-Host $line -ForegroundColor Cyan }
        default{                            Write-Host $line }
    }
    $script:ReportLines.Add($line)
}

function Update-Result {
    param([string]$Tag, [string]$OldMsg, [string]$NewMsg)
    $script:ReportLines.RemoveAt($script:ReportLines.Count - 1)
    Write-Result $Tag $OldMsg
    Write-Result $Tag $NewMsg
}

function Show-Summary {
    Write-Result "INFO" "==== 汇总 ===="
    Write-Result "INFO" "通过(Passed)=$script:Passed  失败(Failed)=$script:Failed  警告(Warned)=$script:Warned"
    Write-Result "INFO" "本脚本仅为诊断工具；若 Passed 全绿仍不弹窗，请按『最后阶梯标记』定位并把本报告与 app.log 尾部一起反馈。"
    if ($OutFile) {
        $script:ReportLines | Set-Content -Path $OutFile -Encoding UTF8
        Write-Host "报告已导出: $OutFile" -ForegroundColor Cyan
    }
}

# 判断 Java 大版本(>=17 通过)，并回传版本串
function Test-JavaVersion {
    param([string]$JavaExe, [bool]$MustPass)
    if (-not (Test-Path $JavaExe -PathType Leaf)) {
        if ($MustPass) { Write-Result "FAIL" "未找到 Java 可执行文件: $JavaExe" }
        else { Write-Result "WARN" "未找到 Java 可执行文件: $JavaExe (后备路径缺失，非必须)" }
        return
    }
    $raw = & $JavaExe -version 2>&1
    $verText = ($raw | Out-String).Trim()
    $major = 0
    if ($verText -match '"(\d+)([\.-]\d+)*"') {
        $major = [int]$Matches[1]
    } elseif ($verText -match 'version\s+"(\d+)') {
        $major = [int]$Matches[1]
    }
    if ($major -eq 0) {
        # 尝试从输出中解析任一数字
        if ($verText -match '(\d+)\.\d+') { $major = [int]$Matches[1] }
    }
    if ($major -ge 17) {
        Write-Result "PASS" "Java 版本 OK (major=$major): $verText"
    } else {
        $msg = "Java 版本过低 (major=$major)，需 >= 17，否则后端 JAR 报 UnsupportedClassVersionError: $verText"
        if ($MustPass) { Write-Result "FAIL" $msg } else { Write-Result "WARN" $msg }
    }
}

function Test-PortFree {
    param([int]$Port, [string]$Name)
    $conns = @()
    try {
        $conns = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    } catch { }
    if ($conns.Count -gt 0) {
        $pids = ($conns | Select-Object -ExpandProperty OwningProcess -Unique) -join ","
        Write-Result "WARN" "端口 $Port ($Name) 被占用 PID=$pids，可能为残留进程，本应用将被单实例锁/端口清理拦截"
    } else {
        Write-Result "PASS" "端口 $Port ($Name) 空闲"
    }
}

# 将"最后一条阶梯标记"映射为根因提示
function Get-StageHint {
    param([string]$Stage)
    $map = @{
        ""                  = "app.log 尚未出现任何 [Ladder] 标记：主进程很可能根本没进入 whenReady，或探针前就已退出。请确认 app.log 末尾是否有 [Probe]/[Fatal] 行。"
        "probe"             = "刚过资源预检：疑似卡在 setupIPC / clearCache 之前的早期环节。"
        "ipc.after"         = "setupIPC 完成，疑似卡在 await session.defaultSession.clearCache()（离线环境此调用偶发阻塞）。"
        "cache.before"      = "正在执行 clearCache，长时间无后置标记 = 卡在 clearCache。"
        "cache.after"       = "缓存已清，进入 SQLite 本地索引初始化。若长时间卡在 index.before，说明 initLocalIndex 全量扫描过慢/挂死（检查 storagePath 下是否含超大目录，如 integrations/dsh/node_modules）。"
        "index.before"      = "正在全量扫描建索引（默认 storagePath=安装目录，含 integrations/dsh），若长时间停留此步为空闲卡死的高发点。"
        "index.after"       = "索引层就绪，但后续无配置读取标记：疑似卡在截图初始化 / 托盘创建 / 配置加载之一。"
        "screenshot.after"  = "截图服务就绪，疑似卡在 createTray 或配置迁移/加载。"
        "tray.after"        = "托盘就绪，疑似卡在配置加载 loadConfig 或端口清理 killPortProcess。"
        "migrate.after"     = "配置迁移完成，进入 loadConfig，极少在此卡住。"
        "config.after"      = "配置已读取。若卡在此后，则卡在端端口清理(killPortProcess 的 netstat/taskkill)阶段。"
        "ports.after"       = "端口清理完成。未出现 fe.before = 在进入服务启动前卡住；或系统静默无输出。"
        "fe.before"         = "正在启动前端静态服务（绑定 127.0.0.1:3001），长时间停留 = 端口被占或事件循环异常。"
        "fe.after"          = "前端已就绪。未出现 window.after = 卡在后端启动（请查看 backend.log）。"
        "backend.before"    = "正在启动后端 Java 进程。若崩溃无 window.after，重点查 Java 版本/backend.log。"
        "backend.after"     = "后端已就绪。未出现 window.after = 卡在 createMainWindow。"
        "window.after"      = "主窗口已创建（已接管 createMainWindow 之后）。窗口仍不显示请看 backend.log 与渲染进程日志。"
    }
    if ($map.ContainsKey($Stage)) { return $map[$Stage] }
    return "未知阶梯标记 '$Stage'，可再核对 app.log 原文。"
}

# ==================== 收集环境信息 ====================
$Env:INSTALL = $InstallDir
if (-not (Test-Path $InstallDir)) {
    Write-Result "FAIL" "安装目录不存在: $InstallDir（请确认解压路径）"
    . Show-Summary
    exit 1
}
if (-not $InstallDir.EndsWith("\")) { $InstallDir += "\" }
$resPath = Join-Path $InstallDir "resources"
if (-not (Test-Path $resPath)) {
    Write-Result "FAIL" "缺少 resources 目录: $resPath（此目录需与 exe 同级的根目录下）"
    . Show-Summary
    exit 1
}

Write-Result "INFO" "==== 静态资源校验 (InstallDir=$InstallDir) ===="

# 1. 可写性（日志目录）
$probeLog = Join-Path $InstallDir "__diag_probe.tmp"
try {
    [System.IO.File]::WriteAllText($probeLog, "diag", (New-Object System.Text.UTF8Encoding $false))
    Remove-Item $probeLog -ErrorAction SilentlyContinue
    Write-Result "PASS" "安装目录可写（可写出 app.log）"
} catch {
    Write-Result "FAIL" "安装目录不可写，日志和自动更新将失败，请授予写入权限: $InstallDir"
}

# 2. 应用 exe
$exe = Get-ChildItem -Path $InstallDir -Filter *.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notmatch 'uninst' } |
    Sort-Object Length -Descending | Select-Object -First 1
if ($exe) { Write-Result "PASS" "找到应用可执行文件: $($exe.Name)" }
else { Write-Result "FAIL" "未找到应用 exe（期望 {安装目录}\\CutShelter.exe 等）" }

# 3. 内嵌 JRE（关键：必须 >= 17）
$jreJava = Join-Path $resPath "jre\bin\java.exe"
if (Test-Path $jreJava) {
    Write-Result "PASS" "内嵌 JRE 存在: $jreJava"
    Test-JavaVersion -JavaExe $jreJava -MustPass $true
} else {
    Write-Result "FAIL" "缺少内嵌 JRE: $jreJava（已配置的后端将无法启动，JAR 需要 Java 17+）"
}
# runtime 兜底目录
$rtJava = Join-Path $resPath "runtime\bin\java.exe"
if (Test-Path $rtJava) { Write-Result "INFO" "另发现 runtime Java 兜底目录存在(可选): $rtJava" }

# 4. 系统 Java（后备提示，非必须）
$sysJava = Get-Command java -ErrorAction SilentlyContinue
if ($sysJava) {
    Write-Result "INFO" "系统 Java 存在于 PATH ($($sysJava.Source))，仅作后备参考，应用优先用内嵌 JRE"
} else {
    Write-Result "WARN" "未检测到系统 java（若内嵌 JRE 缺失则该失败）"
}

# 5. 后端 JAR
$jar = Join-Path $resPath "backend\clip-demo-0.0.1-SNAPSHOT.jar"
if (Test-Path $jar) {
    $len = (Get-Item $jar).Length
    if ($len -gt 1024) { Write-Result "PASS" "后端 JAR 存在且大小正常 ($([math]::Round($len/1KB,0)) KB): $jar" }
    else { Write-Result "FAIL" "后端 JAR 异常小 (=$len 字节)，可能损坏: $jar" }
} else { Write-Result "FAIL" "缺少后端 JAR: $jar" }

# 6. 前端 index.html
$index = Join-Path $resPath "frontend\index.html"
if (Test-Path $index) { Write-Result "PASS" "前端入口存在: $index" }
else { Write-Result "FAIL" "缺少前端 index.html: $index" }

# 7. DSH 集成目录
$dsh = Join-Path $resPath "integrations\dsh"
if (Test-Path $dsh) { Write-Result "PASS" "DSH 集成目录存在: $dsh" }
else { Write-Result "WARN" "缺少 integrations\dsh（AI 干活面板不可用，但主程序仍应能启动）" }

# ==================== 运行时环境 ====================
Write-Result "INFO" "==== 运行时环境 ===="

# 端口占用
Test-PortFree -Port $BackendPort -Name "backend"
Test-PortFree -Port $FrontendPort -Name "frontend"

# 残留实例
$procs = @(Get-Process CutShelter -ErrorAction SilentlyContinue) + @(Get-Process clip-demo -ErrorAction SilentlyContinue)
if ($procs.Count -gt 0) {
    $pids = ($procs | Select-Object -ExpandProperty Id) -join ","
    Write-Result "WARN" "检测到残留进程 PID=$pids（单实例锁会让新启动的实例直接退出而不弹窗）。建议先在任务管理器结束旧 CutShelter.exe 再试"
} else {
    Write-Result "PASS" "无残留 CutShelter 进程"
}

# 配置形态
$userDataConfig = Join-Path $env:LOCALAPPDATA "CutShelter\config\config.json"
if (Test-Path $userDataConfig) {
    try {
        $cfg = Get-Content $userDataConfig -Raw -Encoding UTF8 | ConvertFrom-Json
        $mode = if ($cfg.configured) { "已配置(configured=$($cfg.configured), startupMode=$($cfg.startupMode))，应弹出主窗口" }
                 else { "未配置，应弹出'首次运行设置'窗口" }
        Write-Result "INFO" "发现配置 $userDataConfig → $mode, storagePath=$($cfg.storagePath), 端口=backend:$($cfg.backendPort)/frontend:$($cfg.frontendPort)"
        if ($cfg.frontendPort) { $script:FrontendPort = [int]$cfg.frontendPort }
        if ($cfg.backendPort)  { $script:BackendPort  = [int]$cfg.backendPort }
    } catch {
        Write-Result "WARN" "配置文件存在但解析失败（可能是旧版/损坏）: $userDataConfig"
    }
} else {
    Write-Result "INFO" "未发现配置 $userDataConfig → 属首次运行（应弹出设置窗口）"
}

# ==================== 拉起探测 ====================
if ($Launch) {
    Write-Result "INFO" "==== 拉起探测 (app.log 阶梯标记 + HTTP) ===="

    $appLog = Join-Path $InstallDir "app.log"
    $backendLog = Join-Path $InstallDir "backend.log"
    $logSeek = 0
    if (Test-Path $appLog) { $logSeek = (Get-Item $appLog).Length }

    if ($exe) {
        Write-Result "INFO" "启动 $($exe.FullName) ..."
        $p = Start-Process -FilePath $exe.FullName -WorkingDirectory $InstallDir -PassThru
        Start-Sleep -Seconds 12
        if ($p -and -not $p.HasExited) {
            Write-Result "PASS" "主进程存活 (PID=$($p.Id))，未在启动初期闪退"
        } elseif ($p -and $p.HasExited) {
            Write-Result "FAIL" "主进程已退出 (exitCode=$($p.ExitCode))，应用启动即崩溃"
        }

        # 前端/后端 HTTP 实测
        $feOk = $false; $beOk = $false
        try { $feOk = ((Invoke-WebRequest -Uri ("http://127.0.0.1:" + $script:FrontendPort) -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200) } catch { }
        try { $be = Invoke-WebRequest -Uri ("http://127.0.0.1:" + $script:BackendPort + "/api/health") -UseBasicParsing -TimeoutSec 5; $beOk = ($be.StatusCode -eq 200 -and $be.Content -match 'UP') } catch { }
        if ($feOk)  { Write-Result "PASS" "前端 HTTP OK  ($script:FrontendPort, 返回 200)" }
        else        { Write-Result "FAIL" "前端 HTTP 不通 ($script:FrontendPort)。说明前端静态服务未起来" }
        if ($beOk)  { Write-Result "PASS" "后端 HTTP OK  ($script:BackendPort/api/health = UP)" }
        else        { Write-Result "WARN" "后端 HTTP 不通 ($script:BackendPort/api/health)。若为 frontend-only 模式属正常，否则请看 backend.log" }

        # 解析 app.log 最后一条阶梯标记
        $stage = ""
        if (Test-Path $appLog) {
            $newBytes = $logSeek
            try {
                $fs = [System.IO.File]::OpenRead($appLog)
                if ($newBytes -gt $fs.Length) { $newBytes = $fs.Length }
                $fs.Seek($newBytes, [System.IO.SeekOrigin]::Begin) | Out-Null
                $buf = New-Object byte[] ($fs.Length - $newBytes)
                $rd = $fs.Read($buf, 0, $buf.Length)
                $tail = [System.Text.Encoding]::UTF8.GetString($buf, 0, $rd)
                $fs.Close()
                # 追加既有内容最后 100 行作为兜底
                if ([string]::IsNullOrWhiteSpace($tail)) {
                    $existing = Get-Content $appLog -Tail 120 -Encoding UTF8
                    $tail = ($existing -join "`n")
                }
                $m = [regex]::Matches($tail, '\[Ladder\] step:(\S+)')
                if ($m.Count -gt 0) { $stage = $m[$m.Count - 1].Groups[1].Value }
                Write-Result "INFO" "app.log 本次启动最后阶梯标记 = '$stage'"
                # 一次性列出本次出现的所有阶梯，方便人工核对
                if ($m.Count -gt 0) {
                    $all = ($m | ForEach-Object { $_.Groups[1].Value }) -join ", "
                    Write-Result "INFO" "本次阶梯序列: $all"
                }
                if ($tail -match '\[Fatal\]|\[Startup\] FATAL|render-process-gone|UnhandledRejection|uncaught') {
                    Write-Result "WARN" "app.log 中出现异常/致命标记，见下方日志尾部"
                }
            } catch {
                Write-Result "WARN" "读取 app.log 增量失败: $($_.Exception.Message)"
            }
        } else {
            Write-Result "FAIL" "本次未生成 app.log 于 $InstallDir（检查是否被写权限/其它目录拦截）"
        }

        # 给出阶段定位提示
        if ($stage -eq "window.after") {
            Write-Result "PASS" "启动阶梯已走到 window.after，主窗口创建逻辑已执行。若仍不见窗口，请看 backend.log / 渲染进程日志（did-fail-load / render-process-gone）"
        } elseif ("window.after,fe.after,backend.after".Contains($stage)) {
            Write-Result "INFO" "启动已较靠后 (阶段=$stage)。$(Get-StageHint $stage)"
        } else {
            Write-Result "INFO" "排查提示（当前阶段=$stage）：$(Get-StageHint $stage)"
        }

        if (-not $KeepRunning) {
            Write-Result "INFO" "停止本次启动以清理环境 (任务管理器结束 $exe)..."
            try { Stop-Process -Name $exe.BaseName -ErrorAction SilentlyContinue } catch { }
            Start-Sleep -Seconds 1
        }
    } else {
        Write-Result "FAIL" "未找到 exe，跳过拉起探测"
    }

    # 日志尾部
    Write-Result "INFO" "==== 日志尾部 (app.log / backend.log 最后 40 行) ===="
    if (Test-Path $appLog) {
        Write-Result "INFO" "--- $appLog (tail 40) ---"
        Get-Content $appLog -Tail 40 -Encoding UTF8 | ForEach-Object { Write-Result "INFO" $_ }
    }
    if (Test-Path $backendLog) {
        Write-Result "INFO" "--- $backendLog (tail 25) ---"
        Get-Content $backendLog -Tail 25 -Encoding UTF8 | ForEach-Object { Write-Result "INFO" $_ }
    } else {
        Write-Result "WARN" "未找到 backend.log（后端进程从未成功写出日志：多为 Java 未启动/版本问题）"
    }
}

# ==================== 汇总 ====================
Show-Summary