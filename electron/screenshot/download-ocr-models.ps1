# download-ocr-models.ps1 - 下载 RapidOCR / PaddleOCR PP-OCRv4 ONNX 模型
# 注意：本文件必须为 UTF-8 带 BOM（Windows PowerShell 5.1 按 ANSI 读取无 BOM 脚本会中文乱码导致解析失败）

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

$done = 0
foreach ($f in $Files) {
  $target = Join-Path $OutDir $f.name
  if (Test-Path $target) { Write-Host "[OK] 已存在，跳过: $($f.name)"; $done++; continue }
  Write-Host "下载 $($f.name) ..."
  try {
    Invoke-WebRequest -Uri $f.url -OutFile $target -UseBasicParsing -TimeoutSec 120
    Write-Host "  完成: $($f.name) ($((Get-Item $target).Length) bytes)"
    $done++
  } catch {
    Write-Host "  [FAIL] $($f.name) -> $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "OCR 模型目录: $OutDir"
Write-Host "就绪: $done/4"
if ($done -eq 4) { Write-Host "[OK] OCR 模型就绪，重启应用后生效" }
else {
  Write-Host "[WARN] 部分模型缺失；可尝试以下方式：" -ForegroundColor Yellow
  Write-Host "  1) 设置镜像源后重试：$env:OCR_BASE_URL = 'https://github.com/RapidAI/RapidOCR/releases/download/v4.0.0'" -ForegroundColor Yellow
  Write-Host "  2) 浏览器打开模型下载页手动下载后放入 $OutDir :" -ForegroundColor Yellow
  Write-Host "     https://github.com/RapidAI/RapidOCR/releases" -ForegroundColor Yellow
  Write-Host "     需要的文件: ch_PP-OCRv4_det_infer.onnx / ch_PP-OCRv4_rec_infer.onnx / ch_PP-OCRv4_cls_infer.onnx / ppocr_keys_v1.txt" -ForegroundColor Yellow
}
