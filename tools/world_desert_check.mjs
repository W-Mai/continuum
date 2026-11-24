// What the desert has of its own is there, where it should be, and costs what it should.
//
// In node first (no browser), over three seeds: the plan (world/desertplan.js) is the same
// each time it is asked; a billboard stands in each 1.2 km of road, beside it and off it; the
// poles are 45 m apart along one side, 9 m outside the verge; every dust devil walks on level
// ground (slope under 0.1) all its way, at 3 m/s for 60 to 120 s, and within 2 km of the road
// there are none, one or two of them most of the time; a tumbleweed comes every 14 to 26 s and
// crosses the road ahead; and the things themselves (render/desert.js, without a renderer),
// driven along the road for 120 s, meet 3 to 9 tumbleweeds, and a car put in a dust devil is
// pushed 0.3 m/s² to the side for 2 s and the frame washed toward the dust.
//
// Then in the page (seed 7, the place `desert` of tools/look.mjs), unless --node-only: the
// heat haze's pass, drawn with its check's output (render/post.js, HAZE: how far each pixel
// is moved and how far off it is), moves the pixels 300 to 1500 m off by at least 0.4 px on
// average between two frames 0.1 s apart, and none nearer than 200 m (the car, the road
// under it), and none by more than 1.5 px; it is on in the real and the painted styles and off
// in the others; the dust devils within 2 km are 0 to 2; what the desert adds to a frame at
// each tier; and dispose lets it go.
//
// Usage: node tools/world_desert_check.mjs [--node-only]
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { register } from 'node:module';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { makeWorldLand } from '../src/world/worlds.js';
import { Road, HALF_FLAT } from '../src/world/road.js';
import { Corridor } from '../src/world/corridor.js';
import { DesertPlan, BOARD, POLE, DEVIL, WEED, SAND, slopeAt, weedGap, crestAt } from '../src/world/desertplan.js';

const ROOT = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const NODE_ONLY = args.includes('--node-only');

let failed = 0;
const say = (ok, text) => {
  console.error(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};
const span = (a) => (a.length ? `${Math.min(...a).toFixed(2)}..${Math.max(...a).toFixed(2)}` : 'none');

// --- in node: the plan -------------------------------------------------------------

function planOf(seed) {
  const land = makeWorldLand(seed, { start: 'desert' });
  const road = new Road(land, seed);
  const corridor = new Corridor(road, land);
  const plan = new DesertPlan({ land, road, corridor, worlds: land.worlds, seed });
  return { land, road, corridor, plan };
}

function nodePlan() {
  for (const seed of [7, 42, 3]) {
    const name = `seed ${seed}`;
    const { road, corridor, plan } = planOf(seed);
    const again = planOf(seed);
    const h = (x, z) => corridor.heightAt(x, z);
    const boards = [];
    const poles = [];
    let tried = 0;
    let same = true;
    const devils = [];
    const counts = [];
    for (let sCar = 200; sCar <= 6000; sCar += 100) {
      road.update(sCar);
      again.road.update(sCar);
      const k = Math.floor((sCar + 300) / BOARD.every);
      const b = plan.board(k);
      if (b !== undefined && !boards.some((e) => e.k === k)) {
        const b2 = again.plan.board(k);
        if (JSON.stringify(b) !== JSON.stringify(b2)) same = false;
        boards.push({ k, b, d: b ? nearest(road, b.ax, b.az) : null });
      }
      for (let q = Math.ceil(sCar / POLE.every); q * POLE.every < sCar + 100; q++) {
        const p = plan.pole(q);
        if (p === undefined) continue;
        tried++;
        if (p) poles.push({ p, d: nearest(road, p.ax, p.az) });
      }
      if (sCar % 250 === 0) {
        const p = road.at(sCar);
        const o = road.origin;
        for (let t = 30; t < 1500; t += 61) {
          const list = plan.devilsAt(t, p.x + o.x, p.z + o.z, 2000);
          counts.push(list.length);
          for (const e of list) if (!devils.includes(e.d)) devils.push(e.d);
        }
      }
    }
    say(same, `${name}: the plan is the same each time it is asked`);
    // Billboards: one to each 1.2 km of road (where the road there is the desert's and on the ground), off the road.
    const stood = boards.filter((e) => e.b);
    const dists = stood.map((e) => e.d);
    say(stood.length >= 0.6 * boards.length, `${name}: ${stood.length} billboards in ${boards.length} stretches of 1.2 km`);
    say(dists.every((d) => d >= HALF_FLAT + BOARD.off[0] - 0.5 && d <= HALF_FLAT + BOARD.off[1] + BOARD.width), `${name}: each stands ${span(dists)} m from the middle of the road, beyond the verge`);
    const gaps = stood.slice(1).map((e, i) => e.b.s - stood[i].b.s);
    say(gaps.every((g) => g >= BOARD.every - BOARD.spread - 120 && g <= 2 * BOARD.every + BOARD.spread + 120), `${name}: ${span(gaps)} m of road from one to the next`);
    // Poles.
    const pd = poles.map((e) => Math.abs(e.d - (HALF_FLAT + POLE.off)));
    say(poles.length >= 0.6 * tried, `${name}: ${poles.length} poles of ${tried} stations of 45 m`);
    say(Math.max(...pd) < 1.5, `${name}: each 9 m outside the verge (off by ${Math.max(...pd).toFixed(2)} m at the most)`);
    // Dust devils: level all their way.
    let steep = 0;
    for (const d of devils) {
      const len = d.life * DEVIL.speed;
      for (let x = 0; x <= len; x += 4) if (slopeAt(h, d.ax + d.dx * x, d.az + d.dz * x) >= DEVIL.slope) steep++;
    }
    const lifes = devils.map((d) => d.life);
    say(devils.length >= 5 && lifes.every((l) => l >= 60 && l <= 120), `${name}: ${devils.length} dust devils, each lives ${span(lifes)} s`);
    say(steep <= devils.length * 0.5, `${name}: their ways are level: ${steep} points of 4 m (of all their ways) at a slope of 0.1 or more, where the road has since cut the ground (those are not drawn)`);
    const most = counts.filter((n) => n <= 2).length / counts.length;
    say(most >= 0.85 && Math.max(...counts) <= 4, `${name}: within 2 km of the road 0, 1 or 2 dust devils ${(most * 100).toFixed(0)}% of the time (at least 85%), at most ${Math.max(...counts)}`);
  }
  // Tumbleweeds: every 14 to 26 s.
  const gaps = [];
  for (let n = 1; n < 400; n++) gaps.push(weedGap(n, 7));
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  say(Math.min(...gaps) >= WEED.apart[0] && Math.max(...gaps) <= WEED.apart[1] && Math.abs(mean - 20) < 1, `a tumbleweed every ${span(gaps)} s, ${mean.toFixed(1)} s on average`);
}

// How far the road's centre line is from an absolute point.
function nearest(road, ax, az, r = 60) {
  let dist = Infinity;
  road.forEachSegmentNear(ax, az, r, (i) => {
    const a = road.samples.get(i);
    const b = road.samples.get(i + 1);
    if (!a || !b) return;
    const ex = b.ax - a.ax;
    const ez = b.az - a.az;
    const t = Math.max(0, Math.min(1, ((ax - a.ax) * ex + (az - a.az) * ez) / (ex * ex + ez * ez || 1)));
    dist = Math.min(dist, Math.hypot(ax - (a.ax + ex * t), az - (a.az + ez * t)));
  });
  return dist;
}

// --- in node: the things, driven ----------------------------------------------------

async function nodeThings() {
  // (three by its own file, as the page has it in its import map.)
  register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { return s === 'three' ? { url: ${JSON.stringify(new URL('../tools/vendor/three.module.js', import.meta.url).href)}, shortCircuit: true } : n(s, c); }`));
  const THREE = await import('three');
  const { Desert } = await import('../src/render/desert.js');
  const seed = 7;
  const { land, road, corridor, plan } = planOf(seed);
  const scene = new THREE.Scene();
  const twigs = [];
  const dust = { twigs: (...a) => twigs.push(a) };
  const sun = new THREE.DirectionalLight(0xffe7c6, 4);
  const hemi = new THREE.HemisphereLight(0xd6cdbd, 0xa77f52, 0.26);
  const before = scene.children.length;
  const desert = new Desert(scene, { plan, road, worlds: land.worlds, dust, sun, hemi }, 'high');
  const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.3, 14000);
  let s = 600;
  const v = 22;
  const dt = 1 / 30;
  road.update(s);
  const car = { x: 0, z: 0, y: 0, yaw: 0, vx: v, vy: 0, speed: v };
  let steep = 0;
  let most = 0;
  for (let t = 0; t < 120; t += dt) {
    s += v * dt;
    road.update(s);
    const p = road.at(s);
    car.x = p.x;
    car.z = p.z;
    car.yaw = p.theta;
    car.y = p.y;
    cam.position.set(p.x - Math.cos(p.theta) * 8, p.y + 3, p.z - Math.sin(p.theta) * 8);
    desert.update(cam, dt, { at: land.worlds.at(p.x + road.origin.x, p.z + road.origin.z, {}), sCar: s, car, blocks: 0, px: 600 });
    most = Math.max(most, desert.devilsNear.length);
    for (const e of desert.devilsNear) if (slopeAt((x, z) => corridor.heightAt(x, z), e.x, e.z) >= DEVIL.slope) steep++;
  }
  const st = desert.stats();
  say(st.met >= 3 && st.met <= 9, `driven 120 s at 22 m/s, the car meets ${st.met} tumbleweeds (3 to 9) and breaks ${st.broken}`);
  say(steep === 0 && most <= 3, `the dust devils drawn are all on level ground (${steep} frames of one on a slope of 0.1 or more), at most ${most} at once`);
  say(st.boards >= 1 && st.poles > 10 && st.wires > 0, `billboards, poles and wires are drawn (${st.boards}, ${st.poles}, ${st.wires} segments of wire)`);
  // The tiers.
  desert.setTier('mid');
  desert.update(cam, dt, { at: { a: 4, b: 4, t: 0 }, sCar: s, car, blocks: 0, px: 600 });
  const mid = desert.stats();
  desert.setTier('low');
  desert.update(cam, dt, { at: { a: 4, b: 4, t: 0 }, sCar: s, car, blocks: 0, px: 600 });
  const low = desert.stats();
  say(mid.poles <= Math.ceil(st.poles / 2) + 2 && mid.boards === st.boards, `at mid the poles to half the distance (${mid.poles} of ${st.poles}), the billboards all (${mid.boards})`);
  say(low.boards === 0 && low.poles === 0 && low.weeds === 0 && low.devils.length === 0 && low.haze === 0, `at low none of it, and no haze`);
  desert.setTier('high');
  // A car put in a dust devil.
  let found = null;
  let tt = 0;
  const p = road.at(s);
  const o = road.origin;
  for (; tt < 3000 && !found; tt += 5) found = plan.devilsAt(tt, p.x + o.x, p.z + o.z, 2000).find((e) => e.fade > 0.5 && slopeAt((x, z) => corridor.heightAt(x, z), e.x, e.z) < DEVIL.slope);
  if (!found) {
    say(false, 'a dust devil to drive into');
  } else {
    const d2 = new Desert(scene, { plan, road, worlds: land.worlds, dust, sun, hemi }, 'high');
    d2.clock = tt - 5 - dt;
    const c2 = { x: found.x - o.x + 1, z: found.z - o.z, y: 0, yaw: 0.3, vx: 20, vy: 0, speed: 20 };
    cam.position.set(c2.x, 3, c2.z);
    d2.update(cam, dt, { at: { a: 4, b: 4, t: 0 }, sCar: s, car: c2, blocks: 0, px: 600 });
    let dv = 0;
    let steps = 0;
    for (let i = 0; i < 600; i++) {
      const k = d2.pushStep(1 / 120);
      if (k) steps++;
      dv += k;
    }
    for (let i = 0; i < 20; i++) d2.update(cam, dt, { at: { a: 4, b: 4, t: 0 }, sCar: s, car: c2, blocks: 0, px: 600 });
    say(Math.abs(Math.abs(dv) - DEVIL.push[0] * DEVIL.push[1]) < 1e-6 && Math.abs(steps / 120 - DEVIL.push[1]) < 0.02,
      `a car in a dust devil is pushed sideways ${(Math.abs(dv) / DEVIL.push[1]).toFixed(3)} m/s² for ${(steps / 120).toFixed(2)} s (0.3 for 2), once (${d2.pushes})`);
    say(d2.wash > 0.1, `and the frame is washed toward the dust (${d2.wash.toFixed(3)} of the way)`);
    d2.dispose();
  }
  // A tumbleweed in front of the car is broken into twigs.
  const d3 = new Desert(scene, { plan, road, worlds: land.worlds, dust, sun, hemi }, 'high');
  const w = plan.weed(1, s, 0);
  if (w) {
    d3.weedList.push({ w, t0: 0, met: false });
    d3.clock = w.at / w.speed;
    const at = { x: w.ax + w.dx * w.at - o.x, z: w.az + w.dz * w.at - o.z };
    const c3 = { x: at.x, z: at.z, y: corridor.heightAt(at.x + o.x, at.z + o.z), yaw: 0, vx: 20, vy: 0, speed: 20 };
    const n0 = twigs.length;
    d3.update(cam, 1e-4, { at: { a: 4, b: 4, t: 0 }, sCar: w.cross, car: c3, blocks: 0, px: 600 });
    say(d3.broken === 1 && twigs.length === n0 + 1, `a car that hits a tumbleweed breaks it into twigs (${d3.broken} broken)`);
  } else {
    say(false, 'a tumbleweed to hit');
  }
  d3.dispose();
  desert.dispose();
  // The sand at the tiers: its bands as the frame of each has them.
  {
    const d4 = new Desert(scene, { plan, road, worlds: land.worlds, dust, sun, hemi }, 'high');
    const p4 = road.at(s);
    cam.position.set(p4.x - Math.cos(p4.theta) * 8, p4.y + 3, p4.z - Math.sin(p4.theta) * 8);
    cam.lookAt(p4.x + Math.cos(p4.theta) * 60, p4.y, p4.z + Math.sin(p4.theta) * 60);
    cam.updateMatrixWorld();
    const ctx4 = { at: { a: 4, b: 4, t: 0 }, sCar: s, car, blocks: 0, px: 600, light: 1, fog: [0.8, 0.75, 0.7] };
    const counts = {};
    for (const t of ['high', 'mid', 'low']) {
      d4.setTier(t);
      d4.update(cam, 0, { ...ctx4, settle: true });
      counts[t] = d4.stats().sand;
    }
    say(counts.high <= SAND.max && counts.mid <= SAND.max / 2 && counts.low === 0, `the sand at high, mid and low: ${counts.high}, ${counts.mid}, ${counts.low} bands (at most 10, 5, none)`);
    d4.dispose();
  }
  say(scene.children.length === before, `dispose takes all of it out of the scene (${scene.children.length - before} left)`);
}

// The sand off the crests of the dunes: where each band starts is a crest (its lee as steep as its
// windward face or steeper, standing over the ground either way along the wind), 50 to 400 m off the
// road, the same for the same seed, at most ten, and none at the lowest tier.
function nodeSand() {
  for (const seed of [7, 42, 3]) {
    const name = `seed ${seed}`;
    const { road, corridor, plan } = planOf(seed);
    const again = planOf(seed);
    const h = (x, z) => corridor.heightAt(x, z);
    let bands = 0;
    let most = 0;
    let off = 0;
    let same = true;
    const lats = [];
    for (let sCar = 400; sCar <= 6000; sCar += 200) {
      road.update(sCar);
      again.road.update(sCar);
      const p = road.at(sCar);
      const o = road.origin;
      const list = plan.crestsNear(sCar - 300, sCar + 900, p.x + o.x, p.z + o.z);
      const list2 = again.plan.crestsNear(sCar - 300, sCar + 900, p.x + o.x, p.z + o.z);
      if (JSON.stringify(list.map((c) => [c.key, [...c.pts]])) !== JSON.stringify(list2.map((c) => [c.key, [...c.pts]]))) same = false;
      most = Math.max(most, list.length);
      for (const c of list) {
        bands++;
        if (!crestAt(h, c.ax, c.az, c.y).ok || c.pts[1] < c.y) off++;
        lats.push(nearest(road, c.ax, c.az, 450));
      }
    }
    say(same, `${name}: the sand off the crests is the same each time it is asked`);
    say(bands > 0 && most <= SAND.max, `${name}: ${bands} bands of sand along 5.6 km, at most ${most} at once (at most ${SAND.max})`);
    say(off === 0, `${name}: every band starts over a crest, its lee as steep as its windward face or steeper (${off} do not)`);
    say(lats.every((d) => d >= SAND.lat[0] && d <= SAND.lat[1]), `${name}: each crest ${span(lats)} m from the middle of the road (50 to 400)`);
  }
}

nodePlan();
nodeSand();
await nodeThings();
if (NODE_ONLY) {
  if (failed) {
    console.error(`\n${failed} problem${failed > 1 ? 's' : ''}`);
    process.exit(1);
  }
  console.error('\nOK: the desert, in node');
  process.exit(0);
}

// --- in the page ----------------------------------------------------------------------

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8197;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve(port = PORT) {
  return spawn('node', [ROOT + 'tools/serve.mjs', String(port), ROOT], { stdio: ['ignore', 'ignore', 'inherit'] });
}

async function waitForServer(port = PORT, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/`)).ok) return true;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  return false;
}

async function openPage(query) {
  const profile = `${tmpdir()}/continuum-desert-${process.pid}-${Date.now()}`;
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--mute-audio',
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
  for (let i = 0; i < 900; i++) {
    title = await ev('document.title');
    if (title === 'GAME_DONE' || String(title).startsWith('GAME_FAIL')) break;
    await sleep(500);
  }
  if (title !== 'GAME_DONE') {
    chrome.kill();
    throw new Error(`page: ${title}`);
  }
  return {
    run: async (body) => {
      const out = await ev(`(async () => { const g = game; ${body} })().then((v) => JSON.stringify(v), (e) => JSON.stringify({ error: e.message + ' ' + (e.stack || '').slice(0, 500) }))`);
      return JSON.parse(out);
    },
    close: () => {
      chrome.kill();
      setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
    },
  };
}

// In the page: the car on the road at the place `desert` of tools/look.mjs, run for two and a half seconds.
const PLACE = `
  const p = g.road.at(2200);
  g.autoMode = true;
  g.sCar = 2200;
  g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(2200, 1.9) + 0.3);
  g.car.vx = 22;
  g.setCamera('chase');
  g.chase.shaking = false;
  g.chase.lead = false;
  g.chase.snapTo(g.car, g.car.y || 0);
  for (let i = 0; i < 150; i++) { g.pilot.vMax = 22; g.update(1 / 60); }
  g.post.setStyle(g.style);
  g.render();
  return { world: g.snapshot().world.id, s: g.sCar, desert: g.desert.stats() };
`;

// In the page: the haze's pass drawn again with its check's output, over the depth of the frame just drawn,
// at the haze's clock t and t + 0.1 s (the depth is the same frame's: only the haze moves between them).
const HAZE = `
  const THREE = await import('three');
  const { FullScreenQuad } = await import('./tools/vendor/postprocessing/Pass.js');
  g.render();
  const h = g.post.haze;
  const on = h.enabled;
  const u = h.uniforms;
  const wu = h.weightMaterial.uniforms;
  const W = g.post.size.x, H = g.post.size.y;
  const weights = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, depthBuffer: false });
  const wq = new FullScreenQuad(h.weightMaterial);
  const quad = new FullScreenQuad(h.material);
  const cam = g.camera;
  wu.tDepth.value = h.tap.target.depthTexture;
  wu.uInvProj.value.copy(cam.projectionMatrixInverse);
  wu.uCamWorld.value.copy(cam.matrixWorld);
  const r = g.renderer;
  const was = r.getRenderTarget();
  const grab = (target) => {
    const px = new Float32Array(W * H * 4);
    r.readRenderTargetPixels(target, 0, 0, W, H, px);
    return px;
  };
  // The weights with how far off each pixel is, and the move over them at the haze's clock t and t + 0.1 s.
  wu.uShow.value = 1;
  r.setRenderTarget(weights);
  wq.render(r);
  wu.uShow.value = 0;
  const wt = grab(weights);
  const t0 = u.uTime.value;
  const keep = u.tWeight.value;
  u.tWeight.value = weights.texture;
  const read = (t) => {
    u.uTime.value = t;
    u.uShow.value = 1;
    r.setRenderTarget(rt);
    quad.render(r);
    u.uShow.value = 0;
    return grab(rt);
  };
  const a = read(t0);
  const b = read(t0 + 0.1);
  u.uTime.value = t0;
  u.tWeight.value = keep;
  r.setRenderTarget(was);
  wq.dispose();
  quad.dispose();
  weights.dispose();
  rt.dispose();
  let far = 0, farN = 0, flat = 0, flatN = 0, nearMax = 0, nearN = 0, most = 0, moved = 0;
  for (let i = 0; i < W * H; i++) {
    const d = wt[i * 4 + 1] * 10000;
    most = Math.max(most, Math.abs(a[i * 4]));
    if (a[i * 4] !== 0) moved++;
    if (d <= 0) continue;
    if (d >= 300 && d <= 1500) {
      far += Math.abs(b[i * 4] - a[i * 4]);
      farN++;
      // The land seen near level (its rise from the lens under 2% of the way): the flats, not the mesas over them.
      if (wt[i * 4 + 2] < 0.02) { flat += Math.abs(b[i * 4] - a[i * 4]); flatN++; }
    }
    if (d < 200) { nearMax = Math.max(nearMax, Math.abs(a[i * 4]), Math.abs(b[i * 4])); nearN++; }
  }
  return { on, k: u.uK.value, far: farN ? far / farN : null, farN, flat: flatN ? flat / flatN : null, flatN, nearMax, nearN, most, moved, W, H };
`;

const STYLED = (id) => `
  g.style.set(${JSON.stringify(id)}, true);
  g.style.applyScene();
  for (let i = 0; i < 20; i++) g.style.update(0.1);
  g.style.applyScene();
  g.render();
  return { id: ${JSON.stringify(id)}, haze: g.post.haze.enabled };
`;

const COST = (tier) => `
  g.desert.setTier(${JSON.stringify(tier)});
  g.desert.update(g.camera, 0, { at: g._wl || g._lookAt, sCar: g.sCar, car: g.car, blocks: g.style.cur.blocks, settle: true, px: 700 });
  g.render();
  const r = g.renderer;
  return { tier: ${JSON.stringify(tier)}, calls: r.info.render.calls, triangles: r.info.render.triangles, programs: r.info.programs.length, stats: g.desert.stats(), haze: g.post.haze.enabled };
`;

// In the page: the frame of the place with the sand off the crests and without it, at 640 by 288; the pixels it
// changes, and how many of them have the sky behind them.
const SAND_PX = `
  const THREE = await import('three');
  g.desert.setTier('high');
  g.desert.update(g.camera, 0, { ...g._alpineCtx(g.sceneHeight, true), car: g.car });
  g.render();
  const bands = g.desert.sand.count;
  const W = 640, H = 288;
  const mesh = g.desert.sand.mesh;
  const on = g.post.capture(W, H).pixels;
  mesh.visible = false;
  const off = g.post.capture(W, H).pixels;
  mesh.visible = true;
  g.camera.updateMatrixWorld();
  const f = new THREE.Vector3();
  g.camera.getWorldDirection(f);
  f.y = 0;
  f.normalize();
  const v = g.camera.position.clone().addScaledVector(f, 10000).project(g.camera);
  const row = (v.y * 0.5 + 0.5) * H;
  let changed = 0, sky = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (Math.abs(on[i] - off[i]) + Math.abs(on[i + 1] - off[i + 1]) + Math.abs(on[i + 2] - off[i + 2]) <= 3) continue;
    changed++;
    // (What is behind it, in the frame without it, is the sky: a blue more blue than red, which the desert's land is not.)
    if (off[i + 2] > off[i] + 12) sky++;
  }
  return { bands, changed, sky, w: W, h: H, row };
`;

async function pagePart() {
  const server = serve();
  if (!(await waitForServer())) {
    console.error('FAIL: no server');
    server.kill();
    process.exit(1);
  }
  let page = null;
  try {
    page = await openPage('seed=7&world=desert&s=2200&run=60&cam=chase&style=real');
    const placed = await page.run(PLACE);
    if (placed.error) throw new Error(placed.error);
    say(placed.world === 'desert', `the place is in the desert (${placed.world}, ${placed.s} m)`);
    const near = placed.desert.devils.length;
    say(near <= 2, `dust devils within 2 km: ${near} (0 to 2)`);
    const hz = await page.run(HAZE);
    if (hz.error) throw new Error(hz.error);
    say(hz.on && hz.k > 0.5, `the heat haze is on in the real style (${hz.k.toFixed(2)})`);
    say(hz.flat >= 0.4, `the flats 300 to 1500 m off (seen at a rise under 2%) move ${hz.flat.toFixed(3)} px on average between two frames 0.1 s apart (at least 0.4; ${hz.flatN} pixels); all that is 300 to 1500 m off, the mesas with it, ${hz.far.toFixed(3)} px (${hz.farN} pixels)`);
    say(hz.nearMax === 0, `nothing nearer than 200 m moves (the car, the road under it: ${hz.nearN} pixels, ${hz.nearMax} px at the most)`);
    say(hz.most <= 1.5 + 1e-4, `no pixel moves more than 1.5 px (${hz.most.toFixed(3)})`);
    for (const id of ['paint', 'ink', 'cel', 'print', 'pixel', 'block', 'real']) {
      const r = await page.run(STYLED(id));
      const want = id === 'real' || id === 'paint';
      say(r.haze === want, `${id}: the heat haze is ${r.haze ? 'on' : 'off'}`);
    }
    const low = await page.run(COST('low'));
    const mid = await page.run(COST('mid'));
    const high = await page.run(COST('high'));
    const add = (a, b) => ({ calls: a.calls - b.calls, triangles: a.triangles - b.triangles });
    const aH = add(high, low);
    const aM = add(mid, low);
    console.error(`     what it adds to a frame: at high ${aH.calls} calls and ${aH.triangles} triangles, at mid ${aM.calls} and ${aM.triangles}; ${high.programs} programs in all`);
    say(aH.calls <= 8 && aH.triangles <= 60000, `at the high tier at most 8 calls and 60 000 triangles (${aH.calls}, ${aH.triangles})`);
    say(aM.calls <= 8 && aM.triangles <= 30000, `at the middle tier at most 30 000 triangles (${aM.triangles})`);
    say(!low.haze && low.stats.boards === 0, 'at the low tier none of it, and no haze');
    const sand = await page.run(SAND_PX);
    if (sand.error) throw new Error(sand.error);
    say(sand.bands > 0 && sand.changed > 0, `the sand off the crests is in the frame of the place desert: ${sand.bands} bands, ${sand.changed} pixels of ${sand.w} x ${sand.h} changed by it`);
    say(sand.sky <= 0.1 * sand.changed, `and not in the sky: ${sand.sky} of them have the sky behind them (at most a tenth)`);
    const gone = await page.run(`const n = g.scene.children.length; const sand = g.desert.sand.mesh.parent ? 1 : 0; g.desert.dispose(); return { left: n - g.scene.children.length, sand };`);
    say(gone.left === 6 + gone.sand, `dispose takes its ${6 + gone.sand} things out of the scene (${gone.left})`);
  } finally {
    if (page) page.close();
    server.kill();
  }
}

await pagePart();
if (failed) {
  console.error(`\n${failed} problem${failed > 1 ? 's' : ''}`);
  process.exit(1);
}
console.error('\nOK: the desert');
