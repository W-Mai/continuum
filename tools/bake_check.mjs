// Tiles baked in a worker come out as they do on the page.
//
// Loads the real page in Chrome (not a headless run, which bakes on the
// page), waits for the workers (render/bakers.js), then bakes the same land
// and forest tiles both ways, around the camera and along the road ahead,
// and compares every array bit for bit. In each world of the cases below,
// and once more after turning to the next world, so the workers are seen to
// follow the page's schedule. It also checks that the workers load every
// module by its stamped URL (tools/stamp.mjs). In the first case the grain of
// the road's surfaces (world/surface.js) is drawn both ways too, and the road
// is seen to have had its tiles from the workers (none drawn on the page); the
// worker's clock for them is printed, and held to half a second (what a loaded
// machine gives; their 150 ms of the processor is held by tools/surface_check.mjs).
// The tile of the real style's cirrus (world/cirrus.js) is drawn both ways too, and
// the sky is seen to have had its own from a worker.
//
// Usage: node tools/bake_check.mjs [case name ...]   (none: all of them)
// PORT=8199 moves the server it starts, to run beside another check.
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
const PORT = Number(process.env.PORT) || 8178;
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Where to look: the start of a world, a border, cloud over the land
// (tiles left empty), the city's parks, the kelp under the deep sea, and the
// land by the lava, whose tiles carry its light (world/infernoplan.js, lavaGlow):
// there some of them must.
const CASES = [
  { name: 'alpine', query: 'seed=7&s=6000', turn: true, surfaces: true, foliage: true },
  { name: 'coast border', query: 'seed=7&world=coast&worldlen=2500&s=1700' },
  { name: 'city', query: 'seed=42&world=city&s=2000' },
  { name: 'heaven', query: 'seed=3&world=heaven&s=1200' },
  { name: 'abyss', query: 'seed=7&world=abyss&s=1500' },
  { name: 'upside', query: 'seed=7&world=upside&s=1500' },
  { name: 'inferno', query: 'seed=7&world=inferno&s=2200', lava: true },
];

// Runs in the page: bake each tile on the page and in a worker, compare.
async function compare() {
  const g = window.game;
  const B = g.bakers;
  const { bakeLand, plantTrees, landBox, forestBox, LAND_LEVELS, FOREST_TILE } = await import('./src/world/bakery.js');
  const run = (gen) => {
    let r = gen.next();
    while (!r.done) r = gen.next();
    return r.value;
  };
  const sent = (ctx) => [ctx.seg.buffer, ctx.bStart.buffer, ctx.bIds.buffer];
  const inWorker = (job) => new Promise((resolve) => {
    const go = () => {
      if (!B.post(job, sent(job.ctx), resolve)) setTimeout(go, 10);
    };
    go();
  });
  const bad = [];
  let arrays = 0;
  let values = 0;
  const same = (a, b, path) => {
    if (ArrayBuffer.isView(a)) {
      arrays++;
      values += a.length;
      if (!ArrayBuffer.isView(b) || a.constructor !== b.constructor || a.length !== b.length) {
        bad.push(`${path}: ${a.constructor.name}(${a.length}) vs ${b && b.constructor.name}(${b && b.length})`);
        return;
      }
      const ua = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      const ub = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
      for (let k = 0; k < ua.length; k++) {
        if (ua[k] !== ub[k]) {
          const e = Math.floor(k / a.BYTES_PER_ELEMENT);
          bad.push(`${path}[${e}]: ${a[e]} vs ${b[e]}`);
          return;
        }
      }
      return;
    }
    if (a && typeof a === 'object') {
      const ka = Object.keys(a).sort().join();
      const kb = Object.keys(b || {}).sort().join();
      if (ka !== kb) {
        bad.push(`${path}: {${ka}} vs {${kb}}`);
        return;
      }
      for (const k of Object.keys(a)) same(a[k], b[k], `${path}.${k}`);
      return;
    }
    values++;
    if (!Object.is(a, b)) bad.push(`${path}: ${a} vs ${b}`);
  };

  // Around the camera, and around the road 0.5, 1.5 and 3 km ahead, where
  // after a turn the new world comes in.
  const cam = g.camera.position;
  const spots = [[cam.x + g.road.origin.x, cam.z + g.road.origin.z]];
  for (const ahead of [500, 1500, 3000]) {
    const p = g.road.at(g.sCar + ahead);
    if (p) spots.push([p.x + g.road.origin.x, p.z + g.road.origin.z]);
  }
  const land = new Set();
  const trees = new Set();
  spots.forEach(([x, z], n) => {
    for (let l = 0; l < LAND_LEVELS.length; l++) {
      if (n > 0 && l > 2) break;
      const s = LAND_LEVELS[l];
      const r = n === 0 ? 1 : 0;
      for (let j = -r; j <= r; j++) {
        for (let i = -r; i <= r; i++) land.add(`${l}:${Math.floor(x / s) + i}:${Math.floor(z / s) + j}`);
      }
    }
    const r = n === 0 ? 2 : 1;
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) trees.add(`${Math.floor(x / FOREST_TILE) + i}:${Math.floor(z / FOREST_TILE) + j}`);
    }
  });
  const sun = (s) => ({ x: s.x, y: s.y, z: s.z });
  // The road's surfaces: the four tiles drawn on the page and in a worker, and where the road's own came from.
  let surface = null;
  if (window.__bakeSurfaces) {
    const { bakeSurface, SURFACE_NAMES } = await import('./src/world/surface.js');
    const here = SURFACE_NAMES.map(bakeSurface);
    const t0 = B.ms;
    const there = await new Promise((resolve) => {
      const go = () => {
        if (!B.post({ type: 'surface', names: SURFACE_NAMES }, [], resolve)) setTimeout(go, 10);
      };
      go();
    });
    const ms = B.ms - t0;
    same(here, there.surfaces, 'surfaces');
    const road = g.roadMesh.surfaces;
    surface = { ms: +ms.toFixed(1), tiles: here.length, bytes: here.reduce((n, t) => n + t.a.length + (t.b ? t.b.length : 0), 0), held: road.held.size, onPage: road.page };
  }
  // The tile of cirrus, on the page and in a worker, and where the sky's own came from.
  let cirrus = null;
  if (window.__bakeSurfaces) {
    const { bakeCirrus } = await import('./src/world/cirrus.js');
    const here = bakeCirrus();
    const t0 = B.ms;
    const there = await new Promise((resolve) => {
      const go = () => {
        if (!B.post({ type: 'cirrus' }, [], resolve)) setTimeout(go, 10);
      };
      go();
    });
    const ms = B.ms - t0;
    same(here, there.cirrus, 'cirrus');
    const sky = g.atmosphere.cirrus;
    cirrus = { ms: +ms.toFixed(1), bytes: here.length, held: sky.held, onPage: sky.page };
  }
  // The leaves and the bark of the real style's trees: drawn on the page and in a worker, at each tier.
  let foliage = null;
  if (window.__bakeFoliage) {
    const { bakeFoliage } = await import('./src/world/foliage.js');
    const t0 = B.ms;
    let n = 0;
    let bytes = 0;
    for (const tier of ['high', 'mid', 'low']) {
      const here = bakeFoliage(tier);
      const there = await new Promise((resolve) => {
        const go = () => {
          if (!B.post({ type: 'foliage', tier }, [], resolve)) setTimeout(go, 10);
        };
        go();
      });
      same(here, there.foliage, `foliage ${tier}`);
      n += here.length;
      bytes += here.reduce((a, t) => a + t.a.length, 0);
    }
    const f = g.foliage;
    foliage = { ms: +(B.ms - t0).toFixed(1), textures: n, bytes, ready: f.ready, onPage: f.page };
  }
  let buried = 0;
  let planted = 0;
  let lit = 0;
  for (const key of land) {
    const [l, i, j] = key.split(':').map(Number);
    const box = landBox(l, i, j);
    const here = run(bakeLand(g.terrain.env, l, i, j, g.corridor.prepare(...box), g.terrain.sunDir));
    const there = await inWorker({ type: 'land', level: l, ix: i, iz: j, ctx: g.corridor.prepare(...box), sun: sun(g.terrain.sunDir) });
    if (here.buried) buried++;
    if (here.lava) lit++;
    same(here, there, `land ${key}`);
  }
  for (const key of trees) {
    const [i, j] = key.split(':').map(Number);
    const box = forestBox(i, j);
    const here = run(plantTrees(g.forest.env, i, j, g.corridor.prepare(...box), g.forest.sunDir, g.seed));
    const there = await inWorker({ type: 'trees', ix: i, iz: j, ctx: g.corridor.prepare(...box), sun: sun(g.forest.sunDir), seed: g.seed });
    planted += here.count;
    same(here, there, `trees ${key}`);
  }
  return {
    land: land.size, buried, lit, trees: trees.size, planted, arrays, values, bad: bad.slice(0, 8), mismatches: bad.length,
    surface, cirrus, foliage, workers: B.workers.length, version: g.worlds.version,
    pool: { baked: B.baked, msPerJob: +(B.ms / Math.max(1, B.baked)).toFixed(2) },
    unstamped: Object.entries(B.urls).filter(([, u]) => !/\?v=[0-9a-f]{10}$/.test(u)).map(([n, u]) => `${n} ${u}`),
  };
}

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

// A page in Chrome, driven over the DevTools protocol.
async function open(query) {
  const profile = `${tmpdir()}/continuum-bake-${process.pid}-${Date.now()}`;
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
      // Errors, and the pool's own warning that it gave up.
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

const server = serve();
let failed = false;
try {
  if (!(await waitForServer())) throw new Error('server did not start');
  const only = process.argv.slice(2);
  for (const c of CASES.filter((k) => !only.length || only.includes(k.name))) {
    const page = await open(c.query);
    try {
      let up = false;
      for (let i = 0; i < 120 && !up; i++) {
        up = await page.ev('!!(window.game && game.bakers && game.bakers.ready && game.simTime > 1)');
        if (!up) await sleep(250);
      }
      if (!up) throw new Error('the workers never came up');
      if (c.surfaces) await page.ev('window.__bakeSurfaces = true');
      if (c.foliage) await page.ev('window.__bakeFoliage = true');
      const runs = [await page.ev(`(${compare})()`)];
      if (c.turn) {
        // Turn to the next world and let the road be laid again into it.
        await page.ev('game.nextWorld()');
        for (let i = 0; i < 80 && await page.ev('game.road.relaying(game.sCar)'); i++) await sleep(250);
        runs.push(await page.ev(`(${compare})()`));
      }
      runs.forEach((r, n) => {
        const sf = r.surface;
        // The tiles of the road's surfaces: all four held, none of them drawn on the page, a worker's clock under half a second.
        const sok = !sf || (sf.held === 4 && sf.onPage === 0 && sf.ms <= 500);
        // The tile of cirrus: the sky has its own, a worker's, none drawn on the page, a worker's clock under half a second.
        const cr = r.cirrus;
        const cok = !cr || (cr.held && cr.onPage === 0 && cr.ms <= 500);
        // The leaves and the bark: all three tiers the same in a worker as on the page, the game's own come from a worker.
        const fl = r.foliage;
        const fok = !fl || (fl.ready && fl.onPage === 0 && fl.ms <= 1500);
        // By the lava, some tiles with its light.
        const lok = !c.lava || r.lit > 0;
        const ok = lok && r.mismatches === 0 && r.arrays > 0 && page.errors.length === 0 && r.unstamped.length === 0 && sok && cok && fok;
        if (!ok) failed = true;
        const label = c.name + (n ? ' after a turn' : '');
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(20)} land ${r.land} (${r.buried} buried${c.lava ? `, ${r.lit} lit by lava` : ''}), trees ${r.trees} (${r.planted} planted),`
          + ` ${r.arrays} arrays, ${r.values} values, ${r.mismatches} differ; ${r.workers} workers, ${r.pool.baked} jobs at ${r.pool.msPerJob} ms`
          + (n ? `, schedule v${r.version}` : '')
          + (fl ? `; foliage: ${fl.textures} textures, ${(fl.bytes / 1048576).toFixed(2)} MB, ${fl.ms} ms in a worker, ${fl.onPage} drawn on the page` : '')
          + (sf ? `; surfaces: ${sf.tiles} tiles, ${(sf.bytes / 1048576).toFixed(2)} MB, ${sf.ms} ms in a worker, ${sf.held} held by the road, ${sf.onPage} drawn on the page` : '')
          + (cr ? `; cirrus: ${(cr.bytes / 1000).toFixed(0)} kB, ${cr.ms} ms in a worker, ${cr.held ? 'held' : 'not held'} by the sky, ${cr.onPage} drawn on the page` : ''));
        for (const b of r.bad) console.log('       ' + b);
        for (const u of r.unstamped) console.log('       unstamped: ' + u);
      });
      for (const e of page.errors) console.log('       page: ' + e);
    } finally {
      page.close();
    }
  }
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  server.kill();
}
console.log(failed ? 'FAIL' : 'OK: worker tiles are the page\'s, bit for bit');
process.exit(failed ? 1 : 0);
