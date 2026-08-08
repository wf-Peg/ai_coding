# 产品开发工作区 — 实施任务

## 任务 1：前端视图改造（workspace.html）

### 1.1 侧边栏新增「产品开发」入口
- [ ] 在 `sidebar-nav` 中新增 `data-view="product-dev"` 按钮
- [ ] 添加点击事件切换到产品开发视图
- [ ] 更新导航高亮逻辑

### 1.2 产品开发视图 HTML 结构
- [ ] 新增 `product-dev-view` 容器
- [ ] 实现仪表盘区域（统计卡片 + 图表容器）
- [ ] 实现需求看板区域（6 列 Kanban）
- [ ] 实现知识图谱容器
- [ ] 实现甘特图区域
- [ ] 实现归档列表区域

### 1.3 数据可视化组件
- [ ] 引入 Chart.js CDN
- [ ] 实现统计卡片渲染
- [ ] 实现环形图（待办完成率）
- [ ] 实现折线图（知识积累趋势）
- [ ] 实现柱状图（各阶段分布）
- [ ] 引入 D3.js CDN 实现力导向图
- [ ] 实现甘特图（纯 CSS/SVG）

### 1.4 交互逻辑
- [ ] 需求看板拖拽切换阶段
- [ ] 需求卡片点击显示详情弹窗
- [ ] 知识图谱悬停显示详情
- [ ] 甘特图缩放到时间范围

### 1.5 样式
- [ ] 产品开发视图样式（仪表盘卡片、看板、图表等）
- [ ] 响应式适配
- [ ] 与现有主题系统一致

---

## 任务 2：后端 API（Java）

### 2.1 创建 ProductDevController
- [ ] 新建 `ProductDevController.java`，路径 `/api/workspace/product-dev`
- [ ] 实现统计接口 `GET /stats`
- [ ] 实现待办统计接口 `GET /todo-stats`
- [ ] 实现知识趋势接口 `GET /knowledge-trend`
- [ ] 实现阶段分布接口 `GET /phase-distribution`
- [ ] 实现关系图接口 `GET /relation-graph`
- [ ] 实现时间线接口 `GET /timeline`
- [ ] 实现需求 CRUD 接口
- [ ] 实现归档接口 `POST /archive`
- [ ] 实现归档列表接口 `GET /archive/list`

### 2.2 创建 ProductDevService
- [ ] 新建 `ProductDevService.java`
- [ ] 实现需求 CRUD 方法
- [ ] 实现统计数据聚合方法
- [ ] 实现归档文件解析方法
- [ ] 实现与 ClipService、KnowledgeService、TodoService 的联动

### 2.3 创建 ProductDevRequirement 模型
- [ ] 新建 `ProductDevRequirement.java` 模型类
- [ ] 定义所有字段（id, title, description, phase, priority, tags, relatedIds, timeline, milestones, archive 等）
- [ ] 集成 FileStorageService 持久化

### 2.4 创建 ProductDevArchiveService
- [ ] 新建 `ProductDevArchiveService.java`
- [ ] 实现启动时扫描归档文件
- [ ] 实现解析并调用各 service 创建数据
- [ ] 实现已处理条目标记
- [ ] 实现处理日志记录

---

## 任务 3：产品开发工作区归档 Skill

### 3.1 创建 Skill 目录结构
- [ ] 创建 `.trae/skills/product-dev-archive/` 目录
- [ ] 创建 `SKILL.md` 定义文件
- [ ] 创建 `template.json` 归档模板

### 3.2 Skill 逻辑实现
- [ ] 定义归档文件路径 `~/.cutshelter/product-dev-archive.json`
- [ ] 定义数据格式（剪藏/知识/待办/Wiki 的字段映射）
- [ ] 实现写入逻辑
- [ ] 实现后端 API 调用逻辑

---

## 任务 4：agent.md 更新

### 4.1 追加归档约束
- [ ] 添加「产品开发工作区归档约束」章节
- [ ] 描述归档触发时机
- [ ] 描述数据格式规范
- [ ] 提供剪藏/知识/待办/Wiki 的 API 调用示例

---

## 任务 5：集成测试

### 5.1 前端测试
- [ ] 产品开发视图加载正常
- [ ] 图表渲染正常
- [ ] 需求看板拖拽正常
- [ ] 响应式布局正常

### 5.2 后端测试
- [ ] 所有 API 接口返回正确状态码
- [ ] 数据存储读取正常
- [ ] 归档解析正常

### 5.3 集成测试
- [ ] 前端调用后端 API 正常
- [ ] Skill 归档文件写入正常
- [ ] 后端解析归档文件正常
- [ ] 不破坏现有功能