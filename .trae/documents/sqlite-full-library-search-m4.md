# SQLite 本地索引层（M4：全库统一搜索）实施计划

> 状态：Planned（待评审后按 M4.x 实施）
> 阶段：SQLite 本地索引层第四阶段
> 关联：`TODO/SQLite本地索引层M3（图谱关系层）/`、`sqlite-local-index-layer-clip-phase1.md`
> 目标：把本地全文检索从「仅 clip」扩展为「全库统一搜索」——跨 clip / knowledge / learning-plan 全部实体命中，返回统一类型化命中结果，前端可据此渲染统一搜索列表，进一步摆脱 Java 后端。

---

## 一、概述

M3 已把 knowledge / learning-plan 实体写入 `content` 表（与 clip 共用 FTS5 倒排）。因此**数据层已天然可检索全部实体**，但存在缺口：

1. `search()` 只反序列化 `content_ref` 原样返回，未带类型标记；前端 clip 搜索契约假定全是 clip。
2. `searchByCategory` 依赖 `category` 列，knowledge/learning-plan 一般无 category，不适合全库路径。
3. 无类型过滤能力、无统一命中视图。

本阶段新增**类型感知的全库统一搜索** `searchAll`，返回统一命中结构，同时保留原 clip `search`/`searchByCategory` 兼容既有调用。

## 二、范围（只做索引层 + 契约层）

- **search.js**：新增 `searchAll(query, { topK, type })`，覆盖全部实体类型，FTS + LIKE 双路径（两者都支持 type 过滤），返回 `{ type, id, title, snippet }[]`。
- **main.js**：新增 IPC `local-index:search-all`（`{ query, topK, type }`）。
- **preload.js**：暴露 `localIndex.searchAll(query, topK, type)`。
- **clip-shared.js**：apiClient 新增 `searchAll(query, opts)`（本地优先；无后端等价端点，仅本地承担，失败返回空 + 日志）。
- **测试**：`search.test.js` 覆盖跨实体命中、type 过滤、FTS/LIKE 双路径、统一结构；真实 Clip_Bed 数据验证。

## 三、统一命中结构

```json
{ "type": "clip|knowledge|learning-plan", "id": "knowledge:39", "title": "…", "snippet": "…" }
```

- `id` 直接用 `content.id`（M3 已统一为 `{type}:{source_id}`）。
- `title`：clip→title/body 截断；knowledge→title；learning-plan→goal。
- `snippet`：body_plain/摘要 截断 ~200 字。
- type 过滤：`type === 'all' | null` → 不限制；否则按 `content.type` 等值过滤。

## 四、实施步骤

| 步骤 | 内容 | 产出 |
|---|---|---|
| M4.1 | search.js 新增 searchAll（FTS+LIKE+type 过滤）+ toHit 统一结构 | `search.js` |
| M4.2 | main.js IPC `local-index:search-all` + preload 桥接 | `main.js`、`preload.js` |
| M4.3 | apiClient.searchAll（本地优先） | `clip-shared.js` |
| M4.4 | search.test.js 单测 + 真实数据验证 + 回归 | `search.test.js` |

## 五、验证标准

- 单测覆盖：跨类型命中、type 过滤、中文 LIKE 兜底、统一命中字段。
- 真实 Clip_Bed：关键词能同时命中 clip 与 knowledge/learning-plan（示例验证）。
- 全量回归：SQLite 单测 + editor 测试无回归。