@echo off
REM ============================================
REM Download JRE for bundling (Windows x64)
REM Using Eclipse Temurin (Adoptium) - reliable direct download
REM ============================================

set "JRE_BUILD=21.0.3"
set "JRE_PATCH=9"
set "JRE_DIR=jre"

REM Eclipse Temurin JRE direct download URL (only ~50MB)
set "JRE_URL=https://github.com/adoptium/temurin21-binaries/releases/download/jdk-%JRE_BUILD%+%JRE_PATCH%/OpenJDK21U-jre_x64_windows_hotspot_%JRE_BUILD%_%JRE_PATCH%.zip"
set "JRE_ZIP=%TEMP%\jre-download.zip"

echo [1/2] Downloading JRE %JRE_BUILD% ...
echo       URL: %JRE_URL%
echo       This may take a few minutes (~50MB)...

REM Use PowerShell with TLS 1.2 and redirect handling
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%JRE_URL%' -OutFile '%JRE_ZIP%' -UseBasicParsing -MaximumRedirection 10"

if not exist "%JRE_ZIP%" (
    echo [ERROR] Failed to download JRE
    echo.
    echo Please download manually from:
    echo   https://adoptium.net/temurin/releases/?os=windows^&arch=x64^&version=21
    echo Choose JRE (not JDK), extract and rename folder to: %JRE_DIR%
    pause
    exit /b 1
)

echo [2/2] Extracting JRE ...
if exist "%JRE_DIR%" rmdir /s /q "%JRE_DIR%"

REM Use PowerShell to extract
powershell -Command "Expand-Archive -Path '%JRE_ZIP%' -DestinationPath '.' -Force"

REM Find and rename the extracted jdk folder to "jre"
REM Temurin extracts as: jdk-21.0.3+9-jre
for /d %%i in (jdk-*-jre) do (
    if not exist "%JRE_DIR%" (
        ren "%%i" "%JRE_DIR%"
    )
)

del "%JRE_ZIP%" 2>nul

if exist "%JRE_DIR%\bin\java.exe" (
    echo [OK] JRE ready: %JRE_DIR%\bin\java.exe
    for /f "tokens=3" %%v in ('%JRE_DIR%\bin\java.exe -version 2^>^&1 ^| findstr /i "version"') do (
        echo       Java version: %%~v
    )
) else (
    echo [ERROR] JRE extraction failed
    echo         Contents of current directory:
    dir /b /ad
    echo.
    echo Please manually download JRE from:
    echo   https://adoptium.net/temurin/releases/?os=windows^&arch=x64^&version=21
    echo Extract the jdk-*-jre folder and rename to: %JRE_DIR%
    pause
    exit /b 1
)
