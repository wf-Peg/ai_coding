#!/usr/bin/env node

/**
 * check-win-artifacts.js — 校验 Windows 打包产物（win-unpacked/resources）必需运行资源是否齐全。
 *
 * 触发时机：build:portable:win 等打包命令在 electron-builder 完成后执行。
 * 校验项（与 electron/main.js 运行时查找路径一致）：
 *   - resources/backend/clip-demo-0.0.1-SNAPSHOT.jar   （后端 JAR，startBackend 依赖）
 *   - resources/jre/bin/java.exe                        （嵌入式 JRE，getJavaCommand 默认来源）
 *   - resources/frontend/index.html                     （前端静态入口，startFrontendServer 依赖）
 *   - resources/ocr-models/**                           （离线 OCR 模型目录）
 *   - resources/integrations/dsh/**                     （DSH sidecar 集成目录）
 *
 * 缺任一项 → 打印缺项并以退出码 1 结束，阻止"坏包被当成成功"。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RESOURCES = path.join(ROOT, 'dist-electron', 'win-unpacked', 'resources');

/** [相对路径, 类型, 描述]；类型 'file' 用 fs.existsSync，'dir' 用 fs.statSync().isDirectory() */
const REQUIRED = [
  ['backend/clip-demo-0.0.1-SNAPSHOT.jar', 'file', '后端 JAR'],
  ['jre/bin/java.exe', 'file', '嵌入式 Windows JRE'],
  ['frontend/index.html', 'file', '前端入口'],
  ['ocr-models', 'dir', '离线 OCR 模型'],
  ['integrations/dsh', 'dir', 'DSH 集成'],
];

function run() {
  if (!fs.existsSync(RESOURCES)) {
    console.error('[check-win-artifacts] 未找到打包产物目录: ' + RESOURCES);
    console.error('[check-win-artifacts] 请确认 electron-builder --win 已成功完成（产出 dist-electron/win-unpacked）。');
    process.exit(1);
  }

  const missing = [];
  for (const [rel, type, desc] of REQUIRED) {
    const p = path.join(RESOURCES, rel);
    let ok = false;
    try {
      ok = type === 'dir' ? fs.statSync(p).isDirectory() : fs.existsSync(p);
    } catch {
      ok = false;
    }
    if (!ok) missing.push(`  - [${desc}] ${rel}`);
  }

  if (missing.length === 0) {
    console.log('[check-win-artifacts] 校验通过：打包产物运行资源齐全 (' + RESOURCES + ')');
    return;
  }

  console.error('[check-win-artifacts] ERROR：以下运行资源缺失：');
  for (const m of missing) console.error(m);
  console.error('[check-win-artifacts] 缺失项会导致打包后 exe 启动失败/无反应。');
  console.error('[check-win-artifacts] 请先跑 node scripts/build-jlink-slim.mjs 生成 JRE、并确认 backend/target 下 jar 存在，再重新打包。');
  process.exit(1);
}

run();