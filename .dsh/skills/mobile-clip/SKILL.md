---
name: "mobile-clip"
description: "从TRAE手机APP端添加剪藏（文本/URL/文件），自动识别内容类型，解析后保存为 {yyMMdd}_mobile.json 到 clip-storage 对应分类目录，并推送到 Clip_Bed Git 仓库。Invoke when user says 剪藏、添加剪藏、save clip、mobile clip、收藏内容 等关键词。"
---

# Mobile Clip（手机端剪藏）

## 概述

当用户在 TRAE 手机 APP 端调用此 skill 时，自动完成以下流程：
1. **识别内容类型**：文本 / URL / 文件
2. **解析内容**：URL → 抓取网页正文；文件 → 读取内容；文本 → 直接使用
3. **保存到本地**：`clip-storage/{category}/{yyMMdd}_mobile.json`
4. **推送到 Git**：`https://github.com/wf-Peg/Clip_Bed.git` 的 master 分支

---

## 分类体系

| 一级分类 | value | 二级分类 | value |
|---------|-------|---------|-------|
| 工作项目 | work | 公司事务 | work-company |
| | | 个人副业 | work-side |
| 学习成长 | study | 课程学习 | study-course |
| | | 读书笔记 | study-book |
| 生活健康 | life | 日常记录 | life-daily |
| | | 健康运动 | life-health |
| 兴趣探索 | hobby | 技术探索 | hobby-tech |
| | | 创意灵感 | hobby-idea |
| 财务规划 | finance | 投资理财 | finance-invest |
| | | 消费记录 | finance-spend |
| 人脉社交 | social | 人脉管理 | social-contact |
| | | 社交活动 | social-event |

默认分类：用户未指定时使用 `inbox`。

---

## 执行流程

### Step 1：识别内容类型

- **URL**：以 `http://` 或 `https://` 开头的字符串 → 类型 `link-ai`
- **文件**：用户上传了文件（图片/PDF/文档等） → 类型 `doc-ai`
- **文本**：其他任意文本内容 → 类型 `ai-text`

### Step 2：解析内容

**URL 类型**：使用 `WebFetch` 工具抓取网页正文内容。

**文件类型**：使用 `Read` 工具读取文件内容，支持：
- 文本文件（.txt/.md/.json/.csv 等）
- 图片文件（.png/.jpg/.webp 等）→ 保存图片路径，提取图片描述

**文本类型**：直接使用用户输入的内容。

### Step 3：确定分类

- 若用户明确指定了分类（如"存到工作"、"分类：学习"），则使用对应 value
- 若用户未指定，默认使用 `inbox`

### Step 4：生成 AI 摘要与分析

对解析后的内容，调用 AI 生成：
- `summary`：不超过 100 字的简短摘要
- `analysis`：深度分析，Markdown 格式

### Step 5：保存文件

**文件路径**：`clip-storage/{categoryDir}/{yyMMdd}_mobile.json`

**categoryDir 规则**：
- 一级分类（如 `work`）→ `clip-storage/work/`
- 二级分类（如 `work-company`）→ `clip-storage/work/公司事务/`
- `inbox` 或 `default` → `clip-storage/inbox/` 或 `clip-storage/default/`

**文件命名**：`{yyMMdd}_mobile.json`，例如 `260628_mobile.json`。`_mobile` 后缀确保不与桌面端剪藏文件（`260628.json`）冲突。

**JSON 格式**（与 ClipContent 模型一致）：

```json
[
  {
    "id": 1000001,
    "content": "原始内容全文",
    "type": "ai-text",
    "source": "mobile",
    "category": "work",
    "title": "标题（取前30字或URL标题）",
    "sourceUrl": "原始URL（如有）",
    "siteName": "站点名称（如有）",
    "capturedAt": "2026-06-28 14:00:00",
    "selectedText": "",
    "contextBefore": "",
    "contextAfter": "",
    "captureMethod": "mobile-clip",
    "workflowStatus": "inbox",
    "tags": [],
    "createdAt": "2026-06-28T14:00:00.000",
    "summary": "AI生成的摘要",
    "analysis": "AI生成的分析",
    "divergentSummary": "",
    "imagePaths": [],
    "isFavorite": false,
    "actionItems": []
  }
]
```

**ID 生成规则**：使用当前时间戳（毫秒）的后 7 位 + 随机 2 位数字，确保不与桌面端冲突。

**重要**：如果目标文件已存在，读取现有内容，将新条目追加到数组末尾，而非覆盖。

### Step 6：推送到 Git 仓库

使用 `RunCommand` 执行以下 Git 操作：

```bash
# 1. 克隆或进入仓库
cd /tmp/Clip_Bed 2>/dev/null || git clone https://github.com/wf-Peg/Clip_Bed.git /tmp/Clip_Bed

# 2. 同步最新代码
cd /tmp/Clip_Bed && git pull origin master

# 3. 复制新文件到仓库
cp {source_file} /tmp/Clip_Bed/clip-storage/{categoryDir}/{yyMMdd}_mobile.json

# 4. 提交并推送
cd /tmp/Clip_Bed && git add . && git commit -m "mobile-clip: {date} {title}" && git push origin master
```

注意：如果 Git 操作需要认证，使用 `GH_TOKEN` 环境变量或已配置的凭据。

---

## 使用示例

### 示例 1：文本剪藏

```
用户：剪藏以下内容：今天学习了 Spring Boot 的自动配置原理，核心是 @EnableAutoConfiguration 注解...
```

→ 类型 `ai-text`，分类 `study`（学习成长），保存为 `clip-storage/study/260628_mobile.json`

### 示例 2：URL 剪藏

```
用户：剪藏这篇文章 https://example.com/article/123
```

→ 类型 `link-ai`，使用 WebFetch 抓取内容，提取标题，保存为 `clip-storage/inbox/260628_mobile.json`

### 示例 3：指定分类

```
用户：剪藏到工作分类：今天开会讨论了Q3目标...
```

→ 类型 `ai-text`，分类 `work`，保存为 `clip-storage/work/260628_mobile.json`

### 示例 4：文件剪藏

```
用户：[上传文件] 帮我剪藏这个文档
```

→ 类型 `doc-ai`，读取文件内容，保存为 `clip-storage/default/260628_mobile.json`

---

## 约束

1. **文件命名**：必须使用 `{yyMMdd}_mobile.json` 格式，`_mobile` 后缀不可省略
2. **ID 不冲突**：使用时间戳后 7 位 + 随机数，避免与桌面端 ID 冲突
3. **追加不覆盖**：读取已有文件，新条目追加到数组末尾
4. **Git 推送**：保存后必须推送到 Clip_Bed 仓库 master 分支
5. **分类目录**：二级分类需创建子目录（如 `work/公司事务/`），一级分类直接放根目录
6. **source 字段**：固定为 `"mobile"`
7. **captureMethod 字段**：固定为 `"mobile-clip"`