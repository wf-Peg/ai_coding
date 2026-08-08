# 产品开发工作区 — 验收清单

## 前端验收

### 视图结构
- [ ] 侧边栏「产品开发」入口可见，点击可切换到产品开发视图
- [ ] 产品开发视图包含仪表盘、需求看板、知识图谱、甘特图、归档列表
- [ ] 切换回其他视图正常，不影响现有功能

### 仪表盘
- [ ] 统计卡片显示正确的数据（总需求、进行中、已完成、待办完成率）
- [ ] 环形图正确显示待办完成比例
- [ ] 折线图正确显示知识积累趋势
- [ ] 柱状图正确显示各阶段需求分布

### 需求看板
- [ ] 6 列看板正确显示各阶段需求
- [ ] 拖拽需求卡片可切换阶段
- [ ] 点击卡片显示需求详情弹窗
- [ ] 需求数量实时更新

### 知识图谱
- [ ] 力导向图正确显示节点和边
- [ ] 节点颜色区分类型
- [ ] 悬停显示详情
- [ ] 点击节点（可选）跳转

### 甘特图
- [ ] 正确显示需求的时间范围
- [ ] 里程碑标记可见
- [ ] 支持水平滚动查看完整时间线

### 样式
- [ ] 与现有工作台设计系统一致
- [ ] 响应式布局正常
- [ ] 暗色/亮色主题切换正常

---

## 后端验收

### 接口可用性
- [ ] `GET /api/workspace/product-dev/stats` 返回正确数据
- [ ] `GET /api/workspace/product-dev/todo-stats` 返回正确数据
- [ ] `GET /api/workspace/product-dev/knowledge-trend` 返回正确数据
- [ ] `GET /api/workspace/product-dev/phase-distribution` 返回正确数据
- [ ] `GET /api/workspace/product-dev/relation-graph` 返回正确数据
- [ ] `GET /api/workspace/product-dev/timeline` 返回正确数据
- [ ] `GET /api/workspace/product-dev/requirements` 返回需求列表
- [ ] `POST /api/workspace/product-dev/requirements` 创建需求成功
- [ ] `PUT /api/workspace/product-dev/requirements/{id}` 更新需求成功
- [ ] `DELETE /api/workspace/product-dev/requirements/{id}` 删除需求成功
- [ ] `POST /api/workspace/product-dev/archive` 归档成功
- [ ] `GET /api/workspace/product-dev/archive/list` 返回归档列表

### 数据持久化
- [ ] 需求数据正确写入 `{configDir}/index/product-dev.json`
- [ ] 数据读取正确
- [ ] 更新/删除后数据一致性

### 归档解析
- [ ] 启动时扫描 `~/.cutshelter/product-dev-archive.json`
- [ ] 正确解析归档数据
- [ ] 调用各 service 创建数据成功
- [ ] 已处理条目标记正确
- [ ] 处理日志记录完整

---

## Skill 验收

### Skill 定义
- [ ] `SKILL.md` 文件存在，内容完整
- [ ] 触发时机描述正确
- [ ] 数据格式规范完整

### 归档功能
- [ ] 归档文件写入路径正确
- [ ] 归档数据格式符合规范
- [ ] 剪藏、知识、待办、Wiki 字段映射正确

---

## agent.md 验收

### 文档更新
- [ ] 「产品开发工作区归档约束」章节已添加
- [ ] 归档触发时机描述正确
- [ ] 数据格式规范完整
- [ ] API 调用示例正确
- [ ] 不破坏现有约束规则

---

## 集成验收

### 前后端联调
- [ ] 前端所有图表数据来自后端 API
- [ ] 需求 CRUD 前端→后端→存储 链路正常
- [ ] 拖拽看板更新同步到后端

### 兼容性
- [ ] 现有工作台功能不受影响
- [ ] 现有 API 接口不受影响
- [ ] 现有数据文件不受影响

### 异常处理
- [ ] 后端服务不可用时有友好提示
- [ ] 数据格式错误时有日志记录
- [ ] 归档文件不存在时优雅降级

---

## 性能验收

### 加载速度
- [ ] 产品开发视图首次加载 < 2 秒
- [ ] 图表渲染 < 500ms
- [ ] 需求列表分页加载 < 1 秒

### 资源占用
- [ ] 图表库按需加载（CDN）
- [ ] 无内存泄漏（定时器正确清理）
- [ ] 后端接口响应 < 200ms（缓存优化）