(function exposeEditorCore(global) {
  'use strict';

  const EXTENSION_LANGUAGE = {
    json: 'json',
    jsonl: 'json',
    xml: 'xml',
    svg: 'xml',
    xhtml: 'xml',
    sql: 'sql',
    txt: 'text',
    log: 'text',
    md: 'markdown',
    mdown: 'markdown',
    markdown: 'markdown',
    csv: 'text'
  };

  function detectLanguage(fileName, text) {
    const extension = String(fileName || '').split('.').pop().toLowerCase();
    if (EXTENSION_LANGUAGE[extension]) return EXTENSION_LANGUAGE[extension];

    const sample = String(text || '').trim().slice(0, 2000);
    if (!sample) return 'text';
    if ((sample.startsWith('{') && sample.endsWith('}')) || (sample.startsWith('[') && sample.endsWith(']'))) {
      try {
        JSON.parse(sample);
        return 'json';
      } catch (error) {
        // Continue with other lightweight checks.
      }
    }
    if (/^<\?xml\b|^<[A-Za-z_][\w:.-]*(?:\s|>|\/)/.test(sample)) return 'xml';
    if (/\b(select|insert|update|delete|create|alter|drop)\b/i.test(sample)) return 'sql';
    return 'text';
  }

  function formatJson(text, compact) {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, compact ? 0 : 2);
  }

  function formatXml(text, compact) {
    const parser = new DOMParser();
    const documentNode = parser.parseFromString(text, 'application/xml');
    const parserError = documentNode.querySelector('parsererror');
    if (parserError) {
      throw new Error(parserError.textContent.replace(/\s+/g, ' ').trim() || 'XML 解析失败');
    }

    const serialized = new XMLSerializer().serializeToString(documentNode);
    if (compact) return serialized.replace(/>\s+</g, '><').trim();

    const serializer = new XMLSerializer();
    const formatNode = (node, depth) => {
      const indent = '  '.repeat(depth);
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return `${indent}${serializer.serializeToString(node).trim()}`;
      }

      const children = Array.from(node.childNodes);
      if (children.length === 0) return `${indent}<${node.tagName}${serializeAttributes(node)}/>`;

      const structuralChildren = children.filter(child => child.nodeType !== Node.TEXT_NODE || child.nodeValue.trim());
      const hasElementChild = structuralChildren.some(child => child.nodeType === Node.ELEMENT_NODE);
      const hasTextContent = structuralChildren.some(child => child.nodeType === Node.TEXT_NODE && child.nodeValue.trim());

      // Mixed content and text-only elements are kept on one line to avoid changing text semantics.
      if (!hasElementChild || hasTextContent) {
        return `${indent}${serializer.serializeToString(node)}`;
      }

      const opening = `${indent}<${node.tagName}${serializeAttributes(node)}>`;
      const inner = structuralChildren.map(child => formatNode(child, depth + 1)).join('\n');
      return `${opening}\n${inner}\n${indent}</${node.tagName}>`;
    };

    return Array.from(documentNode.childNodes)
      .filter(node => node.nodeType !== Node.TEXT_NODE || node.nodeValue.trim())
      .map(node => formatNode(node, 0))
      .join('\n');
  }

  function serializeAttributes(node) {
    return Array.from(node.attributes || []).map(attribute => {
      const escaped = attribute.value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
      return ` ${attribute.name}="${escaped}"`;
    }).join('');
  }

  function formatSql(text, dialect) {
    if (!global.sqlFormatter || typeof global.sqlFormatter.format !== 'function') {
      throw new Error('SQL 格式化组件未加载');
    }
    const language = {
      sql: 'sql',
      mysql: 'mysql',
      postgresql: 'postgresql',
      sqlite: 'sqlite',
      transactsql: 'transactsql'
    }[dialect] || 'sql';
    return global.sqlFormatter.format(text, {
      language,
      keywordCase: 'upper',
      tabWidth: 2,
      linesBetweenQueries: 1
    });
  }

  function utf8ToBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  function base64ToUtf8(text) {
    const normalized = text.replace(/\s+/g, '');
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  function htmlEncode(text) {
    const node = document.createElement('div');
    node.textContent = text;
    return node.innerHTML;
  }

  function htmlDecode(text) {
    const node = document.createElement('textarea');
    node.innerHTML = text;
    return node.value;
  }

  function unicodeEncode(text) {
    return Array.from(text).map(character => {
      const codePoint = character.codePointAt(0);
      if (codePoint <= 0x7f) return character;
      if (codePoint <= 0xffff) return `\\u${codePoint.toString(16).padStart(4, '0')}`;
      const adjusted = codePoint - 0x10000;
      const high = 0xd800 + (adjusted >> 10);
      const low = 0xdc00 + (adjusted & 0x3ff);
      return `\\u${high.toString(16)}\\u${low.toString(16)}`;
    }).join('');
  }

  function unicodeDecode(text) {
    return text.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g, (match, braced, fixed) => {
      const value = parseInt(braced || fixed, 16);
      return String.fromCodePoint(value);
    });
  }

  function hexEncode(text) {
    return Array.from(new TextEncoder().encode(text))
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join(' ');
  }

  function hexDecode(text) {
    const compact = text.replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');
    if (compact.length % 2 !== 0) throw new Error('Hex 字符数必须为偶数');
    const bytes = new Uint8Array(compact.length / 2);
    for (let index = 0; index < compact.length; index += 2) {
      bytes[index / 2] = parseInt(compact.slice(index, index + 2), 16);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  /**
   * 纯 JS MD5 实现（按 RFC 1321）
   * 将输入字符串计算为 32 位小写十六进制 MD5 哈希值。
   */
  function md5Hash(text) {
    const bytes = new TextEncoder().encode(text);
    const lengthBits = bytes.length * 8;

    // 补位：先补 0x80，再补 0x00 到 64 字节倍数 - 8，最后补 64 位长度
    const paddedLength = (((bytes.length + 8) >>> 6) + 1) << 6;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;

    const view = new DataView(padded.buffer);
    for (let i = 0; i < 8; i++) {
      view.setUint8(paddedLength - 8 + i, (lengthBits >>> (i * 8)) & 0xff);
    }

    // MD5 初始常量
    let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;

    // 每轮 16 步的偏移量
    const s = [
      [7, 12, 17, 22], [5, 9, 14, 20], [4, 11, 16, 23], [6, 10, 15, 21]
    ];
    // 每步常数
    const K = new Uint32Array(64);
    for (let i = 0; i < 64; i++) {
      K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);
    }

    function leftRotate(x, n) {
      return ((x << n) | (x >>> (32 - n))) >>> 0;
    }

    function F(x, y, z) { return (x & y) | (~x & z); }
    function G(x, y, z) { return (x & z) | (y & ~z); }
    function H(x, y, z) { return x ^ y ^ z; }
    function I(x, y, z) { return y ^ (x | ~z); }

    const steps = [F, G, H, I];
    const gIndex = [
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      [1, 6, 11, 0, 5, 10, 15, 4, 9, 14, 3, 8, 13, 2, 7, 12],
      [5, 8, 11, 14, 1, 4, 7, 10, 13, 0, 3, 6, 9, 12, 15, 2],
      [0, 3, 6, 9, 12, 15, 2, 5, 8, 11, 14, 1, 4, 7, 10, 13]
    ];

    for (let offset = 0; offset < paddedLength; offset += 64) {
      const words = new Uint32Array(16);
      for (let i = 0; i < 16; i++) {
        words[i] = view.getUint32(offset + i * 4, true);
      }

      let A = a, B = b, C = c, D = d;

      for (let round = 0; round < 64; round++) {
        const f = steps[round >>> 4](B, C, D);
        const g = gIndex[round >>> 4][round & 15];
        const temp = (A + f + K[round] + words[g]) >>> 0;
        const newA = (B + leftRotate(temp, s[round >>> 4][round & 3])) >>> 0;
        A = D; D = C; C = B; B = newA;
      }

      a = (a + A) >>> 0;
      b = (b + B) >>> 0;
      c = (c + C) >>> 0;
      d = (d + D) >>> 0;
    }

    function toHex(n) {
      return n.toString(16).padStart(8, '0');
    }
    return toHex(a) + toHex(b) + toHex(c) + toHex(d);
  }

  function md5Encode(text) {
    // 按行计算 MD5，每行输出独立的哈希值
    const lines = text.split('\n');
    return lines.map(line => md5Hash(line)).join('\n');
  }

  function transform(text, operation) {
    switch (operation) {
      case 'base64-encode': return utf8ToBase64(text);
      case 'base64-decode': return base64ToUtf8(text);
      case 'url-encode': return encodeURIComponent(text);
      case 'url-decode': return decodeURIComponent(text.replace(/\+/g, ' '));
      case 'html-encode': return htmlEncode(text);
      case 'html-decode': return htmlDecode(text);
      case 'unicode-encode': return unicodeEncode(text);
      case 'unicode-decode': return unicodeDecode(text);
      case 'hex-encode': return hexEncode(text);
      case 'hex-decode': return hexDecode(text);
      case 'md5-encode': return md5Encode(text);
      default: throw new Error(`不支持的转换操作：${operation}`);
    }
  }

  function detectLineEnding(text) {
    if (text.includes('\r\n')) return 'CRLF';
    if (text.includes('\r')) return 'CR';
    return 'LF';
  }

  function normalizeLineEnding(text, lineEnding) {
    const normalized = text.replace(/\r\n?/g, '\n');
    if (lineEnding === 'CRLF') return normalized.replace(/\n/g, '\r\n');
    if (lineEnding === 'CR') return normalized.replace(/\n/g, '\r');
    return normalized;
  }

  function extractErrorLocation(error) {
    const message = error && error.message ? error.message : String(error);
    const positionMatch = message.match(/position\s+(\d+)/i);
    const lineMatch = message.match(/line\s+(\d+)(?:\s+column\s+(\d+))?/i);
    return {
      message,
      position: positionMatch ? Number(positionMatch[1]) : null,
      line: lineMatch ? Number(lineMatch[1]) : null,
      column: lineMatch && lineMatch[2] ? Number(lineMatch[2]) : null
    };
  }

  global.EditorCore = {
    detectLanguage,
    detectLineEnding,
    extractErrorLocation,
    formatJson,
    formatSql,
    formatXml,
    normalizeLineEnding,
    transform
  };
})(window);
