// The ground: beds in the faces of the land, the normal maps of rock, gravel, sand and snow, and rubble at the foot of cliffs.
//
// Not in a browser (the generators, as the page and the baking workers run them):
//  - the beds (world/strata.js): nothing is pushed on ground that is not steep or within 12 m of the road, never by more than
//    FACE.amp, they spread over at least 1.5 pixels at 60 m of the lens the harness has (the face is not smooth), and
//    the same bits come out of two bakes; a tile of the finest level has them in the arrays of its bake and the
//    coarser ones have none; the normals that go with them are unit;
//  - the textures (world/groundtex.js): the same bytes twice, a slope in every byte of the rock and the fine ground,
//    sizes by tier (none at the low tier), and what they hold with their mips under 12 MB.
// In the real page (workers up):
//  - the textures a worker made are those the page makes, bit for bit;
//  - the tiers: mid has the smaller textures, low none (and the textures are given back to the renderer),
//    high again has them; the beds are pushed at high and mid and not at low;
//  - a tile with beds has them in its geometry, and no vertex of it is moved by more than FACE.amp;
//  - rubble lies at the foot of cliffs: some at high, fewer at mid, none at low, and none in the painted styles;
//  - nothing is logged as an error.
//
// Usage: node tools/ground_check.mjs [--node-only]
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { makeWorldLand } from '../src/world/worlds.js';
import { Road, STEP } from '../src/world/road.js';
import { Corridor } from '../src/world/corridor.js';
import { bakeLand, landBox, LAND_LEVELS, LAND_RES, FACE_LEVEL } from '../src/world/bakery.js';
import { FACE, faceStep, stairs } from '../src/world/strata.js';
import { makeRock, makeFine, makeGround, GROUND_SIZE, ROCK, FINE } from '../src/world/groundtex.js';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
// Headless WebGL fails on Linux while DISPLAY is set.
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8186;
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1e6;

let failed = false;
const say = (ok, text) => {
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
};
const same = (a, b) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

// --- the generators, in node ----------------------------------------------------

function strata() {
  // Nothing on ground that is not steep, or near the road; never more than amp.
  let max = 0;
  let stray = 0;
  for (let y = -400; y < 900; y += 7.3) {
    for (let x = 0; x < 600; x += 31.7) {
      max = Math.max(max, Math.abs(faceStep(x * 3, y, x * 5, 0.9, 40)));
      if (faceStep(x, y, x * 2, FACE.slope[0] - 0.01, 40) !== 0) stray++;
      if (faceStep(x, y, x * 2, 0.9, FACE.road[0] - 0.01) !== 0) stray++;
    }
  }
  say(stray === 0, `no bed is laid on ground under slope ${FACE.slope[0]} or within ${FACE.road[0]} m of the road (${stray} that are)`);
  say(max > FACE.amp * 0.7 && max <= FACE.amp + 1e-9, `the beds push by up to ${max.toFixed(3)} m, never over ${FACE.amp} m`);
  // The stairs are flat across a bed, and wrap round when asked.
  const flat = Math.abs(stairs(3.5, 5) - stairs(3.9, 5)) < 1e-12;
  const wrap = stairs(-0.5, 9, FACE.rise, 6) === stairs(5.5, 9, FACE.rise, 6);
  say(flat && wrap, 'the face is level across a bed, and goes round when it has a period');
}

function baked() {
  const seed = 7;
  const land = makeWorldLand(seed, { start: 'alpine' });
  const road = new Road(land, seed);
  for (let s = 0; s <= 5800; s += 50) road.update(s);
  const corridor = new Corridor(road, land);
  const env = { land, corridor, veg: null };
  const sun = { x: 0.5, y: 0.6, z: 0.3 };
  const run = (gen) => {
    let r = gen.next();
    while (!r.done) r = gen.next();
    return r.value;
  };
  const size = LAND_LEVELS[FACE_LEVEL];
  const step = size / LAND_RES;
  const N = LAND_RES + 1;
  const p = road.samples.get(Math.round(5200 / STEP));
  const ci = Math.floor(p.ax / size);
  const cj = Math.floor(p.az / size);
  let tiles = 0;
  let withBeds = 0;
  let moved = 0;
  let max = 0;
  let badRoad = 0;
  let badSlope = 0;
  let badNormal = 0;
  let sum = 0;
  let sq = 0;
  let differ = 0;
  let coarse = 0;
  const out = {};
  for (let j = -2; j <= 2; j++) {
    for (let i = -2; i <= 2; i++) {
      const ix = ci + i;
      const iz = cj + j;
      const box = landBox(FACE_LEVEL, ix, iz);
      const ctx = corridor.prepare(...box);
      const r = run(bakeLand(env, FACE_LEVEL, ix, iz, ctx, sun));
      const again = run(bakeLand(env, FACE_LEVEL, ix, iz, corridor.prepare(...box), sun));
      tiles++;
      if (r.buried) continue;
      if ((r.bed === null) !== (again.bed === null) || (r.bed && !same(r.bed, again.bed))) differ++;
      if (!r.bed) continue;
      withBeds++;
      for (let v = 0; v < r.pos.length / 3; v++) {
        const d = r.bed[v * 4 + 3];
        if (d === 0) continue;
        moved++;
        sum += d;
        sq += d * d;
        max = Math.max(max, Math.abs(d));
        if (v < N * N) {
          if (1 - r.nrm[v * 3 + 1] < FACE.slope[0] - 1e-4) badSlope++;
          const ax = ix * size + (v % N) * step;
          const az = iz * size + Math.floor(v / N) * step;
          corridor.shape(ctx, ax, az, land.heightAt(ax, az), out);
          if (out.near < FACE.road[0] - 1e-3) badRoad++;
        }
        const nx = r.nrm[v * 3] + r.bed[v * 4];
        const ny = r.nrm[v * 3 + 1] + r.bed[v * 4 + 1];
        const nz = r.nrm[v * 3 + 2] + r.bed[v * 4 + 2];
        if (Math.abs(Math.hypot(nx, ny, nz) - 1) > 2e-3) badNormal++;
      }
    }
  }
  // The coarser levels have none.
  for (let level = 1; level < LAND_LEVELS.length; level++) {
    const s = LAND_LEVELS[level];
    const ix = Math.floor(p.ax / s);
    const iz = Math.floor(p.az / s);
    const r = run(bakeLand(env, level, ix, iz, corridor.prepare(...landBox(level, ix, iz)), sun));
    if (!r.buried && r.bed !== null) coarse++;
  }
  say(withBeds > 0 && moved > 500, `tiles of the finest level by the road at 5200 m: ${withBeds} of ${tiles} have beds, ${moved} vertices are pushed`);
  say(max <= FACE.amp + 1e-6, `the most a vertex is pushed is ${max.toFixed(3)} m (at most ${FACE.amp})`);
  // How far the face is from smooth, as the lens sees it: the spread of the pushes against what a pixel covers at 60 m
  // of the harness's lens (a 56 degree field, 577 rows): the steps of the face are that many pixels, one way or the other.
  const spread = Math.sqrt(sq / moved - (sum / moved) ** 2);
  const pixel = (60 * 2 * Math.tan((56 / 2) * Math.PI / 180)) / 577;
  say(spread / pixel >= 1.5, `the pushes have a spread of ${spread.toFixed(3)} m: ${(spread / pixel).toFixed(1)} pixels at 60 m, at least 1.5`);
  say(badSlope === 0 && badRoad === 0, `no pushed vertex is on ground under slope ${FACE.slope[0]} (${badSlope}) or within ${FACE.road[0]} m of the road (${badRoad})`);
  say(badNormal === 0, `the normal of a pushed vertex stays a unit vector (${badNormal} that do not)`);
  say(differ === 0, 'two bakes of a tile give the same bytes (the beds included)');
  say(coarse === 0, 'tiles of the coarser levels have no beds');
}

function textures() {
  const rock = makeRock(256);
  const again = makeRock(256);
  const fine = makeFine(128);
  say(same(rock, again) && same(fine, makeFine(128)), 'the textures come out the same twice, byte for byte');
  // A slope in every byte: not all one value, and a texel that is a bump is not flat.
  const spread = (d, c) => {
    let lo = 255;
    let hi = 0;
    for (let k = c; k < d.length; k += 4) {
      lo = Math.min(lo, d[k]);
      hi = Math.max(hi, d[k]);
    }
    return hi - lo;
  };
  say([0, 1, 2, 3].every((c) => spread(rock, c) > 40) && [0, 1, 2, 3].every((c) => spread(fine, c) > 40),
    'every channel of the rock and the fine ground has a spread of more than 40 of 255');
  const sizes = Object.entries(GROUND_SIZE).map(([tier, s]) => `${tier}: ${s ? `${s.rock}/${s.fine}` : 'none'}`).join(', ');
  const high = GROUND_SIZE.high;
  const bytes = (high.rock ** 2 + high.fine ** 2) * 4 * (4 / 3);
  say(GROUND_SIZE.low === null && GROUND_SIZE.mid.rock < high.rock && GROUND_SIZE.mid.fine < high.fine, `sizes by tier (${sizes})`);
  say(bytes < 12 * MB, `the textures hold ${(bytes / MB).toFixed(2)} MB with their mips, at most 12`);
  const made = makeGround('mid');
  say(made.rock.length === GROUND_SIZE.mid.rock ** 2 * 4 && makeGround('low') === null, 'a tier makes the sizes it says, and the low tier none');
  say(ROCK.tile > 0 && FINE.tile > 0, 'the tiles cover a size of the world');
}

// --- the real page --------------------------------------------------------------

// Runs in the page.
async function inPage() {
  const g = window.game;
  const T = g.terrain;
  const M = T.maps;
  const { makeGround: make } = await import('./src/world/groundtex.js');
  const wait = async (f, ms = 20000) => {
    for (let t = 0; t < ms && !f(); t += 100) await new Promise((r) => setTimeout(r, 100));
    return f();
  };
  const out = {};
  // The car stands still: the rubble is laid round the lens, and the tiers are read at one place.
  // The tier is pinned: on a busy machine the frame rate would take it down by itself.
  g.pilot.vMax = 0;
  g.pinTier('high');
  const textures = () => g.renderer.info.memory.textures;
  const eq = (a, b) => {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };
  // A texture is on the card while the renderer holds the texture made for it (what it keeps of a texture it has let go of is nothing).
  const has = (t) => !!t && !!g.renderer.properties.get(t).__webglTexture;
  out.got = await wait(() => M.held === 'high', 90000);
  const mk = make('high');
  out.workerRock = out.got && eq(M.rock.image.data, mk.rock);
  out.workerFine = out.got && eq(M.fine.image.data, mk.fine);
  out.rockSize = out.got ? M.rock.image.width : 0;
  out.bytes = M.bytes;
  await new Promise((r) => setTimeout(r, 1500));
  const rock0 = M.rock;
  const fine0 = M.fine;
  out.high = { textures: textures(), numbers: M.numbers.toArray(), live: has(rock0) && has(fine0) };
  // Beds in the geometry of the tiles of the finest level.
  let tiles = 0;
  let bedded = 0;
  let max = 0;
  let strays = 0;
  for (const mesh of T.tiles.values()) {
    if (mesh.userData.level !== 0 || mesh.userData.buried) continue;
    tiles++;
    const a = mesh.geometry.attributes.aBed;
    if (!a) continue;
    bedded++;
    for (let v = 0; v < a.count; v++) max = Math.max(max, Math.abs(a.array[v * 4 + 3]));
    if (mesh.customDepthMaterial !== T.bedDepth) strays++;
  }
  out.beds = { tiles, bedded, max, strays };
  // Rubble.
  const stones = () => {
    const m = g.clutter.meshes.get('scree:s');
    return m ? { count: m.count, visible: m.visible } : { count: 0, visible: false };
  };
  // Rubble is laid a few cells a frame, and a busy machine draws a frame in a second or more: the frames that
  // are left are made here (the same update the frame makes), and the number is read once it has stood still for a second and a half.
  const lay = () => {
    for (let i = 0; i < 40; i++) g.clutter.update(g.camera, 0);
  };
  const settle = async () => {
    let last = -1;
    let same = 0;
    for (let t = 0; t < 30000 && same < 15; t += 100) {
      lay();
      await new Promise((r) => setTimeout(r, 100));
      const c = stones().count;
      same = c === last ? same + 1 : 0;
      last = c;
    }
  };
  await settle();
  out.rubbleHigh = stones();
  out.sCar = Math.round(g.sCar);
  out.cells = g.clutter.cells.size;
  // A tier at a time.
  const tiers = {};
  for (const tier of ['mid', 'low', 'high']) {
    g.pinTier(tier);
    const wanted = tier === 'low' ? () => M.held === null : () => M.held === tier;
    await wait(wanted);
    await settle();
    await new Promise((r) => setTimeout(r, 1500));
    tiers[tier] = {
      held: M.held, width: M.rock ? M.rock.image.width : 0, fine: M.fine ? M.fine.image.width : 0, bytes: M.bytes,
      textures: textures(), numbers: M.numbers.toArray(), scree: stones(),
      live: has(M.rock) && has(M.fine), gone: !has(rock0) && !has(fine0), fresh: M.rock !== rock0,
    };
  }
  out.tiers = tiers;
  // The painted styles draw none of the rubble.
  g.setStyle('paint');
  await wait(() => (lay(), stones().visible === false), 10000);
  out.rubblePainted = stones();
  g.setStyle('real');
  await wait(() => (lay(), stones().visible === true), 10000);
  out.rubbleBack = stones();
  return out;
}

async function open(query) {
  const profile = `${tmpdir()}/continuum-ground-${process.pid}-${Date.now()}`;
  const url = `http://localhost:${PORT}/index.html?${query}`;
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--window-size=640,360', '--remote-debugging-port=0', `--user-data-dir=${profile}`, url],
  { stdio: ['ignore', 'ignore', 'pipe'], env: CHROME_ENV });
  const devtools = await new Promise((resolve, reject) => {
    let text = '';
    chrome.stderr.on('data', (d) => {
      text += d;
      const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(text);
      if (m) resolve(new URL(m[1]));
    });
    chrome.on('exit', () => reject(new Error('chrome exited: ' + text.slice(-400))));
  });
  let page = null;
  for (let i = 0; i < 100 && !page; i++) {
    const list = await (await fetch(`http://${devtools.host}/json/list`)).json();
    page = list.find((t) => t.type === 'page' && t.url.includes('index.html'));
    if (!page) await sleep(100);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map((a) => a.value ?? a.description).join(' ');
      if (msg.params.type === 'error' || text.startsWith('continuum:')) errors.push(text);
    }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    pending.set(++id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable');
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed');
    return r.result.result.value;
  };
  const close = () => {
    ws.close();
    chrome.kill();
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 300);
  };
  return { ev, errors, close };
}

async function realPage() {
  const server = spawn('node', [ROOT + 'tools/serve.mjs', String(PORT), ROOT], { stdio: ['ignore', 'ignore', 'inherit'] });
  try {
    let up = false;
    for (let i = 0; i < 80 && !up; i++) {
      try {
        up = (await fetch(`http://localhost:${PORT}/`)).ok;
      } catch { /* not up yet */ }
      if (!up) await sleep(100);
    }
    if (!up) throw new Error('server did not start');
    const page = await open('seed=7&world=alpine&s=5000&style=real');
    try {
      let ready = false;
      for (let i = 0; i < 160 && !ready; i++) {
        ready = await page.ev('!!(window.game && game.bakers && game.bakers.ready && game.simTime > 1)');
        if (!ready) await sleep(250);
      }
      if (!ready) throw new Error('the workers never came up');
      const r = await page.ev(`(${inPage})()`);
      const mid = r.tiers.mid;
      const low = r.tiers.low;
      const high = r.tiers.high;
      say(r.got && r.workerRock && r.workerFine, 'the textures a worker made are the page\'s, bit for bit');
      say(r.rockSize === GROUND_SIZE.high.rock && r.bytes < 12 * MB, `at high the rock's texture is ${r.rockSize} texels across, and the maps hold ${(r.bytes / MB).toFixed(2)} MB`);
      say(r.beds.tiles > 0 && r.beds.bedded > 0 && r.beds.max <= FACE.amp + 1e-6 && r.beds.strays === 0,
        `tiles of the finest level in the page: ${r.beds.bedded} of ${r.beds.tiles} have beds, pushed by at most ${r.beds.max.toFixed(3)} m, each with the depth of the sun's shadow that moves them`);
      say(mid.held === 'mid' && mid.width === GROUND_SIZE.mid.rock && mid.fine === GROUND_SIZE.mid.fine && mid.numbers[2] === 1,
        `mid: textures of ${mid.width} and ${mid.fine} texels, the beds pushed`);
      say(r.high.live && mid.live && mid.gone, 'the textures are on the card at high and at mid, and the high ones are given back when the tier makes them again');
      say(low.held === null && low.width === 0 && low.numbers[0] === 0 && low.numbers[1] === 0 && low.numbers[2] === 0 && !low.live && low.gone,
        `low: no textures held, none of the earlier ones on the card, the beds not pushed (${r.high.textures} textures in the renderer at high, ${low.textures} at low)`);
      say(high.held === 'high' && high.width === GROUND_SIZE.high.rock && high.numbers[0] === 1 && high.live && high.fresh,
        `high again: new textures of ${high.width} texels, on the card`);
      say(r.rubbleHigh.count > 0 && mid.scree.count <= r.rubbleHigh.count * 0.8 + 1 && low.scree.count === 0,
        `rubble at ${r.sCar} m: ${r.rubbleHigh.count} stones at high, ${mid.scree.count} at mid, ${low.scree.count} at low`);
      say(r.rubblePainted.visible === false && r.rubbleBack.visible === true, 'the painted style draws none of the rubble, and the real style draws it again');
      say(page.errors.length === 0, `nothing is logged as an error${page.errors.length ? ': ' + page.errors[0] : ''}`);
    } finally {
      page.close();
    }
  } finally {
    server.kill();
  }
}

strata();
baked();
textures();
if (!process.argv.includes('--node-only')) {
  try {
    await realPage();
  } catch (e) {
    console.error(e);
    failed = true;
  }
}
console.log(failed ? 'FAIL' : 'OK: the ground\'s beds, maps and rubble hold');
process.exit(failed ? 1 : 0);
