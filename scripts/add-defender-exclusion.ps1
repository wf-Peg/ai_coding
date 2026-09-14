# add-defender-exclusion.ps1 — 以管理员身份为打包目录添加 Defender 排除项
# 用法：右键"以管理员身份运行"，或由 build 脚本通过 Start-Process -Verb RunAs 调用
$paths = @(
  'L:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding',
  'L:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\dist-electron',
  'L:\归档\30_Projects (行动项目)\31_Work (主要工作)\code\ai_coding\jre-slim',
  # Electron 与 electron-builder 缓存：避免杀软逐文件扫描/误删导致反复重新下载
  (Join-Path $env:LOCALAPPDATA 'electron'),
  (Join-Path $env:LOCALAPPDATA 'electron-builder')
)
$out = Join-Path $env:TEMP 'defender-exclusion.result.txt'
try {
  Set-MpPreference -ExclusionPath $paths
  $cur = (Get-MpPreference).ExclusionPath
  Set-Content -Path $out -Value "OK`n$($cur -join "`n")" -Encoding UTF8
} catch {
  Set-Content -Path $out -Value "FAIL`n$($_.Exception.Message)" -Encoding UTF8
}