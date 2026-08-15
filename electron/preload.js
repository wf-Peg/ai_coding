/**
 * preload.js - Electron 预加载脚本
 *
 * 本脚本在渲染进程加载之前运行，使用 Electron 的 contextBridge 机制
 * 将主进程的 IPC 能力安全地暴露给渲染进程，避免将 Node.js 完整权限
 * 直接暴露给网页内容，这是 Electron 推荐的安全实践。
 *
 * contextBridge 模式说明：
 *   - 渲染进程无法直接访问 Node.js API（如 require、fs、ipcRenderer）
 *   - 只能通过 window.electronAPI 调用此处预定义的方法
 *   - 主进程通过 ipcMain.handle / ipcMain.on 处理这些 IPC 调用
 *   - 有效隔离了渲染进程与系统级能力，防止 XSS 攻击被利用
 *
 * 暴露的 API 分为三类：
 *   1. invoke 型：渲染进程调用主进程并等待返回结果（双向通信）
 *   2. send 型：渲染进程单向发送消息给主进程，不等待回复
 *   3. on 型：渲染进程监听来自主进程的事件推送
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

  // ===================== 配置管理 =====================

  /**
   * 保存配置到主进程的持久化存储（通常是 JSON 文件或 electron-store）
   * @param {Object} config - 完整的配置对象，包含 AI 模型、端口、存储路径、邮件等
   * @returns {Promise<Object>} 主进程返回保存结果，如 { success: true } 或 { success: false, message: '...' }
   */
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),

  /**
   * 从主进程获取已保存的配置
   * @returns {Promise<Object>} 返回完整的配置对象，首次使用时可能返回空对象或默认值
   * 渲染进程通常在窗口加载时调用此方法读取已有配置
   */
  getConfig: () => ipcRenderer.invoke('get-config'),

  /** 查询是否已开启随系统登录自动启动 */
  getAutoStart: () => ipcRenderer.invoke('get-auto-start'),

  /** 更新随系统登录自动启动设置 */
  setAutoStart: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),

  /**
   * 获取 Electron 配置文件（config.json）的所在目录与完整路径
   * @returns {Promise<{success: boolean, configDir: string, configPath: string, exists: boolean}>}
   * 用于设置页面展示并确认桌面应用配置的实际存储位置
   */
  getConfigPath: () => ipcRenderer.invoke('get-config-path'),

  /**
   * 打开 Electron 配置文件所在目录（系统文件管理器）
   * @returns {Promise<{success: boolean, configDir?: string, configPath?: string, message?: string}>}
   * 用于设置页面「打开目录」按钮，方便用户手动查看/备份 config.json
   */
  openConfigFolder: () => ipcRenderer.invoke('open-config-folder'),

  // ===================== 文件/目录选择 =====================

  /**
   * 打开系统原生目录选择对话框，让用户选择本地文件夹
   * @returns {Promise<string|null>} 用户选择的目录路径，取消选择时返回 null
   * 用于配置页面的「浏览...」按钮，选择存储目录、总结目录、周报目录等
   */
  selectDirectory: () => ipcRenderer.invoke('select-directory'),

  /**
   * 工具模块-批量重命名：选择目录（或复用已有目录）并列出其下文件
   * @param {string|null} dirPath - 可选，传入已有目录则直接读取，否则弹出目录选择对话框
   * @returns {Promise<{dirPath: string, files: Array<{name, path}>}|null>}
   */
  selectRenameDirectory: (dirPath) => ipcRenderer.invoke('tools:select-rename-directory', dirPath),

  /**
   * 工具模块-批量重命名：执行重命名
   * @param {Object} payload - { dirPath, renames: [{oldName, newName}] }
   * @returns {Promise<{success: boolean, renamed: number, errors: Array<string>}>}
   */
  applyRenames: (payload) => ipcRenderer.invoke('tools:apply-renames', payload),

  /**
   * 打开系统文本文件选择器。主进程返回文本、编码信息和不透明文件令牌，
   * 渲染进程不会获得任意路径写权限。
   */
  openTextFile: () => ipcRenderer.invoke('editor-open-text-file'),

  /** 按指定编码重新读取已授权文件，不修改磁盘内容。 */
  reopenTextFile: (fileToken, encoding) => ipcRenderer.invoke('editor-reopen-text-file', fileToken, encoding),

  /** 保存到当前已授权文件，并检查外部修改冲突。 */
  saveTextFile: (payload) => ipcRenderer.invoke('editor-save-text-file', payload),

  /** 打开原生另存为对话框并保存文本。 */
  saveTextFileAs: (payload) => ipcRenderer.invoke('editor-save-text-file-as', payload),

  /** 根据文件令牌计算已保存文件的 MD5 哈希。 */
  getFileMd5: (fileToken) => ipcRenderer.invoke('editor-get-file-md5', fileToken),

  /** 在文件管理器中显示指定文件所在目录。 */
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),

  /** 学习计划导出为 Markdown 文件（弹出保存对话框，默认 tmp 目录）。 */
  saveMarkdownFile: (payload) => ipcRenderer.invoke('learning-plan-save-markdown', payload),

  // ===================== 后端服务管理 =====================

  /**
   * 检测后端服务是否在指定端口上运行
   * @param {number} port - 要检测的端口号
   * @returns {Promise<{running: boolean}>} 返回后端是否正在运行
   * 用于配置页面保存后确认后端服务是否启动成功
   */
  checkBackend: (port) => ipcRenderer.invoke('check-backend', port),

  /**
   * 触发剪藏内容转为待办事项
   * @param {Object} payload - 包含剪藏内容的数据对象，如 { clipId, title, content, ... }
   * @returns {Promise<Object>} 主进程处理结果
   * 渲染进程的剪藏页面调用此方法将剪藏内容发送到后端进行待办转换
   */
  clipToTodo: (payload) => ipcRenderer.invoke('clip-to-todo', payload),

  /**
   * 从剪藏内容中提取/派生知识
   * @param {string} clipId - 剪藏记录的 ID
   * @param {boolean} asyncMode - 是否使用异步模式处理（默认 false，即同步等待）
   * @returns {Promise<Object>} 知识提取结果
   * 渲染进程调用此方法将剪藏内容发送给 AI 后端进行知识提炼
   */
  deriveKnowledge: (clipId, asyncMode = false) => ipcRenderer.invoke('derive-knowledge', clipId, asyncMode),

  /**
   * 用新配置重启后端服务
   * @param {Object} config - 新的配置对象（与 saveConfig 格式相同）
   * @returns {Promise<{success: boolean, message?: string}>} 重启结果
   * 非首次运行时，用户修改配置后点击「保存并启动」，调用此方法
   * 主进程会用新配置重启后端服务（如 Python FastAPI 进程）
   */
  restartBackend: (config) => ipcRenderer.invoke('restart-backend', config),

  // ===================== 主进程 → 渲染进程事件监听 =====================

  /**
   * 监听主进程发送的「加载配置」事件
   * @param {Function} callback - 接收配置对象的回调函数
   * 主进程在配置窗口打开时发送已有配置，渲染进程用此数据填充表单
   */
  onLoadConfig: (callback) => ipcRenderer.on('load-config', (event, config) => callback(config)),

  /**
   * 监听主进程发送的「首次运行」事件
   * @param {Function} callback - 无参数回调，触发时表示这是应用首次启动
   * 渲染进程收到此事件后显示欢迎提示，隐藏退出按钮，引导用户完成初始配置
   */
  onFirstRun: (callback) => ipcRenderer.on('first-run', (event) => callback()),

  /**
   * 监听主进程发送的「启动进度」事件
   * @param {Function} callback - 接收进度消息字符串的回调函数
   * 启动过程中主进程会多次推送进度更新（如「正在启动后端服务...」「正在初始化数据库...」）
   * 渲染进程在启动遮罩层上显示这些进度信息
   */
  onStartupProgress: (callback) => ipcRenderer.on('startup-progress', (event, msg) => callback(msg)),

  /**
   * 监听主进程发送的「启动失败」事件
   * @param {Function} callback - 接收错误消息字符串的回调函数
   * 启动过程中如果发生错误，主进程通过此事件通知渲染进程
   * 渲染进程隐藏启动遮罩，显示错误信息，并重新启用保存按钮
   */
  onStartupError: (callback) => ipcRenderer.on('startup-error', (event, msg) => callback(msg)),

  // ===================== 渲染进程 → 主进程单向通信 =====================

  /**
   * 通知主进程配置已完成，可以继续启动流程
   * @param {Object} config - 用户填写的配置对象
   * 仅用于首次运行场景：用户保存配置后，渲染进程调用此方法
   * 主进程收到后负责保存配置并启动后续服务（不通过 invoke 返回值，而是通过事件推送进度）
   */
  configDone: (config) => ipcRenderer.send('config-done', config),

  /**
   * 请求主进程退出应用
   * @returns {Promise<void>}
   * 配置页面「退出应用」按钮调用此方法，主进程执行 app.quit()
   */
  quitApp: () => ipcRenderer.invoke('quit-app'),

  /**
   * 移除指定频道的所有事件监听器
   * @param {string} channel - IPC 频道名称
   * 用于清理不再需要的事件监听，防止内存泄漏
   * 通常在窗口关闭或组件销毁时调用
   */
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),

  // ===================== 窗口控制 =====================

  /**
   * 最小化当前窗口
   * @returns {Promise<void>}
   */
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),

  /**
   * 最大化/还原当前窗口
   * @returns {Promise<void>}
   */
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),

  /**
   * 关闭当前窗口
   * @returns {Promise<void>}
   */
  windowClose: () => ipcRenderer.invoke('window-close'),

  /**
   * 查询当前窗口是否处于最大化状态
   * @returns {Promise<boolean>}
   */
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  /**
   * 开始窗口拖拽（主进程记录窗口起点与鼠标起点，用于绝对坐标定位）
   * @param {number} mouseX - 按下时鼠标屏幕 X 坐标
   * @param {number} mouseY - 按下时鼠标屏幕 Y 坐标
   */
  windowDragStart: (mouseX, mouseY) => ipcRenderer.send('window-drag-start', mouseX, mouseY),

  /**
   * 窗口拖拽移动（上报当前鼠标屏幕坐标，主进程换算绝对位置）
   * @param {number} mouseX - 鼠标屏幕 X 坐标
   * @param {number} mouseY - 鼠标屏幕 Y 坐标
   */
  windowDragMove: (mouseX, mouseY) => ipcRenderer.send('window-drag-move', mouseX, mouseY),

  /**
   * 结束窗口拖拽（主进程根据窗口位置判定贴边分屏）
   */
  windowDragEnd: () => ipcRenderer.send('window-drag-end'),

  /**
   * 监听主进程发送的窗口最大化状态变化事件
   * @param {Function} callback - 接收布尔值的回调，true 表示已最大化
   * 当用户通过系统手势或双击标题栏最大化窗口时，主进程推送此事件
   */
  onWindowMaximized: (callback) => ipcRenderer.on('window-maximized', (event, maximized) => callback(maximized)),

  /**
   * 切换编辑器全屏模式（F11）
   * @param {boolean} enabled - true 进入全屏，false 退出全屏
   * @returns {Promise<{success: boolean}>}
   */
  setFullscreen: (enabled) => ipcRenderer.invoke('set-fullscreen', enabled),

  /**
   * 清除浏览器缓存（设置页调用）
   * @returns {Promise<{success: boolean, message?: string}>}
   */
  clearCache: () => ipcRenderer.invoke('clear-cache'),

  /**
   * 强制刷新页面（忽略缓存，Ctrl+Shift+R 触发）
   * @returns {Promise<void>}
   */
  forceReload: () => ipcRenderer.invoke('force-reload'),

  /**
   * 保存看板娘上传图标到本地文件系统
   * @param {string} characterId - 角色 ID（如 luoxiaohei）
   * @param {string} action - 动作（如 wave）
   * @param {string} dataUrl - 图片 base64 data URL
   * @returns {Promise<{success: boolean, filePath?: string, message?: string}>}
   */
  saveMascotImage: (characterId, action, dataUrl) => ipcRenderer.invoke('save-mascot-image', { characterId, action, dataUrl }),

  // ===================== 编辑器缓存 =====================

  /**
   * 保存编辑器所有标签状态到缓存（{storagePath}/.tmp/editor/cache.json）
   * 用户未保存关闭应用后，下次打开可恢复编辑器内容
   * @param {Object} cacheData - 包含 tabs 数组和 activeTabIndex 的缓存数据
   * @returns {Promise<{success: boolean, message?: string}>}
   */
  saveEditorCache: (cacheData) => ipcRenderer.invoke('editor-save-cache', cacheData),

  /**
   * 读取编辑器缓存
   * @returns {Promise<{exists: boolean, data?: Object, message?: string}>}
   */
  loadEditorCache: () => ipcRenderer.invoke('editor-load-cache'),

  /**
   * 清除编辑器缓存（恢复成功后调用）
   * @returns {Promise<{success: boolean, message?: string}>}
   */
  clearEditorCache: () => ipcRenderer.invoke('editor-clear-cache'),

  // ===================== 编辑器文件树 =====================

  /**
   * 列出指定目录的文件和子目录
   * @param {string} dirPath - 目录路径
   * @returns {Promise<{exists: boolean, files: Array}>} 文件列表
   */
  listDirectory: (dirPath) => ipcRenderer.invoke('editor-list-directory', dirPath),

  /**
   * 根据文件令牌获取所在目录路径
   * @param {string} fileToken - 文件令牌
   * @returns {Promise<{exists: boolean, dirPath: string|null}>}
   */
  getFileDirectory: (fileToken) => ipcRenderer.invoke('editor-get-file-directory', fileToken),

  /**
   * 通过文件路径打开文件
   * @param {string} filePath - 文件绝对路径
   * @returns {Promise<Object>} 文件内容与元数据
   */
  openFileByPath: (filePath) => ipcRenderer.invoke('editor-open-file-by-path', filePath),

  // ===================== 编辑器双链（wikilink）=====================

  /**
   * 扫描知识根目录（vault root）下所有 .md，返回 basename + 相对路径 + 绝对路径，
   * 供双链补全、反链与跳转使用。
   * @returns {Promise<{targets: Array}>}
   */
  listWikilinkTargets: () => ipcRenderer.invoke('editor-list-wikilink-targets'),

  /**
   * 保存当前编辑器内容到知识库（vault root/notes/{basename}.md）
   * @param {{text: string, basename: string}} payload
   * @returns {Promise<{success: boolean, filePath?: string, message?: string}>}
   */
  saveToVault: (payload) => ipcRenderer.invoke('editor-save-to-vault', payload),

  /**
   * 扫描知识根目录下所有 .md，找出引用 `[[basename]]` 的文件与行。
   * @param {string} basename - 被引用文件的不含扩展名名称
   * @returns {Promise<{backlinks: Array}>}
   */
  findBacklinks: (basename) => ipcRenderer.invoke('editor-find-backlinks', basename),

  // ===================== 编辑器自动保存 =====================

  /**
   * 自动保存文件内容到磁盘
   * @param {string} fileToken - 文件令牌
   * @param {string} text - 文本内容
   * @param {string} encoding - 编码
   * @param {string} lineEnding - 换行符
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  autosaveFile: (fileToken, text, encoding, lineEnding) => ipcRenderer.invoke('editor-autosave-file', { fileToken, text, encoding, lineEnding }),

  // ===================== 更新管理 =====================

  /**
   * 获取当前应用版本号
   * @returns {Promise<string>} 版本号字符串
   */
  getVersion: () => ipcRenderer.invoke('get-version'),

  /**
   * 获取更新配置（自动更新开关、频率）
   * @returns {Promise<Object>} 更新配置对象
   */
  getUpdateConfig: () => ipcRenderer.invoke('get-update-config'),

  /**
   * 保存更新配置
   * @param {Object} config - 更新配置 { autoUpdate, frequency }
   * @returns {Promise<Object>} 保存结果
   */
  saveUpdateConfig: (config) => ipcRenderer.invoke('save-update-config', config),

  /**
   * 手动检查更新
   * @returns {Promise<Object>} 更新检查结果 { hasUpdate, latestVersion, currentVersion, releaseNotes, downloadUrl, message }
   */
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),

  /**
   * 开始下载并应用更新
   * @param {string} downloadUrl - 更新包下载地址
   * @returns {Promise<Object>} 下载结果
   */
  downloadAndApplyUpdate: (downloadUrl) => ipcRenderer.invoke('download-and-apply-update', downloadUrl),

  /**
   * 监听更新进度事件
   * @param {Function} callback - 接收 { message, percent } 的回调
   */
  onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (event, data) => callback(data)),

  /**
   * 监听新版本可用事件
   * @param {Function} callback - 接收 { version, notes, releaseUrl, downloadUrl } 的回调
   */
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, data) => callback(data)),

  /**
   * 监听更新完成事件
   * @param {Function} callback - 无参数回调
   */
  onUpdateComplete: (callback) => ipcRenderer.on('update-complete', () => callback()),

  /**
   * 监听更新错误事件
   * @param {Function} callback - 接收错误消息字符串的回调
   */
  onUpdateError: (callback) => ipcRenderer.on('update-error', (event, msg) => callback(msg)),

  // ===================== 后端启动状态 =====================

  /**
   * 监听后端就绪事件
   * @param {Function} callback - 无参数回调，后端端口已可访问
   */
  onBackendReady: (callback) => ipcRenderer.on('backend-ready', () => callback()),

  /**
   * 监听后端启动失败事件
   * @param {Function} callback - 接收错误消息字符串的回调
   */
  onBackendError: (callback) => ipcRenderer.on('backend-error', (event, msg) => callback(msg)),

  /**
   * 监听后端启动进度事件
   * @param {Function} callback - 接收 { message, elapsed } 的回调
   */
  onBackendProgress: (callback) => ipcRenderer.on('backend-progress', (event, data) => callback(data)),

  /**
   * 手动启动后端服务（由前端按钮触发）
   * @returns {Promise<{success: boolean, message: string}>}
   */
  startBackend: () => ipcRenderer.invoke('start-backend'),

  /**
   * 检查后端是否正在运行
   * @returns {Promise<boolean>}
   */
  isBackendRunning: () => ipcRenderer.invoke('is-backend-running'),

  /**
   * 获取当前启动模式
   * @returns {Promise<string>} 'full' | 'frontend-only' | 'frontend-async-backend'
   */
  getStartupMode: () => ipcRenderer.invoke('get-startup-mode'),

  /**
   * 保存配置项
   * @param {Object} partialConfig - 部分配置对象，会合并到现有配置中
   * @returns {Promise<{success: boolean}>}
   */
  saveConfig: (partialConfig) => ipcRenderer.invoke('save-config', partialConfig),

  /**
   * 监听系统通知事件（后端就绪/失败等）
   * @param {Function} callback - 接收 { title, body } 对象
   */
  onShowNotification: (callback) => ipcRenderer.on('show-notification', (event, data) => callback(data)),

  // ===================== 日志 =====================

  /**
   * 将前端日志写入文件（通过主进程）
   * @param {string} level - 日志级别：'info' | 'warn' | 'error'
   * @param {string} message - 日志内容
   * @returns {Promise<void>}
   */
  logToFile: (level, message) => ipcRenderer.invoke('log-to-file', { level, message }),

  // ===================== 剪贴板 & 快捷键 =====================

  readClipboard: () => ipcRenderer.invoke('read-clipboard'),
  getShortcutConfig: () => ipcRenderer.invoke('get-shortcut-config'),
  setShortcutConfig: (config) => ipcRenderer.invoke('set-shortcut-config', config),

  // ===================== 系统右键菜单事件监听 =====================

  /**
   * 监听系统右键「添加到剪藏收件箱」事件
   * @param {Function} callback - 接收文件路径字符串的回调
   */
  onClipFile: (callback) => ipcRenderer.on('clip-file', (event, path) => callback(path)),

  /**
   * 监听系统右键「AI 解析文件并添加剪藏」事件
   * @param {Function} callback - 接收文件路径字符串的回调
   */
  onAiClipFile: (callback) => ipcRenderer.on('ai-clip-file', (event, path) => callback(path)),

  /**
   * 监听系统右键「用编辑器打开文件」事件
   * @param {Function} callback - 接收文件路径字符串的回调
   */
  onOpenFileRequest: (callback) => ipcRenderer.on('open-file-request', (event, path) => callback(path)),

  /**
   * 监听系统右键「PDF OCR 识别」事件
   * @param {Function} callback - 接收文件路径字符串的回调
   */
  onPdfOcr: (callback) => ipcRenderer.on('pdf-ocr', (event, path) => callback(path)),

  /**
   * 监听系统右键「设置」事件
   * @param {Function} callback - 无参数回调
   */
  onOpenSettings: (callback) => ipcRenderer.on('open-settings', () => callback()),

  // ===================== 截图小工具（F1/F2/OCR） =====================

  /** 截图覆盖层取消（Esc/取消按钮） */
  screenshotCancel: () => ipcRenderer.invoke('screenshot:cancel'),

  /** 截图确认：选区 rect（CSS 像素）+ 动作 copy/save/ocr/paste */
  screenshotConfirm: (payload) => ipcRenderer.invoke('screenshot:confirm', payload),

  /** 复制最近一次截图到剪贴板 */
  screenshotCopyLast: () => ipcRenderer.invoke('screenshot:copy-last'),

  /** 贴图：剪贴板图片或最近截图置顶 */
  screenshotPaste: () => ipcRenderer.invoke('screenshot:paste'),

  /** 对图片 dataUrl 执行 OCR 识别 */
  screenshotOcr: (dataUrl) => ipcRenderer.invoke('screenshot:ocr', { dataUrl }),

  /** 查询 OCR 可用状态（onnxruntime + 模型是否就绪） */
  screenshotOcrStatus: () => ipcRenderer.invoke('screenshot:ocr-status'),

  /** 获取截图快捷键/配置 */
  screenshotGetShortcuts: () => ipcRenderer.invoke('screenshot:get-shortcuts'),

  /** 更新截图快捷键/配置（持久化 + 即时重注册） */
  screenshotSetShortcuts: (payload) => ipcRenderer.invoke('screenshot:set-shortcuts', payload),

  /** OCR 结果跳转编辑器：主窗口转发消息 */
  screenshotOpenInEditor: (payload) => ipcRenderer.invoke('screenshot:open-in-editor', payload),

  /** 监听主窗口转发给编辑器的 OCR 文本打开请求 */
  onScreenshotOpenInEditor: (callback) => ipcRenderer.on('screenshot:open-in-editor', (event, data) => callback(data)),
});
