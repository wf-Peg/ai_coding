// ============================================================
// CutShelter clip 页面模块: clip-shared（共享状态/主题/图片/初始化）
// 由 clip.html 内联脚本按功能拆分生成（经典 script 顺序加载）
// ============================================================


// ── 共享状态（原顶层 const/let 转 var，跨文件全局可见）──
    var API_BASE_URL = 'http://127.0.0.1:8081/api/clip';
    var API_ROOT = 'http://127.0.0.1:8081/api';
    var KNOWLEDGE_API_BASE_URL = 'http://127.0.0.1:8081/api/knowledge';
    var GIT_API_BASE_URL = 'http://127.0.0.1:8081/api/git';
    var SYNC_API_BASE_URL = 'http://127.0.0.1:8081/api/sync';
    var fetchSeq = 0;
    var currentTags = [];
    var MAX_TAGS = 10;
    var THEME_STORAGE_KEY = 'app_theme_v1';
    var APPEARANCE_KEY = 'app_appearance_v1';
    var DEFAULT_THEME = 'notion';
    var DEFAULT_CLIP_ANALYZE_PROMPT =
        '你是一个专业的内容分析助手。请对输入内容生成高质量摘要、分析和标签。\n' +
        '输出应准确、简洁、结构化，避免空话和重复。\n' +
        'analysis 字段使用 Markdown 格式，重点提炼关键结论与可执行洞见。';
    var currentPromptType = 'daily';
    var promptConfigCache = null;
    var feedbackPathValue = '';
    var currentTheme = DEFAULT_THEME;
    var currentOrganizeTarget = { scope: 'inbox', clipId: null };
    var clipCache = new Map();
    var uploadedFileBase64 = null;
    var uploadedFileName = null;
    var uploadedImages = [];   // {localId, name, status, progress, path, url, dataUrl, file, error}
    var imageLocalId = 0;
    var contentPreviewActive = false;
    var TYPE_LABELS = {
        'store-only': '纯文本存储',
        'ai-text': 'AI文本整理',
        'link-ai': '链接解析',
        'doc-ai': '文档解析',
        'text': '文本', 'image': '图片', 'file': '文件', 'link': '链接'
    };
    var dropzone = document.getElementById('file-dropzone');
    var fileInput = document.getElementById('file-input');
    var CATEGORY_LABELS = {
        'inbox': '收件箱',
        'work': '工作项目', 'work-company': '工作项目 > 公司事务', 'work-side': '工作项目 > 个人副业',
        'study': '学习成长', 'study-course': '学习成长 > 课程学习', 'study-book': '学习成长 > 读书笔记',
        'life': '生活健康', 'life-daily': '生活健康 > 日常记录', 'life-health': '生活健康 > 健康运动',
        'hobby': '兴趣探索', 'hobby-tech': '兴趣探索 > 技术探索', 'hobby-idea': '兴趣探索 > 创意灵感',
        'finance': '财务规划', 'finance-invest': '财务规划 > 投资理财', 'finance-spend': '财务规划 > 消费记录',
        'social': '人脉社交', 'social-contact': '人脉社交 > 人脉管理', 'social-event': '人脉社交 > 社交活动',
        'default': '默认', 'tech': '技术', 'entertainment': '娱乐', 'health': '健康'
    };
    var currentMode = 'add-clip';
    var searchDebounceTimer = null;
    var CLIP_PAGE_SIZE = 50;
    var visibleClipCount = CLIP_PAGE_SIZE;
    var lastFilteredClips = [];
    var pendingPollTimer = null;
    var confirmActionCallback = null;
    var PROMPT_TYPE_META = {
        'clip': {
            title: '添加剪藏 AI Prompt 配置',
            desc: '编辑剪藏分析时的 AI 角色定义（Role + Goal + Constraints）',
            hint: '角色定义部分，不含任务格式。任务格式（JSON格式要求、分类树）在「clipAnalyzeTaskFormat」中配置。',
            field: 'clipAnalyzeSystemPrompt'
        },
        'clipTaskFormat': {
            title: '剪藏分析任务格式配置',
            desc: '编辑任务描述、JSON 输出格式、分类树等约束',
            hint: '支持 {{category_tree}} 占位符。{task_count} 会被替换为「三项」或「四项」。',
            field: 'clipAnalyzeTaskFormat'
        },
        'daily': {
            title: '整理收件箱 Prompt 配置',
            desc: '编辑整理收件箱时使用的系统提示词',
            hint: '支持 {{category}}、{{date}}、{{count}} 占位符。',
            field: 'dailyOrganizeSystemPrompt'
        },
        'weekly': {
            title: '周报总结 Prompt 配置',
            desc: '编辑生成周报总结时使用的系统提示词',
            hint: '支持 {{week_range}} 占位符。期望 JSON 输出（mainReport + knowledgePoints）。',
            field: 'weeklyReportSystemPrompt'
        },
        'analyzeContent': {
            title: '深度分析 Prompt 配置',
            desc: '编辑内容深度分析时使用的系统提示词',
            hint: '用于 analyzeContent() 方法，输出 Markdown 格式。',
            field: 'analyzeContentPrompt'
        },
        'generateSummary': {
            title: '摘要生成 Prompt 配置',
            desc: '编辑摘要生成时使用的系统提示词',
            hint: '用于 generateSummary() 方法，期望输出不超过 100 字。',
            field: 'generateSummaryPrompt'
        },
        'generateTags': {
            title: '标签提取 Prompt 配置',
            desc: '编辑标签提取时使用的系统提示词',
            hint: '用于 generateTags() 方法，期望输出逗号分隔的标签。',
            field: 'generateTagsPrompt'
        },
        'smartOrganize': {
            title: '智能分类 Prompt 配置',
            desc: '编辑智能分类+标签提取时使用的系统提示词',
            hint: '用于 smartOrganize() 方法。支持 {{category_tree}} 占位符。期望 JSON 输出。',
            field: 'smartOrganizePrompt'
        },
        'generateSynonyms': {
            title: '同义词生成 Prompt 配置',
            desc: '编辑搜索增强同义词生成时使用的系统提示词',
            hint: '用于 generateSynonyms() 方法。期望输出逗号分隔的同义词。',
            field: 'generateSynonymsPrompt'
        },
        'divergentRoleMap': {
            title: '发散性总结角色映射配置',
            desc: '编辑各分类对应的专家角色（JSON 格式）',
            hint: 'JSON 格式：{"work": "你是一位职场专家...", ...}。用于 generateDivergentSummary() 方法。',
            field: 'divergentSummaryRoleMap'
        }
    };
var selectedClipIds = new Set();


    // 暴露到 window：const 顶层声明不挂 window，media-uploader.js 等共享 helper 依赖 window.API_ROOT
    window.API_BASE_URL = API_BASE_URL;
    window.API_ROOT = API_ROOT;

    // ── API 契约层（M4）──
    // 统一封装数据访问：优先走 SQLite 本地索引 IPC（window.electronAPI.localIndex），
    // 不可用/失败时回退后端 REST（axios）。前端消费方只需调用 window.apiClient.xxx，无感知数据源切换。
    window.apiClient = (function () {
        /**
         * 全文搜索（等价 GET /api/clip/search 与 /search/category）。
         * 本地索引策略：FTS5 精确匹配 + LIKE 中文兜底；REST 策略：Java contains + AI 同义词兜底。
         * @param {string} query 关键词
         * @param {{category?: string, topK?: number}} [opts]
         * @returns {Promise<Array<Object>>} ClipContent 数组
         */
        async function search(query, opts) {
            const { category, topK = 10 } = opts || {};
            const bridge = window.electronAPI && window.electronAPI.localIndex;
            if (bridge && typeof bridge.search === 'function') {
                const res = await bridge.search(query, topK, category);
                if (res && res.success) return res.results || [];
                throw new Error((res && res.message) || '本地索引搜索失败');
            }
            const url = category ? `${API_BASE_URL}/search/category` : `${API_BASE_URL}/search`;
            const params = category ? { query, category, topK } : { query, topK };
            const response = await axios.get(url, { params });
            return response.data;
        }

        return { search };
    })();

    // ── 离线/断网模式处理 ──
    // 全局 axios 响应拦截器：统一拦截网络错误，避免控制台大量报错
    axios.interceptors.response.use(
        response => response,
        error => {
            if (!error.response && (error.code === 'ERR_NETWORK' || error.message === 'Network Error')) {
                console.warn('[离线模式] 后端服务不可达，部分功能不可用:', error.config?.url || '');
            }
            return Promise.reject(error);
        }
    );
    // 全局请求超时：避免后端挂起时请求无限等待（默认 30s）
    axios.defaults.timeout = 30000;
    // 列表请求竞态保护：每次 fetchClips 递增序号，仅采纳最新一次请求的结果
    // 监听浏览器网络状态变化
    window.addEventListener('online', () => showToast('网络已恢复连接'));
    window.addEventListener('offline', () => showToast('网络已断开，部分功能可能不可用'));


    function getEffectiveTheme() {
        const appearance = localStorage.getItem(APPEARANCE_KEY) || 'notion';
        if (appearance === 'system') {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'notion';
        }
        return appearance;
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
        currentTheme = themeId === 'regular' ? 'regular' : DEFAULT_THEME;
        const notionThemeLink = document.getElementById('clipThemeNotion');
        if (notionThemeLink) {
            notionThemeLink.disabled = currentTheme !== 'notion';
        }
        const effectiveTheme = getEffectiveTheme();
        if (effectiveTheme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.setAttribute('data-theme', currentTheme);
        }
        if (persist && effectiveTheme !== 'dark') {
            localStorage.setItem(THEME_STORAGE_KEY, currentTheme);
        }
        updateThemeToggleLabel();
    }

    // File upload state

    // ════ 图文一体：图片上传（粘贴/选择/拖拽 → 压缩 → 即传 → 光标插入）════

    function getImageArea() { return document.getElementById('image-upload-area'); }
    function getImageInput() { return document.getElementById('image-input'); }
    function getPreviewsBox() { return document.getElementById('image-previews'); }

    // 图片上传区可见性（ai-text / store-only 显示）
    function updateImageAreaVisibility(type) {
        const area = getImageArea();
        if (!area) return;
        const visible = (type === 'ai-text' || type === 'store-only');
        area.style.display = visible ? '' : 'none';
        if (!visible && contentPreviewActive) {
            toggleContentPreview();
        }
    }

    // 从剪贴板/拖拽中提取图片文件
    // 兼容拖拽本地文件时 item.type 为空的情况：MIME 判断 + 文件名扩展名兜底，
    // items 与 files 两路合并去重，避免拖拽图片被漏识别导致浏览器插入文件路径文本
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
            for (let i = 0; i < dataTransfer.items.length; i++) {
                const item = dataTransfer.items[i];
                if (item.kind === 'file') {
                    const file = item.getAsFile();
                    if (file && isImageFile(file)) files.push(file);
                }
            }
        }
        if (dataTransfer.files && dataTransfer.files.length) {
            for (let i = 0; i < dataTransfer.files.length; i++) {
                const file = dataTransfer.files[i];
                if (file && isImageFile(file) && files.indexOf(file) < 0) files.push(file);
            }
        }
        return files;
    }

    // 在 textarea 光标处插入 markdown 图片引用
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
        if (contentPreviewActive) refreshContentPreview();
    }

    // 刷新内容预览（textarea ↔ markdown 渲染）
    function refreshContentPreview() {
        const preview = document.getElementById('content-preview');
        if (!preview) return;
        const text = document.getElementById('content').value;
        preview.innerHTML = window.MediaKit.render.renderMarkdown(text);
    }

    function toggleContentPreview() {
        const preview = document.getElementById('content-preview');
        const textarea = document.getElementById('content');
        const btn = document.getElementById('image-preview-toggle');
        if (!preview || !btn) return;
        contentPreviewActive = !contentPreviewActive;
        if (contentPreviewActive) {
            refreshContentPreview();
            preview.style.display = '';
            textarea.style.display = 'none';
            btn.classList.add('active');
            btn.textContent = '✏️ 编辑';
        } else {
            preview.style.display = 'none';
            textarea.style.display = '';
            btn.classList.remove('active');
            btn.textContent = '👁 预览';
        }
    }

    // 渲染缩略条
    function renderImagePreviews() {
        const box = getPreviewsBox();
        if (!box) return;
        box.innerHTML = '';
        if (uploadedImages.length === 0) {
            box.style.display = 'none';
            return;
        }
        box.style.display = '';
        uploadedImages.forEach((entry, index) => {
            const el = document.createElement('div');
            el.className = 'image-preview-item';
            el.dataset.id = entry.localId;
            el.dataset.status = entry.status;
            let inner = '';
            if (entry.dataUrl) {
                inner += '<img src="' + entry.dataUrl + '" alt="">';
            } else if (entry.path) {
                inner += '<img src="' + window.MediaKit.render.mediaUrl(entry.path) + '?thumb=1" alt="">';
            }
            if (entry.status === 'uploading' || entry.status === 'compressing') {
                var pct = (entry.status === 'compressing' || entry.progress == null) ? 0 : entry.progress;
                inner += '<div class="preview-status"><div class="preview-progress" style="width:' + pct + '%"></div></div>';
            } else if (entry.status === 'error') {
                inner += '<div class="preview-status error"></div>';
                inner += '<button type="button" class="preview-retry" data-id="' + entry.localId + '">重试</button>';
            } else if (entry.status === 'done') {
                inner += '<div class="preview-dot" title="上传完成"></div>';
            }
            inner += '<button type="button" class="preview-remove" data-id="' + entry.localId + '" title="移除图片（同时移除内容引用）">✕</button>';
            el.innerHTML = inner;
            box.appendChild(el);
        });
    }

    // 移除图片：从列表移除 + 移除 content 中对应引用
    function removeUploadedImage(id) {
        const idx = uploadedImages.findIndex(x => x.localId === id);
        if (idx < 0) return;
        const entry = uploadedImages[idx];
        uploadedImages.splice(idx, 1);
        if (entry.dataUrl) URL.revokeObjectURL(entry.dataUrl);
        // 移除 content 中的引用（已上传完成的）
        if (entry.path) {
            const textarea = document.getElementById('content');
            if (textarea) {
                const escaped = entry.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                textarea.value = textarea.value
                    .replace(new RegExp('!\\[^\\]]*\\]\(' + escaped + '\\)'), '')
                    .replace(/\n{2,}/g, '\n');
            }
        }
        renderImagePreviews();
        if (contentPreviewActive) refreshContentPreview();
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

    // 处理图片文件：压缩 → 上传 → 光标插入
    function handleImageFiles(files) {
        if (!files || files.length === 0) return;
        const imageFiles = files.filter(f => f.type && f.type.startsWith('image/'));
        if (imageFiles.length === 0) {
            showToast('未检测到图片文件');
            return;
        }
        window.MediaKit.uploader.uploadFiles(imageFiles, {
            onStart: (item) => {
                const entry = {
                    localId: ++imageLocalId,
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

    // 当前已上传图片路径清单（提交剪藏用）
    function getUploadedImagePaths() {
        return uploadedImages.filter(i => i.status === 'done' && i.path).map(i => i.path);
    }

    // 图片区事件绑定
    function bindImageEvents() {
        // 注入后端状态读取钩子（主框架广播 backendState 维护 window.__backendState）
        try {
            window.MediaKit.uploader.setBackendStatusProvider(function () {
                return window.__backendState || null;
            });
        } catch (e) {}
        const btn = document.getElementById('image-upload-btn');
        const input = getImageInput();
        const previewToggle = document.getElementById('image-preview-toggle');
        const textarea = document.getElementById('content');
        const previews = getPreviewsBox();

        if (btn && input) {
            btn.addEventListener('click', () => input.click());
            input.addEventListener('change', function () {
                handleImageFiles(input.files);
                input.value = '';
            });
        }
        if (previewToggle) {
            previewToggle.addEventListener('click', toggleContentPreview);
        }
        // 粘贴图片
        if (textarea) {
            textarea.addEventListener('paste', function (e) {
                const files = extractImageFiles(e.clipboardData || window.clipboardData);
                if (files.length > 0) {
                    e.preventDefault();
                    handleImageFiles(files);
                }
            });
            // 拖拽图片
            textarea.addEventListener('dragover', function (e) {
                if (e.dataTransfer && Array.prototype.some.call(e.dataTransfer.types || [], t => t === 'Files')) {
                    e.preventDefault();
                }
            });
            textarea.addEventListener('drop', function (e) {
                const files = extractImageFiles(e.dataTransfer);
                if (files.length > 0) {
                    e.preventDefault();
                    handleImageFiles(files);
                }
            });
        }
        // 缩略条操作（事件委托）
        if (previews) {
            previews.addEventListener('click', function (e) {
                const removeBtn = e.target.closest('.preview-remove');
                const retryBtn = e.target.closest('.preview-retry');
                if (removeBtn) removeUploadedImage(Number(removeBtn.dataset.id));
                if (retryBtn) retryUpload(Number(retryBtn.dataset.id));
            });
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        applyTheme(localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME, false);
        fetchClips();
        loadCategories();
        loadSyncStatus();
        handleTypeChange();
        bindImageEvents();
        updateImageAreaVisibility(document.getElementById('type').value);
        loadDispatchTargets();

        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                applyTheme(getNextThemeId(currentTheme));
            });
        }
        window.addEventListener('storage', event => {
            if (event.key === THEME_STORAGE_KEY || event.key === APPEARANCE_KEY) {
                applyTheme(event.newValue || localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME, false);
            }
        });
        document.addEventListener('click', () => closeAllMoreActions());

        // 监听父页面主题变更消息
        window.addEventListener('message', event => {
            if (event.data && (event.data.type === 'themeChanged' || event.data.type === 'appearanceChanged')) {
                applyTheme(localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME, false);
            }
        });

        // 监听系统主题变化
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            const appearance = localStorage.getItem(APPEARANCE_KEY) || 'light';
            if (appearance === 'system') {
                applyTheme(localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME, false);
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
        const workflowFilter = document.getElementById('workflow-filter');
        if (workflowFilter) {
            workflowFilter.addEventListener('change', fetchClips);
        }

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

            // 如果当前有选中的工作台，传递 workspaceId 自动关联
            const activeWsId = localStorage.getItem('active_workspace_id');
            if (activeWsId) {
                requestBody.workspaceId = activeWsId;
            }

            // 附加用户思考（可选字段）
            const myThoughts = document.getElementById('my-thoughts').value.trim();
            if (myThoughts) {
                requestBody.myThoughts = myThoughts;
            }

            // store-only 类型才发送 workflowStatus: "inbox"
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
            const imagePaths = getUploadedImagePaths();
            if (imagePaths.length > 0) {
                requestBody.imagePaths = imagePaths;
            }

            // 禁用提交按钮并显示加载状态
            const originalText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.textContent = '⏳ 处理中...';
            submitBtn.style.opacity = '0.7';
            submitBtn.style.cursor = 'not-allowed';

            // 显示处理中提示
            const successMessage = document.getElementById('success-message');
            if (type === 'store-only') {
                successMessage.textContent = '💾 正在保存内容...';
            } else if (type === 'link-ai') {
                successMessage.textContent = '🌐 正在爬取链接并分析，请稍候...';
            } else if (type === 'doc-ai') {
                successMessage.textContent = '📄 正在解析文档并分析，请稍候...';
            } else {
                successMessage.textContent = '🎯 AI正在分析内容，请稍候...';
            }
            successMessage.style.display = 'block';
            successMessage.style.background = 'rgba(245, 158, 11, 0.1)';
            successMessage.style.color = 'var(--warning)';
            successMessage.style.borderColor = 'var(--warning)';
            successMessage.style.animation = 'pulse 1.5s ease-in-out infinite';

            // 添加成功/重复后的公共收尾：恢复按钮、清空表单、刷新列表并定位
            const finishAddClip = async () => {
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
                submitBtn.style.opacity = '1';
                submitBtn.style.cursor = 'pointer';

                clearForm();

                // 刷新剪藏列表并确保显示剪藏列表页面
                await fetchClips();

                // 确保显示剪藏列表，隐藏搜索结果页面
                document.getElementById('search-results-page').style.display = 'none';
                document.getElementById('clip-list').style.display = 'block';

                // 滚动到剪藏列表
                document.getElementById('clip-list').scrollIntoView({ behavior: 'smooth' });

                // 开始刷新检查
                setTimeout(startRefreshCheck, 1000);

                setTimeout(() => {
                    successMessage.style.display = 'none';
                }, 3000);
            };

            try {
                const response = await axios.post(`${API_BASE_URL}/add`, requestBody);

                if (response.data.status === 'success') {
                    successMessage.textContent = '✅ 剪藏添加成功！';
                    successMessage.style.background = 'rgba(16, 185, 129, 0.1)';
                    successMessage.style.color = 'var(--success)';
                    successMessage.style.borderColor = 'var(--success)';
                    successMessage.style.animation = 'slideIn 0.5s ease-out';
                    await finishAddClip();
                } else if (response.data.status === 'duplicate') {
                    // 去重命中：提示并跳转到已有记录
                    successMessage.textContent = '⚠️ 检测到相同内容，已跳转到现有剪藏';
                    successMessage.style.background = 'rgba(245, 158, 11, 0.1)';
                    successMessage.style.color = 'var(--warning)';
                    successMessage.style.borderColor = 'var(--warning)';
                    successMessage.style.animation = 'slideIn 0.5s ease-out';
                    await finishAddClip();
                }
            } catch (error) {
                console.error('添加剪藏失败:', error);
                successMessage.textContent = '❌ 添加剪藏失败，请稍后重试';
                successMessage.style.background = 'rgba(239, 68, 68, 0.1)';
                successMessage.style.color = 'var(--error)';
                successMessage.style.borderColor = 'var(--error)';
                successMessage.style.animation = 'pulse 1.5s ease-in-out infinite';

                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
                submitBtn.style.opacity = '1';
                submitBtn.style.cursor = 'pointer';

                setTimeout(() => {
                    successMessage.style.display = 'none';
                }, 3000);
            }
        });
    });

    // Type label mapping
