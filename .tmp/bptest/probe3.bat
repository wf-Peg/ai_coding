@echo off
setlocal enabledelayedexpansion
for /f "usebackq tokens=*" %%v in (`node -p "require('./package.json').version"`) do set "CURRENT_VERSION=%%v"
echo CUR=[!CURRENT_VERSION!]
set /p BUMP=prompt: 
echo BUMP=[!BUMP!]
