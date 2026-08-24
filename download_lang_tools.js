const https = require('https');
const fs = require('fs');
const url = 'https://cdnjs.cloudflare.com/ajax/libs/ace/1.36.2/ext-language_tools.js';
const dest = 'frontend/libs/ace/ext-language_tools.js';

https.get(url, (res) => {
  const data = [];
  res.on('data', (chunk) => data.push(chunk));
  res.on('end', () => {
    fs.writeFileSync(dest, Buffer.concat(data));
    console.log('Downloaded: ' + data.length + ' chunks, size: ' + Buffer.concat(data).length);
  });
}).on('error', (e) => console.error('Error:', e.message));