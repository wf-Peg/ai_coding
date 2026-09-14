// ============================================================
// CutShelter clip 页面模块: clip-form
// 由 clip.html 内联脚本按功能拆分生成（经典 script 顺序加载）
// ============================================================

    function getTypeLabel(type) {
        return TYPE_LABELS[type] || type || '未知';
    }

    // Type switch handler
    function handleTypeChange() {
        const type = document.getElementById('type').value;
        const contentArea = document.getElementById('content');
        const fileUploadArea = document.getElementById('file-upload-area');
        const tagsGroup = document.getElementById('tags-group');
        const contentLabel = contentArea.closest('.form-group').querySelector('label');
        updateImageAreaVisibility(type);

        if (type === 'link-ai') {
            contentArea.style.display = '';
            contentArea.placeholder = '请输入链接URL（如 https://example.com/article）';
            contentLabel.textContent = '链接';
            fileUploadArea.style.display = 'none';
            tagsGroup.style.display = '';
        } else if (type === 'doc-ai') {
            contentArea.style.display = 'none';
            fileUploadArea.style.display = '';
            contentLabel.textContent = '文档';
            tagsGroup.style.display = '';
        } else if (type === 'image') {
            contentArea.style.display = '';
            contentArea.placeholder = '图片剪藏：上传图片后可「OCR 提取文字」，识别结果会填入此处';
            contentLabel.textContent = '插图';
            fileUploadArea.style.display = 'none';
            tagsGroup.style.display = '';
        } else if (type === 'store-only') {
            contentArea.style.display = '';
            contentArea.placeholder = '请输入要存储的内容';
            contentLabel.textContent = '内容';
            fileUploadArea.style.display = 'none';
            tagsGroup.style.display = 'none';
        } else {
            contentArea.style.display = '';
            contentArea.placeholder = '请输入要剪藏的内容';
            contentLabel.textContent = '内容';
            fileUploadArea.style.display = 'none';
            tagsGroup.style.display = '';
        }
    }

    // File upload handlers

    /** 折叠态展开/收起：剪藏填写区默认折叠为记录条，交互后原位展开 */
    function expandForm(preType) {
        const section = document.getElementById('add-clip-section');
        if (!section) return;
        // 若表单当前被 toggleMode 隐藏（信息检索模式），先恢复显示
        section.style.display = 'block';
        section.classList.remove('form-collapsed');
        // 重新触发 fadeInUp 展开动画（先强制重排，再恢复动画）
        const form = section.querySelector('.clip-form');
        if (form) {
            form.style.animation = 'none';
            void form.offsetWidth;
            form.style.animation = '';
        }
        if (preType) {
            const typeSel = document.getElementById('type');
            if (typeSel && typeSel.value !== preType) {
                typeSel.value = preType;
                handleTypeChange();
            }
        }
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(function () {
            const content = document.getElementById('content');
            if (content && (content.style.display !== 'none') && content.offsetParent !== null) {
                content.focus();
            }
        }, 250);
    }

    function collapseForm() {
        const section = document.getElementById('add-clip-section');
        if (!section) return;
        section.classList.add('form-collapsed');
        // 不做强制滚动：表单折叠后，视觉自然回落到记录条 + 列表区域
    }

    /** 快速记录：预置剪藏类型并引导，提升首屏记录效率（对标 NoteGen 剪藏种类） */
    function quickRecord(mode) {
        // OCR 快速记录归一为 image 类型：type select 只有 store-only/ai-text/link-ai/doc-ai/image，
        // 直接传 'ocr' 会把 select 置空 → 图片区被隐藏、提交类型为空，图片"存不上"且无缩略图。
        const type = mode === 'ocr' ? 'image' : mode;
        const KNOWN_TYPES = ['store-only', 'ai-text', 'link-ai', 'doc-ai', 'image'];
        expandForm(KNOWN_TYPES.indexOf(type) >= 0 ? type : 'store-only');
        const content = document.getElementById('content');
        if (mode === 'store-only') {
            content.placeholder = '粘贴文本内容，快速剪藏…（Ctrl+V）';
        } else if (mode === 'image' || mode === 'ocr') {
            content.placeholder = '图片剪藏：上传图片后可「OCR 提取文字」';
        } else if (mode === 'link-ai') {
            content.placeholder = '输入链接 URL，AI 解析后收藏（如 https://example.com/article）';
        }
        if (mode === 'ocr') {
            setTimeout(function () {
                const input = document.getElementById('image-input');
                if (input) input.click();
            }, 400);
        }
    }

    /** 将存储的 media 相对路径图片加载为 dataUrl（供已保存剪藏的 OCR 复用；当前会话图直接传 dataUrl） */
    async function loadImageDataUrl(relPath) {
        if (!relPath) return null;
        if (relPath.indexOf('data:') === 0) return relPath;
        const url = window.MediaKit.render.mediaUrl(relPath);
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('图片加载失败（HTTP ' + resp.status + '）');
        const blob = await resp.blob();
        return await new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onload = function () { resolve(reader.result); };
            reader.onerror = function () { reject(new Error('图片读取失败')); };
            reader.readAsDataURL(blob);
        });
    }

    /** 执行 OCR：识别 dataUrl 图片并返回识别文本（表单 / 已保存剪藏共用）；失败或不可用返回空串 */
    async function recognizeImage(dataUrl) {
        const api = window.electronAPI;
        if (!api || typeof api.ocrRecognize !== 'function') { showToast('OCR 仅桌面客户端可用'); return ''; }
        if (typeof api.ocrStatus === 'function') {
            const st = await api.ocrStatus();
            if (st && st.available === false) { showToast('OCR 不可用：' + (st.reason || '模型未就绪')); return ''; }
        }
        showToast('OCR 识别中…');
        const res = await api.ocrRecognize(dataUrl);
        if (res.status === 'success' && res.text) {
            return res.text.trim();
        }
        showToast('OCR 失败：' + (res.message || '未识别到文字'));
        return '';
    }

    /** 对识别文本请求后端 AI 总结；失败或无效时返回 ''，不拖垮 OCR 主流程 */
    async function requestTextSummary(text) {
        if (!text || !text.trim()) return '';
        try {
            const resp = await axios.post(`${API_BASE_URL}/text-summary`, { content: text });
            if (resp.data && resp.data.status === 'success' && resp.data.summary) {
                return resp.data.summary.trim();
            }
            return '';
        } catch (e) {
            return '';
        }
    }

    /** 插图 OCR：对已上传的图片离线识别文字，结果填入内容（复用通用离线 OCR，独立于截图工具） */
    async function runImageOcr() {
        const img = uploadedImages.find(i => i.path || i.dataUrl);
        if (!img) { showToast('请先上传图片再执行 OCR'); return; }
        try {
            const dataUrl = img.dataUrl || (await loadImageDataUrl(img.path));
            const text = await recognizeImage(dataUrl);
            if (!text) return;
            // OCR 识别文字后再请求 AI 总结，形成「识别原文 + AI 总结」的完整记录（对标 NoteGen 截图→文字→总结）
            const summary = await requestTextSummary(text);
            const content = document.getElementById('content');
            let composed = text;
            if (summary) composed += '\n\n**AI 总结**：' + summary;
            content.value = (content.value ? content.value + '\n' : '') + composed;
            content.dispatchEvent(new Event('input'));
            showToast('已识别 ' + text.length + ' 字' + (summary ? '，并生成 AI 总结' : ''));
        } catch (e) {
            showToast('OCR 失败：' + (e && e.message ? e.message : '请稍后重试'));
        }
    }

    if (dropzone) {
        dropzone.addEventListener('click', () => fileInput.click());

        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        });

        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('dragover');
        });

        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                handleFile(e.dataTransfer.files[0]);
            }
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                handleFile(fileInput.files[0]);
            }
        });
    }

    function handleFile(file) {
        const allowedExts = ['.pdf', '.docx', '.txt', '.md', '.csv'];
        const ext = '.' + file.name.split('.').pop().toLowerCase();

        if (!allowedExts.includes(ext)) {
            showToast('不支持的文件格式，请上传 PDF、DOCX 或 TXT 文件');
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            uploadedFileBase64 = e.target.result.split(',')[1];
            uploadedFileName = file.name;
            document.getElementById('file-name').textContent = file.name;
            document.getElementById('file-size').textContent = formatFileSize(file.size);
            document.getElementById('file-info').style.display = 'flex';
            dropzone.style.display = 'none';
        };
        reader.readAsDataURL(file);
    }

    function removeFile() {
        uploadedFileBase64 = null;
        uploadedFileName = null;
        fileInput.value = '';
        document.getElementById('file-info').style.display = 'none';
        dropzone.style.display = '';
    }

    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    // Category value-to-label mapping

    function getCategoryLabel(value) {
        if (!value) return '未分类';
        return CATEGORY_LABELS[value] || value;
    }

    function getWorkflowStatusLabel(value) {
        if (!value) return '未指定';
        if (value === 'inbox') return '收件箱';
        if (value === 'organized') return '已整理';
        return value;
    }

    function resolveWorkflowStatus(clip) {
        const status = (clip?.workflowStatus || '').toString().trim().toLowerCase();
        if (status) {
            return status;
        }
        // 兼容旧数据与未升级后端
        if ((clip?.category || '').toString().trim().toLowerCase() === 'inbox') {
            return 'inbox';
        }
        return 'organized';
    }

    // Load category tree from backend
    async function loadCategories() {
        try {
            const response = await axios.get(`${API_BASE_URL}/categories`);
            const categories = response.data;

            // Fill add-clip category select
            const select = document.getElementById('category');
            select.innerHTML = '<option value="">落入收件箱</option>';

            // Fill search category select
            const searchSelect = document.getElementById('search-category');
            searchSelect.innerHTML = '<option value="">全部分类</option>';

            const organizeCategory = document.getElementById('organize-category');
            if (organizeCategory) {
                organizeCategory.innerHTML = '<option value="">保持原分类</option>';
            }

            categories.forEach(cat => {
                if (cat.children && cat.children.length > 0) {
                    // Add-clip: optgroup with children
                    const group = document.createElement('optgroup');
                    group.label = cat.label;
                    cat.children.forEach(child => {
                        const option = document.createElement('option');
                        option.value = child.value;
                        option.textContent = '  ' + child.label;
                        group.appendChild(option);
                    });
                    select.appendChild(group);

                    // Search: flat list with "大类 > 子类" format
                    cat.children.forEach(child => {
                        const opt = document.createElement('option');
                        opt.value = child.value;
                        opt.textContent = cat.label + ' > ' + child.label;
                        searchSelect.appendChild(opt);

                        if (organizeCategory) {
                            const organizeOpt = document.createElement('option');
                            organizeOpt.value = child.value;
                            organizeOpt.textContent = cat.label + ' > ' + child.label;
                            organizeCategory.appendChild(organizeOpt);
                        }
                    });
                } else {
                    const option = document.createElement('option');
                    option.value = cat.value;
                    option.textContent = cat.label;
                    select.appendChild(option);

                    const searchOpt = document.createElement('option');
                    searchOpt.value = cat.value;
                    searchOpt.textContent = cat.label;
                    searchSelect.appendChild(searchOpt);

                    if (organizeCategory) {
                        const organizeOpt = document.createElement('option');
                        organizeOpt.value = cat.value;
                        organizeOpt.textContent = cat.label;
                        organizeCategory.appendChild(organizeOpt);
                    }
                }
            });
        } catch (error) {
            console.error('Failed to load categories:', error);
        }
    }

    function toggleTagInput() {
        const useAiTags = document.getElementById('ai-generate-tags').checked;
        const tagInput = document.getElementById('tag-input');

        if (useAiTags) {
            tagInput.disabled = true;
            tagInput.placeholder = 'AI将自动生成标签';
            currentTags = [];
            renderTags();
        } else {
            tagInput.disabled = false;
            tagInput.placeholder = '输入标签后按回车 (最多10个)';
        }
    }

    function addTag(tag) {
        if (!tag || !tag.trim()) return;
        if (currentTags.includes(tag.trim())) return;
        if (currentTags.length >= MAX_TAGS) {
            showToast(`最多只能添加 ${MAX_TAGS} 个标签`);
            return;
        }

        currentTags.push(tag.trim());
        renderTags();
    }

    function removeTag(tag) {
        currentTags = currentTags.filter(t => t !== tag);
        renderTags();
    }

    function renderTags() {
        const tagsList = document.getElementById('tags-list');
        // 使用 DOM API 构建，避免 innerHTML 拼接用户输入导致 XSS
        tagsList.innerHTML = '';
        currentTags.forEach(tag => {
            const div = document.createElement('div');
            div.className = 'tag';
            const span = document.createElement('span');
            span.textContent = tag;
            const remove = document.createElement('span');
            remove.className = 'tag-remove';
            remove.textContent = '\u00d7';
            remove.title = '删除标签';
            remove.addEventListener('click', () => removeTag(tag));
            div.appendChild(span);
            div.appendChild(remove);
            tagsList.appendChild(div);
        });
    }

    function clearForm() {
        document.getElementById('content').value = '';
        document.getElementById('type').value = 'store-only';
        document.getElementById('source').value = '';
        document.getElementById('category').value = '';
        document.getElementById('ai-generate-tags').checked = false;
        document.getElementById('my-thoughts').value = '';
        toggleTagInput();
        currentTags = [];
        renderTags();
        removeFile();
        // 图片相关已移除A
        document.getElementById('type').dispatchEvent(new Event('change'));
    }

    async function smartIngestClip(event) {
        const contentTextarea = document.getElementById('content');
        const text = contentTextarea ? contentTextarea.value.trim() : '';
        if (!text) {
            showToast('请输入内容');
            return;
        }
        if (text.length < 5) {
            showToast('内容过短，请至少输入5个字符');
            return;
        }

        const btn = event.target.closest('button');
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '分析中...';

        try {
            const response = await fetch(API_ROOT + '/ingest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });

            const result = await response.json();

            if (result.success) {
                const intentLabel = result.intent === 'todo' ? '待办' : result.intent === 'topic' ? '话题' : '剪藏';
                const degradedNote = result.degraded ? ' (降级存储)' : '';
                showToast(`智能入库成功！识别为${intentLabel}${degradedNote}`);
                clearForm();
                if (typeof fetchClips === 'function') setTimeout(fetchClips, 500);
            } else {
                showToast(result.error || '智能入库失败');
            }
        } catch (error) {
            console.error('智能入库失败:', error);
            showToast('网络错误，请确认后端服务已启动');
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }

    function startVoiceInput() {
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            const recognition = new SpeechRecognition();

            recognition.lang = 'zh-CN';
            recognition.continuous = false;
            recognition.interimResults = false;

            recognition.onstart = function() {
                showToast('语音识别已启动，请开始说话...');
            };

            recognition.onresult = function(event) {
                const transcript = event.results[0][0].transcript;
                document.getElementById('content').value = transcript;
            };

            recognition.onerror = function(event) {
                console.error('语音识别错误:', event.error);
                showToast('语音识别失败，请重试');
            };

            recognition.onend = function() {
                console.log('语音识别已结束');
            };

            recognition.start();
        } else {
            showToast('您的浏览器不支持语音识别功能');
        }
    }
