#!/bin/bash
# ============================================================
# 一键发布脚本：构建 → 打包 → 创建 GitHub Release
# 用法：
#   ./scripts/release.sh 1.0.1 "更新说明"
#   ./scripts/release.sh 1.0.1          # 不写说明则用默认
# ============================================================
set -e

VERSION="${1:-}"
NOTES="${2:-"版本更新"}"

if [ -z "$VERSION" ]; then
  echo "用法: ./scripts/release.sh <版本号> [更新说明]"
  echo "示例: ./scripts/release.sh 1.0.1 \"新增我的思考功能\""
  exit 1
fi

TAG="v${VERSION}"
REPO="wf-Peg/ai_coding"
DIST_DIR="dist-electron"

echo "========================================="
echo "  发布版本: ${TAG}"
echo "  仓库: ${REPO}"
echo "========================================="

# 1. 更新 package.json 版本号
echo "[1/6] 更新版本号到 ${VERSION}..."
node -e "
const pkg = require('./package.json');
pkg.version = '${VERSION}';
require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
"
git add package.json
git commit -m "chore: bump version to ${VERSION}" || true

# 2. 构建后端 JAR
echo "[2/6] 构建后端 JAR..."
npm run build:jar

# 3. 构建桌面客户端
echo "[3/6] 构建桌面客户端..."
npm run build:win
# 如需全平台构建，取消下一行注释：
# npm run build:all

# 4. 创建更新包 ZIP
echo "[4/6] 创建更新包..."
UPDATE_ZIP="clip-update-${VERSION}.zip"
if [ -d "${DIST_DIR}/win-unpacked/resources" ]; then
  cd "${DIST_DIR}"
  zip -r "../${UPDATE_ZIP}" win-unpacked/resources/*
  cd ..
  echo "  更新包已创建: ${UPDATE_ZIP}"
else
  echo "  警告: win-unpacked 目录不存在，跳过更新包创建"
fi

# 5. 推送代码
echo "[5/6] 推送代码到远程..."
git push origin "$(git branch --show-current)"

# 6. 创建 GitHub Release
echo "[6/6] 创建 GitHub Release..."
RELEASE_ARGS=(
  --repo "${REPO}"
  --title "${TAG}"
  --notes "${NOTES}"
)

# 附加安装包
for f in "${DIST_DIR}"/*.exe "${DIST_DIR}"/*.dmg "${DIST_DIR}"/*.AppImage; do
  [ -f "$f" ] && RELEASE_ARGS+=("$f")
done

# 附加上传更新包
[ -f "${UPDATE_ZIP}" ] && RELEASE_ARGS+=("${UPDATE_ZIP}")

gh release create "${TAG}" "${RELEASE_ARGS[@]}"

echo ""
echo "========================================="
echo "  发布完成！"
echo "  版本: ${TAG}"
echo "  Release: https://github.com/${REPO}/releases/tag/${TAG}"
echo "========================================="