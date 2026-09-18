# 首装「上手引导卡」 + 设置页重构 · 设计规格

> 版本：v1.1（设计定稿，含评审修订）
> 日期：2026-09-19
> 状态：设计已确认，待转实现计划
> 配套原型：`design-prototype/onboarding-settings-review.html`（浏览器直接打开，已选定 V3 融合风格）

---

## 1. 背景与问题

当前首次启动只弹一个 560×700、离线风格浓的 `electron/config.html` 独立窗口，仅让新用户配置「存储目录 + 端口」，未引导 AI 能力；而功能完备的设置页 `frontend/settings.html` 采用左栏分组 + 深层分块折叠，其中**工作区存储路径**被埋在最深处（`AI 与集成 → 应用配置 → 数据与本地 → 存储路径`），新用户几乎找不到核心配置项。

两个痛点：
1. 首装引导弱：无现代化、可跳过的上手引导，AI Key 等能力配置入口缺失；
2. 设置信息架构差：核心必填项层级过深，分组未按「影响开箱即用」的优先级组织。

## 2. 目标

- **首装改体验**：升级首次配置窗口为「清单式上手引导卡」，Notion 极简纸感 + 温暖插画小点缀（V3 融合），引导存储路径与 AI Key，可跳过、后续补配。
- **设置可重播**：设置页提供「上手引导/教学引导」入口，随时重播引导卡（覆盖存储、AI、进阶集成）。
- **设置页重构**：左栏分组按优先级重排，唯一必填项（工作区存储路径）置顶并标红；其余字段标清可选/核心等级。
- **主题一致性**：引导卡与设置全部消费 `--app-*` 令牌 + `data-theme`，随 regular/notion/dark 三套主题自动适配，不引入主题专属硬编码色。**特别地，首装窗口 `config.html` 需同步接入主题初始化**（现状零依赖，硬编码 `#f5f7fa/#333`），否则 V3 深浅色不成立。

## 3. 已确认决策（用户选定）

| 议题 | 结论 |
|------|------|
| 引导载体 | 升级现有首次配置窗口 `electron/config.html` |
| 视觉风格 | V3 融合：纸感主体 + 主色按钮 + 暖色小点缀插画，深浅色均成立 |
| 卡片形态 | 清单式卡片集合（存储路径卡 + AI Key 卡），非严格线性 Stepper |
| 必填口径 | 两级：唯一强必填 = 工作区存储路径（红色标记）；AI Key 等均为可选 |
| 引导清单范围 | 首次仅两张卡：存储总目录（必填）、主 AI 模型 API Key（可跳过） |
| 设置导航 | 左栏分组 + 分块折叠，按优先级重排，必填标红 |

---

## 4. Part A — 上手引导卡（V3 融合）

### 4.1 交互定式

- 首次运行（`config.configured === false`）打开升级后的 config 窗口，展示「欢迎使用碎碎记」+ 进度（第 N 步 / 共 2 步）+ 两张卡片。
- **存储路径卡**：顶部红色「必填」角标；「未设置」状态显示红色警示点；卡片可点击展开内嵌配置（路径输入 + 浏览按钮）。**首装时 `storagePath` 留空（不预填 `APP_DIR`）**，并提供「一键填充推荐路径」按钮，让用户有明确动作后才变绿「已就绪」；只有用户真正落定路径后，主按钮「开始使用」才可用。
- **主 AI 模型 · API Key 卡**：灰色「稍后可配」徽章；提供服务商（DashScope/DeepSeek/自定义）、API Key 输入、显示/测试按钮；提供「跳过，稍后配置」旁路动作，不阻塞「开始使用」。
- **端口（高级）**：`backendPort` + `frontendPort` 全部收进一张折叠「高级」卡，默认 8081 / 3001，普通用户无需展开；仅保留 `backendPort === frontendPort` 相等校验兜底。
- 底部信任文案：「内容 100% 存本机 · 随时可迁移」。
- 主题/风格：`html[data-theme]` 切换时整组卡片跟随 `--app-*` 令牌变化；关闭窗口即保存已填项、跳过项按「稍后」处理。**首装窗口默认 notion**（详见 §4.5 主题适配限制）。

### 4.2 共享引导组件（架构）

为避免「首装窗口（Electron file://）与设置页重播（前端 http://）」两地样式漂移，抽**单一共享引导组件**：

- 新增 `frontend/js/guide-core.js`，暴露 `window.CutShelterGuide.render(container, spec)`：
  - 纯 DOM 构建，**自带注入 `<style>`**（避免跨 source 的独立 CSS 文件解析差异）；
  - 消费 `--app-*` 令牌 + `html[data-theme]`，不读任何全局主题专属硬编码色；
  - 输入 `spec`：`{ cards: [{ key, icon, label, required, badge, desc, statusMeta, fields, actions }], progress: {...}, footer, onDone }`；
  - 组件内部封装卡片展开/收起、必填校验、状态流转（未设置→已完成）、存根回调。
- 落地为「首装卡集合」与「教学引导卡集合」两份 spec，共用同一渲染器。

接入点：
1. `electron/config.html`：
   - 引入 `theme-core.js` + `theme-bridge.js`（相对路径同 guide-core），init 时设置 `html[data-theme]`，让整页（含标题栏、卡片）消费 `--app-*` 令牌。
   - `<script src="../frontend/js/guide-core.js"></script>` 后在首装区调用。Electron `loadFile` 基址为 `file://…/electron/`，`../frontend/js/…` 解析到 asar 内 `frontend/`，允许作为子资源加载。（若打包后 file:// 跨目录受限，回退见 §10。）
2. `frontend/settings.js`：同源直接 `<script src="js/guide-core.js">`，用于重播入口。

### 4.3 首装窗口数据与保存

- 进入前 `api.onLoadConfig`（preload 已提供）读 `config`；渲染时回填 `activeProvider/apiKey` 等已有值；**但仅首次运行时 `storagePath` 回填为空**（配合 §4.1 的留空 + 推荐路径逻辑，避免 `APP_DIR` 默认值让「必填」失效）。
- 「开始使用」→ 校验存储路径非空 → 调 `api.onConfigDone`/既有 `config-done` 通道，提交 `{ backendPort, frontendPort, storagePath, activeProvider, apiKey/dashscope/deepseekApiKey…, configured: true }`（沿用主进程既有 `config-done` 处理，见 `electron/main.js` 首启段）。
- 中途关闭窗口：已填项仍随保存流程写入（如果走到了 save），未完成项按「稍后」标记；后续可从设置页重播补配。

### 4.4 设置页重播入口

- 在工作区分组顶部常驻「上手引导」横幅（如图 A 确认的 B 区演示）：`📎/🎓 上手引导 · 点击重播首次引导卡 / 分步学习存储、AI Key、进阶集成` + 「播放引导」按钮。
- 点击后以**模态/抽屉**在 settings iframe 内调用 `CutShelterGuide.render` 渲染教学引导卡集合（两卡 = 首装同款 + 可加入进阶集成位，进阶卡默认折叠可选）。

### 4.5 主题适配

- 引导卡所有颜色、圆角、阴影、动效仅引用 `--app-*` 令牌与 `html[data-theme]`，与 `frontend/styles/design-tokens.css` 契约一致。
- 温暖插画点缀（文档+对勾、台灯）仅使用暖色**局部变量**（如 `--warm-*`），在 light/dark 下分别定义，作为引导卡专属 accent，不进全局令牌以免污染组件语义。
- **首装窗口主题限制**：`config.html` 走 `file://`，与主窗口 `http://localhost:3001` 不是同一 origin，读不到主窗口的 `localStorage` 主题偏好；且 index.html 的 `themeChange` 广播不会发给 config 窗口。因此首装窗口**默认 notion**，靠自身 init（theme-core/bridge）设置 `data-theme`；用户进主界面选定主题后，后续重播时自然生效。验收「三主题下均成立」对首装窗口以「默认 notion + 可手动切 data-theme 模拟」为准。

---

## 5. Part B — 设置页重构

### 5.1 目标

把影响「开箱即用」的核心项提前、必填项标红，按重要等级重排左栏分组；保留分块折叠交互，降低认知负担。

### 5.2 新分组结构与排序（已确认）

左栏顺序（自上而下）：
1. **工作区**（红「必填」标签）—— 存储总目录（强必填，红色 `*`）、子目录结构（自动派生）、搜索覆盖区 & 目录规范（只读体检）
2. **AI 与模型** —— 主 AI 服务商 + API Key（核心可选）、PDF OCR 配置、Exa 搜索
3. **集成** —— DSH 牛马 Agent、MCP 接入、Git 远程仓库、邮件通知
4. **外观** —— 主题/皮肤、动效、小记图标
5. **通用** —— 启动行为、渲染性能（GPU）、字体
6. **快捷操作** —— 快捷键
7. **数据与隐私** —— 数据目录/配置路径展示、信任区、剪切板监听
8. **系统** —— 缓存管理、软件更新、关于

> 说明：原「AI 与集成」承载过多（含模型、DSH、MCP、全套 unified config），拆为「AI 与模型」+「集成」两组；原「数据与本地」的存储路径相关项并入新置顶的「工作区」。渲染性能从「通用/渲染性能」就地归入通用；若改动回归面过大可保留为独立同层分组，见 §10 风险。

### 5.3 必填标红（两级）

- **强必填（红）**：仅「工作区 → 存储总目录」。以红色 `*` + 红色描边/底色行 + 分组内红字母标「必填」呈现；未配置时该行常驻警示。
- **核心可选**：AI 主 Key 等，默认灰态/「稍后可配」，不标红。
- 首装时若用户跳过 AI Key，工作区分组顶部「上手引导」横幅持续显示「AI Key 待配置」提示（非阻塞）。

### 5.4 教学引导入口

工作区分组顶部常驻横幅（§4.4），提供「播放引导」重播引导卡；AI Key 未配置时横幅追加状态提示。

### 5.5 实施方式（二阶段 + 硬约束）

**分两阶段实施，避免大回归面一次爆发：**

- **阶段 1（最小闭环，先做）**：只新增置顶「工作区」Section，把 `storagePath` 相关 DOM 迁入并标红必填，其余分组暂不动。独立验证「提升 + 标红」闭环后再进入阶段 2。
- **阶段 2**：按 §5.2 完成 8 组拆分与排序，迁移其余字段容器。

**硬约束（必守，建议写进验收）**：`settings.js` 依赖大量硬编码 element id（`storagePath` / `dashscopeApiKey` / `testDashscope` / `dshAgentEnabled` 等），开展分组重排时**只能移动 DOM 位置、绝不能改 id 或 `data-target` 映射键**；字段逻辑绑定全部靠原 id 命中，改 id 会导致 `settings.js` 在绑定阶段崩溃。分组重排以「新增分组容器 + 原 id 字段整体搬入」为主，不原地改名。

---

## 6. 数据 / 配置键（沿用现有，不新增破坏性字段）

| 键 | 位置 | 用途 |
|----|------|------|
| `configured` | config.json | 首次引导是否完成（`config-done` 置 true） |
| `storagePath` | config.json | 存储总目录（唯一强必填） |
| `activeProvider` / `apiKey` / `deepseekApiKey` / `dashscopeModel` / `custom*` | config.json | AI 提供方与 Key（可选，可后补；明文存储口径与现有 model-config.json 一致，不额外加密） |
| `backendPort` / `frontendPort` | config.json | 收进首装「高级」折叠卡，默认 8081 / 3001，保留相等校验 |

> 不新增「引导已播放」等布尔：首次引导完成即 `configured=true`；重播引导以「设置页横幅按钮」为显式入口，无状态记忆负担。

---

## 7. 验收标准

- [ ] 首次启动进入升级后的 config 窗口，两张引导卡（存储必填红、AI Key 可跳过），未落定存储路径时「开始使用」不可用。
- [ ] 首装窗口 `storagePath` 初始为空，提供「一键填充推荐路径」；确认路径后状态由红转绿。
- [ ] 端口（backend/frontend）收进折叠「高级」卡，默认 8081/3001，相等校验仍生效。
- [ ] 首装窗口接入主题初始化（theme-core/bridge 设 `data-theme`），默认 notion，不再是硬编码 `#f5f7fa/#333`。
- [ ] 配置完成并启动后 `configured=true`，后续启动直接进主界面，不再弹引导。
- [ ] 设置页左栏分组按 §5.2 顺序呈现，存储路径项标红必填并被置于首屏「工作区」。
- [ ] 分组重排全程不改字段 element id / `data-target` 映射键，`settings.js` 绑定不报错。
- [ ] 工作区分组顶部「上手引导」横幅可点击重播引导卡（两卡 + 折叠的进阶集成位）。
- [ ] 引导卡与设置页在 regular/notion/dark 三主题下均无突兀硬编码色、对比可用（首装窗口以 notion + 手动切 data-theme 模拟为准）。
- [ ] 设置页深埋的存储路径不再出现在 AI→数据与本地分块内（已移交「工作区」）。

## 8. 明确不做

- 不做严格线性多步 Stepper。
- 不做手机端引导。
- 不新增引导「完成度」持久化模型；重播以显式入口为主。
- 不改后端接口；仅前端 + Electron 渲染层改动。

## 9. 涉及文件

- 新增：`frontend/js/guide-core.js`；`design-prototype/onboarding-settings-review.html`（原型，保留供评审）。
- 改造：`electron/config.html`（首装引导卡 + 接入主题初始化）；`electron/main.js`（首启配置窗口装载路径/尺寸若需调整、`config-done` 处理保持兼容）；`frontend/settings.html`（分组重排 + 必填标红 + 引导横幅）；`frontend/js/settings.js`（引导重播调用、分组切换映射）。
- 只读参考（不改）：`frontend/styles/design-tokens.css`、`frontend/js/theme-core.js`、`frontend/js/theme-bridge.js`。
- 若采用远程样式拆分，可加 `frontend/styles/guide-core.css`（与 JS 注入二选一，默认 JS 注入）。

## 10. 风险与回退

1. **Electron file:// 跨目录加载**：`config.html` 引 `../frontend/js/guide-core.js`（及 theme-core/bridge）若在打包 asar 中受限 → 回退 A：把这三个 JS 安装到 `electron/` 一份（由构建脚本复制，避免手改漂移）；回退 B：由 `main.js` 读取文件内容注入 config 窗口。
2. **设置分组重排回归面**：原「AI 与集成」被拆分，涉及 `settings.js` 的 `data-target` 导航键、字段容器 id。采用「新增分组容器 + 迁移原 id 字段」而非原地改 id，降低联动破坏（§5.5 硬约束）。
3. **主题暖色点缀**：暖色仅作引导卡装饰，不进入全局 `--app-*`，避免影响其它模块。
4. **首装窗口尺寸**：原 560×700 且 `resizable:false` 对 hero + 清单卡片偏窄，实施时调整为约 540×680 或放开 resizable；若保持锁尺寸需重排卡片留白。