@echo off
chcp 65001 >nul 2>&1
REM ============================================================
REM release.bat
REM One-click release: version prompt -> build -> pack -> GitHub Release (Windows)
REM
REM Usage:
REM   scripts\release.bat [version] ["release notes"] [platform]
REM
REM Interactive (recommended):
REM   scripts\release.bat                          : 询问是否递增版本号并更新
REM   scripts\release.bat 1.0.1 "release notes"
REM   scripts\release.bat 1.0.1 "" win             : Windows only
REM
REM Prereq: JDK 21 + Maven + Node.js + GitHub CLI
REM ============================================================
setlocal enabledelayedexpansion
title Release Publisher

set "ARG_VERSION=%~1"
set "NOTES=%~2"
set "PLATFORM=%~3"

if "%NOTES%"=="" set "NOTES=Version update"
if "%PLATFORM%"=="" set "PLATFORM=all"

set "REPO=wf-Peg/ai_coding"
set "DIST_DIR=dist-electron"
set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%.."

REM ---- detect how we were launched ----
set "LAUNCHED_BY_DBLCLICK=0"
echo %CMDCMDLINE% | findstr /i /c:"%COMSPEC%" >nul
if %ERRORLEVEL% NEQ 0 set "LAUNCHED_BY_DBLCLICK=1"

cd /d "%PROJECT_DIR%"

echo.
echo ============================================
echo   Release Publisher
echo   Repo: %REPO%
echo ============================================
echo.

REM ============================================================
REM Step 1: Pre-check
REM ============================================================
echo [1/9] Pre-check

echo   Checking tools ...

where java >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [ERROR] Java not found. Please install JDK 21.
    goto :fail
)
for /f "tokens=*" %%V in ('java -version 2^>^&1 ^| findstr /i "version"') do echo   Java: %%V

where mvn >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [ERROR] Maven not found.
    goto :fail
)

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [ERROR] Node.js not found.
    goto :fail
)

where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [ERROR] npm not found.
    goto :fail
)

where gh >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [ERROR] GitHub CLI not found.
    echo   Run: winget install GitHub.cli
    echo   Then: gh auth login
    goto :fail
)

gh auth status >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [ERROR] GitHub CLI not authenticated. Run: gh auth login
    goto :fail
)

REM check git status
git status --porcelain 2>nul | findstr /r "." >nul
if %ERRORLEVEL% EQU 0 (
    echo   [WARNING] Uncommitted changes detected:
    git status --short
    set /p "CONTINUE=Continue? (y/N): "
    if /I not "!CONTINUE!"=="y" goto :fail
)

echo   [OK] Pre-check passed

REM ============================================================
REM Step 2: 版本号确认（询问是否递增版本号并更新）
REM ============================================================
echo [2/9] 版本号确认

if "%ARG_VERSION%"=="" (
    REM 交互提示由 node 实现（chcp 65001 下 bat 的 set /p 对管道/重定向 stdin 不可靠）
    node scripts\version-prompt.js
    if %ERRORLEVEL% NEQ 0 (
        echo   [ERROR] 版本号确认失败
        goto :fail
    )
    set "VERSION="
    if exist ".tmp\version-result.txt" set /p VERSION=<.tmp\version-result.txt
    del /f /q ".tmp\version-result.txt" 2>nul
    if "!VERSION!"=="" set "VERSION=1.0.0"
    echo   发布版本: %VERSION%
) else (
    set "VERSION=%ARG_VERSION%"
)

REM 用 node 校验版本号格式 x.y.z（命令行指定版本时兜底校验）
node -e "const v=process.argv[1]; process.exit(/^\d+\.\d+\.\d+$/.test(v)?0:1)" "%VERSION%" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [ERROR] 版本号格式无效: %VERSION%（应为 x.y.z，如 1.0.8）
    goto :fail
)

set "TAG=v%VERSION%"
echo   [OK] 发布版本: %TAG%  平台: %PLATFORM%

REM ============================================================
REM Step 3: 确保 package.json 版本号与发布版本一致（如不一致则更新）
REM ============================================================
for /f "usebackq tokens=*" %%v in (`node -p "require('./package.json').version"`) do set "PKG_VERSION=%%v"
if not defined PKG_VERSION set "PKG_VERSION=1.0.0"

if not "!PKG_VERSION!"=="!VERSION!" (
    echo [3/9] 更新版本号到 !VERSION! ...
    node -e "const pkg = require('./package.json'); pkg.version = '!VERSION!'; require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\r\n');"
    if %ERRORLEVEL% NEQ 0 (
        echo   [ERROR] Failed to update version
        goto :fail
    )
    git add package.json
    git commit -m "chore: bump version to !VERSION!" 2>nul
    if %ERRORLEVEL% NEQ 0 echo   [WARNING] Version may be unchanged
    echo   [OK] 版本号已更新为 !VERSION!
) else (
    echo [3/9] 版本号未变化（!VERSION!），跳过版本更新
    REM 检查 Release 是否已存在，避免覆盖已有发布
    gh release view "!TAG!" --repo %REPO% >nul 2>&1
    if !ERRORLEVEL! EQU 0 (
        set /p "CONTINUE=Release !TAG! 已存在，是否覆盖发布？(y/N): "
        if /I not "!CONTINUE!"=="y" goto :fail
    )
)

REM ============================================================
REM Step 4: JRE / JDK (jlink 裁剪 or 完整下载)
REM ============================================================
echo [4/9] JRE / JDK check ...

REM check if jre/ already exists
if exist "jre\bin\java.exe" (
    echo   [OK] jlink-minimal JRE found: jre\
    goto :step5
)
if exist "jre\win\bin\java.exe" (
    echo   [OK] Built-in JRE found: jre\win
    goto :step5
)
if exist "jre\mac\bin\java" (
    echo   [OK] Built-in JRE found: jre\mac
    goto :step5
)

REM try jlink 裁剪（需要 JDK 17+ 的 jlink 工具）
echo   Trying jlink minimal JRE ...
if defined JAVA_HOME (
    if exist "%JAVA_HOME%\bin\jlink.exe" (
        echo   jlink available, generating minimal JRE...
        call scripts\build-jlink.bat
        if exist "jre\bin\java.exe" (
            echo   [OK] jlink-minimal JRE generated
            goto :step5
        )
    )
)

REM fallback: check if system JDK is available
if defined JAVA_HOME (
    if exist "%JAVA_HOME%\bin\java.exe" (
        echo   [OK] Using JAVA_HOME: %JAVA_HOME%
        goto :step5
    )
)

where java.exe >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo   [OK] Using system Java
    goto :step5
)

REM no JDK/JRE found, try to download full JRE
echo   Downloading full JRE ...
call scripts\download-jre.bat all
if %ERRORLEVEL% NEQ 0 (
    echo   [WARNING] JRE download failed. Build will use system JDK.
    echo   [WARNING] Run manually: scripts\build-jlink.bat or scripts\download-jre.bat all
)

:step5

REM ============================================================
REM Step 5: Build backend JAR
REM ============================================================
echo [5/9] Build backend JAR ...

cd backend
call mvn clean package -DskipTests -q 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   [ERROR] Maven build failed
    cd ..
    goto :fail
)
cd ..

if exist "backend\target\clip-demo-0.0.1-SNAPSHOT.jar" (
    for %%f in (backend\target\clip-demo-0.0.1-SNAPSHOT.jar) do set "JAR_SIZE=%%~zf"
    set /a "JAR_SIZE_MB=!JAR_SIZE! / 1048576"
    echo   [OK] Backend JAR built ^(!JAR_SIZE_MB! MB^)
) else (
    echo   [ERROR] Backend JAR not found
    goto :fail
)

REM ============================================================
REM Step 6: Build desktop client
REM ============================================================
echo [6/9] Build desktop client ...

if /I "%PLATFORM%"=="win" (
    echo   Building Windows ...
    call npm run build:win
) else if /I "%PLATFORM%"=="mac" (
    echo   Building macOS ...
    call npm run build:mac
) else if /I "%PLATFORM%"=="linux" (
    echo   Building Linux ...
    call npm run build:linux
) else if /I "%PLATFORM%"=="all" (
    echo   Building Windows ...
    call npm run build:win
    if %ERRORLEVEL% NEQ 0 goto :fail
    echo   Building macOS ...
    call npm run build:mac
    if %ERRORLEVEL% NEQ 0 (
        echo   [WARNING] macOS build failed (may need macOS host)
    )
    echo   Building Linux ...
    call npm run build:linux
    if %ERRORLEVEL% NEQ 0 (
        echo   [WARNING] Linux build failed (may need Linux host)
    )
)

if %ERRORLEVEL% NEQ 0 (
    echo   [ERROR] Build failed
    goto :fail
)

echo   [OK] Build artifacts:
dir /b "%DIST_DIR%\*.exe" "%DIST_DIR%\*.dmg" "%DIST_DIR%\*.AppImage" "%DIST_DIR%\*.zip" 2>nul

REM ============================================================
REM Step 7: Create update zip（统一走 scripts/build-update-zip.js）
REM ============================================================
echo [7/9] Create update package ...

node scripts\build-update-zip.js
if %ERRORLEVEL% NEQ 0 (
    echo   [WARNING] build-update-zip.js failed, update package may be missing
) else (
    set "UPDATE_ZIP=%DIST_DIR%\clip-update-%VERSION%.zip"
    if exist "%UPDATE_ZIP%" (
        for %%f in ("%UPDATE_ZIP%") do set "UPDATE_SIZE=%%~zf"
        set /a "UPDATE_SIZE_MB=!UPDATE_SIZE! / 1048576"
        echo   [OK] Update package: %UPDATE_ZIP% ^(!UPDATE_SIZE_MB! MB^)
    )
)

REM ============================================================
REM Step 8: Verify
REM ============================================================
echo [8/9] Verify artifacts ...

set "HAS_ARTIFACTS=0"
for %%f in ("%DIST_DIR%\*.exe" "%DIST_DIR%\*.dmg" "%DIST_DIR%\*.AppImage" "%DIST_DIR%\*.zip" "%DIST_DIR%\*.sha256") do (
    if exist %%f (
        set "HAS_ARTIFACTS=1"
        echo   [OK] %%~nxf
    )
)

if "!HAS_ARTIFACTS!"=="0" (
    echo   [ERROR] No artifacts found!
    goto :fail
)

REM ============================================================
REM Step 9: Push + Release
REM ============================================================
echo [9/9] Push code + Create Release ...

for /f "tokens=*" %%b in ('git branch --show-current') do set "BRANCH=%%b"

git push origin "!BRANCH!"
if %ERRORLEVEL% NEQ 0 (
    echo   [ERROR] Push failed
    goto :fail
)
echo   [OK] Code pushed

echo   Creating GitHub Release ...

set "RELEASE_CMD=gh release create %TAG% --repo %REPO% --title "%TAG%" --notes "%NOTES%""

for %%f in ("%DIST_DIR%\*.exe" "%DIST_DIR%\*.dmg" "%DIST_DIR%\*.AppImage" "%DIST_DIR%\*.zip" "%DIST_DIR%\*.sha256") do (
    if exist %%f set "RELEASE_CMD=!RELEASE_CMD! %%f"
)

!RELEASE_CMD!
if %ERRORLEVEL% NEQ 0 (
    echo   [ERROR] Release creation failed
    goto :fail
)

echo.
echo ============================================
echo   Release Complete!
echo   Version: %TAG%
echo   URL: https://github.com/%REPO%/releases/tag/%TAG%
echo ============================================
echo.
echo Artifacts:
dir /b "%DIST_DIR%\*.exe" "%DIST_DIR%\*.dmg" "%DIST_DIR%\*.AppImage" "%DIST_DIR%\*.zip" 2>nul
if exist "%DIST_DIR%\clip-update-%VERSION%.zip" echo clip-update-%VERSION%.zip (update package)
if exist "%DIST_DIR%\clip-update-%VERSION%.zip.sha256" echo clip-update-%VERSION%.zip.sha256 (checksum)
echo.

:end
if "%LAUNCHED_BY_DBLCLICK%"=="1" (
    echo Press any key to exit ...
    pause >nul
)
endlocal
exit /b 0

:fail
echo.
echo ============================================
echo   Release FAILED. Check errors above.
echo ============================================
if "%LAUNCHED_BY_DBLCLICK%"=="1" (
    echo.
    echo Press any key to exit ...
    pause >nul
)
endlocal
exit /b 1

:usage
echo.
echo Release Publisher
echo.
echo Usage:
echo   scripts\release.bat [version] ["release notes"] [platform]
echo.
echo Examples:
echo   scripts\release.bat                       : 询问是否递增版本号并更新
echo   scripts\release.bat 1.0.1 "New feature" all
echo   scripts\release.bat 1.0.1 "" win
echo.
echo Platforms: win, mac, linux, all (default)
echo.
pause
exit /b 0
