(function initializeLightEditor() {
  'use strict';

  const API_BASE_URL = 'http://127.0.0.1:8081/api/clip';
  window.API_BASE_URL = API_BASE_URL; // 暴露给 media-uploader.js（const 不挂 window）
  const AI_CHAT_API_URL = API_BASE_URL.replace(/\/api\/clip$/, '/api/ai/chat/stream');
  const MAX_TRANSFORM_LENGTH = 5 * 1024 * 1024;
  const LANGUAGE_EXTENSIONS = { json: 'json', xml: 'xml', sql: 'sql', text: 'txt', markdown: 'md' };
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
  const AI_CHAT_WIDTH_KEY = 'editor_ai_chat_width_v1';

  // 跨标签共享状态（对比、转换等）
  const sharedState = {
    compareToken: null,
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
    'selectionStatus', 'matchStatus', 'runtimeStatus', 'compareToolbar', 'comparePane',
    'editorWorkspace', 'compareFileName', 'diffCounter', 'markdownPane', 'markdownBody', 'mdFullscreenBtn', 'closeMarkdownBtn', 'transformPanel',
    'transformOperation', 'transformPreview', 'encodingModal', 'encodingSelect',
    'encodingNote', 'clipModal', 'clipModalTitle', 'clipScopeDescription', 'discardModal',
    'clipTitleInput', 'clipModeSelect', 'clipCategorySelect', 'clipTagsInput',
    'clipThoughtsInput', 'includeFileNameCheck', 'submitClipBtn', 'browserFileInput', 'toast',
    'statusLang', 'statusTabSize', 'settingsModal', 'fontSizeSlider', 'fontSizeLabel', 'tabSizeSelect',
    'fullscreenBtn', 'fileTreePane', 'fileTreeTitle', 'fileTreeBody', 'closeFileTreeBtn', 'selectDirBtn',
    'autosaveStatus', 'historyCount', 'historyList', 'closeHistoryBtn',
    'undoHistoryBtn', 'redoHistoryBtn', 'clearHistoryBtn', 'mainPane', 'historyPane', 'recentPane',
    'recentList', 'closeRecentBtn', 'clearRecentBtn', 'favPane', 'favList', 'closeFavBtn', 'clearFavBtn',
    'backlinksPane', 'backlinksList', 'backlinksTarget', 'backlinksCount', 'backlinksPaneTitle', 'saveToVaultBtn', 'closeBacklinksBtn', 'tabBacklinks', 'tabOutgoing', 'tabBacklinksCount', 'tabOutgoingCount', 'outgoingList', 'outlinePane', 'outlineList', 'closeOutlineBtn', 'tagsPane', 'tagsList', 'closeTagsBtn', 'commandPalette', 'commandPaletteInput', 'commandPaletteList', 'quickSwitcher', 'quickSwitcherInput', 'quickSwitcherList', 'aiChatPane', 'aiChatMessages', 'aiChatInput',
    'aiChatSendBtn', 'aiChatStopBtn', 'aiChatClearBtn', 'aiChatCloseBtn', 'aiChatStatus',
    'aiChatResizeHandle', 'aiPetBtn', 'editorContextMenu', 'aiSearchContextBtn', 'smartIngestContextBtn', 'aiImportPasswordContextBtn',
    'offlineTranslateContextBtn', 'onlineTranslateContextBtn', 'addCustomMappingContextBtn', 'addToDictLibContextBtn', 'aiContextAnalysisContextBtn',
    'manageDictionaryContextBtn', 'aiChatContextBtn', 'joinLineEndsContextBtn', 'formatContextBtn',
    'dictModal', 'dictSourceInput', 'dictTargetInput', 'dictAddBtn', 'dictList', 'dictLibList', 'dictTabMapping', 'dictTabLibrary',
    'wikilinkPickerModal', 'wikilinkPickerHint', 'wikilinkPickerList',
    'aiChatSelectionHint', 'aiChatSelectionHintText', 'aiChatSelectionHintClear'
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
    if (!/Mac/i.test(navigator.platform || '')) return sc;
    return sc
      .replace(/Ctrl\+/gi, '⌘')
      .replace(/Meta\+/gi, '⌘')
      .replace(/Shift\+/gi, '⇧')
      .replace(/Alt\+/gi, '⌥');
  }

  function applyMascotPreference() {
    try {
      const config = JSON.parse(localStorage.getItem('cut_shelter_mascot_v1') || '{}');
      const action = config.action || 'run';
      elements.aiPetBtn.dataset.action = action;
      elements.aiPetBtn.style.setProperty('--mascot-color', config.color || 'var(--app-primary)');
      // 构建图片 HTML
      let iconHtml = null;
      if (config.iconType === 'preset-images' && config.iconId) {
        iconHtml = `<img class="ai-pet-image" src="assets/mascot/${config.iconId}/${action}.png" alt="Pet">`;
      } else if (config.iconType === 'upload' && config.iconDataUrls) {
        const uploads = config.iconDataUrls;
        const isLegacy = Object.keys(uploads).some(k => ['run', 'wave', 'jump', 'think', 'sleep', 'celebrate'].includes(k));
        const charUploads = isLegacy ? uploads : (uploads[config.iconId] || {});
        const url = charUploads[action];
        if (url) {
          iconHtml = `<img class="ai-pet-image" src="${url}" alt="Pet">`;
        } else if (config.iconId) {
          // 如果当前动作没有上传图片，用预设图兜底
          iconHtml = `<img class="ai-pet-image" src="assets/mascot/${config.iconId}/${action}.png" alt="Pet">`;
        }
      } else if (config.iconType === 'upload' && config.iconDataUrl) {
        // 旧版兼容
        iconHtml = `<img class="ai-pet-image" src="${config.iconDataUrl}" alt="Pet">`;
      }
      if (iconHtml) elements.aiPetBtn.innerHTML = iconHtml;
      else if (config.iconSvg) elements.aiPetBtn.innerHTML = config.iconSvg.replace('<svg ', '<svg class="ai-pet-svg" ');
      else elements.aiPetBtn.innerHTML = '<svg class="ai-pet-svg" viewBox="0 0 64 64" aria-hidden="true"><ellipse class="ai-pet-glow" cx="32" cy="50" rx="14" ry="4" fill="var(--mascot-color,var(--app-primary))" opacity=".2"></ellipse><g class="ai-pet-figure"><circle cx="32" cy="28" r="18" fill="var(--mascot-color,var(--app-primary))" fill-opacity=".85" stroke="var(--mascot-color,var(--app-primary))" stroke-width="2.5"></circle></g><g class="ai-pet-face"><circle cx="23" cy="25" r="5" fill="#fff" stroke="none"></circle><circle cx="41" cy="25" r="5" fill="#fff" stroke="none"></circle><circle class="ai-pet-eye" cx="23" cy="25" r="3" fill="#2d3748" stroke="none"></circle><circle class="ai-pet-eye" cx="41" cy="25" r="3" fill="#2d3748" stroke="none"></circle><circle class="ai-pet-eye-highlight" cx="22" cy="23.5" r="1.5" fill="#fff" stroke="none"></circle><circle class="ai-pet-eye-highlight" cx="40" cy="23.5" r="1.5" fill="#fff" stroke="none"></circle><ellipse class="ai-pet-blush" cx="18" cy="31" rx="4" ry="2.5" fill="#ff8a9e" opacity=".5" stroke="none"></ellipse><ellipse class="ai-pet-blush" cx="46" cy="31" rx="4" ry="2.5" fill="#ff8a9e" opacity=".5" stroke="none"></ellipse><path d="M27 34c2 2 6 2 8 0" fill="none" stroke="#2d3748" stroke-width="2" stroke-linecap="round"></path></g></svg>';
      elements.aiPetBtn.title = `打开Pet · ${({ run: '奔跑', wave: '挥手', jump: '跳跃', think: '思考', sleep: '打盹', celebrate: '庆祝' })[action] || '奔跑'}`;
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

  // 覆盖 ACE 默认的 Ctrl/Cmd+L（跳转到指定行），改为格式化当前内容
  mainEditor.commands.addCommand({
    name: 'formatContent',
    bindKey: { win: 'Ctrl-L', mac: 'Command-L' },
    exec: function() {
      formatCurrentContent();
    },
    readOnly: false
  });

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

  /**
   * 应用主题到编辑器页面与 ACE 编辑器。
   * @param {string|null} parentTheme 父窗口通过 message 传回的主题值（dark / notion / regular 等），
   *        非空时优先采用，避免切页后本地缓存与父窗口不一致导致背景色错乱（Bug 修复）。
   */
  function applyTheme(parentTheme) {
    const appearance = localStorage.getItem(APPEARANCE_KEY) || 'notion';
    let theme = localStorage.getItem(THEME_STORAGE_KEY) || 'notion';
    if (appearance === 'dark') theme = 'dark';
    else if (appearance === 'regular') theme = 'regular';
    else if (appearance === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'notion';
    }
    // 父窗口显式传入主题时优先采用（规避 iframe 隐藏期间缓存未同步造成的错乱）
    if (parentTheme === 'dark' || parentTheme === 'notion' || parentTheme === 'regular') {
      theme = parentTheme;
    }
    document.documentElement.setAttribute('data-theme', theme);
    const aceTheme = theme === 'dark' ? 'ace/theme/tomorrow_night' : 'ace/theme/textmate';
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
   */
  function switchToTab(index) {
    if (index === activeTabIndex || index < 0 || index >= tabs.length) return;
    if (activeAiRequest) cancelAiRequest();
    saveActiveTabSnapshot();
    activeTabIndex = index;
    state = tabs[activeTabIndex];
    ensureAiChatState(state);

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
    mainEditor.focus();
    // 载入新文件后刷新双向链接面板（当前激活 tab；面板可见时生效）
    scheduleBacklinksRefresh();
  }

  function setLanguage(language) {
    const normalized = ['json', 'xml', 'sql', 'markdown'].includes(language) ? language : 'text';
    elements.languageSelect.value = normalized;
    mainEditor.session.setMode(`ace/mode/${normalized}`);
    compareEditor.session.setMode(`ace/mode/${normalized}`);
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
    const target = getTargetRangeAndText();
    if (target.text.length > MAX_TRANSFORM_LENGTH) {
      showToast('格式化内容超过 5 MB，已阻止本次操作', true);
      return;
    }
    const language = elements.languageSelect.value;
    // 返回 null 表示语言不支持格式化；否则返回 {error, value}
    const runFormatter = (text) => {
      if (language === 'json') return { value: EditorCore.formatJson(text, false) };
      if (language === 'xml') return { value: EditorCore.formatXml(text, false) };
      if (language === 'sql') return { value: EditorCore.formatSql(text, 'sql') };
      return null;
    };
    try {
      const fmt = runFormatter(target.text);
      if (!fmt) throw new Error('请选择 JSON、XML 或 SQL 模式');
      mainEditor.session.replace(target.range, fmt.value);
      showToast(`${target.selection ? '选区' : '全文'}格式化完成`);
    } catch (error) {
      // 兜底：格式化失败时先「删除每行末尾换行符」合并被客户端截断的多行，再尝试格式化，
      // 减少用户一次手动「删除每行末换行符」的交互动作
      let fallbackError = null;
      const joined = target.text.replace(/\r\n|\r|\n/g, '');
      if (joined.length !== target.text.length) {
        try {
          const fmt = runFormatter(joined);
          if (fmt) {
            const removed = target.text.length - joined.length;
            mainEditor.session.replace(target.range, fmt.value);
            showToast(`${target.selection ? '选区' : '全文'}格式化完成（已自动删除 ${removed} 个行末换行符后重试）`, false, 'info');
            FrontendLogger.info('[Editor] Format fallback success', { language, selection: target.selection, removed });
            return;
          }
          fallbackError = new Error('请选择 JSON、XML 或 SQL 模式');
        } catch (err2) {
          fallbackError = err2;
        }
      }
      const detail = EditorCore.extractErrorLocation(fallbackError || error);
      const hint = (joined.length === target.text.length)
        ? '（内容不含可合并的行末换行符，请手动「删除每行末换行符」后重试）'
        : '（已自动删除行末换行符后仍失败）';
      showToast(`格式化失败${hint}：${detail.message}`, true);
      FrontendLogger.warn('[Editor] Format failed', language, detail.message);
    }
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
    mainEditor.session.replace(sharedState.transformTarget.range, elements.transformPreview.value);
    closeTransformPanel();
    showToast('转换结果已替换原文');
  }

  /**
   * 切换 Markdown 预览模式
   */
  let markdownRenderTimer = null;

  function toggleMarkdownPreview(forceOpen) {
    const shouldOpen = forceOpen !== undefined ? forceOpen : elements.markdownPane.hidden;
    if (shouldOpen && isPaneOpen(elements.aiChatPane)) setAiChatPanelOpen(false);
    elements.markdownPane.hidden = !shouldOpen;
    elements.editorWorkspace.classList.toggle('markdown-preview', shouldOpen);

    // 关闭预览时同步退出预览全屏态
    if (!shouldOpen && markdownFullscreen) {
      toggleMarkdownFullscreen(false);
    }

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

  // Markdown 预览全屏：预览独占整个工作区（编辑区/反链等面板临时隐藏）
  let markdownFullscreen = false;
  function toggleMarkdownFullscreen(forceOpen) {
    if (elements.markdownPane.hidden) return;
    markdownFullscreen = forceOpen !== undefined ? forceOpen : !markdownFullscreen;
    elements.editorWorkspace.classList.toggle('markdown-fullscreen', markdownFullscreen);
    if (elements.mdFullscreenBtn) {
      elements.mdFullscreenBtn.textContent = markdownFullscreen ? '退出全屏' : '⛶ 全屏';
      elements.mdFullscreenBtn.title = markdownFullscreen ? '退出预览全屏 (Esc)' : '预览全屏';
    }
    setTimeout(() => mainEditor.resize(), 0);
  }

  function scheduleMarkdownRender() {
    clearTimeout(markdownRenderTimer);
    markdownRenderTimer = setTimeout(renderMarkdownPreview, 300);
  }

  function renderMarkdownPreview() {
    const text = mainEditor.getValue();
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
  }

  async function toggleCompare(forceOpen) {
    const shouldOpen = forceOpen !== undefined ? forceOpen : elements.comparePane.hidden;
    if (shouldOpen && isPaneOpen(elements.aiChatPane)) setAiChatPanelOpen(false);
    elements.comparePane.hidden = !shouldOpen;
    elements.compareToolbar.classList.toggle('is-open', shouldOpen);
    elements.compareToolbar.setAttribute('aria-hidden', String(!shouldOpen));
    elements.editorWorkspace.classList.toggle('comparing', shouldOpen);
    // 进入对比模式时退出 Markdown 预览
    if (shouldOpen && !elements.markdownPane.hidden) {
      toggleMarkdownPreview(false);
    }
    if (shouldOpen && !compareEditor.getValue()) {
      compareEditor.setValue(mainEditor.getValue(), -1);
      elements.compareFileName.textContent = '当前文档快照';
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
    elements.aiPetBtn.title = nextState === 'thinking' ? 'Pet正在奔跑回答' : nextState === 'sleeping' ? 'Pet正在打盹，点击唤醒' : '打开Pet';
    clearTimeout(petIdleTimer);
    if (nextState === 'idle') {
      petIdleTimer = setTimeout(() => setPetState('sleeping'), 2 * 60 * 1000);
    }
    // 根据状态切换对应的动作图片（thinking→think, happy→celebrate, sleeping→sleep）
    updatePetActionImage(nextState);
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
    elements.aiChatStatus.textContent = status;
    elements.aiChatStatus.className = `ai-chat-status ${chat.status}`;
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
    const left = Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 8);
    const top = Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    menu.dataset.selectedText = selectedText;
  }

  function closeEditorContextMenu() {
    elements.editorContextMenu.hidden = true;
    delete elements.editorContextMenu.dataset.selectedText;
  }

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
    mainEditor.focus();
    const command = action === 'selectAll' ? 'selectall' : action;
    try {
      mainEditor.execCommand(command);
    } catch (error) {
      showToast(`${action} 操作失败`, true);
    }
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
    elements.aiPetBtn.addEventListener('click', toggleAiChatPanel);
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
  }

  function updateStatusBar() {
    const langMap = { text: '纯文本', json: 'JSON', xml: 'XML', sql: 'SQL', markdown: 'Markdown' };
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
      const editorContent = (clip.bodyContent && clip.bodyContent.trim()) ? clip.bodyContent : (clip.content || '');
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
      const editorContent = (clip.bodyContent && clip.bodyContent.trim()) ? clip.bodyContent : (clip.content || '');
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
      renderAiChat();
      mainEditor.focus();
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
  document.getElementById('markdownBtn').addEventListener('click', () => toggleMarkdownPreview());
  document.getElementById('exportWordBtn').addEventListener('click', exportToWord);
  elements.closeMarkdownBtn.addEventListener('click', () => toggleMarkdownPreview(false));
  elements.mdFullscreenBtn.addEventListener('click', () => toggleMarkdownFullscreen());
  document.getElementById('terminalBtn').addEventListener('click', openTerminalInDir);

  // 在系统终端中打开当前文件所在目录（无则回退知识库根目录）
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

  // 导出 Markdown 为 Word：Mermaid → PNG → 后端 POI 生成 .docx（FP-9）
  async function exportToWord() {
    const text = mainEditor.getValue();
    if (!text || !text.trim()) { showToast('暂无内容可导出', true); return; }

    let markdown = text;
    const images = {};

    // 1. 提取 ```mermaid 代码块，渲染为高分辨率 PNG 并替换为图片引用
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

    // 2. 调用后端生成 .docx 并触发下载
    const filename = (getCurrentFileName() || '导出文档').replace(/\.[^.]+$/, '') + '.docx';
    // 从 API 基地址提取 origin（协议+主机+端口），拼接后端导出接口，
    // 不依赖 /api/clip 后缀，避免后缀变动导致 URL 拼接失败（Bug 修复）
    let origin = '';
    try { origin = new URL(window.API_BASE_URL || 'http://127.0.0.1:8081').origin; }
    catch (e) { origin = 'http://127.0.0.1:8081'; }
    const exportUrl = origin + '/api/editor/export-word';
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
      // 网络错误分类提示，便于定位是后端未启动还是接口地址问题
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
  if (editorImageInput) {
    editorImageInput.addEventListener('change', (e) => {
      handleEditorImageFiles(e.target.files);
      e.target.value = '';
    });
  }
  // Ace 编辑区粘贴图片拦截（Ctrl+V 图片 → 上传，而非粘贴文本）
  if (mainEditor && mainEditor.container) {
    mainEditor.container.addEventListener('paste', (e) => {
      const files = [];
      if (e.clipboardData && e.clipboardData.items) {
        for (let i = 0; i < e.clipboardData.items.length; i++) {
          const item = e.clipboardData.items[i];
          if (item.kind === 'file' && item.type && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) files.push(file);
          }
        }
      }
      if (files.length) {
        e.preventDefault();
        handleEditorImageFiles(files);
      }
    });
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
  document.getElementById('clipBtn').addEventListener('click', openClipModal);
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
      // Ctrl/Cmd+O 已由全局快速搜索（openQuickSwitcher）接管，不再打开原生文件对话框
      event.preventDefault();
    } else if (modifier && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveFile(event.shiftKey);
    } else if (modifier && event.key.toLowerCase() === 'l') {
      // Ctrl/Cmd+L 格式化当前内容（JSON/SQL/XML 等）
      // 焦点在 ACE 编辑器内时由编辑器命令处理，此处仅兜底处理焦点在编辑器外的情况
      if (mainEditor.container.contains(event.target)) return;
      event.preventDefault();
      formatCurrentContent();
    } else if (modifier && event.shiftKey && event.key.toLowerCase() === 'm') {
      event.preventDefault();
      toggleMarkdownPreview();
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
      // Ctrl+, 打开设置
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
    } else if (data.type === 'openFileData') {
      // 系统右键菜单「用编辑器打开」→ 父页面读取文件后传入数据，在新标签页打开
      openFileDataInNewTab(data.fileData);
    } else if (data.type === 'openTextData') {
      // 系统右键菜单「PDF OCR」→ 在编辑器新标签页打开识别结果
      openTextInNewTab(data.text, data.title || 'OCR 识别结果');
    }
  });

  window.addEventListener('storage', event => {
    if (event.key === THEME_STORAGE_KEY || event.key === APPEARANCE_KEY) applyTheme();
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  // 页面（iframe）切回可见时强制重绘主题，修复切换页面后 ACE 背景色/高亮错乱的问题（Bug 修复）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') applyTheme();
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

  // Alt+T 在系统终端中打开当前文件所在目录
  document.addEventListener('keydown', function(e) {
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      openTerminalInDir();
    }
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

    elements.fullscreenBtn.textContent = isFullscreen ? '退出全屏' : '全屏';
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
    // Esc 退出 Markdown 预览全屏
    if (e.key === 'Escape' && markdownFullscreen) {
      e.preventDefault();
      toggleMarkdownFullscreen(false);
    }
  });

  // 退出全屏时同步状态
  document.addEventListener('fullscreenchange', function() {
    if (!document.fullscreenElement && isFullscreen) {
      isFullscreen = false;
      document.querySelector('.editor-app').classList.remove('fullscreen');
      elements.fullscreenBtn.textContent = '全屏';
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

  function triggerAutosave() {
    if (!autosaveEnabled) return;
    var currentContent = mainEditor.getValue();
    if (!state.modified || currentContent === lastSavedContent) return;

    // 桌面模式但文件未保存（无 fileToken），静默跳过
    var api = getElectronAPI();
    if (api && api.autosaveFile && !state.fileToken) {
      return;
    }

    elements.autosaveStatus.textContent = '保存中...';
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
        elements.autosaveStatus.textContent = '已自动保存';
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
            elements.autosaveStatus.textContent = '已自动保存';
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
  setInterval(function() { saveEditorCache(); }, 30000);

  // ══════════════════════════════════════════════════════════
  // 5. File Tree (文件树侧边栏)
  // ══════════════════════════════════════════════════════════
  var fileTreeOpen = false;
  var fileTreeDir = null; // 当前浏览的目录路径

  function toggleFileTree() {
    fileTreeOpen = !fileTreeOpen;
    elements.fileTreePane.setAttribute('aria-hidden', String(!fileTreeOpen));
    elements.editorWorkspace.classList.toggle('show-filetree', fileTreeOpen);
    if (fileTreeBtn) fileTreeBtn.classList.toggle('active', fileTreeOpen);

    if (fileTreeOpen) {
      // 互斥：关闭其它左抽屉（历史/最近/收藏/反链/大纲/标签）
      closeOtherLeftPanes('show-filetree');
      loadFileTree();
    }

    setTimeout(function() { mainEditor.resize(); }, 250);
  }

  function loadFileTree() {
    var api = getElectronAPI();
    if (!api || !api.listDirectory) {
      elements.fileTreeBody.innerHTML = '<div class="filetree-item" style="cursor:default;color:var(--app-text-muted);">文件树仅桌面模式可用</div>';
      return;
    }

    // 已有已选择的目录，直接加载
    if (fileTreeDir) {
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
  var fileTreeBtn = createStatusBtn('文件', '📁', '文件浏览器', 'Ctrl+Shift+E');
  fileTreeBtn.addEventListener('click', toggleFileTree);
  elements.runtimeStatus.parentNode.insertBefore(fileTreeBtn, elements.runtimeStatus);

  elements.closeFileTreeBtn.addEventListener('click', toggleFileTree);
  elements.selectDirBtn.addEventListener('click', selectFileTreeDirectory);

  // Ctrl/Cmd+Shift+F 文件树快捷键
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      toggleFileTree();
    }
  });

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
  setInterval(saveWorkspace, 60000); // 每分钟保存一次

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
  var historyBtn = createStatusBtn('历史', '📋', '编辑历史', 'Ctrl+Shift+H');
  historyBtn.addEventListener('click', toggleHistoryPanel);
  elements.runtimeStatus.parentNode.insertBefore(historyBtn, elements.runtimeStatus);

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

  function recordRecentFile(filePath, fileName) {
    if (!filePath) return;
    let list = getRecentFiles().filter(item => item.path !== filePath);
    list.unshift({ path: filePath, name: fileName || filePath.split(/[\\/]/).pop() || filePath, time: Date.now() });
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
    list.forEach(item => {
      const el = document.createElement('div');
      el.className = 'recent-item';
      const nameLine = document.createElement('div');
      nameLine.className = 'recent-name';
      nameLine.textContent = item.name;
      const metaLine = document.createElement('div');
      metaLine.className = 'recent-meta';
      metaLine.textContent = item.path + ' · ' + formatRecentTime(item.time);
      el.appendChild(nameLine);
      el.appendChild(metaLine);
      el.title = item.path;
      el.addEventListener('click', function() {
        openRecentFile(item.path);
      });
      el.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        e.stopPropagation();
        showRecentContextMenu(e, item);
      });
      elements.recentList.appendChild(el);
    });
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
  var recentBtn = createStatusBtn('最近', '🕐', '最近打开的文件', 'Ctrl+Shift+R');
  recentBtn.addEventListener('click', toggleRecentPanel);
  elements.runtimeStatus.parentNode.insertBefore(recentBtn, historyBtn);

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
  var favBtn = createStatusBtn('收藏', '⭐', '常用文件收藏', 'Ctrl+Shift+F');
  favBtn.addEventListener('click', toggleFavPanel);
  elements.runtimeStatus.parentNode.insertBefore(favBtn, recentBtn);

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
      if (overviewBtn) overviewBtn.classList.toggle('active', rulerVisible);
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

    // 添加快捷键和按钮
    var overviewBtn = document.createElement('button');
    overviewBtn.className = 'status-btn';
    overviewBtn.title = '概览图 ' + platformShortcut('Ctrl+Shift+Y');
    overviewBtn.textContent = '概览';
    overviewBtn.addEventListener('click', function() {
      toggleOverviewRuler();
    });
    elements.runtimeStatus.parentNode.insertBefore(overviewBtn, elements.runtimeStatus);

    // Ctrl/Cmd+Shift+Y 切换概览（避免与大纲 Ctrl+Shift+O 冲突）
    document.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        toggleOverviewRuler();
      }
    });
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
  function escapeHtml(str) {
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

  // 初始化：加载词典 + 注册 completer + 设置弹窗
  loadDictLib();
  loadUserDict();
  setupDictModal();
  // 延迟注册 completer（等待编辑器完全初始化）
  setTimeout(registerDictCompleter, 500);

  // ══════════════════════════════════════════════════════════
  // FP-1 / FP-6 Obsidian 双链（wikilink）支持
  // ─ 补全 / 索引 / 解析 / 跳转 / 反链 / 存入知识库
  // ══════════════════════════════════════════════════════════
  var wikilinkState = { targets: [], modules: [], loaded: false };
  var registeredWikilinkCompleter = null;
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
      return;
    }
    try {
      var res = await api.listWikilinkTargets();
      wikilinkState.targets = (res && res.targets) || [];
      wikilinkState.modules = (res && res.modules) || [];
      wikilinkState.loaded = true;
    } catch (e) {
      wikilinkState.targets = [];
      wikilinkState.modules = [];
      wikilinkState.loaded = true;
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
        var query = m[1].toLowerCase();
        var results = [];
        var targets = wikilinkState.targets || [];
        // 统计同名 fileName 冲突（同名文件需额外给出 [[相对路径]] 精确候选消歧）
        var nameCounts = {};
        for (var i = 0; i < targets.length; i++) {
          var fn = targets[i].fileName || targets[i].basename;
          nameCounts[fn] = (nameCounts[fn] || 0) + 1;
        }
        var seen = {};
        for (var j = 0; j < targets.length; j++) {
          var t = targets[j];
          var fn = t.fileName || t.basename;
          if (seen[fn]) continue; // 同名文件只补一个（foo.md 与 foo.sql 可分别补出）
          seen[fn] = true;
          var hay = (fn + ' ' + (t.basename || '') + ' ' + (t.relativePath || '')).toLowerCase();
          if (query && hay.indexOf(query) === -1) continue;
          // md 用 basename（Obsidian 原生语法），非 md 用 fileName（含扩展名显式消歧）
          var label = /\.(md|mdown|markdown)$/i.test(fn) ? t.basename : fn;
          var meta = (t.moduleName || t.moduleId || '') + '/' + (t.relativePath || '');
          results.push({
            // caption 需包含 `[[` 前缀，否则会被 ACE 的 setFilter 过滤掉
            caption: '[[' + label + ']]',
            // value 必须保留 `[[` 前缀：当前 identifierRegexps 回溯出的前缀含 `[[`，
            // ACE 会整体替换该前缀（如 `[[xx` → `[[label]]`）。若 value 去掉 `[[`，
            // 替换后两根 `[[` 会被吞掉，得到 `label]]`。
            value: '[[' + label + ']]',
            meta: meta,
            score: (t.basename || fn).toLowerCase().indexOf(query) === 0 ? 1000 : 500
          });
          // 同名冲突 → 额外给出 [[相对路径]] 精确候选用于歧义消除
          if (nameCounts[fn] > 1 && t.relativePath && t.relativePath.indexOf('/') !== -1) {
            results.push({
              caption: '[[' + t.relativePath + ']]',
              value: '[[' + t.relativePath + ']]',
              meta: (t.moduleName || t.moduleId || '') + ' 精确路径',
              score: 900
            });
          }
        }
        results.sort(function(a, b) { return b.score - a.score; });
        callback(null, results.slice(0, 30));
      }
    };

    registeredWikilinkCompleter = completer;
    if (langTools.addCompleter) {
      langTools.addCompleter(completer);
    } else if (mainEditor.completers) {
      mainEditor.completers.push(completer);
    }
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
    if (!a) return;
    e.preventDefault();
    openWikilink(a.getAttribute('data-target'));
  });

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
  var backlinksBtn = createStatusBtn('反链', '🔗', '双链反链面板', 'Ctrl+Shift+B');
  backlinksBtn.addEventListener('click', function() { toggleBacklinks(); });
  elements.runtimeStatus.parentNode.insertBefore(backlinksBtn, fileTreeBtn);

  // Ctrl/Cmd+Shift+B 反链面板快捷键
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      toggleBacklinks();
    }
  });

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
    if (keepClass !== 'show-filetree') fileTreeOpen = false;
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
    }
    setTimeout(function() { mainEditor.resize(); }, 250);
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
    if (!outlineData.length) {
      list.innerHTML = '<div class="outline-empty">暂无标题</div>';
      return;
    }
    list.innerHTML = '';
    outlineData.forEach(function(item, idx) {
      var row = document.createElement('div');
      row.className = 'outline-item' + (item.isTitle ? ' outline-title' : '');
      row.style.paddingLeft = (item.level - 1) * 16 + 'px';
      row.dataset.line = String(item.line);
      row.innerHTML = (item.isTitle
          ? '<span class="outline-marker outline-marker-title">◉</span>'
          : '<span class="outline-marker">' + ('#'.repeat(item.level)) + '</span>')
        + '<span class="outline-label">' + escapeHtml(item.text) + '</span>'
        + '<span class="outline-line">' + (item.isTitle ? '文首' : 'L' + (item.line + 1)) + '</span>';
      row.title = item.isTitle ? '文档标题' : '跳转到第 ' + (item.line + 1) + ' 行';
      row.addEventListener('click', function() {
        goToLine(parseInt(this.dataset.line, 10));
        highlightOutlineRow(this);
      });
      list.appendChild(row);
    });
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
  var outlineBtn = createStatusBtn('大纲', '☰', '文档大纲', 'Ctrl+Shift+D');
  outlineBtn.addEventListener('click', function() { toggleOutline(); });
  elements.runtimeStatus.parentNode.insertBefore(outlineBtn, elements.runtimeStatus);

  // 全局文件搜索按钮（底部状态栏右侧，Ctrl+O）
  // 注意：createStatusBtn 会自动拼接 "(shortcut)"，title 里不要再重复写快捷键，否则悬浮提示会出现两个 Ctrl+O
  var quickSearchBtn = createStatusBtn('搜索', '🔍', '快速打开文件', 'Ctrl+O');
  quickSearchBtn.addEventListener('click', function() { openQuickSwitcher(); });
  elements.runtimeStatus.parentNode.insertBefore(quickSearchBtn, elements.runtimeStatus);

  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      toggleOutline();
    }
  });

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
  function tagPattern(tag) {
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
  var tagsBtn = createStatusBtn('标签', '#', '文档标签', 'Ctrl+Shift+T');
  tagsBtn.addEventListener('click', function() { toggleTags(); });
  elements.runtimeStatus.parentNode.insertBefore(tagsBtn, elements.runtimeStatus);

  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      toggleTags();
    }
  });

  // ── 命令面板(Ctrl+P) ──
  var commandRegistry = [];
  function registerCommand(id, name, icon, handler, shortcut) {
    commandRegistry.push({ id: id, name: name, icon: icon, handler: handler, shortcut: shortcut || '' });
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
  registerCommand('new', '新建文件', '📄', function() { createNewTab(); });
  registerCommand('open', '打开文件…', '📁', function() { openMainFile(); });
  registerCommand('quick-open', '快速打开文件', '🔍', function() { openQuickSwitcher(); }, 'Ctrl+O');
  registerCommand('save', '保存', '💾', function() { saveFile(false); });
  registerCommand('save-as', '另存为…', '📋', function() { saveFile(true); });
  registerCommand('outline', '切换大纲面板', '☰', function() { toggleOutline(); });
  registerCommand('tags', '切换标签面板', '#', function() { toggleTags(); });
  registerCommand('backlinks', '切换反链面板', '🔗', function() { toggleBacklinks(); });
  registerCommand('compare', '对比模式', '⇄', function() { toggleCompare(); });
  registerCommand('markdown', 'Markdown 预览', '👁', function() { toggleMarkdownPreview(); });
  registerCommand('export-word', '导出 Word (.docx)', '📝', function() { exportToWord(); });
  registerCommand('settings', '编辑器设置', '⚙', function() { openSettingsModal(); });

  var paletteOpen = false;
  var paletteIndex = 0;
  var paletteFiltered = [];

  function openCommandPalette() {
    paletteOpen = true;
    paletteIndex = 0;
    elements.commandPalette.hidden = false;
    elements.commandPalette.setAttribute('aria-hidden', 'false');
    renderCommandList('');
    elements.commandPaletteInput.value = '';
    elements.commandPaletteInput.focus();
  }

  function closeCommandPalette() {
    paletteOpen = false;
    elements.commandPalette.hidden = true;
    elements.commandPalette.setAttribute('aria-hidden', 'true');
    mainEditor.focus();
  }

  function renderCommandList(query) {
    var q = (query || '').trim().toLowerCase();
    paletteFiltered = q
      ? commandRegistry.filter(function(c) { return c.name.toLowerCase().indexOf(q) !== -1 || c.id.toLowerCase().indexOf(q) !== -1; })
      : commandRegistry.slice();
    var list = elements.commandPaletteList;
    list.innerHTML = '';
    if (!paletteFiltered.length) {
      list.innerHTML = '<div class="command-palette-empty">无匹配命令</div>';
      return;
    }
    paletteIndex = Math.min(paletteIndex, paletteFiltered.length - 1);
    paletteFiltered.forEach(function(c, i) {
      var item = document.createElement('div');
      item.className = 'command-palette-item' + (i === paletteIndex ? ' active' : '');
      item.innerHTML = '<span class="command-palette-item-icon">' + c.icon + '</span>'
        + '<span class="command-palette-item-name">' + escapeHtml(c.name) + '</span>'
        + (c.shortcut ? '<span class="command-palette-item-shortcut">' + platformShortcut(c.shortcut) + '</span>' : '');
      item.addEventListener('mousedown', function(ev) { ev.preventDefault(); executeCommand(i); });
      item.addEventListener('mouseenter', function() { setPaletteIndex(i); });
      list.appendChild(item);
    });
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
    closeCommandPalette();
    try { cmd.handler(); } catch (e) { showToast('命令执行失败：' + e.message, true); }
  }

  elements.commandPaletteInput.addEventListener('input', function() {
    paletteIndex = 0;
    renderCommandList(this.value);
  });
  elements.commandPaletteInput.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeCommandPalette(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setPaletteIndex(Math.min(paletteIndex + 1, paletteFiltered.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setPaletteIndex(Math.max(paletteIndex - 1, 0)); return; }
    if (e.key === 'Enter') { e.preventDefault(); executeCommand(paletteIndex); return; }
  });

  // 点击遮罩关闭
  elements.commandPalette.addEventListener('mousedown', function(e) { e.stopPropagation(); });
  document.addEventListener('mousedown', function(e) {
    if (paletteOpen && !elements.commandPalette.contains(e.target)) closeCommandPalette();
  });

  // Ctrl/Cmd+P 唤起命令面板（排除 Shift/Alt，避免与其它 Ctrl+Shift 快捷键冲突）
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === 'p') {
      e.preventDefault();
      if (quickOpenVisible) closeQuickSwitcher();
      if (paletteOpen) closeCommandPalette(); else openCommandPalette();
    }
  });

  // ── 全局文件快速搜索（Ctrl+O，Obsidian Quick Switcher 风格）──
  var quickOpenVisible = false;
  var quickIndex = 0;
  var quickFiltered = [];

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
  function fuzzyScore(query, str) {
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
      list.innerHTML = '<div class="command-palette-empty">' + (all.length ? '无匹配文件' : '暂无文件索引，请先打开桌面应用') + '</div>';
      return;
    }
    quickIndex = Math.min(quickIndex, quickFiltered.length - 1);
    quickFiltered.forEach(function(t, i) {
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
      list.appendChild(item);
    });
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
    renderQuickList(this.value);
  });
  elements.quickSwitcherInput.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeQuickSwitcher(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setQuickIndex(Math.min(quickIndex + 1, quickFiltered.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setQuickIndex(Math.max(quickIndex - 1, 0)); return; }
    if (e.key === 'Enter') { e.preventDefault(); executeQuickOpen(quickIndex); return; }
  });

  // 点击遮罩关闭
  elements.quickSwitcher.addEventListener('mousedown', function(e) { e.stopPropagation(); });
  document.addEventListener('mousedown', function(e) {
    if (quickOpenVisible && !elements.quickSwitcher.contains(e.target)) closeQuickSwitcher();
  });

  // Ctrl/Cmd+O 唤起全局文件搜索（排除 Shift/Alt，避免与 Ctrl+Shift+O 大纲等冲突）
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === 'o') {
      e.preventDefault();
      if (quickOpenVisible) closeQuickSwitcher(); else openQuickSwitcher();
    }
  });

  // ── 模板系统：列表/读取/插入/变量替换 ──
  function templateFormatDate(d) {
    var pad = function(n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function templateNow() {
    var d = new Date();
    var pad = function(n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function replaceTemplateVars(content) {
    var vars = {
      '{{date}}': templateFormatDate(new Date()),
      '{{now}}': templateNow(),
      '{{title}}': getCurrentFileName().replace(/\.[^.]+$/, ''),
      '{{author}}': ''
    };
    return Object.keys(vars).reduce(function(s, k) { return s.split(k).join(vars[k]); }, content);
  }

  async function insertTemplateByName(name) {
    var api = getElectronAPI();
    if (!api || !api.listTemplates) { showToast('模板功能仅桌面模式可用', true); return; }
    try {
      var list = await api.listTemplates();
      var tpl = (list || []).find(function(t) { return t.name === name; });
      if (!tpl) { showToast('未找到模板：' + name, true); return; }
      var content = await api.readTemplate(tpl.name);
      var resolved = replaceTemplateVars(content || '');
      mainEditor.session.insert(mainEditor.getCursorPosition(), resolved);
      mainEditor.focus();
      showToast('已插入模板 ' + name);
    } catch (e) {
      showToast('模板插入失败：' + e.message, true);
    }
  }

  // 模板命令面板入口（命令面板 markdown 模板自动注册）
  registerCommand('template', '插入模板…', '📌', function() { openTemplatePicker(); });

  function openTemplatePicker() {
    var api = getElectronAPI();
    if (!api || !api.listTemplates) { showToast('模板功能仅桌面模式可用', true); return; }
    api.listTemplates().then(function(list) {
      var names = (list || []).map(function(t) { return t.name; });
      if (!names.length) { showToast('暂无模板，请在知识库 templates 目录创建', true); return; }
      // 复用命令面板做模板选择
      paletteOpen = true;
      paletteFiltered = names.map(function(n) {
        return { id: 'tpl-' + n, name: n, icon: '📌', handler: function() { insertTemplateByName(n); } };
      });
      paletteIndex = 0;
      elements.commandPalette.hidden = false;
      elements.commandPalette.setAttribute('aria-hidden', 'false');
      renderTemplateList(names);
      elements.commandPaletteInput.value = '';
      elements.commandPaletteInput.focus();
    }).catch(function(err) { showToast('模板加载失败：' + err.message, true); });
  }

  function renderTemplateList(names) {
    var list = elements.commandPaletteList;
    list.innerHTML = '';
    names.forEach(function(n, i) {
      var item = document.createElement('div');
      item.className = 'command-palette-item' + (i === paletteIndex ? ' active' : '');
      item.innerHTML = '<span class="command-palette-item-icon">📌</span><span class="command-palette-item-name">' + escapeHtml(n) + '</span>';
      item.addEventListener('mousedown', function(ev) { ev.preventDefault(); executeTemplate(i); });
      item.addEventListener('mouseenter', function() { paletteIndex = i; setPaletteIndex(i); });
      list.appendChild(item);
    });
  }
  function executeTemplate(i) {
    var item = paletteFiltered[i];
    closeCommandPalette();
    if (item) item.handler();
  }

  window.parent.postMessage({ type: 'editorReady' }, '*');

  // ── 系统右键菜单事件处理 ──
  // 注意：右键菜单的 IPC 事件统一由父页面（index.html）监听并处理，
  // 父页面读取文件内容后通过 postMessage（openFileData / openTextData）转发到本编辑器。
  // 此处不再重复注册 IPC 监听器，避免与父页面处理器双重触发。
})();
