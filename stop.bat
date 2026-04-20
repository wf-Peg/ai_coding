@echo off
title Clip - Stop Services

echo ========================================
echo   Clip - Stopping Frontend & Backend
echo ========================================
echo.

echo [1/2] Stopping backend (port 8080)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8080 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
    echo       Killed PID %%a
)

echo [2/2] Stopping frontend (port 3000)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
    echo       Killed PID %%a
)

echo.
echo ========================================
echo   All services stopped!
echo ========================================
echo.
timeout /t 2 /nobreak >nul
