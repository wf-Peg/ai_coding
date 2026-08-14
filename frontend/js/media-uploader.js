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

  /** 上传地址：{API_ROOT}/media/upload */
  function getUploadUrl() {
    var root = global.API_ROOT || (global.API_BASE_URL ? String(global.API_BASE_URL).replace(/\/clip\/?$/, '') : '');
    return root + '/media/upload';
  }

  /**
   * canvas 压缩图片。
   * @param {File} file 图片文件
   * @returns {Promise<Blob>} 压缩后的 Blob
   */
  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !file.type || file.type.indexOf('image/') !== 0) {
        return reject(new Error('不是图片文件: ' + (file && file.name)));
      }
      // gif 动图保持原样（canvas 会丢失动画）
      if (file.type === 'image/gif') {
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
          var mime = (file.type === 'image/png') ? 'image/png' : 'image/jpeg';
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
      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable && callbacks && callbacks.onProgress) {
          callbacks.onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = function () {
        try {
          var resp = JSON.parse(xhr.responseText);
          if (xhr.status === 200 && resp.status === 'success') {
            resolve(resp);
          } else {
            reject(new Error(resp && resp.message ? resp.message : '上传失败（HTTP ' + xhr.status + '）'));
          }
        } catch (e) {
          reject(new Error('上传响应解析失败'));
        }
      };
      xhr.onerror = function () { reject(new Error('网络错误，上传失败')); };
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
    compressImage: compressImage,
    uploadImage: uploadImage,
    uploadFiles: uploadFiles
  };
})(typeof window !== 'undefined' ? window : globalThis);
