// Verifies the car is actually animated: on the road the wheels spin, the
// front wheels steer and each wheel has its own travel; past cruising speed the
// car rises, folds its wheels flat and floats; the body pitches and rolls, and
// the camera lags. Runs the real page in headless Chrome and reads its
// diagnostics, so a regression in any of these fails CI.
//
// Usage: node tools/presentation_check.mjs

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
const PORT = 8176;
const ROOT = new URL('..', import.meta.url).pathname;

// From rest: still on the wheels at 1 s and 3 s, afloat and settled by 11 s.
const STEPS = [60, 180, 660];

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
      '--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
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
      // Start on the serpentine below the first viaduct, so there are bends to
      // steer through and weight to transfer.
      const url = `http://localhost:${PORT}/index.html?seed=7&s=5260&run=${steps}`;
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
      kmh: d.speedKmh,
      spin: w.spinZ,
      frontSteer: front.steerY,
      rearSteer: rear.steerY,
      fold: car.fold,
      hinge: front.hingeX,
      heave: car.bodyHeave,
      pitch: car.bodyPitch,
      roll: car.bodyRoll,
      camDist: d.cameraRig && d.cameraRig.dist,
      yawLag: d.cameraRig && d.cameraRig.yawLag,
    };
  });
  console.table(rows);

  const problems = [];
  const first = runs[0].d;
  const last = runs[runs.length - 1].d;
  const near = (a, b, tol) => Math.abs(a - b) <= tol;

  if (!first.car || !last.car) problems.push('no car node data: the model did not attach');
  else {
    const w0 = first.car.wheels || [];
    const wN = last.car.wheels || [];
    if (w0.length !== 4) problems.push(`expected 4 wheel nodes, got ${w0.length}`);

    // Spin must keep advancing, rolling on the road and idling afloat.
    if (!(Math.abs(wN[0].spinZ) > Math.abs(w0[0].spinZ) + 1)) {
      problems.push(`wheels are not spinning: ${w0[0].spinZ} -> ${wN[0].spinZ}`);
    }

    // On the road: wheels down, front axle steering, independent travel.
    const onRoad = runs.filter((r) => r.d.speedKmh < 40).map((r) => r.d);
    if (!onRoad.length) problems.push('no sample below 40 km/h: the start is not from rest');
    for (const d of onRoad) {
      if (d.car.hover || d.car.fold > 0 || d.car.lift > 0) {
        problems.push(`afloat at ${d.speedKmh} km/h (fold ${d.car.fold}, lift ${d.car.lift})`);
      }
    }
    const steering = onRoad.find((d) => Math.abs(d.car.steer) > 0.005);
    if (steering) {
      const f = steering.car.wheels.find((x) => x.name === 'wheel_fl');
      if (f && Math.abs(f.steerY) < 1e-5) problems.push('front wheels never steer');
    }
    for (const { d } of runs) {
      const r = d.car.wheels.find((x) => x.name === 'wheel_rl');
      if (r && Math.abs(r.steerY) > 1e-6) problems.push('rear wheels are steering');
    }
    const rolling = onRoad[onRoad.length - 1];
    if (rolling) {
      const bounce = rolling.car.wheels.map((w) => w.bounceY);
      if (new Set(bounce.map((v) => v.toFixed(4))).size === 1) {
        problems.push('all wheels share identical suspension travel');
      }
    }

    // Afloat: risen, settled, wheels flat with left and right swung opposite
    // ways, front pads no longer steering.
    if (last.speedKmh <= 40) problems.push(`never passed 40 km/h (${last.speedKmh})`);
    else {
      const c = last.car;
      if (!c.hover || c.fold < 0.999 || c.lift < 0.999) {
        problems.push(`not afloat at ${last.speedKmh} km/h (fold ${c.fold}, lift ${c.lift})`);
      }
      for (const w of c.wheels) {
        const want = (w.name.endsWith('l') ? -1 : 1) * Math.PI / 2;
        if (!near(w.hingeX, want, 0.002)) problems.push(`${w.name} folded to ${w.hingeX}, want ${want.toFixed(4)}`);
        if (Math.abs(w.steerY) > 1e-6) problems.push(`${w.name} steers while folded`);
      }
      if (!near(c.bodyHeave, 0.2, 0.03)) problems.push(`hover height ${c.bodyHeave} m, want 0.20`);
    }

    // Body attitude should be non-zero and change over the run.
    if (Math.abs(first.car.bodyPitch) < 1e-6 && Math.abs(last.car.bodyPitch) < 1e-6) {
      problems.push('body never pitches');
    }
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
  console.error('\nOK: wheels roll and steer on the road, fold flat afloat; body moves; camera has lag');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
