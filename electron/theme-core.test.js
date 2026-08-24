const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../frontend/js/theme-core.js');

test('normalizes the six supported themes and falls back safely', () => {
  assert.equal(core.normalizeTheme('studio'), 'studio');
  assert.equal(core.normalizeTheme('focus'), 'focus');
  assert.equal(core.normalizeTheme('calm'), 'calm');
  assert.equal(core.normalizeTheme('notion'), 'notion');
  assert.equal(core.normalizeTheme('regular'), 'regular');
  assert.equal(core.normalizeTheme('dark'), 'dark');
  assert.equal(core.normalizeTheme('unknown'), 'notion');
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
  assert.equal(core.resolveAppearance('focus', true), 'focus');
  assert.equal(core.resolveAppearance('calm', false), 'calm');
});

test('builds a version-independent themeChange message', () => {
  assert.deepEqual(core.buildThemeMessage('calm', 'reduced'), {
    action: 'themeChange', theme: 'calm', motion: 'reduced'
  });
});

test('reads stored theme and motion with safe fallbacks', () => {
  const storage = {
    getItem(key) {
      return { app_theme_v1: 'studio', app_motion_v1: 'reduced' }[key] || null;
    }
  };
  assert.equal(core.readStoredTheme(storage), 'studio');
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
