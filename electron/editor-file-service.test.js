const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  EditorFileService,
  decodeText,
  encodeText
} = require('./editor-file-service');

test('supported editor encodings round-trip text', () => {
  const text = '剪藏 Editor 123';
  ['UTF-8', 'UTF-8-BOM', 'GB18030', 'UTF-16LE', 'UTF-16BE'].forEach(encoding => {
    assert.equal(decodeText(encodeText(text, encoding), encoding), text);
  });
});

test('lossy target encoding is rejected', () => {
  assert.throws(() => encodeText('中文', 'WINDOWS-1252'), /无法表示/);
});

test('file capability supports open, save and conflict detection', () => {
  const tempDir = fs.mkdtempSync(path.join(process.cwd(), '.editor-file-test-'));
  const filePath = path.join(tempDir, 'sample.txt');
  try {
    fs.writeFileSync(filePath, Buffer.from('first', 'utf8'));
    const service = new EditorFileService();
    const opened = service.openPath(filePath);
    assert.equal(opened.text, 'first');

    const saved = service.save(opened.fileToken, {
      text: 'second\nline',
      encoding: 'UTF-8',
      lineEnding: 'CRLF',
      expectedMtimeMs: opened.mtimeMs
    });
    assert.equal(saved.conflict, false);
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'second\r\nline');

    fs.writeFileSync(filePath, 'external', 'utf8');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(filePath, future, future);
    const conflict = service.save(opened.fileToken, {
      text: 'third',
      encoding: 'UTF-8',
      lineEnding: 'LF',
      expectedMtimeMs: saved.mtimeMs
    });
    assert.equal(conflict.conflict, true);
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'external');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('unknown capability tokens cannot write arbitrary files', () => {
  const service = new EditorFileService();
  assert.throws(() => service.save('missing-token', { text: 'x' }), /令牌无效/);
});
