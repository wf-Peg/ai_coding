// SPA static server — serves files from current directory
// Only falls back to index.html for paths that don't match a real file
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3001;
const ROOT = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// 本机第一个非回环 IPv4（供「发送到手机」生成局域网可达地址）
function getLanIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
        return net.address;
      }
    }
  }
  return '';
}

function serve(req, res) {
  let urlPath = new URL(req.url, `http://127.0.0.1:${PORT}`).pathname;
  if (urlPath === '/') urlPath = '/index.html';

  // 「发送到手机」探测本机局域网地址
  if (urlPath === '/__lan_ip') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ip: getLanIP(), port: PORT }));
    return;
  }

  const filePath = path.join(ROOT, urlPath);

  // Only serve existing files
  if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // SPA fallback: return index.html for non-file routes
  const indexPath = path.join(ROOT, 'index.html');
  fs.readFile(indexPath, (err, data) => {
    if (err) { res.writeHead(500); res.end('Error'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

http.createServer(serve).listen(PORT, () => {
  console.log(`SPA frontend server running at http://localhost:${PORT}`);
});