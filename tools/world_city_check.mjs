// What the city has of its own is there, where it should be, and costs what it should.
//
// In node first (no browser), over three seeds: the railway (world/cityrail.js) is the same each
// time it is laid, every span of it is 60 to 120 m from the road and in the city, and two minutes
// driven at 22 m/s from 2200 m into the city meet 2 to 4 trains, each on the railway; what stands
// on a roof (world/cityplan.js) is 0 to 6 things, inside the roof and none in another, and a sign
// is inside its face, over the street floor and within the three storeys over the ground.
//
// Then in the page (the city, seed 7, the place `city` of tools/look.mjs): at least 60% of the
// towers within 300 m of the lens have something on their roof; 1 to 40 signs are in the picture
// (within 150 m, facing the lens, in the frustum), and every sign within reach faces the road and the lens; no tower stands on the railway; what it adds to a
// frame (draw calls, triangles, programs) against the same frame without it, by tier (at most 8 calls
// at high); two minutes of driving meet 2 to 4 trains, the front of each within 0.5 m of the middle
// of the railway at every step; each of the real, painted, ink and block styles draws it; and last it
// is disposed of and what it held is let go.
//
// Usage: node tools/world_city_check.mjs [--node-only] [--keep out/city-check]
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { makeWorldLand } from '../src/world/worlds.js';
import { Road } from '../src/world/road.js';
import { CityRail, RAIL, TRAIN, segDist } from '../src/world/cityrail.js';
import { roofOf, signOf, SIGN, ROOF } from '../src/world/cityplan.js';

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

// --- in node -------------------------------------------------------------------------

function railOf(seed) {
  const land = makeWorldLand(seed, { start: 'city' });
  const road = new Road(land, seed);
  const rail = new CityRail(road, land, seed);
  return { land, road, rail };
}

// The nearest the road comes to a point (absolute), over the road there is.
function roadGap(road, x, z) {
  let best = Infinity;
  for (let s = road.start; s <= road.end; s += 3) {
    const p = road.at(s);
    if (p) best = Math.min(best, Math.hypot(p.x + road.origin.x - x, p.z + road.origin.z - z));
  }
  return best;
}

// How far a point is from the middle line of the railway's spans.
function offRail(rail, x, z) {
  let best = Infinity;
  for (let k = rail.k0; k < rail.k1; k++) {
    if (!rail.span(k)) continue;
    const a = rail.nodes.get(k);
    const b = rail.nodes.get(k + 1);
    best = Math.min(best, segDist(x, z, a.x, a.z, b.x, b.z));
  }
  return best;
}

function nodePart() {
  for (const seed of [7, 42, 3]) {
    const name = `seed ${seed}`;
    const { road, rail } = railOf(seed);
    const again = railOf(seed);
    rail.update(200);
    again.rail.update(200);
    const nodes = [...rail.nodes.values()];
    const same = nodes.length > 100 && nodes.every((n) => {
      const m = again.rail.nodes.get(n.k);
      return m && m.x === n.x && m.z === n.z && m.y === n.y && m.ok === n.ok;
    });
    say(same, `${name}: the railway is the same each time it is laid (${nodes.length} nodes, every ${RAIL.step} m of road)`);
    const spans = [];
    for (let k = rail.k0; k < rail.k1; k++) if (rail.span(k)) spans.push(k);
    say(spans.length >= 0.6 * nodes.length, `${name}: ${spans.length} of its ${nodes.length - 1} stretches are spans of the viaduct`);
    const gaps = [];
    const shares = [];
    for (const k of spans) {
      const a = rail.nodes.get(k);
      const b = rail.nodes.get(k + 1);
      for (const t of [0, 0.5, 1]) {
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        gaps.push(roadGap(road, x, z));
        shares.push(rail.share(x, z));
      }
    }
    say(Math.min(...gaps) >= 60 - 1 && Math.max(...gaps) <= 120 + 1, `${name}: every span is 60 to 120 m from the road, at its ends and its middle (${span(gaps)} m, give or take a metre for the road's samples)`);
    say(Math.min(...shares) >= RAIL.share, `${name}: and in the city (its share there ${span(shares)}, at least ${RAIL.share})`);
    const tops = nodes.filter((n) => n.ok).map((n) => n.y - road.land.heightAt(n.x, n.z));
    say(Math.abs(Math.min(...tops) - RAIL.deck) < 1e-6 && Math.abs(Math.max(...tops) - RAIL.deck) < 1e-6, `${name}: its deck is ${RAIL.deck} m over the ground`);

    // Two minutes of driving.
    const drive = railOf(seed);
    let sCar = 2200;
    const p = {};
    const met = new Map();
    let worst = 0;
    let steps = 0;
    for (let t = 0; t < 120; t += 1 / 30) {
      sCar += 22 / 30;
      drive.road.update(sCar);
      drive.rail.update(sCar);
      const c = drive.road.at(sCar);
      for (const tr of drive.rail.runTrains(t, sCar)) {
        if (!drive.rail.at(tr.head, p) || !p.ok) continue;
        steps++;
        worst = Math.max(worst, offRail(drive.rail, p.x, p.z));
        const d = Math.hypot(p.x - c.x - drive.road.origin.x, p.z - c.z - drive.road.origin.z);
        met.set(tr.n, Math.min(met.has(tr.n) ? met.get(tr.n) : Infinity, d));
      }
    }
    const byCar = [...met.values()].filter((d) => d < 200);
    say(byCar.length >= 2 && byCar.length <= 4, `${name}: two minutes at 22 m/s meet ${byCar.length} trains (2 to 4), the nearest each comes to the car ${byCar.map((d) => d.toFixed(0)).join(', ')} m`);
    say(steps > 100 && worst <= 0.5, `${name}: the front of a train is on the middle of the railway at all ${steps} steps it is drawn (off by ${worst.toFixed(3)} m at the most)`);
  }

  // The roofs.
  let all = 0;
  let topped = 0;
  let most = 0;
  let outside = 0;
  let into = 0;
  for (let i = 0; i < 60; i++) {
    for (let j = 0; j < 60; j++) {
      const w = 16 + 22 * ((i * 7 + j * 13) % 23) / 22;
      const d = 16 + 22 * ((i * 11 + j * 5) % 19) / 18;
      const out = [];
      const n = roofOf(out, i, j, 7, 0, 0, 0, w, d, 0);
      all++;
      if (n) topped++;
      most = Math.max(most, n);
      const boxes = [];
      for (let q = 0; q < out.length; q += 9) {
        const [x, , z, sx, , sz] = out.slice(q, q + 6);
        if (Math.abs(x) + sx / 2 > w / 2 + 1e-6 || Math.abs(z) + sz / 2 > d / 2 + 1e-6) outside++;
        for (const b of boxes) if (Math.abs(b[0] - x) < (b[2] + sx) / 2 && Math.abs(b[1] - z) < (b[3] + sz) / 2) into++;
        boxes.push([x, z, sx, sz]);
      }
    }
  }
  say(most <= ROOF.most && outside === 0 && into === 0, `roofs: 0 to ${most} things on a roof (at most ${ROOF.most}), none over its edge (${outside}) and none in another (${into})`);
  say(topped / all >= 0.6, `roofs: ${(100 * topped / all).toFixed(1)}% of ${all} roofs of 16 to 38 m a side have something on them`);

  // The signs.
  let bad = 0;
  let blink = 0;
  const colours = new Set();
  for (let i = 0; i < 400; i++) {
    const w = 16 + (i % 23);
    const d = 16 + (i % 19);
    const s = signOf(i, i * 3 + 1, 7, w, d);
    const fw = s[0] < 2 ? d : w;
    if (s[1] - s[3] / 2 < 1 || s[1] + s[3] / 2 > fw - 1 || s[2] < 0.6 + 4.2 || s[2] + s[4] > 0.6 + 3 * 3.6) bad++;
    if (s[7] > 0) {
      blink++;
      if (s[7] < SIGN.period[0] || s[7] > SIGN.period[1]) bad++;
    }
    colours.add(s[6]);
  }
  say(bad === 0 && colours.size === 4, `signs: each is inside its face, over the street floor and under the third storey's ceiling, of one of ${colours.size} colours (${bad} are not)`);
  say(blink / 400 > 0.25 && blink / 400 < 0.42, `signs: ${(100 * blink / 400).toFixed(0)}% of them go out for a moment once every ${SIGN.period[0]} to ${SIGN.period[1]} s`);
}

nodePart();
if (NODE_ONLY) {
  if (failed) {
    console.error(`\n${failed} problem${failed > 1 ? 's' : ''}`);
    process.exit(1);
  }
  console.error('\nOK: the railway, the trains, the roofs and the signs of the city');
  process.exit(0);
}

// --- in the page ----------------------------------------------------------------------

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8193;
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
  const profile = `${tmpdir()}/continuum-city-${process.pid}-${Date.now()}`;
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

// In the page: the car put on the road at the place `city` of tools/look.mjs (2200 m into the
// city), run for two and a half seconds, and the lens as the style gives it.
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
  g.atmosphere.uniforms.uTime.value = 100;
  for (let i = 0; i < 150; i++) { g.pilot.vMax = 22; g.update(1 / 60); }
  g.post.setStyle(g.style);
  g.atmosphere.bakeEnvironment();
  return { world: g.snapshot().world.id, s: g.sCar, city: g.cityLife.stats() };
`;

// In the page: the city's things laid at a tier ('none': none of them, nor the signs) with the clock
// standing, and the frame drawn.
const TIER_FRAME = (tier) => `
  g.camera.updateMatrixWorld();
  const L = g.cityLife;
  L.setTier(${JSON.stringify(tier === 'none' ? 'low' : tier)});
  L.shift();
  L.update(g.camera, 0, g.simTime, g.sCar, g.road.origin);
  L.group.visible = ${tier !== 'none'};
  if (${tier === 'none'}) { const u = (await import('./src/render/city.js')).signU.uSign.value; u.y = 0; }
  g.render();
`;
const COST = (tier) => `${TIER_FRAME(tier)}
  const r = g.renderer;
  return { tier: ${JSON.stringify(tier)}, calls: r.info.render.calls, triangles: r.info.render.triangles, programs: r.info.programs.length, stats: L.stats() };
`;

// In the page: the signs in the picture: within reach, their face to the lens, their middle in the frustum.
const SIGNS_IN_VIEW = `
  const signsInView = (THREE) => {
  const o = g.road.origin;
  const c = g.camera.position;
  g.camera.updateMatrixWorld();
  const list = g.city.signsNear(c.x + o.x, c.z + o.z, ${SIGN.reach}, []);
  let inView = 0, facing = 0;
  const v = new THREE.Vector3();
  for (let i = 0; i < list.length; i += 5) {
    const x = list[i] - o.x, y = list[i + 1], z = list[i + 2] - o.z;
    if ((c.x - x) * list[i + 3] + (c.z - z) * list[i + 4] <= 0) continue;
    facing++;
    v.set(x, y, z).project(g.camera);
    if (Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z < 1) inView++;
  }
  return { near: list.length / 5, facing, inView };
  };
`;
const SIGNS = `${SIGNS_IN_VIEW}
  return signsInView(await import('three'));
`;

// In the page: no tower on the railway: the middle of every span within the lens's tiles is outside every tower.
const CLEAR = `
  const R = g.cityRail;
  let spans = 0, hit = 0;
  for (let k = R.k0; k < R.k1; k++) {
    if (!R.span(k)) continue;
    const a = R.nodes.get(k), b = R.nodes.get(k + 1);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      for (const y of [a.y - 1, a.y - 8, a.y + 3]) if (g.city.solidAt(x, y, z)) hit++;
    }
    spans++;
  }
  return { spans, hit, buildings: g.city.buildings };
`;

// In the page: two minutes of driving, the trains drawn and the front of each against the railway.
const DRIVE = `${SIGNS_IN_VIEW}
  const THREE = await import('three');
  const seen = [];
  const R = g.cityRail;
  const off = (x, z) => {
    let best = Infinity;
    for (let k = R.k0; k < R.k1; k++) {
      if (!R.span(k)) continue;
      const a = R.nodes.get(k), b = R.nodes.get(k + 1);
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
      best = Math.min(best, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
    }
    return best;
  };
  const met = new Map();
  let worst = 0, steps = 0, drawn = 0, heard = 0;
  const o = g.road.origin;
  for (let i = 0; i < 3600; i++) {
    g.pilot.vMax = 22;
    g.update(1 / 30);
    if (g.cityLife.counts.cars) drawn++;
    if (g.cityLife.trainNear && g.cityLife.trainNear.d < 320) heard++;
    if (i % 90 === 0) seen.push(signsInView(THREE).inView);
    if (i % 3) continue;
    for (const h of g.cityLife.heads) {
      steps++;
      worst = Math.max(worst, off(h.x, h.z));
      const d = Math.hypot(h.x - g.car.x - o.x, h.z - g.car.z - o.z);
      met.set(h.n, Math.min(met.has(h.n) ? met.get(h.n) : Infinity, d));
    }
  }
  return { seen, met: [...met.values()], worst, steps, drawn, heard, world: g.snapshot().world.id, s: g.sCar };
`;

// In the page: a style draws the city's things: the frame with them against the frame without.
const STYLED = (id) => `
  g.style.set(${JSON.stringify(id)}, true);
  g.style.applyScene();
  g.post.setStyle(g.style);
  g.atmosphere.bakeEnvironment();
  for (let i = 0; i < 20; i++) g.style.update(0.1);
  g.style.applyScene();
  g.atmosphere.bakeEnvironment();
  g.update(1 / 60);
  const gl = g.renderer.getContext();
  const canvas = document.getElementById('view');
  const errors = () => { let n = 0; while (gl.getError() !== gl.NO_ERROR && n < 50) n++; return n; };
  const signU = (await import('./src/render/city.js')).signU.uSign.value;
  const shot = (on) => {
    g.cityLife.setTier('high');
    g.cityLife.shift();
    g.cityLife.update(g.camera, 0, g.simTime, g.sCar, g.road.origin);
    g.cityLife.group.visible = on;
    signU.y = on ? 1 : 0;
    errors();
    g.render();
    const e = errors();
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    c.getContext('2d').drawImage(canvas, 0, 0);
    return { errors: e, png: canvas.toDataURL('image/png'), d: c.getContext('2d').getImageData(0, 0, c.width, c.height).data };
  };
  const off = shot(false);
  const on = shot(true);
  g.cityLife.group.visible = true;
  signU.y = 1;
  let diff = 0;
  for (let i = 0; i < on.d.length; i += 4) if (Math.abs(on.d[i] - off.d[i]) + Math.abs(on.d[i + 1] - off.d[i + 1]) + Math.abs(on.d[i + 2] - off.d[i + 2]) > 6) diff++;
  return { id: ${JSON.stringify(id)}, changed: diff / (on.d.length / 4), offErrors: off.errors, onErrors: on.errors, onPng: on.png, offPng: off.png };
`;

const DISPOSE = `
  g.render();
  const r = g.renderer;
  const before = { geometries: r.info.memory.geometries, children: g.city.group.children.length };
  g.cityLife.dispose();
  g.render();
  const after = { geometries: r.info.memory.geometries, children: g.city.group.children.length };
  return { before, after };
`;

async function pagePart() {
  const server = serve();
  if (!(await waitForServer())) {
    console.error('FAIL: no server');
    server.kill();
    process.exit(1);
  }
  const keep = KEEP ? (mkdirSync(KEEP, { recursive: true }), KEEP.replace(/\/?$/, '/')) : null;
  let page = null;
  try {
    page = await openPage('seed=7&world=city&s=2200&run=60&cam=chase&style=real&tier=high');
    const placed = await page.run(PLACE);
    if (placed.error) throw new Error(placed.error);
    say(placed.world === 'city', `the place is in the city (${placed.world}, ${placed.s.toFixed(0)} m)`);
    const st = placed.city;
    say(st.tops > 20 && st.topped / st.tops >= 0.6, `${st.topped} of the ${st.tops} towers within 300 m of the lens have something on their roof (${(100 * st.topped / Math.max(1, st.tops)).toFixed(1)}%, at least 60%): ${st.boxes} boxes and ${st.cylinders} cylinders`);
    const signs = await page.run(SIGNS);
    if (signs.error) throw new Error(signs.error);
    // (Three in ten towers within 150 m, by a park: a sign or a few in the picture, not more.)
    say(signs.inView >= 1 && signs.inView <= 40 && signs.facing === signs.near, `${signs.inView} signs are in the picture (1 to 40): ${signs.near} within ${SIGN.reach} m, ${signs.facing} of them facing the road and the lens`);
    const clear = await page.run(CLEAR);
    if (clear.error) throw new Error(clear.error);
    say(clear.spans > 20 && clear.hit === 0, `no tower stands on the railway: ${clear.hit} points of ${clear.spans} spans are inside one (of ${clear.buildings} towers)`);
    say(st.spans > 20 && st.lamps > 0 && st.plumes > 0, `drawn: ${st.spans} spans on ${st.piers} piers, ${st.plumes} plumes of steam, ${st.lamps} lamps in the parks`);

    // The cost, against the same frame without any of it.
    const none = await page.run(COST('none'));
    const low = await page.run(COST('low'));
    const mid = await page.run(COST('mid'));
    const high = await page.run(COST('high'));
    for (const c of [none, low, mid, high]) if (c.error) throw new Error(c.error);
    const add = (a) => ({ calls: a.calls - none.calls, triangles: a.triangles - none.triangles });
    const [aLow, aMid, aHigh] = [add(low), add(mid), add(high)];
    console.error(`     what it adds to the frame: high ${aHigh.calls} calls, ${aHigh.triangles} triangles; mid ${aMid.calls}, ${aMid.triangles}; low ${aLow.calls}, ${aLow.triangles}`);
    say(aHigh.calls >= 1 && aHigh.calls <= 8, `at the high tier it adds at most 8 draw calls (${aHigh.calls})`);
    say(aHigh.triangles <= 60000, `and at most 60 000 triangles (${aHigh.triangles})`);
    say(aMid.calls <= aHigh.calls && aMid.triangles <= aHigh.triangles && mid.stats.lamps <= high.stats.lamps / 2 + 1 && mid.stats.plumes <= high.stats.plumes / 2 + 1,
      `the middle tier draws less: ${mid.stats.roofs} roof things against ${high.stats.roofs}, ${mid.stats.plumes} plumes against ${high.stats.plumes}, ${mid.stats.lamps} lamps against ${high.stats.lamps}`);
    say(low.stats.roofs === 0 && low.stats.plumes === 0 && low.stats.lamps === 0 && !low.stats.signs, `the low tier has no roof things, steam, lamps of the parks or signs (the viaduct and the trains it keeps: ${aLow.calls} calls)`);

    // Each style draws it.
    for (const id of ['real', 'paint', 'ink', 'block']) {
      const r = await page.run(STYLED(id));
      if (r.error) {
        say(false, `${id}: ${r.error}`);
        continue;
      }
      say(r.onErrors <= r.offErrors && r.changed > 0.0005, `${id}: it draws the city's things (${(r.changed * 100).toFixed(2)}% of the frame is different from the frame without them, ${r.onErrors} GL errors against ${r.offErrors})`);
      if (keep) {
        writeFileSync(`${keep}${id}-off.png`, Buffer.from(r.offPng.replace(/^data:image\/png;base64,/, ''), 'base64'));
        writeFileSync(`${keep}${id}-on.png`, Buffer.from(r.onPng.replace(/^data:image\/png;base64,/, ''), 'base64'));
      }
    }
    await page.run("g.style.set('real', true); g.style.applyScene(); return 1;");

    // Two minutes of driving.
    await page.run(PLACE);
    const drive = await page.run(DRIVE);
    if (drive.error) throw new Error(drive.error);
    const by = drive.met.filter((d) => d < 200);
    say(drive.world === 'city' && by.length >= 2 && by.length <= 4, `two minutes driven in the city meet ${by.length} trains (2 to 4), the nearest each came ${by.map((d) => d.toFixed(0)).join(', ')} m (at ${drive.s.toFixed(0)} m, in ${drive.world})`);
    say(drive.steps > 100 && drive.worst <= 0.5, `the front of each is within 0.5 m of the middle of the railway at all ${drive.steps} steps it was looked at (${drive.worst.toFixed(3)} m at the most)`);
    const sorted = [...drive.seen].sort((a, b) => a - b);
    console.error(`     signs in the picture every 3 s of the drive: ${drive.seen.join(' ')} (median ${sorted[sorted.length >> 1]})`);
    console.error(`     a train is drawn for ${(drive.drawn / 30).toFixed(0)} s of the two minutes, near enough to be heard for ${(drive.heard / 30).toFixed(0)} s`);

    const gone = await page.run(DISPOSE);
    say(!gone.error && gone.before.geometries - gone.after.geometries >= 5 && gone.after.children === gone.before.children - 1,
      `disposed of: ${gone.before.geometries - gone.after.geometries} geometries gone from the renderer, its group from the city's (${gone.error || 'no error'})`);
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
console.error('\nOK: the city has its roofs, signs, railway and trains, steam and lamps, where and as many as it should');
process.exit(0);
