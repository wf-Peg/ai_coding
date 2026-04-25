// 选项页面脚本
const DEFAULT_CONFIG = {
  apiUrl: 'http://localhost:8080/api/clip/add',
  apiTimeout: 30,
  apiRetryCount: 2,
  defaultType: 'ai-text',
  autoTags: true,
  autoSource: true,
  enableNotifications: true,
  successNotification: true,
  clipPageShortcut: 'Ctrl+Shift+S',
  clipSelectionShortcut: 'Ctrl+Shift+D',
  contentSelectors: [
    'article',
    'main',
    '.content',
    '.article-content',
    '.post-content',
    '#content',
    '.main-content',
    '.entry-content',
    '.article-body',
    '.post-body',
    '.blog-content'
  ],
  enableModelCleanup: false,
  modelApiKey: '',
  modelProvider: 'openai',
  modelName: 'gpt-3.5-turbo'
};

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('optionsForm');
  const apiUrlInput = document.getElementById('apiUrl');
  const apiTimeoutInput = document.getElementById('apiTimeout');
  const apiRetryCountInput = document.getElementById('apiRetryCount');
  const defaultTypeSelect = document.getElementById('defaultType');
  const autoTagsCheckbox = document.getElementById('autoTags');
  const autoSourceCheckbox = document.getElementById('autoSource');
  const enableNotificationsCheckbox = document.getElementById('enableNotifications');
  const successNotificationCheckbox = document.getElementById('successNotification');
  const clipPageShortcutInput = document.getElementById('clipPageShortcut');
  const clipSelectionShortcutInput = document.getElementById('clipSelectionShortcut');
  const selectorInput = document.getElementById('selectorInput');
  const addRuleBtn = document.getElementById('addRuleBtn');
  const resetRulesBtn = document.getElementById('resetRulesBtn');
  const rulesList = document.getElementById('rulesList');
  const enableModelCleanupCheckbox = document.getElementById('enableModelCleanup');
  const modelApiKeyInput = document.getElementById('modelApiKey');
  const modelProviderSelect = document.getElementById('modelProvider');
  const modelNameInput = document.getElementById('modelName');
  const testBtn = document.getElementById('testBtn');
  const testStatus = document.getElementById('testStatus');
  const resetBtn = document.getElementById('resetBtn');

  // 加载配置
  await loadConfig();

  // 绑定事件
  form.addEventListener('submit', handleSave);
  testBtn.addEventListener('click', handleTestConnection);
  resetBtn.addEventListener('click', handleReset);

  // 加载配置
  async function loadConfig() {
    try {
      const result = await chrome.storage.local.get(Object.keys(DEFAULT_CONFIG));
      const config = { ...DEFAULT_CONFIG, ...result };
      
      apiUrlInput.value = config.apiUrl;
      apiTimeoutInput.value = config.apiTimeout;
      apiRetryCountInput.value = config.apiRetryCount;
      defaultTypeSelect.value = config.defaultType;
      autoTagsCheckbox.checked = config.autoTags;
      autoSourceCheckbox.checked = config.autoSource;
      enableNotificationsCheckbox.checked = config.enableNotifications;
      successNotificationCheckbox.checked = config.successNotification;
      clipPageShortcutInput.value = config.clipPageShortcut;
      clipSelectionShortcutInput.value = config.clipSelectionShortcut;
      enableModelCleanupCheckbox.checked = config.enableModelCleanup;
      modelApiKeyInput.value = config.modelApiKey;
      modelProviderSelect.value = config.modelProvider;
      modelNameInput.value = config.modelName;
      
      // 加载并渲染内容提取规则
      renderRulesList(config.contentSelectors);
    } catch (error) {
      console.error('加载配置失败:', error);
      // 使用默认值
      fillFormWithDefaults();
    }
  }

  // 填充默认值
  function fillFormWithDefaults() {
    apiUrlInput.value = DEFAULT_CONFIG.apiUrl;
    apiTimeoutInput.value = DEFAULT_CONFIG.apiTimeout;
    apiRetryCountInput.value = DEFAULT_CONFIG.apiRetryCount;
    defaultTypeSelect.value = DEFAULT_CONFIG.defaultType;
    autoTagsCheckbox.checked = DEFAULT_CONFIG.autoTags;
    autoSourceCheckbox.checked = DEFAULT_CONFIG.autoSource;
    enableNotificationsCheckbox.checked = DEFAULT_CONFIG.enableNotifications;
    successNotificationCheckbox.checked = DEFAULT_CONFIG.successNotification;
    clipPageShortcutInput.value = DEFAULT_CONFIG.clipPageShortcut;
    clipSelectionShortcutInput.value = DEFAULT_CONFIG.clipSelectionShortcut;
    enableModelCleanupCheckbox.checked = DEFAULT_CONFIG.enableModelCleanup;
    modelApiKeyInput.value = DEFAULT_CONFIG.modelApiKey;
    modelProviderSelect.value = DEFAULT_CONFIG.modelProvider;
    modelNameInput.value = DEFAULT_CONFIG.modelName;
    
    // 渲染默认内容提取规则
    renderRulesList(DEFAULT_CONFIG.contentSelectors);
  }

  // 保存配置
  async function handleSave(e) {
    e.preventDefault();
    
    // 获取当前的内容提取规则
    const contentSelectors = [];
    rulesList.querySelectorAll('.rule-selector').forEach(el => {
      contentSelectors.push(el.textContent.trim());
    });
    
    const config = {
      apiUrl: apiUrlInput.value.trim() || DEFAULT_CONFIG.apiUrl,
      apiTimeout: parseInt(apiTimeoutInput.value) || DEFAULT_CONFIG.apiTimeout,
      apiRetryCount: parseInt(apiRetryCountInput.value) || DEFAULT_CONFIG.apiRetryCount,
      defaultType: defaultTypeSelect.value,
      autoTags: autoTagsCheckbox.checked,
      autoSource: autoSourceCheckbox.checked,
      enableNotifications: enableNotificationsCheckbox.checked,
      successNotification: successNotificationCheckbox.checked,
      clipPageShortcut: clipPageShortcutInput.value.trim() || DEFAULT_CONFIG.clipPageShortcut,
      clipSelectionShortcut: clipSelectionShortcutInput.value.trim() || DEFAULT_CONFIG.clipSelectionShortcut,
      contentSelectors: contentSelectors,
      enableModelCleanup: enableModelCleanupCheckbox.checked,
      modelApiKey: modelApiKeyInput.value.trim(),
      modelProvider: modelProviderSelect.value,
      modelName: modelNameInput.value.trim() || DEFAULT_CONFIG.modelName
    };

    try {
      await chrome.storage.local.set(config);
      
      // 如果启用通知，请求权限
      if (config.enableNotifications) {
        if (Notification.permission === 'default') {
          await Notification.requestPermission();
        }
      }
      
      showSaveSuccess();
    } catch (error) {
      console.error('保存配置失败:', error);
      alert('保存配置失败，请重试');
    }
  }

  // 测试连接
  async function handleTestConnection() {
    const apiUrl = apiUrlInput.value.trim();
    if (!apiUrl) {
      showTestStatus('请输入API地址', 'error');
      return;
    }

    showTestStatus('正在测试...', 'loading');
    testBtn.disabled = true;

    try {
      // 尝试访问API的根路径或某个简单接口
      const response = await fetch(apiUrl.replace('/add', '/list'), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok || response.status === 404) {
        // 404可能说明后端在运行只是路径不对
        showTestStatus('✅ 连接成功！', 'success');
      } else {
        showTestStatus('❌ 连接失败，状态码: ' + response.status, 'error');
      }
    } catch (error) {
      console.error('连接测试失败:', error);
      showTestStatus('❌ 无法连接到后端服务，请检查地址和服务状态', 'error');
    } finally {
      testBtn.disabled = false;
    }
  }

  // 重置为默认值
  function handleReset() {
    if (confirm('确定要重置所有设置为默认值吗？')) {
      fillFormWithDefaults();
    }
  }

  // 显示测试状态
  function showTestStatus(message, type) {
    testStatus.textContent = message;
    testStatus.className = 'test-status ' + type;
  }

  // 显示保存成功提示
  function showSaveSuccess() {
    // 检查是否已存在提示元素
    let successEl = document.querySelector('.save-success');
    if (!successEl) {
      successEl = document.createElement('div');
      successEl.className = 'save-success';
      document.body.appendChild(successEl);
    }
    
    successEl.textContent = '✅ 设置已保存！';
    successEl.style.display = 'block';
    
    setTimeout(() => {
      successEl.style.display = 'none';
    }, 2000);
  }
  
  // 渲染规则列表
  function renderRulesList(selectors) {
    rulesList.innerHTML = '';
    
    selectors.forEach((selector, index) => {
      const ruleItem = document.createElement('div');
      ruleItem.className = 'rule-item';
      ruleItem.dataset.index = index;
      
      ruleItem.innerHTML = `
        <div class="rule-selector">${selector}</div>
        <div class="rule-actions">
          <button class="rule-btn move-up" title="上移">↑</button>
          <button class="rule-btn move-down" title="下移">↓</button>
          <button class="rule-btn delete" title="删除">×</button>
        </div>
      `;
      
      rulesList.appendChild(ruleItem);
    });
    
    // 绑定事件
    bindRuleEvents();
  }
  
  // 绑定规则操作事件
  function bindRuleEvents() {
    // 上移按钮
    rulesList.querySelectorAll('.rule-btn.move-up').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const ruleItem = e.target.closest('.rule-item');
        const index = parseInt(ruleItem.dataset.index);
        if (index > 0) {
          const prevItem = ruleItem.previousElementSibling;
          ruleItem.parentNode.insertBefore(ruleItem, prevItem);
          updateRuleIndexes();
        }
      });
    });
    
    // 下移按钮
    rulesList.querySelectorAll('.rule-btn.move-down').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const ruleItem = e.target.closest('.rule-item');
        const index = parseInt(ruleItem.dataset.index);
        const nextItem = ruleItem.nextElementSibling;
        if (nextItem) {
          ruleItem.parentNode.insertBefore(nextItem, ruleItem);
          updateRuleIndexes();
        }
      });
    });
    
    // 删除按钮
    rulesList.querySelectorAll('.rule-btn.delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const ruleItem = e.target.closest('.rule-item');
        ruleItem.remove();
        updateRuleIndexes();
      });
    });
  }
  
  // 更新规则索引
  function updateRuleIndexes() {
    rulesList.querySelectorAll('.rule-item').forEach((item, index) => {
      item.dataset.index = index;
    });
  }
  
  // 添加规则
  function addRule() {
    const selector = selectorInput.value.trim();
    if (!selector) {
      alert('请输入选择器');
      return;
    }
    
    // 检查是否已存在
    const existingSelectors = [];
    rulesList.querySelectorAll('.rule-selector').forEach(el => {
      existingSelectors.push(el.textContent.trim());
    });
    
    if (existingSelectors.includes(selector)) {
      alert('该选择器已存在');
      return;
    }
    
    // 添加新规则
    const ruleItem = document.createElement('div');
    ruleItem.className = 'rule-item';
    ruleItem.dataset.index = rulesList.children.length;
    
    ruleItem.innerHTML = `
      <div class="rule-selector">${selector}</div>
      <div class="rule-actions">
        <button class="rule-btn move-up" title="上移">↑</button>
        <button class="rule-btn move-down" title="下移">↓</button>
        <button class="rule-btn delete" title="删除">×</button>
      </div>
    `;
    
    rulesList.appendChild(ruleItem);
    bindRuleEvents();
    selectorInput.value = '';
  }
  
  // 绑定添加规则按钮事件
  addRuleBtn.addEventListener('click', addRule);
  
  // 绑定重置规则按钮事件
  resetRulesBtn.addEventListener('click', () => {
    if (confirm('确定要重置为默认规则吗？')) {
      renderRulesList(DEFAULT_CONFIG.contentSelectors);
    }
  });
  
  // 绑定选择器输入框的回车事件
  selectorInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addRule();
    }
  });
});
