// Capture a frame and its diagnostics from ONE page run, so the numbers describe
// exactly the pixels being written. Chrome's --screenshot composites a stale GL
// layer under a virtual-time budget, so the frame comes out of the page instead.
//
// Usage: node tools/shot.mjs [out.png] [frames] ["extra query"]
//   e.g. node tools/shot.mjs out/viaduct.png 90 "seed=7&s=6900&cam=drone&hideui=1"
// SHOT_SIZE=w,h sets the window; CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
// Headless WebGL fails on Linux while DISPLAY is set.
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = 8177;
const ROOT = new URL('..', import.meta.url).pathname;

const [out = 'out/shots/shot.png', frames = '120', extra = ''] = process.argv.slice(2);

function serve() {
  return spawn('node', [ROOT + 'tools/serve.mjs', String(PORT), ROOT], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

async function waitUp(port, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/`)).ok) return true;
    } catch { /* not started yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function chrome(url, budget) {
  const profile = join(tmpdir(), 'continuum-shot-' + process.pid + '-' + Date.now());
  return new Promise((resolve, reject) => {
    const p = spawn(CHROME, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--window-size=' + (process.env.SHOT_SIZE || '1280,720'),
      '--virtual-time-budget=' + budget, '--dump-dom',
      '--user-data-dir=' + profile, url,
    ], { stdio: ['ignore', 'pipe', 'pipe'], env: CHROME_ENV });
    let text = '';
    p.stdout.on('data', (d) => { text += d; });
    p.on('exit', () => {
      rmSync(profile, { recursive: true, force: true });
      resolve(text);
    });
    p.on('error', reject);
  });
}

const server = serve();
try {
  if (!await waitUp(PORT)) throw new Error('server did not start');
  // A duplicated query key makes params.get() return the first one, so a caller's
  // value is silently ignored. Pin a default only when the caller left it out.
  const pin = (key, value) =>
    new RegExp('(?<![\\w-])' + key + '=').test(extra) ? '' : `&${key}=${value}`;
  const url = `http://localhost:${PORT}/index.html?diag=1&run=${frames}` + pin('seed', 7) + `&${extra}`;
  const dom = await chrome(url, Number(frames) * 200 + 60000);

  const frame = /<script id="frame"[^>]*>([\s\S]*?)<\/script>/.exec(dom);
  if (!frame) {
    const title = /<title>(.*?)<\/title>/.exec(dom);
    throw new Error('no frame captured; title=' + (title ? title[1] : 'none'));
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(frame[1].replace(/^data:image\/png;base64,/, '').trim(), 'base64'));

  const diag = /<script id="diag"[^>]*>([\s\S]*?)<\/script>/.exec(dom);
  if (diag) {
    const d = JSON.parse(diag[1]);
    console.log(`${out} | ${d.distance} m | ${d.speedKmh} km/h | ${d.structure} | `
      + `${d.drawCalls} calls | ${Math.round(d.triangles / 1000)}k tris | ${d.trees} trees`);
  } else {
    console.log(out + ' (no diag)');
  }
} finally {
  server.kill();
}
