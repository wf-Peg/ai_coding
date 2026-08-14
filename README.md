# 剪藏（Clip）— 信息检索与知识管理系统

基于 Spring Boot 和多 LLM 提供者架构的个人信息管理与知识库系统，支持剪藏、AI分析、专题管理、待办时间线、日报/周报生成、Git同步，并提供 Electron 桌面应用打包。

## 功能特性

- ✅ 文件选择与剪藏（文本/链接/文档）
- ✅ 浏览器内容复制剪藏
- ✅ AI分析与标签生成（多模型支持）
- ✅ 信息检索（关键词搜索 + 分类筛选）
- ✅ 每日内容整理与邮件通知
- ✅ 每周内容周报与邮件通知
- ✅ 语音输入（中文）
- ✅ 发散性总结（专家级分析，打字机效果）
- ✅ Markdown渲染
- ✅ 本地文件存储与分类
- ✅ 图片上传与管理
- ✅ AI分类匹配
- ✅ 来源地址输入
- ✅ 专题管理（创建/编辑/关联剪藏/分区展示）
- ✅ 待办时间线管理（创建/编辑/删除/剪藏转待办）
- ✅ 多LLM模型支持（DashScope / DeepSeek / 智能路由）
- ✅ Prompt自定义配置
- ✅ 主题切换（Notion风格 / 常规风格）
- ✅ Git同步与仓库配置
- ✅ Electron桌面应用打包（Windows/macOS/Linux）

## 技术栈

- **后端**：Spring Boot 3.2.0, Spring AI, 多LLM提供者（DashScope + DeepSeek）
- **前端**：HTML5, CSS3, JavaScript, Marked.js（Markdown渲染）, html2canvas（截图导出）
- **存储**：本地文件系统（JSON + Markdown），支持向量嵌入检索
- **Git**：Git命令行集成，支持自动同步
- **桌面应用**：Electron 28+, electron-builder

## 快速开始

### 1. 环境要求

- JDK 17+
- Maven 3.6+
- Node.js 18+（仅桌面打包需要）
- 现代浏览器

### 2. 配置步骤

#### 2.1 配置API Key

目前支持的两家大模型，获取 apikey 的地址（需付费）：

> [大模型服务平台百炼控制台](https://bailian.console.aliyun.com/cn-beijing?tab=model#/api-key)
> 
> [DeepSeek](https://platform.deepseek.com/api_keys)

1. 复制 `backend/src/main/resources/application_templete.yml` 文件为 `application.yml`

2. 打开 `application.yml` 文件，填写以下配置：
   
   ```yaml
   spring:
     ai:
       dashscope:
         api-key: your-dashscope-api-key  # 阿里云DashScope API Key（必填）
   ```

3. 可选：配置DeepSeek模型（在设置页面中配置，或直接在配置文件中添加）

4. 可选：调整存储目录路径和邮件配置
   
   ```yaml
   clip:
     storage:
       path: ./clip-storage  # 剪藏文件存放目录
     organized-storage:
       path: ./clip-organized  # 总结文件存放目录
     clip-weekly-report:
       path: ./clip-weekly-report  # 周报文件存放目录
   
   # 邮件配置（可选，用于发送日报和周报）
   spring:
     mail:
       host: smtp.qq.com
       port: 587
       username: your-email@example.com
       password: your-email-password
       properties:
         mail:
           smtp:
             auth: true
             starttls:
               enable: true
   ```

### 3. 方式一：一键启动（推荐）

**Windows:**

```bash
start.bat
```

**macOS / Linux:**

```bash
chmod +x start.sh
./start.sh
```

脚本会自动检查Java环境、编译JAR包（如需要）、启动后端和前端服务。

### 4. 方式二：手动启动

#### 4.1 启动后端服务

```bash
cd backend
mvn clean package -DskipTests
mvn spring-boot:run
```

后端服务将在 `http://localhost:8081` 启动。

#### 4.2 启动前端服务

```bash
# 方式A：使用npx serve（推荐）
npx serve frontend -l 3001

# 方式B：使用Python
cd frontend
python3 -m http.server 3001 --bind 0.0.0.0
```

前端服务将在 `http://localhost:3001` 启动。

#### 4.3 停止服务

**Windows:**

```bash
stop.bat
```

**macOS / Linux:**

```bash
chmod +x stop.sh
./stop.sh
```

### 5. 桌面应用打包

#### 5.1 一键打包（推荐）

**Windows:**

```bash
build.bat
```

**macOS / Linux:**

```bash
chmod +x build.sh
./build.sh
```

脚本会自动完成：编译后端JAR → 准备JRE → 安装Electron依赖 → 打包桌面应用。

#### 5.2 手动打包

```bash
# 1. 编译后端JAR
cd backend && mvn clean package -DskipTests && cd ..

# 2. 安装依赖
npm install

# 3. 打包
npm run build:win     # Windows → dist-electron/剪藏 Setup x.x.x.exe
npm run build:mac     # macOS   → dist-electron/剪藏-x.x.x.dmg
npm run build:linux   # Linux   → dist-electron/剪藏-x.x.x.AppImage
```

打包后的应用内嵌JRE，用户无需安装Java环境。详见 [打包说明.md](./打包说明.md)。

## 项目结构

```
├── backend/                          # 后端代码
│   ├── src/main/java/com/example/clip/
│   │   ├── config/                   # 配置类（存储、Git、图片、Prompt等）
│   │   ├── controller/               # 控制器
│   │   │   ├── ClipController.java   # 剪藏接口
│   │   │   ├── TodoController.java   # 待办接口
│   │   │   ├── TopicController.java  # 专题接口
│   │   │   ├── GitController.java    # Git配置接口
│   │   │   ├── ModelConfigController.java  # 模型配置接口
│   │   │   └── WeeklyReportController.java # 周报接口
│   │   ├── core/                     # 核心服务
│   │   │   ├── AiService.java        # AI服务
│   │   │   ├── LlmProvider.java      # LLM提供者接口
│   │   │   ├── DashScopeLlmProvider.java  # 通义千问提供者
│   │   │   ├── DeepSeekLlmProvider.java   # DeepSeek提供者
│   │   │   ├── RoutingLlmProvider.java    # 智能路由提供者
│   │   │   ├── LlmProviderConfig.java     # LLM配置
│   │   │   ├── ModelConfig.java           # 模型配置
│   │   │   ├── EmbeddingConfig.java       # 嵌入配置
│   │   │   └── ScheduledTasks.java        # 定时任务
│   │   ├── dto/                      # 数据传输对象
│   │   ├── model/                    # 数据模型
│   │   │   ├── ClipContent.java      # 剪藏内容
│   │   │   ├── TodoContent.java      # 待办内容
│   │   │   ├── Topic.java            # 专题
│   │   │   └── KnowledgeEntry.java   # 知识条目
│   │   ├── service/                  # 业务服务
│   │   │   ├── ClipService.java      # 剪藏服务
│   │   │   ├── TodoService.java      # 待办服务
│   │   │   ├── TopicService.java     # 专题服务
│   │   │   ├── SearchService.java    # 搜索服务
│   │   │   ├── EmailService.java     # 邮件服务
│   │   │   ├── GitService.java       # Git服务
│   │   │   ├── DocumentParseService.java   # 文档解析
│   │   │   ├── LinkParseService.java       # 链接解析
│   │   │   ├── ContentOrganizeService.java # 内容整理
│   │   │   ├── WeeklyReportService.java    # 周报生成
│   │   │   ├── PromptConfigService.java    # Prompt配置
│   │   │   └── ModelConfigService.java     # 模型配置
│   │   └── utils/                    # 工具类
│   ├── src/main/resources/           # 资源文件
│   └── pom.xml                       # Maven配置
├── frontend/                         # 前端代码
│   ├── index.html                    # 主页面（待办+剪藏）
│   ├── clip.html                     # 剪藏页面
│   ├── todo.html                     # 待办时间线页面
│   ├── topic.html                    # 专题列表页面
│   ├── topic-detail.html             # 专题详情页面
│   ├── topic-editor.html             # 专题编辑器页面
│   ├── topic.js / topic-detail.js / topic-editor.js  # 专题逻辑
│   ├── settings.html                 # 系统设置页面
│   ├── settings.js                   # 设置页面逻辑
│   ├── styles/                       # 样式文件
│   │   ├── theme-notion.css          # Notion风格主题
│   │   ├── theme-regular.css         # 常规主题
│   │   └── clip-theme-notion.css     # 剪藏Notion主题
│   ├── libs/                         # 第三方库
│   │   ├── marked.min.js             # Markdown渲染
│   │   └── html2canvas.min.js        # 截图导出
│   ├── start-mac.sh                  # macOS前端启动
│   └── start-win.bat                 # Windows前端启动
├── electron/                         # Electron桌面应用
│   ├── main.js                       # 主进程
│   ├── preload.js                    # 预加载脚本
│   ├── config.html                   # 首次启动配置界面
│   ├── afterPack.js                  # 打包后处理
│   └── icon.png                      # 应用图标
├── package.json                      # Electron依赖和打包配置
├── build.bat / build.sh              # 一键构建脚本
├── start.bat / start.sh              # 一键启动脚本
├── stop.bat / stop.sh                # 一键停止脚本
├── prepare-jre.bat                   # JRE自动下载
├── .npmrc                            # npm镜像配置
├── .gitignore                        # Git忽略配置
├── PRD.md                            # 产品需求文档
├── README.md                         # 项目说明
└── 打包说明.md                         # 打包详细说明
```

## API接口

### 剪藏相关

- `POST /api/clip/add` - 添加剪藏
- `GET /api/clip/list` - 获取剪藏列表
- `DELETE /api/clip/{id}` - 删除剪藏
- `GET /api/clip/divergent-summary/{id}` - 获取发散性总结
- `GET /api/clip/search` - 搜索剪藏
- `GET /api/clip/image/{category}/{fileName}` - 访问图片
- `POST /api/clip/open-storage-folder` - 打开存储目录

### 内容整理

- `POST /api/clip/organize` - 整理剪藏内容
- `POST /api/clip/organize-inbox` - 收件箱整理
- `GET /api/clip/organize/status` - 获取整理状态

### 周报

- `POST /api/clip/weekly-report` - 生成周报

### 待办管理

- `GET /api/todo/list` - 获取待办列表
- `POST /api/todo/add` - 添加待办
- `PUT /api/todo/{id}` - 更新待办
- `DELETE /api/todo/{id}` - 删除待办
- `POST /api/todo/from-clip` - 剪藏转待办

### 专题管理

- `GET /api/topic/list` - 获取专题列表
- `POST /api/topic/create` - 创建专题
- `PUT /api/topic/{id}` - 更新专题
- `DELETE /api/topic/{id}` - 删除专题
- `GET /api/topic/{id}` - 获取专题详情
- `POST /api/topic/{id}/link-clip` - 关联剪藏到专题

### Git同步

- `GET /api/git/config` - 获取Git配置
- `POST /api/git/config` - 保存Git配置
- `POST /api/git/test-connection` - 测试Git连接
- `POST /api/git/sync` - 执行Git同步

### 模型配置

- `GET /api/model-config/list` - 获取模型配置列表
- `POST /api/model-config/save` - 保存模型配置
- `GET /api/model-config/prompts` - 获取Prompt配置
- `POST /api/model-config/prompts` - 保存Prompt配置

## 使用说明

### 1. 基本功能

#### 1.1 添加剪藏

- 在前端页面输入内容，支持文本输入和语音输入
- 选择剪藏类型：AI文本整理、只存储内容、链接AI解析整理、文档AI解析整理
- 输入来源地址，如：www.sspai.com
- 选择分类或使用默认的AI匹配分类
- 添加标签（手动输入或AI自动生成）
- 可粘贴图片或批量上传图片
- 点击"添加剪藏"按钮提交

#### 1.2 语音输入

- 点击麦克风图标，使用语音输入内容
- 支持中文语音识别
- 语音输入完成后会自动填充到内容输入框

#### 1.3 搜索剪藏

- 点击页面右上角的"切换到信息检索"按钮进入搜索模式
- 输入关键词进行搜索
- 可选择特定分类进行筛选
- 搜索结果按相关度排序显示

#### 1.4 查看剪藏

- 在剪藏列表中查看所有剪藏内容
- 每条剪藏显示摘要、类型、来源、分类和标签
- 点击展开按钮查看详细内容和AI分析结果
- 标签超过3个时显示+N，点击可展开查看所有标签

#### 1.5 发散性总结

- 点击剪藏条目下方的"发散性总结"按钮
- 系统会生成专家级分析，通过打字机效果展示结果
- 可复制生成的分析结果

### 2. 专题管理

#### 2.1 创建专题

- 进入专题列表页面，点击"新建专题"
- 填写专题标题、描述和关联分类
- 可选择AI辅助生成专题内容

#### 2.2 编辑专题

- 在专题详情页点击"编辑"进入Markdown编辑器
- 支持Markdown语法编辑，实时预览
- 可关联剪藏条目到专题

#### 2.3 专题详情

- 专题详情页支持分区展示内容
- 展示关联的剪藏条目列表
- 可跳转至剪藏详情查看原始内容

### 3. 待办时间线管理

#### 3.1 添加待办事项

- 在待办时间线页面添加新的待办
- 输入待办内容和截止日期
- 设置待办状态（进行中/已完成）
- 待办按截止日期升序排列

#### 3.2 剪藏转待办

- 在剪藏详情中点击"转为待办"按钮
- 自动关联原始剪藏内容
- 可在待办中查看关联的剪藏来源

#### 3.3 管理待办事项

- 点击复选框标记待办为已完成
- 点击删除按钮删除待办事项
- 已完成的待办会有明确的视觉标记

### 4. 内容整理与报告

#### 4.1 每日内容整理

- 点击"整理今日内容"按钮
- 系统会自动按分类组织当日剪藏内容
- 生成分类报告和每日剪藏日报
- 整理结果保存到配置的存储目录
- 如果配置了邮箱，会发送邮件通知

#### 4.2 收件箱整理

- 支持收件箱模式整理
- 将未分类内容通过AI智能归类
- 自动整合到对应分类中

#### 4.3 周报生成

- 点击"生成周报总结"按钮
- 系统会自动按分类组织本周剪藏内容
- 生成分类周报和知识库格式报告
- 周报结果保存到配置的存储目录
- 如果配置了邮箱，会发送邮件通知

### 5. Git同步功能

#### 5.1 Git配置

- 点击剪藏页面顶部的"⚙️ Git配置"按钮
- 在弹出的配置窗口中填写：
  - 远程仓库URL（GitHub/GitLab等仓库地址）
  - Git用户名
  - Git密码或访问令牌
  - 分支名称（默认：main）
- 点击"测试连接"按钮验证配置
- 点击"保存配置"按钮保存设置

#### 5.2 同步仓库

- 配置完成后，点击"🔄 同步仓库"按钮
- 系统会自动执行 git pull → add → commit → push
- 同步完成后会显示成功通知

#### 5.3 自动同步

- 在执行"整理今日内容"或"生成周报总结"后
- 系统会自动执行Git同步操作
- 确保内容变更及时推送到远程仓库

#### 5.4 配置持久化

- Git配置会自动保存到用户目录
- 重启应用后配置不会丢失
- 配置文件位置：`~/.clip-demo/git-config.json`

### 6. 多模型与系统设置

#### 6.1 模型配置

- 在设置页面可配置多个AI模型
- 支持DashScope（通义千问系列）和DeepSeek
- 可自定义API地址、模型名称、API Key
- 模型切换即时生效，无需重启

#### 6.2 Prompt配置

- 支持自定义各场景的AI提示词
- 场景包括：分析、总结、标签生成、发散性总结等
- 可根据需求调整Prompt模板

#### 6.3 LLM路由

- 支持按场景配置模型路由策略
- 不同任务可使用不同模型
- 支持模型自动分配

#### 6.4 主题切换

- 支持Notion风格主题和常规主题
- 一键切换，即时生效

#### 6.5 存储路径配置

- 在application.yml中可配置剪藏存储、整理存储和周报存储的路径
- 支持自定义存储位置

#### 6.6 邮件配置

- 在application.yml中配置邮件服务器信息
- 支持SMTP配置
- 用于发送日报和周报通知
- 如果未配置，系统会跳过邮件发送

### 7. 高级功能

#### 7.1 图片管理

- 支持直接粘贴图片到内容输入框
- 支持批量上传图片
- 图片会自动存储到配置的存储目录
- 在剪藏内容中会自动添加图片引用

#### 7.2 AI分类匹配

- 默认情况下，系统会通过AI分析内容并匹配最合适的分类
- 也可以手动选择分类
- 分类支持一级和二级分类

#### 7.3 来源地址管理

- 来源字段改为文本框输入
- 提示用户输入来源地址，如：www.sspai.com
- 支持任意来源地址的输入

#### 7.4 主题切换

- 支持Notion风格和常规风格两种主题
- 可在设置中切换，即时生效

## 注意事项

- 首次使用需要配置阿里云DashScope API Key
- 可选配置DeepSeek API Key以使用多模型功能
- 确保存储目录有读写权限
- 如需修改端口号，请在 `application.yml` 中修改 `server.port`
- 打包桌面应用时，确保 `prepare-jre.bat` 已成功下载JRE（或手动放置jre目录）
- 通过`.npmrc`已配置国内镜像，加速Electron下载

## 许可证

MIT License