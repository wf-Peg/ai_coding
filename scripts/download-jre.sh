#!/bin/bash
# ============================================================
# download-jre.sh — 下载 JDK 21 JRE（免安装便携版）
#
# 用法：
#   ./scripts/download-jre.sh              # 下载当前平台
#   ./scripts/download-jre.sh all           # 下载所有平台
#   ./scripts/download-jre.sh win mac mac-arm
#
# JRE 来源：Eclipse Adoptium (Temurin) 21
# 存放路径：jre/ 目录（electron-builder 打包时作为 extraResources）
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
JRE_DIR="$PROJECT_DIR/jre"
API_BASE="https://api.adoptium.net/v3/binary/latest/21/ga"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[JRE]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[JRE]${NC} $1"; }
log_error() { echo -e "${RED}[JRE]${NC} $1"; }

# ============================================================
# 下载指定平台的 JRE
# ============================================================
download_jre() {
  local platform="$1"
  local os arch out_name out_dir

  case "$platform" in
    win|windows)
      os="windows"; arch="x64"; out_name="jre-windows-x64.zip"; out_dir="$JRE_DIR/win"
      ;;
    mac|mac-x64)
      os="mac"; arch="x64"; out_name="jre-mac-x64.tar.gz"; out_dir="$JRE_DIR/mac"
      ;;
    mac-arm|mac-arm64)
      os="mac"; arch="aarch64"; out_name="jre-mac-arm64.tar.gz"; out_dir="$JRE_DIR/mac"
      ;;
    linux)
      os="linux"; arch="x64"; out_name="jre-linux-x64.tar.gz"; out_dir="$JRE_DIR/linux"
      ;;
    *)
      log_error "未知平台: $platform"
      log_info "支持的平台: win, mac, mac-arm, linux, all"
      return 1
      ;;
  esac

  mkdir -p "$out_dir"

  local url="${API_BASE}/${os}/${arch}/jre/hotspot/normal/eclipse?project=jdk"
  local tmp_file="$JRE_DIR/${out_name}"

  log_info "下载 ${platform} JRE 21..."
  log_info "URL: ${url}"

  if curl -L --connect-timeout 30 --max-time 600 --retry 3 \
    -o "$tmp_file" \
    -w "\nHTTP:%{http_code} Size:%{size_download}" \
    "$url"; then

    log_info "下载完成: $(ls -lh "$tmp_file" | awk '{print $5}')"

    # 解压到目标目录
    log_info "解压到 ${out_dir}..."
    if [[ "$out_name" == *.zip ]]; then
      unzip -qo "$tmp_file" -d "$out_dir"
      # Windows JRE 解压后目录结构: jdk-21.x.x-jre/ → 移动到 jre/win/
      JRE_CONTENT=$(find "$out_dir" -maxdepth 1 -type d -name "jdk*" -o -name "jre*" | head -1)
    else
      tar -xzf "$tmp_file" -C "$out_dir"
      JRE_CONTENT=$(find "$out_dir" -maxdepth 1 -type d -name "jdk*" -o -name "jre*" | head -1)
    fi

    if [ -n "$JRE_CONTENT" ] && [ "$JRE_CONTENT" != "$out_dir" ]; then
      # 扁平化目录结构
      mv "$JRE_CONTENT"/* "$out_dir/" 2>/dev/null || true
      rmdir "$JRE_CONTENT" 2>/dev/null || true
    fi

    # 精简：删除仅开发用/冗余的 jmods 与 man（打包 filter 已排除，这步释放源码磁盘）
    rm -rf "$out_dir/jmods" "$out_dir/man" 2>/dev/null || true

    rm -f "$tmp_file"
    log_info "${platform} JRE 准备完成: $out_dir"
  else
    log_error "下载失败: $platform"
    rm -f "$tmp_file"
    return 1
  fi
}

# ============================================================
# 主流程
# ============================================================
PLATFORM="${1:-auto}"

# ---- 检查本地 JDK/JRE ----
log_info "检查本地 JDK/JRE..."

# 1) JAVA_HOME
if [ -n "$JAVA_HOME" ] && [ -x "$JAVA_HOME/bin/java" ]; then
  log_info "发现 JAVA_HOME = $JAVA_HOME"
  "$JAVA_HOME/bin/java" -version 2>&1 | head -1
  log_info "本地 JDK 已可用，无需下载 JRE。如仍需下载请手动指定平台。"
  exit 0
fi

# 2) 系统 PATH 上的 java
if command -v java &>/dev/null; then
  JAVA_PATH=$(command -v java)
  log_info "发现系统 Java: $JAVA_PATH"
  java -version 2>&1 | head -1
  log_info "本地 JDK 已可用，无需下载 JRE。如仍需下载请手动指定平台。"
  exit 0
fi

# 3) 常见安装路径
for dir in \
  "/usr/lib/jvm/java-21-openjdk" \
  "/usr/lib/jvm/jdk-21" \
  "/Library/Java/JavaVirtualMachines/jdk-21.jdk" \
  "/Library/Java/JavaVirtualMachines/temurin-21.jdk" \
  "/opt/homebrew/opt/openjdk@21" \
  "$HOME/.sdkman/candidates/java/21"* \
  ; do
  if [ -x "$dir/bin/java" ]; then
    log_info "发现: $dir"
    "$dir/bin/java" -version 2>&1 | head -1
    log_info "本地 JDK 已可用，无需下载 JRE。如仍需下载请手动指定平台。"
    exit 0
  fi
done

# 4) 项目 jre/ 目录
if [ -d "$JRE_DIR/win/bin" ] || [ -d "$JRE_DIR/mac/bin" ] || [ -d "$JRE_DIR/mac-arm/bin" ]; then
  log_info "项目 jre/ 目录已存在，跳过下载"
  exit 0
fi

log_info "未找到本地 JDK 21，开始下载 JRE..."

if [ "$PLATFORM" = "all" ]; then
  log_info "下载所有平台 JRE..."
  download_jre "win"
  download_jre "mac"
  download_jre "mac-arm"
  log_info "所有平台 JRE 下载完成"

elif [ "$PLATFORM" = "auto" ]; then
  # 自动检测当前平台
  case "$(uname -s)" in
    Darwin)
      case "$(uname -m)" in
        arm64) download_jre "mac-arm" ;;
        *)     download_jre "mac" ;;
      esac
      ;;
    Linux)   download_jre "linux" ;;
    MINGW*|MSYS*|CYGWIN*) download_jre "win" ;;
    *) log_error "无法自动检测平台，请手动指定: $0 <platform>" ;;
  esac
else
  # 下载指定平台
  for p in "$@"; do
    download_jre "$p"
  done
fi

# 验证 JRE 目录
log_info "JRE 目录结构:"
if [ -d "$JRE_DIR" ]; then
  find "$JRE_DIR" -maxdepth 3 -type f -name "java" -o -name "java.exe" 2>/dev/null | while read f; do
    echo "  $f"
  done
fi

echo ""
log_info "JRE 准备完成！现在可以运行 npm run build:win 或 npm run build:mac 进行打包"