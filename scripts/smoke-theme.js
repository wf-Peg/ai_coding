#!/usr/bin/env node
/* ============================================================================
   smoke-theme.js — 全局主题静态冒烟测试
   读取 CSS / HTML 文本，断言六套主题选择器、语义令牌、减少动效与主题桥接引用。
   任一必需令牌缺失即以描述性信息非零退出。
   ============================================================================ */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');

function read(rel) {
  const p = path.join(ROOT, rel);
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    return null;
  }
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail: detail || '' });
}

function has(css, token) {
  return typeof css === 'string' && css.indexOf(token) !== -1;
}

// ---- 令牌与主题 ----
const tokensCss = read('frontend/styles/design-tokens.css');
const uiCommonCss = read('frontend/styles/ui-common.css');

const SIX_THEMES = ['regular', 'notion', 'dark', 'focus', 'calm', 'studio'];
SIX_THEMES.forEach(t => {
  check(
    `design-tokens.css declares html[data-theme="${t}"]`,
    has(tokensCss, `html[data-theme="${t}"]`),
    '缺少主题选择器'
  );
});

const SEMANTIC_TOKENS = [
  '--app-bg', '--app-surface', '--app-surface-subtle', '--app-surface-hover',
  '--app-border', '--app-text', '--app-text-secondary', '--app-text-muted',
  '--app-primary', '--app-success', '--app-warning', '--app-danger',
  '--app-duration-fast', '--app-duration-normal', '--app-duration-panel',
  '--app-ease-smooth', '--app-control-bg', '--app-card-bg', '--app-nav-bg',
  '--app-modal-bg', '--app-editor-bg', '--app-ai-bg'
];
SEMANTIC_TOKENS.forEach(t => {
  check(
    `design-tokens.css declares semantic token ${t}`,
    has(tokensCss, t),
    '缺少语义令牌'
  );
});

const LEGACY_ALIASES = ['--background', '--surface', '--text', '--border'];
LEGACY_ALIASES.forEach(t => {
  check(
    `design-tokens.css maps legacy alias ${t}`,
    has(tokensCss, `${t}: var(--app-`),
    '缺少旧版别名映射'
  );
});

check(
  'ui-common.css respects prefers-reduced-motion',
  has(uiCommonCss, 'prefers-reduced-motion: reduce'),
  '缺少系统减少动效查询'
);
check(
  'ui-common.css supports [data-motion="reduced"]',
  has(uiCommonCss, '[data-motion="reduced"]'),
  '缺少应用级减少动效覆盖'
);

// ---- 可访问性与焦点样式 ----
const settingsHtml = read('frontend/settings.html');
check(
  'ui-common.css exposes visible focus styles',
  has(uiCommonCss, ':focus-visible') && has(uiCommonCss, ':focus'),
  '缺少可见焦点样式'
);
check(
  'settings.html theme cards use a radiogroup',
  has(settingsHtml, 'role="radiogroup"'),
  '主题卡片组缺少 role="radiogroup"'
);
check(
  'settings.html theme cards expose radio role',
  has(settingsHtml, 'role="radio"'),
  '主题卡片缺少 role="radio"'
);
check(
  'settings.html theme cards expose aria-checked state',
  has(settingsHtml, 'aria-checked'),
  '主题卡片缺少 aria-checked'
);
check(
  'settings.html theme cards are keyboard-focusable buttons',
  has(settingsHtml, '<button type="button" class="theme-card'),
  '主题卡片应为可聚焦的 button'
);
check(
  'settings.html theme group has an accessible label',
  has(settingsHtml, 'aria-label="界面主题"'),
  '主题卡片组缺少 aria-label'
);
check(
  'settings.html offers a reduced-motion switch',
  has(settingsHtml, 'id="reduceMotionToggle"'),
  '缺少减少动效开关'
);

// ---- 主题桥接引用 ----
const SHELL_PAGES = ['frontend/index.html', 'frontend/settings.html'];
const CORE_PAGES = ['frontend/editor.html', 'frontend/workspace.html', 'frontend/clip.html'];
const MODULE_PAGES = [
  'frontend/knowledge.html', 'frontend/knowledge-detail.html', 'frontend/knowledge-editor.html',
  'frontend/knowledge-graph.html', 'frontend/learning-plan.html', 'frontend/pdf.html',
  'frontend/tools.html', 'frontend/data-observability.html', 'frontend/vault.html',
  'frontend/wiki.html', 'frontend/todo.html'
];
const ALL_PAGES = SHELL_PAGES.concat(CORE_PAGES).concat(MODULE_PAGES);
ALL_PAGES.forEach(rel => {
  const html = read(rel);
  const exists = html !== null;
  check(`${rel} exists`, exists, '文件不存在');
  if (!exists) return;
  check(
    `${rel} loads theme-core.js`,
    has(html, 'js/theme-core.js'),
    '缺少 theme-core.js 引用'
  );
  check(
    `${rel} loads theme-bridge.js`,
    has(html, 'js/theme-bridge.js'),
    '缺少 theme-bridge.js 引用'
  );
  check(
    `${rel} loads design-tokens.css`,
    has(html, 'styles/design-tokens.css'),
    '缺少 design-tokens.css 引用'
  );
  check(
    `${rel} loads ui-common.css`,
    has(html, 'styles/ui-common.css'),
    '缺少 ui-common.css 引用'
  );
});

// ---- 报告 ----
const failed = results.filter(r => !r.pass);
const verbose = process.argv.includes('--verbose') || process.env.SMOKE_THEME_VERBOSE;

if (verbose) {
  results.forEach(r => {
    console.log(`${r.pass ? '✔' : '✘'} ${r.name}${r.pass ? '' : '  — ' + r.detail}`);
  });
}

console.log(`smoke-theme: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.error('smoke-theme FAILED:');
  failed.forEach(r => console.error(`  - ${r.name}: ${r.detail}`));
  process.exit(1);
}
