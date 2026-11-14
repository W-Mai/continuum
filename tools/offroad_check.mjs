// The car can leave the road, and the world answers.
//
// Runs the page headless (the hills, seed 7), then drives it from the page:
//  - a car put 16 m off the road rides the land: its height keeps to the
//    ground's whenever it is on the ground, and it climbs and falls with it;
//  - a car driven at a trunk stops against it, short of it, not through;
//  - turning the autopilot on puts a car that is off the road back on it;
//  - in 方块 an animal in the car's way is thrown (it leaves the ground, the
//    car is slowed by its weight), comes to rest, and goes;
//  - in 手绘 an animal that bolts straight at a trunk goes round it.
//
// Usage: node tools/offroad_check.mjs
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
// Headless WebGL fails on Linux while DISPLAY is set.
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = 8180;
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  return spawn('node', [ROOT + 'tools/serve.mjs', String(PORT), ROOT], { stdio: ['ignore', 'ignore', 'inherit'] });
}

async function waitForServer(tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) return true;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  return false;
}

// The page, headless, and a way to run code in it.
async function openPage(query) {
  const profile = `${tmpdir()}/continuum-offroad-${process.pid}-${Date.now()}`;
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--window-size=1280,720', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    `http://localhost:${PORT}/index.html?${query}`], { stdio: ['ignore', 'ignore', 'pipe'], env: CHROME_ENV });
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
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  });
  const ev = (expression) => new Promise((resolve) => {
    pending.set(++id, (r) => resolve(r && r.result ? (r.result.value !== undefined ? r.result.value : r.result.description) : r));
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  });
  let title = '';
  for (let i = 0; i < 600; i++) {
    title = await ev('document.title');
    if (title === 'GAME_DONE' || String(title).startsWith('GAME_FAIL')) break;
    await sleep(500);
  }
  if (title !== 'GAME_DONE') throw new Error(`page: ${title}`);
  return {
    // Runs the body of an async function with `g` the game; its result comes back as JSON.
    run: async (body) => {
      const out = await ev(`(async () => { const g = game; ${body} })().then((v) => JSON.stringify(v), (e) => JSON.stringify({ error: e.message }))`);
      return JSON.parse(out);
    },
    close: () => {
      chrome.kill();
      setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
    },
  };
}

// In the page: a car 16 m off the road, driven along the land.
const LAND = `
  g.autoMode = false;
  const p = g.road.at(g.sCar);
  const x0 = p.x + Math.sin(p.theta) * 16;
  const z0 = p.z - Math.cos(p.theta) * 16;
  g.car.reset(x0, z0, p.theta, g.groundAt(x0, z0));
  g.car.vx = 10;
  g.driver.read = () => ({ steer: 0, throttle: 0.35, brake: 0 });
  let worst = 0, air = 0, lo = 1e9, hi = -1e9, off = 0, sane = true;
  for (let i = 0; i < 480; i++) {
    g.update(1 / 60);
    const gy = g.groundAt(g.car.x, g.car.z);
    if (g.offRoad) off++;
    if (g.car.airborne) air++;
    else worst = Math.max(worst, Math.abs(g.car.y - gy));
    lo = Math.min(lo, g.car.y);
    hi = Math.max(hi, g.car.y);
    if (!Number.isFinite(g.car.x + g.car.y + g.car.z)) sane = false;
  }
  return { worst, air, span: hi - lo, off, sane };
`;

// In the page: a car sent at a trunk from 14 m.
const TRUNK = `
  g.autoMode = false;
  const o = g.road.origin;
  const buf = [];
  let spot = null;
  for (let ds = -40; ds <= 120 && !spot; ds += 8) {
    const q = g.road.at(g.sCar + ds);
    if (!q) continue;
    for (const side of [1, -1]) for (let d = 12; d < 80 && !spot; d += 4) {
      const cx = q.x - Math.sin(q.theta) * d * side, cz = q.z + Math.cos(q.theta) * d * side;
      g.forest.trunksNear(cx + o.x, cz + o.z, 10, buf);
      for (let k = 0; k < buf.length && !spot; k += 3) if (buf[k + 2] > 0.25) spot = { x: buf[k] - o.x, z: buf[k + 1] - o.z, r: buf[k + 2] };
    }
  }
  if (!spot) return { error: 'no trunk found' };
  const ang = 0.7;
  const sx = spot.x - Math.cos(ang) * 14, sz = spot.z - Math.sin(ang) * 14;
  g.car.reset(sx, sz, ang, g.groundAt(sx, sz));
  g.car.vx = 12;
  g.driver.read = () => ({ steer: 0, throttle: 0.5, brake: 0 });
  let nearest = 1e9;
  for (let i = 0; i < 360; i++) {
    g.update(1 / 60);
    // The car's nose, the trunk's surface.
    const fx = g.car.x + Math.cos(g.car.yaw) * 2.2, fz = g.car.z + Math.sin(g.car.yaw) * 2.2;
    nearest = Math.min(nearest, Math.hypot(fx - spot.x, fz - spot.z) - spot.r);
  }
  return { nearest, speed: g.car.speed, r: spot.r };
`;

// In the page: the autopilot taken back to the road.
const AUTO = `
  g.autoMode = false;
  const p = g.road.at(g.sCar);
  g.car.reset(p.x + Math.sin(p.theta) * 20, p.z - Math.cos(p.theta) * 20, p.theta, 0);
  g.update(1 / 60);
  const before = g.offRoad;
  g.setAuto(true);
  for (let i = 0; i < 30; i++) g.update(1 / 60);
  const lat = g.road.lateralOf(g.sCar, g.car.x, g.car.z);
  return { before, after: g.offRoad, lat: Math.abs(lat) };
`;

// In the page: an animal 30 m ahead of the car, on its line.
const FLING = `
  const C = g.critters;
  let w = null, pool = null;
  for (const p of Object.values(C.pools)) if (p.walkers.length && !w) { w = p.walkers[0]; pool = p; }
  if (!w) return { error: 'no animals about' };
  g.autoMode = false;
  g.driver.read = () => ({ steer: 0, throttle: 0.4, brake: 0 });
  const p = g.road.at(g.sCar);
  g.car.reset(p.x, p.z, p.theta, g.groundAt(p.x, p.z));
  g.car.vx = 22;
  const fx = Math.cos(g.car.yaw), fz = Math.sin(g.car.yaw);
  w.x = g.car.x + fx * 30; w.z = g.car.z + fz * 30; w.y = g.groundAt(w.x, w.z); w.ground = w.y;
  w.state = 'idle'; w.speed = 0; w.timer = 999; w.leaving = false; w.fade = 1;
  const y0 = w.y;
  let up = 0, thrown = false, gone = false, vBefore = 0, vAfter = 0;
  for (let i = 0; i < 900; i++) {
    if (!thrown) vBefore = Math.hypot(g.car.vx, g.car.vy);
    g.update(1 / 60);
    w.timer = 999;
    if (!thrown && w.state === 'flung') { thrown = true; vAfter = Math.hypot(g.car.vx, g.car.vy); }
    if (thrown && !gone) up = Math.max(up, w.y - g.groundAt(w.x, w.z));
    if (thrown && !pool.walkers.includes(w)) { gone = true; break; }
  }
  return { thrown, up, gone, knocked: C.knocked, vBefore, vAfter, kind: pool.id, mass: pool.sp.mass };
`;

// In the page: an animal bolting at a trunk.
const DODGE = `
  const C = g.critters;
  g.autoMode = false;
  g.driver.read = () => ({ steer: 0, throttle: 0, brake: 1 });
  const o = g.road.origin;
  const buf = [];
  let spot = null;
  for (let ds = -60; ds <= 160 && !spot; ds += 8) {
    const q = g.road.at(g.sCar + ds);
    if (!q) continue;
    for (const side of [1, -1]) for (let d = 10; d < 90 && !spot; d += 4) {
      const cx = q.x - Math.sin(q.theta) * d * side, cz = q.z + Math.cos(q.theta) * d * side;
      g.forest.trunksNear(cx + o.x, cz + o.z, 10, buf);
      for (let k = 0; k < buf.length && !spot; k += 3) if (buf[k + 2] > 0.25) spot = { x: buf[k] - o.x, z: buf[k + 1] - o.z, r: buf[k + 2] };
    }
  }
  if (!spot) return { error: 'no trunk found' };
  const pool = C.pools.deer;
  pool.walkers.length = 0;
  const ang = 0.9;
  const sx = spot.x - Math.sin(ang) * 6, sz = spot.z - Math.cos(ang) * 6;
  const y = g.groundAt(sx, sz);
  const w = { x: sx, z: sz, y, yaw: ang, away: [Math.sin(ang), Math.cos(ang)], aim: ang, scale: 1, state: 'flee', timer: 5, speed: pool.sp.speed,
    gait: 0, stride: 1, bow: 0, bowTo: 0, hop: 0, pitch: 0, groundClock: 0, fade: 1, leaving: false, draw: 0.3, ground: y };
  pool.walkers.push(w);
  let gap = 1e9;
  for (let i = 0; i < 120; i++) {
    g.update(1 / 60);
    w.leaving = false;
    gap = Math.min(gap, Math.hypot(w.x - spot.x, w.z - spot.z) - spot.r);
  }
  return { gap, moved: Math.hypot(w.x - sx, w.z - sz) };
`;

const failures = [];
function check(ok, text) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failures.push(text);
}
const f2 = (v) => (typeof v === 'number' ? v.toFixed(2) : String(v));

const server = serve();
try {
  if (!(await waitForServer())) throw new Error('the dev server did not come up');

  const wood = await openPage('seed=7&s=1500&run=60&style=paint');
  try {
    const land = await wood.run(LAND);
    check(!land.error && land.sane && land.off > 400, `off the road the car stays off it (${land.off} of 480 steps)`);
    check(land.worst < 0.1, `it rides the ground: never more than ${f2(land.worst)} m from it while on it`);
    check(land.span > 1.5, `it climbs and falls with the land (${f2(land.span)} m, ${land.air} steps in the air)`);

    const trunk = await wood.run(TRUNK);
    check(!trunk.error && trunk.nearest > -0.1 && trunk.speed < 1, `a trunk stops it, short of the wood (nose ${f2(trunk.nearest)} m from the bark, ${f2(trunk.speed)} m/s)`);

    const auto = await wood.run(AUTO);
    check(auto.before === true && auto.after === false && auto.lat < 3, `the autopilot takes it back to the road (${f2(auto.lat)} m from the line)`);

    const dodge = await wood.run(DODGE);
    check(!dodge.error && dodge.gap > 0.3 && dodge.moved > 8, `an animal sent at a trunk goes round (${f2(dodge.gap)} m clear, ran ${f2(dodge.moved)} m)`);
  } finally {
    wood.close();
  }

  const farm = await openPage('seed=7&s=1500&run=600&style=block');
  try {
    const fling = await farm.run(FLING);
    check(!fling.error && fling.thrown && fling.up > 0.5, `${fling.kind} in the car's way is thrown (${f2(fling.up)} m above the ground)`);
    check(fling.knocked === 1 && fling.vAfter < fling.vBefore, `it counts, and the car is slowed (${f2(fling.vBefore)} to ${f2(fling.vAfter)} m/s, ${fling.mass} kg)`);
    check(fling.gone, 'it comes to rest and goes');
  } finally {
    farm.close();
  }
} finally {
  server.kill();
}

if (failures.length) {
  console.error(`\nFAILED: ${failures.length} check(s)`);
  process.exit(1);
}
console.log('\nOK: the car rides the land, trees stop it, animals are thrown and go round the trees');
