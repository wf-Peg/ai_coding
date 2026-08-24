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
