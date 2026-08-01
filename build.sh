#!/bin/bash
# ============================================
# 剪藏 - 一键构建脚本 (macOS / Linux)
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

# 步骤1: 编译后端 JAR
echo ""
echo -e "${YELLOW}[1/3] 编译后端 JAR 包...${NC}"
cd backend
mvn clean package -DskipTests -q
if [ ! -f "target/clip-demo-0.0.1-SNAPSHOT.jar" ]; then
    echo -e "${RED}错误: JAR 包构建失败${NC}"
    exit 1
fi
echo -e "${GREEN}✓ 后端 JAR 包构建成功${NC}"
cd ..

# 步骤2: 生成最小化 JRE（jlink 裁剪）
echo ""
echo -e "${YELLOW}[2/4] 生成最小化 JRE（jlink 裁剪）...${NC}"
echo "  将 JRE 从 316MB 裁剪到约 50MB"
if command -v jlink &> /dev/null; then
    if [ ! -f "jre/bin/java" ] && [ ! -f "jre/bin/java.exe" ]; then
        bash scripts/build-jlink.sh
        if [ $? -ne 0 ]; then
            echo -e "${RED}jlink 失败，将使用系统 Java${NC}"
        fi
    else
        echo -e "${GREEN}✓ 最小化 JRE 已存在${NC}"
    fi
else
    echo -e "${YELLOW}! 未找到 jlink（需要 JDK 17+），将使用系统 Java${NC}"
    echo "  提示: 安装 JDK 17+ 后运行 'npm run build:jlink:unix' 可进一步减小体积"
fi
if [ ! -f "jre/bin/java" ] && [ ! -f "jre/bin/java.exe" ]; then
    echo -e "${YELLOW}! 无嵌入式 JRE，打包后的应用需要用户自行安装 JDK 17+${NC}"
fi

# 步骤3: 安装 Electron 依赖
echo ""
echo -e "${YELLOW}[3/4] 安装 Electron 依赖...${NC}"
if [ ! -d "node_modules" ]; then
    npm install
fi
echo -e "${GREEN}✓ Electron 依赖安装完成${NC}"

# 步骤4: 打包桌面应用
echo ""
echo -e "${YELLOW}[4/4] 打包桌面应用...${NC}"

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
