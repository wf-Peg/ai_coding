@echo off
title CutShelter - Start Services
echo ========================================
echo   CutShelter - Starting Frontend & Backend
echo ========================================
echo.
echo   Note: 建议使用 'npm start' 启动（Electron 桌面模式）
echo         此脚本仅启动后端 + 前端服务，用于调试
echo.
echo   JRE: 优先使用 jre/bin/java.exe（jlink 裁剪版 ~50MB）
echo        找不到时回退到系统 JAVA_HOME 或 PATH
echo.

:: Check Java
where java >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Java not found. Please install JDK first.
    pause
    exit /b 1
)

:: Check if backend is already running
curl -s http://127.0.0.1:8081/api/clip/list >nul 2>&1
if %errorlevel% equ 0 (
    echo [INFO] Backend already running on port 8081
    goto :start_frontend
)

:: Start backend
echo [1/2] Starting backend...
cd /d "%~dp0backend"

if not exist "target\clip-demo-0.0.1-SNAPSHOT.jar" (
    echo [ERROR] JAR not found. Run: mvn clean package -DskipTests
    pause
    exit /b 1
)

start "Clip-Backend" /min cmd /c "java -jar target\clip-demo-0.0.1-SNAPSHOT.jar 2>&1 > ..\backend.log"

echo       Waiting for backend...
set retries=0
:wait_backend
curl -s http://127.0.0.1:8081/api/clip/list >nul 2>&1
if %errorlevel% equ 0 (
    echo       Backend started!
    goto :start_frontend
)
set /a retries+=1
if %retries% geq 30 (
    echo [ERROR] Backend startup timeout. Check backend.log
    pause
    exit /b 1
)
timeout /t 2 /nobreak >nul
goto :wait_backend

:start_frontend
curl -s http://127.0.0.1:3001 >nul 2>&1
if %errorlevel% equ 0 (
    echo [INFO] Frontend already running on port 3001
    goto :done
)

echo [2/2] Starting frontend...
cd /d "%~dp0"
start "Clip-Frontend" /min cmd /c "cd frontend && node server.js"
timeout /t 3 /nobreak >nul
echo       Frontend started!

:done
echo.
echo ========================================
echo   All services started!
echo   Frontend: http://127.0.0.1:3001
echo   Backend:  http://127.0.0.1:8081
echo ========================================
echo.
echo Press any key to open browser...
pause >nul
start http://127.0.0.1:3001
