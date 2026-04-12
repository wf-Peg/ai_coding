# 信息检索与剪藏系统

一个基于Spring Boot和Alibaba DashScope API的信息检索与剪藏系统，支持文件选择、浏览器复制、剪藏、AI分析、信息整理等功能。

## 功能特性

- ✅ 文件选择与剪藏
- ✅ 浏览器内容复制剪藏
- ✅ AI分析与标签生成
- ✅ 信息检索（关键词搜索）
- ✅ 每日内容整理
- ✅ 语音输入
- ✅ 发散性总结
- ✅ Markdown渲染
- ✅ 本地文件存储与分类

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

3. 可选：调整存储目录路径

   ```yaml
   clip:
     storage:
       path: ./clip-storage  # 剪藏文件存放目录
     organized-storage:
       path: ./clip-organized  # 总结文件存放目录
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

- `POST /api/clip` - 添加剪藏
- `GET /api/clip` - 获取剪藏列表
- `DELETE /api/clip/{id}` - 删除剪藏
- `GET /api/clip/{id}/summary` - 获取发散性总结
- `GET /api/organize` - 整理内容
- `GET /api/organize/status` - 获取整理状态
- `GET /api/search` - 搜索剪藏

## 使用说明

1. **添加剪藏**：在前端页面输入内容，选择分类，点击"添加剪藏"按钮
2. **语音输入**：点击麦克风图标，使用语音输入内容
3. **搜索剪藏**：点击切换按钮，进入搜索模式，输入关键词搜索
4. **查看剪藏**：在剪藏列表中查看所有剪藏内容
5. **发散性总结**：点击剪藏条目下方的"发散性总结"按钮，生成专家级分析
6. **整理内容**：点击"整理今日内容"按钮，系统会自动整理内容并生成Markdown文件

## 注意事项

- 首次使用需要配置阿里云DashScope API Key
- 确保存储目录有读写权限
- 如需修改端口号，请在 `application.yml` 中修改 `server.port`

## 许可证

MIT License