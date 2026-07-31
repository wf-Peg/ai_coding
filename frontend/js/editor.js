(function initializeLightEditor() {
  'use strict';

  const API_BASE_URL = 'http://127.0.0.1:8080/api/clip';
  const MAX_TRANSFORM_LENGTH = 5 * 1024 * 1024;
  const LANGUAGE_EXTENSIONS = { json: 'json', xml: 'xml', sql: 'sql', text: 'txt' };
  const THEME_STORAGE_KEY = 'app_theme_v1';
  const APPEARANCE_KEY = 'app_appearance_v1';
  const Range = ace.require('ace/range').Range;

  /**
   * 工厂函数：生成默认标签状态快照
   */
  function createTabState() {
    return {
      id: `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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
      clipMetadata: null,
      content: '',
      language: 'text',
      scrollTop: 0,
      scrollLeft: 0,
      cursorRow: 0,
      cursorColumn: 0
    };
  }

  // 多标签状态
  const tabs = [];
  let activeTabIndex = 0;
  let state = null;

  // 跨标签共享状态（对比、转换等）
  const sharedState = {
    compareToken: null,
    diffMarkers: { main: [], compare: [] },
    syncMarkers: { main: [], compare: [] },
    diffLocations: [],
    activeDiffIndex: -1,
    transformTarget: null,
    categoriesLoaded: false,
    diffTimer: null,
    discardResolver: null
  };

  const elements = Object.fromEntries([
    'tabBar', 'tabNewBtn',
    'documentName', 'documentPath', 'modifiedDot', 'clipSourceBadge', 'languageSelect',
    'encodingLabel', 'encodingConfidence', 'lineEndingSelect', 'cursorStatus',
    'selectionStatus', 'matchStatus', 'runtimeStatus', 'compareToolbar', 'comparePane',
    'editorWorkspace', 'compareFileName', 'diffCounter', 'transformPanel',
    'transformOperation', 'transformPreview', 'encodingModal', 'encodingSelect',
    'encodingNote', 'clipModal', 'clipModalTitle', 'clipScopeDescription', 'discardModal',
    'clipTitleInput', 'clipModeSelect', 'clipCategorySelect', 'clipTagsInput',
    'clipThoughtsInput', 'includeFileNameCheck', 'submitClipBtn', 'browserFileInput', 'toast'
  ].map(id => [id, document.getElementById(id)]));

  /**
   * 获取 Electron API（兼容 iframe 模式）。
   * editor.html 在 index.html 的 iframe 中加载，preload 脚本只注入顶层窗口，
   * 因此需要从 window.parent 获取 electronAPI。
   */
  function getElectronAPI() {
    return window.electronAPI || (window.parent && window.parent.electronAPI);
  }

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
      selectionStyle: 'line',
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

  /**
   * 保存当前活跃标签的快照（内容、光标、滚动位置）
   */
  function saveActiveTabSnapshot() {
    if (!state) return;
    state.content = mainEditor.getValue();
    const cursor = mainEditor.getCursorPosition();
    state.cursorRow = cursor.row;
    state.cursorColumn = cursor.column;
    state.scrollTop = mainEditor.session.getScrollTop();
    state.scrollLeft = mainEditor.session.getScrollLeft();
    state.language = elements.languageSelect.value;
    state.lineEnding = elements.lineEndingSelect.value;
  }

  /**
   * 切换到指定索引的标签
   */
  function switchToTab(index) {
    if (index === activeTabIndex || index < 0 || index >= tabs.length) return;
    saveActiveTabSnapshot();
    activeTabIndex = index;
    state = tabs[activeTabIndex];

    // 恢复标签内容
    state.suppressChange = true;
    mainEditor.setValue(state.content || '', -1);
    state.suppressChange = false;

    // 恢复光标和滚动位置
    mainEditor.gotoLine(state.cursorRow + 1, state.cursorColumn, false);
    mainEditor.session.setScrollTop(state.scrollTop);
    mainEditor.session.setScrollLeft(state.scrollLeft);

    // 恢复语言模式
    setLanguage(state.language);

    // 更新 UI
    updateDocumentIdentity();
    updateCursorStatus();
    renderTabBar();

    // 切换标签时退出对比模式
    if (!elements.comparePane.hidden) {
      toggleCompare(false);
    }

    mainEditor.focus();
  }

  /**
   * 新建标签
   */
  function createNewTab() {
    saveActiveTabSnapshot();
    const newTab = createTabState();
    tabs.push(newTab);
    activeTabIndex = tabs.length - 1;
    state = tabs[activeTabIndex];
    setEditorContent('', { fileName: '未命名.txt', encoding: 'UTF-8', lineEnding: 'LF' });
    renderTabBar();
    mainEditor.focus();
  }

  /**
   * 关闭指定索引的标签
   */
  async function closeTab(index) {
    if (tabs.length <= 1) return;

    const tab = tabs[index];
    if (tab.modified) {
      // 先切换到该标签以便用户看到内容
      if (index !== activeTabIndex) {
        switchToTab(index);
      }
      const confirmed = await confirmDiscardChanges();
      if (!confirmed) return;
    }

    // 移除标签
    tabs.splice(index, 1);

    // 调整活跃索引
    if (index < activeTabIndex || activeTabIndex >= tabs.length) {
      activeTabIndex = Math.min(activeTabIndex, tabs.length - 1);
    }

    state = tabs[activeTabIndex];

    // 恢复新的活跃标签
    state.suppressChange = true;
    mainEditor.setValue(state.content || '', -1);
    state.suppressChange = false;
    mainEditor.gotoLine(state.cursorRow + 1, state.cursorColumn, false);
    mainEditor.session.setScrollTop(state.scrollTop);
    setLanguage(state.language);
    updateDocumentIdentity();
    renderTabBar();
    mainEditor.focus();
  }

  /**
   * 渲染标签栏 DOM
   */
  function renderTabBar() {
    const tabBar = elements.tabBar;
    // 移除旧标签项和 spacer
    tabBar.querySelectorAll('.tab-item, .tab-bar-spacer').forEach(el => el.remove());

    tabs.forEach((tab, index) => {
      const tabEl = document.createElement('div');
      tabEl.className = 'tab-item' + (index === activeTabIndex ? ' active' : '');
      tabEl.title = tab.displayPath || tab.fileName;

      const dot = document.createElement('span');
      dot.className = 'tab-dot' + (tab.modified ? ' active' : '');

      const label = document.createElement('span');
      label.className = 'tab-label';
      label.textContent = tab.fileName;

      const closeBtn = document.createElement('button');
      closeBtn.className = 'tab-close-btn';
      closeBtn.innerHTML = '&times;';
      closeBtn.title = '关闭标签 (Ctrl+W)';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(index);
      });

      tabEl.appendChild(dot);
      tabEl.appendChild(label);
      tabEl.appendChild(closeBtn);
      tabEl.addEventListener('click', () => switchToTab(index));

      tabBar.insertBefore(tabEl, elements.tabNewBtn);
    });

    // 添加双击空白区域新建标签的 spacer
    const spacer = document.createElement('div');
    spacer.className = 'tab-bar-spacer';
    spacer.addEventListener('dblclick', createNewTab);
    tabBar.insertBefore(spacer, elements.tabNewBtn);
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
    // 增量更新当前标签的修改圆点，避免重建整个标签栏
    const tabItems = elements.tabBar.querySelectorAll('.tab-item');
    const currentTab = tabItems[activeTabIndex];
    if (currentTab) {
      const dot = currentTab.querySelector('.tab-dot');
      if (dot) dot.classList.toggle('active', modified);
    }
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

  function getEditorExtension() {
    return LANGUAGE_EXTENSIONS[elements.languageSelect.value] || 'txt';
  }

  function getSuggestedFileName() {
    const extension = getEditorExtension();
    const baseName = (state.fileName || 'untitled').replace(/\.(json|xml|sql|txt|md|csv|log|yaml|yml|ini|conf)$/i, '') || 'untitled';
    return `${baseName}.${extension}`;
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
    if (!state.modified) return Promise.resolve(true);
    openModal(elements.discardModal);
    return new Promise(resolve => {
      sharedState.discardResolver = resolve;
    });
  }

  function settleDiscardDecision(shouldDiscard) {
    closeModal(elements.discardModal);
    if (!sharedState.discardResolver) return;
    const resolve = sharedState.discardResolver;
    sharedState.discardResolver = null;
    resolve(shouldDiscard);
  }

  async function openMainFile() {
    if (!(await confirmDiscardChanges())) return;
    if (getElectronAPI() && typeof getElectronAPI().openTextFile === 'function') {
      try {
        const result = await getElectronAPI().openTextFile();
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
        renderTabBar();
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
    renderTabBar();
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
    const suggestedName = getSuggestedFileName();
    const currentExtension = (state.fileName.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
    const needsTypeConversion = currentExtension !== getEditorExtension();
    if (getElectronAPI() && typeof getElectronAPI().saveTextFile === 'function') {
      try {
        const payload = {
          fileToken: state.fileToken,
          text,
          encoding: state.encoding,
          lineEnding: state.lineEnding,
          expectedMtimeMs: state.expectedMtimeMs,
          suggestedName,
          language: elements.languageSelect.value
        };
        const result = saveAs || !state.fileToken || needsTypeConversion
          ? await getElectronAPI().saveTextFileAs(payload)
          : await getElectronAPI().saveTextFile(payload);
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
        renderTabBar();
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
    anchor.download = suggestedName;
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
    sharedState.transformTarget = getTargetRangeAndText();
    elements.transformPanel.classList.add('open');
    elements.transformPanel.setAttribute('aria-hidden', 'false');
    updateTransformPreview();
  }

  function closeTransformPanel() {
    elements.transformPanel.classList.remove('open');
    elements.transformPanel.setAttribute('aria-hidden', 'true');
  }

  function updateTransformPreview() {
    if (!sharedState.transformTarget) sharedState.transformTarget = getTargetRangeAndText();

    const operation = elements.transformOperation.value;

    // 文件 MD5 校验：异步处理
    if (operation === 'md5-file') {
      handleFileMd5Preview();
      return;
    }

    if (sharedState.transformTarget.text.length > MAX_TRANSFORM_LENGTH) {
      elements.transformPreview.value = '内容超过 5 MB，无法转换。';
      return;
    }
    try {
      elements.transformPreview.value = EditorCore.transform(
        sharedState.transformTarget.text,
        operation
      );
    } catch (error) {
      elements.transformPreview.value = `转换失败：${error.message}`;
    }
  }

  async function handleFileMd5Preview() {
    const api = getElectronAPI();
    if (!api || typeof api.getFileMd5 !== 'function') {
      elements.transformPreview.value = '文件 MD5 校验仅桌面模式可用。';
      return;
    }
    if (!state.fileToken) {
      elements.transformPreview.value = '请先保存文件后再进行文件 MD5 校验。';
      return;
    }

    // 计算内容 MD5（编辑器当前文本）
    const contentMd5 = EditorCore.transform(sharedState.transformTarget.text, 'md5-encode');

    // 从磁盘读取文件 MD5
    const result = await api.getFileMd5(state.fileToken);
    if (result.error) {
      elements.transformPreview.value = `文件 MD5 校验失败：${result.error}`;
      return;
    }

    elements.transformPreview.value = [
      `┌─ 文件信息 ─────────────────`,
      `│ 文件名：${result.fileName}`,
      `│ 文件大小：${(result.size / 1024).toFixed(1)} KB`,
      `│ 文件 MD5：${result.hash}`,
      `├─ 内容对比 ─────────────────`,
      `│ 内容 MD5：${contentMd5.trim()}`,
      `│ 结论：${result.hash === contentMd5.trim() ? '✓ 文件与内容 MD5 一致' : '✗ 文件与内容 MD5 不一致（编码/换行符差异）'}`,
      `└────────────────────────────`
    ].join('\n');
  }

  function applyTransform() {
    const operation = elements.transformOperation.value;
    if (operation === 'md5-file') {
      showToast('文件 MD5 校验结果为只读信息，不可替换原文');
      return;
    }
    if (!sharedState.transformTarget || elements.transformPreview.value.startsWith('转换失败：')) return;
    mainEditor.session.replace(sharedState.transformTarget.range, elements.transformPreview.value);
    closeTransformPanel();
    showToast('转换结果已替换原文');
  }

  async function toggleCompare(forceOpen) {
    const shouldOpen = forceOpen !== undefined ? forceOpen : elements.comparePane.hidden;
    elements.comparePane.hidden = !shouldOpen;
    elements.compareToolbar.classList.toggle('is-open', shouldOpen);
    elements.compareToolbar.setAttribute('aria-hidden', String(!shouldOpen));
    elements.editorWorkspace.classList.toggle('comparing', shouldOpen);
    if (shouldOpen && !compareEditor.getValue()) {
      compareEditor.setValue(mainEditor.getValue(), -1);
      elements.compareFileName.textContent = '当前文档快照';
    }
    if (!shouldOpen) {
      clearMarkers(mainEditor, sharedState.diffMarkers.main);
      clearMarkers(compareEditor, sharedState.diffMarkers.compare);
      sharedState.diffLocations = [];
      sharedState.activeDiffIndex = -1;
      elements.diffCounter.textContent = '无差异';
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
      if (getElectronAPI() && typeof getElectronAPI().readClipboard === 'function') {
        text = await getElectronAPI().readClipboard();
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
    if (getElectronAPI() && typeof getElectronAPI().openTextFile === 'function') {
      try {
        const result = await getElectronAPI().openTextFile();
        if (!result || result.canceled) return;
        sharedState.compareToken = result.fileToken;
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
    clearMarkers(mainEditor, sharedState.diffMarkers.main);
    clearMarkers(compareEditor, sharedState.diffMarkers.compare);
    sharedState.diffLocations = [];
    sharedState.activeDiffIndex = -1;

    if (!window.Diff || typeof window.Diff.diffLines !== 'function') {
      elements.diffCounter.textContent = '差异组件未加载';
      return;
    }
    const parts = window.Diff.diffLines(mainEditor.getValue(), compareEditor.getValue());
    let leftRow = 0;
    let rightRow = 0;
    // 标记上一部分是否为 removed（用于合并 removed+added 为 1 处差异）
    let prevWasRemoved = false;

    parts.forEach(part => {
      const rows = countRows(part.value);
      if (part.removed && !part.added) {
        // 纯删除：记录差异位置
        sharedState.diffMarkers.main.push(addFullLineMarker(mainEditor, leftRow, rows, 'diff-removed-line'));
        sharedState.diffLocations.push({ editor: mainEditor, row: leftRow });
        leftRow += rows;
        prevWasRemoved = true;
      } else if (part.added && !part.removed) {
        // 纯新增
        if (prevWasRemoved) {
          // 上一部分是 removed，合并为同一次替换，不新增 diffLocations
          prevWasRemoved = false;
        } else {
          sharedState.diffLocations.push({ editor: compareEditor, row: rightRow });
        }
        sharedState.diffMarkers.compare.push(addFullLineMarker(compareEditor, rightRow, rows, 'diff-added-line'));
        rightRow += rows;
      } else {
        // 无变化行
        leftRow += rows;
        rightRow += rows;
        prevWasRemoved = false;
      }
    });
    elements.diffCounter.textContent = sharedState.diffLocations.length
      ? `${sharedState.diffLocations.length} 处差异`
      : '无差异';
  }

  function navigateDiff(direction) {
    if (!sharedState.diffLocations.length) return;
    sharedState.activeDiffIndex = (sharedState.activeDiffIndex + direction + sharedState.diffLocations.length) % sharedState.diffLocations.length;
    const location = sharedState.diffLocations[sharedState.activeDiffIndex];
    location.editor.scrollToLine(location.row + 1, true, true, () => {});
    location.editor.gotoLine(location.row + 1, 0, true);
    elements.diffCounter.textContent = `${sharedState.activeDiffIndex + 1} / ${sharedState.diffLocations.length}`;
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
      markWordInEditor(mainEditor, word, sharedState.syncMarkers.main);
      markWordInEditor(compareEditor, word, sharedState.syncMarkers.compare);
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
    element.classList.add('is-visible');
  }

  function closeModal(element) {
    element.classList.remove('is-visible');
  }

  async function reopenWithEncoding() {
    if (!(await confirmDiscardChanges())) return;
    const encoding = elements.encodingSelect.value;
    try {
      if (getElectronAPI() && state.fileToken && typeof getElectronAPI().reopenTextFile === 'function') {
        const result = await getElectronAPI().reopenTextFile(state.fileToken, encoding);
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
    if (sharedState.categoriesLoaded) return;
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
      sharedState.categoriesLoaded = true;
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
    if (!clipId) return;
    if (String(clipId) !== String(state.clipId) && !(await confirmDiscardChanges())) return;
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
      renderTabBar();
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
      clearTimeout(sharedState.diffTimer);
      sharedState.diffTimer = setTimeout(updateDiff, 180);
    }
  });
  mainEditor.selection.on('changeCursor', updateCursorStatus);
  mainEditor.selection.on('changeSelection', updateCursorStatus);
  mainEditor.container.addEventListener('dblclick', () => setTimeout(syncSelectedWord, 0));
  compareEditor.container.addEventListener('dblclick', () => {
    const word = compareEditor.getSelectedText();
    markWordInEditor(mainEditor, word, sharedState.syncMarkers.main);
    markWordInEditor(compareEditor, word, sharedState.syncMarkers.compare);
  });

  document.getElementById('newFileBtn').addEventListener('click', createNewTab);
  document.getElementById('openFileBtn').addEventListener('click', openMainFile);
  document.getElementById('saveFileBtn').addEventListener('click', () => saveFile(false));
  document.getElementById('saveAsBtn').addEventListener('click', () => saveFile(true));
  elements.tabNewBtn.addEventListener('click', createNewTab);
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

  document.getElementById('cancelDiscardBtn').addEventListener('click', () => settleDiscardDecision(false));
  document.getElementById('cancelDiscardActionBtn').addEventListener('click', () => settleDiscardDecision(false));
  document.getElementById('confirmDiscardBtn').addEventListener('click', () => settleDiscardDecision(true));

  document.addEventListener('keydown', event => {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      createNewTab();
    } else if (modifier && event.key.toLowerCase() === 't') {
      event.preventDefault();
      createNewTab();
    } else if (modifier && event.key.toLowerCase() === 'w') {
      event.preventDefault();
      closeTab(activeTabIndex);
    } else if (modifier && event.key === 'Tab') {
      event.preventDefault();
      const next = event.shiftKey
        ? (activeTabIndex - 1 + tabs.length) % tabs.length
        : (activeTabIndex + 1) % tabs.length;
      switchToTab(next);
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
    if (tabs.some(tab => tab.modified)) {
      event.preventDefault();
      event.returnValue = '';
    }
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

  elements.runtimeStatus.textContent = getElectronAPI() ? '桌面模式' : '浏览器模式';
  elements.encodingNote.textContent = getElectronAPI()
    ? '重新读取不会修改磁盘；设置保存编码后，保存时才执行转换。'
    : '浏览器模式可重新解码已选择文件，但保存统一下载为 UTF-8。';
  applyTheme();

  // 初始化默认标签
  tabs.push(createTabState());
  state = tabs[0];
  resetDocument();
  renderTabBar();

  updateCursorStatus();
  window.parent.postMessage({ type: 'editorReady' }, '*');
})();
