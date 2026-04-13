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

REM ---------- Step 2: Prepare JRE ----------
echo.
echo [2/4] Checking embedded JRE...
if exist "jre\bin\java.exe" (
    echo [OK] Found jre\bin\java.exe, using local JRE
) else if exist "jdk\bin\java.exe" (
    echo [OK] Found jdk\bin\java.exe, creating symlink as jre...
    mklink /D jre jdk >nul 2>nul || xcopy /E /I /Q jdk jre\ >nul
    if not exist "jre\bin\java.exe" (
        echo [ERROR] Failed to create jre from jdk folder
        pause
        exit /b 1
    )
) else (
    echo [INFO] No local JRE/JDK found in project directory.
    echo        Place your JDK folder here and rename to "jre" or "jdk".
    echo        Or the script will try to download one automatically.
    echo.
    call prepare-jre.bat
    if not exist "jre\bin\java.exe" (
        echo [ERROR] JRE preparation failed
        pause
        exit /b 1
    )
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
