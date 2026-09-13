# 碎碎记 CutShelter 离线官网落地页 — 实施计划

> 状态：待评审
> 交付物：单文件离线官网（含官网首页 + 概要版使用文档，锚点导航）
> 风格基准：`design-prototype/index.html`（对标 NoteGen 的产品 UI 原型）
> 约束：完全离线可用（零外链资源）、适配产品风格、**不要 AI 风**

---

## 1. 概述（Summary）

为产品「碎碎记 CutShelter」制作一个**单文件**离线官网页面：浏览器直接双击打开即可浏览，包含官网首页（品牌 Hero、功能特性、工作流主线）与概要版使用文档（快速上手、剪藏、收件箱整理、编辑器、知识库/图谱、AI 助手、工具、数据与隐私），全部通过页面内锚点导航。

设计语言复用产品既有 design token（主色 `#2383e2`、低饱和 Notion 类灰白基调、`IBM Plex Sans / Noto Sans SC` 字体栈、圆角 6/9/12px、动效 120/200/300ms），与 `design-prototype/index.html` 视觉一致。刻意规避 AI 产品常见风格（渐变紫蓝、玻璃拟态、发光光晕、大模型插画），主视觉用 CSS/SVG 绘制的产品界面示意。

## 2. 现状分析（Current State Analysis）

已确认的落地事实：

| 项 | 现状 | 来源 |
|----|------|------|
| 品牌名 | 中文「碎碎记」/ 英文「CutShelter」，AI 助手「小记」（气泡图标） | 项目记忆 + 各页面标题 |
| 版本号 | `1.0.14`，productName `CutShelter` | [package.json](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/package.json) |
| 主色 | `#2383e2`（浅）/ `#61a6ff`（深） | [design-tokens.css](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/frontend/styles/design-tokens.css) |
| 页面基调 | 浅色 `#f7f7f5` 背景 / 白色 surface / `#e3e3df` 边框 / 文字 `#2f3437` | `design-prototype/index.html` L9-L52 |
| 字体 | `IBM Plex Sans` → `Noto Sans SC` → 系统字体（离线不加载 web font，走系统回退） | design-tokens.css |
| 圆角/阴影/动效 | 6/9/12px；`--app-shadow-sm/md/lg`；`--app-duration-*` + `cubic-bezier(0.22,1,0.36,1)` | design-tokens.css |
| 产品 slogan | 「捕捉灵感，智能整理，构建你的个人知识库」 | `frontend/clip.html` subtitle |
| 核心功能 | 剪藏六种方式（稍后整理/AI笔记/链接/文档/插图OCR/待办）、收件箱主线、离线 OCR、统一 AI 助手、编辑器、知识库/知识图谱/画布、工具（截图/PDF/提示词库）、Git 同步、本地优先纯文本存储 | README + design-spec.md + 本会话开发内容 |
| 设计定位 | 对标 NoteGen「先记录、再整理」，一条主线（记录→收件箱→整理→写作/画布）+ 沉淀线 | [design-spec.md](file:///Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/design-prototype/design-spec.md) |

**「不要 AI 风」执行规则**（写入官网样式实现）：
- 不使用紫蓝渐变、发光文字/光晕、玻璃拟态（backdrop-blur 大面积）、霓虹描边
- 用低饱和灰白底 + 蓝色点缀 + 细边框 + 克制阴影，卡片圆角 9-12px
- 主视觉为 CSS/SVG 绘制的产品界面示意（简化版收件箱 + 编辑器 + AI 侧栏），非生成图片
- 动效仅用产品既有 duration/ease 令牌（hover 微交互、滚动渐入）

## 3. 交付物与文件结构

**新增单个文件**：`/Users/pengwenfeng/Documents/gitRep/trae_demo/codex-project/website/index.html`

- 新建 `website/` 目录（与 `design-prototype/` 平级，语义独立）
- 单文件自包含：内联 `<style>` + 内联 `<script>`（仅锚点滚动/滚动渐入 IntersectionObserver），**无任何外链**（无 CDN、无 web font、无外域图片/脚本）
- 不新增/修改其它任何文件

## 4. 页面结构与内容大纲

单页纵向布局，顶部固定导航，锚点滚动到各区块：

### 4.1 顶部导航
- 左：品牌标识（CSS 绘制的「小记」气泡风格圆标 + 「碎碎记 CutShelter」）
- 右：锚点链接 `功能 / 工作流 / 使用文档 / 快速上手 / 数据与隐私`

### 4.2 Hero 区
- 主标题：`碎碎记 · CutShelter`，副标语：**「捕捉灵感，智能整理，构建你的个人知识库」**
- 一句话定位：本地优先的剪藏与知识管理桌面应用
- CTA：`查看使用文档`（锚点）+ `快速上手`（锚点）
- 右/下侧主视觉：CSS 绘制的**产品界面示意**（简化收件箱卡片列表 + 状态徽章 待整理橙/已整理绿 + 底部批量操作条，风格取 `design-prototype/index.html` 应用外壳配色）

### 4.3 功能特性（6 张卡片，图标用内联 SVG 线性图标）
1. 剪藏六种方式：文本 / 链接 / 文档 / 插图 / 待办 / 截图
2. 离线 OCR：插图文字本地识别，不上传
3. 统一 AI 助手「小记」：回答附来源，一键整理为笔记
4. 本地优先 · 纯文本：Markdown/JSON 明文存储，数据 100% 属于你
5. 知识库与知识图谱：双链关联、无限画布
6. 多主题编辑器：Markdown 写作、代码高亮、格式化、对比

### 4.4 工作流主线（4 步）
`记录（截图/粘贴/插图） → 收件箱（待整理） → 一键整理（AI 分类归档） → 写作 / 画布（沉淀）`

### 4.5 使用文档（概要版，锚点分区）
1. **快速上手**：三步（① 安装启动 ② 首次记录——快捷键/粘贴 ③ 整理收件箱）
2. **剪藏**：六种类型逐一说明 + 「稍后整理 / 立即 AI 整理」两种决策 + OCR 使用
3. **收件箱与整理**：待整理→已整理流转、状态徽章、批量整理/删除撤销、每日回看
4. **编辑器（写作）**：Markdown/代码、本地纯文本保存、常用快捷键（保存/新建/搜索/替换）
5. **知识库与知识图谱**：剪藏落库 Obsidian、双链、无限画布
6. **AI 助手「小记」**：三种上下文（选中记录/全库/当前文档）、来源引用
7. **工具模块**：截图、离线 OCR、PDF、提示词库
8. **数据与隐私**：本地优先 / 纯文本可读 / 存储路径 / 一键带走；**离线承诺**（应用内一切本地运行，可断网使用）

### 4.6 页脚
- 品牌名 + 版本 `v1.0.14` + 「本页面为离线页面，双击即可打开」说明

## 5. 样式规范（内联 CSS 关键点）

- `:root` 复用 design-prototype token 值（浅色主题）：`--app-bg:#f7f7f5; --app-surface:#fff; --app-border:#e3e3df; --app-text:#2f3437; --app-primary:#2383e2; --app-radius:9px; --app-duration-*; --app-ease-smooth`
- 字体栈：`"IBM Plex Sans","Noto Sans SC",-apple-system,"PingFang SC",sans-serif`（系统回退，离线可用）
- 卡片：白底 + `1px solid var(--app-border)` + `--app-shadow-sm`，hover 时 `--app-shadow-md` 上浮
- 章节标题用 `--app-primary` 左侧短竖线点缀；正文用 `--app-text-secondary`
- 状态徽章色复用产品语义：待整理橙 `#b7791f` / 已整理绿 `#238b63` / 其它灰 `#92969d`
- 动效：hover `120ms`、卡片上浮 `200ms`、区块滚动渐入 `300ms`，统一 `cubic-bezier(0.22,1,0.36,1)`

## 6. 假设与决策（Assumptions & Decisions）

1. **单浅色主题**：官网默认浅色（Notion 类基调），不做深色切换——官网场景以浅色为主，避免过度工程；产品内深色体验由应用本体提供
2. **不引入生成图片**：主视觉/示意图全部用 CSS/SVG 手绘，保证离线零依赖且契合产品真实观感（也规避 AI 风）
3. **文档为概要版**：每模块 2-5 条要点说明，不展开完整用户手册（用户已确认）
4. **版本号文案**：`v1.0.14`，来源 package.json，页面可后续手动更新
5. **放 `website/index.html`**：独立目录便于未来扩展（下载页/更新日志）；单文件交付满足「存离线」要求

## 7. 验证步骤（Verification）

1. 用浏览器（TRAE-browseruse 或本地浏览器）打开 `website/index.html`，逐区块目检：
   - 顶部导航锚点跳转正常（功能/工作流/使用文档/快速上手/数据与隐私）
   - Hero 与界面示意渲染正常，无布局溢出（1440px 与 375px 宽度）
   - 六张特性卡、工作流四步、文档各分区内容完整
2. **离线性检查**：全文搜索确认无 `http(s)://` 外链、无 `<link>`/`<script>` 外域引用、无 `url()` 外链图片
3. 样式一致性：与 `design-prototype/index.html` 对照主色、边框、圆角、字体观感一致；确认无渐变紫蓝/玻璃拟态等 AI 风元素
4. 文档要点与真实功能对齐抽查：剪藏六种类型、状态徽章语义、快捷键（如 ⌘S 保存）与代码现状一致
