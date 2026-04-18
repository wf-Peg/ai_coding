# 待办事项存储实现计划

## 项目现状分析

当前项目已经实现了：
- 前端待办事项时间线页面（todo.html）
- 后端基础架构
- 剪藏功能的存储实现

剪藏的存储实现：
- 剪藏内容以JSON格式存储在本地文件系统，按分类和日期组织
- 存储路径：`./clip-storage/{category}/{date}.json`
- 整理结果：存储在`./clip-organized/{category}/{date}.md`

## 实现目标

实现待办事项的真实数据存储，参考剪藏的存储方式：
1. 在`./clip-storage/`与`./clip-organized/`下分别增加todolist目录
2. 待办事项存储按照剪藏的只存储正文的方式
3. 实体所包含的所有字段按照a字段+'/'+b字段的方式拼接存储作为正文与摘要
4. 其他逻辑基本一致

## 技术方案

### 1. 数据模型设计

创建待办事项数据模型，包含以下字段：
- id: 唯一标识符
- title: 待办事项标题
- priority: 优先级（high/medium/low）
- deadline: 截止日期
- completed: 完成状态
- createdAt: 创建时间
- category: 分类

### 2. 存储结构设计

- **存储路径**：`./clip-storage/todolist/{date}.json`
- **整理结果**：存储在`./clip-organized/todolist/{date}.md`
- **存储格式**：JSON格式，按日期组织

### 3. 后端实现

1. **创建TodoContent模型类**
2. **创建TodoService服务类**
3. **创建TodoController控制器类**
4. **实现FileStorageService中的待办事项存储方法**
5. **实现待办事项的CRUD操作**

### 4. 前端实现

1. **修改todo.html中的API调用**
2. **实现待办事项的添加、编辑、删除功能**
3. **实现待办事项的状态更新**
4. **实现待办事项的过滤功能**

### 5. 存储逻辑

- 待办事项实体的所有字段按照`字段名/字段值`的方式拼接存储作为正文与摘要
- 例如：`title/完成项目方案设计 priority/high deadline/2026-04-20 completed/false`
- 存储为JSON格式，按日期组织

## 实现步骤

1. **创建数据模型** - 创建TodoContent模型类
2. **实现存储服务** - 在FileStorageService中添加待办事项存储方法
3. **实现业务逻辑** - 创建TodoService服务类
4. **实现API接口** - 创建TodoController控制器类
5. **修改前端代码** - 更新todo.html中的API调用
6. **测试功能** - 测试待办事项的CRUD操作
7. **验证存储** - 验证待办事项是否正确存储到指定目录

### 6. 具体实现细节

#### 6.1 后端实现

1. **TodoContent模型类**
   - 包含id、title、priority、deadline、completed、createdAt、category字段
   - 提供构造函数和getter/setter方法

2. **FileStorageService**
   - 添加saveTodo方法
   - 添加getAllTodos方法
   - 添加getTodosByDate方法
   - 添加deleteTodo方法

3. **TodoService**
   - 实现待办事项的业务逻辑
   - 调用FileStorageService进行存储操作

4. **TodoController**
   - 实现REST API接口
   - 处理前端的请求

#### 6.2 前端实现

1. **修改API调用**
   - 更新todo.html中的API调用地址
   - 实现待办事项的添加、编辑、删除功能

2. **实现状态管理**
   - 实现待办事项的状态更新
   - 实现待办事项的过滤功能

3. **测试功能**
   - 测试待办事项的CRUD操作
   - 验证待办事项是否正确存储

### 7. 风险评估

- **存储路径问题** - 需要确保todolist目录正确创建
- **数据格式问题** - 需要确保待办事项数据格式正确
- **API接口问题** - 需要确保前端API调用正确
- **兼容性问题** - 需要确保与现有剪藏功能兼容

### 8. 测试计划

1. **功能测试** - 测试待办事项的CRUD操作
2. **存储测试** - 验证待办事项是否正确存储到指定目录
3. **API测试** - 测试前端API调用是否正确
4. **兼容性测试** - 测试与现有剪藏功能的兼容性

### 9. 预期效果

- 待办事项数据真实存储到本地文件系统
- 存储路径：`./clip-storage/todolist/{date}.json`
- 整理结果：存储在`./clip-organized/todolist/{date}.md`
- 前端可以正常添加、编辑、删除待办事项
- 前端可以正常更新待办事项的状态
- 前端可以正常过滤待办事项

### 10. 交付物

- TodoContent模型类
- FileStorageService中的待办事项存储方法
- TodoService服务类
- TodoController控制器类
- 更新后的todo.html前端页面
- 待办事项存储目录结构

## 注意事项

- 确保待办事项的存储路径正确创建
- 确保待办事项数据格式正确
- 确保前端API调用正确
- 确保与现有剪藏功能兼容
- 确保待办事项的字段拼接格式正确（a字段+'/'+b字段）