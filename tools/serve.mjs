// Tiny static server so the game can load over http instead of file://, which
// ES module imports and GLB fetches both require.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.argv[2]) || 8173;
const ROOT = process.argv[3] || process.cwd();
// isolated: the page is cross-origin isolated (COOP and COEP), which gives
// performance.now() a clock of microseconds instead of a tenth of a
// millisecond (tools/perf_check.mjs). Everything here is same-origin.
const ISOLATED = process.argv[4] === 'isolated';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.gltf.js': 'text/javascript; charset=utf-8',
  '.obj': 'text/plain; charset=utf-8',
  '.mtl': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.css': 'text/css; charset=utf-8',
};

// Where it listens: this machine only, on both loopback addresses
// ("localhost" is ::1 to some clients and 127.0.0.1 to others). HOST=0.0.0.0
// opens it to the network, when another device is to load the page.
const HOSTS = process.env.HOST ? [process.env.HOST] : ['127.0.0.1', '::1'];

const serve = async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '') p = '/index.html';

    const full = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    const info = await stat(full);
    if (info.isDirectory()) {
      res.writeHead(302, { Location: p.replace(/\/?$/, '/') + 'index.html' });
      res.end();
      return;
    }

    const body = await readFile(full);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Content-Length': body.length,
      ...(ISOLATED ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } : {}),
    });
    res.end(body);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
    res.end(e.code === 'ENOENT' ? 'not found' : String(e));
  }
};

let up = 0;
for (const host of HOSTS) {
  const server = createServer(serve);
  server.on('error', (e) => {
    // A machine with no IPv6 loopback: the other address serves.
    if (HOSTS.length > 1 && host === '::1' && (e.code === 'EADDRNOTAVAIL' || e.code === 'EAFNOSUPPORT')) return;
    throw e;
  });
  server.listen(PORT, host, () => {
    if (!up++) console.log('serving ' + ROOT + ' on http://localhost:' + PORT);
  });
}
