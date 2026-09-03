// ============================================================
// CutShelter clip 页面模块: clip-sync
// 由 clip.html 内联脚本按功能拆分生成（经典 script 顺序加载）
// ============================================================

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

        // 使用 DOM API 构建，避免 title/message 注入 HTML（XSS）
        errorDiv.innerHTML = '';
        const flex = document.createElement('div');
        flex.style.cssText = 'display: flex; align-items: flex-start; gap: 12px;';
        const icon = document.createElement('div');
        icon.style.cssText = 'font-size: 1.5rem; flex-shrink: 0;';
        icon.textContent = '⚠️';
        const body = document.createElement('div');
        body.style.flex = '1';
        const titleEl = document.createElement('h4');
        titleEl.style.cssText = 'margin: 0 0 8px 0; font-size: 1.1rem; font-weight: 600;';
        titleEl.textContent = title;
        const msgEl = document.createElement('p');
        msgEl.style.cssText = 'margin: 0; font-size: 0.95rem; opacity: 0.9;';
        msgEl.textContent = message;
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '关闭';
        closeBtn.style.cssText = `
                            margin-top: 12px;
                            background: rgba(255, 255, 255, 0.2);
                            border: none;
                            color: white;
                            padding: 6px 12px;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 0.85rem;
                            transition: background 0.3s ease;
                        `;
        closeBtn.addEventListener('click', () => errorDiv.remove());
        body.appendChild(titleEl);
        body.appendChild(msgEl);
        body.appendChild(closeBtn);
        flex.appendChild(icon);
        flex.appendChild(body);
        errorDiv.appendChild(flex);

        document.body.appendChild(errorDiv);

        // 3秒后自动消失
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.style.animation = 'slideOut 0.3s ease-in';
                setTimeout(() => errorDiv.remove(), 300);
            }
        }, 5000);
    }

    function syncGit() {
        showActionConfirm('确定要同步仓库吗？将把本地剪藏数据推送到 Git 远程仓库。', () => {
            doSyncGit();
        });
    }

    function doSyncGit() {
        const syncBtn = document.getElementById('sync-btn');

        syncBtn.disabled = true;
        syncBtn.innerHTML = '<span class="toggle-text">🔄 同步中...</span>';
        hideGitSyncResult();

        axios.post(`${GIT_API_BASE_URL}/sync`)
            .then(response => {
                syncBtn.innerHTML = '<span class="toggle-text">🔄 同步仓库</span>';
                syncBtn.disabled = false;
                renderGitSyncResult(response.data || { ok: true, steps: [] });
                showNotification((response.data?.ok) ? '同步完成' : '同步过程中出现问题，详见同步详情');
            })
            .catch(error => {
                syncBtn.innerHTML = '<span class="toggle-text">🔄 同步仓库</span>';
                syncBtn.disabled = false;
                // 后端在同步异常时以 400 返回结构化的分步结果
                renderGitSyncResult(error.response?.data || { ok: false, message: error.response?.data?.message || error.message, steps: [] });
                showNotification('同步失败: ' + (error.response?.data?.message || error.message));
                console.error('Git sync failed:', error);
            });
    }

    // 渲染 Git 同步分步结果
    function renderGitSyncResult(result) {
        const container = document.getElementById('git-sync-result');
        if (!container) return;

        const steps = Array.isArray(result?.steps) ? result.steps : [];
        const ok = !!result?.ok;
        const message = result?.message || (ok ? '同步完成' : '同步失败');

        const STEP_NAMES = {
            fetch: '拉取', pull: '合并', add: '暂存', commit: '提交', push: '推送'
        };

        let html = `<div class="sync-card">`;
        html += `<div class="sync-summary"><span class="sum-icon">${ok ? '✅' : '⚠️'}</span><span>${escapeHtml(message)}</span></div>`;
        html += '<div class="sync-steps">';
        steps.forEach(step => {
            const stepOk = !!step.ok;
            const name = STEP_NAMES[step.name] || step.name || '';
            const files = (step.files && step.files > 0) ? `（${step.files} 个文件）` : '';
            html += `<div class="sync-step">`;
            html += `<span class="step-icon ${stepOk ? 'ok' : 'err'}">${stepOk ? '✓' : '✗'}</span>`;
            html += `<span class="step-name">${escapeHtml(name)}</span>`;
            html += `<span class="step-detail ${stepOk ? '' : 'err'}">${escapeHtml(step.message || '')}${files}</span>`;
            html += '</div>';
        });
        html += '</div></div>';

        container.innerHTML = html;
        container.classList.remove('sync-ok', 'sync-err');
        container.classList.add('visible', ok ? 'sync-ok' : 'sync-err');
    }

    function hideGitSyncResult() {
        const container = document.getElementById('git-sync-result');
        if (container) {
            container.classList.remove('visible');
            container.innerHTML = '';
        }
    }

    // 触发 Web Clipper 同步：调用 POST /api/sync/trigger
    function triggerWebClipperSync() {
        const syncBtn = document.getElementById('web-clipper-sync-btn');
        if (!syncBtn) return;
        const originalHtml = syncBtn.innerHTML;
        syncBtn.disabled = true;
        syncBtn.innerHTML = '同步中...';

        axios.post(`${SYNC_API_BASE_URL}/trigger`)
            .then(response => {
                const data = response.data || {};
                const syncedCount = data.syncedCount != null ? data.syncedCount : (data.added != null ? data.added : (data.newCount != null ? data.newCount : 0));
                const skippedCount = data.skippedCount != null ? data.skippedCount : (data.skipped != null ? data.skipped : (data.skipCount != null ? data.skipCount : 0));
                const message = data.message || `同步完成：新增 ${syncedCount} 条，跳过 ${skippedCount} 条`;
                showToast(message);
                // 同步成功后刷新同步状态和剪藏列表
                loadSyncStatus();
                fetchClips();
            })
            .catch(error => {
                const msg = error.response?.data?.message || error.message || '未知错误';
                showToast('Web Clipper 同步失败: ' + msg);
                console.error('Web Clipper sync failed:', error);
            })
            .finally(() => {
                syncBtn.disabled = false;
                syncBtn.innerHTML = originalHtml;
            });
    }

    // 加载 Web Clipper 同步状态：调用 GET /api/sync/status
    function loadSyncStatus() {
        const statusText = document.getElementById('sync-status-text');
        const statusDot = document.querySelector('#web-clipper-sync-status .sync-dot');
        if (!statusText) return;

        axios.get(`${SYNC_API_BASE_URL}/status`)
            .then(response => {
                const data = response.data || {};
                const synced = data.synced != null ? data.synced : (data.syncedCount != null ? data.syncedCount : 0);
                const pending = data.pending != null ? data.pending : (data.pendingCount != null ? data.pendingCount : 0);
                statusText.textContent = `Web Clipper 同步：已同步 ${synced} 条，待同步 ${pending} 条`;
                if (statusDot) {
                    statusDot.classList.toggle('pending', pending > 0);
                }
            })
            .catch(error => {
                statusText.textContent = 'Web Clipper 同步：状态获取失败';
                if (statusDot) statusDot.classList.add('pending');
                console.error('Load sync status failed:', error);
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
                    document.getElementById('branch').value = config.branch || 'main';
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
                showNotification('Git配置保存成功');
                closeGitConfigModal();
            })
            .catch(error => {
                showNotification('Git配置保存失败: ' + (error.response?.data || error.message));
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
                showNotification(response.data);
            })
            .catch(error => {
                showNotification('连接测试失败: ' + (error.response?.data || error.message));
            })
            .finally(() => {
                testBtn.disabled = false;
                testBtn.textContent = '测试连接';
            });
    }

// ====== 接收主框架消息：滚动到顶部 / 刷新 ======
window.addEventListener('message', (e) => {
  if (e.data.action === 'backendState') {
    // 主框架广播的后端状态（ready/stopped/starting/error），供上传失败分级提示
    window.__backendState = e.data.state || '';
  } else if (e.data.action === 'scrollToTop') {
    document.documentElement.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (e.data.action === 'refresh') {
    location.reload();
  } else if (e.data.action === 'hardRefresh') {
    CutShelterScroll.capture(e.data.module || 'clip');
    location.reload();
  } else if (e.data.action === 'themeChange') {
    applyTheme(localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME, false);
  } else if (e.data.action === 'workspaceChange') {
    const wsId = e.data.workspaceId;
    if (wsId) {
      localStorage.setItem('active_workspace_id', wsId);
    } else {
      localStorage.removeItem('active_workspace_id');
    }
    fetchClips();
  } else if (e.data.action === 'refreshKnowledge') {
    document.querySelectorAll('.clip-detail.expanded').forEach(detail => {
      const clipId = detail.dataset.clipId;
      if (clipId) {
        renderLinkedKnowledge(parseInt(clipId));
        renderPlanBacklinks(parseInt(clipId));
      }
    });
  }
});

// ====== 选择与知识合成（浮动操作栏） ======

// 使用事件委托监听复选框变化
document.addEventListener('change', function(e) {
    if (e.target.classList.contains('clip-checkbox')) {
        handleCheckboxChange(e.target);
    }
});

function handleCheckboxChange(checkbox) {
    const clipId = parseInt(checkbox.dataset.clipId);
    const clipItem = checkbox.closest('.clip-item');
    if (checkbox.checked) {
        selectedClipIds.add(clipId);
        if (clipItem) clipItem.classList.add('selected');
    } else {
        selectedClipIds.delete(clipId);
        if (clipItem) clipItem.classList.remove('selected');
    }
    updateFloatBar();
}

function updateFloatBar() {
    const bar = document.getElementById('float-bar');
    const countNum = document.getElementById('float-bar-count-num');
    const btn = document.getElementById('float-bar-synthesize-btn');
    const count = selectedClipIds.size;

    countNum.textContent = count;
    if (count > 0) {
        bar.classList.add('visible');
        btn.disabled = count < 2;
    } else {
        bar.classList.remove('visible');
        btn.disabled = true;
    }
}

function clearAllSelection() {
    selectedClipIds.clear();
    document.querySelectorAll('.clip-checkbox').forEach(function(cb) {
        cb.checked = false;
    });
    document.querySelectorAll('.clip-item.selected').forEach(function(item) {
        item.classList.remove('selected');
    });
    updateFloatBar();
}

async function synthesizeKnowledge() {
    if (selectedClipIds.size < 2) {
        showToast('请至少选择 2 个剪藏以合成知识');
        return;
    }

    const btn = document.getElementById('float-bar-synthesize-btn');
    const btnText = document.getElementById('float-bar-btn-text');
    btn.disabled = true;
    btnText.innerHTML = '<span class="float-bar-loading"><span class="spinner"></span>AI 合成中…</span>';

    try {
        const response = await axios.post(KNOWLEDGE_API_BASE_URL + '/synthesize', {
            clipIds: Array.from(selectedClipIds)
        });

        const data = response.data;
        if (data.error) {
            showToast(data.error);
            btn.disabled = false;
            btnText.textContent = '合成知识';
            return;
        }

        // 将 AI 合成的内容存入 sessionStorage，供 knowledge-editor 使用
        sessionStorage.setItem('synthesizedKnowledge', JSON.stringify({
            title: data.title || '',
            summary: data.summary || '',
            content: data.content || '',
            sourceClipIds: data.sourceClipIds || []
        }));

        // 通知父框架切换到知识模块并打开知识编辑器，保持应用头部导航栏
        window.parent.postMessage({ type: 'navigateKnowledgeCreate' }, '*');
    } catch (error) {
        console.error('知识合成失败:', error);
        const errMsg = error.response?.data?.error || 'AI 合成失败，请稍后重试或手动创建知识条目';
        showToast(errMsg);
        btn.disabled = false;
        btnText.textContent = '合成知识';
    }
}

// ====== Toast ======
function showToast(msg) {
  if (window.UI && UI.toast) {
    UI.toast(msg, { type: 'info', duration: 2000 });
    return;
  }
  const existing = document.querySelector('.clip-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'clip-toast';
  t.textContent = msg;
  t.style.cssText = 'position:fixed;top:20px;right:20px;background:var(--card);color:var(--fg);padding:10px 20px;border-radius:10px;border:1px solid var(--border);z-index:9999;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,0.15);animation:slideIn 0.3s ease-out;';
  document.body.appendChild(t);
  setTimeout(() => { t.style.animation = 'slideOut 0.3s ease-in forwards'; setTimeout(() => t.remove(), 300); }, 2000);
}

// ====== 已关联知识 ======
async function renderLinkedKnowledge(clipId) {
    const listEl = document.getElementById(`linkedKnowledgeList-${clipId}`);
    const noDataEl = document.getElementById(`noLinkedKnowledge-${clipId}`);
    if (!listEl || !noDataEl) return;

    try {
        const response = await axios.get(`${KNOWLEDGE_API_BASE_URL}/by-clip/${clipId}`);
        const knowledgeList = response.data || [];

        // 列表级「已关联知识」角标
        const badge = document.getElementById(`knowledge-badge-${clipId}`);
        if (badge) {
            if (knowledgeList.length > 0) {
                badge.textContent = `🧠 已关联 ${knowledgeList.length} 条知识`;
                badge.style.display = '';
            } else {
                badge.style.display = 'none';
            }
        }

        if (knowledgeList.length > 0) {
            noDataEl.style.display = 'none';
            listEl.style.display = 'block';
            listEl.innerHTML = knowledgeList.map(k => {
                const date = k.createdAt ? new Date(k.createdAt).toLocaleDateString('zh-CN') : '';
                const summary = k.summary || '';
                return `<div class="linked-knowledge-item">
                    <div class="knowledge-title">
                        <a href="knowledge-detail.html?id=${k.id}" target="_blank">${escapeHtml(k.title || '未命名知识')}</a>
                    </div>
                    ${summary ? `<div class="knowledge-summary">${escapeHtml(summary)}</div>` : ''}
                    ${date ? `<div class="knowledge-date">${date}</div>` : ''}
                </div>`;
            }).join('');
        } else {
            listEl.style.display = 'none';
            noDataEl.style.display = 'block';
            const btn = noDataEl.querySelector('.create-knowledge-action');
            if (btn) {
                btn.classList.remove('loading');
                btn.innerHTML = '创建知识条目';
            }
        }
    } catch (error) {
        console.error('获取已关联知识失败:', error);
        listEl.style.display = 'none';
        noDataEl.style.display = 'block';
        const btn = noDataEl.querySelector('.create-knowledge-action');
        if (btn) {
            btn.classList.remove('loading');
            btn.innerHTML = '创建知识条目';
        }
    }
}

// ====== 被学习计划引用（剪藏反链）=======
async function renderPlanBacklinks(clipId) {
    const section = document.getElementById(`planBacklinksSection-${clipId}`);
    const listEl = document.getElementById(`planBacklinksList-${clipId}`);
    if (!section || !listEl) return;
    try {
        const response = await axios.get(`${API_ROOT}/learning-plan/by-clip/${clipId}`);
        const plans = response.data || [];
        if (!plans || plans.length === 0) {
            section.style.display = 'none';
            return;
        }
        section.style.display = '';
        listEl.innerHTML = plans.map(p => `
            <div class="linked-knowledge-item" style="cursor:pointer;">
                <div class="knowledge-title">
                    <a href="javascript:void(0)" onclick="openLearningPlanFromClip(${p.planId})">📘 ${escapeHtml(p.planTitle)}</a>
                    <span style="font-size:0.72rem;color:var(--text-muted);">${(p.phases || []).map(ph => `阶段 ${ph.phaseNumber}`).join('、')}</span>
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.error('获取学习计划引用失败:', e);
        section.style.display = 'none';
    }
}

function openLearningPlanFromClip(planId) {
    if (window.parent && window.parent.postMessage) {
        window.parent.postMessage({ type: 'navigateLearningPlan', planId: parseInt(planId) }, '*');
    }
}

async function createKnowledgeFromClip(event, clipId) {
    let savedHtml = null;
    if (event) {
        event.stopPropagation();
        const btn = event.currentTarget;
        savedHtml = btn.innerHTML;
        btn.classList.add('loading');
        btn.innerHTML = '<span class="spinner"></span> 加载中…';
    }

    try {
        // 获取剪藏数据
        const clipResp = await axios.get(`${API_BASE_URL}/${clipId}`);
        const clip = clipResp.data;
        if (!clip) {
            showToast('获取剪藏数据失败');
            _resetCreateBtn(event, savedHtml);
            return;
        }

        // 组装知识草稿数据，存入 sessionStorage
        const knowledgeDraft = {
            title: clip.title || clip.summary || ('来自剪藏 #' + clip.id),
            summary: clip.summary || '',
            content: clip.content || '',
            sourceClipIds: [clip.id]
        };
        sessionStorage.setItem('synthesizedKnowledge', JSON.stringify(knowledgeDraft));

        showToast('正在跳转到知识编辑器...');
        // 通知父框架切换到知识模块并打开知识编辑器，保持应用头部导航栏
        window.parent.postMessage({ type: 'navigateKnowledgeCreate' }, '*');
    } catch (error) {
        console.error('获取剪藏数据失败:', error);
        showToast('获取剪藏数据失败，请稍后重试');
        _resetCreateBtn(event, savedHtml);
    }
}

function _resetCreateBtn(event, savedHtml) {
    if (event && savedHtml) {
        const btn = event.currentTarget;
        btn.classList.remove('loading');
        btn.innerHTML = savedHtml;
    }
}
