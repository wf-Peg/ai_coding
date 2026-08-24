// ============================================================
// CutShelter clip 页面模块: clip-list
// 由 clip.html 内联脚本按功能拆分生成（经典 script 顺序加载）
// ============================================================

    function clearSearch() {
        document.getElementById('search-query').value = '';
        document.getElementById('search-category').value = '';
    }

    function backToList() {
        clearAllSelection();
        document.getElementById('search-results-page').style.display = 'none';
        document.getElementById('clip-list').style.display = 'block';
    }


    function toggleMode() {
        clearAllSelection();
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

    async function performSearch() {
        const query = document.getElementById('search-query').value;
        const category = document.getElementById('search-category').value;

        if (!query) {
            return;
        }

        try {
            // 走统一 API 契约层：优先本地索引 IPC，回退后端 REST
            const results = await window.apiClient.search(query, { category, topK: 10 });
            displaySearchResults(results);
        } catch (error) {
            console.error('搜索失败:', error);
            showToast('搜索失败，请稍后重试');
        }
    }

    document.getElementById('search-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const query = document.getElementById('search-query').value;
        if (!query) {
            showToast('请输入搜索关键词');
            return;
        }
        performSearch();
    });

    // 输入防抖搜索：停止输入 300ms 后自动搜索（清空时不触发）
    document.getElementById('search-query').addEventListener('input', () => {
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        const q = document.getElementById('search-query').value.trim();
        if (!q) return;
        searchDebounceTimer = setTimeout(performSearch, 300);
    });

    function displaySearchResults(results) {
        clipCache.clear();
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
                if (clip && clip.id != null) {
                    clipCache.set(String(clip.id), clip);
                }
                const clipItem = createClipItem(clip, true);
                searchResultsContainer.appendChild(clipItem);
            });
        }

        document.getElementById('search-results-page').style.display = 'block';
        document.getElementById('clip-list').style.display = 'none';
    }

    // 列表客户端分页与 pending 轮询状态

    async function fetchClips() {
        const seq = ++fetchSeq; // 本请求序号，用于丢弃过期请求结果
        // 清理待执行的分析轮询，避免请求堆积
        if (pendingPollTimer) {
            clearTimeout(pendingPollTimer);
            pendingPollTimer = null;
        }
        const clipItemsContainer = document.getElementById('clip-items');
        try {
            // 首次/无内容时展示骨架屏（轮询刷新时已有内容则不闪屏）
            if (!clipItemsContainer.querySelector('.clip-item')) {
                showSkeleton(clipItemsContainer);
            }

            // 重置选中状态
            selectedClipIds.clear();
            updateFloatBar();

            const workflowFilter = document.getElementById('workflow-filter');
            const workflowStatus = workflowFilter ? workflowFilter.value : '';
            let url = `${API_BASE_URL}/list`;
            const params = new URLSearchParams();
            const wsId = localStorage.getItem('active_workspace_id');
            if (wsId) {
                params.set('workspaceId', wsId);
            }
            const paramsStr = params.toString();
            if (paramsStr) url += '?' + paramsStr;
            const response = await axios.get(url);
            if (seq !== fetchSeq) return; // 已有更新的请求，丢弃本次过期结果
            let clips = response.data;

            if (workflowStatus) {
                clips = clips.filter(clip => resolveWorkflowStatus(clip) === workflowStatus);
            }

            // 过滤掉待办事项数据（后端已按目录排除 todoList 等，此处为防御）
            const filteredClips = clips.filter(clip => {
                // 待办：type 为 todo
                if (clip.type === 'todo') return false;
                // 空壳记录：无正文/摘要/分析（如历史待办备份解析残留），避免显示"暂无摘要"空条目
                if (!clip.content && !clip.summary && !clip.bodyContent && !clip.analysis) return false;
                return true;
            });

            filteredClips.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            renderClipList(filteredClips);
        } catch (error) {
            if (seq !== fetchSeq) return; // 过期请求的失败也忽略
            console.error('获取剪藏列表失败:', error);
            document.getElementById('clip-items').innerHTML = `
                    <div class="empty-state">
                        <h3>获取剪藏列表失败</h3>
                        <p>请检查后端服务是否正常运行</p>
                    </div>
                `;
        }
    }

    // ===== 列表渲染（客户端分页 + 展开恢复 + pending 自动轮询）=====

    /** 加载骨架屏占位 */
    function showSkeleton(container) {
        if (!container) return;
        let skeleton = '';
        for (let i = 0; i < 5; i++) {
            skeleton += `
                <div class="skeleton-card">
                    <div class="skeleton-line short"></div>
                    <div class="skeleton-line mid"></div>
                    <div class="skeleton-line" style="width: 90%;"></div>
                </div>`;
        }
        container.innerHTML = skeleton;
    }

    /** 渲染剪藏列表（按可见数量分页 + 加载更多 + 展开状态恢复 + pending 轮询） */
    function renderClipList(clips) {
        lastFilteredClips = clips;
        const clipItemsContainer = document.getElementById('clip-items');
        const clipCountElement = document.getElementById('clip-count');
        clipCache.clear();

        // 保存当前展开的剪藏 ID，重建后恢复
        const expandedIds = new Set();
        document.querySelectorAll('.clip-detail.expanded').forEach(detail => {
          const cid = detail.dataset.clipId;
          if (cid) expandedIds.add(cid);
        });

        clipCountElement.textContent = clips.length;
        clipItemsContainer.innerHTML = '';

        if (clips.length === 0) {
            clipItemsContainer.innerHTML = `
                    <div class="empty-state">
                        <h3>暂无剪藏内容</h3>
                        <p>开始添加你的第一个剪藏吧！</p>
                    </div>
                `;
            return;
        }

        const shown = clips.slice(0, visibleClipCount);
        shown.forEach(clip => {
            if (clip && clip.id != null) {
                clipCache.set(String(clip.id), clip);
            }
            const clipItem = createClipItem(clip, false);
            clipItemsContainer.appendChild(clipItem);
            renderLinkedKnowledge(clip.id);
            renderPlanBacklinks(clip.id);
        });

        // 加载更多（客户端分页，保留现有筛选/排序逻辑）
        if (clips.length > visibleClipCount) {
            const loadMoreBtn = document.createElement('button');
            loadMoreBtn.className = 'btn-secondary load-more-btn';
            loadMoreBtn.textContent = `加载更多（剩余 ${clips.length - visibleClipCount} 条）`;
            loadMoreBtn.addEventListener('click', () => {
                visibleClipCount += CLIP_PAGE_SIZE;
                renderClipList(lastFilteredClips);
            });
            clipItemsContainer.appendChild(loadMoreBtn);
        }

        // 恢复之前展开的剪藏详情
        expandedIds.forEach(id => {
          const detail = document.querySelector(`.clip-detail[data-clip-id="${id}"]`);
          if (detail) {
            detail.classList.add('expanded');
            const btn = detail.closest('.clip-item')?.querySelector(`.expand-btn[data-clip-id="${id}"]`);
            if (btn) {
              btn.classList.add('expanded');
              const text = btn.querySelector('.text');
              if (text) text.textContent = '收起';
            }
            renderLinkedKnowledge(parseInt(id));
            renderPlanBacklinks(parseInt(id));
          }
        });

        // 存在 pending 剪藏 → 2.5s 后自动轮询刷新（异步 AI 分析完成自动出现）
        if (clips.some(c => c.analysisStatus === 'pending')) {
            schedulePendingPoll();
        }
    }

    /** 调度 pending 剪藏的自动轮询（防堆积） */
    function schedulePendingPoll() {
        if (pendingPollTimer) return;
        pendingPollTimer = setTimeout(() => {
            pendingPollTimer = null;
            fetchClips();
        }, 2500);
    }

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

    function createClipItem(clip, isSearch) {
        const clipItem = document.createElement('div');
        clipItem.className = 'clip-item';
        const normalizedWorkflow = resolveWorkflowStatus(clip);

        const createdAt = new Date(clip.createdAt).toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });

        const categoryLabel = normalizedWorkflow === 'inbox'
            ? '收件箱（待整理）'
            : (clip.category ? getCategoryLabel(clip.category) : '未分类');

        let tagsHtml = '';
        if (clip.tags && clip.tags.length > 0) {
            const displayTags = clip.tags.slice(0, 3);
            const remainingTags = clip.tags.slice(3);

            // 标签渲染统一转义，防止用户输入的标签注入 HTML
            const renderTag = tag => `<span class="tag-display-item"><span class="tag"><span>${escapeHtml(tag)}</span></span></span>`;

            tagsHtml = `
                    <div class="tags-display" style="margin-top: 12px;">
                        <div class="tags-collapsed">
                            ${displayTags.map(renderTag).join('')}
                            ${remainingTags.length > 0 ? `<button class="tag-expand-btn" onclick="toggleTags(this)">+${remainingTags.length}</button>` : ''}
                        </div>
                        ${remainingTags.length > 0 ? `<div class="tags-all" style="display: none;">${clip.tags.map(renderTag).join('')}</div>` : ''}
                    </div>
                `;
        }

        const displaySummary = clip.summary || '暂无摘要';
        const isStoreOnly = clip.type === 'store-only';
        const summaryClass = isStoreOnly ? 'store-only-summary' : '';
        const originalContent = clip.bodyContent || clip.content || '';
        const analysisContent = clip.analysis || '';
        const analysisState = getAnalysisState(clip);
        const fanButtons = [
            buildFanActionButton('edit-in-editor', clip.id, '在编辑器打开原文', renderFanActionIcon('editInEditor')),
            buildFanActionButton('organize-auto', clip.id, '快速AI整理', renderFanActionIcon('organizeAuto')),
            buildFanActionButton('organize-manual', clip.id, '编辑', renderFanActionIcon('organizeManual')),
            buildFanActionButton('to-todo', clip.id, '转待办', renderFanActionIcon('toTodo')),
            buildFanActionButton('dispatch', clip.id, '投递到AI', renderFanActionIcon('dispatch')),
            buildFanActionButton('export', clip.id, '导出', renderFanActionIcon('export')),
        ];
        if (!isStoreOnly) {
            fanButtons.push(buildFanActionButton('divergent', clip.id, '发散性总结', renderFanActionIcon('divergent')));
        }
        if (!isSearch) {
            fanButtons.push(buildFanActionButton('delete', clip.id, '删除', renderFanActionIcon('delete')));
        }

        clipItem.innerHTML = `
                <div class="clip-header">
                    <div class="clip-header-left">
                        <div class="check-area" id="check-area-${clip.id}">
                            <input type="checkbox" class="clip-checkbox" id="check-${clip.id}" data-clip-id="${clip.id}">
                            <label for="check-${clip.id}" class="check-visual" title="选择用于合成知识"></label>
                        </div>
                        ${getSourceBadge(clip.source)}
                        <span class="category-badge">📁 ${categoryLabel}</span>
                        ${clip.myThoughts ? '<span class="category-badge thoughts-badge">💭 有思考</span>' : ''}
                        <span class="category-badge knowledge-badge" id="knowledge-badge-${clip.id}" style="display:none;"></span>
                    </div>
                    <div class="clip-actions">
                        <div class="more-actions-wrapper">
                            <button class="expand-btn" onclick="toggleMoreActions(this, event)" title="更多功能">
                                <span class="text">更多功能</span>
                                <span class="icon">▼</span>
                            </button>
                            <div class="fan-drawer">
                                ${fanButtons.join('')}
                            </div>
                        </div>
                        <button class="expand-btn" onclick="toggleDetail(this)" data-clip-id="${clip.id}">
                            <span class="icon">▼</span>
                            <span class="text">展开</span>
                        </button>
                    </div>
                </div>
                ${clip.imagePaths && clip.imagePaths.length > 0 ? '<div class="clip-thumb-row"><img class="clip-thumb" src="' + window.MediaKit.render.mediaUrl(clip.imagePaths[0]) + '?thumb=1" alt="缩略图" loading="lazy"></div>' : ''}
                <div class="clip-summary ${summaryClass}" title="${escapeHtml(displaySummary)}">${escapeHtml(displaySummary)}</div>
                <div class="clip-meta">
                    <span class="meta-item meta-type">类型: ${getTypeLabel(clip.type)}</span>
                    <span class="meta-item">流程: ${getWorkflowStatusLabel(normalizedWorkflow)}</span>
                    <span class="meta-item">分类: ${clip.category ? getCategoryLabel(clip.category) : '未分类'}</span>
                    <span class="meta-item">来源: ${clip.source}</span>
                    <span class="meta-item">创建时间: ${createdAt}</span>
                </div>
                ${tagsHtml}
                <div class="clip-detail" data-clip-id="${clip.id}">
                    <div class="content-section">
                        <h4>原文</h4>
                        <div class="content-text truncated">${renderContent(originalContent, clip.id)}</div>
                        <button class="copy-btn" onclick="copyToClipboard('${escapeJs(originalContent)}')">
                            📋 复制原文
                        </button>
                        <button class="copy-btn" onclick="copyToEditor('${escapeJs(originalContent)}', ${clip.id})" title="复制内容到剪贴板并在编辑器中打开">
                            📋 复制到编辑区打开
                        </button>
                    ${clip.sourceUrl ? `
                    <div class="source-link" style="margin-top: 8px; display:flex; flex-direction:column; gap:4px;">
                        <span style="font-size:0.78rem;color:var(--text-secondary);word-break:break-all;">
                            来源: <a href="${escapeHtml(clip.sourceUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);">${escapeHtml(clip.sourceUrl)}</a>
                        </span>
                    </div>
                    ` : ''}
                    ${clip.sourceFilePath ? `
                    <div class="source-file" style="font-size:0.82rem;color:var(--text-secondary);margin-top:4px;display:flex;align-items:center;gap:4px;padding:2px 0;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        <span class="wiki-link" onclick="openClipInEditorNewTab('${clip.id}', '${escapeJs(clip.sourceFilePath)}')" title="在编辑器中打开 Clipper 文档" style="cursor:pointer;color:var(--primary);text-decoration:underline;">${renderWikiLink(clip.content, clip.id, clip.sourceFilePath)}</span>
                    </div>
                    ` : ''}
                    </div>
                    ${clip.myThoughts ? `
                    <div class="content-section" style="border-left: 3px solid #a855f7; background: linear-gradient(135deg, rgba(168,85,247,0.04), transparent);">
                        <h4 style="color: #a855f7;">💭 我的思考</h4>
                        <div class="content-text truncated">${escapeHtml(clip.myThoughts)}</div>
                        <button class="copy-btn" onclick="copyToClipboard('${escapeJs(clip.myThoughts)}')" style="background: rgba(168,85,247,0.1); color: #a855f7;">
                            📋 复制思考
                        </button>
                    </div>
                    ` : ''}
                    ${!isStoreOnly ? `
                    ${analysisState === 'ready' ? `
                    <div class="content-section">
                        <h4>AI分析</h4>
                        <div class="markdown-content" id="analysis-content-${clip.id}"></div>
                        <button class="btn-secondary" style="margin-top: 12px;" onclick="generateDivergentSummary(${clip.id})">
                            🔄 发散性总结
                        </button>
                    </div>
                    ` : analysisState === 'pending' ? `
                    <div class="content-section">
                        <h4>AI分析</h4>
                        <div class="ai-analysis-empty-state">
                            <div class="analysis-pending-spinner"></div>
                            <p class="empty-state-title">AI 分析中...</p>
                            <p class="empty-state-desc">正在提炼摘要、关键信息和标签，页面将自动刷新</p>
                        </div>
                    </div>
                    ` : analysisState === 'failed' ? `
                    <div class="content-section">
                        <h4>AI分析</h4>
                        <div class="ai-analysis-empty-state">
                            <svg class="empty-state-icon" viewBox="0 0 80 80" fill="none" style="opacity:0.5;">
                                <circle cx="40" cy="40" r="28" stroke="currentColor" stroke-width="1.5" opacity="0.2"/>
                                <path d="M36 36l8 8M44 36l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.35"/>
                                <circle cx="40" cy="40" r="24" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.15"/>
                            </svg>
                            <p class="empty-state-title" style="color: var(--error);">AI 分析失败</p>
                            <p class="empty-state-desc">未能成功生成摘要，可能是内容格式不支持或服务暂时不可用</p>
                            <button class="generate-analysis-action generate-analysis-btn" data-clip-id="${clip.id}">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M1 4v6h6M23 20v-6h-6"/>
                                    <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/>
                                </svg>
                                重新生成
                            </button>
                        </div>
                    </div>
                    ` : `
                    <div class="content-section">
                        <h4>AI分析</h4>
                        <div class="ai-analysis-empty-state">
                            <svg class="empty-state-icon" viewBox="0 0 80 80" fill="none">
                                <circle cx="40" cy="40" r="28" stroke="currentColor" stroke-width="1.5" opacity="0.2"/>
                                <path d="M28 48V32l8-4 8 4 8-4 8 4v16" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.15"/>
                                <path d="M28 48V32l8-4 8 4 8-4 8 4v16" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.3"/>
                                <circle cx="32" cy="36" r="2" fill="currentColor" opacity="0.2"/>
                                <circle cx="40" cy="36" r="2" fill="currentColor" opacity="0.2"/>
                                <circle cx="48" cy="36" r="2" fill="currentColor" opacity="0.2"/>
                                <circle cx="32" cy="42" r="2" fill="currentColor" opacity="0.2"/>
                                <circle cx="40" cy="42" r="2" fill="currentColor" opacity="0.2"/>
                                <circle cx="48" cy="42" r="2" fill="currentColor" opacity="0.2"/>
                                <path d="M52 32l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.2"/>
                                <path d="M56 48v-8l-4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.2"/>
                            </svg>
                            <p class="empty-state-title">暂无 AI 分析</p>
                            <p class="empty-state-desc">AI 将自动提炼摘要、关键信息和标签，帮助快速理解内容</p>
                            <button class="generate-analysis-action generate-analysis-btn" data-clip-id="${clip.id}">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M12 2l2.4 7.2h7.6l-6 4.8 2.4 7.2-6.4-4.8-6.4 4.8 2.4-7.2-6-4.8h7.6z"/>
                                </svg>
                                生成分析
                            </button>
                        </div>
                    </div>
                    `}
                    ${clip.divergentSummary ? `
                    <div class="content-section" id="divergent-summary-${clip.id}" style="display: block;">
                        <h4>发散性总结</h4>
                        <div class="divergent-content markdown-content" id="divergent-content-${clip.id}">
                            <p>加载中...</p>
                        </div>
                        <button class="copy-btn" onclick="copyToClipboard(document.getElementById('divergent-content-${clip.id}').textContent)">
                            📋 复制总结
                        </button>
                    </div>
                    ` : `
                    <div class="content-section" id="divergent-summary-${clip.id}" style="display: none;">
                        <h4>发散性总结</h4>
                        <div class="divergent-content markdown-content" id="divergent-content-${clip.id}">
                        </div>
                        <button class="copy-btn" onclick="copyToClipboard(document.getElementById('divergent-content-${clip.id}').textContent)" style="display:none;">
                            📋 复制总结
                        </button>
                    </div>
                    `}
                    ` : ''}
                    <div class="content-section" id="dispatch-section-${clip.id}" style="display: none;">
                        <h4>📤 投递到 AI<span class="dispatch-model-info" id="dispatch-model-${clip.id}"></span></h4>
                        <div class="dispatch-targets" id="dispatch-targets-${clip.id}">
                            <p style="color: var(--text-secondary);">投递目标加载中...</p>
                        </div>
                        <div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
                            <button class="btn-secondary" onclick="dispatchRun(${clip.id})">🚀 投递所选</button>
                            <button class="btn-secondary" onclick="dispatchDistill(${clip.id})">🧪 蒸馏总结</button>
                            <span style="flex: 1;"></span>
                            <button class="btn-secondary" onclick="exportClipById(${clip.id}, 'md')">导出 MD</button>
                            <button class="btn-secondary" onclick="exportClipById(${clip.id}, 'txt')">TXT</button>
                            <button class="btn-secondary" onclick="exportClipById(${clip.id}, 'html')">HTML</button>
                        </div>
                        ${clip.lastDispatchTarget ? `<div style="margin-top: 8px; font-size: 0.85rem; color: var(--text-secondary);">上次投递: ${escapeHtml(clip.lastDispatchTarget)} @ ${escapeHtml(clip.lastDispatchAt || '')}</div>` : ''}
                        <div id="dispatch-results-${clip.id}" style="margin-top: 10px;"></div>
                    </div>
                    <div class="linked-knowledge-section" id="linkedKnowledgeSection-${clip.id}">
                        <h4>已关联知识</h4>
                        <div id="linkedKnowledgeList-${clip.id}">
                            <!-- Dynamically populated by JS -->
                        </div>
                        <div id="noLinkedKnowledge-${clip.id}" style="display:none;">
                            <div class="empty-knowledge-state">
                                <svg class="empty-state-icon" viewBox="0 0 80 80" fill="none">
                                    <circle cx="40" cy="40" r="28" stroke="currentColor" stroke-width="1.5" opacity="0.2"/>
                                    <path d="M32 35h16M32 40h12M32 45h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.35"/>
                                    <path d="M40 28l-12 8v16h24V36l-12-8z" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.15"/>
                                    <path d="M40 28l-12 8v8l12-8 12 8v-8l-12-8z" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.3"/>
                                    <circle cx="52" cy="32" r="4" fill="currentColor" opacity="0.12"/>
                                    <path d="M40 44v10M35 54h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.2"/>
                                </svg>
                                <p class="empty-state-title">暂无关联知识</p>
                                <p class="empty-state-desc">将这条剪藏的内容提炼为知识条目，构建你的知识体系</p>
                                <button class="create-knowledge-action" onclick="createKnowledgeFromClip(event, ${clip.id})">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M12 5v14M5 12h14"/>
                                    </svg>
                                    创建知识条目
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="linked-knowledge-section" id="planBacklinksSection-${clip.id}">
                        <h4>被学习计划引用</h4>
                        <div id="planBacklinksList-${clip.id}"></div>
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

                    console.log('清理后的内容:', cleanContent);

                    const renderedHtml = window.MediaKit.render.renderMarkdown(cleanContent);
                    analysisContentDiv.innerHTML = renderedHtml;
                } catch (e) {
                    console.error('Markdown渲染失败:', e);
                    analysisContentDiv.textContent = analysisContent;
                }
            }
        }

        // 渲染已有 divergentSummary 内容
        if (clip.divergentSummary) {
            const dsContent = clipItem.querySelector(`#divergent-content-${clip.id}`);
            if (dsContent) {
                try {
                    dsContent.innerHTML = window.MediaKit.render.renderMarkdown(clip.divergentSummary);
                } catch (e) {
                    dsContent.textContent = clip.divergentSummary;
                }
            }
        }

        return clipItem;
    }

    // 剪藏分析空态/失败态 - 生成/重新生成分析按钮事件委托
    document.addEventListener('click', function(e) {
        const btn = e.target.closest('.generate-analysis-btn');
        if (btn) {
            quickOrganizeClip(parseInt(btn.dataset.clipId));
        }
    });

    function toggleDetail(btn) {
        closeAllMoreActions();
        const clipItem = btn.closest('.clip-item');
        const detail = clipItem.querySelector('.clip-detail');
        const icon = btn.querySelector('.icon');
        const text = btn.querySelector('.text');

        detail.classList.toggle('expanded');
        btn.classList.toggle('expanded');

        // 展开/收起时同步切换原文截断
        const contentTexts = detail.querySelectorAll('.content-text.truncated');
        if (detail.classList.contains('expanded')) {
            text.textContent = '收起';
            contentTexts.forEach(el => el.classList.remove('truncated'));
            const clipId = detail.dataset.clipId;
            if (clipId) {
                renderLinkedKnowledge(parseInt(clipId));
                renderPlanBacklinks(parseInt(clipId));
            }
        } else {
            text.textContent = '展开';
            contentTexts.forEach(el => el.classList.add('truncated'));
        }
    }

    function closeAllMoreActions() {
        document.querySelectorAll('.fan-drawer.open').forEach(drawer => {
            drawer.classList.remove('open');
            const trigger = drawer.closest('.more-actions-wrapper')?.querySelector('.expand-btn');
            if (trigger) {
                trigger.classList.remove('expanded');
            }
        });
    }

    function toggleMoreActions(btn, event) {
        event.stopPropagation();
        const wrapper = btn.closest('.more-actions-wrapper');
        const drawer = wrapper?.querySelector('.fan-drawer');
        if (!drawer) {
            return;
        }
        const shouldOpen = !drawer.classList.contains('open');
        closeAllMoreActions();
        if (shouldOpen) {
            drawer.classList.add('open');
            btn.classList.add('expanded');
        } else {
            drawer.classList.remove('open');
            btn.classList.remove('expanded');
        }
    }

    function buildFanActionButton(action, clipId, label, iconSvg) {
        return `<button class="fan-action-btn" title="${label}" aria-label="${label}" onclick="handleMoreAction(event, '${action}', ${clipId})">${iconSvg}<span class="fan-label">${label}</span></button>`;
    }

    function renderFanActionIcon(type) {
        switch (type) {
            case 'editInEditor':
                return '<svg class="fan-icon" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>';
            case 'organizeAuto':
                return '<svg class="fan-icon" viewBox="0 0 24 24"><path d="M12 3l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.3-4.5 2.3.9-5L4.8 8.3l5-.7L12 3z"/></svg>';
            case 'organizeManual':
                return '<svg class="fan-icon" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
            case 'toTodo':
                return '<svg class="fan-icon" viewBox="0 0 24 24"><path d="M9 11l2 2 4-4"/><rect x="3" y="4" width="18" height="16" rx="2"/></svg>';
            case 'divergent':
                return '<svg class="fan-icon" viewBox="0 0 24 24"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2v2"/><path d="M5 9H3"/><path d="M21 9h-2"/><path d="M6.3 4.3 7.7 5.7"/><path d="M17.7 5.7 19.1 4.3"/><path d="M8 14h8"/></svg>';
            case 'dispatch':
                return '<svg class="fan-icon" viewBox="0 0 24 24"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>';
            case 'export':
                return '<svg class="fan-icon" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
            case 'delete':
                return '<svg class="fan-icon" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>';
            default:
                return '<svg class="fan-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>';
        }
    }

    function handleMoreAction(event, action, clipId) {
        event.stopPropagation();
        closeAllMoreActions();
        const label = getMoreActionLabel(action);
        if (action === 'organize-manual' || action === 'edit-in-editor' || action === 'dispatch' || action === 'export') {
            performMoreAction(action, clipId)
        } else {
            showActionConfirm(`确定执行「${label}」吗？`, () => performMoreAction(action, clipId));
        }
    }

    function performMoreAction(action, clipId) {
        switch (action) {
            case 'edit-in-editor':
                window.parent.postMessage({ type: 'openClipInEditor', clipId }, '*');
                break;
            case 'organize-auto':
                quickOrganizeClip(clipId);
                break;
            case 'organize-manual':
                openOrganizeActionModal('clip', clipId, 'manual');
                break;
            case 'to-todo':
                quickClipToTodo(clipId);
                break;
            case 'divergent':
                generateDivergentSummary(clipId);
                break;
            case 'dispatch':
                toggleDispatchPanel(clipId);
                break;
            case 'export':
                exportClipById(clipId, 'md');
                break;
            case 'delete':
                deleteClip(clipId);
                break;
            default:
                break;
        }
    }

    function getMoreActionLabel(action) {
        switch (action) {
            case 'edit-in-editor':
                return '在编辑器打开原文';
            case 'organize-auto':
                return '快速整理';
            case 'organize-manual':
                return '编辑';
            case 'to-todo':
                return '转待办';
            case 'divergent':
                return '发散性总结';
            case 'dispatch':
                return '投递到 AI';
            case 'export':
                return '导出';
            case 'delete':
                return '删除';
            default:
                return '该操作';
        }
    }

    // ==================== 内容分发（MVP）：投递 / 蒸馏 / 导出 ====================

    /** 投递目标缓存（全局一次加载） */
    let dispatchTargetsCache = null;
    let dispatchModelInfo = {};

    /** 构造 /api/dispatch 前缀（与 API_ROOT 对齐） */
    function dispatchApiBase() {
        return API_ROOT + '/dispatch';
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
            return '<p style="color: var(--text-secondary);">投递目标加载中...</p>';
        }
        return dispatchTargetsCache.map(t => `
            <label style="display: block; margin: 4px 0; cursor: pointer; font-size: 0.9rem;">
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
                const btn = detail.closest('.clip-item')?.querySelector('.expand-btn[data-clip-id]');
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

    /** 按 id 从 clipCache 取剪藏对象（列表/搜索渲染时均已填充） */
    function getCachedClip(clipId) {
        return clipCache.get(String(clipId));
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
        const body = clip.bodyContent || clip.content || '';
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
