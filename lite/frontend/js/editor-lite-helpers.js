  // ============================================================
  // Lite 版独有辅助：启动完整版 + AI 配置面板 + 全局快捷键
  // ============================================================

  let cachedLiteAiConfig = null;
  async function getLiteAiConfig() {
    if (cachedLiteAiConfig) return cachedLiteAiConfig;
    try {
      const cfg = await window.liteAPI.ai.getConfig();
      cachedLiteAiConfig = cfg || {};
    } catch (_) {
      cachedLiteAiConfig = {};
    }
    return cachedLiteAiConfig;
  }

  async function launchFullVersion() {
    try {
      const result = await window.liteAPI.launch.full();
      if (!result || result.ok === false) {
        if (result && result.reason === 'user_canceled') return;
        showToast('启动完整版失败：' + (result && result.message ? result.message : '未知错误'), true);
      } else {
        showToast('正在启动完整版...');
      }
    } catch (err) {
      showToast('启动完整版失败：' + (err.message || err), true);
    }
  }

  if (window.liteAPI && window.liteAPI.onToast) {
    window.liteAPI.onToast((data) => {
      if (data && data.message) showToast(data.message);
    });
  }

  function openLiteAiSettings() {
    if (!elements.liteAiSettingsModal) return;
    getLiteAiConfig().then((cfg) => {
      const provider = (cfg && cfg.activeProvider) || 'deepseek';
      if (elements.liteAiDeepseekKey) elements.liteAiDeepseekKey.value = cfg.deepseekApiKey || '';
      if (elements.liteAiDeepseekModel) elements.liteAiDeepseekModel.value = cfg.deepseekModel || 'deepseek-chat';
      if (elements.liteAiDashscopeKey) elements.liteAiDashscopeKey.value = cfg.dashscopeApiKey || '';
      if (elements.liteAiDashscopeModel) elements.liteAiDashscopeModel.value = cfg.dashscopeModel || 'qwen-plus';
      const radios = document.querySelectorAll('input[name="liteAiProvider"]');
      radios.forEach(r => { r.checked = (r.value === provider); });
      openModal(elements.liteAiSettingsModal);
    });
  }

  function closeLiteAiSettings() {
    if (elements.liteAiSettingsModal) closeModal(elements.liteAiSettingsModal);
  }

  async function saveLiteAiSettings() {
    const radios = document.querySelectorAll('input[name="liteAiProvider"]');
    let provider = 'deepseek';
    radios.forEach(r => { if (r.checked) provider = r.value; });
    const next = {
      activeProvider: provider,
      deepseekApiKey: (elements.liteAiDeepseekKey && elements.liteAiDeepseekKey.value || '').trim(),
      deepseekModel: (elements.liteAiDeepseekModel && elements.liteAiDeepseekModel.value || 'deepseek-chat').trim(),
      dashscopeApiKey: (elements.liteAiDashscopeKey && elements.liteAiDashscopeKey.value || '').trim(),
      dashscopeModel: (elements.liteAiDashscopeModel && elements.liteAiDashscopeModel.value || 'qwen-plus').trim()
    };
    try {
      const result = await window.liteAPI.ai.saveConfig(next);
      if (result && result.aiConfig) cachedLiteAiConfig = result.aiConfig;
      showToast('AI 设置已保存');
      closeLiteAiSettings();
    } catch (err) {
      showToast('保存失败：' + (err.message || err), true);
    }
  }

  function toggleLiteAiKeyVisibility() {
    const fields = [elements.liteAiDeepseekKey, elements.liteAiDashscopeKey].filter(Boolean);
    const show = !(elements.liteAiShowKeyBtn && elements.liteAiShowKeyBtn.dataset.shown === '1');
    fields.forEach(f => { f.type = show ? 'text' : 'password'; });
    if (elements.liteAiShowKeyBtn) {
      elements.liteAiShowKeyBtn.dataset.shown = show ? '1' : '0';
      elements.liteAiShowKeyBtn.textContent = show ? '隐藏 Key' : '显示 Key';
    }
  }

  function trySetDefaultWorkspace() {
    if (!window.liteAPI || !window.liteAPI.workspace) return;
    window.liteAPI.workspace.get().then((res) => {
      if (!res || !res.dir) return;
      try {
        const tree = elements.fileTreePane;
        if (tree && typeof window.EditorCore !== 'undefined' && window.EditorCore.setWorkspaceDir) {
          window.EditorCore.setWorkspaceDir(res.dir);
        }
      } catch (_) {}
    }).catch(() => {});
  }

  elements.launchFullBtn?.addEventListener('click', launchFullVersion);
  elements.liteAiSettingsBtn?.addEventListener('click', openLiteAiSettings);
  elements.liteAiSettingsClose?.addEventListener('click', closeLiteAiSettings);
  elements.liteAiSaveBtn?.addEventListener('click', saveLiteAiSettings);
  elements.liteAiShowKeyBtn?.addEventListener('click', toggleLiteAiKeyVisibility);

  // 注册编辑器内 Ctrl+Shift+O 启动完整版
  try {
    mainEditor.commands.addCommand({
      name: 'launchFullVersion',
      bindKey: { win: 'Ctrl-Shift-O', mac: 'Command-Shift-O' },
      exec: launchFullVersion,
      readOnly: false
    });
  } catch (_) {}

  // 启动时拉取默认 workspace
  trySetDefaultWorkspace();

