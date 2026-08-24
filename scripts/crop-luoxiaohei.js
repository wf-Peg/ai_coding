const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const src = path.join(__dirname, '..', '罗小黑.png');
const outDir = path.join(__dirname, '..', 'frontend', 'assets', 'mascot', 'luoxiaohei');
const SIZE = 128;
const actions = ['run', 'wave', 'jump', 'think', 'sleep', 'celebrate'];

async function main() {
  // Ensure output dir exists
  fs.mkdirSync(outDir, { recursive: true });

  // Get image metadata
  const meta = await sharp(src).metadata();
  console.log(`Image size: ${meta.width}x${meta.height}`);

  // Crop first row, first 6 columns
  for (let i = 0; i < 6; i++) {
    const left = i * SIZE;
    const top = 0;
    const outPath = path.join(outDir, `${actions[i]}.png`);
    await sharp(src)
      .extract({ left, top, width: SIZE, height: SIZE })
      .png()
      .toFile(outPath);
    console.log(`Created: ${actions[i]}.png (left=${left}, top=${top})`);
  }

  console.log('Done! 6 icons cropped.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});