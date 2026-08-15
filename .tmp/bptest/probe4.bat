@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion
cd /d "%~dp0"
for /f "usebackq tokens=*" %%v in (`node -p "require('./package.json').version"`) do set "CURRENT_VERSION=%%v"
if not defined CURRENT_VERSION set "CURRENT_VERSION=1.0.0"
echo   当前版本: !CURRENT_VERSION!
set "VERSION=!CURRENT_VERSION!"
set /p "BUMP=是否递增版本号并更新 package.json？(y/N): "
echo   BUMP=[!BUMP!]
