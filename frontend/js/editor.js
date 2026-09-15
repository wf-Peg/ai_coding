(function initializeLightEditor() {
  'use strict';

  const API_BASE_URL = 'http://127.0.0.1:8081/api/clip';
  window.API_BASE_URL = API_BASE_URL; // 暴露给 media-uploader.js（const 不挂 window）
  const AI_CHAT_API_URL = API_BASE_URL.replace(/\/api\/clip$/, '/api/ai/chat/stream');
  const MAX_TRANSFORM_LENGTH = 5 * 1024 * 1024;
  const LANGUAGE_EXTENSIONS = { json: 'json', xml: 'xml', sql: 'sql', text: 'txt', markdown: 'md',
    javascript: 'js', python: 'py', yaml: 'yml', css: 'css', html: 'html' };
  const THEME_STORAGE_KEY = 'app_theme_v1';
  const APPEARANCE_KEY = 'app_appearance_v1';
  const Range = ace.require('ace/range').Range;

  // 验证离线词典加载状态
  if (typeof window.DICT !== 'undefined') {
    var dictKeys = Object.keys(window.DICT);
    if (dictKeys.length > 0) {
      console.log('[editor] 离线词典已加载，共 ' + dictKeys.length + ' 个词条');
    }
  } else {
    console.warn('[editor] 离线词典未加载，请确认 dict-offline.js 已正确引入');
  }

  /**
   * 工厂函数：生成默认标签状态快照
   */
  function createTabState() {
    return {
      id: `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fileToken: null,
      fileName: '未命名.md',
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
      language: 'markdown',
      scrollTop: 0,
      scrollLeft: 0,
      cursorRow: 0,
      cursorColumn: 0,
      aiChat: window.EditorAiChatCore.createState()
    };
  }

  // 多标签状态
  const tabs = [];
  let activeTabIndex = 0;
  let state = null;
  let activeAiRequest = null;
  let petIdleTimer = null;
  let petBubbleTimer = null;
  let petQuickMenuOpen = false;
  const AI_CHAT_WIDTH_KEY = 'editor_ai_chat_width_v1';

  // 跨标签共享状态（对比、转换等）
  const sharedState = {
    compareToken: null,
    // 对比内容来源：'snapshot'（当前文档自动快照）| 'clipboard' | 'file' | null（未初始化）
    compareSource: null,
    diffMarkers: { main: [], compare: [] },
    diffWordMarkers: { main: [], compare: [] },
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
    'selectionStatus', 'multiCursorStatus', 'matchStatus', 'runtimeStatus', 'compareToolbar', 'comparePane',
    'editorWorkspace', 'compareFileName', 'diffCounter', 'markdownPane', 'markdownBody', 'mdFullscreenBtn', 'mdFollowBtn', 'closeMarkdownBtn', 'markdownBtn', 'compareBtn', 'transformPanel',
    'breadcrumbBar',
    'transformOperation', 'transformPreview', 'encodingModal', 'encodingSelect',
    'encodingNote', 'clipModal', 'clipModalTitle', 'clipScopeDescription', 'discardModal',
    'clipTitleInput', 'clipModeSelect', 'clipCategorySelect', 'clipTagsInput',
    'clipThoughtsInput', 'includeFileNameCheck', 'submitClipBtn', 'browserFileInput', 'toast',
    'clipCaretBtn', 'clipMenu', 'smartClipMenuItem', 'detailClipMenuItem',
    'smartClipConfirmModal', 'smartClipMethodHint', 'smartClipPreview', 'smartClipAsyncHint', 'smartClipSaveBtn',
    'smartClipFallbackModal', 'smartClipFallbackSaveBtn',
    'statusLang', 'statusTabSize', 'docStats', 'zoomStatus', 'settingsModal', 'fontSizeSlider', 'fontSizeLabel', 'tabSizeSelect',
    'fullscreenBtn', 'fileTreePane', 'fileTreeTitle', 'fileTreeBody', 'closeFileTreeBtn', 'selectDirBtn',
    'autosaveStatus', 'historyCount', 'historyList', 'closeHistoryBtn',
    'undoHistoryBtn', 'redoHistoryBtn', 'clearHistoryBtn', 'mainPane', 'historyPane', 'recentPane',
    'recentList', 'closeRecentBtn', 'clearRecentBtn', 'favPane', 'favList', 'closeFavBtn', 'clearFavBtn',
    'backlinksPane', 'backlinksList', 'backlinksTarget', 'backlinksCount', 'backlinksPaneTitle', 'saveToVaultBtn', 'closeBacklinksBtn', 'tabBacklinks', 'tabOutgoing', 'tabBacklinksCount', 'tabOutgoingCount', 'outgoingList', 'outlinePane', 'outlineList', 'outlineSearchInput', 'closeOutlineBtn', 'tagsPane', 'tagsList', 'closeTagsBtn', 'commandPalette', 'commandPaletteInput', 'commandPaletteList', 'quickSwitcher', 'quickSwitcherInput', 'quickSwitcherList', 'aiChatPane', 'aiChatMessages', 'aiChatInput',
    'aiChatSendBtn', 'aiChatStopBtn', 'aiChatClearBtn', 'aiChatCloseBtn', 'aiChatStatus',
    'aiChatResizeHandle', 'aiPetBtn', 'editorContextMenu', 'aiSearchContextBtn', 'smartIngestContextBtn', 'aiImportPasswordContextBtn',
    'offlineTranslateContextBtn', 'onlineTranslateContextBtn', 'addCustomMappingContextBtn', 'addToDictLibContextBtn', 'aiContextAnalysisContextBtn',
    'manageDictionaryContextBtn', 'aiChatContextBtn', 'joinLineEndsContextBtn', 'formatContextBtn', 'toggleWordWrapContextBtn', 'insertWikilinkContextBtn',
    'dictModal', 'dictSourceInput', 'dictTargetInput', 'dictAddBtn', 'dictList', 'dictLibList', 'dictTabMapping', 'dictTabLibrary',
    'templateModal', 'templateNameInput', 'templateContentInput', 'templateSaveBtn', 'templateEditCancelBtn', 'templateList',
    'wikilinkPickerModal', 'wikilinkPickerHint', 'wikilinkPickerList',
    'shortcutModal', 'shortcutGroups', 'shortcutConfigurableList', 'shortcutFixedList', 'shortcutHelpBtn',
    'shortcutModeGroup', 'shortcutModeGroupTitle', 'shortcutModeList',
    'keyboardModeHelpSelect', 'keyboardModeHelpBtn',
    'aiChatSelectionHint', 'aiChatSelectionHintText', 'aiChatSelectionHintClear',
    'slashMenu', 'slashMenuList', 'startWritingGuide',
    'aiPetQuickMenu', 'aiPetBubble'
  ].map(id => [id, document.getElementById(id)]));

  /**
   * 创建带图标的状态栏按钮
   * @param {string} label - 按钮文字
   * @param {string} icon - 图标字符（emoji 或 SVG）
   * @param {string} title - 悬停提示（含快捷键）
   * @param {string} shortcut - 快捷键后缀
   * @returns {HTMLButtonElement}
   */
  function createStatusBtn(label, icon, title, shortcut) {
    var btn = document.createElement('button');
    btn.className = 'status-btn';
    btn.title = (title || label) + (shortcut ? ' (' + platformShortcut(shortcut) + ')' : '');
    if (icon) {
      var iconSpan = document.createElement('span');
      iconSpan.className = 'status-btn-icon';
      iconSpan.textContent = icon;
      btn.appendChild(iconSpan);
    }
    var labelSpan = document.createElement('span');
    labelSpan.className = 'status-btn-label';
    labelSpan.textContent = label;
    btn.appendChild(labelSpan);
    return btn;
  }

  // 悬浮提示快捷键平台自适应：macOS 显示 ⌘/⇧/⌥ 符号，Windows/Linux 保留 Ctrl/Shift/Alt 文本。
  function platformShortcut(sc) {
    if (!sc) return '';
    var out = sc
      .replace(/ArrowLeft/gi, '←')
      .replace(/ArrowRight/gi, '→')
      .replace(/ArrowUp/gi, '↑')
      .replace(/ArrowDown/gi, '↓');
    if (!/Mac/i.test(navigator.platform || '')) return out;
    return out
      .replace(/Ctrl\+/gi, '⌘')
      .replace(/Meta\+/gi, '⌘')
      .replace(/Shift\+/gi, '⇧')
      .replace(/Alt\+/gi, '⌥');
  }

  // ── 功能快捷键注册表：action → 按钮，配置变更（设置页）后即时刷新 tooltip ──
  var shortcutButtonRegistry = {};
  function registerShortcutButton(action, btn, rawTitle) {
    shortcutButtonRegistry[action] = { btn: btn, title: rawTitle };
    syncShortcutTitle(action);
  }
  function syncShortcutTitle(action) {
    var entry = shortcutButtonRegistry[action];
    if (!entry || !entry.btn) return;
    var combo = EditorShortcuts.get(action);
    entry.btn.title = entry.title + (combo ? ' (' + platformShortcut(combo) + ')' : '');
  }
  function refreshAllShortcutTitles() {
    Object.keys(shortcutButtonRegistry).forEach(syncShortcutTitle);
  }
  window.addEventListener('storage', function (ev) {
    if (ev.key === EditorShortcuts.STORAGE_KEY) refreshAllShortcutTitles();
  });
  // 设置页(settings iframe)改快捷键后经 index 主界面转发广播，实时刷新 tooltip 文案与组合键
  window.addEventListener('message', function (ev) {
    if (ev.data && ev.data.type === 'editor-shortcuts-changed') refreshAllShortcutTitles();
  });

  function applyMascotPreference() {
    try {
      const config = JSON.parse(localStorage.getItem('cut_shelter_mascot_v1') || '{}');
      const action = config.action || 'run';
      elements.aiPetBtn.dataset.action = action;
      elements.aiPetBtn.style.setProperty('--mascot-color', config.color || 'var(--app-primary)');
      // 构建图片 HTML
      let iconHtml = null;
      if (config.iconType === 'preset-images' && config.iconId) {
        iconHtml = `<img class="ai-pet-image" src="assets/mascot/${config.iconId}/${action}.png" alt="小记">`;
      } else if (config.iconType === 'upload' && config.iconDataUrls) {
        const uploads = config.iconDataUrls;
        const isLegacy = Object.keys(uploads).some(k => ['run', 'wave', 'jump', 'think', 'sleep', 'celebrate'].includes(k));
        const charUploads = isLegacy ? uploads : (uploads[config.iconId] || {});
        const url = charUploads[action];
        if (url) {
          iconHtml = `<img class="ai-pet-image" src="${url}" alt="小记">`;
        } else if (config.iconId) {
          // 如果当前动作没有上传图片，用预设图兜底
          iconHtml = `<img class="ai-pet-image" src="assets/mascot/${config.iconId}/${action}.png" alt="小记">`;
        }
      } else if (config.iconType === 'upload' && config.iconDataUrl) {
        // 旧版兼容
        iconHtml = `<img class="ai-pet-image" src="${config.iconDataUrl}" alt="小记">`;
      }
      if (iconHtml) elements.aiPetBtn.innerHTML = iconHtml;
      else if (config.iconSvg) elements.aiPetBtn.innerHTML = config.iconSvg.replace('<svg ', '<svg class="ai-pet-svg" ');
      else elements.aiPetBtn.innerHTML = '<svg class="ai-pet-svg" viewBox="0 0 64 64" aria-hidden="true"><ellipse class="ai-pet-glow" cx="32" cy="50" rx="14" ry="4" fill="var(--mascot-color,var(--app-primary))" opacity=".2"></ellipse><g class="ai-pet-figure"><circle cx="32" cy="28" r="18" fill="var(--mascot-color,var(--app-primary))" fill-opacity=".85" stroke="var(--mascot-color,var(--app-primary))" stroke-width="2.5"></circle></g><g class="ai-pet-face"><circle cx="23" cy="25" r="5" fill="#fff" stroke="none"></circle><circle cx="41" cy="25" r="5" fill="#fff" stroke="none"></circle><circle class="ai-pet-eye" cx="23" cy="25" r="3" fill="#2d3748" stroke="none"></circle><circle class="ai-pet-eye" cx="41" cy="25" r="3" fill="#2d3748" stroke="none"></circle><circle class="ai-pet-eye-highlight" cx="22" cy="23.5" r="1.5" fill="#fff" stroke="none"></circle><circle class="ai-pet-eye-highlight" cx="40" cy="23.5" r="1.5" fill="#fff" stroke="none"></circle><ellipse class="ai-pet-blush" cx="18" cy="31" rx="4" ry="2.5" fill="#ff8a9e" opacity=".5" stroke="none"></ellipse><ellipse class="ai-pet-blush" cx="46" cy="31" rx="4" ry="2.5" fill="#ff8a9e" opacity=".5" stroke="none"></ellipse><path d="M27 34c2 2 6 2 8 0" fill="none" stroke="#2d3748" stroke-width="2" stroke-linecap="round"></path></g></svg>';
      elements.aiPetBtn.title = `打开小记 · ${({ run: '奔跑', wave: '挥手', jump: '跳跃', think: '思考', sleep: '打盹', celebrate: '庆祝' })[action] || '奔跑'}`;
    } catch (_) {
      elements.aiPetBtn.dataset.action = 'wave';
    }
  }
  applyMascotPreference();
  window.addEventListener('storage', (event) => {
    if (event.key === 'cut_shelter_mascot_v1') applyMascotPreference();
  });
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'mascotChanged') applyMascotPreference();
  });
  try {
    const mascotChannel = new BroadcastChannel('cut-shelter-mascot');
    mascotChannel.addEventListener('message', applyMascotPreference);
  } catch (_) {}

  /**
   * 获取 Electron API（兼容 iframe 模式）。
   * editor.html 在 index.html 的 iframe 中加载，preload 脚本只注入顶层窗口，
   * 因此需要从 window.parent 获取 electronAPI。
   */
  function getElectronAPI() {
    return window.electronAPI || (window.parent && window.parent.electronAPI);
  }

  /**
   * 功能开关统一读取（Phase 1 导航效率）。
   * editor-features.js 在脚本末尾引入，此处一律惰性读取，未加载或未定义时按关处理，
   * 保证默认行为与改造前一致（不影响现有功能）。
   */
  function featureOn(name) {
    return !!(window.EditorFeatures && typeof window.EditorFeatures.isOn === 'function' && window.EditorFeatures.isOn(name));
  }

  // 功能开关模块就绪后刷新依赖 UI（面包屑等初始渲染早于 editor-features.js 引入）
  window.addEventListener('editor-features-ready', function() {
    try {
      renderBreadcrumb();
      updateCursorStatus();
    } catch (e) { /* 忽略，不影响现有功能 */ }
  });

  ace.config.set('basePath', 'libs/ace');
  ace.config.set('modePath', 'libs/ace');
  ace.config.set('themePath', 'libs/ace');
  ace.config.set('workerPath', 'libs/ace');

  // language_tools 需要在创建编辑器前加载以注册自动补全选项
  try {
    ace.require(['ace/ext/language_tools'], function() {});
  } catch (e) {
    console.warn('ace/ext/language_tools 加载失败:', e);
  }

  const mainEditor = createEditor('mainEditor', false);
  const compareEditor = createEditor('compareEditor', true);
  // Phase 2：worker 错误标注（JSON/XML）
  setupErrorMarkers(mainEditor);

  // 替换（replace）快捷键由 Ace 默认 Ctrl+H 改为 Ctrl+R（Command+R，macOS）
  (function rebindAceReplaceShortcut() {
    var cmds = mainEditor && mainEditor.commands;
    var replaceCmd = cmds && cmds.byName && cmds.byName['replace'];
    if (!replaceCmd) return;
    try { cmds.removeCommand(replaceCmd); } catch (e) { /* 忽略 */ }
    replaceCmd.bindKey = {
      win: 'Ctrl-R',
      mac: 'Command-R',
      sender: 'editor'
    };
    try { cmds.addCommand(replaceCmd, true); } catch (e) { /* 忽略 */ }
  })();

  // Ctrl/Cmd+G（跳转到行）与 Ctrl/Cmd+Shift+L（自动识别格式化）由窗口捕获阶段统一接管
  //  （见下方 keydown 捕获处理器），保证编辑区内外焦点均能触发。
  // 不再覆盖 ACE 内置命令，令其各自保留默认键位。

  // 对齐上游 acejump 插件的绑定方式：通过 ACE 命令管理器注册组合键
  // （原版 bindKey: win "Ctrl+;" / mac "Ctrl+;"）。作为 EditorShortcuts 捕获分发的
  // 双保险——焦点落在 ACE 内部时由命令管理器直接命中，不依赖 window 捕获。
  (function bindAceJumpCommand() {
    if (!mainEditor || !mainEditor.commands) return;
    var combo = (window.EditorShortcuts && EditorShortcuts.get('aceJump')) || 'Ctrl+;';
    var win = combo.split('+').join('-');   // Ctrl+;  → Ctrl-;
    var mac = combo.replace(/^Ctrl\+/i, 'Cmd+').split('+').join('-'); // → Cmd-;
    try {
      mainEditor.commands.addCommand({
        name: 'acejump-activate',
        bindKey: { win: win, mac: mac, sender: 'editor' },
        exec: function () {
          if (typeof window.__debugShortcutLog === 'function') window.__debugShortcutLog('ACE 命令管理器命中 acejump-activate（' + combo + '）');
          hideStartWritingGuide();
          mainEditor.focus();
          acejump('word', false);
        }
      });
    } catch (e) { /* 绑定失败不影响既有功能 */ }
  })();

  // 搜索/替换快捷键（Ctrl+F / Ctrl+H）由 Ace 内置命令处理：
  // ace.js 核心已注册 find/replace 命令并调用 config.loadModule("ace/ext/searchbox")，
  // ext-searchbox.js 已通过 editor.html 中的 <script> 标签加载并注册模块，无需自定义绑定。

  // ════════════════════════════════════════════
  // 鼠标滚轮缩放（Ctrl + 滚轮调整字体大小）
  // ════════════════════════════════════════════
  (function enableWheelZoom() {
    const container = mainEditor.container;
    let zoomTimer = null;

    container.addEventListener('wheel', function onWheel(e) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();

      const direction = e.deltaY > 0 ? -1 : 1;
      const current = parseInt(mainEditor.getFontSize(), 10) || 13;
      const next = Math.max(8, Math.min(40, current + direction));
      if (next === current) return;

      mainEditor.setFontSize(next + 'px');
      elements.fontSizeSlider.value = String(next);
      elements.fontSizeLabel.textContent = next + 'px';

      // 防抖显示提示
      clearTimeout(zoomTimer);
      zoomTimer = setTimeout(() => {
        showToast('字体大小: ' + next + 'px');
      }, 600);
    }, { passive: false });
  })();

  // ════════════════════════════════════════════
  // 拖拽文件/文本到编辑器
  // ════════════════════════════════════════════
  (function enableDragDrop() {
    const pane = mainEditor.container.closest('.editor-pane') || mainEditor.container;
    let dragCounter = 0;

    pane.addEventListener('dragenter', function onDragEnter(e) {
      e.preventDefault();
      e.stopPropagation();
      dragCounter++;
      pane.classList.add('drag-over');
    });

    pane.addEventListener('dragleave', function onDragLeave(e) {
      e.preventDefault();
      e.stopPropagation();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        pane.classList.remove('drag-over');
      }
    });

    pane.addEventListener('dragover', function onDragOver(e) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
    });

    pane.addEventListener('drop', async function onDrop(e) {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      pane.classList.remove('drag-over');

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        // 拖入文件：读取文本并插入到编辑器
        const file = files[0];
        try {
          const text = await file.text();
          if (text.length > 5 * 1024 * 1024) {
            showToast('文件过大，无法拖入（超过 5MB）', true);
            return;
          }
          const cursor = mainEditor.getCursorPosition();
          mainEditor.session.insert(cursor, text);
          mainEditor.focus();
          showToast('已拖入文件: ' + file.name + ' (' + text.length + ' 字符)');
        } catch (err) {
          showToast('读取拖入文件失败: ' + err.message, true);
        }
        return;
      }

      // 拖入纯文本
      const text = e.dataTransfer.getData('text/plain');
      if (text) {
        const cursor = mainEditor.getCursorPosition();
        mainEditor.session.insert(cursor, text);
        mainEditor.focus();
      }
    });
  })();

  function createEditor(id, readOnly) {
    const editor = ace.edit(id);
    editor.setOptions({
      fontSize: '13px',
      showPrintMargin: false,
      displayIndentGuides: true,
      highlightActiveLine: !readOnly,
      highlightSelectedWord: true,
      selectionStyle: 'line',
      showInvisibles: true,
      useWorker: true,
      readOnly,
      scrollPastEnd: 0.3,
      wrap: false,
      enableBasicAutocompletion: !readOnly,
      enableLiveAutocompletion: !readOnly,
      dragEnabled: !readOnly
    });
    editor.renderer.setAnimatedScroll(true);
    // 平滑光标动画
    editor.setOption('cursorStyle', 'smooth');
    editor.session.setMode('ace/mode/text');
    editor.session.setUseSoftTabs(true);
    editor.session.setTabSize(2);
    return editor;
  }

  // Phase 2：worker 错误标注（JSON/XML 语法错误 → gutter 红点 + 状态栏计数 + 点击跳转）。
  // 独立挂载，不改动 createEditor 默认选项；无 worker 或模式不支持时静默无效果。
  function setupErrorMarkers(editor) {
    if (!editor || editor.__errMarkersSetup) return;
    editor.__errMarkersSetup = true;
    var session = editor.session;
    var decoratedRows = {}; // 已加装饰的行号 → true，用于增量清理
    session.on('changeAnnotation', function() {
      if (!featureOn('errorMarkers')) return;
      var anns = session.getAnnotations() || [];
      var errors = anns.filter(function(a) { return a.type === 'error'; });
      var rowsToDeco = {};
      errors.forEach(function(a) {
        if (a.row !== undefined) rowsToDeco[a.row] = true;
      });
      // 清理不再有错误的旧装饰，保留仍需要的（见下方顺序：先删旧再加重，避免残留）
      Object.keys(decoratedRows).forEach(function(row) {
        if (!rowsToDeco[row]) {
          session.removeGutterDecoration(Number(row), 'ace_worker_error');
          delete decoratedRows[row];
        }
      });
      // 追加新的错误装饰
      Object.keys(rowsToDeco).forEach(function(row) {
        if (!decoratedRows[row]) {
          session.addGutterDecoration(Number(row), 'ace_worker_error');
          decoratedRows[row] = true;
        }
      });
      updateErrorMarkerStatus();
    });
    // 行号点击：有语法错误 → 跳转错误；无错误 → 选中整行（D2，Notepad++ 行为）
    editor.renderer.on('gutterClick', function(e) {
      if (!featureOn('errorMarkers')) return;
      const row = e.getDocumentPosition().row;
      const errors = (mainEditor.session.getAnnotations() || [])
        .filter(function(a) { return a.type === 'error' && (a.row === row || a.row === row - 1 || a.row === row + 1); });
      if (errors.length) { openErrorAtRow(row); return; }
      if (featureOn('gutterSelectLine')) {
        try {
          mainEditor.selection.setSelectionRange(new Range(row, 0, row + 1, 0));
        } catch (e) { /* 忽略 */ }
        mainEditor.focus();
      }
    });
  }

  // gutter 红点 → 点击定位到错误
  function openErrorAtRow(row) {
    var errors = (mainEditor.session.getAnnotations() || [])
      .filter(function(a) { return a.type === 'error' && (a.row === row || a.row === row - 1 || a.row === row + 1); });
    if (!errors.length) return;
    var err = errors[0];
    mainEditor.gotoLine(err.row + 1, err.column || 0, true);
    mainEditor.focus();
    showToast('语法错误：' + (err.text || '解析失败'));
  }

  // 状态栏错误计数（仅在有错误时显示，布局不受影响）
  var errStatusEl = null;
  function updateErrorMarkerStatus() {
    if (!featureOn('errorMarkers')) return;
    var session = mainEditor.session;
    var count = (session.getAnnotations() || []).filter(function(a) { return a.type === 'error'; }).length;
    if (!errStatusEl) {
      errStatusEl = document.createElement('span');
      errStatusEl.id = 'errorMarkerStatus';
      errStatusEl.style.cssText = 'color:var(--app-danger, #e5484d);cursor:pointer';
      errStatusEl.title = '点击跳转到第一处语法错误';
      errStatusEl.addEventListener('click', function() {
        var anns = mainEditor.session.getAnnotations() || [];
        var first = anns.filter(function(a) { return a.type === 'error'; })[0];
        if (first) mainEditor.gotoLine(first.row + 1, first.column || 0, true);
      });
      (elements.runtimeStatus && elements.runtimeStatus.parentNode)
        ? elements.runtimeStatus.parentNode.insertBefore(errStatusEl, elements.runtimeStatus)
        : null;
    }
    if (count > 0) {
      errStatusEl.textContent = '✕ ' + count;
      errStatusEl.hidden = false;
    } else {
      errStatusEl.hidden = true;
    }
  }

  /**
   * 应用主题到编辑器页面与 ACE 编辑器。
   * @param {string|null} parentTheme 父窗口通过 message 传回的主题值（dark / notion / regular 等），
   *        非空时优先采用，避免切页后本地缓存与父窗口不一致导致背景色错乱（Bug 修复）。
   */
  function applyTheme(parentTheme) {
    const core = window.CutShelterThemeCore;
    const appearance = localStorage.getItem(APPEARANCE_KEY) || 'notion';
    let theme = core
      ? core.resolveAppearance(appearance, window.matchMedia('(prefers-color-scheme: dark)').matches)
      : (localStorage.getItem(THEME_STORAGE_KEY) || 'notion');
    // 父窗口显式传入主题时优先采用（规避 iframe 隐藏期间缓存未同步造成的错乱）
    if (core && parentTheme && core.THEMES.indexOf(parentTheme) !== -1) {
      theme = parentTheme;
    }
    theme = core ? core.normalizeTheme(theme) : theme;
    const motion = core ? core.readStoredMotion(localStorage) : 'full';
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-motion', motion);
    // Ace 语法主题与应用主题分离：深色系用深色语法主题，浅色系用浅色
    const isDark = theme === 'dark';
    const aceTheme = isDark ? 'ace/theme/tomorrow_night' : 'ace/theme/textmate';
    mainEditor.setTheme(aceTheme);
    compareEditor.setTheme(aceTheme);
    // 重绘兜底：强制刷新排版，确保隐藏/重新显示后背景色、选区高亮等正确
    mainEditor.renderer.updateFull && mainEditor.renderer.updateFull();
    compareEditor.renderer.updateFull && compareEditor.renderer.updateFull();
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

  function ensureAiChatState(tab) {
    if (!tab.aiChat || !window.EditorAiChatCore) {
      tab.aiChat = window.EditorAiChatCore.createState();
    }
    return tab.aiChat;
  }

  /**
   * 切换到指定索引的标签
   * @param {boolean} [recordHistory=true] 切换前是否记录当前编辑位置（位置历史跳转复用标签时置 false，避免重写历史指针）
   */
  function switchToTab(index, recordHistory) {
    if (recordHistory === undefined) recordHistory = true;
    if (index === activeTabIndex || index < 0 || index >= tabs.length) return;
    if (activeAiRequest) cancelAiRequest();
    saveActiveTabSnapshot();
    if (recordHistory) recordEditorPositionHistory(); // Phase 1：切换前记录当前编辑位置
    activeTabIndex = index;
    state = tabs[activeTabIndex];
    ensureAiChatState(state);

    // 恢复标签内容
    state.suppressChange = true;
    mainEditor.setValue(state.content || '', -1);
    state.suppressChange = false;
    updateStartWritingGuide();

    // 恢复光标和滚动位置
    mainEditor.gotoLine(state.cursorRow + 1, state.cursorColumn, false);
    mainEditor.session.setScrollTop(state.scrollTop);
    mainEditor.session.setScrollLeft(state.scrollLeft);

    // 恢复语言模式
    setLanguage(state.language);

    // 更新 UI
    updateDocumentIdentity();
    updateCursorStatus();
    updateStatusBar();
    renderTabBar();
    renderAiChat();
    // 切换标签 → 当前文件 basename 可能变化 → 刷新反链（面板可见时生效）
    scheduleBacklinksRefresh();

    // 切换标签时退出对比和 Markdown 预览模式
    if (!elements.comparePane.hidden) {
      toggleCompare(false);
    }
    if (!elements.markdownPane.hidden) {
      toggleMarkdownPreview(false);
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
    ensureAiChatState(state);
    setEditorContent('', { language: 'markdown', encoding: 'UTF-8', lineEnding: 'LF' });
    renderTabBar();
    renderAiChat();
    mainEditor.focus();
  }

  /**
   * 关闭指定索引的标签
   */
  async function closeTab(index) {
    if (tabs.length <= 1) return;

    const tab = tabs[index];
    if (activeAiRequest && activeAiRequest.tab === tab) cancelAiRequest();
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
    ensureAiChatState(state);

    // 恢复新的活跃标签
    state.suppressChange = true;
    mainEditor.setValue(state.content || '', -1);
    state.suppressChange = false;
    updateStartWritingGuide();
    mainEditor.gotoLine(state.cursorRow + 1, state.cursorColumn, false);
    mainEditor.session.setScrollTop(state.scrollTop);
    setLanguage(state.language);
    updateDocumentIdentity();
    renderTabBar();
    renderAiChat();
    mainEditor.focus();
  }

  /**
   * 渲染标签栏 DOM
   * Phase 3：开关开启时走增量渲染（仅更新变更项，复用 DOM），关闭时沿用原全量重建逻辑。
   */
  function renderTabBar() {
    if (featureOn('tabBarIncremental') && typeof renderTabBarIncremental === 'function') {
      renderTabBarIncremental();
      return;
    }
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
      closeBtn.title = '关闭标签 (' + platformShortcut('Ctrl+W') + ')';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(index);
      });

      tabEl.appendChild(dot);
      tabEl.appendChild(label);
      tabEl.appendChild(closeBtn);

      // 拖拽排序
      tabEl.draggable = true;
      tabEl.dataset.tabIndex = index;
      tabEl.addEventListener('dragstart', function(e) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
        setTimeout(function() { tabEl.classList.add('tab-dragging'); }, 0);
      });
      tabEl.addEventListener('dragend', function() {
        tabEl.classList.remove('tab-dragging');
        tabBar.querySelectorAll('.tab-item').forEach(function(el) { el.classList.remove('tab-drop-target'); });
      });
      tabEl.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        tabBar.querySelectorAll('.tab-item').forEach(function(el) { el.classList.remove('tab-drop-target'); });
        tabEl.classList.add('tab-drop-target');
      });
      tabEl.addEventListener('drop', function(e) {
        e.preventDefault();
        e.stopPropagation();
        tabEl.classList.remove('tab-drop-target');
        tabBar.querySelectorAll('.tab-item').forEach(function(el) { el.classList.remove('tab-dragging', 'tab-drop-target'); });
        var srcIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
        var dstIndex = parseInt(tabEl.dataset.tabIndex, 10);
        if (isNaN(srcIndex) || isNaN(dstIndex) || srcIndex === dstIndex) return;
        var item = tabs.splice(srcIndex, 1)[0];
        tabs.splice(dstIndex, 0, item);
        if (srcIndex < activeTabIndex && dstIndex >= activeTabIndex) {
          activeTabIndex--;
        } else if (srcIndex > activeTabIndex && dstIndex <= activeTabIndex) {
          activeTabIndex++;
        } else if (srcIndex === activeTabIndex) {
          activeTabIndex = dstIndex;
        }
        renderTabBar();
      });

      tabEl.addEventListener('click', () => switchToTab(index));
      tabEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showTabContextMenu(e, index);
      });

      tabBar.insertBefore(tabEl, elements.tabNewBtn);
    });

    // 添加双击空白区域新建标签的 spacer
    const spacer = document.createElement('div');
    spacer.className = 'tab-bar-spacer';
    spacer.addEventListener('dblclick', createNewTab);
    tabBar.insertBefore(spacer, elements.tabNewBtn);
  }

  /**
   * Phase 3：标签栏增量渲染——尽量复用既有 DOM，只对变动的标签做新建/更新/移除。
   * 与原 renderTabBar 并行存在，由开关切换；行为校验失败时可一键回退到原逻辑。
   */
  function renderTabBarIncremental() {
    const tabBar = elements.tabBar;
    // 按 data-tab-index 建立现有 tab-item 映射
    const existing = {};
    tabBar.querySelectorAll('.tab-item').forEach(el => {
      const idx = parseInt(el.dataset.tabIndex, 10);
      if (!isNaN(idx)) existing[idx] = el;
    });

    // 1) 移除已不存在的标签
    const keep = {};
    tabs.forEach((tab, index) => { keep[index] = true; });
    Object.keys(existing).forEach(idx => {
      if (!keep[idx]) livingRemoveTabEl(existing[Number(idx)]);
    });

    // 2) 逐个同步（新建或更新 class/标题/圆点/文案；拖拽/右键等在创建时静默绑定一次）
    tabs.forEach((tab, index) => {
      let el = existing[index];
      if (!el) {
        el = buildTabElCore(tab, index);
        tabBar.insertBefore(el, findInsertPoint(tabBar, index));
      } else {
        updateTabEl(el, tab, index);
      }
      el.dataset.tabIndex = index;
    });

    // 3) 同步 spacer 位置（始终在新建按钮前）
    let spacer = tabBar.querySelector(':scope > .tab-bar-spacer');
    if (!spacer) {
      spacer = document.createElement('div');
      spacer.className = 'tab-bar-spacer';
      spacer.addEventListener('dblclick', createNewTab);
    }
    if (!spacer.parentNode) tabBar.insertBefore(spacer, elements.tabNewBtn);
    else if (spacer !== tabBar.querySelector(':scope > .tab-bar-spacer')) spacer.remove();
    // spacer 放回末尾（新建按钮前）
    tabBar.insertBefore(spacer, elements.tabNewBtn);
  }

  // 移除标签（复用原 close 视觉行为：移除 DOM）
  function livingRemoveTabEl(el) { if (el && el.parentNode) el.parentNode.removeChild(el); }

  // 新建单个标签 DOM（仅初始绑定一次；等价于原逻辑的构建部分）
  function buildTabElCore(tab, index) {
    const el = document.createElement('div');
    el.className = 'tab-item' + (index === activeTabIndex ? ' active' : '');
    el.dataset.tabIndex = String(index);
    const dot = document.createElement('span');
    const label = document.createElement('span');
    const closeBtn = document.createElement('button');
    dot.className = 'tab-dot' + (tab.modified ? ' active' : '');
    label.className = 'tab-label';
    closeBtn.className = 'tab-close-btn';
    closeBtn.innerHTML = '&times;';
    // 事件只绑定一次
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(parseInt(el.dataset.tabIndex, 10));
    });
    el.appendChild(dot);
    el.appendChild(label);
    el.appendChild(closeBtn);
    // 拖拽排序（与全量版一致）
    el.draggable = true;
    el.addEventListener('dragstart', function(e) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(parseInt(el.dataset.tabIndex, 10)));
      setTimeout(function() { el.classList.add('tab-dragging'); }, 0);
    });
    el.addEventListener('dragend', function() {
      el.classList.remove('tab-dragging');
      elements.tabBar.querySelectorAll('.tab-item').forEach(function(x) { x.classList.remove('tab-drop-target'); });
    });
    el.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      elements.tabBar.querySelectorAll('.tab-item').forEach(function(x) { x.classList.remove('tab-drop-target'); });
      el.classList.add('tab-drop-target');
    });
    el.addEventListener('drop', function(e) {
      e.preventDefault(); e.stopPropagation();
      el.classList.remove('tab-drop-target');
      elements.tabBar.querySelectorAll('.tab-item').forEach(function(x) { x.classList.remove('tab-dragging', 'tab-drop-target'); });
      const src = parseInt(e.dataTransfer.getData('text/plain'), 10);
      const dst = parseInt(el.dataset.tabIndex, 10);
      if (isNaN(src) || isNaN(dst) || src === dst) return;
      const item = tabs.splice(src, 1)[0];
      tabs.splice(dst, 0, item);
      if (src < activeTabIndex && dst >= activeTabIndex) activeTabIndex--;
      else if (src > activeTabIndex && dst <= activeTabIndex) activeTabIndex++;
      else if (src === activeTabIndex) activeTabIndex = dst;
      renderTabBar();
    });
    el.addEventListener('click', () => switchToTab(parseInt(el.dataset.tabIndex, 10)));
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); showTabContextMenu(e, parseInt(el.dataset.tabIndex, 10)); });
    // 同步静态内容（调用同一 update 逻辑，保证新建也有正确名字/圆点）
    updateTabEl(el, tab, index);
    return el;
  }

  // 增量更新单个标签的静态内容（标题/圆点/激活态）
  function updateTabEl(el, tab, index) {
    el.className = 'tab-item' + (index === activeTabIndex ? ' active' : '');
    el.title = tab.displayPath || tab.fileName;
    const dot = el.querySelector('.tab-dot');
    if (dot) dot.className = 'tab-dot' + (tab.modified ? ' active' : '');
    const label = el.querySelector('.tab-label');
    if (label && label.textContent !== tab.fileName) label.textContent = tab.fileName;
  }

  // 在正确位置插入新标签：排在已有索引之前、新建按钮之前
  function findInsertPoint(tabBar, index) {
    const items = tabBar.querySelectorAll('.tab-item');
    for (let i = 0; i < items.length; i++) {
      const idx = parseInt(items[i].dataset.tabIndex, 10);
      if (!isNaN(idx) && idx > index) return items[i];
    }
    return elements.tabNewBtn;
  }

  // 标签栏右键菜单
  function showTabContextMenu(event, tabIndex) {
    var tab = tabs[tabIndex];
    if (!tab) return;
    var menu = document.getElementById('tabContextMenu');
    if (!menu) return;
    var filePath = tab.displayPath || '';
    var isFav = filePath ? isFavoriteFile(filePath) : false;
    menu.innerHTML = '<button type="button" class="tab-context-fav" role="menuitem">' + (isFav ? '★ 取消收藏' : '☆ 收藏到常用') + '</button>'
      + (filePath ? '<button type="button" class="tab-context-open-folder" role="menuitem">📂 打开文件所在目录</button>' : '');
    menu.hidden = false;
    var left = Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 8);
    var top = Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 8);
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = Math.max(8, top) + 'px';
    menu.dataset.tabIndex = tabIndex;
    var favBtn = menu.querySelector('.tab-context-fav');
    if (favBtn) {
      favBtn.onclick = function() {
        menu.hidden = true;
        if (filePath) {
          toggleFavItem(filePath, tab.fileName);
        } else {
          showToast('该文件暂无可收藏路径', true);
        }
      };
    }
    var openFolderBtn = menu.querySelector('.tab-context-open-folder');
    if (openFolderBtn) {
      openFolderBtn.onclick = function() {
        menu.hidden = true;
        openFileInFolder(filePath);
      };
    }
  }

  // 关闭标签右键菜单
  function closeTabContextMenu() {
    var menu = document.getElementById('tabContextMenu');
    if (menu) menu.hidden = true;
  }

  document.addEventListener('click', function(event) {
    var menu = document.getElementById('tabContextMenu');
    if (menu && !menu.contains(event.target)) closeTabContextMenu();
  });
  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') closeTabContextMenu();
  });
  window.addEventListener('blur', closeTabContextMenu);

  // 文件树右键菜单
  function showFileTreeContextMenu(event, file) {
    if (file.isDirectory) return;
    var menu = document.getElementById('tabContextMenu');
    if (!menu) return;
    var filePath = file.path || '';
    var isFav = filePath ? isFavoriteFile(filePath) : false;
    menu.innerHTML = '<button type="button" class="tab-context-fav" role="menuitem">' + (isFav ? '★ 取消收藏' : '☆ 收藏到常用') + '</button>'
      + (filePath ? '<button type="button" class="tab-context-open-folder" role="menuitem">📂 打开文件所在目录</button>' : '');
    menu.hidden = false;
    var left = Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 8);
    var top = Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 8);
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = Math.max(8, top) + 'px';
    var favBtn = menu.querySelector('.tab-context-fav');
    if (favBtn) {
      favBtn.onclick = function() {
        menu.hidden = true;
        if (filePath) {
          toggleFavItem(filePath, file.name);
        } else {
          showToast('该文件暂无可收藏路径', true);
        }
      };
    }
    var openFolderBtn = menu.querySelector('.tab-context-open-folder');
    if (openFolderBtn) {
      openFolderBtn.onclick = function() {
        menu.hidden = true;
        openFileInFolder(filePath);
      };
    }
  }

  // 最近文件右键菜单
  function showRecentContextMenu(event, item) {
    var menu = document.getElementById('tabContextMenu');
    if (!menu) return;
    var filePath = item.path || '';
    var isFav = filePath ? isFavoriteFile(filePath) : false;
    menu.innerHTML = '<button type="button" class="tab-context-fav" role="menuitem">' + (isFav ? '★ 取消收藏' : '☆ 收藏到常用') + '</button>'
      + (filePath ? '<button type="button" class="tab-context-open-folder" role="menuitem">📂 打开文件所在目录</button>' : '');
    menu.hidden = false;
    var left = Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 8);
    var top = Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 8);
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = Math.max(8, top) + 'px';
    var favBtn = menu.querySelector('.tab-context-fav');
    if (favBtn) {
      favBtn.onclick = function() {
        menu.hidden = true;
        if (filePath) {
          toggleFavItem(filePath, item.name);
        } else {
          showToast('该文件暂无可收藏路径', true);
        }
      };
    }
    var openFolderBtn = menu.querySelector('.tab-context-open-folder');
    if (openFolderBtn) {
      openFolderBtn.onclick = function() {
        menu.hidden = true;
        openFileInFolder(filePath);
      };
    }
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
    renderBreadcrumb();
  }

  /**
   * 面包屑导航（Phase 1）：按当前文档路径分段渲染，目录段可点击回退定位到文件树，
   * 文件段显示文件名。featureOn('breadcrumbBar') 关闭时保持 hidden，零布局影响。
   */
  function renderBreadcrumb() {
    const bar = elements.breadcrumbBar;
    if (!bar) return;
    const app = document.querySelector('.editor-app');
    if (!featureOn('breadcrumbBar')) {
      bar.hidden = true;
      bar.classList.remove('breadcrumb-visible');
      bar.innerHTML = '';
      if (app) app.classList.remove('breadcrumb-on');
      return;
    }
    bar.hidden = false;
    bar.classList.add('breadcrumb-visible');
    if (app) app.classList.add('breadcrumb-on');
    bar.innerHTML = '';
    const filePath = state && (state.displayPath || '');
    // 无保存路径时仅显示「未命名文档」
    if (!filePath) {
      const nameSpan = document.createElement('span');
      nameSpan.className = 'breadcrumb-file';
      nameSpan.textContent = state && state.fileName ? state.fileName : '未命名文档';
      bar.appendChild(nameSpan);
      return;
    }
    const parts = filePath.split(/[/\\]+/).filter(Boolean);
    if (!parts.length) return;
    // 目录段：每个目录段点击可在文件树中打开其完整路径（保留盘符/根前缀）
    const isWinAbs = /^[a-zA-Z]:[/\\]/.test(filePath);
    const isUnixAbs = filePath.startsWith('/');
    for (let i = 0; i < parts.length - 1; i++) {
      // 构造目录段的完整绝对路径，避免相对路径导致 listDirectory 查不到
      let target;
      if (isWinAbs) {
        target = i === 0 ? parts[0] + '/' : parts[0] + '/' + parts.slice(1, i + 1).join('/');
      } else if (isUnixAbs) {
        target = '/' + parts.slice(0, i + 1).join('/');
      } else {
        target = parts.slice(0, i + 1).join('/'); // 相对路径保底（理论不出现）
      }
      const seg = document.createElement('span');
      seg.className = 'breadcrumb-seg';
      seg.textContent = parts[i];
      seg.title = '在文件树中打开 ' + target;
      seg.addEventListener('click', function () {
        openBreadcrumbDir(target);
      });
      bar.appendChild(seg);
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = '›';
      bar.appendChild(sep);
    }
    const file = document.createElement('span');
    file.className = 'breadcrumb-file';
    file.textContent = parts[parts.length - 1];
    file.title = filePath;
    bar.appendChild(file);
  }

  // 点击面包屑目录段：定位到文件树对应目录（开关关闭时无副作用）
  function openBreadcrumbDir(dirPath) {
    if (!featureOn('breadcrumbBar')) return;
    const api = getElectronAPI();
    if (!api || typeof api.listDirectory !== 'function') return;
    // 先登记目标目录与一次性来源，再打开面板：loadFileTree 命中缓存直接加载该目录，
    // 避免与 getFileDirectory 异步解析链形成竞态互相覆盖
    fileTreeDir = dirPath;
    fileTreeDirSource = 'breadcrumb';
    if (typeof toggleFileTree === 'function' && !fileTreeOpen) {
      toggleFileTree();
    } else {
      loadDirectory(dirPath);
    }
  }

  // ══════════════════════════════════════════════════════════
  // Phase 1：近期编辑位置记忆（快捷键见 EditorShortcuts：Ctrl/Cmd+Alt+← / →）
  // 独立于现有标签快照；仅记录 (fileKey,row,column)，上限 50 条。
  // ══════════════════════════════════════════════════════════
  const POS_HISTORY_KEY = 'editor_pos_history_v1';
  const POS_HISTORY_MAX = 50;
  let posHistory = loadPosHistory();
  let posHistoryIndex = -1;

  function loadPosHistory() {
    try {
      const arr = JSON.parse(localStorage.getItem(POS_HISTORY_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function persistPosHistory() {
    try { localStorage.setItem(POS_HISTORY_KEY, JSON.stringify(posHistory)); } catch (e) { /* 忽略 */ }
  }

  /** 当前编辑位置的文件键（桌面文件路径优先，未保存用文件名） */
  function currentPosFileKey() {
    if (state && state.displayPath) return 'path:' + state.displayPath;
    if (state && state.fileName) return 'name:' + state.fileName;
    return 'untitled';
  }

  /**
   * 记录当前编辑位置（追加去重，指针移到末尾）。
   * 仅在 featureOn('editorPosHistory') 时生效；未开启时零副作用。
   */
  function recordEditorPositionHistory() {
    if (!featureOn('editorPosHistory') || !state) return;
    const pos = { key: currentPosFileKey(), row: state.cursorRow, column: state.cursorColumn };
    // 与最近一条相同则跳过，避免连续切换造成重复
    const last = posHistory[posHistory.length - 1];
    if (last && last.key === pos.key && last.row === pos.row && last.column === pos.column) return;
    posHistory.push(pos);
    if (posHistory.length > POS_HISTORY_MAX) posHistory.splice(0, posHistory.length - POS_HISTORY_MAX);
    posHistoryIndex = posHistory.length - 1;
    persistPosHistory();
  }

  /** 回到上一编辑位置（跨文件时经 openFileByPath 打开并定位） */
  async function jumpPosHistoryBack() {
    if (!featureOn('editorPosHistory')) return;
    if (posHistoryIndex < 0) posHistoryIndex = posHistory.length;
    if (posHistoryIndex <= 0) { showToast('没有更早的编辑位置'); return; }
    const target = posHistory[posHistoryIndex - 1];
    await gotoPosHistoryEntry(target);
    posHistoryIndex -= 1;
  }

  /** 前进到下一编辑位置 */
  async function jumpPosHistoryForward() {
    if (!featureOn('editorPosHistory')) return;
    if (posHistoryIndex >= posHistory.length - 1) { showToast('没有更新的编辑位置'); return; }
    const target = posHistory[posHistoryIndex + 1];
    await gotoPosHistoryEntry(target);
    posHistoryIndex += 1;
  }

  /** 定位到历史条目：同文件直接 gotoLine，异文件走 openFileByPath（若可用） */
  async function gotoPosHistoryEntry(target) {
    if (!target) return;
    const sameFile = target.key === currentPosFileKey();
    if (sameFile) {
      mainEditor.gotoLine(target.row + 1, target.column, true);
      mainEditor.focus();
      return;
    }
    // 异文件：优先复用已打开的编辑区（tabs），不新建；确实未打开时才经 openFileByPath 首次打开
    if (target.key.indexOf('path:') === 0) {
      const filePath = target.key.slice(5);
      const existingIdx = tabs.findIndex(t => t.displayPath === filePath);
      if (existingIdx >= 0) {
        if (existingIdx !== activeTabIndex) switchToTab(existingIdx, false); // 不记历史，保持跳转指针
        mainEditor.gotoLine(target.row + 1, target.column, true);
        mainEditor.focus();
        return;
      }
      const api = getElectronAPI();
      if (api && typeof api.openFileByPath === 'function') {
        try {
          const result = await api.openFileByPath(filePath);
          if (result && !result.canceled) {
            saveActiveTabSnapshot();
            const newTab = createTabState();
            tabs.push(newTab);
            activeTabIndex = tabs.length - 1;
            state = tabs[activeTabIndex];
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
            mainEditor.gotoLine(target.row + 1, target.column, true);
          }
        } catch (e) {
          showToast('打开历史位置文件失败', true);
        }
        return;
      }
    }
    showToast('该历史位置的文件不可用（浏览器模式或无路径）', true);
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
    // C2：大文件打开提示 + 下一帧应用，避免 setValue 阻塞首帧导致界面短暂无响应
    const bigHint = featureOn('largeFileOpenHint') && new TextEncoder().encode(text || '').length > 2 * 1024 * 1024;
    if (bigHint) showToast('正在打开大文件，请稍候…');
    const apply = function () {
      state.suppressChange = true;
      mainEditor.setValue(text || '', -1);
      state.suppressChange = false;
      state.content = text || '';
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
      updateStartWritingGuide();
      mainEditor.focus();
      applyLargeFileMode(text);
      if (featureOn('docStatsZoom')) scheduleDocStatsUpdate();
      // 载入新文件后刷新双向链接面板（当前激活 tab；面板可见时生效）
      scheduleBacklinksRefresh();
    };
    if (bigHint) requestAnimationFrame(apply); else apply();
  }

  // Phase 3：大文件降级策略——按内容字节数调整编辑器选项。
  // 阈值与开关双条件：≤2MB 或开关关闭时行为与改造前完全一致；>5MB 额外关闭换行与选中词同步。
  function applyLargeFileMode(text) {
    if (!featureOn('largeFileDegrade')) return;
    const bytes = new TextEncoder().encode(text || '').length;
    state.lastContentBytes = bytes; // C3 搜索高亮上限依据
    const isLarge2M = bytes > 2 * 1024 * 1024;
    const isLarge5M = bytes > 5 * 1024 * 1024;
    const isLarge6M = bytes > 6 * 1024 * 1024;
    // >2MB：关闭 worker（降低 tokenize/校验开销；语法模式与普通高亮保留，ACE 高亮本身不依赖 worker）
    try {
      mainEditor.setOption('useWorker', !isLarge2M);
      compareEditor.setOption('useWorker', !isLarge2M);
    } catch (e) { /* 忽略 */ }
    // A2：>2MB 关闭自动补全（实时/手动），恢复时还原用户原偏好
    try {
      if (origAutocompletePref === null) {
        origAutocompletePref = {
          live: mainEditor.getOption('enableLiveAutocompletion'),
          basic: mainEditor.getOption('enableBasicAutocompletion')
        };
      }
      if (featureOn('largeFileAutocompleteOff')) {
        mainEditor.setOption('enableLiveAutocompletion', !isLarge2M && !!origAutocompletePref.live);
        mainEditor.setOption('enableBasicAutocompletion', !isLarge2M && !!origAutocompletePref.basic);
      }
    } catch (e) { /* 忽略 */ }
    // >5MB：关闭自动换行与选中词同步高亮
    if (isLarge5M) {
      mainEditor.setOption('wrap', 'off');
      compareEditor.setOption('wrap', 'off');
      mainEditor.setOption('highlightSelectedWord', false);
      compareEditor.setOption('highlightSelectedWord', false);
    } else if (state && state.__degraded5M) {
      // 曾降级过大文件，现在切回小文件 → 恢复原默认（wrap off / highlightSelectedWord true）
      mainEditor.setOption('wrap', 'off');
      compareEditor.setOption('wrap', 'off');
      mainEditor.setOption('highlightSelectedWord', true);
      compareEditor.setOption('highlightSelectedWord', true);
    }
    state.__degraded5M = !!isLarge5M;
    // >6MB：降级为纯文本模式，跳过完整 markdown/代码高亮，避免大文件输入卡顿
    if (isLarge6M) {
      const currentLang = elements.languageSelect ? elements.languageSelect.value : 'text';
      if (currentLang !== 'text') {
        // 记住降级前的真实语言，切回小文件时恢复
        state.__largeModeLang = currentLang;
        setLanguage('text');
      }
      if (!state.__degradedText) showToast('已进入轻量模式：超大文件已关闭语法高亮');
      state.__degradedText = true;
    } else if (state && state.__degradedText) {
      const backup = state.__largeModeLang || 'markdown';
      setLanguage(backup);
      state.__degradedText = false;
      delete state.__largeModeLang;
    }
    if (isLarge2M) showToast('已进入轻量模式：超大文件已降低高亮/换行开销');
    // B3：超长行检测（>8k 字符/行）→ 临时开启换行避免横向滚动卡顿
    applyLongLineMode(text, isLarge5M);
  }

  // A2：记录用户原有自动补全偏好，便于大文件降级后还原
  var origAutocompletePref = null;

  // B3：超长行自动换行——扫描文档行，发现超长行临时开启 wrap，恢复后还原
  var longLineModeActive = false;
  var prevWrapPref = null;
  var longLineCheckTimer = null;
  function applyLongLineMode(text, isLarge5M) {
    if (!featureOn('longLineWrap')) return;
    if (isLarge5M) return; // 超大文件跳过扫描，避免扫描本身拖慢
    if (longLineCheckTimer) return;
    longLineCheckTimer = setTimeout(function() {
      longLineCheckTimer = null;
      var hasLong = false;
      try {
        var doc = mainEditor.session.getDocument();
        var total = doc.getLength();
        var step = Math.max(1, Math.floor(total / 4000)); // 大文件抽样控制开销
        for (var r = 0; r < total; r += step) {
          if ((doc.getLine(r) || '').length > 8192) { hasLong = true; break; }
        }
      } catch (e) { hasLong = false; }
      if (hasLong && !longLineModeActive) {
        longLineModeActive = true;
        prevWrapPref = mainEditor.getOption('wrap');
        mainEditor.setOption('wrap', 'free');
        showToast('检测到超长行：已临时开启自动换行');
      } else if (!hasLong && longLineModeActive) {
        longLineModeActive = false;
        mainEditor.setOption('wrap', prevWrapPref || 'off');
      }
    }, 800);
  }

  // C3：大文件搜索高亮上限——保留结果跳转，限制全文档高亮标记数
  (function initSearchHighlightLimit() {
    if (!featureOn('searchHighlightLimit')) return;
    var session = mainEditor.session;
    var origHighlight = session.highlight.bind(session);
    session.highlight = function (re, maxMatches, range) {
      if (state && state.lastContentBytes > 5 * 1024 * 1024) {
        if (!maxMatches || maxMatches > 1000) maxMatches = 1000;
      }
      return origHighlight(re, maxMatches, range);
    };
  })();

  /**
   * P1 直接开始写作：根据当前文档是否为空切换居中引导层显隐。
   * 对比 / Markdown 预览 / 全屏等模式下不显示，避免遮挡。
   */
  function updateStartWritingGuide() {
    const guide = elements.startWritingGuide;
    if (!guide) return;
    const isEmpty = !(state.content || '').trim();
    const busyMode = !elements.comparePane.hidden || !elements.markdownPane.hidden;
    guide.hidden = !(isEmpty && !busyMode);
    if (guide.hidden) {
      guide.setAttribute('aria-hidden', 'true');
    } else {
      guide.removeAttribute('aria-hidden');
    }
  }

  // 引导层可见时：点击 / 任意输入立即进入写作
  function hideStartWritingGuide() {
    const guide = elements.startWritingGuide;
    if (!guide || guide.hidden) return;
    guide.hidden = true;
    guide.setAttribute('aria-hidden', 'true');
  }

  function setLanguage(language) {
    // 支持的模式：原 5 种 + Phase 2 新增（javascript/python/yaml/css/html）
    const SUPPORTED_MODES = ['json', 'xml', 'sql', 'markdown', 'javascript', 'python', 'yaml', 'css', 'html'];
    // 公司内已有行为：未知语言回落到 text；保持默认与改造前一致
    const normalized = SUPPORTED_MODES.includes(language) ? language : 'text';
    elements.languageSelect.value = normalized;
    mainEditor.session.setMode(`ace/mode/${normalized}`);
    compareEditor.session.setMode(`ace/mode/${normalized}`);
    // 标记当前语言模式，供 CSS 精确作用域（如仅 Markdown 围栏灰化，不波及 JSON/SQL 等代码模式的 token 原色）
    mainEditor.container.setAttribute('data-mode', normalized);
    compareEditor.container.setAttribute('data-mode', normalized);
    // Phase 2：括号配对/自动闭合——仅对新增的代码模式显式开启 behaviours
    // （ACE 括号高亮/匹配为 session 内置行为，无需也无可用的 setOption，仅声明不使用会产生告警）
    if (featureOn('bracketPairs') && ['javascript', 'python', 'yaml', 'css', 'html'].includes(normalized)) {
      try {
        if (mainEditor.session.setBehavioursEnabled) mainEditor.session.setBehavioursEnabled(true);
        if (compareEditor.session.setBehavioursEnabled) compareEditor.session.setBehavioursEnabled(true);
      } catch (e) { /* 忽略：环境不支持时不改变行为 */ }
    }
    updateStatusBar();
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
    if (getElectronAPI() && typeof getElectronAPI().openTextFile === 'function') {
      try {
        const result = await getElectronAPI().openTextFile();
        if (!result || result.canceled) return;
        // 打开文件在新标签页中打开，不覆盖当前编辑区域（Ctrl+T + 打开 的组合）
        saveActiveTabSnapshot();
        const newTab = createTabState();
        tabs.push(newTab);
        activeTabIndex = tabs.length - 1;
        state = tabs[activeTabIndex];
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
        recordRecentFile(result.displayPath || result.filePath, result.fileName);
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
      sharedState.compareSource = 'file';
      updateDiff();
      return;
    }
    if (state.browserPurpose === 'main') {
      // 浏览器模式打开文件同样在新标签页中打开，不覆盖当前编辑区域
      saveActiveTabSnapshot();
      const newTab = createTabState();
      tabs.push(newTab);
      activeTabIndex = tabs.length - 1;
      state = tabs[activeTabIndex];
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
      const payload = {
        fileToken: state.fileToken,
        text,
        encoding: state.encoding,
        lineEnding: state.lineEnding,
        expectedMtimeMs: state.expectedMtimeMs,
        suggestedName,
        language: elements.languageSelect.value
      };
      try {
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
        lastSavedContent = text;
        setModified(false);
        renderTabBar();
        showToast('已保存为 ' + state.encoding, false, 'success');
        scheduleBacklinksRefresh();
        FrontendLogger.info('[Editor] Saved file', result.fileName, result.size, state.encoding);
      } catch (error) {
        // 令牌失效或其它错误时自动降级为另存为
        if (state.fileToken) {
          try {
            showToast('保存失败，正在尝试另存为...', false, 'info');
            const retryPayload = {
              fileToken: null,
              text: payload.text,
              encoding: payload.encoding,
              lineEnding: payload.lineEnding,
              expectedMtimeMs: null,
              suggestedName: payload.suggestedName,
              language: payload.language
            };
            const retryResult = await getElectronAPI().saveTextFileAs(retryPayload);
            if (!retryResult || retryResult.canceled) return;
            state.fileToken = retryResult.fileToken;
            state.fileName = retryResult.fileName;
            state.displayPath = retryResult.displayPath;
            state.expectedMtimeMs = retryResult.mtimeMs;
            lastSavedContent = text;
            setModified(false);
            renderTabBar();
            showToast('已保存为 ' + state.encoding, false, 'success');
            scheduleBacklinksRefresh();
            FrontendLogger.info('[Editor] Saved file (fallback)', retryResult.fileName, retryResult.size);
            return;
          } catch (fallbackError) {
            handleError('保存文件失败', fallbackError);
          }
        } else {
          handleError('保存文件失败', error);
        }
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
    lastSavedContent = text;
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
    formatCurrentContentAuto();
  }

  /**
   * 自动识别并格式化（右键菜单入口）：无视右上角文本类型，主动检测 + 依次尝试 JSON/XML/SQL。
   * 有选区只格式化选区，无选区格式化全文。全部解析失败时，合并行末换行后重试一次。
   */
  function formatCurrentContentAuto() {
    const target = getTargetRangeAndText();
    if (target.text.length > MAX_TRANSFORM_LENGTH) {
      showToast('格式化内容超过 5 MB，已阻止本次操作', true);
      return;
    }
    // 候选类型去重排序：优先按文件名+内容检测，随后按 JSON/XML/SQL 兜底尝试，忽略右上角下拉框
    const candidates = ['json', 'xml', 'sql'];
    const first = EditorCore.detectLanguage(state.fileName, target.text);
    if (first && first !== 'text') candidates.unshift(first);
    const order = Array.from(new Set(candidates));

    // 依次尝试各类型格式化，返回 { type, value } 或 null
    const tryAutoFormat = (text) => {
      for (const type of order) {
        try {
          let value;
          if (type === 'json') value = EditorCore.formatJson(text, false);
          else if (type === 'xml') value = EditorCore.formatXml(text, false);
          else if (type === 'sql') value = EditorCore.formatSql(text, 'sql');
          else continue;
          return { type, value };
        } catch (e) { /* 该类型解析失败，继续尝试下一种 */ }
      }
      return null;
    };

    const scope = target.selection ? '选区' : '全文';
    let result = tryAutoFormat(target.text);
    if (!result) {
      // 兜底：合并被客户端截断的行末换行后重试一次
      const joined = target.text.replace(/\r\n|\r|\n/g, '');
      if (joined.length !== target.text.length) {
        const retry = tryAutoFormat(joined);
        if (retry) {
          const removed = target.text.length - joined.length;
          mainEditor.session.replace(target.range, retry.value);
          showToast(`${scope}已按 ${retry.type.toUpperCase()} 格式化（自动识别，已合并 ${removed} 个行末换行符）`, false, 'info');
          FrontendLogger.info('[Editor] Auto-format(joined) success', { type: retry.type, selection: target.selection, removed });
          return;
        }
      }
    }
    if (result) {
      mainEditor.session.replace(target.range, result.value);
      showToast(`${scope}已按 ${result.type.toUpperCase()} 格式化（自动识别）`, false, 'success');
      FrontendLogger.info('[Editor] Auto-format success', { type: result.type, selection: target.selection });
      return;
    }
    showToast('自动格式化失败：未能识别为 JSON、XML 或 SQL（可尝试「删除每行末换行符」后重试）', true);
    FrontendLogger.warn('[Editor] Auto-format failed', { selection: target.selection });
  }

  /**
   * 删除每行末尾换行符：将客户端截断的多行日志合并为整行，便于后续格式化（JSON/SQL等）。
   * 有选中处理选中，无选中处理全文。实际把所有换行符移除（每行仅末尾有换行），
   * 兼容 \r\n / \r / \n 三种行尾。
   */
  function joinLineEnds() {
    const target = getTargetRangeAndText();
    if (target.text.length > MAX_TRANSFORM_LENGTH) {
      showToast('内容超过 5 MB，已阻止本次操作', true);
      return;
    }
    const joined = target.text.replace(/\r\n|\r|\n/g, '');
    if (joined.length === target.text.length) {
      showToast('没有可删除的换行符', true);
      return;
    }
    mainEditor.session.replace(target.range, joined);
    showToast(`${target.selection ? '选中' : '全文'}:已删除每行末尾的换行符（${target.text.length - joined.length} 个）`);
    FrontendLogger.info('[Editor] joinLineEnds', { selection: target.selection, removed: target.text.length - joined.length });
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
    const target = sharedState.transformTarget;
    mainEditor.session.replace(target.range, elements.transformPreview.value);
    closeTransformPanel();
    // 反馈替换成功数量：一次替换原文对应 1 处；并区分作用于「选中选区」还是「全文」便于用户确认范围
    const count = 1;
    showToast(`已替换${target.selection ? '选中内容' : '全文'}（成功 ${count} 处）`);
    FrontendLogger.info('[Editor] applyTransform', { selection: target.selection, operation, count });
  }

  /**
   * 切换 Markdown 预览模式
   */
  let markdownRenderTimer = null;
  let mdPreviewLastHash = ''; // Phase 3：预览重绘去重（内容未变不重绘）

  // ── Markdown 预览分屏：卷动宽度兜底常量与函数。必须放在 IIFE 顶层（与 toggleMarkdownPreview 同作用域），
  //    否则嵌套在 initializeAiChat 内会造成 toggleMarkdownPreview → applyMdSplitRatio ReferenceError → 预览空白。
  const MD_SPLIT_MIN_PX = 230;       // 兜底：任一侧最窄 230px，菜单/内容字体不被收没
  const MD_SPLIT_KEY = 'md_preview_split_v1';
  function getMdSplitRatio() {
    let r = 0.5;
    try { r = parseFloat(localStorage.getItem(MD_SPLIT_KEY)) || 0.5; } catch (e) {}
    return Math.max(0.28, Math.min(0.72, r));
  }
  // 按占比把抽屉宽度写入 --md-drawer-width；drawer 为预览抽屉占视觉的份额。
  // 兜底：clamp 到 [MD_SPLIT_MIN_PX, 容器宽-MD_SPLIT_MIN_PX]，编辑区最窄也保留 230px
  function applyMdSplitRatio(ratio, persist) {
    const ws = elements.editorWorkspace;
    if (!ws || !ws.classList.contains('markdown-preview')) return;
    ratio = Math.max(0.28, Math.min(0.72, ratio));
    if (persist) { try { localStorage.setItem(MD_SPLIT_KEY, String(ratio)); } catch (e) {} }
    const w = ws.clientWidth || 1000;
    const maxDrawer = Math.max(MD_SPLIT_MIN_PX, w - MD_SPLIT_MIN_PX);
    const drawer = Math.max(MD_SPLIT_MIN_PX, Math.min(maxDrawer, Math.round(w * ratio)));
    ws.style.setProperty('--md-drawer-width', drawer + 'px');
  }
  function resetMdSplitGrid() {
    const ws = elements.editorWorkspace;
    ws.style.removeProperty('--md-drawer-width');
    ws.classList.remove('md-resizing');
  }

  function toggleMarkdownPreview(forceOpen) {
    const shouldOpen = forceOpen !== undefined ? forceOpen : elements.markdownPane.hidden;
    if (shouldOpen && isPaneOpen(elements.aiChatPane)) setAiChatPanelOpen(false);

    // 关闭预览时需先退出预览全屏态：pane 一旦 hidden，toggleMarkdownFullscreen 的守卫会提前返回，导致
    // markdown-fullscreen 类残留、main-pane 持续 display:none，画布变空白
    if (!shouldOpen && markdownFullscreen) {
      toggleMarkdownFullscreen(false);
    }

    elements.markdownPane.hidden = !shouldOpen;
    elements.editorWorkspace.classList.toggle('markdown-preview', shouldOpen);
    elements.markdownBtn.classList.toggle('active', shouldOpen);
    updateStartWritingGuide();
    // 分屏宽度：进入时套用上次比例，退出时清掉 inline grid，避免残留影响其它布局
    if (shouldOpen) applyMdSplitRatio(getMdSplitRatio(), false);
    else resetMdSplitGrid();

    // 进入 Markdown 预览时退出对比模式
    if (shouldOpen && !elements.comparePane.hidden) {
      toggleCompare(false);
    }

    if (shouldOpen) {
      renderMarkdownPreview();
      // 监听编辑器内容变化，同步更新预览
      mainEditor.session.on('change', scheduleMarkdownRender);
    } else {
      mainEditor.session.off('change', scheduleMarkdownRender);
    }

    setTimeout(() => mainEditor.resize(), 0);
  }

  // ── Markdown 预览全屏：浮动抽屉（反链/大纲/标签）横向拖动 ──
  const FLOATING_DRAWER_IDS = ['backlinksPane', 'outlinePane', 'tagsPane'];

  // 横向偏移（负数=向左移）写入 CSS 变量 --md-off；transform 仅在
  // markdown-fullscreen 悬浮覆盖规则中引用该变量，退出全屏即归位，不影响其余布局。
  // 变量写入 workspace（公共祖先）而非抽屉元素自身，使兄弟节点 markdown-pane
  // 的 right 让位规则也能读到（全屏抽屉打开时预览区让位滚动条）。
  function resetFloatingDrawers() {
    if (elements.editorWorkspace) elements.editorWorkspace.style.removeProperty('--md-off');
    FLOATING_DRAWER_IDS.forEach(id => {
      const pane = document.getElementById(id);
      if (pane) pane.style.removeProperty('--md-off');
    });
  }

  let floatingDrawerDragReady = false;
  function ensureFloatingDrawerDrag() {
    if (floatingDrawerDragReady) return;
    floatingDrawerDragReady = true;
    FLOATING_DRAWER_IDS.forEach(id => {
      const pane = document.getElementById(id);
      const header = pane && pane.querySelector('.filetree-header');
      if (header) header.addEventListener('pointerdown', onFloatingDrawerDragStart);
    });
  }

  function onFloatingDrawerDragStart(e) {
    if (e.button !== 0) return;
    // 头部按钮/tabs 保留点击行为，不触发拖动
    if (e.target.closest('button, [role="tab"], a, input, select')) return;
    const header = e.currentTarget;
    const pane = header.closest('.editor-pane');
    const ws = elements.editorWorkspace;
    if (!pane || !ws.classList.contains('markdown-fullscreen')) return;
    if (pane.getAttribute('aria-hidden') !== 'false') return;
    const startX = e.clientX;
    const startOff = parseFloat(ws.style.getPropertyValue('--md-off')) || 0;
    // 允许拖到最左，左右各留 12px 边距，不拖出可视区
    const minOff = Math.min(0, -(ws.getBoundingClientRect().width - pane.getBoundingClientRect().width - 24));
    if (header.setPointerCapture) header.setPointerCapture(e.pointerId);
    const onMove = (ev) => {
      const off = Math.max(minOff, Math.min(0, startOff + (ev.clientX - startX)));
      ws.style.setProperty('--md-off', off + 'px');
    };
    const onUp = () => {
      header.removeEventListener('pointermove', onMove);
      header.removeEventListener('pointerup', onUp);
      header.removeEventListener('pointercancel', onUp);
    };
    header.addEventListener('pointermove', onMove);
    header.addEventListener('pointerup', onUp);
    header.addEventListener('pointercancel', onUp);
  }

  // Markdown 预览全屏：预览独占工作区（编辑区等隐藏），反链/大纲/标签可唤起为右侧悬浮层
  let markdownFullscreen = false;
  function toggleMarkdownFullscreen(forceOpen) {
    if (elements.markdownPane.hidden) return;
    markdownFullscreen = forceOpen !== undefined ? forceOpen : !markdownFullscreen;
    elements.editorWorkspace.classList.toggle('markdown-fullscreen', markdownFullscreen);
    if (markdownFullscreen) ensureFloatingDrawerDrag(); else resetFloatingDrawers();
    if (elements.mdFullscreenBtn) {
      elements.mdFullscreenBtn.textContent = markdownFullscreen ? '退出全屏' : '⛶ 全屏';
      elements.mdFullscreenBtn.title = markdownFullscreen ? '退出预览全屏 (Esc)' : '预览全屏';
    }
    setTimeout(() => mainEditor.resize(), 0);
  }

  let lastMdChangeAt = 0;
  function scheduleMarkdownRender() {
    // A1：中文输入法组合期间暂停渲染，compositionend 后再补一次
    if (isComposing()) return;
    // A3：自适应防抖——连续击键拉长到 500ms，停顿 200ms 即渲染
    var now = Date.now();
    var gap = now - lastMdChangeAt;
    lastMdChangeAt = now;
    clearTimeout(markdownRenderTimer);
    var delay = featureOn('mdAdaptiveDebounce') ? (gap < 80 ? 500 : 200) : 300;
    markdownRenderTimer = setTimeout(renderMarkdownPreview, delay);
  }

  function renderMarkdownPreview() {
    const text = mainEditor.getValue();
    // Phase 3：内容未变化时不重绘（等值输入/切换标签经过时避免无谓 innerHTML 重建）
    if (featureOn('mdPreviewDiff') && typeof mdPreviewLastHash === 'string') {
      if (mdPreviewLastHash === text) return;
    }
    mdPreviewLastHash = text;
    if (!text.trim()) {
      elements.markdownBody.innerHTML = '<p style="color:var(--app-text-muted);padding:2em 0;text-align:center;">暂无内容</p>';
      return;
    }
    try {
      // 图文一体：marked → 白名单消毒 → 图片重写（media/ 相对路径 → /api/media/...）
      elements.markdownBody.innerHTML = window.MediaKit.render.renderMarkdown(text);
      // 双链状态标注（命中/缺失）与点击跳转已由 markdownBody 委托处理
      markWikilinkStatus();
      // Mermaid 流程图异步渲染（` ```mermaid ` 代码块 → SVG）
      if (window.MediaKit.render.renderMermaid) {
        window.MediaKit.render.renderMermaid(elements.markdownBody);
      }
    } catch (error) {
      elements.markdownBody.innerHTML = '<p style="color:var(--app-danger);">渲染失败：' + error.message + '</p>';
    }
    // B1：渲染完成后按当前编辑滚动比例重新对齐预览
    if (featureOn('previewScrollFollow') && mdFollowEnabled) requestAnimationFrame(syncMarkdownPreviewScroll);
  }

  // ── B1：Markdown 预览滚动跟随（编辑区滚动 → 预览按比例同步）──
  var mdFollowEnabled = true;
  function syncMarkdownPreviewScroll() {
    if (!featureOn('previewScrollFollow')) return;
    if (!mdFollowEnabled || elements.markdownPane.hidden) return;
    if (isComposing()) return;
    var body = elements.markdownBody;
    if (!body) return;
    // 用可见行区间估算滚动比例（兼容 wrap，无需内部最大滚动值）
    var first = mainEditor.session.getFirstVisibleRow();
    var last = mainEditor.session.getLastVisibleRow();
    var total = mainEditor.session.getLength();
    if (!total) return;
    var ratio = (first + (last - first) / 2) / total;
    var maxBody = body.scrollHeight - body.clientHeight;
    if (maxBody <= 0) return;
    body.scrollTop = Math.min(maxBody, ratio * maxBody);
  }
  function toggleMdFollow() {
    mdFollowEnabled = !mdFollowEnabled;
    if (elements.mdFollowBtn) {
      elements.mdFollowBtn.classList.toggle('active', mdFollowEnabled);
      elements.mdFollowBtn.textContent = mdFollowEnabled ? '跟随' : '跟随关';
    }
    if (mdFollowEnabled) syncMarkdownPreviewScroll();
  }
  mainEditor.session.on('changeScrollTop', syncMarkdownPreviewScroll);
  if (elements.mdFollowBtn) elements.mdFollowBtn.addEventListener('click', toggleMdFollow);

  // ── C4：抽屉面板入场动效统一（打开时内容淡入轻滑，与悬浮层过渡风格一致）──
  (function initPaneEnterAnimation() {
    if (!featureOn('paneEnterAnim') || !elements.editorWorkspace) return;
    var paneIds = ['fileTreePane', 'historyPane', 'recentPane', 'favPane', 'backlinksPane', 'outlinePane', 'tagsPane'];
    var observer = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        if (m.type === 'attributes' && m.attributeName === 'aria-hidden' && m.target.getAttribute('aria-hidden') === 'false') {
          var pane = m.target;
          pane.classList.remove('pane-enter');
          void pane.offsetWidth; // 强制 reflow 重启动画
          pane.classList.add('pane-enter');
        }
      });
    });
    paneIds.forEach(function (id) {
      var pane = document.getElementById(id);
      if (pane) observer.observe(pane, { attributes: true, attributeFilter: ['aria-hidden'] });
    });
  })();

  // ── E1：容器尺寸变化即时 resize（抽屉开合/分屏调整瞬间消除错位闪烁）──
  (function initResizeObserver() {
    if (!featureOn('resizeObserver') || typeof ResizeObserver === 'undefined') return;
    var target = elements.editorWorkspace;
    if (!target) return;
    var ro = new ResizeObserver(function () {
      mainEditor.resize(true);
      if (elements.comparePane && !elements.comparePane.hidden) compareEditor.resize(true);
    });
    ro.observe(target);
    window.__editorResizeObserver = ro;
  })();

  async function toggleCompare(forceOpen) {
    const shouldOpen = forceOpen !== undefined ? forceOpen : elements.comparePane.hidden;
    if (shouldOpen && isPaneOpen(elements.aiChatPane)) setAiChatPanelOpen(false);
    elements.comparePane.hidden = !shouldOpen;
    elements.compareToolbar.classList.toggle('is-open', shouldOpen);
    elements.compareToolbar.setAttribute('aria-hidden', String(!shouldOpen));
    elements.editorWorkspace.classList.toggle('comparing', shouldOpen);
    elements.compareBtn.classList.toggle('active', shouldOpen);
    updateStartWritingGuide();
    // 进入对比模式时退出 Markdown 预览
    if (shouldOpen && !elements.markdownPane.hidden) {
      toggleMarkdownPreview(false);
    }
    // 打开时同步对比内容：若对比区为空，或上次内容只是自动快照（用户未手动载入剪贴板/文件），
    // 则刷新为当前文档快照，避免复用陈旧快照把整个文档误判为差异、出现整屏红绿底色块（Bug 修复）。
    if (shouldOpen) {
      const manualTarget = sharedState.compareSource === 'clipboard' || sharedState.compareSource === 'file';
      if (!compareEditor.getValue() || !manualTarget) {
        compareEditor.setValue(mainEditor.getValue(), -1);
        elements.compareFileName.textContent = '当前文档快照';
        sharedState.compareSource = 'snapshot';
      }
    }
    if (!shouldOpen) {
      clearMarkers(mainEditor, sharedState.diffMarkers.main);
      clearMarkers(compareEditor, sharedState.diffMarkers.compare);
      clearMarkers(mainEditor, sharedState.diffWordMarkers.main);
      clearMarkers(compareEditor, sharedState.diffWordMarkers.compare);
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

  function getAiChatWidth() {
    const stored = Number(localStorage.getItem(AI_CHAT_WIDTH_KEY));
    return Number.isFinite(stored) ? Math.max(280, Math.min(560, stored)) : 360;
  }

  function setAiChatWidth(width, persist) {
    const normalized = Math.max(280, Math.min(560, Math.round(width)));
    elements.editorWorkspace.style.setProperty('--ai-chat-width', `${normalized}px`);
    if (persist) localStorage.setItem(AI_CHAT_WIDTH_KEY, String(normalized));
    setTimeout(() => mainEditor.resize(), 0);
  }

  function setPetState(nextState) {
    if (!elements.aiPetBtn) return;
    elements.aiPetBtn.classList.remove('thinking', 'happy', 'error', 'sleeping');
    if (nextState !== 'idle') elements.aiPetBtn.classList.add(nextState);
    elements.aiPetBtn.title = nextState === 'thinking' ? '小记正在思考回答' : nextState === 'sleeping' ? '小记正在打盹，点击唤醒' : '打开小记';
    clearTimeout(petIdleTimer);
    if (nextState === 'idle') {
      petIdleTimer = setTimeout(() => setPetState('sleeping'), 2 * 60 * 1000);
    }
    // 根据状态切换对应的动作图片（thinking→think, happy→celebrate, sleeping→sleep）
    updatePetActionImage(nextState);
    // 状态气泡联动（thinking→正在想，idle→低频问候）
    updatePetBubbleState(nextState);
  }

  function updatePetActionImage(state) {
    try {
      const config = JSON.parse(localStorage.getItem('cut_shelter_mascot_v1') || '{}');
      // 状态 ↔ 动作映射：状态机状态 → 预设动作名称
      const stateToAction = {
        thinking: 'think',
        happy: 'celebrate',
        sleeping: 'sleep',
        error: config.action || 'run',
        idle: config.action || 'run'
      };
      const action = stateToAction[state] || 'run';
      const img = elements.aiPetBtn.querySelector('.ai-pet-image');
      if (!img) return; // 内联 SVG 无需切换图片
      elements.aiPetBtn.dataset.action = action;
      if (config.iconType === 'preset-images' && config.iconId) {
        img.src = `assets/mascot/${config.iconId}/${action}.png`;
      } else if (config.iconType === 'upload' && config.iconDataUrls) {
        const uploads = config.iconDataUrls;
        const isLegacy = Object.keys(uploads).some(k => ['run', 'wave', 'jump', 'think', 'sleep', 'celebrate'].includes(k));
        const charUploads = isLegacy ? uploads : (uploads[config.iconId] || {});
        img.src = charUploads[action] || (config.iconId ? `assets/mascot/${config.iconId}/${action}.png` : img.src);
      }
    } catch (_) {}
  }
  // ── Pet 快捷操作（Quick-menu）与在场气泡 ──
  // 复用统一发送入口 sendAiMessage；快捷操作基于当前选区/光标行文本触发。

  const PET_GREETINGS = [
    '需要我帮你看看这段吗？',
    '想让我解释、润色还是翻译？',
    '有拿不准的地方，问我就行',
    '选中一段文字，我能帮你总结要点'
  ];

  function openPetQuickMenu() {
    if (!elements.aiPetQuickMenu || petQuickMenuOpen) return;
    petQuickMenuOpen = true;
    const rect = elements.aiPetBtn.getBoundingClientRect();
    const menu = elements.aiPetQuickMenu;
    menu.hidden = false;
    const menuW = menu.offsetWidth || 160;
    const menuH = menu.offsetHeight || 220;
    let left = rect.left + rect.width / 2 - menuW / 2;
    let top = rect.top - menuH - 10;
    if (left < 8) left = 8;
    if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
    if (top < 8) top = rect.bottom + 10; // 上方放不下时翻转到下方
    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
  }

  function closePetQuickMenu() {
    if (!elements.aiPetQuickMenu) return;
    petQuickMenuOpen = false;
    elements.aiPetQuickMenu.hidden = true;
  }

  // 目标文本：优先选区，无选区取光标所在行；都没有返回空串
  function getPetTargetText() {
    const selectedText = mainEditor.getSelectedText();
    if (selectedText && selectedText.trim()) return selectedText.trim().slice(0, 2000);
    const cursor = mainEditor.getCursorPosition();
    const row = Math.max(0, cursor.row || 0);
    const line = mainEditor.session.getLine(row);
    if (line && line.trim()) return line.trim().slice(0, 2000);
    return '';
  }

  function executePetQuickAction(action) {
    closePetQuickMenu();
    const target = getPetTargetText();
    if (!target) {
      showToast('没有可分析的内容，请在编辑器中先选中或定位文本', true);
      return;
    }
    const prompts = {
      explain: '请通俗解释以下内容：',
      polish: '请润色以下文本，保持原意：',
      translate: '请把以下内容翻译成英文：',
      summarize: '请用要点概括以下内容：',
      search: '一句话描述以下内容：'
    };
    const prefix = prompts[action] || '请分析以下内容：';
    sendAiMessage(prefix + target);
  }

  function showPetBubble(text) {
    if (!elements.aiPetBubble || !elements.aiPetBtn) return;
    elements.aiPetBubble.textContent = text;
    const rect = elements.aiPetBtn.getBoundingClientRect();
    const bubble = elements.aiPetBubble;
    bubble.hidden = false;
    const bubW = bubble.offsetWidth || 0;
    const bubH = bubble.offsetHeight || 24;
    let left = rect.left + rect.width / 2 - bubW / 2;
    let top = rect.top - bubH - 10;
    if (left < 8) left = 8;
    if (left + bubW > window.innerWidth - 8) left = window.innerWidth - bubW - 8;
    if (top < 8) top = rect.bottom + 10; // 上方放不下时翻转到下方
    bubble.style.left = Math.round(left) + 'px';
    bubble.style.top = Math.round(top) + 'px';
  }

  function hidePetBubble() {
    if (!elements.aiPetBubble) return;
    elements.aiPetBubble.hidden = true;
  }

  function scheduleIdleGreeting() {
    clearTimeout(petBubbleTimer);
    petBubbleTimer = setTimeout(function() {
      if (petQuickMenuOpen) { scheduleIdleGreeting(); return; }
      if (elements.aiPetBubble && elements.aiPetBubble.hidden === false) { scheduleIdleGreeting(); return; }
      const randomGreet = PET_GREETINGS[Math.floor(Math.random() * PET_GREETINGS.length)];
      showPetBubble(randomGreet);
      clearTimeout(petBubbleTimer);
      petBubbleTimer = setTimeout(function() {
        hidePetBubble();
        scheduleIdleGreeting();
      }, 3500);
    }, 25000);
  }

  function updatePetBubbleState(state) {
    clearTimeout(petBubbleTimer);
    if (state === 'thinking') {
      showPetBubble('正在想…');
    } else if (state === 'happy' || state === 'error' || state === 'sleeping') {
      hidePetBubble();
    } else {
      scheduleIdleGreeting(); // idle：低频问候
    }
  }
  setPetState('idle');

  // 面板开关统一辅助：aria-hidden + workspace 类 + 抽屉动画结束后 resize
  function isPaneOpen(pane) {
    return pane.getAttribute('aria-hidden') !== 'true';
  }

  function setAiChatPanelOpen(open) {
    if (open) {
      if (!elements.comparePane.hidden) toggleCompare(false);
      if (!elements.markdownPane.hidden) toggleMarkdownPreview(false);
      setAiChatWidth(getAiChatWidth(), false);
    }
    elements.aiChatPane.setAttribute('aria-hidden', String(!open));
    elements.editorWorkspace.classList.toggle('show-ai-chat', open);
    if (elements.aiPetBtn) elements.aiPetBtn.classList.toggle('active', open);
    if (open) {
      renderAiChat();
      setTimeout(() => {
        mainEditor.resize();
        elements.aiChatInput.focus();
      }, 250);
    } else {
      setTimeout(() => mainEditor.resize(), 250);
    }
  }

  function toggleAiChatPanel() {
    setPetState('idle');
    setAiChatPanelOpen(!isPaneOpen(elements.aiChatPane));
  }

  function escapeAiHtml(value) {
    const node = document.createElement('div');
    node.textContent = value || '';
    return node.innerHTML;
  }

  function sanitizeAiHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll('script,style,iframe,object,embed,form').forEach(node => node.remove());
    template.content.querySelectorAll('*').forEach(node => {
      Array.from(node.attributes).forEach(attribute => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim().toLowerCase();
        if (name.startsWith('on') || ((name === 'href' || name === 'src') && value.startsWith('javascript:'))) {
          node.removeAttribute(attribute.name);
        }
      });
    });
    return template.innerHTML;
  }

  // ══════════════════════════════════════════════════════════
  // AI 代码块操作按钮（Phase 1）
  // ══════════════════════════════════════════════════════════

  /**
   * 转义 HTML 属性值
   */
  function escapeAttr(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * 渲染 AI 代码块，附带操作按钮
   */
  function renderAiCodeBlock(code, language, messageId) {
    const escapedCode = escapeAiHtml(code);
    const escapedLang = escapeAiHtml(language || 'text');
    const dataMsgId = escapeAttr(messageId || '');
    const dataCode = escapeAttr(code);
    return '<div class="ai-code-block" data-message-id="' + dataMsgId + '">'
      + '<div class="ai-code-block-header">'
      + '<span class="ai-code-block-lang">' + escapedLang + '</span>'
      + '<div class="ai-code-block-actions">'
      + '<button class="ai-code-btn" data-action="apply" data-code="' + dataCode + '" title="用 AI 代码替换整个编辑器内容">应用到编辑器</button>'
      + '<button class="ai-code-btn" data-action="insert" data-code="' + dataCode + '" title="在光标位置插入">插入到光标</button>'
      + '<button class="ai-code-btn" data-action="replace-selection" data-code="' + dataCode + '" title="用 AI 代码替换当前选中内容">替换选中</button>'
      + '<button class="ai-code-btn" data-action="diff" data-code="' + dataCode + '" title="对比差异后审批">查看差异</button>'
      + '</div>'
      + '</div>'
      + '<pre><code class="language-' + escapedLang + '">' + escapedCode + '</code></pre>'
      + '</div>';
  }

  /**
   * 在 Markdown 渲染后的 HTML 中查找代码块并添加操作按钮
   * 仅对非 streaming（已完成）的消息做处理
   */
  function enhanceAiHtmlWithCodeBlocks(html, messageId) {
    if (!html || !messageId) return html;
    // 匹配 <pre><code class="language-XXX"> 或 <pre><code> 的内容块
    return html.replace(
      /<pre><code(?:\s+class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g,
      function(match, language, code) {
        var lang = language || 'text';
        // 解码 HTML 实体以获取原始代码
        var decoded = code
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
        return renderAiCodeBlock(decoded, lang, messageId);
      }
    );
  }

  /**
   * 渲染 AI 助手消息内容（含代码块操作按钮增强）
   */
  function renderAiAssistantContent(message) {
    if (!message.content) {
      if (message.streaming) return '<span class="ai-chat-stream-cursor">▍</span>';
      return '<span class="ai-chat-cancelled">已停止生成</span>';
    }
    if (!window.marked || typeof window.marked.parse !== 'function') {
      return escapeAiHtml(message.content);
    }
    var html = sanitizeAiHtml(window.marked.parse(message.content));
    // 仅对已完成的消息添加代码块操作按钮
    if (!message.streaming && message.id) {
      html = enhanceAiHtmlWithCodeBlocks(html, message.id);
    }
    return html;
  }

  function renderAiChat() {
    if (!elements.aiChatMessages || !window.EditorAiChatCore) return;
    if (!state) {
      elements.aiChatMessages.innerHTML = '<div class="ai-chat-empty">打开一个编辑标签后开始对话。</div>';
      return;
    }
    const chat = ensureAiChatState(state);
    if (!chat.messages.length) {
      elements.aiChatMessages.innerHTML = '<div class="ai-chat-empty">你好，我可以解释术语、分析文本或协助处理当前编辑内容。</div>';
    } else {
      elements.aiChatMessages.innerHTML = chat.messages.map(message => {
        const content = message.role === 'assistant'
          ? renderAiAssistantContent(message)
          : escapeAiHtml(message.content);
        const copy = message.role === 'assistant' && message.content && !message.streaming
          ? `<button class="ai-chat-copy" data-copy-message-id="${escapeAiHtml(message.id)}">复制</button>` : '';
        const error = message.error ? `<div class="ai-chat-message-error">${escapeAiHtml(message.error)}</div>` : '';
        return `<div class="ai-chat-message ${message.role}">
          <div class="ai-chat-bubble">${content}</div>${error}${copy}
        </div>`;
      }).join('');
      elements.aiChatMessages.querySelectorAll('[data-copy-message-id]').forEach(button => {
        button.addEventListener('click', async () => {
          try {
            const message = chat.messages.find(item => item.id === button.dataset.copyMessageId);
            await navigator.clipboard.writeText(message ? message.content : '');
            showToast('AI 回答已复制');
          } catch (error) {
            showToast('复制 AI 回答失败', true);
          }
        });
      });
    }
    const status = chat.status === 'streaming' ? '思考中…' : chat.status === 'error' ? '发生错误' : '就绪';
    elements.aiChatStatus.className = `ai-chat-status ${chat.status}`;
    const statusTextEl = elements.aiChatStatus.querySelector('.ai-chat-status-text');
    if (statusTextEl) statusTextEl.textContent = status;
    const busy = Boolean(chat.activeRequestId);
    elements.aiChatSendBtn.hidden = busy;
    elements.aiChatStopBtn.hidden = !busy;
    elements.aiChatInput.disabled = busy;
    elements.aiChatMessages.scrollTop = elements.aiChatMessages.scrollHeight;
  }

  // ══════════════════════════════════════════════════════════
  // Phase 2: 选中感知 AI 交互
  // ══════════════════════════════════════════════════════════

  /**
   * 编辑器选中状态快照
   */
  var selectionState = { text: '', contextBefore: '', contextAfter: '', range: null };

  /**
   * 更新选中状态（由编辑器 selection change 事件触发）
   */
  function updateSelectionState() {
    if (!mainEditor) return;
    var selectedText = mainEditor.getSelectedText();
    if (!selectedText) {
      selectionState = { text: '', contextBefore: '', contextAfter: '', range: null };
      updateAiSelectionHint(false, '');
      return;
    }
    var range = mainEditor.getSelectionRange();
    var content = mainEditor.getValue();
    var lines = content.split('\n');
    var beforeLines = lines.slice(Math.max(0, range.start.row - 5), range.start.row);
    var afterLines = lines.slice(range.end.row + 1, range.end.row + 6);
    selectionState = {
      text: selectedText.slice(0, 2000),
      contextBefore: beforeLines.join('\n').slice(-500),
      contextAfter: afterLines.join('\n').slice(0, 500),
      range: range
    };
    updateAiSelectionHint(true, selectedText.slice(0, 50) + (selectedText.length > 50 ? '…' : ''));
  }

  /**
   * 更新 AI 面板选中提示条
   */
  function updateAiSelectionHint(visible, text) {
    if (!elements.aiChatSelectionHint) return;
    if (visible && text) {
      elements.aiChatSelectionHint.classList.add('visible');
      elements.aiChatSelectionHintText.textContent = '已选中: ' + text;
    } else {
      elements.aiChatSelectionHint.classList.remove('visible');
      elements.aiChatSelectionHintText.textContent = '';
    }
  }

  // 监听编辑器选中变化
  mainEditor.selection.addEventListener('changeSelection', function() {
    updateSelectionState();
  });

  /**
   * 构建附带选中上下文信息的 AI 提示词
   */
  function buildContextualPrompt(userMessage) {
    var sel = selectionState;
    if (!sel.text) return userMessage;
    var context = [];
    context.push('当前选中文本：\n```\n' + sel.text.slice(0, 2000) + '\n```');
    if (sel.contextBefore) {
      context.push('选中前上下文：\n```\n' + sel.contextBefore + '\n```');
    }
    if (sel.contextAfter) {
      context.push('选中后上下文：\n```\n' + sel.contextAfter + '\n```');
    }
    context.push('---\n用户请求：' + userMessage);
    return context.join('\n\n');
  }

  // ══════════════════════════════════════════════════════════
  // Phase 3: AI 内容应用到编辑器 + 差异对比审批
  // ══════════════════════════════════════════════════════════

  /**
   * 记录 AI 操作到历史（供撤销/重做使用）
   * 利用 ACE 编辑器的 undo 栈：执行操作后标记文档已修改，
   * ACE 的 undo 管理器会自动记录操作，用户可按 Ctrl+Z 撤销
   */
  function recordAiOperation(mode, oldContent, newContent, label) {
    if (!state) return;
    // 触发 ACE 的 change 事件以记录 undo 快照
    mainEditor.session.getUndoManager().markClean();
    state.modified = true;
    updateDocumentIdentity();
    // 记录到控制台日志，便于调试
    var opLabel = label || 'AI 操作';
    console.log('[AI操作] ' + opLabel + ' (' + mode + '): ' + (newContent.length || 0) + ' 字符');
  }

  /**
   * 打开 AI 差异对比预览弹窗
   * @param {Range|null} range - 要替换的选区范围，null 表示全文替换
   * @param {string} newContent - AI 生成的新内容
   */
  function openAiDiffPreview(range, newContent) {
    var oldContent = '';
    if (range) {
      oldContent = mainEditor.session.getTextRange(range);
    } else {
      oldContent = mainEditor.getValue();
    }
    // 填充差异对比弹窗内容
    var originalEl = document.getElementById('originalContent');
    var aiContentEl = document.getElementById('aiContent');
    if (originalEl && aiContentEl) {
      originalEl.textContent = oldContent;
      aiContentEl.textContent = newContent;
      // 简单行级差异高亮
      var oldLines = oldContent.split('\n');
      var newLines = newContent.split('\n');
      originalEl.innerHTML = oldLines.map(function(line, i) {
        var isDiff = i >= newLines.length || line !== newLines[i];
        return isDiff ? '<div class="diff-removed">' + escapeAiHtml(line) + '</div>'
                      : '<div>' + escapeAiHtml(line) + '</div>';
      }).join('');
      aiContentEl.innerHTML = newLines.map(function(line, i) {
        var isDiff = i >= oldLines.length || line !== oldLines[i];
        return isDiff ? '<div class="diff-added">' + escapeAiHtml(line) + '</div>'
                      : '<div>' + escapeAiHtml(line) + '</div>';
      }).join('');
    }
    // 存储 diff 上下文供接受按钮使用
    document.getElementById('aiDiffModal').dataset.range = range ? JSON.stringify({start: range.start, end: range.end}) : '';
    // 打开弹窗
    document.getElementById('aiDiffModal').classList.add('is-visible');
    showToast('请审阅 AI 差异对比后点击"接受修改"');
  }

  /**
   * 将 AI 内容应用到编辑器
   * @param {string} content - AI 生成的代码内容
   * @param {string} mode - 应用模式：'replace'（全文替换）、'insert'（插入到光标）、'selection'（替换选中）
   * @param {object} options - 可选配置
   */
  function applyAiContent(content, mode, options) {
    options = options || {};
    var showDiff = options.showDiff !== false;
    if (mode === 'insert') {
      var cursor = mainEditor.getCursorPosition();
      mainEditor.session.insert(cursor, content);
      recordAiOperation('insert', '', content, 'AI 插入内容');
      showToast('AI 内容已插入到光标位置');
      return;
    }
    if (mode === 'selection') {
      var range = mainEditor.getSelectionRange();
      if (range.isEmpty()) {
        showToast('请先在编辑器中选择要替换的文本', true);
        return;
      }
      if (showDiff) {
        openAiDiffPreview(range, content);
      } else {
        var oldSel = mainEditor.session.getTextRange(range);
        mainEditor.session.replace(range, content);
        recordAiOperation('replace_selection', oldSel, content, 'AI 替换选中');
        showToast('AI 内容已替换选中文本');
      }
      return;
    }
    // mode === 'replace'（全文替换）
    if (showDiff) {
      openAiDiffPreview(null, content);
    } else {
      var oldContent = mainEditor.getValue();
      mainEditor.session.setValue(content);
      recordAiOperation('replace', oldContent, content, 'AI 全文替换');
      showToast('AI 内容已应用到编辑器');
    }
  }

  // ══════════════════════════════════════════════════════════
  // 代码块操作按钮事件处理
  // ══════════════════════════════════════════════════════════

  /**
   * 处理 AI 代码块按钮点击事件（事件委托）
   */
  function handleAiCodeBlockAction(event) {
    var button = event.target.closest('.ai-code-btn');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    var action = button.dataset.action;
    var code = button.dataset.code;
    if (!code) { showToast('无法获取代码内容', true); return; }
    switch (action) {
      case 'apply':
        applyAiContent(code, 'replace', { showDiff: true });
        break;
      case 'insert':
        applyAiContent(code, 'insert');
        break;
      case 'replace-selection':
        applyAiContent(code, 'selection', { showDiff: true });
        break;
      case 'diff':
        applyAiContent(code, 'replace', { showDiff: true });
        break;
      default:
        showToast('未知操作: ' + action, true);
    }
  }

  function updateAiChatState(tab, action) {
    tab.aiChat = window.EditorAiChatCore.reduce(ensureAiChatState(tab), action);
    if (tab === state) renderAiChat();
  }

  function finishAiRequest(request, action, petState) {
    updateAiChatState(request.tab, action);
    if (activeAiRequest === request) activeAiRequest = null;
    if (request.tab === state) {
      setPetState(petState);
      if (petState === 'happy') setTimeout(() => {
        if (!activeAiRequest) setPetState('idle');
      }, 1800);
    }
  }

  function cancelAiRequest() {
    const request = activeAiRequest;
    if (!request) return;
    request.controller.abort();
    finishAiRequest(request, { type: 'cancel', assistantId: request.assistantId }, 'idle');
  }

  async function sendAiMessage(rawMessage) {
    const message = String(rawMessage || '').trim();
    if (!message || !state) return;
    if (activeAiRequest) {
      pendingDictAdd = null;
      return;
    }
    // 将当前 pendingDictAdd 捕获到 request 对象上，避免后续调用覆盖
    var capturedPendingAdd = pendingDictAdd;
    pendingDictAdd = null;
    setAiChatPanelOpen(true);

    const request = {
      tab: state,
      requestId: `editor-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      userId: `user-${Date.now()}`,
      assistantId: `assistant-${Date.now()}`,
      controller: new AbortController(),
      completed: false,
      serverError: null,
      pendingDictAdd: capturedPendingAdd
    };
    // 若用户有选中文本，自动构建上下文提示词
    var contextualMessage = buildContextualPrompt(message);
    updateAiChatState(request.tab, {
      type: 'start',
      requestId: request.requestId,
      userId: request.userId,
      assistantId: request.assistantId,
      content: contextualMessage
    });
    activeAiRequest = request;
    elements.aiChatInput.value = '';
    setPetState('thinking');

    try {
      const response = await fetch(AI_CHAT_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          requestId: request.requestId,
          messages: window.EditorAiChatCore.toApiMessages(request.tab.aiChat)
        }),
        signal: request.controller.signal
      });
      if (!response.ok) throw new Error(`AI 服务返回 HTTP ${response.status}`);
      if (!response.body) throw new Error('AI 服务未返回流式响应');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new window.EditorAiChatCore.SseParser(event => {
        if (event.event === 'delta' && event.data && event.data.content) {
          updateAiChatState(request.tab, {
            type: 'delta', assistantId: request.assistantId, content: event.data.content
          });
        } else if (event.event === 'done' || event.raw === '[DONE]') {
          request.completed = true;
          finishAiRequest(request, { type: 'done', assistantId: request.assistantId }, 'happy');
          // 自动添加词典：AI 回复完成后，将结果存入对应词典
          var pendingAdd = request.pendingDictAdd;
          if (pendingAdd) {
            var messages = request.tab.aiChat.messages || [];
            var assistantMsg = null;
            for (var mi = messages.length - 1; mi >= 0; mi--) {
              if (messages[mi].role === 'assistant' && !messages[mi].streaming && messages[mi].content) {
                assistantMsg = messages[mi];
                break;
              }
            }
            if (assistantMsg) {
              var translation = assistantMsg.content.replace(/^["']|["']$/g, '').trim();
              if (translation) {
                if (pendingAdd.type === 'mapping') {
                  if (addUserDictEntry(pendingAdd.source, translation)) {
                    showToast('✅ 已自动添加到自定义映射: ' + pendingAdd.source + ' → ' + translation);
                  }
                } else if (pendingAdd.type === 'lib') {
                  if (addDictLibEntry(pendingAdd.source, translation)) {
                    showToast('✅ 已自动添加到词典库: ' + pendingAdd.source + ' → ' + translation);
                  }
                }
              }
            }
          }
        } else if (event.event === 'error') {
          request.serverError = event.data && event.data.message ? event.data.message : 'AI 服务调用失败';
        }
      });

      while (true) {
        const result = await reader.read();
        if (result.done) break;
        parser.push(decoder.decode(result.value, { stream: true }));
      }
      parser.push(decoder.decode());
      parser.finish();
      if (request.serverError && !request.completed) throw new Error(request.serverError);
      if (!request.completed) throw new Error('AI 流式响应未正常结束');
    } catch (error) {
      if (request.controller.signal.aborted) return;
      // 请求已成功完成（收到 done 事件），不覆盖为 error 状态
      if (request.completed) return;
      const rawMsg = error.message || '';
      const friendlyMsg = rawMsg.includes('Failed to fetch') || rawMsg.includes('fetch failed') || rawMsg.includes('NetworkError') || rawMsg.toLowerCase().includes('network error')
        ? '无法连接到 AI 服务，请检查网络或后端服务是否正常运行'
        : rawMsg || 'AI 服务调用失败';
      finishAiRequest(request, {
        type: 'error', assistantId: request.assistantId,
        message: friendlyMsg
      }, 'error');
    } finally {
      if (request.tab === state && !activeAiRequest) {
        renderAiChat();
      }
    }
  }

  function openEditorContextMenu(event) {
    event.preventDefault();
    const selectedText = mainEditor.getSelectedText();
    const hasSelection = !!selectedText.trim();
    elements.aiSearchContextBtn.hidden = !hasSelection;
    elements.smartIngestContextBtn.hidden = !hasSelection;
    elements.aiImportPasswordContextBtn.hidden = !hasSelection;
    elements.offlineTranslateContextBtn.hidden = !hasSelection;
    elements.onlineTranslateContextBtn.hidden = !hasSelection;
    elements.addCustomMappingContextBtn.hidden = !hasSelection;
    elements.addToDictLibContextBtn.hidden = !hasSelection;
    // AI 分析上下文始终可用（无选中时分析全文）
    elements.aiContextAnalysisContextBtn.hidden = false;
    // 删除每行末换行符：始终可用（无选中处理全文，有选中处理选中）
    elements.joinLineEndsContextBtn.hidden = false;
    // 管理词典始终可用
    elements.manageDictionaryContextBtn.hidden = false;
    // 插入双向链接始终可用（无需选中）
    elements.insertWikilinkContextBtn.hidden = false;
    // 自动换行：始终可用，刷新菜单项勾选状态与文字
    elements.toggleWordWrapContextBtn.hidden = false;
    if (typeof toggleWordWrapContextSync === 'function') toggleWordWrapContextSync();
    // 分隔线显隐：共3条分隔线，后2条（翻译相关）按选中状态
    const translateDivider = elements.editorContextMenu.querySelectorAll('.editor-context-divider');
    translateDivider.forEach(function(div, idx) {
      // idx 0 = 编辑操作与AI功能之间（始终可见）
      // idx 1 = AI功能与翻译功能之间（按选中状态）
      // idx 2 = 翻译功能与词典管理之间（按选中状态）
      div.hidden = (idx >= 1) ? !hasSelection : false;
    });
    elements.editorContextMenu.hidden = false;
    const menu = elements.editorContextMenu;
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const gap = 8;
    const spaceRight = window.innerWidth - event.clientX - gap;
    const spaceLeft = event.clientX - gap;
    const spaceBelow = window.innerHeight - event.clientY - gap;
    const spaceAbove = event.clientY - gap;
    // 优先按鼠标位置放置；空间不足时向上/左翻转，仍不足则贴边钳制
    let left = event.clientX;
    if (mw > spaceRight) left = (spaceLeft >= mw) ? event.clientX - mw : window.innerWidth - mw - gap;
    let top = event.clientY;
    if (mh > spaceBelow) top = (spaceAbove >= mh) ? event.clientY - mh : window.innerHeight - mh - gap;
    menu.style.left = Math.max(gap, Math.min(left, window.innerWidth - mw - gap)) + 'px';
    menu.style.top = Math.max(gap, Math.min(top, window.innerHeight - mh - gap)) + 'px';
    menu.dataset.selectedText = selectedText;
    focusContextMenu(null);
  }

  function closeEditorContextMenu() {
    elements.editorContextMenu.hidden = true;
    delete elements.editorContextMenu.dataset.selectedText;
  }

  // 右键菜单键盘导航：↑↓ 高亮、Enter 执行、Esc 关闭
  var contextMenuFocusIndex = -1;

  function focusContextMenu(index) {
    const items = elements.editorContextMenu.querySelectorAll('button[data-context-action]:not([hidden])');
    items.forEach(btn => btn.classList.remove('focused'));
    contextMenuFocusIndex = -1;
    if (index === null || !items.length) return;
    if (index < 0) index = items.length - 1;
    if (index >= items.length) index = 0;
    items[index].classList.add('focused');
    contextMenuFocusIndex = index;
  }

  document.addEventListener('keydown', function(e) {
    if (elements.editorContextMenu.hidden) return;
    const items = elements.editorContextMenu.querySelectorAll('button[data-context-action]:not([hidden])');
    if (!items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); focusContextMenu(contextMenuFocusIndex + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusContextMenu(contextMenuFocusIndex - 1); }
    else if (e.key === 'Enter') {
      if (contextMenuFocusIndex >= 0 && items[contextMenuFocusIndex]) {
        e.preventDefault();
        items[contextMenuFocusIndex].click();
      }
    }
    else if (e.key === 'Escape') { closeEditorContextMenu(); }
  });

  // 鼠标移入同步高亮
  elements.editorContextMenu.addEventListener('mouseover', function(e) {
    const btn = e.target.closest('button[data-context-action]');
    if (!btn || btn.hidden) return;
    const items = elements.editorContextMenu.querySelectorAll('button[data-context-action]:not([hidden])');
    focusContextMenu(Array.prototype.indexOf.call(items, btn));
  });
  elements.editorContextMenu.addEventListener('mouseleave', function() { focusContextMenu(null); });

  function executeEditorContextAction(action) {
    const selectedText = elements.editorContextMenu.dataset.selectedText || '';
    closeEditorContextMenu();
    if (action === 'aiSearch') {
      const prompt = window.EditorAiChatCore.buildSearchPrompt(selectedText);
      if (prompt) {
        pendingDictAdd = { source: selectedText.trim(), type: 'mapping' };
        sendAiMessage(prompt);
      }
      return;
    }
    if (action === 'smartIngest') {
      if (!selectedText.trim()) { showToast('请先选中文本', true); return; }
      const url = API_BASE_URL.replace('/api/clip', '/api/ingest');
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: selectedText }) })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.success) {
            var intentLabel = data.intent === 'todo' ? '待办' : data.intent === 'topic' ? '话题' : '剪藏';
            showToast('智能入库成功: ' + intentLabel + (data.title ? ' - ' + data.title : ''));
          } else {
            showToast('智能入库失败: ' + (data.error || '未知错误'), true);
          }
        })
        .catch(function() { showToast('智能入库请求失败，请确认后端已启动', true); });
      return;
    }
    if (action === 'aiImportPassword') {
      if (!selectedText.trim()) { showToast('请先选中文本', true); return; }
      var vaultUrl = API_BASE_URL.replace('/api/clip', '/api/vault/auto-fill');
      fetch(vaultUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: selectedText }) })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.success && data.entries && data.entries.length > 0) {
            showToast('AI 识别到 ' + data.entries.length + ' 条密码，请在密码库中查看');
          } else if (data.success) {
            showToast('AI 未识别到密码信息', true);
          } else {
            showToast('AI 识别失败: ' + (data.error || '未知错误'), true);
          }
        })
        .catch(function() { showToast('AI 识别请求失败，请确认后端已启动', true); });
      return;
    }
    // 离线翻译：从本地词典查询选中单词
    if (action === 'offlineTranslate') {
      if (!selectedText.trim()) { showToast('请先选中文本', true); return; }
      var text = selectedText.trim();
      var hasChinese = /[\u4e00-\u9fff]/.test(text);
      var result = null;
      if (hasChinese) {
        // 中文文本：直接查 USER_DICT、DICT_CN、DICT_LIB
        if (window.USER_DICT && window.USER_DICT[text]) {
          result = { word: text, meaning: window.USER_DICT[text], matchedAs: '用户词典' };
        }
        if (!result && window.DICT_CN && window.DICT_CN[text]) {
          result = { word: text, meaning: window.DICT_CN[text], matchedAs: '中译英' };
        }
        if (!result) {
          var libResult = lookupDictLib(text);
          if (libResult) result = libResult;
        }
      } else {
        // 英文文本：取第一个单词走 lookupOfflineWord
        var firstWord = text.split(/[\s,;:!?.\n]+/)[0];
        result = lookupOfflineWord(firstWord);
      }
      if (result) {
        showToast('📖 ' + result.word + ': ' + result.meaning + (result.matchedAs ? ' (匹配: ' + result.matchedAs + ')' : ''));
      } else {
        showToast('📖 未找到"' + (hasChinese ? text : text.split(/[\s,;:!?.\n]+/)[0]) + '"的离线释义，试试在线翻译', true);
      }
      return;
    }
    // 在线翻译：调用翻译API
    if (action === 'onlineTranslate') {
      if (!selectedText.trim()) { showToast('请先选中文本', true); return; }
      onlineTranslateText(selectedText.trim());
      return;
    }
    // 添加自定义词典：选中文本 → 打开词典弹窗，预填源词并聚焦到释义输入框
    if (action === 'addCustomMapping') {
      if (!selectedText.trim()) { showToast('请先选中文本', true); return; }
      openDictModalWithSource(selectedText.trim());
      return;
    }
    // 添加词典库：选中文本 → 弹出输入框，输入翻译 → 保存到词典库
    if (action === 'addToDictLib') {
      if (!selectedText.trim()) { showToast('请先选中文本', true); return; }
      promptAddToDictLib(selectedText.trim());
      return;
    }
    // AI 分析上下文：将编辑区内容发送到AI聊天
    if (action === 'aiContextAnalysis') {
      sendEditorContextToAi(selectedText || mainEditor.getValue());
      return;
    }
    // 管理词典：打开自定义词典管理弹窗
    if (action === 'manageDictionary') {
      openDictModal();
      return;
    }
    // 删除每行末尾换行符：将客户端截断的多行日志合并为整行，便于后续格式化（JSON/SQL等）
    if (action === 'joinLineEnds') {
      joinLineEnds();
      return;
    }
    // 自动识别并格式化：无视右上角类型，依次尝试 JSON/XML/SQL（选区或全文）
    if (action === 'format') {
      formatCurrentContentAuto();
      return;
    }
    // 自动换行：对超出窗口宽度的内容做自动换行排版（参考 Notepad），主/对比编辑器同步切换
    if (action === 'toggleWordWrap') {
      toggleWordWrap();
      return;
    }
    // 对比视图：打开/切换对比面板（当前文档对比右侧内容）
    if (action === 'compare') {
      toggleCompare();
      mainEditor.focus();
      return;
    }
    // 插入双向链接：光标处插入 [[]] 并唤起模糊补全列表
    if (action === 'insertWikilink') {
      mainEditor.focus();
      insertWikilinkFromCommand();
      return;
    }
    mainEditor.focus();
    const command = action === 'selectAll' ? 'selectall' : action;
    try {
      mainEditor.execCommand(command);
    } catch (error) {
      showToast(`${action} 操作失败`, true);
    }
  }

  /**
   * 自动换行开关：切换 ACE 软换行（wrap）选项，对超出窗口宽度的内容做自动换行排版（参考 Notepad）。
   * 主编辑器与对比编辑器同步切换，使预览/对比视图与主视图排版一致。
   */
  function toggleWordWrap() {
    if (!mainEditor) return;
    const enable = mainEditor.getOption('wrap') === 'off';
    toggleWordWrapApply(enable);
    showToast(enable ? '自动换行已开启' : '自动换行已关闭');
    if (typeof toggleWordWrapContextSync === 'function') toggleWordWrapContextSync();
  }

  // 实际应用换行状态到主/对比编辑器（对比编辑器存在时同步）
  function toggleWordWrapApply(enable) {
    mainEditor.setOption('wrap', enable ? 'free' : 'off');
    if (typeof compareEditor !== 'undefined' && compareEditor) {
      compareEditor.setOption('wrap', enable ? 'free' : 'off');
    }
  }

  // 同步右键菜单勾选状态与文字（☑/☐）
  function toggleWordWrapContextSync() {
    if (!elements.toggleWordWrapContextBtn || !mainEditor) return;
    const label = elements.toggleWordWrapContextBtn.querySelector('.ctx-label');
    if (label) label.textContent =
      (mainEditor.getOption('wrap') !== 'off' ? '☑ 自动换行' : '☐ 自动换行');
  }

  /**
   * 离线词典智能查找：支持词形变化匹配
   */
  function lookupOfflineWord(word) {
    var clean = word.replace(/[^a-z'-]/g, '').toLowerCase().trim();
    if (!clean) return null;
    // 0. 优先查用户自定义词典（大小写敏感 + 忽略大小写）
    var userDict = window.USER_DICT || {};
    var userKeys = Object.keys(userDict);
    for (var uk = 0; uk < userKeys.length; uk++) {
      if (userKeys[uk].toLowerCase() === clean) {
        return { word: userKeys[uk], meaning: userDict[userKeys[uk]], matchedAs: '用户词典' };
      }
    }
    // 0.2 查词典库（DICT_LIB）
    if (window.DICT_LIB) {
      var libKeys = Object.keys(window.DICT_LIB);
      for (var lk = 0; lk < libKeys.length; lk++) {
        if (libKeys[lk].toLowerCase() === clean) {
          return { word: libKeys[lk], meaning: window.DICT_LIB[libKeys[lk]], matchedAs: '词典库' };
        }
      }
    }
    // 0.5 查中文→英文词典（DICT_CN）
    if (window.DICT_CN && window.DICT_CN[word.trim()]) {
      return { word: word.trim(), meaning: window.DICT_CN[word.trim()], matchedAs: '中译英' };
    }
    // 1. 精确查内置词典
    if (window.DICT && window.DICT[clean]) {
      return { word: clean, meaning: window.DICT[clean], matchedAs: null };
    }
    // 2. 尝试各种词形变化（仅当内置词典可用时）
    if (window.DICT) {
      var forms = [];
      // 复数/三单 -s/-es/-ies
      if (clean.endsWith('ies')) forms.push(clean.slice(0, -3) + 'y');
      if (clean.endsWith('ves')) forms.push(clean.slice(0, -3) + 'f');
      if (clean.endsWith('es')) forms.push(clean.slice(0, -2));
      if (clean.endsWith('s') && !clean.endsWith('ss')) forms.push(clean.slice(0, -1));
      // 进行时 -ing
      if (clean.endsWith('ying')) forms.push(clean.slice(0, -4) + 'ie');
      if (clean.endsWith('ming')) forms.push(clean.slice(0, -3));
      if (clean.endsWith('ning') && clean.length > 6) forms.push(clean.slice(0, -4));
      if (clean.endsWith('ing') && clean.length > 5) {
        forms.push(clean.slice(0, -3));
        forms.push(clean.slice(0, -3) + 'e');
      }
      // 过去式 -ed
      if (clean.endsWith('ied')) forms.push(clean.slice(0, -3) + 'y');
      if (clean.endsWith('ed') && clean.length > 4) {
        forms.push(clean.slice(0, -2));
        forms.push(clean.slice(0, -1));
      }
      if (clean.endsWith('d') && clean.length > 3) {
        forms.push(clean.slice(0, -1));
      }
      // 比较级/最高级 -er/-est
      if (clean.endsWith('iest')) forms.push(clean.slice(0, -4) + 'y');
      if (clean.endsWith('est') && clean.length > 5) forms.push(clean.slice(0, -3));
      if (clean.endsWith('ier')) forms.push(clean.slice(0, -3) + 'y');
      if (clean.endsWith('er') && clean.length > 4) forms.push(clean.slice(0, -2));
      // 副词 -ly
      if (clean.endsWith('ily')) forms.push(clean.slice(0, -3) + 'y');
      if (clean.endsWith('ly') && clean.length > 5) forms.push(clean.slice(0, -2));
      // 名词 -tion/-sion
      if (clean.endsWith('ation')) forms.push(clean.slice(0, -5) + 'e');
      if (clean.endsWith('ition')) forms.push(clean.slice(0, -5) + 'e');
      if (clean.endsWith('tion')) forms.push(clean.slice(0, -4) + 'e');
      if (clean.endsWith('sion')) forms.push(clean.slice(0, -4));
      // 名词 -ment
      if (clean.endsWith('ment')) forms.push(clean.slice(0, -4));
      // 名词 -ness
      if (clean.endsWith('iness')) forms.push(clean.slice(0, -5) + 'y');
      if (clean.endsWith('ness')) forms.push(clean.slice(0, -4));
      // 形容词 -able/-ible
      if (clean.endsWith('able')) forms.push(clean.slice(0, -4));
      if (clean.endsWith('ible')) forms.push(clean.slice(0, -4));
      // 形容词 -ful
      if (clean.endsWith('iful')) forms.push(clean.slice(0, -4) + 'y');
      if (clean.endsWith('ful')) forms.push(clean.slice(0, -3));
      // 形容词 -less
      if (clean.endsWith('less')) forms.push(clean.slice(0, -4));
      // 形容词 -ive
      if (clean.endsWith('ative')) forms.push(clean.slice(0, -5) + 'e');
      if (clean.endsWith('ive')) forms.push(clean.slice(0, -3));
      // 去重
      var seen = {};
      var unique = [];
      forms.forEach(function(f) {
        if (f && f.length > 1 && !seen[f]) { seen[f] = true; unique.push(f); }
      });
      // 按匹配质量排序：越长越精确
      unique.sort(function(a, b) { return b.length - a.length; });
      for (var i = 0; i < unique.length; i++) {
        if (window.DICT[unique[i]]) {
          return { word: unique[i], meaning: window.DICT[unique[i]], matchedAs: clean };
        }
      }
      // 3. 部分匹配：包含关系
      var keys = Object.keys(window.DICT);
      for (var j = 0; j < keys.length; j++) {
        if (keys[j].indexOf(clean) !== -1 || clean.indexOf(keys[j]) !== -1) {
          return { word: keys[j], meaning: window.DICT[keys[j]], matchedAs: '部分匹配' };
        }
      }
    }
    return null;
  }

  /**
   * 在线翻译：发送"一句话翻译"提示词到右侧AI面板
   */
  function onlineTranslateText(text) {
    if (!text.trim()) return;
    var prompt = '一句话翻译：' + text.trim();
    pendingDictAdd = { source: text.trim(), type: 'lib' };
    showToast('🌐 正在通过 AI 翻译...');
    setAiChatPanelOpen(true);
    sendAiMessage(prompt);
  }

  /**
   * 添加英文翻译：对中文文本追加英文翻译到编辑器
   * 优先使用离线词典（单次词），否则发送到AI面板
   */
  function addEnglishTranslation(text) {
    if (!text.trim()) return;
    // 单英文词优先查离线词典（中英互查）
    var cleaned = text.trim().toLowerCase().replace(/[^a-z\u4e00-\u9fff]/g, '');
    var dictResult = null;
    if (window.USER_DICT && window.USER_DICT[cleaned]) {
      dictResult = window.USER_DICT[cleaned];
    } else if (window.USER_DICT && window.USER_DICT[text.trim()]) {
      dictResult = window.USER_DICT[text.trim()];
    } else if (window.DICT_CN && window.DICT_CN[text.trim()]) {
      dictResult = window.DICT_CN[text.trim()];
    } else if (window.DICT && window.DICT[cleaned]) {
      dictResult = window.DICT[cleaned].split(';')[0].trim() || window.DICT[cleaned];
    }
    if (dictResult) {
      insertTranslation(dictResult);
      showToast('➕ 已添加英文翻译 (离线词典)');
      return;
    }
    // 发送到AI面板
    showToast('➕ 正在通过 AI 翻译...');
    var prompt = '一句话翻译：' + text.trim();
    // 打开AI面板并发送
    setTimeout(function() {
      // 发送后，AI面板会显示翻译结果，用户手动复制
    }, 100);
    setAiChatPanelOpen(true);
    setTimeout(function() {
      sendAiMessage(prompt);
    }, 300);
  }

  /**
   * 将翻译结果插入到编辑器光标位置
   */
  function insertTranslation(translation) {
    var cursorPos = mainEditor.getCursorPosition();
    var session = mainEditor.getSession();
    session.insert(cursorPos, ' (' + translation + ')');
  }

  /**
   * 将编辑器上下文发送到AI聊天面板
   */
  function sendEditorContextToAi(editorContent) {
    if (!editorContent || !editorContent.trim()) {
      showToast('编辑器内容为空', true);
      return;
    }
    var maxLen = 3000;
    var content = editorContent.trim();
    if (content.length > maxLen) {
      content = content.slice(0, maxLen) + '\n\n...(内容过长已截断)';
    }
    // 如果有选中文本，优先分析选中区域
    var sel = selectionState;
    var prompt;
    if (sel.text) {
      prompt = '请分析以下选中的文本内容，提炼要点、指出问题或给出优化建议：\n\n```\n'
        + sel.text + '\n```';
      if (sel.contextBefore || sel.contextAfter) {
        prompt += '\n\n（上下文已自动附加到请求中）';
      }
    } else {
      prompt = '请分析以下编辑器中的内容，提炼要点、指出问题或给出优化建议：\n\n```\n'
        + content + '\n```';
    }
    setAiChatPanelOpen(true);
    setTimeout(function() {
      sendAiMessage(prompt);
    }, 300);
  }

  function initializeAiChat() {
    setAiChatWidth(getAiChatWidth(), false);
    // 悬停宠物唤起快捷操作菜单；点击仍切换 AI 对话面板（同时收起菜单）
    elements.aiPetBtn.addEventListener('mouseenter', openPetQuickMenu);
    elements.aiPetBtn.addEventListener('click', function() {
      closePetQuickMenu();
      toggleAiChatPanel();
    });
    // 快捷操作项
    if (elements.aiPetQuickMenu) {
      elements.aiPetQuickMenu.addEventListener('click', function(event) {
        const item = event.target && event.target.closest('.ai-pet-quick-item');
        if (!item) return;
        executePetQuickAction(item.getAttribute('data-act'));
      });
    }
    // 点击菜单外 / 滚轮 / Esc 关闭快捷菜单
    document.addEventListener('mousedown', function(event) {
      if (!petQuickMenuOpen) return;
      if (elements.aiPetQuickMenu.contains(event.target)) return;
      if (elements.aiPetBtn && elements.aiPetBtn.contains(event.target)) return;
      closePetQuickMenu();
    });
    document.addEventListener('wheel', function() { closePetQuickMenu(); }, { passive: true });
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') closePetQuickMenu();
    });
    elements.aiChatCloseBtn.addEventListener('click', () => setAiChatPanelOpen(false));
    elements.aiChatClearBtn.addEventListener('click', () => {
      cancelAiRequest();
      if (state) updateAiChatState(state, { type: 'clear' });
    });
    // 读取上下文按钮
    elements.aiChatContextBtn.addEventListener('click', function() {
      if (!state) { showToast('没有打开的编辑器内容', true); return; }
      var editorContent = mainEditor.getValue() || state.content || '';
      sendEditorContextToAi(editorContent);
    });
    elements.aiChatSendBtn.addEventListener('click', () => sendAiMessage(elements.aiChatInput.value));
    elements.aiChatStopBtn.addEventListener('click', cancelAiRequest);
    elements.aiChatInput.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendAiMessage(elements.aiChatInput.value);
      }
    });
    mainEditor.container.addEventListener('contextmenu', openEditorContextMenu);
    elements.editorContextMenu.querySelectorAll('[data-context-action]').forEach(button => {
      button.addEventListener('click', () => executeEditorContextAction(button.dataset.contextAction));
    });
    elements.aiSearchContextBtn.hidden = true;
    elements.offlineTranslateContextBtn.hidden = true;
    elements.onlineTranslateContextBtn.hidden = true;
    elements.addCustomMappingContextBtn.hidden = true;
    elements.addToDictLibContextBtn.hidden = true;
    elements.aiContextAnalysisContextBtn.hidden = true;
    elements.manageDictionaryContextBtn.hidden = true;
    document.addEventListener('click', event => {
      if (!elements.editorContextMenu.contains(event.target)) closeEditorContextMenu();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeEditorContextMenu();
    });
    window.addEventListener('blur', closeEditorContextMenu);

    // ── 斜杠命令菜单（输入 / 唤起）：行首输入 "/" 弹出插入/格式化命令菜单 ──
    var slashMenuOpen = false;
    var slashQuery = '';
    var slashIndex = -1;
    var slashDebounce = null;
    var slashTemplates = null;   // 斜杠菜单模板缓存（异步加载，null=未加载）

    function svgSlashIcon(paths) {
      return '<svg class="ctx-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
    }
    var SLASH_ICON = {
      h1: '<span class="ctx-icon head-mark">H1</span>',
      h2: '<span class="ctx-icon head-mark">H2</span>',
      h3: '<span class="ctx-icon head-mark">H3</span>',
      image: svgSlashIcon('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
      link: svgSlashIcon('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
      // 双向链接：双括号式图标（区别于普通链接）
      wikilink: svgSlashIcon('<path d="M8 4 4 12l4 8"/><path d="M16 4l4 8-4 8"/><line x1="13" y1="4" x2="11" y2="20"/>'),
      code: svgSlashIcon('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'),
      table: svgSlashIcon('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/>'),
      quote: svgSlashIcon('<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>'),
      todo: svgSlashIcon('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 12 2 2 4-4"/>'),
      divider: svgSlashIcon('<line x1="4" x2="20" y1="12" y2="12"/><path d="M7 7h10"/><path d="M7 17h10"/>'),
      ai: svgSlashIcon('<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>'),
      aiPolish: svgSlashIcon('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>'),
      template: svgSlashIcon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="13" x2="16" y2="13"/><line x1="8" y1="13" x2="9" y2="13"/><line x1="12" y1="17" x2="16" y2="17"/><line x1="8" y1="17" x2="9" y2="17"/>')
    };

    var SLASH_ITEMS = [
      { group: '标题', items: [
        { id: 'h1', title: '一级标题', keywords: 'heading 标题 h1', icon: 'h1', insert: '# ' },
        { id: 'h2', title: '二级标题', keywords: 'heading 标题 h2', icon: 'h2', insert: '## ' },
        { id: 'h3', title: '三级标题', keywords: 'heading 标题 h3', icon: 'h3', insert: '### ' }
      ]},
      { group: '插入', items: [
        { id: 'image', title: '插入图片', keywords: 'image 图片 插图', icon: 'image', insert: '![]()' },
        { id: 'link', title: '插入链接', keywords: 'link 链接 url', icon: 'link', insert: '[]()' },
        { id: 'wikilink', title: '双向链接', keywords: 'wikilink link 双链 双向 linknote 跳转 [[', icon: 'wikilink', insert: '[[]]' },
        { id: 'code', title: '代码块', keywords: 'code 代码 block', icon: 'code', insert: '```\n\n```' },
        { id: 'table', title: '插入表格', keywords: 'table 表格', icon: 'table', insert: '| 列1 | 列2 |\n| --- | --- |\n|  |  |' },
        { id: 'quote', title: '引用', keywords: 'quote 引用 blockquote', icon: 'quote', insert: '> ' },
        { id: 'todo', title: '待办事项', keywords: 'todo 待办 task', icon: 'todo', insert: '- [ ] ' },
        { id: 'divider', title: '分隔线', keywords: 'hr divider 分割线', icon: 'divider', insert: '\n---\n' }
      ]},
      { group: 'AI', items: [
        { id: 'ai-continue', title: 'AI 续写', keywords: 'ai continue 续写 继续', icon: 'ai', ai: 'continue' },
        { id: 'ai-polish', title: 'AI 润色', keywords: 'ai polish 润色 改写', icon: 'aiPolish', ai: 'polish' }
      ]}
    ];

    function renderSlashMenu() {
      const listEl = elements.slashMenuList;
      listEl.innerHTML = '';
      const q = slashQuery.toLowerCase();
      let matched = false;
      SLASH_ITEMS.forEach(function(group) {
        const groupItems = group.items.filter(function(it) {
          if (!q) return true;
          if (it.title.toLowerCase().indexOf(q) !== -1) return true;
          return it.keywords && it.keywords.toLowerCase().indexOf(q) !== -1;
        });
        if (!groupItems.length) return;
        matched = true;
        const title = document.createElement('div');
        title.className = 'slash-group-title';
        title.textContent = group.group;
        listEl.appendChild(title);
        groupItems.forEach(function(it) {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'slash-item';
          row.dataset.id = it.id;
          row.innerHTML = SLASH_ICON[it.icon] + '<span class="ctx-label">' + it.title + '</span>';
          row.addEventListener('click', function() { executeSlashItem(it); });
          listEl.appendChild(row);
        });
      });
      // 动态「模板」分组：模板异步加载后增量渲染
      const tplItems = (slashTemplates || []).filter(function(t) {
        if (!q) return true;
        return t.name.toLowerCase().indexOf(q) !== -1;
      });
      if (tplItems.length) {
        matched = true;
        const title = document.createElement('div');
        title.className = 'slash-group-title';
        title.textContent = '模板';
        listEl.appendChild(title);
        tplItems.forEach(function(t) {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'slash-item';
          row.dataset.id = 'tpl-' + t.name;
          row.innerHTML = (t.builtin ? '<span class="tpl-badge-sm">内置</span>' : '') + SLASH_ICON.template + '<span class="ctx-label">' + t.name + '</span>';
          row.addEventListener('click', function() { executeSlashItem({ id: 'tpl-' + t.name, title: t.name, icon: 'template', templateName: t.name }); });
          listEl.appendChild(row);
        });
        // 「维护模板」入口：选择后打开模板管理弹窗
        const manageRow = document.createElement('button');
        manageRow.type = 'button';
        manageRow.className = 'slash-item slash-manage-tpl';
        manageRow.dataset.id = 'slash-manage-templates';
        manageRow.innerHTML = SLASH_ICON.template + '<span class="ctx-label">管理模板…</span>';
        manageRow.addEventListener('click', function() { executeSlashItem({ id: 'slash-manage-templates', manage: true, icon: 'template' }); });
        listEl.appendChild(manageRow);
      }
      if (!matched) {
        const empty = document.createElement('div');
        empty.className = 'slash-menu-empty';
        empty.textContent = '无匹配命令';
        listEl.appendChild(empty);
      }
      focusSlashItem(null);
    }

    function focusSlashItem(index) {
      const items = elements.slashMenuList.querySelectorAll('.slash-item');
      items.forEach(btn => btn.classList.remove('focused'));
      slashIndex = -1;
      if (index === null || !items.length) return;
      if (index < 0) index = items.length - 1;
      if (index >= items.length) index = 0;
      items[index].classList.add('focused');
      slashIndex = index;
      if (items[index].scrollIntoView) items[index].scrollIntoView({ block: 'nearest' });
    }

    function slashShouldOpen() {
      const cur = mainEditor.getCursorPosition();
      const line = mainEditor.session.getLine(cur.row);
      const before = line.slice(0, cur.column);
      // 行首或空白之后的 "/" 触发（避免 http:// 等 URL、a/b 路径误触发）
      const m = /(^|\s)\/(.*)$/.exec(before);
      if (m) { slashQuery = m[2].replace(/^\s+/, ''); return true; }
      return false;
    }

    function openSlashMenu() {
      slashMenuOpen = true;
      renderSlashMenu();
      elements.slashMenu.hidden = false;
      elements.slashMenu.setAttribute('aria-hidden', 'false');
      positionSlashMenu();
      reportSlashMenuState(true);
      loadSlashTemplates();
    }

    // 异步加载模板列表，成功后若菜单仍打开则增量补渲染「模板」分组
    function loadSlashTemplates() {
      var api = getElectronAPI();
      if (!api || !api.listTemplates) return;
      api.listTemplates().then(function(result) {
        slashTemplates = (result && result.success && result.templates) || [];
        if (slashMenuOpen) { renderSlashMenu(); positionSlashMenu(); }
      }).catch(function() {
        slashTemplates = [];
      });
    }

    function closeSlashMenu() {
      slashMenuOpen = false;
      slashQuery = '';
      elements.slashMenu.hidden = true;
      elements.slashMenu.setAttribute('aria-hidden', 'true');
      reportSlashMenuState(false);
    }

    // 向父窗口上报菜单开关状态：父窗口据此决定是否把 ↑↓/Enter/Esc 等导航键转发进编辑器
    // （焦点落在父窗口时，编辑器收不到 keydown，菜单键盘操作全靠这条通道兜底）
    function reportSlashMenuState(open) {
      try { window.parent.postMessage({ type: 'slashMenuState', open: !!open }, '*'); } catch (e) {}
    }

    function positionSlashMenu() {
      const menu = elements.slashMenu;
      const pos = mainEditor.getCursorPosition();
      const pix = mainEditor.renderer.$cursorLayer.getPixelPosition(pos, true);
      // getPixelPosition 只返回 {left, top}，不含 height；行高取 renderer.lineHeight
      const lineHeight = mainEditor.renderer.lineHeight || 16;
      const rect = mainEditor.container.getBoundingClientRect();
      const x = rect.left + pix.left;
      const y = rect.top + pix.top + lineHeight + 6;
      const mw = menu.offsetWidth;
      const mh = menu.offsetHeight;
      const gap = 8;
      let left = x;
      if (mw > window.innerWidth - x - gap) left = Math.max(gap, window.innerWidth - mw - gap);
      let top = y;
      if (mh > window.innerHeight - y - gap) {
        const above = y - lineHeight - 12 - mh;
        top = Math.max(gap, above >= gap ? above : y - mh - gap);
      }
      menu.style.left = left + 'px';
      menu.style.top = top + 'px';
    }

    function executeSlashItem(item) {
      if (item.ai) {
        closeSlashMenu();
        const sel = mainEditor.getSelectedText();
        const text = (sel && sel.trim()) ? sel : mainEditor.getValue();
        const prompt = item.ai === 'continue'
          ? '请基于以下内容继续续写，保持原有语气与风格，直接输出续写部分：\n\n' + text
          : '请润色以下文本，保持原意，直接输出润色结果：\n\n' + text;
        sendAiMessage(prompt);
        return;
      }
      if (item.manage) {
        // 维护模板：删除 "/" 前缀后打开模板管理弹窗
        const cur = mainEditor.getCursorPosition();
        const line = mainEditor.session.getLine(cur.row);
        const before = line.slice(0, cur.column);
        const m = /(^|\s)\//.exec(before);
        const startCol = m ? m.index + m[0].length - 1 : cur.column;
        const range = new Range(cur.row, startCol, cur.row, cur.column);
        closeSlashMenu();
        mainEditor.session.replace(range, '');
        openTemplateManager();
        return;
      }
      if (item.templateName) {
        // 模板插入：先删除 "/" 前缀，再异步读取内容插入
        const cur = mainEditor.getCursorPosition();
        const line = mainEditor.session.getLine(cur.row);
        const before = line.slice(0, cur.column);
        const m = /(^|\s)\//.exec(before);
        const startCol = m ? m.index + m[0].length - 1 : cur.column;
        const range = new Range(cur.row, startCol, cur.row, cur.column);
        closeSlashMenu();
        mainEditor.session.replace(range, '');
        insertTemplateByName(item.templateName);
        return;
      }
      if (item.mode === 'wikilink' || item.id === 'wikilink') {
        // 双向链接：删除 "/" 前缀后插入 [[ ]]，光标居中并唤起模糊补全列表
        const cur = mainEditor.getCursorPosition();
        const line2 = mainEditor.session.getLine(cur.row);
        const before2 = line2.slice(0, cur.column);
        const m2 = /(^|\s)\//.exec(before2);
        const startCol2 = m2 ? m2.index + m2[0].length - 1 : cur.column;
        const range2 = new Range(cur.row, startCol2, cur.row, cur.column);
        closeSlashMenu();
        mainEditor.session.replace(range2, '');
        mainEditor.focus();
        insertWikilinkAtCursor(range2.start);
        return;
      }
      const cur = mainEditor.getCursorPosition();
      const line = mainEditor.session.getLine(cur.row);
      const before = line.slice(0, cur.column);
      // 与触发条件一致：仅删除 "/"（含其前一个空白），保留前文
      const m = /(^|\s)\//.exec(before);
      const startCol = m ? m.index + m[0].length - 1 : cur.column;
      const range = new Range(cur.row, startCol, cur.row, cur.column);
      closeSlashMenu();
      mainEditor.session.replace(range, item.insert);
      mainEditor.focus();
    }

    // 输入监听：行首 "/" 唤起、继续输入过滤、移出条件关闭
    mainEditor.session.on('change', function() {
      clearTimeout(slashDebounce);
      slashDebounce = setTimeout(function() {
        if (slashShouldOpen()) {
          if (!slashMenuOpen) openSlashMenu();
          else { renderSlashMenu(); positionSlashMenu(); }
        } else if (slashMenuOpen) {
          closeSlashMenu();
        }
      }, 120);
    });
    // 光标移出斜杠触发条件（如移动到 "/" 之前或其它行）自动关闭
    mainEditor.selection.on('changeCursor', function() {
      if (slashMenuOpen && !slashShouldOpen()) closeSlashMenu();
    });

    // 菜单键盘操作：↑↓ 高亮循环、Enter 执行、Esc 关闭。返回 true 表示按键已被菜单消费。
    // 既由编辑器内 keydown 调用，也由父窗口转发（焦点落在父窗口时）经 editorKeyDown 消息调用。
    function handleSlashMenuKey(e) {
      if (!slashMenuOpen) return false;
      const items = elements.slashMenuList.querySelectorAll('.slash-item');
      if (e.key === 'ArrowDown') { e.preventDefault(); focusSlashItem(slashIndex + 1); return true; }
      if (e.key === 'ArrowUp') { e.preventDefault(); focusSlashItem(slashIndex - 1); return true; }
      if (e.key === 'Enter') {
        if (slashIndex >= 0 && items[slashIndex]) {
          e.preventDefault();
          items[slashIndex].click();
          return true;
        }
        return false;
      }
      if (e.key === 'Escape') { e.preventDefault(); closeSlashMenu(); mainEditor.focus(); return true; }
      return false;
    }

    // 暴露给顶层消息处理：焦点落在父窗口时，父窗口转发的 editorKeyDown 消息经此进入菜单逻辑
    // （handleSlashMenuKey 是 initializeAiChat 的内部函数，顶层 message 监听器无法直接访问）
    window.__slashMenuKeyHandler = function (key) {
      handleSlashMenuKey({ key: key, preventDefault: function() {} });
    };

    // 菜单打开时用捕获阶段接管导航/确认/关闭键：若走冒泡阶段，ACE 会先处理方向键移动光标，
    // 触发 changeCursor → slashShouldOpen 失败 → 菜单被提前关闭，↑↓ 导航失效
    document.addEventListener('keydown', function(e) {
      if (!slashMenuOpen) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter' && e.key !== 'Escape') return;
      if (handleSlashMenuKey(e)) e.stopPropagation();
    }, true);
    document.addEventListener('mousedown', function(e) {
      if (slashMenuOpen && !elements.slashMenu.contains(e.target)) closeSlashMenu();
    });

    // ── P1 直接开始写作：空文档引导层点击 / 任意输入即进入写作 ──
    elements.startWritingGuide.addEventListener('click', function() {
      hideStartWritingGuide();
      mainEditor.focus();
    });
    elements.startWritingGuide.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        hideStartWritingGuide();
        mainEditor.focus();
      }
    });
    // 引导层可见时：可打印字符保留首个输入；其余按键（回车/方向等）仅隐藏并聚焦
    document.addEventListener('keydown', function(e) {
      const guide = elements.startWritingGuide;
      if (!guide || guide.hidden) return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') { hideStartWritingGuide(); mainEditor.focus(); return; }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        hideStartWritingGuide();
        mainEditor.focus();
        mainEditor.insert(e.key);
        return;
      }
      hideStartWritingGuide();
      mainEditor.focus();
    });
    // 文档一旦非空（粘贴/拖入/程序写入等）自动隐藏引导层
    mainEditor.session.on('change', function() {
      if (!elements.startWritingGuide.hidden && mainEditor.getValue().trim()) {
        hideStartWritingGuide();
      }
    });

    // 选中提示条清除按钮
    if (elements.aiChatSelectionHintClear) {
      elements.aiChatSelectionHintClear.addEventListener('click', function() {
        mainEditor.selection.clearSelection();
        updateSelectionState();
      });
    }

    // 接受 AI 差异对比修改（从差异弹窗应用）
    document.getElementById('acceptAiDiffBtn').addEventListener('click', function() {
      var aiContent = document.getElementById('aiContent');
      if (!aiContent) return;
      var newText = aiContent.textContent || aiContent.innerText;
      if (!newText) { showToast('AI 建议内容为空', true); return; }
      var modal = document.getElementById('aiDiffModal');
      var rangeData = modal.dataset.range;
      if (rangeData) {
        try {
          var rangeObj = JSON.parse(rangeData);
          if (rangeObj.start && rangeObj.end) {
            var range = new Range(rangeObj.start.row, rangeObj.start.column, rangeObj.end.row, rangeObj.end.column);
            var oldSel = mainEditor.session.getTextRange(range);
            mainEditor.session.replace(range, newText);
            recordAiOperation('diff_accept_selection', oldSel, newText, 'AI 差异审批（选区）');
          } else {
            fullReplace();
          }
        } catch (_) {
          fullReplace();
        }
      } else {
        fullReplace();
      }
      function fullReplace() {
        var oldContent = mainEditor.getValue();
        mainEditor.session.setValue(newText);
        recordAiOperation('diff_accept', oldContent, newText, 'AI 差异审批');
      }
      modal.classList.remove('is-visible');
      showToast('AI 修改已接受并应用到编辑器');
    });

    const mdResizer = document.getElementById('mdSplitResizer');
    if (mdResizer) {
      mdResizer.addEventListener('pointerdown', function(e) {
        if (e.button !== 0) return;
        e.preventDefault();
        const ws = elements.editorWorkspace;
        // 仅抽屉态（非全屏）生效；≤680px 堆叠布局下 resizer 已被 CSS 隐藏，不会触发
        if (!ws.classList.contains('markdown-preview') || ws.classList.contains('markdown-fullscreen')) return;
        ws.classList.add('md-resizing');
        const rect = ws.getBoundingClientRect();
        let ratio = getMdSplitRatio();
        const onMove = function(ev) {
          if (rect.width <= 0) return;
          // 手指/指针即抽屉左边缘：右侧剩余宽度 = (右边界 - 指针x)
          const drawer = Math.max(0, rect.right - ev.clientX);
          ratio = drawer / rect.width;
          applyMdSplitRatio(ratio, false);
        };
        const onUp = function() {
          ws.classList.remove('md-resizing');
          try { localStorage.setItem(MD_SPLIT_KEY, String(ratio)); } catch (err) {}
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          setTimeout(function() { try { mainEditor.resize(); } catch (err) {} }, 0);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
      });
    }
    // 窗口尺寸变化时按当前占比重算左右列像素宽度，避免固定 px 列溢出或留缝
    var mdResizeTimer = null;
    window.addEventListener('resize', function() {
      if (mdResizeTimer) return;
      mdResizeTimer = setTimeout(function() {
        mdResizeTimer = null;
        var ws = elements.editorWorkspace;
        if (ws && ws.classList.contains('markdown-preview') && !ws.classList.contains('markdown-fullscreen')) {
          applyMdSplitRatio(getMdSplitRatio(), false);
        }
      }, 120);
    });

    let dragStartX = 0;
    let dragStartWidth = 360;
    elements.aiChatResizeHandle.addEventListener('pointerdown', event => {
      event.preventDefault();
      dragStartX = event.clientX;
      dragStartWidth = getAiChatWidth();
      elements.aiChatResizeHandle.classList.add('dragging');
      const move = moveEvent => setAiChatWidth(dragStartWidth + dragStartX - moveEvent.clientX, false);
      const stop = () => {
        setAiChatWidth(parseInt(getComputedStyle(elements.editorWorkspace).getPropertyValue('--ai-chat-width'), 10), true);
        elements.aiChatResizeHandle.classList.remove('dragging');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop, { once: true });
    });
    // AI 代码块操作按钮事件委托（监听 AI 对话面板内的点击）
    elements.aiChatMessages.addEventListener('click', handleAiCodeBlockAction);
    renderAiChat();
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
      sharedState.compareSource = 'clipboard';
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
        sharedState.compareSource = 'file';
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
    clearMarkers(mainEditor, sharedState.diffWordMarkers.main);
    clearMarkers(compareEditor, sharedState.diffWordMarkers.compare);
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
    // 暂存被删除行的内容，用于后续词级对比
    let pendingRemoved = null;

    parts.forEach(part => {
      const rows = countRows(part.value);
      if (part.removed && !part.added) {
        // 纯删除：记录差异位置
        sharedState.diffMarkers.main.push(addFullLineMarker(mainEditor, leftRow, rows, 'diff-removed-line'));
        sharedState.diffLocations.push({ editor: mainEditor, row: leftRow });
        // 暂存删除行内容供词级对比
        pendingRemoved = {
          lines: splitLines(part.value),
          startRow: leftRow,
          rowCount: rows
        };
        leftRow += rows;
        prevWasRemoved = true;
      } else if (part.added && !part.removed) {
        // 纯新增
        if (prevWasRemoved && pendingRemoved) {
          // 上一部分是 removed，合并为同一次替换，进行词级对比
          const addedLines = splitLines(part.value);
          const removedLines = pendingRemoved.lines;
          const maxLines = Math.max(removedLines.length, addedLines.length);
          for (let i = 0; i < maxLines; i++) {
            const oldLine = i < removedLines.length ? removedLines[i] : '';
            const newLine = i < addedLines.length ? addedLines[i] : '';
            if (oldLine !== newLine) {
              // 用 diffWords 逐行计算词级差异
              const wordParts = window.Diff.diffWords(oldLine, newLine);
              // 标记旧文件（左侧）删除的词
              if (i < removedLines.length) {
                const mRow = pendingRemoved.startRow + i;
                let mCol = 0;
                wordParts.forEach(function (wp) {
                  if (wp.removed) {
                    sharedState.diffWordMarkers.main.push(
                      mainEditor.session.addMarker(
                        new Range(mRow, mCol, mRow, mCol + wp.value.length),
                        'diff-word-removed',
                        'text'
                      )
                    );
                  }
                  if (!wp.added) mCol += wp.value.length;
                });
              }
              // 标记新文件（右侧）新增的词
              if (i < addedLines.length) {
                const aRow = rightRow + i;
                let aCol = 0;
                wordParts.forEach(function (wp) {
                  if (wp.added) {
                    sharedState.diffWordMarkers.compare.push(
                      compareEditor.session.addMarker(
                        new Range(aRow, aCol, aRow, aCol + wp.value.length),
                        'diff-word-added',
                        'text'
                      )
                    );
                  }
                  if (!wp.removed) aCol += wp.value.length;
                });
              }
            }
          }
          prevWasRemoved = false;
          pendingRemoved = null;
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
        pendingRemoved = null;
      }
    });
    elements.diffCounter.textContent = sharedState.diffLocations.length
      ? `${sharedState.diffLocations.length} 处差异`
      : '无差异';
  }

  /** 将字符串按行分割，过滤掉末尾空行 */
  function splitLines(value) {
    if (!value) return [];
    var lines = value.split('\n');
    // 如果末尾是空行（value 以 \n 结尾），去掉最后一个空元素
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    return lines;
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
    // Phase 1：多光标状态指示（仅多光标时显示，其余情况保持隐藏，不影响状态栏布局）
    if (featureOn('multiCursor')) {
      ensureAceMultiSelect();
      const ranges = mainEditor.selection.getAllRanges && mainEditor.selection.getAllRanges();
      const count = ranges && ranges.length > 1 ? ranges.length : 0;
      if (elements.multiCursorStatus) {
        if (count > 1) {
          elements.multiCursorStatus.hidden = false;
          elements.multiCursorStatus.textContent = `${count} 个光标`;
        } else {
          elements.multiCursorStatus.hidden = true;
        }
      }
    }
  }

  // D3：全文行数/字符数 与 缩放百分比状态（写作时感知篇幅与字号）
  var docStatsTimer = null;
  function scheduleDocStatsUpdate() {
    if (isComposing()) return;
    clearTimeout(docStatsTimer);
    docStatsTimer = setTimeout(updateDocStats, 300);
  }
  function updateDocStats() {
    if (!elements.docStats) return;
    if (isComposing()) return;
    var text = mainEditor.getValue();
    elements.docStats.textContent = mainEditor.session.getLength() + ' 行 · ' + text.length + ' 字';
  }
  function updateZoomStatus() {
    if (!elements.zoomStatus) return;
    var size = mainEditor.getFontSize();
    var n = typeof size === 'number' ? size : (parseFloat(size) || 13);
    elements.zoomStatus.textContent = Math.round((n / 13) * 100) + '%';
  }
  // 钩住所有 setFontSize 路径（滑块/Ctrl+=/Ctrl+-/Ctrl+滚轮/设置恢复），统一刷新缩放百分比
  if (featureOn('docStatsZoom')) {
    var origSetFontSize = mainEditor.setFontSize.bind(mainEditor);
    mainEditor.setFontSize = function (size) {
      origSetFontSize(size);
      updateZoomStatus();
    };
    updateZoomStatus();
  }

  // 确保 ACE 多选（multi_select）模块已加载并启用（独立函数，不修改 createEditor 默认选项）
  let aceMultiSelectEnsured = false;
  function ensureAceMultiSelect() {
    if (aceMultiSelectEnsured || !mainEditor) return;
    try {
      ace.require('ace/multi_select');
      // 对已存在的编辑器实例显式开启（模块 defineOptions 已把 enableMultiselect 置为默认 true，
      // 显式设置保证本实例生效，且不改动 createEditor 的默认选项值）
      mainEditor.setOption('enableMultiselect', true);
      aceMultiSelectEnsured = true;
    } catch (e) {
      // 模块缺失时静默降级为单光标，不影响其它功能
    }
  }

  // ═══ IDEA 式多光标与智能选中（Alt+J / Alt+Shift+J / Ctrl+Alt+J / Alt+W / Esc）═══
  // 词边界采用"分隔符区分"语义：空白与标点（ASCII + 全角）视为分隔符，
  // 中文按连续非分隔符成词（与用户习惯的 IDEA Ctrl+W 一致）。
  var ALTJ_SEP_RE = /[\s.,;:!?()\[\]{}<>"'`~@#$%^&*+\-=|\\/，。；：！？、（）【】《》〈〉「」『』“”‘’…·—–]/;
  var ALTJ_SENT_RE = /[。！？.!?]/;

  /** 取 (row, col) 处按分隔符界定的词范围 */
  function altjTokenRangeAt(session, row, col) {
    var line = session.getLine(row) || '';
    var s = col, e = col;
    while (s > 0 && !ALTJ_SEP_RE.test(line.charAt(s - 1))) s--;
    while (e < line.length && !ALTJ_SEP_RE.test(line.charAt(e))) e++;
    return new Range(row, s, row, e);
  }

  /**
   * 从 (fromRow, fromCol) 起向后查找下一个 needle（大小写敏感、精确匹配）。
   * 单行 needle 走逐行 indexOf 快速扫描；跨行 needle 回退全文检索。
   */
  function altjFindNext(session, needle, fromRow, fromCol, wrap) {
    var lineCount = session.getLength();
    if (needle.indexOf('\n') === -1) {
      var row = fromRow, col = fromCol, steps = 0;
      while (steps <= lineCount) {
        var line = session.getLine(row) || '';
        var idx = line.indexOf(needle, col);
        if (idx !== -1) return new Range(row, idx, row, idx + needle.length);
        row++; col = 0; steps++;
        if (row >= lineCount) {
          if (!wrap) return null;
          row = 0;
        }
      }
      return null;
    }
    var full = session.getValue();
    var startOff = session.doc && session.doc.positionToIndex
      ? session.doc.positionToIndex({ row: fromRow, column: fromCol }) : 0;
    var off = full.indexOf(needle, startOff);
    if (off === -1 && wrap) off = full.indexOf(needle, 0);
    if (off === -1) return null;
    var s = session.doc.indexToPosition(off);
    var e = session.doc.indexToPosition(off + needle.length);
    return new Range(s.row, s.column, e.row, e.column);
  }

  /** 当前待匹配文本：无选区取光标处词，否则取最后选区的文本 */
  function altjTargetText(editor) {
    var sel = editor.selection;
    var pos = editor.getCursorPosition();
    if (sel.isEmpty()) {
      var tk = altjTokenRangeAt(editor.session, pos.row, pos.column);
      return tk.end.column > tk.start.column ? editor.session.getTextRange(tk) : '';
    }
    var ranges = sel.getAllRanges();
    return editor.session.getTextRange(ranges[ranges.length - 1]);
  }

  /** Alt+J：无选区先选中光标处词；已有选区则追加下一个相同文本为多光标 */
  function altjSelectNext(editor) {
    ensureAceMultiSelect();
    var sel = editor.selection;
    var pos = editor.getCursorPosition();
    if (sel.isEmpty()) {
      var tk = altjTokenRangeAt(editor.session, pos.row, pos.column);
      if (tk.end.column > tk.start.column) sel.setSelectionRange(tk);
      return;
    }
    var ranges = sel.getAllRanges();
    var last = ranges[ranges.length - 1];
    var text = editor.session.getTextRange(last);
    if (!text) return;
    var found = altjFindNext(editor.session, text, last.end.row, last.end.column, true);
    // 防误判：找到的区间与最后选区完全相同（全文仅此一处时 wrap 回到自身）则忽略
    if (found && !(found.start.row === last.start.row && found.start.column === last.start.column
      && found.end.row === last.end.row && found.end.column === last.end.column)) {
      sel.addRange(found, false);
      editor.renderer.scrollSelectionIntoView(found.start, found.end, 0.5);
    }
  }

  /** Alt+Shift+J：撤销最后一个选中项（回退一步） */
  function altjUnselectPrev(editor) {
    ensureAceMultiSelect();
    var sel = editor.selection;
    var ranges = sel.getAllRanges();
    if (ranges.length <= 1) return;
    var kept = ranges.slice(0, ranges.length - 1);
    sel.clearSelection();
    kept.forEach(function (r) { sel.addRange(r, false); });
    var last = kept[kept.length - 1];
    editor.renderer.scrollSelectionIntoView(last.start, last.end, 0.5);
  }

  /** Ctrl+Alt+J：选中所有相同项（转为多光标） */
  function altjSelectAll(editor) {
    ensureAceMultiSelect();
    var text = altjTargetText(editor);
    if (!text) return;
    var full = editor.session.getValue();
    var found = [];
    var off = 0;
    while ((off = full.indexOf(text, off)) !== -1) {
      var s = editor.session.doc.indexToPosition(off);
      var e = editor.session.doc.indexToPosition(off + text.length);
      found.push(new Range(s.row, s.column, e.row, e.column));
      off += text.length;
      if (text.length === 0) break; // 防空匹配死循环
    }
    if (found.length) {
      var sel = editor.selection;
      sel.clearSelection();
      found.forEach(function (r) { sel.addRange(r, false); });
      var last = found[found.length - 1];
      editor.renderer.scrollSelectionIntoView(last.start, last.end, 0.5);
    }
  }

  /** 单段选区按分隔符扩展一级：词 → 句子(含句末标点) → 整行 → 段落 */
  function altwExpandRange(session, range) {
    var tk2 = altjTokenRangeAt(session, range.start.row, range.start.column);
    var isToken = range.start.row === tk2.start.row && range.end.row === tk2.end.row
      && range.start.column === tk2.start.column && range.end.column === tk2.end.column;
    if (isToken) {
      // 词 → 句子（同句内按句末标点扩展，包含句末标点）
      var line = session.getLine(range.start.row) || '';
      var s = range.start.column, e = range.end.column;
      while (s > 0 && !ALTJ_SENT_RE.test(line.charAt(s - 1))) s--;
      while (e < line.length && !ALTJ_SENT_RE.test(line.charAt(e))) e++;
      if (e < line.length && ALTJ_SENT_RE.test(line.charAt(e))) e++;
      return new Range(range.start.row, s, range.end.row, e);
    }
    var singleLine = range.start.row === range.end.row;
    var lineLen = (session.getLine(range.start.row) || '').length;
    var isWholeLine = singleLine && range.start.column === 0 && range.end.column === lineLen;
    if (singleLine && !isWholeLine) {
      // 句子/部分选区 → 整行
      return new Range(range.start.row, 0, range.end.row, lineLen);
    }
    // 整行（或多行）→ 段落：向上下扩展到空行边界
    var startRow = range.start.row, endRow = range.end.row;
    var total = session.getLength();
    while (startRow > 0 && (session.getLine(startRow - 1) || '').trim() !== '') startRow--;
    while (endRow < total - 1 && (session.getLine(endRow + 1) || '').trim() !== '') endRow++;
    return new Range(startRow, 0, endRow, (session.getLine(endRow) || '').length);
  }

  /** Alt+W：按分隔符逐级扩展选区 词 → 句子 → 整行 → 段落；多光标时每个光标独立扩展 */
  function altwSmartSelect(editor) {
    var sel = editor.selection;
    var session = editor.session;
    var ranges = sel.getAllRanges();
    if (!ranges.length) return;
    if (sel.isEmpty()) {
      // L0 → 词
      var pos = editor.getCursorPosition();
      var tk = altjTokenRangeAt(session, pos.row, pos.column);
      if (tk.end.column > tk.start.column) sel.setSelectionRange(tk);
      return;
    }
    var expanded = ranges.map(function (r) { return altwExpandRange(session, r); });
    sel.clearSelection();
    expanded.forEach(function (r) { sel.addRange(r, false); });
    var last = expanded[expanded.length - 1];
    editor.renderer.scrollSelectionIntoView(last.start, last.end, 0.5);
  }

  /** VS Code 语义大小写切换：全大写（不含小写）→ 全小写；其余情况（含小写/混合）→ 全大写 */
  function toggleCaseText(text) {
    if (!text) return text;
    if (/[A-Z]/.test(text) && !/[a-z]/.test(text)) return text.toLowerCase();
    return text.toUpperCase();
  }

  /** 逆扩展一级（Alt+Shift+W，确定性）：
   *  词 → 光标（空选区）；句子/部分行 → 起点处词；
   *  整行 → 起点所在句子（到首个句末标点为止；无句末标点则回退起点处词，防卡死）；
   *  多行/段落 → 起点行整行 */
  function altwShrinkRange(session, range) {
    var startRow = range.start.row, startCol = range.start.column;
    var tk = altjTokenRangeAt(session, startRow, startCol);
    var isToken = range.start.row === tk.start.row && range.start.column === tk.start.column
      && range.end.row === tk.end.row && range.end.column === tk.end.column;
    if (isToken) {
      // 词 → 光标（空选区）
      return new Range(startRow, startCol, startRow, startCol);
    }
    var singleLine = range.start.row === range.end.row;
    var lineLen = (session.getLine(startRow) || '').length;
    var isWholeLine = singleLine && range.start.column === 0 && range.end.column === lineLen;
    if (singleLine && !isWholeLine) {
      // 句子/部分行 → 起点处词
      return tk;
    }
    if (isWholeLine) {
      // 整行 → 起点所在句子（到首个句末标点为止）
      var line = session.getLine(startRow) || '';
      var e = lineLen;
      for (var i = 0; i < lineLen; i++) {
        if (ALTJ_SENT_RE.test(line.charAt(i))) { e = i + 1; break; }
      }
      if (e >= lineLen) return tk; // 无句末标点（结果=整行）→ 回退起点处词
      return new Range(startRow, 0, startRow, e);
    }
    // 多行/段落 → 起点行整行
    return new Range(startRow, 0, startRow, lineLen);
  }

  /** Alt+Shift+W：逆扩展选区；多光标时每个光标独立收缩 */
  function altwShrinkSelection(editor) {
    var sel = editor.selection;
    var session = editor.session;
    var ranges = sel.getAllRanges();
    if (!ranges.length || sel.isEmpty()) return; // 空选区无可收缩
    var shrunk = ranges.map(function (r) { return altwShrinkRange(session, r); });
    sel.clearSelection();
    shrunk.forEach(function (r) { sel.addRange(r, false); });
    var last = shrunk[shrunk.length - 1];
    editor.renderer.scrollSelectionIntoView(last.start, last.end, 0.5);
  }

  function updateStatusBar() {
    const langMap = { text: '纯文本', json: 'JSON', xml: 'XML', sql: 'SQL', markdown: 'Markdown',
      javascript: 'JavaScript', python: 'Python', yaml: 'YAML', css: 'CSS', html: 'HTML' };
    const lang = elements.languageSelect.value;
    elements.statusLang.textContent = langMap[lang] || lang;
    const tabSize = mainEditor.session.getTabSize();
    elements.statusTabSize.textContent = 'Tab: ' + tabSize;
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

  let smartClipPending = null;

  function closeClipMenu() {
    elements.clipMenu.hidden = true;
    elements.clipCaretBtn.setAttribute('aria-expanded', 'false');
  }

  function toggleClipMenu(event) {
    if (event) event.stopPropagation();
    const willOpen = elements.clipMenu.hidden;
    elements.clipMenu.hidden = !willOpen;
    elements.clipCaretBtn.setAttribute('aria-expanded', String(willOpen));
  }

  async function smartClip() {
    // 编辑既有剪藏时走原表单更新流程，避免智能直存覆盖原条目
    if (state.clipId) { openClipModal(); return; }
    const context = buildClipContext();
    if (!context.content.trim()) { showToast('没有可保存的内容', true); return; }
    const btn = document.getElementById('clipBtn');
    btn.disabled = true;
    btn.textContent = '⚡ 识别中…';
    try {
      const response = await fetch(`${API_BASE_URL}/detect-structured`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: context.content })
      });
      if (!response.ok) throw new Error(await response.text() || `HTTP ${response.status}`);
      const detection = await response.json();
      if (detection && detection.detected) {
        if (detection.method === 'regex') {
          // 正则命中：分层免确认，直接入库
          await saveSmartClip(detection);
        } else {
          openSmartClipConfirm(detection);
        }
      } else {
        smartClipPending = detection || {};
        openModal(elements.smartClipFallbackModal);
      }
    } catch (error) {
      handleError('智能剪藏识别失败', error);
      openClipModal(); // 识别异常时回退到详细剪藏表单，保证内容不丢
    } finally {
      btn.disabled = false;
      btn.textContent = '⚡ 智能剪藏';
    }
  }

  function openSmartClipConfirm(detection) {
    smartClipPending = detection;
    elements.smartClipMethodHint.textContent = detection.method === 'llm'
      ? '已通过 AI 智能解析，预览为落库后的 Markdown 视图'
      : '已识别结构化章节，预览为落库后的 Markdown 视图';
    try {
      elements.smartClipPreview.innerHTML = window.MediaKit && window.MediaKit.render
        ? window.MediaKit.render.renderMarkdown(detection.mdPreview || '')
        : (detection.mdPreview || '').replace(/</g, '&lt;');
    } catch (error) {
      elements.smartClipPreview.textContent = detection.mdPreview || '';
    }
    openModal(elements.smartClipConfirmModal);
  }

  async function saveSmartClip(detection) {
    const method = detection.method || 'regex';
    const type = method === 'llm' ? 'ai-text' : 'store-only';
    const context = buildClipContext();
    const payload = {
      content: detection.content || context.content,
      title: detection.title || (state.fileName ? state.fileName.replace(/\.[^.]+$/, '') : '') || '编辑器内容',
      type,
      source: 'editor',
      category: null,
      tags: detection.tags || [],
      summary: detection.summary || null,
      analysis: detection.analysis || null,
      myThoughts: detection.myThoughts || null,
      useAiTags: false,
      workflowStatus: 'inbox',
      captureMethod: context.selection ? 'editor-selection' : 'editor-document',
      selectedText: context.selectedText,
      contextBefore: context.contextBefore,
      contextAfter: context.contextAfter,
      contentFormat: elements.languageSelect.value,
      sourceFileName: state.fileName || null,
      sourceEncoding: state.encoding,
      sourceLineEnding: state.lineEnding
    };
    elements.smartClipSaveBtn.disabled = true;
    try {
      const saved = await postSmartClip(payload);
      if (saved) {
        closeModal(elements.smartClipConfirmModal);
        closeModal(elements.smartClipFallbackModal);
      }
    } finally {
      elements.smartClipSaveBtn.disabled = false;
    }
  }

  async function saveSmartClipFallback() {
    const context = buildClipContext();
    const payload = {
      content: context.content,
      title: (state.fileName ? state.fileName.replace(/\.[^.]+$/, '') : '') || '编辑器内容',
      type: 'store-only',
      source: 'editor',
      category: null,
      tags: [],
      summary: context.content,
      analysis: null,
      myThoughts: null,
      useAiTags: false,
      workflowStatus: 'inbox',
      captureMethod: context.selection ? 'editor-selection' : 'editor-document',
      selectedText: context.selectedText,
      contextBefore: context.contextBefore,
      contextAfter: context.contextAfter,
      contentFormat: elements.languageSelect.value,
      sourceFileName: state.fileName || null,
      sourceEncoding: state.encoding,
      sourceLineEnding: state.lineEnding
    };
    elements.smartClipFallbackSaveBtn.disabled = true;
    try {
      const saved = await postSmartClip(payload);
      if (saved) closeModal(elements.smartClipFallbackModal);
    } finally {
      elements.smartClipFallbackSaveBtn.disabled = false;
    }
  }

  async function postSmartClip(payload) {
    try {
      const response = await fetch(`${API_BASE_URL}/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(await response.text() || `HTTP ${response.status}`);
      const result = await response.json();
      if (result && result.status === 'duplicate') {
        showToast('已存在相同剪藏，未重复保存', false, 'warning');
        return false;
      }
      state.clipId = result.id || state.clipId;
      state.clipType = payload.type;
      state.clipMetadata = {
        title: payload.title,
        category: payload.category,
        tags: payload.tags,
        myThoughts: payload.myThoughts
      };
      updateDocumentIdentity();
      showUndoToast(state.clipId);
      window.parent.postMessage({ type: 'editorClipSaved', clipId: state.clipId }, '*');
      FrontendLogger.info('[Editor] Smart clip saved', state.clipId, payload.content.length);
      return true;
    } catch (error) {
      handleError('保存剪藏失败', error);
      return false;
    }
  }

  function showUndoToast(clipId) {
    if (window.UI && UI.toast) {
      const toastEl = UI.toast(clipId ? `剪藏 #${clipId} 已保存` : '剪藏已保存', { type: 'success', duration: 6000 });
      const action = document.createElement('button');
      action.className = 'ui-toast__action';
      action.textContent = '撤销';
      action.addEventListener('click', () => undoSmartClip(clipId));
      toastEl.appendChild(action);
      return;
    }
    showToast(clipId ? `剪藏 #${clipId} 已保存` : '剪藏已保存', false, 'success');
  }

  async function undoSmartClip(clipId) {
    if (!clipId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/${clipId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await response.text() || `HTTP ${response.status}`);
      if (String(state.clipId) === String(clipId)) {
        state.clipId = null;
        state.clipType = null;
        state.clipMetadata = null;
        updateDocumentIdentity();
      }
      showToast('已撤销剪藏，内容未入库', false, 'success');
    } catch (error) {
      handleError('撤销剪藏失败', error);
    }
  }

  async function openClipModal() {
    const context = buildClipContext();
    elements.clipModalTitle.textContent = state.clipId ? `更新剪藏 #${state.clipId}` : '存入剪藏';
    elements.clipScopeDescription.textContent = state.clipId
      ? '将当前全文更新回原剪藏，AI 分析与附件不会被覆盖。'
      : (context.selection ? `保存当前选区，共 ${context.content.length} 字符。` : `保存当前全文，共 ${context.content.length} 字符。`);
    const parsed = !state.clipId ? parseStructuredContent(context.content) : { summary: null, tags: [], title: null };
    elements.clipTitleInput.value = state.clipMetadata?.title
      || parsed.title
      || state.fileName.replace(/\.[^.]+$/, '')
      || '编辑器内容';
    elements.clipModeSelect.value = state.clipType || 'store-only';
    elements.clipModeSelect.disabled = Boolean(state.clipId);
    elements.clipTagsInput.value = (state.clipMetadata?.tags && state.clipMetadata.tags.length > 0
      ? state.clipMetadata.tags : parsed.tags).join(', ');
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

  function parseStructuredContent(fullText) {
    const result = { summary: null, tags: [], title: null };
    if (!fullText || !fullText.includes('###')) return result;

    const summaryMatch = fullText.match(/###\s*摘要\s*\n([\s\S]*?)(?=\n###\s|$)/);
    if (summaryMatch) {
      result.summary = summaryMatch[1].trim();
    }

    const tagsMatch = fullText.match(/###\s*标签\s*\n([\s\S]*?)(?=\n###\s|$)/);
    if (tagsMatch) {
      const tagText = tagsMatch[1].trim();
      const backtickTags = tagText.match(/`[^`]+`/g);
      if (backtickTags) {
        result.tags = backtickTags.map(t => t.replace(/`/g, '').trim()).filter(Boolean);
      } else {
        result.tags = tagText.split(/[,\n]/).map(t => t.trim()).filter(Boolean);
      }
    }

    const firstHeading = fullText.indexOf('###');
    if (firstHeading > 0) {
      const beforeHeading = fullText.substring(0, firstHeading).trim();
      const firstLine = beforeHeading.split('\n')[0].trim();
      if (firstLine) result.title = firstLine;
    }

    return result;
  }

  async function submitClip() {
    const context = buildClipContext();
    if (!context.content.trim()) {
      showToast('没有可保存的内容', true);
      return;
    }
    const type = state.clipId ? state.clipType : elements.clipModeSelect.value;
    const tags = elements.clipTagsInput.value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean).slice(0, 10);
    const parsed = parseStructuredContent(context.content);
    const effectiveTags = tags.length > 0 ? tags : parsed.tags.slice(0, 10);
    // 编辑 Web Clipper 剪藏时，正文写回 bodyContent（保留 content 中的 wiki-link）
    const isWebClipperEdit = state.clipId && state.clipMetadata && state.clipMetadata.hasBodyContent;
    const payload = {
      content: isWebClipperEdit ? (state.originalClipContent || '') : context.content,
      bodyContent: isWebClipperEdit ? context.content : undefined,
      title: elements.clipTitleInput.value.trim() || parsed.title || state.fileName,
      type,
      source: 'editor',
      category: elements.clipCategorySelect.value || null,
      tags: effectiveTags,
      summary: parsed.summary,
      useAiTags: type === 'ai-text' && effectiveTags.length === 0,
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
      state.originalClipContent = clip.content || '';
      state.clipMetadata = {
        title: clip.title,
        category: clip.category,
        tags: clip.tags || [],
        myThoughts: clip.myThoughts,
        hasBodyContent: !!(clip.bodyContent && clip.bodyContent.trim())
      };
      // 优先显示源文件正文（Web Clipper 文档），否则显示 content（可能为 wiki-link）
      let editorContent = (clip.bodyContent && clip.bodyContent.trim()) ? clip.bodyContent : (clip.content || '');
      // 插件剪藏偶发正文为空（纯 JS/稀疏页抓取），回退到选中文本/摘要，避免编辑器空白
      if (!editorContent.trim() && clip.selectedText && clip.selectedText.trim()) editorContent = clip.selectedText;
      if (!editorContent.trim() && clip.summary && clip.summary.trim()) editorContent = clip.summary;
      if (!editorContent.trim()) editorContent = `（该剪藏无正文内容，ID: ${clip.id}）`;
      const format = clip.contentFormat || EditorCore.detectLanguage(clip.sourceFileName || clip.title, editorContent);
      setEditorContent(editorContent, {
        fileName: clip.sourceFileName || `${clip.title || `clip-${clip.id}`}.${format === 'text' ? 'txt' : (format === 'markdown' ? 'md' : format)}`,
        displayPath: `剪藏 #${clip.id}`,
        encoding: clip.sourceEncoding || 'UTF-8',
        encodingConfidence: '剪藏元数据',
        lineEnding: clip.sourceLineEnding || EditorCore.detectLineEnding(editorContent),
        language: format
      });
      state.clipId = clip.id;
      state.clipType = clip.type || 'store-only';
      updateDocumentIdentity();
      renderTabBar();
      showToast(`已打开剪藏 #${clip.id}`);
      // 写入「来自收件箱」最近分组（写作侧一键回看）
      recordRecentFile(`剪藏 #${clip.id}`, clip.title || clip.sourceFileName || `剪藏 #${clip.id}`, { source: 'clip', clipId: clip.id });
    } catch (error) {
      handleError('打开剪藏失败', error);
    }
  }

  /**
   * 在新标签页中打开剪藏内容（类似 Ctrl+T + 打开文件）
   */
  async function loadClipInNewTab(clipId) {
    if (!clipId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/${clipId}`);
      if (!response.ok) throw new Error(response.status === 404 ? '剪藏不存在' : `HTTP ${response.status}`);
      const clip = await response.json();

      // 保存当前标签快照，创建新标签
      saveActiveTabSnapshot();
      const newTab = createTabState();
      tabs.push(newTab);
      activeTabIndex = tabs.length - 1;
      state = tabs[activeTabIndex];
      ensureAiChatState(state);

      state.clipId = clip.id;
      state.clipType = clip.type || 'store-only';
      state.originalClipContent = clip.content || '';
      state.clipMetadata = {
        title: clip.title,
        category: clip.category,
        tags: clip.tags || [],
        myThoughts: clip.myThoughts,
        hasBodyContent: !!(clip.bodyContent && clip.bodyContent.trim())
      };
      // 优先显示源文件正文（Web Clipper 文档），否则显示 content（可能为 wiki-link）
      let editorContent = (clip.bodyContent && clip.bodyContent.trim()) ? clip.bodyContent : (clip.content || '');
      // 插件剪藏偶发正文为空（纯 JS/稀疏页抓取），回退到选中文本/摘要，避免编辑器空白
      if (!editorContent.trim() && clip.selectedText && clip.selectedText.trim()) editorContent = clip.selectedText;
      if (!editorContent.trim() && clip.summary && clip.summary.trim()) editorContent = clip.summary;
      if (!editorContent.trim()) editorContent = `（该剪藏无正文内容，ID: ${clip.id}）`;
      const format = clip.contentFormat || EditorCore.detectLanguage(clip.sourceFileName || clip.title, editorContent);
      setEditorContent(editorContent, {
        fileName: clip.sourceFileName || `${clip.title || `clip-${clip.id}`}.${format === 'text' ? 'txt' : (format === 'markdown' ? 'md' : format)}`,
        displayPath: `剪藏 #${clip.id}`,
        encoding: clip.sourceEncoding || 'UTF-8',
        encodingConfidence: '剪藏元数据',
        lineEnding: clip.sourceLineEnding || EditorCore.detectLineEnding(editorContent),
        language: format
      });
      state.clipId = clip.id;
      state.clipType = clip.type || 'store-only';
      updateDocumentIdentity();
      renderTabBar();
      // 首屏优先：AI 侧栏渲染移到下一帧，避免拖慢正文首屏
      requestAnimationFrame(function () { renderAiChat(); });
      mainEditor.focus();
      showToast(`已打开剪藏 #${clip.id}`);
      // 写入「来自收件箱」最近分组（写作侧一键回看）
      recordRecentFile(`剪藏 #${clip.id}`, clip.title || clip.sourceFileName || `剪藏 #${clip.id}`, { source: 'clip', clipId: clip.id });
      showToast(`已在新标签打开剪藏 #${clip.id}`);
    } catch (error) {
      handleError('在新标签打开剪藏失败', error);
    }
  }

  // 系统右键菜单「用编辑器打开」：父页面读取文件后传入数据，在新标签页打开
  function openFileDataInNewTab(fileData) {
    if (!fileData || fileData.canceled) return;
    saveActiveTabSnapshot();
    var newTab = createTabState();
    tabs.push(newTab);
    activeTabIndex = tabs.length - 1;
    state = tabs[activeTabIndex];
    state.clipId = null;
    state.clipType = 'store-only';
    state.clipMetadata = null;
    setEditorContent(fileData.text, {
      fileToken: fileData.fileToken,
      fileName: fileData.fileName,
      displayPath: fileData.displayPath,
      encoding: fileData.encoding,
      lineEnding: fileData.lineEnding
    });
    renderTabBar();
    renderAiChat();
    mainEditor.focus();
    showToast('已打开 ' + fileData.fileName);
    recordRecentFile(fileData.displayPath || fileData.filePath, fileData.fileName);
  }

  // 系统右键菜单「PDF OCR」：在新标签页打开识别结果文本
  function openTextInNewTab(text, title) {
    saveActiveTabSnapshot();
    var newTab = createTabState();
    tabs.push(newTab);
    activeTabIndex = tabs.length - 1;
    state = tabs[activeTabIndex];
    state.clipId = null;
    state.clipType = 'store-only';
    state.clipMetadata = null;
    setEditorContent(text || '', {
      fileName: title || '未命名',
      displayPath: title || '未命名'
    });
    renderTabBar();
    renderAiChat();
    mainEditor.focus();
    showToast('已打开 ' + (title || '未命名'));
  }

  function showToast(message, error, type) {
    // 类型：'success' | 'error' | 'info' | 'warning'
    var notificationType = type || (error ? 'error' : 'info');
    if (window.UI && UI.toast) {
      UI.toast(message, { type: notificationType, duration: notificationType === 'error' ? 4000 : notificationType === 'warning' ? 3500 : 2600 });
      return;
    }
    clearTimeout(showToast.timer);
    elements.toast.textContent = message;
    elements.toast.className = 'toast show ' + notificationType;
    // 不同类型不同持续时间
    var duration = notificationType === 'error' ? 4000 : notificationType === 'warning' ? 3500 : 2600;
    showToast.timer = setTimeout(function() {
      elements.toast.classList.remove('show');
    }, duration);
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
    if (featureOn('docStatsZoom')) scheduleDocStatsUpdate();
    // B3：粘贴长文本场景，内容变化后防抖复查超长行
    if (featureOn('longLineWrap') && state && state.lastContentBytes <= 2 * 1024 * 1024) applyLongLineMode();
  });

  // A1：中文输入法友好——composition 期间暂停「跟随」任务（预览/反链/自动保存/字数），结束再补一次
  let composing = false;
  if (featureOn('imeComposition') && mainEditor.container) {
    mainEditor.container.addEventListener('compositionstart', function () { composing = true; });
    mainEditor.container.addEventListener('compositionend', function () {
      composing = false;
      if (!elements.markdownPane.hidden) scheduleMarkdownRender();
      scheduleBacklinksRefresh();
      if (autosaveChangeHandler) autosaveChangeHandler();
      if (featureOn('docStatsZoom')) scheduleDocStatsUpdate();
    });
  }
  function isComposing() { return composing; }

  // A4：状态栏更新合并到帧——高频移动/拖选只在本帧内更新一次
  let cursorStatusRaf = 0;
  function scheduleCursorStatus() {
    if (cursorStatusRaf) return;
    cursorStatusRaf = requestAnimationFrame(function () {
      cursorStatusRaf = 0;
      updateCursorStatus();
    });
  }
  mainEditor.selection.on('changeCursor', function () {
    if (featureOn('statusRaf')) scheduleCursorStatus(); else updateCursorStatus();
  });
  mainEditor.selection.on('changeSelection', function () {
    if (featureOn('statusRaf')) scheduleCursorStatus(); else updateCursorStatus();
  });
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

  // D1：标签中键关闭（Notepad++ 行为，未保存走既有确认逻辑）
  if (featureOn('middleClickCloseTab') && elements.tabBar) {
    elements.tabBar.addEventListener('auxclick', function (e) {
      if (e.button !== 1) return;
      var item = e.target && e.target.closest ? e.target.closest('.tab-item') : null;
      if (!item) return;
      e.preventDefault();
      var idx = parseInt(item.dataset.tabIndex, 10);
      if (!isNaN(idx) && tabs[idx]) closeTab(idx);
    });
  }
  document.getElementById('formatBtn').addEventListener('click', formatCurrentContentAuto);
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
  document.getElementById('markdownBtn').addEventListener('click', () => toggleMarkdownPreview());
  // ── 导出下拉菜单（图标 + 二级选项：Markdown / PDF / Word）──
  var exportBtn = document.getElementById('exportBtn');
  var exportMenu = document.getElementById('exportMenu');
  function setExportMenu(open) {
    if (!exportMenu) return;
    exportMenu.hidden = !open;
    exportBtn && exportBtn.classList.toggle('active', open);
  }
  function toggleExportMenu() { setExportMenu(exportMenu.hidden); }
  exportBtn && exportBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    toggleExportMenu();
  });
  // 点击菜单项后关闭；点击外部区域关闭
  document.addEventListener('click', function (e) {
    var wrap = exportBtn && exportBtn.closest('.toolbar-export');
    if (!wrap || !wrap.contains(e.target)) setExportMenu(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && exportMenu && !exportMenu.hidden) setExportMenu(false);
  });
  // ── 更多工具溢出菜单（低频动作收纳） ──
  var moreBtn = document.getElementById('moreBtn');
  var moreMenu = document.getElementById('moreMenu');
  function setMoreMenu(open) {
    if (!moreMenu) return;
    moreMenu.hidden = !open;
    moreBtn && moreBtn.classList.toggle('active', open);
  }
  function toggleMoreMenu() { setMoreMenu(moreMenu.hidden); }
  moreBtn && moreBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    setExportMenu(false);   // 互斥：展开更多时收起导出菜单
    toggleMoreMenu();
  });
  document.addEventListener('click', function (e) {
    var wrap = moreBtn && moreBtn.closest('.toolbar-more');
    if (!wrap || !wrap.contains(e.target)) setMoreMenu(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && moreMenu && !moreMenu.hidden) setMoreMenu(false);
  });
  // 点击任一菜单项后自动收起
  moreMenu && moreMenu.addEventListener('click', function (e) {
    if (e.target.closest('.toolbar-more-item')) setMoreMenu(false);
  });
  document.getElementById('exportMarkdownBtn').addEventListener('click', function (e) {
    e.stopPropagation(); setExportMenu(false); exportToMarkdown();
  });
  document.getElementById('exportWordLegacyBtn').addEventListener('click', function (e) {
    e.stopPropagation(); setExportMenu(false); exportToWord();
  });
  document.getElementById('exportPdfBtn').addEventListener('click', function (e) {
    e.stopPropagation(); setExportMenu(false); exportToPdf();
  });
  elements.closeMarkdownBtn.addEventListener('click', () => toggleMarkdownPreview(false));
  elements.mdFullscreenBtn.addEventListener('click', () => toggleMarkdownFullscreen());
  document.getElementById('terminalBtn').addEventListener('click', openTerminalInDir);

  // 在系统终端中打开当前文件所在目录（无则回退知识库根目录）
  // ── 快捷键速查弹窗：可配置项读 EditorShortcuts 实际生效值，固定键静态展示 ──
  var shortcutFixedRows = [
    ['新建标签', 'Ctrl+T', 'newTab'], ['新建文件', 'Ctrl+N', 'newFile'], ['打开文件', 'Ctrl+O', 'openFile'],
    ['跳转到行', 'Ctrl+G（不区分大小写）'], ['保存', 'Ctrl+S', 'save'], ['格式化(自动识别)', 'Ctrl+Shift+L', 'formatDoc'], ['转换面板', 'Ctrl+Shift+X'],
    ['Markdown 预览', 'Ctrl+Shift+M', 'markdownPreview'], ['编辑器设置', 'Ctrl+,'], ['全屏', 'F11'],
    ['命令面板', 'Ctrl+P'], ['终端跟随目录', 'Alt+T', 'terminal'], ['撤销', 'Ctrl+Z'],
    ['重做', 'Ctrl+Shift+Z'], ['字体放大', 'Ctrl+='], ['字体缩小', 'Ctrl+-'],
    ['插入图片', 'Ctrl+Shift+I', 'insertImage'], ['唤起浏览器控制台', 'Ctrl+F12'], ['双击选词同词高亮', '双击'],
    ['AceJump 跳跃导航', 'Ctrl+;'], ['返回编辑位置', 'Ctrl+Alt+←'], ['前进编辑位置', 'Ctrl+Alt+→'],
    ['选中下一个相同项', 'Alt+J', 'selectNextOccurrence'], ['撤销上一个选中', 'Alt+Shift+J', 'unselectPreviousOccurrence'], ['选中所有相同项', 'Ctrl+Alt+J', 'selectAllOccurrences'],
    ['智能选中（词/句/行/段）', 'Alt+W', 'expandSmartSelection'], ['收起多光标', 'Esc'],
    ['大小写切换', 'Ctrl+Shift+U', 'toggleCase'], ['收缩选区（逆扩展）', 'Alt+Shift+W', 'shrinkSmartSelection'], ['删除整行', 'Ctrl+Shift+K', 'deleteLine'],
    ['复制行', 'Shift+Alt+↑/↓'], ['移动行', 'Alt+↑/↓'], ['添加光标', 'Ctrl+Alt+↑/↓']
  ].filter(function (row) { return row; });
  function buildShortcutRows(rows) {
    var EAS = window.EditorAceShortcuts;
    return rows.map(function (r) {
      var combo = r[1];
      var tag = '';
      if (r[2] && EAS && EAS.get(r[2])) {
        combo = EAS.get(r[2]);
        tag = '<span class="ace-sc-tag">可配置</span>';
      }
      return '<div class="shortcut-row">'
        + '<span class="shortcut-name">' + r[0] + '</span>'
        + '<kbd class="shortcut-keys">' + platformShortcut(combo) + '</kbd>' + tag
        + '</div>';
    }).join('');
  }
  // 键盘模式（Ace/Vim/Emacs/Sublime/VSCode）常用键位静态说明（仅查看，不可修改）
  var MODE_SHORTCUTS = {
    'Ace': [
      ['新开标签', 'Ctrl+T'], ['保存', 'Ctrl+S'], ['撤销', 'Ctrl+Z'], ['重做', 'Ctrl+Shift+Z'],
      ['查找', 'Ctrl+F'], ['替换', 'Ctrl+H'], ['跳转到行', 'Ctrl+G'], ['跳转行首', 'Ctrl+Home'], ['跳转行尾', 'Ctrl+End'],
      ['多光标', 'Alt+Click'], ['选中下一个匹配', 'Ctrl+D'], ['缩进', 'Tab'], ['取消缩进', 'Shift+Tab'],
      ['整行注释', 'Ctrl+/'], ['删除当前行', 'Ctrl+Shift+D'], ['向上复制行', 'Shift+Alt+↑'], ['移动行', 'Alt+↑/↓']
    ],
    'Vim': [
      ['正常模式', 'Esc'], ['向左移动', 'h'], ['向下移动', 'j'], ['向上移动', 'k'], ['向右移动', 'l'],
      ['光标前插入', 'i'], ['行尾追加', 'A'], ['下方新建行', 'o'], ['可视模式', 'v'], ['可视行', 'V'], ['可视块', 'Ctrl+V'],
      ['删除行', 'dd'], ['复制行', 'yy'], ['粘贴', 'p'], ['撤销', 'u'], ['重做', 'Ctrl+R'],
      ['保存', ':w'], ['退出', ':q'], ['保存并退出', ':wq'], ['查找', '/'], ['下一个匹配', 'n'],
      ['上翻页', 'Ctrl+B'], ['下翻页', 'Ctrl+F'], ['跳转到顶部', 'gg'], ['跳转到底部', 'G'], ['行首', '^'], ['行尾', '$']
    ],
    'Emacs': [
      ['前移光标', 'Ctrl+F'], ['后移光标', 'Ctrl+B'], ['下移', 'Ctrl+N'], ['上移', 'Ctrl+P'],
      ['行首', 'Ctrl+A'], ['行尾', 'Ctrl+E'], ['删除到行尾', 'Ctrl+K'], ['剪切词/选区', 'Ctrl+W'],
      ['复制选区', 'Alt+W'], ['粘贴', 'Ctrl+Y'], ['查找', 'Ctrl+S'], ['反向查找', 'Ctrl+R'], ['取消', 'Ctrl+G'],
      ['保存', 'Ctrl+X Ctrl+S'], ['打开文件', 'Ctrl+X Ctrl+F'], ['切换缓冲区', 'Ctrl+X Ctrl+B']
    ],
    'Sublime': [
      ['查找', 'Ctrl+F'], ['查找下一个', 'F3'], ['查找上一个', 'Shift+F3'], ['替换', 'Ctrl+H'], ['快速打开文件', 'Ctrl+P'],
      ['选中单词', 'Ctrl+D'], ['拆分选择为多光标', 'Ctrl+Shift+L'], ['选择当前行', 'Ctrl+L'], ['跳转到行', 'Ctrl+G'],
      ['缩进', 'Ctrl+]'], ['取消缩进', 'Ctrl+['], ['整行注释', 'Ctrl+/'], ['撤销', 'Ctrl+Z'], ['重做', 'Ctrl+Y']
    ],
    'VSCode': [
      ['查找', 'Ctrl+F'], ['替换', 'Ctrl+H'], ['选中下一个匹配', 'Ctrl+D'], ['多光标', 'Alt+Click'],
      ['跳转到行', 'Ctrl+G'], ['快速打开文件', 'Ctrl+P'], ['整行缩进', 'Ctrl+]'], ['取消缩进', 'Ctrl+['],
      ['整行注释', 'Ctrl+/'], ['撤销', 'Ctrl+Z'], ['重做', 'Ctrl+Y'],
      ['行复制', 'Shift+Alt+↓'], ['向上移动行', 'Alt+↑'], ['向下移动行', 'Alt+↓']
    ],
    'Ace': [
      ['查找', 'Ctrl+F'], ['替换', 'Ctrl+H'], ['跳转到行', 'Ctrl+L'], ['选中下一个匹配', 'Alt+K'],
      ['多光标（Alt+Click 追加）', 'Alt+Click'], ['拆分选区为多光标', 'Ctrl+Shift+L'],
      ['撤销', 'Ctrl+Z'], ['重做', 'Ctrl+Shift+Z'], ['缩进', 'Tab'], ['取消缩进', 'Shift+Tab'], ['整行注释', 'Ctrl+/']
    ]
  };
  // Ace 模式的常用命令：从运行时 mainEditor.commands 取「真实」组合键，保证与模式对齐
  // 三元组 [命令名, 中文名, 兜底组合键（运行时缺失时使用，已按 ACE 默认修正）]
  var ACE_CMD_KEYS = [
    ['find', '查找', 'Ctrl+F'],
    ['replace', '替换', 'Ctrl+R'],
    ['gotoline', '跳转到行', 'Ctrl+L'],
    ['selectOrFindNext', '选中下一个匹配（多光标）', 'Alt+K'],
    ['undo', '撤销', 'Ctrl+Z'],
    ['redo', '重做', 'Ctrl+Shift+Z'],
    ['togglecomment', '整行注释/取消', 'Ctrl+/'],
    ['indent', '缩进', 'Tab'],
    ['outdent', '取消缩进', 'Shift+Tab'],
    ['selectNextOccurrence', '选中下一个相同项（多光标）', 'Alt+J'],
    ['unselectPreviousOccurrence', '撤销上一个选中项', 'Alt+Shift+J'],
    ['selectAllOccurrences', '选中所有相同项', 'Ctrl+Alt+J'],
    ['expandSmartSelection', '智能选中（词/句/行/段）', 'Alt+W'],
    ['collapseMultiCursor', '收起多光标', 'Esc'],
    ['toggleCase', '大小写切换', 'Ctrl+Shift+U'],
    ['shrinkSmartSelection', '收缩选区（逆扩展）', 'Alt+Shift+W'],
    ['deleteLine', '删除整行', 'Ctrl+Shift+K']
  ];
  function resolveAceModeRows() {
    var rows = [];
    ACE_CMD_KEYS.forEach(function (c) {
      var binding = c[2]; // 兜底
      try {
        var cmds = mainEditor && mainEditor.commands;
        var cmd = cmds && cmds.byName && cmds.byName[c[0]];
        var bk = cmd && cmd.bindKey;
        if (bk && typeof bk === 'object' && bk.win) binding = String(bk.win).split('|')[0].trim() || binding;
        else if (bk && typeof bk === 'string' && bk) binding = String(bk).split('|')[0].trim() || binding;
      } catch (e) { /* 保持兜底 */ }
      rows.push([c[1], binding]);
    });
    return rows;
  }
  // shortcutMode 为 null 时打开默认「快捷键速查」，否则为模式名（仅展示该模式键位）
  var shortcutMode = null;
  var SHORTCUT_MODE_NOTE = '该键盘模式未内置实际按键处理器，以下键位仅为常用参照，不可修改、不确保全部生效。';
  function renderShortcutHelp() {
    if (!elements.shortcutConfigurableList || !elements.shortcutFixedList) return;
    var isMode = shortcutMode && (MODE_SHORTCUTS[shortcutMode] || shortcutMode === 'Ace');
    // 模式分组
    if (isMode) {
      var rows = shortcutMode === 'Ace' ? resolveAceModeRows() : MODE_SHORTCUTS[shortcutMode];
      elements.shortcutModeGroupTitle.textContent = shortcutMode + ' 键盘模式快捷键（仅查看）';
      elements.shortcutModeList.innerHTML = buildShortcutRows(rows);
      var sub = document.getElementById('shortcutModalSub');
      if (sub) {
        sub.textContent = shortcutMode === 'Ace' ? '来自当前 ACE 运行时实际按键映射。' : SHORTCUT_MODE_NOTE;
        sub.style.display = '';
      }
      elements.shortcutModeGroup.hidden = false;
      elements.shortcutGroups.querySelectorAll('.shortcut-group#shortcutModeGroup ~ .shortcut-group').forEach(function (g) { g.hidden = true; });
    } else {
      elements.shortcutModeGroup.hidden = true;
      elements.shortcutGroups.querySelectorAll('.shortcut-group#shortcutModeGroup ~ .shortcut-group').forEach(function (g) { g.hidden = false; });
      var subEl = document.getElementById('shortcutModalSub');
      if (subEl) subEl.textContent = '可配置快捷键可在系统设置中修改；编辑区命令可在本弹窗直接改键';
      var configRows = Object.keys(EditorShortcuts.DEFAULTS).map(function (action) {
        return [EditorShortcuts.labelOf(action), EditorShortcuts.get(action)];
      });
      elements.shortcutConfigurableList.innerHTML = buildShortcutRows(configRows);
      elements.shortcutFixedList.innerHTML = buildShortcutRows(shortcutFixedRows);
      renderAceShortcutGroups();
    }
  }
  function openShortcutHelp(mode) {
    shortcutMode = mode || null;
    renderShortcutHelp();
    openModal(elements.shortcutModal);
  }
  elements.shortcutHelpBtn.addEventListener('click', function () { openShortcutHelp(); });
  elements.keyboardModeHelpBtn.addEventListener('click', function () {
    openShortcutHelp(elements.keyboardModeHelpSelect.value);
  });
  // ── 编辑区命令改键录制（速查弹窗内，复刻 settings.js startEsRecording 模式）──
  // 录制态由 aceShortcutRecordingInput 标记：dispatchCapture 与 aceShortcutDispatch
  // 开头均检查该标记直接放行，保证按键直达此处不被分发器吞掉。
  function aceScIdOf(input) { return input && input.dataset ? (input.dataset.aceId || '') : ''; }
  function aceScResetValue(input) {
    var id = aceScIdOf(input);
    var EAS = window.EditorAceShortcuts;
    input.value = (EAS && id && EAS.get(id)) || '';
  }
  function renderAceShortcutGroups() {
    var EAS = window.EditorAceShortcuts;
    var textList = document.getElementById('aceShortcutTextList');
    var coreList = document.getElementById('aceShortcutCoreList');
    if (!EAS || !textList || !coreList) return;
    var build = function (ids) {
      return ids.map(function (id) {
        return '<div class="shortcut-row">'
          + '<span class="shortcut-name">' + (EAS.ACE_DEFAULTS[id] || {}).label + '</span>'
          + '<input type="text" class="ace-sc-input" readonly spellcheck="false" data-ace-id="' + id + '" value="' + EAS.get(id) + '" placeholder="点击录制">'
          + '</div>';
      }).join('');
    };
    var ids = Object.keys(EAS.ACE_DEFAULTS);
    textList.innerHTML = build(ids.filter(function (id) { return EAS.ACE_DEFAULTS[id].aceOnly; }));
    coreList.innerHTML = build(ids.filter(function (id) { return !EAS.ACE_DEFAULTS[id].aceOnly; }));
    refreshAceScConflicts();
  }
  function refreshAceScConflicts() {
    var EAS = window.EditorAceShortcuts;
    if (!EAS) return;
    var conflicts = EAS.findConflicts(EAS.getAll());
    document.querySelectorAll('.ace-sc-input').forEach(function (input) {
      if (input.classList.contains('recording')) return;
      var combo = input.value.trim();
      input.classList.toggle('conflict', !!combo && conflicts.indexOf(aceScIdOf(input)) >= 0);
    });
  }
  function commitAceScRecording(input) {
    if (aceShortcutRecordingInput !== input) return;
    aceShortcutRecordingInput = null;
    window.__aceShortcutRecording = false; // 同步解除 dispatchCapture 的录制守卫
    input.classList.remove('recording');
    input.placeholder = '点击录制';
    var id = aceScIdOf(input);
    var EAS = window.EditorAceShortcuts;
    if (!EAS || !id) return;
    var combo = input.value.trim();
    var map = EAS.getAll();
    if (!combo) {
      // 空值 = 恢复该命令默认键位
      map[id] = undefined;
      EAS.save(map);
      applyAceShortcutOverrides();
      renderShortcutHelp();
      showToast('已恢复默认键位');
      return;
    }
    if (!EditorShortcuts.parse(combo)) {
      showToast('无效组合键');
      aceScResetValue(input);
      refreshAceScConflicts();
      return;
    }
    if (EAS.isReserved(combo)) {
      // Review Bug③：Ctrl+;/K/P 被主进程 before-input-event 拦截，渲染进程收不到完整按键
      showToast('Ctrl+;/K/P 为系统级固定键，不可用于编辑区改键');
      input.classList.add('conflict');
      aceScResetValue(input);
      return;
    }
    map[id] = combo;
    EAS.save(map);
    applyAceShortcutOverrides();
    renderShortcutHelp();
    showToast('快捷键已保存');
  }
  function aceScRecordKeydown(e) {
    if (!aceShortcutRecordingInput) return;
    e.preventDefault();
    e.stopImmediatePropagation(); // Review 建议⑦：阻断弹窗自身 Esc 关闭监听，防止误关弹窗
    var input = aceShortcutRecordingInput;
    var key = e.key;
    if (key === 'Escape') {
      aceShortcutRecordingInput = null;
      window.__aceShortcutRecording = false; // 同步解除 dispatchCapture 的录制守卫
      input.classList.remove('recording');
      input.value = input.dataset.prevValue || '';
      input.placeholder = '点击录制';
      refreshAceScConflicts();
      return;
    }
    if (key === 'Backspace' || key === 'Delete') {
      input.value = '';
      commitAceScRecording(input);
      return;
    }
    var combo = EditorShortcuts.normalizeCombo(e);
    if (!combo) return; // 无效按键（裸字母/纯修饰键）忽略，继续录制
    input.value = combo;
    commitAceScRecording(input);
  }
  document.addEventListener('keydown', aceScRecordKeydown, true);
  document.addEventListener('click', function (e) {
    var input = e.target && e.target.closest ? e.target.closest('.ace-sc-input') : null;
    if (!input) return;
    if (aceShortcutRecordingInput && aceShortcutRecordingInput !== input) {
      // 切换录制目标：先取消旧录制
      var prev = aceShortcutRecordingInput;
      prev.classList.remove('recording');
      prev.value = prev.dataset.prevValue || '';
      prev.placeholder = '点击录制';
    }
    aceShortcutRecordingInput = input;
    window.__aceShortcutRecording = true; // 同步启用 dispatchCapture 的录制守卫
    input.dataset.prevValue = input.value;
    input.classList.add('recording');
    input.classList.remove('conflict');
    input.value = '';
    input.placeholder = '请按下新组合键…';
    input.focus();
  });
  var aceScResetBtn = document.getElementById('aceShortcutResetBtn');
  if (aceScResetBtn) {
    aceScResetBtn.addEventListener('click', function () {
      var EAS = window.EditorAceShortcuts;
      if (!EAS) return;
      if (aceShortcutRecordingInput) {
        aceShortcutRecordingInput.classList.remove('recording');
        aceShortcutRecordingInput = null;
        window.__aceShortcutRecording = false; // 同步解除 dispatchCapture 的录制守卫
      }
      EAS.reset();
      applyAceShortcutOverrides();
      renderShortcutHelp();
      showToast('编辑区命令已恢复默认键位');
    });
  }
  elements.keyboardModeHelpSelect.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openShortcutHelp(elements.keyboardModeHelpSelect.value);
    }
  });
  function openTerminalInDir() {
    const api = getElectronAPI();
    if (!api || typeof api.openTerminal !== 'function') {
      showToast('当前环境不支持打开系统终端');
      return;
    }
    api.openTerminal({ fileToken: state.fileToken })
      .then(function(res) {
        if (res && res.success) showToast('已在 ' + res.cwd + ' 打开终端');
        else showToast((res && res.message) || '打开终端失败');
      })
      .catch(function(err) {
        showToast('打开终端失败：' + (err && err.message ? err.message : err));
      });
  }

  // 导出 Markdown：直接下载原文 .md（客户端处理，无需后端）
  function exportToMarkdown() {
    const text = mainEditor.getValue();
    if (!text || !text.trim()) { showToast('暂无内容可导出', true); return; }
    const base = (getCurrentFileName() || '导出文档').replace(/\.[^.]+$/, '') + '.md';
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = base;
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => { URL.revokeObjectURL(anchor.href); anchor.remove(); }, 1000);
    showToast('已导出 ' + base, false, 'success');
  }

  // 导出共用管线：提取正文并将 ```mermaid 渲染为 base64 PNG，替换为图片引用
  async function prepareExportContent() {
    const text = mainEditor.getValue();
    if (!text || !text.trim()) { showToast('暂无内容可导出', true); return null; }

    let markdown = text;
    const images = {};

    const mermaidBlocks = [];
    const mermaidRe = /```mermaid\s*\n([\s\S]*?)```/gi;
    let m;
    while ((m = mermaidRe.exec(text)) !== null) {
      mermaidBlocks.push({ code: m[1], full: m[0] });
    }

    if (mermaidBlocks.length > 0 && window.mermaid) {
      try { window.mermaid.initialize({ startOnLoad: false, theme: 'default' }); } catch (e) { /* 忽略 */ }
      for (let i = 0; i < mermaidBlocks.length; i++) {
        const block = mermaidBlocks[i];
        try {
          const name = 'mmd-' + i + '.png';
          const res = await window.mermaid.render('export-mmd-' + i, block.code.trim());
          const svg = String(res && res.svg || '');
          if (!svg) continue;
          const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
          const svgUrl = URL.createObjectURL(svgBlob);
          const img = new Image();
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = svgUrl;
          });
          const svgRoot = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
          const w = parseFloat(svgRoot.getAttribute('width')) || 800;
          const h = parseFloat(svgRoot.getAttribute('height')) || 600;
          const scale = 2;
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(w * scale));
          canvas.height = Math.max(1, Math.round(h * scale));
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          images[name] = canvas.toDataURL('image/png');
          URL.revokeObjectURL(svgUrl);
          markdown = markdown.replace(block.full, '![Mermaid 流程图](' + name + ')');
        } catch (e) {
          showToast('Mermaid 渲染失败，已跳过该流程图', true);
        }
      }
    }
    return { markdown, images };
  }

  // 从 API 基地址提取 origin（协议+主机+端口），拼接后端导出接口（不依赖 /api/clip 后缀）
  function getBackendOrigin() {
    let origin = '';
    try { origin = new URL(window.API_BASE_URL || 'http://127.0.0.1:8081').origin; }
    catch (e) { origin = 'http://127.0.0.1:8081'; }
    return origin;
  }

  // 导出 Word：Mermaid → PNG → 后端 POI 生成 .docx（FP-9）
  async function exportToWord() {
    const payload = await prepareExportContent();
    if (!payload) return;
    const { markdown, images } = payload;
    const filename = (getCurrentFileName() || '导出文档').replace(/\.[^.]+$/, '') + '.docx';
    const exportUrl = getBackendOrigin() + '/api/editor/export-word';
    try {
      showToast('正在生成 Word…', false, 'info');
      const resp = await fetch(exportUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown, images, filename })
      });
      if (!resp.ok) {
        let msg = 'Word 导出失败';
        try { const j = await resp.json(); msg = j.error || msg; } catch (e) { /* 忽略 */ }
        showToast(msg, true);
        return;
      }
      const blob = await resp.blob();
      const anchor = document.createElement('a');
      anchor.href = URL.createObjectURL(blob);
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      setTimeout(() => { URL.revokeObjectURL(anchor.href); anchor.remove(); }, 1000);
      showToast('已导出 ' + filename, false, 'success');
    } catch (err) {
      const detail = err && err.message ? err.message : String(err);
      let hint;
      if (/Failed to fetch|NetworkError|TYPE_ERROR|name resolution/i.test(detail)) {
        hint = '网络请求失败，请确认后端服务（8081）已启动且 /api/editor/export-word 可访问（地址：' + exportUrl + '）';
      } else {
        hint = '导出失败：' + detail;
      }
      showToast(hint, true);
    }
  }

  // 导出 PDF：Mermaid → PNG → 后端 OpenHTMLtoPDF 渲染 .pdf
  async function exportToPdf() {
    const payload = await prepareExportContent();
    if (!payload) return;
    const { markdown, images } = payload;
    const filename = (getCurrentFileName() || '导出文档').replace(/\.[^.]+$/, '') + '.pdf';
    const exportUrl = getBackendOrigin() + '/api/editor/export-pdf';
    try {
      showToast('正在生成 PDF…', false, 'info');
      const resp = await fetch(exportUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown, images, filename })
      });
      if (!resp.ok) {
        let msg = 'PDF 导出失败';
        try { const j = await resp.json(); msg = j.error || msg; } catch (e) { /* 忽略 */ }
        showToast(msg, true);
        return;
      }
      const blob = await resp.blob();
      const anchor = document.createElement('a');
      anchor.href = URL.createObjectURL(blob);
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      setTimeout(() => { URL.revokeObjectURL(anchor.href); anchor.remove(); }, 1000);
      showToast('已导出 ' + filename, false, 'success');
    } catch (err) {
      const detail = err && err.message ? err.message : String(err);
      let hint;
      if (/Failed to fetch|NetworkError|TYPE_ERROR|name resolution/i.test(detail)) {
        hint = '网络请求失败，请确认后端服务（8081）已启动且 /api/editor/export-pdf 可访问（地址：' + exportUrl + '）';
      } else {
        hint = '导出失败：' + detail;
      }
      showToast(hint, true);
    }
  }

  // ── 图文一体（M3）：图片插入（按钮/粘贴/拖拽 → 压缩 → 上传 → 光标处插入）──
  const editorImageInput = document.getElementById('editorImageInput');

  function insertImageAtCursor(markdown) {
    const cursor = mainEditor.getCursorPosition();
    mainEditor.session.insert(cursor, markdown);
    setModified(true);
    mainEditor.focus();
  }

  function handleEditorImageFiles(files) {
    if (!files || !files.length) return;
    const imageFiles = Array.from(files).filter(f => f.type && f.type.startsWith('image/'));
    if (!imageFiles.length) {
      showToast('未检测到图片文件');
      return;
    }
    if (!window.MediaKit || !window.MediaKit.uploader) {
      showToast('媒体上传组件未加载');
      return;
    }
    window.MediaKit.uploader.uploadFiles(imageFiles, {
      onSuccess: (item, resp) => {
        insertImageAtCursor('![图片](' + resp.path + ')');
      },
      onError: (item, err) => {
        showToast('图片上传失败: ' + (err && err.message ? err.message : err));
      }
    });
  }

  const imageInsertBtn = document.getElementById('imageInsertBtn');
  if (imageInsertBtn) {
    imageInsertBtn.addEventListener('click', () => editorImageInput.click());
  }
  // 快捷键 Ctrl+Shift+I（插入图片）/ Ctrl+Shift+M（Markdown 预览）已收敛到
  // 下方 aceShortcutDispatch 统一捕获分发（core 类命令，可配置改键）。
  // 快捷键 Ctrl/Cmd+G（跳转到行，不区分大小写）统一在窗口捕获阶段接管，
  // 保证编辑区内焦点也能触发，不受 ACE 自身 keydown 处理顺序影响。
  window.addEventListener('keydown', function (e3) {
    const mod = (e3.ctrlKey || e3.metaKey) && !e3.altKey;
    if (!mod) return;
    const key = (e3.key || '').toLowerCase();
    const isGotoLine = key === 'g' && !e3.shiftKey;       // Ctrl/Cmd+G → 跳转到行
    if (!isGotoLine) return;
    // 普通输入区不拦截；ACE 编辑区（.ace_editor）与跳转行输入框放行
    const inAce = !!(e3.target && e3.target.closest && e3.target.closest('.ace_editor'));
    const t = (e3.target && e3.target.tagName) || '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(t) && !inAce && e3.target.id !== 'gotoLineInput') return;
    e3.preventDefault();
    e3.stopImmediatePropagation();
    openGotoLineDialog();
  }, true);

  // —— 跳转到行弹窗 ——
  function openGotoLineDialog() {
    const modal = document.getElementById('gotoLineModal');
    const input = document.getElementById('gotoLineInput');
    if (!modal || !input) return;
    const total = mainEditor.session.getLength() || 1;
    input.min = 1;
    input.max = total;
    input.value = String((mainEditor.getCursorPosition().row || 0) + 1);
    openModal(modal);
    input.select();
    input.focus();
  }
  function jumpToLineConfirmed() {
    const modal = document.getElementById('gotoLineModal');
    const input = document.getElementById('gotoLineInput');
    if (!input || !modal) return;
    const total = mainEditor.session.getLength() || 1;
    const v = parseInt(input.value, 10);
    if (isNaN(v) || v < 1) return;
    mainEditor.gotoLine(Math.min(v, total), 0, true);
    mainEditor.focus();
    closeModal(modal);
  }
  const glInput = document.getElementById('gotoLineInput');
  if (glInput) {
    glInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); jumpToLineConfirmed(); }
      else if (e.key === 'Escape') { closeModal(document.getElementById('gotoLineModal')); }
    });
  }
  const glConfirmBtn = document.getElementById('gotoLineConfirmBtn');
  if (glConfirmBtn) glConfirmBtn.addEventListener('click', jumpToLineConfirmed);
  if (editorImageInput) {
    editorImageInput.addEventListener('change', (e) => {
      handleEditorImageFiles(e.target.files);
      e.target.value = '';
    });
  }
  // Ace 编辑区粘贴处理（Ctrl+V）：
  //  ① 图片 → 上传（而非粘贴文本）
  //  ② 富文本(HTML) → 用 turndown 转成干净的 Markdown 再插入光标（借鉴 NoteGen）
  //  ③ 纯文本 → 交给 ACE 默认粘贴
  // 注意：必须用 capture 阶段 + stopPropagation 提前接管。ACE 自身的 paste 处理器绑定在隐藏
  //  textarea（.ace_text-input）上，位于 target 阶段；真实 Cmd+V 的事件目标正是该 textarea，
  //  若本处理器只在冒泡阶段执行，ACE 已先插入 text/plain，随后本处再插入 Markdown，
  //  会导致同一内容被插入两遍（纯文本 + 带标记的 Markdown），粘贴区出现重复内容且
  //  Markdown 标记被渲染成彩色/高亮，表现为"字体/背景颜色错乱"（Bug 修复）。
  // 判断剪贴板 HTML 是否"真富文本"：含块级结构（标题/列表/表格/引用/代码块）或
  // 链接/图片，或"格式化标签 + 块容器"组合（Word/网页加粗等）。
  // 仅内联包裹（span/code/font 等）的纯文本 → 视为普通文本，走 ACE 默认粘贴，
  // 避免空格被包进反引号、下划线被转义为 \_（Bug 修复）。
  function isRichClipboardHtml(html) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const body = doc.body;
      if (body.querySelector('h1,h2,h3,h4,h5,h6,ul,ol,li,table,thead,tbody,tr,td,th,blockquote,pre')) return true;
      if (body.querySelector('a[href],img')) return true;
      const fmt = body.querySelector('strong,em,b,i,u,s,del');
      const block = body.querySelector('p,div');
      return !!(fmt && block);
    } catch (e) { return false; }
  }
  if (mainEditor && mainEditor.container) {
    mainEditor.container.addEventListener('paste', (e) => {
      const cd = e.clipboardData;
      if (!cd) return;
      // ① 图片粘贴 → 上传
      const files = [];
      for (let i = 0; i < cd.items.length; i++) {
        const item = cd.items[i];
        if (item.kind === 'file' && item.type && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length) {
        e.preventDefault();
        e.stopPropagation();
        handleEditorImageFiles(files);
        return;
      }
      // ② 富文本粘贴 → Markdown（仅当 HTML 确为"真富文本"时才接管，避免纯文本被过度转义）
      if (typeof TurndownService !== 'undefined') {
        const html = cd.getData('text/html');
        if (html && isRichClipboardHtml(html)) {
          try {
            const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
            const md = (turndown.turndown(html) || '').replace(/^\n+|\n+$/g, '');
            const plain = (cd.getData('text/plain') || '').trim();
            if (md && md !== plain) {
              e.preventDefault();
              e.stopPropagation();
              mainEditor.session.insert(mainEditor.getCursorPosition(), md);
            }
          } catch (err) {
            console.warn('[Paste] HTML→MD 转换失败，回退纯文本粘贴:', err);
          }
        }
      }
      // ③ 纯文本：不做处理，走 ACE 默认粘贴
    }, { capture: true });
  }
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
  document.getElementById('clipBtn').addEventListener('click', smartClip);
  elements.clipCaretBtn.addEventListener('click', toggleClipMenu);
  elements.smartClipMenuItem.addEventListener('click', () => { closeClipMenu(); smartClip(); });
  elements.detailClipMenuItem.addEventListener('click', () => { closeClipMenu(); openClipModal(); });
  elements.smartClipSaveBtn.addEventListener('click', () => { if (smartClipPending) saveSmartClip(smartClipPending); });
  elements.smartClipFallbackSaveBtn.addEventListener('click', saveSmartClipFallback);
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.clip-split')) closeClipMenu();
  });
  elements.submitClipBtn.addEventListener('click', submitClip);
  elements.browserFileInput.addEventListener('change', async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (file) await handleBrowserFile(file);
  });

  // ════════════════════════════════════════════
  // 设置弹窗
  // ════════════════════════════════════════════
  document.getElementById('settingsBtn').addEventListener('click', () => {
    // 重置到基本标签页
    switchSettingsTab('basic');
    // 同步当前值到弹窗
    const currentSize = parseInt(mainEditor.getFontSize(), 10) || 13;
    elements.fontSizeSlider.value = String(currentSize);
    elements.fontSizeLabel.textContent = currentSize + 'px';
    elements.tabSizeSelect.value = String(mainEditor.session.getTabSize() || 2);
    openModal(elements.settingsModal);
  });

  // 设置标签页切换
  var settingsTabRendered = false;

  /**
   * 翻译 ACE 高级设置面板（OptionPanel）的标签为中文
   */
  function translateAceOptions(container) {
    if (!container) return;
    var labelMap = {
      'Font Size': '字体大小',
      'Tab Size': '缩进大小',
      'Soft Tabs': '软制表符',
      'Use Soft Wrap': '自动换行',
      'Wrap Limit': '换行限制',
      'Show Invisibles': '显示不可见字符',
      'Show Gutter': '显示行号栏',
      'Show Line Numbers': '显示行号',
      'Show Print Margin': '显示打印边距',
      'Print Margin Column': '打印边距列',
      'Highlight Active Line': '高亮当前行',
      'Highlight Selected Word': '高亮选中词语',
      'Highlight Gutter Line': '高亮行号栏',
      'Selection Style': '选择样式',
      'Enable Live Autocompletion': '实时自动补全',
      'Enable Basic Autocompletion': '基础自动补全',
      'Enable Snippets': '启用代码片段',
      'Emmet': 'Emmet',
      'Use Worker': '使用语法检查器',
      'Scroll Past End': '滚动超出末尾',
      'Cursor Style': '光标样式',
      'Merge Undo Deltas': '合并撤销记录',
      'Animated Scrolling': '平滑滚动',
      'New Line Mode': '换行模式',
      'Theme': '主题',
      'Keybinding': '快捷键',
      'Enable Behaviours': '启用智能行为',
      'Fold Style': '折叠样式',
      'Copy with empty selection': '无选区复制整行',
      'Relative Line Numbers': '相对行号',
      'Overwrite': '覆盖模式',
      'Fade Fold Widgets': '折叠控件淡入淡出',
      'Show Fold Widgets': '显示折叠控件',
      'Enable Spelling': '启用拼写检查',
      'Spellcheck': '拼写检查',
      'Use Elastic Tabstops': '弹性制表位',
      'Elastic Tabstops': '弹性制表位',
      'Use Wrap Mode': '自动换行模式',
      'Full Line Selection': '整行选择',
      'Highlight Gutter Line': '高亮行号栏',
      'Indented Soft Wrap': '缩进软换行',
      'Navigate Within Soft Tabs': '软制表符内导航',
      'HScroll Past End': '水平滚动超出末尾',
      'HScroll Page Size': '水平滚动页大小',
      'First Line Number': '起始行号',
      'Outline': '轮廓线',
      'Min Lines': '最小行数',
      'Max Lines': '最大行数',
      'Use Textarea For IME': '输入法文本框',
      'Placeholder': '占位符文本',
      'Scroll Speed': '滚动速度',
      'Drag Delay': '拖拽延迟',
      'Tooltip Follows Mouse': '提示跟随鼠标',
      'Display Indent Guides': '显示缩进参考线',
      'Highlight': '高亮',
      'Animated Scroll': '平滑滚动',
      'Wrap': '换行',
      'Code Folding': '代码折叠',
      'Fade Fold Widgets': '折叠控件淡入',
      'Show Fold Widgets': '显示折叠控件',
      'New Line Mode': '换行符模式',
      'Use Worker': '语法检查'
    };

    function walkNodes(node) {
      if (!node) return;
      // 翻译文本节点
      if (node.nodeType === 3 && node.nodeValue && node.nodeValue.trim()) {
        var text = node.nodeValue.trim();
        if (labelMap[text]) {
          node.nodeValue = node.nodeValue.replace(text, labelMap[text]);
        }
      }
      // 翻译 select 选项
      if (node.tagName === 'OPTION' && node.textContent) {
        var optText = node.textContent.trim();
        if (labelMap[optText]) {
          node.textContent = labelMap[optText];
        }
      }
      // 翻译 label 元素、按钮、th/td 等
      if (node.tagName && node.textContent && node.childNodes.length <= 1) {
        var t = node.textContent.trim();
        // 跳过空文本和纯数字/符号
        if (t.length > 1 && t.length < 40 && labelMap[t]) {
          // 只在没有子元素或只有文本子元素时替换
          if (node.childNodes.length === 0 || (node.childNodes.length === 1 && node.childNodes[0].nodeType === 3)) {
            node.textContent = labelMap[t];
          }
        }
      }
      // 递归子节点
      for (var i = 0; i < node.childNodes.length; i++) {
        walkNodes(node.childNodes[i]);
      }
    }

    walkNodes(container);
  }

  function switchSettingsTab(tabId) {
    // 更新标签按钮状态
    document.querySelectorAll('.settings-tab').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    // 切换内容区域
    document.getElementById('settingsBasic').hidden = tabId !== 'basic';
    document.getElementById('settingsAdvanced').hidden = tabId !== 'advanced';
    // 调整弹窗宽度
    elements.settingsModal.classList.toggle('advanced-open', tabId === 'advanced');
    // 更新描述
    document.getElementById('settingsDesc').textContent =
      tabId === 'advanced' ? 'ACE 图形化设置面板，实时生效。' : '调整编辑器偏好设置。';

    // 打开高级设置时，模式快捷键说明 select 默认当前键盘处理器（处理器未打包时恒为 Ace）
    if (tabId === 'advanced' && elements.keyboardModeHelpSelect) {
      if (!elements.keyboardModeHelpSelect.value || elements.keyboardModeHelpSelect.value === '') {
        elements.keyboardModeHelpSelect.value = 'Ace';
      }
    }

    // 首次打开高级时渲染 ACE OptionPanel
    if (tabId === 'advanced' && !settingsTabRendered) {
      settingsTabRendered = true;
      try {
        var OptionPanel = ace.require('ace/ext/options').OptionPanel;
        if (OptionPanel) {
          var panel = new OptionPanel(mainEditor);
          panel.render();
          var container = document.getElementById('aceSettingsContainer');
          container.innerHTML = '';
          container.appendChild(panel.container);
          // 翻译 ACE 选项标签为中文
          translateAceOptions(container);
        }
      } catch (e) {
        console.warn('ACE 高级设置面板加载失败:', e);
        document.getElementById('aceSettingsContainer').innerHTML =
          '<p style="color:var(--app-text-secondary);padding:12px;text-align:center;">高级设置面板不可用</p>';
      }
    }
  }

  document.querySelectorAll('.settings-tab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      switchSettingsTab(this.dataset.tab);
    });
  });

  elements.fontSizeSlider.addEventListener('input', function () {
    const size = parseInt(this.value, 10);
    mainEditor.setFontSize(size + 'px');
    elements.fontSizeLabel.textContent = size + 'px';
  });

  elements.tabSizeSelect.addEventListener('change', function () {
    const size = parseInt(this.value, 10);
    mainEditor.session.setTabSize(size);
    updateStatusBar();
    showToast('缩进大小已设为 ' + size + ' 空格');
  });

  document.querySelectorAll('[data-close-modal]').forEach(button => {
    button.addEventListener('click', () => closeModal(document.getElementById(button.dataset.closeModal)));
  });

  document.getElementById('cancelDiscardBtn').addEventListener('click', () => settleDiscardDecision(false));
  document.getElementById('cancelDiscardActionBtn').addEventListener('click', () => settleDiscardDecision(false));
  document.getElementById('confirmDiscardBtn').addEventListener('click', () => settleDiscardDecision(true));

  document.addEventListener('keydown', event => {
    const modifier = event.ctrlKey || event.metaKey;
    // Ctrl+T/N/O、Ctrl+S（保存）已收敛到 aceShortcutDispatch 统一捕获分发（可配置改键）
    if (modifier && event.key.toLowerCase() === 'w') {
      event.preventDefault();
      closeTab(activeTabIndex);
    } else if (modifier && event.key === 'Tab') {
      event.preventDefault();
      const next = event.shiftKey
        ? (activeTabIndex - 1 + tabs.length) % tabs.length
        : (activeTabIndex + 1) % tabs.length;
      switchToTab(next);
    } else if (modifier && event.shiftKey && event.key.toLowerCase() === 's') {
      // Ctrl+Shift+S 另存为（固定；普通 Ctrl+S 保存走 aceShortcutDispatch）
      event.preventDefault();
      saveFile(true);
    } else if (modifier && (event.key === '=' || event.key === '+')) {
      // Ctrl+= 放大字体
      event.preventDefault();
      const cur = parseInt(mainEditor.getFontSize(), 10) || 13;
      const next = Math.min(40, cur + 1);
      mainEditor.setFontSize(next + 'px');
      elements.fontSizeSlider.value = String(next);
      elements.fontSizeLabel.textContent = next + 'px';
      showToast('字体大小: ' + next + 'px');
    } else if (modifier && event.key === '-') {
      // Ctrl+- 缩小字体
      event.preventDefault();
      const cur = parseInt(mainEditor.getFontSize(), 10) || 13;
      const next = Math.max(8, cur - 1);
      mainEditor.setFontSize(next + 'px');
      elements.fontSizeSlider.value = String(next);
      elements.fontSizeLabel.textContent = next + 'px';
      showToast('字体大小: ' + next + 'px');
    } else if (modifier && event.key === ',') {
      // Ctrl+, 打开设置（固定；保留文档级监听以便编辑器外焦点也可唤起）
      event.preventDefault();
      document.getElementById('settingsBtn').click();
    }
  });

  // ===== 编辑器缓存：保存/恢复标签状态 =====
  // 缓存到 {storagePath}/.tmp/editor/cache.json，用于未保存关闭后恢复

  function saveEditorCache() {
    const api = getElectronAPI();
    if (!api || !api.saveEditorCache) return;
    saveActiveTabSnapshot();
    const cacheData = {
      activeTabIndex: activeTabIndex,
      tabs: tabs.map(tab => {
        const t = { ...tab };
        delete t.suppressChange;
        delete t.browserBytes;
        delete t.aiChat;
        return t;
      })
    };
    api.saveEditorCache(cacheData);
  }

  async function restoreEditorCache() {
    const api = getElectronAPI();
    if (!api || !api.loadEditorCache) return false;
    const result = await api.loadEditorCache();
    if (!result.exists || !result.data || !result.data.tabs || result.data.tabs.length === 0) return false;

    const cache = result.data;
    // 清除默认标签，替换为缓存标签
    tabs.length = 0;
    cache.tabs.forEach(t => tabs.push(t));
    activeTabIndex = Math.min(cache.activeTabIndex || 0, tabs.length - 1);
    state = tabs[activeTabIndex];
    ensureAiChatState(state);

    // 恢复编辑器内容
    state.suppressChange = true;
    mainEditor.setValue(state.content || '', -1);
    state.suppressChange = false;
    updateStartWritingGuide();
    mainEditor.gotoLine(state.cursorRow + 1, state.cursorColumn, false);
    mainEditor.session.setScrollTop(state.scrollTop);
    mainEditor.session.setScrollLeft(state.scrollLeft);
    setLanguage(state.language);
    updateDocumentIdentity();
    updateCursorStatus();
    updateStatusBar();
    renderTabBar();
    renderAiChat();
    mainEditor.focus();

    // 清除缓存，避免每次启动都恢复
    if (api.clearEditorCache) {
      api.clearEditorCache();
    }
    return true;
  }

  window.addEventListener('beforeunload', event => {
    // 保存缓存（记录所有标签状态，包括未修改的）
    saveEditorCache();
    // 阻止关闭：有已修改但未保存的标签时提示
    if (tabs.some(tab => tab.modified)) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  window.addEventListener('message', event => {
    const data = event.data || {};
    if (data.action === 'backendState') {
      // 主框架广播的后端状态，供编辑器图片上传失败分级提示
      window.__backendState = data.state || '';
      try { window.MediaKit.uploader.setBackendStatusProvider(function () { return window.__backendState || null; }); } catch (e) {}
    } else if (data.action === 'themeChange' || data.type === 'themeChanged' || data.type === 'appearanceChanged') {
      // 父窗口切换主题时，直接采用其传入的主题值，保证 ACE 背景色与主框架一致
      applyTheme(data.theme);
    } else if (data.action === 'editorPing') {
      window.parent.postMessage({ type: 'editorReady' }, '*');
    } else if (data.action === 'openClipInEditor' || data.type === 'openClipInEditor') {
      loadClip(data.clipId);
    } else if (data.action === 'openClipInNewTab' || data.type === 'openClipInNewTab') {
      loadClipInNewTab(data.clipId);
    } else if (data.action === 'refresh') {
      if (state.clipId) loadClip(state.clipId);
    } else if (data.action === 'focusEditor') {
      mainEditor.focus();
    } else if (data.action === 'focusAceJump') {
      // 父窗口焦点场景转发：⌘/Ctrl+; 唤出 AceJump（与 editorKeyDown/editorInsertChar 同一转发通道）
      // 无条件输出（不依赖 SHORTCUT_DEBUG），用于定位 IPC→iframe 转发是否到达
      console.log('[AceJump] iframe 收到 focusAceJump 消息');
      try {
        hideStartWritingGuide();
        mainEditor.focus();
        acejump('word', false);
      } catch (err) {
        console.error('[AceJump] 唤出失败:', err.message, err.stack || '');
      }
    } else if (data.action === 'focusCommandPalette') {
      // 主进程菜单加速键 / before-input-event 最低层兜底 → IPC → 父窗口转发到编辑器：
      // 焦点在编辑区时唤起编辑器命令面板（经 triggerCommandPalette 去重，兼容 Ctrl+K/P）
      try {
        hideStartWritingGuide();
        mainEditor.focus();
        triggerCommandPalette();
      } catch (err) {
        console.error('[CommandPalette] 唤起失败:', err.message, err.stack || '');
      }
    } else if (data.type === 'shortcut-debug') {
      // 主进程 SHORTCUT_DEBUG=1 时由父窗口广播到 iframe：开启本窗口快捷键诊断日志
      window.__shortcutDebug = !!data.value;
    } else if (data.action === 'editorInsertChar') {
      // 父窗口兜底转发：焦点落在父窗口（点击工具栏/标签栏等）时，可打印字符经此注入编辑器。
      // 触发链与直接输入一致：insert → session change → 斜杠菜单条件检查
      hideStartWritingGuide();
      mainEditor.focus();
      mainEditor.insert(data.char);
    } else if (data.action === 'editorKeyDown') {
      // 父窗口转发：斜杠菜单打开且焦点在父窗口时，↑↓/Enter/Esc 等导航键经此进入菜单逻辑
      mainEditor.focus();
      if (typeof window.__slashMenuKeyHandler === 'function') {
        window.__slashMenuKeyHandler(data.key);
      }
    } else if (data.type === 'openFileData') {
      // 系统右键菜单「用编辑器打开」→ 父页面读取文件后传入数据，在新标签页打开
      openFileDataInNewTab(data.fileData);
    } else if (data.type === 'openTextData') {
      // 系统右键菜单「PDF OCR」→ 在编辑器新标签页打开识别结果
      openTextInNewTab(data.text, data.title || 'OCR 识别结果');
    }
  });

  window.addEventListener('storage', event => {
    if (event.key === THEME_STORAGE_KEY || event.key === APPEARANCE_KEY || event.key === 'app_motion_v1') applyTheme();
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  // 页面（iframe）切回可见时强制重绘主题，修复切换页面后 ACE 背景色/高亮错乱的问题（Bug 修复）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      applyTheme();
      // 切回编辑视图时把焦点还给编辑器：否则输入 "/" 等字符会落入父窗口，
      // 斜杠命令菜单等依赖编辑器焦点的快捷键无法唤起
      mainEditor.focus();
    }
  });

  elements.runtimeStatus.textContent = getElectronAPI() ? '桌面模式' : '浏览器模式';
  elements.encodingNote.textContent = getElectronAPI()
    ? '重新读取不会修改磁盘；设置保存编码后，保存时才执行转换。'
    : '浏览器模式可重新解码已选择文件，但保存统一下载为 UTF-8。';
  applyTheme();

  // 初始化：尝试恢复编辑器缓存（未保存关闭后恢复内容）
  // 缓存恢复成功后清除缓存文件，避免每次启动都恢复
  (async () => {
    const restored = await restoreEditorCache();
    if (!restored) {
      // 无缓存时创建默认空白标签
      tabs.push(createTabState());
      state = tabs[0];
      ensureAiChatState(state);
      resetDocument();
      renderTabBar();
      renderAiChat();
    }
    // 确保键盘焦点落在编辑器内：否则初次启动（空白引导层可见）时输入 "/" 等字符
    // 会落入父窗口而非 ACE 编辑器，斜杠命令菜单等快捷键均无法唤起
    mainEditor.focus();
  })();

  updateCursorStatus();
  updateStatusBar();
  initializeAiChat();

  // 标签栏容器 - 阻止拖拽默认行为
  elements.tabBar.addEventListener('dragover', function(e) { e.preventDefault(); });
  elements.tabBar.addEventListener('drop', function(e) { e.preventDefault(); });

  // 路径栏双击打开文件所在目录
  elements.documentPath.addEventListener('dblclick', function() {
    var path = state && state.displayPath;
    if (!path) { showToast('文件尚未保存，无法打开目录', true); return; }
    openFileInFolder(path);
  });

  // 阻止 Ctrl+R / Cmd+R 刷新页面（浏览器默认行为与编辑模块冲突）
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault();
    }
  });

  // Alt+T 终端跟随目录已收敛到 aceShortcutDispatch 统一捕获分发（可配置改键）

  // 兼容旧键位：Alt+- / Alt+Shift+- 前后跳转（新主键位 Ctrl/Cmd+Alt+←/→ 走 EditorShortcuts 统一分发）
  document.addEventListener('keydown', function(e) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key !== '-' && e.key !== '_') return;
    e.preventDefault();
    if (e.shiftKey) jumpPosHistoryForward(); else jumpPosHistoryBack();
  });

  // ══════════════════════════════════════════════════════════
  // 1. ACE Settings Menu (图形化设置菜单)
  // ══════════════════════════════════════════════════════════
  (function initSettingsMenu() {
    try {
      ace.require('ace/ext/settings_menu');
      // 给主编辑器注入 showSettingsMenu 命令
      // Ctrl+, 打开设置弹窗并切换到高级（ACE 图形化设置面板）
      mainEditor.commands.addCommand({
        name: 'showSettingsMenu',
        bindKey: { win: 'Ctrl-,', mac: 'Command-,' },
        exec: function(editor) {
          // 打开设置弹窗并切换到高级标签页
          var size = parseInt(editor.getFontSize(), 10) || 13;
          elements.fontSizeSlider.value = String(size);
          elements.fontSizeLabel.textContent = size + 'px';
          elements.tabSizeSelect.value = String(editor.session.getTabSize() || 2);
          openModal(elements.settingsModal);
          switchSettingsTab('advanced');
        },
        readOnly: true
      });
    } catch (e) {
      console.warn('ace/ext/settings_menu 加载失败，使用自定义设置:', e);
    }
  })();

  // ══════════════════════════════════════════════════════════
  // 2. Fullscreen (全屏模式)
  // ══════════════════════════════════════════════════════════
  let isFullscreen = false;

  function toggleFullscreen() {
    isFullscreen = !isFullscreen;
    const app = document.querySelector('.editor-app');
    app.classList.toggle('fullscreen', isFullscreen);

    // 浏览器全屏 API
    if (!getElectronAPI()) {
      if (isFullscreen) {
        document.documentElement.requestFullscreen().catch(function(){});
      } else {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(function(){});
        }
      }
    } else {
      // Electron 模式：通过 IPC 切换全屏
      const api = getElectronAPI();
      if (api.setFullscreen) {
        api.setFullscreen(isFullscreen);
      }
    }

    elements.fullscreenBtn.classList.toggle('active', isFullscreen);
    setTimeout(function() { mainEditor.resize(); }, 100);
  }

  elements.fullscreenBtn.addEventListener('click', toggleFullscreen);

  // F11 全屏快捷键（Windows/Linux）；macOS 上为 Ctrl+Cmd+F
  document.addEventListener('keydown', function(e) {
    const isMacFullscreen = e.ctrlKey && e.metaKey && (e.key === 'f' || e.key === 'F');
    if (e.key === 'F11' || isMacFullscreen) {
      e.preventDefault();
      toggleFullscreen();
    }
    // Esc：全屏悬浮抽屉开着时优先关抽屉，否则退出 Markdown 预览全屏
    if (e.key === 'Escape' && markdownFullscreen) {
      e.preventDefault();
      const closeFn = { backlinksPane: toggleBacklinks, outlinePane: toggleOutline, tagsPane: toggleTags };
      const openDrawer = FLOATING_DRAWER_IDS.find(id => {
        const pane = document.getElementById(id);
        return pane && pane.getAttribute('aria-hidden') === 'false';
      });
      if (openDrawer && closeFn[openDrawer]) closeFn[openDrawer]();
      else toggleMarkdownFullscreen(false);
    }
  });

  // 退出全屏时同步状态
  document.addEventListener('fullscreenchange', function() {
    if (!document.fullscreenElement && isFullscreen) {
      isFullscreen = false;
      document.querySelector('.editor-app').classList.remove('fullscreen');
      elements.fullscreenBtn.classList.remove('active');
    }
  });

  // ══════════════════════════════════════════════════════════
  // 4. Autosave (自动保存)
  // ══════════════════════════════════════════════════════════
  var AUTOSAVE_INTERVAL = 10000; // 10 秒
  var autosaveTimer = null;
  var lastSavedContent = '';
  var autosaveEnabled = true;
  var autosaveBlurHandler = null;
  // Phase 3：防抖自动保存状态
  var autosaveChangeHandler = null;
  var autosaveDebounceTimer = null;

  function triggerAutosave() {
    if (!autosaveEnabled) return;
    var currentContent = mainEditor.getValue();
    if (!state.modified || currentContent === lastSavedContent) return;

    // 桌面模式但文件未保存（无 fileToken），静默跳过
    var api = getElectronAPI();
    if (api && api.autosaveFile && !state.fileToken) {
      return;
    }

    // C1：自动保存静默化——成功路径不闪烁文字，仅用状态圆点反馈（失败仍 Toast）
    if (!featureOn('autosaveSilent')) elements.autosaveStatus.textContent = '保存中...';
    elements.autosaveStatus.classList.add('saving');
    elements.autosaveStatus.classList.remove('saved');

    // 浏览器模式：保存到 localStorage
    if (!api) {
      try {
        var cacheKey = 'editor_autosave_' + (state.fileName || 'untitled') + '_' + (state.fileToken || '');
        localStorage.setItem(cacheKey, currentContent);
        localStorage.setItem(cacheKey + '_meta', JSON.stringify({
          fileName: state.fileName,
          language: elements.languageSelect.value,
          cursorRow: mainEditor.getCursorPosition().row,
          cursorColumn: mainEditor.getCursorPosition().column,
          scrollTop: mainEditor.session.getScrollTop(),
          time: Date.now()
        }));
        lastSavedContent = currentContent;
        setModified(false);
        if (!featureOn('autosaveSilent')) elements.autosaveStatus.textContent = '已自动保存';
        elements.autosaveStatus.classList.remove('saving');
        elements.autosaveStatus.classList.add('saved');
        clearTimeout(autosaveStatusResetTimer);
        autosaveStatusResetTimer = setTimeout(function() {
          elements.autosaveStatus.classList.remove('saved');
          updateAutosaveUI();
        }, 2000);
      } catch (e) {
        showAutosaveError(e && e.message ? e.message : '自动保存失败');
      }
      return;
    }

    // 桌面模式：保存到文件
    if (api.autosaveFile && state.fileToken) {
      api.autosaveFile(state.fileToken, currentContent, state.encoding, state.lineEnding)
        .then(function(result) {
          if (result && !result.error) {
            lastSavedContent = currentContent;
            state.expectedMtimeMs = result.mtimeMs ?? state.expectedMtimeMs;
            setModified(false);
            if (!featureOn('autosaveSilent')) elements.autosaveStatus.textContent = '已自动保存';
            elements.autosaveStatus.classList.remove('saving');
            elements.autosaveStatus.classList.add('saved');
            clearTimeout(autosaveStatusResetTimer);
            autosaveStatusResetTimer = setTimeout(function() {
              elements.autosaveStatus.classList.remove('saved');
              updateAutosaveUI();
            }, 2000);
          } else {
            showAutosaveError(result && result.error ? result.error : '自动保存失败');
          }
        })
        .catch(function(err) {
          showAutosaveError(err && err.message ? err.message : '自动保存失败');
        });
    }
  }

  var autosaveStatusResetTimer = null;

  function showAutosaveError(message) {
    elements.autosaveStatus.textContent = '自动保存失败';
    elements.autosaveStatus.classList.remove('saving', 'saved');
    elements.autosaveStatus.classList.add('failed');
    showToast('自动保存失败：' + message, true);
    FrontendLogger.error('[Editor] Autosave failed:', message);
    clearTimeout(autosaveStatusResetTimer);
    autosaveStatusResetTimer = setTimeout(function() {
      elements.autosaveStatus.classList.remove('failed');
      updateAutosaveUI();
    }, 4000);
  }

  function updateAutosaveUI() {
    elements.autosaveStatus.classList.toggle('active', autosaveEnabled);
    elements.autosaveStatus.classList.remove('saving', 'saved');
    if (autosaveEnabled) {
      elements.autosaveStatus.textContent = '自动保存';
      elements.autosaveStatus.title = '自动保存已开启：每 10 秒保存一次，点击关闭';
    } else {
      elements.autosaveStatus.textContent = '自动保存:关';
      elements.autosaveStatus.title = '自动保存已关闭：需按 ' + platformShortcut('Ctrl+S') + ' 手动保存，点击开启';
    }
  }

  function startAutosave() {
    if (autosaveTimer) clearInterval(autosaveTimer);
    autosaveTimer = setInterval(triggerAutosave, AUTOSAVE_INTERVAL);
    if (!autosaveBlurHandler) {
      autosaveBlurHandler = function onBlur() { triggerAutosave(); };
      document.addEventListener('blur', autosaveBlurHandler);
    }
    // Phase 3：防抖自动保存——编辑停止 2s 后触发保存（阈值与开关双条件，
    // 未开启时沿用原 10s 固定间隔；triggerAutosave 本身语义不变）
    if (featureOn('autosaveDebounce') && !autosaveChangeHandler) {
      autosaveChangeHandler = function onChange() {
        // A1：中文输入法组合期间暂停自动保存，compositionend 后再补一次
        if (isComposing()) return;
        if (autosaveDebounceTimer) clearTimeout(autosaveDebounceTimer);
        autosaveDebounceTimer = setTimeout(function() {
          autosaveDebounceTimer = null;
          triggerAutosave();
        }, 2000);
      };
      mainEditor.session.on('change', autosaveChangeHandler);
    }
    updateAutosaveUI();
  }

  function stopAutosave() {
    if (autosaveTimer) {
      clearInterval(autosaveTimer);
      autosaveTimer = null;
    }
    if (autosaveBlurHandler) {
      document.removeEventListener('blur', autosaveBlurHandler);
      autosaveBlurHandler = null;
    }
    updateAutosaveUI();
  }

  function toggleAutosave() {
    if (autosaveEnabled) {
      autosaveEnabled = false;
      stopAutosave();
      showToast('自动保存已关闭，使用 Ctrl+S 手动保存');
    } else {
      autosaveEnabled = true;
      startAutosave();
      showToast('自动保存已开启（每 10 秒）');
    }
  }

  elements.autosaveStatus.addEventListener('click', toggleAutosave);
  startAutosave();

  // 定期保存编辑器缓存（IPC invoke 是异步的，beforeunload 同步事件中
  // 请求可能来不及送达主进程，因此改为定时落盘，每 30 秒一次）
  // Phase 3：仅在有变更时保存缓存（开关关闭时维持原固定频率行为）
  var stateDirty = false;
  function markStateDirty() { stateDirty = true; }
  function consumeStateDirty() {
    var d = stateDirty;
    stateDirty = false;
    return d;
  }
  (function trackEditorDirty() {
    mainEditor.session.on('change', markStateDirty);
    document.addEventListener('blur', markStateDirty);
  })();
  setInterval(function() {
    if (featureOn('dirtyCacheGate') && !consumeStateDirty()) return;
    saveEditorCache();
  }, 30000);

  // ══════════════════════════════════════════════════════════
  // 5. File Tree (文件树侧边栏)
  // ══════════════════════════════════════════════════════════
  var fileTreeOpen = false;
  var fileTreeDir = null;       // 当前浏览的目录路径
  var fileTreeDirSource = null; // 目录来源：null=当前文件默认会话 | 'breadcrumb'=面包屑一次性定位 | 'manual'=手动选择目录

  function toggleFileTree() {
    fileTreeOpen = !fileTreeOpen;
    elements.fileTreePane.setAttribute('aria-hidden', String(!fileTreeOpen));
    elements.editorWorkspace.classList.toggle('show-filetree', fileTreeOpen);
    if (fileTreeBtn) fileTreeBtn.classList.toggle('active', fileTreeOpen);

    if (fileTreeOpen) {
      // 互斥：关闭其它左抽屉（历史/最近/收藏/反链/大纲/标签）
      closeOtherLeftPanes('show-filetree');
      loadFileTree();
    } else {
      // 面包屑定位是一次性会话：关闭后不缓存，下次手动唤起回到当前文件父目录
      if (fileTreeDirSource === 'breadcrumb') {
        fileTreeDir = null;
        fileTreeDirSource = null;
      }
    }

    setTimeout(function() { mainEditor.resize(); }, 250);
  }

  function loadFileTree() {
    var api = getElectronAPI();
    if (!api || !api.listDirectory) {
      elements.fileTreeBody.innerHTML = '<div class="filetree-item" style="cursor:default;color:var(--app-text-muted);">文件树仅桌面模式可用</div>';
      return;
    }

    // 仅"手动选择目录"或"面包屑定位会话中"复用缓存；
    // 默认会话（null）一律按当前文件父目录重新解析，避免与面包屑定位互相污染
    if (fileTreeDir && (fileTreeDirSource === 'manual' || fileTreeDirSource === 'breadcrumb')) {
      loadDirectory(fileTreeDir);
      return;
    }

    // 有文件令牌，尝试从当前文件所在目录加载
    if (state.fileToken) {
      api.getFileDirectory(state.fileToken)
        .then(function(result) {
          if (!result || !result.exists || !result.dirPath) throw new Error('无法获取文件所在目录');
          fileTreeDir = result.dirPath;
          return api.listDirectory(result.dirPath);
        })
        .then(function(result) {
          if (result && result.exists && Array.isArray(result.files)) {
            renderFileTree(result.files);
          } else {
            elements.fileTreeBody.innerHTML = '<div class="filetree-item" style="cursor:default;color:var(--app-text-muted);">空目录</div>';
          }
        })
        .catch(function(err) {
          // 令牌失效或目录不存在，显示选择目录提示
          fileTreeDir = null;
          showFileTreePrompt();
        });
    } else {
      // 无文件令牌且未选择目录，显示提示
      showFileTreePrompt();
    }
  }

  /** 显示"选择目录"提示 */
  function showFileTreePrompt() {
    elements.fileTreeTitle.textContent = '文件浏览器';
    elements.fileTreeBody.innerHTML = ''
      + '<div class="filetree-item" style="cursor:default;color:var(--app-text-muted);padding:16px 10px;text-align:center;line-height:1.6;">'
      + '请先打开或保存文件，<br>或点击上方"选择目录"按钮<br>浏览文件系统'
      + '</div>';
  }

  /** 加载指定目录的文件列表 */
  function loadDirectory(dirPath) {
    var api = getElectronAPI();
    if (!api || !api.listDirectory) return;

    // 更新标题显示当前目录名
    var dirName = dirPath.split(/[\\/]/).filter(Boolean).pop() || dirPath;
    elements.fileTreeTitle.textContent = dirName;

    api.listDirectory(dirPath)
      .then(function(result) {
        if (result && result.exists && Array.isArray(result.files)) {
          renderFileTree(result.files);
        } else {
          elements.fileTreeBody.innerHTML = '<div class="filetree-item" style="cursor:default;color:var(--app-text-muted);">空目录或无法访问</div>';
        }
      })
      .catch(function(err) {
        elements.fileTreeBody.innerHTML = '<div class="filetree-item" style="cursor:default;color:var(--app-text-muted);">加载目录失败: ' + (err.message || '未知错误') + '</div>';
      });
  }

  /** 通过系统对话框选择目录 */
  function selectFileTreeDirectory() {
    var api = getElectronAPI();
    if (!api || !api.selectDirectory) {
      showToast('选择目录仅桌面模式可用', true);
      return;
    }
    api.selectDirectory()
      .then(function(dirPath) {
        if (!dirPath) return;
        fileTreeDir = dirPath;
        fileTreeDirSource = 'manual'; // 手动选择的目录为持久会话
        loadDirectory(dirPath);
      })
      .catch(function(err) {
        showToast('选择目录失败: ' + (err.message || '未知错误'), true);
      });
  }

  function renderFileTree(files) {
    if (!files || files.length === 0) {
      elements.fileTreeBody.innerHTML = '<div class="filetree-item" style="cursor:default;color:var(--app-text-muted);">空目录</div>';
      return;
    }
    elements.fileTreeBody.innerHTML = '';

    // 添加"返回上级"条目（如果不是根目录）
    if (fileTreeDir && fileTreeDir !== '/' && !/^[a-zA-Z]:\\$/.test(fileTreeDir)) {
      var parentItem = document.createElement('div');
      parentItem.className = 'filetree-item folder';
      parentItem.title = '返回上级目录';

      var parentIcon = document.createElement('span');
      parentIcon.className = 'ft-icon';
      parentIcon.textContent = '📂';
      parentItem.appendChild(parentIcon);

      var parentName = document.createElement('span');
      parentName.textContent = '..';
      parentItem.appendChild(parentName);

      parentItem.addEventListener('click', function() {
        // 获取父目录路径（兼容 Windows 和 Unix 路径）
        var normalized = fileTreeDir.replace(/[\\/]+/g, '/');
        // 去掉末尾的 /
        if (normalized.length > 1 && normalized.endsWith('/')) {
          normalized = normalized.slice(0, -1);
        }
        var lastSlash = normalized.lastIndexOf('/');
        var parentDir = lastSlash > 0 ? normalized.slice(0, lastSlash) : normalized + '/';
        // Windows 盘符根目录（如 C:/）保持不变
        if (/^[a-zA-Z]:\/?$/.test(parentDir) || parentDir === '/') {
          parentDir = parentDir.replace(/\/$/, '') + '/';
        }
        if (parentDir === fileTreeDir) return;
        fileTreeDir = parentDir;
        loadDirectory(parentDir);
      });

      elements.fileTreeBody.appendChild(parentItem);
    }

    // 排序：文件夹在前，文件在后
    files.sort(function(a, b) {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });

    files.forEach(function(file) {
      var item = document.createElement('div');
      item.className = 'filetree-item ' + (file.isDirectory ? 'folder' : 'file');
      item.title = file.name + (file.isDirectory ? ' (文件夹)' : '');

      var icon = document.createElement('span');
      icon.className = 'ft-icon';
      icon.textContent = file.isDirectory ? '📁' : '📄';
      item.appendChild(icon);

      var nameSpan = document.createElement('span');
      nameSpan.textContent = file.name;
      item.appendChild(nameSpan);

      if (file.isDirectory) {
        // 点击文件夹进入子目录
        item.addEventListener('click', function() {
          fileTreeDir = file.path;
          loadDirectory(file.path);
        });
      } else {
        item.addEventListener('click', function() {
          openFileTreeFile(file);
        });
        item.addEventListener('contextmenu', function(e) {
          e.preventDefault();
          e.stopPropagation();
          showFileTreeContextMenu(e, file);
        });
      }

      elements.fileTreeBody.appendChild(item);
    });
  }

  function openFileTreeFile(file) {
    // 通过 Electron API 打开文件，在新标签页中打开，不覆盖当前编辑区域
    var api = getElectronAPI();
    if (api && api.openFileByPath) {
      api.openFileByPath(file.path)
        .then(function(result) {
          if (result && !result.canceled) {
            saveActiveTabSnapshot();
            var newTab = createTabState();
            tabs.push(newTab);
            activeTabIndex = tabs.length - 1;
            state = tabs[activeTabIndex];
            setEditorContent(result.text, {
              fileToken: result.fileToken,
              fileName: result.fileName,
              displayPath: result.displayPath,
              encoding: result.encoding,
              lineEnding: result.lineEnding
            });
            renderTabBar();
            showToast('已打开 ' + result.fileName);
            recordRecentFile(file.path, result.fileName);
          }
        })
        .catch(function(err) {
          showToast('打开文件失败: ' + err.message, true);
        });
    }
  }

  // 文件树按钮（在状态栏右侧添加一个按钮）
  var fileTreeBtn = createStatusBtn('文件', '📁', '文件浏览器', EditorShortcuts.get('fileTree'));
  registerShortcutButton('fileTree', fileTreeBtn, '文件浏览器');
  fileTreeBtn.addEventListener('click', toggleFileTree);
  elements.runtimeStatus.parentNode.insertBefore(fileTreeBtn, elements.runtimeStatus);

  elements.closeFileTreeBtn.addEventListener('click', toggleFileTree);
  elements.selectDirBtn.addEventListener('click', selectFileTreeDirectory);

  // 文件树快捷键（默认 Ctrl/Cmd+Shift+E，可在系统设置中修改）；由 EditorShortcuts 捕获阶段统一分发
  EditorShortcuts.registerHandler('fileTree', function() { toggleFileTree(); });

  // ══════════════════════════════════════════════════════════
  // 6. Project & Workspace (项目与工作区管理)
  // ══════════════════════════════════════════════════════════
  var PROJECTS_KEY = 'editor_projects_v1';
  var WORKSPACE_KEY = 'editor_workspace_v1';

  // 保存当前工作区状态
  function saveWorkspace() {
    try {
      var workspaceData = {
        activeTab: activeTabIndex,
        tabs: tabs.map(function(tab) {
          return {
            fileName: tab.fileName,
            displayPath: tab.displayPath,
            fileToken: tab.fileToken,
            encoding: tab.encoding,
            lineEnding: tab.lineEnding,
            language: tab.language,
            content: tab.content,
            cursorRow: tab.cursorRow,
            cursorColumn: tab.cursorColumn,
            scrollTop: tab.scrollTop,
            scrollLeft: tab.scrollLeft,
            clipId: tab.clipId,
            modified: tab.modified
          };
        }),
        savedAt: Date.now()
      };
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspaceData));
    } catch (e) {
      console.warn('保存工作区失败:', e);
    }
  }

  // 恢复工作区状态
  function restoreWorkspace() {
    try {
      var raw = localStorage.getItem(WORKSPACE_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (!data.tabs || data.tabs.length === 0) return false;

      // 清除默认标签
      tabs.length = 0;
      data.tabs.forEach(function(t) {
        var tab = createTabState();
        Object.assign(tab, t);
        tabs.push(tab);
      });
      activeTabIndex = Math.min(data.activeTab || 0, tabs.length - 1);
      state = tabs[activeTabIndex];

      // 恢复编辑器
      state.suppressChange = true;
      mainEditor.setValue(state.content || '', -1);
      state.suppressChange = false;
      updateStartWritingGuide();
      mainEditor.gotoLine(state.cursorRow + 1, state.cursorColumn, false);
      mainEditor.session.setScrollTop(state.scrollTop);
      setLanguage(state.language);
      updateDocumentIdentity();
      updateCursorStatus();
      updateStatusBar();
      renderTabBar();
      mainEditor.focus();
      return true;
    } catch (e) {
      console.warn('恢复工作区失败:', e);
      return false;
    }
  }

  // 定期保存工作区
  setInterval(function() {
    if (featureOn('dirtyCacheGate') && !consumeStateDirty()) return;
    saveWorkspace();
  }, 60000); // 每分钟保存一次

  // 在关闭前保存工作区
  window.addEventListener('beforeunload', function() {
    saveActiveTabSnapshot();
    saveWorkspace();
  });

  // 尝试恢复工作区（如果缓存恢复失败）
  (function tryRestoreWorkspace() {
    // 缓存恢复优先，如果缓存没有内容则尝试恢复工作区
    setTimeout(function() {
      if (tabs.length <= 1 && (!state.content || state.content === '')) {
        restoreWorkspace();
      }
    }, 500);
  })();

  // ══════════════════════════════════════════════════════════
  // 7. History (历史管理)
  // ══════════════════════════════════════════════════════════
  var historyEntries = [];
  var maxHistoryEntries = 200;

  // 从 ACE 撤销栈项中提取具体的变化内容摘要。
  // 注意：ACE UndoManager 的 $undoStack/$redoStack 每项是一个"组"（delta 数组），
  // 组内每个元素是 {action,start,end,lines} 结构，需按数组解包后合并描述。
  function describeHistoryEntry(entry) {
    if (!entry) return '未知操作';
    // 兼容三种结构：delta 数组（真实结构）、{deltas:[...]} 包装、裸 delta
    var deltas = Array.isArray(entry) ? entry
      : (entry.deltas && Array.isArray(entry.deltas) ? entry.deltas : [entry]);
    var parts = [];
    for (var i = 0; i < deltas.length; i++) {
      var d = deltas[i];
      if (!d) continue;
      var action = d.action === 'insert' ? '插入' : '删除';
      var lines = d.lines || [];
      var text = lines.join('\n');
      if (!text) continue;
      // 摘要截断：保留首行 + 换行提示
      var firstLine = text.split('\n')[0];
      var summary = firstLine.length > 40 ? firstLine.slice(0, 40) + '…' : firstLine;
      var extra = lines.length > 1 ? ' +' + (lines.length - 1) + '行' : '';
      parts.push(action + '「' + summary + '」' + extra);
    }
    if (parts.length === 0) {
      // 没有可描述的内容（如纯光标移动、空 delta），退回统计信息
      var total = 0;
      for (var k = 0; k < deltas.length; k++) {
        total += (deltas[k].lines || []).length;
      }
      var act = (deltas[0] && deltas[0].action === 'insert') ? '插入' : '删除';
      return act + '（' + total + ' 行）';
    }
    return parts.join('；');
  }

  // 格式化时间戳为可读字符串
  function formatHistoryTime(timestamp) {
    if (!timestamp) return '';
    var d = new Date(timestamp);
    var now = new Date();
    var isToday = d.getFullYear() === now.getFullYear()
      && d.getMonth() === now.getMonth()
      && d.getDate() === now.getDate();
    var pad = function(n) { return n < 10 ? '0' + n : n; };
    var timeStr = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    if (isToday) {
      return timeStr;
    }
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + timeStr;
  }

  // 渲染单条历史项（带结构化布局和时间戳）
  function createHistoryItem(entry, kind) {
    var item = document.createElement('div');
    item.className = 'history-item ' + kind;
    // 解包出 delta 数组（与 describeHistoryEntry 相同的兼容逻辑）
    var deltas = Array.isArray(entry) ? entry
      : (entry && entry.deltas && Array.isArray(entry.deltas) ? entry.deltas : [entry]);
    var first = deltas[0] || null;
    var position = first && first.start ? '行 ' + (first.start.row + 1) + '，列 ' + (first.start.column + 1) : '';
    // 完整变化内容（多个 delta 拼接）
    var fullParts = [];
    for (var i = 0; i < deltas.length; i++) {
      var lines = (deltas[i] && deltas[i].lines) || [];
      if (lines.length) fullParts.push(lines.join('\n'));
    }
    var fullText = fullParts.join('\n');
    // 时间戳
    var timestamp = entry && entry._timestamp ? entry._timestamp : null;
    var timeStr = formatHistoryTime(timestamp);

    // 动作描述
    var actionLabel = kind === 'undo' ? '撤销' : '重做';
    var desc = describeHistoryEntry(entry);

    // 构建结构化 HTML
    var html = '<span class="history-action">'
      + '<span class="history-action-label">' + actionLabel + '</span> '
      + '<span class="history-action-desc">' + escapeHtml(desc) + '</span>'
      + '</span>';
    html += '<span class="history-meta">';
    if (timeStr) {
      html += '<span class="history-time">' + timeStr + '</span>';
    }
    if (position) {
      html += '<span class="history-position">' + position + '</span>';
    }
    html += '</span>';
    item.innerHTML = html;

    // 悬停显示完整变化内容
    if (fullText) {
      item.title = '位置: ' + position + '\n完整内容:\n' + (fullText.length > 500 ? fullText.slice(0, 500) + '…' : fullText);
    }
    return item;
  }

  function updateHistoryPanel() {
    try {
      var undoManager = mainEditor.session.getUndoManager();
      var undoStack = undoManager.$undoStack || [];
      var redoStack = undoManager.$redoStack || [];
      var stackPosition = undoManager.$stackPosition || 0;
      var totalEntries = undoStack.length + redoStack.length;

      elements.historyCount.textContent = totalEntries;

      elements.historyList.innerHTML = '';

      // 限制显示数量
      var maxDisplay = maxHistoryEntries;
      var redoCount = redoStack.length;
      var undoCount = undoStack.length;
      // 如果总条目超过上限，从最早的撤销记录开始截断
      if (totalEntries > maxDisplay) {
        var excess = totalEntries - maxDisplay;
        // 优先截断撤销栈底部（最早的历史）
        if (excess <= undoCount) {
          undoCount -= excess;
        } else {
          redoCount = Math.max(0, redoCount - (excess - undoCount));
          undoCount = 0;
        }
      }

      // 显示重做栈（反向：最远->最近）
      for (var i = redoStack.length - 1; i >= redoStack.length - redoCount; i--) {
        var redoItem = createHistoryItem(redoStack[i], 'redo');
        redoItem.dataset.historyIndex = i;
        redoItem.dataset.historyKind = 'redo';
        redoItem.addEventListener('click', function(idx) {
          return function() { seekToHistory('redo', idx); };
        }(i));
        elements.historyList.appendChild(redoItem);
      }

      // 显示当前位置分隔
      if (undoStack.length > 0 && redoStack.length > 0) {
        var sep = document.createElement('div');
        sep.className = 'history-item current';
        sep.innerHTML = '<span class="history-action"><span class="history-action-label">← 当前位置</span></span>';
        elements.historyList.appendChild(sep);
      }

      // 显示撤销栈（反向：最近->最远）
      var displayedUndo = 0;
      for (var j = undoStack.length - 1; j >= 0; j--) {
        if (displayedUndo >= undoCount) break;
        var undoItem = createHistoryItem(undoStack[j], 'undo');
        undoItem.dataset.historyIndex = j;
        undoItem.dataset.historyKind = 'undo';
        undoItem.addEventListener('click', function(idx) {
          return function() { seekToHistory('undo', idx); };
        }(j));
        elements.historyList.appendChild(undoItem);
        displayedUndo++;
      }

      if (undoStack.length === 0 && redoStack.length === 0) {
        elements.historyList.innerHTML = '<div class="history-item" style="cursor:default;padding:24px 12px;text-align:center;color:var(--app-text-muted);font-size:11px;line-height:1.6;">暂无历史记录<br>编辑内容后将自动记录</div>';
      }
    } catch (e) {
      elements.historyList.innerHTML = '<div class="history-item" style="cursor:default;padding:24px 12px;text-align:center;color:var(--app-text-muted);font-size:11px;">历史记录不可用</div>';
    }
  }

  function seekToHistory(kind, index) {
    var undoManager = mainEditor.session.getUndoManager();
    var undoStack = undoManager.$undoStack || [];
    var redoStack = undoManager.$redoStack || [];
    var steps = 0;

    if (kind === 'undo') {
      // 点击撤销栈中的条目：index 是 undoStack 数组中的索引
      // 需要撤销的次数 = index + 1（因为最靠近当前位置的 undoStack[length-1] 撤销 1 次）
      steps = index + 1;
      for (var i = 0; i < steps; i++) {
        mainEditor.undo();
      }
    } else if (kind === 'redo') {
      // 点击重做栈中的条目：index 是 redoStack 数组中的索引
      // 需要重做的次数 = redoStack.length - index
      steps = redoStack.length - index;
      for (var j = 0; j < steps; j++) {
        mainEditor.redo();
      }
    }

    setTimeout(updateHistoryPanel, 100);
  }

  // 切换历史面板（内嵌编辑区左侧，与文件树一致）
  function toggleHistoryPanel() {
    const open = !isPaneOpen(elements.historyPane);
    if (open) {
      // 互斥：关闭文件树、最近、收藏、反链、大纲、标签面板
      closeOtherLeftPanes('show-history');
      updateHistoryPanel();
    }
    elements.historyPane.setAttribute('aria-hidden', String(!open));
    elements.editorWorkspace.classList.toggle('show-history', open);
    if (historyBtn) historyBtn.classList.toggle('active', open);
    setTimeout(function() { mainEditor.resize(); }, 250);
  }

  function closeHistoryPanel() {
    elements.historyPane.setAttribute('aria-hidden', 'true');
    elements.editorWorkspace.classList.remove('show-history');
    if (historyBtn) historyBtn.classList.remove('active');
    setTimeout(function() { mainEditor.resize(); }, 250);
  }

  // 历史按钮（在状态栏）
  var historyBtn = createStatusBtn('历史', '📋', '编辑历史', EditorShortcuts.get('history'));
  registerShortcutButton('history', historyBtn, '编辑历史');
  historyBtn.addEventListener('click', toggleHistoryPanel);
  elements.runtimeStatus.parentNode.insertBefore(historyBtn, elements.runtimeStatus);

  // 编辑历史快捷键（默认 Ctrl/Cmd+Shift+H，可在系统设置中修改）；由 EditorShortcuts 捕获阶段统一分发
  EditorShortcuts.registerHandler('history', function() { toggleHistoryPanel(); });

  elements.closeHistoryBtn.addEventListener('click', closeHistoryPanel);
  elements.undoHistoryBtn.addEventListener('click', function() {
    mainEditor.undo();
    setTimeout(updateHistoryPanel, 100);
  });
  elements.redoHistoryBtn.addEventListener('click', function() {
    mainEditor.redo();
    setTimeout(updateHistoryPanel, 100);
  });
  elements.clearHistoryBtn.addEventListener('click', function() {
    mainEditor.session.getUndoManager().reset();
    _lastUndoStackSize = 0;
    updateHistoryPanel();
    showToast('历史记录已清空');
  });

  // 编辑变更时更新历史，并记录时间戳
  var _lastUndoStackSize = 0;
  mainEditor.session.on('change', function() {
    // 为新撤销栈条目记录时间戳
    var um = mainEditor.session.getUndoManager();
    var stack = um.$undoStack || [];
    if (stack.length > _lastUndoStackSize) {
      for (var i = _lastUndoStackSize; i < stack.length; i++) {
        if (stack[i] && !stack[i]._timestamp) {
          stack[i]._timestamp = Date.now();
        }
      }
    }
    _lastUndoStackSize = stack.length;
    // 防抖更新历史面板（如果打开的话）
    if (!isPaneOpen(elements.historyPane)) return;
    clearTimeout(historyEntries._timer);
    historyEntries._timer = setTimeout(updateHistoryPanel, 300);
  });

  // ══════════════════════════════════════════════════════════
  // 7.5 Recent Files (最近打开 - 保留 20 条)
  // ══════════════════════════════════════════════════════════
  const RECENT_FILES_KEY = 'editor_recent_files';
  const MAX_RECENT_FILES = 20;

  function getRecentFiles() {
    try {
      return JSON.parse(localStorage.getItem(RECENT_FILES_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function recordRecentFile(filePath, fileName, opts) {
    if (!filePath) return;
    opts = opts || {};
    let list = getRecentFiles().filter(item => item.path !== filePath);
    list.unshift({
      path: filePath,
      name: fileName || filePath.split(/[\\/]/).pop() || filePath,
      time: Date.now(),
      source: opts.source || '',
      clipId: opts.clipId != null ? opts.clipId : null
    });
    list = list.slice(0, MAX_RECENT_FILES);
    try {
      localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(list));
    } catch (e) {
      FrontendLogger.warn('[Editor] Failed to save recent files:', e.message);
    }
  }

  function formatRecentTime(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + ' 小时前';
    return Math.floor(diff / 86400000) + ' 天前';
  }

  function renderRecentPanel() {
    const list = getRecentFiles();
    elements.recentList.innerHTML = '';
    if (list.length === 0) {
      elements.recentList.innerHTML = '<div class="history-item" style="cursor:default;color:var(--app-text-muted);">暂无最近打开的文件</div>';
      return;
    }
    // 分组：来自收件箱的剪藏置顶，其余为最近打开
    const clips = list.filter(item => item.source === 'clip');
    const others = list.filter(item => item.source !== 'clip');
    const appendGroup = (title, items) => {
      if (!items || items.length === 0) return;
      const group = document.createElement('div');
      group.className = 'recent-group';
      const head = document.createElement('div');
      head.className = 'recent-group-title';
      head.textContent = title;
      group.appendChild(head);
      items.forEach(item => group.appendChild(buildRecentItem(item)));
      elements.recentList.appendChild(group);
    };
    appendGroup('来自收件箱', clips);
    appendGroup('最近打开', others);
  }

  function buildRecentItem(item) {
    const el = document.createElement('div');
    el.className = 'recent-item' + (item.source === 'clip' ? ' recent-clip-item' : '');
    const nameLine = document.createElement('div');
    nameLine.className = 'recent-name';
    const nameText = document.createElement('span');
    nameText.textContent = item.name;
    nameLine.appendChild(nameText);
    if (item.source === 'clip') {
      const badge = document.createElement('span');
      badge.className = 'recent-clip-badge';
      badge.textContent = '收件箱';
      nameLine.appendChild(badge);
    }
    const metaLine = document.createElement('div');
    metaLine.className = 'recent-meta';
    metaLine.textContent = item.path + ' · ' + formatRecentTime(item.time);
    el.appendChild(nameLine);
    el.appendChild(metaLine);
    el.title = item.path;
    el.addEventListener('click', function () {
      if (item.source === 'clip' && item.clipId != null) {
        openRecentClip(item.clipId);
      } else {
        openRecentFile(item.path);
      }
    });
    el.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      e.stopPropagation();
      showRecentContextMenu(e, item);
    });
    return el;
  }

  /** 从收件箱剪藏分组重新打开该剪藏 */
  function openRecentClip(clipId) {
    closeRecentPanel();
    loadClipInNewTab(clipId);
  }

  async function openRecentFile(filePath) {
    const api = getElectronAPI();
    if (!api || !api.openFileByPath) {
      showToast('重新打开文件仅桌面模式可用', true);
      return;
    }
    closeRecentPanel();
    try {
      const result = await api.openFileByPath(filePath);
      if (!result || result.canceled) {
        // 文件已被删除/移动：从最近记录和收藏列表中移除
        recordRecentFileRemove(filePath);
        if (isFavoriteFile(filePath)) {
          removeFavoriteFile(filePath);
          showToast('文件不存在或已被移动，已从最近记录和收藏列表移除', true);
        } else {
          showToast('文件不存在或已被移动，已从最近记录移除', true);
        }
        renderRecentPanel();
        return;
      }
      saveActiveTabSnapshot();
      const newTab = createTabState();
      tabs.push(newTab);
      activeTabIndex = tabs.length - 1;
      state = tabs[activeTabIndex];
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
      showToast('已打开 ' + result.fileName);
    } catch (error) {
      handleError('打开文件失败', error);
    }
  }

  function recordRecentFileRemove(filePath) {
    const list = getRecentFiles().filter(item => item.path !== filePath);
    try {
      localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(list));
    } catch (e) {}
  }

  // 切换最近面板（内嵌编辑区左侧，与文件树一致）
  function toggleRecentPanel() {
    const open = !isPaneOpen(elements.recentPane);
    if (open) {
      // 互斥：关闭文件树、历史、收藏、反链、大纲、标签面板
      closeOtherLeftPanes('show-recent');
      renderRecentPanel();
    }
    elements.recentPane.setAttribute('aria-hidden', String(!open));
    elements.editorWorkspace.classList.toggle('show-recent', open);
    if (recentBtn) recentBtn.classList.toggle('active', open);
    setTimeout(function() { mainEditor.resize(); }, 250);
  }

  function closeRecentPanel() {
    elements.recentPane.setAttribute('aria-hidden', 'true');
    elements.editorWorkspace.classList.remove('show-recent');
    if (recentBtn) recentBtn.classList.remove('active');
    setTimeout(function() { mainEditor.resize(); }, 250);
  }

  // 最近打开按钮（状态栏，历史按钮旁）
  var recentBtn = createStatusBtn('最近', '🕐', '最近打开的文件', EditorShortcuts.get('recent'));
  registerShortcutButton('recent', recentBtn, '最近打开的文件');
  recentBtn.addEventListener('click', toggleRecentPanel);
  elements.runtimeStatus.parentNode.insertBefore(recentBtn, elements.runtimeStatus);

  // 最近打开快捷键（默认 Ctrl/Cmd+Shift+N，可在系统设置中修改；
  // 原 Ctrl/Cmd+Shift+R 与「强制刷新」冲突故让出；由 EditorShortcuts 捕获阶段统一分发
  EditorShortcuts.registerHandler('recent', function() { toggleRecentPanel(); });

  elements.closeRecentBtn.addEventListener('click', closeRecentPanel);
  elements.clearRecentBtn.addEventListener('click', function() {
    localStorage.removeItem(RECENT_FILES_KEY);
    renderRecentPanel();
    showToast('最近打开记录已清空');
  });

  // 打开文件时记录到最近列表
  // （openMainFile / openFileTreeFile 成功回调中调用 recordRecentFile）

  // ══════════════════════════════════════════════════════════
  // 7.6 Favorite Files (常用文件收藏 - 无数量上限)
  // ══════════════════════════════════════════════════════════
  var FAVORITE_FILES_KEY = 'editor_favorite_files';

  function getFavoriteFiles() {
    try {
      return JSON.parse(localStorage.getItem(FAVORITE_FILES_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function saveFavoriteFiles(list) {
    try {
      localStorage.setItem(FAVORITE_FILES_KEY, JSON.stringify(list));
    } catch (e) {
      FrontendLogger.warn('[Editor] Failed to save favorite files:', e.message);
    }
  }

  function addFavoriteFile(filePath, fileName) {
    if (!filePath) return false;
    var list = getFavoriteFiles();
    var existing = list.filter(function(item) { return item.path === filePath; });
    if (existing.length > 0) return false; // 已存在
    list.push({ id: 'fav_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), path: filePath, name: fileName || filePath.split(/[\\/]/).pop() || filePath, addTime: Date.now() });
    saveFavoriteFiles(list);
    if (elements.favPane.getAttribute('aria-hidden') === 'false') renderFavPanel();
    return true;
  }

  function removeFavoriteFile(filePath) {
    var list = getFavoriteFiles().filter(function(item) { return item.path !== filePath; });
    saveFavoriteFiles(list);
    if (elements.favPane.getAttribute('aria-hidden') === 'false') renderFavPanel();
  }

  function isFavoriteFile(filePath) {
    return getFavoriteFiles().some(function(item) { return item.path === filePath; });
  }

  function toggleFavItem(filePath, fileName) {
    if (isFavoriteFile(filePath)) {
      removeFavoriteFile(filePath);
      showToast('已取消收藏');
    } else {
      addFavoriteFile(filePath, fileName);
      showToast('已收藏到常用');
    }
  }

  function openFileInFolder(filePath) {
    if (!filePath) { showToast('文件路径不可用', true); return; }
    var api = getElectronAPI();
    if (api && api.showItemInFolder) {
      api.showItemInFolder(filePath);
    } else {
      showToast('仅在桌面模式下可用', true);
    }
  }

  function renderFavPanel() {
    var list = getFavoriteFiles();
    elements.favList.innerHTML = '';
    if (list.length === 0) {
      elements.favList.innerHTML = '<div class="fav-empty"><div class="fav-empty-icon">☆</div><div>暂无收藏文件</div><div style="font-size:11px;opacity:0.7;">右键标签栏可收藏</div></div>';
      return;
    }
    list.forEach(function(item, index) {
      var el = document.createElement('div');
      el.className = 'fav-item';
      el.draggable = true;
      el.dataset.favIndex = index;
      // 拖拽手柄
      var handle = document.createElement('span');
      handle.className = 'fav-drag-handle';
      handle.textContent = '☰';
      handle.title = '拖拽排序';
      // 文件信息
      var body = document.createElement('div');
      body.className = 'fav-body';
      var nameLine = document.createElement('div');
      nameLine.className = 'fav-name';
      nameLine.textContent = item.name;
      var metaLine = document.createElement('div');
      metaLine.className = 'fav-meta';
      metaLine.textContent = item.path;
      body.appendChild(nameLine);
      body.appendChild(metaLine);
      // 删除按钮
      var removeBtn = document.createElement('button');
      removeBtn.className = 'fav-remove-btn';
      removeBtn.textContent = '×';
      removeBtn.title = '取消收藏';
      removeBtn.addEventListener('click', function(ev) {
        ev.stopPropagation();
        removeFavoriteFile(item.path);
        showToast('已取消收藏');
      });
      // 点击打开文件
      el.addEventListener('click', function() {
        openRecentFile(item.path);
      });
      // 拖拽事件
      el.draggable = true;
      el.addEventListener('dragstart', function(ev) {
        el.classList.add('dragging');
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', index);
        // 自定义拖拽幽灵图
        var ghost = el.cloneNode(true);
        ghost.style.position = 'absolute';
        ghost.style.top = '-9999px';
        ghost.style.width = el.offsetWidth + 'px';
        ghost.style.opacity = '0.7';
        ghost.style.borderRadius = '6px';
        ghost.style.background = 'var(--app-surface)';
        ghost.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        ghost.style.padding = '6px 8px';
        ghost.style.fontSize = '12px';
        ghost.style.pointerEvents = 'none';
        document.body.appendChild(ghost);
        ev.dataTransfer.setDragImage(ghost, 20, 20);
        setTimeout(function() { document.body.removeChild(ghost); }, 0);
      });
      el.addEventListener('dragend', function() {
        el.classList.remove('dragging');
        document.querySelectorAll('.fav-item.drag-over').forEach(function(o) { o.classList.remove('drag-over'); });
      });
      el.addEventListener('dragleave', function() {
        el.classList.remove('drag-over');
      });
      el.appendChild(handle);
      el.appendChild(body);
      el.appendChild(removeBtn);
      el.addEventListener('animationend', function() {
        el.classList.remove('fav-enter');
      });
      elements.favList.appendChild(el);
      // 新项入场动画
      requestAnimationFrame(function() { el.classList.add('fav-enter'); });
    });
  }

  function toggleFavPanel() {
    var open = elements.favPane.getAttribute('aria-hidden') === 'false';
    if (open) {
      // 关闭
      elements.favPane.setAttribute('aria-hidden', 'true');
      elements.editorWorkspace.classList.remove('show-fav');
      if (favBtn) favBtn.classList.remove('active');
      setTimeout(function() { mainEditor.resize(); }, 250);
    } else {
      // 互斥关闭其他面板（文件树/历史/最近/反链/大纲/标签）
      closeOtherLeftPanes('show-fav');
      renderFavPanel();
      elements.favPane.setAttribute('aria-hidden', 'false');
      elements.editorWorkspace.classList.add('show-fav');
      if (favBtn) favBtn.classList.add('active');
      setTimeout(function() { mainEditor.resize(); }, 250);
    }
  }

  function closeFavPanel() {
    elements.favPane.setAttribute('aria-hidden', 'true');
    elements.editorWorkspace.classList.remove('show-fav');
    if (favBtn) favBtn.classList.remove('active');
    setTimeout(function() { mainEditor.resize(); }, 250);
  }

  // 收藏按钮（状态栏）
  var favBtn = createStatusBtn('收藏', '⭐', '常用文件收藏', EditorShortcuts.get('favorite'));
  registerShortcutButton('favorite', favBtn, '常用文件收藏');
  favBtn.addEventListener('click', toggleFavPanel);
  elements.runtimeStatus.parentNode.insertBefore(favBtn, elements.runtimeStatus);

  // 收藏快捷键（默认 Ctrl/Cmd+Shift+A，可在系统设置中修改；
  // 原 Ctrl/Cmd+Shift+F 为全局搜索快捷键故让出；由 EditorShortcuts 捕获阶段统一分发
  EditorShortcuts.registerHandler('favorite', function() { toggleFavPanel(); });

  // 常用文件面板事件绑定
  elements.closeFavBtn.addEventListener('click', closeFavPanel);
  elements.clearFavBtn.addEventListener('click', function() {
    saveFavoriteFiles([]);
    renderFavPanel();
    showToast('常用文件已清空');
  });

  // fav-list 拖拽排序（一次性注册，避免重复监听）
  elements.favList.addEventListener('dragover', function(ev) {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    var target = ev.target.closest('.fav-item');
    if (!target) return;
    document.querySelectorAll('.fav-item.drag-over').forEach(function(o) { if (o !== target) o.classList.remove('drag-over'); });
    target.classList.add('drag-over');
  });
  elements.favList.addEventListener('drop', function(ev) {
    ev.preventDefault();
    var srcIndex = parseInt(ev.dataTransfer.getData('text/plain'), 10);
    var target = ev.target.closest('.fav-item');
    if (!target) return;
    var dstIndex = parseInt(target.dataset.favIndex, 10);
    if (isNaN(srcIndex) || isNaN(dstIndex) || srcIndex === dstIndex) return;
    var list = getFavoriteFiles();
    var item = list.splice(srcIndex, 1)[0];
    list.splice(dstIndex, 0, item);
    saveFavoriteFiles(list);
    renderFavPanel();
  });

  // ══════════════════════════════════════════════════════════
  // 8. Overview Ruler (滚动条预览图 - 简化 minimap)
  // ══════════════════════════════════════════════════════════
  (function initOverviewRuler() {
    var rulerEl = document.getElementById('overviewRuler');
    if (!rulerEl) return;

    var canvas = document.createElement('canvas');
    rulerEl.appendChild(canvas);
    var ctx = canvas.getContext('2d');

    // 视口指示器
    var viewport = document.createElement('div');
    viewport.className = 'overview-viewport';
    rulerEl.appendChild(viewport);

    // 行号提示
    var tooltip = document.createElement('div');
    tooltip.className = 'overview-ruler-tip';
    rulerEl.appendChild(tooltip);

    var rulerVisible = false;
    var renderTimer = null;
    var LINE_HEIGHT = 3; // 每行像素高度
    var MIN_LINE_HEIGHT = 1;
    var MAX_VISIBLE_LINES = 2000;

    function updateRulerSize() {
      var rect = rulerEl.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      ctx.scale(dpr, dpr);
    }

    function renderOverview() {
      if (!rulerVisible) return;
      var rect = rulerEl.getBoundingClientRect();
      var w = rect.width;
      var h = rect.height;
      if (w <= 0 || h <= 0) return;

      ctx.clearRect(0, 0, w, h);

      var session = mainEditor.session;
      var lines = session.getDocument().getAllLines();
      var totalLines = lines.length;
      if (totalLines === 0) return;

      // 计算每行像素
      var lh = Math.max(MIN_LINE_HEIGHT, Math.min(LINE_HEIGHT, h / Math.min(totalLines, MAX_VISIBLE_LINES)));
      var totalHeight = totalLines * lh;
      var offsetY = 0;
      if (totalHeight < h) {
        offsetY = (h - totalHeight) / 2;
      }

      // 绘制每一行（简化：用灰度表示行长度）
      var maxLineLen = 0;
      for (var i = 0; i < Math.min(totalLines, MAX_VISIBLE_LINES); i++) {
        if (lines[i].length > maxLineLen) maxLineLen = lines[i].length;
      }
      maxLineLen = Math.max(maxLineLen, 1);

      // 使用主题色
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      var textColor = isDark ? 'rgba(212,212,212,0.35)' : 'rgba(30,30,30,0.25)';
      var emptyColor = isDark ? 'rgba(212,212,212,0.08)' : 'rgba(30,30,30,0.06)';

      ctx.fillStyle = emptyColor;
      ctx.fillRect(2, offsetY, w - 4, totalHeight);

      // 绘制每一行内容
      for (var j = 0; j < Math.min(totalLines, MAX_VISIBLE_LINES); j++) {
        var y = offsetY + j * lh;
        var line = lines[j] || '';
        var lineLen = Math.min(line.length, maxLineLen);
        var barWidth = Math.max(1, (w - 4) * (lineLen / maxLineLen));
        ctx.fillStyle = textColor;
        ctx.fillRect(2, y, barWidth, Math.max(1, lh - 0.5));
      }

      // 更新视口指示器
      var firstRow = session.getFirstVisibleRow();
      var lastRow = session.getLastVisibleRow();
      var vpTop = offsetY + firstRow * lh;
      var vpHeight = Math.max(3, (lastRow - firstRow) * lh);
      viewport.style.top = vpTop + 'px';
      viewport.style.height = vpHeight + 'px';
    }

    function toggleOverviewRuler(show) {
      rulerVisible = show !== undefined ? show : !rulerVisible;
      rulerEl.setAttribute('aria-hidden', String(!rulerVisible));
      if (rulerVisible) {
        setTimeout(function() {
          updateRulerSize();
          renderOverview();
        }, 250);
      }
    }

    // 点击跳转到指定行
    rulerEl.addEventListener('click', function(e) {
      if (!rulerVisible) return;
      var rect = rulerEl.getBoundingClientRect();
      var session = mainEditor.session;
      var totalLines = session.getLength();
      if (totalLines === 0) return;

      var lh = Math.max(MIN_LINE_HEIGHT, Math.min(LINE_HEIGHT, rect.height / Math.min(totalLines, MAX_VISIBLE_LINES)));
      var totalHeight = totalLines * lh;
      var offsetY = 0;
      if (totalHeight < rect.height) {
        offsetY = (rect.height - totalHeight) / 2;
      }

      var relY = e.clientY - rect.top - offsetY;
      var targetRow = Math.round(relY / lh);
      targetRow = Math.max(0, Math.min(totalLines - 1, targetRow));

      // 将目标行滚动到编辑器中间
      var editorHeight = mainEditor.renderer.layerConfig.maxHeight;
      var rowHeight = editorHeight / totalLines;
      var scrollTop = targetRow * rowHeight - mainEditor.renderer.layerConfig.height / 2;
      mainEditor.session.setScrollTop(Math.max(0, scrollTop));
      mainEditor.gotoLine(targetRow + 1, 0, true);
      mainEditor.focus();
    });

    // 悬停显示行号
    rulerEl.addEventListener('mousemove', function(e) {
      if (!rulerVisible) return;
      var rect = rulerEl.getBoundingClientRect();
      var session = mainEditor.session;
      var totalLines = session.getLength();
      if (totalLines === 0) return;

      var lh = Math.max(MIN_LINE_HEIGHT, Math.min(LINE_HEIGHT, rect.height / Math.min(totalLines, MAX_VISIBLE_LINES)));
      var totalHeight = totalLines * lh;
      var offsetY = 0;
      if (totalHeight < rect.height) {
        offsetY = (rect.height - totalHeight) / 2;
      }

      var relY = e.clientY - rect.top - offsetY;
      var targetRow = Math.round(relY / lh);
      targetRow = Math.max(0, Math.min(totalLines - 1, targetRow));

      tooltip.textContent = '行 ' + (targetRow + 1);
      tooltip.style.top = Math.max(0, e.clientY - rect.top - 8) + 'px';
      tooltip.classList.add('show');
    });

    rulerEl.addEventListener('mouseleave', function() {
      tooltip.classList.remove('show');
    });

    // 编辑器内容变化时重新渲染
    mainEditor.session.on('change', function() {
      if (!rulerVisible) return;
      clearTimeout(renderTimer);
      renderTimer = setTimeout(renderOverview, 300);
    });

    // 滚动时更新视口指示器
    mainEditor.session.on('changeScrollTop', function() {
      if (!rulerVisible) return;
      clearTimeout(renderTimer);
      renderTimer = setTimeout(renderOverview, 100);
    });

    // 窗口大小变化时更新
    window.addEventListener('resize', function() {
      if (!rulerVisible) return;
      updateRulerSize();
      renderOverview();
    });

    // 主题变化时重新渲染
    window.addEventListener('storage', function(e) {
      if (e.key === THEME_STORAGE_KEY || e.key === APPEARANCE_KEY) {
        if (rulerVisible) setTimeout(renderOverview, 100);
      }
    });

    // Ctrl/Cmd+Shift+Y 切换概览（默认，可在系统设置中修改）；由 EditorShortcuts 捕获阶段统一分发
    EditorShortcuts.registerHandler('overview', function() { toggleOverviewRuler(); });
  })();

  /* ─── 词典库 (DICT_LIB) ─── */
  var DICT_LIB_STORAGE_KEY = 'editor_dict_lib_v1';

  /** 从 localStorage 加载词典库 */
  function loadDictLib() {
    try {
      var data = localStorage.getItem(DICT_LIB_STORAGE_KEY);
      if (data) {
        var parsed = JSON.parse(data);
        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
          window.DICT_LIB = parsed;
          return;
        }
      }
    } catch (e) { /* 忽略 */ }
    window.DICT_LIB = {};
  }

  /** 保存词典库到 localStorage */
  function saveDictLib() {
    try {
      localStorage.setItem(DICT_LIB_STORAGE_KEY, JSON.stringify(window.DICT_LIB || {}));
    } catch (e) { /* 忽略 */ }
  }

  /** 添加词典库条目 */
  function addDictLibEntry(source, target) {
    if (!source || !source.trim() || !target || !target.trim()) {
      showToast('源词和翻译不能为空', true);
      return false;
    }
    source = source.trim();
    target = target.trim();
    if (!window.DICT_LIB) window.DICT_LIB = {};
    window.DICT_LIB[source] = target;
    saveDictLib();
    registerDictCompleter();
    return true;
  }

  /** 删除词典库条目 */
  function removeDictLibEntry(source) {
    if (!window.DICT_LIB) return;
    delete window.DICT_LIB[source];
    saveDictLib();
    registerDictCompleter();
  }

  /** 在词典库中查找 */
  function lookupDictLib(word) {
    if (!window.DICT_LIB || !word) return null;
    if (window.DICT_LIB[word]) {
      return { word: word, meaning: window.DICT_LIB[word], matchedAs: '词典库' };
    }
    return null;
  }

  /** 待处理的词典自动添加（AI搜索/在线翻译完成后触发） */
  var pendingDictAdd = null;

  /* ─── 用户自定义词典 (USER_DICT) ─── */
  var USER_DICT_STORAGE_KEY = 'editor_user_dict_v1';

  /** 从 localStorage 加载用户词典 */
  function loadUserDict() {
    try {
      var data = localStorage.getItem(USER_DICT_STORAGE_KEY);
      if (data) {
        var parsed = JSON.parse(data);
        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
          window.USER_DICT = parsed;
          return;
        }
      }
    } catch (e) { /* 忽略 */ }
    window.USER_DICT = {};
  }

  /** 保存用户词典到 localStorage */
  function saveUserDict() {
    try {
      localStorage.setItem(USER_DICT_STORAGE_KEY, JSON.stringify(window.USER_DICT || {}));
    } catch (e) { /* 忽略 */ }
  }

  /** 添加用户词典条目 */
  function addUserDictEntry(source, target) {
    if (!source || !source.trim() || !target || !target.trim()) {
      showToast('源词和目标释义不能为空', true);
      return false;
    }
    source = source.trim();
    target = target.trim();
    if (!window.USER_DICT) window.USER_DICT = {};
    window.USER_DICT[source] = target;
    saveUserDict();
    return true;
  }

  /** 删除用户词典条目 */
  function removeUserDictEntry(source) {
    if (!window.USER_DICT) return;
    delete window.USER_DICT[source];
    saveUserDict();
  }

  /** 渲染词典列表 */
  function renderDictList() {
    var listEl = elements.dictList;
    if (!listEl) return;
    var dict = window.USER_DICT || {};
    var keys = Object.keys(dict);
    if (keys.length === 0) {
      listEl.innerHTML = '<div class="dict-list-empty">暂无自定义词典条目<br>在上方输入源词和目标释义后点击"添加条目"</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < keys.length; i++) {
      var src = keys[i];
      var tgt = dict[src];
      var isCn = /[\u4e00-\u9fff]/.test(src);
      html += '<div class="dict-item" data-source="' + encodeURIComponent(src) + '">'
        + '<span class="dict-source">' + escapeHtml(src) + '</span>'
        + '<span class="dict-arrow">' + (isCn ? '→' : '→') + '</span>'
        + '<span class="dict-target">' + escapeHtml(tgt) + '</span>'
        + '<button class="dict-remove-btn" data-source="' + encodeURIComponent(src) + '" title="删除条目">×</button>'
        + '</div>';
    }
    listEl.innerHTML = html;
    // 绑定删除事件
    listEl.querySelectorAll('.dict-remove-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var src = decodeURIComponent(this.dataset.source);
        removeUserDictEntry(src);
        renderDictList();
        showToast('已删除词典条目: ' + src);
      });
    });
  }

  /** 渲染词典库列表 */
  function renderDictLibList() {
    var listEl = elements.dictLibList;
    if (!listEl) return;
    var dict = window.DICT_LIB || {};
    var keys = Object.keys(dict);
    if (keys.length === 0) {
      listEl.innerHTML = '<div class="dict-list-empty">暂无词典库条目<br>右键选中文本选择"添加词典库"快速添加</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < keys.length; i++) {
      var src = keys[i];
      var tgt = dict[src];
      html += '<div class="dict-item" data-source="' + encodeURIComponent(src) + '">'
        + '<span class="dict-source">' + escapeHtml(src) + '</span>'
        + '<span class="dict-arrow">→</span>'
        + '<span class="dict-target">' + escapeHtml(tgt) + '</span>'
        + '<button class="dict-remove-btn" data-source="' + encodeURIComponent(src) + '" title="删除条目">×</button>'
        + '</div>';
    }
    listEl.innerHTML = html;
    listEl.querySelectorAll('.dict-remove-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var src = decodeURIComponent(this.dataset.source);
        removeDictLibEntry(src);
        renderDictLibList();
        showToast('已删除词典库条目: ' + src);
      });
    });
  }

  /** 切换词典弹窗标签 */
  function switchDictTab(tab) {
    if (!elements.dictTabMapping || !elements.dictTabLibrary) return;
    var tabs = document.querySelectorAll('.dict-tab');
    tabs.forEach(function(t) {
      t.classList.remove('active');
      if (t.dataset.dictTab === tab) t.classList.add('active');
    });
    elements.dictTabMapping.style.display = tab === 'mapping' ? 'block' : 'none';
    elements.dictTabLibrary.style.display = tab === 'library' ? 'block' : 'none';
  }

  /** 打开词典弹窗并预填源词 */
  function openDictModalWithSource(sourceText) {
    if (elements.dictSourceInput) elements.dictSourceInput.value = sourceText;
    switchDictTab('mapping');
    openDictModal();
    if (elements.dictTargetInput) setTimeout(function() { elements.dictTargetInput.focus(); }, 100);
  }

  /** 弹出词典库添加对话框（替代 window.prompt，兼容 Electron contextIsolation） */
  function showDictLibAddDialog(sourceText) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    overlay.style.cssText = 'display:flex;align-items:center;justify-content:center;z-index:10000';

    var dialog = document.createElement('div');
    dialog.className = 'modal-card';
    dialog.style.cssText = 'width:400px;padding:20px';

    dialog.innerHTML = '<div class="panel-header" style="margin-bottom:12px">'
      + '<div><h2>添加到词典库</h2><p style="font-size:12px;color:var(--app-text-muted);margin-top:4px">为 "' + escapeHtml(sourceText) + '" 添加翻译</p></div>'
      + '</div>'
      + '<label class="field-group wide" style="margin-bottom:12px">'
      + '<span class="field-label">翻译</span>'
      + '<input class="field-control" id="dictLibAddInput" placeholder="输入翻译" style="width:100%">'
      + '</label>'
      + '<div class="panel-actions" style="justify-content:flex-end;gap:8px">'
      + '<button class="tool-btn" id="dictLibAddCancelBtn">取消</button>'
      + '<button class="tool-btn primary" id="dictLibAddConfirmBtn">添加</button>'
      + '</div>';

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    var input = dialog.querySelector('#dictLibAddInput');
    var confirmBtn = dialog.querySelector('#dictLibAddConfirmBtn');
    var cancelBtn = dialog.querySelector('#dictLibAddCancelBtn');

    function close() { document.body.removeChild(overlay); }

    confirmBtn.addEventListener('click', function() {
      var translation = input.value.trim();
      if (translation) {
        if (addDictLibEntry(sourceText, translation)) {
          showToast('✅ 已添加到词典库: ' + sourceText + ' → ' + translation);
        }
      }
      close();
    });
    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
    input.addEventListener('keydown', function(e) { if (e.key === 'Enter') confirmBtn.click(); });

    setTimeout(function() { input.focus(); }, 100);
  }

  /** 弹出快速添加对话框，将选中文本添加到词典库 */
  function promptAddToDictLib(sourceText) {
    showDictLibAddDialog(sourceText);
  }

  /** 转义 HTML 特殊字符 */
  // Phase 4-1：已抽取到 editor-pure.js（EditorPure），此处优先委托，缺失时回退原实现。
  function escapeHtml(str) {
    if (window.EditorPure && typeof window.EditorPure.escapeHtml === 'function') {
      return window.EditorPure.escapeHtml(str);
    }
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  /** 打开词典管理弹窗 */
  function openDictModal() {
    // 重置到自定义映射标签
    switchDictTab('mapping');
    renderDictList();
    renderDictLibList();
    elements.dictModal.classList.add('is-visible');
  }

  /** 关闭词典管理弹窗 */
  function closeDictModal() {
    elements.dictModal.classList.remove('is-visible');
  }

  /** 初始化词典管理弹窗 */
  function setupDictModal() {
    if (!elements.dictModal) return;
    // 添加条目按钮
    elements.dictAddBtn.addEventListener('click', function() {
      var source = elements.dictSourceInput.value.trim();
      var target = elements.dictTargetInput.value.trim();
      if (!source || !target) {
        showToast('请输入源词和目标释义', true);
        return;
      }
      if (addUserDictEntry(source, target)) {
        showToast('✅ 已添加词典条目: ' + source + ' → ' + target);
        elements.dictSourceInput.value = '';
        elements.dictTargetInput.value = '';
        renderDictList();
        // 重新注册 completer 以包含新条目
        registerDictCompleter();
      }
    });
    // 回车键快速添加
    elements.dictTargetInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        elements.dictAddBtn.click();
      }
    });
    // 点击关闭按钮
    elements.dictModal.querySelectorAll('[data-close-modal="dictModal"]').forEach(function(el) {
      el.addEventListener('click', closeDictModal);
    });
    // 点击遮罩层关闭
    elements.dictModal.addEventListener('click', function(e) {
      if (e.target === elements.dictModal) closeDictModal();
    });
    // 标签切换
    elements.dictModal.querySelectorAll('.dict-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        switchDictTab(this.dataset.dictTab);
      });
    });
  }

  /* ─── ACE 编辑器词典自动补全 (Completer) ─── */
  var registeredDictCompleter = null;

  /** 收集所有词典数据（DICT + DICT_CN + USER_DICT） */
  function collectDictEntries() {
    var entries = {};
    // 内置英→中词典
    if (window.DICT) {
      var dk = Object.keys(window.DICT);
      for (var di = 0; di < dk.length; di++) {
        entries[dk[di]] = window.DICT[dk[di]];
      }
    }
    // 内置中→英词典
    if (window.DICT_CN) {
      var ck = Object.keys(window.DICT_CN);
      for (var ci = 0; ci < ck.length; ci++) {
        entries[ck[ci]] = window.DICT_CN[ck[ci]];
      }
    }
    // 用户自定义词典
    if (window.USER_DICT) {
      var uk = Object.keys(window.USER_DICT);
      for (var ui = 0; ui < uk.length; ui++) {
        entries[uk[ui]] = window.USER_DICT[uk[ui]];
      }
    }
    // 词典库
    if (window.DICT_LIB) {
      var lk = Object.keys(window.DICT_LIB);
      for (var li = 0; li < lk.length; li++) {
        entries[lk[li]] = window.DICT_LIB[lk[li]];
      }
    }
    return entries;
  }

  /** 注册词典自动补全 completer */
  function registerDictCompleter() {
    if (!mainEditor) return;
    var langTools = null;
    try {
      langTools = ace.require('ace/ext/language_tools');
    } catch (e) { return; }
    if (!langTools) return;

    // 移除旧的 completer（如果有）
    if (registeredDictCompleter) {
      var completers = mainEditor.completers || [];
      var idx = completers.indexOf(registeredDictCompleter);
      if (idx !== -1) completers.splice(idx, 1);
    }

    var dictEntries = collectDictEntries();
    var keys = Object.keys(dictEntries);

    var completer = {
      identifierRegexps: [/[a-zA-Z\u4e00-\u9fff]/],
      getCompletions: function(editor, session, pos, prefix, callback) {
        if (!prefix || prefix.length === 0) {
          callback(null, []);
          return;
        }
        var prefixLower = prefix.toLowerCase();
        var results = [];
        var seen = {};
        for (var i = 0; i < keys.length; i++) {
          var key = keys[i];
          if (key.indexOf(prefix) === 0 || key.toLowerCase().indexOf(prefixLower) !== -1) {
            if (seen[key]) continue;
            seen[key] = true;
            var isCn = /[\u4e00-\u9fff]/.test(key);
            results.push({
              caption: key,
              value: isCn ? dictEntries[key] : key,
              meta: '词典',
              score: key.indexOf(prefix) === 0 ? 1000 : 500
            });
          }
        }
        // 按匹配度排序
        results.sort(function(a, b) { return b.score - a.score; });
        callback(null, results.slice(0, 50));
      }
    };

    registeredDictCompleter = completer;
    if (langTools.addCompleter) {
      langTools.addCompleter(completer);
    } else if (mainEditor.completers) {
      mainEditor.completers.push(completer);
    }
  }

  /**
   * 注册语言关键字补全（Phase 2 代码智能，opt-in）。
   * 独立于词典 completer，仅按当前语言模式提供关键字候选；
   * 开关关闭时不注册，现有补全行为不受影响。
   */
  var KEYWORD_LISTS = {
    json: ['true', 'false', 'null'],
    sql: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'FROM', 'WHERE', 'ORDER', 'GROUP', 'BY', 'HAVING', 'LIMIT', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'AS', 'AND', 'OR', 'NOT', 'NULL', 'CREATE', 'TABLE', 'INDEX', 'ALTER', 'DROP', 'VALUES', 'SET', 'INTO', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX'],
    xml: ['xml', 'version', 'encoding', 'xsl:stylesheet', 'template', 'match', 'select', 'value-of'],
    sqlAndMore: ['BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END']
  };
  var registeredKeywordCompleter = null;

  function registerKeywordCompleter() {
    if (!featureOn('keywordCompleter')) return;
    if (!mainEditor) return;
    var langTools = null;
    try { langTools = ace.require('ace/ext/language_tools'); } catch (e) { return; }
    if (!langTools) return;

    // 移除旧的 completer（如果有），保持幂等
    if (registeredKeywordCompleter) {
      var completersOld = mainEditor.completers || [];
      var idxOld = completersOld.indexOf(registeredKeywordCompleter);
      if (idxOld !== -1) completersOld.splice(idxOld, 1);
    }

    var completer = {
      identifierRegexps: [/[A-Za-z_]/],
      getCompletions: function(editor, session, pos, prefix, callback) {
        if (!prefix || prefix.length === 0) { callback(null, []); return; }
        var modeParts = (session.getMode() || {}).$id || '';
        var modeName = (modeParts.split('/').pop() || '').toLowerCase();
        var words = KEYWORD_LISTS[modeName] || [];
        if (modeName === 'sql') words = words.concat(KEYWORD_LISTS.sqlAndMore);
        var prefixLower = prefix.toLowerCase();
        var results = [];
        words.forEach(function(w) {
          // 小写单词按前缀匹配（SQL 关键字给原样大写）；其它按前缀匹配，命中即提示
          if (w.toLowerCase().indexOf(prefixLower) === 0) {
            results.push({ caption: w, value: w, meta: '关键字', score: 900 });
          }
        });
        callback(null, results.slice(0, 50));
      }
    };

    registeredKeywordCompleter = completer;
    if (langTools.addCompleter) langTools.addCompleter(completer);
    else if (mainEditor.completers) mainEditor.completers.push(completer);
  }

  // 初始化：加载词典 + 注册 completer + 设置弹窗
  loadDictLib();
  loadUserDict();
  setupDictModal();
  // 延迟注册 completer（等待编辑器完全初始化）
  setTimeout(registerDictCompleter, 500);
  // Phase 2：语言关键字补全（开关开启时注册，与词典 completer 相互独立）
  setTimeout(registerKeywordCompleter, 600);

  // ══════════════════════════════════════════════════════════
  // FP-1 / FP-6 Obsidian 双链（wikilink）支持
  // ─ 补全 / 索引 / 解析 / 跳转 / 反链 / 存入知识库
  // ══════════════════════════════════════════════════════════
  var wikilinkState = { targets: [], modules: [], loaded: false };
  var registeredWikilinkCompleter = null;
  var wikilinkMatchCache = null;   // 补全/模糊匹配的轻量预计算缓存（重建于索引加载后，避免每次击键全量扫描）
  var currentLinkTab = 'backlinks';   // 双向链接面板当前激活 tab：backlinks | outgoing

  /** 当前文档真实文件名（含扩展名，非 md 文件标题显示准确） */
  function getCurrentFileName() {
    var name = (state && state.fileName) || '';
    // 防御：个别来源可能传入完整路径，仅保留 basename
    if (name.indexOf('/') !== -1 || name.indexOf('\\') !== -1) {
      name = String(name).split(/[\\/]/).pop();
    }
    return name;
  }

  /** 当前文档 basename（去扩展名） */
  function getCurrentBasename() {
    return getCurrentFileName().replace(/\.[^.]+$/, '');
  }

  /** 由当前文件绝对路径推断其所属模块 id（未保存/未纳管返回 null，即无就近优先级） */
  function getModuleIdByPath(currentPath) {
    if (!currentPath) return null;
    var norm = String(currentPath).replace(/\\/g, '/');
    var best = null;
    var bestLen = -1;
    var targets = wikilinkState.targets || [];
    for (var i = 0; i < targets.length; i++) {
      var abs = targets[i].absolutePath || '';
      if (abs && norm.indexOf(abs.replace(/\\/g, '/')) === 0 && abs.length > bestLen) {
        best = targets[i].moduleId;
        bestLen = abs.length;
      }
    }
    return best;
  }

  /** 构建链接索引：扫描各模块下所有可链接文本文件（md + txt/sql/json 等）的 basename + 相对路径 + 模块信息 */
  async function buildLinkIndex() {
    var api = getElectronAPI();
    if (!api || !api.listWikilinkTargets) {
      wikilinkState.targets = [];
      wikilinkState.modules = [];
      wikilinkState.loaded = true;
      wikilinkMatchCache = null;
      return;
    }
    try {
      var res = await api.listWikilinkTargets();
      wikilinkState.targets = (res && res.targets) || [];
      wikilinkState.modules = (res && res.modules) || [];
      wikilinkState.loaded = true;
      wikilinkMatchCache = null;
    } catch (e) {
      wikilinkState.targets = [];
      wikilinkState.modules = [];
      wikilinkState.loaded = true;
      wikilinkMatchCache = null;
    }
  }

  /**
   * 解析 wikilink 目标（多模块就近优先）。
   * 1) 含 `/` → 相对路径精确匹配（Obsidian 库内相对路径语法）；
   * 2) fileName（含扩展名）精确匹配（支持 [[query.sql]] 显式消歧）；
   * 3) basename 匹配 → 就近优先排序（同模块优先 → relativePath 短者优先）。
   * 返回：命中唯一 → 目标对象；命中多个 → 数组；未命中 → null。
   */
  function resolveWikilink(target, currentPath) {
    var t = String(target || '').trim();
    if (!t) return null;
    var targets = wikilinkState.targets || [];
    var rel, byFile, byBase;
    // 1) 相对路径精确匹配（含 `/`）
    if (t.indexOf('/') !== -1) {
      rel = targets.filter(function(x) { return x.relativePath === t; });
      if (rel.length) return rel.length === 1 ? rel[0] : rel;
    }
    // 2) fileName 精确匹配（含扩展名）
    byFile = targets.filter(function(x) { return x.fileName === t; });
    if (byFile.length) return byFile.length === 1 ? byFile[0] : byFile;
    // 3) basename 匹配 → 就近优先排序
    byBase = targets.filter(function(x) { return x.basename === t; });
    if (byBase.length === 0) return null;
    if (byBase.length === 1) return byBase[0];
    var currentModuleId = getModuleIdByPath(currentPath);
    byBase.sort(function(a, b) {
      var am = a.moduleId === currentModuleId ? 0 : 1;
      var bm = b.moduleId === currentModuleId ? 0 : 1;
      if (am !== bm) return am - bm;
      return a.relativePath.length - b.relativePath.length;
    });
    return byBase;
  }

  /** 打开 wikilink 目标（编辑器新标签页，通过 Electron openFileByPath） */
  async function openWikilink(target) {
    var resolved = resolveWikilink(target, state.displayPath);
    if (!resolved) {
      showToast('未找到链接目标：' + target, true);
      return;
    }
    if (Array.isArray(resolved)) {
      // 多个同名目标 → 弹出选择列表，由用户决定打开哪个
      showWikilinkPicker(resolved, target);
      return;
    }
    openWikilinkByPath(resolved);
  }

  /** 按已解析目标打开文件（共用 openWikilink 的打开逻辑） */
  async function openWikilinkByPath(resolved) {
    var api = getElectronAPI();
    if (!api || !api.openFileByPath || !resolved.absolutePath) {
      showToast('双链跳转仅桌面模式可用', true);
      return;
    }
    try {
      var result = await api.openFileByPath(resolved.absolutePath);
      if (result && !result.canceled) {
        openFileDataInNewTab(result);
      } else {
        showToast('无法打开目标：' + resolved.basename, true);
      }
    } catch (e) {
      showToast('打开目标失败：' + (e.message || '未知错误'), true);
    }
  }

  /** 同名目标选择弹窗：多个目标命中时展示列表（含相对路径），点击打开对应文件 */
  function showWikilinkPicker(candidates, target) {
    var modal = elements.wikilinkPickerModal;
    var listEl = elements.wikilinkPickerList;
    if (!modal || !listEl || !candidates || !candidates.length) return;
    if (elements.wikilinkPickerHint) {
      elements.wikilinkPickerHint.textContent = '「' + target + '」存在 ' + candidates.length + ' 个同名目标，请选择要打开的文件';
    }
    listEl.innerHTML = '';
    candidates.forEach(function(c) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'wikilink-picker-item';
      var nameEl = document.createElement('span');
      nameEl.className = 'wlp-name';
      nameEl.textContent = c.fileName || c.basename;
      var pathEl = document.createElement('span');
      pathEl.className = 'wlp-path';
      pathEl.textContent = (c.moduleName || c.moduleId || '') + '/' + (c.relativePath || c.fileName);
      item.appendChild(nameEl);
      item.appendChild(pathEl);
      item.addEventListener('click', function() {
        closeModal(modal);
        openWikilinkByPath(c);
      });
      listEl.appendChild(item);
    });
    openModal(modal);
  }

  /** 标注预览区双链命中/缺失状态 */
  function markWikilinkStatus() {
    if (!elements.markdownBody) return;
    var links = elements.markdownBody.querySelectorAll('a.wikilink');
    for (var i = 0; i < links.length; i++) {
      var target = links[i].getAttribute('data-target');
      links[i].classList.toggle('wikilink-missing', !resolveWikilink(target, state.displayPath));
    }
  }

  /** 注册双链补全：`[[` 前缀触发，候选来自链接索引 */
  function registerWikilinkCompleter() {
    if (!mainEditor) return;
    var langTools = null;
    try {
      langTools = ace.require('ace/ext/language_tools');
    } catch (e) { return; }
    if (!langTools) return;

    // 移除旧的 completer（如果有）
    if (registeredWikilinkCompleter) {
      var completers = mainEditor.completers || [];
      var idx = completers.indexOf(registeredWikilinkCompleter);
      if (idx !== -1) completers.splice(idx, 1);
    }

    var completer = {
      // 关键：必须是“单字符”匹配正则。ACE 会逐字符回溯检测前缀，
      // 多字符的 `\[\[...` 会导致单个 `[` 无法匹配，getCompletionPrefix 返回空串，
      // 进而 live autocomplete 不触发、本 completer 的 getCompletions 也不会被调用。
      identifierRegexps: [/\[[a-zA-Z0-9\u4e00-\u9fff._\/\-]*/],
      getCompletions: function(editor, session, pos, prefix, callback) {
        // 以光标所在行实时判断是否处于 `[[` 上下文（比 prefix 更可靠，
        // 因为 prefix 由 ACE 按 identifierRegexps 逐字符回溯得出，可能不完整）。
        var line = session.getLine(pos.row).slice(0, pos.column);
        var m = line.match(/\[\[([^\[\]]*)$/);
        if (!m) { callback(null, []); return; }
        var qlower = (m[1] || '').toLowerCase();
        var results = [];
        var rows = ensureWikilinkMatchCache().rows || [];
        var seen = {};
        var MAX = 30; // 结果上限：防止目标量大时下拉框/排序开销过大（性能）
        for (var j = 0; j < rows.length && results.length < MAX; j++) {
          var row = rows[j];
          if (!row || seen[row.label]) continue; // 同名/同 label 只补一个
          // 前向模糊评分：label 权重最高，其次全文 hay（basename+fileName+相对路径）
          var bSc = fuzzyScore(qlower, row.label);
          var hSc = fuzzyScore(qlower, row.hay);
          if (qlower && bSc < 0 && hSc < 0) continue;
          seen[row.label] = true;
          var score = bSc >= 0 ? 1000 + bSc : 500 + hSc;
          results.push({
            // caption 需包含 `[[` 前缀，否则会被 ACE 的 setFilter 过滤掉
            caption: '[[' + row.label + ']]',
            // value 必须保留 `[[` 前缀：当前 identifierRegexps 回溯出的前缀含 `[[`，
            // ACE 会整体替换该前缀（如 `[[xx` → `[[label]]`）。若 value 去掉 `[[`，
            // 替换后两根 `[[` 会被吞掉，得到 `label]]`。
            value: '[[' + row.label + ']]',
            meta: row.meta,
            score: score
          });
          // 同名冲突 → 额外给出 [[相对路径]] 精确候选用于歧义消除
          if (row.nameCount > 1 && row.t.relativePath && row.t.relativePath.indexOf('/') !== -1) {
            results.push({
              caption: '[[' + row.t.relativePath + ']]',
              value: '[[' + row.t.relativePath + ']]',
              meta: (row.t.moduleName || row.t.moduleId || '') + ' 精确路径',
              score: 900
            });
          }
        }
        results.sort(function(a, b) { return b.score - a.score; });
        callback(null, results.slice(0, MAX));
      }
    };

    registeredWikilinkCompleter = completer;
    if (langTools.addCompleter) {
      langTools.addCompleter(completer);
    } else if (mainEditor.completers) {
      mainEditor.completers.push(completer);
    }
  }

  // ── 双向链接预计算缓存：每个目标归一化一次 label / 检索 hay / 同名冲突数，
  //    供 ACE completer 与自定义插值器复用，避免每次击键对全量 targets 重复扫描（性能）──
  function rebuildWikilinkMatchCache() {
    var targets = wikilinkState.targets || [];
    var nameCounts = {};
    for (var i = 0; i < targets.length; i++) {
      var fn = targets[i].fileName || targets[i].basename;
      nameCounts[fn + '\u0000' + (/\.(md|mdown|markdown)$/i.test(fn) ? 'md' : 'raw')] = (nameCounts[fn + '\u0000' + (/\.(md|mdown|markdown)$/i.test(fn) ? 'md' : 'raw')] || 0) + 1;
    }
    var rows = [];
    for (var j = 0; j < targets.length; j++) {
      var t = targets[j];
      var fn2 = t.fileName || t.basename;
      var isMd = /\.(md|mdown|markdown)$/i.test(fn2);
      var label = isMd ? t.basename : fn2;                    // md 用 basename（Obsidian 原生），非 md 用含扩展名文件名消歧
      var countKey = fn2 + '\u0000' + (isMd ? 'md' : 'raw');
      rows.push({
        t: t,
        fn: fn2,
        label: label,
        isMd: isMd,
        nameCount: nameCounts[countKey] || 1,
        hay: (fn2 + ' ' + (t.basename || '') + ' ' + (t.relativePath || '')).toLowerCase(),
        meta: (t.moduleName || t.moduleId || '') + '/' + (t.relativePath || '')
      });
    }
    return rows;
  }
  function ensureWikilinkMatchCache() {
    if (!wikilinkMatchCache || !wikilinkMatchCache.rows) {
      wikilinkMatchCache = { rows: rebuildWikilinkMatchCache() };
    }
    return wikilinkMatchCache;
  }

  /** 主动唤起 ACE 实时自动补全（[[ 已就位时弹出模糊列表） */
  function triggerAceAutocomplete() {
    try { mainEditor.execCommand('startAutocomplete'); } catch (e) { /* 忽略：非致命 */ }
  }

  /**
   * 在锚点处插入双向链接骨架 `[[]]`，光标置于括号中间并唤起模糊补全列表。
   * anchorPos：插入基准位置（默认当前光标）。若光标已在 `[[` 之后则不再重复包裹，直接唤起补全。
   */
  function insertWikilinkAtCursor(anchorPos) {
    if (!mainEditor) return;
    var ensureLoaded = function() {
      if (wikilinkState.loaded) { doInsertWikilink(anchorPos); return; }
      buildLinkIndex().then(function() { doInsertWikilink(anchorPos); }).catch(function() { doInsertWikilink(anchorPos); });
    };
    ensureLoaded();
  }

  function doInsertWikilink(anchorPos) {
    if (!mainEditor) return;
    var pos = anchorPos || mainEditor.getCursorPosition();
    var line = mainEditor.session.getLine(pos.row);
    // 已处于 [[ 后的链接输入态：直接唤起补全，不重复插入括号
    if (/\[\[[^\[\]\n]*$/.test(line.slice(0, pos.column))) {
      mainEditor.moveCursorTo(pos.row, pos.column);
      mainEditor.focus();
      triggerAceAutocomplete();
      return;
    }
    // 插入 [[ ]] 骨架，光标置于中间（[[|]]）
    mainEditor.session.insert(pos, '[[]]');
    mainEditor.moveCursorTo(pos.row, pos.column + 2);
    mainEditor.focus();
    triggerAceAutocomplete();
  }

  /** 右键菜单「插入双向链接」入口 / 其它命令调用 */
  async function insertWikilinkFromCommand() {
    if (!wikilinkState.loaded) {
      try { await buildLinkIndex(); } catch (e) { /* 索引加载失败仍允许插入骨架 */ }
    }
    doInsertWikilink(null);
  }

  /** 更新双向链接 tab 数量徽标（0 / null → 隐藏） */
  function setLinkTabCount(tab, count) {
    var el = tab === 'outgoing' ? elements.tabOutgoingCount : elements.tabBacklinksCount;
    if (!el) return;
    if (typeof count === 'number' && count > 0) {
      el.textContent = count;
      el.hidden = false;
    } else {
      el.textContent = '';
      el.hidden = true;
    }
  }

  /** 构建反链表：聚合各模块引用来源（含模块标签，点击直达精确文件，标题显示真实文件名） */
  async function buildBacklinks() {
    var listEl = elements.backlinksList;
    if (!listEl) return;
    var fileName = getCurrentFileName();
    if (elements.backlinksPaneTitle) {
      elements.backlinksPaneTitle.textContent = fileName || '双向链接';
      elements.backlinksPaneTitle.title = state.displayPath || fileName || '';
    }
    if (!fileName) {
      listEl.innerHTML = '<div class="backlinks-empty"><strong>当前文档尚未命名</strong><span>保存后再查看反链</span></div>';
      setLinkTabCount('backlinks', null);
      return;
    }
    var api = getElectronAPI();
    if (!api || !api.findBacklinks) {
      listEl.innerHTML = '<div class="backlinks-empty"><strong>反链扫描仅桌面模式可用</strong></div>';
      setLinkTabCount('backlinks', null);
      return;
    }
    listEl.innerHTML = '<div class="backlinks-empty"><span class="backlinks-loading"></span><span>正在扫描…</span></div>';
    setLinkTabCount('backlinks', null);
    try {
      var res = await api.findBacklinks(state.displayPath);
      // 后端扫描异常（读文件失败等）不再误报为“暂无引用”，展示真实原因便于排查
      if (res && res.message) {
        listEl.innerHTML = '<div class="backlinks-empty backlinks-error"><strong>扫描失败</strong><span>' + escapeHtml(res.message) + '</span></div>';
        setLinkTabCount('backlinks', null);
        return;
      }
      var items = (res && res.backlinks) || [];
      if (!items.length) {
        listEl.innerHTML = '<div class="backlinks-empty"><span class="backlinks-empty-dot"></span><strong>暂无文档引用</strong><span>在其它笔记中写入 <code>[[' + escapeHtml(getCurrentBasename()) + ']]</code> 即可在此显示关联</span></div>';
        setLinkTabCount('backlinks', 0);
        return;
      }
      setLinkTabCount('backlinks', items.length);
      listEl.innerHTML = '';
      // 精确高亮：匹配当前文件 basename / fileName（含扩展名）/ 相对路径 的双链（可带别名）
      var hlKeys = [getCurrentFileName(), getCurrentBasename()].filter(Boolean);
      var hlRe = new RegExp('(\\[\\[' + hlKeys.map(escapeRegExp).join('|') + '(?:\\|[^\\]]*)?\\]\\])', 'gi');
      items.forEach(function(b) {
        var item = document.createElement('div');
        item.className = 'backlinks-item';
        item.setAttribute('role', 'button');
        item.title = (b.moduleName ? b.moduleName + '/' : '') + (b.relativePath || b.fileName);
        var nameRow = document.createElement('div');
        nameRow.className = 'bl-name-row';
        var nameEl = document.createElement('span');
        nameEl.className = 'bl-name';
        nameEl.textContent = b.fileName || b.basename;
        nameRow.appendChild(nameEl);
        if (b.moduleName) {
          var modEl = document.createElement('span');
          modEl.className = 'bl-module';
          modEl.textContent = b.moduleName;
          nameRow.appendChild(modEl);
        }
        item.appendChild(nameRow);
        var pathEl = document.createElement('div');
        pathEl.className = 'bl-path';
        pathEl.textContent = b.relativePath || b.fileName;
        item.appendChild(pathEl);
        (b.matches || []).slice(0, 3).forEach(function(m) {
          var lineEl = document.createElement('div');
          lineEl.className = 'bl-line';
          var text = escapeHtml(m.text || '');
          text = text.replace(hlRe, '<span class="bl-hl">$1</span>');
          lineEl.innerHTML = '<span class="bl-ln">' + (m.lineNumber || 0) + '</span><span class="bl-text">' + text + '</span>';
          item.appendChild(lineEl);
        });
        // 直接按反链条目携带的 absolutePath 打开，避免同名误判/误弹选择框
        item.addEventListener('click', function() {
          openWikilinkByPath(b);
        });
        listEl.appendChild(item);
      });
    } catch (e) {
      listEl.innerHTML = '<div class="backlinks-empty backlinks-error"><strong>扫描失败</strong><span>' + escapeHtml(e.message || '未知错误') + '</span></div>';
      setLinkTabCount('backlinks', null);
    }
  }

  /** 构建出链表：解析当前文件内所有 [[链接]]，展示目标解析结果与断链状态 */
  async function buildOutgoing() {
    var listEl = elements.outgoingList;
    if (!listEl) return;
    var currentPath = state.displayPath;
    if (!currentPath) {
      listEl.innerHTML = '<div class="outgoing-empty"><strong>当前文档尚未保存</strong><span>保存后再查看出链</span></div>';
      setLinkTabCount('outgoing', null);
      return;
    }
    var api = getElectronAPI();
    if (!api || !api.findOutgoing) {
      listEl.innerHTML = '<div class="outgoing-empty"><strong>出链扫描仅桌面模式可用</strong></div>';
      setLinkTabCount('outgoing', null);
      return;
    }
    listEl.innerHTML = '<div class="outgoing-empty"><span class="backlinks-loading"></span><span>正在扫描…</span></div>';
    setLinkTabCount('outgoing', null);
    try {
      var res = await api.findOutgoing(currentPath);
      if (res && res.message) {
        listEl.innerHTML = '<div class="outgoing-empty outgoing-error"><strong>扫描失败</strong><span>' + escapeHtml(res.message) + '</span></div>';
        setLinkTabCount('outgoing', null);
        return;
      }
      var items = (res && res.outgoing) || [];
      if (!items.length) {
        listEl.innerHTML = '<div class="outgoing-empty"><span class="backlinks-empty-dot"></span><strong>暂无出链</strong><span>在当前笔记中写入 <code>[[目标]]</code> 即可在此显示关联</span></div>';
        setLinkTabCount('outgoing', 0);
        return;
      }
      setLinkTabCount('outgoing', items.length);
      listEl.innerHTML = '';
      items.forEach(function(item) {
        var rowEl = document.createElement('div');
        rowEl.className = 'outgoing-item' + (item.missing ? ' wikilink-missing' : '');
        rowEl.setAttribute('role', 'button');
        var linkEl = document.createElement('span');
        linkEl.className = 'ol-link';
        linkEl.textContent = '[[' + item.target + ']]';
        rowEl.appendChild(linkEl);
        if (item.resolved) {
          var pathEl = document.createElement('span');
          pathEl.className = 'ol-path';
          pathEl.textContent = item.resolved.moduleName + '/' + item.resolved.relativePath;
          rowEl.appendChild(pathEl);
          rowEl.addEventListener('click', function() {
            openWikilinkByPath(item.resolved);
          });
        } else {
          var missingEl = document.createElement('span');
          missingEl.className = 'ol-missing';
          missingEl.textContent = '未找到目标';
          rowEl.appendChild(missingEl);
        }
        listEl.appendChild(rowEl);
      });
    } catch (e) {
      listEl.innerHTML = '<div class="outgoing-empty outgoing-error"><strong>扫描失败</strong><span>' + escapeHtml(e.message || '未知错误') + '</span></div>';
      setLinkTabCount('outgoing', null);
    }
  }

  /** 切换双向链接面板 tab（反链 | 出链） */
  function switchLinkTab(tab) {
    currentLinkTab = tab === 'outgoing' ? 'outgoing' : 'backlinks';
    var isBack = currentLinkTab === 'backlinks';
    elements.tabBacklinks.classList.toggle('active', isBack);
    elements.tabOutgoing.classList.toggle('active', !isBack);
    elements.tabBacklinks.setAttribute('aria-selected', String(isBack));
    elements.tabOutgoing.setAttribute('aria-selected', String(!isBack));
    elements.backlinksList.style.display = isBack ? 'block' : 'none';
    elements.outgoingList.style.display = isBack ? 'none' : 'block';
    if (backlinksVisible) {
      if (isBack) buildBacklinks(); else buildOutgoing();
    }
  }

  // 反链/知识库面板开关（与文件树/历史/最近/收藏抽屉互斥）
  var backlinksVisible = false;
  function toggleBacklinks(forceOpen) {
    // 非全屏 Markdown 预览下禁用反链抽屉：此态网格已固定为 1fr 1fr 两列，打开只会
    // 留下空白列（pane 被 display:none 压制）。仅 markdown-fullscreen 悬浮层允许唤醒。
    if (elements.editorWorkspace.classList.contains('markdown-preview')
        && !elements.editorWorkspace.classList.contains('markdown-fullscreen')) {
      return;
    }
    backlinksVisible = forceOpen !== undefined ? forceOpen : !backlinksVisible;
    elements.backlinksPane.setAttribute('aria-hidden', String(!backlinksVisible));
    elements.editorWorkspace.classList.toggle('show-backlinks', backlinksVisible);
    if (backlinksBtn) backlinksBtn.classList.toggle('active', backlinksVisible);
    if (backlinksVisible) {
      // 互斥关闭其它左抽屉（含大纲/标签）
      closeOtherLeftPanes('show-backlinks');
      // 打开面板时同步刷新链接索引（走主进程缓存，开销极小），保证补全与双链数据最新
      buildLinkIndex();
      if (currentLinkTab === 'outgoing') {
        buildOutgoing();
      } else {
        buildBacklinks();
      }
    } else {
      // 关闭面板时取消待执行的自动刷新
      if (backlinksRefreshTimer) {
        clearTimeout(backlinksRefreshTimer);
        backlinksRefreshTimer = null;
      }
    }
    setTimeout(function() { mainEditor.resize(); }, 250);
  }

  // 双向链接面板自动刷新：内容/保存/切换文件变化时防抖重建（仅面板可见时执行）
  var backlinksRefreshTimer = null;
  function scheduleBacklinksRefresh() {
    if (!backlinksVisible) return;
    // A1：中文输入法组合期间暂停刷新，compositionend 后再补一次
    if (isComposing()) return;
    if (backlinksRefreshTimer) clearTimeout(backlinksRefreshTimer);
    backlinksRefreshTimer = setTimeout(function() {
      backlinksRefreshTimer = null;
      if (currentLinkTab === 'outgoing') {
        buildOutgoing();
      } else {
        buildBacklinks();
      }
    }, 400);
  }
  // 编辑内容变化 → 主页名/引用关系可能改变 → 自动刷新当前激活 tab
  mainEditor.session.on('change', scheduleBacklinksRefresh);

  // 双向链接 tab 切换
  elements.tabBacklinks.addEventListener('click', function() { switchLinkTab('backlinks'); });
  elements.tabOutgoing.addEventListener('click', function() { switchLinkTab('outgoing'); });

  // 预览区 .wikilink 点击委托
  elements.markdownBody.addEventListener('click', function(e) {
    var a = e.target && e.target.closest ? e.target.closest('a.wikilink') : null;
    if (a) {
      e.preventDefault();
      openWikilink(a.getAttribute('data-target'));
      return;
    }
    // B2：预览点击反向定位——点击正文段落/标题，在编辑区定位到对应文本
    if (featureOn('previewClickLocate') && !isComposing()) {
      if (e.target && e.target.closest && e.target.closest('a, button, img, svg, input, select, textarea, .mermaid')) return;
      var text = (e.target && e.target.textContent || '').trim();
      if (!text) return;
      locateInEditor(text);
    }
  });

  // B2 辅助：在编辑区查找文本并定位（找不到则静默）
  function locateInEditor(text) {
    var needle = text.slice(0, 60);
    if (!needle) return;
    var range;
    try {
      range = mainEditor.session.find(needle, {
        backwards: false, wrap: true, caseSensitive: false, wholeWord: false, regExp: false
      });
    } catch (err) { return; }
    if (range) {
      mainEditor.selection.setSelectionRange(range);
      mainEditor.renderer.scrollCursorIntoView(range.start, 0.5);
      mainEditor.focus();
    }
  }

  // 反链面板按钮 + 存入知识库
  elements.closeBacklinksBtn.addEventListener('click', function() { toggleBacklinks(false); });
  elements.saveToVaultBtn.addEventListener('click', async function() {
    var api = getElectronAPI();
    if (!api || !api.saveToVault) {
      showToast('存入知识库仅桌面模式可用', true);
      return;
    }
    var base = getCurrentBasename() || '未命名';
    var res = await api.saveToVault({ text: mainEditor.getValue(), basename: base });
    if (res && res.success) {
      showToast('已存入知识库 notes/' + base + '.md', false, 'success');
      buildLinkIndex();
      markWikilinkStatus();
      scheduleBacklinksRefresh();
    } else {
      showToast('存入失败：' + ((res && res.message) || '未知错误'), true);
    }
  });

  // 状态栏「反链」按钮（在文件树按钮旁）
  var backlinksBtn = createStatusBtn('反链', '🔗', '双链反链面板', EditorShortcuts.get('backlinks'));
  registerShortcutButton('backlinks', backlinksBtn, '双链反链面板');
  backlinksBtn.addEventListener('click', function() { toggleBacklinks(); });
  elements.runtimeStatus.parentNode.insertBefore(backlinksBtn, elements.runtimeStatus);

  // 反链面板快捷键（默认 Ctrl/Cmd+Shift+B，可在系统设置中修改）；由 EditorShortcuts 捕获阶段统一分发
  EditorShortcuts.registerHandler('backlinks', function() { toggleBacklinks(); });

  // 初始化：同步双向链接 tab 初始显示态 + 构建双链索引 + 注册补全（延迟到编辑器就绪）
  switchLinkTab('backlinks');
  buildLinkIndex();
  setTimeout(registerWikilinkCompleter, 600);

  // ══════════════════════════════════════════════════════════════
  // 前端四件套：大纲(Outline) / 标签(#tag) / 命令面板(Ctrl+P) / 模板
  // ══════════════════════════════════════════════════════════════

  // ── 左抽屉互斥通用辅助：关闭除 target 外的所有左抽屉 ──
  function closeOtherLeftPanes(keepClass) {
    var panes = [
      { pane: elements.fileTreePane, cls: 'show-filetree', btn: fileTreeBtn },
      { pane: elements.historyPane, cls: 'show-history', btn: historyBtn },
      { pane: elements.recentPane, cls: 'show-recent', btn: recentBtn },
      { pane: elements.favPane, cls: 'show-fav', btn: favBtn },
      { pane: elements.backlinksPane, cls: 'show-backlinks', btn: backlinksBtn },
      { pane: elements.outlinePane, cls: 'show-outline', btn: outlineBtn },
      { pane: elements.tagsPane, cls: 'show-tags', btn: tagsBtn }
    ];
    panes.forEach(function(p) {
      if (p.cls === keepClass) return;
      if (p.pane) p.pane.setAttribute('aria-hidden', 'true');
      if (p.btn) p.btn.classList.remove('active');
      if (elements.editorWorkspace.classList.contains(p.cls)) {
        elements.editorWorkspace.classList.remove(p.cls);
      }
    });
    // 同步重置被关闭抽屉的状态标志，确保再次点击时能正确切换
    if (keepClass !== 'show-filetree') {
      fileTreeOpen = false;
      // 文件树被其它抽屉互斥关闭时，同样清理面包屑一次性会话缓存
      if (fileTreeDirSource === 'breadcrumb') {
        fileTreeDir = null;
        fileTreeDirSource = null;
      }
    }
    if (keepClass !== 'show-backlinks') backlinksVisible = false;
    if (keepClass !== 'show-outline') outlineVisible = false;
    if (keepClass !== 'show-tags') tagsVisible = false;
  }

  // ── 大纲面板 ──
  var outlineVisible = false;
  var outlineData = [];

  function toggleOutline(forceOpen) {
    outlineVisible = forceOpen !== undefined ? forceOpen : !outlineVisible;
    elements.outlinePane.setAttribute('aria-hidden', String(!outlineVisible));
    elements.editorWorkspace.classList.toggle('show-outline', outlineVisible);
    if (outlineBtn) outlineBtn.classList.toggle('active', outlineVisible);
    if (outlineVisible) {
      closeOtherLeftPanes('show-outline');
      buildOutline();
    } else {
      // 关闭时清空搜索词，避免下次打开残留过滤
      clearOutlineSearch();
    }
    setTimeout(function() { mainEditor.resize(); }, 250);
  }

  // 清空大纲搜索输入并重渲（关闭面板时调用）
  function clearOutlineSearch() {
    if (elements.outlineSearchInput && elements.outlineSearchInput.value) {
      elements.outlineSearchInput.value = '';
    }
  }

  // 解析 Markdown 标题：行首 0-3 空格 + 1-6 个 #，兼容 `# 标题` 与 `#标题`（Obsidian）
  // 用 `(?:\s+)?` 允许 # 后无空格，用 `[^\s#]` 排除空标题 / 纯 # 行 / 嵌套 ## 歧义
  var OUTLINE_HEADING_RE = /^(\s{0,3})(#{1,6})(?:\s+)?([^\s#][^\n]*)$/;
  function buildOutline() {
    var text = mainEditor.getValue();
    var lines = text.split('\n');
    var title = getCurrentFileName() || (elements.documentName ? elements.documentName.textContent : '') || '未命名';
    outlineData = [{ level: 1, text: title, line: 0, isTitle: true }];
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(OUTLINE_HEADING_RE);
      if (!m) continue;
      outlineData.push({ level: m[2].length, text: m[3].trim(), line: i });
    }
    renderOutline();
  }

  function renderOutline() {
    var list = elements.outlineList;
    // 大纲搜索：按标题文本过滤（文档标题始终保留）
    var filter = (elements.outlineSearchInput && elements.outlineSearchInput.value || '').trim().toLowerCase();
    var renderList = outlineData;
    if (filter) {
      renderList = outlineData.filter(function(item) {
        return item.isTitle || item.text.toLowerCase().indexOf(filter) !== -1;
      });
    }
    if (!renderList.length) {
      list.innerHTML = '<div class="outline-empty">' + (filter ? '未找到匹配的标题' : '暂无标题') + '</div>';
      return;
    }
    list.innerHTML = '';
    // Phase 3：DocumentFragment 批量构造，避免逐项 append 触发布局
    var outlineFrag = document.createDocumentFragment();
    renderList.forEach(function(item) {
      var origIdx = outlineData.indexOf(item);
      var row = document.createElement('div');
      row.className = 'outline-item' + (item.isTitle ? ' outline-title' : '');
      row.style.paddingLeft = (item.level - 1) * 16 + 'px';
      row.dataset.line = String(item.line);
      row.dataset.level = String(item.level);
      row.dataset.idx = String(origIdx);
      // 标题层级用 H1/H2/H3 徽章（非原生 # 号）标识，文本按层级以标题字号渲染
      row.innerHTML = (item.isTitle
          ? '<span class="outline-marker outline-marker-title">◉</span>'
          : '<span class="outline-marker outline-marker-level">H' + item.level + '</span>')
        + '<span class="outline-label">' + escapeHtml(item.text) + '</span>'
        + '<span class="outline-line">' + (item.isTitle ? '文首' : 'L' + (item.line + 1)) + '</span>';
      row.title = item.isTitle ? '文档标题' : '跳转到第 ' + (item.line + 1) + ' 行';
      row.addEventListener('click', function() {
        // 全屏预览下编辑器隐藏，改为滚动 markdown 预览对应标题
        if (elements.editorWorkspace.classList.contains('markdown-fullscreen')
            && elements.editorWorkspace.classList.contains('markdown-preview')) {
          jumpMarkdownHeading(parseInt(this.dataset.idx, 10));
        } else {
          goToLine(parseInt(this.dataset.line, 10));
        }
        highlightOutlineRow(this);
      });
      // Phase 1：大纲 hover 悬浮提示（仅大纲增强开关开启时，展示行号 + 该行内容预览）
      if (featureOn('outlineEnhance')) {
        row.addEventListener('mouseenter', function() { showOutlineHoverTip(this); });
        row.addEventListener('mousemove', function(e) { moveOutlineHoverTip(e); });
        row.addEventListener('mouseleave', hideOutlineHoverTip);
      }
      outlineFrag.appendChild(row);
    });
    list.appendChild(outlineFrag);
  }

  // Phase 1：大纲 hover 悬浮提示实现（独立元素，关闭开关即不创建/不显示）
  var outlineTipEl = null;
  function ensureOutlineTipEl() {
    if (outlineTipEl) return outlineTipEl;
    outlineTipEl = document.createElement('div');
    outlineTipEl.className = 'outline-hover-tip';
    outlineTipEl.hidden = true;
    (elements.outlinePane || document.body).appendChild(outlineTipEl);
    return outlineTipEl;
  }
  function showOutlineHoverTip(row) {
    if (!featureOn('outlineEnhance')) return;
    var tip = ensureOutlineTipEl();
    tip.hidden = false;
    var line = parseInt(row.dataset.line, 10);
    var preview = '';
    try {
      var raw = mainEditor.session.getLine(line);
      preview = (raw || '').replace(/^#+\s*/, '').trim().slice(0, 60);
    } catch (e) { /* 读取失败不展示预览 */ }
    tip.innerHTML = '';
    var lineSpan = document.createElement('span');
    lineSpan.className = 'outline-hover-line';
    lineSpan.textContent = String(line + 1);
    tip.appendChild(lineSpan);
    if (preview) {
      var textSpan = document.createElement('span');
      textSpan.className = 'outline-hover-text';
      textSpan.textContent = preview;
      tip.appendChild(textSpan);
    }
  }
  function moveOutlineHoverTip(e) {
    if (!featureOn('outlineEnhance') || !outlineTipEl || outlineTipEl.hidden) return;
    outlineTipEl.style.left = (e.clientX + 10) + 'px';
    outlineTipEl.style.top = (e.clientY + 12) + 'px';
  }
  function hideOutlineHoverTip() {
    if (outlineTipEl) { outlineTipEl.hidden = true; }
  }

  function highlightOutlineRow(row) {
    var rows = elements.outlineList.querySelectorAll('.outline-item.active');
    rows.forEach(function(r) { r.classList.remove('active'); });
    row.classList.add('active');
  }

  function goToLine(line) {
    mainEditor.gotoLine(line + 1, 0, true);
    mainEditor.focus();
    // 滚动画布使目标行可见
    try { mainEditor.scrollToLine(line, true, true, function() {}); } catch (e) {}
  }

  // 全屏预览：定位 markdown-body 中第 nth 个标题（h1-h6）并滚动到可见。
  // outlineData 不含标题项，且与渲染标题按文档顺序一一对应，故用序号而非行号匹配。
  function jumpMarkdownHeading(idx) {
    const headings = elements.markdownBody.querySelectorAll('h1, h2, h3, h4, h5, h6');
    // outlineData 第一项恒为文档标题(文首)，渲染无对应 heading，需偏移映射
    const target = headings[idx - 1];
    if (!target) return;
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // 内容变化 → 防抖重建大纲 + 刷新标签（仅面板可见）
  var outlineTagsRefreshTimer = null;
  mainEditor.session.on('change', function() {
    if (!outlineVisible && !tagsVisible) return;
    if (outlineTagsRefreshTimer) clearTimeout(outlineTagsRefreshTimer);
    outlineTagsRefreshTimer = setTimeout(function() {
      outlineTagsRefreshTimer = null;
      if (outlineVisible) buildOutline();
      if (tagsVisible) buildTags();
    }, 300);
  });

  elements.closeOutlineBtn.addEventListener('click', function() { toggleOutline(false); });

  // 大纲搜索框：输入即过滤
  if (elements.outlineSearchInput) {
    elements.outlineSearchInput.addEventListener('input', function() {
      if (outlineVisible) renderOutline();
    });
    // Esc 清空搜索词
    elements.outlineSearchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        if (this.value) { this.value = ''; if (outlineVisible) renderOutline(); }
        else elements.outlineSearchInput.blur();
      }
    });
  }
  var outlineBtn = createStatusBtn('大纲', '☰', '文档大纲', EditorShortcuts.get('outline'));
  registerShortcutButton('outline', outlineBtn, '文档大纲');
  outlineBtn.addEventListener('click', function() { toggleOutline(); });
  elements.runtimeStatus.parentNode.insertBefore(outlineBtn, elements.runtimeStatus);

  // 全局文件搜索按钮（底部状态栏右侧，Ctrl+Shift+O）
  // 注意：createStatusBtn 会自动拼接 "(shortcut)"，title 里不要再重复写快捷键，否则悬浮提示会出现两个快捷键
  var quickSearchBtn = createStatusBtn('搜索', '🔍', '快速打开文件', EditorShortcuts.get('quickOpen'));
  registerShortcutButton('quickOpen', quickSearchBtn, '快速打开文件');
  quickSearchBtn.addEventListener('click', function() { openQuickSwitcher(); });
  // 「搜索」归入内容导航组，插在「反链」前并加分组分隔符
  var navSep = document.createElement('span');
  navSep.className = 'status-sep';
  navSep.setAttribute('aria-hidden', 'true');
  elements.runtimeStatus.parentNode.insertBefore(navSep, backlinksBtn);
  elements.runtimeStatus.parentNode.insertBefore(quickSearchBtn, backlinksBtn);

  // 大纲面板快捷键（默认 Ctrl/Cmd+Shift+D，可在系统设置中修改）；由 EditorShortcuts 捕获阶段统一分发
  EditorShortcuts.registerHandler('outline', function() { toggleOutline(); });

  // ── 标签面板 ──
  var tagsVisible = false;
  var tagsData = [];

  function toggleTags(forceOpen) {
    tagsVisible = forceOpen !== undefined ? forceOpen : !tagsVisible;
    elements.tagsPane.setAttribute('aria-hidden', String(!tagsVisible));
    elements.editorWorkspace.classList.toggle('show-tags', tagsVisible);
    if (tagsBtn) tagsBtn.classList.toggle('active', tagsVisible);
    if (tagsVisible) {
      closeOtherLeftPanes('show-tags');
      buildTags();
    }
    setTimeout(function() { mainEditor.resize(); }, 250);
  }

  // 从文本 + frontmatter tags 提取标签
  function extractTags() {
    var text = mainEditor.getValue();
    var countMap = {};
    // frontmatter tags 字段（YAML 数组或逗号分隔）
    var fm = text.match(/^---\s*\n([\s\S]*?)\n---/);
    if (fm) {
      var tagsMatch = fm[1].match(/^tags:\s*([\s\S]*?)(?=^\w|\n---)/m);
      if (tagsMatch) {
        var body = tagsMatch[1];
        body.replace(/^[\s-]+([#\w\u4e00-\u9fa5.-]+)\s*$/gm, function(_, t) {
          var tag = t.replace(/^#/, '').trim();
          if (tag) countMap[tag] = (countMap[tag] || 0) + 1;
          return '';
        });
      }
    }
    // 行内 #tag（排除 # 号开头的标题行、链接、代码块）
    var lines = text.split('\n');
    var inCode = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^```/.test(line.trim())) { inCode = !inCode; continue; }
      if (inCode) continue;
      if (/^\s{0,3}#{1,6}\s/.test(line)) continue; // 跳过标题
      var re = /(^|\s)(#([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5.-]*))/g;
      var m;
      while ((m = re.exec(line)) !== null) {
        var tag = m[3];
        if (tag) countMap[tag] = (countMap[tag] || 0) + 1;
      }
    }
    return Object.keys(countMap).map(function(k) {
      return { name: k, count: countMap[k] };
    }).sort(function(a, b) { return b.count - a.count || a.name.localeCompare(b.name); });
  }

  function buildTags() {
    tagsData = extractTags();
    var list = elements.tagsList;
    if (!tagsData.length) {
      list.innerHTML = '<div class="outline-empty">暂无标签，使用 &#35;标签 记录主题</div>';
      return;
    }
    list.innerHTML = '';
    tagsData.forEach(function(t) {
      var chip = document.createElement('div');
      chip.className = 'tag-chip';
      chip.title = '点击定位到所有 #' + t.name + ' 标签';
      chip.innerHTML = '<span class="tag-chip-name">#' + escapeHtml(t.name) + '</span>'
        + '<span class="tag-chip-count">' + t.count + '</span>';
      chip.addEventListener('click', function() { highlightTag(t.name); });
      list.appendChild(chip);
    });
  }

  // 定位并高亮文档中所有指定标签
  // 标签字符集（与 extractTags 一致）：中英文、数字、下划线、点、连字符
  var TAG_CHARS = '[\\w\\u4e00-\\u9fa5.-]';
  // Phase 4-1：已抽取到 editor-pure.js（EditorPure），此处优先委托，缺失时回退原实现。
  function tagPattern(tag) {
    if (window.EditorPure && typeof window.EditorPure.tagPattern === 'function') {
      return window.EditorPure.tagPattern(tag);
    }
    // 用否定前瞻判断标签后是否仍为标签字符，避免 \b 对中文/标点失效导致误判
    return '#(' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?!' + TAG_CHARS + ')';
  }

  function highlightTag(tag) {
    var text = mainEditor.getValue();
    var re = new RegExp(tagPattern(tag), 'g');
    var first = -1;
    var m;
    while ((m = re.exec(text)) !== null) {
      if (first === -1) first = m.index;
    }
    if (first === -1) { showToast('未找到 #' + tag, true); return; }
    goToLine(text.slice(0, first).split('\n').length - 1);
    showToast('已定位 #' + tag + ' 共 ' + countOccurrences(tag) + ' 处');
  }

  function countOccurrences(tag) {
    var text = mainEditor.getValue();
    var re = new RegExp(tagPattern(tag), 'g');
    return (text.match(re) || []).length;
  }

  elements.closeTagsBtn.addEventListener('click', function() { toggleTags(false); });
  var tagsBtn = createStatusBtn('标签', '#', '文档标签', EditorShortcuts.get('tags'));
  registerShortcutButton('tags', tagsBtn, '文档标签');
  tagsBtn.addEventListener('click', function() { toggleTags(); });
  elements.runtimeStatus.parentNode.insertBefore(tagsBtn, elements.runtimeStatus);

  // 标签面板快捷键（默认 Ctrl/Cmd+Shift+T，可在系统设置中修改）；由 EditorShortcuts 捕获阶段统一分发
  EditorShortcuts.registerHandler('tags', function() { toggleTags(); });

  // ── 命令面板(Ctrl+P) ──
  var commandRegistry = [];
  function registerCommand(id, name, icon, handler, shortcut, desc) {
    commandRegistry.push({ id: id, name: name, icon: icon, handler: handler, shortcut: shortcut || '', desc: desc || '' });
  }

  // Phase 2：包裹选区——弹出字符选择（纯 DOM 确认框，兼容 Electron contextIsolation）
  function openWrapSelectionPicker() {
    if (!featureOn('bracketPairs')) return;
    var sel = mainEditor.getSelectedText();
    if (!sel) { showToast('请先选中要包裹的文本', true); return; }
    if (document.getElementById('wrapSelPicker')) return; // 防重复
    var overlay = document.createElement('div');
    overlay.id = 'wrapSelPicker';
    overlay.className = 'modal-backdrop';
    overlay.style.cssText = 'display:flex;align-items:center;justify-content:center;z-index:10000';

    var chars = ['(', ')', '[', ']', '{', '}', '"', '\'', '`'];
    var dialog = document.createElement('div');
    dialog.className = 'modal-card';
    dialog.style.cssText = 'width:320px;padding:16px';
    dialog.innerHTML = '<div class="panel-header" style="margin-bottom:10px"><div><h2>包裹选区</h2>'
      + '<p style="font-size:12px;color:var(--app-text-muted);margin-top:4px">选择包围字符，将当前选区包裹起来</p></div></div>'
      + '<div class="wrap-chars" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px"></div>'
      + '<div class="panel-actions" style="justify-content:flex-end"><button class="tool-btn" data-x>取消</button></div>';

    var wrapBox = dialog.querySelector('.wrap-chars');
    chars.forEach(function(ch) {
      var b = document.createElement('button');
      b.className = 'tool-btn';
      b.textContent = ch;
      b.style.cssText = 'min-width:36px';
      b.addEventListener('click', function() {
        wrapSelectionWith(ch);
        closeWrapPicker();
      });
      wrapBox.appendChild(b);
    });

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    function closeWrapPicker() {
      var el = document.getElementById('wrapSelPicker');
      if (el) el.parentNode.removeChild(el);
    }
    overlay.addEventListener('mousedown', function(e) { if (e.target === overlay) closeWrapPicker(); });
    dialog.querySelector('[data-x]').addEventListener('click', closeWrapPicker);
  }

  function wrapSelectionWith(ch) {
    var sel = mainEditor.getSelectedText();
    if (!sel) return;
    var pairs = { '(': ')', '[': ']', '{': '}', '"': '"', '\'': '\'', '`': '`' };
    var closeChar = pairs[ch] || ch;
    var range = mainEditor.getSelectionRange();
    // 若选区已包含包围字符则不重复包裹
    if (sel.length >= 2 && sel[0] === ch && sel[sel.length - 1] === closeChar) return;
    mainEditor.session.replace(range, ch + sel + closeChar);
    mainEditor.focus();
  }

  // 设置弹窗统一入口（从设置按钮事件中提取）
  function openSettingsModal() {
    switchSettingsTab('basic');
    const currentSize = parseInt(mainEditor.getFontSize(), 10) || 13;
    elements.fontSizeSlider.value = String(currentSize);
    elements.fontSizeLabel.textContent = currentSize + 'px';
    elements.tabSizeSelect.value = String(mainEditor.session.getTabSize() || 2);
    openModal(elements.settingsModal);
  }

  // 注册核心命令
  registerCommand('new', '新建文件', '📄', function() { createNewTab(); }, 'Ctrl+T');
  registerCommand('open', '打开文件…', '📁', function() { openMainFile(); });
  registerCommand('quick-open', '快速打开文件', '🔍', function() { openQuickSwitcher(); }, EditorShortcuts.get('quickOpen'));
  registerCommand('save', '保存', '💾', function() { saveFile(false); }, 'Ctrl+S');
  registerCommand('save-as', '另存为…', '📋', function() { saveFile(true); }, 'Ctrl+Shift+S');
  registerCommand('outline', '切换大纲面板', '☰', function() { toggleOutline(); }, EditorShortcuts.get('outline'));
  registerCommand('tags', '切换标签面板', '#', function() { toggleTags(); }, EditorShortcuts.get('tags'));
  registerCommand('backlinks', '切换反链面板', '🔗', function() { toggleBacklinks(); }, EditorShortcuts.get('backlinks'));
  registerCommand('compare', '对比模式', '⇄', function() { toggleCompare(); });
  registerCommand('markdown', 'Markdown 预览', '👁', function() { toggleMarkdownPreview(); }, 'Ctrl+Shift+M');
  registerCommand('export-markdown', '导出为 Markdown (.md)', '📃', function() { exportToMarkdown(); });
  registerCommand('export-word', '导出为 Word (.docx)', '📝', function() { exportToWord(); });
  registerCommand('export-pdf', '导出为 PDF (.pdf)', '📄', function() { exportToPdf(); });
  registerCommand('settings', '编辑器设置', '⚙', function() { openSettingsModal(); }, 'Ctrl+,');
  registerCommand('pos-back', '返回上一编辑位置', '↶', function() { jumpPosHistoryBack(); }, 'Ctrl+Alt+ArrowLeft');
  registerCommand('pos-forward', '前进到下一编辑位置', '↷', function() { jumpPosHistoryForward(); }, 'Ctrl+Alt+ArrowRight');
  registerCommand('wrap-selection', '包裹选区 ( \' [ { ` " )', '⤾', function() { openWrapSelectionPicker(); });

  // ═══ IDEA 式多光标命令（Alt+J / Alt+Shift+J / Ctrl+Alt+J / Alt+W / Alt+Shift+W /
  //      Ctrl+Shift+U 大小写 / Ctrl+Shift+K 删行 / Esc 收起多光标）═══
  // 键位读 EditorAceShortcuts（速查弹窗可改键）；与上方 altj*/altw* 辅助函数配套。
  // 单一绑定机制：仅走 ACE 命令管理器 bindKey（应用未打包键盘处理器模块，Ace 为唯一实际模式）。
  // 注册前显式解除 ACE 内置同键命令（findprevious=Ctrl+Shift+K / tolowercase=Ctrl+Shift+U）
  // 的键位绑定，避免 "Repeated keybinding" 警告与隐式覆盖依赖。
  (function initAltJCommands() {
    if (!mainEditor || !mainEditor.commands) return;
    var EAS = window.EditorAceShortcuts || null;
    function aceBind(combo) {
      // 'Ctrl+Alt+J' → 'Ctrl-Alt-J'；mac: Ctrl+ → Cmd+
      var win = String(combo).split('+').join('-');
      var mac = String(combo).replace(/^Ctrl\+/i, 'Cmd+').split('+').join('-');
      return { win: win, mac: mac, sender: 'editor' };
    }
    // 释放 ACE 内置同键命令的 bindKey（命令本体保留：搜索框按钮等仍可 exec）
    ['findprevious', 'tolowercase'].forEach(function (name) {
      try {
        var cmds = mainEditor.commands;
        var cmd = cmds && cmds.byName && cmds.byName[name];
        if (!cmd || !cmd.bindKey) return;
        cmds.removeCommand(cmd);
        cmd.bindKey = {};
        cmds.addCommand(cmd, true);
      } catch (e) { /* 忽略：解绑失败不影响新增命令 */ }
    });
    var getBind = function (id, fallback) {
      var combo = EAS ? EAS.get(id) : '';
      return combo || fallback;
    };
    // 8 个可配置命令（Esc 收起多光标固定不可配置）
    var defs = [
      { name: 'selectNextOccurrence',       bind: aceBind(getBind('selectNextOccurrence', 'Alt+J')),       exec: altjSelectNext },
      { name: 'unselectPreviousOccurrence', bind: aceBind(getBind('unselectPreviousOccurrence', 'Alt+Shift+J')), exec: altjUnselectPrev },
      { name: 'selectAllOccurrences',       bind: aceBind(getBind('selectAllOccurrences', 'Ctrl+Alt+J')),  exec: altjSelectAll },
      { name: 'expandSmartSelection',       bind: aceBind(getBind('expandSmartSelection', 'Alt+W')),       exec: altwSmartSelect },
      { name: 'shrinkSmartSelection',       bind: aceBind(getBind('shrinkSmartSelection', 'Alt+Shift+W')), exec: altwShrinkSelection },
      { name: 'toggleCase',                 bind: aceBind(getBind('toggleCase', 'Ctrl+Shift+U')),
        multiSelectAction: 'forEach',
        exec: function (editor) {
          var sel = editor.selection;
          var ranges = sel.getAllRanges();
          ranges.forEach(function (r) {
            if (r.isEmpty()) return; // 无选区跳过
            editor.session.replace(r, toggleCaseText(editor.session.getTextRange(r)));
          });
        } },
      { name: 'deleteLine',                 bind: aceBind(getBind('deleteLine', 'Ctrl+Shift+K')),
        multiSelectAction: 'forEachLine',
        exec: function (editor) { editor.removeLines(); } },
      { name: 'collapseMultiCursor', bind: { win: 'Esc', mac: 'Esc', sender: 'editor' },
        exec: function (editor) {
          // 仅多光标时收起为单光标；单光标时让位，不拦截 Esc 的其它用途
          var sel = editor && editor.selection;
          if (!sel) return;
          try { if (sel.getAllRanges().length > 1) sel.toSingleRange(); } catch (e) { /* 忽略 */ }
        } }
    ];
    defs.forEach(function (d) {
      try {
        mainEditor.commands.addCommand({
          name: d.name,
          bindKey: d.bind,
          exec: d.exec,
          multiSelectAction: d.multiSelectAction
        });
      } catch (e) { /* 单条绑定失败不影响其它命令 */ }
    });
  })();

  /** 弹窗改键后调用：按存储值重绑 7 个 aceOnly 命令（removeCommand → 改 bindKey → addCommand） */
  function applyAceShortcutOverrides() {
    if (!mainEditor || !mainEditor.commands) return;
    var EAS = window.EditorAceShortcuts;
    if (!EAS) return;
    var rebinds = {
      selectNextOccurrence: altjSelectNext,
      unselectPreviousOccurrence: altjUnselectPrev,
      selectAllOccurrences: altjSelectAll,
      expandSmartSelection: altwSmartSelect,
      shrinkSmartSelection: altwShrinkSelection
    };
    var comboToAce = function (combo) {
      var win = String(combo).split('+').join('-');
      var mac = String(combo).replace(/^Ctrl\+/i, 'Cmd+').split('+').join('-');
      return { win: win, mac: mac, sender: 'editor' };
    };
    Object.keys(rebinds).forEach(function (id) {
      var combo = EAS.get(id);
      if (!combo) return;
      try {
        var cmds = mainEditor.commands;
        var cmd = cmds && cmds.byName && cmds.byName[id];
        if (!cmd) return;
        cmds.removeCommand(cmd);
        cmd.bindKey = comboToAce(combo);
        cmds.addCommand(cmd, true);
      } catch (e) { /* 忽略 */ }
    });
    // toggleCase / deleteLine 带 multiSelectAction，单独重绑
    try {
      var cmds2 = mainEditor.commands;
      var tc = cmds2 && cmds2.byName && cmds2.byName['toggleCase'];
      if (tc) {
        cmds2.removeCommand(tc);
        tc.bindKey = comboToAce(EAS.get('toggleCase'));
        cmds2.addCommand(tc, true);
      }
      var dl = cmds2 && cmds2.byName && cmds2.byName['deleteLine'];
      if (dl) {
        cmds2.removeCommand(dl);
        dl.bindKey = comboToAce(EAS.get('deleteLine'));
        cmds2.addCommand(dl, true);
      }
    } catch (e) { /* 忽略 */ }
  }
  // 命令面板条目（Ctrl+P 直达）
  registerCommand('select-next-occurrence', '选中下一个相同项', '🔁', function() { altjSelectNext(mainEditor); }, 'Alt+J', 'IDEA 式多光标：无选区先选中光标处词，再追加下一个相同文本');
  registerCommand('unselect-previous-occurrence', '撤销上一个选中项', '↩', function() { altjUnselectPrev(mainEditor); }, 'Alt+Shift+J', '撤销最后一次追加的相同项选中');
  registerCommand('select-all-occurrences', '选中所有相同项', '🪄', function() { altjSelectAll(mainEditor); }, 'Ctrl+Alt+J', '把文档中所有相同文本一次性转为多光标');
  registerCommand('expand-smart-selection', '智能选中（词/句/行/段）', '⇲', function() { altwSmartSelect(mainEditor); }, 'Alt+W', '按分隔符逐级扩展选区：词 → 句子 → 整行 → 段落');
  registerCommand('shrink-smart-selection', '收缩选区（逆扩展）', '⇱', function() { mainEditor.execCommand('shrinkSmartSelection'); }, 'Alt+Shift+W', '按分隔符逐级收缩选区：段落 → 整行 → 句子 → 词 → 光标');
  registerCommand('toggle-case', '大小写切换', '🔠', function() { mainEditor.execCommand('toggleCase'); }, 'Ctrl+Shift+U', 'VS Code 语义：全大写转小写，其余转大写（多光标独立）');
  registerCommand('delete-line', '删除整行', '🗑', function() { mainEditor.execCommand('deleteLine'); }, 'Ctrl+Shift+K', '删除光标所在整行（多光标逐行删除）');

  /** 命令面板渲染前同步可配置命令的最新键位（编辑区命令在速查弹窗改键后即时反映） */
  function syncPaletteShortcuts() {
    var EAS = window.EditorAceShortcuts;
    if (!EAS) return;
    var map = {
      'new': 'newTab', 'open': 'openFile', 'save': 'save', 'markdown': 'markdownPreview',
      'select-next-occurrence': 'selectNextOccurrence',
      'unselect-previous-occurrence': 'unselectPreviousOccurrence',
      'select-all-occurrences': 'selectAllOccurrences',
      'expand-smart-selection': 'expandSmartSelection',
      'shrink-smart-selection': 'shrinkSmartSelection',
      'toggle-case': 'toggleCase', 'delete-line': 'deleteLine'
    };
    commandRegistry.forEach(function (c) {
      if (map[c.id]) c.shortcut = EAS.get(map[c.id]);
    });
  }

  // ═══ AceJump 跳跃导航（Phase 4，对标 IDEA AceJump）───
  // 触发进入跳跃模式：word/char/line 三种 + 选区语义。独立脚本 ace-jump.js，
  // 未引入或异常时静默无效果（不影响现有功能）。
  var lastAceJumpTriggerT = 0;
  // 空画布唤起 AceJump 时的画布中央提示（toast 太容易被忽略，用户感知=“没反应”）
  function showAceJumpEmptyHint() {
    var host = mainEditor && mainEditor.container && mainEditor.container.closest ? mainEditor.container : null;
    if (!host) return;
    if (host.querySelector('.acejump-empty-hint')) return;
    var d = document.createElement('div');
    d.className = 'acejump-empty-hint';
    d.innerHTML = '<span>画布是空的：先输入内容，再按 <b>⌘; / Ctrl+;</b> 即可跳到任意位置</span>';
    host.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 2200);
  }
  function acejump(mode, select) {
    // 同一组合键被多条路径（主进程菜单加速键 IPC + 渲染层捕获 + 父窗口转发）在极短时间内
    // 重复触发时去重：toggle 语义会令第二次触发变成"取消"，导致覆盖层刚出现就消失（假"无响应"）。
    // 80ms 内忽略：正常人手速二次按键 >500ms，不会被误吞；按住触发键的自动重复也会被抑制（避免闪烁）。
    var now = Date.now();
    if (now - lastAceJumpTriggerT < 80) return;
    lastAceJumpTriggerT = now;

    if (!window.EditorAceJump) { showToast('AceJump 未加载'); return; }
    if (!mainEditor) return;
    window.EditorAceJump.toggle(mainEditor, {
      mode: mode || 'word',
      select: !!select,
      onEmpty: function() {
        showAceJumpEmptyHint();
        showToast('当前编辑区无可跳转目标（区域为空或尚未完成布局）');
      }
    });
  }
  registerCommand('acejump-word', 'AceJump 跳跃（单词）', '🎯', function() { acejump('word', false); }, EditorShortcuts.get('aceJump'), '跳转到可见区域中任意单词 / 中文单字的开头');
  registerCommand('acejump-char', 'AceJump 跳跃（字符）', '🔤', function() { acejump('char', false); }, '', '跳转到可见区域中的任意单个字符');
  registerCommand('acejump-line', 'AceJump 跳跃（行首）', '⎯', function() { acejump('line', false); }, '', '跳转到每个可见行的首个非空白字符');
  registerCommand('acejump-select', 'AceJump 跳跃（选区）', '✂', function() { acejump('word', true); }, '', '从当前光标延伸选区到目标位置（单词模式）');
  // 捕获阶段统一分发：Ctrl/Cmd+; 唤起（EditorShortcuts 可配置回退）
  EditorShortcuts.registerHandler('aceJump', function() { acejump('word', false); });
  // 命令面板：捕获阶段接管 Ctrl+K，防止 ACE 内置 Ctrl+K（删除到行尾/查找下一个）吃掉按键；
  // 捕获期 preventDefault+stopImmediatePropagation 保证 Windows 上按键既不会被菜单加速键之外的 ACE 绑定劫持。
  // Ctrl+K 唤起"顶层全局命令面板"（父窗口 globalCmdPalette）；编辑器内快捷操作面板由 Ctrl+P 承担。
  // 焦点在编辑/画布区时经 postMessage 通知父窗口打开全局命令面板；浏览器直开/无父窗口时降级回编辑器内命令面板。
  function openOuterCommandPalette() {
    try {
      if (window.parent && window.parent.postMessage) {
        window.parent.postMessage({ type: 'openGlobalCmdPalette' }, '*');
      } else {
        triggerCommandPalette();
      }
    } catch (e) { triggerCommandPalette(); }
  }
  EditorShortcuts.registerHandler('commandPalette', function() { openOuterCommandPalette(); });

  // ═══ 应用级命令（跨模块：父窗口导航 + 全局功能）───
  // 编辑器以 iframe 嵌入主窗口，通过 window.parent.postMessage 通知 index.html 切换视图，
  // 实现"编辑器内键盘直达全局页面"，对标 Taio 应用级命令面板。浏览器直开时降级为提示。
  function appNavigate(view) {
    try {
      if (window.parent && window.parent.postMessage) {
        window.parent.postMessage({ type: 'appNavigate', view: view }, '*');
      } else {
        showToast('页面跳转仅桌面应用可用', true);
      }
    } catch (e) { showToast('页面跳转失败', true); }
  }
  function appOpenClipboardHistory() {
    var api = getElectronAPI();
    if (api && api.clipboardHistory && api.clipboardHistory.open) {
      api.clipboardHistory.open();
    } else {
      showToast('剪贴板历史仅桌面应用可用', true);
    }
  }
  registerCommand('app-go-inbox', '到收件箱', '📥', function() { appNavigate('clip'); }, '', '切换主窗口到「收件箱」管理剪藏');
  registerCommand('app-go-editor', '到写作页', '✍', function() { appNavigate('editor'); }, '', '切换主窗口到「写作」编辑器');
  registerCommand('app-go-canvas', '到画布', '🎨', function() { appNavigate('canvas'); }, '', '切换主窗口到「画布」自由摆放与手绘');
  registerCommand('app-go-workspace', '到工作台', '🖥', function() { appNavigate('workspace'); }, '', '切换主窗口到「工作台」工作区概览');
  registerCommand('app-go-knowledge', '到知识库', '📚', function() { appNavigate('knowledge'); }, '', '切换主窗口到「知识库」文档管理');
  registerCommand('app-go-graph', '到知识图谱', '🕸', function() { appNavigate('graph'); }, '', '切换主窗口到「知识图谱」双链视图');
  registerCommand('app-go-settings', '到应用设置', '⚙️', function() { appNavigate('settings'); }, '', '切换主窗口到「设置」全局配置');
  registerCommand('app-clipboard-history', '剪贴板历史', '📋', function() { appOpenClipboardHistory(); }, '', '打开剪贴板历史面板，一键补录为剪藏');

  var paletteOpen = false;
  var paletteIndex = 0;
  var paletteFiltered = [];
  var paletteRenderRaf = null; // Phase 3：输入渲染 rAF 节流句柄
  var paletteVisibleLen = 0;   // 当前实际渲染的可见条数（≤ LIMIT）；键盘导航以此为准，避免索引越过可见区

  function openCommandPalette() {
    paletteMode = 'command';
    paletteOpen = true;
    paletteIndex = 0;
    elements.commandPalette.hidden = false;
    elements.commandPalette.setAttribute('aria-hidden', 'false');
    renderCommandList('');
    elements.commandPaletteInput.value = '';
    elements.commandPaletteInput.focus();
  }

  function closeCommandPalette() {
    paletteMode = 'command';
    paletteOpen = false;
    elements.commandPalette.hidden = true;
    elements.commandPalette.setAttribute('aria-hidden', 'true');
    mainEditor.focus();
  }

  var lastCmdPaletteTriggerT = 0;
  // 命令面板唤起：同一组合键（⌘/Ctrl+K、⌘/Ctrl+P）会被主进程菜单加速键 IPC + 渲染层捕获 + 父窗口转发
  // 在极短时间内重复触发，用 80ms 去重（toggle 语义会让第二次触发变成"取消"，导致面板刚出就关，形同无响应）。
  function triggerCommandPalette() {
    var now = Date.now();
    if (now - lastCmdPaletteTriggerT < 80) return;
    lastCmdPaletteTriggerT = now;
    if (quickOpenVisible) closeQuickSwitcher();
    if (paletteOpen) closeCommandPalette(); else openCommandPalette();
  }

  // ── 命令使用次数（Phase 1 命令面板增强：空查询按最近使用优先）──
  var CMD_USAGE_KEY = 'editor_cmd_usage_v1';
  function readCommandUsage() {
    try { return JSON.parse(localStorage.getItem(CMD_USAGE_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function recordCommandUsage(id) {
    if (!id) return;
    var usage = readCommandUsage();
    usage[id] = (usage[id] || 0) + 1;
    localStorage.setItem(CMD_USAGE_KEY, JSON.stringify(usage));
  }

  function renderCommandList(query) {
    var q = (query || '').trim().toLowerCase();
    syncPaletteShortcuts(); // 可配置命令（编辑区命令）改键后面板实时显示新键位
    // 数据源按模式区分：template 模式下过滤模板条目，command 模式过滤命令注册表
    var source = paletteMode === 'template' ? paletteTemplateEntries : commandRegistry;
    if (featureOn('cmdPaletteEnhanced')) {
      // 增强路径：空查询按使用次数降序（最近优先），非空查询按 fuzzyScore 打分排序。
      // fuzzyScore 在同 IIFE 内先声明后使用（函数声明提升），此处可直接调用。
      if (!q) {
        var usage = readCommandUsage();
        paletteFiltered = source.slice().sort(function (a, b) {
          var ub = usage[b.id] || 0, ua = usage[a.id] || 0;
          return ub - ua;
        });
      } else {
        paletteFiltered = source.map(function (c) {
          return { score: fuzzyScore(q, c.name), cmd: c };
        }).filter(function (x) { return x.score >= 0; })
          .sort(function (a, b) { return b.score - a.score; })
          .map(function (x) { return x.cmd; });
      }
    } else {
      // 原路径（开关关闭时与改造前完全一致）
      paletteFiltered = q
        ? source.filter(function(c) { return c.name.toLowerCase().indexOf(q) !== -1 || c.id.toLowerCase().indexOf(q) !== -1; })
        : source.slice();
    }
    var list = elements.commandPaletteList;
    list.innerHTML = '';
    if (!paletteFiltered.length) {
      paletteVisibleLen = 0;
      paletteIndex = 0;
      list.innerHTML = '<div class="command-palette-empty">无匹配命令</div>';
      return;
    }
    // Phase 3：DocumentFragment 批量构造 + 条数上限，避免频繁整表重建
    var LIMIT = 50;
    var visible = paletteFiltered.slice(0, LIMIT);
    paletteVisibleLen = visible.length;
    // 索引对齐可见区：paletteIndex 只能在已渲染的 visible 范围内移动
    paletteIndex = Math.min(paletteIndex, paletteVisibleLen - 1);
    var frag = document.createDocumentFragment();
    visible.forEach(function(c, i) {
      var item = document.createElement('div');
      item.className = 'command-palette-item' + (i === paletteIndex ? ' active' : '');
      var nameHtml = '<span class="command-palette-item-name">' + escapeHtml(c.name) + '</span>';
      if (c.desc) {
        nameHtml = '<span class="command-palette-item-main">' + nameHtml
          + '<span class="command-palette-item-desc">' + escapeHtml(c.desc) + '</span></span>';
      }
      item.innerHTML = '<span class="command-palette-item-icon">' + c.icon + '</span>'
        + nameHtml
        + (c.shortcut ? '<span class="command-palette-item-shortcut">' + platformShortcut(c.shortcut) + '</span>' : '');
      item.addEventListener('mousedown', function(ev) { ev.preventDefault(); executeCommand(i); });
      item.addEventListener('mouseenter', function() { setPaletteIndex(i); });
      frag.appendChild(item);
    });
    list.appendChild(frag);
  }

  function setPaletteIndex(i) {
    paletteIndex = i;
    var items = elements.commandPaletteList.querySelectorAll('.command-palette-item');
    items.forEach(function(el, idx) { el.classList.toggle('active', idx === paletteIndex); });
    var active = items[paletteIndex];
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function executeCommand(i) {
    var cmd = paletteFiltered[i];
    if (!cmd) return;
    recordCommandUsage(cmd.id);
    closeCommandPalette();
    try { cmd.handler(); } catch (e) { showToast('命令执行失败：' + e.message, true); }
  }

  elements.commandPaletteInput.addEventListener('input', function() {
    paletteIndex = 0;
    // Phase 3：高频输入以 rAF 节流渲染，避免每次击键全量重建列表
    if (paletteRenderRaf) cancelAnimationFrame(paletteRenderRaf);
    const value = this.value;
    paletteRenderRaf = requestAnimationFrame(function() {
      paletteRenderRaf = null;
      renderCommandList(value);
    });
  });
  elements.commandPaletteInput.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeCommandPalette(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setPaletteIndex(Math.min(paletteIndex + 1, paletteVisibleLen - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setPaletteIndex(Math.max(paletteIndex - 1, 0)); return; }
    if (e.key === 'Enter') { e.preventDefault(); executeCommand(paletteIndex); return; }
  });

  // 点击遮罩关闭
  elements.commandPalette.addEventListener('mousedown', function(e) { e.stopPropagation(); });
  document.addEventListener('mousedown', function(e) {
    if (paletteOpen && !elements.commandPalette.contains(e.target)) closeCommandPalette();
  });

  // Ctrl/Cmd+P / Ctrl/Cmd+K 唤起命令面板（排除 Shift/Alt，避免与其它 Ctrl+Shift 快捷键冲突）。
  // Ctrl+K 已由 EditorShortcuts 在捕获阶段接管（防 ACE 内置 Ctrl+K 删除到行尾等命令吃掉）；
  // 此处统一走带 80ms 去重的 triggerCommandPalette，避免与菜单加速键/IPC/转发多路径重复触发。
  document.addEventListener('keydown', function(e) {
    const key = (e.key || '').toLowerCase();
    const isTrigger = key === 'p' || key === 'k';
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && isTrigger) {
      e.preventDefault();
      triggerCommandPalette();
    }
  });

  // ── 全局文件快速搜索（Ctrl+Shift+O，Obsidian Quick Switcher 风格）──
  var quickOpenVisible = false;
  var quickRenderRaf = null; // Phase 3：快速打开输入 rAF 节流句柄
  var quickIndex = 0;
  var quickFiltered = [];
  var quickVisibleLen = 0;  // 当前实际渲染的可见条数（≤50）；键盘导航以此为准，避免索引越过可见区

  async function openQuickSwitcher() {
    if (paletteOpen) closeCommandPalette();
    if (!wikilinkState.loaded) {
      try { await buildLinkIndex(); } catch (e) { /* 索引加载失败时按空列表处理 */ }
    }
    quickOpenVisible = true;
    quickIndex = 0;
    elements.quickSwitcher.hidden = false;
    elements.quickSwitcher.setAttribute('aria-hidden', 'false');
    elements.quickSwitcherInput.value = '';
    renderQuickList('');
    setTimeout(function() { elements.quickSwitcherInput.focus(); }, 0);
  }

  function closeQuickSwitcher() {
    quickOpenVisible = false;
    elements.quickSwitcher.hidden = true;
    elements.quickSwitcher.setAttribute('aria-hidden', 'true');
    mainEditor.focus();
  }

  // Obsidian 风格前向模糊匹配：query 每个字符须按序出现（可跳格），
  // 前缀/连续/词首命中加分；返回分数，-1 表示不匹配。
  // Phase 4-1：已抽取到 editor-pure.js（EditorPure），此处优先委托，缺失时回退原实现。
  function fuzzyScore(query, str) {
    if (window.EditorPure && typeof window.EditorPure.fuzzyScore === 'function') {
      return window.EditorPure.fuzzyScore(query, str);
    }
    if (!query) return 0;
    var q = query.toLowerCase();
    var s = String(str || '').toLowerCase();
    var qi = 0, score = 0, last = -1, consec = 0;
    for (var i = 0; i < s.length && qi < q.length; i++) {
      if (s[i] === q[qi]) {
        var bonus = 4;
        if (last === i - 1) { consec++; bonus = 8 + consec; }
        else { consec = 0; }
        if (i === 0) bonus += 8;
        else if (s[i - 1] === ' ' || s[i - 1] === '-' || s[i - 1] === '_' || s[i - 1] === '.' || s[i - 1] === '/' || s[i - 1] === '\\') bonus += 6;
        score += bonus;
        last = i;
        qi++;
      }
    }
    if (qi < q.length) return -1;
    return score - (s.length - q.length) * 0.5;
  }

  // 综合检索分：basename 权值最高，其次文件名/相对路径/模块（与 `[[` 补全同源）。
  function quickScore(t, q) {
    var b = fuzzyScore(q, t.basename);
    var f = fuzzyScore(q, t.fileName);
    var r = fuzzyScore(q, t.relativePath);
    var m = fuzzyScore(q, (t.moduleName || '') + '/' + (t.moduleId || ''));
    if (b >= 0) return b * 3 + 100;
    if (f >= 0) return f * 2.5 + 80;
    if (r >= 0) return r * 1.5 + 40;
    if (m >= 0) return m + 20;
    return -1;
  }

  // 最近打开顺序映射：absolutePath → 序号（越小越新），空查询时按最近优先。
  function recentOrderMap() {
    var map = {};
    var recents = getRecentFiles() || [];
    for (var i = 0; i < recents.length; i++) map[recents[i].path] = i + 1;
    return map;
  }

  // 高亮命中字符（与 fuzzyScore 同源的贪心扫描，保证高亮位置一致）。
  function highlightQuery(str, q) {
    var wrapper = document.createElement('span');
    if (!q) { wrapper.textContent = str; return wrapper; }
    var s = String(str || '').toLowerCase();
    var ql = q.toLowerCase();
    var qi = 0, buf = '';
    for (var i = 0; i < s.length; i++) {
      if (qi < ql.length && s[i] === ql[qi]) {
        if (buf) { wrapper.appendChild(document.createTextNode(buf)); buf = ''; }
        var m = document.createElement('mark');
        m.className = 'quick-switcher-hit';
        m.textContent = str[i];
        wrapper.appendChild(m);
        qi++;
      } else {
        buf += str[i];
      }
    }
    if (buf) wrapper.appendChild(document.createTextNode(buf));
    return wrapper;
  }

  function renderQuickList(query) {
    var raw = (query || '').trim();
    var q = raw.toLowerCase();
    var all = wikilinkState.targets || [];
    var recentMap = recentOrderMap();
    var scored = [];
    for (var i = 0; i < all.length; i++) {
      var t = all[i];
      var s = q ? quickScore(t, q) : 0;
      if (q && s < 0) continue;
      scored.push({ t: t, s: s, rec: recentMap[t.absolutePath] || 9999 });
    }
    scored.sort(function(a, b) {
      if (q) return b.s - a.s;
      return (a.rec - b.rec) || (a.t.moduleName || '').localeCompare(b.t.moduleName || '') || (a.t.basename || '').localeCompare(b.t.basename || '');
    });
    quickFiltered = scored.map(function(x) { return x.t; });

    var list = elements.quickSwitcherList;
    list.innerHTML = '';
    if (!quickFiltered.length) {
      quickVisibleLen = 0;
      quickIndex = 0;
      list.innerHTML = '<div class="command-palette-empty">' + (all.length ? '无匹配文件' : '暂无文件索引，请先打开桌面应用') + '</div>';
      return;
    }
    // Phase 3：DocumentFragment 批量构造 + 条数上限，避免整表频繁重建
    var quickVisible = quickFiltered.slice(0, 50);
    quickVisibleLen = quickVisible.length;
    // 索引对齐可见区：quickIndex 只能在已渲染的 quickVisible 范围内移动
    quickIndex = Math.min(quickIndex, quickVisibleLen - 1);
    var quickFrag = document.createDocumentFragment();
    quickVisible.forEach(function(t, i) {
      var item = document.createElement('div');
      item.className = 'quick-switcher-item' + (i === quickIndex ? ' active' : '');
      var iconEl = document.createElement('span');
      iconEl.className = 'quick-switcher-item-icon';
      iconEl.textContent = /\.(md|mdown|markdown)$/i.test(t.fileName || '') ? '📄' : '🗂';
      var nameEl = document.createElement('span');
      nameEl.className = 'quick-switcher-item-name';
      nameEl.appendChild(highlightQuery(t.basename || t.fileName || t.absolutePath, q));
      var metaEl = document.createElement('span');
      metaEl.className = 'quick-switcher-item-meta';
      metaEl.textContent = (t.moduleName || t.moduleId || '') + '/' + (t.relativePath || '');
      item.appendChild(iconEl);
      item.appendChild(nameEl);
      item.appendChild(metaEl);
      item.addEventListener('mousedown', function(ev) { ev.preventDefault(); executeQuickOpen(i); });
      item.addEventListener('mouseenter', function() { setQuickIndex(i); });
      quickFrag.appendChild(item);
    });
    list.appendChild(quickFrag);
  }

  function setQuickIndex(i) {
    quickIndex = i;
    var items = elements.quickSwitcherList.querySelectorAll('.quick-switcher-item');
    items.forEach(function(el, idx) { el.classList.toggle('active', idx === quickIndex); });
    var active = items[quickIndex];
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function executeQuickOpen(i) {
    var target = quickFiltered[i];
    if (!target) return;
    closeQuickSwitcher();
    openWikilinkByPath(target);
  }

  elements.quickSwitcherInput.addEventListener('input', function() {
    quickIndex = 0;
    // Phase 3：rAF 节流，避免高频输入全量重建
    if (quickRenderRaf) cancelAnimationFrame(quickRenderRaf);
    const value = this.value;
    quickRenderRaf = requestAnimationFrame(function() {
      quickRenderRaf = null;
      renderQuickList(value);
    });
  });
  elements.quickSwitcherInput.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeQuickSwitcher(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setQuickIndex(Math.min(quickIndex + 1, quickVisibleLen - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setQuickIndex(Math.max(quickIndex - 1, 0)); return; }
    if (e.key === 'Enter') { e.preventDefault(); executeQuickOpen(quickIndex); return; }
  });

  // 点击遮罩关闭
  elements.quickSwitcher.addEventListener('mousedown', function(e) { e.stopPropagation(); });
  document.addEventListener('mousedown', function(e) {
    if (quickOpenVisible && !elements.quickSwitcher.contains(e.target)) closeQuickSwitcher();
  });

  // 唤起全局文件搜索（默认 Ctrl/Cmd+Shift+O，可在系统设置中修改；Ctrl+O 已让给「打开」）；由 EditorShortcuts 捕获阶段统一分发
  EditorShortcuts.registerHandler('quickOpen', function() {
    if (quickOpenVisible) closeQuickSwitcher(); else openQuickSwitcher();
  });

  // 编辑位置前后跳转快捷键（默认 Ctrl/Cmd+Alt+← / Ctrl/Cmd+Alt+→，可在系统设置中修改）；
  // 兼容旧键位 Alt+- / Alt+Shift+-（L5103 的 keydown 绑定）。由 EditorShortcuts 捕获阶段统一分发
  EditorShortcuts.registerHandler('posBack', function() { jumpPosHistoryBack(); });
  EditorShortcuts.registerHandler('posForward', function() { jumpPosHistoryForward(); });

  // 全部右下角抽屉快捷键已注册完毕，开启捕获阶段全局分发（幂等）
  EditorShortcuts.startCapture();

  // ── 编辑区核心操作类命令统一捕获分发（可配置改键）──
  // 接管原分散硬编码核心操作：Ctrl+T/N/O、Ctrl+S、Ctrl+Shift+L（格式化）、
  // Ctrl+Shift+M（预览）、Alt+T（终端）、Ctrl+Shift+I（插入图片）；
  // 默认键位与原行为一致，改键入口=写作区快捷键速查弹窗「编辑区命令」分组。
  // 优先级：本监听器在 startCapture() 之后注册 → dispatchCapture 先执行并
  // stopImmediatePropagation；此处再以 matchAny 双保险，命中系统级 13 项直接让位。
  var aceShortcutRecordingInput = null; // 弹窗内改键录制中的 input（非空=录制态）
  var ACE_CORE_ACTIONS = {
    newTab:          function () { createNewTab(); },
    newFile:         function () { createNewTab(); },
    openFile:        function () { openMainFile(); },
    save:            function () { saveFile(false); },
    formatDoc:       function () { formatCurrentContentAuto(); },
    markdownPreview: function () { toggleMarkdownPreview(); },
    terminal:        function () { openTerminalInDir(); },
    insertImage:     function () { if (editorImageInput) editorImageInput.click(); }
  };
  // guard 语义忠实复刻原硬编码逻辑：
  //   skipEditableAceExcept=INPUT/TEXTAREA/SELECT 且不在 .ace_editor 内则跳过
  //   skipTextareaNonAce=TEXTAREA 且非 ACE 文本域则跳过；其余动作无跳过
  function aceSkipGuard(e, guard) {
    if (!guard) return false;
    var t = (e.target && e.target.tagName) || '';
    var inAce = !!(e.target && e.target.closest && typeof e.target.closest === 'function' && e.target.closest('.ace_editor'));
    if (guard === 'skipEditableAceExcept') return /^(INPUT|TEXTAREA|SELECT)$/.test(t) && !inAce;
    if (guard === 'skipTextareaNonAce') return t === 'TEXTAREA' && !inAce;
    return false;
  }
  function aceShortcutDispatch(e) {
    if (aceShortcutRecordingInput) return; // 改键录制中：按键需直达录制 input，不得被分发器吞掉
    var EAS = window.EditorAceShortcuts;
    if (!EAS || e.defaultPrevented) return;
    if (EditorShortcuts.matchAny(e)) return; // 系统级 13 项优先（双保险，冲突时系统级生效）
    var hit = '';
    Object.keys(ACE_CORE_ACTIONS).forEach(function (id) {
      if (!hit && EditorShortcuts.match(e, EAS.get(id))) hit = id;
    });
    if (!hit) return;
    var def = EAS.ACE_DEFAULTS[hit] || {};
    if (aceSkipGuard(e, def.guard)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    try {
      ACE_CORE_ACTIONS[hit]();
    } catch (err) {
      console.warn('[ShortcutDebug] 编辑区命令分发失败:', hit, err);
    }
  }
  window.addEventListener('keydown', aceShortcutDispatch, true);

  // ── 模板系统：列表/读取/插入/变量替换 ──
  // 日期格式化：支持 strftime 风格 token（YYYY/YY/MM/M/DD/D/HH/H/mm/ss），最长优先替换避免 YY 误吞 YYYY
  function formatDate(d, fmt) {
    var pad = function(n, w) { n = String(Math.abs(n)); return n.padStart(w, '0'); };
    var map = {
      YYYY: String(d.getFullYear()),
      YY: pad(d.getFullYear() % 100, 2),
      MM: pad(d.getMonth() + 1, 2),
      M: String(d.getMonth() + 1),
      DD: pad(d.getDate(), 2),
      D: String(d.getDate()),
      HH: pad(d.getHours(), 2),
      H: String(d.getHours()),
      mm: pad(d.getMinutes(), 2),
      ss: pad(d.getSeconds(), 2)
    };
    return String(fmt).replace(/YYYY|YY|MM|M|DD|D|HH|H|mm|ss/g, function(t) { return map[t]; });
  }
  // 变量替换：{{date}}/{{now}}/{{time}}/{{year}}/{{month}}/{{day}}/{{weekday}}/{{title}}/{{author}}
  // 支持带日期格式参数：{{date:YYYYMMDD}} / {{date:YYMMDD}} / {{now:YYYY-MM-DD HH:mm}}
  function replaceTemplateVars(content, author) {
    var now = new Date();
    var vars = {
      '{{date}}': formatDate(now, 'YYYY-MM-DD'),
      '{{now}}': formatDate(now, 'YYYY-MM-DD HH:mm'),
      '{{time}}': formatDate(now, 'HH:mm'),
      '{{year}}': String(now.getFullYear()),
      '{{month}}': String(now.getMonth() + 1),
      '{{day}}': String(now.getDate()),
      '{{weekday}}': ['日', '一', '二', '三', '四', '五', '六'][now.getDay()],
      '{{title}}': getCurrentFileName().replace(/\.[^.]+$/, ''),
      '{{author}}': author || ''
    };
    var s = content;
    Object.keys(vars).forEach(function(k) { s = s.split(k).join(vars[k]); });
    // 带日期格式参数统一用 formatDate 补齐（在固定变量替换之后再处理，避免嵌套冲突）
    s = s.replace(/\{\{(date|now):([^}]+)\}\}/g, function(m, kind, fmt) { return formatDate(now, fmt); });
    return s;
  }

  // 模板数据统一加载入口：规范化主进程返回的 {success, templates} 契约
  function loadTemplateList() {
    var api = getElectronAPI();
    if (!api || !api.listTemplates) return Promise.reject(new Error('模板功能仅桌面模式可用'));
    return api.listTemplates().then(function(result) {
      if (!result || !result.success) throw new Error((result && result.message) || '模板加载失败');
      return (result.templates || []).slice();
    });
  }

  async function insertTemplateByName(name) {
    try {
      var list = await loadTemplateList();
      var tpl = list.find(function(t) { return t.name === name; });
      if (!tpl) { showToast('未找到模板：' + name, true); return; }
      var api = getElectronAPI();
      var result = await api.readTemplate(tpl.name);
      if (!result || !result.success) throw new Error((result && result.message) || '读取模板失败');
      // {{author}} 从配置读取（config.json 手填 author/authorName），无则替换为空
      var author = '';
      try {
        if (api && api.getConfig) {
          var cfg = await api.getConfig();
          author = (cfg && (cfg.author || cfg.authorName)) || '';
        }
      } catch (e) { /* 配置读取失败时 author 保持空 */ }
      var resolved = replaceTemplateVars(result.content || '', author);
      mainEditor.session.insert(mainEditor.getCursorPosition(), resolved);
      mainEditor.focus();
      showToast('已插入模板 ' + name);
    } catch (e) {
      showToast('模板插入失败：' + e.message, true);
    }
  }

  // 模板命令面板入口（命令面板 + 斜杠菜单双入口）
  registerCommand('template', '插入模板…', '📌', function() { openTemplatePicker(); });
  registerCommand('manage-templates', '管理模板…', '🗂', function() { openTemplateManager(); });

  var paletteMode = 'command';        // command | template：决定命令面板过滤数据源
  var paletteTemplateEntries = [];

  function openTemplatePicker() {
    loadTemplateList().then(function(list) {
      if (!list.length) { showToast('暂无模板，请在模板管理中新建', true); return; }
      paletteTemplateEntries = list.map(function(t) {
        return { id: 'tpl-' + t.name, name: t.name, icon: '📌', handler: function() { insertTemplateByName(t.name); } };
      });
      paletteMode = 'template';
      paletteOpen = true;
      paletteIndex = 0;
      elements.commandPalette.hidden = false;
      elements.commandPalette.setAttribute('aria-hidden', 'false');
      renderCommandList('');
      elements.commandPaletteInput.value = '';
      elements.commandPaletteInput.focus();
    }).catch(function(err) { showToast('模板加载失败：' + err.message, true); });
  }

  // ── 模板管理弹窗（新建/编辑/删除）──
  var templateEditing = null;          // 正在编辑的模板名（null=新建）
  var templateDeletePending = null;    // 两段式删除确认中的模板名
  var templateDeleteTimer = null;

  function openTemplateManager() {
    resetTemplateForm();
    renderTemplateManagerList();
    openModal(elements.templateModal);
  }

  function closeTemplateManager() {
    clearTimeout(templateDeleteTimer);
    templateDeletePending = null;
    closeModal(elements.templateModal);
    resetTemplateForm();
  }

  function resetTemplateForm() {
    templateEditing = null;
    elements.templateNameInput.value = '';
    elements.templateContentInput.value = '';
    elements.templateEditCancelBtn.hidden = true;
  }

  function renderTemplateManagerList() {
    var container = elements.templateList;
    container.innerHTML = '';
    loadTemplateList().then(function(list) {
      if (!list.length) {
        container.innerHTML = '<div class="template-empty">暂无模板，请在下方新建</div>';
        return;
      }
      list.forEach(function(t) {
        var row = document.createElement('div');
        row.className = 'template-item';
        row.innerHTML = '<span class="template-item-name">'
          + (t.builtin ? '<span class="tpl-badge-sm">内置</span>' : '')
          + escapeHtml(t.name) + '</span>'
          + '<span class="template-item-actions">'
          + '<button type="button" class="tool-btn" data-tpl-edit="' + escapeHtml(t.name) + '">编辑</button>'
          + '<button type="button" class="tool-btn danger-action" data-tpl-delete="' + escapeHtml(t.name) + '" data-tpl-builtin="' + (t.builtin ? '1' : '0') + '">' + (t.builtin ? '恢复默认' : '删除') + '</button>'
          + '</span>';
        row.addEventListener('click', function(ev) {
          if (ev.target.closest('[data-tpl-edit]')) { editTemplateInManager(t.name); return; }
          if (ev.target.closest('[data-tpl-delete]')) { deleteTemplateInManager(t.name, ev.target.closest('[data-tpl-delete]')); return; }
          // 点击行本身：关闭弹窗并直接插入
          closeTemplateManager();
          insertTemplateByName(t.name);
        });
        container.appendChild(row);
      });
    }).catch(function(err) { container.innerHTML = '<div class="template-empty">' + escapeHtml(err.message) + '</div>'; });
  }

  function editTemplateInManager(name) {
    var api = getElectronAPI();
    api.readTemplate(name).then(function(result) {
      if (!result || !result.success) { showToast((result && result.message) || '读取模板失败', true); return; }
      templateEditing = name;
      elements.templateNameInput.value = name;
      elements.templateContentInput.value = result.content || '';
      elements.templateEditCancelBtn.hidden = false;
      elements.templateContentInput.focus();
    }).catch(function(err) { showToast('读取模板失败：' + err.message, true); });
  }

  function saveTemplateFromForm() {
    var raw = (elements.templateNameInput.value || '').trim();
    var content = elements.templateContentInput.value;
    if (!raw) { showToast('请输入模板名称', true); return; }
    var name = /\.(md|txt)$/i.test(raw) ? raw : raw + '.md';
    var api = getElectronAPI();
    api.saveTemplate({ name: name, content: content }).then(function(result) {
      if (!result || !result.success) { showToast((result && result.message) || '保存模板失败', true); return; }
      showToast(templateEditing ? '已更新模板 ' + name : '已新建模板 ' + name);
      resetTemplateForm();
      renderTemplateManagerList();
    }).catch(function(err) { showToast('保存模板失败：' + err.message, true); });
  }

  function deleteTemplateInManager(name, btn) {
    if (templateDeletePending === name) {
      // 第二段：确认删除/恢复默认
      clearTimeout(templateDeleteTimer);
      templateDeletePending = null;
      var api = getElectronAPI();
      api.deleteTemplate(name).then(function(result) {
        if (!result || !result.success) { showToast((result && result.message) || '操作失败', true); return; }
        showToast(result.builtin ? ('已恢复默认模板 ' + name) : ('已删除模板 ' + name));
        if (templateEditing === name) resetTemplateForm();
        renderTemplateManagerList();
      }).catch(function(err) { showToast('操作失败：' + err.message, true); });
      return;
    }
    // 第一段：进入待确认状态（3 秒内再点才执行）
    clearTimeout(templateDeleteTimer);
    templateDeletePending = name;
    var isBuiltin = btn.dataset && btn.dataset.tplBuiltin === '1';
    btn.textContent = isBuiltin ? '确认恢复默认' : '确认删除';
    btn.classList.add('danger-confirm');
    templateDeleteTimer = setTimeout(function() {
      templateDeletePending = null;
      renderTemplateManagerList();
    }, 3000);
  }

  elements.templateSaveBtn.addEventListener('click', saveTemplateFromForm);
  elements.templateEditCancelBtn.addEventListener('click', resetTemplateForm);
  elements.templateModal.addEventListener('click', function(e) {
    if (e.target === elements.templateModal) closeTemplateManager();
  });
  elements.templateModal.querySelectorAll('[data-close-modal="templateModal"]').forEach(function(el) {
    el.addEventListener('click', closeTemplateManager);
  });
  document.addEventListener('keydown', function(e) {
    if (elements.templateModal.classList.contains('is-visible') && e.key === 'Escape') closeTemplateManager();
  });

  window.parent.postMessage({ type: 'editorReady' }, '*');

  // ── 系统右键菜单事件处理 ──
  // 注意：右键菜单的 IPC 事件统一由父页面（index.html）监听并处理，
  // 父页面读取文件内容后通过 postMessage（openFileData / openTextData）转发到本编辑器。
  // 此处不再重复注册 IPC 监听器，避免与父页面处理器双重触发。
})();
