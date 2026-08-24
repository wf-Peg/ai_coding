# 产品开发工作台 — 验收清单（MVP 重写）

> 本文档与 `spec.md`（MVP 重写版）、`tasks.md` 配套。验收项聚焦：Agent 归档链路 → 后端扫描落库 → 工作台规则展示。

## 后端验收

### 扫描落库（TodoScannerService）
- [ ] 启动时扫描 TODO 目录，解析 `feature-points.json`
- [ ] `requirement` 对象正确解析（title/summary/tags/phase），缺失时降级为目录名不抛异常
- [ ] 剪藏创建成功：category 取自 clipDef.category 或 config.clipCategory，标签含 `product-dev`
- [ ] 剪藏内容来自 `contentFile` 指向的 md 文件；`section` 指定时按章节截取
- [ ] 待办创建成功：`status: "done"` 正确映射为已完成
- [ ] 待办 category 取自 config.todoCategory
- [ ] 剪藏/待办均带有 `product-dev` 标签或分类，可被工作台规则命中

### 重复导入防护
- [ ] 首次导入后写入 `.imported`（JSON：importedAt + featurePointIds）
- [ ] 二次启动不重复导入（按 featurePoints[].id 幂等）
- [ ] 新增功能点后重启，仅增量导入新增功能点
- [ ] 旧版纯文本 `.imported` 解析失败时降级为全新导入，不崩溃

### 配置
- [ ] `application_templete.yml` 含 `product-dev.todo-dir`
- [ ] Electron `generateApplicationYml()` 输出含 `product-dev.todo-dir`

## 内置工作台验收

- [ ] 首次启动自动创建 `pd-builtin` 工作台（name=产品开发、color=#2383e2、type=project）
- [ ] 三条内置规则存在：`tag equals product-dev`、`type in clip,todo`、`category contains product-dev`
- [ ] 二次启动不重复创建，规则缺失时自动补齐
- [ ] 仅存在一个初始化器（无重复扫描）
- [ ] `Workspace.TYPES` 不含 product-dev（复用 project 类型）

## 前端验收

### 视图结构
- [ ] 产品开发视图在 `.main-area` 内部，不遮挡侧边栏
- [ ] 侧边栏「产品开发」入口可见可点击，切换正常
- [ ] 移动端汉堡按钮可打开侧边栏抽屉
- [ ] 返回「全部概览」/其他工作台正常

### 数据展示
- [ ] 产品开发视图数据来自 `/api/workspace/pd-builtin/resolve`（非 `/api/product-dev/*`）
- [ ] 导入的剪藏和待办在产品开发视图可见
- [ ] 知识图谱、甘特图 tab 已隐藏
- [ ] 标签筛选按 resolve 结果本地过滤，子视图联动
- [ ] 页面无控制台报错

## Skill 验收

### product-dev-archive
- [ ] SKILL.md 中 feature-points.json 字段约定与后端解析器一致（contentFile/title/category/status）
- [ ] 归档时机描述正确（子任务完成时增量归档）

### product-dev-history-migrate
- [ ] 生成的 feature-points.json 可被后端正确导入
- [ ] 存量目录迁移后不重复导入

## 集成验收

- [ ] 全链路走通：构造最小 feature-points.json → 启动后端 → 剪藏/待办落库 → pd-builtin 规则命中 → 前端可见
- [ ] 再次启动幂等跳过
- [ ] 修改 json 新增功能点后增量导入生效
- [ ] 现有剪藏/待办/工作台功能不受影响
- [ ] `mvn test` 后端测试通过

## 文档验收

- [ ] spec.md / tasks.md / checklist.md 三方一致（MVP 版本）
- [ ] `todo-directory-specification.md` 的 `.imported` 格式与实际实现一致
- [ ] `product-dev-workspace-builtin-rules.md` 规则与代码一致
- [ ] agent.md 归档约束与 SKILL.md 一致
- [ ] 审阅评估文档中列出的阻断级问题均已关闭
