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
    md: 'text',
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
