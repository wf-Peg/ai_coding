# 剪藏 - Electron 桌面应用打包指南

## 概述

通过 Electron 将前后端打包为一个桌面应用，用户双击即可启动，无需手动运行 Java 和 Node.js 服务。

## 环境要求

| 工具 | 版本要求 | 用途 |
|------|---------|------|
| Node.js | 18+ | Electron 运行环境 |
| JDK | 17+ | 编译后端 JAR |
| Maven | 3.6+ | 后端项目构建 |

## 项目结构（新增文件）

```
ai_coding-main/
├── electron/                    # [新增] Electron 相关
│   ├── main.js                  # 主进程：窗口管理、后端进程管理
│   ├── preload.js               # 预加载脚本：IPC 通信桥接
│   ├── config.html              # 配置界面：首次启动设置
│   └── icon.png                 # 应用图标
├── package.json                 # [新增] Electron 依赖和打包配置
├── build.sh                     # [新增] macOS/Linux 一键构建脚本
├── build.bat                    # [新增] Windows 一键构建脚本
├── backend/                     # 后端（不变）
│   └── ...
└── frontend/                    # 前端（不变）
    └── ...
```

## 快速开始

### 方式一：一键打包（推荐）

**Windows:**
```bash
build.bat
```

**macOS / Linux:**
```bash
chmod +x build.sh
./build.sh
```

脚本会自动完成：编译后端 JAR → 安装 Electron 依赖 → 打包桌面应用

### 方式二：手动分步操作

```bash
# 1. 编译后端 JAR
cd backend
mvn clean package -DskipTests
cd ..

# 2. 安装 Electron 依赖（首次）
npm install

# 3. 开发模式运行（调试用）
npm start

# 4. 打包桌面应用
npm run build:win     # Windows → dist-electron/xxx.exe
npm run build:mac     # macOS   → dist-electron/xxx.dmg
npm run build:linux   # Linux   → dist-electron/xxx.AppImage
```

## 打包产物

| 平台 | 产物 | 位置 |
|------|------|------|
| Windows | NSIS 安装包 (.exe) | `dist-electron/剪藏 Setup x.x.x.exe` |
| macOS | DMG 镜像 | `dist-electron/剪藏-x.x.x.dmg` |
| Linux | AppImage | `dist-electron/剪藏-x.x.x.AppImage` |

## 首次启动流程

1. **双击运行应用** → 弹出「初始设置」窗口
2. **填写配置**：
   - DashScope API Key（必填）
   - 后端端口（默认 8080）
   - 前端端口（默认 3000）
   - 剪藏文件存储目录
   - 总结文件存储目录
3. **点击「保存并启动」** → 自动启动后端 Java 服务和前端页面
4. **进入主界面** → 正常使用剪藏功能

## 后续修改配置

启动应用后，通过菜单栏 **剪藏 → 设置**（快捷键 `Ctrl+,`）重新打开配置界面。

## 工作原理

```
┌─────────────────────────────────────────────┐
│              Electron 主进程                  │
│                                             │
│  ┌───────────────┐  ┌────────────────────┐  │
│  │  内置 HTTP     │  │  Java 子进程管理    │  │
│  │  静态服务器     │  │  (java -jar xxx)   │  │
│  │  (前端页面)     │  │                    │  │
│  │  端口: 3000    │  │  端口: 8080        │  │
│  └───────┬───────┘  └────────┬───────────┘  │
│          │                   │              │
│          ▼                   ▼              │
│  ┌───────────────────────────────────────┐  │
│  │         BrowserWindow                 │  │
│  │    加载 http://127.0.0.1:3000         │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

- Electron 主进程启动一个内置 HTTP 静态服务器来托管前端 `index.html`
- 同时通过 `child_process.spawn` 启动 Java 后端 JAR 包
- 配置信息保存在用户数据目录（`%APPDATA%/clip-demo/config/config.json`）
- `application.yml` 在运行时动态生成，无需手动配置

## 注意事项

1. **JRE 依赖**：打包后的应用需要目标机器安装了 Java 17+（或自行内嵌 JRE）
2. **API Key 安全**：配置信息存储在本地用户目录，不会上传
3. **端口冲突**：如果默认端口被占用，可在设置中修改
4. **图标替换**：可替换 `electron/icon.png` 为自定义图标（建议 512x512 PNG）
