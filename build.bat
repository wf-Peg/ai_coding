@echo off
REM ============================================
REM Clip Demo - Build Script (Windows)
REM Includes embedded JRE for portable deployment
REM ============================================

echo ========================================
echo   Clip Demo - Desktop App Builder
echo ========================================
echo.

REM ---------- Check Build Environment ----------
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
    pause
    exit /b 1
)

echo [OK] Build environment check passed
echo.

REM ---------- Step 1: Build Backend JAR ----------
echo [1/4] Building backend JAR...
cd /d "%~dp0backend"
call mvn clean package -DskipTests -q
if not exist "target\clip-demo-0.0.1-SNAPSHOT.jar" (
    echo [ERROR] JAR build failed
    cd /d "%~dp0"
    pause
    exit /b 1
)
echo [OK] Backend JAR built successfully
cd /d "%~dp0"

REM ---------- Step 2: Prepare JRE (jlink 裁剪最小化) ----------
echo.
echo [2/4] Generating minimal JRE via jlink...
echo        This reduces JRE from 316MB to ~50MB

REM 检查是否有 jlink 工具（需要 JDK 17+）
set "HAS_JLINK=0"
if defined JAVA_HOME if exist "%JAVA_HOME%\bin\jlink.exe" set "HAS_JLINK=1"
if defined JAVA_HOME goto :jlink_check_done
where jlink.exe >nul 2>&1
if errorlevel 1 goto :jlink_check_done
set "HAS_JLINK=1"
:jlink_check_done

if "%HAS_JLINK%"=="1" (
    echo        jlink tool found, generating minimal JRE...
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

REM ---------- Step 3: Install Electron Dependencies ----------
echo.
echo [3/4] Installing Electron dependencies...
if not exist "node_modules" (
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
) else (
    echo [OK] node_modules exists, skipping
)

REM ---------- Step 4: Package Desktop App ----------
echo.
echo [4/4] Packaging desktop app (Windows .exe)...
echo     This includes JRE (~150MB), please wait...
call npm run build:win
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Build failed, check error messages above
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Build Complete!
echo   Output: dist-electron\
echo ========================================
echo.
echo The app includes embedded JRE.
echo Users do NOT need to install Java.
echo Run Setup.exe in dist-electron\ to install.
echo.
pause
