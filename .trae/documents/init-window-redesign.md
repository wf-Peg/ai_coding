# 系统初始化窗口页面重构

## 一、概述

1. 去掉原生窗口标题栏（最小化/最大化/关闭），改为自定义标题栏
2. 非必填项从初始化页面移除，后续在设置页面中配置
3. DeepSeek 切换时显示对应的 API Key 申请地址链接

---

## 二、当前状态分析

### 2.1 窗口创建

| 文件 | 位置 | 说明 |
|---|---|---|
| `electron/main.js` | L2674-L2682（首次运行） | `width: 560, height: 700, resizable: false`，**无 `frame: false`** |
| `electron/main.js` | L1390-L1400（设置窗口） | 同上，**无 `frame: false`** |

当前使用原生窗口边框（含标题栏、最小化/最大化/关闭按钮），但窗口本身 `resizable: false`，最大化/最小化按钮无实际意义。

### 2.2 页面布局

| 区块 | 必需？ | 当前状态 |
|---|---|---|
| 头部渐变色标题栏 | 保留，改为自定义标题栏 | 渐变背景，显示标题和描述 |
| 首次运行提示横幅 | 保留，补充 DeepSeek 链接 | 仅 DashScope 的 API Key 链接 |
| AI 模型配置 | 必需 | 含 DashScope/DeepSeek/Custom 三个提供商 |
| 端口配置 | 必需 | 后端 8081 + 前端 3001 |
| 启动行为（开机自启） | 非必需，可移除 | 在设置中配置 |
| 存储目录 | 必需 | 含路径选择器和子目录结构展示 |
| 子目录结构展示 | 非必需，可移除 | 仅展示信息，无输入 |
| 邮件通知 | 非必需，可移除 | 整个区块可选 |
| 软件更新 | 非必需，可移除 | 在设置中配置 |
| 底部操作按钮 | 保留 | 保存并启动 + 退出应用 |

### 2.3 关键文件

| 文件 | 角色 |
|---|---|
| `electron/main.js` | 窗口创建，需加 `frame: false` |
| `electron/config.html` | 页面 HTML + 内联 CSS + JS |
| `frontend/settings.html` | 非首次运行时用户的详细设置页 |

---

## 三、改动方案

### 3.1 main.js — 两处配置窗口均去掉原生边框

**首次运行窗口**（L2674-L2682）和**设置窗口**（L1390-L1400）均添加 `frame: false` 选项：

```javascript
mainWindow = new BrowserWindow({
  width: 560, height: 700, resizable: false,
  frame: false,                            // 新增：去掉原生标题栏
  title: 'Clip - Setup',
  webPreferences: { ... }
});
```

同时**修改首次运行判断逻辑**：当前配置窗口的必填校验条件（AI API Key 非空）不再适用。改为仅检查 `config.configured` 字段，不再校验 `hasConfiguredProviderKey`：

```javascript
// 将
if (!config.configured || !hasConfiguredProviderKey) {
// 改为
if (!config.configured) {
```

### 3.2 config.html — 自定义标题栏

**替换现有的 `.header` 渐变区域**为自定义标题栏：

```html
<!-- 自定义标题栏（可拖拽区域） -->
<div class="titlebar">
  <div class="titlebar-drag">
    <span class="titlebar-icon">⚙️</span>
    <span class="titlebar-title" id="headerTitle">CutShelter - 初始设置</span>
  </div>
  <button class="titlebar-close" id="titlebarClose" title="关闭">✕</button>
</div>
```

CSS 样式：

```css
.titlebar {
  display: flex; align-items: center; justify-content: space-between;
  height: 40px; padding: 0 12px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  user-select: none;
}
.titlebar-drag {
  -webkit-app-region: drag;
  display: flex; align-items: center; gap: 8px; flex: 1;
  height: 100%;
}
.titlebar-icon { font-size: 16px; }
.titlebar-title { font-size: 13px; color: white; font-weight: 500; }
.titlebar-close {
  -webkit-app-region: no-drag;
  width: 32px; height: 32px; border: none; background: transparent;
  border-radius: 6px; color: rgba(255,255,255,0.8); font-size: 16px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: background 0.15s;
}
.titlebar-close:hover { background: rgba(255,255,255,0.2); color: white; }
```

JS 绑定关闭事件：

```javascript
document.getElementById('titlebarClose').addEventListener('click', function() {
  window.close();
});
```

**注意**：`window.close()` 在 Electron 中会关闭当前窗口，对首次运行窗口有效；对设置窗口（`parent: mainWindow`）也有效。

### 3.3 config.html — 精简为仅必需项

**初始化页面只保留 2 个必需区块**：端口配置 + 存储目录。其余所有非必需项（AI 模型、邮件、更新、启动行为）全部移除。

**首次运行提示横幅**改为简洁的欢迎文案，不再包含 AI 相关的引导内容：

```html
<div id="firstRunNotice" class="first-run-notice" style="display:none;">
  <strong>🎉 欢迎使用剪藏！</strong>
  首次使用只需配置存储目录和端口即可开始。AI 等高级功能可在设置中按需配置。
</div>
```

**保留的区块**按顺序：
1. 自定义标题栏
2. 首次运行欢迎横幅
3. 端口配置（双端口并排）
4. 存储目录（仅路径选择器 + 浏览按钮）
5. 底部按钮（保存并启动 + 退出应用）
6. 状态栏
7. 启动遮罩层

**注意**：AI 模型配置（含 DeepSeek API Key 注册链接）完整保留在 `frontend/settings.html` 的设置页面中，用户可在应用启动后按需配置。

### 3.4 config.html — 简化表单验证逻辑

在"保存并启动"按钮的验证逻辑中，移除 AI API Key 的必填校验，只校验端口和存储目录：

```javascript
// 移除此类校验：
if (!apiKey) { showStatus('请填写 API Key', 'error'); return; }
// 只保留：
if (!storagePath) { showStatus('请选择数据存储根目录', 'error'); return; }
if (backendPort === frontendPort) { showStatus('前端和后端端口不能相同', 'error'); return; }
```

### 3.5 config.html — 简化存储目录区块

移除子目录结构展示部分，只保留根目录选择器：

```html
<div class="section">
  <div class="section-title"><span class="icon">📁</span> 存储目录</div>
  <div class="form-group">
    <label>存储根目录 <span class="hint">（必填）</span></label>
    <div class="path-group">
      <input type="text" id="storagePath" placeholder="选择数据存储根目录" />
      <button class="btn-browse" id="browseStorage" type="button">浏览...</button>
    </div>
    <div class="path-desc">所有剪藏、整理、周报数据均存储在此目录下</div>
  </div>
</div>
```

注意：移除 `oninput="updateDerivedPaths(this.value)"` 和 `updateDerivedPaths` 函数调用，以及 `updateDerivedPaths` 函数本身。

### 3.6 frontend/settings.html — 补充 AI 模型配置 + DeepSeek 链接

确保设置页面（非首次运行时）的 AI 模型配置区域包含 DeepSeek 的 API Key 申请链接。在 `frontend/settings.html` 的 DeepSeek 字段区域中，参考 DashScope 的样式，添加：

```html
<div class="form-group">
  <label>DeepSeek API Key</label>
  <div class="api-key-wrapper">
    <input type="password" id="deepseekApiKey" placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx" />
    <button class="toggle-visibility" id="toggleDeepseekApiKey" type="button">👁</button>
  </div>
  <div style="margin-top:4px;font-size:11px;color:var(--app-text-muted);">
    <a href="https://platform.deepseek.com/sign_in" target="_blank">前往 DeepSeek 注册获取 API Key →</a>
  </div>
</div>
```

以及在 DashScope 字段区域也添加类似链接（如果当前没有的话）。

---

## 四、不涉及的范围

- 不修改 `frontend/settings.html` / `settings.js`（非必需项在设置页中仍可配置）
- 不修改后端代码
- 不修改 preload.js（无需新增 IPC）
- 不修改 Electron 窗口管理核心逻辑（config-done/restart-backend 等流程不变）

---

## 五、验证方式

1. **自定义标题栏**：初始化窗口无原生边框，顶部显示自定义标题栏（渐变色），可拖拽，关闭按钮正常
2. **非必需项移除**：页面中无邮件通知、软件更新、开机自启、子目录结构展示等区块
3. **DeepSeek API Key 链接**：选择 DeepSeek → 提示横幅显示 DeepSeek 注册链接，字段区域内部也有链接
4. **DashScope API Key 链接**：选择 DashScope → 提示横幅显示阿里云 API Key 链接
5. **设置窗口**：从菜单位置打开设置窗口，同样无原生边框，自定义标题栏正常
6. **保存功能**：保存并启动功能正常，不受 UI 重构影响