/**
 * 「保存当前网站密码」弹窗逻辑。
 *
 * 流程：
 * 1. 从 URL 参数读取 background.js 传来的当前标签页 url/title 并填充
 * 2. 调用 /api/vault/status 检查密码库是否已解锁
 *    - 未解锁：显示警告，禁用保存按钮，提供「前往密码库」链接
 *    - 已解锁：允许填写并保存
 * 3. 用户填写用户名/密码/备注/标签后点击保存
 * 4. 调用 POST /api/vault/entry 保存到密码库
 * 5. 成功后显示成功视图，1.5s 后自动关闭窗口
 */

// 从 options 配置中提取的后端 API 基础地址（http://host:port）
let API_BASE = 'http://localhost:8081';

document.addEventListener('DOMContentLoaded', async () => {
  await initApiBase();
  applyStoredTheme();
  fillFromUrlParams();
  await checkVaultStatus();
  bindEvents();
});

/**
 * 从 chrome.storage.local 读取 options 中配置的 apiUrl，
 * 从中提取 http://host:port 作为 vault API 基础地址。
 */
async function initApiBase() {
  try {
    const { apiUrl } = await chrome.storage.local.get('apiUrl');
    if (apiUrl) {
      // apiUrl 形如 http://127.0.0.1:8081/api/clip/add，提取到 host:port
      API_BASE = apiUrl.replace(/\/api\/.*$/, '');
    }
  } catch (e) {
    console.warn('[import-password] 读取 apiUrl 配置失败，使用默认值', e);
  }
}

/** 应用 options 中保存的主题（regular/dark/notion） */
function applyStoredTheme() {
  try {
    chrome.storage.local.get('theme', ({ theme }) => {
      if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    });
  } catch (e) { /* 忽略主题错误 */ }
}

/** 从 URL 参数读取 background.js 传来的当前标签页信息并填充表单 */
function fillFromUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const url = params.get('url') || '';
  const title = params.get('title') || '';

  // 网址：去除 hash，保留 query（部分网站登录态在 query 中）
  let cleanUrl = url;
  const hashIdx = cleanUrl.indexOf('#');
  if (hashIdx >= 0) cleanUrl = cleanUrl.substring(0, hashIdx);

  document.getElementById('urlInput').value = cleanUrl;

  // 名称：用 tab.title，去掉常见后缀
  let cleanTitle = title.trim();
  cleanTitle = cleanTitle.replace(/\s*[-—|]\s*.*$/, '').trim();
  if (!cleanTitle && url) {
    // 兜底：用域名
    try { cleanTitle = new URL(url).hostname.replace(/^www\./, ''); }
    catch { cleanTitle = ''; }
  }
  document.getElementById('titleInput').value = cleanTitle;
}

/** 检查密码库状态：是否存在、是否已解锁 */
async function checkVaultStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/vault/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data.exists) {
      showLockAlert('密码库尚未创建，请先在密码库中初始化。');
      disableSave();
      return;
    }
    if (!data.unlocked) {
      showLockAlert('密码库未解锁，请先解锁后再保存。');
      disableSave();
      return;
    }
    // 已解锁，可正常使用
    hideLockAlert();
    enableSave();
  } catch (e) {
    showLockAlert('无法连接后端服务，请确认碎碎记桌面应用已启动。');
    disableSave();
  }
}

function showLockAlert(msg) {
  const alert = document.getElementById('lockAlert');
  alert.querySelector('span').innerHTML = msg;
  alert.classList.remove('hidden');
}
function hideLockAlert() {
  document.getElementById('lockAlert').classList.add('hidden');
}
function disableSave() {
  document.getElementById('saveBtn').disabled = true;
}
function enableSave() {
  document.getElementById('saveBtn').disabled = false;
}

function showError(msg) {
  const alert = document.getElementById('errorAlert');
  alert.textContent = msg;
  alert.classList.remove('hidden');
}
function hideError() {
  document.getElementById('errorAlert').classList.add('hidden');
}

function bindEvents() {
  // 密码显示/隐藏切换
  const toggle = document.getElementById('togglePwd');
  const pwdInput = document.getElementById('passwordInput');
  toggle.addEventListener('click', () => {
    pwdInput.type = pwdInput.type === 'password' ? 'text' : 'password';
  });

  // 取消按钮
  document.getElementById('cancelBtn').addEventListener('click', () => window.close());

  // 前往密码库
  const vaultLink = document.getElementById('openVaultLink');
  if (vaultLink) {
    vaultLink.addEventListener('click', (e) => {
      e.preventDefault();
      const frontendUrl = API_BASE.replace(/:\d+/, ':3001');
      chrome.tabs.create({ url: frontendUrl + '/#/vault' });
      window.close();
    });
  }

  // 生成随机用户名
  document.getElementById('genUserBtn').addEventListener('click', generateUsername);

  // 生成随机密码
  document.getElementById('genPwdBtn').addEventListener('click', generatePassword);

  // 保存按钮
  document.getElementById('saveBtn').addEventListener('click', savePassword);
}

/**
 * 生成随机密码。
 * 优先调用后端 /api/vault/generate-password；若后端不可用则本地生成。
 * 生成后自动填入密码框并切换为明文显示。
 */
async function generatePassword() {
  const length = parseInt(document.getElementById('pwdLength').value) || 16;
  const useSpecial = document.getElementById('useSpecial').checked;
  const useDigits = document.getElementById('useDigits').checked;

  let password;
  try {
    const res = await fetch(`${API_BASE}/api/vault/generate-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        length,
        useUpper: true,
        useLower: true,
        useDigits,
        useSpecial,
        excludeAmbiguous: true
      })
    });
    if (res.ok) {
      const data = await res.json();
      password = data.password;
    } else {
      password = generatePasswordLocal(length, useSpecial, useDigits);
    }
  } catch (e) {
    // 后端不可用时使用本地生成（crypto.getRandomValues）
    password = generatePasswordLocal(length, useSpecial, useDigits);
  }

  const pwdInput = document.getElementById('passwordInput');
  pwdInput.value = password;
  pwdInput.type = 'text'; // 生成后自动显示明文，方便用户查看
}

/**
 * 本地生成随机密码（后端不可用时的 fallback）。
 * 使用 crypto.getRandomValues 保证密码学安全随机。
 * 排除易混淆字符（0/O/o/1/I/l）。
 */
function generatePasswordLocal(length, useSpecial, useDigits) {
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const special = '!@#$%^&*()-_=+';
  let pool = lower + upper;
  if (useDigits) pool += digits;
  if (useSpecial) pool += special;

  const random = new Uint32Array(length);
  crypto.getRandomValues(random);
  let pwd = '';
  for (let i = 0; i < length; i++) {
    pwd += pool[random[i] % pool.length];
  }
  return pwd;
}

/**
 * 生成随机用户名：user_ + 8位随机字符（小写字母+数字）。
 * 直接填入用户名输入框。
 */
function generateUsername() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const random = new Uint32Array(8);
  crypto.getRandomValues(random);
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += chars[random[i] % chars.length];
  }
  document.getElementById('usernameInput').value = 'user_' + suffix;
}

async function savePassword() {
  hideError();
  const title = document.getElementById('titleInput').value.trim();
  const url = document.getElementById('urlInput').value.trim();
  const username = document.getElementById('usernameInput').value.trim();
  const password = document.getElementById('passwordInput').value;
  const notes = document.getElementById('notesInput').value.trim();
  const tagsStr = document.getElementById('tagsInput').value.trim();

  if (!username && !password) {
    showError('请至少填写用户名或密码');
    return;
  }
  if (!password) {
    showError('密码不能为空');
    return;
  }

  const tags = tagsStr ? tagsStr.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [];

  const entry = {
    title: title || '未命名',
    url,
    username,
    password,
    notes,
    tags,
    category: 'login'
  };

  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  btn.textContent = '保存中...';

  try {
    const res = await fetch(`${API_BASE}/api/vault/entry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `保存失败 (HTTP ${res.status})`);
    }
    // 成功：切换到成功视图
    document.getElementById('formView').classList.add('hidden');
    document.getElementById('successView').classList.remove('hidden');
    setTimeout(() => window.close(), 1500);
  } catch (e) {
    showError(e.message || '保存失败，请检查后端服务');
    btn.disabled = false;
    btn.textContent = '保存密码';
  }
}
