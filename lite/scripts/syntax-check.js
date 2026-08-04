'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const targets = [
  'main.js',
  'preload.js',
  'editor-file-service.js',
  'frontend/js/editor.js',
  'frontend/js/editor-core.js',
  'frontend/js/editor-ai-chat-core.js',
  'frontend/js/lite-ai-client.js',
  'frontend/js/editor-lite-helpers.js',
  'frontend/js/logger.js'
];

let failed = 0;
for (const rel of targets) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    console.error(`[missing] ${rel}`);
    failed++;
    continue;
  }
  try {
    execFileSync(process.execPath, ['-c', file], { stdio: 'pipe' });
    console.log(`[ok]      ${rel}`);
  } catch (err) {
    console.error(`[fail]    ${rel}\n${err.stderr.toString()}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} file(s) failed syntax check.`);
  process.exit(1);
}
console.log('\nAll JS files passed syntax check.');
