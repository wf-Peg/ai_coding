@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion
cd /d "%~dp0"
for /f "usebackq tokens=*" %%v in (`node -p "require('./package.json').version"`) do set "CURRENT_VERSION=%%v"
if not defined CURRENT_VERSION set "CURRENT_VERSION=1.0.0"
echo   当前版本: !CURRENT_VERSION!
set "VERSION=!CURRENT_VERSION!"
set /p "BUMP=是否递增版本号并更新 package.json？(y/N): "
if /I "!BUMP!"=="y" (
    for /f "tokens=1,2,3 delims=." %%a in ("!CURRENT_VERSION!") do (
        set "MAJOR=%%a"
        set "MINOR=%%b"
        set /a "PATCH=%%c + 1" 2>nul
    )
    if not defined PATCH set "PATCH=1"
    set "SUGGEST_VERSION=!MAJOR!.!MINOR!.!PATCH!"
    set /p "VERSION=请输入新版本号（回车使用建议值 !SUGGEST_VERSION!）: "
    if "!VERSION!"=="" set "VERSION=!SUGGEST_VERSION!"
    node -e "const v=process.argv[1]; process.exit(/^\d+\.\d+\.\d+$/.test(v)?0:1)" "!VERSION!" >nul 2>&1
    if errorlevel 1 (
        echo   [ERROR] 版本号格式无效: !VERSION!
        endlocal
        exit /b 1
    )
    node -e "const pkg = require('./package.json'); pkg.version = '!VERSION!'; require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\r\n');"
    echo   [OK] 版本号已更新为 !VERSION!
) else (
    echo   沿用当前版本 !CURRENT_VERSION!
)
endlocal
