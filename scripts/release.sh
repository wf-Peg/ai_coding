#!/bin/bash
# ============================================================
# 一键发布脚本：构建 → 打包 → 创建 GitHub Release
#
# 用法：
#   ./scripts/release.sh 1.0.1 "更新说明"
#   ./scripts/release.sh 1.0.1                    # 不写说明则用默认
#   ./scripts/release.sh 1.0.1 "" win             # 只构建 Windows
#   ./scripts/release.sh 1.0.1 "" all             # 构建所有平台
#
# 前置条件：
#   1. 已安装 JDK 21 + Maven + Node.js
#   2. 已配置 GitHub CLI (gh auth login)
#   3. 已运行 npm install
# ============================================================
set -e

VERSION="${1:-}"
NOTES="${2:-"版本更新"}"
PLATFORM="${3:-all}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_step() { echo -e "${BLUE}[$1/$TOTAL_STEPS]${NC} $2"; }
log_ok()   { echo -e "${GREEN}  ✓${NC} $1"; }
log_warn() { echo -e "${YELLOW}  ⚠${NC} $1"; }
log_err()  { echo -e "${RED}  ✗${NC} $1"; }

if [ -z "$VERSION" ]; then
  echo "用法: ./scripts/release.sh <版本号> [更新说明] [平台: win|mac|linux|all]"
  echo "示例: ./scripts/release.sh 1.0.1 \"新增我的思考功能\" all"
  exit 1
fi

TAG="v${VERSION}"
REPO="wf-Peg/ai_coding"
DIST_DIR="dist-electron"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# 计算总步骤数
TOTAL_STEPS=8
echo ""
echo "========================================="
echo "  发布版本: ${TAG}"
echo "  目标平台: ${PLATFORM}"
echo "  仓库: ${REPO}"
echo "========================================="
echo ""

# ============================================================
# 前置检查
# ============================================================
log_step 1 "前置检查"

# 检查必要工具
command -v java  >/dev/null 2>&1 || { log_err "未安装 Java"; exit 1; }
command -v mvn   >/dev/null 2>&1 || { log_err "未安装 Maven"; exit 1; }
command -v node  >/dev/null 2>&1 || { log_err "未安装 Node.js"; exit 1; }
command -v npm   >/dev/null 2>&1 || { log_err "未安装 npm"; exit 1; }
command -v gh    >/dev/null 2>&1 || { log_err "未安装 GitHub CLI (gh)，请先运行: gh auth login"; exit 1; }

# 检查 Java 版本
JAVA_VER=$(java -version 2>&1 | head -1 | grep -oP '\d+' | head -1)
if [ "$JAVA_VER" -lt 21 ] 2>/dev/null; then
  log_warn "Java 版本: $JAVA_VER (建议 >= 21)"
fi

# 检查 git 状态
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  log_warn "工作区有未提交的更改，请先提交或暂存"
  git status --short
  read -p "是否继续? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# 检查 gh CLI 认证
gh auth status >/dev/null 2>&1 || { log_err "GitHub CLI 未认证，请运行: gh auth login"; exit 1; }

log_ok "前置检查通过"

# ============================================================
# 版本号更新
# ============================================================
log_step 2 "更新版本号到 ${VERSION}"

node -e "
const pkg = require('./package.json');
pkg.version = '${VERSION}';
require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
"
git add package.json
git commit -m "chore: bump version to ${VERSION}" 2>/dev/null || log_warn "版本号可能未变化"

log_ok "版本号已更新"

# ============================================================
# 下载 JRE
# ============================================================
log_step 3 "下载 JDK 21 JRE（免安装便携版）"

if [ -d "jre/win/bin" ] || [ -d "jre/mac/bin" ] || [ -d "jre/mac-arm/bin" ]; then
  log_ok "JRE 已存在，跳过下载"
else
  bash scripts/download-jre.sh all 2>&1 | sed 's/^/  /' || {
    log_warn "JRE 下载失败，打包将使用系统 JDK 路径"
    log_warn "如需内嵌 JRE，请手动运行: npm run download-jre:all"
  }
fi

# ============================================================
# 构建后端 JAR
# ============================================================
log_step 4 "构建后端 JAR"

cd backend
mvn clean package -DskipTests -q 2>&1 | tail -5
cd ..

if [ -f "backend/target/clip-demo-0.0.1-SNAPSHOT.jar" ]; then
  JAR_SIZE=$(ls -lh backend/target/clip-demo-0.0.1-SNAPSHOT.jar | awk '{print $5}')
  log_ok "后端 JAR 构建完成 ($JAR_SIZE)"
else
  log_err "后端 JAR 构建失败！"
  exit 1
fi

# ============================================================
# 构建桌面客户端
# ============================================================
log_step 5 "构建桌面客户端"

build_platform() {
  local p="$1"
  case "$p" in
    win)
      log_step 5 "构建 Windows 便携版..."
      npm run build:win 2>&1 | tail -3
      ;;
    mac)
      log_step 5 "构建 macOS..."
      npm run build:mac 2>&1 | tail -3
      ;;
    linux)
      log_step 5 "构建 Linux..."
      npm run build:linux 2>&1 | tail -3
      ;;
    all)
      build_platform "win"
      build_platform "mac"
      build_platform "linux"
      ;;
  esac
}

build_platform "$PLATFORM"

# 列出构建产物
log_ok "构建产物:"
find "$DIST_DIR" -maxdepth 1 -type f \( -name "*.exe" -o -name "*.dmg" -o -name "*.AppImage" -o -name "*.zip" \) -exec ls -lh {} \; 2>/dev/null | sed 's/^/  /'

# ============================================================
# 创建更新包 ZIP
# ============================================================
log_step 6 "创建增量更新包"

UPDATE_ZIP="clip-update-${VERSION}.zip"
if [ -d "${DIST_DIR}/win-unpacked/resources" ]; then
  cd "${DIST_DIR}"
  rm -f "../${UPDATE_ZIP}"
  zip -rq "../${UPDATE_ZIP}" win-unpacked/resources/*
  cd ..
  UPDATE_SIZE=$(ls -lh "$UPDATE_ZIP" | awk '{print $5}')
  log_ok "更新包已创建: ${UPDATE_ZIP} ($UPDATE_SIZE)"
else
  log_warn "win-unpacked 目录不存在，跳过更新包创建"
fi

# ============================================================
# 验证产物
# ============================================================
log_step 7 "验证构建产物"

HAS_ARTIFACTS=false
for f in "$DIST_DIR"/*.exe "$DIST_DIR"/*.dmg "$DIST_DIR"/*.AppImage "$DIST_DIR"/*.zip "$UPDATE_ZIP"; do
  if [ -f "$f" ]; then
    HAS_ARTIFACTS=true
    log_ok "$(basename "$f") ($(ls -lh "$f" | awk '{print $5}'))"
  fi
done

if [ "$HAS_ARTIFACTS" = false ]; then
  log_err "没有找到构建产物！"
  exit 1
fi

# ============================================================
# 推送代码
# ============================================================
log_step 8 "推送代码到远程"

git push origin "$(git branch --show-current)" 2>&1 | tail -1
log_ok "代码已推送"

# ============================================================
# 创建 GitHub Release
# ============================================================
log_step 8 "创建 GitHub Release"

RELEASE_ARGS=(
  --repo "${REPO}"
  --title "${TAG}"
  --notes "${NOTES}"
)

# 附加所有构建产物
for f in "$DIST_DIR"/*.exe "$DIST_DIR"/*.dmg "$DIST_DIR"/*.AppImage "$DIST_DIR"/*.zip "$UPDATE_ZIP"; do
  if [ -f "$f" ]; then
    RELEASE_ARGS+=("$f")
  fi
done

gh release create "${TAG}" "${RELEASE_ARGS[@]}"

echo ""
echo "========================================="
echo "  发布完成！"
echo "  版本: ${TAG}"
echo "  Release: https://github.com/${REPO}/releases/tag/${TAG}"
echo "========================================="
echo ""
echo "构建产物列表:"
find "$DIST_DIR" -maxdepth 1 -type f \( -name "*.exe" -o -name "*.dmg" -o -name "*.AppImage" -o -name "*.zip" \) -exec echo "  {}" \; 2>/dev/null
[ -f "$UPDATE_ZIP" ] && echo "  ${UPDATE_ZIP} (增量更新包)"