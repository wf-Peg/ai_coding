// ============================================================
// CutShelter clip 页面模块: clip-actions
// 由 clip.html 内联脚本按功能拆分生成（经典 script 顺序加载）
// ============================================================

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 根据剪藏的 source 字段生成来源徽章 HTML
    function getSourceBadge(source) {
        if (!source) return '';
        const badgeMap = {
            'web-clipper': { cls: 'web-clipper', label: 'Web Clipper' },
            'browser': { cls: 'browser', label: '浏览器' },
            'manual': { cls: 'manual', label: '手动' },
            'system': { cls: 'system', label: '系统' }
        };
        const badge = badgeMap[source];
        if (!badge) return '';
        return `<span class="source-badge ${badge.cls}">${escapeHtml(badge.label)}</span>`;
    }

    // 渲染剪藏内容（图文一体 G1）：markdown 渲染 + 白名单消毒 + 图片重写
    // 图片引用 media/{yyMM}/{uuid}.{ext} 会被重写为 {API origin}/api/media/... 正常显示
    function renderContent(content, clipId) {
        if (!content) return '';
        return window.MediaKit.render.renderMarkdown(content);
    }

    // 渲染 wiki-link 显示文本：只返回文件名，不再包裹 <a> 标签
    function renderWikiLink(content, clipId, fallbackLabel) {
        const match = content && content.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
        let path = '';
        if (match) {
            path = match[1];
        } else if (fallbackLabel) {
            path = fallbackLabel;
        }
        if (!path) return '';
        // 只显示文件名
        const fileName = path.split('/').pop() || path;
        return escapeHtml(fileName);
    }

    // 跳转编辑器模块：在新标签页（类似 Ctrl+T）打开该剪藏文档
    // 如有 sourceFilePath（相对路径），一并传递，父页面将拼接绝对路径后以文件方式打开
    function openClipInEditorNewTab(clipId, sourceFilePath) {
        window.parent.postMessage({ type: 'openClipInNewTab', clipId, sourceFilePath }, '*');
    }

    // 在 Obsidian 中打开指定路径的笔记
    function openInObsidian(path) {
        try {
            const vault = encodeURIComponent('obsidian');
            const encodedPath = encodeURIComponent(path);
            const obsidianUrl = `obsidian://open?vault=${vault}&file=${encodedPath}`;
            window.location.href = obsidianUrl;
            showToast('已在 Obsidian 中打开：' + path);
        } catch (e) {
            console.error('打开 Obsidian 失败:', e);
            showToast('打开 Obsidian 失败，请确认已安装 Obsidian');
        }
    }

    function escapeJs(text) {
        if (!text) return '';
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

    function copyToEditor(text, clipId) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('已复制内容，正在打开编辑器...');
            window.parent.postMessage({ type: 'openClipInNewTab', clipId }, '*');
        }).catch(err => {
            console.error('复制失败:', err);
            showToast('复制失败，请手动复制');
        });
    }

    async function generateDivergentSummary(clipId) {
        const divergentSection = document.getElementById(`divergent-summary-${clipId}`);
        const divergentContent = document.getElementById(`divergent-content-${clipId}`);

        if (!divergentSection || !divergentContent) {
            showToast('页面结构异常，请刷新重试');
            return;
        }

        divergentSection.style.display = 'block';
        divergentContent.innerHTML = '<p>生成中...</p>';

        try {
            const response = await axios.get(`${API_BASE_URL}/divergent-summary/${clipId}`);
            const summary = response.data;

            const markdownHtml = marked.parse(summary);
            typeWriterEffect(divergentContent, markdownHtml);
            // 显示复制按钮
            const copyBtn = divergentSection.querySelector('.copy-btn');
            if (copyBtn) copyBtn.style.display = '';
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

    function toggleTags(btn) {
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


    function showActionConfirm(message, callback) {
        document.getElementById('confirm-message').textContent = message;
        document.getElementById('confirm-modal').style.display = 'flex';
        confirmActionCallback = callback;
    }

    function showConfirmModal(id, message) {
        showActionConfirm(message, () => deleteClip(id));
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

    // ==================== Prompt 配置 ====================


    async function openPromptConfigModal(type) {
        currentPromptType = type;
        const meta = PROMPT_TYPE_META[type];
        if (!meta) return;

        const title = document.getElementById('prompt-config-title');
        const desc = document.getElementById('prompt-config-desc');
        const hint = document.getElementById('prompt-config-hint');
        const textarea = document.getElementById('prompt-config-textarea');

        title.textContent = meta.title;
        desc.textContent = meta.desc;
        if (hint) hint.textContent = meta.hint;

        try {
            const config = await loadPromptConfig();
            textarea.value = config[meta.field] || '';
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
            const meta = PROMPT_TYPE_META[currentPromptType];
            const payload = { ...config };
            payload[meta.field] = value;

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
        showActionConfirm('确定要恢复为默认 Prompt 配置吗？当前修改将丢失。', async () => {
            try {
                const response = await axios.post(`${API_BASE_URL}/prompt-config/reset`);
                promptConfigCache = response.data;

                const textarea = document.getElementById('prompt-config-textarea');
                const meta = PROMPT_TYPE_META[currentPromptType];
                textarea.value = response.data[meta.field] || '';
                showNotification('Prompt 已恢复默认配置');
            } catch (error) {
                console.error('重置Prompt配置失败:', error);
                showError('重置失败', error.response?.data?.message || '请稍后重试');
            }
        });
    }

    function previewFullPrompt() {
        const currentValue = document.getElementById('prompt-config-textarea').value;
        const meta = PROMPT_TYPE_META[currentPromptType];
        let fullPrompt = currentValue;

        if (currentPromptType === 'clip') {
            const taskFormat = promptConfigCache?.clipAnalyzeTaskFormat || '';
            fullPrompt = currentValue + '\n\n--- 任务格式部分 ---\n\n' + taskFormat;
        }

        document.getElementById('preview-prompt-title').textContent = meta.title + ' — 完整预览';
        document.getElementById('preview-prompt-content').textContent = fullPrompt;
        document.getElementById('preview-prompt-modal').style.display = 'flex';
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

    function openOrganizeActionModal(scope = 'inbox', clipId = null, preferredMode = 'auto') {
        currentOrganizeTarget = { scope, clipId };
        const titleEl = document.getElementById('organize-action-title');
        document.getElementById('organize-mode').value = preferredMode === 'manual' ? 'manual' : (scope === 'clip' ? 'manual' : 'auto');
        const typeEl = document.getElementById('organize-type');
        const categoryEl = document.getElementById('organize-category');
        const tagsEl = document.getElementById('organize-tags-input');
        typeEl.value = '';
        categoryEl.value = '';
        tagsEl.value = '';

        if (scope === 'clip' && clipId != null) {
            titleEl.textContent = '编辑剪藏';
            const clip = clipCache.get(String(clipId));
            if (clip) {
                typeEl.value = clip.type || '';
                categoryEl.value = clip.category || '';
                tagsEl.value = Array.isArray(clip.tags) ? clip.tags.join(', ') : '';
                document.getElementById('organize-content').value = clip.content || '';
                document.getElementById('organize-summary').value = clip.summary || '';
                document.getElementById('organize-analysis').value = clip.analysis || '';
                document.getElementById('organize-thoughts').value = clip.myThoughts || '';
            }
        } else {
            titleEl.textContent = '整理收件箱';
        }
        toggleOrganizeManualFields();
        document.getElementById('organize-action-modal').style.display = 'flex';
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

    async function quickClipToTodo(clipId) {
        const clip = clipCache.get(String(clipId));
        const payload = {
            clipId,
            title: clip?.selectedText || clip?.summary || clip?.title || '来自剪藏的待办'
        };

        try {
            showLoading('正在转为待办...', '正在创建待办并回链来源...');
            if (window.electronAPI && typeof window.electronAPI.clipToTodo === 'function') {
                const result = await window.electronAPI.clipToTodo(payload);
                if (!result.success) {
                    throw new Error(result.message || '转换失败');
                }
            } else {
                await axios.post(`${API_BASE_URL}/to-todo`, payload);
            }
            showNotification('已转为待办，可在左侧待办列表查看', false);
        } catch (error) {
            console.error('转待办失败:', error);
            showError('转待办失败', error.message || error.response?.data?.message || '请稍后重试');
        } finally {
            hideLoading();
        }
    }

    function closeOrganizeActionModal() {
        document.getElementById('organize-action-modal').style.display = 'none';
    }

    function toggleOrganizeManualFields() {
        const mode = document.getElementById('organize-mode').value;
        document.getElementById('organize-manual-fields').style.display = mode === 'manual' ? 'block' : 'none';
    }

    async function confirmOrganizeAction() {
        const isClipScope = currentOrganizeTarget.scope === 'clip' && currentOrganizeTarget.clipId != null;
        const organizeBtn = isClipScope
            ? null
            : document.getElementById('organize-inbox-btn');
        const originalText = organizeBtn ? organizeBtn.textContent : '';
        const mode = document.getElementById('organize-mode').value;
        const type = document.getElementById('organize-type').value;
        const category = document.getElementById('organize-category').value;
        const tagsInput = document.getElementById('organize-tags-input').value.trim();
        const tags = tagsInput ? tagsInput.split(/[，,]/).map(t => t.trim()).filter(Boolean) : [];
        const content = document.getElementById('organize-content').value.trim();
        const summary = document.getElementById('organize-summary').value.trim();
        const analysis = document.getElementById('organize-analysis').value.trim();
        const myThoughts = document.getElementById('organize-thoughts').value.trim();

        try {
            closeOrganizeActionModal();
            showLoading(
                isClipScope ? '正在保存剪藏编辑...' : '正在整理收件箱...',
                mode === 'auto' ? '默认AI分类处理中...' : '正在应用手动覆盖规则...'
            );
            if (organizeBtn) {
                organizeBtn.disabled = true;
                organizeBtn.classList.add('btn-loading');
            }

            const payload = { mode };
            if (mode === 'manual') {
                payload.type = type;
                payload.category = category;
                payload.tags = tags;
            }
            // 始终携带可编辑字段（剪藏编辑场景）
            if (isClipScope) {
                payload.content = content;
                payload.summary = summary;
                payload.analysis = analysis;
                payload.myThoughts = myThoughts;
            }

            const endpoint = isClipScope
                ? `${API_BASE_URL}/organize/${currentOrganizeTarget.clipId}`
                : `${API_BASE_URL}/organize-inbox`;
            const response = await axios.post(endpoint, payload);

            if (response.data.status === 'success') {
                if (isClipScope) {
                    showNotification('剪藏编辑已保存', true);
                } else {
                    const count = response.data.organizedCount || 0;
                    showNotification(`收件箱整理完成，共处理 ${count} 条内容`, true);
                }
                await fetchClips();
            }
        } catch (error) {
            console.error('整理内容失败:', error);
            showError('整理失败', error.response?.data?.message || '请稍后重试');
        } finally {
            hideLoading();
            if (organizeBtn) {
                organizeBtn.disabled = false;
                organizeBtn.classList.remove('btn-loading');
                organizeBtn.textContent = originalText;
            }
        }
    }

    async function organizeContent() {
        showActionConfirm('确定要整理今日内容吗？将按分类聚合并生成整理结果。', async () => {
            await doOrganizeContent();
        });
    }

    async function doOrganizeContent() {
        const organizeBtn = document.getElementById('organize-btn');
        const originalText = organizeBtn.textContent;

        try {
            showLoading('正在整理今日内容...', '按分类聚合并生成整理结果...');
            organizeBtn.disabled = true;
            organizeBtn.classList.add('btn-loading');
            const response = await axios.post(`${API_BASE_URL}/organize`);
            if (response.data.status === 'success') {
                showNotification(response.data.message || '今日内容整理完成', true);
            } else {
                showNotification('整理请求已完成', true);
            }
        } catch (error) {
            console.error('整理今日内容失败:', error);
            showError('整理失败', error.response?.data?.message || '请稍后重试');
        } finally {
            hideLoading();
            organizeBtn.disabled = false;
            organizeBtn.classList.remove('btn-loading');
            organizeBtn.textContent = originalText;
        }
    }

    async function generateWeeklyReport() {
        showActionConfirm('确定要生成周报总结吗？将汇总本周所有剪藏内容生成周报。', async () => {
            await doGenerateWeeklyReport();
        });
    }

    async function doGenerateWeeklyReport() {
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

    function showNotification(message, showOpenButton = false) {
        const notificationBar = document.getElementById('notification-bar');
        const notificationMessage = document.getElementById('notification-message');
        const openFolderBtn = document.getElementById('open-folder-btn');

        notificationMessage.textContent = message;
        openFolderBtn.style.display = showOpenButton === true ? 'block' : 'none';
        notificationBar.style.display = 'block';

        // 5秒后自动关闭
        setTimeout(() => {
            notificationBar.style.display = 'none';
        }, 5000);
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