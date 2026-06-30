@echo off
REM ============================================================
REM download-jre.bat — 下载 JDK 21 JRE（免安装便携版）Windows 版
REM
REM 用法：
REM   scripts\download-jre.bat              REM 下载当前平台 (Windows)
REM   scripts\download-jre.bat all           REM 下载所有平台
REM   scripts\download-jre.bat win mac mac-arm
REM
REM 前置条件：需安装 PowerShell 5.0+
REM JRE 来源：Eclipse Adoptium (Temurin) 21
REM 存放路径：jre\ 目录（electron-builder 打包时作为 extraResources）
REM ============================================================
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%.."
set "JRE_DIR=%PROJECT_DIR%\jre"
set "API_BASE=https://api.adoptium.net/v3/binary/latest/21/ga"

if "%1"=="" (
    set "MODE=auto"
) else if /I "%1"=="all" (
    set "MODE=all"
) else (
    set "MODE=manual"
)

echo.
echo =============================================
echo   JDK 21 JRE 下载工具 (Windows)
echo   来源: Eclipse Adoptium Temurin 21
echo =============================================
echo.

REM ============================================================
REM 下载函数（调用 PowerShell）
REM ============================================================
:download_jre
set "PLATFORM=%~1"
set "OS="
set "ARCH="
set "EXT="

if /I "%PLATFORM%"=="win" (
    set "OS=windows" & set "ARCH=x64" & set "EXT=zip"
) else if /I "%PLATFORM%"=="windows" (
    set "OS=windows" & set "ARCH=x64" & set "EXT=zip"
) else if /I "%PLATFORM%"=="mac" (
    set "OS=mac" & set "ARCH=x64" & set "EXT=tar.gz"
) else if /I "%PLATFORM%"=="mac-x64" (
    set "OS=mac" & set "ARCH=x64" & set "EXT=tar.gz"
) else if /I "%PLATFORM%"=="mac-arm" (
    set "OS=mac" & set "ARCH=aarch64" & set "EXT=tar.gz"
) else if /I "%PLATFORM%"=="mac-arm64" (
    set "OS=mac" & set "ARCH=aarch64" & set "EXT=tar.gz"
) else if /I "%PLATFORM%"=="linux" (
    set "OS=linux" & set "ARCH=x64" & set "EXT=tar.gz"
) else (
    echo [错误] 未知平台: %PLATFORM%
    echo 支持的平台: win, mac, mac-arm, linux, all
    exit /b 1
)

set "OUT_DIR=%JRE_DIR%\%PLATFORM%"
set "URL=%API_BASE%/!OS!/!ARCH!/jre/hotspot/normal/eclipse?project=jdk"

if not exist "!OUT_DIR!" mkdir "!OUT_DIR!"

echo [JRE] 下载 !PLATFORM! JRE 21...
echo [JRE] URL: !URL!

REM 使用 PowerShell 下载并解压
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$url = '%URL%';" ^
    "$outDir = '%OUT_DIR%';" ^
    "$tmpFile = Join-Path $env:TEMP 'jre-download-tmp';" ^
    "Write-Host '[JRE] 正在下载...';" ^
    "try {" ^
    "  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;" ^
    "  $wc = New-Object System.Net.WebClient;" ^
    "  $wc.Headers.Add('User-Agent', 'JRE-Downloader/1.0');" ^
    "  $wc.DownloadFile($url, $tmpFile);" ^
    "  $size = [math]::Round((Get-Item $tmpFile).Length / 1MB, 1);" ^
    "  Write-Host \"[JRE] 下载完成: $size MB\";" ^
    "  Write-Host '[JRE] 正在解压...';" ^
    "  if ($url -match 'zip') {" ^
    "    Expand-Archive -Path $tmpFile -DestinationPath $outDir -Force;" ^
    "  } else {" ^
    "    # tar.gz 需要先解压 gz 再解压 tar" ^
    "    $tmpGz = $tmpFile + '.gz';" ^
    "    Rename-Item $tmpFile $tmpGz -Force;" ^
    "    # 使用 7z 或 tar 命令" ^
    "    $tarExe = Get-Command tar -ErrorAction SilentlyContinue;" ^
    "    if ($tarExe) {" ^
    "      & tar -xzf $tmpGz -C $outDir;" ^
    "    } else {" ^
    "      Write-Host '[JRE] 警告: 未找到 tar 命令，请手动解压 tar.gz 文件';" ^
    "      Write-Host '[JRE] 文件位置: ' + $tmpGz;" ^
    "    }" ^
    "  }" ^
    "  # 扁平化目录结构" ^
    "  $subDirs = Get-ChildItem $outDir -Directory | Where-Object { $_.Name -like 'jdk*' -or $_.Name -like 'jre*' };" ^
    "  if ($subDirs) {" ^
    "    foreach ($sub in $subDirs) {" ^
    "      Get-ChildItem $sub.FullName | Move-Item -Destination $outDir -Force;" ^
    "      Remove-Item $sub.FullName -Recurse -Force -ErrorAction SilentlyContinue;" ^
    "    }" ^
    "  }" ^
    "  Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue;" ^
    "  Remove-Item $tmpGz -Force -ErrorAction SilentlyContinue;" ^
    "  Write-Host \"[JRE] !PLATFORM! JRE 准备完成: $outDir\";" ^
    "  # 验证 java 可执行文件" ^
    "  $javaExe = Get-ChildItem $outDir -Recurse -Filter 'java.exe' -ErrorAction SilentlyContinue | Select-Object -First 1;" ^
    "  if ($javaExe) { Write-Host \"[JRE] 验证通过: $($javaExe.FullName)\" }" ^
    "  else {" ^
    "    $javaBin = Get-ChildItem $outDir -Recurse -Filter 'java' -ErrorAction SilentlyContinue | Select-Object -First 1;" ^
    "    if ($javaBin) { Write-Host \"[JRE] 验证通过: $($javaBin.FullName)\" }" ^
    "  }" ^
    "} catch {" ^
    "  Write-Host \"[JRE] 错误: $_\";" ^
    "  Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue;" ^
    "  exit 1;" ^
    "}"

if %ERRORLEVEL% NEQ 0 (
    echo [JRE] 下载失败: %PLATFORM%
    exit /b 1
)
exit /b 0

REM ============================================================
REM 主流程
REM ============================================================
if /I "%MODE%"=="all" (
    echo [JRE] 下载所有平台 JRE...
    call :download_jre win
    if !ERRORLEVEL! NEQ 0 exit /b 1
    call :download_jre mac
    if !ERRORLEVEL! NEQ 0 exit /b 1
    call :download_jre mac-arm
    if !ERRORLEVEL! NEQ 0 exit /b 1
    echo [JRE] 所有平台 JRE 下载完成
    goto :verify
)

if /I "%MODE%"=="auto" (
    echo [JRE] 自动检测当前平台...
    call :download_jre win
    if !ERRORLEVEL! NEQ 0 exit /b 1
    goto :verify
)

REM 手动模式：逐个下载指定平台
:download_loop
if "%1"=="" goto :verify
call :download_jre %1
if %ERRORLEVEL% NEQ 0 exit /b 1
shift
goto :download_loop

REM ============================================================
REM 验证
REM ============================================================
:verify
echo.
echo [JRE] JRE 目录结构:
if exist "%JRE_DIR%" (
    dir /s /b "%JRE_DIR%\java.exe" 2>nul
    dir /s /b "%JRE_DIR%\java" 2>nul
)
echo.
echo [JRE] 准备完成！现在可以运行打包命令:
echo   npm run build:win
echo   npm run build:portable:win
echo   npm run release 1.0.1 "说明" win
echo.
endlocal