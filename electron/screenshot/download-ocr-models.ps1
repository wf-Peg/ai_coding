# download-ocr-models.ps1 - 下载 RapidOCR / PaddleOCR PP-OCRv4 ONNX 模型（多源回退）
# 本文件必须为 UTF-8 带 BOM（Windows PowerShell 5.1 无 BOM 中文乱码解析崩溃）
#
# 用法：powershell -ExecutionPolicy Bypass -File electron/screenshot/download-ocr-models.ps1
# 模型将下载到 electron/screenshot/ocr-models/（源码模式）或随应用打包内置。

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$OutDir = Join-Path $ScriptDir 'ocr-models'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# 多源镜像（按顺序回退）：GitHub Release → hf-mirror 国内镜像 → HuggingFace → PaddleOCR 官方 raw
$GH = 'https://github.com/RapidAI/RapidOCR/releases/download/v4.0.0'
$HF = 'https://hf-mirror.com/spaces/RapidAI/RapidOCR/resolve/main'
$HFRAW = 'https://huggingface.co/spaces/RapidAI/RapidOCR/resolve/main'
$PP = 'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/ppocr_keys_v1.txt'

$Jobs = @(
  @{ n = 'ch_PP-OCRv4_det_infer.onnx'; urls = @("$GH/det.onnx", "$HF/models/text_det/ch_PP-OCRv4_det_infer.onnx", "$HFRAW/models/text_det/ch_PP-OCRv4_det_infer.onnx") },
  @{ n = 'ch_PP-OCRv4_rec_infer.onnx'; urls = @("$GH/rec.onnx", "$HF/models/text_rec/ch_PP-OCRv4_rec_infer.onnx", "$HFRAW/models/text_rec/ch_PP-OCRv4_rec_infer.onnx") },
  @{ n = 'ch_PP-OCRv4_cls_infer.onnx'; urls = @("$GH/cls.onnx", "$HF/models/text_cls/ch_PP-OCRv4_cls_infer.onnx", "$HFRAW/models/text_cls/ch_PP-OCRv4_cls_infer.onnx") },
  @{ n = 'ppocr_keys_v1.txt';          urls = @("$GH/ppocr_keys_v1.txt", $PP, "$HF/models/ppocr_keys_v1.txt") }
)

$done = 0
foreach ($job in $Jobs) {
  $t = Join-Path $OutDir $job.n
  if (Test-Path $t) { Write-Host "[OK] 已存在: $($job.n)"; $done++; continue }
  Write-Host "下载 $($job.n) ..."
  $ok = $false
  foreach ($u in $job.urls) {
    try {
      Invoke-WebRequest -Uri $u -OutFile $t -UseBasicParsing -TimeoutSec 90
      Write-Host "  [OK] $($job.n) ($((Get-Item $t).Length) bytes)"
      $ok = $true; $done++; break
    } catch {
      Write-Host "  [skip] $($job.n) <- $($_.Exception.Message)" -ForegroundColor DarkGray
    }
  }
  if (-not $ok) { Write-Host "  [FAIL] $($job.n) 所有下载源均失败" -ForegroundColor Yellow }
}

Write-Host ""
Write-Host "OCR 模型目录: $OutDir"
Write-Host "就绪: $done/4"
if ($done -eq 4) { Write-Host "[OK] OCR 模型就绪，重启应用后生效" }
else {
  Write-Host "[WARN] 部分模型缺失；可浏览器打开以下页面手动下载放入 $OutDir :" -ForegroundColor Yellow
  Write-Host "  https://huggingface.co/spaces/RapidAI/RapidOCR/tree/main/models" -ForegroundColor Yellow
  Write-Host "  需要: text_det/ ch_PP-OCRv4_det_infer.onnx, text_rec/ ch_PP-OCRv4_rec_infer.onnx, text_cls/ ch_PP-OCRv4_cls_infer.onnx, ppocr_keys_v1.txt" -ForegroundColor Yellow
}
