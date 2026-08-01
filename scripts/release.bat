@echo off
chcp 65001 >nul 2>&1
REM ============================================================
REM release.bat
REM One-click release: build -> pack -> GitHub Release (Windows)
REM
REM Usage:
REM   scripts\release.bat 1.0.1 "release notes"
REM   scripts\release.bat 1.0.1                      : default notes
REM   scripts\release.bat 1.0.1 "" win               : Windows only
REM   scripts\release.bat 1.0.1 "" all               : all platforms
REM
REM Prereq: JDK 21 + Maven + Node.js + GitHub CLI
REM ============================================================
setlocal enabledelayedexpansion
title Release Publisher

set "VERSION=%~1"
set "NOTES=%~2"
set "PLATFORM=%~3"

if "%VERSION%"=="" goto :usage

if "%NOTES%"=="" set "NOTES=Version update"
if "%PLATFORM%"=="" set "PLATFORM=all"

set "TAG=v%VERSION%"
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
echo   Release: %TAG%
echo   Platform: %PLATFORM%
echo   Repo: %REPO%
echo ============================================
echo.

REM ============================================================
REM Step 1: Pre-check
REM ============================================================
echo [1/8] Pre-check

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
REM Step 2: Bump version
REM ============================================================
echo [2/8] Bump version to %VERSION% ...

node -e "const pkg = require('./package.json'); pkg.version = '%VERSION%'; require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\r\n');"
if %ERRORLEVEL% NEQ 0 (
    echo   [ERROR] Failed to update version
    goto :fail
)

git add package.json
git commit -m "chore: bump version to %VERSION%" 2>nul
if %ERRORLEVEL% NEQ 0 echo   [WARNING] Version may be unchanged

echo   [OK] Version updated

REM ============================================================
REM Step 3: JRE / JDK (jlink 裁剪 or 完整下载)
REM ============================================================
echo [3/8] JRE / JDK check ...

REM check if jre/ already exists
if exist "jre\bin\java.exe" (
    echo   [OK] jlink-minimal JRE found: jre\
    goto :step4
)
if exist "jre\win\bin\java.exe" (
    echo   [OK] Built-in JRE found: jre\win
    goto :step4
)
if exist "jre\mac\bin\java" (
    echo   [OK] Built-in JRE found: jre\mac
    goto :step4
)

REM try jlink 裁剪（需要 JDK 17+ 的 jlink 工具）
echo   Trying jlink minimal JRE ...
if defined JAVA_HOME (
    if exist "%JAVA_HOME%\bin\jlink.exe" (
        echo   jlink available, generating minimal JRE...
        call scripts\build-jlink.bat
        if exist "jre\bin\java.exe" (
            echo   [OK] jlink-minimal JRE generated
            goto :step4
        )
    )
)

REM fallback: check if system JDK is available
if defined JAVA_HOME (
    if exist "%JAVA_HOME%\bin\java.exe" (
        echo   [OK] Using JAVA_HOME: %JAVA_HOME%
        goto :step4
    )
)

where java.exe >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo   [OK] Using system Java
    goto :step4
)

REM no JDK/JRE found, try to download full JRE
echo   Downloading full JRE ...
call scripts\download-jre.bat all
if %ERRORLEVEL% NEQ 0 (
    echo   [WARNING] JRE download failed. Build will use system JDK.
    echo   [WARNING] Run manually: scripts\build-jlink.bat or scripts\download-jre.bat all
)

:step4

REM ============================================================
REM Step 4: Build backend JAR
REM ============================================================
echo [4/8] Build backend JAR ...

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
REM Step 5: Build desktop client
REM ============================================================
echo [5/8] Build desktop client ...

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
REM Step 6: Create update zip
REM ============================================================
echo [6/8] Create update package ...

set "UPDATE_ZIP=clip-update-%VERSION%.zip"
if exist "%DIST_DIR%\win-unpacked\resources" (
    if exist "%UPDATE_ZIP%" del /f "%UPDATE_ZIP%"
    powershell -NoProfile -Command ^
        "Compress-Archive -Path '%DIST_DIR%\win-unpacked\resources\*' -DestinationPath '%UPDATE_ZIP%' -Force"
    if exist "%UPDATE_ZIP%" (
        for %%f in ("%UPDATE_ZIP%") do set "UPDATE_SIZE=%%~zf"
        set /a "UPDATE_SIZE_MB=!UPDATE_SIZE! / 1048576"
        echo   [OK] Update package: %UPDATE_ZIP% ^(!UPDATE_SIZE_MB! MB^)
    )
) else (
    echo   [WARNING] win-unpacked not found, skipping update package
)

REM ============================================================
REM Step 7: Verify
REM ============================================================
echo [7/8] Verify artifacts ...

set "HAS_ARTIFACTS=0"
for %%f in ("%DIST_DIR%\*.exe" "%DIST_DIR%\*.dmg" "%DIST_DIR%\*.AppImage" "%DIST_DIR%\*.zip" "%UPDATE_ZIP%") do (
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
REM Step 8: Push + Release
REM ============================================================
echo [8/8] Push code + Create Release ...

for /f "tokens=*" %%b in ('git branch --show-current') do set "BRANCH=%%b"

git push origin "!BRANCH!"
if %ERRORLEVEL% NEQ 0 (
    echo   [ERROR] Push failed
    goto :fail
)
echo   [OK] Code pushed

echo   Creating GitHub Release ...

set "RELEASE_CMD=gh release create %TAG% --repo %REPO% --title "%TAG%" --notes "%NOTES%""

for %%f in ("%DIST_DIR%\*.exe" "%DIST_DIR%\*.dmg" "%DIST_DIR%\*.AppImage" "%DIST_DIR%\*.zip") do (
    if exist %%f set "RELEASE_CMD=!RELEASE_CMD! %%f"
)
if exist "%UPDATE_ZIP%" set "RELEASE_CMD=!RELEASE_CMD! %UPDATE_ZIP%"

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
if exist "%UPDATE_ZIP%" echo %UPDATE_ZIP% (update package)
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
echo   scripts\release.bat ^<version^> ["release notes"] [platform]
echo.
echo Examples:
echo   scripts\release.bat 1.0.1 "New feature" all
echo   scripts\release.bat 1.0.1 "" win
echo.
echo Platforms: win, mac, linux, all (default)
echo.
pause
exit /b 0