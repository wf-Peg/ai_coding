# 内置"产品功能学习"学习计划 — 实施计划

## 一、目标概述

在**学习计划模块**新增一个系统默认自带的 `产品功能学习` 学习计划，把产品说明书嵌入学习模块：

- 按学习顺序组织多个阶段，内容覆盖：**架构概述、使用说明（浏览器插件说明、系统右键说明、快捷键说明）、使用技巧（产出结果配合 Obsidian、省 token、提示词技巧）**，细化到每个功能按钮。
- 每阶段（学习计划展示的说明）可唤起**弹窗渲染 Markdown 内容**。
- 预计学习时间显示 **∞**（无穷号）。
- 内置计划**不可删除**（用户已确认）。
- 每阶段除"查看说明"弹窗外，仍包含**知识作业 + 实战任务**，贴合现有学习计划输出格式（用户已确认）。

参考现有格式：AI 生成的普通学习计划（如 TypeScript 学习计划）输出结构：`phases[]`，每阶段含 `phaseNumber/title/goal/estimatedWeeks/videos/knowledgeQuiz/practiceTasks/progress/completed` + 计划级 `mermaidDiagram`。

## 二、现状分析（基于实际探索）

| 层 | 文件 | 关键事实 |
|---|---|---|
| 模型 | `backend/src/main/java/com/example/clip/model/LearningPlan.java` | `LearningPlan`(int `totalWeeks`)、嵌套 `Phase`(int `estimatedWeeks`)、`VideoResource`、`QuizQuestion`、`PracticeTask`，均为 POJO + getter/setter |
| 服务 | `backend/src/main/java/com/example/clip/service/LearningPlanService.java` | `createPlan()` AI 生成 + Exa 搜索；`parsePhase()` 解析；`deletePlan(id)` 直接委托删除 |
| 存储 | `backend/src/main/java/com/example/clip/service/FileStorageService.java` | 学习计划存 `clip-storage/learning-plan/{yyyy-MM-dd}.json`；`saveLearningPlan` 自动分配 ID；`getAllLearningPlans` 扫描全部日期文件按创建时间倒序 |
| 控制器 | `backend/src/main/java/com/example/clip/controller/LearningPlanController.java` | `GET/POST /api/learning-plan`、`PUT/{id}`、`DELETE/{id}`、`PUT/{id}/phase/{num}`、`POST /batch-delete`、`POST /open-folder`、`POST /{id}/export-pdf` |
| 前端 | `frontend/learning-plan.html` | 列表(`renderList`)+详情(`showDetail`)+阶段卡片(`renderPhaseCard`)+批量模式(`batchMode/selectedIds/batchDelete`)+导出(`exportMarkdown`)+新建弹窗；`marked.min.js` 已存在于 `frontend/libs/`；主题为 `data-theme` CSS 变量体系 |
| 工作台过滤 | `LearningPlanController.filterByWorkspace` → `WorkspaceFilterUtils` | 仅当 `localStorage.active_workspace_id` 存在时前端才带 `workspaceId` 参数；未设工作台时不过滤 → 内置计划默认可见，无需特殊处理 |

产品事实来源（用于编写说明书内容）：`CODE_WIKI.md`（架构/模块/API）、`PRD.md`、`browser-extension/background.js`（右键菜单项与快捷键 Ctrl+Shift+S / Ctrl+Shift+V）、`electron/main.js`（托盘菜单、应用菜单、全局快捷键 `CommandOrControl+Shift+Z`、关闭到托盘）。

## 三、决策记录

1. **内置计划不可删除**：前端详情页不渲染"删除"按钮；后端 `DELETE /{id}` 与 `POST /batch-delete` 对 `builtin` 计划返回 400 / 跳过。
2. **每阶段结构**：`title + goal + detailMarkdown(说明书正文) + knowledgeQuiz(1-2 题) + practiceTasks(1 条)`。
3. **∞ 展示**：`LearningPlan.totalWeeks` 与 `Phase.estimatedWeeks` 由 `int` 改为 `String`（Jackson 反序列化可兼容旧数字 JSON），内置计划置 `"∞"`，普通 AI 计划仍为数字字符串，前端渲染逻辑不变。
4. **内置标识**：新增 `LearningPlan.builtin` 布尔字段（持久化进 JSON），用于识别/拦截删除/前端徽标。
5. **启动重建**：新增 `BuiltinLearningPlanSeeder`（ApplicationRunner），启动时若存储中不存在 `builtin` 计划，则从 `resources/builtin/product-feature-learning-plan.json` 自动生成。因不可删除，不会触发重建；该机制仅兜底初始化/数据丢失场景。
6. **弹窗触发**：阶段卡片头部新增"查看说明"按钮（`stopPropagation` 避免触发展开），点击后读取内存 Map 中的 markdown 用 `marked.parse` 渲染到弹窗。
7. **markdown 传参安全**：不使用内联字符串拼接，前端在 `showDetail` 时把 `detailMarkdown` 存入 `detailMarkdownMap[planId][phaseNum]`，按钮只传 `(planId, phaseNum)`，避免转义问题。

## 四、实施步骤

### 后端

#### 1. `model/LearningPlan.java`（改）
- `Phase` 类：
  - `private int estimatedWeeks;` → `private String estimatedWeeks;`（getter/setter 同步改为 String）
  - 新增 `private String detailMarkdown;` + getter/setter
- `LearningPlan` 类：
  - `private int totalWeeks;` → `private String totalWeeks;`（getter/setter 同步改）
  - 新增 `private boolean builtin = false;` + getter/setter

#### 2. `service/LearningPlanService.java`（改）
- `createPlan()`：`plan.setTotalWeeks(totalWeeks);` → `plan.setTotalWeeks(String.valueOf(totalWeeks));`
- `parsePhase()`：`phase.setEstimatedWeeks(toInt(raw.get("estimatedWeeks"), 1));` → `phase.setEstimatedWeeks(String.valueOf(toInt(raw.get("estimatedWeeks"), 1)));`
- `deletePlan(Long id)`：先 `getPlanById(id)`，若 `plan != null && plan.isBuiltin()` 则 `throw new IllegalStateException("内置计划不可删除")`（由控制器转 400）。

#### 3. `controller/LearningPlanController.java`（改）
- `updatePlan`：`existing.setTotalWeeks(toInt(body.get("totalWeeks"), existing.getTotalWeeks()));` → `existing.setTotalWeeks(String.valueOf(toInt(body.get("totalWeeks"), 8)));`
- `deletePlan` 端点：删除前取计划，`if (existing != null && existing.isBuiltin()) return ResponseEntity.badRequest().body(Map.of("error", "内置计划不可删除"));`
- `batchDelete` 端点：遍历 id 时跳过 `builtin` 计划（用 `getPlanById` 判断），仅删除普通计划；若全被跳过则返回 `{deleted: 0}`。

#### 4. 新增资源 `backend/src/main/resources/builtin/product-feature-learning-plan.json`（新）
完整 `LearningPlan` JSON：
- 顶层：`title:"产品功能学习"`、`level:"beginner"`、`goal:"intro"`、`hoursPerWeek:1`、`totalWeeks:"∞"`、`builtin:true`、`category:"product"`、`tags:["产品功能","内置","说明书"]`、`createdAt/updatedAt` 用当前启动时间（或留空由 seeder 填充）、`mermaidDiagram`（简单架构图，中文节点）。
- `phases`：13 个阶段（见"内容大纲"），每个阶段：`phaseNumber`、`title`、`goal`（阶段目标一句话）、`estimatedWeeks:"∞"`、`detailMarkdown`（完整 Markdown 说明书正文）、`knowledgeQuiz`（1-2 题，choice/essay）、`practiceTasks`（1 条，含 `acceptanceCriteria`）、`progress:0`、`completed:false`。
- 注意：JSON 内 `\n` 必须转义为 `\\n`，Markdown 文本块中的反引号、`${}` 无特殊处理。

#### 5. 新增 `config/BuiltinLearningPlanSeeder.java`（新）
```java
@Component
public class BuiltinLearningPlanSeeder implements ApplicationRunner {
    // 注入 FileStorageService
    // ObjectMapper: JavaTimeModule + FAIL_ON_UNKNOWN_PROPERTIES=false
    public void run(ApplicationArguments args) {
        // 若 getAllLearningPlans() 中已存在 isBuiltin()==true 的计划则跳过
        // 否则读取 classpath:builtin/product-feature-learning-plan.json 反序列化为 LearningPlan
        // fileStorageService.saveLearningPlan(plan)（自动分配 ID）
    }
}
```

### 前端 `frontend/learning-plan.html`（改）

#### 6. 引入 marked
`<head>` 中 mermaid 之后添加：`<script src="libs/marked.min.js"></script>`

#### 7. 新增弹窗 HTML（放在 createModalOverlay 附近）
```html
<div class="modal-overlay" id="detailModalOverlay" style="display:none;" onclick="if(event.target===this) closeDetailModal()">
  <div class="modal modal-lg">
    <div class="modal-header">
      <h2 id="detailModalTitle">产品功能说明</h2>
      <button class="modal-close" onclick="closeDetailModal()">×svg×</button>
    </div>
    <div class="modal-body markdown-body" id="detailModalBody"></div>
  </div>
</div>
```

#### 8. 新增样式
- `.modal-lg { max-width: 820px; }`
- `.markdown-body`：h1-h4 / p / ul / ol / code / pre / table / blockquote / a 的样式，全部使用 `var(--...)` 主题变量，配色与详情页一致；`pre`/`code` 用 `var(--border-light)` 背景。
- `html[data-theme="dark"] .markdown-body` 补充深色适配（code/pre 背景 `#3a3a3a`、链接 `#569cff`）。
- `.builtin-badge`（列表卡片徽标）：小圆角标签，`background:var(--primary-light); color:var(--primary);`。

#### 9. 新增 JS
- 全局 `let detailMarkdownMap = {};`
- `showDetail(planId)`：填充 `detailMarkdownMap = {}; plan.phases.forEach(ph => detailMarkdownMap[ph.phaseNumber] = ph.detailMarkdown);`
- `openDetailModal(phaseNum)`：取 `detailMarkdownMap[phaseNum]` → `document.getElementById('detailModalTitle').textContent = 阶段标题`（标题取 `phases.find(ph => ph.phaseNumber===phaseNum).title`，可通过另一个 Map 或查询 plans）；`marked.setOptions({breaks:true,gfm:true})`；`detailModalBody.innerHTML = marked.parse(md)`；显示 overlay。
- `closeDetailModal()`：隐藏 overlay。
- `renderPhaseCard(phase)`：
  - 周数显示 `${p.estimatedWeeks} 周`（String 直接拼接即可）
  - 若 `p.detailMarkdown` 非空，在 header 中 `.phase-weeks` 前加按钮：
    ```html
    <button class="btn btn-secondary btn-sm" style="flex-shrink:0;" onclick="event.stopPropagation(); openDetailModal(${p.phaseNumber})">📖 查看说明</button>
    ```
- `showDetail()`：`plan.builtin` 为 true 时不渲染删除按钮（条件拼接，隐藏"删除"按钮）。
- `renderList()`：
  - 内置计划卡片标题旁加 `<span class="builtin-badge">内置</span>`
  - 批量模式：内置计划卡片不渲染 checkbox（`p.builtin ? '' : '<input ...>'`），`toggleSelectAll` 只收集非 builtin。
- `batchDelete()`：删除前把 `selectedIds` 中属于 builtin 的剔除（已有 UI 限制，代码层再兜底），若剩余为空则 `alert('内置计划不可删除')`。
- `exportMarkdown()`：阶段导出时若 `phase.detailMarkdown` 存在，追加 `#### 详细说明\n\n` + markdown 原文区块。

#### 10. 主题联动
弹窗与 markdown-body 随 `data-theme` 变化（现有 CSS 变量体系已生效，只需补充 dark 覆盖样式）。

## 五、内容大纲（13 个阶段，按学习顺序）

> 每阶段 detailMarkdown 为该阶段的完整说明书正文，依据 CODE_WIKI.md / PRD.md / background.js / main.js 实际功能编写，做到"具体到每个功能按钮"。

| # | 阶段标题 | 内容要点 |
|---|---|---|
| 1 | 认识 CutShelter：产品定位与整体架构 | 产品简介（AI 驱动/本地优先/多端覆盖）、模块总览表、三层架构（Electron 主进程 + Spring Boot 后端 + iframe SPA）、JSON 本地存储结构、数据流（postMessage/API 代理）、技术栈速览 |
| 2 | 安装、启动与首次配置 | 桌面应用安装与打包（build.bat/sh）、一键脚本 start.bat/sh、手动分步启动（后端 8081 + 前端 3001）、Electron 首次配置（API Key/存储路径/端口）、浏览器扩展安装（chrome://extensions 加载解压）、环境要求（JDK17/Maven/Node） |
| 3 | 界面导航与主题系统 | 导航栏各入口（首页/话题/密码/学习/设置）、iframe 视图切换与懒加载、三种主题（Notion/常规/深色/跟随系统）、主题切换存储键与广播机制、自定义标题栏按钮（最小化/最大化/关闭） |
| 4 | 剪藏模块（核心）：添加与收集 | 添加剪藏各控件：类型（AI文本整理/仅存储/链接解析/文档解析）、来源、分类（6 一级+12 二级）、标签手动/AI、图片上传、语音输入；浏览器扩展/右键/快捷键剪藏入口；智能内容提取 |
| 5 | 剪藏模块：管理与 AI 分析 | 列表卡片操作（展开/删除/更多）、搜索与分类筛选、剪藏详情各按钮（复制原文、复制到编辑区打开、AI 分析、发散性总结、剪藏转待办、关联专题、打开 Obsidian 等）、工作流状态（收件箱→整理中→已完成） |
| 6 | 待办与工作台模块 | 待办时间线、创建/编辑/删除、到期提醒（30s 轮询 + 系统通知）、剪藏转待办、工作台统一视图与筛选 |
| 7 | 知识库 / Wiki 模块 | 本地拆词检索（中文 2-gram + 英文空格分词）、多数据源查询、模型档位路由（简单任务/复杂任务）、剪藏落库为知识条目 |
| 8 | 专题与 Markdown 编辑器 | 专题 CRUD、专题编辑器工具栏、实时预览、AI 辅助生成知识条目、剪藏关联到专题 |
| 9 | 密码管理模块 | DES 加密零知识架构、密钥解锁/锁定、条目 CRUD、分类侧边栏、密码生成器、安全审计（弱密码/重复密码）、CSV 导入导出、AI 自动填充 |
| 10 | 学习计划模块 | AI 生成路线图、Mermaid 可视化、阶段折叠与进度跟踪、Exa 真实资源搜索与 AI 降级、导出 Markdown / 打开目录 / 导出 PDF、内置产品功能学习计划说明 |
| 11 | 系统设置模块 | 存储路径、邮箱、模型配置（档位路由：简单任务 deepseek-v4-flash / 复杂任务 deepseek-v4-pro、自定义模型名、API Key、测试连接）、Prompt 配置、主题外观、快捷键设置、Git 同步 |
| 12 | 浏览器扩展（插件）说明 | 右键菜单逐项说明（智能剪藏→剪藏整个页面/选中内容/图片/剪藏到话题/AI文本整理/仅存储内容/添加到剪藏收件箱/AI解析文件内容/设置）、快捷键 Ctrl+Shift+S（页面）与 Ctrl+Shift+V（选中）、弹出窗口编辑流程、AI 内容清理开关、扩展设置页（API 地址/超时/重试/通知） |
| 13 | 系统级右键、全局快捷键与使用技巧 | 系统托盘右键菜单（显示主窗口/退出等）、应用菜单栏快捷键（Cmd/Ctrl+, 设置、Ctrl+R 刷新、F12 DevTools、Ctrl++/- 缩放、F11 全屏）、全局唤起快捷键 CommandOrControl+Shift+Z、关闭到托盘逻辑、**使用技巧**：产出结果配合 Obsidian（剪藏文件可打开 Obsidian、wiki 链接、知识库结构）、省 token 技巧（简单任务用 flash 档位、Prompt 精简、关闭 AI 清理）、提示词技巧（自定义 Prompt 模板、场景化模型路由） |

## 六、验证步骤

1. **后端编译**：`cd backend && mvn -q compile`（PowerShell 下避免参数中的逗号问题）。
2. **后端回归测试**：运行 `mvn test`，重点确认 LearningPlan 相关测试无回归（已知 ClipControllerTest 的 AppContext 加载问题与本改动无关）。
3. **前端人工验证清单**：
   - 启动后学习计划列表出现"产品功能学习"，卡片带"内置"徽标，周期显示"∞ 周"。
   - 详情页：无"删除"按钮；阶段数=13；每阶段周数显示"∞ 周"；展开显示资源（可为空）/知识作业/实战任务。
   - 点击阶段头部"查看说明"按钮弹出弹窗，Markdown 正常渲染，Notion/常规/深色三主题样式正常；点击遮罩/关闭按钮可关闭。
   - 批量管理模式：内置计划无复选框、不可被勾选；普通计划批量删除正常。
   - 接口验证：`DELETE /api/learning-plan/{内置id}` 返回 400；`POST /batch-delete` 传内置 id 时 deleted=0。
   - 删除内置计划存储文件后重启后端，计划自动重建。
   - 新建普通学习计划功能正常（totalWeeks 仍为数字，详情显示"8 周"等）。
   - 导出 Markdown 含各阶段"详细说明"区块。

## 七、涉及文件清单

**后端（改 3 + 新 2）**
- `backend/src/main/java/com/example/clip/model/LearningPlan.java`（改）
- `backend/src/main/java/com/example/clip/service/LearningPlanService.java`（改）
- `backend/src/main/java/com/example/clip/controller/LearningPlanController.java`（改）
- `backend/src/main/resources/builtin/product-feature-learning-plan.json`（新，含 13 阶段说明书）
- `backend/src/main/java/com/example/clip/config/BuiltinLearningPlanSeeder.java`（新）

**前端（改 1）**
- `frontend/learning-plan.html`（改：marked 引入 + 弹窗 + 样式 + JS + 删除拦截 + 内置徽标）

## 八、风险与兼容性

- `estimatedWeeks/totalWeeks` 改为 String：旧 JSON 中数字会自动反序列化为 String（Jackson 默认强制转换），序列化后为字符串；前端渲染 `${x} 周` 不受影响；`ContentRefMapper.fromLearningPlan` 不使用这两个字段，无影响。
- `builtin` 字段反序列化旧数据时为默认 false，不会误伤普通计划。
- Seeder 仅启动时执行一次且幂等（检测已存在则跳过），不阻塞主流程（异常捕获并告警）。
