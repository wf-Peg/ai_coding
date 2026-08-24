/**
 * 去除 mascot 图标的背景色（将角落采样到的背景色设为透明）
 * 使用 sharp 库处理图片，输出真正的 PNG（含 alpha 通道）
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const MASCOT_DIR = path.join(__dirname, '..', 'frontend', 'assets', 'mascot');
const TOLERANCE = 40; // 颜色容差（0-255），值越大去除越多
const BG_SAMPLE_SIZE = 3; // 角部采样像素数

/**
 * 从图片四角采样背景色
 */
function sampleBgColor(data, width, height) {
  let rSum = 0, gSum = 0, bSum = 0, count = 0;

  // 采样四个角 (BG_SAMPLE_SIZE × BG_SAMPLE_SIZE 区域)
  const corners = [
    [0, 0],                                          // 左上
    [width - BG_SAMPLE_SIZE, 0],                     // 右上
    [0, height - BG_SAMPLE_SIZE],                    // 左下
    [width - BG_SAMPLE_SIZE, height - BG_SAMPLE_SIZE] // 右下
  ];

  for (const [cx, cy] of corners) {
    for (let y = Math.max(0, cy); y < Math.min(height, cy + BG_SAMPLE_SIZE); y++) {
      for (let x = Math.max(0, cx); x < Math.min(width, cx + BG_SAMPLE_SIZE); x++) {
        const idx = (y * width + x) * 3;
        if (idx + 2 < data.length) {
          rSum += data[idx];
          gSum += data[idx + 1];
          bSum += data[idx + 2];
          count++;
        }
      }
    }
  }

  return {
    r: Math.round(rSum / count),
    g: Math.round(gSum / count),
    b: Math.round(bSum / count)
  };
}

/**
 * 去除单张图片背景
 */
async function removeBackground(inputPath, outputPath) {
  const image = sharp(inputPath);
  const metadata = await image.metadata();

  // 读取原始 RGB 像素数据
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

  // 采样背景色
  const bg = sampleBgColor(data, info.width, info.height);
  console.log(`  Background: rgb(${bg.r},${bg.g},${bg.b})`);

  // 创建 RGBA 缓冲区（原 RGB + 计算出的 alpha）
  const rgba = Buffer.alloc(info.width * info.height * 4);

  for (let i = 0; i < info.width * info.height; i++) {
    const srcIdx = i * 3;
    const dstIdx = i * 4;
    const r = data[srcIdx];
    const g = data[srcIdx + 1];
    const b = data[srcIdx + 2];

    // 计算与背景色的欧几里得距离
    const dist = Math.sqrt(
      (r - bg.r) ** 2 +
      (g - bg.g) ** 2 +
      (b - bg.b) ** 2
    );

    rgba[dstIdx] = r;
    rgba[dstIdx + 1] = g;
    rgba[dstIdx + 2] = b;
    // 距离大于容差 → 不透明；否则透明
    rgba[dstIdx + 3] = dist > TOLERANCE ? 255 : 0;
  }

  // 写出真正的 PNG（含 alpha 通道）
  await sharp(rgba, {
    raw: { width: info.width, height: info.height, channels: 4 }
  }).png().toFile(outputPath);

  console.log(`  -> ${path.basename(outputPath)}  ✓`);
}

/**
 * 批量处理所有 mascot 图片
 */
async function main() {
  const characters = ['robot-blue', 'pikachu-yellow', 'turtle-green', 'luoxiaohei'];
  const actions = ['run', 'wave', 'jump', 'think', 'sleep', 'celebrate'];

  let total = 0;
  for (const character of characters) {
    const charDir = path.join(MASCOT_DIR, character);
    console.log(`\n=== ${character} ===`);
    for (const action of actions) {
      const inputPath = path.join(charDir, `${action}.png`);
      const tmpPath = path.join(charDir, `${action}.tmp.png`); // 临时文件

      if (!fs.existsSync(inputPath)) {
        console.log(`  ${action}.png 不存在，跳过`);
        continue;
      }

      try {
        await removeBackground(inputPath, tmpPath);
        // 替换原文件
        fs.renameSync(tmpPath, inputPath);
        total++;
      } catch (err) {
        console.error(`  ${action}.png 处理失败:`, err.message);
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      }
    }
  }

  console.log(`\n全部完成！共处理 ${total} 张图片`);
}

main().catch(console.error);