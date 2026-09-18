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
        closeModalWithAnim(document.getElementById('confirm-modal'));
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
        closeModalWithAnim(document.getElementById('prompt-config-modal'));
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
        // 删除前缓存原数据，用于「撤销」恢复（误删可找回）
        const undoClip = clipCache.get(String(id)) || null;
        // 即时反馈：确认后立刻给卡片加「删除中」态并提示，避免请求期间页面毫无响应（后端删除需全库扫描，耗时较久）
        setClipDeletingState(id, true);
        showToast('正在删除…');
        try {
            const response = await axios.delete(`${API_BASE_URL}/${id}`);
            if (response.data.status === 'success') {
                // 写入墓碑：本地索引同步滞后期内客户端先行隐藏，避免删除后闪回
                if (id != null) softDeletedIds.add(String(id));
                setClipDeletingState(id, false);
                // 先播放卡片移除动画，动画结束（240ms）后本地即时重渲染（无需等后端/切换筛选）；
                // 全量刷新延后一拍执行，避免刚移除就整列表重建的闪烁感
                animateRemoveClipItem(id, function () {
                    lastFilteredClips = lastFilteredClips.filter(function (c) { return c && String(c.id) !== String(id); });
                    renderClipList(lastFilteredClips);
                    setTimeout(function () { fetchClips(); }, 300);
                });
                if (undoClip) {
                    showActionToast('已删除', '撤销', function () { undoDeleteClip(undoClip); });
                } else {
                    showToast('已删除');
                }
                return;
            }
            // 后端未回 success：按失败处理并恢复卡片状态，避免卡片一直停在"删除中"
            setClipDeletingState(id, false);
            showToast('删除失败，请稍后重试');
        } catch (error) {
            console.error('删除剪藏失败:', error);
            setClipDeletingState(id, false);
            showToast('删除失败，请稍后重试');
        }
    }

    /** 切换卡片「删除中」态：半透明 + 禁用交互，给请求期间提供明确的即时视觉反馈 */
    function setClipDeletingState(id, on) {
        const anchor = document.getElementById('check-area-' + id);
        const item = anchor ? anchor.closest('.clip-item') : null;
        if (item) item.classList.toggle('clip-item-deleting', !!on);
    }

    /** 删除动画：卡片淡出右移后移除，动画结束回调（供 fetchClips 全量重建） */
    function animateRemoveClipItem(id, onDone) {
        const anchor = document.getElementById('check-area-' + id);
        const item = anchor ? anchor.closest('.clip-item') : null;
        if (!item) {
            if (onDone) onDone();
            return;
        }
        item.classList.add('clip-item-removing');
        // 动画时长对齐 --app-duration-panel：读取 CSS 令牌，避免与样式里的移除过渡时长脱节
        var removeAnim = 250;
        try {
            removeAnim = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--app-duration-panel'), 10) || 250;
        } catch (e) { /* 保持默认 250ms */ }
        setTimeout(function () {
            item.remove();
            if (onDone) onDone();
        }, removeAnim);
    }

    /** 撤销删除：用缓存的原数据重新入库（POST /add，后端去重时视为已恢复） */
    function undoDeleteClip(clip) {
        const payload = {
            type: clip.type || 'text',
            content: clip.bodyContent || clip.content || '',
            title: clip.title || '',
            summary: clip.summary || '',
            category: clip.category || '',
            source: clip.source || '',
            sourceUrl: clip.sourceUrl || '',
            tags: Array.isArray(clip.tags) ? clip.tags : [],
            myThoughts: clip.myThoughts || '',
            useAiTags: false
        };
        return axios.post(`${API_BASE_URL}/add`, payload).then(function (res) {
            const st = res.data && res.data.status;
            const cid = clip.id != null ? String(clip.id) : null;
            if (cid) softDeletedIds.delete(cid); // 撤销成功：清墓碑，条目恢复可见
            showToast(st === 'success' ? '已恢复删除的剪藏' : '已恢复（与原内容合并）');
            fetchClips();
        }).catch(function () {
            showToast('恢复失败，请检查后端服务');
        });
    }

    /** 带动作按钮的提示 toast（UI.toast 不支持按钮，独立实现；如「撤销」「去写作」） */
    function showActionToast(msg, actionLabel, onAction) {
        const existing = document.querySelector('.clip-toast-undo');
        if (existing) existing.remove();
        const t = document.createElement('div');
        t.className = 'clip-toast-undo';
        t.innerHTML = '<span class="clip-toast-undo-text"></span><button type="button" class="clip-toast-undo-btn"></button>';
        t.querySelector('.clip-toast-undo-text').textContent = msg;
        const btn = t.querySelector('.clip-toast-undo-btn');
        btn.textContent = actionLabel || '撤销';
        document.body.appendChild(t);
        const dismiss = function () {
            if (!t.isConnected) return;
            clearTimeout(t._timer);
            t.style.transition = 'opacity .2s ease, transform .2s ease';
            t.style.opacity = '0';
            setTimeout(function () { t.remove(); }, 220);
        };
        btn.addEventListener('click', function () {
            dismiss();
            if (onAction) onAction();
        });
        t._timer = setTimeout(dismiss, 6000);
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
                // 闭环：一键跳转写作区打开该剪藏（复用 openClipInEditor 消息机制）
                showActionToast('已整理为笔记', '去写作', function () {
                    window.parent.postMessage({ type: 'openClipInEditor', clipId }, '*');
                });
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
        closeModalWithAnim(document.getElementById('organize-action-modal'));
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
        showActionConfirm('确定要生成今日日报吗？将汇总今日剪藏并生成日报内容。', async () => {
            await doOrganizeContent();
        });
    }

    /** 已保存剪藏重新 OCR：识别首图文字，本地识别后弹窗展示，AI 总结独立触发，保存走内容写回接口（不动工作流状态） */
    var currentOcrTarget = null;

    async function ocrClipImage(clipId) {
        const clip = clipCache.get(String(clipId));
        if (!clip) { showToast('未找到该剪藏'); return; }
        const rel = (
            (Array.isArray(clip.imagePaths) && clip.imagePaths.length) ? clip.imagePaths[0]
                : ((clip.bodyContent || clip.content || '').match(/media\/\d{4}\/[\w.-]+\.\w{1,10}/) || [null])[0]
        );
        if (!rel) { showToast('未找到该剪藏的图片'); return; }
        try {
            const dataUrl = await loadImageDataUrl(rel);
            const text = await recognizeImage(dataUrl);
            if (!text) return;
            openOcrResultModal(clip, text);
        } catch (e) {
            showToast('OCR 失败：' + (e && e.message ? e.message : '请稍后重试'));
        }
    }

    /** 打开 OCR 结果弹窗：baseContent 补上图片引用，避免保存时丢图 */
    function openOcrResultModal(clip, text) {
        const base = window.MediaKit.render.appendImageRefs((clip.bodyContent || clip.content || ''), clip.imagePaths);
        currentOcrTarget = { clipId: clip.id, baseContent: base };
        const textEl = document.getElementById('ocr-result-text');
        if (textEl) textEl.value = text || '';
        const statusEl = document.getElementById('ocr-result-status');
        if (statusEl) statusEl.textContent = '';
        const modal = document.getElementById('ocr-result-modal');
        if (modal) modal.style.display = 'flex';
    }

    /** 对弹窗里的 OCR 原文独立触发 AI 总结（可选、较慢，失败不阻塞） */
    async function summarizeOcrModal() {
        const textEl = document.getElementById('ocr-result-text');
        const text = textEl ? textEl.value.trim() : '';
        if (!text) { showToast('暂无识别结果，无法总结'); return; }
        const btn = document.getElementById('ocr-summarize-btn');
        const statusEl = document.getElementById('ocr-result-status');
        if (btn) { btn.disabled = true; btn.textContent = '总结中…'; }
        if (statusEl) statusEl.textContent = '正在生成 AI 总结…';
        try {
            const summary = await requestTextSummary(text);
            if (summary && textEl) {
                textEl.value = (textEl.value ? textEl.value + '\n\n' : '') + '**AI 总结**：' + summary;
                if (statusEl) statusEl.textContent = '';
            } else {
                if (statusEl) statusEl.textContent = 'AI 总结失败，已保留识别原文';
                showToast('AI 总结失败，请稍后重试');
            }
        } catch (e) {
            if (statusEl) statusEl.textContent = 'AI 总结失败，已保留识别原文';
            showToast('AI 总结失败：' + (e && e.message ? e.message : '请稍后重试'));
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '✨ AI 总结'; }
        }
    }

    /** 把弹窗里的识别结果写入原文（内容写回接口，不改变工作流状态 → 仍留在收件箱） */
    async function applyOcrModalToClip() {
        if (!currentOcrTarget) { showToast('缺少保存目标'); return; }
        const textEl = document.getElementById('ocr-result-text');
        const text = textEl ? textEl.value.trim() : '';
        if (!text) { showToast('暂无识别结果可保存'); return; }
        const saveBtn = document.getElementById('ocr-save-btn');
        const statusEl = document.getElementById('ocr-result-status');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '写入中…'; }
        if (statusEl) statusEl.textContent = '正在写入原文…';
        try {
            const base = currentOcrTarget.baseContent;
            const newContent = base ? base + '\n\n' + text : text;
            await axios.put(`${API_BASE_URL}/${currentOcrTarget.clipId}/content`, { content: newContent });
            showToast('识别结果已写入原文（仍留在收件箱）');
            closeOcrResultModal();
            await fetchClips();
        } catch (e) {
            if (statusEl) statusEl.textContent = '';
            showToast('保存失败：' + (e && e.message ? e.message : '请稍后重试'));
        } finally {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 保存到原文'; }
        }
    }

    function closeOcrResultModal() {
        const modal = document.getElementById('ocr-result-modal');
        if (modal) modal.style.display = 'none';
        currentOcrTarget = null;
        const textEl = document.getElementById('ocr-result-text');
        if (textEl) textEl.value = '';
        const statusEl = document.getElementById('ocr-result-status');
        if (statusEl) statusEl.textContent = '';
        const btn = document.getElementById('ocr-summarize-btn');
        if (btn) { btn.disabled = false; btn.textContent = '✨ AI 总结'; }
    }

    async function doOrganizeContent() {
        const organizeBtn = document.getElementById('organize-btn');
        const originalHTML = organizeBtn.innerHTML; // 含图标，恢复需用 innerHTML 防止图标丢失

        try {
            showLoading('正在生成今日日报...', '汇总今日剪藏并按分类聚合...');
            organizeBtn.disabled = true;
            organizeBtn.classList.add('btn-loading');
            const response = await axios.post(`${API_BASE_URL}/organize`);
            if (response.data.status === 'success') {
                const msg = response.data.message;
                showNotification((msg && msg !== '今日内容整理完成') ? msg : '今日日报已生成', true);
            } else {
                showNotification('日报请求已完成', true);
            }
        } catch (error) {
            console.error('生成日报失败:', error);
            showError('日报生成失败', error.response?.data?.message || '请稍后重试');
        } finally {
            hideLoading();
            organizeBtn.disabled = false;
            organizeBtn.classList.remove('btn-loading');
            organizeBtn.innerHTML = originalHTML;
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
        closeModalWithAnim(document.getElementById('feedback-modal'));
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

    // ===== 每日回看（沉底旧收藏回顾） =====
    var dailyReviewItems = [];
    var dailyReviewIdx = 0;
    var dailyReviewStats = { keep: 0, archive: 0, skip: 0, keepTitles: [] };
    var DAILY_REVIEW_KEY = 'daily_review_dismissed_v1';
    var DAILY_REVIEW_STATS_KEY = 'daily_review_stats_v1';
    // 「当天已完成回看」标记：按天生效，次日自动恢复提示栏（区别于 DAILY_REVIEW_KEY 的手动永久关闭）
    var DAILY_REVIEW_DONE_PREFIX = 'daily_review_done_';
    function isDailyReviewDoneToday() {
        try { return localStorage.getItem(DAILY_REVIEW_DONE_PREFIX + todayKey()) === '1'; } catch (e) { return false; }
    }
    function markDailyReviewDoneToday() {
        try { localStorage.setItem(DAILY_REVIEW_DONE_PREFIX + todayKey(), '1'); } catch (e) {}
    }

    /** 已「仍有用」的条目（永久不再推荐）+ 今日已跳过的条目（明天再议） */
    var REVIEW_KEPT_PREFIX = 'daily_review_kept_';
    var REVIEW_SKIPPED_PREFIX = 'daily_review_skipped_';
    function isClipKept(clipId) {
        return clipId != null && localStorage.getItem(REVIEW_KEPT_PREFIX + clipId) === '1';
    }
    function wasClipSkippedToday(clipId) {
        if (clipId == null) return false;
        return localStorage.getItem(REVIEW_SKIPPED_PREFIX + clipId) === todayKey();
    }

    /** 从剪藏缓存中挑选「沉底」旧内容：待整理优先，其次最久未回看（旧的在前） */
    function collectDailyReviewItems() {
        const items = [];
        clipCache.forEach(function (clip) {
            if (!clip || clip.type === 'todo') return;
            if (isClipKept(clip.id) || wasClipSkippedToday(clip.id)) return;
            if (!clip.content && !clip.summary && !clip.bodyContent && !clip.analysis) return;
            items.push(clip);
        });
        items.sort(function (a, b) {
            const wa = resolveWorkflowStatus(a) === 'inbox' ? 0 : 1;
            const wb = resolveWorkflowStatus(b) === 'inbox' ? 0 : 1;
            if (wa !== wb) return wa - wb;
            const da = getClipCreatedDate(a);
            const db = getClipCreatedDate(b);
            return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
        });
        return items.slice(0, 3);
    }

    /** 本周回顾统计（localStorage 持久化，按天累计） */
    function getDailyReviewStats() {
        try { return JSON.parse(localStorage.getItem(DAILY_REVIEW_STATS_KEY) || '{}'); } catch (e) { return {}; }
    }
    function todayKey() { return new Date().toISOString().slice(0, 10); }
    function recordDailyReview(stats) {
        const store = getDailyReviewStats();
        const key = todayKey();
        const prev = store[key] || { keep: 0, archive: 0, skip: 0, count: 0 };
        prev.keep += stats.keep || 0;
        prev.archive += stats.archive || 0;
        prev.skip += stats.skip || 0;
        prev.count += stats.count || 0;
        store[key] = prev;
        try { localStorage.setItem(DAILY_REVIEW_STATS_KEY, JSON.stringify(store)); } catch (e) {}
    }
    function getWeekReviewStats() {
        const store = getDailyReviewStats();
        const now = new Date();
        const day = (now.getDay() + 6) % 7; // 周一=0
        const monday = new Date(now);
        monday.setDate(now.getDate() - day);
        monday.setHours(0, 0, 0, 0);
        const sums = { keep: 0, archive: 0, skip: 0, count: 0, days: 0 };
        const seen = new Set();
        Object.keys(store).forEach(function (k) {
            const d = new Date(k + 'T00:00:00');
            if (isNaN(d.getTime()) || d < monday || d > now) return;
            sums.keep += store[k].keep || 0;
            sums.archive += store[k].archive || 0;
            sums.skip += store[k].skip || 0;
            sums.count += store[k].count || 0;
            seen.add(k);
        });
        sums.days = seen.size;
        return sums;
    }

    function showDailyReviewBanner() {
        const banner = document.getElementById('daily-review');
        if (!banner) return;
        if (localStorage.getItem(DAILY_REVIEW_KEY) === '1' || isDailyReviewDoneToday()) { banner.style.display = 'none'; return; }
        const items = collectDailyReviewItems();
        if (items.length === 0) { banner.style.display = 'none'; return; }
        document.getElementById('daily-review-count').textContent = items.length;
        // 本周回顾进度提示（已有回顾记录时展示为独立徽章，保留基础文案不动）
        const week = getWeekReviewStats();
        const progressEl = document.getElementById('daily-review-progress');
        if (progressEl) {
            if (week.count > 0) {
                progressEl.textContent = '本周已回看 ' + week.count + ' 条 · 保留 ' + week.keep + ' · 归档 ' + week.archive;
                progressEl.style.display = 'inline-flex';
            } else {
                progressEl.style.display = 'none';
            }
        }
        banner.style.display = 'flex';
    }

    function dismissDailyReview() {
        localStorage.setItem(DAILY_REVIEW_KEY, '1');
        const banner = document.getElementById('daily-review');
        if (banner) banner.style.display = 'none';
    }

    function openDailyReview() {
        dailyReviewItems = collectDailyReviewItems();
        dailyReviewIdx = 0;
        dailyReviewStats = { keep: 0, archive: 0, skip: 0, keepTitles: [] };
        if (dailyReviewItems.length === 0) {
            showToast('今天没有可回看的旧收藏');
            return;
        }
        document.getElementById('daily-footer').style.display = 'flex';
        renderDailyReview();
        document.getElementById('daily-review-modal').style.display = 'flex';
    }

    function closeDailyReview() {
        closeModalWithAnim(document.getElementById('daily-review-modal'));
    }

    function renderDailyReview() {
        const item = dailyReviewItems[dailyReviewIdx];
        const total = dailyReviewItems.length;
        document.getElementById('daily-progress-fill').style.width = ((dailyReviewIdx + 1) / total * 100) + '%';
        document.getElementById('daily-progress-txt').textContent = (dailyReviewIdx + 1) + ' / ' + total;
        const title = escapeHtml(item.title || item.summary || item.content || '未命名');
        // 完整原文：优先级与列表/编辑器一致 bodyContent > content
        const raw = item.bodyContent || item.content || '';
        const bodyHtml = window.MediaKit.render && window.MediaKit.render.renderMarkdown
            ? window.MediaKit.render.renderMarkdown(raw)
            : escapeHtml(raw);
        const date = getClipCreatedDate(item);
        const dateText = date ? (typeof formatClipDateTime === 'function' ? formatClipDateTime(date) : '') : '';
        const typeLabel = escapeHtml(item.type || '剪藏');
        document.getElementById('daily-card').innerHTML =
            '<div class="daily-card-type"><span class="daily-dot" style="background:var(--primary)"></span>' + typeLabel + '</div>' +
            '<div class="daily-card-title">' + title + '</div>' +
            (dateText ? '<div class="daily-card-meta">收藏于 ' + dateText + '</div>' : '') +
            (raw ? '<div class="daily-card-content">' + bodyHtml + '</div>' : '');
        if (window.MediaKit.render && window.MediaKit.render.renderMermaid) {
            window.MediaKit.render.renderMermaid(document.getElementById('daily-card'));
        }
        // 图片点击放大/下载（复用列表详情同一套预览层）
        if (typeof bindDetailImageClicks === 'function') bindDetailImageClicks(document.getElementById('daily-card'));
        // 保留该条剪藏的 imagePaths 图片（剪贴板截图类正文只有文字，需补图展示）
        if (item.imagePaths && item.imagePaths.length) {
            const host = document.getElementById('daily-card');
            let extra = '';
            item.imagePaths.forEach(function (rel) {
                const url = window.MediaKit.render.mediaUrl(rel);
                extra += '<div class="daily-card-img"><img src="' + url + '" alt="剪藏图片" loading="lazy"></div>';
            });
            if (extra && !/daily-card-img/.test(host.innerHTML)) {
                host.insertAdjacentHTML('beforeend', extra);
                if (typeof bindDetailImageClicks === 'function') bindDetailImageClicks(host);
            }
        }
    }

    /** 标记该剪藏为「已保留」并落盘（后续不再重复推荐） */
    function markKeepPersisted(item) {
        if (item.id != null) {
            try { localStorage.setItem(REVIEW_KEPT_PREFIX + item.id, '1'); } catch (e) {}
        }
    }

    function dailyAction(action) {
        const item = dailyReviewItems[dailyReviewIdx];
        if (!item) return;
        if (action === 'keep') {
            markKeepPersisted(item);
            dailyReviewStats.keep++;
            dailyReviewStats.keepTitles.push(item.title || item.summary || '未命名');
            showToast('已标记为有用，不再重复推荐');
        } else if (action === 'skip') {
            if (item.id != null) {
                try { localStorage.setItem(REVIEW_SKIPPED_PREFIX + item.id, todayKey()); } catch (e) {}
            }
            dailyReviewStats.skip++;
        } else {
            dailyReviewStats.skip++;
        }
        dailyReviewIdx++;
        if (dailyReviewIdx >= dailyReviewItems.length) {
            document.getElementById('daily-footer').style.display = 'none';
            recordDailyReview({
                keep: dailyReviewStats.keep,
                archive: dailyReviewStats.archive,
                skip: dailyReviewStats.skip,
                count: dailyReviewItems.length
            });
            // 当天收官：收掉提示栏（当天不再主动打扰，次日恢复），如需继续可点下方按钮翻下一批
            markDailyReviewDoneToday();
            const banner = document.getElementById('daily-review');
            if (banner) banner.style.display = 'none';
            const hasMore = collectDailyReviewItems().length > 0;
            const keepTitles = dailyReviewStats.keepTitles || [];
            const keepList = keepTitles.length
                ? '<div class="daily-keep-list"><div class="daily-keep-label">本次标记为有用</div>' +
                  keepTitles.map(t => '<div class="daily-keep-item">' + escapeHtml(t) + '</div>').join('') +
                  '</div>'
                : '';
            const moreBtn = hasMore
                ? '<div class="daily-done-actions"><button class="btn-secondary" type="button" onclick="openDailyReview()">继续回顾3篇</button></div>'
                : '';
            document.getElementById('daily-card').innerHTML =
                '<div class="daily-done">' +
                '<div class="daily-done-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-9"/></svg></div>' +
                '<div class="daily-done-title">今日回看完成</div>' +
                '<div class="daily-done-sub">保留了 <b>' + dailyReviewStats.keep + '</b> 条 · 跳过 <b>' + dailyReviewStats.skip + '</b> 条</div>' +
                '</div>' +
                keepList +
                moreBtn;
            document.getElementById('daily-progress-fill').style.width = '100%';
            document.getElementById('daily-progress-txt').textContent = dailyReviewItems.length + ' / ' + dailyReviewItems.length;
        } else {
            renderDailyReview();
        }
    }

    // 错误提示函数