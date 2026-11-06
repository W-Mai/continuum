// Capture a frame and its diagnostics from ONE page run, so the numbers describe
// exactly the pixels being written. Chrome's --screenshot composites a stale GL
// layer under a virtual-time budget, so the frame comes out of the page instead.

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
    } catch { /* not started yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function chrome(url, budget) {
  return new Promise((resolve, reject) => {
    const p = spawn(CHROME, [
      '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--window-size=' + (process.env.SHOT_SIZE || '1200,628'),
      '--virtual-time-budget=' + budget, '--dump-dom',
      '--user-data-dir=/tmp/ed-shot-' + Date.now(), url,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    p.stdout.on('data', (d) => { text += d; });
    p.on('exit', () => resolve(text));
    p.on('error', reject);
  });
}

const server = serve();
try {
  if (!await waitUp(PORT)) throw new Error('server did not start');
  // Pin the seed only when the caller did not: a duplicate query key would make
  // params.get() return the first one and silently ignore the requested seed.
  const pinned = /(?<![\w-])seed=/.test(extra) ? '' : '&seed=7';
  const url = `http://localhost:${PORT}/index.html?diag=1&run=${frames}&switch=9999${pinned}&${extra}`;
  const dom = await chrome(url, Number(frames) * 120 + 30000);

  const frame = /<script id="frame"[^>]*>([\s\S]*?)<\/script>/.exec(dom);
  if (!frame) {
    const title = /<title>(.*?)<\/title>/.exec(dom);
    throw new Error('no frame captured; title=' + (title ? title[1] : 'none'));
  }
  writeFileSync(out, Buffer.from(frame[1].replace(/^data:image\/png;base64,/, '').trim(), 'base64'));

  const diag = /<script id="diag"[^>]*>([\s\S]*?)<\/script>/.exec(dom);
  if (diag) {
    const d = JSON.parse(diag[1]);
    const s = d.summary;
    const biome = (d.final && d.final.biome) || '';
    console.log(`${out} | ${s.distance} m | ${s.speedKmh} km/h | ${biome} | ${s.drawCalls} calls`);
    console.log('ribbon:', JSON.stringify(d.ribbon));
    const keys = process.argv[5] ? process.argv[5].split(',') : [];
    for (const k of keys) console.log(k + ':', JSON.stringify(s[k]));
  } else {
    console.log(out + ' (no diag)');
  }
} finally {
  server.kill();
}
