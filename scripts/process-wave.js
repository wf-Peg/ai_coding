const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const dstPath = path.join(__dirname, '..', 'frontend', 'assets', 'mascot', 'luoxiaohei', 'wave.png');
const srcPath = path.join(__dirname, '..', '挥手.png');

async function run() {
  const meta = await sharp(srcPath).metadata();
  console.log(`Source: ${meta.width}x${meta.height}`);

  const buf = await sharp(srcPath).raw().toBuffer();

  const s = Math.min(5, Math.floor(Math.min(meta.width, meta.height) / 4));
  const corners = [[0,0],[meta.width-s,0],[0,meta.height-s],[meta.width-s,meta.height-s]];
  let r=0,g=0,b=0,c=0;
  for (const [cx,cy] of corners) {
    for (let dy=0;dy<s;dy++) for (let dx=0;dx<s;dx++) {
      const p = ((cy+dy)*meta.width+(cx+dx))*4;
      r+=buf[p]; g+=buf[p+1]; b+=buf[p+2]; c++;
    }
  }
  console.log(`BG: rgb(${Math.round(r/c)},${Math.round(g/c)},${Math.round(b/c)})`);

  const th = 48;
  for (let i=0;i<buf.length;i+=4) {
    if (Math.abs(buf[i]-r/c)<th && Math.abs(buf[i+1]-g/c)<th && Math.abs(buf[i+2]-b/c)<th) buf[i+3]=0;
  }

  fs.mkdirSync(path.dirname(dstPath), { recursive: true });
  await sharp(buf, { raw: { width: meta.width, height: meta.height, channels: 4 } })
    .resize(128, 128, { fit: 'contain', background: { r:0, g:0, b:0, alpha:0 } })
    .png().toFile(dstPath);
  console.log('Done!');
}
run().catch(e => { console.error(e); process.exit(1); });