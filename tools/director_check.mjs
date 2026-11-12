// Runs the director for a few simulated minutes on several roads and checks
// what a viewer would notice: the car leaving the frame or hidden behind a
// hillside or a parapet, the lens inside a hillside, a jump with no dissolve,
// the same shot over and over. Every frame is audited inside the page
// (Director.audit); this script only reads the totals.
//
// Usage: node tools/director_check.mjs [seconds] [seed ...]
// Also runs the first seed on a portrait screen, and with seed 7 over its
// viaduct and in the worlds where more than the land can block the view.

import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
// Headless WebGL fails on Linux while DISPLAY is set.
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = 8177;
const ROOT = new URL('..', import.meta.url).pathname;
const SECONDS = Number(process.argv[2]) || 180;
const SEEDS = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [7, 42, 3];

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

function runChrome(url, size, tag) {
  const profile = `${tmpdir()}/continuum-director-${process.pid}-${tag}`;
  return new Promise((resolve, reject) => {
    const p = spawn(CHROME, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--window-size=' + size,
      '--virtual-time-budget=' + (SECONDS * 400 + 60000), '--dump-dom',
      `--user-data-dir=${profile}`, url,
    ], { stdio: ['ignore', 'pipe', 'pipe'], env: CHROME_ENV });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('exit', () => {
      rmSync(profile, { recursive: true, force: true });
      resolve(out);
    });
    p.on('error', reject);
  });
}

function extract(dom) {
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

  const cases = SEEDS.map((seed) => ({ seed, size: '1280,720', s: 0 }));
  cases.push({ seed: SEEDS[0], size: '720,1280', s: 0 });
  // The first minutes of a road have only short bridges. Seed 7's 1.2 km
  // viaduct starts at K6+472, where a lens beside or under a deck can lose
  // the car behind the parapet.
  if (SEEDS[0] === 7) cases.push({ seed: 7, size: '1280,720', s: 6000 });
  // The worlds where something other than the land can stand in the way:
  // the city's towers, the cavern's roof, heaven's sea of cloud, the deep
  // sea and the road through space.
  if (SEEDS[0] === 7) {
    for (const world of ['city', 'cavern', 'heaven', 'abyss', 'space']) cases.push({ seed: 7, size: '1280,720', s: 0, world });
  }
  const rows = [];
  const problems = [];
  try {
    for (const c of cases) {
      const url = `http://localhost:${PORT}/index.html?seed=${c.seed}&run=${SECONDS * 60}&cam=director&dirstats=1${c.s ? '&s=' + c.s : ''}${c.world ? '&world=' + c.world : ''}`;
      const d = extract(await runChrome(url, c.size, `${c.seed}-${c.size}-${c.s}-${c.world || ''}`));
      const tag = `seed ${c.seed} ${c.size}${c.s ? ' from K' + c.s / 1000 : ''}${c.world ? ' in ' + c.world : ''}`;
      if (!d || !d.director || !d.director.audit) {
        problems.push(`${tag}: no diagnostics`);
        continue;
      }
      const a = d.director.audit;
      const time = a.time || {};
      const types = Object.keys(time);
      const top = types.reduce((m, k) => Math.max(m, time[k] / a.frames), 0);
      const row = {
        case: tag,
        km: +(d.distance / 1000).toFixed(1),
        shots: d.director.cuts + d.director.glides,
        types: types.length,
        inFrame: +(a.inFrame / a.frames * 100).toFixed(2),
        hidden: +((a.hidden || 0) / a.frames * 100).toFixed(2),
        inside: a.inside || 0,
        hardCuts: a.hardCuts || 0,
        chaseSteps: a.chaseSteps || 0,
        topShare: +(top * 100).toFixed(0),
      };
      rows.push(row);
      if (row.inFrame < 98) problems.push(`${tag}: car in frame ${row.inFrame}% of the time`);
      if (row.hidden > 1.5) problems.push(`${tag}: car behind the land or a parapet ${row.hidden}% of the time`);
      if (row.hardCuts) problems.push(`${tag}: ${row.hardCuts} jump(s) with no dissolve`);
      if (row.inside > a.frames * 0.002) problems.push(`${tag}: lens inside the land for ${row.inside} frames`);
      if (row.types < 4) problems.push(`${tag}: only ${row.types} kinds of shot`);
      if (top > 0.5) problems.push(`${tag}: one kind of shot holds ${row.topShare}% of the time`);
    }
  } finally {
    server.kill();
  }
  console.table(rows);
  if (problems.length) {
    console.error('\nFAIL:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.error(`\nOK: ${cases.length} runs of ${SECONDS} s, the car in frame and in sight, no jump without a dissolve`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
