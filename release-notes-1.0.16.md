## v1.0.16

### 打包构建优化（本次重点）
- 集成依赖安装改为指纹缓存：`prebuild-integrations` 在 package.json / lockfile 未变化时跳过 `npm ci`，Windows 下显著提速
- 更新包改用系统 tar 直压：`build-update-zip` 免 staging 整份复制，压缩更快；支持 `SKIP_UPDATE_ZIP=1` 跳过
- 精简 JRE 增加备份/恢复：`build-jlink-slim` 自动备份到 `jre-slim-backup/`，可 `--restore` 恢复
- 固化 Electron 下载源（`.npmrc`）并新增 Defender 排除脚本，避免同版本 zip 反复重新下载
- electron-builder 显式 `--publish never`，避免 CI 环境下隐式发布失败

### 功能 / 其他
- 国内下载源适配与打包脚本健壮性提升

### 产物
- 安装包：CutShelter-Setup-1.0.16.exe
- 便携版：CutShelter-portable-1.0.16-win-x64.exe
- 增量更新包：clip-update-1.0.16.zip（含 sha256）