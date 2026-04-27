@echo off
setlocal

set PORT=3000
cd /d "%~dp0"

for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  echo Port %PORT% is already in use. Please stop that process first.
  exit /b 1
)

where python >nul 2>&1
if %errorlevel%==0 (
  set PYTHON_CMD=python
) else (
  where python3 >nul 2>&1
  if %errorlevel%==0 (
    set PYTHON_CMD=python3
  ) else (
    echo Python is not installed or not in PATH.
    exit /b 1
  )
)

echo Starting frontend on http://localhost:%PORT%
%PYTHON_CMD% -m http.server %PORT%

