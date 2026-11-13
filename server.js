// 로컬 개발용: npm run dev  (배포는 Vercel이 api/main.js 와 정적 파일을 직접 서빙)
const http = require('http'), fs = require('fs'), path = require('path');
const api = require('./api/main');
const PORT = process.env.PORT || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const OK = ['emoji', 'asset'].map(d => path.join(__dirname, d) + path.sep);

http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return api(req, res);
  let f; try { f = req.url === '/' ? '/index.html' : decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { f = ''; }
  const p = path.join(__dirname, f);
  if (f !== '/index.html' && !OK.some(d => p.startsWith(d))) { res.writeHead(404); return res.end(); }
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(d);
  });
}).listen(PORT, () => console.log('http://localhost:' + PORT));
