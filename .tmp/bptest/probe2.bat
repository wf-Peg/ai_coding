@echo off
set /p BUMP=prompt: 
echo BUMP=[%BUMP%]
if /I "%BUMP%"=="y" (echo YES) else (echo NO)
