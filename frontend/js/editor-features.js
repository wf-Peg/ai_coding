/**
 * 编辑器功能开关（opt-in 管理）
 * ------------------------------------------------------------
 * Phase 1「导航效率」所有新功能通过本模块统一管控，保证：
 *   1. 默认行为零变更：新功能默认走旧逻辑路径（default 可整体翻转为开启）；
 *   2. 可一键回退：localStorage['editor_features_v1'] 中关闭某开关即恢复旧行为，无需改代码；
 *   3. 逐项隔离：每个功能独立开关，互不影响。
 *
 * 用法：
 *   EditorFeatures.isOn('breadcrumbBar')        → 是否生效
 *   EditorFeatures.set('breadcrumbBar', false)  → 一键关闭（回退）
 *   EditorFeatures.list()                       → 全部状态（供调试/设置页）
 *
 * 注意：editor.js 内统一用内部 helper `featureOn(name)` 读取，
 * 避免在 EditorFeatures 加载前（脚本按末尾顺序引入）报错。
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'editor_features_v1';

  // 功能注册表：name -> { label 中文名, default 默认值 }
  // 默认开启（用户可见的新能力）；如需「默认关 + 手动开」，把对应 default 改为 false 即可。
  var FEATURES = {
    cmdPaletteEnhanced: { label: '命令面板增强（模糊匹配 + 最近使用）', default: true },
    multiCursor:        { label: '多光标支持与状态栏提示', default: true },
    breadcrumbBar:      { label: '面包屑导航栏', default: true },
    editorPosHistory:   { label: '近期编辑位置记忆（Alt+- / Alt+Shift+-）', default: true },
    outlineEnhance:     { label: '大纲点击跳转与行号悬浮', default: true },
    // Phase 2：代码智能
    keywordCompleter:   { label: '语言关键字补全（JSON/XML/SQL）', default: true },
    bracketPairs:       { label: '括号配对与包裹选区（新增代码模式）', default: true },
    errorMarkers:       { label: '语法错误标注（JSON/XML gutter 红点）', default: true },
    // Phase 3：性能
    largeFileDegrade:   { label: '大文件轻量模式（>2MB 关 worker，>5MB 关换行/选中同步）', default: true },
    autosaveDebounce:   { label: '自动保存防抖（编辑停止 2s 保存）', default: true },
    dirtyCacheGate:     { label: '缓存/工作区仅变更时落盘', default: true },
    tabBarIncremental:  { label: '标签栏增量渲染', default: true },
    mdPreviewDiff:      { label: 'Markdown 预览内容未变不重绘', default: true },
    // Phase 4：写作区丝滑度（借鉴 UltraEdit / Notepad++）
    imeComposition:     { label: '中文输入法友好（composition 期间暂停跟随任务）', default: true },
    mdAdaptiveDebounce: { label: 'Markdown 预览自适应防抖', default: true },
    statusRaf:          { label: '状态栏更新合并到帧', default: true },
    previewScrollFollow:{ label: 'Markdown 预览滚动跟随', default: true },
    previewClickLocate: { label: '预览点击反向定位到编辑区', default: true },
    largeFileAutocompleteOff: { label: '大文件关闭自动补全', default: true },
    longLineWrap:       { label: '超长行自动换行', default: true },
    largeFileOpenHint:  { label: '大文件打开提示与异步加载', default: true },
    searchHighlightLimit:{ label: '大文件搜索高亮上限', default: true },
    autosaveSilent:     { label: '自动保存成功静默提示', default: true },
    middleClickCloseTab:{ label: '标签中键关闭', default: true },
    gutterSelectLine:   { label: '行号点击选中整行', default: true },
    docStatsZoom:       { label: '状态栏全文行数/字符数与缩放百分比', default: true },
    paneEnterAnim:      { label: '抽屉面板入场动效统一', default: true },
    resizeObserver:     { label: '容器尺寸变化即时 resize', default: true }
  };

  function readOverrides() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function isOn(name) {
    var feat = FEATURES[name];
    if (!feat) return false;
    var overrides = readOverrides();
    if (Object.prototype.hasOwnProperty.call(overrides, name)) return !!overrides[name];
    return !!feat.default;
  }

  function set(name, on) {
    if (!FEATURES[name]) return;
    var overrides = readOverrides();
    overrides[name] = !!on;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  }

  function list() {
    var overrides = readOverrides();
    return Object.keys(FEATURES).map(function (k) {
      return {
        name: k,
        label: FEATURES[k].label,
        on: isOn(k),
        overridden: Object.prototype.hasOwnProperty.call(overrides, k)
      };
    });
  }

  global.EditorFeatures = {
    STORAGE_KEY: STORAGE_KEY,
    FEATURES: FEATURES,
    isOn: isOn,
    set: set,
    list: list
  };

  // 通知编辑器：功能开关已就绪（editor.js 在脚本中先于本文件执行，
  // 初始渲染需要按加载后的实际开关状态刷新一次，如面包屑、多光标状态栏）。
  try {
    window.dispatchEvent(new CustomEvent('editor-features-ready', { detail: { features: list() } }));
  } catch (e) { /* 事件派发失败不影响功能本身 */ }
})(window);