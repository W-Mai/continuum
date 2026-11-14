// Tiles baked in a worker come out as they do on the page.
//
// Loads the real page in Chrome (not a headless run, which bakes on the
// page), waits for the workers (render/bakers.js), then bakes the same land
// and forest tiles both ways, around the camera and along the road ahead,
// and compares every array bit for bit. In each world of the cases below,
// and once more after turning to the next world, so the workers are seen to
// follow the page's schedule. It also checks that the workers load every
// module by its stamped URL (tools/stamp.mjs).
//
// Usage: node tools/bake_check.mjs
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
const PORT = 8178;
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Where to look: the start of a world, a border, cloud over the land
// (tiles left empty), the city's parks and the kelp under the deep sea.
const CASES = [
  { name: 'alpine', query: 'seed=7&s=6000', turn: true },
  { name: 'coast border', query: 'seed=7&world=coast&worldlen=2500&s=1700' },
  { name: 'city', query: 'seed=42&world=city&s=2000' },
  { name: 'heaven', query: 'seed=3&world=heaven&s=1200' },
  { name: 'abyss', query: 'seed=7&world=abyss&s=1500' },
  { name: 'upside', query: 'seed=7&world=upside&s=1500' },
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
  let buried = 0;
  let planted = 0;
  for (const key of land) {
    const [l, i, j] = key.split(':').map(Number);
    const box = landBox(l, i, j);
    const here = run(bakeLand(g.terrain.env, l, i, j, g.corridor.prepare(...box), g.terrain.sunDir));
    const there = await inWorker({ type: 'land', level: l, ix: i, iz: j, ctx: g.corridor.prepare(...box), sun: sun(g.terrain.sunDir) });
    if (here.buried) buried++;
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
    land: land.size, buried, trees: trees.size, planted, arrays, values, bad: bad.slice(0, 8), mismatches: bad.length,
    workers: B.workers.length, version: g.worlds.version,
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
  for (const c of CASES) {
    const page = await open(c.query);
    try {
      let up = false;
      for (let i = 0; i < 120 && !up; i++) {
        up = await page.ev('!!(window.game && game.bakers && game.bakers.ready && game.simTime > 1)');
        if (!up) await sleep(250);
      }
      if (!up) throw new Error('the workers never came up');
      const runs = [await page.ev(`(${compare})()`)];
      if (c.turn) {
        // Turn to the next world and let the road be laid again into it.
        await page.ev('game.nextWorld()');
        for (let i = 0; i < 80 && await page.ev('game.road.relaying(game.sCar)'); i++) await sleep(250);
        runs.push(await page.ev(`(${compare})()`));
      }
      runs.forEach((r, n) => {
        const ok = r.mismatches === 0 && r.arrays > 0 && page.errors.length === 0 && r.unstamped.length === 0;
        if (!ok) failed = true;
        const label = c.name + (n ? ' after a turn' : '');
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(20)} land ${r.land} (${r.buried} buried), trees ${r.trees} (${r.planted} planted),`
          + ` ${r.arrays} arrays, ${r.values} values, ${r.mismatches} differ; ${r.workers} workers, ${r.pool.baked} jobs at ${r.pool.msPerJob} ms`
          + (n ? `, schedule v${r.version}` : ''));
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
