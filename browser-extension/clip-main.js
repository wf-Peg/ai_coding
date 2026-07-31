const API_BASE_URL = 'http://127.0.0.1:8080/api/clip';
const GIT_API_BASE_URL = 'http://127.0.0.1:8080/api/git';
let currentTags = [];
const MAX_TAGS = 10;
const THEME_STORAGE_KEY = 'app_theme_v1';
let currentPromptType = 'daily';
let promptConfigCache = null;
let feedbackPathValue = '';
let currentTheme = 'regular';

function getNextThemeId(themeId) {
    return themeId === 'notion' ? 'regular' : 'notion';
}

function updateThemeToggleLabel() {
    const toggle = document.getElementById('themeToggle');
    if (!toggle) return;
    const nextThemeName = getNextThemeId(currentTheme) === 'notion' ? 'Notion风格' : '常规风格';
    toggle.title = `切换到${nextThemeName}`;
    toggle.setAttribute('aria-label', `切换到${nextThemeName}`);
}

function applyTheme(themeId, persist = true) {
    currentTheme = themeId === 'notion' ? 'notion' : 'regular';
    const notionThemeLink = document.getElementById('clipThemeNotion');
    if (notionThemeLink) {
        notionThemeLink.disabled = currentTheme !== 'notion';
    }
    document.documentElement.setAttribute('data-theme', currentTheme);
    if (persist) {
        localStorage.setItem(THEME_STORAGE_KEY, currentTheme);
    }
    updateThemeToggleLabel();
}

// 其他函数和事件监听器...
document.addEventListener('DOMContentLoaded', () => {
    applyTheme(localStorage.getItem(THEME_STORAGE_KEY));
    fetchClips();
    loadCategories();
    handleTypeChange();

    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            applyTheme(getNextThemeId(currentTheme));
        });
    }
    window.addEventListener('storage', event => {
        if (event.key === THEME_STORAGE_KEY) {
            applyTheme(event.newValue, false);
        }
    });

    const tagInput = document.getElementById('tag-input');
    tagInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addTag(tagInput.value);
            tagInput.value = '';
        }
    });

    // 为确认按钮添加点击事件
    document.getElementById('confirm-btn').addEventListener('click', confirmAction);

    document.getElementById('clip-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        const type = document.getElementById('type').value;
        const source = document.getElementById('source').value;
        const category = document.getElementById('category').value;
        const useAiTags = document.getElementById('ai-generate-tags').checked;
        const submitBtn = e.target.querySelector('button[type="submit"]');

        // Build request body based on type
        let content = document.getElementById('content').value;
        let requestBody = {
            type,
            source,
            category,
            tags: useAiTags ? null : currentTags,
            useAiTags: type === 'store-only' ? false : useAiTags
        };

        if (type === 'doc-ai') {
            if (!uploadedFileBase64) {
                showToast('请上传文件');
                return;
            }
            requestBody.content = uploadedFileName;
            requestBody.fileData = uploadedFileBase64;
            requestBody.fileName = uploadedFileName;
        }

        // 其余代码...
    });
});

// 其他函数...
function fetchClips() {
    // 实现获取剪藏列表的逻辑
}

function loadCategories() {
    // 实现加载分类的逻辑
}

function handleTypeChange() {
    // 实现处理类型变更的逻辑
}

function addTag(tag) {
    // 实现添加标签的逻辑
}

function confirmAction() {
    // 实现确认操作的逻辑
}

function clearForm() {
    // 实现清空表单的逻辑
}

function startVoiceInput() {
    // 实现语音输入的逻辑
}

function clearSearch() {
    // 实现清空搜索的逻辑
}

function backToList() {
    // 实现返回列表的逻辑
}

function handleImageFiles(files) {
    // 实现处理图片文件的逻辑
}

function removeFile() {
    // 实现移除文件的逻辑
}

function removeImage(index) {
    // 实现移除图片的逻辑
}

function removeTag(tag) {
    // 实现移除标签的逻辑
}

function toggleTags(button, tags) {
    // 实现切换标签的逻辑
}

function generateDivergentSummary(id) {
    // 实现生成发散总结的逻辑
}

function toggleDetail(button) {
    // 实现切换详情的逻辑
}

function copyToClipboard(text) {
    // 实现复制到剪贴板的逻辑
}

function closeGitConfigModal() {
    // 实现关闭Git配置模态框的逻辑
}

function testGitConnection() {
    // 实现测试Git连接的逻辑
}

function saveGitConfig() {
    // 实现保存Git配置的逻辑
}

// 函数定义
function toggleMode() {
    const toggleBtn = document.getElementById('toggle-btn');
    const toggleText = document.getElementById('toggle-text');
    const addClipSection = document.getElementById('add-clip-section');
    const searchSection = document.getElementById('search-section');
    const searchResultsPage = document.getElementById('search-results-page');
    const clipList = document.getElementById('clip-list');

    if (currentMode === 'add-clip') {
        currentMode = 'search';
        toggleBtn.classList.add('active');
        toggleText.textContent = '📋 切换到添加剪藏';
        addClipSection.style.display = 'none';
        searchSection.style.display = 'block';
        searchResultsPage.style.display = 'none';
        clipList.style.display = 'block';
    } else {
        currentMode = 'add-clip';
        toggleBtn.classList.remove('active');
        toggleText.textContent = '🔍 切换到信息检索';
        addClipSection.style.display = 'block';
        searchSection.style.display = 'none';
        searchResultsPage.style.display = 'none';
        clipList.style.display = 'block';
    }
}

function displaySearchResults(results) {
    const searchResultsContainer = document.getElementById('search-results');
    searchResultsContainer.innerHTML = '';

    if (results.length === 0) {
        searchResultsContainer.innerHTML = `
                <div class="empty-state">
                    <h3>没有找到相关内容</h3>
                    <p>请尝试其他搜索关键词</p>
                </div>
            `;
    } else {
        results.forEach(clip => {
            const clipItem = createClipItem(clip, true);
            searchResultsContainer.appendChild(clipItem);
        });
    }

    document.getElementById('search-results-page').style.display = 'block';
    document.getElementById('clip-list').style.display = 'none';
}

async function fetchClips() {
    try {
        const response = await axios.get(`${API_BASE_URL}/list`);
        let clips = response.data;

        // 过滤掉待办事项数据（前端过滤，后端存储不变）
        const filteredClips = clips.filter(clip => {
            // 根据特征判断是否为待办事项数据
            // 待办事项通常有特定的类型或内容特征
            return !clip.type || clip.type !== 'todo' && !clip.content?.includes('前完成') && !clip.content?.includes('待办');
        });

        console.log('===== 调试信息 =====');
        console.log('获取到的剪藏数量:', clips.length);
        console.log('过滤后的剪藏数量:', filteredClips.length);
        if (filteredClips.length > 0) {
            console.log('第一个剪藏分析内容:', filteredClips[0].analysis);
            console.log('第一个剪藏分析内容类型:', typeof filteredClips[0].analysis);
        }

        const clipItemsContainer = document.getElementById('clip-items');
        const clipCountElement = document.getElementById('clip-count');

        clipCountElement.textContent = filteredClips.length;
        clipItemsContainer.innerHTML = '';

        if (filteredClips.length === 0) {
            clipItemsContainer.innerHTML = `
                    <div class="empty-state">
                        <h3>暂无剪藏内容</h3>
                        <p>开始添加你的第一个剪藏吧！</p>
                    </div>
                `;
            return;
        }

        filteredClips.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        filteredClips.forEach(clip => {
            const clipItem = createClipItem(clip, false);
            clipItemsContainer.appendChild(clipItem);
        });

        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const clipId = e.target.dataset.id;
                showConfirmModal(clipId, '确定要删除这个剪藏吗？');
            });
        });
    } catch (error) {
        console.error('获取剪藏列表失败:', error);
        document.getElementById('clip-items').innerHTML = `
                <div class="empty-state">
                    <h3>获取剪藏列表失败</h3>
                    <p>请检查后端服务是否正常运行</p>
                </div>
            `;
    }
}

function createClipItem(clip, isSearch) {
    const clipItem = document.createElement('div');
    clipItem.className = 'clip-item';

    const createdAt = new Date(clip.createdAt).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });

    let tagsHtml = '';
    if (clip.tags && clip.tags.length > 0) {
        const displayTags = clip.tags.slice(0, 3);
        const remainingTags = clip.tags.slice(3);
        const allTags = clip.tags;

        tagsHtml = `
                <div class="tags-display" style="margin-top: 12px;">
                    <div class="tags-collapsed">
                        ${displayTags.map(tag => `<span class="tag-display-item"><span class="tag"><span>${tag}</span></span></span>`).join('')}
                        ${remainingTags.length > 0 ? `<button class="tag-expand-btn" data-tags="${allTags.map(t => t.replace(/'/g, "\\'"))}">+${remainingTags.length}</button>` : ''}
                    </div>
                    ${remainingTags.length > 0 ? `<div class="tags-all" style="display: none;">${allTags.map(tag => `<span class="tag-display-item"><span class="tag"><span>${tag}</span></span></span>`).join('')}</div>` : ''}
                </div>
            `;
    }

    const displaySummary = clip.summary || '暂无摘要';
    const isStoreOnly = clip.type === 'store-only';
    const summaryClass = isStoreOnly ? 'store-only-summary' : '';
    const originalContent = clip.content || '';
    const analysisContent = clip.analysis || '';

    clipItem.innerHTML = `
            <div class="clip-header">
                <span class="category-badge">📁 ${getCategoryLabel(clip.category)}</span>
                <div class="clip-actions">
                    ${!isSearch ? `<button class="delete-btn" data-id="${clip.id}">删除</button>` : ''}
                    ${!isStoreOnly ? `<button class="expand-btn divergent-btn" data-id="${clip.id}" title="发散总结">💡</button>` : ''}
                    <button class="expand-btn toggle-detail-btn">
                        <span class="icon">▼</span>
                        <span class="text">展开</span>
                    </button>
                </div>
            </div>
            <div class="clip-summary ${summaryClass}" title="${escapeHtml(displaySummary)}">${escapeHtml(displaySummary)}</div>
            <div class="clip-meta">
                <span class="meta-item meta-type">类型: ${getTypeLabel(clip.type)}</span>
                <span class="meta-item">来源: ${clip.source}</span>
                <span class="meta-item">创建时间: ${createdAt}</span>
            </div>
            ${tagsHtml}
            <div class="clip-detail">
                <div class="content-section">
                    <h4>原文</h4>
                    <div class="content-text truncated">${escapeHtml(originalContent)}</div>
                    <button class="copy-btn" data-text="${escapeJs(originalContent)}">
                        📋 复制原文
                    </button>
                </div>
                ${!isStoreOnly ? (analysisContent ? `
                <div class="content-section">
                    <h4>AI分析</h4>
                    <div class="markdown-content" id="analysis-content-${clip.id}"></div>
                    <button class="btn-secondary divergent-btn" style="margin-top: 12px;" data-id="${clip.id}">
                        🔄 发散性总结
                    </button>
                </div>
                <div class="content-section" id="divergent-summary-${clip.id}" style="display: none;">
                    <h4>发散性总结</h4>
                    <div class="divergent-content markdown-content" id="divergent-content-${clip.id}">
                        <p>生成中...</p>
                    </div>
                    <button class="copy-btn copy-summary-btn" data-id="${clip.id}">
                        📋 复制总结
                    </button>
                </div>
                ` : `
                <div class="content-section">
                    <h4>AI分析</h4>
                    <div class="markdown-content" style="text-align: center; padding: 20px;">
                        <p style="color: var(--text-secondary);">内容处理中...</p>
                        <p style="font-size: 0.9rem; color: var(--text-secondary); margin-top: 10px;">AI正在分析内容，请稍候</p>
                    </div>
                </div>
                `) : ''}
            </div>
        `;

    if (analysisContent) {
        // console.log('===== 剪藏ID:', clip.id, '的分析内容调试 =====');
        // console.log('原始分析内容:', analysisContent);
        // console.log('原始内容长度:', analysisContent.length);

        const analysisContentDiv = clipItem.querySelector(`#analysis-content-${clip.id}`);
        if (analysisContentDiv) {
            try {
                let cleanContent = analysisContent;

                if (cleanContent.startsWith('```markdown')) {
                    cleanContent = cleanContent.substring('```markdown'.length);
                }
                if (cleanContent.startsWith('```')) {
                    cleanContent = cleanContent.substring(3);
                }
                if (cleanContent.endsWith('```')) {
                    cleanContent = cleanContent.substring(0, cleanContent.length - 3);
                }
                cleanContent = cleanContent.trim();

                console.log('清理后的内容:', cleanContent);

                const renderedHtml = marked.parse(cleanContent);
                console.log('marked渲染后的HTML:', renderedHtml);
                analysisContentDiv.innerHTML = renderedHtml;
                console.log('DOM元素的innerHTML:', analysisContentDiv.innerHTML);
            } catch (e) {
                console.error('Markdown渲染失败:', e);
                analysisContentDiv.textContent = analysisContent;
            }
        }
    }

    return clipItem;
}

function toggleDetail(btn) {
    const clipItem = btn.closest('.clip-item');
    const detail = clipItem.querySelector('.clip-detail');
    const icon = btn.querySelector('.icon');
    const text = btn.querySelector('.text');

    detail.classList.toggle('expanded');
    btn.classList.toggle('expanded');

    if (detail.classList.contains('expanded')) {
        text.textContent = '收起';
    } else {
        text.textContent = '展开';
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeJs(text) {
    if (!text) return '';
    return text.replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('已复制到剪贴板！');
    }).catch(err => {
        console.error('复制失败:', err);
        showToast('复制失败，请手动复制');
    });
}

async function generateDivergentSummary(clipId) {
    const divergentSection = document.getElementById(`divergent-summary-${clipId}`);
    const divergentContent = document.getElementById(`divergent-content-${clipId}`);

    divergentSection.style.display = 'block';
    divergentContent.innerHTML = '<p>生成中...</p>';

    try {
        const response = await axios.get(`${API_BASE_URL}/divergent-summary/${clipId}`);
        const summary = response.data;

        const markdownHtml = marked.parse(summary);
        typeWriterEffect(divergentContent, markdownHtml);
    } catch (error) {
        console.error('生成发散性总结失败:', error);
        divergentContent.innerHTML = '<p style="color: var(--secondary);">生成失败，请稍后重试</p>';
    }
}

function typeWriterEffect(element, html) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    const fullText = tempDiv.textContent || tempDiv.innerText;

    element.innerHTML = '<p>生成中...</p>';

    let index = 0;
    element.innerHTML = '';

    element.innerHTML = html;
    element.style.opacity = '0';

    setTimeout(() => {
        element.style.transition = 'opacity 1s ease-out';
        element.style.opacity = '1';
    }, 100);

    element.style.animation = 'none';

    const textOnly = fullText;
    let charIndex = 0;
    element.innerHTML = '';

    function typeChar() {
        if (charIndex < textOnly.length) {
            element.textContent = textOnly.substring(0, charIndex + 1);
            charIndex++;
            setTimeout(typeChar, 20);
        } else {
            setTimeout(() => {
                element.innerHTML = html;
            }, 300);
        }
    }

    typeChar();
}

function toggleTags(btn, tagsStr) {
    const tagsDisplay = btn.closest('.tags-display');
    const tagsCollapsed = tagsDisplay.querySelector('.tags-collapsed');
    const tagsAll = tagsDisplay.querySelector('.tags-all');

    if (tagsAll.style.display === 'flex') {
        tagsAll.style.display = 'none';
        tagsCollapsed.style.display = 'flex';
    } else {
        tagsCollapsed.style.display = 'none';
        tagsAll.style.display = 'flex';
    }
}

let confirmActionCallback = null;

function showConfirmModal(id, message) {
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-modal').style.display = 'flex';
    confirmActionCallback = () => deleteClip(id);
}

function closeConfirmModal() {
    document.getElementById('confirm-modal').style.display = 'none';
    confirmActionCallback = null;
}

async function loadPromptConfig() {
    if (promptConfigCache) {
        return promptConfigCache;
    }
    const response = await axios.get(`${API_BASE_URL}/prompt-config`);
    promptConfigCache = response.data || {};
    return promptConfigCache;
}

async function openPromptConfigModal(type) {
    currentPromptType = type;
    const title = document.getElementById('prompt-config-title');
    const desc = document.getElementById('prompt-config-desc');
    const textarea = document.getElementById('prompt-config-textarea');

    if (type === 'daily') {
        title.textContent = '整理今日内容 Prompt 配置';
        desc.textContent = '编辑整理今日内容时使用的系统提示词';
    } else {
        title.textContent = '周报总结 Prompt 配置';
        desc.textContent = '编辑生成周报总结时使用的系统提示词';
    }

    try {
        const config = await loadPromptConfig();
        textarea.value = type === 'daily'
            ? (config.dailyOrganizeSystemPrompt || '')
            : (config.weeklyReportSystemPrompt || '');
        document.getElementById('prompt-config-modal').style.display = 'flex';
    } catch (error) {
        console.error('加载Prompt配置失败:', error);
        showError('加载失败', 'Prompt配置加载失败，请稍后重试');
    }
}

function closePromptConfigModal() {
    document.getElementById('prompt-config-modal').style.display = 'none';
}

async function savePromptConfig() {
    const textarea = document.getElementById('prompt-config-textarea');
    const value = textarea.value.trim();
    if (!value) {
        showError('保存失败', 'Prompt 不能为空');
        return;
    }

    try {
        const config = await loadPromptConfig();
        const payload = {
            dailyOrganizeSystemPrompt: config.dailyOrganizeSystemPrompt || '',
            weeklyReportSystemPrompt: config.weeklyReportSystemPrompt || ''
        };
        if (currentPromptType === 'daily') {
            payload.dailyOrganizeSystemPrompt = value;
        } else {
            payload.weeklyReportSystemPrompt = value;
        }

        const response = await axios.post(`${API_BASE_URL}/prompt-config`, payload);
        promptConfigCache = response.data;
        showNotification('Prompt 配置保存成功');
        closePromptConfigModal();
    } catch (error) {
        console.error('保存Prompt配置失败:', error);
        showError('保存失败', error.response?.data?.message || '请稍后重试');
    }
}

async function resetPromptConfig() {
    try {
        const response = await axios.post(`${API_BASE_URL}/prompt-config/reset`);
        promptConfigCache = response.data;

        const textarea = document.getElementById('prompt-config-textarea');
        textarea.value = currentPromptType === 'daily'
            ? (promptConfigCache.dailyOrganizeSystemPrompt || '')
            : (promptConfigCache.weeklyReportSystemPrompt || '');
        showNotification('Prompt 已恢复默认配置');
    } catch (error) {
        console.error('重置Prompt配置失败:', error);
        showError('重置失败', error.response?.data?.message || '请稍后重试');
    }
}

function confirmAction() {
    if (confirmActionCallback) {
        confirmActionCallback();
    }
    closeConfirmModal();
}

async function deleteClip(id) {
    try {
        const response = await axios.delete(`${API_BASE_URL}/${id}`);
        if (response.data.status === 'success') {
            fetchClips();
        }
    } catch (error) {
        console.error('删除剪藏失败:', error);
        showToast('删除失败，请稍后重试');
    }
}

async function organizeContent() {
    const organizeBtn = document.getElementById('organize-btn');
    const originalText = organizeBtn.textContent;

    try {
        // 显示加载状态
        showLoading('正在整理内容...', '正在处理剪藏内容，请稍候...');

        // 禁用按钮
        organizeBtn.disabled = true;
        organizeBtn.classList.add('btn-loading');

        const response = await axios.post(`${API_BASE_URL}/organize`);

        if (response.data.status === 'success') {
            showNotification('内容整理完成！', true);
        }
    } catch (error) {
        console.error('整理内容失败:', error);
        showError('整理失败', error.response?.data?.message || '请稍后重试');
    } finally {
        // 隐藏加载状态
        hideLoading();

        // 恢复按钮状态
        organizeBtn.disabled = false;
        organizeBtn.classList.remove('btn-loading');
        organizeBtn.textContent = originalText;
    }
}

async function generateWeeklyReport() {
    const reportBtn = document.getElementById('weekly-report-btn');
    const originalText = reportBtn.textContent;

    try {
        // 显示加载状态
        showLoading('正在生成周报...', '正在分析本周内容，请稍候...');

        // 禁用按钮
        reportBtn.disabled = true;
        reportBtn.classList.add('btn-loading');

        const response = await axios.post(`${API_BASE_URL}/weekly-report`);

        if (response.data.status === 'success') {
            showNotification('周报生成完成！', true);
        }
    } catch (error) {
        console.error('生成周报失败:', error);
        showError('生成失败', error.response?.data?.message || '请稍后重试');
    } finally {
        // 隐藏加载状态
        hideLoading();

        // 恢复按钮状态
        reportBtn.disabled = false;
        reportBtn.classList.remove('btn-loading');
        reportBtn.textContent = originalText;
    }
}

function showToast(msg) {
  const existing = document.querySelector('.ext-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'ext-toast';
  t.textContent = msg;
  t.style.cssText = 'position:fixed;top:20px;right:20px;background:var(--card,#1e1e1e);color:var(--fg,#d4d4d4);padding:10px 20px;border-radius:10px;border:1px solid var(--border,#3e3e3e);z-index:9999;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,0.3);animation:extSlideIn 0.3s ease-out;';
  document.body.appendChild(t);
  setTimeout(() => { t.style.animation = 'extSlideOut 0.3s ease-in forwards'; setTimeout(() => t.remove(), 300); }, 2000);
}

function showNotification(message, showOpenButton = false) {
    const notificationBar = document.getElementById('notification-bar');
    const notificationMessage = document.getElementById('notification-message');
    const openFolderBtn = document.getElementById('open-folder-btn');

    notificationMessage.textContent = message;
    openFolderBtn.style.display = showOpenButton === true ? 'block' : 'none';
    notificationBar.style.display = 'block';
}

function closeNotification() {
    document.getElementById('notification-bar').style.display = 'none';
}

function openStorageFolder() {
    // 调用后端API打开存储目录
    axios.post(`${API_BASE_URL}/open-storage-folder`)
        .then(response => {
            if (response.data.status === 'success') {
                showFeedbackModal('打开目录', response.data.message, response.data.storagePath || '');
            } else {
                showFeedbackModal('打开目录失败', response.data.message || '打开存储目录失败');
            }
        })
        .catch(error => {
            console.error('打开存储目录失败:', error);
            showFeedbackModal('打开目录失败', error.response?.data?.message || '打开存储目录失败，请稍后重试');
        });
}

function showFeedbackModal(title, message, path = '') {
    const titleNode = document.getElementById('feedback-title');
    const messageNode = document.getElementById('feedback-message');
    const pathBlock = document.getElementById('feedback-path-block');
    const copyBtn = document.getElementById('copy-path-btn');

    titleNode.textContent = title;
    messageNode.textContent = message;

    feedbackPathValue = path || '';
    if (feedbackPathValue) {
        pathBlock.textContent = feedbackPathValue;
        pathBlock.style.display = 'block';
        copyBtn.style.display = 'inline-block';
    } else {
        pathBlock.style.display = 'none';
        copyBtn.style.display = 'none';
    }

    document.getElementById('feedback-modal').style.display = 'flex';
}

function closeFeedbackModal() {
    document.getElementById('feedback-modal').style.display = 'none';
}

function copyFeedbackPath() {
    if (!feedbackPathValue) {
        return;
    }
    navigator.clipboard.writeText(feedbackPathValue)
        .then(() => showNotification('路径已复制'))
        .catch(() => showError('复制失败', '请手动复制路径'));
}

// 加载状态管理函数
function showLoading(text = '处理中...', subtext = '请稍候...') {
    const overlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    const loadingSubtext = document.getElementById('loading-subtext');

    loadingText.textContent = text;
    loadingSubtext.textContent = subtext;
    overlay.style.display = 'flex';
}

function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    overlay.style.display = 'none';
}

// 错误提示函数
function showError(title, message) {
    // 创建错误提示
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(239, 68, 68, 0.95);
            color: white;
            padding: 16px 24px;
            border-radius: var(--radius);
            box-shadow: var(--shadow-hover);
            z-index: 3000;
            animation: slideIn 0.3s ease-out;
            max-width: 400px;
        `;

    errorDiv.innerHTML = `
            <div style="display: flex; align-items: flex-start; gap: 12px;">
                <div style="font-size: 1.5rem; flex-shrink: 0;">⚠️</div>
                <div style="flex: 1;">
                    <h4 style="margin: 0 0 8px 0; font-size: 1.1rem; font-weight: 600;">${title}</h4>
                    <p style="margin: 0; font-size: 0.95rem; opacity: 0.9;">${message}</p>
                    <button class="error-close-btn" style="
                        margin-top: 12px;
                        background: rgba(255, 255, 255, 0.2);
                        border: none;
                        color: white;
                        padding: 6px 12px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 0.85rem;
                        transition: background 0.3s ease;
                    ">关闭</button>
                </div>
            </div>
        `;

    document.body.appendChild(errorDiv);

    // 3秒后自动消失
    setTimeout(() => {
        if (errorDiv.parentNode) {
            errorDiv.style.animation = 'slideOut 0.3s ease-in';
            setTimeout(() => errorDiv.remove(), 300);
        }
    }, 5000);
}

function handleTypeChange() {
    const type = document.getElementById('type').value;
    const imageUploadArea = document.getElementById('image-upload-area');
    const fileUploadArea = document.getElementById('file-upload-area');
    
    // 控制图片上传区域显示
    if (type === 'ai-text' || type === 'store-only') {
        imageUploadArea.style.display = 'block';
    } else {
        imageUploadArea.style.display = 'none';
    }
    
    // 控制文件上传区域显示
    if (type === 'doc-ai') {
        fileUploadArea.style.display = 'block';
    } else {
        fileUploadArea.style.display = 'none';
    }
}

function syncGit() {
    const syncBtn = document.getElementById('sync-btn');
    
    syncBtn.disabled = true;
    syncBtn.innerHTML = '<span class="toggle-text">🔄 同步中...</span>';

    axios.post(`${GIT_API_BASE_URL}/sync`)
        .then(response => {
            syncBtn.innerHTML = '<span class="toggle-text">🔄 同步仓库</span>';
            syncBtn.disabled = false;
            showNotification('同步成功', 'success');
        })
        .catch(error => {
            syncBtn.innerHTML = '<span class="toggle-text">🔄 同步仓库</span>';
            syncBtn.disabled = false;
            showNotification('同步失败', 'error');
            console.error('Git sync failed:', error);
        });
}

function startRefreshCheck() {
    // 定期检查是否有新内容
    setTimeout(() => {
        fetchClips();
    }, 5000);
}

// Git配置相关函数
function openGitConfigModal() {
    // 显示配置弹窗
    document.getElementById('git-config-modal').style.display = 'flex';
    // 加载当前配置
    loadGitConfig();
}

function closeGitConfigModal() {
    // 隐藏配置弹窗
    document.getElementById('git-config-modal').style.display = 'none';
}

function loadGitConfig() {
    // 加载当前Git配置
    axios.get(`${GIT_API_BASE_URL}/config`)
        .then(response => {
            const config = response.data;
            if (config) {
                document.getElementById('remoteUrl').value = config.remoteUrl || '';
                document.getElementById('username').value = config.username || '';
                document.getElementById('password').value = config.password || '';
                document.getElementById('branch').value = config.branch || 'main'; // 默认分支为main
            }
        })
        .catch(error => {
            console.error('Failed to load git config:', error);
        });
}

function saveGitConfig() {
    // 保存Git配置
    const config = {
        remoteUrl: document.getElementById('remoteUrl').value,
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
        branch: document.getElementById('branch').value
    };

    axios.post(`${GIT_API_BASE_URL}/config`, config)
        .then(response => {
            showNotification('Git配置保存成功', 'success');
            closeGitConfigModal();
        })
        .catch(error => {
            showNotification('Git配置保存失败: ' + error.response.data, 'error');
        });
}

function testGitConnection() {
    // 测试Git连接
    const testBtn = document.getElementById('test-connection-btn');
    testBtn.disabled = true;
    testBtn.textContent = '测试中...';

    // 先保存配置
    const config = {
        remoteUrl: document.getElementById('remoteUrl').value,
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
        branch: document.getElementById('branch').value
    };

    axios.post(`${GIT_API_BASE_URL}/config`, config)
        .then(() => {
            // 配置保存成功后，执行连接测试
            return axios.post(`${GIT_API_BASE_URL}/test-connection`);
        })
        .then(response => {
            showNotification(response.data, 'success');
        })
        .catch(error => {
            showNotification('连接测试失败: ' + error.response.data, 'error');
        })
        .finally(() => {
            testBtn.disabled = false;
            testBtn.textContent = '测试连接';
        });
}

function getCategoryLabel(category) {
    const categoryMap = {
        'work': '工作',
        'life': '生活',
        'study': '学习',
        'other': '其他'
    };
    return categoryMap[category] || category || '未分类';
}

function getTypeLabel(type) {
    const typeMap = {
        'ai-text': 'AI文本',
        'link-ai': '链接AI',
        'doc-ai': '文档AI',
        'store-only': '仅存储'
    };
    return typeMap[type] || type || '未知';
}

function clearForm() {
    // 实现清空表单的逻辑
    document.getElementById('content').value = '';
    document.getElementById('source').value = '';
    document.getElementById('category').value = 'work';
    document.getElementById('ai-generate-tags').checked = false;
    currentTags = [];
    updateTagsDisplay();
}

function startVoiceInput() {
    // 实现语音输入的逻辑
    if ('webkitSpeechRecognition' in window) {
        const recognition = new webkitSpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'zh-CN';

        recognition.onresult = function(event) {
            const transcript = event.results[0][0].transcript;
            document.getElementById('content').value = transcript;
        };

        recognition.onerror = function(event) {
            console.error('语音识别错误:', event.error);
            showError('语音输入失败', '请检查麦克风权限或网络连接');
        };

        recognition.start();
        showNotification('请开始说话...');
    } else {
        showError('语音输入不可用', '您的浏览器不支持语音识别功能');
    }
}

function clearSearch() {
    // 实现清空搜索的逻辑
    document.getElementById('search-query').value = '';
    document.getElementById('search-category').value = '';
}

function backToList() {
    // 实现返回列表的逻辑
    document.getElementById('search-results-page').style.display = 'none';
    document.getElementById('clip-list').style.display = 'block';
}

function handleImageFiles(files) {
    // 实现处理图片文件的逻辑
    // 这里可以添加图片上传的逻辑
}

function removeFile() {
    // 实现移除文件的逻辑
    document.getElementById('file-name').textContent = '';
    document.getElementById('file-size').textContent = '';
    document.getElementById('file-info').style.display = 'none';
    document.getElementById('file-input').value = '';
}

function updateTagsDisplay() {
    // 实现更新标签显示的逻辑
    const tagsContainer = document.getElementById('tags-container');
    tagsContainer.innerHTML = '';
    currentTags.forEach(tag => {
        const tagElement = document.createElement('span');
        tagElement.className = 'tag';
        tagElement.innerHTML = `<span>${tag}</span><span class="tag-remove" data-tag="${tag}">&times;</span>`;
        tagsContainer.appendChild(tagElement);
    });
}

// 事件监听器
document.addEventListener('DOMContentLoaded', function() {
    // 上传按钮点击事件
    const uploadBtn = document.getElementById('upload-btn');
    if (uploadBtn) {
        uploadBtn.addEventListener('click', function() {
            document.getElementById('image-input').click();
        });
    }

    // 图片输入变化事件
    const imageInput = document.getElementById('image-input');
    if (imageInput) {
        imageInput.addEventListener('change', function(e) {
            handleImageFiles(e.target.files);
        });
    }

    // 文件移除按钮点击事件
    const fileRemoveBtn = document.getElementById('file-remove-btn');
    if (fileRemoveBtn) {
        fileRemoveBtn.addEventListener('click', removeFile);
    }

    // 清空表单按钮点击事件
    const clearFormBtn = document.getElementById('clear-form-btn');
    if (clearFormBtn) {
        clearFormBtn.addEventListener('click', clearForm);
    }

    // 语音输入按钮点击事件
    const voiceInputBtn = document.getElementById('voice-input-btn');
    if (voiceInputBtn) {
        voiceInputBtn.addEventListener('click', startVoiceInput);
    }

    // 清空搜索按钮点击事件
    const clearSearchBtn = document.getElementById('clear-search-btn');
    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', clearSearch);
    }

    // 返回列表按钮点击事件
    const backToListBtn = document.getElementById('back-to-list-btn');
    if (backToListBtn) {
        backToListBtn.addEventListener('click', backToList);
    }

    // 关闭Git配置模态框按钮点击事件
    const closeGitConfigBtn = document.getElementById('close-git-config-btn');
    if (closeGitConfigBtn) {
        closeGitConfigBtn.addEventListener('click', closeGitConfigModal);
    }

    // 取消Git配置按钮点击事件
    const cancelGitConfigBtn = document.getElementById('cancel-git-config-btn');
    if (cancelGitConfigBtn) {
        cancelGitConfigBtn.addEventListener('click', closeGitConfigModal);
    }

    // 测试Git连接按钮点击事件
    const testConnectionBtn = document.getElementById('test-connection-btn');
    if (testConnectionBtn) {
        testConnectionBtn.addEventListener('click', testGitConnection);
    }

    // Git配置表单提交事件
    const gitConfigForm = document.getElementById('git-config-form');
    if (gitConfigForm) {
        gitConfigForm.addEventListener('submit', function(e) {
            e.preventDefault();
            saveGitConfig();
        });
    }

    // 标签展开/收起按钮点击事件
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('tag-expand-btn')) {
            const tagsStr = e.target.dataset.tags;
            toggleTags(e.target, tagsStr);
        }
    });

    // 展开/收起详情按钮点击事件
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('toggle-detail-btn') || e.target.closest('.toggle-detail-btn')) {
            const btn = e.target.closest('.toggle-detail-btn');
            toggleDetail(btn);
        }
    });

    // 发散总结按钮点击事件
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('divergent-btn') || e.target.closest('.divergent-btn')) {
            const btn = e.target.closest('.divergent-btn');
            const clipId = btn.dataset.id;
            generateDivergentSummary(clipId);
        }
    });

    // 复制按钮点击事件
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('copy-btn') || e.target.closest('.copy-btn')) {
            const btn = e.target.closest('.copy-btn');
            if (btn.classList.contains('copy-summary-btn')) {
                const clipId = btn.dataset.id;
                const text = document.getElementById(`divergent-content-${clipId}`).textContent;
                copyToClipboard(text);
            } else {
                const text = btn.dataset.text;
                copyToClipboard(text);
            }
        }
    });

    // 错误提示关闭按钮点击事件
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('error-close-btn')) {
            e.target.closest('div[style*="background: rgba(239, 68, 68, 0.95)"]').remove();
        }
    });

    // 标签移除按钮点击事件
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('tag-remove')) {
            const tag = e.target.dataset.tag;
            currentTags = currentTags.filter(t => t !== tag);
            updateTagsDisplay();
        }
    });

    // 类型变更事件
    const typeSelect = document.getElementById('type');
    if (typeSelect) {
        typeSelect.addEventListener('change', handleTypeChange);
    }

    // 初始加载
    handleTypeChange();
    fetchClips();
    startRefreshCheck();
});
