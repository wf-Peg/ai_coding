let API_BASE_URL = 'http://127.0.0.1:8081/api/clip';
let GIT_API_BASE_URL = 'http://127.0.0.1:8081/api/git';
// 暴露到 window：let 顶层声明不挂 window，media-uploader.js 的 getUploadUrl 依赖 window.API_BASE_URL
window.API_BASE_URL = API_BASE_URL;
window.GIT_API_BASE_URL = GIT_API_BASE_URL;
// 读取扩展配置中的自定义 API 地址（与 options 页/background.js 保持一致），
// 避免修改配置后独立页面仍指向硬编码地址
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['apiUrl'], (result) => {
        if (result && result.apiUrl) {
            const base = result.apiUrl.replace(/\/api\/clip\/add$/, '').replace(/\/+$/, '');
            API_BASE_URL = base + '/api/clip';
            GIT_API_BASE_URL = base + '/api/git';
            // 动态更新后同步到 window（上传/请求均读取 window 或最新值）
            window.API_BASE_URL = API_BASE_URL;
            window.GIT_API_BASE_URL = GIT_API_BASE_URL;
        }
    });
}
let currentTags = [];
const MAX_TAGS = 10;
// 文档/图片上传状态（doc-ai 文件 + 图片附件列表）
let uploadedFileBase64 = null;
let uploadedFileName = null;
let uploadedImages = [];
let extImageLocalId = 0; // 缩略条 localId 自增（删除/重试按 id 定位，避免下标错位）
const THEME_STORAGE_KEY = 'app_theme_v1';
let currentPromptType = 'daily';
let promptConfigCache = null;
let feedbackPathValue = '';
let currentTheme = 'regular';

function getAnalysisState(clip) {
    // 异步 AI 分析中（新增字段，优先判定）
    if (clip.analysisStatus === 'pending') return 'pending';
    const analysis = (clip.analysis || '').trim();
    const summary = (clip.summary || '');
    const failed = summary.indexOf('摘要生成失败') !== -1
        || summary.indexOf('[文档解析失败]') !== -1
        || analysis.indexOf('分析生成失败') !== -1;
    if (analysis && !failed) return 'ready';
    return failed ? 'failed' : 'empty';
}

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
        const successMessage = document.getElementById('success-message');

        let content = document.getElementById('content').value.trim();
        let requestBody = {
            type,
            source,
            category,
            tags: useAiTags ? null : currentTags,
            useAiTags: type === 'store-only' ? false : useAiTags
        };

        // 我的思考（可选）
        const myThoughts = document.getElementById('my-thoughts').value.trim();
        if (myThoughts) {
            requestBody.myThoughts = myThoughts;
        }

        // store-only 类型进入收件箱
        if (type === 'store-only') {
            requestBody.workflowStatus = 'inbox';
        }

        if (type === 'doc-ai') {
            if (!uploadedFileBase64) {
                showToast('请上传文件');
                return;
            }
            requestBody.content = uploadedFileName;
            requestBody.fileData = uploadedFileBase64;
            requestBody.fileName = uploadedFileName;
        } else {
            if (!content) {
                showToast(type === 'link-ai' ? '请输入链接URL' : '请输入内容');
                return;
            }
            requestBody.content = content;
        }

        // 图文一体：提交已上传图片的相对路径清单（imagePaths）
        const imagePaths = uploadedImages.filter(i => i.status === 'done' && i.path).map(i => i.path);
        if (imagePaths.length > 0) {
            requestBody.imagePaths = imagePaths;
        }

        // 提交中状态
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ 处理中...';
        successMessage.style.display = 'block';
        successMessage.style.background = 'rgba(245, 158, 11, 0.1)';
        successMessage.style.color = 'var(--warning)';
        successMessage.style.borderColor = 'var(--warning)';
        successMessage.textContent = type === 'store-only' ? '💾 正在保存内容...'
            : type === 'link-ai' ? '🌐 正在爬取链接并分析，请稍候...'
            : type === 'doc-ai' ? '📄 正在解析文档并分析，请稍候...'
            : '🎯 AI正在分析内容，请稍候...';

        try {
            const response = await axios.post(`${API_BASE_URL}/add`, requestBody);
            if (response.data.status === 'success' || response.data.status === 'duplicate') {
                successMessage.textContent = response.data.status === 'duplicate'
                    ? '⚠️ 检测到相同内容，未重复剪藏'
                    : '✅ 剪藏添加成功！';
                successMessage.style.background = 'rgba(16, 185, 129, 0.1)';
                successMessage.style.color = 'var(--success)';
                successMessage.style.borderColor = 'var(--success)';
                clearForm();
                fetchClips();
            } else {
                successMessage.textContent = '❌ ' + (response.data.message || '添加剪藏失败');
                successMessage.style.background = 'rgba(239, 68, 68, 0.1)';
                successMessage.style.color = 'var(--error)';
                successMessage.style.borderColor = 'var(--error)';
            }
        } catch (error) {
            console.error('添加剪藏失败:', error);
            successMessage.textContent = '❌ 添加剪藏失败，请稍后重试';
            successMessage.style.background = 'rgba(239, 68, 68, 0.1)';
            successMessage.style.color = 'var(--error)';
            successMessage.style.borderColor = 'var(--error)';
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = '添加剪藏';
            setTimeout(() => { successMessage.style.display = 'none'; }, 3000);
        }
    });
});

// 其他函数（真实实现，替换原空壳占位）

// 添加标签（原为无实现空壳，标签添加功能曾失效）
function addTag(tag) {
    tag = (tag || '').trim();
    if (!tag) return;
    if (currentTags.includes(tag)) return;
    if (currentTags.length >= MAX_TAGS) {
        showToast(`最多只能添加 ${MAX_TAGS} 个标签`);
        return;
    }
    currentTags.push(tag);
    updateTagsDisplay();
}

// 从后端加载分类树，填充添加/搜索分类下拉框（原为空壳，分类下拉曾为空）
async function loadCategories() {
    try {
        const response = await axios.get(`${API_BASE_URL}/categories`);
        const categories = response.data;
        const select = document.getElementById('category');
        if (!select) return;
        select.innerHTML = '<option value="">落入收件箱</option>';
        const searchSelect = document.getElementById('search-category');
        if (searchSelect) {
            searchSelect.innerHTML = '<option value="">全部分类</option>';
        }
        categories.forEach(cat => {
            if (cat.children && cat.children.length > 0) {
                const group = document.createElement('optgroup');
                group.label = cat.label;
                cat.children.forEach(child => {
                    const option = document.createElement('option');
                    option.value = child.value;
                    option.textContent = '  ' + child.label;
                    group.appendChild(option);
                });
                select.appendChild(group);
                if (searchSelect) {
                    cat.children.forEach(child => {
                        const opt = document.createElement('option');
                        opt.value = child.value;
                        opt.textContent = cat.label + ' > ' + child.label;
                        searchSelect.appendChild(opt);
                    });
                }
            } else {
                const option = document.createElement('option');
                option.value = cat.value;
                option.textContent = cat.label;
                select.appendChild(option);
                if (searchSelect) {
                    const searchOpt = document.createElement('option');
                    searchOpt.value = cat.value;
                    searchOpt.textContent = cat.label;
                    searchSelect.appendChild(searchOpt);
                }
            }
        });
    } catch (error) {
        console.error('加载分类失败:', error);
    }
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
        allClipsCache = results;
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
        allClipsCache = filteredClips;

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

        // 存在 pending 剪藏 → 2.5s 后自动轮询刷新（异步 AI 分析完成自动出现）
        if (filteredClips.some(c => c.analysisStatus === 'pending')) {
            if (!window.__clipPendingPollTimer) {
                window.__clipPendingPollTimer = setTimeout(() => {
                    window.__clipPendingPollTimer = null;
                    fetchClips();
                }, 2500);
            }
        } else if (window.__clipPendingPollTimer) {
            clearTimeout(window.__clipPendingPollTimer);
            window.__clipPendingPollTimer = null;
        }
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

        // 标签渲染统一转义，防止用户输入的标签注入 HTML（XSS）
        const renderTag = tag => `<span class="tag-display-item"><span class="tag"><span>${escapeHtml(tag)}</span></span></span>`;

        tagsHtml = `
                <div class="tags-display" style="margin-top: 12px;">
                    <div class="tags-collapsed">
                        ${displayTags.map(renderTag).join('')}
                        ${remainingTags.length > 0 ? `<button class="tag-expand-btn">+${remainingTags.length}</button>` : ''}
                    </div>
                    ${remainingTags.length > 0 ? `<div class="tags-all" style="display: none;">${clip.tags.map(renderTag).join('')}</div>` : ''}
                </div>
            `;
    }

    const displaySummary = clip.summary || '暂无摘要';
    const isStoreOnly = clip.type === 'store-only';
    const summaryClass = isStoreOnly ? 'store-only-summary' : '';
    const originalContent = clip.content || '';
    const analysisContent = clip.analysis || '';
    const analysisState = getAnalysisState(clip);

    clipItem.innerHTML = `
            <div class="clip-header">
                <span class="category-badge">📁 ${getCategoryLabel(clip.category)}</span>
                <div class="clip-actions">
                    ${!isSearch ? `<button class="delete-btn" data-id="${clip.id}">删除</button>` : ''}
                    ${!isStoreOnly ? `<button class="expand-btn divergent-btn" data-id="${clip.id}" title="发散总结">💡</button>` : ''}
                    <button class="expand-btn dispatch-btn" data-id="${clip.id}" title="投递到 AI / 导出">📤</button>
                    <button class="expand-btn toggle-detail-btn">
                        <span class="icon">▼</span>
                        <span class="text">展开</span>
                    </button>
                </div>
            </div>
            <div class="clip-summary ${summaryClass}" title="${escapeHtml(displaySummary)}">${escapeHtml(displaySummary)}</div>
            <div class="clip-meta">
                <span class="meta-item meta-type">类型: ${getTypeLabel(clip.type)}</span>
                <span class="meta-item">来源: ${escapeHtml(clip.source || '')}</span>
                <span class="meta-item">创建时间: ${createdAt}</span>
            </div>
            ${tagsHtml}
            <div class="clip-detail">
                <div class="content-section">
                    <h4>原文</h4>
                    <div class="content-text truncated">${window.MediaKit.render.renderMarkdown(originalContent)}</div>
                    <button class="copy-btn" data-text="${escapeJs(originalContent)}">
                        📋 复制原文
                    </button>
                </div>
                ${!isStoreOnly ? (analysisState === 'ready' ? `
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
                ` : analysisState === 'pending' ? `
                <div class="content-section">
                    <h4>AI分析</h4>
                    <div class="markdown-content" style="text-align: center; padding: 20px;">
                        <div class="analysis-pending-spinner"></div>
                        <p style="color: var(--text-secondary); margin-top: 10px;">AI 分析中...</p>
                        <p style="font-size: 0.85rem; color: var(--text-secondary); opacity: 0.8;">正在提炼摘要、关键信息和标签，请稍候</p>
                    </div>
                </div>
                ` : analysisState === 'failed' ? `
                <div class="content-section">
                    <h4>AI分析</h4>
                    <div class="markdown-content" style="text-align: center; padding: 20px;">
                        <p style="color: var(--error);">❌ AI 分析失败</p>
                        <p style="font-size: 0.9rem; color: var(--text-secondary); margin-top: 10px;">未能成功生成摘要或分析内容</p>
                        <button class="btn-secondary generate-analysis-btn" data-clip-id="${clip.id}" style="margin-top: 12px;">🔄 重新生成分析</button>
                    </div>
                </div>
                ` : `
                <div class="content-section">
                    <h4>AI分析</h4>
                    <div class="markdown-content" style="text-align: center; padding: 20px;">
                        <p style="color: var(--text-secondary);">暂无 AI 分析内容</p>
                        <p style="font-size: 0.9rem; color: var(--text-secondary); margin-top: 10px;">该剪藏未生成 AI 分析</p>
                        <button class="btn-secondary generate-analysis-btn" data-clip-id="${clip.id}" style="margin-top: 12px;">✨ 生成分析</button>
                    </div>
                </div>
                `) : ''}
                <div class="content-section" id="dispatch-section-${clip.id}" style="display: none;">
                    <h4>📤 投递到 AI<span class="dispatch-model-info" id="dispatch-model-${clip.id}"></span></h4>
                    <div class="dispatch-targets" id="dispatch-targets-${clip.id}">
                        <p class="dispatch-loading" style="color: var(--text-secondary);">投递目标加载中...</p>
                    </div>
                    <div class="dispatch-actions" style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
                        <button class="btn-secondary dispatch-run-btn" data-id="${clip.id}">🚀 投递所选</button>
                        <button class="btn-secondary dispatch-distill-btn" data-id="${clip.id}">🧪 蒸馏总结</button>
                        <span style="flex: 1;"></span>
                        <button class="btn-secondary export-clip-btn" data-id="${clip.id}" data-format="md">导出 MD</button>
                        <button class="btn-secondary export-clip-btn" data-id="${clip.id}" data-format="txt">TXT</button>
                        <button class="btn-secondary export-clip-btn" data-id="${clip.id}" data-format="html">HTML</button>
                    </div>
                    ${clip.lastDispatchTarget ? `<div class="dispatch-last" style="margin-top: 8px; font-size: 0.85rem; color: var(--text-secondary);">上次投递: ${escapeHtml(clip.lastDispatchTarget)} @ ${escapeHtml(clip.lastDispatchAt || '')}</div>` : ''}
                    <div class="dispatch-results" id="dispatch-results-${clip.id}" style="margin-top: 10px;"></div>
                </div>
            </div>
        `;

    if (analysisState === 'ready') {

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

                const renderedHtml = window.MediaKit.render.renderMarkdown(cleanContent);
                analysisContentDiv.innerHTML = renderedHtml;
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
    // 先转义反斜杠，再转义引号与换行，防止闭合 JS 字符串上下文（XSS）
    return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('已复制到剪贴板！');
    }).catch(err => {
        console.error('复制失败:', err);
        showToast('复制失败，请手动复制');
    });
}

async function quickOrganizeClip(clipId) {
    try {
        showLoading('正在快速整理...', '正在对当前剪藏进行AI分类与标签整理...');
        const response = await axios.post(`${API_BASE_URL}/organize/${clipId}`, { mode: 'auto' });
        if (response.data.status === 'success') {
            showNotification('当前剪藏已完成AI整理', true);
            await fetchClips();
        }
    } catch (error) {
        console.error('快速整理失败:', error);
        showError('整理失败', error.response?.data?.message || '请稍后重试');
    } finally {
        hideLoading();
    }
}

async function generateDivergentSummary(clipId) {
    const divergentSection = document.getElementById(`divergent-summary-${clipId}`);
    const divergentContent = document.getElementById(`divergent-content-${clipId}`);

    divergentSection.style.display = 'block';
    divergentContent.innerHTML = '<p>生成中...</p>';

    try {
        const response = await axios.get(`${API_BASE_URL}/divergent-summary/${clipId}`);
        const summary = response.data;

        const markdownHtml = window.MediaKit.render.renderMarkdown(summary);
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

// ==================== 内容分发（MVP）：投递 / 蒸馏 / 导出 ====================

/** 当前渲染的剪藏列表缓存（导出按 id 取对象用） */
let allClipsCache = [];

/** 投递目标缓存（全局一次加载） */
let dispatchTargetsCache = null;
let dispatchModelInfo = {};

/** 构造 /api/dispatch 前缀（兼容 API_BASE_URL 配置化） */
function dispatchApiBase() {
    return API_BASE_URL.replace(/\/api\/clip\/?$/, '') + '/api/dispatch';
}

/** 加载投递目标（全局缓存，成功后回填已渲染的容器） */
async function loadDispatchTargets() {
    try {
        const response = await axios.get(`${dispatchApiBase()}/targets`);
        dispatchTargetsCache = response.data.targets || [];
        dispatchModelInfo = response.data.currentModel || {};
        document.querySelectorAll('.dispatch-targets').forEach(el => {
            const clipId = el.id.replace('dispatch-targets-', '');
            el.innerHTML = dispatchTargetsHtml(clipId);
        });
        document.querySelectorAll('.dispatch-model-info').forEach(el => {
            el.textContent = dispatchModelInfo.model ? `（${dispatchModelInfo.model}）` : '';
        });
    } catch (e) {
        console.error('加载投递目标失败:', e);
    }
}

/** 生成投递目标复选框 HTML（无缓存时占位） */
function dispatchTargetsHtml(clipId) {
    if (!dispatchTargetsCache || dispatchTargetsCache.length === 0) {
        return '<p class="dispatch-loading" style="color: var(--text-secondary);">投递目标加载中...</p>';
    }
    return dispatchTargetsCache.map(t => `
        <label class="dispatch-target-item" style="display: block; margin: 4px 0; cursor: pointer; font-size: 0.9rem;">
            <input type="checkbox" class="dispatch-target-check" data-target="${escapeHtml(t.id)}" data-clip="${clipId}">
            <strong>${escapeHtml(t.name)}</strong>
            <span style="color: var(--text-secondary); margin-left: 6px;">${escapeHtml(t.description || '')}</span>
        </label>
    `).join('');
}

/** 展开/收起投递面板（自动展开外层详情，避免面板被折叠的详情遮住） */
function toggleDispatchPanel(clipId) {
    const section = document.getElementById(`dispatch-section-${clipId}`);
    if (!section) {
        showToast('未找到投递面板，请刷新重试');
        return;
    }
    section.style.display = section.style.display === 'none' ? 'block' : 'none';
    if (section.style.display === 'block') {
        // 若外层详情处于折叠态，先展开详情（复用 toggleDetail）
        const detail = section.closest('.clip-detail');
        if (detail && !detail.classList.contains('expanded')) {
            const btn = detail.closest('.clip-item')?.querySelector('.toggle-detail-btn');
            if (btn) toggleDetail(btn);
        }
        const targetsBox = document.getElementById(`dispatch-targets-${clipId}`);
        if (targetsBox) targetsBox.innerHTML = dispatchTargetsHtml(clipId);
        const modelBox = document.getElementById(`dispatch-model-${clipId}`);
        if (modelBox) modelBox.textContent = dispatchModelInfo.model ? `（${dispatchModelInfo.model}）` : '';
    }
}

/** 依次投递所选目标，结果逐条追加展示 */
async function dispatchRun(clipId) {
    const resultsBox = document.getElementById(`dispatch-results-${clipId}`);
    const checks = document.querySelectorAll(`#dispatch-targets-${clipId} .dispatch-target-check:checked`);
    if (checks.length === 0) {
        showToast('请先选择至少一个投递目标');
        return;
    }
    const targets = [...checks].map(c => c.dataset.target);
    if (resultsBox) resultsBox.innerHTML = '';
    for (const targetId of targets) {
        const item = document.createElement('div');
        item.className = 'dispatch-result-item';
        item.style.cssText = 'margin-top: 10px; padding: 10px; border: 1px solid var(--border-color, #e5e5e5); border-radius: 8px;';
        item.innerHTML = `<div style="font-weight: 600; margin-bottom: 6px;">🚀 ${escapeHtml(targetId)} <span class="dispatch-result-status" style="color: var(--text-secondary); font-weight: 400;">投递中...</span></div>
            <div class="dispatch-result-body markdown-content"></div>`;
        resultsBox.appendChild(item);
        const body = item.querySelector('.dispatch-result-body');
        const statusEl = item.querySelector('.dispatch-result-status');
        try {
            const response = await axios.post(`${dispatchApiBase()}/${encodeURIComponent(targetId)}`, { clipId });
            const data = response.data;
            if (data.success) {
                statusEl.textContent = '✓ 完成';
                body.innerHTML = window.MediaKit.render.renderMarkdown(data.result || '');
            } else {
                statusEl.textContent = '✗ 失败';
                body.innerHTML = `<p style="color: var(--error);">${escapeHtml(data.error || '未知错误')}</p>`;
            }
        } catch (e) {
            statusEl.textContent = '✗ 错误';
            body.innerHTML = `<p style="color: var(--error);">${escapeHtml(e.message || '网络错误')}</p>`;
        }
    }
    showToast('投递完成，结果已回存剪藏');
}

/** 汇总蒸馏：将全部投递结果蒸馏为一份精炼总结 */
async function dispatchDistill(clipId) {
    const resultsBox = document.getElementById(`dispatch-results-${clipId}`);
    const item = document.createElement('div');
    item.className = 'dispatch-result-item';
    item.style.cssText = 'margin-top: 10px; padding: 10px; border: 1px solid var(--border-color, #e5e5e5); border-radius: 8px;';
    item.innerHTML = `<div style="font-weight: 600; margin-bottom: 6px;">🧪 蒸馏总结 <span class="dispatch-result-status" style="color: var(--text-secondary); font-weight: 400;">蒸馏中...</span></div>
        <div class="dispatch-result-body markdown-content"></div>`;
    if (resultsBox) resultsBox.appendChild(item);
    const body = item.querySelector('.dispatch-result-body');
    const statusEl = item.querySelector('.dispatch-result-status');
    try {
        const response = await axios.post(`${dispatchApiBase()}/distill`, { clipId });
        const data = response.data;
        if (data.success) {
            statusEl.textContent = '✓ 完成';
            body.innerHTML = window.MediaKit.render.renderMarkdown(data.result || '');
        } else {
            statusEl.textContent = '✗ 失败';
            body.innerHTML = `<p style="color: var(--error);">${escapeHtml(data.error || '未知错误')}</p>`;
        }
    } catch (e) {
        statusEl.textContent = '✗ 错误';
        body.innerHTML = `<p style="color: var(--error);">${escapeHtml(e.message || '网络错误')}</p>`;
    }
}

/** 按 id 从缓存取剪藏对象 */
function getCachedClip(clipId) {
    return (allClipsCache || []).find(c => String(c.id) === String(clipId));
}

/** 导出剪藏为 md / txt / html（纯前端 Blob 下载） */
function exportClipById(clipId, format) {
    const clip = getCachedClip(clipId);
    if (!clip) {
        showToast('未找到该剪藏数据，请刷新列表后重试');
        return;
    }
    exportClipAs(clip, format);
}

function exportClipAs(clip, format) {
    const rawTitle = clip.title || clip.category || '剪藏';
    const safeTitle = rawTitle.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
    const date = (clip.createdAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10);

    const meta = `# ${rawTitle}\n\n> 来源: ${clip.source || ''}${clip.sourceUrl ? ' | ' + clip.sourceUrl : ''}\n> 分类: ${clip.category || ''} | 标签: ${(clip.tags || []).join(', ')}\n> 时间: ${clip.createdAt || ''}\n\n---\n\n`;
    const body = clip.content || '';
    const stripMd = s => String(s).replace(/[#>*`_~[\](!)<>|]/g, '').replace(/\n{3,}/g, '\n\n');

    let content, mime;
    if (format === 'md') {
        content = meta + body;
        mime = 'text/markdown;charset=utf-8';
    } else if (format === 'txt') {
        content = stripMd(meta) + stripMd(body);
        mime = 'text/plain;charset=utf-8';
    } else {
        const htmlBody = window.MediaKit.render.renderMarkdown(meta + body);
        content = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(rawTitle)}</title>
<style>body{max-width:860px;margin:40px auto;padding:0 20px;font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;line-height:1.7;color:#333}
blockquote{color:#666;border-left:4px solid #ddd;margin-left:0;padding-left:16px}
pre{background:#f6f8fa;padding:12px;border-radius:6px;overflow:auto}
code{background:#f6f8fa;padding:2px 4px;border-radius:4px}
img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 10px}</style></head><body>${htmlBody}</body></html>`;
        mime = 'text/html;charset=utf-8';
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `剪藏-${safeTitle}-${date}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`已导出 ${format.toUpperCase()}`);
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

// AI 自动生成标签时禁用手动输入
function toggleTagInput() {
    const tagInput = document.getElementById('tag-input');
    const useAiTags = document.getElementById('ai-generate-tags').checked;
    if (tagInput) tagInput.disabled = useAiTags;
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
    document.getElementById('category').value = '';
    document.getElementById('ai-generate-tags').checked = false;
    document.getElementById('my-thoughts').value = '';
    currentTags = [];
    updateTagsDisplay();
    // 清空文档/图片附件状态
    uploadedFileBase64 = null;
    uploadedFileName = null;
    uploadedImages = [];
    renderImagePreviews();
    removeFile();
    document.getElementById('type').dispatchEvent(new Event('change'));
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
    // 图文一体（M4）：canvas 压缩 → 立即上传 → 光标处插入（替代旧 base64 实现）
    if (!files || files.length === 0) return;
    const imageFiles = Array.from(files).filter(f => f.type && f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
        showToast('未检测到图片文件');
        return;
    }
    if (!window.MediaKit || !window.MediaKit.uploader) {
        showToast('媒体上传组件未加载');
        return;
    }
    window.MediaKit.uploader.uploadFiles(imageFiles, {
        onStart: (item) => {
            const entry = {
                localId: ++extImageLocalId,
                name: item.name,
                status: 'compressing',
                dataUrl: URL.createObjectURL(item.file),
                progress: 0,
                file: item.file
            };
            item._entry = entry;
            uploadedImages.push(entry);
            renderImagePreviews();
        },
        onProgress: (item, percent) => {
            if (item._entry) { item._entry.status = 'uploading'; item._entry.progress = percent; renderImagePreviews(); }
        },
        onSuccess: (item, resp) => {
            if (item._entry) {
                item._entry.status = 'done';
                item._entry.path = resp.path;
                item._entry.url = resp.url;
            }
            renderImagePreviews();
            insertImageMarkdown(resp.path);
        },
        onError: (item, err) => {
            if (item._entry) {
                item._entry.status = 'error';
                item._entry.error = err && err.message ? err.message : String(err);
            }
            renderImagePreviews();
            showToast('图片上传失败: ' + (err && err.message ? err.message : err));
        }
    });
}

// 在内容框光标处插入 markdown 图片引用
function insertImageMarkdown(path) {
    const textarea = document.getElementById('content');
    if (!textarea) return;
    const markdown = '![图片](' + path + ')';
    const start = textarea.selectionStart != null ? textarea.selectionStart : textarea.value.length;
    const end = textarea.selectionEnd != null ? textarea.selectionEnd : textarea.value.length;
    const value = textarea.value;
    textarea.value = value.substring(0, start) + markdown + value.substring(end);
    const pos = start + markdown.length;
    textarea.selectionStart = textarea.selectionEnd = pos;
    textarea.focus();
}

// 移除图片：列表移除 + 移除 content 中对应引用
function removeUploadedImage(id) {
    const idx = uploadedImages.findIndex(x => x.localId === id);
    if (idx < 0) return;
    const entry = uploadedImages[idx];
    uploadedImages.splice(idx, 1);
    if (entry.dataUrl) URL.revokeObjectURL(entry.dataUrl);
    if (entry.path) {
        const textarea = document.getElementById('content');
        if (textarea) {
            const escaped = entry.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            textarea.value = textarea.value
                .replace(new RegExp('!\\[[^\\]]*\\]\\(' + escaped + '\\)'), '')
                .replace(/\n{2,}/g, '\n');
        }
    }
    renderImagePreviews();
}

// 重试单张上传
function retryUpload(id) {
    const idx = uploadedImages.findIndex(x => x.localId === id);
    if (idx < 0) return;
    const entry = uploadedImages[idx];
    if (!entry.file) return;
    entry.status = 'compressing';
    entry.error = null;
    renderImagePreviews();
    window.MediaKit.uploader.uploadFiles([entry.file], {
        onProgress: (item, percent) => { entry.status = 'uploading'; entry.progress = percent; renderImagePreviews(); },
        onSuccess: (item, resp) => {
            entry.status = 'done';
            entry.path = resp.path;
            entry.url = resp.url;
            renderImagePreviews();
            insertImageMarkdown(resp.path);
        },
        onError: (item, err) => {
            entry.status = 'error';
            entry.error = err && err.message ? err.message : String(err);
            renderImagePreviews();
            showToast('图片上传失败: ' + entry.error);
        }
    });
}

function renderImagePreviews() {
    const previews = document.getElementById('image-previews');
    const grid = document.getElementById('preview-grid');
    if (!previews || !grid) return;
    if (uploadedImages.length === 0) {
        previews.style.display = 'none';
        grid.innerHTML = '';
        return;
    }
    previews.style.display = 'block';
    grid.innerHTML = '';
    uploadedImages.forEach((entry, index) => {
        const item = document.createElement('div');
        item.className = 'image-preview-item';
        item.dataset.id = entry.localId;
        item.dataset.status = entry.status;
        let inner = '';
        if (entry.dataUrl) {
            inner += '<img src="' + entry.dataUrl + '" alt="">';
        } else if (entry.path) {
            inner += '<img src="' + window.MediaKit.render.mediaUrl(entry.path) + '?thumb=1" alt="">';
        }
        if (entry.status === 'uploading' || entry.status === 'compressing') {
            const pct = (entry.status === 'compressing' || entry.progress == null) ? 0 : entry.progress;
            inner += '<div class="preview-status"><div class="preview-progress" style="width:' + pct + '%"></div></div>';
        } else if (entry.status === 'error') {
            inner += '<div class="preview-status error"></div>';
            inner += '<button type="button" class="preview-retry" data-id="' + entry.localId + '">重试</button>';
        } else if (entry.status === 'done') {
            inner += '<div class="preview-dot" title="上传完成"></div>';
        }
        inner += '<button type="button" class="preview-remove" data-id="' + entry.localId + '" title="移除图片（同时移除内容引用）">✕</button>';
        item.innerHTML = inner;
        grid.appendChild(item);
    });
    // 事件委托：删除/重试（按 localId，避免数组下标错位）
    grid.onclick = function (e) {
        const removeBtn = e.target.closest('.preview-remove');
        const retryBtn = e.target.closest('.preview-retry');
        if (removeBtn) removeUploadedImage(Number(removeBtn.dataset.id));
        if (retryBtn) retryUpload(Number(retryBtn.dataset.id));
    };
}

function handleFile(file) {
    // 读取文档为 Base64（doc-ai 用），限制 20MB
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
        showToast('文件超过 20MB，请压缩后重试');
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        const dataUrl = String(e.target.result);
        const comma = dataUrl.indexOf(',');
        uploadedFileBase64 = comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl;
        uploadedFileName = file.name;
        document.getElementById('file-name').textContent = file.name;
        document.getElementById('file-size').textContent = (file.size / 1024).toFixed(1) + ' KB';
        document.getElementById('file-info').style.display = 'block';
    };
    reader.onerror = () => showToast('文件读取失败');
    reader.readAsDataURL(file);
}

function removeFile() {
    // 实现移除文件的逻辑
    uploadedFileBase64 = null;
    uploadedFileName = null;
    document.getElementById('file-name').textContent = '';
    document.getElementById('file-size').textContent = '';
    document.getElementById('file-info').style.display = 'none';
    document.getElementById('file-input').value = '';
}

function updateTagsDisplay() {
    // DOM API 构建标签，避免 innerHTML 拼接用户输入导致 XSS
    const tagsContainer = document.getElementById('tags-container');
    tagsContainer.innerHTML = '';
    currentTags.forEach(tag => {
        const tagElement = document.createElement('span');
        tagElement.className = 'tag';
        const label = document.createElement('span');
        label.textContent = tag;
        const remove = document.createElement('span');
        remove.className = 'tag-remove';
        remove.textContent = '\u00d7';
        remove.title = '删除标签';
        remove.addEventListener('click', () => {
            currentTags = currentTags.filter(t => t !== tag);
            updateTagsDisplay();
        });
        tagElement.appendChild(label);
        tagElement.appendChild(remove);
        tagsContainer.appendChild(tagElement);
    });
}

// 事件监听器
document.addEventListener('DOMContentLoaded', function() {
    // 图片输入变化事件
    const imageInput = document.getElementById('image-input');
    if (imageInput) {
        imageInput.addEventListener('change', function(e) {
            handleImageFiles(e.target.files);
            e.target.value = ''; // 允许重复选择同一文件
        });
    }

    // 文档输入变化事件（doc-ai）
    const fileInput = document.getElementById('file-input');
    if (fileInput) {
        fileInput.addEventListener('change', function(e) {
            if (e.target.files && e.target.files[0]) {
                handleFile(e.target.files[0]);
            }
        });
    }

    // 从剪贴板/拖拽中提取图片文件（兼容拖拽本地文件 item.type 为空：扩展名兜底）
    function extractImageFiles(dataTransfer) {
        const files = [];
        if (!dataTransfer) return files;
        const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
        const isImageFile = (file) => {
            if (!file) return false;
            if (file.type && file.type.startsWith('image/')) return true;
            if (file.name) {
                const ext = (file.name.split('.').pop() || '').toLowerCase();
                return IMAGE_EXTS.indexOf(ext) >= 0;
            }
            return false;
        };
        if (dataTransfer.items && dataTransfer.items.length) {
            for (const item of dataTransfer.items) {
                if (item.kind === 'file') {
                    const file = item.getAsFile();
                    if (file && isImageFile(file)) files.push(file);
                }
            }
        }
        if (dataTransfer.files && dataTransfer.files.length) {
            for (const file of dataTransfer.files) {
                if (file && isImageFile(file) && files.indexOf(file) < 0) files.push(file);
            }
        }
        return files;
    }

    // 内容框粘贴/拖拽图片
    const contentTextarea = document.getElementById('content');
    if (contentTextarea) {
        contentTextarea.addEventListener('paste', function(e) {
            const imageFiles = extractImageFiles(e.clipboardData || window.clipboardData);
            if (imageFiles.length > 0) {
                e.preventDefault();
                handleImageFiles(imageFiles);
            }
        });
        // 拖拽图片到内容框（与粘贴走同一上传流，避免浏览器插入文件路径文本）
        contentTextarea.addEventListener('dragover', function(e) {
            if (e.dataTransfer && Array.prototype.some.call(e.dataTransfer.types || [], t => t === 'Files')) {
                e.preventDefault();
            }
        });
        contentTextarea.addEventListener('drop', function(e) {
            const imageFiles = extractImageFiles(e.dataTransfer);
            if (imageFiles.length > 0) {
                e.preventDefault();
                handleImageFiles(imageFiles);
            } else if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
                // 有文件但非图片：阻止默认插入路径文本
                e.preventDefault();
                showToast('仅支持图片文件');
            }
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

    // 标签展开/收起按钮点击事件（data-tags 属性已移除，仅切换显示）
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('tag-expand-btn')) {
            toggleTags(e.target);
        }
    });

    // 剪藏分析空态/失败态 - 生成/重新生成分析按钮事件委托
    document.addEventListener('click', function(e) {
        const btn = e.target.closest('.generate-analysis-btn');
        if (btn) {
            quickOrganizeClip(parseInt(btn.dataset.clipId));
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

    // 内容分发：投递面板 / 投递所选 / 蒸馏总结 / 导出（事件委托）
    document.addEventListener('click', function(e) {
        const dispatchBtn = e.target.closest('.dispatch-btn');
        if (dispatchBtn) {
            toggleDispatchPanel(dispatchBtn.dataset.id);
            return;
        }
        const runBtn = e.target.closest('.dispatch-run-btn');
        if (runBtn) {
            dispatchRun(parseInt(runBtn.dataset.id));
            return;
        }
        const distillBtn = e.target.closest('.dispatch-distill-btn');
        if (distillBtn) {
            dispatchDistill(parseInt(distillBtn.dataset.id));
            return;
        }
        const exportBtn = e.target.closest('.export-clip-btn');
        if (exportBtn) {
            exportClipById(parseInt(exportBtn.dataset.id), exportBtn.dataset.format);
            return;
        }
        const copyDispatch = e.target.closest('.dispatch-copy-btn');
        if (copyDispatch) {
            const text = document.getElementById(`dispatch-results-${copyDispatch.dataset.id}`).textContent;
            copyToClipboard(text);
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

    // 标签移除：updateTagsDisplay 已为每个移除按钮绑定闭包监听，此处不再需要全局委托
    // （原委托依赖 data-tag 属性，存在二次转义不匹配与 XSS 隐患）

    // 类型变更事件
    const typeSelect = document.getElementById('type');
    if (typeSelect) {
        typeSelect.addEventListener('change', handleTypeChange);
    }

    // 初始加载
    handleTypeChange();
    fetchClips();
    startRefreshCheck();
    loadDispatchTargets();
});
