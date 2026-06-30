const API_BASE = 'http://127.0.0.1:8080/api/model-config';
const THEME_KEY = 'app_theme_v1';
const APPEARANCE_KEY = 'app_appearance_v1'; // regular | dark | notion | system

// ====== 外观管理 ======
function getEffectiveTheme() {
  const appearance = localStorage.getItem(APPEARANCE_KEY) || 'notion';
  if (appearance === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'notion';
  }
  return appearance;
}

function applyAppearance(appearance) {
  localStorage.setItem(APPEARANCE_KEY, appearance);
  const theme = getEffectiveTheme();
  const dataTheme = theme === 'dark' ? 'dark' : (theme === 'regular' ? 'regular' : 'notion');
  document.documentElement.setAttribute('data-theme', dataTheme);
  localStorage.setItem(THEME_KEY, dataTheme);
  // 通知父页面
  try { window.parent.postMessage({ type: 'appearanceChanged', appearance: appearance }, '*'); } catch(e) {}
}

function onAppearanceChange() {
  applyAppearance(document.getElementById('appearanceSelect').value);
}

// 初始化外观
(function initAppearance() {
  const appearance = localStorage.getItem(APPEARANCE_KEY) || 'notion';
  document.getElementById('appearanceSelect').value = appearance;
  const theme = getEffectiveTheme();
  const dataTheme = theme === 'dark' ? 'dark' : (theme === 'regular' ? 'regular' : 'notion');
  document.documentElement.setAttribute('data-theme', dataTheme);

  window.addEventListener('storage', function(e) {
    if (e.key === THEME_KEY || e.key === APPEARANCE_KEY) {
      const theme = getEffectiveTheme();
      const dataTheme = theme === 'dark' ? 'dark' : (theme === 'regular' ? 'regular' : 'notion');
      document.documentElement.setAttribute('data-theme', dataTheme);
      document.getElementById('appearanceSelect').value = localStorage.getItem(APPEARANCE_KEY) || 'notion';
    }
  });

  // 监听系统主题变化
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const appearance = localStorage.getItem(APPEARANCE_KEY) || 'notion';
    if (appearance === 'system') {
      const theme = getEffectiveTheme();
      const dataTheme = theme === 'dark' ? 'dark' : (theme === 'regular' ? 'regular' : 'notion');
      document.documentElement.setAttribute('data-theme', dataTheme);
    }
  });
})();

// 加载配置
async function loadConfig() {
  try {
    const response = await fetch(API_BASE);
    const config = await response.json();
    document.getElementById('activeProvider').value = config.activeProvider || 'dashscope';
    document.getElementById('dashscopeApiKey').value = config.dashscopeApiKey || '';
    document.getElementById('dashscopeModel').value = config.dashscopeModel || 'qwen-plus';
    document.getElementById('deepseekApiKey').value = config.deepseekApiKey || '';
    document.getElementById('deepseekModel').value = config.deepseekModel || 'deepseek-chat';
    onProviderChange();
  } catch (error) {
    console.error('加载配置失败:', error);
    showToast('加载配置失败，请检查后端服务');
  }
}

// 保存配置
async function saveConfig() {
  const saveBtn = document.getElementById('saveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = '保存中...';

  const config = {
    activeProvider: document.getElementById('activeProvider').value,
    dashscopeApiKey: document.getElementById('dashscopeApiKey').value,
    dashscopeModel: document.getElementById('dashscopeModel').value,
    deepseekApiKey: document.getElementById('deepseekApiKey').value,
    deepseekModel: document.getElementById('deepseekModel').value
  };

  try {
    const response = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    if (response.ok) {
      showToast('设置已保存');
      onProviderChange();
    } else {
      showToast('保存失败');
    }
  } catch (error) {
    console.error('保存失败:', error);
    showToast('保存失败，请检查后端服务');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '保存设置';
  }
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
    const response = await fetch(`${API_BASE}/test`, {
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
    const response = await fetch(`${API_BASE}/test`, {
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

  if (active === 'deepseek') {
    dashBadge.className = 'badge badge-inactive';
    dashBadge.textContent = '未激活';
    deepBadge.className = 'badge badge-active';
    deepBadge.textContent = '当前';
    document.getElementById('deepseekSection').style.borderColor = 'var(--primary)';
    document.getElementById('dashscopeSection').style.borderColor = 'var(--border)';
  } else {
    dashBadge.className = 'badge badge-active';
    dashBadge.textContent = '当前';
    deepBadge.className = 'badge badge-inactive';
    deepBadge.textContent = '未激活';
    document.getElementById('dashscopeSection').style.borderColor = 'var(--primary)';
    document.getElementById('deepseekSection').style.borderColor = 'var(--border)';
  }
}

// 切换密码可见性
function toggleVisibility(inputId) {
  const input = document.getElementById(inputId);
  input.type = input.type === 'password' ? 'text' : 'password';
}

function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-in forwards';
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  const appearance = localStorage.getItem(APPEARANCE_KEY) || 'notion';
  document.getElementById('appearanceSelect').value = appearance;
  loadConfig();
  initUpdateUI();
});

// ==================== 更新管理 ====================

let updateDownloadUrl = null;
let isUpdating = false;

/**
 * 初始化更新 UI。
 * 读取当前版本号、更新配置，并监听来自主进程的更新事件。
 */
async function initUpdateUI() {
  // 仅在 Electron 环境中显示更新功能
  if (!window.electronAPI) {
    document.getElementById('updateSection').style.display = 'none';
    return;
  }

  try {
    // 加载当前版本号
    const version = await window.electronAPI.getVersion();
    document.getElementById('currentVersion').textContent = 'v' + version;

    // 加载更新配置
    const config = await window.electronAPI.getUpdateConfig();
    const toggle = document.getElementById('autoUpdateToggle');
    toggle.checked = config.autoUpdate === true;
    document.getElementById('updateFrequency').value = config.frequency || 'weekly';
    onAutoUpdateToggle();

    // 监听主进程推送的更新进度
    window.electronAPI.onUpdateProgress((data) => {
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
    window.electronAPI.onUpdateAvailable((data) => {
      showUpdateAvailable(data);
    });

    // 监听更新完成
    window.electronAPI.onUpdateComplete(() => {
      document.getElementById('updateMessage').textContent = '更新完成，应用即将重启...';
      document.getElementById('updateMessage').className = 'update-available';
    });

    // 监听更新错误
    window.electronAPI.onUpdateError((msg) => {
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
  saveUpdateConfig();
}

/**
 * 检查频率变更。
 */
function onFrequencyChange() {
  saveUpdateConfig();
}

/**
 * 保存更新配置到主进程。
 */
async function saveUpdateConfig() {
  if (!window.electronAPI) return;
  try {
    const config = {
      autoUpdate: document.getElementById('autoUpdateToggle').checked,
      frequency: document.getElementById('updateFrequency').value
    };
    await window.electronAPI.saveUpdateConfig(config);
  } catch (e) {
    console.error('[Update] Save config failed:', e);
  }
}

/**
 * 手动检查更新。
 */
async function manualCheckUpdate() {
  if (!window.electronAPI) {
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
    const result = await window.electronAPI.checkForUpdate();

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
  msgEl.innerHTML = `发现新版本 <strong>v${data.version}</strong>（当前 v${data.currentVersion}）`;
  msgEl.className = 'update-available';

  // 显示更新日志
  if (data.releaseNotes) {
    const notesEl = document.createElement('div');
    notesEl.className = 'update-notes';
    notesEl.textContent = data.releaseNotes;
    // 移除旧的更新日志
    const oldNotes = statusEl.querySelector('.update-notes');
    if (oldNotes) oldNotes.remove();
    msgEl.after(notesEl);
  }

  actionsEl.style.display = 'block';
  document.getElementById('updateNowBtn').style.display = 'block';
  document.getElementById('cancelUpdateBtn').style.display = 'none';

  // 保存下载地址
  updateDownloadUrl = data.downloadUrl;
}

/**
 * 开始下载并应用更新。
 */
async function startUpdate() {
  if (isUpdating || !updateDownloadUrl) return;

  isUpdating = true;
  document.getElementById('updateNowBtn').style.display = 'none';
  document.getElementById('cancelUpdateBtn').style.display = 'inline-block';
  document.getElementById('updateProgressBar').style.display = 'block';

  try {
    const result = await window.electronAPI.downloadAndApplyUpdate(updateDownloadUrl);
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