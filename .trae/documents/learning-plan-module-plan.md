# 学习计划模块 设计方案

## 一、产品定位

**核心功能**：用户输入学习主题、当前水平、目标和时间投入，AI 自动生成分阶段学习路线图，用户可跟踪每阶段的学习进度。

**参考来源**：[tech-shrimp/tech-shrimp-learning-roadmap](https://github.com/tech-shrimp/tech-shrimp-learning-roadmap) — 其核心产品理念和结构将被借鉴，但完全重新设计为适配本系统风格的前后端一体化模块。

## 二、数据模型

### 2.1 后端 Model：`LearningPlan`

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

### 2.2 后端 Model：`Phase`（嵌套在 LearningPlan 内）

```java
public class Phase {
    private int phaseNumber;        // 阶段编号
    private String title;           // 阶段名称
    private String goal;            // 阶段目标
    private int estimatedWeeks;     // 预计周数
    private List<VideoResource> videos;     // 推荐视频
    private List<QuizQuestion> knowledgeQuiz; // 知识作业
    private List<PracticeTask> practiceTasks; // 实战作业
    private int progress;           // 进度 0-100
    private boolean completed;      // 是否完成
}
```

### 2.3 后端 Model：`VideoResource` / `QuizQuestion` / `PracticeTask`

```java
public class VideoResource {
    private String title;
    private String url;
    private String reason;  // 推荐理由
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

## 三、后端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/learning-plan` | 创建学习计划（调用 AI 生成路线图） |
| GET | `/api/learning-plan` | 获取所有学习计划列表 |
| GET | `/api/learning-plan/{id}` | 获取单个学习计划详情 |
| PUT | `/api/learning-plan/{id}` | 更新学习计划（进度、标题等） |
| DELETE | `/api/learning-plan/{id}` | 删除学习计划 |
| PUT | `/api/learning-plan/{id}/phase/{phaseNum}` | 更新某阶段进度/完成状态 |

### 3.1 创建流程（POST）关键逻辑

1. 前端提交：`{ title, level, goal, hoursPerWeek, totalWeeks }`
2. Service 调用 AI 服务（已有的 `AiService`），传入 prompt 模板要求生成分阶段路线图
3. AI 返回结构化 JSON（phase 列表 + mermaid 图）
4. 解析后保存到文件存储

### 3.2 文件

**新建文件**：
- `backend/src/main/java/com/example/clip/model/LearningPlan.java`
- `backend/src/main/java/com/example/clip/controller/LearningPlanController.java`
- `backend/src/main/java/com/example/clip/service/LearningPlanService.java`
- 在 `FileStorageService.java` 中增加 `saveLearningPlan` / `getLearningPlanById` / `getAllLearningPlans` / `deleteLearningPlan` 方法

## 四、前端设计

### 4.1 导航入口

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

### 4.2 页面结构：`learning-plan.html`

**列表页（默认视图）**：
- 顶部：标题 "学习计划" + "新建计划" 按钮
- 列表卡片：每个计划显示标题、阶段数、总进度百分比、创建时间
- 空状态：引导文案 + 新建按钮

**新建计划弹窗**：
- 表单字段：学习主题、当前水平（下拉）、学习目标（下拉）、每周投入小时数、预计周数
- 提交后：显示加载动画，等待 AI 生成完成后跳转到详情页

**详情页（同文件内切换）**：
- 顶部：返回按钮 + 计划标题 + 编辑/删除操作
- Mermaid 可视化路径图（使用 mermaid.js 渲染）
- 阶段列表（卡片式，可折叠展开）：
  - 每个阶段卡片：阶段编号 + 名称 + 进度条 + 完成勾选
  - 展开后：学习目标、推荐视频（可点击链接）、知识作业、实战作业
- 阶段进度跟踪：每个阶段有独立的进度条，勾选完成按钮

### 4.3 样式设计

**主题跟随**：使用 CSS 变量体系，与现有模块（clip/topic/todo）完全一致：
- `--background` / `--surface` / `--text` / `--text-secondary` / `--border` / `--primary`
- 支持 `data-theme="dark"` / `data-theme="notion"` / `data-theme="regular"`

**卡片风格**：与 clip.html 保持一致，使用 `border-radius: 12px`，`box-shadow` 悬浮效果

**Mermaid 渲染**：引入 `mermaid@10` CDN，使用 `mermaid.render()` 渲染 SVG

### 4.4 深色主题适配

学习计划页面需要完整的深色主题 CSS 覆盖，包括：
- 阶段卡片背景色
- Mermaid 图表的主题切换（`mermaid.initialize({ theme: 'default' | 'dark' })`）
- 进度条颜色
- 表单输入框样式

## 五、文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/index.html` | 修改 | 新增导航按钮 + 视图面板 + 主题广播 + 路由映射 |
| `frontend/learning-plan.html` | 新建 | 学习计划页面（列表 + 详情 + 新建弹窗） |
| `backend/src/main/java/com/example/clip/model/LearningPlan.java` | 新建 | 学习计划数据模型 |
| `backend/src/main/java/com/example/clip/controller/LearningPlanController.java` | 新建 | REST API 控制器 |
| `backend/src/main/java/com/example/clip/service/LearningPlanService.java` | 新建 | 业务逻辑 + AI 生成 |
| `backend/src/main/java/com/example/clip/service/FileStorageService.java` | 修改 | 增加学习计划存储方法 |

## 六、AI Prompt 模板

创建学习计划时发送给 AI 的 prompt：

```
你是一个技术学习导师。请根据以下信息生成一份分阶段学习路线图：

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
      "videos": [{"title": "...", "url": "...", "reason": "..."}],
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
```

## 七、验证标准

1. 导航栏点击"学习"切换视图正常
2. 新建计划弹窗表单校验正常
3. AI 生成路线图后正确显示阶段列表和 Mermaid 图
4. 阶段卡片可折叠展开，内容完整渲染
5. 进度条滑动和完成勾选功能正常
6. 深色/浅色主题切换正常
7. 编辑/删除计划功能正常
8. 快捷键 Ctrl+R 刷新后状态保持