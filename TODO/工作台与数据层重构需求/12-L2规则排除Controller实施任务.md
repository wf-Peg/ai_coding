# L2 规则与排除 Controller 实施任务

- [x] Task 1: 建立 Controller 请求与响应模型
  - [x] 定义规则请求、排除请求和统一错误响应结构。
  - [x] 保证请求模型不允许客户端覆盖 workspaceId、id 和时间字段。

- [x] Task 2: 实现规则管理接口
  - [x] 先编写 MockMvc 或 Controller 定向失败测试。
  - [x] 实现规则列表、新增、更新和删除。
  - [x] 将路径 workspaceId 注入规则并生成/维护时间字段。

- [x] Task 3: 实现排除管理与解析接口
  - [x] 实现排除列表、新增/幂等更新和删除。
  - [x] 实现解析结果接口并返回元数据与来源统计，不返回正文。
  - [x] 统一调用 WorkspaceIndexService，不在 Controller 重复实现规则逻辑。

- [x] Task 4: 实现错误映射与回归验证
  - [x] 参数错误返回 400，工作台不存在返回 404，索引失败返回 503。
  - [x] 保持 `/api/workspace/overview` 兼容。
  - [x] 运行 Controller 定向测试、后端全量测试和编译。
  - [x] 更新主线文档与验收清单，提交并推送远程。
  - [x] 明确前端规则配置、排除操作和解析结果展示仍待开发。

# Task Dependencies
- Task 2 依赖 Task 1。
- Task 3 依赖 Task 1 和 Task 2。
- Task 4 依赖 Task 2 和 Task 3。
