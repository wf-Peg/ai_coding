#!/bin/bash
# ============================================
# 剪藏 - 一键构建脚本 (macOS / Linux)
# 本地打包 + 可选交互：
#   ① 打包前询问是否递增版本号并更新 package.json
#   ② 打包完成后询问是否推送到 GitHub Release（含更新包）
# ============================================

set -e

echo "========================================"
echo "  剪藏 - 桌面应用打包脚本"
echo "========================================"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}错误: 未找到 Node.js，请先安装 Node.js 18+${NC}"
    exit 1
fi

# 检查 Java
if ! command -v java &> /dev/null; then
    echo -e "${RED}错误: 未找到 Java，请先安装 JDK 17+${NC}"
    exit 1
fi

# 检查 Maven
if ! command -v mvn &> /dev/null; then
    echo -e "${RED}错误: 未找到 Maven，请先安装 Maven 3.6+${NC}"
    exit 1
fi

echo -e "${GREEN}✓ 环境检查通过${NC}"

# ============================================
# 版本号确认（询问是否递增版本号并更新）
# ============================================
echo ""
echo -e "${YELLOW}[1/4] 版本号确认...${NC}"

CURRENT_VERSION="$(node -p "require('./package.json').version" 2>/dev/null || echo 1.0.0)"
echo "  当前版本: ${CURRENT_VERSION}"

VERSION="$CURRENT_VERSION"
read -p "  是否递增版本号并更新 package.json？(y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    # 建议下一 patch 版本（x.y.z -> x.y.(z+1)）
    IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
    SUGGEST_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))"
    read -p "  请输入新版本号（回车使用建议值 ${SUGGEST_VERSION}）: " VERSION
    if [ -z "$VERSION" ]; then
        VERSION="$SUGGEST_VERSION"
    fi

    if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo -e "${RED}错误: 版本号格式无效: ${VERSION}（应为 x.y.z，如 1.0.8）${NC}"
        exit 1
    fi

    node -e "
    const pkg = require('./package.json');
    pkg.version = '${VERSION}';
    require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
    "
    echo -e "${GREEN}✓ 版本号已更新为 ${VERSION}${NC}"
else
    echo "  沿用当前版本 ${VERSION}"
fi

# 步骤2: 编译后端 JAR
echo ""
echo -e "${YELLOW}[2/4] 编译后端 JAR 包...${NC}"
cd backend
mvn clean package -DskipTests -q
if [ ! -f "target/clip-demo-0.0.1-SNAPSHOT.jar" ]; then
    echo -e "${RED}错误: JAR 包构建失败${NC}"
    exit 1
fi
echo -e "${GREEN}✓ 后端 JAR 包构建成功${NC}"
cd ..

# 步骤3: 校验嵌入式 JRE（分平台 jre/mac、jre/win；需先 download-jre）
echo ""
echo -e "${YELLOW}[3/4] 校验嵌入式 JRE（分平台）...${NC}"
echo "  当前方案使用分平台嵌入 JRE（2-c），无需 jlink 裁剪"
jre_exists() {
    [ -f "jre/mac/bin/java" ] || [ -f "jre/win/bin/java.exe" ] || [ -f "jre/linux/bin/java" ]
}

if command -v jlink &> /dev/null; then
    if jre_exists; then
        echo -e "${GREEN}✓ 嵌入式 JRE 已就绪（分平台 jre/mac、jre/win 等）${NC}"
    else
        echo -e "${RED}错误: 未找到嵌入式 JRE（jre/ 下无 jre/mac 等分平台运行时）${NC}"
        echo "  请先运行 'npm run download-jre:all'（macOS/Linux）或 'npm run download-jre:win:all'（Windows）下载对应平台 JRE"
        exit 1
    fi
else
    echo -e "${YELLOW}! 未找到 jlink（需要 JDK 17+），但当前方案使用分平台嵌入式 JRE，不依赖 jlink${NC}"
    jre_exists || { echo -e "${RED}错误: 请先下载嵌入式 JRE: npm run download-jre:all${NC}"; exit 1; }
fi

# 步骤4: 安装 Electron 依赖 + 打包
echo ""
echo -e "${YELLOW}[4/4] 安装依赖并打包桌面应用...${NC}"
if [ ! -d "node_modules" ]; then
    npm install
fi

# 检测平台
OS="$(uname -s)"
case "$OS" in
    Darwin)
        echo "检测到 macOS，构建 .dmg..."
        npm run build:mac
        ;;
    Linux)
        echo "检测到 Linux，构建 AppImage..."
        npm run build:linux
        ;;
    MINGW*|MSYS*|CYGWIN*)
        echo "检测到 Windows (Git Bash)，请使用 build.bat"
        npm run build:win
        ;;
    *)
        echo -e "${RED}未知平台: $OS${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}========================================"
echo "  打包完成！"
echo "  输出目录: dist-electron/"
echo "========================================${NC}"
echo ""

# ============================================
# 可选：推送到 GitHub Release
# ============================================
read -p "  是否推送到 GitHub Release（含更新包）？(y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "  已跳过发布。"
    echo "  如需一键发布（含版本号提示），也可运行: ./scripts/release.sh"
    exit 0
fi

echo ""
echo -e "${YELLOW}  正在准备发布 v${VERSION} ...${NC}"

if ! command -v gh &> /dev/null; then
    echo -e "${RED}错误: 未安装 GitHub CLI (gh)，跳过发布${NC}"
    exit 0
fi

if ! gh auth status &> /dev/null; then
    echo -e "${RED}错误: GitHub CLI 未登录，跳过发布。请先运行: gh auth login${NC}"
    exit 0
fi

# 提交版本号变更（如已更新）
if [ "$VERSION" != "$CURRENT_VERSION" ]; then
    git add package.json
    git commit -m "chore: bump version to ${VERSION}" 2>/dev/null || true
fi

TAG="v${VERSION}"
REPO="wf-Peg/ai_coding"
DIST_DIR="dist-electron"

# Release 说明（可选输入）
NOTES="版本更新"
read -p "  请输入 Release 说明（回车默认「版本更新」）: " NOTES_INPUT
if [ -n "$NOTES_INPUT" ]; then
    NOTES="$NOTES_INPUT"
fi

# 推送代码
git push origin "$(git branch --show-current)"
echo -e "${GREEN}✓ 代码已推送${NC}"

# 创建 GitHub Release（附带安装包 + 更新包 + 校验文件）
RELEASE_ARGS=(
    --repo "${REPO}"
    --title "${TAG}"
    --notes "${NOTES}"
)
for f in "$DIST_DIR"/*.exe "$DIST_DIR"/*.dmg "$DIST_DIR"/*.AppImage "$DIST_DIR"/*.zip "$DIST_DIR"/*.sha256; do
    if [ -f "$f" ]; then
        RELEASE_ARGS+=("$f")
    fi
done

gh release create "${TAG}" "${RELEASE_ARGS[@]}"

echo ""
echo -e "${GREEN}========================================"
echo "  Release Complete!"
echo "  版本: ${TAG}"
echo "  URL: https://github.com/${REPO}/releases/tag/${TAG}"
echo "========================================${NC}"
