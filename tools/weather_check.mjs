// The weather changes from one world to the next the way weather does.
//
// Runs the page headless (seed 7) on a road of two worlds at a time, and walks
// a point along the road from well before the border to past it, reading the
// sky, the light and the weather round the camera (render/weather.js) every
// twelve metres, without drawing:
//  - nothing jumps: the most any of them (the sun, the exposure, the
//    horizon's colour overhead and in all twenty-four directions) moves in
//    twelve metres is a few hundredths of all the way from one world's to the
//    other's;
//  - the front is seen coming: at the start of the border the horizon ahead
//    is already part-way to the next world's, and the one behind is still the
//    last world's;
//  - the whole thing is the next world's once the border is past, and was the
//    last world's before the front showed;
//  - the clouds baked into the sky (render/clouds.js) are ready in 60 frames,
//    crossed to another set over twenty seconds, wanted by the world a little
//    ahead of the lens, and still from one frame to the next.
//
// Usage: node tools/weather_check.mjs
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8185;
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

async function openPage(query) {
  const profile = `${tmpdir()}/continuum-weather-${process.pid}-${Date.now()}`;
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--window-size=800,450', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
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

// In the page: the first border of the road, walked from 2.4 km before it to
// 300 m past it.
const WALK = `
  const W = g.worlds;
  const o = g.road.origin;
  const top = g.road.classified * 2 - 4;
  let s0 = null, s1 = null;
  for (let s = 60; s < top; s += 4) {
    const p = g.road.at(s);
    if (!p) continue;
    const w = W.at(p.x + o.x, p.z + o.z);
    if (w.a !== w.b && w.t > 0.001) {
      if (s0 === null) s0 = s;
      s1 = s;
    } else if (s0 !== null) break;
  }
  if (s0 === null) return { error: 'no border on this road' };
  const R = await import('./src/render/ring.js');
  const N = R.RING_N;
  const at = (s) => {
    const p = g.road.at(s);
    g._updateLook(p.x, p.z, 0.02, true);
    const l = g._look;
    return { s, sun: l.sunIntensity, exp: l.exposure, hz: [l.horizon.r, l.horizon.g, l.horizon.b], ring: Array.from(R.ringU.uRingH.value) };
  };
  const from = Math.max(60, s0 - 2400);
  const rows = [];
  for (let s = from; s <= s1 + 300 && s < top; s += 12) rows.push(at(s));
  const fwd = Math.floor((Math.atan2(W.dz, W.dx) / (2 * Math.PI) + 0.5) * N) % N;
  const back = (fwd + N / 2) % N;
  const start = at(s0);
  return { s0, s1, rows, fwd, back, N, start, a: g._lookAt.a, b: g._lookAt.b };
`;


// In the page (the paint style, a road of hills and then desert): the clouds
// baked into the sky (render/clouds.js). A set is baked a strip a frame and
// is ready within 60 frames; a set asked for after it is baked into the free
// cube and crossed to over twenty seconds, steadily; which set the sky wants
// goes by the world a little ahead of the lens; the sky of a car that stands
// still is the same picture a second on; and a face of the cube holds the
// shares of cloud the sets are for (a set of towers stands on the horizon and
// has none high up; a dry sky has little).
const CLOUDS = `
  const { Clouds } = await import('./src/render/clouds.js');
  const axis = Math.atan2(g.worlds.dz, g.worlds.dx);
  const out = {};
  const c = new Clouds(g.renderer, { seed: 7, axis, sync: false, tier: 'high' });
  c.want('fair');
  let frames = 0;
  while (!c.baked && frames < 400) { c.update(1 / 60, true); frames++; }
  out.frames = frames;
  out.strips = c.frames;
  c.want('few');
  let ask = 0;
  while (!c.crossing && ask < 400) { c.update(1 / 60, true); ask++; }
  out.ask = ask;
  let steps = 0;
  let last = 0;
  let steady = true;
  let most = 0;
  while (c.crossing && steps < 3000) {
    c.update(1 / 60, true);
    steps++;
    if (!c.crossing) break;
    const t = c.uniforms.uCloudT.value;
    if (t < last - 1e-9) steady = false;
    most = Math.max(most, t - last);
    last = t;
  }
  out.cross = steps / 60;
  out.steady = steady;
  out.step = most;
  out.set = c.set;
  out.done = !c.crossing && c.uniforms.uCloudT.value === 0;
  // A low tier draws no crossing: the new set is simply the one in use.
  const low = new Clouds(g.renderer, { seed: 7, axis, sync: false, tier: 'low' });
  low.want('fair');
  for (let i = 0; i < 400 && !low.baked; i++) low.update(1 / 60, true);
  low.want('few');
  let lowCross = false;
  for (let i = 0; i < 400 && low.set !== 'few'; i++) { low.update(1 / 60, true); lowCross = lowCross || low.crossing; }
  out.low = { set: low.set, crossed: lowCross, size: low.size };
  c.dispose();
  low.dispose();

  // The shares of cloud in the set's cube, weighted by solid angle: of the
  // sky above the horizon, and above 20 degrees of elevation.
  const share = (name) => {
    const cl = new Clouds(g.renderer, { seed: 7, axis, sync: true, tier: 'mid' });
    cl.want(name);
    cl.update(1 / 60, true);
    cl.update(1 / 60, true);
    const rt = cl.cubes[cl.live];
    const S = rt.width;
    const buf = new Uint8Array(S * S * 4);
    const sin20 = Math.sin(20 * Math.PI / 180);
    const dir = (f, a, b) => [[1, -b, -a], [-1, -b, a], [a, 1, b], [a, -1, -b], [a, -b, 1], [-a, -b, -1]][f];
    let wAll = 0, cAll = 0, wHigh = 0, cHigh = 0;
    for (const f of [0, 1, 2, 4, 5]) {
      g.renderer.readRenderTargetPixels(rt, 0, 0, S, S, buf, f);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const a = (x + 0.5) / S * 2 - 1, b = (y + 0.5) / S * 2 - 1;
        const d = dir(f, a, b);
        const n = Math.hypot(d[0], d[1], d[2]);
        const el = d[1] / n;
        if (el <= 0) continue;
        const w = 1 / Math.pow(1 + a * a + b * b, 1.5);
        const cover = buf[(y * S + x) * 4 + 3] / 255 > 0.5 ? 1 : 0;
        wAll += w; cAll += w * cover;
        if (el > sin20) { wHigh += w; cHigh += w * cover; }
      }
    }
    cl.dispose();
    return { all: cAll / wAll, high: cHigh / wHigh };
  };
  out.share = { fair: share('fair'), few: share('few'), towers: share('towers') };

  // The sky on its own, from where the lens is, a second apart with the car
  // standing: not a pixel of it moves.
  g.autoMode = true;
  g.car.vx = 0;
  g.pilot.vMax = 0;
  for (let i = 0; i < 400 && Math.abs(g.car.speed) > 0.001; i++) g.update(1 / 60);
  out.speed = g.car.speed;
  const THREE = await import('three');
  const W = 256, H = 144;
  const rt = new THREE.WebGLRenderTarget(W, H);
  const scene = new THREE.Scene();
  const dome = new THREE.Mesh(g.atmosphere.sky.geometry, g.atmosphere.sky.material);
  dome.frustumCulled = false;
  dome.scale.setScalar(4000);
  scene.add(dome);
  const lens = g.camera.clone();
  lens.position.set(0, 0, 0);
  lens.lookAt(Math.cos(1.1), 0.35, Math.sin(1.1));
  lens.updateMatrixWorld();
  const shot = () => {
    dome.material = g.atmosphere.sky.material;
    const b = new Uint8Array(W * H * 4);
    g.renderer.setRenderTarget(rt);
    g.renderer.clear();
    g.renderer.render(scene, lens);
    g.renderer.readRenderTargetPixels(rt, 0, 0, W, H, b);
    g.renderer.setRenderTarget(null);
    return b;
  };
  const one = shot();
  for (let i = 0; i < 60; i++) g.update(1 / 60);
  const two = shot();
  let apart = 0, cloudPx = 0;
  for (let i = 0; i < one.length; i += 4) {
    if (one[i] !== two[i] || one[i + 1] !== two[i + 1] || one[i + 2] !== two[i + 2]) apart++;
    if (one[i] > 200 && one[i + 1] > 200) cloudPx++;
  }
  rt.dispose();
  out.still = { apart, cloudPx, material: [g.atmosphere.skyPlainHeaps, g.atmosphere.skyPlainPure].includes(g.atmosphere.sky.material) };
  return out;
`;

// In the page: the set the sky wants, read at each step of a walk from 600 m
// before the first border to 600 m past it (the look is the world a little
// ahead of the lens).
const SETS = `
  const W = g.worlds;
  const o = g.road.origin;
  const top = g.road.classified * 2 - 4;
  let s0 = null, s1 = null;
  for (let s = 60; s < top; s += 4) {
    const p = g.road.at(s);
    if (!p) continue;
    const w = W.at(p.x + o.x, p.z + o.z);
    if (w.a !== w.b && w.t > 0.001) {
      if (s0 === null) s0 = s;
      s1 = s;
    } else if (s0 !== null) break;
  }
  if (s0 === null) return { error: 'no border on this road' };
  const seq = [];
  for (let s = Math.max(60, s0 - 600); s <= s1 + 600 && s < top; s += 12) {
    const p = g.road.at(s);
    g._updateLook(p.x, p.z, 0.02, true);
    seq.push(g._look.cloudSet);
  }
  const flips = seq.filter((v, i) => i > 0 && v !== seq[i - 1]).length;
  return { first: seq[0], last: seq[seq.length - 1], flips, n: seq.length };
`;

const PAIRS = [['hills', 'desert'], ['river', 'city'], ['city', 'cavern'], ['abyss', 'heaven'], ['heaven', 'space'], ['space', 'upside']];

let failed = 0;
const say = (ok, text) => {
  console.error(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};

const server = serve();
if (!(await waitForServer())) {
  console.error('FAIL: no server');
  server.kill();
  process.exit(1);
}
let exitCode = 0;
try {
  for (const [a, b] of PAIRS) {
    const page = await openPage(`seed=7&world=${a}&loop=${a},${b}&worldlen=4000&run=5&cam=chase`);
    const d = await page.run(WALK);
    page.close();
    if (d.error) {
      say(false, `${a} to ${b}: ${d.error}`);
      continue;
    }
    const rows = d.rows;
    const first = rows[0];
    const last = rows[rows.length - 1];
    // Each kind of number against how far it goes at all between the two
    // worlds (the most and the least it is anywhere on the walk, in the
    // sky and in every direction round), and the step in twelve metres as a
    // share of that.
    const classes = (r) => [[r.sun], [r.exp], [r.hz[0]], [r.hz[1]], [r.hz[2]],
      ...[0, 1, 2, 3].map((c) => Array.from({ length: d.N }, (_, k) => r.ring[k * 4 + c]))];
    const lo = classes(first).map(() => Infinity);
    const hi = classes(first).map(() => -Infinity);
    for (const r of rows) {
      classes(r).forEach((vs, i) => {
        for (const v of vs) {
          if (v < lo[i]) lo[i] = v;
          if (v > hi[i]) hi[i] = v;
        }
      });
    }
    let jump = 0;
    let where = 0;
    for (let k = 1; k < rows.length; k++) {
      const x = classes(rows[k - 1]);
      const y = classes(rows[k]);
      for (let i = 0; i < x.length; i++) {
        const range = hi[i] - lo[i];
        if (range < 0.03) continue;
        for (let j = 0; j < x[i].length; j++) {
          const f = Math.abs(y[i][j] - x[i][j]) / range;
          if (f > jump) {
            jump = f;
            where = rows[k].s;
          }
        }
      }
    }
    say(jump < 0.06, `${a} to ${b}: nothing jumps (the most in 12 m is ${(jump * 100).toFixed(1)} % of the way, at ${where} m)`);
    const hzA = first.hz;
    const hzB = last.hz;
    const l1 = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
    const way = l1(hzA, hzB);
    const bin = (r, k) => [r.ring[k * 4], r.ring[k * 4 + 1], r.ring[k * 4 + 2]];
    if (way > 0.08) {
      const ahead = l1(bin(d.start, d.fwd), hzA) / way;
      const behind = l1(bin(d.start, d.back), hzA) / way;
      say(ahead > 0.25, `${a} to ${b}: the front is seen coming (at the start of the border the horizon ahead is ${(ahead * 100).toFixed(0)} % of the way to the next world's)`);
      say(behind < 0.1, `${a} to ${b}: and behind it is still the last world's (${(behind * 100).toFixed(0)} % of the way)`);
    }
    const end = l1(last.hz, bin(last, d.fwd)) / Math.max(way, 0.08);
    say(end < 0.15, `${a} to ${b}: past the border it is all the next world's (the horizon ahead is within ${(end * 100).toFixed(0)} % of the sky overhead)`);
  }

  // The clouds baked into the sky.
  {
    const page = await openPage('seed=7&world=hills&loop=hills,desert&worldlen=4000&run=5&cam=chase&style=paint');
    try {
      const d = await page.run(CLOUDS);
      if (d.error) {
        say(false, `clouds: ${d.error}`);
      } else {
        say(d.frames <= 60, `a set of clouds is baked and ready within 60 frames (${d.frames}: ${d.strips} strips)`);
        say(d.set === 'few' && d.done && d.ask <= 60, `a set asked for after it is baked into the free cube in ${d.ask} frames and is the one in use after the crossing`);
        say(Math.abs(d.cross - 20) < 0.2 && d.steady && d.step < 0.01, `the two cubes are crossed over ${d.cross.toFixed(1)} s (20), and steadily (${(d.step * 100).toFixed(2)} % at most in a frame)`);
        say(d.low.set === 'few' && !d.low.crossed && d.low.size === 384, `at the low tier (${d.low.size} texels a face) the new set is the one in use with no crossing`);
        say(d.share.towers.high <= 0.05, `of the sky above 20 degrees, the towers on the horizon are ${(d.share.towers.high * 100).toFixed(1)} % cloud (at most 5 %)`);
        say(d.share.few.all < d.share.fair.all * 0.6 && d.share.fair.all > 0.05, `a dry sky has less cloud than a fair one (${(d.share.few.all * 100).toFixed(1)} % of the sky against ${(d.share.fair.all * 100).toFixed(1)} %)`);
        say(d.still.material && d.still.apart === 0 && d.still.cloudPx > 200, `the sky of a car standing still is the same picture a second on: ${d.still.apart} pixels apart of the ${d.still.cloudPx} that are cloud or its light`);
      }
      const q = await page.run(SETS);
      say(!q.error && q.first === 'fair' && q.last === 'few' && q.flips === 1, `the set the sky wants goes by the world a little ahead of the lens: ${q.first} before the border of the hills and the desert, ${q.last} past it, changed ${q.flips} time${q.flips === 1 ? '' : 's'}${q.error ? ' ' + q.error : ''}`);
    } finally {
      page.close();
    }
  }
} catch (e) {
  console.error(`FAIL: ${e.message}`);
  failed++;
  exitCode = 1;
} finally {
  server.kill();
}
if (failed) {
  console.error(`\n${failed} problem${failed > 1 ? 's' : ''}`);
  process.exit(1);
}
console.error('\nOK: the weather changes smoothly, is seen coming, and is the next world\'s once the border is past');
process.exit(exitCode);
