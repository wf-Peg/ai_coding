# Roadmap — 长周期韧性

> Done / Current / Future 三视图。**只做链接索引**，不复制内容；详细规模一律回链 `TODO/` 目录或 HARNESS 记录，避免双份。
> 由用户/Agent 在里程碑收尾时更新；不需要天写。

> ⚠️ **本文件是「当前真相」层（compiled_truth）**：只写产品现状的最新共识，可重写、保持干净。公司的目标是「有意识地」移动的，不是悄悄漂走的——方向/状态变更须在主流程里同步更新本文件，重大变更随手附一条 devlog 落时间线。

## Done（已完成）

- 2026-09-16 搭建 HARNESS 开发闭环档案层 → [devlog DEV-2026-09-16-001](devlog/2026/2026-09-16-harness-layer.md)
- 2026-09-16 wiki 批量入库检索增强与 LLM 路由熔断 → [devlog DEV-2026-09-16-002](devlog/2026/2026-09-16-wiki-llm-circuit-breaker.md)

## Current（正做 / 队列中）

- 工作台自定义组件拼接 MVP（组件空渲染待修复） → [.trae/documents/工作台自定义组件拼接MVP设计.md](../.trae/documents/工作台自定义组件拼接MVP设计.md)
- 写作模块打磨（澄清「是否依赖 Obsidian 查看内容」的尴尬点） → 无独立文档，见会话记忆 2026-09-17
- 数据层重构与用户习惯聚合（TDD，L0 工作台只读骨架已完成） → [TODO/data-layer-refactor-and-habit-plan.md](../TODO/data-layer-refactor-and-habit-plan.md)
- 浏览器插件 MVP（首期：网页高亮标注） → 见项目记忆「浏览器插件 MVP 范围」

## Future（待做 / 已记入 backlog）

- 编辑区 AI 宠物图标优化 + 动作×状态机联动 → [TODO/pet-icon-redesign-and-state-machine.md](../TODO/pet-icon-redesign-and-state-machine.md)
- 编辑模块 AI 对话助手 + 宠物模块 → [TODO/editor-ai-chat-pet-design.md](../TODO/editor-ai-chat-pet-design.md)
- 后端 AI 中转站 / 自定义 API 地址（参考 ccswitch） → [TODO/ai-relay-provider-plan.md](../TODO/ai-relay-provider-plan.md)
- 明确缓做/不做：原生手机 App、微信助手、浏览器历史「后悔药」、搜索引擎注入、语音转写

## 关联

- 需求明细：`TODO/*.md`
- 开发日志：`devlog/_index.md`；Bug：`bugs/_index.md`；决策：`decisions/_index.md`