@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion
REM ============================================
REM Clip Demo - Build Script (Windows)
REM 本地打包 + 可选交互：
REM   ① 打包前询问是否递增版本号并更新 package.json
REM   ② 打包完成后询问是否推送到 GitHub Release（含更新包）
REM
REM 注意：交互输入/暂停统一走 node（scripts/version-prompt.js / console-helper.js），
REM 因为 chcp 65001 下 bat 的 set /p、pause 在控制台/管道输入时可能不等待或读到空值。
REM ============================================

cd /d "%~dp0"

echo ========================================
echo   Clip Demo - Desktop App Builder
echo ========================================
echo.

REM ---------- Step 1: Check Build Environment ----------
echo [1/6] 检查构建环境 ...
set "MISSING="

where node >nul 2>nul
if %errorlevel% neq 0 set "MISSING=Node.js"

where java >nul 2>nul
if %errorlevel% neq 0 set "MISSING=%MISSING% Java(JDK)"

where mvn >nul 2>nul
if %errorlevel% neq 0 set "MISSING=%MISSING% Maven"

if not "%MISSING%"=="" (
    echo [ERROR] Command not found: %MISSING%
    echo.
    echo Build machine needs:
    echo   1. Node.js 18+    https://nodejs.org/
    echo   2. JDK 17+        https://adoptium.net/
    echo   3. Maven 3.6+     https://maven.apache.org/download.cgi
    echo.
    node scripts\console-helper.js waitkey "[ERROR] 缺少构建工具"
    endlocal
    exit /b 1
)

echo [OK] Build environment check passed
echo.

REM ---------- Step 2: 版本号确认（询问是否递增版本号并更新） ----------
echo [2/6] 版本号确认 ...

REM 交互提示由 node 实现（chcp 65001 下 bat 的 set /p 对管道/重定向 stdin 不可靠）
node scripts\version-prompt.js
if errorlevel 1 (
    echo   [ERROR] 版本号确认失败
    node scripts\console-helper.js waitkey "[ERROR] 版本号确认失败"
    endlocal
    exit /b 1
)

set "VERSION="
if exist ".tmp\version-result.txt" set /p VERSION=<.tmp\version-result.txt
del /f /q ".tmp\version-result.txt" 2>nul
if "!VERSION!"=="" set "VERSION=1.0.0"
echo   发布版本: !VERSION!
echo.

REM ---------- Step 3: Build Backend JAR ----------
echo [3/6] 构建后端 JAR ...
cd /d "%~dp0backend"
call mvn clean package -DskipTests -q
if not exist "target\clip-demo-0.0.1-SNAPSHOT.jar" (
    echo [ERROR] JAR build failed
    cd /d "%~dp0"
    node scripts\console-helper.js waitkey "[ERROR] JAR 构建失败"
    endlocal
    exit /b 1
)
echo [OK] Backend JAR built successfully
cd /d "%~dp0"

REM ---------- Step 4: Prepare JRE (jlink 裁剪最小化) ----------
echo.
echo [4/6] 生成最小化 JRE (jlink)...
echo       可将 JRE 从 316MB 裁剪到约 50MB

REM 检查是否有 jlink 工具（需要 JDK 17+）
set "HAS_JLINK=0"
if defined JAVA_HOME if exist "%JAVA_HOME%\bin\jlink.exe" set "HAS_JLINK=1"
if defined JAVA_HOME goto :jlink_check_done
where jlink.exe >nul 2>&1
if errorlevel 1 goto :jlink_check_done
set "HAS_JLINK=1"
:jlink_check_done

if "%HAS_JLINK%"=="1" (
    echo       jlink tool found, generating minimal JRE...
    if not exist "jre\bin\java.exe" (
        call scripts\build-jlink.bat
        if errorlevel 1 (
            echo [WARNING] jlink failed, falling back to system Java
        )
    ) else (
        echo [OK] Minimal JRE already exists: jre\bin\java.exe
    )
) else (
    echo [INFO] jlink not available (need JDK 17+^), will use system Java.
    echo        Install JDK 17+ and run 'npm run build:jlink' for smaller package.
    echo        Download: https://adoptium.net/
)

REM Fallback: check if jre exists, if not, use system Java during build
if not exist "jre\bin\java.exe" (
    echo [INFO] No embedded JRE found. The build will use system Java.
    echo        Users without JDK installed must download JRE manually.
    echo        Run: scripts\build-jlink.bat  (needs JDK 17+)
    echo        Or:  scripts\download-jre.bat (no JDK needed)
)

REM ---------- Step 5: Install Electron Dependencies ----------
echo.
echo [5/6] 安装 Electron 依赖...
if not exist "node_modules" (
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed
        node scripts\console-helper.js waitkey "[ERROR] npm install 失败"
        endlocal
        exit /b 1
    )
) else (
    echo [OK] node_modules exists, skipping
)

REM ---------- Step 6: Package Desktop App ----------
echo.
echo [6/6] 打包桌面应用（Windows .exe + 更新包）...
echo     请耐心等待...
call npm run build:win
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Build failed, check error messages above
    node scripts\console-helper.js waitkey "[ERROR] 打包失败"
    endlocal
    exit /b 1
)

echo.
echo ========================================
echo   Build Complete!
echo   Output: dist-electron\
echo ========================================
echo.

REM ---------- 可选：推送到 GitHub Release ----------
node scripts\console-helper.js ask "是否推送到 GitHub Release（含更新包 clip-update-!VERSION!.zip）？(y/N)" ".tmp\pub-answer.txt"
set "PUBLISH="
if exist ".tmp\pub-answer.txt" set /p PUBLISH=<.tmp\pub-answer.txt
del /f /q ".tmp\pub-answer.txt" 2>nul

if /I not "!PUBLISH!"=="y" (
    echo.
    echo   已跳过发布。如需一键发布（含版本号提示）可运行: scripts\release.bat
    node scripts\console-helper.js waitkey "跳过发布"
    endlocal
    exit /b 0
)

echo.
echo   正在准备发布 v!VERSION! ...

where gh >nul 2>&1
if errorlevel 1 (
    echo   [ERROR] 未安装 GitHub CLI [gh]，跳过发布。
    echo   安装: winget install GitHub.cli  然后: gh auth login
    node scripts\console-helper.js waitkey "[ERROR] 未安装 gh"
    endlocal
    exit /b 0
)

gh auth status >nul 2>&1
if errorlevel 1 (
    echo   [ERROR] GitHub CLI 未登录，跳过发布。请先运行: gh auth login
    node scripts\console-helper.js waitkey "[ERROR] gh 未登录"
    endlocal
    exit /b 0
)

REM 提交版本号变更（package.json 未变化时 git commit 静默失败，无副作用）
git add package.json
git commit -m "chore: bump version to !VERSION!" 2>nul

set "TAG=v!VERSION!"
set "REPO=wf-Peg/ai_coding"
set "DIST_DIR=dist-electron"

REM Release 说明（可选输入）
node scripts\console-helper.js ask "请输入 Release 说明（回车默认「版本更新」）" ".tmp\notes-answer.txt"
set "NOTES=版本更新"
set "NOTES_INPUT="
if exist ".tmp\notes-answer.txt" set /p NOTES_INPUT=<.tmp\notes-answer.txt
del /f /q ".tmp\notes-answer.txt" 2>nul
if not "!NOTES_INPUT!"=="" set "NOTES=!NOTES_INPUT!"

REM 推送代码
for /f "tokens=*" %%b in ('git branch --show-current') do set "BRANCH=%%b"
git push origin "!BRANCH!"
if errorlevel 1 (
    echo   [ERROR] git push 失败，发布中止。
    echo   请检查: 1. git 已安装  2. 凭据可用（gh auth login 后运行 gh auth setup-git）
    node scripts\console-helper.js waitkey "[ERROR] git push 失败"
    endlocal
    exit /b 1
)
echo   [OK] 代码已推送

REM 创建 GitHub Release（附带安装包 + 更新包 + 校验文件）
set "RELEASE_CMD=gh release create %TAG% --repo %REPO% --title "%TAG%" --notes "!NOTES!""
for %%f in ("%DIST_DIR%\*.exe" "%DIST_DIR%\*.dmg" "%DIST_DIR%\*.AppImage" "%DIST_DIR%\*.zip" "%DIST_DIR%\*.sha256") do (
    if exist %%f set "RELEASE_CMD=!RELEASE_CMD! %%f"
)

!RELEASE_CMD!
if errorlevel 1 (
    echo   [ERROR] GitHub Release 创建失败（tag 已存在时需先删除或换版本号）
    node scripts\console-helper.js waitkey "[ERROR] Release 创建失败"
    endlocal
    exit /b 1
)

echo.
echo ========================================
echo   Release Complete!
echo   Version: %TAG%
echo   URL: https://github.com/%REPO%/releases/tag/%TAG%
echo ========================================
echo.
node scripts\console-helper.js waitkey "发布完成"
endlocal
exit /b 0
