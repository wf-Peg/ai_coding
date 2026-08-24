@echo off
chcp 65001 >nul 2>&1
REM ============================================================
REM download-jre.bat
REM JDK 21 JRE (portable)
REM
REM Usage:
REM   scripts\download-jre.bat              : current platform
REM   scripts\download-jre.bat all           : all platforms
REM   scripts\download-jre.bat win mac mac-arm
REM
REM Prereq: PowerShell 5.0+
REM Source: Eclipse Adoptium Temurin 21
REM Output: jre\ (extraResources for electron-builder)
REM ============================================================
setlocal enabledelayedexpansion
title JDK 21 JRE Downloader

set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%.."
set "JRE_DIR=%PROJECT_DIR%\jre"
set "API_BASE=https://api.adoptium.net/v3/binary/latest/21/ga"

REM ---- detect how we were launched ----
set "LAUNCHED_BY_DBLCLICK=0"
echo %CMDCMDLINE% | findstr /i /c:"%COMSPEC%" >nul
if %ERRORLEVEL% NEQ 0 set "LAUNCHED_BY_DBLCLICK=1"
if /i "%~1"=="/?" goto :usage
if /i "%~1"=="-h" goto :usage
if /i "%~1"=="--help" goto :usage

if "%1"=="" (
    set "MODE=auto"
) else if /I "%1"=="all" (
    set "MODE=all"
) else (
    set "MODE=manual"
)

echo.
echo ============================================
echo   JDK 21 JRE Downloader (Windows)
echo   Source: Eclipse Adoptium Temurin 21
echo ============================================
echo.

REM ============================================================
REM Check local JDK / JRE
REM ============================================================
:check_local
echo [JRE] Checking local JDK/JRE ...

REM 1) Check JAVA_HOME
if defined JAVA_HOME (
    if exist "%JAVA_HOME%\bin\java.exe" (
        echo [JRE] Found JAVA_HOME = %JAVA_HOME%
        for /f "tokens=*" %%V in ('"%JAVA_HOME%\bin\java.exe" -version 2^>^&1 ^| findstr /i "version"') do echo [JRE] %%V
        set "LOCAL_JDK=%JAVA_HOME%"
        goto :found_local
    )
)

REM 2) Check java on PATH
where java.exe >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    for /f "tokens=*" %%P in ('where java.exe 2^>nul') do set "JAVA_PATH=%%P"
    echo [JRE] Found on PATH: !JAVA_PATH!
    for /f "tokens=*" %%V in ('java -version 2^>^&1 ^| findstr /i "version"') do echo [JRE] %%V
    for /f "tokens=*" %%P in ('where java.exe 2^>nul') do (
        set "JAVA_EXE=%%P"
        for %%D in ("!JAVA_EXE!\..") do set "LOCAL_JDK=%%~fD"
    )
    goto :found_local
)

REM 3) Check common install paths
for %%D in (
    "C:\Program Files\Java\jdk-21"
    "C:\Program Files\Java\jdk-21.0"
    "C:\Program Files\Eclipse Adoptium\jdk-21"
    "C:\Program Files\Eclipse Adoptium\jre-21"
    "%LOCALAPPDATA%\Programs\Eclipse Adoptium\jdk-21"
    "%USERPROFILE%\.sdkman\candidates\java\21"
) do (
    if exist "%%~D\bin\java.exe" (
        echo [JRE] Found: %%~D
        for /f "tokens=*" %%V in ('"%%~D\bin\java.exe" -version 2^>^&1 ^| findstr /i "version"') do echo [JRE] %%V
        set "LOCAL_JDK=%%~D"
        goto :found_local
    )
)

REM 4) Check project jre/ directory
if exist "%JRE_DIR%\win\bin\java.exe" (
    echo [JRE] Found built-in JRE: %JRE_DIR%\win
    set "LOCAL_JDK=%JRE_DIR%\win"
    goto :found_local
)
if exist "%JRE_DIR%\mac\bin\java" (
    echo [JRE] Found built-in JRE: %JRE_DIR%\mac
)
if exist "%JRE_DIR%\mac-arm\bin\java" (
    echo [JRE] Found built-in JRE: %JRE_DIR%\mac-arm
)

echo [JRE] No local JDK 21 found, will download JRE
goto :do_download

:found_local
echo.
echo [JRE] Local JDK/JRE found. No download needed.
echo [JRE] Path: !LOCAL_JDK!
echo [JRE] electron-builder will bundle this JDK if jre\ dir is empty.
echo.
echo To force re-download, delete the jre\ directory first.
echo.
goto :end

REM ============================================================
REM Download
REM ============================================================
:do_download

REM download a single platform
:download_one
set "PLATFORM=%~1"
set "OS="
set "ARCH="
set "EXT="

if /I "%PLATFORM%"=="win"       (set "OS=windows" & set "ARCH=x64" & set "EXT=zip")
if /I "%PLATFORM%"=="windows"   (set "OS=windows" & set "ARCH=x64" & set "EXT=zip")
if /I "%PLATFORM%"=="mac"       (set "OS=mac" & set "ARCH=x64" & set "EXT=tar.gz")
if /I "%PLATFORM%"=="mac-x64"   (set "OS=mac" & set "ARCH=x64" & set "EXT=tar.gz")
if /I "%PLATFORM%"=="mac-arm"   (set "OS=mac" & set "ARCH=aarch64" & set "EXT=tar.gz")
if /I "%PLATFORM%"=="mac-arm64" (set "OS=mac" & set "ARCH=aarch64" & set "EXT=tar.gz")
if /I "%PLATFORM%"=="linux"     (set "OS=linux" & set "ARCH=x64" & set "EXT=tar.gz")

if "%OS%"=="" (
    echo [ERROR] Unknown platform: %PLATFORM%
    echo Supported: win, mac, mac-arm, linux, all
    exit /b 1
)

REM 统一按打包目标归档：win -> jre\win, mac(含 mac-arm) -> jre\mac, linux -> jre\linux
set "OUT_DIR=%JRE_DIR%\win"
if /I "%OS%"=="mac" set "OUT_DIR=%JRE_DIR%\mac"
if /I "%OS%"=="linux" set "OUT_DIR=%JRE_DIR%\linux"

REM skip if already downloaded
if exist "%OUT_DIR%\bin\java.exe" (
    echo [JRE] Already exists: %OUT_DIR%
    exit /b 0
)
if exist "%OUT_DIR%\bin\java" (
    echo [JRE] Already exists: %OUT_DIR%
    exit /b 0
)

if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

set "URL=%API_BASE%/!OS!/!ARCH!/jre/hotspot/normal/eclipse?project=jdk"

echo [JRE] Downloading !PLATFORM! JRE 21 ...
echo [JRE] URL: !URL!

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$url = '%URL%';" ^
    "$outDir = '%OUT_DIR%';" ^
    "$tmpFile = Join-Path $env:TEMP ('jre-dl-' + [guid]::NewGuid().ToString().Substring(0,8));" ^
    "Write-Host '[JRE] Downloading...';" ^
    "try {" ^
    "  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;" ^
    "  $wc = New-Object System.Net.WebClient;" ^
    "  $wc.Headers.Add('User-Agent', 'JRE-Downloader/1.0');" ^
    "  $wc.DownloadFile($url, $tmpFile);" ^
    "  $size = [math]::Round((Get-Item $tmpFile).Length / 1MB, 1);" ^
    "  Write-Host \"[JRE] Downloaded: $size MB\";" ^
    "  Write-Host '[JRE] Extracting...';" ^
    "  if ($url -match 'zip') {" ^
    "    Expand-Archive -Path $tmpFile -DestinationPath $outDir -Force;" ^
    "  } else {" ^
    "    $tmpGz = $tmpFile + '.tgz';" ^
    "    Rename-Item $tmpFile $tmpGz -Force;" ^
    "    $tarExe = Get-Command tar -ErrorAction SilentlyContinue;" ^
    "    if ($tarExe) {" ^
    "      & tar -xzf $tmpGz -C $outDir;" ^
    "    } else {" ^
    "      Write-Host '[JRE] WARNING: tar not found, please extract manually';" ^
    "      Write-Host '[JRE] File: ' + $tmpGz;" ^
    "    }" ^
    "    Remove-Item $tmpGz -Force -ErrorAction SilentlyContinue;" ^
    "  }" ^
    "  # flatten directory" ^
    "  $subDirs = Get-ChildItem $outDir -Directory | Where-Object { $_.Name -like 'jdk*' -or $_.Name -like 'jre*' };" ^
    "  if ($subDirs) {" ^
    "    foreach ($sub in $subDirs) {" ^
    "      Get-ChildItem $sub.FullName | Move-Item -Destination $outDir -Force;" ^
    "      Remove-Item $sub.FullName -Recurse -Force -ErrorAction SilentlyContinue;" ^
    "    }" ^
    "  }" ^
    "  # strip dev-only / redundant jmods + man (packaging filter already excludes them)" ^
    "  Remove-Item (Join-Path $outDir 'jmods') -Recurse -Force -ErrorAction SilentlyContinue;" ^
    "  Remove-Item (Join-Path $outDir 'man') -Recurse -Force -ErrorAction SilentlyContinue;" ^
    "  Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue;" ^
    "  Write-Host \"[JRE] !PLATFORM! JRE ready: $outDir\";" ^
    "  $javaExe = Get-ChildItem $outDir -Recurse -Filter 'java.exe' -ErrorAction SilentlyContinue | Select-Object -First 1;" ^
    "  if ($javaExe) { Write-Host \"[JRE] Verified: $($javaExe.FullName)\" }" ^
    "  else {" ^
    "    $javaBin = Get-ChildItem $outDir -Recurse -Filter 'java' -ErrorAction SilentlyContinue | Select-Object -First 1;" ^
    "    if ($javaBin) { Write-Host \"[JRE] Verified: $($javaBin.FullName)\" }" ^
    "  }" ^
    "} catch {" ^
    "  Write-Host \"[JRE] ERROR: $_\";" ^
    "  Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue;" ^
    "  exit 1;" ^
    "}"

if %ERRORLEVEL% NEQ 0 (
    echo [JRE] Download failed: !PLATFORM!
    exit /b 1
)
exit /b 0

REM ============================================================
REM Main
REM ============================================================
if /I "%MODE%"=="all" (
    echo [JRE] Downloading all platforms ...
    call :download_one win   || exit /b 1
    call :download_one mac   || exit /b 1
    call :download_one mac-arm || exit /b 1
    echo [JRE] All platforms done
    goto :verify
)

if /I "%MODE%"=="auto" (
    echo [JRE] Auto-detecting platform ...
    call :download_one win
    if !ERRORLEVEL! NEQ 0 exit /b 1
    goto :verify
)

REM manual mode: download each specified platform
:download_loop
if "%1"=="" goto :verify
call :download_one %1
if %ERRORLEVEL% NEQ 0 exit /b 1
shift
goto :download_loop

REM ============================================================
REM Verify
REM ============================================================
:verify
echo.
echo [JRE] JRE directory structure:
if exist "%JRE_DIR%" (
    dir /s /b "%JRE_DIR%\java.exe" 2>nul
    dir /s /b "%JRE_DIR%\java" 2>nul
)
echo.
echo [JRE] Done. Now you can run:
echo   npm run build:win
echo   npm run build:portable:win
echo   npm run release 1.0.1 "" win
echo.

:end
if "%LAUNCHED_BY_DBLCLICK%"=="1" (
    echo.
    echo Press any key to exit ...
    pause >nul
)
endlocal
exit /b 0

:usage
echo.
echo JDK 21 JRE Downloader
echo.
echo Usage:
echo   scripts\download-jre.bat              : current platform
echo   scripts\download-jre.bat all           : all platforms
echo   scripts\download-jre.bat win mac mac-arm
echo.
echo The script checks local JDK/JRE first:
echo   1. JAVA_HOME environment variable
echo   2. java on PATH
echo   3. Common install directories
echo   4. Existing jre\ directory
echo.
echo If a local JDK 21 is found, no download is needed.
echo.
pause
exit /b 0