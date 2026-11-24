// What the valley has of its own is there, where it should be, and costs what it should.
//
// In node first (no browser), over three seeds: the plan (world/valleyplan.js) is the same each
// time it is asked; every poplar of the row stands six to fourteen metres from the shore (found
// again with a finer search than the plan's), on ground above the water and off the road, about
// nine metres from the next; every pier is one in a 1500 m of road, within 80 m of the road, with
// its end on the bank, its head over water a metre deep and its deck a hand over the water; every
// gravel bar lies over deep water on every side; the water grid is the land's water; and the modules of the bake worker, loaded
// as the worker loads them, plant the same poplars as the plain ones, byte for byte.
//
// Then in the page (the valley, seed 7, and the places of tools/look.mjs): poplars are planted in
// the tiles round the lens, each within 4 to 16 m of the shore; stones lie only within 0.4 m of the
// water's level; a pier is drawn with its end on the bank and its head over the water, with a boat
// that rises and falls; the mist is over water (200 points of it, 90% of them with water under
// them) and none is drawn 500 m from it; the lens by the water hears it and 500 m off it does
// not; at the tiers all is drawn at high, half at mid and none at low, and what it adds to a frame
// (draw calls, which meshes they are, triangles, programs) is counted against the same frame at
// low; every style draws it, and the mist is seen in each of them in a view over the river (the
// frame drawn with it and without it); and last the valley is disposed of and what it held is let go.
//
// Usage: node tools/world_valley_check.mjs [--node-only] [--keep out/valley-check]
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { makeWorldLand } from '../src/world/worlds.js';
import { Road, HALF_FLAT } from '../src/world/road.js';
import { Corridor } from '../src/world/corridor.js';
import { ValleyPlan, WaterGrid, poplarsIn, isWet, waterDepth, valleyShare, POPLAR, PIER, BAR } from '../src/world/valleyplan.js';
import { makeVegetation } from '../src/world/vegetation.js';
import * as bakery from '../src/world/bakery.js';

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

// How far the nearest water is from an absolute point, by 48 rays and steps of half a metre: finer than the plan's own search.
function shoreOf(land, x, z, reach = 24) {
  let best = Infinity;
  for (let a = 0; a < 48; a++) {
    const c = Math.cos((a / 48) * Math.PI * 2);
    const s = Math.sin((a / 48) * Math.PI * 2);
    for (let d = 0.5; d <= reach && d < best; d += 0.5) {
      if (isWet(land, x + c * d, z + s * d)) {
        best = d;
        break;
      }
    }
  }
  return best;
}

// --- in node: the plan -------------------------------------------------------------

function planOf(seed, start = 'river') {
  const land = makeWorldLand(seed, { start });
  const road = new Road(land, seed);
  const corridor = new Corridor(road, land);
  const plan = new ValleyPlan({ land, road, corridor, worlds: land.worlds, seed });
  return { land, road, corridor, plan };
}

// The poplars in every forest tile within `radius` m of an absolute point, as [ax, az, y, ...].
function poplarsNear(P, ax, az, radius, seed) {
  const T = 160;
  const out = [];
  for (let iz = Math.floor((az - radius) / T); iz <= Math.floor((az + radius) / T); iz++) {
    for (let ix = Math.floor((ax - radius) / T); ix <= Math.floor((ax + radius) / T); ix++) {
      const ctx = P.corridor.prepare(ix * T, iz * T, T, 16);
      const list = poplarsIn({ land: P.land, corridor: P.corridor }, ix * T, iz * T, T, ctx, seed);
      for (let q = 0; q < list.length; q += 7) if (Math.hypot(list[q] - ax, list[q + 1] - az) <= radius) out.push(list[q], list[q + 1], list[q + 2]);
    }
  }
  return out;
}

function nodePart() {
  for (const seed of [7, 42, 3]) {
    const P = planOf(seed);
    const again = planOf(seed);
    const { land, road, plan } = P;
    const name = `seed ${seed}`;
    // The poplars: 2 km round the place of tools/look.mjs `river` (3600 m, and the 55 m the car goes in 2.5 s); the road laid up
    // to there first (it lets go of what is far behind it).
    let ax = 0;
    let az = 0;
    for (let s = 400; s <= 6400; s += 400) {
      road.update(s);
      again.road.update(s);
      if (s === 3600) {
        const here = road.at(3655);
        ax = here.x + road.origin.x;
        az = here.z + road.origin.z;
      }
    }
    const o = road.origin;
    const list = poplarsNear(P, ax, az, 2000, seed);
    const twice = poplarsNear(again, ax, az, 2000, seed);
    say(list.length === twice.length && list.every((v, i) => v === twice[i]), `${name}: the poplars are the same each time they are asked for (${list.length / 3} of them within 2 km of the place river)`);
    if (seed === 7) say(list.length / 3 >= 60, `${name}: at least 60 poplars within 2 km of the place river (${list.length / 3})`);
    const d = [];
    const wet = [];
    const roadNear = [];
    const above = [];
    for (let q = 0; q < list.length; q += 3) {
      d.push(shoreOf(land, list[q], list[q + 1]));
      wet.push(isWet(land, list[q], list[q + 1]));
      roadNear.push(plan.roadDist(list[q], list[q + 1], 60));
      above.push(list[q + 2] - land.waterLevel(list[q], list[q + 1]));
    }
    say(d.length > 0 && Math.min(...d) >= 4 && Math.max(...d) <= 16, `${name}: each poplar is 4 to 16 m from the shore, found with 48 rays (${span(d)} m)`);
    say(!wet.some(Boolean) && Math.min(...above) > 0.6, `${name}: none stands in the water, all on ground over it (the lowest ${Math.min(...above).toFixed(2)} m over)`);
    say(Math.min(...roadNear) >= 15, `${name}: none is within 15 m of the road's middle (the nearest ${Math.min(...roadNear).toFixed(1)} m)`);
    // About nine metres from the next one along the row: the nearest neighbour of each.
    const near = [];
    for (let i = 0; i < list.length; i += 3) {
      let best = Infinity;
      for (let j = 0; j < list.length; j += 3) if (j !== i) best = Math.min(best, Math.hypot(list[i] - list[j], list[i + 1] - list[j + 1]));
      near.push(best);
    }
    const mean = near.reduce((a, b) => a + b, 0) / near.length;
    say(Math.min(...near) >= 3.4 && mean >= 7 && mean <= 11, `${name}: a poplar's nearest neighbour is ${mean.toFixed(1)} m off on average (7 to 11), none nearer than ${Math.min(...near).toFixed(1)} m (3.4)`);
    // Only where the valley is: none where it has under 0.9 of the world.
    let off = 0;
    for (let q = 0; q < list.length; q += 3) if (valleyShare(land.worlds, list[q], list[q + 1]) < POPLAR.world) off++;
    say(off === 0, `${name}: all of them stand where the valley has at least 0.9 of the world (${off} do not)`);

    // The piers and the bars of the road laid.
    const piers = [];
    const bars = [];
    for (let k = 0; k <= 4; k++) {
      const p = plan.pier(k);
      const q = again.plan.pier(k);
      if (p === undefined) continue;
      if (JSON.stringify(p) !== JSON.stringify(q)) say(false, `${name}: pier ${k} is not the same each time`);
      if (p) piers.push(p);
    }
    for (let k = 0; k <= 12; k++) {
      const b = plan.barsIn(k);
      if (b === undefined) continue;
      if (JSON.stringify(b) !== JSON.stringify(again.plan.barsIn(k))) say(false, `${name}: the bars of ${k} are not the same each time`);
      bars.push(...b);
    }
    if (seed === 7) say(piers.length >= 1, `${name}: a pier within the road laid (${piers.length})`);
    say(piers.every((p, i) => piers.every((q, j) => i === j || p.k !== q.k)) && piers.every((p) => p.s >= p.k * PIER.every + 80 && p.s <= (p.k + 1) * PIER.every - 80),
      `${name}: one pier at most in each 1500 m of road, in its cell (${piers.map((p) => p.s.toFixed(0)).join(', ') || 'none'})`);
    say(piers.every((p) => p.len >= PIER.len[0] - 1e-6 && p.len <= PIER.len[1] + 1e-6), `${name}: a pier is 8 to 14 m long (${span(piers.map((p) => p.len))})`);
    say(piers.every((p) => p.road >= HALF_FLAT + PIER.road[0] - 8 && p.road <= HALF_FLAT + PIER.road[1] + 2), `${name}: each stands within 80 m of the road's verge (${span(piers.map((p) => p.road - HALF_FLAT))} m)`);
    say(piers.every((p) => land.heightAt(p.ax, p.az) >= p.y - 0.31 && land.heightAt(p.ax, p.az) <= p.y + PIER.deck + 1.21), `${name}: the end of each is on the bank, no more than a metre in it`);
    say(piers.every((p) => waterDepth(land, p.hx, p.hz) >= PIER.deep - 1e-6 && isWet(land, p.sx + p.dx * 1, p.sz + p.dz * 1)), `${name}: its head is over water ${PIER.deep} m deep at least, and from the shore on there is water under it`);
    say(piers.every((p) => Math.abs(p.deck - p.y - PIER.deck) < 1e-9 && p.posts.length >= 12), `${name}: the deck is ${PIER.deck} m over the water on posts (${span(piers.map((p) => p.posts.length / 3))} of them)`);
    say(piers.every((p) => waterDepth(land, p.boat.ax, p.boat.az) >= 1), `${name}: the boat lies over water at least a metre deep`);
    say(bars.length === 0 || bars.every((b) => waterDepth(land, b.ax, b.az) >= BAR.deep), `${name}: ${bars.length} gravel bars, each over water ${BAR.deep} m deep or more in the middle (${span(bars.map((b) => waterDepth(land, b.ax, b.az)))} m)`);
    say(bars.every((b) => b.len >= BAR.len[0] && b.len <= BAR.len[1] && b.wide >= BAR.wide[0] && b.wide <= BAR.wide[1]), `${name}: a bar is ${BAR.len[0]} to ${BAR.len[1]} m long and ${BAR.wide[0]} to ${BAR.wide[1]} m across`);

    // The water grid: the land's own water.
    const g = new WaterGrid(land);
    const mid = road.at(4600);
    g.fill(mid.x + o.x, mid.z + o.z, 1e9);
    let bad = 0;
    for (let k = 0; k < 400; k++) {
      const x = mid.x + o.x + (((k * 7919) % 641) - 320) * 0.98;
      const z = mid.z + o.z + (((k * 104729) % 641) - 320) * 0.98;
      if (Math.abs(g.at(x, z) - waterDepth(land, (Math.floor(x / 10) + 0.5) * 10, (Math.floor(z / 10) + 0.5) * 10)) > 1e-5) bad++;
    }
    const n1 = g.nearest(mid.x + o.x, mid.z + o.z, 300);
    const truth = n1 ? shoreOf(land, mid.x + o.x, mid.z + o.z, 320) : Infinity;
    say(bad === 0 && (n1 === null ? truth === Infinity : Math.abs(n1.dist - truth) <= 12), `${name}: the water grid has the land's water in its cells (${bad} of 400 differ), and its nearest water is ${n1 ? n1.dist.toFixed(0) : 'none'} m off against ${Number.isFinite(truth) ? truth.toFixed(0) : 'none'} m by rays`);
  }
}

// The bake worker's way of loading (world/bakeworker.js): the modules of render/bakers.js's list read, each one's sibling imports pointed
// at the others', every one loaded from an address of its own; the tiles round the river planted with them and with the modules as they
// are imported plainly, and every bin of each the same bytes. (The poplars are planted in the workers: a module the list lacks is one the
// worker cannot load.)
async function workerPart() {
  const names = /const MODULES = \[(.*?)\];/.exec(readFileSync(`${ROOT}src/render/bakers.js`, 'utf8'))[1].split(',').map((n) => n.trim().replace(/'/g, ''));
  const SPEC = /((?:^|[;\s])(?:import|export)\s*(?:[\w*{}\s,$]*?\s*from\s*)?)(['"])([^'"]+)\2/g;
  const src = Object.fromEntries(names.map((n) => [`${n}.js`, readFileSync(`${ROOT}src/world/${n}.js`, 'utf8')]));
  const blobs = {};
  const open = new Set();
  const make = (name) => {
    if (blobs[name]) return blobs[name];
    if (!(name in src)) throw new Error(`no address for ${name}`);
    if (open.has(name)) throw new Error(`an import cycle through ${name}`);
    open.add(name);
    const code = src[name].replace(SPEC, (all, head, q, spec) => {
      if (!spec.startsWith('./')) throw new Error(`${name} imports ${spec}`);
      return head + q + make(spec.slice(2)) + q;
    });
    blobs[name] = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
    return blobs[name];
  };
  let loaded;
  try {
    for (const name of Object.keys(src)) make(name);
    loaded = await Promise.all(['worlds.js', 'corridor.js', 'vegetation.js', 'bakery.js'].map((n) => import(blobs[n])));
  } catch (e) {
    say(false, `the bake worker's modules do not load: ${e.message}`);
    return;
  }
  const [worldsW, corridorW, vegetationW, bakeryW] = loaded;
  say(names.includes('valleyplan'), `the bake worker loads ${names.length} modules, valleyplan among them, each importing only its siblings`);
  const seed = 7;
  const P = planOf(seed);
  const { land, road, corridor } = P;
  for (let s = 400; s <= 5200; s += 400) road.update(s);
  const env = { land, corridor, veg: makeVegetation(land, seed) };
  // The worker's land: the same seed and the page's map, handed over as render/bakers.js does.
  const m = land.worlds;
  const landW = worldsW.makeWorldLand(seed, { start: 'river' });
  const mw = landW.worlds;
  for (const k of ['ox', 'oz', 'dx', 'dz', 'shift', 'ready', 'len', 'blend', 'first', 'version']) mw[k] = m[k];
  mw.loop = m.loop.slice();
  mw.segs = m.segs.map((q) => ({ u: q.u, w: q.w, blend: q.blend, asked: q.asked }));
  mw._hint = 0;
  const envW = { land: landW, corridor: new corridorW.Corridor(null, landW), veg: vegetationW.makeVegetation(landW, seed) };
  const run = (gen) => {
    let r = gen.next();
    while (!r.done) r = gen.next();
    return r.value;
  };
  const sun = { x: 0.4, y: 0.8, z: 0.45 };
  const here = road.at(4500);
  const o = road.origin;
  const T = bakery.FOREST_TILE;
  const k = 7;
  let tiles = 0;
  let withPoplars = 0;
  let poplars = 0;
  let differ = 0;
  for (let iz = Math.floor((here.z + o.z - 700) / T); iz <= Math.floor((here.z + o.z + 700) / T); iz++) {
    for (let ix = Math.floor((here.x + o.x - 700) / T); ix <= Math.floor((here.x + o.x + 700) / T); ix++) {
      const ctx = corridor.prepare(...bakery.forestBox(ix, iz));
      const A = run(bakery.plantTrees(env, ix, iz, ctx, sun, seed));
      const B = run(bakeryW.plantTrees(envW, ix, iz, ctx, sun, seed));
      tiles++;
      const same = A.count === B.count && A.bins.every((bin, q) => bin.n === B.bins[q].n
        && ['mats', 'suns', 'cols'].every((f) => bin[f].length === B.bins[q][f].length && bin[f].every((v, i) => v === B.bins[q][f][i])));
      if (!same) differ++;
      if (A.bins[k] && A.bins[k].n) {
        withPoplars++;
        poplars += A.bins[k].n;
      }
    }
  }
  say(differ === 0 && withPoplars > 0, `${tiles} tiles round the bridge planted with the worker's modules and with the plain ones: ${withPoplars} have poplars (${poplars} of them), ${differ} differ in a byte`);
}

nodePart();
await workerPart();
if (NODE_ONLY) {
  if (failed) {
    console.error(`\n${failed} problem${failed > 1 ? 's' : ''}`);
    process.exit(1);
  }
  console.error('\nOK: the plan of the valley');
  process.exit(0);
}

// --- in the page ----------------------------------------------------------------------

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8192;
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
  const profile = `${tmpdir()}/continuum-valley-${process.pid}-${Date.now()}`;
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
  // What the page says is wrong: exceptions, and what it logs as an error (a shader that does not build is one).
  const errors = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push((msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description) || msg.params.exceptionDetails.text);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
    }
  });
  const ev = (expression) => new Promise((resolve) => {
    pending.set(++id, (r) => resolve(r && r.result ? (r.result.value !== undefined ? r.result.value : r.result.description) : r));
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  });
  ws.send(JSON.stringify({ id: ++id, method: 'Runtime.enable' }));
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
    errors,
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

// In the page: the car put on the road at s, run for two and a half seconds, and the lens as the style gives it.
const PLACE = (s) => `
  const p = g.road.at(${s});
  g.autoMode = true;
  g.sCar = ${s};
  g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(${s}, 1.9) + 0.3);
  g.car.vx = 22;
  g.setCamera('chase');
  g.chase.shaking = false;
  g.chase.lead = false;
  g.chase.snapTo(g.car, g.car.y || 0);
  g.atmosphere.uniforms.uTime.value = 100;
  for (let i = 0; i < 150; i++) { g.pilot.vMax = 22; g.update(1 / 60); }
  g.post.setStyle(g.style);
  g.atmosphere.bakeEnvironment();
  const o = g.road.origin;
  const near = g.valley.grid.nearest(g.camera.position.x + o.x, g.camera.position.z + o.z, 300);
  const { Sound } = await import('./src/ui/sound.js');
  const st = Sound.state(g);
  return { world: g.snapshot().world.id, s: g.sCar, valley: g.valley.stats(), water: { near: st.water.near, shoal: st.water.shoal }, nearest: near ? near.dist : null };
`;

// In the page: the poplars the forest has planted in its tiles, how far each is from the shore.
const POPLARS = `
  const k = ${JSON.stringify(7)};
  const T = 160;
  const o = g.road.origin;
  const land = g.land;
  const wet = (x, z) => { const wl = land.waterLevel(x, z); return wl !== -Infinity && land.heightAt(x, z) < wl; };
  const shore = (x, z) => {
    let best = Infinity;
    for (let a = 0; a < 48; a++) {
      const c = Math.cos(a / 48 * Math.PI * 2), s = Math.sin(a / 48 * Math.PI * 2);
      for (let d = 0.5; d <= 24 && d < best; d += 0.5) if (wet(x + c * d, z + s * d)) { best = d; break; }
    }
    return best;
  };
  const rows = [];
  let tiles = 0;
  for (const t of g.forest.tiles.values()) {
    const bin = t.r.bins[k];
    tiles++;
    if (!bin || !bin.n) continue;
    for (let i = 0; i < bin.n; i++) {
      const x = t.x0 + bin.mats[i * 16 + 12];
      const z = t.z0 + bin.mats[i * 16 + 14];
      rows.push({ d: shore(x, z), wet: wet(x, z), h: bin.mats[i * 16 + 5], w: Math.hypot(bin.mats[i * 16], bin.mats[i * 16 + 2]) });
    }
  }
  return { tiles, rows, drawn: g.snapshot().treeKinds };
`;

// In the page: the stones at the water's edge, against the land's water level.
const STONES = `
  const out = [];
  const land = g.land;
  for (const cell of g.clutter.cells.values()) {
    for (const it of cell.items) if (it.stone) out.push({ off: it.y - land.waterLevel(it.x, it.z), natural: land.heightAt(it.x, it.z) - land.waterLevel(it.x, it.z) });
  }
  return { count: out.length, shown: g.clutter.counts.pebble || 0, rows: out };
`;

// In the page: the pier that is drawn, against the plan's own rules, and the boat's rise and fall.
const PIERS = `
  const V = g.valley;
  const land = g.land;
  const pier = V.piers.list[0];
  if (!pier) return { error: 'no pier drawn' };
  const p = pier.p;
  const wet = (x, z) => { const wl = land.waterLevel(x, z); return wl !== -Infinity && land.heightAt(x, z) < wl; };
  const ys = [];
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 20; j++) g.update(1 / 60);
    ys.push(pier.h);
  }
  return {
    count: V.piers.count, visible: V.struct.mesh.visible, boats: V.piers.list.map((e) => [!!e.part, e.part ? e.part.count : 0]),
    bank: land.heightAt(p.ax, p.az) - p.y, head: land.waterLevel(p.hx, p.hz) - land.heightAt(p.hx, p.hz), headWet: wet(p.hx, p.hz),
    len: p.len, deck: p.deck - p.y, ys, tris: pier.geo.getIndex().count / 3, full: V.struct.full,
  };
`;

// In the page: 200 points of the mist, and what is under each. The sheets are the lattice squares drawn at three heights; a point
// of one is a point of mist where the water's own map (the grid's, as the shader reads it) is over a half there; its footing is
// the land under it. Also what the mist adds to the frame, seen from the lens: the frame drawn with it and without.
const MIST = `
  const V = g.valley;
  const m = V.mist;
  const land = g.land;
  const o = g.road.origin;
  const grid = V.grid;
  const n = grid.n;
  const sheets = m.sheets.array;
  const S = ${JSON.stringify(60)};
  // The map as the shader reads it: bilinear over the cells' centres.
  const mask = (ax, az) => {
    const fx = ax / 10 - 0.5;
    const fz = az / 10 - 0.5;
    const i0 = Math.floor(fx), j0 = Math.floor(fz);
    const tx = fx - i0, tz = fz - j0;
    const at = (i, j) => grid.mask[(j & (n - 1)) * n + (i & (n - 1))] / 255;
    return (at(i0, j0) * (1 - tx) + at(i0 + 1, j0) * tx) * (1 - tz) + (at(i0, j0 + 1) * (1 - tx) + at(i0 + 1, j0 + 1) * tx) * tz;
  };
  const rnd = (() => { let s = 12345; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
  const points = [];
  let tries = 0;
  while (points.length < 200 && tries++ < 20000 && m.count > 0) {
    const i = Math.floor(rnd() * m.count);
    const x = sheets[i * 4] + o.x + (rnd() - 0.5) * S;
    const z = sheets[i * 4 + 1] + o.z + (rnd() - 0.5) * S;
    const over = (() => { const v = mask(x, z); const t = Math.min(1, Math.max(0, (v - 0.5) / 0.4)); return t * t * (3 - 2 * t); })();
    if (over < 0.5) continue;
    const wl = land.waterLevel(x, z);
    points.push({ wet: wl !== -Infinity && land.heightAt(x, z) < wl });
  }
  // The frame with the mist and without it (the real style's own frame, whole).
  const canvas = document.getElementById('view');
  const grab = () => {
    g.render();
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const x = c.getContext('2d');
    x.drawImage(canvas, 0, 0);
    return x.getImageData(0, 0, c.width, c.height).data;
  };
  const withMist = grab();
  m.mesh.visible = false;
  const was = m.mesh.geometry.instanceCount;
  m.mesh.geometry.instanceCount = 0;
  const without = grab();
  m.mesh.visible = true;
  m.mesh.geometry.instanceCount = was;
  let diff = 0;
  for (let i = 0; i < withMist.length; i += 4) if (Math.abs(withMist[i] - without[i]) + Math.abs(withMist[i + 1] - without[i + 1]) + Math.abs(withMist[i + 2] - without[i + 2]) > 3) diff++;
  return { sheets: m.count, max: m.max, cells: m.cells, points: points.length, wet: points.filter((p) => p.wet).length, changed: diff / (withMist.length / 4) };
`;

// In the page: what goes by the style and by where the lens is, brought to the lens as the game's own update does it with no time given.
const SYNC = `{
  const syncBlocky = g.style.cur.blocks > 0.5;
  const syncO = g.road.origin;
  g.forest.setBlocky(syncBlocky);
  g.clutter.setBlocky(syncBlocky);
  g.valley.piers.setBlocky(syncBlocky);
  g.forest.update(g.camera.position.x + syncO.x, g.camera.position.z + syncO.z, true);
  for (let i = 0; i < 40; i++) g.clutter.update(g.camera, 0);
  const syncCtx = { sCar: g.sCar, blocks: g.style.cur.blocks, fog: g.scene.fog.color, settle: true };
  for (let i = 0; i < 3; i++) g.valley.update(g.camera, 0, syncCtx);
}`;

// In the page: the valley's tier changed alone (the rest of the frame is as it was), its things brought to the lens with the clock
// standing still, and the frame drawn.
const TIER_FRAME = (tier) => `
  g.valley.setTier(${JSON.stringify(tier)});
  g.forest.setTier(${JSON.stringify(tier)});
  const ctx = { sCar: g.sCar, blocks: g.style.cur.blocks, fog: g.scene.fog.color, settle: true };
  for (let i = 0; i < 3; i++) g.valley.update(g.camera, 0, ctx);
  g.render();
  g.render();
`;

const COST = (tier) => `${TIER_FRAME(tier)}
  const r = g.renderer;
  const slot = g.forest._slots.base[7];
  let poplars = 0;
  for (const set of [g.forest.lists[slot]]) if (set) for (const m of set) if (m && m.visible) poplars += m.count;
  // The most sheets of mist there are at the tier: every layer of the squares that have them, and the lowest of those beyond.
  const { MIST: P } = await import('./src/render/valleymist.js');
  const mistMax = P.sheets[${JSON.stringify(tier)}] * P.layers[${JSON.stringify(tier)}].length + P.far[${JSON.stringify(tier)}];
  const cost = { mistMax, calls: r.info.render.calls, triangles: r.info.render.triangles, programs: r.info.programs.length, geometries: r.info.memory.geometries };
  // Which meshes the frame draws, by what they are (one more frame drawn, with the renderer's draw call told of).
  const draws = {};
  const V = g.valley;
  const label = (o, m) => {
    const u = o.userData || {};
    const name = o === V.struct.mesh ? 'valley.struct' : o === V.mist.mesh ? 'valley.mist'
      : u.list ? 'forest.list k' + u.kind + ' lod' + u.lod : u.caster ? 'forest.caster k' + u.kind + ' lod' + u.lod : u.far ? 'forest.far k' + u.kind
        : u.kind !== undefined ? 'mesh.' + u.kind : o.type;
    return name + (m && (m.isMeshDepthMaterial || m.isMeshDistanceMaterial) ? ' [shadow]' : '');
  };
  const orig = r.renderBufferDirect;
  r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    const k = label(object, material);
    draws[k] = (draws[k] || 0) + 1;
    return orig.apply(this, arguments);
  };
  try { g.render(); } finally { r.renderBufferDirect = orig; }
  return { tier: ${JSON.stringify(tier)}, ...cost, draws, poplars,
    stats: V.stats(), visible: { struct: V.struct.mesh.visible, mist: V.mist.mesh.visible, boats: V.piers.list.some((e) => !!e.part) }, full: V.struct.full, vertices: V.struct.nv };
`;

// In the page: each style draws the valley, with its things and without (the tier low).
const STYLED = (id) => `
  g.style.set(${JSON.stringify(id)}, true);
  g.style.applyScene();
  g.post.setStyle(g.style);
  g.atmosphere.bakeEnvironment();
  for (let i = 0; i < 20; i++) g.style.update(0.1);
  g.style.applyScene();
  g.atmosphere.bakeEnvironment();
  const gl = g.renderer.getContext();
  const canvas = document.getElementById('view');
  const errors = () => { let n = 0; while (gl.getError() !== gl.NO_ERROR && n < 50) n++; return n; };
  const shot = (tier) => {
    g.valley.setTier(tier);
    g.forest.setTier(tier);
    g.clutter.setTier(tier);
    ${SYNC}
    errors();
    g.render();
    g.render();
    const e = errors();
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const x = c.getContext('2d');
    x.drawImage(canvas, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
    return { errors: e, mean: sum / (d.length / 4), data: d, png: canvas.toDataURL('image/png') };
  };
  const low = shot('low');
  const high = shot('high');
  let diff = 0;
  for (let i = 0; i < low.data.length; i += 4) if (Math.abs(low.data[i] - high.data[i]) + Math.abs(low.data[i + 1] - high.data[i + 1]) + Math.abs(low.data[i + 2] - high.data[i + 2]) > 6) diff++;
  return { style: ${JSON.stringify(id)}, lowErrors: low.errors, highErrors: high.errors, lowMean: low.mean, highMean: high.mean, changed: diff / (low.data.length / 4), lowPng: low.png, highPng: high.png, drawn: g.valley.stats(),
    blocky: g.forest.blocky, poplarBlocks: g.forest._slots.list.some((s) => s.name === 'poplar'),
    boatVertices: (g.valley.piers.list[0] && g.valley.piers.list[0].part) ? g.valley.piers.list[0].part.count : 0 };
`;

// In the page: close views of what the valley has: the lens is put by the first pier (over the water off its head and to the side,
// looking along it; over the water off its head, looking back at the row of poplars; on the bank above the mist, looking over the river; at the nearest gravel bar),
// the frame is drawn in the style the page is in and the lens is put back. Returns the picture, or says what is missing; for the
// view of the mist also how much of the frame the mist changes (the frame drawn with it and without it).
const CLOSE = (view, off = false) => `
  const V = g.valley;
  const o = g.road.origin;
  const pier = V.piers.list[0];
  if (!pier) return { error: 'no pier' };
  const p = pier.p;
  const gy = (x, z) => g.groundAt(x - o.x, z - o.z);
  let eye, at;
  if (${JSON.stringify(view)} === 'pier') {
    // Over the water, ten metres past its head and six to the side, looking along it toward the bank.
    const ex = p.hx + p.dx * 10 + (-p.dz) * 6;
    const ez = p.hz + p.dz * 10 + p.dx * 6;
    eye = [ex - o.x, p.y + 2.0, ez - o.z];
    at = [p.ax + p.dx * p.len * 0.45 - o.x, p.y + 1.0, p.az + p.dz * p.len * 0.45 - o.z];
  } else if (${JSON.stringify(view)} === 'row') {
    const ex = p.hx + p.dx * 7;
    const ez = p.hz + p.dz * 7;
    eye = [ex - o.x, p.y + 2.2, ez - o.z];
    at = [p.ax - p.dx * 10 - o.x, p.y + 7, p.az - p.dz * 10 - o.z];
  } else if (${JSON.stringify(view)} === 'mist') {
    // On the bank, a little inland from the pier's end and above the three layers, looking along the shore and out over the water.
    const ex = p.ax - p.dx * 3;
    const ez = p.az - p.dz * 3;
    eye = [ex - o.x, Math.max(gy(ex, ez), p.y) + 3.4, ez - o.z];
    const dirx = -p.dz * Math.cos(0.6) + p.dx * Math.sin(0.6);
    const dirz = p.dx * Math.cos(0.6) + p.dz * Math.sin(0.6);
    at = [eye[0] + dirx * 70, p.y + 0.4, eye[2] + dirz * 70];
  } else {
    const b = V.bars.list.slice().sort((a, c) => Math.hypot(a.ax - p.sx, a.az - p.sz) - Math.hypot(c.ax - p.sx, c.az - p.sz))[0];
    if (!b) return { error: 'no bar' };
    const ang = Math.atan2(b.ax - p.sx, b.az - p.sz);
    const ex = b.ax - Math.sin(ang) * 30, ez = b.az - Math.cos(ang) * 30;
    eye = [ex - o.x, Math.max(gy(ex, ez), p.y) + 3.6, ez - o.z];
    at = [b.ax - o.x, p.y - 0.4, b.az - o.z];
  }
  const was = [g.camera.position.clone(), g.camera.quaternion.clone()];
  g.camera.position.set(eye[0], eye[1], eye[2]);
  g.camera.lookAt(at[0], at[1], at[2]);
  g.camera.updateMatrixWorld(true);
  // (Asked to be off, the view is drawn as it is where none of the valley's things is: the tier low.)
  ${off ? "g.valley.setTier('low'); g.forest.setTier('low'); g.clutter.setTier('low');" : ''}
  ${SYNC}
  for (let i = 0; i < 3; i++) g.render();
  const canvas = document.getElementById('view');
  const png = canvas.toDataURL('image/png');
  let mist = null;
  if (${JSON.stringify(view)} === 'mist') {
    const grab = () => {
      g.render();
      const c = document.createElement('canvas');
      c.width = canvas.width; c.height = canvas.height;
      const x = c.getContext('2d');
      x.drawImage(canvas, 0, 0);
      return x.getImageData(0, 0, c.width, c.height).data;
    };
    const withMist = grab();
    V.mist.mesh.visible = false;
    const without = grab();
    V.mist.mesh.visible = true;
    let diff = 0, sum = 0;
    for (let i = 0; i < withMist.length; i += 4) {
      const d = Math.abs(withMist[i] - without[i]) + Math.abs(withMist[i + 1] - without[i + 1]) + Math.abs(withMist[i + 2] - without[i + 2]);
      if (d > 3) { diff++; sum += d / 3; }
    }
    mist = { changed: diff / (withMist.length / 4), mean: diff ? sum / diff : 0, sheets: V.mist.count, ends: V.mist.ends };
  }
  ${off ? "g.valley.setTier('high'); g.forest.setTier('high'); g.clutter.setTier('high'); " + SYNC : ''}
  g.camera.position.copy(was[0]);
  g.camera.quaternion.copy(was[1]);
  g.camera.updateMatrixWorld(true);
  return { png, mist };
`;

// In the page: the valley let go.
const DISPOSE = `
  g.valley.setTier('high');
  g.update(1 / 60);
  g.render();
  const r = g.renderer;
  const before = { geometries: r.info.memory.geometries, children: g.scene.children.length };
  g.valley.dispose();
  g.render();
  const after = { geometries: r.info.memory.geometries, children: g.scene.children.length };
  g.valley.update = () => {};
  let thrown = null;
  try { for (let i = 0; i < 4; i++) { g.update(1 / 60); g.render(); } } catch (e) { thrown = e.message; }
  return { before, after, thrown };
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
    page = await openPage('seed=7&world=river&s=3000&run=60&cam=chase&style=real');
    // Every program built from here on that fails to build is noted; those of the valley's own things, the land's and the water's are built again.
    await page.run(`window.__shaderErrors = [];
      g.renderer.debug.onShaderError = (gl, program) => { window.__shaderErrors.push(String(gl.getProgramInfoLog(program)).slice(0, 300)); };
      for (const m of [g.valley.mist.material, g.valley.material, g.terrain.material, g.water.material, g.forest.material, g.clutter.material]) m.needsUpdate = true;
      g.render();
      return 1;`);
    // 500 m from the water: nothing of the valley's mist is drawn, and the lens does not hear the river.
    const far = await page.run(PLACE(3000));
    if (far.error) throw new Error(far.error);
    say(far.world === 'river' && (far.nearest === null || far.nearest > 300), `the place is in the river's world, ${far.nearest === null ? 'with no water within 300 m' : far.nearest.toFixed(0) + ' m from the water'} (${far.world}, ${far.s} m)`);
    say(far.valley.sheets === 0 && !far.valley.mist && far.water.near === 0 && far.water.shoal === 0, `away from the water: no mist drawn (${far.valley.sheets} sheets), nothing heard of it (near ${far.water.near}, shoal ${far.water.shoal})`);

    // The place `river`: the poplars the forest has planted round the lens.
    const river = await page.run(PLACE(3600));
    if (river.error) throw new Error(river.error);
    const pop = await page.run(POPLARS);
    if (pop.error) throw new Error(pop.error);
    console.error(`     ${pop.rows.length} poplars in the ${pop.tiles} tiles round the lens at ${river.s} m`);
    say(pop.rows.length >= 10, `poplars are planted in the tiles round the lens (${pop.rows.length})`);
    say(pop.rows.every((r) => r.d >= 4 && r.d <= 16 && !r.wet), `each is 4 to 16 m from the shore, on dry ground (${span(pop.rows.map((r) => r.d))} m)`);
    say(pop.rows.every((r) => r.h >= 17 - 1e-3 && r.h <= 25 + 1e-3 && r.w / r.h >= 0.16 && r.w / r.h <= 0.23), `...tall and narrow: ${span(pop.rows.map((r) => r.h))} m tall, a ${span(pop.rows.map((r) => r.w / r.h))} of that across`);

    // By the water: the bridge. The stones at its edge, the mist over it, the sound of it.
    const bridge = await page.run(PLACE(4500));
    if (bridge.error) throw new Error(bridge.error);
    say(bridge.nearest !== null && bridge.nearest < 40, `the place by the river is ${bridge.nearest === null ? '?' : bridge.nearest.toFixed(0)} m from the water`);
    say(bridge.water.near >= 0.55, `the lens heard from there has the river near: ${bridge.water.near.toFixed(2)} of 1 (at least 0.55 within 40 m)`);
    const stones = await page.run(STONES);
    say(stones.count >= 20 && stones.rows.every((r) => Math.abs(r.natural) <= 0.4 + 1e-6), `stones lie only where the ground is within 0.4 m of the water: ${stones.count} of them, ${stones.shown} drawn, the ground ${span(stones.rows.map((r) => r.natural))} m from the water's level`);
    const mist = await page.run(MIST);
    if (mist.error) throw new Error(mist.error);
    say(mist.sheets >= 3 && mist.sheets <= mist.max && mist.points === 200, `mist is drawn: ${mist.sheets} sheets (at most ${mist.max}) on ${mist.cells} squares of the lattice, ${mist.points} points of it taken`);
    say(mist.wet / mist.points >= 0.9, `${mist.wet} of the ${mist.points} points of it have water under them (${((100 * mist.wet) / mist.points).toFixed(1)}%, at least 90)`);
    say(mist.changed > 0.002, `and it changes ${(mist.changed * 100).toFixed(2)}% of the frame (the frame drawn with it against without it)`);

    // The pier, its boat, the bars.
    const pierPlace = await page.run(PLACE(4600));
    if (pierPlace.error) throw new Error(pierPlace.error);
    const pier = await page.run(PIERS);
    if (pier.error) {
      say(false, `the pier: ${pier.error} (${JSON.stringify(pierPlace.valley)})`);
    } else {
      say(pier.visible && pier.count >= 1, `a pier is drawn (${pier.count})`);
      say(pier.bank >= -0.31 && pier.bank <= PIER.deck + 1.21 && pier.headWet && pier.head >= PIER.deep, `its end is on the bank (the ground ${pier.bank.toFixed(2)} m over the water) and its head is over water ${pier.head.toFixed(2)} m deep`);
      say(pier.len >= 8 && pier.len <= 14 && Math.abs(pier.deck - PIER.deck) < 1e-6, `it is ${pier.len.toFixed(1)} m long, its deck ${pier.deck.toFixed(2)} m over the water`);
      const lo = Math.min(...pier.ys);
      const hi = Math.max(...pier.ys);
      say(pier.boats.some(([v, c]) => v && c >= 1) && hi - lo >= 0.01 && Math.abs(lo) < 0.2 && Math.abs(hi) < 0.2, `a boat lies off its head and rises and falls with the water: ${(1000 * (hi - lo)).toFixed(0)} mm over 4 s, within ${(1000 * Math.max(Math.abs(lo), Math.abs(hi))).toFixed(0)} mm of the water's level`);
      console.error(`     the pier has ${pier.tris} triangles`);
    }
    const bars = await page.run(PLACE(4900));
    say(bars.valley.bars >= 1, `gravel bars are drawn in the river (${bars.valley.bars}), the lens heard from ${bars.nearest === null ? '?' : bars.nearest.toFixed(0)} m off the water has the shallows at ${bars.water.shoal.toFixed(2)}`);

    // The tiers, at the place of the pier: nothing at low, half at mid, all at high.
    await page.run(PLACE(4600));
    const lowCost = await page.run(COST('low'));
    say(lowCost.stats.bars === 0 && lowCost.stats.piers === 0 && lowCost.stats.sheets === 0 && lowCost.poplars === 0
      && !lowCost.visible.struct && !lowCost.visible.mist && !lowCost.visible.boats, `at the lowest tier none of it is drawn (${JSON.stringify(lowCost.stats)}, ${lowCost.poplars} poplars)`);
    const midCost = await page.run(COST('mid'));
    const highCost = await page.run(COST('high'));
    const add = (a, b) => ({ calls: a.calls - b.calls, triangles: a.triangles - b.triangles, programs: a.programs - b.programs, geometries: a.geometries - b.geometries });
    const addHigh = add(highCost, lowCost);
    const addMid = add(midCost, lowCost);
    console.error(`     what it adds to a frame: at high ${addHigh.calls} calls and ${addHigh.triangles} triangles, at mid ${addMid.calls} calls and ${addMid.triangles} triangles; programs built when it was first drawn: ${addHigh.programs} (the others are built ahead, as the page settles); geometries ${addHigh.geometries}`);
    // (What those calls are: the meshes that are drawn at the tier and not at low.)
    const added = (a, b) => Object.entries(a.draws).map(([k, n]) => [k, n - (b.draws[k] || 0)]).filter(([, n]) => n !== 0).map(([k, n]) => `${k} x${n}`).join(', ');
    console.error(`     high adds: ${added(highCost, lowCost)}`);
    console.error(`     mid adds: ${added(midCost, lowCost)}`);
    say(addHigh.calls >= 1 && addHigh.calls <= 8, `at the high tier it adds at most 8 draw calls (${addHigh.calls})`);
    say(addHigh.triangles > 0 && addHigh.triangles <= 60000, `and at most 60 000 triangles (${addHigh.triangles})`);
    say(addMid.calls <= 6 && addMid.triangles <= 30000, `at the middle tier half of that: at most 6 calls and 30 000 triangles (${addMid.calls}, ${addMid.triangles})`);
    // (Every other tree of a tile's planting is left out at mid: of those in view that is half, give or take the draw of which.)
    say(highCost.poplars >= 4 && midCost.poplars > 0 && midCost.poplars <= Math.ceil(highCost.poplars * 0.7) && midCost.poplars >= Math.floor(highCost.poplars * 0.3),
      `poplars drawn from the lists: ${highCost.poplars} at high, ${midCost.poplars} at mid (about half), ${lowCost.poplars} at low`);
    say(highCost.stats.bars >= 1 && midCost.stats.bars <= 4 && midCost.stats.bars <= highCost.stats.bars && midCost.stats.piers === 1 && highCost.stats.piers >= 1
      && midCost.stats.sheets < highCost.stats.sheets && midCost.stats.sheets <= midCost.mistMax && highCost.stats.sheets <= highCost.mistMax && !highCost.full && !midCost.full,
    `bars, piers, sheets: ${highCost.stats.bars}, ${highCost.stats.piers}, ${highCost.stats.sheets} at high (at most 8, 3, ${highCost.mistMax}); ${midCost.stats.bars}, ${midCost.stats.piers}, ${midCost.stats.sheets} at mid (at most 4, 1, ${midCost.mistMax}); ${highCost.vertices} vertices of the solid things' mesh at high`);

    // Every style.
    const styles = [];
    for (const id of ['real', 'paint', 'ink', 'cel', 'print', 'pixel', 'block']) {
      const r = await page.run(STYLED(id));
      if (r.error) {
        say(false, `${id}: ${r.error}`);
        continue;
      }
      styles.push(r);
      say(r.highErrors <= r.lowErrors && r.changed > 0.0005 && r.highMean > 0.5, `${id}: it draws with the valley's things (${(r.changed * 100).toFixed(2)}% of the frame is different from the frame at low, ${r.highErrors} GL errors against ${r.lowErrors}, mean ${r.highMean.toFixed(1)})`);
      // The block style's poplars and boat are of blocks (a boat of eight boxes), the others' are not (a boat lofted from stations).
      say(r.blocky === (id === 'block') && r.poplarBlocks === (id === 'block') && r.boatVertices === (id === 'block' ? 192 : 324),
        `${id}: the poplars are ${r.poplarBlocks ? 'of blocks' : 'rounded'} and the boat is ${r.boatVertices === 192 ? 'of boxes' : r.boatVertices === 324 ? 'lofted' : 'not there'} (${r.boatVertices} vertices)`);
      // The mist, in a view over the river: how much of the frame it changes (the frame drawn with it and without it).
      const view = await page.run(CLOSE('mist'));
      if (view.error) say(false, `${id}: no view of the mist: ${view.error}`);
      else say(view.mist.changed >= 0.01, `${id}: the mist changes ${(view.mist.changed * 100).toFixed(1)}% of the frame in a view over the river, by ${view.mist.mean.toFixed(1)} of 255 where it does (${view.mist.sheets} sheets, which stop ${view.mist.ends.map((e) => e.toFixed(0)).join(' and ')} m off)`);
      if (keep) {
        writeFileSync(`${keep}${id}-low.png`, Buffer.from(r.lowPng.replace(/^data:image\/png;base64,/, ''), 'base64'));
        writeFileSync(`${keep}${id}-high.png`, Buffer.from(r.highPng.replace(/^data:image\/png;base64,/, ''), 'base64'));
        if (!view.error) writeFileSync(`${keep}${id}-mist.png`, Buffer.from(view.png.replace(/^data:image\/png;base64,/, ''), 'base64'));
        // (The page is at tier high now, in this style: the close views.)
        for (const name of ['pier', 'row', 'bar']) {
          const c = await page.run(CLOSE(name));
          if (c.error) console.error(`     ${id}: no close view ${name}: ${c.error}`);
          else writeFileSync(`${keep}${id}-${name}.png`, Buffer.from(c.png.replace(/^data:image\/png;base64,/, ''), 'base64'));
        }
        // The same views without the valley's things, for the real style: the pictures to set them against.
        if (id === 'real') {
          for (const name of ['pier', 'row', 'mist', 'bar']) {
            const c = await page.run(CLOSE(name, true));
            if (!c.error) writeFileSync(`${keep}${id}-${name}-off.png`, Buffer.from(c.png.replace(/^data:image\/png;base64,/, ''), 'base64'));
          }
        }
      }
    }
    // With --keep: the painted style under the other two skies of the day worlds (the golden one and the grey).
    if (keep) {
      for (const sky of ['golden', 'grey']) {
        await page.run(`
          g.style.set('paint', true);
          g.style.applyScene();
          g.post.setStyle(g.style);
          g.setSkyPins({ river: ${JSON.stringify(sky)} });
          for (let i = 0; i < 8; i++) g.update(1 / 60);
          for (let i = 0; i < 20; i++) g.style.update(0.1);
          g.style.applyScene();
          g.atmosphere.bakeEnvironment();
          return 1;`);
        for (const name of ['pier', 'row', 'mist']) {
          const c = await page.run(CLOSE(name));
          if (c.error) console.error(`     paint under ${sky}: no close view ${name}: ${c.error}`);
          else {
            writeFileSync(`${keep}paint-${sky}-${name}.png`, Buffer.from(c.png.replace(/^data:image\/png;base64,/, ''), 'base64'));
            if (c.mist) console.error(`     paint under the ${sky} sky: the mist changes ${(c.mist.changed * 100).toFixed(1)}% of the frame, by ${c.mist.mean.toFixed(1)}`);
          }
        }
      }
      await page.run("g.setSkyPins({}); return 1;");
    }
    await page.run("g.style.set('real', true); g.style.applyScene(); return 1;");

    // Where the valley is not, none of it is: the hills, a world in which no water is near.
    const other = await openPage('seed=7&world=hills&s=2000&run=120&cam=chase&style=real');
    try {
      const d = await other.run(`
        const st = g.valley.stats();
        const { Sound } = await import('./src/ui/sound.js');
        const w = Sound.state(g).water;
        const meshes = [g.valley.struct.mesh, g.valley.mist.mesh].filter((m) => m.visible).length;
        return { st, kinds: Object.keys(g.clutter.counts), near: w.near, shoal: w.shoal, visible: meshes, poplars: g.forest.tiles.size && [...g.forest.tiles.values()].reduce((n, t) => n + (t.r.bins[7] ? t.r.bins[7].n : 0), 0) };
      `);
      say(!d.error && d.st.bars === 0 && d.st.piers === 0 && d.st.sheets === 0 && d.visible === 0 && d.near === 0 && d.shoal === 0 && d.poplars === 0 && !d.kinds.includes('pebble'),
        `in the hills none of the valley's own things is drawn or heard (${JSON.stringify(d.st || d)}, ${d.poplars} poplars, stones: ${d.kinds ? d.kinds.includes('pebble') : '?'})`);
    } finally {
      other.close();
    }

    // No program failed to build, in any style, and the page logged no error.
    const errs = await page.run('return window.__shaderErrors;');
    say(Array.isArray(errs) && errs.length === 0, `no shader failed to build, in any style${errs.length ? ': ' + errs[0] : ''}`);
    say(page.errors.length === 0, `the page logged no error${page.errors.length ? ': ' + page.errors[0] : ''}`);

    // Let go.
    const gone = await page.run(DISPOSE);
    say(!gone.thrown && gone.before.geometries - gone.after.geometries >= 2 && gone.before.children - gone.after.children >= 2,
      `disposed of: ${gone.before.geometries - gone.after.geometries} geometries and ${gone.before.children - gone.after.children} objects gone from the renderer and the scene, and the game goes on (${gone.thrown || 'no error'})`);
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
console.error('\nOK: the valley has its poplars, its stones, its mist, its bars and its pier, where and as many as it should');
process.exit(0);
