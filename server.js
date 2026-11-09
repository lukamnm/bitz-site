const http = require('http'), fs = require('fs'), path = require('path');
const DIR = __dirname;
const TYPES = { '.html':'text/html', '.mp4':'video/mp4', '.webm':'video/webm','.js':'application/javascript','.css':'text/css','.webp':'image/webp','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(DIR, p);
  if (!fp.startsWith(DIR) || !fs.existsSync(fp)) { res.writeHead(404); return res.end('nf'); }
  const stat = fs.statSync(fp);
  const type = TYPES[path.extname(fp)] || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m[1] ? parseInt(m[1]) : 0;
    let end = m[2] ? parseInt(m[2]) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': type
    });
    fs.createReadStream(fp, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': type, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(fp).pipe(res);
  }
}).listen(7800, '127.0.0.1', () => console.log('newsite on http://127.0.0.1:7799'));
