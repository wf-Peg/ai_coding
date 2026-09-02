const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');

const { resignAdHoc } = require('./afterPack');

function describeCodeSignature(binaryPath) {
  const result = spawnSync('codesign', ['-dv', '--verbose=1', binaryPath], { encoding: 'utf8' });
  return `${result.stdout || ''}${result.stderr || ''}`;
}

test('resigns macOS app binaries with a consistent adhoc signature (required to launch on Apple Silicon)', { skip: process.platform !== 'darwin' }, () => {
  const appPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cutshelter-unsigned-'));
  const binaryPath = path.join(appPath, 'Contents', 'MacOS', 'CutShelter');
  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  fs.copyFileSync(process.execPath, binaryPath);

  assert.match(describeCodeSignature(binaryPath), /adhoc/);

  resignAdHoc(appPath);

  // 所有签名被重新覆盖为一致的 adhoc（Signature=adhoc），而非移除
  assert.match(describeCodeSignature(binaryPath), /Signature=adhoc/);
});