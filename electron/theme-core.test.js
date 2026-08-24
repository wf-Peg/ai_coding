const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../frontend/js/theme-core.js');

test('normalizes the three supported themes and falls back safely', () => {
  assert.equal(core.normalizeTheme('notion'), 'notion');
  assert.equal(core.normalizeTheme('regular'), 'regular');
  assert.equal(core.normalizeTheme('dark'), 'dark');
  assert.equal(core.normalizeTheme('unknown'), 'notion');
  assert.equal(core.normalizeTheme('focus'), 'notion');
  assert.equal(core.normalizeTheme(''), 'notion');
  assert.equal(core.normalizeTheme(null), 'notion');
});

test('normalizes motion preference to full or reduced', () => {
  assert.equal(core.normalizeMotion('reduced'), 'reduced');
  assert.equal(core.normalizeMotion('full'), 'full');
  assert.equal(core.normalizeMotion(''), 'full');
  assert.equal(core.normalizeMotion(null), 'full');
  assert.equal(core.normalizeMotion('bounce'), 'full');
});

test('resolves system appearance without exposing system as a DOM theme', () => {
  assert.equal(core.resolveAppearance('system', true), 'dark');
  assert.equal(core.resolveAppearance('system', false), 'notion');
  assert.equal(core.resolveAppearance('regular', true), 'regular');
  assert.equal(core.resolveAppearance('dark', false), 'dark');
  // 已删除的历史主题值安全回退
  assert.equal(core.resolveAppearance('focus', true), 'notion');
});

test('builds a version-independent themeChange message', () => {
  assert.deepEqual(core.buildThemeMessage('dark', 'reduced'), {
    action: 'themeChange', theme: 'dark', motion: 'reduced'
  });
});

test('reads stored theme and motion with safe fallbacks', () => {
  const storage = {
    getItem(key) {
      return { app_theme_v1: 'regular', app_motion_v1: 'reduced' }[key] || null;
    }
  };
  assert.equal(core.readStoredTheme(storage), 'regular');
  assert.equal(core.readStoredMotion(storage), 'reduced');
});

test('falls back to notion/full when stored values are invalid', () => {
  const storage = {
    getItem() { return 'garbage'; }
  };
  assert.equal(core.readStoredTheme(storage), 'notion');
  assert.equal(core.readStoredMotion(storage), 'full');
});

test('handles missing storage safely', () => {
  assert.equal(core.readStoredTheme(null), 'notion');
  assert.equal(core.readStoredMotion(null), 'full');
});

test('exposes the version-stable storage keys', () => {
  assert.equal(core.THEME_KEY, 'app_theme_v1');
  assert.equal(core.MOTION_KEY, 'app_motion_v1');
});

test('themeChange message always carries both theme and motion', () => {
  const msg = core.buildThemeMessage('dark', 'reduced');
  assert.equal(msg.action, 'themeChange');
  assert.ok('theme' in msg && 'motion' in msg);
});
