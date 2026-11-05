// Capture a frame by reading it out of the page instead of relying on Chrome's
// --screenshot, which composites a stale GL layer under a virtual-time budget.
//
// The page runs a fixed number of steps inside one task, renders, and writes a
// PNG data URL into the DOM. This script reads the DOM and saves the file.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8177;
const ROOT = new URL('..', import.meta.url).pathname;

const [out = 'out/shots/shot.png', frames = '420', extra = ''] = process.argv.slice(2);

function serve() {
  return spawn('node', [ROOT + 'tools/serve.mjs', String(PORT), ROOT], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

async function waitUp(port, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/`)).ok) return true;
    } catch { /* not started */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function chrome(url, budget) {
  return new Promise((resolve, reject) => {
    const p = spawn(CHROME, [
      '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--window-size=1200,700',
      '--virtual-time-budget=' + budget, '--dump-dom',
      '--user-data-dir=/tmp/ed-shot-' + Date.now(), url,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('exit', () => resolve(out));
    p.on('error', reject);
  });
}

const server = serve();
try {
  if (!await waitUp(PORT)) throw new Error('server did not start');
  const url = `http://localhost:${PORT}/index.html?diag=1&run=${frames}&switch=9999&${extra}`;
  const dom = await chrome(url, Number(frames) * 120 + 25000);
  const m = /<script id="frame"[^>]*>([\s\S]*?)<\/script>/.exec(dom);
  if (!m) {
    const title = /<title>(.*?)<\/title>/.exec(dom);
    throw new Error('no frame captured; title=' + (title ? title[1] : 'none'));
  }
  const b64 = m[1].replace(/^data:image\/png;base64,/, '').trim();
  writeFileSync(out, Buffer.from(b64, 'base64'));
  const diag = /<script id="diag"[^>]*>([\s\S]*?)<\/script>/.exec(dom);
  if (diag) {
    const s = JSON.parse(diag[1]).summary;
    console.log(`${out} | ${s.distance} m | ${s.speedKmh} km/h | ${s.biome || ''} | ${s.drawCalls} calls`);
  } else {
    console.log(out + ' (no diag)');
  }
} finally {
  server.kill();
}
