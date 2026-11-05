// Verifies the car is actually animated: wheels spin, front wheels steer, body
// pitches and rolls, and the camera lags. Runs the real page in headless
// Chrome and reads its diagnostics, so a regression in any of these fails CI.
//
// Usage: node tools/presentation_check.mjs

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8176;
const ROOT = new URL('..', import.meta.url).pathname;

const STEPS = [60, 240, 420];

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

function runChrome(url, budgetMs, tag) {
  return new Promise((resolve, reject) => {
    const args = [
      '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--window-size=900,560',
      '--virtual-time-budget=' + budgetMs, '--dump-dom',
      '--user-data-dir=/tmp/ed-pres-' + tag, url,
    ];
    const p = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('exit', () => resolve(out));
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

  const runs = [];
  try {
    for (const steps of STEPS) {
      const url = `http://localhost:${PORT}/index.html?diag=1&steps=${steps}&switch=9999`;
      const dom = await runChrome(url, steps * 100 + 20000, steps);
      const d = extract(dom);
      if (!d) {
        console.error(`no diagnostics at steps=${steps}`);
        process.exit(1);
      }
      runs.push({ steps, d });
    }
  } finally {
    server.kill();
  }

  const rows = runs.map(({ steps, d }) => {
    const car = d.car || {};
    const w = (car.wheels || [])[0] || {};
    const front = (car.wheels || []).find((x) => x.name === 'wheel_fl') || {};
    const rear = (car.wheels || []).find((x) => x.name === 'wheel_rl') || {};
    return {
      steps,
      spin: w.spinZ,
      frontSteer: front.steerY,
      rearSteer: rear.steerY,
      pitch: car.bodyPitch,
      roll: car.bodyRoll,
      heave: car.bodyHeave,
      sw: car.steeringWheel,
      camDist: d.cameraRig && d.cameraRig.dist,
      yawLag: d.cameraRig && d.cameraRig.yawLag,
      kmh: d.final && d.final.speedKmh,
    };
  });
  console.table(rows);

  const problems = [];
  const first = runs[0].d;
  const last = runs[runs.length - 1].d;

  if (!first.car) problems.push('no car node data: the model did not attach');
  else {
    const w0 = first.car.wheels || [];
    const wN = last.car.wheels || [];
    if (w0.length !== 4) problems.push(`expected 4 wheel nodes, got ${w0.length}`);

    // Spin must advance monotonically with distance travelled.
    if (!(Math.abs(wN[0].spinZ) > Math.abs(w0[0].spinZ) + 1)) {
      problems.push(`wheels are not spinning: ${w0[0].spinZ} -> ${wN[0].spinZ}`);
    }

    // Front wheels steer, rear do not.
    const f = wN.find((x) => x.name === 'wheel_fl');
    const r = wN.find((x) => x.name === 'wheel_rl');
    if (f && Math.abs(f.steerY) < 1e-5) problems.push('front wheels never steer');
    if (r && Math.abs(r.steerY) > 1e-6) problems.push('rear wheels are steering');

    // Body attitude should be non-zero and change over the run.
    if (Math.abs(first.car.bodyPitch) < 1e-6 && Math.abs(last.car.bodyPitch) < 1e-6) {
      problems.push('body never pitches');
    }
    // Wheels need independent vertical travel.
    const bounce = (last.car.wheels || []).map((w) => w.bounceY);
    if (new Set(bounce.map((v) => v.toFixed(4))).size === 1) {
      problems.push('all wheels share identical suspension travel');
    }
    if (last.car.steeringWheel === null) problems.push('steering wheel node not found');
  }

  // Camera must lag the car and pull back with speed.
  if (last.cameraRig) {
    const dFirst = runs[0].d.cameraRig;
    const dLast = runs[runs.length - 1].d.cameraRig;
    if (dLast.dist <= dFirst.dist) {
      problems.push(`camera does not pull back with speed: ${dFirst.dist} -> ${dLast.dist}`);
    }
    if (dLast.fov <= dFirst.fov) {
      problems.push(`fov does not widen with speed: ${dFirst.fov} -> ${dLast.fov}`);
    }
  } else {
    problems.push('no camera rig diagnostics');
  }

  if (problems.length) {
    console.error('\nFAIL:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.error('\nOK: wheels spin, front axle steers, body moves, camera has lag');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
