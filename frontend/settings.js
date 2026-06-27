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
});