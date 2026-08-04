'use strict';

const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '..', 'frontend/js/editor.js');
let src = fs.readFileSync(file, 'utf-8');
const original = src;

// 替换所有 IPC 调用风格为 Lite 适配
const replacements = [
  // openFile -> file.openDialog
  { pattern: /api\.openFile\b/g, replace: 'liteAPI.file.openDialog' },
  // openFileByPath -> file.openPath
  { pattern: /api\.openFileByPath\b/g, replace: 'liteAPI.file.openPath' },
  // saveFile -> file.save
  { pattern: /api\.saveFile\b\(/g, replace: 'liteAPI.file.save(' },
  // saveAsFile -> file.saveAsDialog
  { pattern: /api\.saveAsFile\b\(/g, replace: 'liteAPI.file.saveAsDialog(' },
  // autosaveFile -> file.save
  { pattern: /api\.autosaveFile\b\(/g, replace: 'liteAPI.file.save(' },
  // readFile -> file.openPath
  { pattern: /api\.readFile\b\(/g, replace: 'liteAPI.file.openPath(' },
  // writeFile -> file.save
  { pattern: /api\.writeFile\b\(/g, replace: 'liteAPI.file.save(' },
  // 旧版 openDialog/openReg/openClipWith 兜底（如有）
  { pattern: /api\.openDialog\b/g, replace: 'liteAPI.file.openDialog' },
  { pattern: /api\.openReg\b/g, replace: 'liteAPI.file.openDialog' },
  { pattern: /api\.openClipWith\b/g, replace: 'liteAPI.file.openDialog' },
  { pattern: /api\.openSave\b/g, replace: 'liteAPI.file.saveAsDialog' },
  // listWorkspace / selectCategor / safeChooseFile 不在 Lite 中支持 -> 改为启动完整版
  { pattern: /api\.listWorkspace\b/g, replace: 'liteAPI.workspace.get' },
  { pattern: /api\.safeChooseFile\b/g, replace: 'liteAPI.file.openDialog' },
  { pattern: /api\.selectCategor\b/g, replace: 'liteAPI.file.openDialog' },
  // getCategories / saveConfig / getConfig 等由 Lite 通过本地设置面板处理（删）
  { pattern: /api\.getCategories\b/g, replace: 'liteAPI.ai.getConfig' },
  { pattern: /api\.saveConfig\b/g, replace: 'liteAPI.ai.saveConfig' },
  { pattern: /api\.getConfig\b/g, replace: 'liteAPI.ai.getConfig' },
  // openSettings/openHelp/openLicense/... 在 Lite 中无意义，直接 no-op
  { pattern: /api\.openSettings\b/g, replace: 'liteAPI.window.show' },
  { pattern: /api\.openHelp\b/g, replace: 'liteAPI.window.show' },
  { pattern: /api\.openLicense\b/g, replace: 'liteAPI.window.show' },
  { pattern: /api\.openAcknowledgments\b/g, replace: 'liteAPI.window.show' },
  { pattern: /api\.openThirdParty\b/g, replace: 'liteAPI.window.show' },
  { pattern: /api\.openHomepage\b/g, replace: 'liteAPI.window.show' },
  { pattern: /api\.openLogs\b/g, replace: 'liteAPI.window.show' },
  { pattern: /api\.openUpdate\b/g, replace: 'liteAPI.window.show' },
  { pattern: /api\.openNotifier\b/g, replace: 'liteAPI.window.show' },
  { pattern: /api\.getBuildInfo\b/g, replace: 'liteAPI.window.show' },
  { pattern: /api\.openSearch\b/g, replace: 'liteAPI.window.show' },
  { pattern: /api\.openHistory\b/g, replace: 'liteAPI.window.show' },
  { pattern: /api\.openRecent\b/g, replace: 'liteAPI.window.show' },
  { pattern: /api\.openFav\b/g, replace: 'liteAPI.window.show' },
  { pattern: /api\.markRead\b/g, replace: 'liteAPI.window.show' },
  { pattern: /api\.showItem\b/g, replace: 'liteAPI.window.show' },
  { pattern: /api\.openExternal\b/g, replace: 'liteAPI.window.show' },
  // getRecent/getFav/getHistory 在 Lite 中无持久化列表，使用 extractRecent etc 仅在 localStorage 简单维护
  { pattern: /api\.getRecent\b/g, replace: 'liteAPI.window.show' },
  { pattern: /api\.getFav\b/g, replace: 'liteAPI.window.show' },
  { pattern: /api\.getHistory\b/g, replace: 'liteAPI.window.show' }
];

let changes = 0;
for (const { pattern, replace } of replacements) {
  const before = src;
  src = src.replace(pattern, replace);
  if (before !== src) {
    changes++;
    console.log(`Replaced: ${pattern} -> ${replace}`);
  }
}

if (src !== original) {
  fs.writeFileSync(file, src, 'utf-8');
  console.log(`Done. ${changes} pattern(s) updated. File: ${file}`);
} else {
  console.log('No changes');
}
