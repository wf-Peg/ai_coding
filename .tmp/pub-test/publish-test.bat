@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion
set "VERSION=1.0.7"
echo [TEST] simulating publish section ...
echo.
REM ---------- 可选：推送到 GitHub Release ----------
set /p "PUBLISH=是否推送到 GitHub Release（含更新包 clip-update-!VERSION!.zip）？(y/N): "
if /I not "!PUBLISH!"=="y" (
    echo   已跳过发布。
    echo   如需一键发布（含版本号提示），也可运行: scripts\release.bat
    pause
    endlocal
    exit /b 0
)

echo.
echo   正在准备发布 v!VERSION! ...
echo   [STUB] where gh (假装已安装)
echo   [STUB] gh auth status (假装已登录)
echo   [STUB] git add/commit
set "TAG=v!VERSION!"
set "REPO=wf-Peg/ai_coding"
set "DIST_DIR=dist-electron"
set "NOTES=版本更新"
set /p "NOTES_INPUT=请输入 Release 说明（回车默认「版本更新」）: "
if not "!NOTES_INPUT!"=="" set "NOTES=!NOTES_INPUT!"
echo   [STUB] git push origin main (失败)
set /p "JUNK=按任意键继续测试错误分支... "
echo   [ERROR] git push 失败，发布中止
pause
endlocal
exit /b 1
