/**
 * Text editor file service.
 *
 * The renderer receives opaque capability tokens instead of arbitrary write
 * access to local paths. Paths are only registered after a native open/save
 * dialog has granted access.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');
const chardet = require('chardet');

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const SUPPORTED_ENCODINGS = new Set([
  'UTF-8',
  'UTF-8-BOM',
  'GB18030',
  'UTF-16LE',
  'UTF-16BE',
  'BIG5',
  'SHIFT_JIS',
  'WINDOWS-1252'
]);

class EditorFileService {
  constructor(options = {}) {
    this.maxFileSize = options.maxFileSize || MAX_FILE_SIZE;
    this.capabilities = new Map();
  }

  openPath(filePath) {
    const resolvedPath = path.resolve(filePath);
    const stat = this.validateReadableFile(resolvedPath);
    const bytes = fs.readFileSync(resolvedPath);
    const detected = detectEncoding(bytes);
    const fileToken = this.registerPath(resolvedPath);
    return buildReadResult(fileToken, resolvedPath, stat, bytes, detected.encoding, detected.confidence);
  }

  reopen(fileToken, requestedEncoding) {
    const filePath = this.resolveToken(fileToken);
    const stat = this.validateReadableFile(filePath);
    const bytes = fs.readFileSync(filePath);
    const encoding = normalizeEncoding(requestedEncoding);
    return buildReadResult(fileToken, filePath, stat, bytes, encoding, '手动指定');
  }

  save(fileToken, payload) {
    const filePath = this.resolveToken(fileToken);
    if (hasExternalModification(filePath, payload.expectedMtimeMs)) {
      return { conflict: true };
    }
    return this.writePath(filePath, fileToken, payload);
  }

  saveAs(filePath, payload) {
    const resolvedPath = path.resolve(filePath);
    const fileToken = this.registerPath(resolvedPath);
    return this.writePath(resolvedPath, fileToken, payload);
  }

  writePath(filePath, fileToken, payload) {
    const encoding = normalizeEncoding(payload.encoding || 'UTF-8');
    const lineEnding = normalizeLineEndingName(payload.lineEnding);
    const text = applyLineEnding(String(payload.text ?? ''), lineEnding);
    const bytes = encodeText(text, encoding);
    if (bytes.length > this.maxFileSize) {
      throw new Error(`保存内容超过 ${(this.maxFileSize / 1024 / 1024).toFixed(0)} MB 限制`);
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, bytes);
    const stat = fs.statSync(filePath);
    return {
      canceled: false,
      conflict: false,
      fileToken,
      fileName: path.basename(filePath),
      displayPath: filePath,
      encoding,
      lineEnding,
      mtimeMs: stat.mtimeMs,
      size: stat.size
    };
  }

  registerPath(filePath) {
    const token = crypto.randomUUID();
    this.capabilities.set(token, filePath);
    return token;
  }

  resolveToken(fileToken) {
    const filePath = this.capabilities.get(fileToken);
    if (!filePath) throw new Error('文件访问令牌无效或已过期');
    return filePath;
  }

  validateReadableFile(filePath) {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error('所选路径不是文件');
    if (stat.size > this.maxFileSize) {
      throw new Error(`文件超过 ${(this.maxFileSize / 1024 / 1024).toFixed(0)} MB 限制`);
    }
    return stat;
  }
}

function buildReadResult(fileToken, filePath, stat, bytes, encoding, confidence) {
  const text = decodeText(bytes, encoding);
  return {
    canceled: false,
    fileToken,
    fileName: path.basename(filePath),
    displayPath: filePath,
    text,
    encoding,
    encodingConfidence: confidence,
    lineEnding: detectLineEnding(text),
    mtimeMs: stat.mtimeMs,
    size: stat.size
  };
}

function detectEncoding(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: 'UTF-8-BOM', confidence: 'BOM' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: 'UTF-16LE', confidence: 'BOM' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: 'UTF-16BE', confidence: 'BOM' };
  }
  if (isValidUtf8(bytes)) return { encoding: 'UTF-8', confidence: '高可信' };

  const detected = String(chardet.detect(bytes) || '').toUpperCase();
  const mapped = mapDetectedEncoding(detected);
  return { encoding: mapped, confidence: mapped === 'WINDOWS-1252' ? '低可信' : '推测' };
}

function mapDetectedEncoding(value) {
  if (value.includes('GB18030') || value.includes('GB2312') || value.includes('GBK')) return 'GB18030';
  if (value.includes('BIG5')) return 'BIG5';
  if (value.includes('SHIFT_JIS') || value.includes('SJIS')) return 'SHIFT_JIS';
  if (value.includes('UTF-16LE')) return 'UTF-16LE';
  if (value.includes('UTF-16BE')) return 'UTF-16BE';
  if (value.includes('UTF-8')) return 'UTF-8';
  return 'WINDOWS-1252';
}

function isValidUtf8(bytes) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch (error) {
    return false;
  }
}

function normalizeEncoding(value) {
  const normalized = String(value || 'UTF-8').trim().toUpperCase().replace(/_/g, '-');
  const aliases = {
    UTF8: 'UTF-8',
    'UTF-8-SIG': 'UTF-8-BOM',
    GBK: 'GB18030',
    GB2312: 'GB18030',
    UTF16LE: 'UTF-16LE',
    UTF16BE: 'UTF-16BE',
    SHIFTJIS: 'SHIFT_JIS',
    'SHIFT-JIS': 'SHIFT_JIS',
    WIN1252: 'WINDOWS-1252',
    WINDOWS1252: 'WINDOWS-1252'
  };
  const result = aliases[normalized] || normalized;
  if (!SUPPORTED_ENCODINGS.has(result)) throw new Error(`不支持的编码：${value}`);
  return result;
}

function iconvLabel(encoding) {
  return {
    'UTF-8': 'utf8',
    'UTF-8-BOM': 'utf8',
    GB18030: 'gb18030',
    'UTF-16LE': 'utf16-le',
    'UTF-16BE': 'utf16-be',
    BIG5: 'big5',
    SHIFT_JIS: 'shift_jis',
    'WINDOWS-1252': 'win1252'
  }[encoding];
}

function decodeText(bytes, encoding) {
  let content = bytes;
  if (encoding === 'UTF-8-BOM' && hasPrefix(bytes, [0xef, 0xbb, 0xbf])) content = bytes.subarray(3);
  if (encoding === 'UTF-16LE' && hasPrefix(bytes, [0xff, 0xfe])) content = bytes.subarray(2);
  if (encoding === 'UTF-16BE' && hasPrefix(bytes, [0xfe, 0xff])) content = bytes.subarray(2);
  return iconv.decode(content, iconvLabel(encoding));
}

function encodeText(text, encoding) {
  const bytes = iconv.encode(text, iconvLabel(encoding));
  const roundTrip = iconv.decode(bytes, iconvLabel(encoding));
  if (roundTrip !== text) {
    throw new Error(`${encoding} 无法表示文档中的部分字符，请改用 UTF-8 或 GB18030`);
  }
  if (encoding === 'UTF-8-BOM') return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]);
  if (encoding === 'UTF-16LE') return Buffer.concat([Buffer.from([0xff, 0xfe]), bytes]);
  if (encoding === 'UTF-16BE') return Buffer.concat([Buffer.from([0xfe, 0xff]), bytes]);
  return bytes;
}

function hasPrefix(bytes, prefix) {
  return prefix.every((value, index) => bytes[index] === value);
}

function detectLineEnding(text) {
  if (text.includes('\r\n')) return 'CRLF';
  if (text.includes('\r')) return 'CR';
  return 'LF';
}

function normalizeLineEndingName(value) {
  return ['LF', 'CRLF', 'CR'].includes(value) ? value : 'LF';
}

function applyLineEnding(text, lineEnding) {
  const normalized = text.replace(/\r\n?/g, '\n');
  if (lineEnding === 'CRLF') return normalized.replace(/\n/g, '\r\n');
  if (lineEnding === 'CR') return normalized.replace(/\n/g, '\r');
  return normalized;
}

function hasExternalModification(filePath, expectedMtimeMs) {
  if (expectedMtimeMs === null || expectedMtimeMs === undefined || !fs.existsSync(filePath)) return false;
  const currentMtimeMs = fs.statSync(filePath).mtimeMs;
  return Math.abs(currentMtimeMs - Number(expectedMtimeMs)) > 1;
}

module.exports = {
  EditorFileService,
  applyLineEnding,
  decodeText,
  detectEncoding,
  detectLineEnding,
  encodeText,
  normalizeEncoding
};
