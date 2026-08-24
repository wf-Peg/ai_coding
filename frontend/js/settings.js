const API_BASE = 'http://127.0.0.1:8081/api/config';
const MODEL_TEST_BASE = 'http://127.0.0.1:8081/api/model-config';
const THEME_KEY = 'app_theme_v1';
const APPEARANCE_KEY = 'app_appearance_v1'; // regular | dark | notion | system | focus | calm | studio
const MOTION_KEY = 'app_motion_v1'; // full | reduced
let currentStoragePath = ''; // 用于检测路径变更

const themeCore = window.CutShelterThemeCore;
const themeBridge = window.CutShelterThemeBridge;

// ====== 外观管理 ======
function getEffectiveTheme() {
  const appearance = localStorage.getItem(APPEARANCE_KEY) || 'notion';
  return themeCore.resolveAppearance(appearance, window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function getMotion() {
  return themeCore.readStoredMotion(localStorage);
}

function applyAppearance(appearance) {
  localStorage.setItem(APPEARANCE_KEY, appearance);
  const theme = getEffectiveTheme();
  const motion = getMotion();
  themeBridge.apply(theme, motion, { persist: true });
  renderThemeCards();
  // 通知父页面（父页面作为唯一事实来源会重新广播）
  try { window.parent.postMessage({ type: 'appearanceChanged', appearance: appearance }, '*'); } catch(e) {}
}

function applyMotion(motion) {
  const theme = getEffectiveTheme();
  const m = themeCore.normalizeMotion(motion);
  localStorage.setItem(MOTION_KEY, m);
  themeBridge.apply(theme, m, { persist: true });
}

function onAppearanceChange() {
  applyAppearance(document.getElementById('appearanceSelect')?.value || 'notion');
}

function onSystemThemeChange() {
  const checked = document.getElementById('systemThemeToggle').checked;
  applyAppearance(checked ? 'system' : getEffectiveTheme());
}

function onReduceMotionChange() {
  applyMotion(document.getElementById('reduceMotionToggle').checked ? 'reduced' : 'full');
}

function applyTheme() {
  const theme = getEffectiveTheme();
  const motion = getMotion();
  themeBridge.apply(theme, motion, { persist: false });
  renderThemeCards();
}

function renderThemeCards() {
  const grid = document.getElementById('themeCardGrid');
  const effective = getEffectiveTheme();
  const appearance = localStorage.getItem(APPEARANCE_KEY) || 'notion';
  if (grid) {
    grid.querySelectorAll('.theme-card').forEach(card => {
      const isActive = appearance !== 'system' && card.dataset.theme === effective;
      card.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
  }
  const systemToggle = document.getElementById('systemThemeToggle');
  if (systemToggle) systemToggle.checked = appearance === 'system';
  const reduceToggle = document.getElementById('reduceMotionToggle');
  if (reduceToggle) reduceToggle.checked = getMotion() === 'reduced';
}

// 初始化外观
(function initAppearance() {
  const appearance = localStorage.getItem(APPEARANCE_KEY) || 'notion';
  const theme = getEffectiveTheme();
  const motion = getMotion();
  themeBridge.apply(theme, motion, { persist: false });

  // 主题卡片点击
  const grid = document.getElementById('themeCardGrid');
  if (grid) {
    grid.addEventListener('click', function(e) {
      const card = e.target.closest('.theme-card');
      if (!card) return;
      const themeName = card.dataset.theme;
      localStorage.setItem(APPEARANCE_KEY, themeName);
      applyAppearance(themeName);
      const nameEl = card.querySelector('.theme-card__name');
      showToast('已切换主题：' + (nameEl ? nameEl.textContent : themeName));
    });
  }

  window.addEventListener('storage', function(e) {
    if (e.key === THEME_KEY || e.key === APPEARANCE_KEY || e.key === MOTION_KEY) {
      applyTheme();
    }
  });

  // 监听系统主题变化
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const appearance = localStorage.getItem(APPEARANCE_KEY) || 'notion';
    if (appearance === 'system') {
      applyTheme();
    }
  });

  // 监听父页面广播的主题变更并回执
  themeBridge.listen({ onChange: function () { renderThemeCards(); } });

  renderThemeCards();
})();

// 加载配置
async function loadConfig() {
  try {
    const response = await fetch(API_BASE);
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('后端未更新（返回 404），请重新编译后端后再试');
      }
      throw new Error('后端返回状态码: ' + response.status);
    }
    const config = await response.json();
    // AI 模型配置
    document.getElementById('activeProvider').value = config.activeProvider || 'dashscope';
    document.getElementById('dashscopeApiKey').value = config.dashscopeApiKey || '';
    document.getElementById('dashscopeModel').value = config.dashscopeModel || 'qwen-plus';
    document.getElementById('deepseekApiKey').value = config.deepseekApiKey || '';
    document.getElementById('deepseekModel').value = config.deepseekModel || 'deepseek-v4-flash';
    document.getElementById('customProviderName').value = config.customProviderName || '';
    document.getElementById('customBaseUrl').value = config.customBaseUrl || '';
    document.getElementById('customApiKey').value = config.customApiKey || '';
    document.getElementById('customModel').value = config.customModel || '';
    // 任务档位模型名
    document.getElementById('simpleTierModel').value = config.simpleTierModel || 'deepseek-v4-flash';
    document.getElementById('strongTierModel').value = config.strongTierModel || 'deepseek-v4-pro';
    onProviderChange();
    loadMascotConfig();

    // 邮件配置
    document.getElementById('mailEnabled').checked = config.mailEnabled === true;
    document.getElementById('mailHost').value = config.mailHost || '';
    document.getElementById('mailPort').value = config.mailPort || 465;
    document.getElementById('mailUsername').value = config.mailUsername || '';
    document.getElementById('mailPassword').value = config.mailPassword || '';
    onMailToggle();

    // Git 配置
    document.getElementById('gitRemoteUrl').value = config.gitRemoteUrl || '';
    document.getElementById('gitUsername').value = config.gitUsername || '';
    document.getElementById('gitPassword').value = config.gitPassword || '';
    document.getElementById('gitBranch').value = config.gitBranch || 'main';

    // Exa 搜索配置（未配置时默认关闭）
    document.getElementById('exaApiKey').value = config.exaApiKey || '';
    document.getElementById('exaEnabled').checked = config.exaEnabled === true;

    // PDF OCR 配置
    document.getElementById('pdfOcrBaseUrl').value = config.pdfOcrBaseUrl || '';
    document.getElementById('pdfOcrApiKey').value = config.pdfOcrApiKey || '';
    document.getElementById('pdfOcrEnabled').checked = config.pdfOcrEnabled !== false;
    document.getElementById('pdfOcrModel').value = config.pdfOcrModel || 'qwen-vl-plus';
    document.getElementById('pdfOcrMinTextLength').value = config.pdfOcrMinTextLength || 15;

    // 存储路径（可配置）
    const rootPath = config.storagePath || '';
    document.getElementById('storagePath').value = rootPath;
    currentStoragePath = rootPath;
    updateDerivedPaths(rootPath);

    // 本地配置文件路径（Electron config.json + 后端 app-config.json）
    loadElectronConfigPath();
    loadConfigFilePath();

    const electronAPI = getElectronAPI();
    if (electronAPI && electronAPI.getAutoStart) {
      try {
        document.getElementById('autoStartToggle').checked = await electronAPI.getAutoStart();
      } catch (error) {
        console.warn('读取开机自启状态失败:', error);
      }
    }

    showToast('配置加载成功');
  } catch (error) {
    console.error('加载配置失败:', error);
    const errDiv = document.createElement('div');
    errDiv.className = 'backend-error';
    errDiv.innerHTML = '<strong>⚠️ 无法连接后端服务</strong><br>请确保 Spring Boot 后端已在 <strong>http://127.0.0.1:8081</strong> 启动';
    const existing = document.querySelector('.backend-error');
    if (existing) existing.remove();
    document.querySelector('.page-title').after(errDiv);
    showToast('加载配置失败，请检查后端服务');
  }
}

const MASCOT_CONFIG_KEY = 'cut_shelter_mascot_v1';
const MASCOT_ACTIONS = ['run', 'wave', 'jump', 'think', 'sleep', 'celebrate'];
const MASCOT_ACTION_LABELS = { run: '奔跑中', wave: '挥手中', jump: '跳跃中', think: '思考中', sleep: '打盹中', celebrate: '庆祝中' };
const MASCOT_ACTION_NAMES = { run: '奔跑', wave: '挥手', jump: '跳跃', think: '思考', sleep: '打盹', celebrate: '庆祝' };
const MASCOT_COLORS = ['#569cff', '#e5b93f', '#49b883', '#2d3748', '#e05d76', '#d0a23c'];
const MASCOT_PRESETS = [
  { id: 'robot-blue', name: '机器宝宝', color: '#569cff' },
  { id: 'pikachu-yellow', name: '皮卡丘', color: '#e5b93f' },
  { id: 'turtle-green', name: '杰尼龟', color: '#49b883' },
  { id: 'luoxiaohei', name: '罗小黑', color: '#2d3748' }
];

function buildMascotImageUrl(characterId, action) {
  return `assets/mascot/${characterId}/${action}.png`;
}

function createEmptyCharUploads() {
  return { run: '', wave: '', jump: '', think: '', sleep: '', celebrate: '' };
}

function createEmptyUploads() {
  return MASCOT_PRESETS.reduce((acc, p) => { acc[p.id] = createEmptyCharUploads(); return acc; }, {});
}

function getCharUploads(config, characterId) {
  const uploads = config.iconDataUrls;
  if (!uploads) return createEmptyCharUploads();
  const isLegacy = Object.keys(uploads).some(k => MASCOT_ACTIONS.includes(k));
  if (isLegacy) return uploads;
  return uploads[characterId] || createEmptyCharUploads();
}

function getMascotConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(MASCOT_CONFIG_KEY) || '{}');
    const history = Array.isArray(raw.history) ? raw.history : [];
    const iconId = (raw.iconId && !raw.iconId.startsWith('upload-')) ? raw.iconId : 'luoxiaohei';
    const defaults = {
      prompt: '', action: 'run', color: MASCOT_COLORS[3],
      iconType: 'preset-images', iconId,
      iconSvg: buildMascotSvg('turtle-green'),
      iconDataUrls: createEmptyUploads(),
      iconDataUrl: '',
      history, currentId: raw.currentId || history[0]?.id || null
    };
    const config = { ...defaults, ...raw, iconId };
    // 兼容旧数据：旧版只有 iconDataUrl 没有 iconDataUrls
    if (config.iconDataUrl && (!config.iconDataUrls || Object.keys(config.iconDataUrls).length === 0)) {
      config.iconDataUrls = { ...createEmptyUploads(), [iconId]: { ...createEmptyCharUploads(), [config.action || 'run']: config.iconDataUrl } };
    }
    // 归一化 iconDataUrls：旧格式（动作维度）迁移为按宠物嵌套，缺失的宠物补空
    const uploads = config.iconDataUrls;
    if (uploads) {
      const isLegacy = Object.keys(uploads).some(k => MASCOT_ACTIONS.includes(k));
      if (isLegacy) {
        config.iconDataUrls = { ...createEmptyUploads(), [iconId]: { ...createEmptyCharUploads(), ...uploads } };
      } else {
        MASCOT_PRESETS.forEach(p => { if (!config.iconDataUrls[p.id]) config.iconDataUrls[p.id] = createEmptyCharUploads(); });
      }
    }
    return config;
  } catch (_) {
    return {
      prompt: '', action: 'run', color: MASCOT_COLORS[3],
      iconType: 'preset-images', iconId: 'luoxiaohei',
      iconSvg: buildMascotSvg('turtle-green'),
      iconDataUrls: createEmptyUploads(),
      iconDataUrl: '', history: [], currentId: null
    };
  }
}

function loadMascotConfig() {
  const config = getMascotConfig();
  const action = document.getElementById('mascotAction');
  if (action) action.value = config.action;
  renderMascotPresets(config);
  renderMascotPreview(config.action, config.color);
  renderMascotUploadList();
  renderMascotHistory();
}

function renderMascotPreview(action, color = MASCOT_COLORS[3]) {
  const label = document.getElementById('mascotActionLabel');
  if (label) label.textContent = MASCOT_ACTION_LABELS[action] || MASCOT_ACTION_LABELS.run;
  const preview = document.getElementById('mascotPreview');
  if (preview) {
    preview.dataset.action = action;
    preview.style.setProperty('--mascot-color', color);
    const icon = preview.querySelector('.mascot-preview-dino');
    if (icon) {
      const config = getMascotConfig();
      icon.innerHTML = getMascotIconHtml(config, action);
    }
  }
}

function getMascotIconHtml(config, action) {
  const a = action || config.action || 'run';
  if (config.iconType === 'preset-images') {
    return `<img src="${buildMascotImageUrl(config.iconId, a)}" alt="Pet图标" class="mascot-preview-img">`;
  }
  if (config.iconType === 'upload') {
    const url = getCharUploads(config, config.iconId)[a];
    if (url) return `<img src="${url}" alt="自定义Pet图标" class="mascot-preview-img">`;
    // 如果当前动作没有上传图片，尝试用预设图兜底
    return `<img src="${buildMascotImageUrl(config.iconId, a)}" alt="Pet图标" class="mascot-preview-img">`;
  }
  // 旧版 preset 兼容
  return config.iconSvg || buildMascotSvg(config.iconId);
}

function renderMascotPresets(config = getMascotConfig()) {
  const list = document.getElementById('mascotPresetList');
  if (!list) return;
  list.innerHTML = MASCOT_PRESETS.map(preset => {
    const isActive = config.iconId === preset.id && config.iconType !== 'upload';
    // 每个预设使用固定的 'run' 动作显示缩略图，避免受当前 config.action 影响
    const imgSrc = buildMascotImageUrl(preset.id, 'run');
    return `<button type="button" class="mascot-preset${isActive ? ' active' : ''}" data-mascot-preset="${preset.id}" style="--mascot-color:${preset.color}"><span><img src="${imgSrc}" alt="${preset.name}" class="mascot-preset-img"></span><small>${preset.name}</small></button>`;
  }).join('');
}

function applyMascotConfig(next) {
  localStorage.setItem(MASCOT_CONFIG_KEY, JSON.stringify(next));
  notifyMascotChanged(next);
  // 上传模式不重绘预设列表，避免其他角色图标被切换为当前动作导致显示异常
  if (next.iconType !== 'upload') {
    renderMascotPresets(next);
  }
  renderMascotPreview(next.action, next.color);
  renderMascotUploadList();
  showToast('Pet图标已应用');
}

function handleMascotPreset(event) {
  const id = event.target.closest('[data-mascot-preset]')?.dataset.mascotPreset;
  if (!id) return;
  const preset = MASCOT_PRESETS.find(item => item.id === id);
  if (!preset) return;
  const config = getMascotConfig();
  applyMascotConfig({
    ...config,
    iconType: 'preset-images',
    iconId: preset.id,
    iconSvg: buildMascotSvg('turtle-green'),
    iconDataUrl: '',
    color: preset.color
  });
}

function handleMascotMultiUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const action = event.target.dataset.action;
  if (!action || !MASCOT_ACTIONS.includes(action)) { showToast('未知的动作标识'); event.target.value = ''; return; }
  // 更新文件名显示
  const nameSpan = document.getElementById(`mascotUploadName_${action}`);
  if (nameSpan) nameSpan.textContent = file.name;
  // 校验文件类型
  if (!file.type.startsWith('image/png') && !file.name.toLowerCase().endsWith('.png')) {
    showToast('只支持 PNG 格式的图片'); event.target.value = ''; return;
  }
  // 校验文件大小 ≤2MB
  if (file.size > 2 * 1024 * 1024) { showToast('图标不能超过 2MB'); event.target.value = ''; return; }
  const reader = new FileReader();
  reader.onload = () => {
    const config = getMascotConfig();
    config.iconType = 'upload';
    // 保留原始 preset iconId，确保未上传动作的预览图使用预设图片路径而非碎图
    if (!config.iconId || config.iconId.startsWith('upload-')) {
      config.iconId = 'luoxiaohei';
    }
    config.iconDataUrls = config.iconDataUrls || createEmptyUploads();
    if (!config.iconDataUrls[config.iconId]) config.iconDataUrls[config.iconId] = createEmptyCharUploads();
    // 按宠物隔离存储：只写入当前宠物的动作图标，不影响其他宠物
    config.iconDataUrls[config.iconId][action] = reader.result;
    config.iconDataUrl = ''; // 清空旧字段
    // 注意：不改动 config.action，避免其他角色预设卡片被切换为当前动作
    applyMascotConfig(config);
    // 单独更新预览区显示上传的图片（不改变 config.action）
    renderMascotPreview(action, config.color);
    // 保存到本地文件系统（覆盖原预设图标），使编辑器也能看到新图标
    const api = getElectronAPI();
    if (api && api.saveMascotImage) {
      api.saveMascotImage(config.iconId, action, reader.result).catch(() => {});
    }
  };
  reader.readAsDataURL(file);
}

function handleMascotActionChange(event) {
  const config = getMascotConfig();
  const next = { ...config, action: event.target.value };
  applyMascotConfig(next);
}

function renderMascotUploadList() {
  const container = document.getElementById('mascotUploadList');
  if (!container) return;
  const config = getMascotConfig();
  container.innerHTML = MASCOT_ACTIONS.map(action => {
    const charUploads = getCharUploads(config, config.iconId);
    const url = charUploads[action] || '';
    const hasFile = !!url;
    const fileName = hasFile ? '已选择' : '未选择';
    const previewSrc = hasFile ? url : buildMascotImageUrl(config.iconId, action);
    return `<div class="mascot-upload-row" data-action="${action}">
      <label class="mascot-upload-action-label">${MASCOT_ACTION_NAMES[action] || action}</label>
      <div class="mascot-upload-preview"><img src="${previewSrc}" alt="${MASCOT_ACTION_NAMES[action] || action}" class="mascot-upload-thumb"></div>
      <div class="mascot-upload-control">
        <label class="mascot-upload-button" for="mascotUpload_${action}">选择文件</label>
        <span class="mascot-upload-name" id="mascotUploadName_${action}">${hasFile ? fileName : '未选择'}</span>
        <input type="file" id="mascotUpload_${action}" accept="image/png" data-action="${action}" />
      </div>
    </div>`;
  }).join('');
  // 绑定事件
  MASCOT_ACTIONS.forEach(action => {
    const input = document.getElementById(`mascotUpload_${action}`);
    if (input) {
      input.removeEventListener('change', handleMascotMultiUpload);
      input.addEventListener('change', handleMascotMultiUpload);
    }
  });
}

function notifyMascotChanged(config) {
  try {
    window.dispatchEvent(new StorageEvent('storage', { key: MASCOT_CONFIG_KEY, newValue: JSON.stringify(config) }));
  } catch (_) {}
  try { window.parent.postMessage({ type: 'mascotChanged', mascot: config }, '*'); } catch (_) {}
  try { new BroadcastChannel('cut-shelter-mascot').postMessage(config); } catch (_) {}
}

function generateMascotIcon() {
  const prompt = document.getElementById('mascotPrompt')?.value.trim() || '一只边跑边挥手的绿色小恐龙';
  const action = document.getElementById('mascotAction')?.value || 'run';
  const config = getMascotConfig();
  const color = MASCOT_COLORS[Math.abs([...prompt].reduce((sum, char) => sum + char.codePointAt(0), 0)) % MASCOT_COLORS.length];
  const item = { id: `mascot_${Date.now()}`, prompt, action, color, iconType: config.iconType, iconId: config.iconId, iconSvg: config.iconSvg || '', iconDataUrls: { ...config.iconDataUrls }, iconDataUrl: config.iconDataUrl || '', createdAt: Date.now() };
  config.history = [item, ...config.history.filter(entry => entry.prompt !== prompt || entry.action !== action)].slice(0, 30);
  config.currentId = item.id;
  config.prompt = prompt;
  config.action = action;
  config.color = color;
  localStorage.setItem(MASCOT_CONFIG_KEY, JSON.stringify(config));
  notifyMascotChanged(config);
  renderMascotPreview(action, color);
  renderMascotHistory();
  const hint = document.getElementById('mascotGeneratedHint');
  if (hint) hint.textContent = `已生成：${prompt}（${MASCOT_ACTION_LABELS[action]}）`;
  showToast('机器人图标已生成并应用');
}

function renderMascotHistory() {
  const list = document.getElementById('mascotHistoryList');
  if (!list) return;
  const config = getMascotConfig();
  const filter = (document.getElementById('mascotHistoryFilter')?.value || '').trim().toLowerCase();
  const items = config.history.filter(item => `${item.prompt} ${MASCOT_ACTION_LABELS[item.action] || ''}`.toLowerCase().includes(filter));
  if (!items.length) { list.innerHTML = '<div class="form-hint">暂无匹配的历史图标</div>'; return; }
  list.innerHTML = items.map(item => `<div class="mascot-history-item${item.id === config.currentId ? ' current' : ''}">
    <div class="mascot-history-icon" style="--mascot-color:${item.color}">${renderHistoryIcon(item)}</div>
    <div class="mascot-history-copy"><div class="mascot-history-prompt" title="${escapeHtml(item.prompt)}">${escapeHtml(item.prompt)}</div><div class="mascot-history-meta">${MASCOT_ACTION_LABELS[item.action] || '奔跑中'}</div></div>
    <div class="mascot-history-actions"><button type="button" data-mascot-use="${item.id}">使用</button><button type="button" data-mascot-delete="${item.id}">删除</button></div>
  </div>`).join('');
}

function renderHistoryIcon(item) {
  // 优先使用 iconDataUrls（按宠物隔离的 6 动作独立上传）
  if (item.iconDataUrls) {
    // 按动作显示对应图片
    const charUploads = getCharUploads(item, item.iconId || 'luoxiaohei');
    const url = charUploads[item.action || 'run'];
    if (url) {
      return `<img src="${url}" alt="历史Pet图标">`;
    }
    // 兜底：显示第一个有图片的动作
    const urls = Object.values(charUploads).filter(Boolean);
    if (urls.length > 0) {
      return `<img src="${urls[0]}" alt="历史Pet图标">`;
    }
  }
  if (item.iconType === 'upload' && item.iconDataUrl) {
    return `<img src="${item.iconDataUrl}" alt="历史Pet图标">`;
  }
  // 使用预设图片
  if (item.iconId && MASCOT_PRESETS.some(p => p.id === item.iconId)) {
    return `<img src="${buildMascotImageUrl(item.iconId, item.action || 'run')}" alt="历史Pet图标">`;
  }
  return item.iconSvg || buildMascotSvg(item.iconId || 'turtle-green');
}

function buildMascotSvg(id) {
  // 兜底 fallback：一个最简 SVG 头像
  return '<svg viewBox="0 0 64 64" aria-hidden="true"><ellipse class="ai-pet-glow" cx="32" cy="50" rx="14" ry="4" fill="var(--mascot-color,var(--app-primary,#569cff))" opacity=".2"/><g class="ai-pet-figure"><circle cx="32" cy="28" r="18" fill="var(--mascot-color,var(--app-primary,#569cff))" fill-opacity=".85" stroke="var(--mascot-color,var(--app-primary,#569cff))" stroke-width="2.5"/></g><g class="ai-pet-face"><circle cx="23" cy="25" r="5" fill="#fff" stroke="none"/><circle cx="41" cy="25" r="5" fill="#fff" stroke="none"/><circle class="ai-pet-eye" cx="23" cy="25" r="3" fill="#2d3748" stroke="none"/><circle class="ai-pet-eye" cx="41" cy="25" r="3" fill="#2d3748" stroke="none"/><circle class="ai-pet-eye-highlight" cx="22" cy="23.5" r="1.5" fill="#fff" stroke="none"/><circle class="ai-pet-eye-highlight" cx="40" cy="23.5" r="1.5" fill="#fff" stroke="none"/><ellipse class="ai-pet-blush" cx="18" cy="31" rx="4" ry="2.5" fill="#ff8a9e" opacity=".5" stroke="none"/><ellipse class="ai-pet-blush" cx="46" cy="31" rx="4" ry="2.5" fill="#ff8a9e" opacity=".5" stroke="none"/><path d="M27 34c2 2 6 2 8 0" fill="none" stroke="#2d3748" stroke-width="2" stroke-linecap="round"/></g></svg>';
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }

function handleMascotHistoryClick(event) {
  const useId = event.target.dataset.mascotUse;
  const deleteId = event.target.dataset.mascotDelete;
  if (!useId && !deleteId) return;
  const config = getMascotConfig();
  if (useId) {
    const item = config.history.find(entry => entry.id === useId);
    if (!item) return;
    Object.assign(config, {
      currentId: item.id, prompt: item.prompt, action: item.action, color: item.color,
      iconType: item.iconType || 'preset-images',
      iconId: item.iconId || config.iconId,
      iconSvg: item.iconSvg || buildMascotSvg(),
      iconDataUrls: item.iconDataUrls || createEmptyUploads(),
      iconDataUrl: item.iconDataUrl || ''
    });
    localStorage.setItem(MASCOT_CONFIG_KEY, JSON.stringify(config));
    notifyMascotChanged(config);
    document.getElementById('mascotAction').value = item.action;
    renderMascotPreview(item.action, item.color); renderMascotHistory(); renderMascotUploadList(); showToast('已应用历史机器人图标');
  } else if (deleteId) {
    config.history = config.history.filter(entry => entry.id !== deleteId);
    if (config.currentId === deleteId) { config.currentId = config.history[0]?.id || null; Object.assign(config, config.history[0] || { prompt: '', action: 'run', color: MASCOT_COLORS[3], iconType: 'preset-images', iconId: 'luoxiaohei' }); }
    localStorage.setItem(MASCOT_CONFIG_KEY, JSON.stringify(config)); renderMascotHistory(); renderMascotPreview(config.action, config.color); renderMascotUploadList(); showToast('历史机器人图标已删除');
    notifyMascotChanged(config);
  }
}

// 保存配置
async function saveConfig() {
  const saveBtn = document.getElementById('saveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = '保存中...';

  const config = {
    // AI 模型
    activeProvider: document.getElementById('activeProvider').value,
    dashscopeApiKey: document.getElementById('dashscopeApiKey').value,
    dashscopeModel: document.getElementById('dashscopeModel').value,
    deepseekApiKey: document.getElementById('deepseekApiKey').value,
    deepseekModel: document.getElementById('deepseekModel').value,
    customProviderName: document.getElementById('customProviderName').value,
    customBaseUrl: document.getElementById('customBaseUrl').value,
    customApiKey: document.getElementById('customApiKey').value,
    customModel: document.getElementById('customModel').value,
    // 任务档位模型名
    simpleTierModel: document.getElementById('simpleTierModel').value || 'deepseek-v4-flash',
    strongTierModel: document.getElementById('strongTierModel').value || 'deepseek-v4-pro',
    // 邮件
    mailEnabled: document.getElementById('mailEnabled').checked,
    mailHost: document.getElementById('mailHost').value,
    mailPort: parseInt(document.getElementById('mailPort').value) || 465,
    mailUsername: document.getElementById('mailUsername').value,
    mailPassword: document.getElementById('mailPassword').value,
    // Git
    gitRemoteUrl: document.getElementById('gitRemoteUrl').value,
    gitUsername: document.getElementById('gitUsername').value,
    gitPassword: document.getElementById('gitPassword').value,
    gitBranch: document.getElementById('gitBranch').value || 'main',
    // Exa 搜索
    exaApiKey: document.getElementById('exaApiKey').value,
    exaEnabled: document.getElementById('exaEnabled').checked,
    // PDF OCR
    pdfOcrBaseUrl: document.getElementById('pdfOcrBaseUrl').value,
    pdfOcrApiKey: document.getElementById('pdfOcrApiKey').value,
    pdfOcrEnabled: document.getElementById('pdfOcrEnabled').checked,
    pdfOcrModel: document.getElementById('pdfOcrModel').value,
    pdfOcrMinTextLength: parseInt(document.getElementById('pdfOcrMinTextLength').value) || 15,
    storagePath: document.getElementById('storagePath').value,
    autoStart: document.getElementById('autoStartToggle')?.checked === true
  };

  // 检测存储路径变更
  const newStoragePath = config.storagePath;
  const oldStoragePath = currentStoragePath;
  let shouldArchive = false;

  if (oldStoragePath && newStoragePath && oldStoragePath !== newStoragePath) {
    shouldArchive = await showMigrateModal(oldStoragePath, newStoragePath);
  }

  // 执行归档
  if (shouldArchive) {
    try {
      showToast('正在归档旧数据...');
      const archiveResult = await fetch('http://127.0.0.1:8081/api/config/migrate-storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: oldStoragePath, newPath: newStoragePath })
      }).then(r => r.json());
      if (archiveResult.success) {
        showToast('归档完成：' + archiveResult.archiveSize + ' → ' + archiveResult.archivePath);
      } else {
        showToast('归档失败：' + (archiveResult.message || '未知错误'));
      }
    } catch (e) {
      showToast('归档请求失败：' + e.message);
    }
  }

  try {
    const response = await fetch(API_BASE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    const result = await response.json();
    if (response.ok && result.success) {
      currentStoragePath = newStoragePath; // 更新已记录路径

      const autoStartAPI = getElectronAPI();
      if (autoStartAPI && autoStartAPI.setAutoStart) {
        const autoStartResult = await autoStartAPI.setAutoStart(config.autoStart);
        if (!autoStartResult?.success) throw new Error(autoStartResult?.message || '开机自启设置失败');
      }

      // 同步 storagePath 到 Electron config.json（触发 application.yml 更新）
      if (newStoragePath !== oldStoragePath) {
        const api = getElectronAPI();
        if (api && api.getConfig && api.saveConfig) {
          try {
            const electronConfig = await api.getConfig();
            electronConfig.storagePath = newStoragePath;
            await api.saveConfig(electronConfig);
          } catch (e) {
            console.warn('同步 Electron 配置失败:', e);
          }
        }
      }

      const msg = (oldStoragePath && oldStoragePath !== newStoragePath)
        ? '配置已保存，请重启后端使存储路径生效'
        : '所有配置已保存';
      showToast(msg);
      onProviderChange();
      saveUpdateConfig();
    } else {
      showToast(result.message || '保存失败');
    }
  } catch (error) {
    console.error('保存失败:', error);
    showToast('保存失败，请检查后端服务');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '保存所有配置';
  }
}

async function onAutoStartChange() {
  const toggle = document.getElementById('autoStartToggle');
  const electronAPI = getElectronAPI();
  if (!toggle || !electronAPI?.setAutoStart) return;

  const enabled = toggle.checked;
  const result = await electronAPI.setAutoStart(enabled);
  if (!result?.success) {
    toggle.checked = !enabled;
    showToast('开机自启设置失败，请稍后重试');
    return;
  }
  showToast(enabled ? '已开启开机自启' : '已关闭开机自启');
}

// 测试 DashScope 连接
async function testDashscope() {
  const apiKey = document.getElementById('dashscopeApiKey').value;
  const model = document.getElementById('dashscopeModel').value;
  if (!apiKey) {
    const el = document.getElementById('dashscopeTestResult');
    el.className = 'test-result show error';
    el.textContent = '请先填写 DashScope API Key';
    return;
  }

  const testBtn = document.getElementById('testDashscopeBtn');
  testBtn.disabled = true;
  testBtn.textContent = '测试中...';

  const resultEl = document.getElementById('dashscopeTestResult');
  resultEl.className = 'test-result show';
  resultEl.textContent = '正在测试连接...';

  try {
    const response = await fetch(`${MODEL_TEST_BASE}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'dashscope', apiKey, model })
    });
    const result = await response.json();
    if (result.success) {
      resultEl.className = 'test-result show success';
      resultEl.textContent = 'DashScope 连接测试成功！';
    } else {
      resultEl.className = 'test-result show error';
      resultEl.textContent = result.message || '连接测试失败';
    }
  } catch (error) {
    resultEl.className = 'test-result show error';
    resultEl.textContent = '测试请求失败: ' + error.message;
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = '测试连接';
  }
}

// 测试 DeepSeek 连接
async function testDeepseek() {
  const apiKey = document.getElementById('deepseekApiKey').value;
  const model = document.getElementById('deepseekModel').value;
  if (!apiKey) {
    const el = document.getElementById('deepseekTestResult');
    el.className = 'test-result show error';
    el.textContent = '请先填写 DeepSeek API Key';
    return;
  }

  const testBtn = document.getElementById('testDeepseekBtn');
  testBtn.disabled = true;
  testBtn.textContent = '测试中...';

  const resultEl = document.getElementById('deepseekTestResult');
  resultEl.className = 'test-result show';
  resultEl.textContent = '正在测试连接...';

  try {
    const response = await fetch(`${MODEL_TEST_BASE}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'deepseek', apiKey, model })
    });
    const result = await response.json();
    if (result.success) {
      resultEl.className = 'test-result show success';
      resultEl.textContent = 'DeepSeek 连接测试成功！';
    } else {
      resultEl.className = 'test-result show error';
      resultEl.textContent = result.message || '连接测试失败';
    }
  } catch (error) {
    resultEl.className = 'test-result show error';
    resultEl.textContent = '测试请求失败: ' + error.message;
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = '测试连接';
  }
}

// 切换当前模型
function onProviderChange() {
  const active = document.getElementById('activeProvider').value;
  const dashBadge = document.getElementById('dashscopeBadge');
  const deepBadge = document.getElementById('deepseekBadge');
  const customSection = document.getElementById('customSection');
  const presetGroup = document.getElementById('presetGroup');
  const dashSection = document.getElementById('dashscopeSection');
  const deepSection = document.getElementById('deepseekSection');

  // 重置所有区块显示
  dashSection.style.display = 'block';
  deepSection.style.display = 'block';
  customSection.style.display = 'none';
  presetGroup.style.display = 'none';

  if (active === 'custom') {
    dashSection.style.display = 'none';
    deepSection.style.display = 'none';
    customSection.style.display = 'block';
    presetGroup.style.display = 'block';
    dashBadge.className = 'badge badge-inactive';
    dashBadge.textContent = '未激活';
    deepBadge.className = 'badge badge-inactive';
    deepBadge.textContent = '未激活';
    loadPresets();
  } else if (active === 'deepseek') {
    dashBadge.className = 'badge badge-inactive';
    dashBadge.textContent = '未激活';
    deepBadge.className = 'badge badge-active';
    deepBadge.textContent = '当前';
    deepSection.style.borderColor = 'var(--primary)';
    dashSection.style.borderColor = 'var(--border)';
  } else {
    // dashscope
    dashBadge.className = 'badge badge-active';
    dashBadge.textContent = '当前';
    deepBadge.className = 'badge badge-inactive';
    deepBadge.textContent = '未激活';
    dashSection.style.borderColor = 'var(--primary)';
    deepSection.style.borderColor = 'var(--border)';
  }
}

// 加载预设模板列表
async function loadPresets() {
  const select = document.getElementById('presetSelect');
  if (!select) return;
  try {
    const response = await fetch(`${MODEL_TEST_BASE}/presets`);
    if (!response.ok) return;
    const presets = await response.json();
    // 保留第一个占位选项
    select.innerHTML = '<option value="">-- 选择预设 --</option>';
    presets.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
  } catch (e) {
    console.warn('加载预设模板失败:', e);
  }
}

// 预设模板切换
function onPresetChange() {
  const preset = document.getElementById('presetSelect').value;
  if (!preset) return;
  // 从后端 API 获取预设列表（已缓存在 select 的 option 中，直接取 data-* 即可）
  // 实际上我们通过预设 id 映射，但更可靠的方式是重新请求
  fetch(`${MODEL_TEST_BASE}/presets`)
    .then(r => r.json())
    .then(presets => {
      const p = presets.find(item => item.id === preset);
      if (!p) return;
      if (p.baseUrl) document.getElementById('customBaseUrl').value = p.baseUrl;
      if (p.defaultModel) document.getElementById('customModel').value = p.defaultModel;
      showToast(`已应用「${p.name}」预设`);
    })
    .catch(() => {});
}

// 测试自定义 OpenAI 兼容连接
async function testCustom() {
  const apiKey = document.getElementById('customApiKey').value;
  const model = document.getElementById('customModel').value;
  const baseUrl = document.getElementById('customBaseUrl').value;
  if (!apiKey) {
    const el = document.getElementById('customTestResult');
    el.className = 'test-result show error';
    el.textContent = '请先填写 API Key';
    return;
  }
  if (!baseUrl) {
    const el = document.getElementById('customTestResult');
    el.className = 'test-result show error';
    el.textContent = '请先填写 API 地址';
    return;
  }

  const testBtn = document.getElementById('testCustomBtn');
  testBtn.disabled = true;
  testBtn.textContent = '测试中...';

  const resultEl = document.getElementById('customTestResult');
  resultEl.className = 'test-result show';
  resultEl.textContent = '正在测试连接...';

  try {
    const response = await fetch(`${MODEL_TEST_BASE}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'custom', apiKey, model, baseUrl })
    });
    const result = await response.json();
    if (result.success) {
      resultEl.className = 'test-result show success';
      resultEl.textContent = '自定义连接测试成功！';
    } else {
      resultEl.className = 'test-result show error';
      resultEl.textContent = result.message || '连接测试失败';
    }
  } catch (error) {
    resultEl.className = 'test-result show error';
    resultEl.textContent = '测试请求失败: ' + error.message;
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = '测试连接';
  }
}

// 切换密码可见性
function toggleVisibility(inputId) {
  const input = document.getElementById(inputId);
  input.type = input.type === 'password' ? 'text' : 'password';
}

function showToast(message, isError = false) {
  if (window.UI && UI.toast) {
    UI.toast(message, { type: isError ? 'error' : 'info', duration: isError ? 4000 : 2000 });
    return;
  }
  // 兜底（理论上不会触发：settings.html 已加载 ui-common.js）
  const existing = document.querySelector('.ui-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'ui-toast ui-toast--' + (isError ? 'error' : 'info');
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  renderThemeCards();
  loadConfig();
  document.getElementById('mascotAction')?.addEventListener('change', handleMascotActionChange);
  document.getElementById('mascotPresetList')?.addEventListener('click', handleMascotPreset);
  document.getElementById('mascotHistoryFilter')?.addEventListener('input', renderMascotHistory);
  document.getElementById('mascotHistoryList')?.addEventListener('click', handleMascotHistoryClick);
  document.getElementById('mascotCopyPromptBtn')?.addEventListener('click', () => {
    const prompt = '要求：生成透明背景 PNG / SVG，每张独立 128×128 图标，大小不超过2M\n主体：罗小黑（动漫罗小黑战记IP的黑猫）；\n生成图六个动作的图片：奔跑、挥手、跳跃、思考、打盹、庆祝；\n风格：宫崎骏、粗线条； ';
    navigator.clipboard.writeText(prompt).then(() => {
      showToast('提示词已复制到剪贴板');
    }).catch(() => {
      const textarea = document.createElement('textarea');
      textarea.value = prompt;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showToast('提示词已复制到剪贴板');
    });
  });
  loadMascotConfig();
  loadShortcutConfig();
  loadScreenshotConfig();
  loadStartupMode();
  initUpdateUI();
});

// ==================== 快捷键设置 ====================

let recordingShortcut = false;
let recordingPreviousEnabled = false;

async function loadShortcutConfig() {
  const api = getElectronAPI();
  if (!api || !api.getShortcutConfig) return;
  try {
    const config = await api.getShortcutConfig();
    document.getElementById('shortcutEnabled').checked = config.enabled;
    document.getElementById('shortcutKey').value = config.accelerator || 'Alt+X';
    document.getElementById('shortcutKeyRow').style.display = config.enabled ? '' : 'none';
  } catch (e) {}
}

async function startShortcutRecording() {
  const input = document.getElementById('shortcutKey');
  const api = getElectronAPI();
  // 录制前临时禁用全局快捷键，避免快捷键触发导致窗口隐藏
  if (api && api.setShortcutConfig) {
    try {
      const config = await api.getShortcutConfig();
      recordingPreviousEnabled = config.enabled;
      if (config.enabled) {
        await api.setShortcutConfig({ enabled: false, accelerator: config.accelerator });
      }
    } catch (e) {}
  }
  recordingShortcut = true;
  input.value = '按下组合键...';
  input.style.borderColor = 'var(--text)';
  input.style.background = 'var(--primary-light)';
}

async function cancelShortcutRecording() {
  const input = document.getElementById('shortcutKey');
  recordingShortcut = false;
  input.style.borderColor = '';
  input.style.background = '';
  // 恢复全局快捷键（仅当之前是启用状态且有有效快捷键时）
  const api = getElectronAPI();
  if (api && api.setShortcutConfig && recordingPreviousEnabled) {
    try {
      const val = input.value.trim();
      const accelerator = (val && val !== '按下组合键...') ? val : 'Alt+X';
      await api.setShortcutConfig({ enabled: true, accelerator });
    } catch (e) {}
  }
  recordingPreviousEnabled = false;
}

// keydown 监听 — 录制组合键
document.addEventListener('keydown', (e) => {
  if (!recordingShortcut) return;
  e.preventDefault();
  e.stopPropagation();
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const key = e.key;
  if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') return;
  // 功能键（F1-F12 等）直接保存；普通键必须配合修饰键，避免裸字母全局拦截
  const isFunctionKey = /^F([1-9]|1[0-2])$/.test(key) || ['PrintScreen', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Delete', 'Backspace', 'Tab', 'CapsLock'].indexOf(key) >= 0;
  if (!isFunctionKey && parts.length === 0) {
    showToast('请同时按 Ctrl / Alt / Shift + 键，或直接按 F1-F12 功能键');
    return;
  }
  parts.push(key.length === 1 ? key.toUpperCase() : key);
  const accelerator = parts.join('+');
  const input = document.getElementById('shortcutKey');
  input.value = accelerator;
  // 录制完成，直接重置状态，由 onShortcutChange 重新注册快捷键
  recordingShortcut = false;
  input.style.borderColor = '';
  input.style.background = '';
  onShortcutChange();
});

// 点击其他地方取消录制
document.addEventListener('click', (e) => {
  if (recordingShortcut && e.target.id !== 'shortcutKey') {
    cancelShortcutRecording();
    loadShortcutConfig(); // 恢复原值
  }
});

async function onShortcutChange() {
  const enabled = document.getElementById('shortcutEnabled').checked;
  const accelerator = document.getElementById('shortcutKey').value.trim() || 'Alt+X';
  document.getElementById('shortcutKeyRow').style.display = enabled ? '' : 'none';
  const api = getElectronAPI();
  if (!api || !api.setShortcutConfig) return;
  await api.setShortcutConfig({ enabled, accelerator });
  showToast('快捷键已更新');
}

// ==================== 截图工具配置 ====================

let recordingShotField = null; // 'shot' | 'paste' | null

/** 加载截图工具配置（快捷键 + 收起主窗口开关） */
async function loadScreenshotConfig() {
  const api = getElectronAPI();
  if (!api || !api.screenshotGetShortcuts) return;
  try {
    const cfg = await api.screenshotGetShortcuts();
    if (document.getElementById('shotKey')) {
      document.getElementById('shotKey').value = cfg.screenshot || 'F1';
      document.getElementById('pasteKey').value = cfg.paste || 'F2';
      document.getElementById('shotHideMain').checked = cfg.hideMain !== false;
    }
  } catch (e) {}
}

/** 开始录制截图/贴图快捷键 */
function startShotRecording(field) {
  recordingShotField = field;
  const input = document.getElementById(field === 'paste' ? 'pasteKey' : 'shotKey');
  input.value = '按下快捷键...';
  input.style.borderColor = 'var(--text)';
  input.style.background = 'var(--primary-light)';
}

/** 保存截图快捷键 + 配置（即时重注册） */
async function saveScreenshotConfig() {
  const api = getElectronAPI();
  if (!api || !api.screenshotSetShortcuts) return;
  const payload = {
    screenshot: (document.getElementById('shotKey').value.trim() || 'F1'),
    paste: (document.getElementById('pasteKey').value.trim() || 'F2'),
    hideMain: document.getElementById('shotHideMain').checked
  };
  await api.screenshotSetShortcuts(payload);
  showToast('截图工具配置已保存');
}

// 截图快捷键录制：keydown 处理（与全局快捷键录制分离，互不干扰）
document.addEventListener('keydown', (e) => {
  if (!recordingShotField) return;
  e.preventDefault();
  e.stopPropagation();
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const key = e.key;
  if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta' || key === 'Escape') return;
  if (parts.length === 0) parts.push('Ctrl');
  parts.push(key.length === 1 ? key.toUpperCase() : key);
  const accelerator = parts.join('+');
  const input = document.getElementById(recordingShotField === 'paste' ? 'pasteKey' : 'shotKey');
  input.value = accelerator;
  recordingShotField = null;
  input.style.borderColor = '';
  input.style.background = '';
  saveScreenshotConfig();
});

// 点击其它区域取消录制并恢复原值
document.addEventListener('click', (e) => {
  if (!recordingShotField) return;
  if (!e.target.closest('#shotKey') && !e.target.closest('#pasteKey')) {
    recordingShotField = null;
    loadScreenshotConfig();
  }
});

// 收起主窗口开关即时保存
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'shotHideMain') saveScreenshotConfig();
});

// ==================== 更新管理 ====================

let updateDownloadUrl = null;
let updateDownloadSha256 = null;
let isUpdating = false;

/**
 * 获取 Electron API（兼容 iframe 模式）。
 * settings.html 在 index.html 的 iframe 中加载，preload 脚本只注入顶层窗口，
 * 因此需要从 window.parent 获取 electronAPI。
 */
function getElectronAPI() {
  return window.electronAPI || (window.parent && window.parent.electronAPI);
}

/**
 * 初始化更新 UI。
 * 读取当前版本号、更新配置，并监听来自主进程的更新事件。
 */
async function initUpdateUI() {
  const section = document.getElementById('updateSection');
  section.style.display = 'block';

  const electronAPI = getElectronAPI();

  if (!electronAPI) {
    // 非 Electron 环境：显示版本号 + 提示不可用，隐藏交互控件
    document.getElementById('currentVersion').parentElement.style.display = 'flex';
    document.getElementById('currentVersion').textContent = 'v1.0.0';
    document.getElementById('checkUpdateBtn').style.display = 'none';
    const toggleForm = document.getElementById('autoUpdateToggle').closest('.form-group');
    if (toggleForm) toggleForm.style.display = 'none';
    document.getElementById('frequencyGroup').style.display = 'none';
    const statusEl = document.getElementById('updateStatus');
    statusEl.style.display = 'block';
    document.getElementById('updateMessage').textContent = '需要桌面客户端支持，请使用 CutShelter 桌面应用';
    document.getElementById('updateMessage').className = 'update-available';
    return;
  }

  try {
    // 加载当前版本号
    const version = await electronAPI.getVersion();
    document.getElementById('currentVersion').textContent = 'v' + version;

    // 加载更新配置
    const config = await electronAPI.getUpdateConfig();
    const toggle = document.getElementById('autoUpdateToggle');
    toggle.checked = config.autoUpdate === true;
    document.getElementById('updateFrequency').value = config.frequency || 'weekly';
    onAutoUpdateToggle();

    // 监听主进程推送的更新进度
    electronAPI.onUpdateProgress((data) => {
      document.getElementById('updateStatus').style.display = 'block';
      document.getElementById('updateMessage').textContent = data.message;
      document.getElementById('updateMessage').className = 'update-checking';

      const progressBar = document.getElementById('updateProgressBar');
      const progressFill = document.getElementById('updateProgressFill');
      if (data.percent >= 0) {
        progressBar.style.display = 'block';
        progressFill.style.width = data.percent + '%';
      }

      if (data.percent >= 100) {
        document.getElementById('updateActions').style.display = 'none';
        document.getElementById('cancelUpdateBtn').style.display = 'none';
      }
    });

    // 监听新版本可用
    electronAPI.onUpdateAvailable((data) => {
      showUpdateAvailable(data);
    });

    // 监听更新完成
    electronAPI.onUpdateComplete(() => {
      document.getElementById('updateMessage').textContent = '更新完成，应用即将重启...';
      document.getElementById('updateMessage').className = 'update-available';
    });

    // 监听更新错误
    electronAPI.onUpdateError((msg) => {
      document.getElementById('updateMessage').textContent = '更新失败: ' + msg;
      document.getElementById('updateMessage').className = 'update-error';
      document.getElementById('updateProgressBar').style.display = 'none';
      document.getElementById('updateNowBtn').style.display = 'block';
      document.getElementById('cancelUpdateBtn').style.display = 'none';
      isUpdating = false;
    });
  } catch (e) {
    console.error('[Update] Init UI failed:', e);
  }
}

/**
 * 自动更新开关切换。
 */
function onAutoUpdateToggle() {
  const checked = document.getElementById('autoUpdateToggle').checked;
  document.getElementById('frequencyGroup').style.display = checked ? 'block' : 'none';
  document.getElementById('autoUpdateLabel').textContent = checked ? '已开启' : '已关闭';
  // 不自动保存，由"保存设置"按钮统一触发
}

/**
 * 保存更新配置到主进程。
 * 由"保存设置"按钮统一调用，不在 toggle/select 切换时自动保存。
 */

/** 检查频率即时生效 */
async function onUpdateFrequencyChange() {
  await saveUpdateConfig();
  showToast('检查频率已更新');
}

async function saveUpdateConfig() {
  const electronAPI = getElectronAPI();
  if (!electronAPI) return;
  try {
    const config = {
      autoUpdate: document.getElementById('autoUpdateToggle').checked,
      frequency: document.getElementById('updateFrequency').value
    };
    await electronAPI.saveUpdateConfig(config);
  } catch (e) {
    console.error('[Update] Save config failed:', e);
  }
}

/**
 * 手动检查更新。
 */
async function manualCheckUpdate() {
  const electronAPI = getElectronAPI();
  if (!electronAPI) {
    showToast('仅在桌面客户端中可用');
    return;
  }

  const statusEl = document.getElementById('updateStatus');
  const msgEl = document.getElementById('updateMessage');
  const checkBtn = document.getElementById('checkUpdateBtn');

  // 显示检查中状态
  statusEl.style.display = 'block';
  msgEl.textContent = '正在检查更新...';
  msgEl.className = 'update-checking';
  document.getElementById('updateProgressBar').style.display = 'none';
  document.getElementById('updateActions').style.display = 'none';
  checkBtn.disabled = true;
  checkBtn.textContent = '检查中...';

  try {
    const result = await electronAPI.checkForUpdate();

    if (result.hasUpdate) {
      showUpdateAvailable(result);
    } else {
      msgEl.textContent = result.message || '已是最新版本';
      msgEl.className = 'update-available';
      document.getElementById('updateActions').style.display = 'none';
    }
  } catch (e) {
    msgEl.textContent = '检查失败: ' + e.message;
    msgEl.className = 'update-error';
  } finally {
    checkBtn.disabled = false;
    checkBtn.textContent = '检查更新';
  }
}

/**
 * 显示新版本可用信息。
 */
function showUpdateAvailable(data) {
  const statusEl = document.getElementById('updateStatus');
  const msgEl = document.getElementById('updateMessage');
  const actionsEl = document.getElementById('updateActions');

  statusEl.style.display = 'block';
  msgEl.innerHTML = `发现新版本 <strong>v${data.version || data.latestVersion}</strong>（当前 v${data.currentVersion || '未知'}）`;
  msgEl.className = 'update-available';

  // 显示更新日志（折叠长文本）
  if (data.releaseNotes) {
    const oldNotes = statusEl.querySelector('.update-notes');
    if (oldNotes) oldNotes.remove();

    const notesEl = document.createElement('div');
    notesEl.className = 'update-notes';
    const fullText = data.releaseNotes;
    const maxPreview = 200;
    if (fullText.length > maxPreview) {
      const preview = document.createElement('span');
      preview.textContent = fullText.substring(0, maxPreview) + '... ';
      const more = document.createElement('span');
      more.textContent = fullText.substring(maxPreview);
      more.style.display = 'none';
      const toggle = document.createElement('a');
      toggle.textContent = '展开全部';
      toggle.href = 'javascript:void(0)';
      toggle.className = 'update-notes-toggle';
      toggle.onclick = () => {
        const isHidden = more.style.display === 'none';
        more.style.display = isHidden ? 'inline' : 'none';
        preview.style.display = isHidden ? 'none' : 'inline';
        toggle.textContent = isHidden ? '收起' : '展开全部';
      };
      notesEl.appendChild(preview);
      notesEl.appendChild(more);
      notesEl.appendChild(document.createTextNode(' '));
      notesEl.appendChild(toggle);
    } else {
      notesEl.textContent = fullText;
    }
    msgEl.after(notesEl);
  }

  actionsEl.style.display = 'block';
  document.getElementById('updateNowBtn').style.display = 'block';
  document.getElementById('cancelUpdateBtn').style.display = 'none';

  // 保存下载地址与校验值
  updateDownloadUrl = data.downloadUrl;
  updateDownloadSha256 = data.sha256 || null;
  console.log('[Update] Available, downloadUrl:', updateDownloadUrl || '(none)', 'sha256:', updateDownloadSha256 ? updateDownloadSha256.slice(0, 12) + '...' : '(none)');
}

/**
 * 开始下载并应用更新。
 */
async function startUpdate() {
  const electronAPI = getElectronAPI();
  if (!electronAPI) {
    showToast('仅在桌面客户端中可用');
    return;
  }
  if (isUpdating) return;
  if (!updateDownloadUrl) {
    console.error('[Update] No download URL available');
    const msgEl = document.getElementById('updateMessage');
    msgEl.textContent = '更新失败：未找到下载地址，请确认 Release 中已上传更新包';
    msgEl.className = 'update-error';
    return;
  }

  console.log('[Update] Starting update download:', updateDownloadUrl);
  isUpdating = true;
  document.getElementById('updateNowBtn').style.display = 'none';
  document.getElementById('cancelUpdateBtn').style.display = 'inline-block';
  document.getElementById('updateProgressBar').style.display = 'block';

  try {
    const result = await electronAPI.downloadAndApplyUpdate({
      downloadUrl: updateDownloadUrl,
      sha256: updateDownloadSha256
    });
    if (!result.success) {
      throw new Error(result.message);
    }
  } catch (e) {
    console.error('[Update] Start update failed:', e);
    document.getElementById('updateMessage').textContent = '更新失败: ' + e.message;
    document.getElementById('updateMessage').className = 'update-error';
    document.getElementById('updateProgressBar').style.display = 'none';
    document.getElementById('updateNowBtn').style.display = 'block';
    document.getElementById('cancelUpdateBtn').style.display = 'none';
    isUpdating = false;
  }
}

/**
 * 取消更新（仅 UI 操作，不影响已在进行的下载）。
 */
function cancelUpdate() {
  isUpdating = false;
  document.getElementById('updateStatus').style.display = 'none';
  document.getElementById('updateNowBtn').style.display = 'block';
  document.getElementById('cancelUpdateBtn').style.display = 'none';
  document.getElementById('updateProgressBar').style.display = 'none';
}

// ==================== 邮件配置 ====================

function onMailToggle() {
  const enabled = document.getElementById('mailEnabled').checked;
  document.querySelectorAll('.mail-field').forEach(el => {
    el.style.display = enabled ? '' : 'none';
  });
}

async function testMail() {
  const host = document.getElementById('mailHost').value;
  const port = parseInt(document.getElementById('mailPort').value) || 465;
  const username = document.getElementById('mailUsername').value;
  const password = document.getElementById('mailPassword').value;

  if (!host || !username || !password) {
    showToast('请先完整填写 SMTP 配置');
    return;
  }

  const btn = document.getElementById('testMailBtn');
  btn.disabled = true;
  btn.textContent = '测试中...';
  try {
    const response = await fetch('http://127.0.0.1:8081/api/config/test-mail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port, username, password })
    });
    const result = await response.json();
    if (response.ok && result.success) {
      showToast('邮件连接测试成功！');
    } else {
      showToast('测试失败: ' + (result.message || '连接失败'));
    }
  } catch (e) {
    showToast('测试请求失败: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '测试连接';
  }
}

// ==================== Git 配置 ====================

async function testGit() {
  const remoteUrl = document.getElementById('gitRemoteUrl').value;
  const username = document.getElementById('gitUsername').value;
  const password = document.getElementById('gitPassword').value;

  if (!remoteUrl) {
    showToast('请先填写远程仓库 URL');
    return;
  }

  const btn = document.getElementById('testGitBtn');
  btn.disabled = true;
  btn.textContent = '测试中...';
  try {
    const response = await fetch('http://127.0.0.1:8081/api/git/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remoteUrl, username, password })
    });
    const result = await response.json();
    if (response.ok && result.success) {
      showToast('Git 连接测试成功！');
    } else {
      showToast('测试失败: ' + (result.message || '连接失败'));
    }
  } catch (e) {
    showToast('测试请求失败: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '测试连接';
  }
}

// ==================== 存储路径 ====================

// 模态框 resolve 回调
let _migrateResolve = null;

function showMigrateModal(oldPath, newPath) {
  return new Promise((resolve) => {
    _migrateResolve = resolve;
    document.getElementById('migrateOldPath').textContent = oldPath;
    document.getElementById('migrateNewPath').textContent = newPath;
    document.getElementById('migrateModal').style.display = 'flex';
    document.getElementById('migrateArchiveBtn').disabled = false;
    document.getElementById('migrateArchiveBtn').textContent = '归档旧数据';
  });
}

function closeMigrateModal(shouldArchive) {
  document.getElementById('migrateModal').style.display = 'none';
  if (_migrateResolve) {
    _migrateResolve(shouldArchive === true);
    _migrateResolve = null;
  }
}

function updateDerivedPaths(rootPath) {
  if (!rootPath) {
    document.getElementById('derivedClipPath').textContent = '—';
    document.getElementById('derivedOrganizedPath').textContent = '—';
    document.getElementById('derivedWeeklyPath').textContent = '—';
    return;
  }
  const normalized = rootPath.replace(/\\/g, '/');
  document.getElementById('derivedClipPath').textContent = normalized + '/clip-storage';
  document.getElementById('derivedOrganizedPath').textContent = normalized + '/clip-organized';
  document.getElementById('derivedWeeklyPath').textContent = normalized + '/weekly-report';
}

// ==================== 本地配置文件 ====================

// 加载 Electron 桌面应用配置路径（config.json）并展示
// 该文件由 Electron 主进程管理，位于 userData/config/config.json
async function loadElectronConfigPath() {
  const input = document.getElementById('electronConfigPath');
  if (!input) return;
  const api = getElectronAPI();
  if (!api || !api.getConfigPath) {
    input.value = '仅在桌面客户端中可用';
    return;
  }
  try {
    const result = await api.getConfigPath();
    if (result.success && result.configPath) {
      input.value = result.configPath;
    } else {
      input.value = '获取配置路径失败';
    }
  } catch (e) {
    console.error('获取 Electron 配置路径失败:', e);
    input.value = '获取配置路径失败';
  }
}

// 打开 Electron 桌面应用配置文件（config.json）所在目录
async function openElectronConfigFolder() {
  const api = getElectronAPI();
  if (!api || !api.openConfigFolder) {
    showToast('仅在桌面客户端中可用');
    return;
  }
  const btn = document.getElementById('openElectronConfigBtn');
  const input = document.getElementById('electronConfigPath');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '打开中...';
  }
  try {
    const result = await api.openConfigFolder();
    if (result.success) {
      if (input && result.configPath) input.value = result.configPath;
      showToast('已打开 Electron 配置文件目录');
    } else {
      showToast(result.message || '打开配置文件目录失败');
    }
  } catch (e) {
    console.error('打开 Electron 配置目录失败:', e);
    showToast('打开配置文件目录失败，请检查后端服务');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '打开目录';
    }
  }
}

// 加载后端配置文件路径（app-config.json）并展示
async function loadConfigFilePath() {
  const input = document.getElementById('configFilePath');
  if (!input) return;
  try {
    const response = await fetch(`${API_BASE}/path`);
    const result = await response.json();
    if (result.status === 'success' && result.configPath) {
      input.value = result.configPath;
    } else {
      input.value = '获取配置路径失败';
    }
  } catch (e) {
    console.error('获取配置路径失败:', e);
    input.value = '获取配置路径失败';
  }
}

// 打开后端配置文件（app-config.json）所在目录
async function openConfigFolder() {
  const btn = document.getElementById('openConfigFolderBtn');
  const input = document.getElementById('configFilePath');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '打开中...';
  }
  try {
    const response = await fetch(`${API_BASE}/open-config-folder`, { method: 'POST' });
    const result = await response.json();
    if (result.status === 'success') {
      if (input && result.configPath) input.value = result.configPath;
      showToast('已打开配置文件目录');
    } else {
      showToast(result.message || '打开配置文件目录失败');
    }
  } catch (e) {
    console.error('打开配置文件目录失败:', e);
    showToast('打开配置文件目录失败，请检查后端服务');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '打开目录';
    }
  }
}

async function browseDirectory(inputId) {
  const api = getElectronAPI();
  if (api && api.selectDirectory) {
    const dir = await api.selectDirectory();
    if (dir) {
      document.getElementById(inputId).value = dir;
      if (inputId === 'storagePath') updateDerivedPaths(dir);
    }
  } else {
    showToast('目录浏览仅在桌面客户端中可用，请手动输入路径');
  }
}

// ==================== 启动模式管理 ====================

/**
 * 加载启动模式配置
 * 从 Electron 主进程获取当前启动模式并设置下拉框
 */
function loadStartupMode() {
  var api = getElectronAPI();
  if (!api || typeof api.getStartupMode !== 'function') {
    // 非 Electron 环境，隐藏启动模式设置
    var select = document.getElementById('startupModeSelect');
    if (select) {
      var row = select.closest('.setting-row');
      if (row) row.style.display = 'none';
    }
    return;
  }
  api.getStartupMode().then(function(mode) {
    var select = document.getElementById('startupModeSelect');
    if (select) {
      select.value = mode || 'frontend-only';
    }
  }).catch(function(e) {
    console.warn('加载启动模式失败:', e);
  });
}

/**
 * 启动模式变更时保存
 */
function onStartupModeChange() {
  var select = document.getElementById('startupModeSelect');
  if (!select) return;
  var mode = select.value;
  var api = getElectronAPI();
  if (api && typeof api.saveConfig === 'function') {
    api.saveConfig({ startupMode: mode }).then(function(result) {
      if (result && result.success) {
        showToast('启动模式已保存，重启应用后生效');
      } else {
        showToast('保存启动模式失败', true);
      }
    }).catch(function(e) {
      console.error('保存启动模式失败:', e);
      showToast('保存启动模式失败: ' + (e.message || '未知错误'), true);
    });
  }
}

// ==================== DSH Agent 设置（AI 干活） ====================

/**
 * 初始化 DSH Agent 设置区块：回填配置、技能包状态、运行状态，并绑定操作按钮。
 */
function initDshAgentSection() {
  const api = getElectronAPI();
  if (!api || typeof api.getConfig !== 'function') {
    const section = document.getElementById('dshAgentSection');
    if (section) section.style.display = 'none';
    return;
  }

  // 回填配置
  api.getConfig().then((cfg) => {
    if (!cfg) return;
    const enabled = document.getElementById('dshAgentEnabled');
    const port = document.getElementById('dshPort');
    const binPath = document.getElementById('dshBinPath');
    if (enabled) enabled.checked = cfg.dshAgentEnabled !== false;
    if (port) port.value = cfg.dshPort || 3081;
    if (binPath) binPath.value = cfg.dshBinPath || '';
  }).catch(() => {});

  // 技能包状态 + 工具清单漂移检测
  const renderSkillDrift = (drift) => {
    const el = document.getElementById('dshSkillDriftDesc');
    if (!el) return;
    if (!drift) { el.style.display = 'none'; el.textContent = ''; return; }
    el.style.display = 'block';
    el.style.color = drift.ok ? 'var(--success, #16a34a)' : 'var(--danger, #dc2626)';
    if (drift.ok) {
      el.textContent = `✅ 工具清单已同步（实际 ${drift.actualCount} = SKILL.md 登记 ${drift.documentedCount}）`;
    } else {
      const parts = [];
      if (drift.missingInDoc && drift.missingInDoc.length) parts.push(`未登记 ${drift.missingInDoc.join(', ')}`);
      if (drift.staleInDoc && drift.staleInDoc.length) parts.push(`残留 ${drift.staleInDoc.join(', ')}`);
      el.textContent = `⚠️ 工具清单漂移：${parts.join('；')}（SKILL.md 需按维护约定同步）`;
    }
  };
  const refreshSkillStatus = () => {
    if (!api.dshSkillStatus) return;
    api.dshSkillStatus().then((s) => {
      const desc = document.getElementById('dshSkillStatusDesc');
      if (desc && s) desc.textContent = s.installed
        ? '✅ 已安装：' + s.target
        : '未安装：cut-shelter 技能将复制到 ~/.dsh/skills/cut-shelter';
      if (s) renderSkillDrift(s.drift);
    }).catch(() => {});
  };
  refreshSkillStatus();
  const btnCheckSkill = document.getElementById('btnCheckSkill');
  if (btnCheckSkill) {
    btnCheckSkill.addEventListener('click', () => refreshSkillStatus());
  }

  // 运行状态
  const refreshRunStatus = () => {
    if (!api.dshAgentStatus) return;
    api.dshAgentStatus().then((s) => {
      const desc = document.getElementById('dshAgentRunDesc');
      if (desc && s) desc.textContent = s.running
        ? ('运行中（端口 ' + s.port + (s.owned ? '，本应用拉起' : '，复用实例') + '）')
        : '未运行（端口 ' + (s && s.port || 3081) + '）';
    }).catch(() => {});
  };
  refreshRunStatus();

  // 状态自动同步：DSH 可能由「工具→AI 干活」等其它入口启动/停止，须自动刷新。
  // ① 事件驱动：订阅主进程 dsh-agent-progress 广播（install/start/ready/failed 时立即刷新）
  if (api.onDshAgentProgress) api.onDshAgentProgress(() => { refreshRunStatus(); });
  // ② 兜底轮询：每 2s 探测一次 3081；仅页面可见时轮询，隐藏时暂停以降低开销
  let runPollTimer = null;
  const startRunPolling = () => {
    if (runPollTimer) return;
    runPollTimer = setInterval(() => refreshRunStatus(), 2000);
  };
  const stopRunPolling = () => {
    if (runPollTimer) { clearInterval(runPollTimer); runPollTimer = null; }
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') startRunPolling();
    else stopRunPolling();
  };
  document.addEventListener('visibilitychange', onVisibility);
  onVisibility();

  // 保存设置
  const btnSave = document.getElementById('btnSaveDshConfig');
  if (btnSave) {
    btnSave.addEventListener('click', () => {
      const enabled = document.getElementById('dshAgentEnabled');
      const port = document.getElementById('dshPort');
      const binPath = document.getElementById('dshBinPath');
      api.saveConfig({
        dshAgentEnabled: enabled ? enabled.checked : true,
        dshPort: parseInt(port && port.value, 10) || 3081,
        dshBinPath: (binPath && binPath.value.trim()) || '',
      }).then((r) => {
        showToast(r && r.success ? 'DSH 设置已保存（端口/路径重启应用后生效）' : '保存失败');
        refreshRunStatus();
      }).catch((e) => showToast('保存失败: ' + e.message, true));
    });
  }

  // 一键安装技能包
  const btnSkill = document.getElementById('btnInstallSkill');
  if (btnSkill) {
    btnSkill.addEventListener('click', () => {
      btnSkill.disabled = true;
      btnSkill.textContent = '安装中…';
      api.installDshSkill().then((r) => {
        btnSkill.disabled = false;
        btnSkill.textContent = '一键安装技能包';
        if (r && r.success) showToast('技能包已安装到 ' + r.target);
        else showToast('安装失败：' + ((r && r.message) || '未知错误'), true);
        refreshSkillStatus();
      }).catch((e) => {
        btnSkill.disabled = false;
        btnSkill.textContent = '一键安装技能包';
        showToast('安装失败: ' + e.message, true);
      });
    });
  }

  // 启动 / 停止 / 打开
  const btnStart = document.getElementById('btnStartDshAgent');
  if (btnStart) {
    btnStart.addEventListener('click', () => {
      btnStart.disabled = true;
      api.ensureDshAgent().then((r) => {
        btnStart.disabled = false;
        if (r && r.success) showToast(r.reused ? '已复用现有实例（端口 ' + r.port + '）' : 'DSH 已启动（端口 ' + r.port + '）');
        else showToast('启动失败：' + ((r && r.message) || '未知错误'), true);
        refreshRunStatus();
      }).catch((e) => { btnStart.disabled = false; showToast('启动失败: ' + e.message, true); });
    });
  }
  const btnStop = document.getElementById('btnStopDshAgent');
  if (btnStop) {
    btnStop.addEventListener('click', () => {
      api.stopDshAgent().then(() => {
        showToast('已停止本应用拉起的 DSH（复用实例不受影响）');
        refreshRunStatus();
      });
    });
  }
  const btnOpen = document.getElementById('btnOpenDshAgent');
  if (btnOpen) {
    btnOpen.addEventListener('click', () => {
      const port = parseInt((document.getElementById('dshPort') || {}).value, 10) || 3081;
      window.open('http://127.0.0.1:' + port, '_blank');
    });
  }
}

// 页面就绪后初始化（settings.html 底部脚本调用时机）
if (typeof getElectronAPI === 'function') {
  initDshAgentSection();
}

// ====== 接收主框架消息：滚动到顶部 / 刷新 ======
window.addEventListener('message', (e) => {
  if (e.data.action === 'scrollToTop') {
    document.documentElement.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (e.data.action === 'refresh') {
    location.reload();
  } else if (e.data.action === 'themeChange') {
    applyTheme();
  }
});
