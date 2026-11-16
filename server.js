const http = require('http'), fs = require('fs'), path = require('path');
const DIR = __dirname;
const TYPES = { '.html':'text/html', '.mp4':'video/mp4', '.webm':'video/webm','.js':'application/javascript','.css':'text/css','.webp':'image/webp','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.yml':'text/yaml','.pdf':'application/pdf' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (req.method === 'POST' && p === '/contact.php') {   // no PHP locally: echo the message and say ok (the real endpoint runs on the host)
    let b = ''; req.on('data', c => b += c); req.on('end', () => { console.log('contact form:', b.slice(0, 300)); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); });
    return;
  }
  if (p.endsWith('/')) p += 'index.html';
  let fp = path.join(DIR, p);
  // page addresses (/portfolio/brace/, /ge/stories/ ...) are real folders only in the staged build; here the app serves them all
  if (!fs.existsSync(fp) && p.endsWith('/index.html') && !p.startsWith('/admin/')) fp = path.join(DIR, 'index.html');
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
