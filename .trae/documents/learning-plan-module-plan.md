# 学习计划模块 设计方案

## 一、产品定位

**核心功能**：用户输入学习主题、当前水平、目标和时间投入，AI 自动生成分阶段学习路线图，用户可跟踪每阶段的学习进度。

**参考来源**：[tech-shrimp/tech-shrimp-learning-roadmap](https://github.com/tech-shrimp/tech-shrimp-learning-roadmap) — 其核心产品理念和结构将被借鉴，但完全重新设计为适配本系统风格的前后端一体化模块。

**关键升级**：集成 [Exa](https://exa.ai) 语义搜索引擎，为每个学习阶段搜索真实、高质量的学习资源（教程、文档、视频、论文），替代 AI 幻觉生成的虚假推荐，确保内容靠谱可用。

## 二、Exa 搜索集成

### 2.1 为什么用 Exa

| 问题 | AI 直接生成 | Exa 搜索 |
|------|------------|----------|
| 资源真实性 | 幻觉URL，打不开 | 真实可访问的链接 |
| 内容时效性 | 训练数据截止日期 | 实时搜索最新内容 |
| 推荐质量 | 泛泛而谈 | 针对性强、有摘要 |
| 中文资源 | 不准确 | 可指定中文站点 |

Exa 是专为 AI 应用设计的语义搜索引擎，基于 embeddings 理解查询意图，支持：
- `auto` 模式自动选择最佳搜索策略
- 内容提取（text、highlights、summary）
- 域名过滤（如限定 `youtube.com`、`github.com`、`csdn.net`）
- 类别过滤（`research paper`、`news` 等）
- 日期范围过滤

### 2.2 集成架构

```
用户输入学习主题
    ↓
LearningPlanService.generatePlan()
    ↓
┌─────────────────────────────────────┐
│  Step 1: AI 生成阶段结构             │
│  AiService.chat(prompt) → phases[]  │
│  (仅生成 phaseNumber/title/goal/    │
│   estimatedWeeks/quiz/practice)     │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  Step 2: Exa 搜索真实资源            │
│  for each phase:                    │
│    ExaSearchService.search(         │
│      query: "{title} {phase.goal}   │
│              tutorial guide",       │
│      type: "auto",                  │
│      numResults: 5,                 │
│      contents: {text: true}         │
│    ) → 填充 videos[]                │
│  (同时搜索中文资源 + 英文资源)       │
└─────────────────────────────────────┘
    ↓
完整的 LearningPlan（结构+真实资源）
```

### 2.3 ExaSearchService API

```java
@Service
public class ExaSearchService {

    /**
     * 搜索学习资源
     * @param query 搜索查询（自然语言）
     * @param category 资源类型：tutorial/documentation/course/paper
     * @param numResults 结果数量
     * @return 搜索结果列表
     */
    public List<ExaSearchResult> searchLearningResources(
        String query, String category, int numResults);

    /**
     * 批量搜索（为多个阶段并行搜索资源）
     * @param phaseQueries 每个阶段的搜索查询
     * @return 每个阶段的搜索结果
     */
    public Map<Integer, List<ExaSearchResult>> batchSearchResources(
        List<PhaseSearchQuery> phaseQueries);
}
```

### 2.4 搜索策略

每个阶段执行 **2 次搜索**（中文 + 英文），取综合结果：

| 搜索方向 | 域名偏好 | 用途 |
|---------|---------|------|
| 中文教程 | csdn.net, juejin.cn, zhihu.com, bilibili.com | 中文视频/文章 |
| 英文资源 | youtube.com, github.com, medium.com, arxiv.org | 英文教程/论文 |
| 官方文档 | 主题相关官方域名 | 一手资料 |

### 2.5 配置

在 `application.yml` 新增：

```yaml
exa:
  api-key: your-exa-api-key
  enabled: true  # 可关闭降级为纯 AI 生成
```

## 三、数据模型

### 3.1 后端 Model：`LearningPlan`

```java
public class LearningPlan {
    private Long id;
    private String title;           // 学习主题，如 "Python 机器学习"
    private String level;           // 当前水平：zero/beginner/intermediate
    private String goal;            // 学习目标：intro/project/job/portfolio
    private int hoursPerWeek;       // 每周投入小时数
    private int totalWeeks;         // 预计总周数
    private List<Phase> phases;     // 学习阶段列表
    private String mermaidDiagram;  // Mermaid 可视化路径图
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
```

### 3.2 后端 Model：`Phase`（嵌套在 LearningPlan 内）

```java
public class Phase {
    private int phaseNumber;        // 阶段编号
    private String title;           // 阶段名称
    private String goal;            // 阶段目标
    private int estimatedWeeks;     // 预计周数
    private List<VideoResource> videos;     // 推荐视频/文章（Exa 搜索填充）
    private List<QuizQuestion> knowledgeQuiz; // 知识作业（AI 生成）
    private List<PracticeTask> practiceTasks; // 实战作业（AI 生成）
    private int progress;           // 进度 0-100
    private boolean completed;      // 是否完成
}
```

### 3.3 后端 Model：`VideoResource` / `QuizQuestion` / `PracticeTask`

```java
public class VideoResource {
    private String title;
    private String url;
    private String reason;  // 推荐理由
    private String source;  // 来源：exa / ai
    private String snippet; // 内容摘要（Exa 返回）
}

public class QuizQuestion {
    private String type;    // "choice" | "essay"
    private String question;
    private List<String> options; // 仅选择题
}

public class PracticeTask {
    private String description;
    private int difficulty; // 1-3 星
    private String acceptanceCriteria; // 验收标准
}
```

## 四、后端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/learning-plan` | 创建学习计划（AI 生成结构 + Exa 搜索资源） |
| GET | `/api/learning-plan` | 获取所有学习计划列表 |
| GET | `/api/learning-plan/{id}` | 获取单个学习计划详情 |
| PUT | `/api/learning-plan/{id}` | 更新学习计划（进度、标题等） |
| DELETE | `/api/learning-plan/{id}` | 删除学习计划 |
| PUT | `/api/learning-plan/{id}/phase/{phaseNum}` | 更新某阶段进度/完成状态 |

### 4.1 创建流程（POST）关键逻辑

1. 前端提交：`{ title, level, goal, hoursPerWeek, totalWeeks }`
2. AI 生成阶段结构（phase 列表 + mermaid 图）
3. Exa 为每个阶段搜索真实学习资源，填充 videos[]
4. 合并结果，保存到文件存储

### 4.2 降级策略

当 Exa 不可用（API key 未配置、网络异常、配额耗尽）时，自动降级为 AI 生成资源，标记 `source: "ai"`，前端可选择性展示"AI 推荐"标识。

### 4.3 文件

**新建文件**：
- `backend/src/main/java/com/example/clip/model/LearningPlan.java` ✅ 已创建
- `backend/src/main/java/com/example/clip/service/ExaSearchService.java`
- `backend/src/main/java/com/example/clip/service/LearningPlanService.java`
- `backend/src/main/java/com/example/clip/controller/LearningPlanController.java`
- 在 `FileStorageService.java` 中增加 `saveLearningPlan` / `getLearningPlanById` / `getAllLearningPlans` / `deleteLearningPlan` 方法 ✅ 已完成

## 五、前端设计

### 5.1 导航入口

在 `index.html` 标题栏新增"学习"按钮，点击切换到学习计划视图。

```html
<button class="nav-btn" data-view="learning-plan">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 14l9-5-9-5-9 5 9 5z"/>
        <path d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z"/>
    </svg>
    学习
</button>
```

### 5.2 页面结构：`learning-plan.html`

**列表页（默认视图）**：
- 顶部：标题 "学习计划" + "新建计划" 按钮
- 列表卡片：每个计划显示标题、阶段数、总进度百分比、创建时间
- 空状态：引导文案 + 新建按钮

**新建计划弹窗**：
- 表单字段：学习主题、当前水平（下拉）、学习目标（下拉）、每周投入小时数、预计周数
- 提交后：显示加载动画 + 分步进度提示（"AI 正在生成学习路线图..." → "正在搜索真实学习资源..."）
- 生成完成后跳转到详情页

**详情页（同文件内切换）**：
- 顶部：返回按钮 + 计划标题 + 编辑/删除操作
- Mermaid 可视化路径图（使用 mermaid.js 渲染）
- 阶段列表（卡片式，可折叠展开）：
  - 每个阶段卡片：阶段编号 + 名称 + 进度条 + 完成勾选
  - 展开后：学习目标、推荐资源（带来源标记 + 摘要 + 可点击链接）、知识作业、实战作业
- 阶段进度跟踪：每个阶段有独立的进度条，勾选完成按钮

### 5.3 样式设计

**主题跟随**：使用 CSS 变量体系，与现有模块（clip/topic/todo）完全一致：
- `--background` / `--surface` / `--text` / `--text-secondary` / `--border` / `--primary`
- 支持 `data-theme="dark"` / `data-theme="notion"` / `data-theme="regular"`

**资源卡片**：每个资源显示 favicon + 标题 + 来源标签（Exa 搜索 / AI 推荐）+ 摘要 + 链接，外链可点击跳转

**卡片风格**：与 clip.html 保持一致，使用 `border-radius: 12px`，`box-shadow` 悬浮效果

**Mermaid 渲染**：引入 `mermaid@10` CDN，使用 `mermaid.render()` 渲染 SVG

### 5.4 深色主题适配

学习计划页面需要完整的深色主题 CSS 覆盖，包括：
- 阶段卡片背景色
- Mermaid 图表的主题切换（`mermaid.initialize({ theme: 'default' | 'dark' })`）
- 进度条颜色
- 表单输入框样式

## 六、AI Prompt 模板

创建学习计划时发送给 AI 的 prompt（AI 只负责生成结构，资源由 Exa 搜索填充）：

```
你是一个技术学习导师。请根据以下信息生成一份分阶段学习路线图的结构：

学习主题：{title}
当前水平：{level}
学习目标：{goal}
每周投入：{hoursPerWeek} 小时
预计周期：{totalWeeks} 周

请返回 JSON 格式（不要包含 markdown 代码块标记）：
{
  "phases": [
    {
      "phaseNumber": 1,
      "title": "阶段名称",
      "goal": "阶段目标",
      "estimatedWeeks": 2,
      "knowledgeQuiz": [
        {"type": "choice", "question": "...", "options": ["A", "B", "C", "D"]},
        {"type": "essay", "question": "..."}
      ],
      "practiceTasks": [
        {"description": "...", "difficulty": 2, "acceptanceCriteria": "..."}
      ]
    }
  ],
  "mermaidDiagram": "graph TD\\n  A[...] --> B[...]\\n  ..."
}

注意：
- 不需要生成 videos 字段，学习资源将通过搜索引擎实时获取
- 每个阶段的知识作业和实战作业要具体、可执行
- mermaidDiagram 使用中文节点标签
```

## 七、文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/index.html` | 修改 | 新增导航按钮 + 视图面板 + 主题广播 + 路由映射 |
| `frontend/learning-plan.html` | 新建 | 学习计划页面（列表 + 详情 + 新建弹窗） |
| `backend/src/main/java/com/example/clip/model/LearningPlan.java` | 新建 ✅ | 学习计划数据模型 |
| `backend/src/main/java/com/example/clip/service/ExaSearchService.java` | 新建 | Exa 搜索服务 |
| `backend/src/main/java/com/example/clip/service/LearningPlanService.java` | 新建 | 业务逻辑 + AI 生成 + Exa 资源搜索 |
| `backend/src/main/java/com/example/clip/controller/LearningPlanController.java` | 新建 | REST API 控制器 |
| `backend/src/main/java/com/example/clip/service/FileStorageService.java` | 修改 ✅ | 增加学习计划存储方法 |
| `backend/src/main/resources/application_templete.yml` | 修改 | 增加 Exa 配置项 |

## 八、验证标准

1. 导航栏点击"学习"切换视图正常
2. 新建计划弹窗表单校验正常
3. AI 生成阶段结构正确，Exa 搜索返回真实可访问资源链接
4. Exa 不可用时自动降级为 AI 生成资源，不影响正常使用
5. 阶段卡片可折叠展开，内容完整渲染
6. 资源链接可点击打开，摘要正确显示
7. 进度条滑动和完成勾选功能正常
8. 深色/浅色主题切换正常
9. 编辑/删除计划功能正常
10. 快捷键 Ctrl+R 刷新后状态保持