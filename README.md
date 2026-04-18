# 信息检索与剪藏系统

一个基于Spring Boot和Alibaba DashScope API的信息检索与剪藏系统，支持文件选择、浏览器复制、剪藏、AI分析、信息整理等功能。

## 功能特性

- ✅ 文件选择与剪藏
- ✅ 浏览器内容复制剪藏
- ✅ AI分析与标签生成
- ✅ 信息检索（关键词搜索）
- ✅ 每日内容整理与邮件通知
- ✅ 每周内容周报与邮件通知
- ✅ 语音输入
- ✅ 发散性总结
- ✅ Markdown渲染
- ✅ 本地文件存储与分类
- ✅ 图片上传与管理
- ✅ AI分类匹配
- ✅ 来源地址输入

## 技术栈

- **后端**：Spring Boot 3.2.0, Spring AI, Alibaba DashScope API
- **前端**：HTML5, CSS3, JavaScript, Marked.js (Markdown渲染)
- **存储**：本地文件系统

## 快速开始

### 1. 环境要求

- JDK 17+
- Maven 3.6+
- 现代浏览器

### 2. 配置步骤

#### 2.1 配置API Key

1. 复制 `backend/src/main/resources/application_templete.yml` 文件为 `application.yml`
2. 打开 `application.yml` 文件，填写以下配置：

   ```yaml
   spring:
     ai:
       dashscope:
         api-key: your-dashscope-api-key  # 替换为你的阿里云DashScope API Key
   ```

3. 可选：调整存储目录路径和邮件配置

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
       host: smtp.qq.com  # 邮件服务器
       port: 587
       username: your-email@example.com  # 发件人邮箱
       password: your-email-password  # 邮箱密码或授权码
       properties:
         mail:
           smtp:
             auth: true
             starttls:
               enable: true
   ```

### 3. 源代码安装启动

#### 3.1 启动后端服务

```bash
# 进入后端目录
cd backend

# 编译项目
mvn clean package

# 运行服务
mvn spring-boot:run
```

后端服务将在 `http://localhost:8080` 启动。

#### 3.2 启动前端服务

```bash
# 进入前端目录
cd frontend

# 使用Python启动简单HTTP服务器
python3 -m http.server 3000
```

前端服务将在 `http://localhost:3000` 启动。

### 4. 打包文件使用

#### 4.1 构建打包文件

```bash
# 进入后端目录
cd backend

# 构建可执行JAR包
mvn clean package -DskipTests
```

生成的JAR包位于 `backend/target/clip-demo-0.0.1-SNAPSHOT.jar`。

#### 4.2 使用打包文件启动

1. 将 `application_templete.yml` 复制为 `application.yml` 并配置API Key
2. 将JAR包和 `application.yml` 放在同一目录
3. 执行以下命令启动服务：

   ```bash
   java -jar clip-demo-0.0.1-SNAPSHOT.jar
   ```

4. 前端文件可以直接部署到任何静态文件服务器，如Nginx、Apache等。

## 项目结构

```
clip-demo/
├── backend/           # 后端代码
│   ├── src/           # 源代码
│   │   └── main/      # 主代码
│   │       ├── java/  # Java源码
│   │       └── resources/  # 配置文件
│   └── pom.xml        # Maven配置
├── frontend/          # 前端代码
│   ├── index.html     # 主页面
│   └── assets/        # 静态资源
├── README.md          # 项目说明
└── .gitignore         # Git忽略配置
```

## API接口

- `POST /api/clip/add` - 添加剪藏
- `GET /api/clip/list` - 获取剪藏列表
- `DELETE /api/clip/{id}` - 删除剪藏
- `GET /api/clip/divergent-summary/{id}` - 获取发散性总结
- `POST /api/clip/organize` - 整理内容
- `GET /api/clip/organize/status` - 获取整理状态
- `GET /api/clip/search` - 搜索剪藏
- `POST /api/clip/weekly-report` - 生成周报
- `GET /api/clip/image/{category}/{fileName}` - 访问图片
- `POST /api/clip/open-storage-folder` - 打开存储目录

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

### 2. 内容整理与报告

#### 2.1 每日内容整理
- 点击"整理今日内容"按钮
- 系统会自动按分类组织当日剪藏内容
- 生成分类报告和每日剪藏日报
- 整理结果保存到配置的存储目录
- 如果配置了邮箱，会发送邮件通知

#### 2.2 周报生成
- 点击"生成周报总结"按钮
- 系统会自动按分类组织本周剪藏内容
- 生成分类周报和知识库格式报告
- 周报结果保存到配置的存储目录
- 如果配置了邮箱，会发送邮件通知

### 3. 高级功能

#### 3.1 图片管理
- 支持直接粘贴图片到内容输入框
- 支持批量上传图片
- 图片会自动存储到配置的存储目录
- 在剪藏内容中会自动添加图片引用

#### 3.2 AI分类匹配
- 默认情况下，系统会通过AI分析内容并匹配最合适的分类
- 也可以手动选择分类
- 分类支持一级和二级分类

#### 3.3 来源地址管理
- 来源字段改为文本框输入
- 提示用户输入来源地址，如：www.sspai.com
- 支持任意来源地址的输入

#### 3.4 存储路径配置
- 在application.yml中可配置剪藏存储、整理存储和周报存储的路径
- 支持自定义存储位置

### 4. 系统管理

#### 4.1 邮件配置
- 在application.yml中配置邮件服务器信息
- 支持SMTP配置
- 用于发送日报和周报通知
- 如果未配置，系统会跳过邮件发送

#### 4.2 存储管理
- 系统会自动创建存储目录结构
- 按分类和日期组织文件
- 支持备份和迁移存储数据

#### 4.3 错误处理
- 系统会记录详细的错误日志
- 前端会显示友好的错误提示
- 邮件发送失败不会影响报告生成

## 注意事项

- 首次使用需要配置阿里云DashScope API Key
- 确保存储目录有读写权限
- 如需修改端口号，请在 `application.yml` 中修改 `server.port`

## 许可证

MIT License