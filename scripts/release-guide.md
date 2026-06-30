# GitHub Release 创建与更新包发布指南

## 一、前置条件

1. 项目已推送到 GitHub 仓库（`wf-Peg/ai_coding`）
2. 本地已安装 [GitHub CLI](https://cli.github.com/)（`gh`），或直接在 GitHub 网页操作
3. 已配置 `package.json` 中的 `version` 字段

## 二、发布流程

### 步骤 1：更新版本号

编辑 `package.json`，将 `version` 从当前值改为新版本号：

```json
"version": "1.0.1"
```

提交版本号变更：
```bash
git add package.json
git commit -m "chore: bump version to 1.0.1"
git push
```

### 步骤 2：构建应用

```bash
# 1. 先构建后端 JAR
npm run build:jar

# 2. 构建桌面客户端（Windows）
npm run build:win

# 或构建所有平台
npm run build:all
```

构建产物在 `dist-electron/` 目录下，例如：
- `剪藏-Setup-1.0.1.exe`（Windows 安装包）
- `剪藏-1.0.1-arm64.dmg`（macOS 安装包）
- `剪藏-1.0.1.AppImage`（Linux）

### 步骤 3：创建更新包（ZIP）

```bash
# 创建更新用的 ZIP 包（包含前后端文件，不含安装程序）
cd dist-electron
# Windows: 从 win-unpacked 目录打包
zip -r ../clip-update-1.0.1.zip win-unpacked/resources/*
```

### 步骤 4：创建 GitHub Release

#### 方法 A：使用 GitHub CLI

```bash
gh release create v1.0.1 \
  --title "v1.0.1" \
  --notes "## 更新内容
- 新增：我的思考功能，支持认知对话模式
- 优化：AI 分析 Prompt，融入用户思考
- 修复：若干 Bug" \
  --repo wf-Peg/ai_coding \
  dist-electron/剪藏-Setup-1.0.1.exe \
  dist-electron/剪藏-1.0.1-arm64.dmg \
  dist-electron/剪藏-1.0.1.AppImage \
  clip-update-1.0.1.zip
```

#### 方法 B：在 GitHub 网页操作

1. 打开 `https://github.com/wf-Peg/ai_coding/releases`
2. 点击 **Draft a new release**
3. **Tag version**: 输入 `v1.0.1`（会自动创建 tag）
4. **Release title**: 输入 `v1.0.1`
5. **Description**: 填写更新内容
6. 将构建产物拖入 **Attach binaries** 区域
7. 点击 **Publish release**

### 步骤 5：验证

发布后，桌面客户端会自动检测到新版本：
- 更新检查 API：`GET https://api.github.com/repos/wf-Peg/ai_coding/releases/latest`
- 客户端比对 `tag_name`（如 `v1.0.1`）与本地 `package.json` 的 `version`

## 三、Release 文件说明

| 文件 | 用途 |
|------|------|
| `剪藏-Setup-x.x.x.exe` | Windows 新用户安装包 |
| `剪藏-x.x.x-arm64.dmg` | macOS 新用户安装包 |
| `剪藏-x.x.x.AppImage` | Linux 新用户安装包 |
| `clip-update-x.x.x.zip` | 增量更新包（客户端自动下载解压） |

## 四、更新包结构

`clip-update-x.x.x.zip` 内部结构：
```
resources/
├── backend/
│   └── clip-demo-0.0.1-SNAPSHOT.jar    # 后端 JAR
├── frontend/
│   ├── index.html
│   ├── clip.html
│   ├── todo.html
│   ├── settings.html
│   ├── settings.js
│   └── ...
└── app.asar                            # Electron 打包文件
```

## 五、一键发布脚本

运行 `scripts/release.sh` 可自动完成构建和发布（需先配置 `gh` CLI）。