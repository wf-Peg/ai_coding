# CutShelter 数据层重构与用户习惯聚合开发计划

> 状态：按 TDD 分阶段实施  
> 更新日期：2026-08-02

## 目标

保留现有 JSON 业务数据和本地优先特性，新增可重建的统一索引、关系、项目和习惯统计层。该计划不建设 Agent 平台，不自动移动或修改用户数据。

## 重构顺序

1. **Phase 0：统一内容引用**
   - 定义 `ContentRef`、`ContentRelation` 和映射器。
   - 为剪藏、知识、待办、学习计划、编辑器文件建立稳定引用 ID。
   - 先兼容旧 JSON，不改变现有实体存储格式。
2. **Phase 1：只读内容索引**
   - 新增 `ContentIndexService`。
   - 扫描现有业务目录生成可重建索引。
   - 提供状态、重建和搜索接口。
3. **Phase 2：关系索引**
   - 统一 `sourceClipId` 和后续项目关系。
   - 支持来源链、反向查询和幂等关系写入。
4. **Phase 3：轻量项目模型**
   - 支持手动创建项目、加入内容、项目内搜索和默认偏好。
   - 不自动创建项目，不自动移动文件。
5. **Phase 4：用户行为事件**
   - 记录打开、编辑、保存、分类、标签、转换、项目关联等轻量事件。
   - 本地 JSONL，异步写入，默认保留 30～90 天。
6. **Phase 5：习惯画像**
   - 聚合常用分类、标签、目录、文件类型、动作和时间段。
   - 使用计数 + 时间衰减，不引入机器学习。
7. **Phase 6：项目聚合建议**
   - 根据标签、分类、目录、时间和连续操作生成可解释建议。
   - 用户确认后才建立项目关系，支持忽略和永久拒绝。

## 数据目录

```text
业务数据：{storagePath}/
  clip-storage/ todoList/ knowledge/ topic/ learning-plan/ vault/

应用索引：~/.cut-shelter/config/index/
  content-index.json
  relation-index.json
  project-index.json
  habit-profile.json
  action-events.jsonl
```

索引不是数据真相，损坏后必须可以通过业务目录重建。配置、行为数据和索引不得写入用户选择的业务数据目录之外的随机位置。

## TDD 约束

- 每个阶段先写失败测试，再实现最小代码。
- 映射、索引、关系和评分逻辑优先使用纯单元测试。
- 文件系统测试使用临时目录，不能读写用户真实数据。
- 重建操作必须幂等，失败不能影响编辑器和剪藏主流程。
- 自动建议必须包含原因、置信度、确认、忽略和永久拒绝状态。

## Phase 0 首批验收

- `clip:1001`、`knowledge:2001`、`todo:3001` 等引用 ID 稳定且类型明确。
- 标题、分类、标签、来源路径和创建时间能从现有实体正确映射。
- 缺失字段和旧 JSON 字段不会抛出异常。
- 相同实体重复映射结果一致。
- `ContentRef` 不携带正文，避免索引重复保存用户内容。

## 当前落地状态（2026-08-02）

已按上述顺序完成第一版可测试基础设施：

- Phase 0：`ContentRef`、实体映射器已覆盖剪藏、知识、待办、学习计划，稳定 ID 使用 `类型:id`。
- Phase 1：`ContentIndexService` 支持从 `FileStorageService` 扫描重建、去重和原子写入；原业务 JSON 仍是唯一数据源。
- Phase 2：`RelationIndexService` 支持关系幂等写入、来源/反向查询和删除。
- Phase 3：`ProjectIndexService` 支持项目保存、按项目 ID 更新、成员幂等加入和移除。
- Phase 4：`ActionEventService` 使用 JSONL 记录事件并支持按时间清理。
- Phase 5：`HabitProfileService` 聚合分类、标签、目录和动作计数；空元数据事件仍会统计动作。
- Phase 6：`ProjectSuggestionService` 基于分类、标签、目录、成员模式和习惯画像输出带原因的确定性评分，不自动建立关系。

对应测试位于 `backend/src/test/java/com/example/clip/index/`，覆盖映射、重建幂等、关系、项目成员、事件画像和建议解释性评分。后续接入业务时，应通过应用配置目录创建索引服务，并把事件写入放到不阻塞主流程的异步边界；建议分数低于产品阈值时只展示候选，不自动关联。
