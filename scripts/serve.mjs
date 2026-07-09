// Minimal static dev server — no external deps (self-contained ethos, matches the
// strict-CSP target). Serves the repo root so ES-module imports resolve as they
// will in production. PORT via env so concurrent Playwright runs each get their
// own port (test#E9 — a shared port causes phantom failures).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = normalize(join(new URL('.', import.meta.url).pathname, '..'));
const PORT = Number(process.env.PORT || 8792);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent((req.url || '/').split('?')[0]);
    if (path === '/') path = '/index.html';
    const full = normalize(join(ROOT, path));
    if (!full.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const body = await readFile(full);
    res.writeHead(200, { 'content-type': TYPES[extname(full)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
}).listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}`));
