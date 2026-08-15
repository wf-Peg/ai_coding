// 与 frontend/js/media-uploader.js 保持同步（决策 D-L），修改请两端同步。
/**
 * 媒体上传共享 helper（media-uploader.js）
 *
 * 剪藏图文一体（决策 D-A / D-C / D-H）的上传层工具：
 *  - compressImage：canvas 客户端压缩（最长边 1600px / JPEG q0.82 /
 *    PNG 保留透明 / webp 转 jpg / gif 保持原样不压缩）
 *  - uploadImage：XHR multipart 上传（upload.onprogress 进度、可重试）
 *  - uploadFiles：批量上传入口（逐张压缩+上传，单张失败不阻塞）
 *
 * 使用：<script src="js/media-uploader.js"></script>，之后 window.MediaKit.uploader
 * 扩展端复制到 browser-extension/libs/ 并保持同步（决策 D-L）。
 */
(function (global) {
  'use strict';

  var MAX_DIM = 1600;
  var JPEG_QUALITY = 0.82;
  var MAX_SIZE = 10 * 1024 * 1024; // 10MB 后端上限

  /** 显式配置的 API 根地址（优先；const 声明不挂 window，页面需通过 setApiRoot 或 window.API_ROOT 提供） */
  var configuredApiRoot = '';
  function setApiRoot(root) {
    configuredApiRoot = root ? String(root).replace(/\/+$/, '') : '';
  }

  /** 后端状态读取钩子：页面注入返回 'ready'|'stopped'|'starting'|'error' 的函数（来自主框架广播） */
  var backendStatusProvider = null;
  function setBackendStatusProvider(fn) {
    backendStatusProvider = typeof fn === 'function' ? fn : null;
  }
  function getBackendStatus() {
    try { return backendStatusProvider ? backendStatusProvider() : null; } catch (e) { return null; }
  }

  /** 上传地址：{API_ROOT}/media/upload */
  function getUploadUrl() {
    var root = configuredApiRoot
      || global.API_ROOT
      || (global.API_BASE_URL ? String(global.API_BASE_URL).replace(/\/clip\/?$/, '') : '');
    if (!root) {
      // 兜底：没有任何 API 配置时抛明确错误，避免请求打到前端静态服务器返回 HTML
      throw new Error('未配置 API 地址（缺少 API_ROOT / API_BASE_URL），请检查页面脚本加载顺序');
    }
    return root + '/media/upload';
  }

  /**
   * canvas 压缩图片。
   * @param {File} file 图片文件
   * @returns {Promise<Blob>} 压缩后的 Blob
   */
  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file) {
        return reject(new Error('不是图片文件'));
      }
      // 兼容拖拽本地文件 type 为空的情况：交由 Image 实际加载判断，扩展名兜底
      var lowerName = (file.name || '').toLowerCase();
      var isGif = file.type === 'image/gif' || /.gif$/i.test(lowerName);
      var isPng = file.type === 'image/png' || /.png$/i.test(lowerName);
      // gif 动图保持原样（canvas 会丢失动画）
      if (isGif) {
        return resolve(file);
      }
      var objectUrl = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(objectUrl);
        try {
          var width = img.naturalWidth || img.width;
          var height = img.naturalHeight || img.height;
          if (width > MAX_DIM || height > MAX_DIM) {
            var scale = MAX_DIM / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          var canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          var ctx = canvas.getContext('2d');
          // webp → jpg（白底）；png 保留透明 → png
          var mime = isPng ? 'image/png' : 'image/jpeg';
          if (mime === 'image/jpeg') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);
          }
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(function (blob) {
            if (blob) resolve(blob);
            else reject(new Error('压缩失败'));
          }, mime, mime === 'image/jpeg' ? JPEG_QUALITY : undefined);
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('图片加载失败: ' + file.name));
      };
      img.src = objectUrl;
    });
  }

  /**
   * XHR multipart 上传单张图片。
   * @param {Blob} blob 图片 Blob
   * @param {string} filename 文件名
   * @param {object} callbacks { onProgress(percent) }
   * @returns {Promise<{path:string,url:string,size:number}>}
   */
  function uploadImage(blob, filename, callbacks) {
    return new Promise(function (resolve, reject) {
      if (blob.size > MAX_SIZE) {
        return reject(new Error('图片超过 10MB 上限'));
      }
      var xhr = new XMLHttpRequest();
      var formData = new FormData();
      var ext = (filename || 'image.jpg').split('.').pop() || 'jpg';
      formData.append('file', blob, 'image-' + Date.now() + '.' + ext);
      xhr.open('POST', getUploadUrl());
      xhr.setRequestHeader('Accept', 'application/json'); // 强制 JSON 响应，便于错误诊断
      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable && callbacks && callbacks.onProgress) {
          callbacks.onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.timeout = 60000; // 60s 超时，避免一直转圈
      xhr.ontimeout = function () { reject(new Error('上传超时（60 秒）')); };
      xhr.onload = function () {
        var raw = xhr.responseText || '';
        var resp = null;
        try { resp = JSON.parse(raw); } catch (e) { resp = null; }
        if (xhr.status === 200 && resp && resp.status === 'success') {
          resolve(resp);
          return;
        }
        // 非成功响应：给出可诊断的错误信息（而非笼统的"解析失败"）
        var detail = (resp && resp.message) ? resp.message : '';
        if (!detail) {
          if (xhr.status === 404) {
            detail = '上传接口不存在（HTTP 404）——请确认后端已更新并重启应用';
          } else if (xhr.status === 413 || xhr.status === 500) {
            detail = '文件超过服务器大小限制（HTTP ' + xhr.status + '，服务器上限 10MB）';
          } else if (xhr.status === 0) {
            detail = '网络错误（无法连接后端）';
          } else {
            var snippet = raw.replace(/\s+/g, ' ').slice(0, 120);
            detail = '响应异常（HTTP ' + xhr.status + '）' + (snippet ? '：' + snippet : '');
          }
        }
        reject(new Error(detail || '上传失败（HTTP ' + xhr.status + '）'));
      };
      xhr.onerror = function () {
        // 分级提示：优先依据主框架广播的后端状态；无钩子时探测连通性
        var status = getBackendStatus();
        if (status && status !== 'ready') {
          reject(new Error('后端服务未就绪（' + status + '），请确认后端已启动后再上传'));
        } else if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          reject(new Error('网络不可用，请检查网络连接'));
        } else {
          // 无广播钩子（扩展等独立环境）：快速探测后端连通性
          var probe = new XMLHttpRequest();
          probe.open('GET', getUploadUrl().replace(/\/media\/upload$/, '/clip/list'), true);
          probe.timeout = 2000;
          probe.onload = function () { reject(new Error('网络错误，上传失败')); };
          probe.onerror = function () { reject(new Error('无法连接后端服务，请确认后端已启动（8081）')); };
          probe.ontimeout = function () { reject(new Error('无法连接后端服务，请确认后端已启动（8081）')); };
          probe.send();
        }
      };
      xhr.send(formData);
    });
  }

  /**
   * 批量处理图片文件：压缩 → 上传 → 回调。
   * 单张失败不阻塞其它图片。
   *
   * @param {File[]} files 图片文件列表
   * @param {object} hooks { onStart(item), onProgress(item, percent),
   *                         onSuccess(item, resp), onError(item, err) }
   * @returns {Promise<void>}
   */
  async function uploadFiles(files, hooks) {
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var item = { file: file, name: file.name, status: 'compressing' };
      if (hooks.onStart) hooks.onStart(item);
      try {
        var blob = await compressImage(file);
        item.status = 'uploading';
        var resp = await uploadImage(blob, file.name, {
          onProgress: function (percent) {
            item.progress = percent;
            if (hooks.onProgress) hooks.onProgress(item, percent);
          }
        });
        item.status = 'done';
        item.path = resp.path;
        item.url = resp.url;
        if (hooks.onSuccess) hooks.onSuccess(item, resp);
      } catch (err) {
        item.status = 'error';
        item.error = err && err.message ? err.message : String(err);
        if (hooks.onError) hooks.onError(item, err);
      }
    }
  }

  global.MediaKit = global.MediaKit || {};
  global.MediaKit.uploader = {
    MAX_DIM: MAX_DIM,
    MAX_SIZE: MAX_SIZE,
    getUploadUrl: getUploadUrl,
    setApiRoot: setApiRoot,
    setBackendStatusProvider: setBackendStatusProvider,
    compressImage: compressImage,
    uploadImage: uploadImage,
    uploadFiles: uploadFiles
  };
})(typeof window !== 'undefined' ? window : globalThis);
