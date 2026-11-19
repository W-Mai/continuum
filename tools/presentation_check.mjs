// Verifies the car is actually animated: on the road the wheels spin, the
// front wheels steer and each wheel has its own travel; past cruising speed the
// car rises, folds its wheels flat and floats; the body pitches and rolls, and
// the camera lags. Runs the real page in headless Chrome and reads its
// diagnostics, so a regression in any of these fails CI.
//
// The camera's feel is checked first, with no browser: the real ChaseCamera
// driven through made-up drives (a bend of 60 m at 20 m/s, a straight at 48 and
// 30 m/s, a landing at 3 m/s, a drag of the right button, the hood lens held
// against the car model), and over the real road with the autopilot. It looks
// into the bend, leans out of it, rumbles at speed, goes down on a landing and
// turns toward a car going by; each of those is zero with the lens held still
// (ChaseCamera.shaking); the view dragged round the car comes back; the hood
// lens is a point of the car, outside it; and the same drive twice gives the
// same lens to the last bit, in node and in the page.
//
// Usage: node tools/presentation_check.mjs [--rig | --pointer]
//   --rig      only the camera's own checks, which need no browser
//   --pointer  only the right button in the real page (real mouse events)
// PORT=8199 moves the server it starts, to run beside another check.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
// Headless WebGL fails on Linux while DISPLAY is set.
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8176;
const ROOT = new URL('..', import.meta.url).pathname;

// From rest: still on the wheels at 1 s and 3 s, afloat and settled by 11 s.
const STEPS = [60, 180, 660];
// A slow machine: the same drive, 12 s of it stepped at these frame rates.
// The rig's springs once flew off below 43 fps, taking the camera
// thousands of kilometres away.
const SLOW_FPS = [10, 20, 30, 40];

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
    // A profile of its own, made here and taken away when the browser has gone.
    const profile = mkdtempSync(`${tmpdir()}/ed-pres-${tag}-`);
    const args = [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--window-size=900,560',
      '--virtual-time-budget=' + budgetMs, '--dump-dom',
      '--user-data-dir=' + profile, url,
    ];
    const p = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'], env: CHROME_ENV });
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

// --- the camera's own checks -------------------------------------------------------------

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
// A frame, as the headless page steps it.
const FRAME = 1 / 60;

// The game's modules import `three` by name, which only the page's import map
// knows: a resolver points the name at the vendored copy, and the modules are
// loaded after it.
async function loadRig() {
  const three = new URL('./vendor/three.module.js', import.meta.url).href;
  register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, n) { return s === 'three' ? { url: ${JSON.stringify(three)}, shortCircuit: true } : n(s, c); }`,
  ));
  return {
    THREE: await import('./vendor/three.module.js'),
    ...(await import('../src/render/presentation.js')),
    ...(await import('../src/game.js')),
    ...(await import('./vendor/GLTFLoader.js')),
    ...(await import('../src/world/landform.js')),
    ...(await import('../src/world/road.js')),
    ...(await import('../src/core/car.js')),
    ...(await import('../src/core/autopilot.js')),
  };
}

// The real camera through drives made up here, and one over the real road.
// Each thing is measured as a difference from the same drive without it (the
// lens is the same in every other way), so what is measured is that one thing.
async function rigChecks(problems) {
  const rig = await loadRig();
  const { THREE, ChaseCamera, HOOD, bendAhead } = rig;
  const rows = [];
  const bare = (name, value, want, ok) => {
    rows.push({ measure: name, value, want, ok: ok ? 'ok' : 'FAIL' });
    if (!ok) problems.push(`${name}: ${value}, want ${want}`);
  };
  const within = (name, value, lo, hi, unit = '') => bare(name, `${+value.toPrecision(4)}${unit}`, `${lo} to ${hi}${unit}`, value >= lo && value <= hi);

  // The wall clock and Math.random are counted while the lens is driven: it
  // reads neither (what shakes it is the game's clock and the seed).
  let reads = 0;
  let clockReads = 0;
  const realNow = performance.now.bind(performance);
  const realRandom = Math.random;
  performance.now = () => { reads++; return realNow(); };
  Math.random = () => { reads++; return realRandom(); };

  try {
    const lens = (shaking = true, seed = 7) => {
      const camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.3, 14000);
      const chase = new ChaseCamera(camera, { seed });
      chase.shaking = shaking;
      return { camera, chase };
    };
    const step = (l, car, opts = {}) => {
      const before = reads;
      l.chase.update(FRAME, car, { roadY: 0, ...opts });
      clockReads += reads - before;
    };
    const dir = new THREE.Vector3();
    const viewYaw = (camera) => Math.atan2(camera.getWorldDirection(dir).z, dir.x);
    const wrap = (a) => a - TAU * Math.round(a / TAU);
    // How far the lens is rolled about its line of sight: positive when its up leans to its own right.
    const rollOf = (camera) => {
      const f = camera.getWorldDirection(new THREE.Vector3());
      const right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
      const level = new THREE.Vector3().crossVectors(right, f);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      return Math.atan2(up.dot(right), up.dot(level));
    };

    // A steady bend, to the right (way 1) or the left (-1): the car on its
    // circle, and the road's curvature ahead as steady.
    const bend = ({ R = 60, v = 20, way = 1, seconds = 20, shaking = true, into = true } = {}) => {
      const l = lens(shaking);
      const car = { x: 0, z: 0, y: 0, yaw: 0, speed: v, lateralG: (way * v * v) / R / 9.81 };
      l.chase.snapTo(car, 0);
      const w = (way * v) / R;
      for (let i = 1; i <= seconds / FRAME; i++) {
        const t = i * FRAME;
        car.yaw = w * t;
        car.x = (v / w) * Math.sin(car.yaw);
        car.z = -(v / w) * (Math.cos(car.yaw) - 1);
        step(l, car, { time: t, curvature: into ? way / R : 0 });
      }
      // outward: the roll to the outside of the bend, positive. into: how far the view is turned to the inside.
      return { l, car, view: viewYaw(l.camera), outward: -rollOf(l.camera) * way };
    };

    // Into the bend: how far further round the lens looks with the term that
    // reads the road ahead than with the same lens without it (the two are the
    // same in all else). Against the car's own heading it is still behind in
    // both: the heading spring trails the car round a bend.
    const seen = bend();
    const blind = bend({ into: false });
    within('into a bend of 60 m at 20 m/s, steady: the lens\'s yaw with the look-into-the-curve term minus the same lens without it', wrap(seen.view - blind.view), 0.05, 0.14, ' rad');
    rows.push({ measure: '  (the lens\'s yaw minus the car\'s, with the term, which the heading spring trails round a bend)', value: `${+wrap(seen.view - seen.car.yaw).toPrecision(3)} rad`, want: '', ok: '' });
    rows.push({ measure: '  (and without it)', value: `${+wrap(blind.view - blind.car.yaw).toPrecision(3)} rad`, want: '', ok: '' });
    within('  the turn the term holds (ChaseCamera.lookIn)', seen.l.chase.lookIn.value, 0.1, 0.14, ' rad');
    const seenLeft = bend({ way: -1 });
    within('  in a bend to the left, the same turned the other way', -wrap(seenLeft.view - bend({ way: -1, into: false }).view), 0.05, 0.14, ' rad');

    // Out of the bend: the lens rolls to the outside. The horizon's tilt with the
    // car (the lens leaning into the bend, 0.014 rad a g) is in it still, so what
    // is measured is the net roll of the lens: 1.53 degrees to the outside less
    // that tilt's 0.55 degree.
    within('in the same bend: the net roll of the lens, to the outside (the horizon\'s own tilt in it)', seen.outward / DEG, 0.5, 2.5, ' deg');
    within('  in a bend to the left, the same', seenLeft.outward / DEG, 0.5, 2.5, ' deg');

    // Rumble: the lens's own movement on a straight at speed, its position
    // against the car's once it has settled, with the mean taken out.
    const straight = ({ v, seconds = 12, shaking = true, seed = 7, offRoad = false } = {}) => {
      const l = lens(shaking, seed);
      const car = { x: 0, z: 0, y: 0, yaw: 0, speed: v, lateralG: 0 };
      l.chase.snapTo(car, 0);
      const at = [];
      for (let i = 1; i <= seconds / FRAME; i++) {
        const t = i * FRAME;
        car.x = v * t;
        step(l, car, { time: t, curvature: 0, offRoad });
        if (t > seconds - 4) at.push([l.camera.position.x - car.x, l.camera.position.y, l.camera.position.z]);
      }
      const mean = [0, 1, 2].map((k) => at.reduce((s, p) => s + p[k], 0) / at.length);
      return Math.sqrt(at.reduce((s, p) => s + [0, 1, 2].reduce((q, k) => q + (p[k] - mean[k]) ** 2, 0), 0) / at.length);
    };
    const rms48 = straight({ v: 48 });
    within('on a straight at 48 m/s: the lens\'s movement, rms', rms48 * 1000, 3, 12, ' mm');
    const still30 = straight({ v: 30 });
    bare('  at 30 m/s', `${+(still30 * 1e9).toFixed(3)} nm`, '0', still30 < 1e-9);
    within('  off the road, 2.5 times as much', straight({ v: 48, offRoad: true }) / rms48, 2.4, 2.6);
    within('  at 80 m/s (the movement stops at 2 cm)', straight({ v: 80 }) * 1000, 15, 30, ' mm');

    // A landing: the lens goes down by 2 cm for each m/s of the fall and comes
    // back, the field of view a little wider and back.
    const landing = ({ impact = 3, shaking = true } = {}) => {
      const a = lens(shaking);
      const b = lens(shaking);
      const car = { x: 0, z: 0, y: 0, yaw: 0, speed: 20, lateralG: 0 };
      a.chase.snapTo(car, 0);
      b.chase.snapTo(car, 0);
      const out = { sink: 0, wide: 0, late: 0, lateFov: 0, same: true };
      const down = Math.round(5 / FRAME);
      for (let i = 1; i <= 8 / FRAME; i++) {
        const t = i * FRAME;
        car.x = 20 * t;
        if (i === down) a.chase.land(impact);
        step(a, car, { time: t });
        step(b, car, { time: t });
        if (i < down) continue;
        const dy = a.camera.position.y - b.camera.position.y;
        out.sink = Math.max(out.sink, -dy);
        out.wide = Math.max(out.wide, a.camera.fov - b.camera.fov);
        if ((i - down) * FRAME >= 0.5) {
          out.late = Math.max(out.late, Math.abs(dy));
          out.lateFov = Math.max(out.lateFov, Math.abs(a.camera.fov - b.camera.fov));
        }
        if (!a.camera.position.equals(b.camera.position) || a.camera.fov !== b.camera.fov) out.same = false;
      }
      return out;
    };
    const land3 = landing();
    within('landing at 3 m/s: the lens\'s deepest dip', land3.sink, 0.04, 0.08, ' m');
    within('  what is left of it after half a second', land3.late * 1000, 0, 5, ' mm');
    within('  the field of view opens by', land3.wide, 1.8, 2.05, ' deg');
    within('  and is back after half a second, to within', land3.lateFov, 0, 0.1, ' deg');
    within('landing at 10 m/s: the dip', landing({ impact: 10 }).sink, 0.15, 0.19, ' m');
    within('landing at 20 m/s: the dip stops at', landing({ impact: 20 }).sink, 0.17, 0.19, ' m');

    // A car going by: the lens turns toward it by 0.4 degree and is back in 0.3 s.
    const passing = ({ side = 1, shaking = true } = {}) => {
      const a = lens(shaking);
      const b = lens(shaking);
      const car = { x: 0, z: 0, y: 0, yaw: 0, speed: 20, lateralG: 0 };
      a.chase.snapTo(car, 0);
      b.chase.snapTo(car, 0);
      const out = { peak: 0, over: 0 };
      for (let i = 1; i <= 4 / FRAME; i++) {
        const t = i * FRAME;
        car.x = 20 * t;
        if (i === 120) a.chase.brush(side);
        step(a, car, { time: t });
        step(b, car, { time: t });
        const d = wrap(viewYaw(a.camera) - viewYaw(b.camera));
        if (Math.abs(d) > Math.abs(out.peak)) out.peak = d;
        if (i > 120 && Math.abs(d) > 1e-9) out.over = (i - 120) * FRAME;
      }
      return out;
    };
    const byRight = passing();
    within('a car going by on the right: the lens turned toward it, at most', byRight.peak / DEG, 0.38, 0.42, ' deg');
    within('  and back in', byRight.over, 0.2, 0.31, ' s');
    within('  on the left, the other way', passing({ side: -1 }).peak / DEG, -0.42, -0.38, ' deg');

    // Which cars are a pass (Game._passing): one that crosses the player's place
    // along the road with less than 2.2 m between the two bodies, not touching,
    // the two closing on each other at 15 m/s or more; the lens turns to its side,
    // and not twice in 1.5 s. Run on a stand-in of the game: cars ahead of the
    // player in one frame and behind it in the next.
    {
      const meet = ({ lat = 1.9, lane = -1.9, wid = 1.82, dir = -1, speed = 15, vx = 20, yaw = 0, from = 10, to = -10 } = {}) => {
        const turned = [];
        const self = {
          road: { at: () => ({ theta: 0 }) }, car: { yaw, vx }, sCar: 100, simTime: 100, _nudged: -Infinity,
          traffic: { cars: [{ s: 100 + from, lane, wid, dir, speed }] },
          chase: { brush: (side) => turned.push(side) }, passes: 0, _lastPass: null,
        };
        const frame = () => rig.Game.prototype._passing.call(self, lat);
        frame();
        self.traffic.cars[0].s = 100 + to;
        frame();
        frame();
        const last = self._lastPass || {};
        return { turned: turned.join(), passes: self.passes, gap: last.gap, closing: last.closing };
      };
      const own = meet();
      bare('a car coming the other way in its lane, 1.97 m between the bodies, the two closing at 35 m/s: one pass, the lens turned to the left',
        `${own.passes} pass, ${own.turned}, ${own.gap && own.gap.toFixed(2)} m, ${own.closing} m/s`, '1 pass, -1', own.passes === 1 && own.turned === '-1' && Math.abs(own.gap - 1.97) < 0.01);
      const lorry = meet({ wid: 2.5 });
      bare('  a lorry (2.5 m wide) in its lane: 1.63 m, a pass as well', `${lorry.passes} pass, ${lorry.turned}`, '1 pass, -1', lorry.passes === 1 && lorry.turned === '-1');
      const wide = meet({ lat: 2.6 });
      bare('  2.7 m between the bodies is not a pass', `${wide.passes} passes`, '0', wide.passes === 0 && wide.turned === '');
      const slow = meet({ dir: 1, speed: 12, lane: 1.9, lat: -0.5 });
      bare('  a car the player closes on at 8 m/s is not a pass', `${slow.passes} passes`, '0', slow.passes === 0);
      const quick = meet({ dir: 1, speed: 4, lane: 1.9, lat: -0.5 });
      bare('  one closed on at 16 m/s is, to the right of the player', `${quick.passes} pass, ${quick.turned}`, '1 pass, 1', quick.passes === 1 && quick.turned === '1');
      const back = meet({ yaw: Math.PI, dir: 1, lane: -1.9, lat: 1.75 });
      bare('  the player facing back along the road: the sides change places', `${back.turned}`, '1', back.turned === '1');
      const hit = meet({ lat: -0.5 });
      bare('  bodies that overlap are a hit and not a pass', `${hit.passes} passes`, '0', hit.passes === 0);
      const far = meet({ from: 120, to: 90 });
      bare('  a car that has not crossed is not a pass', `${far.passes} passes`, '0', far.passes === 0);
      const jump = meet({ from: 40, to: -40 });
      bare('  nor one that is found on the other side after a jump of 80 m', `${jump.passes} passes`, '0', jump.passes === 0);

      // Three cars, the second half a second after the first, the third a second and a half after the second.
      const turned = [];
      const world = {
        road: { at: () => ({ theta: 0 }) }, car: { yaw: 0, vx: 20 }, sCar: 100, simTime: 100, _nudged: -Infinity,
        traffic: { cars: [0, 1, 2].map(() => ({ s: 110, lane: -1.9, wid: 1.82, dir: -1, speed: 15 })) },
        chase: { brush: (side) => turned.push(side) }, passes: 0, _lastPass: null,
      };
      const frame = (time, at) => {
        world.simTime = time;
        if (at !== undefined) world.traffic.cars[at].s = 90;
        rig.Game.prototype._passing.call(world, 1.9);
      };
      frame(100);
      frame(100.1, 0);
      frame(100.6, 1);
      frame(102.1, 2);
      bare('  three passes, the second 0.5 s after the first, the third 2 s after the first: all three counted, the lens turned for the first and the third',
        `${world.passes} passes, turned ${turned.length}`, '3 passes, turned 2', world.passes === 3 && turned.length === 2);
    }

    // The lens held still: none of the five, but the turn into the bend, which
    // is where the car is going and no shake.
    const held = bend({ shaking: false });
    const tilt = held.car.lateralG * 0.014;
    bare('lens held still, in the bend: the roll is the horizon\'s tilt with the car and no more',
      `${+(-held.outward / DEG).toPrecision(4)} deg`, `${+(tilt / DEG).toPrecision(4)} deg`, Math.abs(-held.outward - tilt) < 1e-5);
    within('  the turn into the bend is still there', wrap(held.view - bend({ shaking: false, into: false }).view), 0.05, 0.14, ' rad');
    const still55 = straight({ v: 55, shaking: false });
    bare('  at 55 m/s the lens does not move', `${+(still55 * 1e9).toFixed(3)} nm`, '0', still55 < 1e-9);
    const heldLand = landing({ impact: 10, shaking: false });
    bare('  a landing at 10 m/s moves neither the lens nor the field', `${heldLand.sink} m, ${heldLand.wide} deg`, '0',
      heldLand.same && heldLand.sink === 0 && heldLand.wide === 0);
    const heldBy = passing({ shaking: false }).peak;
    bare('  a car going by does not turn it', `${heldBy} rad`, '0', heldBy === 0);

    // Looking round. The right button on the canvas, as the browser gives it:
    // pointer events, and the menu the button would open. The drag is 90 degrees.
    {
      const a = lens();
      const b = lens();
      const target = new EventTarget();
      const page = new EventTarget();
      target.ownerDocument = page;
      const captured = [];
      target.setPointerCapture = (id) => captured.push(id);
      a.chase.listen(target);
      const car = { x: 0, z: 0, y: 0, yaw: 0, speed: 20, lateralG: 0 };
      a.chase.snapTo(car, 0);
      b.chase.snapTo(car, 0);
      let t = 0;
      const run = (seconds) => {
        for (let i = 0; i < Math.round(seconds / FRAME); i++) {
          t += FRAME;
          car.x = 20 * t;
          step(a, car, { time: t });
          step(b, car, { time: t });
        }
      };
      const fire = (type, props = {}) => {
        const e = Object.assign(new Event(type, { cancelable: true }), {
          button: 2, buttons: 2, pointerType: 'mouse', pointerId: 1, clientX: 0, clientY: 0,
        }, props);
        target.dispatchEvent(e);
        return e;
      };
      const view = a.chase.view;
      const apart = () => Math.abs(wrap(viewYaw(a.camera) - viewYaw(b.camera))) / DEG;
      run(2);
      const pixels = (90 * DEG) / (0.3 * DEG);
      fire('pointerdown', { clientX: 400, clientY: 300 });
      for (let i = 1; i <= 10; i++) {
        fire('pointermove', { clientX: 400 + (pixels * i) / 10, clientY: 300 });
        run(0.05);
      }
      bare('looking round: the right button down on the canvas, the canvas holds the pointer', `${captured.length}`, '1', captured.length === 1);
      within('  dragged across 300 pixels: the view turned by', view.yaw / DEG, 89.9, 90.1, ' deg');
      run(0.3);
      within('  the lens is round the car by', apart(), 89, 91, ' deg');
      within('  and that far from where it was', a.camera.position.distanceTo(b.camera.position), 10, 40, ' m');
      fire('pointerup');
      run(1.9);
      within('  1.9 s after the button is let go it is still turned by', view.yaw / DEG, 89.9, 90.1, ' deg');
      run(1.6);
      within('  3.5 s after: the lens is back, to within', apart(), 0, 1, ' deg');
      bare('  and where it was, to the last bit', `${view.yaw} rad, ${a.camera.position.distanceTo(b.camera.position)} m`, '0',
        view.yaw === 0 && view.pitch === 0 && a.camera.position.equals(b.camera.position) && a.camera.quaternion.equals(b.camera.quaternion));

      // The limits to the right and left, down and up; and the menu the button would open.
      fire('pointerdown');
      fire('pointermove', { clientX: 1e6, clientY: 1e6 });
      const high = [view.yaw / DEG, view.pitch / DEG];
      fire('pointermove', { clientX: -1e6, clientY: -1e6 });
      const low = [view.yaw / DEG, view.pitch / DEG];
      bare('  at most 140 degrees to either side, 50 up and 10 down', `${high[0]}, ${high[1]} / ${low[0]}, ${low[1]}`, '140, 50 / -140, -10',
        Math.abs(high[0] - 140) < 1e-6 && Math.abs(high[1] - 50) < 1e-6 && Math.abs(low[0] + 140) < 1e-6 && Math.abs(low[1] + 10) < 1e-6);
      const menu = fire('contextmenu');
      bare('  the browser\'s menu does not open over the chase lens', `prevented: ${menu.defaultPrevented}`, 'true', menu.defaultPrevented);
      fire('pointerup');
      // Where the menu comes after the button is let go, over a button of the page: shut once.
      const late = new Event('contextmenu', { cancelable: true });
      page.dispatchEvent(late);
      const next = new Event('contextmenu', { cancelable: true });
      page.dispatchEvent(next);
      bare('  nor when it comes after the button is let go, over the page: shut once, and not for the next press', `${late.defaultPrevented} then ${next.defaultPrevented}`, 'true then false',
        late.defaultPrevented && !next.defaultPrevented);
      a.chase.snapTo(car, 0);
      const others = [];
      for (const name of ['low', 'drone', 'hood']) {
        a.chase.setFraming(name);
        const e = fire('contextmenu');
        fire('pointerdown');
        fire('pointermove', { clientX: 80, clientY: 0 });
        fire('pointerup');
        others.push(!e.defaultPrevented && view.yaw === 0);
      }
      bare('  in the other lenses the button is the browser\'s: no menu is shut and nothing is turned', others.join(' '), 'true true true', others.every(Boolean));
      a.chase.setFraming('chase');
      fire('pointerdown', { button: 0, buttons: 1 });
      fire('pointermove', { buttons: 1, clientX: 200 });
      fire('pointerup', { button: 0, buttons: 0 });
      fire('pointerdown', { pointerType: 'touch' });
      fire('pointermove', { pointerType: 'touch', clientX: 200 });
      fire('pointerup', { pointerType: 'touch' });
      bare('  the left button and a finger turn nothing', `${view.yaw} rad`, '0', view.yaw === 0);
    }

    // The hood lens: reached by the C key after the others, a point of the car,
    // looking a little below its nose in a field of 62 degrees. Held against the
    // car model: the front edge of the hood is in the bottom of the frame with
    // the road above it, and nothing of the cabin is in it.
    {
      const order = [];
      const turn = lens();
      for (let i = 0; i < 7; i++) order.push(turn.chase.cycle());
      bare('the C key goes round the lenses, and the hood is the last of them', order.join(' '), 'director drone side low front hood chase',
        order.join(' ') === 'director drone side low front hood chase');
      // The lens on the hood, the car on a flat straight at `speed` m/s, settled.
      const onHood = (speed) => {
        const l = lens();
        l.chase.snapFraming('hood');
        const car = { x: 0, z: 0, y: 0, yaw: 0, speed, lateralG: 0 };
        l.chase.snapTo(car, 0);
        for (let i = 1; i <= 360; i++) {
          car.x = speed * i * FRAME;
          step(l, car, { time: i * FRAME });
        }
        // The car stands at the origin for the model to be measured against.
        l.camera.position.x -= car.x;
        l.camera.updateMatrixWorld();
        return l.camera;
      };
      const rest = onHood(0);
      within('the hood lens: 1.0 m ahead of the middle of the car and 1.44 m up, off by', rest.position.distanceTo(new THREE.Vector3(HOOD.x, HOOD.y, 0)) * 1000, 0, 1, ' mm');
      within('  looking below the nose by', -Math.asin(rest.getWorldDirection(new THREE.Vector3()).y) / DEG, 3.45, 3.55, ' deg');
      within('  its field of view at rest', rest.fov, 61.95, 62.05, ' deg');

      const file = ROOT + 'out/car.glb';
      if (!existsSync(file)) problems.push('out/car.glb missing; run python3 build.py first');
      else {
        const bytes = readFileSync(file);
        const gltf = await new Promise((ok, no) => new rig.GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', ok, no));
        const model = gltf.scene;
        model.scale.setScalar(0.001);
        model.updateMatrixWorld(true);
        model.traverse((o) => { if (o.isMesh) o.material.side = THREE.DoubleSide; });
        const ray = new THREE.Raycaster();
        ray.far = 80;
        const cast = (from, to) => {
          ray.set(from, to.clone().normalize());
          return ray.intersectObject(model, true);
        };
        // What a frame of the lens holds of the car: how far up the frame its paint
        // reaches from the bottom (the share of the frame's height) at the middle
        // and at the sides, what else of the car is above that, every material met,
        // and the nearest of it.
        const holds = (camera) => {
          const f = camera.getWorldDirection(new THREE.Vector3());
          const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
          const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
          const half = Math.tan((camera.fov * DEG) / 2);
          const names = new Map();
          const share = {};
          let above = 0;
          let nearest = Infinity;
          const ROWS = 100;
          for (const u of [-1, -0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9, 1]) {
            let run = 0;
            let open = true;
            for (let r = 0; r < ROWS; r++) {
              const w = -1 + (2 * (r + 0.5)) / ROWS;
              const hit = cast(camera.position, f.clone().addScaledVector(right, u * half * camera.aspect).addScaledVector(up, w * half));
              const name = hit.length ? hit[0].object.material.name : '';
              if (name) {
                names.set(name, (names.get(name) || 0) + 1);
                nearest = Math.min(nearest, hit[0].distance);
              }
              if (open && name === 'paint') run++;
              else {
                open = false;
                if (name) above++;
              }
            }
            share[u] = run / ROWS;
          }
          return { share, names, above, nearest };
        };
        const at27 = onHood(27);
        for (const [label, camera] of [['at rest', rest], ['at 27 m/s (the field has opened to ' + at27.fov.toFixed(1) + ' degrees)', at27]]) {
          const h = holds(camera);
          within(`  against the car model, ${label}: the hood's paint fills this much of the frame's height in the middle`, h.share[0], 0.1, 0.2);
          within('    and at the sides, at least', Math.min(h.share[-0.9], h.share[0.9]), 0.08, 0.2);
          bare('    with the road above it, and no other part of the car above it', `${h.above} rays`, '0', h.above === 0);
          bare('    the car in the frame is paint and nothing else (no windscreen, pillars, dashboard, seats)', [...h.names].map(([n, c]) => `${n} ${c}`).join(', ') || 'nothing',
            'paint', [...h.names.keys()].every((n) => n === 'paint') && h.names.has('paint'));
          within('    its nearest bit is', h.nearest, 0.3, 2, ' m');
        }
        const over = cast(rest.position, new THREE.Vector3(0, 1, 0));
        bare('  nothing of the car over the lens', `${over.length} hits`, '0', over.length === 0);
      }
    }

    // The same drive twice gives the same lens to the last bit; another seed
    // shakes it another way.
    {
      const drive = (seed) => {
        const l = lens(true, seed);
        const car = { x: 0, z: 0, y: 0, yaw: 0.3, speed: 55, lateralG: 0.2 };
        l.chase.snapTo(car, 0);
        const out = [];
        for (let i = 1; i <= 600; i++) {
          car.x += 55 * Math.cos(car.yaw) * FRAME;
          car.z += 55 * Math.sin(car.yaw) * FRAME;
          step(l, car, { time: i * FRAME, curvature: 0.003, bump: 0.25 });
          if (i === 300) l.chase.land(6);
          if (i === 400) l.chase.brush(-1);
          out.push([...l.camera.position.toArray(), ...l.camera.quaternion.toArray(), l.camera.fov]);
        }
        return out;
      };
      const alike = (x, y) => x.every((row, i) => row.every((v, k) => Object.is(v, y[i][k])));
      const first = drive(7);
      bare('the same drive twice with the same seed: the lens the same to the last bit', `${alike(first, drive(7))}`, 'true', alike(first, drive(7)));
      bare('  another seed shakes it another way', `${!alike(first, drive(8))}`, 'true', !alike(first, drive(8)));
    }

    // Over the real road with the autopilot: the lens turns into each bend the
    // car is in, to the side the car turns to.
    {
      const seed = 7;
      const road = new rig.Road(rig.makeAlpine(seed), seed);
      const car = new rig.Car();
      const pilot = new rig.Autopilot(road);
      let sCar = 160;
      const p0 = road.at(sCar);
      car.reset(p0.x - Math.sin(p0.theta) * rig.LANE, p0.z + Math.cos(p0.theta) * rig.LANE, p0.theta, road.surfaceAt(sCar, rig.LANE) + 0.045);
      const l = lens(true, seed);
      l.chase.snapTo(car, car.y);
      const DT = 1 / 120;
      let simTime = 0;
      let turning = 0;
      let agree = 0;
      let most = 0;
      for (let i = 0; i < Math.round(150 / DT); i++) {
        const shift = road.update(sCar);
        if (shift) {
          car.x -= shift.dx;
          car.z -= shift.dz;
          for (const k of ['posX', 'lookX']) l.chase[k].value -= shift.dx;
          for (const k of ['posZ', 'lookZ']) l.chase[k].value -= shift.dz;
        }
        sCar = road.nearestS(car.x, car.z, sCar).s;
        const p = road.at(sCar);
        const lat = road.lateralOf(sCar, car.x, car.z);
        car.groundY = road.surfaceAt(sCar, lat) + 0.045;
        car.groundVy = p.grade * Math.max(0, car.vx);
        car.pitchSlope = Math.atan(p.grade);
        car.step(DT, pilot.drive(DT, { s: sCar, x: car.x, z: car.z, yaw: car.yaw, speed: car.speed, leadGap: null, leadSpeed: null }));
        simTime += DT;
        if (i % 2 === 0) continue;
        step(l, car, { roadY: car.y, time: simTime, curvature: bendAhead(road, sCar, car) });
        if (Math.abs(car.r) > 0.12) {
          turning++;
          if (Math.sign(l.chase.lookIn.value) === Math.sign(car.r)) agree++;
        }
        most = Math.max(most, Math.abs(l.chase.lookIn.value));
      }
      bare('over the real road, 150 s of the autopilot: frames in a bend (yaw rate over 0.12 rad/s)', `${turning}`, 'at least 500', turning >= 500);
      within('  the share of them in which the lens is turned to the side the car turns to', (100 * agree) / Math.max(1, turning), 95, 100, ' %');
      within('  the most it was turned', most, 0.1, 0.14, ' rad');
    }

    bare('the lens read the wall clock or Math.random', `${clockReads} times`, 'never', clockReads === 0);
  } finally {
    performance.now = realNow;
    Math.random = realRandom;
  }
  console.table(rows);
}

// The right button in the real page, by real mouse events through DevTools on
// the page's own canvas: dragged across it, in the chase lens, it turns the
// lens round the car and its menu stays shut; the left button does not; in
// another lens, or pressed on a panel of the page, the button is the browser's.
async function pointerChecks(problems) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const profile = mkdtempSync(`${tmpdir()}/ed-pres-pointer-`);
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--mute-audio',
    '--hide-scrollbars', '--window-size=1280,720', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    `http://localhost:${PORT}/index.html?seed=7&s=5260&run=60&cam=chase`], { stdio: ['ignore', 'ignore', 'pipe'], env: CHROME_ENV });
  try {
    const devtools = await new Promise((resolve) => {
      let text = '';
      chrome.stderr.on('data', (d) => {
        text += d;
        const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(text);
        if (m) resolve(new URL(m[1]));
      });
    });
    let page = null;
    for (let i = 0; i < 100 && !page; i++) {
      const list = await (await fetch(`http://${devtools.host}/json/list`)).json();
      page = list.find((t) => t.type === 'page' && t.url.includes('index.html'));
      if (!page) await sleep(200);
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    let id = 0;
    const waiting = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (waiting.has(m.id)) {
        waiting.get(m.id)(m.result || m.error);
        waiting.delete(m.id);
      }
    });
    const send = (method, params = {}) => new Promise((resolve) => {
      waiting.set(++id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
    const ev = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      return r && r.result ? r.result.value : undefined;
    };
    let title = '';
    for (let i = 0; i < 240 && title !== 'GAME_DONE' && !String(title).startsWith('GAME_FAIL'); i++) {
      title = await ev('document.title');
      if (title !== 'GAME_DONE') await sleep(250);
    }
    if (title !== 'GAME_DONE') {
      problems.push(`the page for the pointer check did not come up: ${title}`);
      return;
    }
    const mouse = (type, x, y, button, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const drag = async (from, to, button, buttons) => {
      await mouse('mousePressed', from[0], from[1], button, buttons);
      for (let i = 1; i <= 10; i++) await mouse('mouseMoved', from[0] + ((to[0] - from[0]) * i) / 10, from[1] + ((to[1] - from[1]) * i) / 10, button, buttons);
      const during = await ev('({ yaw: game.chase.view.yaw * 180 / Math.PI, pitch: game.chase.view.pitch * 180 / Math.PI, held: game.chase.view.held })');
      await mouse('mouseReleased', to[0], to[1], button, 0);
      return during;
    };
    await ev(`window.__menus = []; window.__target = ''; addEventListener('pointerdown', (e) => { __target = e.target.id || e.target.tagName; });
      addEventListener('contextmenu', (e) => __menus.push(e.defaultPrevented)); 0`);
    const rows = [];
    const check = (name, value, want, ok) => {
      rows.push({ measure: name, value, want, ok: ok ? 'ok' : 'FAIL' });
      if (!ok) problems.push(`the right button in the real page, ${name}: ${value}, want ${want}`);
    };

    // 300 pixels to the right and 100 down, in the chase lens: 90 degrees round and 30 up.
    const during = await drag([400, 300], [700, 400], 'right', 2);
    const after = await ev('({ held: game.chase.view.held, menus: __menus, on: __target })');
    check('dragged 300 px right and 100 down on the canvas: the lens is turned round by', `${during.yaw.toFixed(2)} deg, up ${during.pitch.toFixed(2)} deg, held ${during.held}`, '90 deg, up 30 deg, held true',
      Math.abs(during.yaw - 90) < 0.1 && Math.abs(during.pitch - 30) < 0.1 && during.held === true);
    check('  the press was on the canvas, and the button let go lets go of the view', `${after.on}, held ${after.held}`, 'view, held false', after.on === 'view' && after.held === false);
    check('  the browser\'s menu was shut', JSON.stringify(after.menus), '[true]', after.menus.length === 1 && after.menus[0] === true);

    // The left button.
    await ev('game.chase.snapTo(game.car, game.car.y); 0');
    await drag([400, 300], [700, 300], 'left', 1);
    const left = await ev('game.chase.view.yaw');
    check('the left button dragged: the view', `${left} rad`, '0', left === 0);

    // Another lens: the button is the browser's.
    await ev(`game.setCamera('low'); __menus.length = 0; 0`);
    await drag([400, 300], [700, 300], 'right', 2);
    const low = await ev('({ yaw: game.chase.view.yaw, menus: __menus })');
    check('in the low lens the right button turns nothing and its menu is the browser\'s', `${low.yaw} rad, menus ${JSON.stringify(low.menus)}`, '0 rad, [false]', low.yaw === 0 && low.menus.length === 1 && low.menus[0] === false);

    // Pressed on a panel of the page (the bar): not the lens's.
    await ev(`game.setCamera('chase'); __menus.length = 0; 0`);
    const bar = await ev(`(() => { const r = document.getElementById('bar').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    await drag(bar, [bar[0] - 100, bar[1]], 'right', 2);
    const panel = await ev('({ yaw: game.chase.view.yaw, menus: __menus })');
    check('pressed on the bar, dragged: the view, and the menu', `${panel.yaw} rad, menus ${JSON.stringify(panel.menus)}`, '0 rad, [false]', panel.yaw === 0 && panel.menus.every((m) => m === false));
    console.table(rows);
    ws.close();
  } finally {
    chrome.kill();
    await sleep(500);
    rmSync(profile, { recursive: true, force: true });
  }
}

function finish(problems, ok) {
  if (problems.length) {
    console.error('\nFAIL:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.error('\nOK: ' + ok);
}

async function main() {
  const problems = [];
  if (!process.argv.includes('--pointer')) await rigChecks(problems);
  if (process.argv.includes('--pointer')) {
    // Only the right button in the real page.
    const server = serve();
    try {
      if (!await waitForServer(PORT)) throw new Error('server did not start');
      await pointerChecks(problems);
    } finally {
      server.kill();
    }
    finish(problems, 'the right button turns the chase lens in the real page and is the browser\'s everywhere else');
    return;
  }
  if (process.argv.includes('--rig')) {
    finish(problems, 'the lens looks into the bend, leans out of it, rumbles at speed, goes down on a landing, turns to a car going by, looks round and comes back, and is the same twice; the hood lens is outside the car; each is nothing with the lens held still');
    return;
  }
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
  const slow = [];
  let again = null;
  let onHood = null;
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
    for (const fps of SLOW_FPS) {
      const steps = fps * 12;
      const url = `http://localhost:${PORT}/index.html?seed=7&s=5260&run=${steps}&fps=${fps}&cam=chase`;
      const d = extract(await runChrome(url, steps * 100 + 20000, 'slow' + fps));
      if (!d) {
        console.error(`no diagnostics at ${fps} fps`);
        process.exit(1);
      }
      slow.push({ fps, d });
    }
    // The longest of the drives again, for the lens to be compared to the last
    // bit; and a drive on the hood lens.
    const longest = STEPS[STEPS.length - 1];
    again = extract(await runChrome(`http://localhost:${PORT}/index.html?seed=7&s=5260&run=${longest}`, longest * 100 + 20000, 'again'));
    onHood = extract(await runChrome(`http://localhost:${PORT}/index.html?seed=7&s=5260&run=300&cam=hood`, 300 * 100 + 20000, 'hood'));
    await pointerChecks(problems);
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

  // On a slow machine the camera still rides with the car, and the body
  // still sits on it.
  console.table(slow.map(({ fps, d }) => ({
    fps, kmh: d.speedKmh, toCar: d.cameraRig && d.cameraRig.toCar, up: d.cameraRig && d.cameraRig.up,
    heave: d.car && d.car.bodyHeave, pitch: d.car && d.car.bodyPitch,
  })));
  for (const { fps, d } of slow) {
    const rig = d.cameraRig || {};
    if (!(rig.toCar < 30) || !(Math.abs(rig.up) < 15)) {
      problems.push(`at ${fps} fps the camera is ${rig.toCar} m from the car, ${rig.up} m above it`);
    }
    const c = d.car || {};
    if (!(Math.abs(c.bodyHeave) < 1) || !(Math.abs(c.bodyPitch) < 0.5) || !(Math.abs(c.bodyRoll) < 0.5)) {
      problems.push(`at ${fps} fps the body is off: heave ${c.bodyHeave}, pitch ${c.bodyPitch}, roll ${c.bodyRoll}`);
    }
  }

  // The lens of the real game. The same drive twice leaves the lens as it was,
  // to the last bit (what shook it was the wall clock and Math.random).
  if (!again || !again.lens || !last.lens) problems.push('no lens in the diagnostics');
  else {
    const was = JSON.stringify(last.lens);
    const now = JSON.stringify(again.lens);
    if (was !== now) problems.push(`the same drive twice leaves the lens elsewhere: ${was} then ${now}`);
  }
  // And it turns into the bend the road ahead has, to the side it turns to:
  // where the road ahead is bent, the turn is the way the road bends.
  const lenses = [...runs, ...slow].map(({ d }) => ({ lens: d.lens, speed: d.speedKmh / 3.6 })).filter((x) => x.lens);
  const bent = lenses.filter(({ lens, speed }) => Math.abs(lens.bend * speed * 0.35) > 0.05 && Math.abs(lens.lookIn) > 0.02);
  const along = bent.filter(({ lens }) => Math.sign(lens.lookIn) === Math.sign(lens.bend)).length;
  console.table(lenses.map(({ lens, speed }) => ({ speed: +speed.toFixed(1), bend: +lens.bend.toFixed(4), lookIn: +lens.lookIn.toFixed(4) })));
  if (!along) problems.push('in none of the drives is the lens turned into a bend');
  else if (along < bent.length) problems.push(`the lens is turned the wrong way for the road ahead in ${bent.length - along} of ${bent.length} drives`);

  // The hood lens in the page: a point of the car's body, 1.0 m ahead of its middle and 1.44 m over the road, more
  // with the body risen on its hover and pitched on its springs: 1.7 to 2.1 m from where the tyres touch.
  const b = onHood && onHood.cameraRig;
  console.table([b ? { framing: b.framing, toCar: b.toCar, up: b.up, fov: b.fov } : {}]);
  if (!b || b.framing !== 'hood') problems.push(`cam=hood gives the ${b && b.framing} lens`);
  else if (!(b.toCar > 1.6 && b.toCar < 2.3) || !(b.up > 1.3 && b.up < 1.9)) {
    problems.push(`the hood lens is ${b.toCar} m from the car, ${b.up} m above it: want 1.6 to 2.3 and 1.3 to 1.9`);
  }

  finish(problems, 'wheels roll and steer on the road, fold flat afloat; body moves; camera has lag, and keeps with the car at 10-40 fps; the lens is the same twice, turns into the bend and sits on the hood');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
