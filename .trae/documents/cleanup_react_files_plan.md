# React文件清理与文档更新计划

## 1. 问题分析

当前项目确实使用纯HTML/CSS/JS（index.html, clip.html, todo.html）作为前端，但仍然保留了完整的React开发文件，这些文件现在未被使用。同时，PRD文档中仍然描述使用React，需要更新。

## 2. 需要处理的文件

### 2.1 需要删除的React文件
- `/workspace/frontend/src/App.jsx`
- `/workspace/frontend/src/main.jsx`
- `/workspace/frontend/src/components/CategorySelector.jsx`
- `/workspace/frontend/src/components/ClipForm.jsx`
- `/workspace/frontend/src/components/ContentInput.jsx`
- `/workspace/frontend/src/components/ImageUploader.jsx`
- `/workspace/frontend/src/components/TodoTimeline.jsx`
- `/workspace/frontend/src/App.css`
- `/workspace/frontend/src/index.css`
- `/workspace/frontend/src/assets/` 目录
- `/workspace/frontend/vite.config.js`
- `/workspace/frontend/eslint.config.js`
- `/workspace/frontend/public/` 目录（如不需要）
- `/workspace/frontend/package.json`
- `/workspace/frontend/package-lock.json`
- `/workspace/frontend/node_modules/` 目录

### 2.2 需要更新的文档
- `/workspace/PRD.md` - 更新技术栈描述
- `/workspace/README.md` - 更新用户手册，添加Git同步功能说明

## 3. 实施步骤

### 3.1 删除React相关文件
1. 删除 `frontend/src/` 整个目录
2. 删除 `frontend/node_modules/` 目录
3. 删除 `frontend/public/` 目录
4. 删除 `frontend/package.json` 和 `frontend/package-lock.json`
5. 删除 `frontend/vite.config.js` 和 `frontend/eslint.config.js`
6. 删除 `frontend/README.md`

### 3.2 更新PRD文档
1. 更新4.1系统架构部分：将React + Vite改为HTML5 + CSS3 + JavaScript
2. 更新4.2核心技术栈表格：移除React、Vite、TypeScript相关内容
3. 更新4.3目录结构部分：调整前端目录结构描述
4. 检查并更新其他提到React的部分

### 3.3 更新README用户手册
1. 更新技术栈部分：移除React相关
2. 更新快速开始部分：简化前端启动说明
3. 更新项目结构部分：调整目录描述
4. 添加Git同步功能使用说明：
   - Git配置入口
   - 同步仓库按钮功能
   - 配置步骤说明

## 4. 优化后的前端结构
```
frontend/
├── index.html          # 主页面（待办时间线 + 剪藏）
├── clip.html           # 剪藏页面
├── todo.html           # 待办页面
└── README.md           # 前端说明（可选）
```

## 5. 需要添加的内容

### 5.1 PRD更新要点
- 更新技术栈说明：前端为纯HTML/CSS/JS
- 说明移除React的原因（简化架构、降低复杂度）
- 添加Git同步功能到核心功能模块

### 5.2 README更新要点
- 在功能特性中添加Git同步功能
- 添加Git配置使用说明
- 更新API接口列表，添加Git相关接口

## 6. 注意事项

- 确保删除操作不会影响当前使用的HTML文件
- 保留必要的静态资源文件
- 更新文档时保持格式一致性
- Git同步功能是新增功能，需要详细说明
