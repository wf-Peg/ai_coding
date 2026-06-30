@echo off
REM ============================================================
REM release.bat — 一键发布脚本 (Windows 版)
REM
REM 用法：
REM   scripts\release.bat 1.0.1 "更新说明"
REM   scripts\release.bat 1.0.1                    REM 不写说明则用默认
REM   scripts\release.bat 1.0.1 "" win             REM 只构建 Windows
REM   scripts\release.bat 1.0.1 "" all             REM 构建所有平台
REM
REM 前置条件：
REM   1. 已安装 JDK 21 + Maven + Node.js
REM   2. 已配置 GitHub CLI (gh auth login)
REM   3. 已运行 npm install
REM ============================================================
setlocal enabledelayedexpansion

set "VERSION=%~1"
set "NOTES=%~2"
set "PLATFORM=%~3"

if "%VERSION%"=="" (
    echo 用法: scripts\release.bat ^<版本号^> [更新说明] [平台: win^|mac^|linux^|all]
    echo 示例: scripts\release.bat 1.0.1 "新增我的思考功能" all
    exit /b 1
)

if "%NOTES%"=="" set "NOTES=版本更新"
if "%PLATFORM%"=="" set "PLATFORM=all"

set "TAG=v%VERSION%"
set "REPO=wf-Peg/ai_coding"
set "DIST_DIR=dist-electron"
set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%.."

cd /d "%PROJECT_DIR%"

echo.
echo =============================================
echo   发布版本: %TAG%
echo   目标平台: %PLATFORM%
echo   仓库: %REPO%
echo =============================================
echo.

REM ============================================================
REM 步骤 1: 前置检查
REM ============================================================
echo [1/8] 前置检查

REM 检查 Java
where java >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [错误] 未安装 Java，请先安装 JDK 21
    exit /b 1
)

REM 检查 Java 版本
for /f "tokens=3" %%i in ('java -version 2^>^&1 ^| findstr /i "version"') do (
    set "JAVA_VER=%%i"
)
set "JAVA_VER=%JAVA_VER:"=%"
echo   Java 版本: %JAVA_VER%

REM 检查 Maven
where mvn >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [错误] 未安装 Maven
    exit /b 1
)

REM 检查 Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [错误] 未安装 Node.js
    exit /b 1
)

REM 检查 npm
where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [错误] 未安装 npm
    exit /b 1
)

REM 检查 GitHub CLI
where gh >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [错误] 未安装 GitHub CLI ^(gh^)
    echo   请运行: winget install GitHub.cli
    echo   然后: gh auth login
    exit /b 1
)

REM 检查 git 状态
git status --porcelain 2>nul | findstr /r "." >nul
if %ERRORLEVEL% EQU 0 (
    echo   [警告] 工作区有未提交的更改
    git status --short
    set /p "CONTINUE=是否继续? (y/N): "
    if /I not "!CONTINUE!"=="y" exit /b 1
)

REM 检查 gh 认证
gh auth status >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [错误] GitHub CLI 未认证，请运行: gh auth login
    exit /b 1
)

echo   [OK] 前置检查通过

REM ============================================================
REM 步骤 2: 更新版本号
REM ============================================================
echo [2/8] 更新版本号到 %VERSION%...

node -e "const pkg = require('./package.json'); pkg.version = '%VERSION%'; require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\r\n');"
if %ERRORLEVEL% NEQ 0 (
    echo   [错误] 版本号更新失败
    exit /b 1
)

git add package.json
git commit -m "chore: bump version to %VERSION%" 2>nul
if %ERRORLEVEL% NEQ 0 echo   [警告] 版本号可能未变化

echo   [OK] 版本号已更新

REM ============================================================
REM 步骤 3: 下载 JRE
REM ============================================================
echo [3/8] 下载 JDK 21 JRE（免安装便携版）...

if exist "jre\win\bin\java.exe" (
    echo   [OK] JRE 已存在，跳过下载
) else if exist "jre\mac\bin\java" (
    echo   [OK] JRE 已存在，跳过下载
) else (
    call scripts\download-jre.bat all
    if %ERRORLEVEL% NEQ 0 (
        echo   [警告] JRE 下载失败，打包将使用系统 JDK 路径
        echo   [警告] 如需内嵌 JRE，请手动运行: scripts\download-jre.bat all
    )
)

REM ============================================================
REM 步骤 4: 构建后端 JAR
REM ============================================================
echo [4/8] 构建后端 JAR...

cd backend
call mvn clean package -DskipTests -q 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [错误] Maven 构建失败
    cd ..
    exit /b 1
)
cd ..

if exist "backend\target\clip-demo-0.0.1-SNAPSHOT.jar" (
    for %%f in (backend\target\clip-demo-0.0.1-SNAPSHOT.jar) do set "JAR_SIZE=%%~zf"
    set /a "JAR_SIZE_MB=!JAR_SIZE! / 1048576"
    echo   [OK] 后端 JAR 构建完成 ^(!JAR_SIZE_MB! MB^)
) else (
    echo   [错误] 后端 JAR 构建失败！文件不存在
    exit /b 1
)

REM ============================================================
REM 步骤 5: 构建桌面客户端
REM ============================================================
echo [5/8] 构建桌面客户端...

if /I "%PLATFORM%"=="win" (
    echo   构建 Windows 便携版...
    call npm run build:win
) else if /I "%PLATFORM%"=="mac" (
    echo   构建 macOS...
    call npm run build:mac
) else if /I "%PLATFORM%"=="linux" (
    echo   构建 Linux...
    call npm run build:linux
) else if /I "%PLATFORM%"=="all" (
    echo   构建 Windows...
    call npm run build:win
    echo   构建 macOS...
    call npm run build:mac
    echo   构建 Linux...
    call npm run build:linux
)

if %ERRORLEVEL% NEQ 0 (
    echo   [错误] 构建失败
    exit /b 1
)

echo   [OK] 构建产物:
dir /b "%DIST_DIR%\*.exe" "%DIST_DIR%\*.dmg" "%DIST_DIR%\*.AppImage" "%DIST_DIR%\*.zip" 2>nul

REM ============================================================
REM 步骤 6: 创建更新包 ZIP
REM ============================================================
echo [6/8] 创建增量更新包...

set "UPDATE_ZIP=clip-update-%VERSION%.zip"
if exist "%DIST_DIR%\win-unpacked\resources" (
    if exist "%UPDATE_ZIP%" del /f "%UPDATE_ZIP%"
    powershell -NoProfile -Command ^
        "Compress-Archive -Path '%DIST_DIR%\win-unpacked\resources\*' -DestinationPath '%UPDATE_ZIP%' -Force"
    if exist "%UPDATE_ZIP%" (
        for %%f in ("%UPDATE_ZIP%") do set "UPDATE_SIZE=%%~zf"
        set /a "UPDATE_SIZE_MB=!UPDATE_SIZE! / 1048576"
        echo   [OK] 更新包已创建: %UPDATE_ZIP% ^(!UPDATE_SIZE_MB! MB^)
    )
) else (
    echo   [警告] win-unpacked 目录不存在，跳过更新包创建
)

REM ============================================================
REM 步骤 7: 验证产物
REM ============================================================
echo [7/8] 验证构建产物...

set "HAS_ARTIFACTS=0"
for %%f in ("%DIST_DIR%\*.exe" "%DIST_DIR%\*.dmg" "%DIST_DIR%\*.AppImage" "%DIST_DIR%\*.zip" "%UPDATE_ZIP%") do (
    if exist %%f (
        set "HAS_ARTIFACTS=1"
        echo   [OK] %%~nxf
    )
)

if "!HAS_ARTIFACTS!"=="0" (
    echo   [错误] 没有找到构建产物！
    exit /b 1
)

REM ============================================================
REM 步骤 8: 推送代码 + 创建 Release
REM ============================================================
echo [8/8] 推送代码到远程...

REM 获取当前分支名
for /f "tokens=*" %%b in ('git branch --show-current') do set "BRANCH=%%b"

git push origin "!BRANCH!"
if %ERRORLEVEL% NEQ 0 (
    echo   [错误] 推送失败
    exit /b 1
)
echo   [OK] 代码已推送

echo   创建 GitHub Release...

REM 构建 gh release create 命令
set "RELEASE_CMD=gh release create %TAG% --repo %REPO% --title "%TAG%" --notes "%NOTES%""

REM 附加所有构建产物
for %%f in ("%DIST_DIR%\*.exe" "%DIST_DIR%\*.dmg" "%DIST_DIR%\*.AppImage" "%DIST_DIR%\*.zip") do (
    if exist %%f set "RELEASE_CMD=!RELEASE_CMD! %%f"
)
if exist "%UPDATE_ZIP%" set "RELEASE_CMD=!RELEASE_CMD! %UPDATE_ZIP%"

%RELEASE_CMD%
if %ERRORLEVEL% NEQ 0 (
    echo   [错误] Release 创建失败
    exit /b 1
)

echo.
echo =============================================
echo   发布完成！
echo   版本: %TAG%
echo   Release: https://github.com/%REPO%/releases/tag/%TAG%
echo =============================================
echo.
echo 构建产物列表:
dir /b "%DIST_DIR%\*.exe" "%DIST_DIR%\*.dmg" "%DIST_DIR%\*.AppImage" "%DIST_DIR%\*.zip" 2>nul
if exist "%UPDATE_ZIP%" echo %UPDATE_ZIP% ^(增量更新包^)
echo.
endlocal