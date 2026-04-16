# 剪藏功能增强 - The Implementation Plan (Decomposed and Prioritized Task List)

## [x] Task 1: Git操作功能实现
- **Priority**: P0
- **Depends On**: None
- **Description**: 
  - 在后端添加Git命令执行的Controller和Service
  - 在前端添加Git推送和同步按钮
  - 实现Git操作状态反馈
- **Acceptance Criteria Addressed**: [AC-1]
- **Test Requirements**:
  - `programmatic` TR-1.1: 后端Git命令执行API返回正确的执行结果
  - `programmatic` TR-1.2: 前端按钮点击能够触发后端API调用
  - `human-judgement` TR-1.3: 操作结果和状态在界面上清晰显示
- **Notes**: 需要处理Git命令执行失败的情况，提供友好的错误提示

## [x] Task 2: 待办事项时间线功能（后端部分）
- **Priority**: P0
- **Depends On**: None
- **Description**: 
  - 创建待办事项数据模型
  - 实现待办事项的CRUD API
  - 实现待办事项按日期存储到todoList目录
- **Acceptance Criteria Addressed**: [AC-2]
- **Test Requirements**:
  - `programmatic` TR-2.1: 待办事项能够正确保存和读取
  - `programmatic` TR-2.2: 待办事项数据存储在正确的目录位置
  - `programmatic` TR-2.3: 待办事项API返回按截止日期排序的数据
- **Notes**: 待办事项数据格式使用JSON数组存储

## [x] Task 3: 待办事项时间线功能（前端部分）
- **Priority**: P0
- **Depends On**: Task 2
- **Description**: 
  - 在页面左侧添加待办事项时间线UI组件
  - 实现截止日期和待办事项的填空式填写表单
  - 实现垂直时间线展示和同一天内容的归档功能
- **Acceptance Criteria Addressed**: [AC-2]
- **Test Requirements**:
  - `programmatic` TR-3.1: 前端表单能够正确提交待办事项
  - `human-judgement` TR-3.2: 时间线UI美观且响应式
  - `human-judgement` TR-3.3: 同一天的待办事项能够正确归档显示
- **Notes**: 时间线设计需要与现有UI风格保持一致

## [x] Task 4: Obsidian兼容标签格式优化
- **Priority**: P1
- **Depends On**: None
- **Description**: 
  - 修改ContentOrganizeService中的标签生成逻辑
  - 实现`tag:#java`格式的独立标签展示
- **Acceptance Criteria Addressed**: [AC-3]
- **Test Requirements**:
  - `programmatic` TR-4.1: 生成的Markdown文件中标签格式正确
  - `programmatic` TR-4.2: 保持与现有标签功能的兼容性
- **Notes**: 需要测试Obsidian中标签的显示效果

## [x] Task 5: 周报总结功能（后端部分）
- **Priority**: P0
- **Depends On**: None
- **Description**: 
  - 创建周报总结Service
  - 实现最近7天剪藏内容的读取和解析
  - 实现知识点拆分和双链引用逻辑
  - 实现文件存储到weeklyReport目录
- **Acceptance Criteria Addressed**: [AC-4]
- **Test Requirements**:
  - `programmatic` TR-5.1: 能够正确读取最近7天的剪藏内容
  - `programmatic` TR-5.2: 知识点能够正确拆分和生成双链引用
  - `programmatic` TR-5.3: 文件正确存储到weeklyReport目录
- **Notes**: 参考日报的拼接整理逻辑

## [x] Task 6: 周报总结功能（前端部分）
- **Priority**: P0
- **Depends On**: Task 5
- **Description**: 
  - 添加周报总结按钮
  - 实现周报生成状态反馈
  - 显示周报生成结果
- **Acceptance Criteria Addressed**: [AC-4]
- **Test Requirements**:
  - `programmatic` TR-6.1: 前端按钮能够正确触发周报生成API
  - `human-judgement` TR-6.2: 生成状态和结果清晰显示
- **Notes**: 按钮位置和样式需要与现有UI协调

## [x] Task 7: 集成测试和验证
- **Priority**: P1
- **Depends On**: Task 1, Task 3, Task 4, Task 6
- **Description**: 
  - 对所有新功能进行集成测试
  - 验证与现有功能的兼容性
  - 性能测试和优化
- **Acceptance Criteria Addressed**: [AC-1, AC-2, AC-3, AC-4]
- **Test Requirements**:
  - `programmatic` TR-7.1: 所有API端点正常工作
  - `human-judgement` TR-7.2: 整体用户体验流畅
  - `programmatic` TR-7.3: 性能符合NFR要求
- **Notes**: 重点测试Git操作、待办事项和周报功能的协同工作
