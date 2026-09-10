# 对齐产品现状：产品开发归档 → TraeCode/DSH 迭代记录归档

## 摘要

产品「产品开发工作台/概览」的迭代记录如今由两路写入：**DSH clip-capture 插件（回答后自动）** 与将要新增的 **TraeCode 归档收尾**，皆落库到后端 `/api/workspace/feature-points/iterations/ai-session`（AI 提炼 title/problem/solution/outcome + source）。旧「写 TODO/feature-points.json + 后端 TODO 落库」流程的后端落库已硬禁用。本次：
1. 后端 `ai-session` 接口支持可配置 `source`（默认 `dsh-session`，不动 DSH 行为），TraeCode 可写 `trae-session`；
2. 前端按 `source` 区分并体现 TraeCode 来源（徽标/标签/过滤）；
3. 新增 TraeCode 归档收尾 skill，写入 agent.md 作为「完成任务后必执行」的收尾动作；
4. 重写 agent.md「产品开发归档」章节对齐现状；
5. 对两个旧 `product-dev-archive` / `product-dev-history-migrate` skill 做去留决策。

## 现状分析

- **后端旧代落库已禁**：[TodoScannerService.java#L103-L110](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/TodoScannerService.java#L103-L110) `scanAndImport()` 硬编码「扫描功能已禁用」。README 亦注明「被硬禁用且无调用方」。
- **概览页仍兼容旧树**：[workspace.js#L2065-L2066](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/workspace.js#L2065-L2066) 同时拉 `GET /api/workspace/feature-points`（读 TODO/*/feature-points.json）与 `.../iterations`（新迭代）。故旧 feature-points.json 的**展示消费仍存活**，只是 TODO→剪藏/待办的**自动落库已死**。
- **新代自动归档存续**：[clip-capture/index.mjs#L171-L222](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/integrations/dsh/plugins/clip-capture/index.mjs#L171-L222) 监听 DSH `turn/end(completed)` → POST `/iterations/ai-session`。`cordis.example.yml#L40-45` 已挂载。
- **存储层已支持任意 source**：[FeaturePointIterationService.add#L92-L97](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/service/FeaturePointIterationService.java#L92-L97) 用 `record.getOrDefault("source","manual")`。硬编码仅在 **WorkspaceController ai-session** 一处。
- **后端 ai-session 硬编码 source**：[WorkspaceController.java#L1176](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/backend/src/main/java/com/example/clip/controller/WorkspaceController.java#L1176) `record.put("source","dsh-session")`。
- **前端已按 source 区别人工归巢**：[workspace.js#L2507/L2521/L2778](file:///l:/归档/30_Projects%20(行动项目)/31_Work%20(主要工作)/code/ai_coding/frontend/js/workspace.js#L2507) —— `dsh-session`/`dsh-agent` 归为「牛马/AI 归档」，`isAi` 判定两处、徽标渲染两处。

## 决策与假设

- **新 source 取值**：`trae-session`（与 `dsh-session` 并列，语义「TraeCode 会话归档」）。显式归档由 clip_session 工具负责，TraeCode 收尾属于「自动/约定」路径，故不复用 `dsh-agent`。
- **后端向后兼容**：`ai-session` 的 `source` 仅当 body 显式给出且非空时生效，否则默认 `dsh-session` → DSH 既有行为不变。
- **前端归类**：将 `trae-session` 并入「牛马/AI 迭代」展示集合（`isAi` 判定处），另给 TraeCode 独立徽标文字/颜色/tooltip，避免与 DSH 混淆。
- **旧 skill 去留**：**保留文件、降级为遗留**。概览旧树仍读 feature-points.json + 存量迁移结果仍在展示，删除会破坏存量兼容且无必要。agent.md 不再要求「必须自动执行」，仅标注「遗留/存量兼容，非主线」。
- **归档主线**：新增 `trae-session-archive` skill 为 TraeCode 侧收尾，与 DSH 复用同一后端链，概览统一为迭代记录。
- **本次不动**：后端旧接口 `GET /api/workspace/feature-points` 与 FeaturePointsService（概览旧树仍需，解偶留待后续需求）。

## 改动清单

### 1. 后端 `WorkspaceController.java`（ai-session 支持 source）
- 文件：`backend/src/main/java/com/example/clip/controller/WorkspaceController.java#L1146-L1187`
- 改：方法开头读取可选 `source`：
  ```java
  String source = (String) body.get("source");
  if (source == null || source.isBlank()) source = "dsh-session";
  ```
- 改：L1176 `record.put("source","dsh-session")` → `record.put("source", source);`
- 不改 `FeaturePointIterationService`（已能持久化任意 source）。

### 2. 前端 `frontend/js/workspace.js`（按 source 区分展示）
- 在「牛马/AI 迭代」识别处（当前 `isAi`/filter，约 L2521、L2778）并入 `trae-session`：
  ```js
  const AI_SESSION_SOURCES = ['dsh-session','dsh-agent','trae-session'];
  ```
- 徽标渲染（L2507、L2780 附近）：按 source 分支 —— `dsh-*` 显示「牛马」，`trae-session` 显示「TraeCode」，tooltip 注明来源，如 `由 TraeCode 归档收尾（trae-session）`；颜色沿用现有 ai 徽标体系或新增一色以示区分。
- 新增/复用一处 source→文案映射（如 `trae-session: 'TraeCode'`），保证列表/详情/筛选一致体现。

### 3. 新增 skill `.trae/skills/trae-session-archive/SKILL.md`
- 目的：TraeCode 侧「归档收尾」——完成一段编码/研发任务后，把本会话成果提炼为一条产品概览迭代记录。
- 内容（遵循 SKILL.md 约定，frontmatter `name: trae-session-archive`）：
  - 说明：不写 TODO feature-points.json；改调后端 `POST /api/workspace/feature-points/iterations/ai-session`，body `{ conversation, project?, source: 'trae-session' }`。
  - `conversation` = 本会话用户需求 + AI 产出/决策的紧凑 Markdown 提炼（≤3000字，非原文粘贴），后端用强模型提炼四字段。
  - 何时调用：完成任务、验证通过、准备提交前调用一次；纯运维/闲聊不调用。
  - 失败容忍：接口异常仅记录，不阻塞正常交付。

### 4. `agent.md`（对齐现状）
- 文件：`agent.md#L160-L223`
- 将「## 产品开发归档」章节改为「## 归档与产品概览迭代」并重写，核心内容：
  1. **迭代记录两路写入**：
     - DSH：clip-capture 插件在 `turn/end` 后自动归档（source=dsh-session）。
     - TraeCode：完成任务后**必执行 `trae-session-archive` skill**（source=trae-session），调用 `/iterations/ai-session`。
     - 两者共用后端 AI 提炼 → 落 `feature-point-iterations.json` → product 概览展示。
  2. **旧链路已禁用/遗留**：后端 TODO/feature-points.json 自动落库（TodoScannerService）已禁用；概览页兼容展示既有 feature-points.json 旧树；`product-dev-archive`/`product-dev-history-migrate` 为遗留 skill，仅在有需维护既有 TODO 概览树/存量迁移时手动使用，**不再自动执行、不再作为主线**。
  3. 删除原先「每次完成需求后必须自动执行 product-dev-archive」的表述。

### 5. （如可行）`frontend/workspace.html`
- 若存在迭代记录图例/静态说明文案，补充 TraeCode 来源说明；否则跳过（以 js 动态渲染为准）。

## 验证

1. **后端编译**：`cd backend && mvn compile` 通过。
2. **source 生效**：后端启动后：
   - `curl -X POST /api/workspace/feature-points/iterations/ai-session -H 'Content-Type: application/json' -d '{"conversation":"测试","source":"trae-session"}'` → 响应中 `source=="trae-session"`。
   - 不传 source 再调一次 → `source=="dsh-session"`（回归 DSH 兼容）。
3. **前端区分**：产品概览页出现 TraeCode 来源的迭代记录，徽标/标签显示「TraeCode」，`feature-point-iterations.json` 对应记录含 `trae-session`。
4. **agent.md**：重读章节，确认与产品现状一致、不再出现「必须自动执行 product-dev-archive」。
5. **收尾 skill**：模拟一次会话后按 skill 说明调用，确认落库成功、不阻塞流程。

## 相关文件

- `backend/src/main/java/com/example/clip/controller/WorkspaceController.java`
- `frontend/js/workspace.js`（必要时 `frontend/workspace.html`）
- `.trae/skills/trae-session-archive/SKILL.md`（新增）
- `agent.md`