---
name: smart-ingest
description: 智能入库 — 接收任意文本，AI 自动识别意图（剪藏/待办/话题）、提取结构化字段，并调用后端已有接口入库。
---

# 智能入库 Skill

## 概述

当用户提供文本内容需要入库时，按以下规则路由：

- **默认流程**：agent 自主完成"意图识别 + 字段提取"，根据识别结果调用对应的具体接口（`/api/clip/add`、`/api/todo/add`、`/api/topic`）
- **例外流程**：用户**明确指定类型关键词**时，跳过意图识别，直接走对应接口

> ⚠️ 核心原则：**默认走 agent 整理好的结构化数据**，避免后端 AI 重复处理；只有用户明确说"智能剪藏"才走 `/api/ingest` 让后端 AI 全权处理。

## 流程决策树

```
用户发送内容
    ↓
检查是否含"强制类型关键词"
    ↓
┌───────────────┬──────────────┐
│ 含关键词       │ 无关键词      │
└───────┬───────┴──────┬───────┘
        ↓              ↓
   走例外流程       走默认流程
        ↓              ↓
   按关键词         agent 做意图识别
   选定接口         + 字段提取
        ↓              ↓
   入库            按识别意图调对应接口
```

## 强制类型关键词识别

用户在指令中**明确指定类型关键词**时，agent **跳过意图识别**，直接按指定类型走对应接口（包含匹配）：

| 用户关键词 | 走的接口 | 说明 |
|----------|---------|------|
| "智能剪藏"、"智能入库"、"smart clip"、"ingest"、"后端AI处理" | `POST /api/ingest` | **特殊路径**：agent 不做字段提取，只传 `{"text": 原文}`，让后端 AI 全权处理 |
| "剪藏到话题"、"作为话题入库"、"添加话题"、"创建话题"、"topic入库" | `POST /api/topic` | 跳过意图识别，强制按话题整理字段入库 |
| "添加剪藏"、"剪藏入库"、"保存为剪藏"、"clip入库"、"clip this" | `POST /api/clip/add` | 跳过意图识别，强制按剪藏整理字段入库 |
| "添加待办"、"创建待办"、"新建待办"、"todo入库"、"todo this" | `POST /api/todo/add` | 跳过意图识别，强制按待办整理字段入库 |

> 关键词匹配规则：用户原话包含上述关键词即触发例外流程（如"智能剪藏这个"或"用智能剪藏"都识别为例外）。

## 接口选择优先级

1. **用户明确指定类型** > 一切（最高优先级，直接走例外流程）
2. **agent 意图识别结果** > 默认降级（clip）
3. **字段提取失败** > 降级为 clip，使用原文作为 content

## 意图识别规则（仅默认流程使用）

> ⚠️ 本规则需与后端 `AiService.identifyIntent` 的 systemPrompt 保持同步，修改时请两处同时更新。

根据文本内容判断意图：

- **clip（剪藏）**：长文分析、URL、结构化报告、知识点、无明确行动项或待办属性的内容
- **todo（待办）**：含 deadline/时间限制、优先级、行动项、待办标记、提醒类内容
- **topic（话题）**：分享推荐、观点讨论、社交讨论、对话内容

## 字段提取规则

### clip 剪藏

提取字段：title, content, summary, category, tags, sourceUrl, siteName

- **title**: 简短标题（≤30字）
- **content**: 原文内容
- **summary**: 一句话摘要（≤100字，**严禁直接复制原文**，必须是从原文提炼的概括性描述）
- **category**: 分类（work/study/life/hobby/finance/social）
- **tags**: 标签数组
- **sourceUrl**: 来源URL（如有）
- **siteName**: 来源站点名（如有）

> ⚠️ **summary 字段规范**
>
> summary 必须是 agent 对内容的**主动概括**，不是原文截取或原文本身。
>
> - ✅ 正确：用一句话概括内容主题、关键信息、价值点
> - ❌ 错误：把 content 原文直接当 summary；截取原文前 N 个字当 summary
>
> 示例：
> - 内容是"V2EX 75 条回复推荐各种看片网站..."
> - summary 应为："V2EX 用户求推荐替代飞极速的看片网站，75 条回复涵盖流媒体、PT、Emby 私服、自建方案、BT 磁力等多种渠道，反映跨平台聚合观影需求。"
> - summary 不应为："之前都是用飞极速看动漫，电影啥的，现在搜不到了..."（原文截取）

> ⚠️ **关键约束：资源完整性要求**
>
> 当剪藏内容涉及多个应用、工具、网站推荐或资源汇总时，**结构化整理后必须保留每个相关应用的名称和对应网址**，才算整理收集完全。
>
> **禁止**：只做概括性摘要而丢失具体的资源链接，这会导致剪藏失去收藏价值。
>
> **正确做法**：在 content 字段中以结构化格式保留所有应用名+网址，例如：
> ```
> 1. 应用名A：https://example-a.com（简介）
> 2. 应用名B：https://example-b.com（简介）
> 3. 工具C：https://tool-c.com（简介）
> ```
>
> **校验标准**：整理后的 content 应能让用户再次查看时，直接获取每个推荐应用的名称和可访问的 URL，无需重新搜索。

### todo 待办

提取字段：title, priority, deadline, deadlineTime, category

- **title**: 待办标题（≤50字）
- **priority**: 优先级（high/medium/low）
- **deadline**: 截止日期（如"2026-07-20"）
- **deadlineTime**: 截止时间（如"15:00"）
- **category**: 分类

### topic 话题

提取字段：title, summary, content, category, tags

- **title**: 话题标题（≤50字）
- **summary**: 摘要
- **content**: 完整内容（同 clip 的资源完整性要求：涉及应用/网站推荐时必须保留应用名+网址）
- **category**: 分类
- **tags**: 标签数组

## 调用后端接口

后端服务运行在 `http://localhost:8081`，请确保服务已启动。

### 平台兼容性调用方式

> ⚠️ Windows 环境下 curl 存在编码与稳定性问题（exit code 7 假阴性），**优先使用 PowerShell 的 `Invoke-WebRequest`**；macOS/Linux 可继续用 curl。

### 默认流程接口（agent 已整理字段）

#### 1. POST /api/clip/add（默认 intent=clip，或用户说"添加剪藏"）

**触发场景**：
- 默认流程：agent 识别 intent=clip
- 例外流程：用户含"添加剪藏"/"剪藏入库"/"保存为剪藏"等关键词

> ⚠️ **关键约束：使用 store-only 类型，跳过后端 AI 分析**
>
> agent 已经完成意图识别+字段提取+结构化整理（title/content/tags/category 都已就绪），后端只需要**存储**，**不要再调用 AI 重复分析**。
>
> - `type` 必须为 `"store-only"`（若为 `"ai-text"` 会触发后端 `processWithAi` 重新做分类/标签/摘要，浪费 token 且可能覆盖 agent 已整理的字段）
> - `useAiTags` 必须为 `false`（agent 已提取好 tags，不需要后端 AI 再生成）
> - `workflowStatus` 为 `"inbox"`（store-only 类型默认进入收件箱等待整理）

**请求体字段**：
```json
{
  "type": "store-only",
  "content": "<content>",
  "title": "<title>",
  "summary": "<一句话概括，≤100字，严禁复制原文>",
  "source": "<source>",
  "sourceUrl": "<sourceUrl>",
  "siteName": "<siteName>",
  "category": "<category>",
  "tags": ["<tag1>", "<tag2>"],
  "useAiTags": false,
  "workflowStatus": "inbox"
}
```

#### 2. POST /api/todo/add（默认 intent=todo，或用户说"添加待办"）

**触发场景**：
- 默认流程：agent 识别 intent=todo
- 例外流程：用户含"添加待办"/"创建待办"/"新建待办"等关键词

**请求体字段**：
```json
{
  "title": "<title>",
  "priority": "<priority>",
  "deadline": "<deadline>",
  "deadlineTime": "<deadlineTime>",
  "category": "<category>"
}
```

#### 3. POST /api/topic（默认 intent=topic，或用户说"剪藏到话题"）

**触发场景**：
- 默认流程：agent 识别 intent=topic
- 例外流程：用户含"剪藏到话题"/"添加话题"/"创建话题"等关键词

**请求体字段**：
```json
{
  "title": "<title>",
  "summary": "<summary>",
  "content": "<content>",
  "category": "<category>",
  "tags": ["<tag1>", "<tag2>"]
}
```

### 例外流程接口（特殊路径）

#### POST /api/ingest（用户说"智能剪藏"/"智能入库"）

**触发场景**：用户含"智能剪藏"/"智能入库"/"smart clip"/"ingest"/"后端AI处理"等关键词

**特殊说明**：此接口是"后端 AI 全权处理"模式，agent **不做字段提取**，只把原文 `text` 传给后端，由后端 AI 完成意图识别+字段提取+路由入库。

**请求体**（极简，只有一个 text 字段）：
```json
{
  "text": "<用户原始文本>"
}
```

**响应**：
```json
{
  "success": true,
  "intent": "clip|todo|topic",
  "id": <id>,
  "title": "<后端AI生成的标题>",
  "redirect": "/api/<type>/<id>"
}
```

### PowerShell 调用模板

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$body = @{
    # 字段根据调用的接口填入
} | ConvertTo-Json -Depth 5

$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)

try {
    $r = Invoke-WebRequest -Uri "http://localhost:8081/api/<endpoint>" -Method POST `
        -UseBasicParsing -TimeoutSec 30 `
        -ContentType "application/json; charset=utf-8" -Body $bodyBytes
    Write-Host "Status: $($r.StatusCode)"
    Write-Host "Response: $($r.Content)"
} catch {
    Write-Host "请求失败: $($_.Exception.Message)"
}
```

## 重试机制（重要）

> 后端在冷启动或 GC 暂停时可能出现瞬时连接失败（exit code 7），**不能一次失败就放弃**。

### 重试策略

1. **第 1 次失败**：等待 2 秒后重试
2. **第 2 次失败**：等待 5 秒后重试
3. **第 3 次仍失败**：确认后端服务未运行，提示用户

### PowerShell 重试模板

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$maxRetries = 3
$retryDelays = @(0, 2, 5)  # 第1次立即，第2次等2秒，第3次等5秒
$success = $false

for ($i = 0; $i -lt $maxRetries -and -not $success; $i++) {
    if ($retryDelays[$i] -gt 0) {
        Write-Host "等待 $($retryDelays[$i]) 秒后重试..."
        Start-Sleep -Seconds $retryDelays[$i]
    }
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:8081/api/<endpoint>" -Method POST `
            -UseBasicParsing -TimeoutSec 30 `
            -ContentType "application/json; charset=utf-8" -Body $bodyBytes
        Write-Host "✅ 入库成功 (Status: $($r.StatusCode))"
        Write-Host "Response: $($r.Content)"
        $success = $true
    } catch {
        Write-Host "⚠️ 第 $($i+1) 次尝试失败: $($_.Exception.Message)"
        if ($i -eq $maxRetries - 1) {
            Write-Host "❌ 后端服务不可用，请确认 8080 端口已启动"
        }
    }
}
```

## 异常处理

1. **后端不可用**：按重试机制处理；3 次仍失败则提示"请先启动后端服务（端口 8080），可执行 `start.bat` 或打开 Electron 应用"
2. **意图不明确**：默认降级为 clip 剪藏类型
3. **字段提取失败**：使用原文作为 content，title 取原文前 30 字
4. **API 返回错误**：展示后端返回的错误信息给用户
5. **中文乱码**：Windows 下必须用 UTF-8 字节数组传 body，`ContentType` 设为 `application/json; charset=utf-8`

## 使用示例

### 默认流程示例

#### 示例 1：默认流程 - 待办入库

用户说："入库：明天下午3点前完成报告，高优先级"

→ 走默认流程（无关键词）
→ agent 识别 intent=todo
→ 提取 title="完成报告", priority="high", deadline="2026-07-19", deadlineTime="15:00"
→ PowerShell POST /api/todo/add（带重试）
→ 告知用户："待办已入库：完成报告（高优先级，截止 2026-07-19 15:00）"

#### 示例 2：默认流程 - 普通文章剪藏

用户说："把这篇文章存起来：TCP三次握手详解..."

→ 走默认流程（无关键词）
→ agent 识别 intent=clip
→ 提取 title="TCP三次握手详解", category="study", tags=["网络", "TCP"]
→ PowerShell POST /api/clip/add（带重试）
→ 告知用户："剪藏已入库：TCP三次握手详解"

#### 示例 3：默认流程 - 资源汇总类剪藏（必须保留应用名+网址）

用户说："入库这个帖子：V2EX 上大家推荐的各种看片网站..."

→ 走默认流程（无关键词）
→ agent 识别 intent=clip
→ **关键**：content 字段必须结构化整理并保留每个推荐应用名+网址：
  ```
  V2EX 帖子《求一个看片网站》推荐汇总：
  
  1. 低端影视(ddys)：https://ddys.app（老牌流媒体站，近期回归）
  2. Libvio：https://libvio.lat（在线流媒体）
  3. Vidhub：https://vidhub.tv
  4. 教父 PT：https://教父.com（需邀请）
  5. 动漫花园：https://share.dmhy.org（BT/磁力）
  6. 影和导航：https://yinghezhinan.com（聚合导航）
  ...
  ```
→ PowerShell POST /api/clip/add
→ 告知用户："剪藏已入库：xxx（含 N 个资源链接）"

### 例外流程示例

#### 示例 4：例外流程 - 智能剪藏（后端 AI 处理）

用户说："智能剪藏这个内容：[一段长文本]"

→ 走例外流程（含"智能剪藏"关键词）
→ 跳过 agent 字段提取
→ PowerShell POST /api/ingest，只传 `{"text": "<用户原始文本>"}`
→ 后端 AI 自主完成意图识别+字段提取+路由入库
→ 告知用户："已通过后端AI智能入库：xxx（intent=clip/todo/topic，id=N）"

#### 示例 5：例外流程 - 剪藏到话题（强制作为话题）

用户说："剪藏到话题：关于AI发展的讨论..."

→ 走例外流程（含"剪藏到话题"关键词）
→ 跳过意图识别
→ agent 按话题规则提取字段（title, summary, content, category, tags）
→ PowerShell POST /api/topic
→ 告知用户："话题已入库：xxx"

#### 示例 6：例外流程 - 添加待办（强制作为待办）

用户说："添加待办：完成月报"

→ 走例外流程（含"添加待办"关键词）
→ 跳过意图识别
→ agent 按待办规则提取字段（title, priority, deadline, deadlineTime, category）
→ PowerShell POST /api/todo/add
→ 告知用户："待办已入库：完成月报"
