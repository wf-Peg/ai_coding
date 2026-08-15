# download-ocr-models.ps1 — 下载 RapidOCR / PaddleOCR PP-OCRv4 ONNX 模型
#
# 用途：离线 OCR（ocr-service.js）所需的 det/rec/cls 模型 + 字典。
# 用法（在项目根目录执行）：
#   powershell -ExecutionPolicy Bypass -File electron/screenshot/download-ocr-models.ps1
#
# 说明：默认从 RapidOCR 模型托管下载 PP-OCRv4 onnx（百度 PaddleOCR 官方模型导出）。
#       可改用 $env:OCR_BASE_URL 指定镜像；下载失败时按文末"手动放置"指引操作。
# 网络不可用时可手动下载以下文件放入 electron/screenshot/ocr-models/：
#   ch_PP-OCRv4_det_infer.onnx   (~4.7MB)  文本检测
#   ch_PP-OCRv4_rec_infer.onnx   (~10.4MB) 文本识别
#   ch_PP-OCRv4_cls_infer.onnx   (~1.6MB)  方向分类
#   ppocr_keys_v1.txt            (~103KB)  中文字典

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$OutDir = Join-Path $ScriptDir 'ocr-models'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# RapidOCR 官方模型下载根（可被 $env:OCR_BASE_URL 覆盖）
$Base = $env:OCR_BASE_URL
if (-not $Base) {
  $Base = 'https://github.com/RapidAI/RapidOCR/releases/download/v4.0.0'
}

$Files = @(
  @{ name = 'ch_PP-OCRv4_det_infer.onnx'; url = "$Base/det.onnx" },
  @{ name = 'ch_PP-OCRv4_rec_infer.onnx'; url = "$Base/rec.onnx" },
  @{ name = 'ch_PP-OCRv4_cls_infer.onnx'; url = "$Base/cls.onnx" },
  @{ name = 'ppocr_keys_v1.txt';          url = "$Base/ppocr_keys_v1.txt" }
)

foreach ($f in $Files) {
  $target = Join-Path $OutDir $f.name
  if (Test-Path $target) { Write-Host "已存在，跳过: $($f.name)"; continue }
  Write-Host "下载 $($f.name) ..."
  try {
    Invoke-WebRequest -Uri $f.url -OutFile $target -UseBasicParsing
    Write-Host "  完成: $($f.name) ($((Get-Item $target).Length) bytes)"
  } catch {
    Write-Host "  下载失败: $($f.name) -> $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "  可手动下载后放入: $OutDir" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "OCR 模型目录: $OutDir"
$ok = @('ch_PP-OCRv4_det_infer.onnx','ch_PP-OCRv4_rec_infer.onnx','ch_PP-OCRv4_cls_infer.onnx','ppocr_keys_v1.txt') |
      Where-Object { Test-Path (Join-Path $OutDir $_) }
Write-Host "就绪: $($ok.Count)/4"
if ($ok.Count -eq 4) { Write-Host "✅ OCR 模型就绪，重启应用后生效" } else { Write-Host "⚠️ 部分模型缺失，OCR 将降级为不可用提示" }
