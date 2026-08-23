/**
 * ocr-service.test.js — OCR 纯函数单测
 * 仅覆盖不依赖 onnx/shar 的 ctcDecode（置信度过滤降噪），不加载真实模型。
 * 运行：node --test electron/screenshot/ocr-service.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { ctcDecode } = require('./ocr-service');

// 构造一个 [width, numClasses] 的概率向量，index 0 = blank，index 1..n = 字典字符
function makeProbs(width, numClasses, assign) {
  const out = new Float32Array(width * numClasses);
  for (let i = 0; i < width; i++) {
    out[i * numClasses] = 1; // 默认全 blank（idx0=1）
    if (assign) assign(out, i, numClasses);
  }
  return { out, width, numClasses };
}

test('ctcDecode 高置信度正常解码（去重+去blank）', () => {
  const dict = ['你', '好'];
  const { out, width, numClasses } = makeProbs(3, dict.length + 2, (p, i, n) => {
    p[i * n] = 0;
    p[i * n + (i === 2 ? 2 : 1)] = 1;
  });
  const text = ctcDecode(out, width, dict, numClasses);
  assert.strictEqual(text, '你好');
});

test('ctcDecode 无阈值时不丢失低置信度列（兼容旧行为）', () => {
  const dict = ['A', 'B'];
  const { out, width, numClasses } = makeProbs(2, dict.length + 2, (p, i, n) => {
    p[i * n] = 0;
    p[i * n + 1] = 0.3; // 低置信度但无阈值过滤
  });
  const text = ctcDecode(out, width, dict, numClasses);
  assert.strictEqual(text, 'A'); // 同一字符去重为 A
});

test('ctcDecode 置信度过滤：低于阈值列按 blank 处理', () => {
  const dict = ['X', 'Y'];
  const { out, width, numClasses } = makeProbs(3, dict.length + 2, (p, i, n) => {
    p[i * n] = 0;
    if (i === 1) p[i * n + 2] = 0.6;   // 高置信 'Y'（idx2）
    else p[i * n + 1] = 0.6;           // 高置信 'X'（idx1）
  });
  // 正常（无过滤）
  assert.strictEqual(ctcDecode(out, width, dict, numClasses), 'XYX');

  // 中间列低置信，应被过滤为 blank
  const { out: out2, width: w2, numClasses: nc2 } = makeProbs(3, dict.length + 2, (p, i, n) => {
    p[i * n] = 0;
    if (i === 1) p[i * n + 2] = 0.2; // 低置信 'Y'，应被过滤
    else p[i * n + 1] = 0.9;
  });
  assert.strictEqual(ctcDecode(out2, w2, dict, nc2, 0.5), 'XX');
});

test('ctcDecode 全列低置信 → 空结果', () => {
  const dict = ['a'];
  const { out, width, numClasses } = makeProbs(2, dict.length + 2, (p, i, n) => {
    p[i * n] = 0;
    p[i * n + 1] = 0.1;
  });
  assert.strictEqual(ctcDecode(out, width, dict, numClasses, 0.5), '');
});