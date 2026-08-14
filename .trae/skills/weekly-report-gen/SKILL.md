---
name: weekly-report-gen
description: 周报生成 — 基于剪藏待办模块本周完成的任务，按周报模板填充 xlsx 文件，输出到周报目录。
---

# 周报生成 Skill

## 概述

将剪藏待办模块本周创建/完成的任务，按周报模板格式生成 xlsx 文件，输出到周报目录。

- **数据源**：剪藏待办（todoList），本周一 00:00 到本周日 23:59
- **AI 智能识别**：工作待办（默认保留）/生活待办（忽略）
- **title 编码解析**：从 title 末尾的 `[任务类型,工时h,进度%]` 提取元信息
- **xlsx 生成方式**：复制最近的周报模板，覆盖数据区，保留原格式
- **输出目录**：`D:\develop\svnRep\信息科技部\1、职能管理\3、管理周报\2、软件开发跨组\2026\信贷核心\彭文峰\`
- **文件名**：`开发组_周报_{本周五YYYYMMDD}_彭文峰.xlsx`

## 触发场景

1. 用户主动触发："生成周报" / "周报生成" / "weekly report" / "本周周报"
2. TRAE Schedule 自动化：每周五 16:00 自动触发

## 流程

```
计算本周时间范围（本周一 00:00 - 本周日 23:59）
    ↓
调用 GET /api/todo/list 获取所有待办
    ↓
按 createdAtTimestamp 过滤本周待办
    ↓
AI 识别工作 vs 生活待办
    ↓
解析 title 末尾 [任务类型,工时h,进度%]
    ↓
按 taskType 分组
    ↓
找到最近的周报模板 xlsx → 复制 → 填数据 → 另存为新文件
    ↓
输出文件路径给用户
```

## Title 编码格式

### 格式

```
<任务内容描述>[<任务类型>,<计划工时>h,<完成进度>%]
```

### 字段说明

| 字段 | 必填 | 格式 | 示例 |
|------|------|------|------|
| 任务内容描述 | ✅ | 自由文本 | 度小满账务文件入账内容开发 |
| 任务类型 | ❌ | 枚举值（见下） | 需求分析 |
| 计划工时 | ❌ | 数字+h（支持小数） | 15h、4.5h |
| 完成进度 | ❌ | 0-100 整数+% | 30% |

### 任务类型枚举

```
项目开发、需求分析、系统设计、详细设计、架构设计、开发自测、联调测试、缺陷
```

### 解析规则

1. 提取 title 末尾 `[...]` 中的内容（如无则全为任务描述）
2. 按逗号分割
3. 逐项识别：
   - 含"项目开发/需求分析/系统设计/详细设计/架构设计/开发自测/联调测试/缺陷"关键词 → taskType
   - 匹配 `^\d+(\.\d+)?h$` → plannedHours（去 h 转数字）
   - 匹配 `^\d+%$` → progress（去 % 转数字）
4. **默认值**：
   - taskType 未指定 → `项目开发`
   - plannedHours 未指定 → `0`
   - progress 未指定 → `completed=true ? 100 : 0`

### 示例

| title | 解析结果 |
|-------|---------|
| `度小满账务文件入账内容开发[需求分析,15h,30%]` | type=需求分析, hours=15, progress=30% |
| `字节账务文件下载代码开发[项目开发,20h]` | type=项目开发, hours=20, progress=100%(若 completed) |
| `微众联调配合[联调测试,8h]` | type=联调测试, hours=8, progress=0%(若未完成) |
| `完成月报` | type=项目开发(默认), hours=0, progress=0% |
| `修复sftp连接超时缺陷[缺陷,2h]` | type=缺陷, hours=2, progress=0% |

## AI 工作待办识别规则

> ⚠️ 用于过滤掉偶尔混入的生活待办，避免污染周报。

### 工作关键词（命中 → 工作待办）

开发、设计、测试、联调、修复、缺陷、需求、上线、配置、优化、监控、迁移、对接、配合、文档、自测、代码、sftp、API、数据库、接口、加工、入账、对账、清算、账务、文件、报表、bug、review、部署、回滚、灰度、生产、环境、日志、告警、性能、压测、单元测试、集成测试、回归、上线验证、数据校验、生产核检

### 生活关键词（命中 → 生活待办，跳过）

购物、家庭、旅行、生活、健康、运动、读书、买菜、缴费、聚会、生日、约会、看电影、健身、散步、咖啡、午餐、晚餐、周末、休假、请假

### 识别规则

- 同时含工作和生活关键词 → 归为工作（保守原则）
- 仅含生活关键词 → 跳过
- 都不含 → 默认归为工作（用户说待办模块主要记工作）

## xlsx 填充规则

### Sheet 1 - 1.重点工作进度汇报

> 行 1-2 为标题和表头（保留不动），从行 3 开始填数据。

| 列 | 字段 | 取值规则 |
|----|------|---------|
| A | 任务编号 | 按顺序 P001、P002、P003... |
| B | 任务名称 | title 去除 [..] 后缀的部分 |
| C | 计划工时 | plannedHours（解析所得，默认 0） |
| D | 完成工时 | progress=100% → = plannedHours；否则 = plannedHours × progress / 100 |
| E | 完成进度 | progress + "%" |
| F | 本周情况 | completed ? "已完成" : "进行中" |
| G | 备注说明 | sourceUrl（如有），否则留空 |

### Sheet 2 - 2.主要工作说明

> 行 1 为标题（保留），行 2 为双表头（保留），从行 3 开始填数据。底部工时合计区从行 15 开始。

**左半部分（A-F 列）**：按 taskType 分组，每组一行：

| 列 | 字段 | 取值规则 |
|----|------|---------|
| A | 任务类型 | taskType（如"需求分析"、"项目开发"） |
| B | 本周内容 | 同 taskType 下所有任务 title（去编码后缀）拼接，用分号 `;` 分隔 |
| C | 计划工时(h) | 同 taskType 下 plannedHours 求和 |
| D | 实际工时 | 同 taskType 下 D 列（完成工时）求和 |
| E | （本周内容续） | 留空 |
| F | 本周计划完成情况(h) | = C 列值（计划工时） |

**右半部分（H-J 列）**：与左半部分任务类型一一对应的汇总：

| 列 | 字段 | 取值规则 |
|----|------|---------|
| H | 任务名称 | = A 列（taskType） |
| I | 计划工时(h) | = C 列（同类型求和） |
| J | 本周占比 | = I 列 / 总工时 × 100%（保留 2 位小数） |

**底部合计区**：

| 单元格 | 字段 | 取值规则 |
|--------|------|---------|
| H15 | 应付工时合计 | 文本"应付工时合计"（保留模板） |
| I15 | 应付工时 | 总计划工时 |
| J15 | 工时比 | 100.00% |
| K15 | 休假 | 0 |
| L15 | 合计 | = I15 + K15 |
| H16 | 第N周 | "第 N 周"（N 为今年第几周） |
| I16 | （数值） | = L15 |
| K16 | （数值） | 0 |
| L16 | （数值） | = I16 + K16 |

### Sheet 3 - 3.下周计划

> 行 1 为标题，行 2 为表头（保留），从行 3 开始填数据。
>
> **下周计划来源**：completed=false 且 deadline 落在下周（下周一到下周日）的待办。
>
> 若无下周任务，至少填一行"暂无明确下周计划"占位。

| 列 | 字段 | 取值规则 |
|----|------|---------|
| A | 任务类型 | taskType（解析所得或"项目开发"） |
| B | 任务类型 | = A 列（模板要求重复） |
| C | 任务名称 | title 去除 [..] 后缀 |
| D | 下周计划(h) | plannedHours 或默认 0 |
| E | 备注 | sourceUrl 或留空 |

## PowerShell 完整执行脚本

> ⚠️ 周报生成必须用 PowerShell（依赖 COM Excel 自动化），不要用 curl。

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

# ========== 1. 配置 ==========
$backendUrl = "http://localhost:8081/api/todo/list"
$reportDir = "D:\develop\svnRep\信息科技部\1、职能管理\3、管理周报\2、软件开发跨组\2026\信贷核心\彭文峰"

# 计算本周一 00:00 和本周日 23:59 的时间戳（毫秒）
$today = Get-Date
$dayOfWeek = [int]$today.DayOfWeek  # Sunday=0, Monday=1, ..., Saturday=6
if ($dayOfWeek -eq 0) { $dayOfWeek = 7 }  # 转为 Monday=1, Sunday=7
$monday = $today.Date.AddDays(-($dayOfWeek - 1))
$sunday = $monday.AddDays(7).AddSeconds(-1)
$weekStartMs = [long]($monday.ToUniversalTime() - [DateTime]'1970-01-01').TotalMilliseconds
$weekEndMs = [long]($sunday.ToUniversalTime() - [DateTime]'1970-01-01').TotalMilliseconds

# 本周五日期（用于文件名）
$friday = $monday.AddDays(4)
$fridayStr = $friday.ToString("yyyyMMdd")
$weekNumber = [System.Globalization.CultureInfo]::InvariantCalendar.GetWeekOfYear($today, [System.Globalization.CalendarWeekRule]::FirstFourDay, [System.DayOfWeek]::Monday)

Write-Host "本周时间范围: $monday ~ $sunday"
Write-Host "本周五日期: $fridayStr (第 $weekNumber 周)"

# ========== 2. 调用后端获取待办 ==========
$maxRetries = 3
$retryDelays = @(0, 2, 5)
$allTodos = $null

for ($i = 0; $i -lt $maxRetries -and -not $allTodos; $i++) {
    if ($retryDelays[$i] -gt 0) {
        Start-Sleep -Seconds $retryDelays[$i]
    }
    try {
        $r = Invoke-WebRequest -Uri $backendUrl -Method GET -UseBasicParsing -TimeoutSec 30
        $allTodos = $r.Content | ConvertFrom-Json
        Write-Host "✅ 获取待办成功: $($allTodos.Count) 条"
    } catch {
        Write-Host "⚠️ 第 $($i+1) 次获取失败: $($_.Exception.Message)"
        if ($i -eq $maxRetries - 1) {
            Write-Host "❌ 后端服务不可用，请确认 8081 端口已启动"
            exit 1
        }
    }
}

# ========== 3. 过滤本周待办 + AI 识别工作待办 + 解析 title ==========
$workKeywords = @('开发','设计','测试','联调','修复','缺陷','需求','上线','配置','优化','监控','迁移','对接','配合','文档','自测','代码','sftp','API','数据库','接口','加工','入账','对账','清算','账务','文件','报表','bug','review','部署','回滚','灰度','生产','环境','日志','告警','性能','压测','回归','数据校验','核检')
$lifeKeywords = @('购物','家庭','旅行','生活','健康','运动','读书','买菜','缴费','聚会','生日','约会','看电影','健身','散步','咖啡','午餐','晚餐','周末','休假','请假')

$taskTypes = @('项目开发','需求分析','系统设计','详细设计','架构设计','开发自测','联调测试','缺陷')

function Parse-TodoTitle {
    param([string]$title, [bool]$completed)

    $result = @{
        taskName = $title
        taskType = '项目开发'
        plannedHours = 0
        progress = if ($completed) { 100 } else { 0 }
    }

    # 提取末尾 [..] 中的内容
    if ($title -match '\[([^\]]+)\]\s*$') {
        $encoded = $matches[1]
        $result.taskName = ($title -replace '\s*\[[^\]]+\]\s*$', '').Trim()
        $parts = $encoded -split ','
        foreach ($part in $parts) {
            $part = $part.Trim()
            # 任务类型
            foreach ($t in $taskTypes) {
                if ($part -eq $t) { $result.taskType = $t; break }
            }
            # 工时（如 15h、4.5h）
            if ($part -match '^\d+(\.\d+)?h$') {
                $result.plannedHours = [double]($part -replace 'h$','')
            }
            # 进度（如 30%）
            if ($part -match '^\d+%$') {
                $result.progress = [int]($part -replace '%$','')
            }
        }
    }
    return $result
}

function Test-IsWorkTodo {
    param([string]$title)
    $isWork = $false
    $isLife = $false
    foreach ($kw in $workKeywords) {
        if ($title -like "*$kw*") { $isWork = $true; break }
    }
    foreach ($kw in $lifeKeywords) {
        if ($title -like "*$kw*") { $isLife = $true; break }
    }
    # 同时命中 → 工作；仅生活 → 生活；都不命中 → 工作（默认）
    if ($isLife -and -not $isWork) { return $false }
    return $true
}

# 本周待办（按 createdAtTimestamp 过滤）
$thisWeekTodos = @()
foreach ($todo in $allTodos) {
    $createdMs = $todo.createdAtTimestamp
    if ($createdMs -ge $weekStartMs -and $createdMs -le $weekEndMs) {
        # AI 识别工作 vs 生活
        if (-not (Test-IsWorkTodo -title $todo.title)) {
            Write-Host "⏭️ 跳过生活待办: $($todo.title)"
            continue
        }
        # 解析 title
        $parsed = Parse-TodoTitle -title $todo.title -completed $todo.completed
        $todo | Add-Member -NotePropertyName parsed -NotePropertyValue $parsed
        $thisWeekTodos += $todo
    }
}

Write-Host "📊 本周工作待办: $($thisWeekTodos.Count) 条"

# ========== 4. 计算 D 列（完成工时）和分组 ==========
foreach ($t in $thisWeekTodos) {
    $p = $t.parsed
    if ($p.progress -eq 100) {
        $p | Add-Member -NotePropertyName doneHours -NotePropertyValue $p.plannedHours
    } else {
        $doneHours = [math]::Round($p.plannedHours * $p.progress / 100, 2)
        $p | Add-Member -NotePropertyName doneHours -NotePropertyValue $doneHours
    }
}

# 按 taskType 分组
$grouped = $thisWeekTodos | Group-Object { $_.parsed.taskType }
$nextWeekTodos = $allTodos | Where-Object {
    $_.completed -eq $false -and $_.deadline -ne $null -and `
    [datetime]::Parse($_.deadline) -ge $sunday.AddDays(1) -and `
    [datetime]::Parse($_.deadline) -le $sunday.AddDays(7)
}

# ========== 5. 找到最近的周报模板 ==========
$existingReports = Get-ChildItem -Path $reportDir -Filter "开发组_周报_*_彭文峰.xlsx" | Sort-Object Name -Descending
if ($existingReports.Count -eq 0) {
    Write-Host "❌ 找不到任何历史周报模板"
    exit 1
}
$templateFile = $existingReports[0].FullName
$newFileName = "开发组_周报_${fridayStr}_彭文峰.xlsx"
$newFilePath = Join-Path $reportDir $newFileName

Write-Host "📁 模板文件: $templateFile"
Write-Host "📁 输出文件: $newFilePath"

# 复制模板为新文件
Copy-Item -Path $templateFile -Destination $newFilePath -Force
Write-Host "✅ 已复制模板"

# ========== 6. 用 COM Excel 填充数据 ==========
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
    $wb = $excel.Workbooks.Open($newFilePath)

    # ----- Sheet 1: 1.重点工作进度汇报 -----
    $ws1 = $wb.Sheets.Item("1.重点工作进度汇报")
    # 清空第 3 行起的数据
    $used1 = $ws1.UsedRange
    $lastRow1 = $used1.Rows.Count
    if ($lastRow1 -ge 3) {
        $ws1.Range("A3:G$lastRow1").ClearContents() | Out-Null
    }
    # 填入任务
    $rowIdx = 3
    $taskNo = 1
    foreach ($t in $thisWeekTodos) {
        $p = $t.parsed
        $ws1.Cells.Item($rowIdx, 1) = "P{0:D3}" -f $taskNo
        $ws1.Cells.Item($rowIdx, 2) = $p.taskName
        $ws1.Cells.Item($rowIdx, 3) = $p.plannedHours
        $ws1.Cells.Item($rowIdx, 4) = $p.doneHours
        $ws1.Cells.Item($rowIdx, 5) = "$($p.progress)%"
        $ws1.Cells.Item($rowIdx, 6) = if ($t.completed) { "已完成" } else { "进行中" }
        $ws1.Cells.Item($rowIdx, 7) = if ($t.sourceUrl) { $t.sourceUrl } else { "" }
        $rowIdx++
        $taskNo++
    }
    Write-Host "✅ Sheet 1 已填充 $($thisWeekTodos.Count) 条任务"

    # ----- Sheet 2: 2.主要工作说明 -----
    $ws2 = $wb.Sheets.Item("2.主要工作说明")
    # 清空数据区（A3:F14 + H3:J14）
    $ws2.Range("A3:F14").ClearContents() | Out-Null
    $ws2.Range("H3:J14").ClearContents() | Out-Null

    $totalPlannedHours = 0
    $totalDoneHours = 0
    $rowIdx = 3
    foreach ($grp in $grouped) {
        $taskType = $grp.Name
        $titles = ($grp.Group | ForEach-Object { $_.parsed.taskName }) -join "; "
        $plannedSum = ($grp.Group | ForEach-Object { $_.parsed.plannedHours } | Measure-Object -Sum).Sum
        $doneSum = ($grp.Group | ForEach-Object { $_.parsed.doneHours } | Measure-Object -Sum).Sum

        # 左半部分
        $ws2.Cells.Item($rowIdx, 1) = $taskType
        $ws2.Cells.Item($rowIdx, 2) = $titles
        $ws2.Cells.Item($rowIdx, 3) = $plannedSum
        $ws2.Cells.Item($rowIdx, 4) = $doneSum
        $ws2.Cells.Item($rowIdx, 5) = ""
        $ws2.Cells.Item($rowIdx, 6) = $plannedSum
        # 右半部分
        $ws2.Cells.Item($rowIdx, 8) = $taskType
        $ws2.Cells.Item($rowIdx, 9) = $plannedSum
        $ws2.Cells.Item($rowIdx, 10) = 0  # 占比稍后计算

        $totalPlannedHours += $plannedSum
        $totalDoneHours += $doneSum
        $rowIdx++
    }

    # 计算占比（J 列）
    if ($totalPlannedHours -gt 0) {
        for ($r = 3; $r -lt $rowIdx; $r++) {
            $cellValue = $ws2.Cells.Item($r, 9).Text
            if ($cellValue -and [double]$cellValue -gt 0) {
                $ratio = [double]$cellValue / $totalPlannedHours * 100
                $ws2.Cells.Item($r, 10) = [math]::Round($ratio, 2)
            }
        }
    }

    # 底部合计区（行 15-16）
    $ws2.Cells.Item(15, 8) = "应付工时合计"
    $ws2.Cells.Item(15, 9) = $totalPlannedHours
    $ws2.Cells.Item(15, 10) = 100
    $ws2.Cells.Item(15, 11) = 0  # K15 休假
    $ws2.Cells.Item(15, 12) = $totalPlannedHours  # L15 合计
    $ws2.Cells.Item(16, 8) = "第 $weekNumber 周"
    $ws2.Cells.Item(16, 9) = $totalPlannedHours
    $ws2.Cells.Item(16, 11) = 0
    $ws2.Cells.Item(16, 12) = $totalPlannedHours

    Write-Host "✅ Sheet 2 已填充 $($grouped.Count) 个任务类型，总工时 $totalPlannedHours h"

    # ----- Sheet 3: 3.下周计划 -----
    $ws3 = $wb.Sheets.Item("3.下周计划")
    # 清空数据区（A3:E20）
    $ws3.Range("A3:E20").ClearContents() | Out-Null

    $rowIdx = 3
    if ($nextWeekTodos.Count -eq 0) {
        # 占位
        $ws3.Cells.Item($rowIdx, 1) = "项目开发"
        $ws3.Cells.Item($rowIdx, 2) = "项目开发"
        $ws3.Cells.Item($rowIdx, 3) = "暂无明确下周计划"
        $ws3.Cells.Item($rowIdx, 4) = 0
        $ws3.Cells.Item($rowIdx, 5) = ""
    } else {
        foreach ($t in $nextWeekTodos) {
            $p = Parse-TodoTitle -title $t.title -completed $t.completed
            $ws3.Cells.Item($rowIdx, 1) = $p.taskType
            $ws3.Cells.Item($rowIdx, 2) = $p.taskType
            $ws3.Cells.Item($rowIdx, 3) = $p.taskName
            $ws3.Cells.Item($rowIdx, 4) = $p.plannedHours
            $ws3.Cells.Item($rowIdx, 5) = if ($t.sourceUrl) { $t.sourceUrl } else { "" }
            $rowIdx++
        }
    }
    Write-Host "✅ Sheet 3 已填充 $($nextWeekTodos.Count) 条下周计划"

    # 保存
    $wb.Save()
    Write-Host "✅ 周报已保存: $newFilePath"
} finally {
    if ($wb) { $wb.Close($false) }
    $excel.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

Write-Host ""
Write-Host "🎉 周报生成完成！"
Write-Host "📁 文件: $newFilePath"
Write-Host "📊 本周任务: $($thisWeekTodos.Count) 条"
Write-Host "📋 下周计划: $($nextWeekTodos.Count) 条"
Write-Host "⏰ 总工时: $totalPlannedHours h"
```

## 异常处理

1. **后端不可用**：重试 3 次（0/2/5 秒延迟），失败提示用户启动后端服务
2. **找不到最近的周报模板**：报错退出，提示用户手动创建首份模板
3. **title 解析失败**：降级为「任务类型=项目开发，工时=0，进度=0%」
4. **COM Excel 不可用**：报错提示用户检查 Office/WPS 安装
5. **本周无工作待办**：生成空白周报（仅表头），并在 Sheet 1 填"本周无明确工作内容"
6. **下周无计划待办**：在 Sheet 3 填"暂无明确下周计划"占位

## 使用示例

### 示例 1：手动触发周报生成

用户："生成周报"

执行：
1. 调用上述 PowerShell 脚本
2. 输出文件路径
3. 回复用户："周报已生成：开发组_周报_20260725_彭文峰.xlsx，包含 N 条本周任务，M 条下周计划"

### 示例 2：自动化触发（TRAE Schedule）

- cron：`0 16 * * 5`（每周五 16:00）
- timezone：Asia/Shanghai
- message：执行 weekly-report-gen skill，生成本周周报到 `D:\develop\svnRep\信息科技部\1、职能管理\3、管理周报\2、软件开发跨组\2026\信贷核心\彭文峰\` 目录，文件名为 `开发组_周报_本周五日期_彭文峰.xlsx`，生成完成后告知本周任务数量和总工时。
