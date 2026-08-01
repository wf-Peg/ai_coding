@echo off
setlocal

set PORT=3001
cd /d "%~dp0"

for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  echo Port %PORT% is already in use. Please stop that process first.
  exit /b 1
)

where node >nul 2>&1
if %errorlevel%==0 (
  echo Starting frontend on http://localhost:%PORT% (Node SPA)
  node server.js
  exit /b 0
)

where python >nul 2>&1
if %errorlevel%==0 (
  set PYTHON_CMD=python
) else (
  where python3 >nul 2>&1
  if %errorlevel%==0 (
    set PYTHON_CMD=python3
  ) else (
    echo Neither node nor Python found. Install Node.js or Python.
    exit /b 1
  )
)

echo Starting frontend on http://localhost:%PORT% (Python SPA)
%PYTHON_CMD% -c "import http.server,os;class S(http.server.SimpleHTTPRequestHandler):def do_GET(s):p=s.translate_path(s.path);s.path='/index.html' if not os.path.exists(p) or os.path.isdir(p) else s.path;return super().do_GET();http.server.HTTPServer(('0.0.0.0',%PORT%),S).serve_forever()"