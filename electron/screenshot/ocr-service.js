/**
 * ocr-service.js — 离线 OCR 服务（RapidOCR / PaddleOCR PP-OCRv4 onnx）
 *
 * 原理：PaddleOCR 官方 PP-OCRv4 模型导出为 onnx，用 onnxruntime-node 离线推理。
 *   管线：图像预处理 → det（文本检测）→ DB 后处理（文本框）→ cls（方向分类）→
 *         rec（文本识别，CTC 解码）→ 拼接文本。
 * 模型文件：electron/screenshot/ocr-models/（ch_PP-OCRv4_{det,rec,cls}_infer.onnx
 *         + ppocr_keys_v1.txt），由 download-ocr-models.ps1 下载。
 *
 * 依赖：onnxruntime-node（用户环境 npm i + electron-builder install-app-deps）、sharp。
 * 未安装/模型缺失时 status() 返回 available:false，上层降级提示，不影响截图主体。
 */
const fs = require('fs');
const path = require('path');

let MODELS_DIR = path.join(__dirname, 'ocr-models'); // 默认源码模式；打包环境由 service 注入 userData
/** 设置模型目录（打包环境 userData/ocr-models） */
function setModelsDir(dir) { if (dir) MODELS_DIR = dir; }
const DET_MODEL = 'ch_PP-OCRv4_det_infer.onnx';
const REC_MODEL = 'ch_PP-OCRv4_rec_infer.onnx';
const CLS_MODEL = 'ch_PP-OCRv4_cls_infer.onnx';
const DICT_FILE = 'ppocr_keys_v1.txt';

/** 推理会话与字典缓存 */
let sessions = null;
let dict = null;
let ort = null;   // onnxruntime-node
let sharp = null; // sharp（图像解码/缩放）

/** 惰性初始化：加载 onnxruntime + 模型；失败返回 null（上层降级） */
function init() {
  if (sessions) return sessions;
  try {
    if (!ort) ort = require('onnxruntime-node');
    if (!sharp) sharp = require('sharp');
    // 必需：det + rec + 字典；cls（方向分类）可选（缺失时跳过，正立文本不受影响）
    const required = [DET_MODEL, REC_MODEL, DICT_FILE];
    const hasAll = required.every(f => fs.existsSync(path.join(MODELS_DIR, f)));
    if (!hasAll) return null;
    dict = fs.readFileSync(path.join(MODELS_DIR, DICT_FILE), 'utf-8').split(/\r?\n/).filter(Boolean);
    sessions = {
      det: ort.InferenceSession.create(path.join(MODELS_DIR, DET_MODEL)),
      rec: ort.InferenceSession.create(path.join(MODELS_DIR, REC_MODEL)),
      cls: fs.existsSync(path.join(MODELS_DIR, CLS_MODEL))
        ? ort.InferenceSession.create(path.join(MODELS_DIR, CLS_MODEL))
        : null
    };
    return sessions;
  } catch (e) {
    sessions = null;
    return null;
  }
}

/** 查询 OCR 可用状态 */
function status() {
  let ortOk = true;
  try { require.resolve('onnxruntime-node'); } catch (e) { ortOk = false; }
  if (!ortOk) return { available: false, reason: 'onnxruntime-node 未安装（npm i onnxruntime-node + electron-builder install-app-deps）' };
  // 必需模型（det/rec/字典）；cls 可选
  const required = ['ch_PP-OCRv4_det_infer.onnx', 'ch_PP-OCRv4_rec_infer.onnx', 'ppocr_keys_v1.txt'];
  const missing = required.filter(f => !fs.existsSync(path.join(MODELS_DIR, f)));
  if (missing.length > 0) {
    return { available: false, reason: 'OCR 模型缺失：' + missing.join(', ') + '（模型目录 ' + MODELS_DIR + '，可用一键安装）' };
  }
  const clsOk = fs.existsSync(path.join(MODELS_DIR, CLS_MODEL));
  return { available: true, reason: clsOk ? '' : '（可选的方向分类模型缺失，正立文本识别不受影响）' };
}

// ==================== 图像预处理 ====================

/** 解码 png 为 RGB 浮点数组（CHW, 0-1）并返回宽高 */
async function decodeToRgb(pngBuffer) {
  const { data, info } = await sharp(pngBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  // data: RGB 每像素 3 字节，行优先
  const { width, height } = info;
  return { data, width, height };
}

/** 图像 resize 到目标尺寸（sharp 完成）→ 返回 RGB buffer + 宽高 */
async function resizeImage(pngBuffer, width, height) {
  const { data, info } = await sharp(pngBuffer)
    .removeAlpha()
    .resize(width, height, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** RGB buffer → NCHW Float32Array（归一化 mean/std，PP-OCR 标准） */
function rgbToNchw(rgb, width, height, mean, std) {
  const n = width * height;
  const out = new Float32Array(3 * n);
  const m = mean || [0.485, 0.456, 0.406];
  const s = std || [0.229, 0.224, 0.225];
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
    out[i] = (r / 255 - m[0]) / s[0];
    out[n + i] = (g / 255 - m[1]) / s[1];
    out[2 * n + i] = (b / 255 - m[2]) / s[2];
  }
  return out;
}

/** 创建 onnx Tensor（NCHW float） */
function makeTensor(data, width, height) {
  return new ort.Tensor('float32', data, [1, 3, height, width]);
}

// ==================== det 后处理（DB 算法简化版） ====================

/**
 * 从 probability map 提取文本框。
 * 简化实现：阈值二值化 → 4-邻域连通域 → 每个连通域取外接矩形（可扩展为 minAreaRect）。
 */
function extractTextBoxes(probMap, width, height, threshold, minArea) {
  const thr = threshold || 0.3;
  const minA = minArea || 8;
  const visited = new Uint8Array(width * height);
  const boxes = [];
  const stack = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx] || probMap[idx] <= thr) continue;
      // BFS 连通域
      stack.push(idx);
      visited[idx] = 1;
      let minX = x, maxX = x, minY = y, maxY = y, count = 0;
      while (stack.length) {
        const cur = stack.pop();
        const cx = cur % width, cy = (cur / width) | 0;
        if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
        count++;
        const neighbors = [
          cy > 0 ? cur - width : -1,
          cy < height - 1 ? cur + width : -1,
          cx > 0 ? cur - 1 : -1,
          cx < width - 1 ? cur + 1 : -1
        ];
        for (const nb of neighbors) {
          if (nb >= 0 && !visited[nb] && probMap[nb] > thr) {
            visited[nb] = 1;
            stack.push(nb);
          }
        }
      }
      if (count >= minA) {
        boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, count });
      }
    }
  }
  // 按 y 排序（阅读顺序近似）
  boxes.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return boxes;
}

// ==================== 主识别管线 ====================

/**
 * 识别 PNG 图片文字。
 * @param {Buffer} pngBuffer
 * @returns {Promise<{text: string, lines: Array<{text, x, y, w, h}>}|null>}
 */
async function recognize(pngBuffer) {
  const ss = init();
  if (!ss) return null;
  const sharpMod = sharp;
  const { width: srcW, height: srcH } = await sharpMod(pngBuffer).metadata();

  // ---- det：resize 到高 960 ----
  const detH = 960;
  const detW = Math.max(32, Math.round(srcW * (detH / srcH)));
  const detImg = await resizeImage(pngBuffer, detW, detH);
  const detInput = rgbToNchw(detImg.data, detW, detH);
  const detOut = await ss.det.run({ x: makeTensor(detInput, detW, detH) });
  // probability map: 输出名通常是 'sigmoid_0.tmp_0' 或 'out'，取第一个 float 输出
  const probTensor = firstFloatTensor(detOut);
  const prob = probTensor.data; // HxW
  const pW = detW, pH = detH;

  const scaleX = srcW / detW;
  const scaleY = srcH / detH;
  const boxes = extractTextBoxes(prob, pW, pH, 0.3, 12);

  // ---- rec：对每个文本框识别 ----
  const lines = [];
  const recH = 48;             // PP-OCR rec 输入高 48
  const maxRecW = 320;
  const blankIdx = dict.length; // CTC blank 在字典末尾

  for (const box of boxes) {
    // 映射回原图坐标 + 外扩 4px
    const x = Math.max(0, Math.round(box.x * scaleX) - 4);
    const y = Math.max(0, Math.round(box.y * scaleY) - 4);
    const w = Math.min(srcW - x, Math.round(box.w * scaleX) + 8);
    const h = Math.min(srcH - y, Math.round(box.h * scaleY) + 8);
    if (w < 4 || h < 4) continue;

    // 裁剪文本框并 resize 到 rec 输入（保持比例，宽动态）
    const crop = await sharpMod(pngBuffer).extract({ left: x, top: y, width: w, height: h }).toBuffer();
    const recW = Math.min(maxRecW, Math.max(16, Math.round(w * (recH / h))));
    const recImg = await resizeImage(crop, recW, recH);
    const recInput = rgbToNchw(recImg.data, recW, recH);
    const recOut = await ss.rec.run({ x: makeTensor(recInput, recW, recH) });
    const recProbs = firstFloatTensor(recOut).data; // [recW, dict+blank]
    const text = ctcDecode(recProbs, recW, dict, blankIdx);
    if (text) lines.push({ text, x, y, w, h });
  }

  return {
    text: lines.map(l => l.text).join('\n'),
    lines
  };
}

/** 从推理输出中取第一个 Float32Array 张量 */
function firstFloatTensor(output) {
  for (const key of Object.keys(output)) {
    const t = output[key];
    if (t && t.data && t.data instanceof Float32Array) return t;
  }
  throw new Error('OCR 模型输出解析失败');
}

/** CTC 贪心解码（去重 + 去 blank） */
function ctcDecode(probs, width, dictArr, blankIdx) {
  let last = blankIdx;
  let text = '';
  for (let i = 0; i < width; i++) {
    let best = blankIdx;
    let bestP = probs[i * (dictArr.length + 1)];
    for (let c = 0; c < dictArr.length; c++) {
      const p = probs[i * (dictArr.length + 1) + 1 + c];
      if (p > bestP) { bestP = p; best = c; }
    }
    if (best !== blankIdx && best !== last) text += dictArr[best];
    last = best;
  }
  return text.trim();
}

module.exports = { recognize, status, setModelsDir, modelsDir: MODELS_DIR };
