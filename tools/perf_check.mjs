// What a stretch of road costs the main thread, in numbers.
//
// look.mjs measures one frame drawn at a place; this measures driving: how
// long each step of the game (Game.update) takes, which of its parts the
// time goes to, and whether what is kept on the GPU keeps growing. It runs
// the real page headless, one page a world: seed 7, world=<id>, the
// synchronous mode of run=60 (the page steps 60 frames and draws the last),
// then in the page the autopilot drives 20 s (1200 steps of 1/60 s), the
// road is turned toward the next world in the loop (Game.nextWorld, as
// turn=next does) and it drives 10 s more. Each step is timed with
// performance.now() around Game.update (the page is served cross-origin
// isolated, so the clock is good to a few microseconds, not a tenth of a
// millisecond); the top-level parts of update() (terrain, forest, city,
// clutter, physics, ...) are timed by wrapping each one's method on its
// instance in the page (src/ is not changed). A frame is drawn every 2 s
// and the renderer's geometries and textures counted (three.js counts only
// what has been drawn); at the end renderer.info.memory, the number of
// shader programs, and an estimate of the texture memory: the textures and
// render targets the frames drew with, in the scene's materials, or kept on
// the game's objects, width x height x bytes a pixel, x 1.33 with mipmaps.
//
// In the synchronous mode a step builds there and then every tile of land,
// forest and city it wants (the page proper bakes them in Workers and adds a
// few a frame), so the steps that build tiles are many times dearer than
// the rest, and the 95th percentile and the maximum are far above what the
// real page spends on a frame. That is as it should be here: the numbers
// are compared with this tool's own baseline, not with a frame's budget.
// The steps that build no tile are reported apart ("quiet"), as the cost of
// driving alone.
//
// What is held to the baseline, and why so (two runs of the same code, a
// world at a time):
//  - update.p95, over all 1800 steps, at most 0.5 ms above it (it moves by
//    under 0.1 ms between runs);
//  - drive.max, the dearest step of the first 20 s, at most 4 ms above it
//    (it moves by under 1.5 ms). The dearest step of the whole run is the
//    one after the turn, which builds again every tile of the land ahead at
//    once (150-370 ms); it moves by up to 20 ms between runs, and is only
//    reported (update.max, after.max);
//  - the geometries the renderer holds that nothing in the scene uses any
//    more (taken off it, never disposed of) are no more at the end than at
//    the turn. The renderer's own count of geometries rises and falls by
//    a hundred or more in 10 s as the land around the lens fills in, so it
//    is only reported;
//  - the textures no more at the end than 2 s after the turn (the next
//    world's own come in with it).
// The counts are the same from run to run.
//
// Usage:
//   node tools/perf_check.mjs                          every world, to out/perf.json
//   node tools/perf_check.mjs --worlds hills,city      only these
//   node tools/perf_check.mjs --write tools/look/perf-baseline.json
//   node tools/perf_check.mjs --check tools/look/perf-baseline.json
// --check prints a line for each limit, ok or FAIL, and exits non-zero if any fails.
// Measure with nothing else running on the machine.
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';

const CHROME = process.env.CHROME || ({
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
}[process.platform] || '/usr/bin/google-chrome-stable');
// Headless WebGL fails on Linux while DISPLAY is set.
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8187;
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const WORLDS = ['alpine', 'hills', 'river', 'coast', 'desert', 'city', 'cavern', 'inferno', 'abyss', 'heaven', 'space', 'upside'];
const SEED = 7;
const DRIVE = 1200;      // steps in the world itself
const AFTER = 600;       // steps after turning toward the next one
const EVERY = 120;       // steps between counts of what is on the GPU
const SETTLE = 2;        // seconds after the turn before the textures are held to their count
// The limits, against the baseline.
const LIMITS = { p95: 0.5, max: 4 };

function serve() {
  return spawn('node', [ROOT + 'tools/serve.mjs', String(PORT), ROOT, 'isolated'], { stdio: ['ignore', 'ignore', 'inherit'] });
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

// The page, headless, and a way to run code in it (as in look.mjs).
async function openPage(query) {
  const profile = `${tmpdir()}/continuum-perf-${process.pid}-${Date.now()}`;
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--mute-audio',
    '--hide-scrollbars', '--window-size=1280,720', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    `http://localhost:${PORT}/index.html?${query}`], { stdio: ['ignore', 'ignore', 'pipe'], env: CHROME_ENV });
  const close = () => {
    chrome.kill();
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
  };
  try {
    const devtools = await new Promise((resolve, reject) => {
      let text = '';
      chrome.on('error', reject);
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
    const logs = [];
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        logs.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
      }
      if (msg.method === 'Runtime.exceptionThrown') logs.push(String(msg.params.exceptionDetails.text).slice(0, 300));
      if (pending.has(msg.id)) {
        pending.get(msg.id)(msg.result);
        pending.delete(msg.id);
      }
    });
    ws.send(JSON.stringify({ id: 9999, method: 'Runtime.enable' }));
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
    if (title !== 'GAME_DONE') throw new Error(`page: ${title}`);
    return {
      logs,
      run: async (body) => {
        const out = await ev(`(async () => { const g = game; ${body} })().then((v) => JSON.stringify(v), (e) => JSON.stringify({ error: e.message + ' ' + (e.stack || '').slice(0, 400) }))`);
        return JSON.parse(out);
      },
      close,
    };
  } catch (e) {
    close();
    throw e;
  }
}

// In the page: the drive, timed. Returns each step's milliseconds, how many
// tiles it built, the parts' totals, the counts on the GPU over the last
// 10 s, and what is held at the end.
const DRIVE_BODY = `
  const r = g.renderer;
  // The top-level parts of update(), each timed where it is called from
  // update() (a part called from inside another is the other's).
  const parts = {};
  let inside = false;
  const wrap = (name, obj, method) => {
    if (!obj || typeof obj[method] !== 'function') return;
    const f = obj[method];
    parts[name] = 0;
    obj[method] = function (...a) {
      if (inside) return f.apply(this, a);
      inside = true;
      const t0 = performance.now();
      try { return f.apply(this, a); } finally { parts[name] += performance.now() - t0; inside = false; }
    };
  };
  wrap('physics', g, 'stepPhysics');
  wrap('road', g.roadMesh, 'update');
  wrap('traffic', g.traffic, 'update');
  wrap('car', g.presentation, 'update');
  wrap('skids', g.skids, 'update');
  wrap('dust', g.dust, 'update');
  wrap('camera', g.chase, 'update');
  wrap('director', g.director, 'update');
  wrap('upside', g.upside, 'turnView');
  wrap('upside', g.upside, 'update');
  wrap('terrain', g.terrain, 'update');
  wrap('terrain', g.terrain, 'setPortals');
  wrap('forest', g.forest, 'update');
  wrap('forest', g.forest, 'animate');
  wrap('city', g.city, 'update');
  wrap('water', g.water, 'update');
  wrap('ceiling', g.ceiling, 'update');
  wrap('look', g, '_updateLook');
  wrap('motes', g.motes, 'update');
  wrap('fish', g.fish, 'update');
  wrap('critters', g.critters, 'update');
  wrap('drift', g.drift, 'update');
  wrap('props', g.props, 'update');
  wrap('clutter', g.clutter, 'update');
  wrap('atmosphere', g.atmosphere, 'update');
  wrap('style', g.style, 'update');
  // Tiles built in a step: the synchronous paths of terrain, forest, city.
  let built = 0;
  const count = (obj, method) => {
    if (!obj || typeof obj[method] !== 'function') return;
    const f = obj[method];
    obj[method] = function (...a) { built++; return f.apply(this, a); };
  };
  count(g.terrain, '_build');
  count(g.forest, '_build');
  count(g.city, '_bake');

  // The geometries the renderer holds that nothing in the scene uses any
  // more: taken off the scene and never disposed of. The renderer's own count
  // rises and falls as the land around the lens fills in (some 400 to 700 in
  // the hills over a few minutes), so a leak is told by these: the geometries
  // in the scene now, and those first drawn from here on (three.js listens
  // for a geometry's dispose when it first draws it), until disposed of.
  const THREE = await import('three');
  const live = new Set();
  g.scene.traverse((o) => { if (o.geometry) live.add(o.geometry); });
  const listen = THREE.BufferGeometry.prototype.addEventListener;
  THREE.BufferGeometry.prototype.addEventListener = function (type, fn) {
    if (type === 'dispose') live.add(this);
    return listen.call(this, type, fn);
  };
  const dispose = THREE.BufferGeometry.prototype.dispose;
  THREE.BufferGeometry.prototype.dispose = function () { live.delete(this); return dispose.call(this); };
  const orphans = () => {
    const used = new Set();
    g.scene.traverse((o) => { if (o.geometry) used.add(o.geometry); });
    let n = 0;
    for (const geo of live) if (!used.has(geo)) n++;
    return n;
  };

  // The textures and render targets a frame draws with: every one goes
  // through the renderer's properties as it is bound (looked at only while
  // the frames counted below are drawn).
  const bound = new Set();
  let looking = false;
  const props = r.properties.get;
  r.properties.get = function (o) {
    if (looking && o && (o.isTexture || o.isWebGLRenderTarget)) bound.add(o);
    return props.call(this, o);
  };

  const ms = [], tiles = [], samples = [];
  const held = (t) => {
    looking = true;
    g.render();
    looking = false;
    samples.push({ t, geometries: r.info.memory.geometries, textures: r.info.memory.textures, orphans: orphans() });
  };
  const step = () => {
    built = 0;
    const t0 = performance.now();
    g.update(1 / 60);
    ms.push(performance.now() - t0);
    tiles.push(built);
  };
  const from = g.worldHere().id;
  for (let i = 0; i < ${DRIVE}; i++) {
    if (i % ${EVERY} === 0) held(i / 60);
    step();
  }
  const turned = g.nextWorld();
  for (let i = 0; i < ${AFTER}; i++) {
    if (i % ${EVERY} === 0) held((${DRIVE} + i) / 60);
    step();
  }
  held((${DRIVE} + ${AFTER}) / 60);

  // What is held at the end: the textures and render targets the frames
  // drew with, those in the scene's materials, and those kept on the game's
  // objects a few levels down (the passes after the scene, the sky's light),
  // still on the GPU (three.js listens for a dispose while it holds one), by
  // width x height x bytes a pixel, x 1.33 with mipmaps.
  const seen = new Set();
  const bytes = { textures: 0, targets: 0 };
  let nTex = 0, nRT = 0;
  const T = { 1009: 1, 1010: 1, 1011: 2, 1012: 2, 1013: 4, 1014: 4, 1015: 4, 1016: 2, 1017: 2, 1018: 2, 1020: 4 };  // three.js types: bytes a channel
  const C = { 1021: 1, 1022: 3, 1023: 4, 1024: 1, 1025: 1, 1026: 1, 1027: 2, 1028: 1, 1029: 1, 1030: 2, 1031: 2, 1033: 4 };  // formats: channels
  const alive = (o) => !!(o._listeners && o._listeners.dispose && o._listeners.dispose.length);
  const sizeOf = (t, w, h, cube) => {
    const per = t.isDepthTexture ? 4 : (T[t.type] || 1) * (C[t.format] || 4);
    const depth = (t.image && t.image.depth) || 1;
    const faces = t.isCubeTexture || cube ? 6 : 1;
    const mip = t.generateMipmaps && t.minFilter !== 1003 && t.minFilter !== 1006 ? 1.33 : 1;
    return w * h * depth * faces * per * mip;
  };
  const texture = (t) => {
    if (!t || !t.isTexture || seen.has(t)) return;
    seen.add(t);
    if (t.isRenderTargetTexture || !alive(t)) return;    // a target's is counted with it
    const im = Array.isArray(t.image) ? t.image[0] : t.image;
    if (!im) return;
    const w = im.width || im.videoWidth || 0, h = im.height || im.videoHeight || 0;
    if (!w || !h) return;
    nTex++;
    bytes.textures += sizeOf(t, w, h, false);
  };
  const target = (rt) => {
    if (!rt || !rt.isWebGLRenderTarget || seen.has(rt)) return;
    seen.add(rt);
    if (!alive(rt)) return;
    nRT++;
    const n = Math.max(1, rt.samples || 0);
    for (const t of [].concat(rt.texture)) { seen.add(t); bytes.targets += sizeOf(t, rt.width, rt.height, rt.isWebGLCubeRenderTarget) * n; }
    if (rt.depthTexture) { seen.add(rt.depthTexture); bytes.targets += rt.width * rt.height * 4; }
    else if (rt.depthBuffer) bytes.targets += rt.width * rt.height * 4 * n;
  };
  const material = (m) => {
    if (!m) return;
    for (const v of Object.values(m)) { if (v && v.isTexture) texture(v); }
    if (m.uniforms) for (const u of Object.values(m.uniforms)) {
      const v = u && u.value;
      if (v && v.isTexture) texture(v);
      else if (Array.isArray(v)) v.forEach((x) => x && x.isTexture && texture(x));
    }
  };
  for (const o of bound) { if (o.isWebGLRenderTarget) target(o); }
  for (const o of bound) { if (o.isTexture && o.isRenderTargetTexture) continue; texture(o); }
  g.scene.traverse((o) => {
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(material);
    if (o.isLight && o.shadow && o.shadow.map) target(o.shadow.map);
  });
  if (g.scene.background && g.scene.background.isTexture) texture(g.scene.background);
  if (g.scene.environment && g.scene.environment.isTexture) texture(g.scene.environment);
  const walked = new Set();
  const walk = (v, d) => {
    if (!v || typeof v !== 'object' || walked.has(v) || ArrayBuffer.isView(v) || v.isObject3D || v.isBufferGeometry) return;
    walked.add(v);
    if (v.isWebGLRenderTarget) return target(v);
    if (v.isTexture) return texture(v);
    if (v.isMaterial) return material(v);
    if (d <= 0) return;
    if (v instanceof Map || v instanceof Set) { if (v.size < 400) for (const x of v.values()) walk(x, d - 1); return; }
    if (Array.isArray(v)) { if (v.length < 400) for (const x of v) walk(x, d - 1); return; }
    for (const k of Object.keys(v)) walk(v[k], d - 1);
  };
  walk(g, 4);
  const MB = 1024 * 1024;
  return {
    ms, tiles, parts, samples, from, turned, roadAudit: g.roadMesh.audit(),
    memory: { geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs ? r.info.programs.length : null },
    textureMB: { textures: +(bytes.textures / MB).toFixed(1), targets: +(bytes.targets / MB).toFixed(1),
      total: +((bytes.textures + bytes.targets) / MB).toFixed(1), counted: nTex, renderTargets: nRT },
    distance: g.sCar, isolated: self.crossOriginIsolated,
  };
`;

const round = (v, d = 3) => (v === null || v === undefined ? v : Math.round(v * 10 ** d) / 10 ** d);
function stats(list) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
  // The mean of the middle 80% (a tenth cut off each end).
  const cut = s.slice(Math.floor(s.length * 0.1), Math.ceil(s.length * 0.9));
  return {
    n: s.length, median: round(at(0.5)), p95: round(at(0.95)), max: round(s[s.length - 1]),
    mean: round(s.reduce((a, b) => a + b, 0) / s.length), trimmed: round(cut.reduce((a, b) => a + b, 0) / cut.length),
  };
}

function summarise(world, d) {
  const all = d.ms;
  const quiet = all.filter((_, i) => d.tiles[i] === 0);
  const total = all.reduce((a, b) => a + b, 0);
  const parts = Object.fromEntries(Object.entries(d.parts).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => [k, { ms: round(v / all.length), share: round(v / total) }]));
  // The counts over the last 10 s: the geometries left over from the turn
  // on, the textures from a count after it (the next world's own come in as
  // it is asked for).
  const since = (t0) => d.samples.filter((s) => s.t >= t0 - 1e-6);
  const growth = (list, k) => Math.max(...list.map((s) => s[k])) - list[0][k];
  const late = since(DRIVE / 60);
  const settled = since(DRIVE / 60 + SETTLE);
  return {
    update: stats(all),
    quiet: stats(quiet),
    drive: stats(all.slice(0, DRIVE)),
    after: stats(all.slice(DRIVE)),
    tiles: { steps: d.tiles.filter((n) => n > 0).length, built: d.tiles.reduce((a, b) => a + b, 0) },
    parts,
    memory: d.memory,
    textureMB: d.textureMB,
    // [seconds, geometries, textures, orphan geometries], every 2 s from the start.
    held: d.samples.map((s) => [round(s.t, 1), s.geometries, s.textures, s.orphans]),
    grew: { geometries: growth(late, 'geometries'), orphans: growth(late, 'orphans'), textures: growth(settled, 'textures') },
    at: { from: d.from, turned: d.turned, s: round(d.distance, 0), isolated: d.isolated },
    roadAudit: d.roadAudit,
  };
}

// The limits, written out a line each as look.mjs does.
function check(results, base) {
  const failures = [];
  let passed = 0;
  const line = (ok, text) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
    if (ok) passed++;
    else failures.push(text);
  };
  for (const [world, r] of Object.entries(results)) {
    const b = base[world];
    if (!b) {
      console.log(`--   ${world}: not in the baseline`);
      continue;
    }
    line(r.update.p95 <= b.update.p95 + LIMITS.p95, `${world} update.p95 = ${r.update.p95} ms, at most ${round(b.update.p95 + LIMITS.p95, 3)}`);
    line(r.drive.max <= b.drive.max + LIMITS.max, `${world} drive.max = ${r.drive.max} ms, at most ${round(b.drive.max + LIMITS.max, 3)}`);
    const at = (t0, i) => r.held.filter((h) => h[0] >= t0 - 1e-6).map((h) => h[i]).join(' ');
    line(r.grew.orphans <= 0, `${world} geometries off the scene and not disposed of, over the last 10 s: ${at(DRIVE / 60, 3)}, no more than at the start`);
    line(!r.roadAudit.length, `${world} the road's spans hold what their chunks do after the turn${r.roadAudit.length ? ': ' + r.roadAudit.join('; ') : ''}`);
    line(r.grew.textures <= 0, `${world} textures over the last ${10 - SETTLE} s: ${at(DRIVE / 60 + SETTLE, 2)}, no more than at the start`);
  }
  return { passed, failures };
}

// --- main ---------------------------------------------------------------------

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const has = (name) => args.includes(name);
const worlds = opt('--worlds', WORLDS.join(',')).split(',').filter((w) => WORLDS.includes(w));
const results = {};

const server = serve();
try {
  if (!(await waitForServer())) throw new Error('the dev server did not come up');
  for (const world of worlds) {
    const page = await openPage(`seed=${SEED}&world=${world}&run=60`);
    try {
      const d = await page.run(DRIVE_BODY);
      if (d.error) throw new Error(`${world}: ${d.error}`);
      const out = summarise(world, d);
      if (page.logs.length) out.errors = page.logs.slice(0, 3);
      results[world] = out;
      const u = out.update, q = out.quiet;
      const top = Object.entries(out.parts).slice(0, 3).map(([k, v]) => `${k} ${Math.round(v.share * 100)}%`).join(', ');
      console.log(`${world.padEnd(8)} update ${u.median} / ${u.p95} / ${u.max} ms (median / p95 / max)`
        + `  quiet ${q ? `${q.median} / ${q.p95}` : '-'}  tiles in ${out.tiles.steps} steps  ${top}`
        + `  geo ${out.memory.geometries} tex ${out.memory.textures} prog ${out.memory.programs} ~${out.textureMB.total} MB`
        + `  held ${out.held.map((h) => h[1] + '/' + h[2] + '/' + h[3]).join(' ')}`);
    } finally {
      page.close();
    }
  }
} finally {
  server.kill();
}

const file = opt('--write', ROOT + 'out/perf.json');
if (!has('--check') || has('--write')) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ seed: SEED, steps: { drive: DRIVE, after: AFTER, dt: 1 / 60 }, worlds: results }, null, 1) + '\n');
  console.log(`\nwritten: ${file}`);
}
if (has('--check')) {
  const base = JSON.parse(readFileSync(opt('--check'), 'utf8'));
  const { passed, failures } = check(results, base.worlds || base);
  await sleep(600);
  if (failures.length) {
    console.error(`\nFAILED: ${failures.length} limit(s), ${passed} held`);
    process.exit(1);
  }
  console.log(`\nOK: ${passed} limit(s) held`);
}
await sleep(600);
