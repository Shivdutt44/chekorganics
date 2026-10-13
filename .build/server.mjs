import http from 'http';
import fs from 'fs';
import path from 'path';

const root = path.resolve('.');
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.webp':'image/webp', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.json':'application/json', '.ico':'image/x-icon' };
const UPSTREAM = 'https://www.chekorganics.com';
const cache = new Map(); // url -> { at, body }

async function proxy(res, upstreamPath, contentType) {
  const hit = cache.get(upstreamPath);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) {
    res.writeHead(200, { 'content-type': contentType, 'access-control-allow-origin': '*', 'x-catalog-source': 'chekorganics.com (cached)' });
    return res.end(hit.body);
  }
  try {
    const r = await fetch(UPSTREAM + upstreamPath, { headers: { 'user-agent': 'CHEKORGANICS-preview/1.0' } });
    if (!r.ok) throw new Error('upstream ' + r.status);
    const body = Buffer.from(await r.arrayBuffer());
    cache.set(upstreamPath, { at: Date.now(), body });
    res.writeHead(200, { 'content-type': contentType, 'access-control-allow-origin': '*', 'x-catalog-source': 'chekorganics.com (live)' });
    res.end(body);
  } catch (e) {
    if (hit) {
      res.writeHead(200, { 'content-type': contentType, 'access-control-allow-origin': '*', 'x-catalog-source': 'chekorganics.com (stale cache)' });
      return res.end(hit.body);
    }
    res.writeHead(502, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
    res.end('upstream unavailable: ' + e.message);
  }
}

http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';

  // live catalog endpoints (so the store stays dynamic without CORS issues)
  if (p === '/api/products.json') return proxy(res, '/products.json?limit=250', 'application/json; charset=utf-8');
  if (p === '/api/collections.json') return proxy(res, '/collections.json', 'application/json; charset=utf-8');

  let file = path.join(root, p);
  // clean URLs like GitHub Pages: /shop → shop.html
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    const idx = path.join(file, 'index.html');
    if (fs.existsSync(idx)) file = idx;
  }
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const page404 = path.join(root, '404.html');
    if (fs.existsSync(page404)) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      return fs.createReadStream(page404).pipe(res);
    }
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(4173, () => console.log('serving on http://localhost:4173'));
