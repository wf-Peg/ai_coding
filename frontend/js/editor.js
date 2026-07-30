(function initializeLightEditor() {
  'use strict';

  const API_BASE_URL = 'http://127.0.0.1:8080/api/clip';
  const MAX_TRANSFORM_LENGTH = 5 * 1024 * 1024;
  const THEME_STORAGE_KEY = 'app_theme_v1';
  const APPEARANCE_KEY = 'app_appearance_v1';
  const Range = ace.require('ace/range').Range;
  const state = {
    fileToken: null,
    fileName: '未命名.txt',
    displayPath: '',
    encoding: 'UTF-8',
    encodingConfidence: '',
    lineEnding: 'LF',
    expectedMtimeMs: null,
    modified: false,
    suppressChange: false,
    browserBytes: null,
    browserPurpose: 'main',
    clipId: null,
    clipType: 'store-only',
    compareToken: null,
    diffMarkers: { main: [], compare: [] },
    syncMarkers: { main: [], compare: [] },
    diffLocations: [],
    activeDiffIndex: -1,
    transformTarget: null,
    categoriesLoaded: false,
    clipMetadata: null,
    diffTimer: null
  };

  const elements = Object.fromEntries([
    'documentName', 'documentPath', 'modifiedDot', 'clipSourceBadge', 'languageSelect',
    'encodingLabel', 'encodingConfidence', 'lineEndingSelect', 'cursorStatus',
    'selectionStatus', 'matchStatus', 'runtimeStatus', 'compareToolbar', 'comparePane',
    'editorWorkspace', 'compareFileName', 'diffCounter', 'transformPanel',
    'transformOperation', 'transformPreview', 'encodingModal', 'encodingSelect',
    'encodingNote', 'clipModal', 'clipModalTitle', 'clipScopeDescription',
    'clipTitleInput', 'clipModeSelect', 'clipCategorySelect', 'clipTagsInput',
    'clipThoughtsInput', 'includeFileNameCheck', 'submitClipBtn', 'browserFileInput', 'toast'
  ].map(id => [id, document.getElementById(id)]));

  ace.config.set('basePath', 'libs/ace');
  ace.config.set('modePath', 'libs/ace');
  ace.config.set('themePath', 'libs/ace');
  ace.config.set('workerPath', 'libs/ace');

  const mainEditor = createEditor('mainEditor', false);
  const compareEditor = createEditor('compareEditor', true);

  function createEditor(id, readOnly) {
    const editor = ace.edit(id);
    editor.setOptions({
      fontSize: '13px',
      showPrintMargin: false,
      displayIndentGuides: true,
      highlightActiveLine: !readOnly,
      highlightSelectedWord: true,
      enableBasicAutocompletion: false,
      enableLiveAutocompletion: false,
      useWorker: true,
      readOnly,
      scrollPastEnd: 0.3,
      wrap: false
    });
    editor.session.setMode('ace/mode/text');
    editor.session.setUseSoftTabs(true);
    editor.session.setTabSize(2);
    return editor;
  }

  function applyTheme() {
    const appearance = localStorage.getItem(APPEARANCE_KEY) || 'notion';
    let theme = localStorage.getItem(THEME_STORAGE_KEY) || 'notion';
    if (appearance === 'dark') theme = 'dark';
    if (appearance === 'regular') theme = 'regular';
    if (appearance === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'notion';
    }
    document.documentElement.setAttribute('data-theme', theme);
    const aceTheme = theme === 'dark' ? 'ace/theme/tomorrow_night' : 'ace/theme/textmate';
    mainEditor.setTheme(aceTheme);
    compareEditor.setTheme(aceTheme);
  }

  function updateDocumentIdentity() {
    elements.documentName.textContent = state.fileName;
    elements.documentPath.textContent = state.displayPath || (state.clipId ? `剪藏 #${state.clipId}` : '尚未保存');
    elements.modifiedDot.classList.toggle('active', state.modified);
    elements.clipSourceBadge.hidden = !state.clipId;
    elements.encodingLabel.textContent = state.encoding;
    elements.encodingConfidence.textContent = state.encodingConfidence ? ` · ${state.encodingConfidence}` : '';
    elements.lineEndingSelect.value = state.lineEnding;
    document.title = `${state.modified ? '● ' : ''}${state.fileName} - 轻编辑`;
  }

  function setModified(modified) {
    state.modified = modified;
    updateDocumentIdentity();
  }

  function setEditorContent(text, options = {}) {
    state.suppressChange = true;
    mainEditor.setValue(text || '', -1);
    state.suppressChange = false;
    state.lineEnding = options.lineEnding || EditorCore.detectLineEnding(text || '');
    state.encoding = options.encoding || state.encoding;
    state.encodingConfidence = options.encodingConfidence || '';
    state.fileName = options.fileName || state.fileName;
    state.displayPath = options.displayPath || '';
    state.expectedMtimeMs = options.expectedMtimeMs ?? null;
    state.fileToken = options.fileToken ?? null;
    state.browserBytes = options.browserBytes || null;
    setLanguage(options.language || EditorCore.detectLanguage(state.fileName, text));
    setModified(false);
    mainEditor.focus();
  }

  function setLanguage(language) {
    const normalized = ['json', 'xml', 'sql'].includes(language) ? language : 'text';
    elements.languageSelect.value = normalized;
    mainEditor.session.setMode(`ace/mode/${normalized}`);
    compareEditor.session.setMode(`ace/mode/${normalized}`);
  }

  function resetDocument() {
    state.fileToken = null;
    state.fileName = '未命名.txt';
    state.displayPath = '';
    state.encoding = 'UTF-8';
    state.encodingConfidence = '';
    state.expectedMtimeMs = null;
    state.browserBytes = null;
    state.clipId = null;
    state.clipType = 'store-only';
    state.clipMetadata = null;
    elements.clipTagsInput.value = '';
    elements.clipThoughtsInput.value = '';
    elements.clipCategorySelect.value = '';
    setEditorContent('', { fileName: state.fileName, encoding: state.encoding, lineEnding: 'LF' });
  }

  function confirmDiscardChanges() {
    return !state.modified || window.confirm('当前内容尚未保存，确定放弃修改吗？');
  }

  async function openMainFile() {
    if (!confirmDiscardChanges()) return;
    if (window.electronAPI && typeof window.electronAPI.openTextFile === 'function') {
      try {
        const result = await window.electronAPI.openTextFile();
        if (!result || result.canceled) return;
        state.clipId = null;
        state.clipType = 'store-only';
        state.clipMetadata = null;
        setEditorContent(result.text, {
          fileToken: result.fileToken,
          fileName: result.fileName,
          displayPath: result.displayPath,
          encoding: result.encoding,
          encodingConfidence: result.encodingConfidence,
          lineEnding: result.lineEnding,
          expectedMtimeMs: result.mtimeMs
        });
        showToast(`已打开 ${result.fileName}`);
        FrontendLogger.info('[Editor] Opened file', result.fileName, result.size);
      } catch (error) {
        handleError('打开文件失败', error);
      }
      return;
    }
    state.browserPurpose = 'main';
    elements.browserFileInput.click();
  }

  async function handleBrowserFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = decodeBrowserBytes(bytes, 'UTF-8');
    if (state.browserPurpose === 'compare') {
      compareEditor.setValue(text, -1);
      elements.compareFileName.textContent = file.name;
      updateDiff();
      return;
    }
    state.clipId = null;
    state.clipType = 'store-only';
    state.clipMetadata = null;
    setEditorContent(text, {
      fileName: file.name,
      displayPath: file.name,
      encoding: 'UTF-8',
      encodingConfidence: '浏览器默认',
      lineEnding: EditorCore.detectLineEnding(text),
      browserBytes: bytes
    });
  }

  function decodeBrowserBytes(bytes, encoding) {
    const label = {
      'UTF-8': 'utf-8',
      'UTF-8-BOM': 'utf-8',
      GB18030: 'gb18030',
      'UTF-16LE': 'utf-16le',
      'UTF-16BE': 'utf-16be',
      BIG5: 'big5',
      SHIFT_JIS: 'shift_jis',
      'WINDOWS-1252': 'windows-1252'
    }[encoding] || 'utf-8';
    return new TextDecoder(label).decode(bytes);
  }

  async function saveFile(saveAs) {
    const text = mainEditor.getValue();
    if (window.electronAPI && typeof window.electronAPI.saveTextFile === 'function') {
      try {
        const payload = {
          fileToken: state.fileToken,
          text,
          encoding: state.encoding,
          lineEnding: state.lineEnding,
          expectedMtimeMs: state.expectedMtimeMs,
          suggestedName: state.fileName
        };
        const result = saveAs || !state.fileToken
          ? await window.electronAPI.saveTextFileAs(payload)
          : await window.electronAPI.saveTextFile(payload);
        if (!result || result.canceled) return;
        if (result.conflict) {
          showToast('文件已被其他程序修改，请使用“另存为”或重新打开', true);
          return;
        }
        state.fileToken = result.fileToken;
        state.fileName = result.fileName;
        state.displayPath = result.displayPath;
        state.expectedMtimeMs = result.mtimeMs;
        setModified(false);
        showToast(`已保存为 ${state.encoding}`);
        FrontendLogger.info('[Editor] Saved file', result.fileName, result.size, state.encoding);
      } catch (error) {
        handleError('保存文件失败', error);
      }
      return;
    }

    const normalized = EditorCore.normalizeLineEnding(text, state.lineEnding);
    const blob = new Blob([normalized], { type: 'text/plain;charset=utf-8' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = state.fileName || 'untitled.txt';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
    state.encoding = 'UTF-8';
    setModified(false);
    showToast('浏览器模式已下载 UTF-8 文件');
  }

  function getTargetRangeAndText() {
    const range = mainEditor.getSelectionRange();
    const selectedText = mainEditor.session.getTextRange(range);
    if (selectedText) return { range, text: selectedText, selection: true };
    const lastRow = Math.max(0, mainEditor.session.getLength() - 1);
    const endColumn = mainEditor.session.getLine(lastRow).length;
    return {
      range: new Range(0, 0, lastRow, endColumn),
      text: mainEditor.getValue(),
      selection: false
    };
  }

  function formatCurrentContent() {
    const target = getTargetRangeAndText();
    if (target.text.length > MAX_TRANSFORM_LENGTH) {
      showToast('格式化内容超过 5 MB，已阻止本次操作', true);
      return;
    }
    const language = elements.languageSelect.value;
    try {
      let formatted;
      if (language === 'json') formatted = EditorCore.formatJson(target.text, false);
      else if (language === 'xml') formatted = EditorCore.formatXml(target.text, false);
      else if (language === 'sql') formatted = EditorCore.formatSql(target.text, 'sql');
      else throw new Error('请选择 JSON、XML 或 SQL 模式');
      mainEditor.session.replace(target.range, formatted);
      showToast(`${target.selection ? '选区' : '全文'}格式化完成`);
    } catch (error) {
      const detail = EditorCore.extractErrorLocation(error);
      showToast(`格式化失败：${detail.message}`, true);
      FrontendLogger.warn('[Editor] Format failed', language, detail.message);
    }
  }

  function openTransformPanel() {
    state.transformTarget = getTargetRangeAndText();
    elements.transformPanel.classList.add('open');
    elements.transformPanel.setAttribute('aria-hidden', 'false');
    updateTransformPreview();
  }

  function closeTransformPanel() {
    elements.transformPanel.classList.remove('open');
    elements.transformPanel.setAttribute('aria-hidden', 'true');
  }

  function updateTransformPreview() {
    if (!state.transformTarget) state.transformTarget = getTargetRangeAndText();
    if (state.transformTarget.text.length > MAX_TRANSFORM_LENGTH) {
      elements.transformPreview.value = '内容超过 5 MB，无法转换。';
      return;
    }
    try {
      elements.transformPreview.value = EditorCore.transform(
        state.transformTarget.text,
        elements.transformOperation.value
      );
    } catch (error) {
      elements.transformPreview.value = `转换失败：${error.message}`;
    }
  }

  function applyTransform() {
    if (!state.transformTarget || elements.transformPreview.value.startsWith('转换失败：')) return;
    mainEditor.session.replace(state.transformTarget.range, elements.transformPreview.value);
    closeTransformPanel();
    showToast('转换结果已替换原文');
  }

  async function toggleCompare(forceOpen) {
    const shouldOpen = forceOpen !== undefined ? forceOpen : elements.comparePane.hidden;
    elements.comparePane.hidden = !shouldOpen;
    elements.compareToolbar.hidden = !shouldOpen;
    elements.compareToolbar.classList.toggle('is-open', shouldOpen);
    elements.compareToolbar.setAttribute('aria-hidden', String(!shouldOpen));
    elements.editorWorkspace.classList.toggle('comparing', shouldOpen);
    if (shouldOpen && !compareEditor.getValue()) {
      compareEditor.setValue(mainEditor.getValue(), -1);
      elements.compareFileName.textContent = '当前文档快照';
    }
    setTimeout(() => {
      mainEditor.resize();
      compareEditor.resize();
      if (shouldOpen) updateDiff();
    }, 0);
  }

  async function loadCompareFromClipboard() {
    try {
      let text;
      if (window.electronAPI && typeof window.electronAPI.readClipboard === 'function') {
        text = await window.electronAPI.readClipboard();
      } else {
        text = await navigator.clipboard.readText();
      }
      compareEditor.setValue(text || '', -1);
      elements.compareFileName.textContent = '剪贴板';
      updateDiff();
    } catch (error) {
      handleError('读取剪贴板失败', error);
    }
  }

  async function loadCompareFromFile() {
    if (window.electronAPI && typeof window.electronAPI.openTextFile === 'function') {
      try {
        const result = await window.electronAPI.openTextFile();
        if (!result || result.canceled) return;
        state.compareToken = result.fileToken;
        compareEditor.setValue(result.text, -1);
        elements.compareFileName.textContent = result.fileName;
        updateDiff();
      } catch (error) {
        handleError('载入对比文件失败', error);
      }
      return;
    }
    state.browserPurpose = 'compare';
    elements.browserFileInput.click();
  }

  function clearMarkers(editor, markerIds) {
    markerIds.forEach(id => editor.session.removeMarker(id));
    markerIds.length = 0;
  }

  function countRows(value) {
    if (!value) return 0;
    const rows = value.split('\n').length;
    return value.endsWith('\n') ? rows - 1 : rows;
  }

  function addFullLineMarker(editor, row, count, className) {
    const safeCount = Math.max(1, count);
    return editor.session.addMarker(new Range(row, 0, row + safeCount - 1, 1), className, 'fullLine');
  }

  function updateDiff() {
    clearMarkers(mainEditor, state.diffMarkers.main);
    clearMarkers(compareEditor, state.diffMarkers.compare);
    state.diffLocations = [];
    state.activeDiffIndex = -1;

    if (!window.Diff || typeof window.Diff.diffLines !== 'function') {
      elements.diffCounter.textContent = '差异组件未加载';
      return;
    }
    const parts = window.Diff.diffLines(mainEditor.getValue(), compareEditor.getValue());
    let leftRow = 0;
    let rightRow = 0;
    parts.forEach(part => {
      const rows = countRows(part.value);
      if (part.removed) {
        state.diffMarkers.main.push(addFullLineMarker(mainEditor, leftRow, rows, 'diff-removed-line'));
        state.diffLocations.push({ editor: mainEditor, row: leftRow });
        leftRow += rows;
      } else if (part.added) {
        state.diffMarkers.compare.push(addFullLineMarker(compareEditor, rightRow, rows, 'diff-added-line'));
        state.diffLocations.push({ editor: compareEditor, row: rightRow });
        rightRow += rows;
      } else {
        leftRow += rows;
        rightRow += rows;
      }
    });
    elements.diffCounter.textContent = state.diffLocations.length
      ? `${state.diffLocations.length} 处差异`
      : '无差异';
  }

  function navigateDiff(direction) {
    if (!state.diffLocations.length) return;
    state.activeDiffIndex = (state.activeDiffIndex + direction + state.diffLocations.length) % state.diffLocations.length;
    const location = state.diffLocations[state.activeDiffIndex];
    location.editor.scrollToLine(location.row + 1, true, true, () => {});
    location.editor.gotoLine(location.row + 1, 0, true);
    elements.diffCounter.textContent = `${state.activeDiffIndex + 1} / ${state.diffLocations.length}`;
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function countWholeWordMatches(text, word) {
    if (!word || /\s/.test(word) || word.length > 120) return 0;
    const expression = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(word)}(?=$|[^\\p{L}\\p{N}_])`, 'gu');
    return Array.from(text.matchAll(expression)).length;
  }

  function markWordInEditor(editor, word, markerIds) {
    clearMarkers(editor, markerIds);
    if (!word || /\s/.test(word) || word.length > 120) return;
    const lines = editor.session.getDocument().getAllLines();
    lines.forEach((line, row) => {
      let offset = 0;
      while (offset <= line.length - word.length) {
        const index = line.indexOf(word, offset);
        if (index < 0) break;
        const before = index === 0 ? '' : line[index - 1];
        const after = index + word.length >= line.length ? '' : line[index + word.length];
        const boundary = !/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after);
        if (boundary) {
          markerIds.push(editor.session.addMarker(
            new Range(row, index, row, index + word.length),
            'sync-word-marker',
            'text'
          ));
        }
        offset = index + Math.max(1, word.length);
      }
    });
  }

  function syncSelectedWord() {
    const word = mainEditor.getSelectedText();
    const count = countWholeWordMatches(mainEditor.getValue(), word);
    elements.matchStatus.textContent = count ? `${count} 个整词匹配` : '未选择词语';
    if (!elements.comparePane.hidden) {
      markWordInEditor(mainEditor, word, state.syncMarkers.main);
      markWordInEditor(compareEditor, word, state.syncMarkers.compare);
    }
  }

  function updateCursorStatus() {
    const position = mainEditor.getCursorPosition();
    const selection = mainEditor.getSelectedText();
    elements.cursorStatus.textContent = `行 ${position.row + 1}，列 ${position.column + 1}`;
    elements.selectionStatus.textContent = `${selection.length} 字符`;
    if (!selection) elements.matchStatus.textContent = '未选择词语';
  }

  function openModal(element) {
    element.hidden = false;
  }

  function closeModal(element) {
    element.hidden = true;
  }

  async function reopenWithEncoding() {
    if (!confirmDiscardChanges()) return;
    const encoding = elements.encodingSelect.value;
    try {
      if (window.electronAPI && state.fileToken && typeof window.electronAPI.reopenTextFile === 'function') {
        const result = await window.electronAPI.reopenTextFile(state.fileToken, encoding);
        setEditorContent(result.text, {
          fileToken: state.fileToken,
          fileName: state.fileName,
          displayPath: state.displayPath,
          encoding,
          encodingConfidence: '手动指定',
          lineEnding: result.lineEnding,
          expectedMtimeMs: result.mtimeMs
        });
      } else if (state.browserBytes) {
        const text = decodeBrowserBytes(state.browserBytes, encoding);
        setEditorContent(text, {
          fileName: state.fileName,
          displayPath: state.displayPath,
          encoding,
          encodingConfidence: '手动指定',
          lineEnding: EditorCore.detectLineEnding(text),
          browserBytes: state.browserBytes
        });
      } else {
        throw new Error('当前文档没有可重新读取的源文件');
      }
      closeModal(elements.encodingModal);
      showToast(`已按 ${encoding} 重新读取，磁盘文件未修改`);
    } catch (error) {
      handleError('重新读取失败', error);
    }
  }

  function setSaveEncoding() {
    state.encoding = elements.encodingSelect.value;
    state.encodingConfidence = '保存目标';
    updateDocumentIdentity();
    closeModal(elements.encodingModal);
    showToast(`下次保存将转换为 ${state.encoding}`);
  }

  function buildClipContext() {
    const fullText = mainEditor.getValue();
    const range = mainEditor.getSelectionRange();
    const selectedText = state.clipId ? '' : mainEditor.session.getTextRange(range);
    if (!selectedText) {
      return { content: fullText, selectedText: null, contextBefore: null, contextAfter: null, selection: false };
    }
    const documentNode = mainEditor.session.getDocument();
    const start = documentNode.positionToIndex(range.start, 0);
    const end = documentNode.positionToIndex(range.end, 0);
    return {
      content: selectedText,
      selectedText,
      contextBefore: fullText.slice(Math.max(0, start - 500), start),
      contextAfter: fullText.slice(end, Math.min(fullText.length, end + 500)),
      selection: true
    };
  }

  async function openClipModal() {
    const context = buildClipContext();
    elements.clipModalTitle.textContent = state.clipId ? `更新剪藏 #${state.clipId}` : '存入剪藏';
    elements.clipScopeDescription.textContent = state.clipId
      ? '将当前全文更新回原剪藏，AI 分析与附件不会被覆盖。'
      : (context.selection ? `保存当前选区，共 ${context.content.length} 字符。` : `保存当前全文，共 ${context.content.length} 字符。`);
    elements.clipTitleInput.value = state.clipMetadata?.title
      || state.fileName.replace(/\.[^.]+$/, '')
      || '编辑器内容';
    elements.clipModeSelect.value = state.clipType || 'store-only';
    elements.clipModeSelect.disabled = Boolean(state.clipId);
    elements.clipTagsInput.value = (state.clipMetadata?.tags || []).join(', ');
    elements.clipThoughtsInput.value = state.clipMetadata?.myThoughts || '';
    elements.submitClipBtn.textContent = state.clipId ? '更新剪藏' : '保存到剪藏';
    await loadCategories();
    elements.clipCategorySelect.value = state.clipMetadata?.category || '';
    openModal(elements.clipModal);
  }

  async function loadCategories() {
    if (state.categoriesLoaded) return;
    try {
      const response = await fetch(`${API_BASE_URL}/categories`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const categories = await response.json();
      const options = [];
      categories.forEach(category => {
        if (category.value) options.push({ value: category.value, label: category.label || category.value });
        (category.children || []).forEach(child => {
          options.push({ value: child.value, label: `${category.label || category.value} / ${child.label || child.value}` });
        });
      });
      options.forEach(option => {
        const node = document.createElement('option');
        node.value = option.value;
        node.textContent = option.label;
        elements.clipCategorySelect.appendChild(node);
      });
      state.categoriesLoaded = true;
    } catch (error) {
      FrontendLogger.warn('[Editor] Failed to load categories', error);
    }
  }

  async function submitClip() {
    const context = buildClipContext();
    if (!context.content.trim()) {
      showToast('没有可保存的内容', true);
      return;
    }
    const type = state.clipId ? state.clipType : elements.clipModeSelect.value;
    const tags = elements.clipTagsInput.value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean).slice(0, 10);
    const payload = {
      content: context.content,
      title: elements.clipTitleInput.value.trim() || state.fileName,
      type,
      source: 'editor',
      category: elements.clipCategorySelect.value || null,
      tags,
      useAiTags: type === 'ai-text' && tags.length === 0,
      workflowStatus: type === 'store-only' ? 'inbox' : 'organized',
      captureMethod: context.selection ? 'editor-selection' : 'editor-document',
      selectedText: context.selectedText,
      contextBefore: context.contextBefore,
      contextAfter: context.contextAfter,
      myThoughts: elements.clipThoughtsInput.value.trim() || null,
      contentFormat: elements.languageSelect.value,
      sourceFileName: elements.includeFileNameCheck.checked ? state.fileName : null,
      sourceEncoding: state.encoding,
      sourceLineEnding: state.lineEnding
    };
    elements.submitClipBtn.disabled = true;
    try {
      const endpoint = state.clipId ? `${API_BASE_URL}/${state.clipId}/editor-content` : `${API_BASE_URL}/add`;
      const response = await fetch(endpoint, {
        method: state.clipId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(await response.text() || `HTTP ${response.status}`);
      const result = await response.json();
      state.clipId = result.id || state.clipId;
      state.clipType = type;
      state.clipMetadata = {
        title: payload.title,
        category: payload.category,
        tags: payload.tags,
        myThoughts: payload.myThoughts
      };
      updateDocumentIdentity();
      closeModal(elements.clipModal);
      showToast(state.clipId ? `剪藏 #${state.clipId} 已保存` : '剪藏已保存');
      window.parent.postMessage({ type: 'editorClipSaved', clipId: state.clipId }, '*');
      FrontendLogger.info('[Editor] Clip saved', state.clipId, context.content.length);
    } catch (error) {
      handleError('保存剪藏失败', error);
    } finally {
      elements.submitClipBtn.disabled = false;
    }
  }

  async function loadClip(clipId) {
    if (!clipId || (!confirmDiscardChanges() && String(clipId) !== String(state.clipId))) return;
    try {
      const response = await fetch(`${API_BASE_URL}/${clipId}`);
      if (!response.ok) throw new Error(response.status === 404 ? '剪藏不存在' : `HTTP ${response.status}`);
      const clip = await response.json();
      state.clipId = clip.id;
      state.clipType = clip.type || 'store-only';
      state.clipMetadata = {
        title: clip.title,
        category: clip.category,
        tags: clip.tags || [],
        myThoughts: clip.myThoughts
      };
      const format = clip.contentFormat || EditorCore.detectLanguage(clip.sourceFileName || clip.title, clip.content);
      setEditorContent(clip.content || '', {
        fileName: clip.sourceFileName || `${clip.title || `clip-${clip.id}`}.${format === 'text' ? 'txt' : format}`,
        displayPath: `剪藏 #${clip.id}`,
        encoding: clip.sourceEncoding || 'UTF-8',
        encodingConfidence: '剪藏元数据',
        lineEnding: clip.sourceLineEnding || EditorCore.detectLineEnding(clip.content || ''),
        language: format
      });
      state.clipId = clip.id;
      state.clipType = clip.type || 'store-only';
      updateDocumentIdentity();
      showToast(`已打开剪藏 #${clip.id}`);
    } catch (error) {
      handleError('打开剪藏失败', error);
    }
  }

  function showToast(message, error) {
    clearTimeout(showToast.timer);
    elements.toast.textContent = message;
    elements.toast.classList.toggle('error', Boolean(error));
    elements.toast.classList.add('show');
    showToast.timer = setTimeout(() => elements.toast.classList.remove('show'), 3200);
  }

  function handleError(prefix, error) {
    const message = error && error.message ? error.message : String(error);
    showToast(`${prefix}：${message}`, true);
    FrontendLogger.error(`[Editor] ${prefix}`, error);
  }

  mainEditor.session.on('change', () => {
    if (!state.suppressChange) setModified(true);
    if (!elements.comparePane.hidden) {
      clearTimeout(state.diffTimer);
      state.diffTimer = setTimeout(updateDiff, 180);
    }
  });
  mainEditor.selection.on('changeCursor', updateCursorStatus);
  mainEditor.selection.on('changeSelection', updateCursorStatus);
  mainEditor.container.addEventListener('dblclick', () => setTimeout(syncSelectedWord, 0));
  compareEditor.container.addEventListener('dblclick', () => {
    const word = compareEditor.getSelectedText();
    markWordInEditor(mainEditor, word, state.syncMarkers.main);
    markWordInEditor(compareEditor, word, state.syncMarkers.compare);
  });

  document.getElementById('newFileBtn').addEventListener('click', () => {
    if (confirmDiscardChanges()) resetDocument();
  });
  document.getElementById('openFileBtn').addEventListener('click', openMainFile);
  document.getElementById('saveFileBtn').addEventListener('click', () => saveFile(false));
  document.getElementById('saveAsBtn').addEventListener('click', () => saveFile(true));
  document.getElementById('formatBtn').addEventListener('click', formatCurrentContent);
  document.getElementById('transformBtn').addEventListener('click', openTransformPanel);
  document.getElementById('closeTransformBtn').addEventListener('click', closeTransformPanel);
  document.getElementById('applyTransformBtn').addEventListener('click', applyTransform);
  document.getElementById('copyTransformBtn').addEventListener('click', async () => {
    await navigator.clipboard.writeText(elements.transformPreview.value);
    showToast('转换结果已复制');
  });
  elements.transformOperation.addEventListener('change', updateTransformPreview);
  elements.languageSelect.addEventListener('change', () => setLanguage(elements.languageSelect.value));
  elements.lineEndingSelect.addEventListener('change', () => {
    state.lineEnding = elements.lineEndingSelect.value;
    setModified(true);
  });
  document.getElementById('compareBtn').addEventListener('click', () => toggleCompare());
  document.getElementById('closeCompareBtn').addEventListener('click', () => toggleCompare(false));
  document.getElementById('compareClipboardBtn').addEventListener('click', loadCompareFromClipboard);
  document.getElementById('compareFileBtn').addEventListener('click', loadCompareFromFile);
  document.getElementById('previousDiffBtn').addEventListener('click', () => navigateDiff(-1));
  document.getElementById('nextDiffBtn').addEventListener('click', () => navigateDiff(1));
  document.getElementById('encodingBtn').addEventListener('click', () => {
    elements.encodingSelect.value = state.encoding;
    openModal(elements.encodingModal);
  });
  document.getElementById('reopenEncodingBtn').addEventListener('click', reopenWithEncoding);
  document.getElementById('setSaveEncodingBtn').addEventListener('click', setSaveEncoding);
  document.getElementById('clipBtn').addEventListener('click', openClipModal);
  elements.submitClipBtn.addEventListener('click', submitClip);
  elements.browserFileInput.addEventListener('change', async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (file) await handleBrowserFile(file);
  });

  document.querySelectorAll('[data-close-modal]').forEach(button => {
    button.addEventListener('click', () => closeModal(document.getElementById(button.dataset.closeModal)));
  });

  document.addEventListener('keydown', event => {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      if (confirmDiscardChanges()) resetDocument();
    } else if (modifier && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      openMainFile();
    } else if (modifier && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveFile(event.shiftKey);
    } else if (event.shiftKey && event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      formatCurrentContent();
    }
  });

  window.addEventListener('beforeunload', event => {
    if (!state.modified) return;
    event.preventDefault();
    event.returnValue = '';
  });

  window.addEventListener('message', event => {
    const data = event.data || {};
    if (data.action === 'themeChange' || data.type === 'themeChanged' || data.type === 'appearanceChanged') {
      applyTheme();
    } else if (data.action === 'editorPing') {
      window.parent.postMessage({ type: 'editorReady' }, '*');
    } else if (data.action === 'openClipInEditor' || data.type === 'openClipInEditor') {
      loadClip(data.clipId);
    } else if (data.action === 'refresh') {
      if (state.clipId) loadClip(state.clipId);
    } else if (data.action === 'focusEditor') {
      mainEditor.focus();
    }
  });

  window.addEventListener('storage', event => {
    if (event.key === THEME_STORAGE_KEY || event.key === APPEARANCE_KEY) applyTheme();
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  elements.runtimeStatus.textContent = window.electronAPI ? '桌面模式' : '浏览器模式';
  elements.encodingNote.textContent = window.electronAPI
    ? '重新读取不会修改磁盘；设置保存编码后，保存时才执行转换。'
    : '浏览器模式可重新解码已选择文件，但保存统一下载为 UTF-8。';
  applyTheme();
  resetDocument();
  updateCursorStatus();
  window.parent.postMessage({ type: 'editorReady' }, '*');
})();
