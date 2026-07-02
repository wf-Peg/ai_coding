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

  // ===================== 文件/目录选择 =====================

  /**
   * 打开系统原生目录选择对话框，让用户选择本地文件夹
   * @returns {Promise<string|null>} 用户选择的目录路径，取消选择时返回 null
   * 用于配置页面的「浏览...」按钮，选择存储目录、总结目录、周报目录等
   */
  selectDirectory: () => ipcRenderer.invoke('select-directory'),

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
   * 监听主进程发送的窗口最大化状态变化事件
   * @param {Function} callback - 接收布尔值的回调，true 表示已最大化
   * 当用户通过系统手势或双击标题栏最大化窗口时，主进程推送此事件
   */
  onWindowMaximized: (callback) => ipcRenderer.on('window-maximized', (event, maximized) => callback(maximized)),

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
  onBackendProgress: (callback) => ipcRenderer.on('backend-progress', (event, data) => callback(data))
});