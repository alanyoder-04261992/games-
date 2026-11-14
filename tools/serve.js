// Tiny static file server for local testing: `npm start` then open http://localhost:8080
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleTrack, handleInsights } from '../netlify/lib/insights.mjs';
import { fileStore } from './dev-blobs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const port = Number(process.env.PORT || process.argv[2] || 8080);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8',
};

// The owner's play insights work locally too, stored in .insights-dev/ (key: INSIGHTS_KEY, or
// "local"). On Netlify the same code runs as functions; see docs/INSIGHTS.md.
const insightsStore = fileStore(path.resolve(root, '..', '.insights-dev'));
const insightsKey = process.env.INSIGHTS_KEY || 'local';
async function api(req, res, handler) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(new URL(req.url, `http://localhost:${port}`), { method: req.method, headers: req.headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body });
  const out = await handler(request);
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/api/track') return void api(req, res, (r) => handleTrack(r, insightsStore));
  if (p === '/api/insights') return void api(req, res, (r) => handleInsights(r, insightsStore, insightsKey));
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || file.includes(`${path.sep}node_modules${path.sep}`)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}).listen(port, () => console.log(`Game Center on http://localhost:${port}  (play insights: http://localhost:${port}/#/insights, key "${insightsKey}")`));
