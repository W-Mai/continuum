// Headless integration check. Loads the real page in Chrome, runs the game loop
// for N simulated seconds (world built synchronously, last frame rendered),
// then asserts on what actually happened.
//
// Usage: node tools/game_check.mjs [seconds] [seed]
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
const PORT = 8174;
const ROOT = new URL('..', import.meta.url).pathname;
const SECONDS = Number(process.argv[2]) || 60;
const SEED = Number(process.argv[3] ?? 7);

function serve() {
  return spawn('node', [ROOT + 'tools/serve.mjs', String(PORT), ROOT], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

async function waitForServer(port, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://localhost:${port}/`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function runChrome(url, budgetMs) {
  return new Promise((resolve, reject) => {
    const args = [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--window-size=1280,720',
      '--virtual-time-budget=' + budgetMs, '--dump-dom',
      `--user-data-dir=${tmpdir()}/continuum-check-${process.pid}`, url,
    ];
    const p = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('exit', (code) => resolve({ code, out, err }));
    p.on('error', reject);
  });
}

function extractJson(dom) {
  const m = /<script id="diag"[^>]*>([\s\S]*?)<\/script>/.exec(dom);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

async function main() {
  if (!existsSync(ROOT + 'out/car.glb')) {
    console.error('out/car.glb missing; run python3 build.py first');
    process.exit(1);
  }
  const server = serve();
  if (!await waitForServer(PORT)) {
    server.kill();
    console.error('server did not start');
    process.exit(1);
  }
  const url = `http://localhost:${PORT}/index.html?seed=${SEED}&run=${SECONDS * 60}`;
  let result;
  try {
    result = await runChrome(url, SECONDS * 400 + 60000);
  } finally {
    server.kill();
  }

  const d = extractJson(result.out);
  if (!d) {
    const title = /<title>(.*?)<\/title>/.exec(result.out);
    console.error('no diagnostics in DOM. title:', title ? title[1] : '(none)');
    const err = /<pre id="err">([\s\S]*?)<\/pre>/.exec(result.out);
    if (err) console.error('page error:\n' + err[1].slice(0, 1200));
    console.error(result.err.slice(-1000));
    process.exit(1);
  }
  console.log(JSON.stringify(d, null, 2));

  const problems = [];
  if (!d.carLoaded) problems.push('car model never loaded');
  if (d.distance < SECONDS * 12) problems.push(`travelled only ${d.distance} m`);
  if (d.wrecks > 0) problems.push(`${d.wrecks} wrecks`);
  if (d.hits > Math.ceil(SECONDS / 120)) problems.push(`${d.hits} collisions`);
  if (Math.abs(d.lateral) > 3.6) problems.push(`ended ${d.lateral} m off the centreline`);
  if (d.roadChunks > 80) problems.push(`road chunks leaked (${d.roadChunks} live)`);
  if (d.geometries > 1500) problems.push(`geometry count ${d.geometries}`);
  if (!d.trees) problems.push('no forest');
  if (problems.length) {
    console.error('\nFAIL:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.error(`\nOK: ${SECONDS}s, ${Math.round(d.distance)} m, ${d.hits} hits, ${d.wrecks} wrecks`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
