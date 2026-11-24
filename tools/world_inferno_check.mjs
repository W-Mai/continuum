// What the inferno has of its own is there, where it should be, and costs what it should.
//
// In node first (no browser), over three seeds: the plan (world/infernoplan.js) is the same each time
// it is asked; a minute of the lens going down the road at 22 m/s has 10 to 30 splashes, each rising
// from the lava, of 12 to 30 drops thrown at 6 to 14 m/s, each of which comes down on the lava (and is
// gone there) or on the bank (where it lies); a vent is one to a kilometre at most, 40 m and more from
// the road, out of the lava and on ground that is not steep, burning 1.5 s in every 6; the light off the
// lava a land tile carries is there only within 60 m of lava and points at it; and the things themselves
// (render/inferno.js, without a renderer) driven for 60 s meet as many splashes as the plan has, the
// light from below goes up and down by no more than 8% (and by some), and nothing of it is drawn at the
// low tier or out of the inferno.
//
// Then in the page (seed 7, the place `inferno` of tools/look.mjs), unless --node-only: the heat haze's
// pass, drawn with its check's output (render/post.js, LAVA_HAZE), moves the lava's surface between 40 and
// 1500 m off, nothing nearer than 20 m, and nothing by more than 2 px; it is on in the real and the
// painted styles and off in the others; every style draws it all without a GL error; a drop that comes
// down on the lava is not drawn 0.1 s after (its whole splash drawn alone: nothing), and is before; the
// ground within 30 m of a vent is at least 20% brighter while it burns than between; the crust drifts
// 1 to 3 m in 5 s, down the channel; the land's tiles near the lava carry its light, and the hills' none;
// what it adds to a frame at each tier; and dispose lets it go.
//
// Usage: node tools/world_inferno_check.mjs [--node-only] [--keep <dir>]
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { register } from 'node:module';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { makeWorldLand } from '../src/world/worlds.js';
import { Road } from '../src/world/road.js';
import { Corridor } from '../src/world/corridor.js';
import { InfernoPlan, SPLASH, VENT, GLOW, splashGap, ventBurn, lavaGlow } from '../src/world/infernoplan.js';

const ROOT = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const NODE_ONLY = args.includes('--node-only');
const KEEP = args.includes('--keep') ? args[args.indexOf('--keep') + 1] : null;

let failed = 0;
const say = (ok, text) => {
  console.error(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};
const span = (a) => (a.length ? `${Math.min(...a).toFixed(2)}..${Math.max(...a).toFixed(2)}` : 'none');

// --- in node: the plan -------------------------------------------------------------

function planOf(seed) {
  const land = makeWorldLand(seed, { start: 'inferno' });
  const road = new Road(land, seed);
  const corridor = new Corridor(road, land);
  const plan = new InfernoPlan({ land, road, corridor, worlds: land.worlds, seed });
  return { land, road, corridor, plan };
}

// The nearest the road's centre line comes to a point (absolute), from its samples.
function nearest(road, ax, az) {
  let best = Infinity;
  road.forEachSegmentNear(ax, az, 400, (i) => {
    const a = road.samples.get(i);
    const b = road.samples.get(i + 1);
    if (!a || !b) return;
    const ex = b.ax - a.ax;
    const ez = b.az - a.az;
    const t = Math.max(0, Math.min(1, ((ax - a.ax) * ex + (az - a.az) * ez) / (ex * ex + ez * ez || 1)));
    best = Math.min(best, Math.hypot(ax - (a.ax + ex * t), az - (a.az + ez * t)));
  });
  return best;
}

function nodePlan() {
  for (const seed of [7, 42, 3]) {
    const name = `seed ${seed}`;
    const { land, road, corridor, plan } = planOf(seed);
    const again = planOf(seed);
    const h = (x, z) => corridor.heightAt(x, z);
    // A minute down the road at 22 m/s from 2200 m, a splash as each comes.
    let t = 0;
    let next = splashGap(1, seed) * 0.5;
    let n = 1;
    let same = true;
    let missed = 0;
    const splashes = [];
    for (let s = 2200; t < 60; t += 1 / 30, s += 22 / 30) {
      road.update(s);
      again.road.update(s);
      if (t < next) continue;
      const p = road.at(s);
      const o = road.origin;
      const ax = p.x + o.x;
      const az = p.z + o.z;
      const sp = plan.splash(n, ax, az, Math.cos(p.theta), Math.sin(p.theta));
      const sp2 = again.plan.splash(n, ax, az, Math.cos(p.theta), Math.sin(p.theta));
      if (JSON.stringify(sp) !== JSON.stringify(sp2)) same = false;
      if (sp) {
        splashes.push({ sp, d: Math.hypot(sp.x - ax, sp.z - az) });
        n++;
        next = Math.max(next + splashGap(n, seed), t);
      } else {
        missed++;
        next = t + SPLASH.retry;
      }
    }
    say(same, `${name}: the splashes are the same each time they are asked`);
    // (Where there is no lava within 300 m there is none to splash: the rate is of the time there is, and at the place
    // of tools/look.mjs, seed 7, the minute itself.)
    const wet = 60 - missed * SPLASH.retry;
    const rate = splashes.length / wet * 60;
    if (seed === 7) say(splashes.length >= 10 && splashes.length <= 30, `${name}: a minute has ${splashes.length} splashes (10 to 30; ${missed} times none found lava within 300 m and looked again)`);
    say(rate >= 10 && rate <= 30, `${name}: ${rate.toFixed(1)} splashes a minute of the ${wet.toFixed(1)} s with lava within 300 m (10 to 30; ${splashes.length} in all)`);
    const off = splashes.filter((e) => !(h(e.sp.x, e.sp.z) < e.sp.L - SPLASH.deep + 1e-9) || land.lavaLevel(e.sp.x, e.sp.z) === -Infinity || e.d > SPLASH.reach + 1e-6);
    say(off.length === 0, `${name}: every splash rises from the lava within 300 m of the lens (${off.length} do not; ${span(splashes.map((e) => e.d))} m off)`);
    const drops = splashes.flatMap((e) => e.sp.drops.map((d) => ({ e, d })));
    const counts = splashes.map((e) => e.sp.drops.length);
    say(Math.min(...counts) >= 12 && Math.max(...counts) <= 30, `${name}: 12 to 30 drops a splash (${span(counts)})`);
    const speeds = drops.map(({ d }) => Math.hypot(d.vx, d.vy, d.vz));
    say(Math.min(...speeds) >= 6 - 1e-9 && Math.max(...speeds) <= 14 + 1e-9, `${name}: thrown at 6 to 14 m/s (${span(speeds)})`);
    // Where each comes down: on the lava at its surface, or on the bank at the ground.
    let wrong = 0;
    let shore = 0;
    for (const { e, d } of drops) {
      const gy = h(d.ex, d.ez);
      const y = e.sp.y + d.vy * d.t - 0.5 * SPLASH.g * d.t * d.t;
      if (Math.abs(y - d.ey) > 0.05) wrong++;
      else if (d.shore) {
        shore++;
        if (Math.abs(d.ey - gy) > 0.3 || gy <= e.sp.L) wrong++;
      } else if (Math.abs(d.ey - e.sp.L) > 0.05 || gy > e.sp.L + 0.3) wrong++;
    }
    say(wrong === 0, `${name}: each drop comes down where its way meets the lava or the bank (${wrong} of ${drops.length} do not; ${shore} on the bank)`);

    // The vents along 8 km.
    for (let s = 0; s <= 9000; s += 100) road.update(s);
    const vents = plan.ventsAlong(0, 8000);
    const ks = vents.map((v) => v.k);
    say(new Set(ks).size === ks.length, `${name}: at most one vent to a kilometre (${vents.length} in 8 km)`);
    say(vents.length >= 2, `${name}: some vents in 8 km of the inferno (${vents.length})`);
    const bad = vents.filter((v) => {
      const L = land.lavaLevel(v.ax, v.az);
      const gx = (h(v.ax + 3, v.az) - h(v.ax - 3, v.az)) / 6;
      const gz = (h(v.ax, v.az + 3) - h(v.ax, v.az - 3)) / 6;
      return nearest(road, v.ax, v.az) < VENT.clear || (L !== -Infinity && v.y < L + 1) || Math.hypot(gx, gz) > VENT.steep + 0.05;
    });
    say(bad.length === 0, `${name}: each vent is 40 m and more from the road, out of the lava, on ground not steep (${bad.length} are not; ${span(vents.map((v) => nearest(road, v.ax, v.az)))} m from the road)`);
    if (seed === 7) {
      let on = 0;
      let runs = 0;
      let was = false;
      for (let c = 0; c < 60; c += 0.01) {
        const b = ventBurn(vents[0].phase, c) > 0;
        if (b) on++;
        if (b && !was) runs++;
        was = b;
      }
      say(Math.abs(on * 0.01 / runs - VENT.burst) < 0.03 && runs >= 9 && runs <= 11, `a vent burns ${(on * 0.01 / runs).toFixed(2)} s at a time, ${runs} times a minute (1.5 s in every 6)`);
      // The light off the lava on a tile by the river: within 60 m of lava, pointing at it.
      const fresh = planOf(7);
      fresh.road.update(2200);
      const p = fresh.road.at(2200);
      const o = fresh.road.origin;
      const hf = (x, z) => fresh.corridor.heightAt(x, z);
      const x0 = Math.floor((p.x + o.x) / 128) * 128;
      const z0 = Math.floor((p.z + o.z) / 128) * 128;
      const H = (i, j) => hf(x0 + i * 2, z0 + j * 2);
      const glow = lavaGlow(land, x0, z0, 2, 65, H, 0);
      let lit = 0;
      let off = 0;
      let checked = 0;
      if (glow) {
        for (let v = 0; v < 65 * 65; v += 7) {
          const w = Math.hypot(glow[v * 3], glow[v * 3 + 1], glow[v * 3 + 2]);
          if (w === 0) continue;
          lit++;
          // How far the lava is, from how much light there is, and whether it is there.
          const d = GLOW.reach * (1 - Math.sqrt(w));
          const i = v % 65;
          const j = Math.floor(v / 65);
          const ax = x0 + i * 2 + glow[v * 3] / w * d;
          const az = z0 + j * 2 + glow[v * 3 + 2] / w * d;
          checked++;
          if (!(land.heightAtCoarse(ax, az) < land.lavaLevel(ax, az) + 0.5) || d > GLOW.reach) off++;
        }
      }
      say(!!glow && lit > 0 && off <= checked * 0.05, `the light off the lava: a tile by the river has it at ${lit} of the vertices looked at, and the lava is where it points for ${checked - off} of them`);
      const hills = makeWorldLand(7, { start: 'hills' });
      say(lavaGlow(hills, 0, 0, 2, 65, (i, j) => hills.heightAt(i * 2, j * 2), 0) === null, 'and the hills have none');
    }
  }
}

// The things themselves, in node: a minute of the lens down the road.
async function nodeThings() {
  register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { return s === 'three' ? { url: ${JSON.stringify(new URL('../tools/vendor/three.module.js', import.meta.url).href)}, shortCircuit: true } : n(s, c); }`));
  const THREE = await import('three');
  const { Inferno, INFERNO_VIEW } = await import('../src/render/inferno.js');
  const { land, road, corridor, plan } = planOf(7);
  const scene = new THREE.Scene();
  const groundAt = (x, z) => corridor.heightAt(x + road.origin.x, z + road.origin.z);
  const inf = new Inferno(scene, { plan, road, worlds: land.worlds, groundAt }, 'high');
  const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.3, 14000);
  const at = { a: plan.worlds.at(0, 0).a, b: 0, t: 0 };
  const flick = [];
  let s = 2200;
  for (let i = 0; i < 3600; i++, s += 22 / 60) {
    road.update(s);
    const p = road.at(s);
    cam.position.set(p.x, p.y + 4, p.z);
    cam.lookAt(p.x + Math.cos(p.theta) * 20, p.y + 2, p.z + Math.sin(p.theta) * 20);
    cam.updateMatrixWorld();
    const w = land.worlds.at(p.x + road.origin.x, p.z + road.origin.z);
    at.a = w.a;
    at.b = w.b;
    at.t = w.t;
    inf.update(cam, 1 / 60, { at, sCar: s, blocks: 0, px: 700 });
    flick.push(inf.flicker);
  }
  const st = inf.stats();
  say(st.splashes >= 10 && st.splashes <= 30, `render/inferno.js driven for 60 s at 22 m/s: ${st.splashes} splashes (10 to 30)`);
  const lo = Math.min(...flick);
  const hi = Math.max(...flick);
  say(lo >= 1 - INFERNO_VIEW.flicker[0] - 1e-9 && hi <= 1 + INFERNO_VIEW.flicker[0] + 1e-9 && hi - lo > 0.1, `the light from below goes from ${lo.toFixed(3)} to ${hi.toFixed(3)} of itself (within 1 ± 0.08, and by more than 0.1 in all)`);
  inf.setTier('low');
  inf.update(cam, 1 / 60, { at, sCar: s, blocks: 0, px: 700 });
  say(!inf.drops.visible && !inf.columns.visible && !inf.pools.visible && inf.flicker === 1 && inf.haze === 0, 'at the low tier none of it is drawn, and no flicker or haze');
  // Out of the inferno: the hills.
  const hl = makeWorldLand(7, { start: 'hills' });
  const hroad = new Road(hl, 7);
  const hcor = new Corridor(hroad, hl);
  const hp = new InfernoPlan({ land: hl, road: hroad, corridor: hcor, worlds: hl.worlds, seed: 7 });
  const hs = new THREE.Scene();
  const hi2 = new Inferno(hs, { plan: hp, road: hroad, worlds: hl.worlds, groundAt: () => 0 }, 'high');
  hroad.update(2200);
  const q = hroad.at(2200);
  cam.position.set(q.x, q.y + 4, q.z);
  for (let i = 0; i < 600; i++) hi2.update(cam, 1 / 60, { at: { a: 1, b: 1, t: 0 }, sCar: 2200, blocks: 0, px: 700 });
  say(!hi2.on && hi2.splashes === 0 && !hi2.pools.visible && hi2.flicker === 1, 'in the hills none of it is worked out or drawn');
  const before = scene.children.length;
  inf.dispose();
  say(before - scene.children.length === 4, `dispose takes its four things out of the scene (${before - scene.children.length})`);
}

nodePlan();
await nodeThings();
if (NODE_ONLY) {
  if (failed) {
    console.error(`\n${failed} problem${failed > 1 ? 's' : ''}`);
    process.exit(1);
  }
  console.error('\nOK: the inferno, in node');
  process.exit(0);
}

// --- in the page ----------------------------------------------------------------------

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8199;
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
  const profile = `${tmpdir()}/continuum-inferno-${process.pid}-${Date.now()}`;
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

// In the page: the car on the road at the place `inferno` of tools/look.mjs, run for two and a half seconds.
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
  return { world: g.snapshot().world.id, s: g.sCar, inferno: g.inferno.stats() };
`;

// The frame as it is on the canvas, as its mean grey and, in a disc (x, y, r: of the canvas's pixels), its mean grey there.
const GREY = `
  const grey = (disc) => {
    const canvas = document.getElementById('view');
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const x = c.getContext('2d');
    x.drawImage(canvas, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let sum = 0, n = 0;
    for (let j = 0; j < c.height; j++) for (let i = 0; i < c.width; i++) {
      if (disc && (i - disc[0]) ** 2 + (j - disc[1]) ** 2 > disc[2] ** 2) continue;
      const k = (j * c.width + i) * 4;
      sum += (d[k] + d[k + 1] + d[k + 2]) / 3; n++;
    }
    return { mean: n ? sum / n : 0, n, png: canvas.toDataURL('image/png') };
  };
`;

// In the page: the haze's pass drawn again with its check's output (as tools/world_desert_check.mjs does), over the
// depth of the frame just drawn, at the haze's clock t and t + 0.1 s, with the height of each pixel's point in the world
// (for whether it is the lava's surface).
const HAZE = `
  const THREE = await import('three');
  const { FullScreenQuad } = await import('./tools/vendor/postprocessing/Pass.js');
  g.render();
  const h = g.post.haze;
  const on = h.enabled;
  const u = h.uniforms;
  const wu = h.weightMaterial.uniforms;
  const lava = wu.uLava.value.x;
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
  let moveSum = 0, moveN = 0, lavaPx = 0, lavaOn = 0, nearMax = 0, nearN = 0, most = 0, high = 0, highMoved = 0;
  for (let i = 0; i < W * H; i++) {
    const d = wt[i * 4 + 1] * 10000;
    const k = wt[i * 4];
    most = Math.max(most, Math.abs(a[i * 4]));
    if (d <= 0) continue;
    const y = wt[i * 4 + 3];
    if (d < 20) { nearMax = Math.max(nearMax, Math.abs(a[i * 4]), Math.abs(b[i * 4])); nearN++; }
    if (d >= 40 && d <= 1500 && Math.abs(y - g.water.level) < 0.3) { lavaPx++; if (k > 0) lavaOn++; }
    if (d >= 40 && y > g.water.level + 14) { high++; if (a[i * 4] !== 0) highMoved++; }
    if (k > 0 && d >= 40 && d <= 1500) { moveSum += Math.abs(b[i * 4] - a[i * 4]); moveN++; }
  }
  return { on, lava, k: u.uK.value, amp: u.uAmp.value, move: moveN ? moveSum / moveN : null, moveN, lavaPx, lavaOn, nearMax, nearN, most, high, highMoved, W, H };
`;

const STYLED = (id) => `
  ${GREY}
  g.style.set(${JSON.stringify(id)}, true);
  g.style.applyScene();
  g.post.setStyle(g.style);
  for (let i = 0; i < 20; i++) g.style.update(0.1);
  g.style.applyScene();
  const gl = g.renderer.getContext();
  const errors = () => { let n = 0; while (gl.getError() !== gl.NO_ERROR && n < 50) n++; return n; };
  errors();
  g.inferno.update(g.camera, 0, { at: g._wl || g._lookAt, sCar: g.sCar, blocks: g.style.cur.blocks, ground: g._lavaLight(), settle: true, px: 700 });
  g.render();
  const e = errors();
  const shot = ${KEEP ? 'grey().png' : 'null'};
  return { id: ${JSON.stringify(id)}, haze: g.post.haze.enabled, errors: e, png: shot };
`;

// A splash drawn alone (its drops' mesh in a scene of its own, into a target of its own), seen from 30 m off and
// over it, at a time on its clock: how many pixels it lights. spots: whether the drops that come down on the bank
// lie there (else they are as the others: gone where they come down).
const DROPS = `
  const THREE = await import('three');
  const inf = g.inferno;
  const o = g.road.origin;
  // A splash of its own in the first slot, from the lava nearest the lens that the plan finds.
  const p = g.road.at(g.sCar);
  let sp = null;
  for (let n = 1000; n < 1100 && !sp; n++) sp = g.infernoPlan.splash(n, p.x + o.x, p.z + o.z, Math.cos(p.theta), Math.sin(p.theta));
  const e = { s: sp, t0: inf.clock, slot: 0 };
  inf.splashList = [e];
  inf._write(e);
  const lx = sp.x - o.x, lz = sp.z - o.z;
  const cam = new THREE.PerspectiveCamera(60, 1, 0.3, 2000);
  cam.position.set(lx + 30, sp.y + 18, lz + 30);
  cam.lookAt(lx, sp.y + 4, lz);
  cam.updateMatrixWorld();
  const scene = new THREE.Scene();
  const mesh = new THREE.Points(inf.drops.geometry, inf.splashMaterial);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const W = 256;
  const rt = new THREE.WebGLRenderTarget(W, W, { type: THREE.FloatType });
  const r = g.renderer;
  const was = r.getRenderTarget();
  const lit = (at, spots) => {
    const t = inf._t.array;
    const keep = [];
    for (let i = 0; i < sp.drops.length; i++) { keep.push(t[i * 4 + 2]); if (!spots) t[i * 4 + 2] = 0; }
    inf._t.needsUpdate = true;
    inf.splashMaterial.uniforms.uNow.value = e.t0 - inf._base + at;
    inf.splashMaterial.uniforms.uShare.value = 1;
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(scene, cam);
    const px = new Float32Array(W * W * 4);
    r.readRenderTargetPixels(rt, 0, 0, W, W, px);
    for (let i = 0; i < sp.drops.length; i++) t[i * 4 + 2] = keep[i];
    inf._t.needsUpdate = true;
    let n = 0;
    for (let i = 0; i < W * W; i++) if (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2] > 1e-4) n++;
    return n;
  };
  const tMin = Math.min(...sp.drops.map((d) => d.t));
  const tMax = Math.max(...sp.drops.map((d) => d.t));
  const out = {
    drops: sp.drops.length, shore: sp.drops.filter((d) => d.shore).length, tMin, tMax,
    flying: lit(tMin * 0.5, false), after: lit(tMax + 0.1, false), spots: lit(tMax + 0.1, true), spotsGone: lit(tMax + ${SPLASH.spot} + 0.1, true),
  };
  r.setRenderTarget(was);
  rt.dispose();
  inf.splashList = [];
  inf._write({ s: { x: 0, y: 0, z: 0, drops: [] }, t0: 0, slot: 0 });
  return out;
`;

// The nearest vent, looked down on from 70 m over it: the ground within 30 m while it burns and between, the column
// and its sparks hidden (the light it lays on the ground is what is measured).
const VENTED = `
  ${GREY}
  const inf = g.inferno;
  const ctx = { at: g._wl || g._lookAt, sCar: g.sCar, blocks: g.style.cur.blocks, ground: g._lavaLight(), settle: true, px: 700 };
  inf.update(g.camera, 0, ctx);
  const v = inf.ventList[0];
  if (!v) return { none: true };
  const o = g.road.origin;
  const lx = v.v.ax - o.x, lz = v.v.az - o.z;
  const cam = g.camera;
  const keepPos = cam.position.clone();
  const keepQ = cam.quaternion.clone();
  const shot = (burning) => {
    // The clock at the middle of a burst, or half way between two.
    const phase = v.v.phase;
    const want = burning ? 0.75 : 3.75;
    const c = ((want / ${VENT.period} - phase) % 1 + 1) % 1 * ${VENT.period} + ${VENT.period} * 20;
    inf.clock = c;
    cam.position.set(lx + 0.01, v.v.y + 70, lz);
    cam.lookAt(lx, v.v.y, lz);
    cam.updateMatrixWorld();
    inf.update(cam, 0, ctx);
    inf.columns.visible = false;
    inf.sparks.visible = false;
    g.render();
    // The disc of 30 m round the vent on the screen.
    const canvas = document.getElementById('view');
    const h = canvas.height;
    const r = ${VENT.light} / (70 * Math.tan(cam.fov * Math.PI / 360)) * h / 2;
    return { burn: inf.ventList[0] ? inf.ventList[0].burn : -1, ...grey([canvas.width / 2, h / 2, r]) };
  };
  const on = shot(true);
  const off = shot(false);
  cam.position.copy(keepPos);
  cam.quaternion.copy(keepQ);
  cam.updateMatrixWorld();
  return { on: on.mean, off: off.mean, burnOn: on.burn, burnOff: off.burn, n: on.n, d: Math.hypot(lx - keepPos.x, lz - keepPos.z), pngOn: ${KEEP ? 'on.png' : 'null'}, pngOff: ${KEEP ? 'off.png' : 'null'} };
`;

// Five seconds of the lava's clock: how far its crust has drifted, and which way against the way it runs there.
const CRUST = `
  const w = g.water;
  const a = { ...w.lavaGone };
  for (let i = 0; i < 300; i++) g.update(1 / 60);
  const b = { ...w.lavaGone };
  const o = g.road.origin;
  const f = g.land.lavaFlowAt(g.camera.position.x + o.x, g.camera.position.z + o.z, {});
  const dx = b.x - a.x, dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  return { near: w.lavaNear, d, along: d ? (dx * f.x + dz * f.z) / d : 0, uA: w.uniforms.uLavaA.value.toArray() };
`;

// The land's tiles drawn: how many carry the light off the lava.
const TILES = `
  let lit = 0, all = 0;
  for (const k of g.terrain.rendered) {
    const m = g.terrain.tiles.get(k);
    if (!m || !m.geometry.attributes.position) continue;
    all++;
    if (m.geometry.attributes.aLava) lit++;
  }
  return { lit, all, glow: g.inferno.stats().lavaLit };
`;

const COST = (tier) => `
  g.inferno.setTier(${JSON.stringify(tier)});
  const ctx = { at: g._wl || g._lookAt, sCar: g.sCar, blocks: g.style.cur.blocks, ground: g._lavaLight(), settle: true, px: 700 };
  g.inferno.clock = 0.75 - (g.inferno.ventList[0] ? g.inferno.ventList[0].v.phase * ${VENT.period} : 0) + 60;
  g.inferno.update(g.camera, 0, ctx);
  g.render();
  const r = g.renderer;
  return { tier: ${JSON.stringify(tier)}, calls: r.info.render.calls, triangles: r.info.render.triangles, programs: r.info.programs.length, haze: g.post.haze.enabled, stats: g.inferno.stats() };
`;

async function pagePart() {
  const server = serve();
  if (!(await waitForServer())) {
    console.error('FAIL: no server');
    server.kill();
    process.exit(1);
  }
  let page = null;
  if (KEEP) mkdirSync(KEEP, { recursive: true });
  const keep = (name, png) => {
    if (KEEP && png) writeFileSync(`${KEEP}/${name}.png`, Buffer.from(png.split(',')[1], 'base64'));
  };
  try {
    page = await openPage('seed=7&world=inferno&s=2200&run=60&cam=chase&style=real');
    const placed = await page.run(PLACE);
    if (placed.error) throw new Error(placed.error);
    say(placed.world === 'inferno', `the place is in the inferno (${placed.world}, ${placed.s} m)`);
    const hz = await page.run(HAZE);
    if (hz.error) throw new Error(hz.error);
    say(hz.on && hz.lava > 0.5 && hz.amp === 2, `the heat haze is on over the lava in the real style (${hz.k.toFixed(2)}, up to ${hz.amp} px)`);
    say(hz.lavaPx > 0 && hz.lavaOn >= hz.lavaPx * 0.95, `the lava's surface 40 to 1500 m off is in it: ${hz.lavaOn} of ${hz.lavaPx} pixels`);
    say(hz.move >= 0.4, `what is in it moves ${hz.move === null ? 'none' : hz.move.toFixed(3)} px on average between two frames 0.1 s apart (at least 0.4; ${hz.moveN} pixels)`);
    say(hz.nearMax === 0, `nothing nearer than 20 m moves (the car, the road under it: ${hz.nearN} pixels, ${hz.nearMax} px at the most)`);
    say(hz.highMoved === 0, `nothing 14 m and more over the lava moves (${hz.highMoved} of ${hz.high} pixels)`);
    say(hz.most <= 2 + 1e-4, `no pixel moves more than 2 px (${hz.most.toFixed(3)})`);
    const dr = await page.run(DROPS);
    if (dr.error) throw new Error(dr.error);
    say(dr.flying > 0 && dr.after === 0, `a splash of ${dr.drops} drops lights ${dr.flying} pixels on its way and none 0.1 s after its last drop came down on the lava (${dr.after})`);
    say(dr.shore === 0 || (dr.spots > 0 && dr.spotsGone === 0), `the ${dr.shore} that came down on the bank lie there (${dr.spots} pixels) and are gone 4 s on (${dr.spotsGone})`);
    const vt = await page.run(VENTED);
    if (vt.error) throw new Error(vt.error);
    if (vt.none) say(false, 'a vent within 1.5 km of the place');
    else {
      keep('vent-on', vt.pngOn);
      keep('vent-off', vt.pngOff);
      say(vt.burnOn > 0.9 && vt.burnOff === 0 && vt.on >= vt.off * 1.2, `the ground within 30 m of a vent ${vt.d.toFixed(0)} m off: ${vt.on.toFixed(1)} while it burns, ${vt.off.toFixed(1)} between (at least 20% brighter: ${((vt.on / vt.off - 1) * 100).toFixed(0)}%)`);
    }
    const tl = await page.run(TILES);
    say(tl.lit > 0 && Math.max(...tl.glow) > 0, `the land's tiles near the lava carry its light (${tl.lit} of ${tl.all} drawn), and it is lit (${tl.glow.map((x) => x.toFixed(2)).join(', ')})`);
    const cr = await page.run(CRUST);
    if (cr.error) throw new Error(cr.error);
    say(cr.near && cr.d >= 1 && cr.d <= 3 && cr.along > 0.95, `the crust drifts ${cr.d.toFixed(2)} m in 5 s (1 to 3), down its channel (${cr.along.toFixed(3)} of the way)`);
    for (const id of ['paint', 'ink', 'cel', 'print', 'pixel', 'block', 'real']) {
      const r = await page.run(STYLED(id));
      if (r.error) throw new Error(r.error);
      keep(`style-${id}`, r.png);
      const want = id === 'real' || id === 'paint';
      say(r.haze === want && r.errors === 0, `${id}: drawn without a GL error (${r.errors}), the heat haze ${r.haze ? 'on' : 'off'}`);
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
    say(!low.haze && !low.stats.vents.length, 'at the low tier none of it, and no haze');
    const gone = await page.run(`const n = g.scene.children.length; g.inferno.dispose(); return { left: n - g.scene.children.length };`);
    say(gone.left === 4, `dispose takes its four things out of the scene (${gone.left})`);
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
console.error('\nOK: the inferno');
