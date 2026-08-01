@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM ============================================================
REM build-jlink.bat
REM 使用 JDK jlink 工具生成最小化 JRE，替代完整 JRE 下载
REM
REM 前置条件：
REM   1. JDK 17+ 已安装（需要 jlink 工具）
REM   2. 后端 JAR 已编译（先运行 npm run build:jar）
REM
REM 输出：
REM   jre\ 目录（electron-builder 打包时作为 extraResources）
REM
REM 对比：
REM   完整 JRE ≈ 316 MB  →  jlink 裁剪后 ≈ 50 MB
REM ============================================================

set "SCRIPT_DIR=%~dp0"
for %%P in ("%SCRIPT_DIR%..") do set "PROJECT_DIR=%%~fP"
set "JRE_DIR=%PROJECT_DIR%\jre"

echo.
echo ============================================
echo   JDK JRE Minimal Builder (jlink)
echo   从 316 MB 裁剪到约 50 MB
echo ============================================
echo.

REM ============================================================
REM 1. 查找 JDK（需要 jlink 工具）
REM ============================================================
echo [JLINK] 查找 JDK（需要 jlink 工具）...

set "JDK_DIR="

REM 1) JAVA_HOME
if defined JAVA_HOME (
    if exist "%JAVA_HOME%\bin\jlink.exe" (
        echo [JLINK] 发现 JAVA_HOME = %JAVA_HOME%
        set "JDK_DIR=%JAVA_HOME%"
    )
)

REM 2) 搜索常见安装路径
if not defined JDK_DIR (
    for %%D in (
        "K:\jdk\jdk-21.0.10"
        "C:\Program Files\Java\jdk-21"
        "C:\Program Files\Java\jdk-17"
        "C:\Program Files\Eclipse Adoptium\jdk-21"
        "C:\Program Files\Eclipse Adoptium\jdk-17"
        "%LOCALAPPDATA%\Programs\Eclipse Adoptium\jdk-21"
        "%LOCALAPPDATA%\Programs\Eclipse Adoptium\jdk-17"
        "%USERPROFILE%\.sdkman\candidates\java\current"
    ) do (
        if exist "%%~D\bin\jlink.exe" (
            echo [JLINK] 发现 JDK: %%~D
            set "JDK_DIR=%%~D"
            goto :jdk_found
        )
    )
)

REM 3) 检查 PATH 上的 java 所在目录
if not defined JDK_DIR (
    where java.exe >nul 2>&1
    if !ERRORLEVEL! EQU 0 (
        for /f "tokens=*" %%P in ('where java.exe') do (
            set "JAVA_EXE_PATH=%%P"
        )
        for %%D in ("!JAVA_EXE_PATH!\..\..") do (
            if exist "%%~D\bin\jlink.exe" (
                echo [JLINK] 发现 JDK（通过 PATH）: %%~D
                set "JDK_DIR=%%~D"
            )
        )
    )
)

:jdk_found
if not defined JDK_DIR (
    echo [ERROR] 未找到 JDK！jlink 需要 JDK 17+。
    echo.
    echo 请安装 JDK 17+ 并设置 JAVA_HOME 环境变量。
    echo 下载地址: https://adoptium.net/
    echo.
    pause
    exit /b 1
)

echo [JLINK] JDK 版本:
"%JDK_DIR%\bin\java.exe" -version 2>&1 | findstr "version"
echo.

set "JLINK=%JDK_DIR%\bin\jlink.exe"
set "JMODS=%JDK_DIR%\jmods"

if not exist "%JMODS%" (
    echo [ERROR] 未找到 jmods 目录：%JMODS%
    echo 请确保使用的是完整 JDK（不是 JRE）。
    pause
    exit /b 1
)

REM ============================================================
REM 2. 清理旧的 JRE 目录
REM ============================================================
if exist "%JRE_DIR%" (
    echo [JLINK] 删除旧的 JRE 目录...
    rmdir /s /q "%JRE_DIR%" 2>nul
)

REM ============================================================
REM 3. 定义所需 JDK 模块
REM ============================================================
echo [JLINK] 配置 JDK 模块列表（仅保留 Spring Boot 运行必需模块）...

REM Spring Boot Web + Spring AI + PDFBox + POI 等所需模块
REM 排除 java.desktop（~12MB）、jdk.compiler（~11MB）、jdk.javadoc 等非运行时模块
set "MODULES=java.base,java.logging,java.xml,java.sql,java.naming,java.management,java.instrument,jdk.unsupported,jdk.zipfs,jdk.charsets,jdk.crypto.ec,java.net.http,java.security.jgss,java.security.sasl,jdk.security.auth,jdk.naming.dns,jdk.management,jdk.management.agent,jdk.random,jdk.crypto.cryptoki,jdk.crypto.mscapi,java.prefs,java.compiler,java.scripting,jdk.localedata,java.rmi,jdk.naming.rmi,java.transaction.xa,jdk.jfr"

REM ============================================================
REM 4. 执行 jlink 生成最小化 JRE
REM ============================================================
echo [JLINK] 正在生成最小化 JRE...
echo [JLINK] 输出目录: %JRE_DIR%
echo [JLINK] 选项: --strip-debug --compress=2 --no-header-files --no-man-pages
echo.

"%JLINK%" ^
    --module-path "%JMODS%" ^
    --add-modules "%MODULES%" ^
    --output "%JRE_DIR%" ^
    --strip-debug ^
    --compress=2 ^
    --no-header-files ^
    --no-man-pages ^
    --vm=server

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] jlink 执行失败！请检查 JDK 版本和模块列表。
    pause
    exit /b 1
)

REM ============================================================
REM 5. 验证
REM ============================================================
echo.
echo [JLINK] 验证生成的 JRE...
if exist "%JRE_DIR%\bin\java.exe" (
    echo [JLINK] Java 运行时版本:
    "%JRE_DIR%\bin\java.exe" -version 2>&1 | findstr "version"
    echo.

    REM 计算大小（使用 dir 命令规避路径中的括号问题）
    for /f "tokens=3" %%S in ('dir /-c /s "%JRE_DIR%\*" 2^>nul ^| findstr /i "File(s)"') do set "JRE_SIZE=%%S"
    if not defined JRE_SIZE set "JRE_SIZE=0"
    set /a JRE_SIZE_MB=JRE_SIZE / 1048576

    echo [JLINK] JRE 生成成功！
    echo [JLINK] 裁剪后 JRE 大小: !JRE_SIZE_MB! MB
    echo [JLINK] 对比: 完整 JRE 约 316 MB
    echo [JLINK] 体积缩减: 约 80%%+
    echo.
    echo [JLINK] 提示: 如果运行时出现模块缺失错误，请手动添加模块到 MODULES 列表
    echo.
) else (
    echo [ERROR] JRE 验证失败！未找到 java.exe。
    pause
    exit /b 1
)

echo [JLINK] 完成！现在可以运行 npm run build:win 进行打包
echo.
endlocal