#!/bin/bash
# ============================================================
# build-jlink.sh
# 使用 JDK jlink 工具生成最小化 JRE，替代完整 JRE 下载
#
# 前置条件：
#   1. JDK 17+ 已安装（需要 jlink 工具）
#   2. 后端 JAR 已编译（先运行 npm run build:jar）
#
# 输出：
#   jre/ 目录（electron-builder 打包时作为 extraResources）
#
# 对比：
#   完整 JRE ≈ 316 MB  →  jlink 裁剪后 ≈ 35~45 MB
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
JRE_DIR="$PROJECT_DIR/jre"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[JLINK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[JLINK]${NC} $1"; }
log_error() { echo -e "${RED}[JLINK]${NC} $1"; }

echo ""
echo "============================================"
echo "  JDK JRE Minimal Builder (jlink)"
echo "  从 316 MB 裁剪到约 40 MB"
echo "============================================"
echo ""

# ============================================================
# 1. 查找 JDK（需要 jlink 工具）
# ============================================================
log_info "查找 JDK（需要 jlink 工具）..."

JDK_DIR=""

# 1) JAVA_HOME
if [ -n "$JAVA_HOME" ] && [ -x "$JAVA_HOME/bin/jlink" ]; then
  log_info "发现 JAVA_HOME = $JAVA_HOME"
  JDK_DIR="$JAVA_HOME"
fi

# 2) 常见安装路径
if [ -z "$JDK_DIR" ]; then
  for dir in \
    "/usr/lib/jvm/java-21-openjdk" \
    "/usr/lib/jvm/java-17-openjdk" \
    "/usr/lib/jvm/jdk-21" \
    "/usr/lib/jvm/jdk-17" \
    "/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home" \
    "/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home" \
    "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home" \
    "/opt/homebrew/opt/openjdk@21" \
    "/opt/homebrew/opt/openjdk@17" \
    "$HOME/.sdkman/candidates/java/current" \
    ; do
    if [ -x "$dir/bin/jlink" ]; then
      log_info "发现 JDK: $dir"
      JDK_DIR="$dir"
      break
    fi
  done
fi

# 3) 检查 PATH 上的 java
if [ -z "$JDK_DIR" ]; then
  JAVA_PATH=$(command -v java 2>/dev/null || true)
  if [ -n "$JAVA_PATH" ]; then
    RESOLVED_DIR=$(cd "$(dirname "$JAVA_PATH")/.." && pwd 2>/dev/null || true)
    if [ -n "$RESOLVED_DIR" ] && [ -x "$RESOLVED_DIR/bin/jlink" ]; then
      log_info "发现 JDK（通过 PATH）: $RESOLVED_DIR"
      JDK_DIR="$RESOLVED_DIR"
    fi
  fi
fi

if [ -z "$JDK_DIR" ]; then
  log_error "未找到 JDK！jlink 需要 JDK 17+。"
  echo ""
  echo "请安装 JDK 17+ 并设置 JAVA_HOME 环境变量。"
  echo "下载地址: https://adoptium.net/"
  echo ""
  exit 1
fi

log_info "JDK 版本: $("$JDK_DIR/bin/java" -version 2>&1 | head -1)"
echo ""

JLINK="$JDK_DIR/bin/jlink"
JMODS="$JDK_DIR/jmods"

if [ ! -d "$JMODS" ]; then
  log_error "未找到 jmods 目录: $JMODS"
  echo "请确保使用的是完整 JDK（不是 JRE）。"
  exit 1
fi

# ============================================================
# 2. 清理旧的 JRE 目录
# ============================================================
if [ -d "$JRE_DIR" ]; then
  log_info "删除旧的 JRE 目录..."
  rm -rf "$JRE_DIR"
fi

# ============================================================
# 3. 定义所需 JDK 模块
# ============================================================
log_info "配置 JDK 模块列表（仅保留 Spring Boot 运行必需模块）..."

# Spring Boot Web 应用 + Spring AI + PDFBox + POI 等所需模块
# 排除 java.desktop（~12MB）、jdk.compiler（~11MB）、jdk.javadoc 等非运行时模块
MODULES="\
java.base,\
java.logging,\
java.xml,\
java.sql,\
java.naming,\
java.management,\
java.instrument,\
jdk.unsupported,\
jdk.zipfs,\
jdk.charsets,\
jdk.crypto.ec,\
java.net.http,\
java.security.jgss,\
java.security.sasl,\
jdk.security.auth,\
jdk.naming.dns,\
jdk.management,\
jdk.management.agent,\
jdk.random,\
jdk.crypto.cryptoki,\
jdk.crypto.mscapi,\
java.prefs,\
java.compiler,\
java.scripting,\
jdk.localedata,\
java.rmi,\
jdk.naming.rmi,\
java.transaction.xa,\
jdk.security.jgss,\
jdk.jfr"

# ============================================================
# 4. 执行 jlink 生成最小化 JRE
# ============================================================
log_info "正在生成最小化 JRE..."
log_info "输出目录: $JRE_DIR"
log_info "选项: --strip-debug --compress=2 --no-header-files --no-man-pages"
echo ""

"$JLINK" \
    --module-path "$JMODS" \
    --add-modules "$MODULES" \
    --output "$JRE_DIR" \
    --strip-debug \
    --compress=2 \
    --no-header-files \
    --no-man-pages \
    --vm=server

# ============================================================
# 5. 验证
# ============================================================
echo ""
log_info "验证生成的 JRE..."

if [ -x "$JRE_DIR/bin/java" ]; then
  log_info "Java 运行时版本:"
  "$JRE_DIR/bin/java" -version 2>&1 | head -1
  echo ""

  # 计算大小
  if [[ "$OSTYPE" == "darwin"* ]]; then
    JRE_SIZE=$(du -sm "$JRE_DIR" | cut -f1)
  else
    JRE_SIZE=$(du -sm "$JRE_DIR" | cut -f1)
  fi

  log_info "JRE 生成成功！"
  log_info "裁剪后 JRE 大小: ${JRE_SIZE} MB"
  log_info "对比: 完整 JRE 约 316 MB"
  log_info "体积缩减: 约 80%+"
  echo ""
  log_info "提示: 如果运行时出现模块缺失错误，可以手动添加模块到 MODULES 列表"
  echo ""
else
  log_error "JRE 验证失败！未找到 java。"
  exit 1
fi

log_info "完成！现在可以运行 npm run build:win 进行打包"
echo ""