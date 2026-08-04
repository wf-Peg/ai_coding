# L2 规则与排除 Controller 接口规格

## Why
L2 的规则筛选、排除优先和 Workspace 统一解析逻辑已经完成，但尚未通过 HTTP 暴露给工作台页面。需要提供稳定、可验证的 Controller 接口，让前端管理规则、排除内容并读取统一解析结果。

## What Changes
- 扩展现有 `WorkspaceController`，新增规则管理、排除管理和解析结果接口。
- 沿用现有 `/api/workspace` 路径：`/api/workspace/{workspaceId}/rules`、`/exclusions`、`/resolution`。
- 规则请求只接收 field、operator、value、enabled；workspaceId 从路径补充，id 和时间由服务端生成/维护。
- 排除请求只接收 contentId、reason；workspaceId、时间由服务端补充。
- 统一返回 `{status,message}` 错误结构，参数错误 400、工作台不存在 404、索引读写失败 503。
- 解析接口读取 ContentIndexService 的引用并调用 WorkspaceIndexService.resolveWorkspace，不返回内容正文。

## API Contract

### Rules
- `GET /api/workspace/{workspaceId}/rules`：返回该工作台规则列表。
- `POST /api/workspace/{workspaceId}/rules`：创建规则，返回 201 和规则对象。
- `PUT /api/workspace/{workspaceId}/rules/{ruleId}`：更新规则，返回 200 和规则对象；路径 id 不存在时返回 404。
- `DELETE /api/workspace/{workspaceId}/rules/{ruleId}`：删除规则，返回 204。

请求示例：
```json
{
  "field": "tag",
  "operator": "contains",
  "value": "Java",
  "enabled": true
}
```

### Exclusions
- `GET /api/workspace/{workspaceId}/exclusions`：返回排除列表。
- `POST /api/workspace/{workspaceId}/exclusions`：创建或幂等更新排除，返回 201 和排除对象。
- `DELETE /api/workspace/{workspaceId}/exclusions/{contentId}`：移除排除，返回 204。

请求示例：
```json
{
  "contentId": "clip:1",
  "reason": "已处理"
}
```

### Resolution
- `GET /api/workspace/{workspaceId}/resolution`：返回解析结果，包含可见内容元数据和规则命中、手动加入、关系带入、排除、最终可见数量；不返回正文。
- `relationMembers` 本阶段不从 HTTP 接收，Controller 传入空集合；后续关系索引接入时保持 Service 接口不变。

## ADDED Requirements
### Requirement: 规则管理
系统 SHALL 提供规则的列表、新增、更新和删除接口，所有写操作必须委托 `WorkspaceRuleService`，不得由 Controller 直接操作 JSON 文件。

#### Scenario: 新增规则
- **WHEN** 用户向工作台规则端点提交合法 field、operator、value、enabled
- **THEN** 服务端补充工作台归属和时间字段，持久化规则并返回规则对象

### Requirement: 排除管理
系统 SHALL 提供排除记录的列表、新增和删除接口，新增操作保持同工作台同 contentId 幂等。

#### Scenario: 排除内容
- **WHEN** 用户提交 contentId 和 reason
- **THEN** 内容被加入工作台排除列表，并从后续解析结果中消失

### Requirement: 工作台解析结果
系统 SHALL 提供工作台解析结果接口，并统一调用 `WorkspaceIndexService.resolveWorkspace`；返回引用元数据，不得返回 `ContentRef.content`。

#### Scenario: 查询解析结果
- **WHEN** 用户请求一个存在的工作台解析结果
- **THEN** 返回可见内容和来源统计，且排除优先规则生效

### Requirement: 错误隔离
系统 SHALL 将参数错误、工作台不存在和索引读写失败分别映射为 400、404、503，并统一返回 `{status,message}`。

#### Scenario: 工作台不存在
- **WHEN** 请求不存在的工作台规则或解析结果
- **THEN** 返回 404 和不含敏感详情的错误消息

## MODIFIED Requirements
### Requirement: 工作台 Controller
现有 `/api/workspace/overview` 行为保持兼容；新增接口不得改变只读 overview 的响应结构和正文不泄露约束。

## OUT OF SCOPE
- 工作台创建、更新、删除 HTTP 接口。
- 手动成员 HTTP 接口。
- 前端页面实现。
- 关系索引 HTTP 接入。


## 当前落地状态（2026-08-05）
- 本规格对应的后端 Controller 接口阶段已完成并通过定向、全量测试。
- 前端规则管理、排除管理和解析结果页面仍属于后续开发范围。
