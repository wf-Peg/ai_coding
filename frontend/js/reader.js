/* ============================================================================
 * reader.js — 万能阅读器：轻量本地文档预览（纯展示、不编辑）
 * 支持：PDF / docx / pptx(文本提取) / xlsx(只读表格) / csv / md / 代码 / 文本
 * 特性：按需懒加载第三方库（pdf.js / docx-preview / exceljs / highlight.js / jszip），
 *       拖拽打开、翻页缩放、工作表切换、深浅色主题联动。
 * 依赖：window.electronAPI（preload）、window.MediaKit（media-render.js）、marked
 * ============================================================================ */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // ── 状态 ──
  var state = {
    current: null,        // { filePath, fileName, size, type, displayPath }
    pdfDoc: null,         // pdf.js 文档实例
    pdfPage: 1,
    pdfScale: 1.3,
    pptSlides: null,      // 解析出的 pptx 幻灯片文本数组
    xlsxWorkbook: null,   // exceljs workbook
    xlsxSheetIndex: 0,
    docxRendered: false,
    dragDepth: 0
  };

  // ── 类型识别 ──
  var TYPE_PDF = 'pdf';
  var TYPE_DOCX = 'docx';
  var TYPE_PPTX = 'pptx';
  var TYPE_XLSX = 'xlsx';
  var TYPE_CSV = 'csv';
  var TYPE_MD = 'md';
  var TYPE_CODE = 'code';
  var TYPE_TEXT = 'text';

  var TEXT_EXTS = new Set(['txt', 'log', 'ini', 'conf', 'bat', 'cmd', 'sh', 'ps1', 'md', 'markdown', 'json', 'xml', 'yaml', 'yml', 'csv', 'js', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'sql', 'html', 'htm', 'css', 'scss', 'less']);
  var CODE_EXTS = new Set(['js', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'sql', 'html', 'htm', 'css', 'scss', 'less', 'json', 'xml', 'yaml', 'yml', 'sh', 'bat', 'ps1']);

  var FORMAT_BADGE = {
    pdf: 'PDF', docx: 'DOCX', pptx: 'PPTX', xlsx: 'XLSX',
    csv: 'CSV', md: 'MD', code: 'CODE', text: 'TXT'
  };

  var EXT_FORMATS = {
    pdf: TYPE_PDF,
    docx: TYPE_DOCX, docm: TYPE_DOCX,
    pptx: TYPE_PPTX, pptm: TYPE_PPTX,
    xlsx: TYPE_XLSX, xlsm: TYPE_XLSX,
    csv: TYPE_CSV,
    md: TYPE_MD, markdown: TYPE_MD
  };

  // 支持预览的扩展名（供拖拽校验 + 空状态 chips 展示）
  var SUPPORTED_EXTS = new Set([
    'pdf', 'docx', 'docm', 'pptx', 'pptm', 'xlsx', 'xlsm',
    'csv', 'md', 'markdown', 'txt', 'log', 'ini', 'conf',
    'json', 'xml', 'yaml', 'yml', 'js', 'ts', 'tsx', 'py', 'java',
    'c', 'cpp', 'h', 'go', 'rs', 'rb', 'php', 'sql', 'html', 'css', 'sh', 'bat', 'ps1'
  ]);

  var TYPE_LABELS = {
    pdf: 'PDF 文档', docx: 'Word 文档', pptx: 'PPT 演示', xlsx: 'Excel 表格',
    csv: 'CSV 表格', md: 'Markdown', code: '代码文件', text: '纯文本'
  };

  // 已知不支持（可提示用系统程序打开）
  var UNSUPPORTED_MSG = {
    doc: '旧版 Word (.doc) 暂不支持内嵌预览，可右键用系统程序打开。',
    xls: '旧版 Excel (.xls) 暂不支持内嵌预览，可右键用系统程序打开。',
    ppt: '旧版 PPT (.ppt) 暂不支持内嵌预览，可右键用系统程序打开。',
    rtf: 'RTF 暂不支持内嵌预览，可右键用系统程序打开。',
    zip: '压缩包暂不支持内嵌预览，可解压后用阅读器打开。'
  };

  // ── 元素 ──
  var el = {
    badge: $('rdBadge'), fileName: $('rdFileName'), filePath: $('rdFilePath'),
    openBtn: $('rdOpenBtn'), editBtn: $('rdEditBtn'), exportBtn: $('rdExportBtn'),
    zoomGroup: $('rdZoomGroup'), zoomIn: $('rdZoomIn'), zoomOut: $('rdZoomOut'),
    zoomLabel: $('rdZoomLabel'), fit: $('rdFit'),
    pager: $('rdPager'), prev: $('rdPrev'), next: $('rdNext'),
    pageInfo: $('rdPageInfo'), pagerHint: $('rdPagerHint'),
    empty: $('rdEmpty'), loading: $('rdLoading'), error: $('rdError'),
    errorMsg: $('rdErrorMsg'), errorSub: $('rdErrorSub'),
    scroll: $('rdScroll'), container: $('rdContainer'),
    sheetBar: $('rdSheetBar'), chipRow: $('rdChipRow')
  };

  var READER_LIBS_BASE = 'libs/';

  // 懒加载脚本（缓存已加载）
  var loadedScripts = {};
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (loadedScripts[src]) return resolve();
      var s = document.createElement('script');
      s.src = READER_LIBS_BASE + src;
      s.onload = function () { loadedScripts[src] = true; resolve(); };
      s.onerror = function () { reject(new Error('加载解析库失败: ' + src)); };
      document.head.appendChild(s);
    });
  }

  // ── 通用 UI ──
  function show(view) {
    // 进入内容态或错误态即视为解析结束，取消看门狗
    if (view === 'content' || view === 'error') clearWatchdog();
    el.empty.hidden = view !== 'empty';
    el.loading.hidden = view !== 'loading';
    el.error.hidden = view !== 'error';
    el.scroll.style.display = view === 'content' ? '' : 'none';
  }
  function showError(msg, sub) {
    show('error');
    el.errorMsg.textContent = msg || '无法预览该文件';
    el.errorSub.textContent = sub || '';
    el.errorSub.hidden = !sub;
  }
  function setBadge(type) {
    el.badge.textContent = FORMAT_BADGE[type] || 'FILE';
  }
  function setFileMeta(fileName, displayPath) {
    el.fileName.textContent = fileName || '未选择文件';
    el.filePath.textContent = displayPath || '';
    el.filePath.title = displayPath || '';
  }
  function formatSize(n) {
    if (n == null) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }
  function formatBytes(bytes) {
    var text = '';
    try { text = new TextDecoder('utf-8').decode(bytes); }
    catch (e) { text = String(bytes); }
    return text;
  }

  // 从 base64 转 Uint8Array
  function b64ToUint8(b64) {
    var bin = atob(b64);
    var len = bin.length;
    var arr = new Uint8Array(len);
    for (var i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  // 从 ArrayBuffer / Uint8Array 推断文本编码并解码（复用编辑器思路的简化版）
  function decodeBytes(arr) {
    try {
      var utf8 = new TextDecoder('utf-8', { fatal: true });
      return utf8.decode(arr);
    } catch (e) {
      try {
        var gbk = new TextDecoder('gb18030');
        return gbk.decode(arr);
      } catch (e2) {
        return new TextDecoder('utf-8').decode(arr);
      }
    }
  }

  // ── 类型识别 ──
  function extOf(name) {
    var m = /\.([^.]+)$/.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }
  function detectType(fileName) {
    var ext = extOf(fileName);
    if (EXT_FORMATS[ext]) return EXT_FORMATS[ext];
    if (CODE_EXTS.has(ext)) return TYPE_CODE;
    if (TEXT_EXTS.has(ext)) return TYPE_TEXT;
    if (UNSUPPORTED_MSG[ext]) return 'unsupported-' + ext;
    // 未知扩展名：嗅探内容
    return TYPE_TEXT;
  }

  // ── 打开主流程 ──
  function openPath(filePath) {
    if (!filePath) return;
    if (!window.electronAPI || typeof window.electronAPI.readReaderFile !== 'function') {
      showError('当前环境不支持本地文件读取', '请从桌面应用内打开。');
      return;
    }
    show('loading');
    window.electronAPI.readReaderFile(filePath).then(function (res) {
      if (!res) { showError('读取文件失败'); return; }
      if (res.tooLarge) { showError('文件过大', '当前预览上限 100MB，请改用其他工具打开。'); return; }
      if (res.error) { showError('读取文件失败', res.error); return; }
      renderFile(res);
    }).catch(function (err) {
      showError('读取文件失败', err && err.message);
    });
  }

  function renderFile(res) {
    var type = detectType(res.fileName);
    state.current = { filePath: res.displayPath, fileName: res.fileName, size: res.size, type: type };
    state.pdfDoc = null; state.pdfPage = 1; state.pdfScale = 1.3;
    state.pptSlides = null; state.xlsxWorkbook = null; state.xlsxSheetIndex = 0;
    state.docxRendered = false;
    el.container.innerHTML = '';
    el.sheetBar.innerHTML = ''; el.sheetBar.hidden = true;
    el.pager.hidden = true; el.zoomGroup.hidden = true;
    el.editBtn.hidden = true; el.exportBtn.hidden = true;

    setFileMeta(res.fileName, res.displayPath);
    setBadge(type);

    if (String(type).indexOf('unsupported') === 0) {
      var ext = type.replace('unsupported-', '');
      showError('暂不支持预览 .' + ext, UNSUPPORTED_MSG[ext] || '');
      return;
    }

    // 按钮可用性
    var isTextual = (type === TYPE_MD || type === TYPE_CODE || type === TYPE_TEXT || type === TYPE_CSV);
    if (isTextual && window.electronAPI && typeof window.electronAPI.openFileByPath === 'function') {
      el.editBtn.hidden = false;
    }
    if (type === TYPE_CSV || type === TYPE_XLSX) {
      el.exportBtn.hidden = false;
    }

    var arr = b64ToUint8(res.base64);
    var dispatcher = {
      pdf: function () { renderPdf(arr); },
      docx: function () { renderDocx(arr); },
      pptx: function () { renderPptx(arr); },
      xlsx: function () { renderXlsx(arr); },
      csv: function () { renderCsv(arr); },
      md: function () { renderMarkdown(arr); },
      code: function () { renderCode(arr, res.fileName); },
      text: function () { renderText(arr); }
    };
    var fn = dispatcher[type] || function () { renderText(arr); };
    // 防卡死兜底：无论任何原因（worker 加载失败、解析库挂起）在时限内未完成，
    // 强制结束加载态并给出错误提示，避免无限转圈。
    armWatchdog();
    fn();
  }

  // ── 解析看门狗：60s 未完成 → 强制错误态 ──
  var watchdogTimer = null;
  function armWatchdog() {
    clearWatchdog();
    watchdogTimer = setTimeout(function () {
      clearWatchdog();
      if (el.loading && !el.loading.hidden) {
        showError('解析超时', '文档过大或格式异常，请稍后重试，或改用系统默认程序打开。');
      }
    }, 60000);
  }
  function clearWatchdog() {
    if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
  }

  // ── PDF ──
  function renderPdf(arr) {
    show('loading');
    el.zoomGroup.hidden = false;
    el.pager.hidden = false;
    el.pagerHint.textContent = '拖拽/滚轮也可翻页';
    loadScript('pdfjs/pdf.min.js').then(function () {
      var pdfjs = global.pdfjsLib;
      if (!pdfjs || typeof pdfjs.getDocument !== 'function') throw new Error('pdf.js 未加载');
      // Electron (file:// 受限) 下把 worker 转成 blob URL 加载，避免 workerSrc 用相对路径失效
      return loadScript('pdfjs/pdf.worker.min.js').then(function () {
        var workerSrc = READER_LIBS_BASE + 'pdfjs/pdf.worker.min.js';
        // 直接请求 worker 文件内容并包成 blob（fetch 相对同源静态服务器）
        return fetch(workerSrc).then(function (r) { return r.blob(); }).then(function (blob) {
          var url = URL.createObjectURL(blob);
          pdfjs.GlobalWorkerOptions.workerSrc = url;
        }).catch(function () {
          pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
        });
      }).then(function () {
        // getDocument 在 worker 初始化失败时可能永久 pending，加 30s 超时兜底
        return withTimeout(pdfjs.getDocument({ data: arr.slice() }).promise, 30000);
      });
    }).then(function (pdf) {
      state.pdfDoc = pdf;
      show('content');
      clearWatchdog();
      el.pageInfo.textContent = '1 / ' + pdf.numPages;
      return renderPdfPage(1);
    }).catch(function (err) {
      clearWatchdog();
      if (err && err.name === 'TimeoutError') {
        showError('PDF 解析超时', '可能是加密/损坏的 PDF，或渲染引擎未能启动。');
      } else {
        showError('PDF 解析失败', err && err.message);
      }
    });
  }

  // Promise 超时辅助
  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        var e = new Error('timeout');
        e.name = 'TimeoutError';
        reject(e);
      }, ms);
      promise.then(function (v) { clearTimeout(timer); resolve(v); },
        function (e) { clearTimeout(timer); reject(e); });
    });
  }

  function renderPdfPage(pageNum) {
    if (!state.pdfDoc) return;
    var pdf = state.pdfDoc;
    if (pageNum < 1) pageNum = 1;
    if (pageNum > pdf.numPages) pageNum = pdf.numPages;
    state.pdfPage = pageNum;
    el.pageInfo.textContent = pageNum + ' / ' + pdf.numPages;
    el.scroll.scrollTop = 0; // 翻页后回到页首，避免停留在旧页的滚动位置

    var wrap = el.container.querySelector('.rd-pdf-canvas-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'rd-pdf-canvas-wrap';
      el.container.appendChild(wrap);
    }
    wrap.innerHTML = '';
    pdf.getPage(pageNum).then(function (page) {
      var viewport = page.getViewport({ scale: state.pdfScale });
      // 受容器宽度约束
      var maxW = el.container.clientWidth - 60;
      if (viewport.width > maxW && maxW > 200) {
        var fitScale = maxW / viewport.width;
        viewport = page.getViewport({ scale: state.pdfScale * fitScale });
      }
      var pageWrap = document.createElement('div');
      pageWrap.className = 'rd-pdf-page';
      var canvas = document.createElement('canvas');
      var ratio = global.devicePixelRatio || 1;
      canvas.width = viewport.width * ratio;
      canvas.height = viewport.height * ratio;
      canvas.style.width = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';
      pageWrap.appendChild(canvas);
      wrap.appendChild(pageWrap);
      var ctx = canvas.getContext('2d');
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      return page.render({ canvasContext: ctx, viewport: viewport }).promise;
    }).catch(function (err) {
      console.error('[Reader] pdf page render failed', err);
    });
  }

  // ── docx ──
  function renderDocx(arr) {
    show('loading');
    loadScript('jszip.min.js').then(function () {
      return loadScript('docx-preview.min.js');
    }).then(function () {
      var docx = global.docx;
      if (!docx || typeof docx.renderAsync !== 'function') throw new Error('docx-preview 未加载');
      var container = document.createElement('div');
      container.className = 'rd-docx-view';
      el.container.appendChild(container);
      return docx.renderAsync(arr, container, null, {
        className: 'docx',
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        ignoreFonts: false,
        breakPages: true,
        ignoreLastRenderedPageBreak: true
      }).then(function () {
        state.docxRendered = true;
        show('content');
      });
    }).catch(function (err) {
      showError('Word 解析失败', err && err.message);
    });
  }

  // ── pptx（文本提取降级渲染：jszip 解析 XML → 幻灯片文本列表）──
  function renderPptx(arr) {
    show('loading');
    loadScript('jszip.min.js').then(function () {
      return JSZip.loadAsync(arr);
    }).then(function (zip) {
      // 幻灯片文件 slideN.xml 可能带数字前缀（ppt/slides/slide1.xml）
      var slideFiles = Object.keys(zip.files)
        .filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/.test(n); })
        .sort(function (a, b) {
          var an = parseInt(/slide(\d+)/.exec(a)[1], 10);
          var bn = parseInt(/slide(\d+)/.exec(b)[1], 10);
          return an - bn;
        });
      if (!slideFiles.length) throw new Error('未找到幻灯片内容');
      return Promise.all(slideFiles.map(function (name) {
        return zip.file(name).async('text');
      })).then(function (texts) {
        // 抽取 <a:t>…</a:t> 文本
        return texts.map(function (xml) {
          var m;
          var parts = [];
          var re = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
          while ((m = re.exec(xml)) !== null) {
            var t = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
            if (t && t.trim()) parts.push(t);
          }
          return parts;
        });
      });
    }).then(function (slides) {
      state.pptSlides = slides;
      var container = document.createElement('div');
      container.className = 'rd-ppt-view';
      el.container.appendChild(container);
      slides.forEach(function (texts, idx) {
        var slide = document.createElement('div');
        slide.className = 'rd-ppt-slide';
        var title = document.createElement('div');
        title.className = 'rd-ppt-slide-title';
        title.textContent = '幻灯片 ' + (idx + 1) + ' / ' + slides.length;
        slide.appendChild(title);
        if (!texts.length) {
          var empty = document.createElement('p');
          empty.className = 'rd-ppt-empty-note';
          empty.textContent = '（本页无文本内容）';
          slide.appendChild(empty);
        } else {
          texts.forEach(function (t) {
            var p = document.createElement('p');
            p.textContent = t;
            slide.appendChild(p);
          });
        }
        container.appendChild(slide);
      });
      el.pager.hidden = false;
      el.pagerHint.textContent = '已提取各页文本（轻量预览）';
      el.pageInfo.textContent = slides.length + ' 页';
      el.prev.disabled = true;
      el.next.disabled = true;
      show('content');
    }).catch(function (err) {
      showError('PPT 解析失败', err && err.message);
    });
  }

  // ── xlsx（exceljs 只读 → HTML 表格）──
  function renderXlsx(arr) {
    show('loading');
    loadScript('exceljs.min.js').then(function () {
      var wb = new ExcelJS.Workbook();
      return wb.xlsx.load(arr).then(function () {
        state.xlsxWorkbook = wb;
        buildSheetBar();
        renderSheet(0);
        show('content');
      });
    }).catch(function (err) {
      showError('Excel 解析失败', err && err.message);
    });
  }

  function buildSheetBar() {
    var wb = state.xlsxWorkbook;
    if (!wb || wb.worksheets.length <= 1) return;
    el.sheetBar.hidden = false;
    el.sheetBar.innerHTML = '';
    wb.worksheets.forEach(function (ws, i) {
      var tab = document.createElement('button');
      tab.className = 'rd-sheet-tab' + (i === state.xlsxSheetIndex ? ' active' : '');
      tab.textContent = ws.name || ('Sheet' + (i + 1));
      tab.addEventListener('click', function () {
        state.xlsxSheetIndex = i;
        renderSheet(i);
        Array.prototype.forEach.call(el.sheetBar.children, function (b, bi) {
          b.classList.toggle('active', bi === i);
        });
      });
      el.sheetBar.appendChild(tab);
    });
  }

  function renderSheet(index) {
    var wb = state.xlsxWorkbook;
    if (!wb) return;
    var ws = wb.worksheets[index];
    if (!ws) return;
    el.container.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'rd-xlsx-wrap';
    el.container.appendChild(wrap);
    if (!ws.rowCount) {
      var empty = document.createElement('div');
      empty.className = 'rd-xlsx-empty';
      empty.textContent = '工作表为空';
      wrap.appendChild(empty);
      return;
    }
    var table = document.createElement('table');
    table.className = 'rd-xlsx-table';
    // 合并单元格映射（merge 区域 → 只有起始单元格输出，其余占位）
    var merges = {};
    ws.eachRow({ includeEmpty: true }, function (row, rowNum) {
      var tr = document.createElement('tr');
      var lastCol = ws.columnCount || row.cellCount || 1;
      for (var c = 1; c <= lastCol; c++) {
        var cell = row.getCell(c);
        var td = document.createElement('td');
        var v = cell.value;
        var text = '';
        if (v != null) {
          if (typeof v === 'object' && v.richText) {
            text = v.richText.map(function (r) { return r.text || ''; }).join('');
          } else if (typeof v === 'object' && v.text != null) {
            text = String(v.text);
          } else {
            text = String(v);
          }
        }
        td.textContent = text;
        if (rowNum === 1) td = document.createElement('th');
        tr.appendChild(td);
      }
      table.appendChild(tr);
    });
    // 合并单元格（仅起始终止标记）
    if (ws.model && ws.model.merges) {
      ws.model.merges.forEach(function (m) {
        var range = m;
        if (range && range.tl && range.br) {
          // 覆盖第一个单元格 rowspan/colspan
          var r0 = range.tl.row, c0 = range.tl.col;
          var r1 = range.br.row, c1 = range.br.col;
          var rowEl = table.rows[r0 - 1];
          if (rowEl) {
            var cellEl = rowEl.cells[c0 - 1];
            if (cellEl) {
              if (r1 > r0) cellEl.rowSpan = r1 - r0 + 1;
              if (c1 > c0) cellEl.colSpan = c1 - c0 + 1;
              cellEl.classList.add('rd-xlsx-merge-center');
              // 隐藏被合并的单元格
              for (var rr = r0; rr <= r1; rr++) {
                var rowE = table.rows[rr - 1];
                if (!rowE) continue;
                for (var cc = c0; cc <= c1; cc++) {
                  if (rr === r0 && cc === c0) continue;
                  var cel = rowE.cells[cc - 1];
                  if (cel) cel.style.display = 'none';
                }
              }
            }
          }
        }
      });
    }
    wrap.appendChild(table);
  }

  // ── CSV ──
  function renderCsv(arr) {
    show('loading');
    try {
      var text = decodeBytes(arr);
      var rows = parseCsv(text);
      el.container.innerHTML = '';
      var wrap = document.createElement('div');
      wrap.className = 'rd-xlsx-wrap';
      var table = document.createElement('table');
      table.className = 'rd-xlsx-table';
      rows.forEach(function (row, i) {
        var tr = document.createElement('tr');
        row.forEach(function (cellText) {
          var td = document.createElement(i === 0 ? 'th' : 'td');
          td.textContent = cellText;
          tr.appendChild(td);
        });
        table.appendChild(tr);
      });
      wrap.appendChild(table);
      el.container.appendChild(wrap);
      el.exportBtn.hidden = false;
      show('content');
    } catch (err) {
      showError('CSV 解析失败', err && err.message);
    }
  }

  // 简易 CSV 解析（引号/逗号/换行）
  function parseCsv(text) {
    var rows = [];
    var row = [];
    var cur = '';
    var inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else cur += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { row.push(cur); cur = ''; }
        else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
        else if (ch === '\r') { /* skip */ }
        else cur += ch;
      }
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return c.trim() !== ''; }); });
  }

  // ── Markdown ──
  function renderMarkdown(arr) {
    show('loading');
    try {
      var text = decodeBytes(arr);
      var html = '';
      if (global.MediaKit && global.MediaKit.render && typeof global.MediaKit.render.renderMarkdown === 'function') {
        html = global.MediaKit.render.renderMarkdown(text);
      } else if (global.marked && typeof global.marked.parse === 'function') {
        html = global.marked.parse(text);
      } else {
        html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
      var view = document.createElement('div');
      view.className = 'rd-markdown-view';
      view.innerHTML = html;
      el.container.appendChild(view);
      show('content');
    } catch (err) {
      showError('Markdown 解析失败', err && err.message);
    }
  }

  // ── 代码高亮 ──
  function renderCode(arr, fileName) {
    show('loading');
    try {
      var text = decodeBytes(arr);
      var ext = extOf(fileName);
      var lang = hljsLang(ext);
      var view = document.createElement('div');
      view.className = 'rd-code-view';
      var pre = document.createElement('pre');
      var code = document.createElement('code');
      code.className = 'hljs' + (lang ? ' language-' + lang : '');
      loadScript('highlight.min.js').then(function () {
        try {
          if (global.hljs && lang) code.innerHTML = global.hljs.highlight(text, { language: lang }).value;
          else if (global.hljs) code.innerHTML = global.hljs.highlightAuto(text).value;
          else code.textContent = text;
        } catch (e) {
          code.textContent = text;
        }
        pre.appendChild(code);
        view.appendChild(pre);
        el.container.appendChild(view);
        show('content');
      }).catch(function () {
        code.textContent = text;
        pre.appendChild(code);
        view.appendChild(pre);
        el.container.appendChild(view);
        show('content');
      });
    } catch (err) {
      showError('代码解析失败', err && err.message);
    }
  }

  function hljsLang(ext) {
    var map = {
      js: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python',
      java: 'java', c: 'c', cpp: 'cpp', h: 'c', go: 'go', rs: 'rust',
      rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin', sql: 'sql',
      html: 'xml', htm: 'xml', css: 'css', scss: 'scss', less: 'less',
      json: 'json', xml: 'xml', yaml: 'yaml', yml: 'yaml', sh: 'bash',
      bat: 'dos', ps1: 'powershell', ini: 'ini'
    };
    return map[ext] || '';
  }

  // ── 纯文本 ──
  function renderText(arr) {
    show('loading');
    try {
      var text = decodeBytes(arr);
      var view = document.createElement('div');
      view.className = 'rd-text-view';
      view.textContent = text;
      el.container.appendChild(view);
      show('content');
    } catch (err) {
      showError('文本解析失败', err && err.message);
    }
  }

  // ── 按钮事件 ──
  function bindEvents() {
    el.openBtn.addEventListener('click', function () {
      if (!window.electronAPI || typeof window.electronAPI.selectReaderFile !== 'function') return;
      window.electronAPI.selectReaderFile().then(function (r) {
        if (r && r.filePath) openPath(r.filePath);
      });
    });
    el.editBtn.addEventListener('click', function () {
      if (!state.current || !window.electronAPI || typeof window.electronAPI.openFileByPath !== 'function') return;
      var p = state.current.filePath;
      // 通知主框架以编辑器新标签打开
      window.parent.postMessage({ type: 'openFileInEditor', filePath: p }, '*');
    });
    el.exportBtn.addEventListener('click', function () {
      if (!state.current) return;
      var type = state.current.type;
      if (type === TYPE_CSV || type === TYPE_XLSX) {
        var html = el.container.querySelector('.rd-xlsx-wrap');
        if (html) {
          var blob = new Blob([html.outerHTML], { type: 'text/html' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = (state.current.fileName || 'sheet') + '.html';
          a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        }
      }
    });
    el.prev.addEventListener('click', function () { if (state.pdfDoc) renderPdfPage(state.pdfPage - 1); });
    el.next.addEventListener('click', function () { if (state.pdfDoc) renderPdfPage(state.pdfPage + 1); });
    el.zoomIn.addEventListener('click', function () {
      if (state.pdfDoc) { state.pdfScale = Math.min(4, state.pdfScale + 0.2); renderPdfPage(state.pdfPage); }
    });
    el.zoomOut.addEventListener('click', function () {
      if (state.pdfDoc) { state.pdfScale = Math.max(0.4, state.pdfScale - 0.2); renderPdfPage(state.pdfPage); }
    });
    el.fit.addEventListener('click', function () {
      if (state.pdfDoc) { state.pdfScale = 1.3; renderPdfPage(state.pdfPage); }
    });
    // 键盘：空格翻页、方向键翻页、Ctrl +/- 缩放（PDF）
    document.addEventListener('keydown', function (e) {
      if (!state.pdfDoc) return;
      if (e.code === 'Space') { e.preventDefault(); renderPdfPage(e.shiftKey ? state.pdfPage - 1 : state.pdfPage + 1); }
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); renderPdfPage(state.pdfPage + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); renderPdfPage(state.pdfPage - 1); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); state.pdfScale = Math.min(4, state.pdfScale + 0.2); renderPdfPage(state.pdfPage); }
      else if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); state.pdfScale = Math.max(0.4, state.pdfScale - 0.2); renderPdfPage(state.pdfPage); }
    });
    // 滚轮（PDF）：Ctrl+滚轮缩放；普通滚轮滚动到容器边界时翻页
    el.scroll.addEventListener('wheel', function (e) {
      if (!state.pdfDoc) return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        state.pdfScale = Math.max(0.4, Math.min(4, state.pdfScale + (e.deltaY < 0 ? 0.15 : -0.15)));
        renderPdfPage(state.pdfPage);
        return;
      }
      var st = el.scroll.scrollTop;
      var sh = el.scroll.scrollHeight;
      var ch = el.scroll.clientHeight;
      if (e.deltaY > 0 && sh - st - ch < 4) {   // 已滚到底 → 下一页
        e.preventDefault();
        renderPdfPage(state.pdfPage + 1);
      } else if (e.deltaY < 0 && st <= 4) {     // 已滚到顶 → 上一页
        e.preventDefault();
        renderPdfPage(state.pdfPage - 1);
      }
    }, { passive: false });

    // 拖拽翻页（PDF）：按住页面左拖=下一页、右拖=上一页
    var pdfDrag = null;
    el.container.addEventListener('mousedown', function (e) {
      if (!state.pdfDoc || e.button !== 0) return;
      pdfDrag = { x: e.clientX, y: e.clientY, moved: false };
    });
    document.addEventListener('mousemove', function (e) {
      if (!pdfDrag || !state.pdfDoc) return;
      var dx = e.clientX - pdfDrag.x;
      var dy = e.clientY - pdfDrag.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) pdfDrag.moved = true;
      if (pdfDrag.moved) e.preventDefault();
    });
    document.addEventListener('mouseup', function (e) {
      if (!pdfDrag || !state.pdfDoc) return;
      var dx = e.clientX - pdfDrag.x;
      var dy = e.clientY - pdfDrag.y;
      // 水平位移显著大于垂直位移才判定为翻页手势
      if (pdfDrag.moved && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        renderPdfPage(dx < 0 ? state.pdfPage + 1 : state.pdfPage - 1);
      }
      pdfDrag = null;
    });

    // ── 拖拽打开 ──
    var main = document.body;
    main.addEventListener('dragenter', function (e) {
      e.preventDefault();
      state.dragDepth++;
      el.empty.classList.add('drag-over');
    });
    main.addEventListener('dragover', function (e) { e.preventDefault(); });
    main.addEventListener('dragleave', function (e) {
      e.preventDefault();
      state.dragDepth = Math.max(0, state.dragDepth - 1);
      if (state.dragDepth === 0) el.empty.classList.remove('drag-over');
    });
    main.addEventListener('drop', function (e) {
      e.preventDefault();
      state.dragDepth = 0;
      el.empty.classList.remove('drag-over');
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) {
        var f = files[0];
        var ext = extOf(f.name);
        if (SUPPORTED_EXTS.has(ext)) {
          // 浏览器只给了 File 对象（没有绝对路径），无 electronAPI 读取能力时直接读取
          if (window.electronAPI && typeof window.electronAPI.readReaderFile === 'function' && f.path) {
            openPath(f.path);
          } else {
            readDroppedFile(f);
          }
        } else {
          showError('不支持该文件类型', '当前支持：' + Array.from(SUPPORTED_EXTS).slice(0, 18).join(' / ') + ' 等');
        }
      }
    });
  }

  // 拖拽文件无绝对路径时：本地 File 对象读取（工具页自用场景的兜底）
  function readDroppedFile(file) {
    show('loading');
    var reader = new FileReader();
    reader.onload = function () {
      var base64 = String(reader.result).split(',')[1] || '';
      renderFile({ fileName: file.name, displayPath: file.name, size: file.size, base64: base64 });
    };
    reader.onerror = function () { showError('读取文件失败'); };
    reader.readAsDataURL(file);
  }

  // ── 空状态 chips ──
  function renderChips() {
    var groups = [['PDF', 'pdf'], ['Word', 'docx'], ['PPT', 'pptx'], ['Excel', 'xlsx'], ['Markdown', 'md'], ['代码', 'code']];
    el.chipRow.innerHTML = '';
    groups.forEach(function (g) {
      var chip = document.createElement('span');
      chip.className = 'rd-chip';
      chip.textContent = g[0];
      el.chipRow.appendChild(chip);
    });
  }

  // ── 消息监听（主框架 / 剪藏模块转发）──
  function listenMessages() {
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (!d) return;
      // 主框架 / 剪藏模块请求以阅读器打开文件
      if (d.type === 'openInReader' && d.filePath) {
        openPath(d.filePath);
      }
    });
  }

  // ── 初始化 ──
  function init() {
    // 主题：iframe 子页面读取同一份 localStorage 并监听父页面广播
    if (global.CutShelterThemeBridge) {
      global.CutShelterThemeBridge.init();
      global.CutShelterThemeBridge.listen();
    }
    renderChips();
    bindEvents();
    listenMessages();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);