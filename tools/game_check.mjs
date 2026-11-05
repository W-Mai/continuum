// Headless integration check. Loads the real page in Chrome, runs the game loop
// for N simulated seconds, then asserts on what actually happened.
//
// Usage: node tools/game_check.mjs [seconds]

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8174;
const ROOT = new URL('..', import.meta.url).pathname;
const SECONDS = Number(process.argv[2]) || 30;

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
      '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--window-size=1280,800',
      '--virtual-time-budget=' + budgetMs, '--dump-dom',
      '--user-data-dir=/tmp/ed-chrome-check', url,
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

  const url = `http://localhost:${PORT}/index.html?diag=1&auto=1&switch=8`;
  const budget = Math.round(SECONDS * 1000) + 5000;

  let result;
  try {
    result = await runChrome(url, budget);
  } finally {
    server.kill();
  }

  const diag = extractJson(result.out);
  if (!diag) {
    const title = /<title>(.*?)<\/title>/.exec(result.out);
    console.error('no diagnostics in DOM. title:', title ? title[1] : '(none)');
    const err = /<pre id="err">([\s\S]*?)<\/pre>/.exec(result.out);
    if (err) console.error('page error:\n' + err[1].slice(0, 1200));
    console.error(result.err.slice(-1000));
    process.exit(1);
  }

  console.log(JSON.stringify(diag, null, 2));

  const s = diag.summary;
  const problems = [];
  if (!s.carLoaded) problems.push('car model never loaded');
  if (s.frames < SECONDS * 12) problems.push(`only ${s.frames} frames in ${SECONDS}s`);
  if (s.distance < SECONDS * 10) problems.push(`travelled only ${s.distance} m`);
  if (s.offRoadPercent > 6) problems.push(`off road ${s.offRoadPercent}% of frames`);
  if (s.transitions < 1) problems.push('no biome transition happened');
  if (s.biomesSeen < 2) problems.push(`only ${s.biomesSeen} biomes visited`);
  if (s.geometryGrowth > 6) problems.push(`geometry count grew by ${s.geometryGrowth} (leak)`);
  if (s.maxBlendStep > 0.09) {
    problems.push(`blend jumped ${s.maxBlendStep.toFixed(3)} between frames`);
  }
  if (s.finalTrackSamples > 2400) problems.push(`track cache grew to ${s.finalTrackSamples}`);
  if (s.liveRoadChunks > 40) problems.push(`road pool leaked (${s.liveRoadChunks} live)`);

  if (problems.length) {
    console.error('\nFAIL:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.error(`\nOK: ${SECONDS}s, ${Math.round(s.distance)} m, ${s.biomesSeen} biomes`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
