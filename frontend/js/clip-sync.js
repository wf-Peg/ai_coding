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
        syncBtn.classList.add('btn-loading');
        hideGitSyncResult();

        axios.post(`${GIT_API_BASE_URL}/sync`)
            .then(response => {
                syncBtn.disabled = false;
                syncBtn.classList.remove('btn-loading');
                renderGitSyncResult(response.data || { ok: true, steps: [] });
                // 同步完成后刷新同步状态面板（最近同步时间等实时更新）
                loadSyncStatusPanel();
                showNotification((response.data?.ok) ? '同步完成' : '同步过程中出现问题，详见同步详情');
            })
            .catch(error => {
                syncBtn.disabled = false;
                syncBtn.classList.remove('btn-loading');
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

    // pill 主文案
    function setWcPillText(text) {
        const label = document.getElementById('wc-pill-text');
        if (label) label.textContent = text;
    }

    // pill 主文案后的状态/条数小字（单行紧凑显示，避免撑高工具栏）
    function setWcPillMeta(text) {
        const meta = document.getElementById('wc-pill-meta');
        if (meta) meta.textContent = text || '';
    }

    // Clipper 轮询 & 自动同步状态缓存 / 上次自动触发时间
    var lastClipperStatus = null;
    var lastAutoSyncAt = 0;
    var CLIPPER_POLL_INTERVAL = 30000; // 状态轮询间隔（毫秒）

    // 手动触发一次 Clipper 同步；完成后刷新 pill、面板与剪藏列表
    function triggerWebClipperSync() {
        const pill = document.getElementById('web-clipper-sync-status');
        if (!pill) return;
        if (pill.classList.contains('wc-syncing')) return; // 防并发重复触发
        pill.classList.add('wc-syncing');
        pill.title = 'Clipper 同步中…';
        setWcPillText('clipper同步');
        setWcPillMeta('同步中…');

        axios.post(`${SYNC_API_BASE_URL}/trigger`)
            .then(response => {
                const data = response.data || {};
                const syncedCount = data.syncedCount != null ? data.syncedCount : (data.added != null ? data.added : 0);
                const skippedCount = data.skippedCount != null ? data.skippedCount : (data.skipped != null ? data.skipped : 0);
                const failedCount = data.failedCount != null ? data.failedCount : (data.failedFiles && data.failedFiles.length ? data.failedFiles.length : 0);
                let message = '同步完成';
                if (data.lastError) {
                    message = data.lastError;
                } else {
                    message = `新增 ${syncedCount} 条，跳过 ${skippedCount} 条`;
                    if (failedCount > 0) message += `，失败 ${failedCount} 条`;
                }
                showToast(message);
            })
            .catch(error => {
                const msg = error.response?.data?.lastError || error.response?.data?.message || error.message || '未知错误';
                showToast('Clipper 同步失败: ' + msg);
                console.error('Web Clipper sync failed:', error);
            })
            .finally(() => {
                pill.classList.remove('wc-syncing');
                // 无论成败都刷新状态并重拉列表，保证界面与后端一致
                loadClipperSync();
                if (typeof fetchClips === 'function') fetchClips();
            });
    }

    // 加载 Clipper 同步状态：更新 pill，若面板展开则渲染面板，并驱动自动同步
    function loadClipperSync() {
        return axios.get(`${SYNC_API_BASE_URL}/status`)
            .then(response => {
                const data = response.data || {};
                lastClipperStatus = data;
                updateClipperPill(data);
                const panel = document.getElementById('clipper-sync-panel');
                if (panel && !panel.hidden) renderClipperPanel(data);
                scheduleAutoSync(data);
                return data;
            })
            .catch(error => {
                console.error('Load clipper sync status failed:', error);
                const panel = document.getElementById('clipper-sync-panel');
                if (panel && !panel.hidden) {
                    const body = document.getElementById('clipper-panel-body');
                    if (body) { body.innerHTML = ''; body.appendChild(emptyRow('获取同步状态失败，请稍后重试。')); }
                }
                return null;
            });
    }

    // 根据状态更新 pill（点状颜色 + 主文案 + 待传/失败小字 + 悬浮说明）
    function updateClipperPill(data) {
        const pill = document.getElementById('web-clipper-sync-status');
        if (!pill) return;
        const dot = pill.querySelector('.sync-dot');
        const synced = data.syncedCount != null ? data.syncedCount : 0;
        const pending = data.pendingCount != null ? data.pendingCount : 0;
        const failed = data.failedCount != null ? data.failedCount : 0;

        let title = `Clipper 同步：已同步 ${synced} 条，待同步 ${pending} 条，失败 ${failed} 条（点击查看说明与手动同步）`;
        if (!data.enabled) title = `Clipper 同步：自动同步已关闭（需手动同步）（点击查看）`;
        if (data.lastError) title += '｜上次失败：' + data.lastError;

        pill.title = title;
        setWcPillText('clipper同步');
        let hasIssue = false;
        if (failed > 0) { setWcPillMeta(`失败${failed}`); hasIssue = true; }
        else if (pending > 0) { setWcPillMeta(`待传${pending}`); hasIssue = true; }
        else { setWcPillMeta(''); }
        if (dot) dot.classList.toggle('pending', hasIssue);
    }

    // 自动同步调度：仅在【自动开关开启 && 后端同步启用 && 有待同步 && 距上次触发≥间隔】时触发
    function scheduleAutoSync(data) {
        if (!data) return;
        if (!data.enabled) return;
        if (!(data.pendingCount > 0)) return;
        if (localStorage.getItem('clipper_auto_sync') === '0') return; // 默认开启，'0' 表示关闭
        const intervalMs = (data.intervalSeconds || 60) * 1000;
        const now = Date.now();
        if (now - lastAutoSyncAt < intervalMs) return;
        lastAutoSyncAt = now;
        triggerWebClipperSync();
    }

    // 打开/关闭 Clipper 说明面板；展开时刷新状态
    function toggleClipperSyncPanel() {
        const panel = document.getElementById('clipper-sync-panel');
        if (!panel) return;
        if (panel.hidden) { panel.hidden = false; loadClipperSync(); }
        else { panel.hidden = true; }
    }

    // 渲染 Clipper 说明面板主体：功能介绍 + 当前状态 + 失败原因 + 监听位置 + 操作
    function renderClipperPanel(status) {
        const body = document.getElementById('clipper-panel-body');
        if (!body) return;
        body.innerHTML = '';

        // 1) 功能介绍
        const intro = document.createElement('div');
        intro.className = 'sync-panel-card';
        intro.appendChild(panelTitle('这是做什么的？'));
        const introP = document.createElement('div');
        introP.className = 'clipper-intro';
        introP.textContent = 'Clipper 同步会把 Obsidian Web Clipper 存入「原样保存目录」的新 Markdown 文件自动同步为本应用的收件箱剪藏。原文仍保留在 Vault，剪藏以 wiki 链接引用，不会重复复制内容。';
        intro.appendChild(introP);
        body.appendChild(intro);

        // 2) 当前状态
        const st = document.createElement('div');
        st.className = 'sync-panel-card';
        st.appendChild(panelTitle('当前状态'));
        const enabled = !!status.enabled;
        const badge = document.createElement('span');
        badge.className = 'sync-stat-badge ' + (enabled ? 'ok' : 'warn');
        badge.textContent = enabled ? `自动同步已开启（每 ${status.intervalSeconds || 60} 秒扫描）` : '自动同步已关闭（需手动同步）';
        st.appendChild(badge);
        const synced = status.syncedCount != null ? status.syncedCount : 0;
        const pending = status.pendingCount != null ? status.pendingCount : 0;
        const failedCnt = status.failedCount != null ? status.failedCount : 0;
        st.appendChild(fieldRow('已同步', synced + ' 条'));
        st.appendChild(fieldRow('待同步', pending + ' 条' + (failedCnt > 0 ? `（其中 ${failedCnt} 条失败）` : '')));
        const lastT = status.lastSyncTime ? new Date(status.lastSyncTime).toLocaleString('zh-CN') : '暂无同步记录';
        st.appendChild(fieldRow('最近同步', lastT));
        body.appendChild(st);

        // 3) 失败原因 / 诊断
        const diag = document.createElement('div');
        diag.className = 'sync-panel-card';
        diag.appendChild(panelTitle('失败原因'));
        const errs = Array.isArray(status.failedFiles) ? status.failedFiles : [];
        if (status.lastError || errs.length > 0) {
            if (status.lastError) {
                const e = document.createElement('div');
                e.className = 'clipper-err';
                e.textContent = '整体失败：' + status.lastError;
                diag.appendChild(e);
            }
            if (errs.length) {
                const list = document.createElement('div');
                list.className = 'clipper-fail-list';
                errs.forEach(f => {
                    const row = document.createElement('div');
                    row.className = 'clipper-fail-item';
                    row.textContent = f;
                    list.appendChild(row);
                });
                diag.appendChild(list);
            }
        } else {
            diag.appendChild(emptyRow('当前无失败。'));
        }
        body.appendChild(diag);

        // 4) 监听位置
        const paths = document.createElement('div');
        paths.className = 'sync-panel-card';
        paths.appendChild(panelTitle('监听位置'));
        if (status.vaultPath) paths.appendChild(fieldRow('Vault 目录', status.vaultPath));
        if (status.sourcesDir) paths.appendChild(fieldRow('Clipper 保存目录', status.sourcesDir));
        paths.appendChild(emptyRow('请在 Obsidian Web Clipper 中将「保存位置」设置为上面的 Clipper 保存目录。'));
        body.appendChild(paths);

        // 5) 操作（自动同步开关 + 立即同步）
        const act = document.createElement('div');
        act.className = 'sync-panel-card';
        act.appendChild(panelTitle('操作'));
        const autoRow = document.createElement('label');
        autoRow.className = 'clipper-auto-row';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = localStorage.getItem('clipper_auto_sync') !== '0';
        cb.addEventListener('change', () => {
            localStorage.setItem('clipper_auto_sync', cb.checked ? '1' : '0');
        });
        autoRow.appendChild(cb);
        autoRow.appendChild(document.createTextNode('自动同步（有待同步时自动触发）'));
        act.appendChild(autoRow);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-primary';
        btn.textContent = '立即同步';
        btn.style.cssText = 'margin-top:10px;padding:8px 16px;border:none;border-radius:var(--radius);background:var(--primary);color:#fff;cursor:pointer;';
        btn.addEventListener('click', triggerWebClipperSync);
        act.appendChild(btn);
        body.appendChild(act);
    }

    // 生成卡片内小节标题
    function panelTitle(text) {
        const d = document.createElement('div');
        d.className = 'sync-panel-card-title';
        d.textContent = text;
        return d;
    }

    // 兼容旧入口：clip-shared.js DOMContentLoaded 仍调用 loadSyncStatus()
    function loadSyncStatus() {
        return loadClipperSync();
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
        closeModalWithAnim(document.getElementById('git-config-modal'));
    }

// ====== 同步状态面板（同步方案 + 连接状态 + 同步范围说明） ======
// 方案 fields 渲染器注册表（预留）：type -> renderFields(fields)。当前仅 Git；
// 未来新增同步方案时，在此补充对应 type 的处理即可，面板主框架无需改动。
var SYNCPROVIDER_RENDERERS = {};

function toggleSyncPanel() {
    // 切换同步状态面板显隐；每次展开都刷新，保证状态实时
    const panel = document.getElementById('sync-status-panel');
    if (!panel) return;
    if (panel.hidden) {
        panel.hidden = false;
        loadSyncStatusPanel();
    } else {
        panel.hidden = true;
    }
}

// 预取可用同步方案列表（provider 动态发现，未来新增方案自动出现）
function loadProviders() {
    return axios.get(`${SYNC_PROVIDER_API_BASE_URL}/providers`)
        .then(resp => (resp.data || []))
        .catch(err => { console.error('Load sync providers failed:', err); return []; });
}

// 加载并渲染同步状态面板主体
function loadSyncStatusPanel() {
    const body = document.getElementById('sync-panel-body');
    if (!body) return;
    // 并行拉取方案列表 + Git 方案状态
    Promise.all([
        loadProviders(),
        axios.get(`${SYNC_PROVIDER_API_BASE_URL}/git/status`)
    ])
    .then(([providers, statusResp]) => {
        renderSyncPanel(statusResp.data || {}, providers);
    })
    .catch(err => {
        body.innerHTML = '';
        body.appendChild(emptyRow('获取同步状态失败，请稍后重试。'));
        console.error('Load sync status failed:', err);
    });
}

// 渲染同步状态面板：方案 + 连接状态 + 仓库信息 + 同步范围说明
function renderSyncPanel(status, providers) {
    const body = document.getElementById('sync-panel-body');
    if (!body) return;
    body.innerHTML = '';

    // ---- 同步方案 ----
    const scheme = document.createElement('div');
    scheme.className = 'sync-panel-card';
    scheme.innerHTML = '<div class="sync-panel-card-title">同步方案</div>';
    const schemeRow = document.createElement('div');
    schemeRow.className = 'sync-scheme-row';
    const badge = document.createElement('span');
    badge.className = 'sync-provider-badge';
    badge.textContent = status.displayName || '未指定';
    schemeRow.appendChild(badge);
    if (providers && providers.length) {
        const hint = document.createElement('span');
        hint.className = 'sync-scheme-hint';
        hint.textContent = '更多方案即将支持';
        schemeRow.appendChild(hint);
    }
    scheme.appendChild(schemeRow);
    body.appendChild(scheme);

    // ---- 连接状态 ----
    const conn = document.createElement('div');
    conn.className = 'sync-panel-card';
    conn.innerHTML = '<div class="sync-panel-card-title">连接状态</div>';
    const statBadge = document.createElement('span');
    const f = status.fields || {};
    const authMode = f.authMode || 'none';
    let statText = '仅本地提交（未配置远程）';
    if (!status.ready) {
        statText = '仓库尚未初始化（缺少 .git）';
        statBadge.className = 'sync-stat-badge warn';
    } else if (status.configured) {
        statText = authMode === 'token' ? '已配置远程仓库（Token 认证）' : '已配置远程仓库';
        statBadge.className = 'sync-stat-badge ok';
    } else if (f.detectedRemoteUrl) {
        statText = '已检测到本地 Git 仓库（直接用本地配置）';
        statBadge.className = 'sync-stat-badge ok';
    } else {
        statText = '本地仓库已初始化，但未配置远程';
        statBadge.className = 'sync-stat-badge info';
    }
    statBadge.textContent = statText;
    conn.appendChild(statBadge);
    if (status.ready) {
        conn.appendChild(fieldRow('最近同步时间', status.lastSyncAt ? status.lastSyncAt : '暂无提交记录'));
    }
    body.appendChild(conn);

    // ---- 仓库信息（Git fields） ----
    if (f.workingDir || f.remoteUrl || f.branch || f.detectedRemoteUrl || f.localBranch) {
        const repo = document.createElement('div');
        repo.className = 'sync-panel-card';
        repo.innerHTML = '<div class="sync-panel-card-title">仓库信息</div>';
        if (f.workingDir) repo.appendChild(fieldRow('工作目录', f.workingDir));
        if (f.remoteUrl) repo.appendChild(fieldRow('远程仓库（应用内）', f.remoteUrl));
        if (f.detectedRemoteUrl) repo.appendChild(fieldRow('远程仓库（本机检测）', f.detectedRemoteUrl));
        if (f.remoteUrl && f.detectedRemoteUrl && f.remoteUrl !== f.detectedRemoteUrl) {
            // 应用内配置与本机不同：提示以应用内为准
            const warn = document.createElement('div');
            warn.className = 'sync-scope-note';
            warn.textContent = '应用内配置的远程与本机检测不同，同步以应用内配置为准。';
            repo.appendChild(warn);
        }
        if (f.branch || f.localBranch) {
            const branchLabel = f.branch ? '分支（应用内）' : '分支（本机）';
            repo.appendChild(fieldRow(branchLabel, f.branch || f.localBranch));
        }
        if (status.ready && typeof f.identityConfigured === 'boolean') {
            repo.appendChild(fieldRow('提交身份', f.identityConfigured ? '已配置' : '未配置（commit 将失败）'));
        }
        // 去掉无值的内容（字段值 &nbsp; 占位不渲染）
        body.appendChild(repo);
    }

    // ---- 同步范围说明（各存储路径） ----
    const scope = document.createElement('div');
    scope.className = 'sync-panel-card';
    scope.innerHTML = '<div class="sync-panel-card-title">同步范围说明</div>';
    const dirs = Array.isArray(f.dirs) ? f.dirs : [];
    if (dirs.length === 0) {
        scope.appendChild(emptyRow('未获取到同步目录信息。'));
    } else {
        const dirDesc = {
            'clip-storage': '剪藏数据（JSON）',
            'clip-organized': '日报总结',
            'weekly-report': '周报文件',
            'tmp': '临时文件（异常日志/草稿，程序运行产物，通常无需手动编辑）'
        };
        dirs.forEach(d => {
            const row = document.createElement('div');
            row.className = 'sync-dir-row';
            const name = document.createElement('div');
            name.className = 'sync-dir-name';
            name.textContent = (d.name || '') + (dirDesc[d.name] ? ' · ' + dirDesc[d.name] : '');
            const path = document.createElement('div');
            path.className = 'sync-dir-path';
            path.textContent = d.path || '';
            row.appendChild(name);
            row.appendChild(path);
            scope.appendChild(row);
        });
        const note = document.createElement('div');
        note.className = 'sync-scope-note';
        note.textContent = '以上目录均位于同步仓库内，点击「同步仓库」会整体提交并推送。';
        scope.appendChild(note);
    }
    body.appendChild(scope);
}

// 生成一行「标签: 值」
function fieldRow(label, value) {
    const row = document.createElement('div');
    row.className = 'sync-field-row';
    const l = document.createElement('span');
    l.className = 'sync-field-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'sync-field-value';
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    return row;
}

// 生成空态/降级提示
function emptyRow(text) {
    const d = document.createElement('div');
    d.className = 'sync-panel-empty';
    d.textContent = text;
    return d;
}

// 页面加载后预取同步状态（数据缓存，不主动弹窗）
document.addEventListener('DOMContentLoaded', () => {
    loadProviders();
    loadSyncStatusPanel();
    loadClipperSync();
    // Clipper 状态轮询 + 自动同步：确保 Obsidian Web Clipper 新写入的文件自动出现，无需手动刷新/点击
    setInterval(() => { loadClipperSync(); }, CLIPPER_POLL_INTERVAL);
});

    function loadGitConfig() {
        // 加载当前Git配置
        axios.get(`${GIT_API_BASE_URL}/config`)
            .then(response => {
                const config = response.data;
                if (config) {
                    document.getElementById('remoteUrl').value = config.remoteUrl || '';
                    document.getElementById('token').value = config.token || '';
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
            token: document.getElementById('token').value,
            branch: document.getElementById('branch').value
        };

        axios.post(`${GIT_API_BASE_URL}/config`, config)
            .then(response => {
                showNotification('Git配置保存成功');
                closeGitConfigModal();
                loadSyncStatusPanel();
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
            token: document.getElementById('token').value,
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
    const organizeBtn = document.getElementById('float-bar-organize-btn');
    const deleteBtn = document.getElementById('float-bar-delete-btn');
    const count = selectedClipIds.size;

    countNum.textContent = count;
    if (count > 0) {
        bar.classList.add('visible');
        btn.disabled = count < 2;
        if (organizeBtn) organizeBtn.disabled = false;
        if (deleteBtn) deleteBtn.disabled = false;
    } else {
        bar.classList.remove('visible');
        btn.disabled = true;
        if (organizeBtn) organizeBtn.disabled = true;
        if (deleteBtn) deleteBtn.disabled = true;
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

/** 批量整理：对选中的剪藏逐条执行 AI 整理（不弹单条 toast） */
async function batchOrganizeClips() {
    const ids = Array.from(selectedClipIds);
    if (ids.length === 0) { showToast('请先选择剪藏'); return; }
    const btn = document.getElementById('float-bar-organize-btn');
    const btnText = document.getElementById('float-bar-organize-text');
    btn.disabled = true;
    const original = btnText.textContent;
    btnText.textContent = '整理中…';
    try {
        await Promise.all(ids.map(id =>
            axios.post(`${API_BASE_URL}/organize/${id}`, { mode: 'auto' })
        ));
        const count = ids.length;
        clearAllSelection();
        if (typeof fetchClips === 'function') fetchClips();
        showToast(`已批量整理 ${count} 条，归入已整理`);
    } catch (error) {
        console.error('批量整理失败:', error);
        showToast('批量整理失败，请稍后重试');
    } finally {
        btn.disabled = false;
        btnText.textContent = original;
    }
}

/** 批量删除：逐条删除选中的剪藏，支持单次撤销恢复 */
async function batchDeleteClips() {
    const ids = Array.from(selectedClipIds);
    if (ids.length === 0) { showToast('请先选择剪藏'); return; }
    // 删除前缓存数据用于撤销
    const clips = ids.map(id => clipCache.get(String(id))).filter(Boolean);
    const btn = document.getElementById('float-bar-delete-btn');
    const btnText = document.getElementById('float-bar-delete-text');
    btn.disabled = true;
    const original = btnText.textContent;
    btnText.textContent = '删除中…';
    try {
        await Promise.all(ids.map(id => axios.delete(`${API_BASE_URL}/${id}`)));
        const count = ids.length;
        // 写入墓碑（避免本地索引残留导致删除后闪回）
        ids.forEach(id => softDeletedIds.add(String(id)));
        clearAllSelection();
        // 逐条淡出后再全量刷新，删除即时可见且动画连续
        ids.forEach(id => {
            const anchor = document.getElementById('check-area-' + id);
            const item = anchor ? anchor.closest('.clip-item') : null;
            if (item) item.classList.add('clip-item-removing');
        });
        setTimeout(() => { if (typeof fetchClips === 'function') fetchClips(); }, 240);
        if (clips.length > 0 && typeof showActionToast === 'function') {
            showActionToast(`已删除 ${count} 条`, '撤销', function () {
                Promise.all(clips.map(c => {
                    if (typeof undoDeleteClip === 'function') return undoDeleteClip(c);
                    return Promise.resolve();
                })).then(() => {
                    if (typeof fetchClips === 'function') fetchClips();
                });
            });
        } else {
            showToast(`已删除 ${count} 条`);
        }
    } catch (error) {
        console.error('批量删除失败:', error);
        showToast('批量删除失败，请稍后重试');
    } finally {
        btn.disabled = false;
        btnText.textContent = original;
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
  t.style.cssText = 'position:fixed;top:20px;right:20px;background:var(--card);color:var(--fg);padding:10px 20px;border-radius:10px;border:1px solid var(--border);z-index:9999;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,0.15);animation:slideIn var(--app-duration-slow) var(--app-ease-smooth);';
  document.body.appendChild(t);
  setTimeout(() => { t.style.animation = 'slideOut var(--app-duration-slow) var(--app-ease-smooth) forwards'; setTimeout(() => t.remove(), 300); }, 2000);
}

// ====== 关联数据批量缓存（N+1 → 每页 2 个批量请求）======
var linkedKnowledgeCache = new Map(); // clipId(String) -> knowledgeList
var planBacklinksCache = new Map();   // clipId(String) -> plans

async function batchLoadClipRelations(clipIds) {
    const ids = [...new Set((clipIds || []).filter(id => id != null).map(String))];
    if (ids.length === 0) return;
    const missingLinked = ids.filter(id => !linkedKnowledgeCache.has(id));
    const missingPlans = ids.filter(id => !planBacklinksCache.has(id));
    if (missingLinked.length > 0) {
        try {
            const res = await axios.get(`${KNOWLEDGE_API_BASE_URL}/by-clips`,
                { params: { clipIds: missingLinked.join(',') } });
            Object.entries(res.data || {}).forEach(([id, list]) =>
                linkedKnowledgeCache.set(String(id), list || []));
        } catch (e) { console.error('批量获取关联知识失败:', e); }
    }
    if (missingPlans.length > 0) {
        try {
            const res = await axios.get(`${API_ROOT}/learning-plan/by-clips`,
                { params: { clipIds: missingPlans.join(',') } });
            Object.entries(res.data || {}).forEach(([id, list]) =>
                planBacklinksCache.set(String(id), list || []));
        } catch (e) { console.error('批量获取学习计划反链失败:', e); }
    }
}

// ====== 已关联知识 ======
async function renderLinkedKnowledge(clipId) {
    const listEl = document.getElementById(`linkedKnowledgeList-${clipId}`);
    const noDataEl = document.getElementById(`noLinkedKnowledge-${clipId}`);
    if (!listEl || !noDataEl) return;

    // 先读缓存，未命中才单条请求并回填缓存（批量预取失败时兜底）
    const key = String(clipId);
    let knowledgeList = null;
    if (linkedKnowledgeCache.has(key)) {
        knowledgeList = linkedKnowledgeCache.get(key);
    } else {
        try {
            const response = await axios.get(`${KNOWLEDGE_API_BASE_URL}/by-clip/${clipId}`);
            knowledgeList = response.data || [];
            linkedKnowledgeCache.set(key, knowledgeList);
        } catch (error) {
            console.error('获取已关联知识失败:', error);
            listEl.style.display = 'none';
            noDataEl.style.display = 'block';
            const btn = noDataEl.querySelector('.create-knowledge-action');
            if (btn) {
                btn.classList.remove('loading');
                btn.innerHTML = '创建知识条目';
            }
            return;
        }
    }

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
}

// ====== 被学习计划引用（剪藏反链）=======
async function renderPlanBacklinks(clipId) {
    const section = document.getElementById(`planBacklinksSection-${clipId}`);
    const listEl = document.getElementById(`planBacklinksList-${clipId}`);
    if (!section || !listEl) return;

    // 先读缓存，未命中才单条请求并回填缓存（批量预取失败时兜底）
    const key = String(clipId);
    let plans = null;
    if (planBacklinksCache.has(key)) {
        plans = planBacklinksCache.get(key);
    } else {
        try {
            const response = await axios.get(`${API_ROOT}/learning-plan/by-clip/${clipId}`);
            plans = response.data || [];
            planBacklinksCache.set(key, plans);
        } catch (e) {
            console.error('获取学习计划引用失败:', e);
            section.style.display = 'none';
            return;
        }
    }

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
        // 失效该剪藏的关联知识缓存，下次回列表展示最新角标
        linkedKnowledgeCache.delete(String(clipId));

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
