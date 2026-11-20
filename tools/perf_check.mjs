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
// --soak is the other walk: one page, driven for ten minutes of game time, to
// see whether anything keeps growing. Seed 7. The road has to go through all
// twelve worlds in the ten minutes (the car goes 12 to 17 km, bends and all, and
// twelve worlds of 2.5 km are 30), so a world is 800 m (worldlen=800); the
// autopilot's cap is 50 m/s; the lane ahead is cleared of the cars it would
// follow; and the next world is asked for (Game.nextWorld, as its button does)
// every 90 s, once the world asked for last is under the wheels. Every 40 s the
// style changes (the seven in turn, each twice). Only what has to be drawn is
// drawn: of the 36000 steps all but one in 120 are Game.update alone (a frame
// costs half a second in the software renderer, a step a millisecond), and a
// style change draws five frames over its 1.4 s, a program being built when a
// frame first needs it.
//
// Every 30 s of game time, after a garbage collection, it counts: what the
// renderer holds (geometries, textures, shader programs); the JS heap, and the
// memory behind its typed arrays; the textures and render targets, by the same
// estimate as the drives above; the geometries taken off the scene and not
// disposed of, and the instanced meshes (whose matrices and colours go with the
// mesh, not with its geometry); the GL objects made less those deleted (buffers,
// vertex arrays, textures, framebuffers, renderbuffers, and the bytes the
// buffers hold, by size), counted from before the page's first script and by
// number alone, so that it is what three.js did and not what the garbage
// collector has done since; what the scene is made of, and how many tiles and
// chunks each part keeps; how many objects of the classes are alive (the
// protocol's queryObjects); and what the browser's processes take.
//
// Before the walk, at the place the road begins, the car stands still while the
// seven styles are gone through three times, the tier is stepped down to low and
// up twice, and the size the scene is drawn at down to a half and up twice, with
// a count at the end of each turn. The world is the same all the while, so what
// is made and not let go shows as more of it at the end of each turn.
//
// What is held (a line of the output each: ok, FAIL, or note, which is told and
// not held):
//  - geometries off the scene and never disposed of, instanced meshes taken off
//    it without a dispose of their own, and geometry objects alive that no scene
//    holds (the road's chunks apart): none more in the last five minutes than in
//    the first (none, for the instanced meshes);
//  - the JS heap after a collection: at most 25 MB more at minute ten than at
//    minute three (and, for a world the road comes to twice, the memory in the
//    heap, behind it and in the GPU's buffers the second time at most that much
//    more than the first);
//  - the estimate of texture memory: at most 96 MB above the drives' own
//    (tools/look/perf-baseline.json);
//  - at the place the road begins, at the end of a turn through the styles, the
//    tiers or the sizes after the first: no more textures, shader programs, GL
//    textures, framebuffers or renderbuffers than at the end of the one before,
//    and not more than a few geometries, buffers and vertex arrays.
// The count of geometries goes up and down by hundreds with the world in view and
// the style it is drawn in (a tree of blocks is a mesh, the far trees of a tile
// are one), and the textures and programs come in as a world brings the first of
// its kind into view, and as the traffic's and the ground's small things are
// made for each style: those are told, not held.
// A file at out/perf-soak.pause holds the walk between two counts until it is gone.
//
// --steps is the third walk: the steps of the page as a visitor has it. Not run=,
// which builds every tile of land and trees on the page, in the step that wants
// it, but the page as it opens, its workers baking them and the page meshing
// what comes back a few milliseconds a frame. Seed 7, worlds of 2.5 km
// (worldlen=2500), the autopilot at its own speed, 5 minutes of steps of 1/60 s
// taken in real time, one a sixtieth of a second, the page's own loop stopped (its
// pacer says no) so that the steps are the ones taken here; nothing is drawn.
// Each step is timed around Game.update. The first 20 s are warm-up and not
// counted. At 150 s the road is turned toward the next world (Game.nextWorld), the
// one stretch of the walk that lays road a frame after frame. The road's rounds
// are timed by their stages (the plan, the profile fit, the commit, the
// classification: what Road.update does, wrapped in the page, src/ is not changed),
// and the steps that cost the most are told with what each part of update() took.
// Held, what the road answers for: the road's own share of a step (the time
// Game.update spends in Road.update, laying road) at most 5 ms; the road classified
// further than MIN_AHEAD ahead of the car after every step; and the road the page
// has laid at the end, from the first sample to 400 m short of the last, the same
// samples (a hash of every field of each) as a road laid a round at a time, in the
// page too (a browser's maths is not node's to the last bit), from the same seed,
// the same turn and the same places of the car.
// Told, not held: the whole step against the line of 8 ms, and the steps over that
// line in which the road took more than 2 ms, each with what took what (the road,
// the terrain, the forest, the city, the road mesh, the rest). A step is also the
// road mesh building a chunk of road (3 to 5 ms), the terrain rebuilding after a
// world change (its budget is 4 ms), the forest, the city and the clutter, each on a
// budget of its own, and the road's slice is laid at the start of the frame, where
// it cannot see that these have filled it: so the dearest whole step of a page that
// lays its road in pieces is 8 to 9.5 ms, a chunk of the road mesh, or the terrain's
// rebuild after the turn together with a slice of the road of 3 ms; the guarantee is
// the road's own slice, not the whole step's maximum. And the 99.9th percentile, the
// median, what a round takes and in how many pieces, and in how many steps the road
// is laid again after the turn. --root serves another tree (a commit exported with
// git archive), to measure that code (it fails the line about the road's slice, as
// the code that lays a round in one step does); nothing else running on the machine,
// as always.
//
// Usage:
//   node tools/perf_check.mjs                          every world, to out/perf.json
//   node tools/perf_check.mjs --worlds hills,city      only these
//   node tools/perf_check.mjs --write tools/look/perf-baseline.json
//   node tools/perf_check.mjs --check tools/look/perf-baseline.json
//   node tools/perf_check.mjs --soak                   the ten minutes, to out/perf-soak.json
//   node tools/perf_check.mjs --soak --write tools/look/soak-baseline.json
//   node tools/perf_check.mjs --soak --seconds 120 --vmax 40 --worldlen 1200 --style-every 40 --turn-every 30
//   node tools/perf_check.mjs --soak --no-place        without the stretch at the place the road begins
//   node tools/perf_check.mjs --soak --loop city,cavern --seconds 120   only these worlds take turns
//   node tools/perf_check.mjs --soak --gates out/perf-soak.json    the lines again over a run kept (nothing is run)
//   node tools/perf_check.mjs --steps                  the five minutes of steps, to out/perf-steps.json
//   node tools/perf_check.mjs --steps --seconds 60 --pace fast --turn-at 20    a short one, not in real time
//   node tools/perf_check.mjs --steps --root ~/.cache/continuum/<commit> --write out/before.json
//   node tools/perf_check.mjs --steps --gates out/perf-steps.json   the lines again over a run kept (nothing is run)
//   node tools/perf_check.mjs --steps --road-detail     says which samples differ and how, if the road is not the one laid a round at a time
// --check prints a line for each limit, ok or FAIL, and exits non-zero if any fails;
// --soak and --steps print their lines the same way and exit non-zero when one that is held fails.
// Measure with nothing else running on the machine.
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadavg, tmpdir } from 'node:os';

const CHROME = process.env.CHROME || ({
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
}[process.platform] || '/usr/bin/google-chrome-stable');
// Headless WebGL fails on Linux while DISPLAY is set.
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8187;
const ROOT = new URL('..', import.meta.url).pathname;
// The tree the pages are served from: this one, or --root another (a commit exported with git archive).
const SITE = process.argv.includes('--root') ? resolve(process.argv[process.argv.indexOf('--root') + 1]) + '/' : ROOT;
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
  return spawn('node', [ROOT + 'tools/serve.mjs', String(PORT), SITE, 'isolated'], { stdio: ['ignore', 'ignore', 'inherit'] });
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
// opts.flags: more arguments for the browser. opts.init: code to run in the
// page before any of its own; the browser is then opened on a blank page and
// sent to the game after the code is in. opts.ready: the expression that is true
// when the page is up (a run= page says so by its title, GAME_DONE; the page proper
// by window.__ready).
async function openPage(query, opts = {}) {
  const profile = `${tmpdir()}/continuum-perf-${process.pid}-${Date.now()}`;
  const url = `http://localhost:${PORT}/index.html?${query}`;
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--mute-audio',
    '--hide-scrollbars', '--window-size=1280,720', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    ...(opts.flags || []), opts.init ? 'about:blank' : url], { stdio: ['ignore', 'ignore', 'pipe'], env: CHROME_ENV });
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
      page = list.find((t) => t.type === 'page' && (opts.init || t.url.includes('index.html')));
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
    // A page that goes away (the browser's process, the GPU's) answers what is
    // still waiting for an answer, so that nothing waits for ever.
    ws.addEventListener('close', () => {
      for (const done of pending.values()) done({ result: { value: JSON.stringify({ error: 'the page closed' }) } });
      pending.clear();
    });
    ws.send(JSON.stringify({ id: 9999, method: 'Runtime.enable' }));
    const ev = (expression) => new Promise((resolve) => {
      pending.set(++id, (r) => resolve(r && r.result ? (r.result.value !== undefined ? r.result.value : r.result.description) : r));
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    // A protocol command as it is, and what it answers (undefined for an error).
    const send = (method, params = {}) => new Promise((resolve) => {
      pending.set(++id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
    if (opts.init) {
      await send('Page.enable');
      await send('Page.addScriptToEvaluateOnNewDocument', { source: opts.init });
      await send('Page.navigate', { url });
    }
    let title = '';
    let up = false;
    for (let i = 0; i < 900; i++) {
      title = await ev('document.title');
      up = opts.ready ? (await ev(opts.ready)) === true : title === 'GAME_DONE';
      if (up || String(title).startsWith('GAME_FAIL')) break;
      await sleep(500);
    }
    if (!up) throw new Error(`page: ${title}`);
    return {
      logs,
      pid: chrome.pid,
      send,
      run: async (body) => {
        const out = await ev(`(async () => { const g = game; ${body} })().then((v) => JSON.stringify(v), (e) => JSON.stringify({ error: e.message + ' ' + (e.stack || '').slice(0, 400) }))`);
        try {
          return JSON.parse(out);
        } catch {
          throw new Error(`the page answered ${String(out).slice(0, 300)}`);
        }
      },
      close,
    };
  } catch (e) {
    close();
    throw e;
  }
}

// In the page: what is held in textures and render targets, in megabytes: the ones
// the frames drew with (bound), those in the scene's materials, and those kept on
// the game's objects a few levels down (the passes after the scene, the sky's
// light), still on the GPU (three.js listens for a dispose while it holds one), by
// width x height x bytes a pixel, x 1.33 with mipmaps.
function textureEstimate(g, bound) {
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
  return { textures: +(bytes.textures / MB).toFixed(1), targets: +(bytes.targets / MB).toFixed(1),
    total: +((bytes.textures + bytes.targets) / MB).toFixed(1), counted: nTex, renderTargets: nRT };
}

// In the page: the drive, timed. Returns each step's milliseconds, how many
// tiles it built, the parts' totals, the counts on the GPU over the last
// 10 s, and what is held at the end.
const DRIVE_BODY = `
  ${textureEstimate.toString()}
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

  const textureMB = textureEstimate(g, bound);
  return {
    ms, tiles, parts, samples, from, turned, roadAudit: g.roadMesh.audit(),
    memory: { geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs ? r.info.programs.length : null },
    textureMB,
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

// --- the soak ----------------------------------------------------------------

// The walk: seconds of game time, how often it is counted (s), how often a frame
// is drawn (steps), how often the style changes (s) and in what order, how soon
// a next world may be asked for after the last (s), the length of a world (m) and
// the autopilot's cap (m/s); the frames a style change draws (steps after it);
// then, at the place the road begins, before the walk: steps to stand still, steps
// in each style and how many turns through the seven, the tiers and the sizes the
// scene is drawn at (the share of the canvas) gone down and up (twice), and steps in each.
const SOAK = {
  seconds: 600, every: 30, frame: 120, styleEvery: 40, turnEvery: 90, worldLen: 800, vMax: 50,
  styles: ['paint', 'ink', 'cel', 'print', 'pixel', 'block', 'real'],
  burst: [1, 24, 48, 72, 90],
  still: 120, lap: 150, laps: 3, tiers: ['mid', 'low', 'high'], scales: [0.85, 0.72, 0.6, 0.5, 0.6, 0.72, 0.85, 1], hold: 100,
};
// The limits: the share of the most geometries that their spread may be (told), the
// MB of heap that ten minutes may add, the MB of textures over the drives' own, what
// the end of a turn at the place the road begins may have more than the one before
// (geometries, GL buffers, GL vertex arrays, MB of heap), and how many more geometry
// objects may be alive and in no scene than in the first five minutes.
const SOAK_LIMITS = { spread: 0.1, heapMB: 25, texturesMB: 96, geometries: 4, buffers: 24, arrays: 8, lapHeapMB: 5, kept: 8 };
// The classes whose objects are counted alive (Runtime.queryObjects).
const SOAK_CLASSES = ['Object3D', 'Mesh', 'BufferGeometry', 'BufferAttribute', 'Material', 'Texture', 'WebGLRenderTarget'];

// In the page, before any of its own code runs: how many GL objects of each kind
// are made and how many deleted, and what the buffers hold in bytes. Only
// numbers are kept (a WeakSet to see that an object is deleted once), so that
// a leaked object is as free to be collected as it was and the count is of what
// three.js did, not of what the collector has since. Read from window.__gl.
function glInit() {
  const proto = typeof WebGL2RenderingContext !== 'undefined' ? WebGL2RenderingContext.prototype : null;
  if (!proto) return;
  // hist: how many buffers there are of each size in bytes, to tell what a growing count is.
  const q = { made: {}, freed: {}, bytes: 0, hist: new Map(), up: { calls: 0, bytes: 0 }, sub: { calls: 0, bytes: 0 } };
  const dead = new WeakSet();
  const sizes = new WeakMap();
  const tally = (n, d) => {
    if (n) q.hist.set(n, (q.hist.get(n) || 0) + d);
  };
  for (const kind of ['Buffer', 'Texture', 'Framebuffer', 'Renderbuffer', 'VertexArray', 'Program', 'Shader', 'Sampler', 'Query']) {
    const make = proto['create' + kind];
    const drop = proto['delete' + kind];
    if (typeof make !== 'function' || typeof drop !== 'function') continue;
    q.made[kind] = 0;
    q.freed[kind] = 0;
    proto['create' + kind] = function () {
      const o = make.apply(this, arguments);
      if (o) q.made[kind]++;
      return o;
    };
    proto['delete' + kind] = function (o) {
      if (o && !dead.has(o)) {
        dead.add(o);
        q.freed[kind]++;
        if (kind === 'Buffer') {
          const had = sizes.get(o) || 0;
          q.bytes -= had;
          tally(had, -1);
          sizes.delete(o);
        }
      }
      return drop.apply(this, arguments);
    };
  }
  const bound = {};
  const bind = proto.bindBuffer;
  proto.bindBuffer = function (target, buffer) {
    bound[target] = buffer;
    return bind.apply(this, arguments);
  };
  const data = proto.bufferData;
  proto.bufferData = function (target, source) {
    const n = typeof source === 'number' ? source : (source && source.byteLength) || 0;
    const b = bound[target];
    if (b) {
      const had = sizes.get(b) || 0;
      q.bytes += n - had;
      tally(had, -1);
      tally(n, 1);
      sizes.set(b, n);
    }
    q.up.calls++;
    q.up.bytes += n;
    return data.apply(this, arguments);
  };
  const sub = proto.bufferSubData;
  proto.bufferSubData = function (target, offset, source) {
    q.sub.calls++;
    q.sub.bytes += (source && source.byteLength) || 0;
    return sub.apply(this, arguments);
  };
  window.__gl = q;
}

// In the page: the walk, set up once and then stepped from outside, a stretch at a
// time (window.__soak.advance), with what is held counted between the stretches
// (pre, then sample). Returns what the page has to count with.
async function soakSetup(g, cfg) {
  const THREE = await import('three');
  const r = g.renderer;
  const gl = r.getContext();
  const MB = 1024 * 1024;
  const burst = new Set(cfg.burst);
  const S = {
    cfg, step: 0, frames: 0, styleStep: -1e9, styleNo: 0, lastTurn: 10 - cfg.turnEvery, turns: 0, walk0: null,
    path: [], styleLog: [], turnLog: [], heapMin: Infinity, maxSpeed: 0, hudError: null,
  };
  window.__soak = S;
  // The lens does not shake, whose shake goes by the clock of the wall: the counts are the same from run to run.
  g.chase.shaking = false;
  g.pilot.vMax = 0;

  // The geometries taken off the scene and not disposed of: those in it now and
  // those first drawn from here on (three.js listens for a geometry's dispose when
  // it first draws it), until disposed of (as in the drives).
  // And the instanced meshes drawn from here on (three.js listens for the mesh's dispose when it first
  // draws it), against those disposed of: what a mesh holds on the GPU (its matrices and colours) goes with
  // the mesh, and a mesh taken off the scene whose geometry only was disposed of holds it for good.
  const live = new Set();
  g.scene.traverse((o) => { if (o.geometry) live.add(o.geometry); });
  let drawnInstanced = 0;
  let disposedInstanced = 0;
  const listen = THREE.EventDispatcher.prototype.addEventListener;
  THREE.EventDispatcher.prototype.addEventListener = function (type, fn) {
    if (type === 'dispose') {
      if (this.isBufferGeometry) live.add(this);
      else if (this.isInstancedMesh && !this.__drawn) {
        this.__drawn = true;
        drawnInstanced++;
      }
    }
    return listen.call(this, type, fn);
  };
  const dispose = THREE.BufferGeometry.prototype.dispose;
  THREE.BufferGeometry.prototype.dispose = function () {
    live.delete(this);
    return dispose.call(this);
  };
  const disposeInstanced = THREE.InstancedMesh.prototype.dispose;
  THREE.InstancedMesh.prototype.dispose = function () {
    if (this.__drawn && !this.__gone) {
      this.__gone = true;
      disposedInstanced++;
    }
    return disposeInstanced.call(this);
  };
  const orphans = () => {
    const used = new Set();
    g.scene.traverse((o) => { if (o.geometry) used.add(o.geometry); });
    let n = 0;
    for (const geo of live) if (!used.has(geo)) n++;
    return n;
  };
  // Instanced meshes drawn and not disposed of that are not in the scene.
  const lostInstanced = () => {
    let held = 0;
    g.scene.traverse((o) => { if (o.isInstancedMesh && o.__drawn && !o.__gone) held++; });
    return drawnInstanced - disposedInstanced - held;
  };

  // A frame, and a read of one pixel to have the GPU finish it before going on.
  const px = new Uint8Array(4);
  const draw = () => {
    g.render(1 / 60);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    S.frames++;
    try {
      if (window.ui && window.ui.hud) window.ui.hud.update(2);
    } catch (e) {
      S.hudError = String(e && e.message);
    }
  };

  // Where the car is among the worlds, noted when it changes.
  const noteWorld = () => {
    const id = g.worldHere().id;
    const last = S.path[S.path.length - 1];
    if (!last || last.id !== id) S.path.push({ t: +((S.step - (S.walk0 === null ? 0 : S.walk0)) / 60).toFixed(1), id, s: Math.round(g.sCar) });
  };

  // The next world may be asked for when the one asked for last is under the car's
  // wheels (its blend has begun): asked for before that, the one asked for would
  // be taken out for it and a world would be left out. Where the car is on the
  // road, and so the progress the game works from, is as the game reads it.
  const mayAsk = () => {
    const o = g.road.origin;
    const here = g.worlds.u(g.car.x + o.x, g.car.z + o.z);
    const segs = g.worlds.segs;
    for (let i = segs.length - 1; i >= 0; i--) {
      if (segs[i].asked) return here > segs[i].u - segs[i].blend;
    }
    return true;
  };

  // The lane ahead is cleared of the cars that drive the way the car does (it
  // would follow the slowest of them, as the autopilot keeps a gap): the walk is
  // the road's own speed.
  const clearAhead = () => {
    const cars = g.traffic.cars;
    const s0 = g.sCar;
    if (cars.some((c) => c.dir > 0 && c.s > s0 && c.s < s0 + 450)) g.traffic.cars = cars.filter((c) => !(c.dir > 0 && c.s > s0 && c.s < s0 + 450));
  };

  // What happens at a whole second of the walk: the style changes, the lane ahead
  // is cleared, and the next world is asked for.
  const events = (second) => {
    if (S.walk0 === null) return;
    if (second > 0 && second < cfg.seconds && second % cfg.styleEvery === 0) {
      const id = cfg.styles[S.styleNo % cfg.styles.length];
      S.styleNo++;
      if (g.setStyle(id)) {
        S.styleStep = S.step;
        S.styleLog.push({ t: second, id });
      }
    }
    clearAhead();
    if (second - S.lastTurn >= cfg.turnEvery && mayAsk() && g.nextWorld()) {
      S.lastTurn = second;
      S.turns++;
      S.turnLog.push({ t: second, s: Math.round(g.sCar) });
    }
  };

  // n steps of 1/60 s: Game.update alone, and a frame every cfg.frame steps and
  // at the steps after a style change that cfg.burst names.
  S.advance = (n) => {
    const t0 = performance.now();
    const f0 = S.frames;
    for (let i = 0; i < n; i++) {
      const k = S.step;
      const since = S.walk0 === null ? k : k - S.walk0;
      if (since % 60 === 0) {
        events(S.walk0 === null ? 0 : since / 60);
        noteWorld();
      }
      g.update(1 / 60);
      S.step = k + 1;
      if (S.step % cfg.frame === 0 || burst.has(S.step - S.styleStep)) draw();
      if (S.step % 120 === 0) {
        const m = performance.memory;
        if (m && m.usedJSHeapSize < S.heapMin) S.heapMin = m.usedJSHeapSize;
        if (g.car.speed > S.maxSpeed) S.maxSpeed = g.car.speed;
      }
    }
    return { wall: Math.round(performance.now() - t0), steps: n, frames: S.frames - f0, step: S.step };
  };

  // The stretch at the place the road begins: the car stands still while a style, a
  // tier or a size is changed and a few frames are drawn (the same frames as after
  // a style change). Then the walk begins: the car is let go and the time is counted
  // from there.
  S.hold = (n) => S.advance(n);
  S.restyle = (id, n) => {
    g.setStyle(id);
    S.styleStep = S.step;
    return S.advance(n);
  };
  S.retier = (tier, n) => {
    g.pinTier(tier);
    S.styleStep = S.step;
    return S.advance(n);
  };
  S.rescale = (k, n) => {
    g.setRenderScale(k);
    S.styleStep = S.step;
    return S.advance(n);
  };
  S.begin = () => {
    S.walk0 = S.step;
    S.path.length = 0;
    S.maxSpeed = 0;
    g.pilot.vMax = cfg.vMax;
    return { step: S.step };
  };

  // The heap after a collection (two, with the finalizers between), before
  // anything is drawn for the count.
  S.pre = async () => {
    const wait = () => new Promise((res) => setTimeout(res, 20));
    const collected = typeof gc === 'function';
    if (collected) {
      gc();
      await wait();
      gc();
      await wait();
    }
    const m = performance.memory;
    const out = {
      gc: collected,
      used: m ? m.usedJSHeapSize : null, total: m ? m.totalJSHeapSize : null,
      min: S.heapMin === Infinity ? null : S.heapMin,
    };
    S.heapMin = Infinity;
    return out;
  };

  // What is held now: a frame is drawn with the textures and targets it binds
  // looked at, then everything is counted.
  S.sample = () => {
    const bound = new Set();
    const get = r.properties.get;
    r.properties.get = function (o) {
      if (o && (o.isTexture || o.isWebGLRenderTarget)) bound.add(o);
      return get.call(this, o);
    };
    try {
      draw();
    } finally {
      r.properties.get = get;
    }
    const tex = textureEstimate(g, bound);
    const scene = { objects: 0, meshes: 0, instanced: 0, hidden: 0, geometries: 0 };
    const geometries = new Set();
    g.scene.traverse((o) => {
      scene.objects++;
      if (o.isMesh) scene.meshes++;
      if (o.isInstancedMesh) scene.instanced++;
      if (!o.visible) scene.hidden++;
      if (o.geometry) geometries.add(o.geometry);
    });
    scene.geometries = geometries.size;
    const counts = {};
    const put = (key, fn) => {
      try {
        counts[key] = fn();
      } catch {
        counts[key] = null;
      }
    };
    put('terrainTiles', () => g.terrain.tiles.size);
    put('terrainStale', () => g.terrain.stale.size);
    put('forestTiles', () => g.forest.tiles.size);
    put('trees', () => g.forest.trees);
    put('cityTiles', () => g.city.tiles.size);
    put('cityLots', () => g.city.lots.size);
    put('roadSamples', () => g.road.samples.size);
    put('roadChunks', () => g.roadMesh.chunks.size);
    put('roadSpans', () => g.roadMesh.spans.size);
    put('roadParts', () => {
      let n = 0;
      for (const chunk of g.roadMesh.chunks.values()) for (const part of Object.values(chunk.parts)) if (part) n++;
      return n;
    });
    put('lamps', () => g.roadMesh.lampList.length);
    put('piers', () => g.roadMesh.pierList.length);
    put('portals', () => g.roadMesh.portalList.length);
    put('clutterCells', () => g.clutter.cells.size);
    put('clutterMeshes', () => g.clutter.meshes.size);
    put('propCells', () => g.props.cells.size);
    put('trafficCars', () => g.traffic.cars.length);
    put('trafficMeshes', () => g.traffic.meshes.size);
    put('worldSegs', () => g.worlds.segs.length);
    put('envBakes', () => g.atmosphere.bakes || 0);
    put('cloudBakes', () => g.atmosphere.clouds.bakes);
    // The grass's map and meshes, which stay where they are when the style is another one.
    const grass = {};
    try {
      const gr = g.grass;
      grass.painted = !!gr.active;
      grass.mapPx = gr.rt ? gr.rtSize : 0;
      grass.mapMB = gr.rt ? +(gr.rtSize * gr.rtSize * (8 + 4) / MB).toFixed(2) : 0;
      grass.meshMB = +(gr.stats.bytes / MB).toFixed(2);
    } catch {
      grass.error = true;
    }
    // The two cubes the baked clouds are drawn into.
    const clouds = {};
    try {
      const c = g.atmosphere.clouds;
      clouds.faces = c.cubes.map((cube) => (cube ? cube.width : 0));
      const bytes = c.cubes.reduce((a, cube) => a + (cube ? cube.width * cube.width * 4 * 6 : 0), 0);
      clouds.MB = +(bytes / MB).toFixed(1);
      clouds.set = c.set;
    } catch {
      clouds.error = true;
    }
    let gls = null;
    const q = window.__gl;
    if (q) {
      const liveGl = {};
      for (const k of Object.keys(q.made)) liveGl[k] = q.made[k] - q.freed[k];
      gls = {
        live: liveGl, bufferMB: +(q.bytes / MB).toFixed(1),
        sizes: [...q.hist].filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0]),
        uploads: { calls: q.up.calls, MB: +(q.up.bytes / MB).toFixed(0) },
        subUploads: { calls: q.sub.calls, MB: +(q.sub.bytes / MB).toFixed(0) },
      };
    }
    // Each shader program by its material's kind, a hash of its whole key and the
    // end of it, to see which ones are new when there are more of them.
    const hash = (str) => {
      let x = 5381;
      for (let i = 0; i < str.length; i++) x = ((x << 5) + x + str.charCodeAt(i)) | 0;
      return (x >>> 0).toString(36);
    };
    const programKeys = (r.info.programs || []).map((p) => `${p.name} ${hash(String(p.cacheKey))} ${String(p.cacheKey).slice(-44)}`);
    const w = g.worldHere();
    return {
      t: +((S.step - (S.walk0 === null ? 0 : S.walk0)) / 60).toFixed(2), walking: S.walk0 !== null, world: w.id, style: g.style.id, styleT: +g.style.t.toFixed(2),
      s: Math.round(g.sCar), speed: +g.car.speed.toFixed(1), maxSpeed: +S.maxSpeed.toFixed(1),
      geometries: r.info.memory.geometries, textures: r.info.memory.textures,
      programs: r.info.programs ? r.info.programs.length : null,
      orphans: orphans(), instancedLost: lostInstanced(), textureMB: tex, scene, counts, grass, clouds, gl: gls, programKeys,
      turns: g.turns || 0, cuts: g.road.cuts, rebases: g.road.rebases, wrecks: g.wrecks, frames: S.frames,
    };
  };

  return {
    gc: typeof gc === 'function', memory: !!performance.memory, gl: !!window.__gl,
    vMax: g.pilot.vMax, world: g.worldHere().id, style: g.style.id, isolated: self.crossOriginIsolated,
  };
}

// The processes of the browser started, as the system sees them: resident
// megabytes of the browser itself, its renderer, its GPU process and the rest.
function rssOf(pid) {
  try {
    const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss=,command='], { encoding: 'utf8', maxBuffer: 1 << 26 });
    const rows = [];
    for (const line of out.split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
      if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), kb: Number(m[3]), cmd: m[4] });
    }
    const mine = new Set([pid]);
    for (let grew = true; grew;) {
      grew = false;
      for (const p of rows) {
        if (!mine.has(p.pid) && mine.has(p.ppid)) {
          mine.add(p.pid);
          grew = true;
        }
      }
    }
    const kb = { browser: 0, renderer: 0, gpu: 0, other: 0 };
    for (const p of rows) {
      if (!mine.has(p.pid)) continue;
      const kind = p.pid === pid ? 'browser' : /--type=renderer/.test(p.cmd) ? 'renderer' : /--type=gpu/.test(p.cmd) ? 'gpu' : 'other';
      kb[kind] += p.kb;
    }
    const mb = (v) => Math.round(v / 1024);
    return { browser: mb(kb.browser), renderer: mb(kb.renderer), gpu: mb(kb.gpu), other: mb(kb.other), total: mb(kb.browser + kb.renderer + kb.gpu + kb.other) };
  } catch {
    return null;
  }
}

// How many objects of each class are alive in the page (after a collection the
// protocol makes itself): the prototype of the class asked for, then the objects
// that have it. Null for a class that cannot be counted.
async function aliveCounts(page, names) {
  const out = {};
  for (const name of names) {
    out[name] = null;
    try {
      const proto = await page.send('Runtime.evaluate', { expression: `import('three').then((T) => T.${name}.prototype)`, awaitPromise: true });
      const id = proto && proto.result && proto.result.objectId;
      if (!id) continue;
      const found = await page.send('Runtime.queryObjects', { prototypeObjectId: id });
      const m = found && found.objects && /\((\d+)\)/.exec(found.objects.description || '');
      if (m) out[name] = Number(m[1]);
      if (found && found.objects && found.objects.objectId) await page.send('Runtime.releaseObject', { objectId: found.objects.objectId });
      await page.send('Runtime.releaseObject', { objectId: id });
    } catch { /* this class is left uncounted */ }
  }
  return out;
}

// A file at out/perf-soak.pause holds the walk where it is: what is under way is
// finished (a stretch and its count) and nothing new is begun until the file is
// gone, for the machine to be quiet for something else.
const PAUSE = ROOT + 'out/perf-soak.pause';
async function pausedWhile() {
  let said = false;
  while (existsSync(PAUSE)) {
    if (!said) console.log(`        paused: the walk goes on when ${PAUSE} is gone`);
    said = true;
    await sleep(3000);
  }
  if (said) console.log('        going on');
}

// What grew between two counts of the buffers by size: [bytes, how many more].
function growthBySize(a, b, top = 4) {
  const had = new Map(((a && a.gl && a.gl.sizes) || []));
  const out = [];
  for (const [bytes, n] of (b && b.gl && b.gl.sizes) || []) {
    const d = n - (had.get(bytes) || 0);
    if (d > 0) out.push([bytes, d]);
  }
  return out.sort((x, y) => y[1] * y[0] - x[1] * x[0]).slice(0, top);
}

const withTimeout = (promise, ms, what) => Promise.race([promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} took more than ${Math.round(ms / 60000)} minutes`)), ms))]);

// The walk itself, from outside: set up, then stretches of cfg.every seconds each
// followed by a count, then the stretch at one place. Returns what was counted.
async function soakRun(cfg, save) {
  const query = `seed=${SEED}&worldlen=${cfg.worldLen}${cfg.loop ? `&loop=${cfg.loop}` : ''}&run=60`;
  const page = await openPage(query, { init: `(${glInit.toString()})();`, flags: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const run = { seed: SEED, walk: cfg, started: new Date().toISOString(), start: null, samples: [], laps: [], tiers: null, scales: null, notes: [] };
  const wait = 25 * 60e3;
  const call = async (body, what = body, hold = true) => {
    if (hold) await pausedWhile();
    const out = await withTimeout(page.run(body), wait, what);
    if (out && out.error) throw new Error(`${what}: ${out.error}`);
    return out;
  };
  // What is held now, counted: after a collection, the heap and what is behind it, the
  // objects alive by class, a frame and the page's own counts, and the processes' size.
  const take = async () => {
    const pre = await call('return __soak.pre();', 'counting (the heap)', false);
    const usage = await page.send('Runtime.getHeapUsage');
    const dom = await page.send('Memory.getDOMCounters');
    const alive = await aliveCounts(page, SOAK_CLASSES);
    const s = await call('return __soak.sample();', 'counting', false);
    const mb = (v) => (typeof v === 'number' ? Math.round((v / 1048576) * 10) / 10 : null);
    s.heap = { gc: pre.gc, usedMB: mb(pre.used), totalMB: mb(pre.total), minMB: mb(pre.min),
      backingMB: mb(usage && usage.backingStorageSize), embedderMB: mb(usage && usage.embedderHeapUsedSize) };
    s.dom = dom ? { nodes: dom.nodes, listeners: dom.jsEventListeners, documents: dom.documents } : null;
    s.alive = alive;
    s.rssMB = rssOf(page.pid);
    return s;
  };
  try {
    const set = await call(`${textureEstimate.toString()}\nreturn (${soakSetup.toString()})(g, ${JSON.stringify(cfg)});`, 'setting the walk up');
    run.page = set;
    run.notes.push(`the page: ${JSON.stringify(set)}`);
    if (!set.gc) run.notes.push('no gc() in the page: the heap is the lowest of the readings in each stretch');
    console.log(soakHead());
    // The programs a count has that the one before did not.
    const fresh = (s, before) => {
      const had = new Map();
      for (const k of before.programKeys || []) had.set(k, (had.get(k) || 0) + 1);
      const out = [];
      for (const k of s.programKeys || []) {
        if (had.get(k)) had.set(k, had.get(k) - 1);
        else out.push(k);
      }
      return out;
    };
    const note = (s, before, extra = '') => {
      const added = fresh(s, before);
      console.log(soakRow(s, null));
      if (added.length) console.log(`        ${added.length} new shader program(s): ${added.slice(0, 4).join(' | ')}${added.length > 4 ? ' ...' : ''}`);
      const grew = s.gl && before.gl && s.gl.live.Buffer > before.gl.live.Buffer ? growthBySize(before, s) : [];
      if (grew.length && extra !== 'quiet') console.log(`        GL buffers by size, more: ${grew.map(([b, n]) => `${n} of ${b} B`).join(', ')}`);
    };
    const first = await take();
    first.label = 'the road begins';
    run.start = first;
    console.log(soakRow(first, null));
    let before = first;
    const mark = async (label) => {
      const s = await take();
      s.label = label;
      note(s, before);
      before = s;
      save(run);
      return s;
    };
    if (!cfg.noPlace) {
      // At the place the road begins, the car standing still: the seven styles gone
      // through three times, and the tiers and the sizes down and up twice.
      await call(`return __soak.hold(${cfg.still});`, 'standing still');
      for (let lap = 1; lap <= cfg.laps; lap++) {
        for (const id of cfg.styles) await call(`return __soak.restyle(${JSON.stringify(id)}, ${cfg.lap});`, `turn ${lap}, ${id}`);
        run.laps.push(await mark(`styles, turn ${lap}`));
      }
      await call(`return __soak.restyle("paint", ${cfg.lap});`, 'the tiers: the painted style');
      const tiers = { base: await mark('tiers, high') };
      for (let k = 1; k <= 2; k++) {
        for (const tier of [...cfg.tiers, 'high']) await call(`return __soak.retier(${JSON.stringify(tier)}, ${cfg.hold});`, `tier ${tier}`);
        tiers[`end${k}`] = await mark(`tiers, turn ${k}`);
      }
      run.tiers = tiers;
      const scales = { base: tiers.end2 };
      for (let k = 1; k <= 2; k++) {
        for (const size of cfg.scales) await call(`return __soak.rescale(${size}, ${cfg.hold});`, `size ${size}`);
        scales[`end${k}`] = await mark(`size, turn ${k}`);
      }
      run.scales = scales;
      await call(`return __soak.restyle("real", ${cfg.lap});`, 'back to the real style');
    }
    // The walk.
    await call('return __soak.begin();', 'letting the car go');
    const zero = await mark('the walk begins');
    run.samples.push(zero);
    const steps = Math.round(cfg.every * 60);
    for (let t = cfg.every; t <= cfg.seconds + 1e-6; t += cfg.every) {
      const adv = await call(`return __soak.advance(${steps});`, `the walk at ${t - cfg.every} s`);
      const s = await take();
      const added = fresh(s, run.samples[run.samples.length - 1]);
      run.samples.push(s);
      console.log(soakRow(s, adv));
      if (added.length) console.log(`        ${added.length} new shader program(s): ${added.slice(0, 4).join(' | ')}${added.length > 4 ? ' ...' : ''}`);
      save(run);
    }
    run.walkEnd = await call('return { path: __soak.path, styleLog: __soak.styleLog, turnLog: __soak.turnLog, frames: __soak.frames, hudError: __soak.hudError };', 'reading the walk');
    run.logs = page.logs.slice(0, 5);
    run.finished = new Date().toISOString();
    save(run);
    return run;
  } catch (e) {
    run.error = String(e && e.message || e);
    run.logs = page.logs.slice(0, 5);
    save(run);
    throw e;
  } finally {
    page.close();
  }
}

const soakHead = () => '   t(s) world   style  dist(m)  geometries orph  tex prog   heap MB (behind)  tex est  GL buf vao  scene objs  rss MB   wall';
function soakRow(s, adv) {
  const heap = s.heap ? `${String(s.heap.gc ? s.heap.usedMB : s.heap.minMB).padStart(7)} (${String(s.heap.backingMB).padStart(5)})` : '';
  const gl = s.gl ? `${String(s.gl.live.Buffer).padStart(6)} ${String(s.gl.live.VertexArray).padStart(4)}` : '     -    -';
  return `${String(Math.round(s.t)).padStart(7)} ${String(s.world).padEnd(8)} ${String(s.style).padEnd(6)} ${String(s.s).padStart(6)}`
    + `  ${String(s.geometries).padStart(10)} ${String(s.orphans).padStart(4)} ${String(s.textures).padStart(4)} ${String(s.programs).padStart(4)}`
    + `  ${heap}  ${String(s.textureMB.total).padStart(7)}  ${gl}  ${String(s.scene.objects).padStart(10)}  ${String(s.rssMB ? s.rssMB.total : '-').padStart(6)}`
    + `  ${adv ? Math.round(adv.wall / 1000) + ' s' : s.label || ''}`;
}

// The lines the walk is held to, as { hard, ok, text }: a line that is not hard is
// told and not held (what looks at the run, or at what a world brings the first
// time it is in view, not at a leak).
function soakGates(run, baseTexMB, base = null) {
  const lines = [];
  const add = (hard, ok, text) => lines.push({ hard, ok, text });
  const T = run.walk.seconds;
  const timed = run.samples.filter((s) => s.t > 0);
  const first = timed.filter((s) => s.t <= T / 2 + 1e-6);
  const last = timed.filter((s) => s.t > T / 2 + 1e-6);
  const col = (list, f) => list.map(f).filter((v) => typeof v === 'number' && Number.isFinite(v));
  const hi = (a) => (a.length ? Math.max(...a) : NaN);
  const lo = (a) => (a.length ? Math.min(...a) : NaN);
  const r1 = (v) => Math.round(v * 10) / 10;
  const at = (t) => timed.reduce((best, s) => (Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best), timed[0]);
  if (!first.length || !last.length) {
    add(true, false, `the walk has ${timed.length} counts: too few to hold anything to`);
    return lines;
  }
  const from = (T / 2) / 60;
  const to = T / 60;
  const halves = `minutes ${r1(from)}-${r1(to)}`;
  const before = `minutes 0-${r1(from)}`;

  // The geometries the renderer holds. What a world has in view, and the style it is
  // drawn in, differ by hundreds (a tree of blocks is a mesh, the far trees of a tile
  // one), so the count goes up and down by them: the spread is told, and what is held
  // is what is not in the scene or has no owner (below).
  const geoF = col(first, (s) => s.geometries);
  const geoL = col(last, (s) => s.geometries);
  add(false, hi(geoL) - lo(geoL) <= SOAK_LIMITS.spread * hi(geoF),
    `geometries held in ${halves}: ${lo(geoL)}..${hi(geoL)} (spread ${hi(geoL) - lo(geoL)}), at most ${SOAK_LIMITS.spread * 100}% of the most in ${before}, ${hi(geoF)}: ${r1(SOAK_LIMITS.spread * hi(geoF))}`);
  add(false, hi(geoL) <= (1 + SOAK_LIMITS.spread) * hi(geoF),
    `the most geometries held in ${halves}: ${hi(geoL)}, at most ${1 + SOAK_LIMITS.spread} times the most in ${before}, ${hi(geoF)}: ${r1((1 + SOAK_LIMITS.spread) * hi(geoF))}`);
  const orphF = hi(col(first, (s) => s.orphans));
  const orphL = hi(col(last, (s) => s.orphans));
  add(true, orphL <= orphF, `geometries off the scene and not disposed of: at most ${orphL} in ${halves}, no more than the ${orphF} in ${before}`);
  // Instanced meshes taken off the scene without a dispose of their own (their matrices and colours stay on the GPU).
  const lost = hi(col(timed.concat(run.laps, run.tiers ? Object.values(run.tiers) : [], run.scales ? Object.values(run.scales) : []), (s) => s.instancedLost));
  if (Number.isFinite(lost)) add(true, lost <= 0, `instanced meshes drawn, off the scene, and not disposed of: at most ${lost} in the whole run, none`);
  // The geometry objects alive that no scene holds and the road is not keeping to join (the shapes
  // the game makes the trees and the passes from): a number that stays where it is.
  const keptOf = (s) => (s.alive && s.alive.BufferGeometry != null && s.scene && s.scene.geometries != null && s.counts && s.counts.roadParts != null
    ? s.alive.BufferGeometry - s.scene.geometries - s.counts.roadParts : null);
  const keptF = hi(col(first, keptOf));
  const keptL = hi(col(last, keptOf));
  if (Number.isFinite(keptF)) add(true, keptL <= keptF + SOAK_LIMITS.kept, `geometry objects alive and in no scene: at most ${keptL} in ${halves}, ${keptF} in ${before} (and ${SOAK_LIMITS.kept} more is allowed)`);

  // The textures and the programs: what is new is told, by the first time a world's
  // own comes into view; what is held is that going through the styles again, at
  // one place, makes no more (below).
  const mid = first[first.length - 1];
  const texL = col(last, (s) => s.textures);
  add(false, hi(texL) <= mid.textures, `textures in ${halves}: at most ${hi(texL)}, no more than the ${mid.textures} at minute ${r1(mid.t / 60)}`);
  const seen = new Set(['real']);
  let all = null;
  for (const c of run.walkEnd ? run.walkEnd.styleLog : []) {
    seen.add(c.id);
    if (!all && seen.size === 7) all = c.t;
  }
  if (all === null) {
    add(true, false, `the seven styles were not all drawn (${[...seen].join(', ')})`);
  } else {
    const ref = timed.find((s) => s.t >= all + 1.4);
    const later = ref ? col(timed.filter((s) => s.t >= ref.t), (s) => s.programs) : [];
    add(false, !!ref && hi(later) <= ref.programs,
      `shader programs from minute ${r1(ref ? ref.t / 60 : NaN)} (the seven styles drawn at ${all} s): at most ${hi(later)}, no more than the ${ref ? ref.programs : NaN} there`);
  }

  // The heap, after a collection. What a world has in view moves it by tens of megabytes (the
  // hills' forest 170 MB, the desert 105), so ten minutes in against three says little (told);
  // what is held is the same world, the second time the road comes to it, against the first.
  const heapOf = (s) => (s.heap && s.heap.gc ? s.heap.usedMB : s.heap && s.heap.minMB);
  const h3 = at(T * 0.3);
  const h10 = at(T);
  const visits = [];
  for (const s of timed) {
    const v = visits[visits.length - 1];
    if (v && v.world === s.world) v.samples.push(s);
    else visits.push({ world: s.world, samples: [s] });
  }
  const twice = [];
  for (const world of new Set(visits.map((v) => v.world))) {
    const mine = visits.filter((v) => v.world === world);
    if (mine.length >= 2) twice.push({ world, first: mine[0], later: mine[mine.length - 1] });
  }
  // (with no world twice on the road, the minutes are all there is to hold it to)
  add(!twice.length, heapOf(h10) - heapOf(h3) <= SOAK_LIMITS.heapMB,
    `JS heap${h10.heap && h10.heap.gc ? ' after a collection' : ' (lowest reading)'}: ${heapOf(h3)} MB at minute ${r1(h3.t / 60)}, ${heapOf(h10)} MB at minute ${r1(h10.t / 60)}: ${r1(heapOf(h10) - heapOf(h3))} MB more, at most ${SOAK_LIMITS.heapMB}`);
  const over = (visit, f) => hi(col(visit.samples, f));
  const again = (what, f, allowed, hard, unit = '') => {
    for (const w of twice) {
      const a = over(w.first, f);
      const b = over(w.later, f);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        add(hard, b <= allowed(a), `${what}, ${w.world} the second time (minute ${r1(w.later.samples[0].t / 60)}) against the first (minute ${r1(w.first.samples[0].t / 60)}): ${b}${unit} against ${a}${unit}, at most ${r1(allowed(a))}${unit}`);
      }
    }
  };
  again('JS heap', heapOf, (a) => a + SOAK_LIMITS.heapMB, true, ' MB');
  again('typed arrays\' memory behind the heap', (s) => s.heap && s.heap.backingMB, (a) => a + SOAK_LIMITS.heapMB, true, ' MB');
  again('bytes the GPU holds in buffers', (s) => s.gl && s.gl.bufferMB, (a) => a * 1.25 + 8, true, ' MB');
  again('geometries held', (s) => s.geometries, (a) => a * 1.35 + 20, false);
  again('GL buffers made and not deleted', (s) => s.gl && s.gl.live.Buffer, (a) => a * 1.35 + 100, false);

  // The estimate of the textures and render targets, against the drives' own.
  const est = hi(col(timed.concat(run.laps, run.tiers ? Object.values(run.tiers) : [], run.scales ? Object.values(run.scales) : []), (s) => s.textureMB.total));
  add(true, est <= baseTexMB + SOAK_LIMITS.texturesMB,
    `textures and render targets, estimated: at most ${est} MB, the drives' ${baseTexMB} MB and ${SOAK_LIMITS.texturesMB} more: ${r1(baseTexMB + SOAK_LIMITS.texturesMB)}`);

  // What is held on the GPU, by object, and in the processes.
  for (const [kind, label] of [['Buffer', 'buffers'], ['VertexArray', 'vertex arrays'], ['Texture', 'textures'], ['Framebuffer', 'framebuffers'], ['Renderbuffer', 'renderbuffers']]) {
    const a = hi(col(first, (s) => s.gl && s.gl.live[kind]));
    const b = hi(col(last, (s) => s.gl && s.gl.live[kind]));
    if (Number.isFinite(a)) add(false, b <= a * (1 + SOAK_LIMITS.spread) + 8, `GL ${label} made and not deleted: at most ${b} in ${halves}, ${a} in ${before}`);
  }
  const rssF = hi(col(first, (s) => s.rssMB && s.rssMB.total));
  const rssL = hi(col(last, (s) => s.rssMB && s.rssMB.total));
  if (Number.isFinite(rssF)) add(false, rssL <= rssF * 1.1, `the browser's processes: at most ${rssL} MB in ${halves}, ${rssF} MB in ${before}`);
  const domF = hi(col(first, (s) => s.dom && s.dom.listeners));
  const domL = hi(col(last, (s) => s.dom && s.dom.listeners));
  if (Number.isFinite(domF)) add(false, domL <= domF + 20, `event listeners: at most ${domL} in ${halves}, ${domF} in ${before}`);
  for (const name of SOAK_CLASSES) {
    const a = hi(col(first, (s) => s.alive && s.alive[name]));
    const b = hi(col(last, (s) => s.alive && s.alive[name]));
    if (Number.isFinite(a)) add(false, b <= a * (1 + SOAK_LIMITS.spread), `${name} alive: at most ${b} in ${halves}, ${a} in ${before}`);
  }

  // Against the baseline (the same walk, so the same counts, give or take what the machine's
  // timing moves): what the walk holds on the GPU and in the heap, count by count.
  const sameWalk = base && base.walk && ['seconds', 'every', 'worldLen', 'vMax', 'styleEvery', 'turnEvery', 'frame'].every((k) => base.walk[k] === run.walk[k]) && (base.walk.loop || '') === (run.walk.loop || '');
  if (base && !sameWalk) add(false, false, 'the walk is not the baseline\'s (seconds, counts, world length, speed, style or turn every): not held to its counts');
  if (sameWalk) {
    const baseOf = new Map(base.samples.map((b) => [Math.round(b.t), b]));
    const worst = (f, allowed) => {
      let at = null;
      for (const x of timed) {
        const b = baseOf.get(Math.round(x.t));
        const v = f(x);
        const w = b && f(b);
        if (typeof v === 'number' && typeof w === 'number' && v - allowed(w) > (at ? at.over : -Infinity)) at = { t: x.t, v, w, over: v - allowed(w), limit: allowed(w) };
      }
      return at;
    };
    const held = (what, f, allowed, hard, unit = '') => {
      const w = worst(f, allowed);
      if (w) add(hard, w.over <= 0, `${what} against the baseline, the count furthest over it (minute ${r1(w.t / 60)}): ${w.v}${unit}, the baseline's ${w.w}${unit}, at most ${r1(w.limit)}${unit}`);
    };
    held('GL buffers made and not deleted', (x) => (x.gl ? x.gl.live.Buffer : x.buffers), (b) => b * 1.1 + 60, true);
    held('bytes the GPU holds in buffers', (x) => (x.gl ? x.gl.bufferMB : x.bufferMB), (b) => b * 1.1 + 8, true, ' MB');
    held('JS heap', (x) => (x.heapMB !== undefined ? x.heapMB : heapOf(x)), (b) => b + SOAK_LIMITS.heapMB, true, ' MB');
    held('geometries held', (x) => x.geometries, (b) => b * 1.15 + 40, false);
  }

  // The walk itself: what it went through.
  const visited = new Set([...(run.walkEnd ? run.walkEnd.path : []).map((p) => p.id), ...timed.map((s) => s.world)]);
  add(false, visited.size === WORLDS.length, `worlds driven through: ${visited.size} of ${WORLDS.length} (${[...visited].join(', ')}), ${run.walkEnd ? run.walkEnd.path.length : 0} changes of world, ${run.walkEnd ? run.walkEnd.turnLog.length : 0} asked for`);
  const lastSample = last[last.length - 1];
  add(false, lastSample.wrecks === 0, `wrecks: ${lastSample.wrecks}, the car at ${lastSample.s} m, ${lastSample.rebases} times the origin moved`);

  // At the place the road begins, a turn against the one before, with the car standing
  // still: what was made and not let go would show as more of it each time.
  const pair = (a, b, what, hard = true) => {
    if (!a || !b) return;
    const gl = (s, k) => (s.gl ? s.gl.live[k] : null);
    add(hard, b.textures <= a.textures, `${what}: textures ${b.textures}, no more than ${a.textures}`);
    add(hard, b.programs <= a.programs, `${what}: shader programs ${b.programs}, no more than ${a.programs}`);
    add(hard, b.orphans <= a.orphans, `${what}: geometries off the scene and not disposed of ${b.orphans}, no more than ${a.orphans}`);
    add(hard, b.geometries <= a.geometries + SOAK_LIMITS.geometries, `${what}: geometries ${b.geometries}, at most ${a.geometries + SOAK_LIMITS.geometries}`);
    for (const [kind, label, tol] of [['Buffer', 'buffers', SOAK_LIMITS.buffers], ['VertexArray', 'vertex arrays', SOAK_LIMITS.arrays], ['Texture', 'textures', 0], ['Framebuffer', 'framebuffers', 0], ['Renderbuffer', 'renderbuffers', 0]]) {
      if (typeof gl(a, kind) === 'number' && typeof gl(b, kind) === 'number') add(hard, gl(b, kind) <= gl(a, kind) + tol, `${what}: GL ${label} ${gl(b, kind)}, at most ${gl(a, kind) + tol}`);
    }
    const ha = heapOf(a);
    const hb = heapOf(b);
    if (typeof ha === 'number' && typeof hb === 'number') add(false, hb - ha <= SOAK_LIMITS.lapHeapMB, `${what}: JS heap ${hb} MB, ${r1(hb - ha)} MB more than ${ha} MB, at most ${SOAK_LIMITS.lapHeapMB}`);
  };
  if (run.laps.length >= 2) pair(run.laps[run.laps.length - 2], run.laps[run.laps.length - 1], `at the place the road begins, the styles, turn ${run.laps.length} against ${run.laps.length - 1}`);
  if (run.tiers) {
    pair(run.tiers.end1, run.tiers.end2, 'at the place the road begins, the tiers, turn 2 against 1');
    pair(run.tiers.base, run.tiers.end1, 'at the place the road begins, the tiers, turn 1 against before', false);
  }
  if (run.scales) {
    pair(run.scales.end1, run.scales.end2, 'at the place the road begins, the size drawn at, turn 2 against 1');
    pair(run.scales.base, run.scales.end1, 'at the place the road begins, the size drawn at, turn 1 against before', false);
  }
  return lines;
}

// What the run is kept as: the counts of each sample (the rest is in out/perf-soak.json).
function soakDigest(s) {
  const gl = s.gl ? s.gl.live : {};
  return {
    t: s.t, world: s.world, style: s.style, s: s.s, geometries: s.geometries, textures: s.textures, programs: s.programs,
    orphans: s.orphans, instancedLost: s.instancedLost, heapMB: s.heap ? (s.heap.gc ? s.heap.usedMB : s.heap.minMB) : null, backingMB: s.heap ? s.heap.backingMB : null,
    textureMB: s.textureMB.total, buffers: gl.Buffer, bufferMB: s.gl ? s.gl.bufferMB : null, vertexArrays: gl.VertexArray, framebuffers: gl.Framebuffer,
    sceneObjects: s.scene.objects, rssMB: s.rssMB ? s.rssMB.total : null,
  };
}

async function soakMain() {
  const num = (name, fallback) => (args.includes(name) ? Number(opt(name)) : fallback);
  const cfg = {
    ...SOAK,
    seconds: num('--seconds', SOAK.seconds), vMax: num('--vmax', SOAK.vMax), worldLen: num('--worldlen', SOAK.worldLen),
    styleEvery: num('--style-every', SOAK.styleEvery), turnEvery: num('--turn-every', SOAK.turnEvery),
    every: num('--every', SOAK.every), frame: num('--frame', SOAK.frame), noPlace: has('--no-place'), loop: opt('--loop', ''),
  };
  const out = ROOT + 'out/perf-soak.json';
  const save = (run) => {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(run, null, 1) + '\n');
  };
  // The drives' estimate of textures, the one to be held to (the most of any world).
  const drives = JSON.parse(readFileSync(ROOT + 'tools/look/perf-baseline.json', 'utf8'));
  const baseFile = ROOT + 'tools/look/soak-baseline.json';
  const base = existsSync(baseFile) ? JSON.parse(readFileSync(baseFile, 'utf8')) : null;
  const baseTexMB = Math.max(...Object.values(drives.worlds || drives).map((w) => w.textureMB.total));
  let run = null;
  if (has('--gates')) {
    // The lines again over a run kept (out/perf-soak.json): nothing is run.
    run = JSON.parse(readFileSync(opt('--gates'), 'utf8'));
  } else {
    const server = serve();
    try {
      if (!(await waitForServer())) throw new Error('the dev server did not come up');
      const t0 = Date.now();
      run = await soakRun(cfg, save);
      run.minutes = Math.round((Date.now() - t0) / 6000) / 10;
    } finally {
      server.kill();
      await sleep(800);
    }
  }
  const lines = soakGates(run, baseTexMB, base);
  run.gates = lines;
  if (!has('--gates')) save(run);
  console.log('');
  let failed = 0;
  for (const l of lines) {
    console.log(`${l.ok ? 'ok  ' : l.hard ? 'FAIL' : 'note'} ${l.text}`);
    if (!l.ok && l.hard) failed++;
  }
  if (!has('--gates')) console.log(`\nwritten: ${out}  (${run.minutes} minutes)`);
  if (has('--write')) {
    const file = opt('--write');
    mkdirSync(dirname(file), { recursive: true });
    const digest = { seed: SEED, walk: run.walk, limits: SOAK_LIMITS, held: lines.filter((l) => l.hard).map((l) => l.text), samples: run.samples.map(soakDigest), laps: run.laps.map(soakDigest),
      tiers: run.tiers ? Object.fromEntries(Object.entries(run.tiers).map(([k, v]) => [k, soakDigest(v)])) : null,
      scales: run.scales ? Object.fromEntries(Object.entries(run.scales).map(([k, v]) => [k, soakDigest(v)])) : null };
    writeFileSync(file, JSON.stringify(digest, null, 1) + '\n');
    console.log(`written: ${file}`);
  }
  if (failed) {
    console.error(`\nFAILED: ${failed} limit(s) of ${lines.filter((l) => l.hard).length}`);
    return false;
  }
  console.log(`\nOK: ${lines.filter((l) => l.hard).length} limit(s) held`);
  return true;
}

// --- the steps ----------------------------------------------------------------

// The walk: seconds of game time, the warm-up not counted, when the road is turned
// toward the next world (0: never), a world's length (m), how the steps are paced
// (real: a sixtieth of a second each, as the page takes them; fast: one after the
// other, between them only a turn of the page's event loop for what the workers
// have sent), steps to a stretch, and the step (ms) from which one is told with its parts.
const STEPS = { seconds: 300, warm: 20, turnAt: 150, worldLen: 2500, pace: 'real', stretch: 1800, slow: 4 };
// What is held (ms): the road's own share of a step. Told: the whole step against `line`, and the steps
// over it in which the road took more than `share`.
const STEPS_LIMITS = { slice: 5, line: 8, share: 2 };

// A hash of the samples lo to hi of a road: every field of each, number by number, as
// the bits of the number. The page and node each make one, and the two are the same
// road when the hashes are. (It stands alone: it is sent to the page as text.)
function samplesDigest(road, lo, hi) {
  const dv = new DataView(new ArrayBuffer(8));
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  const mix = (x) => {
    a = Math.imul(a ^ x, 16777619) >>> 0;
    b = Math.imul(b + x + 0x7f4a7c15, 0x85ebca6b) >>> 0;
    b = (b ^ (b >>> 15)) >>> 0;
  };
  for (let i = lo; i <= hi; i++) {
    const p = road.samples.get(i);
    if (!p) {
      mix(0xdead);
      continue;
    }
    for (const k of Object.keys(p).sort()) {
      for (let c = 0; c < k.length; c++) mix(k.charCodeAt(c));
      const v = p[k];
      if (typeof v === 'number') {
        dv.setFloat64(0, v);
        mix(dv.getUint32(0));
        mix(dv.getUint32(4));
      } else if (typeof v === 'string') {
        for (let c = 0; c < v.length; c++) mix(v.charCodeAt(c));
      } else {
        mix(v ? 1 : 2);
      }
    }
  }
  return `${a.toString(16)}-${b.toString(16)}`;
}

// In the page: the walk of --steps, set up once and then taken from outside a stretch
// at a time (window.__steps.advance). The page's own loop is stopped (it takes a step
// when its pacer says yes), so that the steps are the ones taken here, and nothing
// is drawn: it is Game.update that is timed. Each step is timed, and what the parts
// of update() took (the road's too: Road.update, whose rounds are timed by their
// stages as well). The page is as it was opened, so the workers bake the land and
// the trees, a little of it comes back a frame, and the road is laid by pieces
// where the code does so.
async function stepsSetup(g, cfg) {
  const road = await import('./src/world/road.js');
  const STEP = road.STEP;
  const MIN_AHEAD = road.MIN_AHEAD || 600;
  const now = () => performance.now();
  const S = {
    cfg, step: 0, t0: 0, ms: [], survey: [], mesh: [], rounds: [], slow: [], short: 0, shortest: Infinity, turned: null, turnStep: -1, relayEnd: -1,
    lastUpdateS: 0, turnUpdateS: 0, turnS: 0,
    path: [], maxCall: 0, calls: 0, minAhead: MIN_AHEAD, pieces: !!g.road._planSome,
  };
  window.__steps = S;
  window.ui.pacer.refresh = () => false;
  // What was left for after the first frame is done, and a frame drawn, so that
  // the page is as the loop would have it a second on.
  g.later.flush();
  g.render(1 / 60);

  const P = { survey: 0 };
  const wrap = (name, obj, method) => {
    if (!obj || typeof obj[method] !== 'function') return;
    const f = obj[method];
    P[name] = 0;
    obj[method] = function (...a) {
      const t0 = now();
      try {
        return f.apply(this, a);
      } finally {
        P[name] += now() - t0;
      }
    };
  };
  wrap('physics', g, 'stepPhysics');
  wrap('roadmesh', g.roadMesh, 'update');
  // What the road mesh's update is made of (inside it, so not counted twice): the chunks built,
  // the spans joined again, and the piers and lamps laid out.
  wrap('mesh.build', g.roadMesh, '_build');
  wrap('mesh.join', g.roadMesh, '_join');
  wrap('mesh.piers', g.roadMesh, '_syncPiers');
  wrap('mesh.lamps', g.roadMesh, '_syncLamps');
  wrap('traffic', g.traffic, 'update');
  wrap('camera', g.chase, 'update');
  wrap('director', g.director, 'update');
  wrap('terrain', g.terrain, 'update');
  wrap('forest', g.forest, 'update');
  wrap('forest', g.forest, 'animate');
  wrap('city', g.city, 'update');
  wrap('look', g, '_updateLook');
  wrap('props', g.props, 'update');
  wrap('clutter', g.clutter, 'update');
  wrap('atmosphere', g.atmosphere, 'update');
  // The road: every call of Road.update (inside the physics), and each of the stages
  // of a round (code that lays a round whole has a method to a stage; code that lays
  // it in pieces, a piece of the plan and of the profile fit at a time), a round
  // ending with its classification.
  const R = g.road;
  const update = R.update;
  R.update = function (...a) {
    const t0 = now();
    try {
      return update.apply(this, a);
    } finally {
      const d = now() - t0;
      S.lastUpdateS = a[0];
      P.survey += d;
      S.calls++;
      if (d > S.maxCall) S.maxCall = d;
    }
  };
  const fresh = () => ({ plan: 0, solve: 0, commit: 0, classify: 0, calls: 0, max: 0, first: -1, last: -1, s: 0 });
  let cur = fresh();
  const keys = ['plan', 'solve', 'commit', 'classify'];
  (S.pieces ? ['_planSome', '_solveSome', '_commit', '_classify'] : ['_plan', '_solve', '_commit', '_classify']).forEach((name, n) => {
    const f = R[name];
    R[name] = function (...a) {
      const t0 = now();
      try {
        return f.apply(this, a);
      } finally {
        const d = now() - t0;
        cur[keys[n]] += d;
        cur.calls++;
        if (d > cur.max) cur.max = d;
        if (cur.first < 0) cur.first = S.step;
        cur.last = S.step;
        if (n === 3) {
          cur.s = Math.round(g.sCar);
          S.rounds.push(cur);
          cur = fresh();
        }
      }
    };
  });

  const take = () => {
    for (const k in P) P[k] = 0;
    const t0 = now();
    g.update(1 / 60);
    const ms = now() - t0;
    S.ms.push(ms);
    S.survey.push(P.survey);
    S.mesh.push(P.roadmesh);
    const ahead = g.road.classified * STEP - g.sCar;
    if (ahead <= MIN_AHEAD) S.short++;
    if (ahead < S.shortest) S.shortest = ahead;
    // The step after which the road is laid again, once it has been turned.
    if (S.turned && S.relayEnd < 0 && S.step >= S.turnStep && !g.road.relaying(g.sCar)) S.relayEnd = S.step;
    // What the parts do not account for (the road's laying is inside the physics, so not counted twice):
    // update()'s own work, and whatever the page's engine did in the step, a collection of garbage among it.
    if (ms >= cfg.slow) {
      const parts = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, +v.toFixed(3)]));
      parts.rest = +(ms - Object.entries(P).reduce((a, [k, v]) => a + (k === 'survey' || k.startsWith('mesh.') ? 0 : v), 0)).toFixed(3);
      S.slow.push({ step: S.step, ms, parts });
    }
  };
  S.tick = cfg.pace === 'real'
    ? () => new Promise((res) => setTimeout(res, Math.max(0, S.t0 + S.step * (1000 / 60) - now())))
    : () => new Promise((res) => {
      const c = new MessageChannel();
      c.port1.onmessage = () => {
        c.port1.close();
        res();
      };
      c.port2.postMessage(0);
    });
  S.advance = async (n) => {
    const t0 = now();
    if (!S.step) S.t0 = t0;
    for (let i = 0; i < n; i++) {
      const k = S.step;
      if (k % 60 === 0) {
        const second = k / 60;
        if (cfg.turnAt && second === cfg.turnAt && S.turned === null) {
          S.turnUpdateS = S.lastUpdateS;
          S.turnS = g.sCar;
          S.turned = g.nextWorld();
          S.turnStep = k;
        }
        const id = g.worldHere().id;
        const last = S.path[S.path.length - 1];
        if (!last || last.id !== id) S.path.push({ t: second, id, s: Math.round(g.sCar) });
      }
      take();
      S.step = k + 1;
      await S.tick();
    }
    const from = Math.min(S.ms.length, cfg.warm * 60);
    let max = 0;
    for (let i = from; i < S.ms.length; i++) if (S.ms[i] > max) max = S.ms[i];
    return { step: S.step, wall: Math.round(now() - t0), max: +max.toFixed(2), s: Math.round(g.sCar), world: g.worldHere().id };
  };
  S.result = () => ({
    ms: S.ms, survey: S.survey, mesh: S.mesh, rounds: S.rounds, slow: S.slow, short: S.short, shortest: S.shortest, turned: S.turned, turnStep: S.turnStep, relayEnd: S.relayEnd,
    path: S.path, maxCall: S.maxCall, calls: S.calls, minAhead: MIN_AHEAD, pieces: S.pieces, distance: g.sCar, cuts: g.road.cuts,
    isolated: self.crossOriginIsolated, bakers: bakers(),
  });
  // The road at the end laid again in the page a round at a time (the way the
  // code lays it whole), from the same seed and with the worlds turned where the
  // car was when they were, and the samples of the two compared: the hash of every
  // field of each from the first to 400 m short of the last. Done once the steps
  // are, so nothing here is timed.
  S.compareRoad = async () => {
    const { makeWorldLand } = await import('./src/world/worlds.js');
    const { turnWorlds, turnNext } = await import('./src/world/turn.js');
    const r = g.road;
    const land = makeWorldLand(g.seed, { len: cfg.worldLen });
    const ref = new road.Road(land, g.seed);
    if (S.turned) {
      ref.update(S.turnUpdateS);
      turnWorlds(ref, land.worlds, S.turnS, turnNext(land.worlds));
    }
    ref.update(S.lastUpdateS);
    if (ref.settle) ref.settle();
    const lo = r.first + 5;
    const hi = r.classified - 400;
    const out = {
      lo, hi, digest: samplesDigest(r, lo, hi), refDigest: ref.classified >= hi ? samplesDigest(ref, lo, hi) : 'short', classified: r.classified, first: r.first,
      cuts: r.cuts, refCuts: ref.cuts, endUpdateS: S.lastUpdateS, turnUpdateS: S.turnUpdateS, turnS: S.turnS, which: [],
    };
    // Which differ, if any do (the first few, and how).
    if (cfg.detail || out.digest !== out.refDigest) {
      for (let i = lo; i <= hi && out.which.length < 4; i++) {
        const a = r.samples.get(i);
        const b = ref.samples.get(i);
        if (!a || !b) {
          out.which.push(`sample ${i}: ${a ? 'only in the page' : b ? 'only in the other' : 'in neither'}`);
          continue;
        }
        const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((f) => !Object.is(a[f], b[f]));
        if (fields.length) out.which.push(`sample ${i}: ${fields.slice(0, 6).map((f) => `${f} ${a[f]} against ${b[f]}`).join('; ')}`);
      }
    }
    return out;
  };
  const bakers = () => (g.bakers ? { ready: !!g.bakers.ready, failed: !!g.bakers.failed } : null);
  return { pieces: S.pieces, minAhead: MIN_AHEAD, isolated: self.crossOriginIsolated, world: g.worldHere().id, bakers: bakers() };
}

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);

// The walk itself, from outside: set up, then stretches of cfg.stretch steps, each
// reported as it ends. Returns what the page measured, with the machine's load
// before and after.
async function stepsRun(cfg) {
  const page = await openPage(`seed=${SEED}&worldlen=${cfg.worldLen}`, { ready: 'window.__ready', flags: ['--window-size=480,270'] });
  const load = () => ({ uptime: execFileSync('uptime', { encoding: 'utf8' }).trim(), loadavg: loadavg().map((v) => round(v, 2)) });
  const run = { seed: SEED, walk: cfg, tree: SITE, started: new Date().toISOString(), before: load(), after: null, notes: [] };
  try {
    const set = await page.run(`${samplesDigest.toString()}\nreturn (${stepsSetup.toString()})(g, ${JSON.stringify(cfg)});`);
    if (set.error) throw new Error(`setting the steps up: ${set.error}`);
    run.page = set;
    console.log(`the page is up in ${set.world}; the road is laid ${set.pieces ? 'in pieces' : 'a round at a time'}; workers ${set.bakers ? (set.bakers.ready ? 'up' : set.bakers.failed ? 'failed' : 'not yet up') : 'none'}, clock ${set.isolated ? 'of microseconds' : 'of a tenth of a millisecond'}; ${run.before.uptime}`);
    const total = cfg.seconds * 60;
    for (let done = 0; done < total; done += cfg.stretch) {
      const n = Math.min(cfg.stretch, total - done);
      const r = await withTimeout(page.run(`return __steps.advance(${n});`), 30 * 60e3, 'a stretch of the steps');
      if (r.error) throw new Error(`the steps: ${r.error}`);
      console.log(`  ${String(Math.round((done + n) / 60)).padStart(4)} s  in ${String(r.wall).padStart(6)} ms of the wall's  s ${String(r.s).padStart(6)} m  ${r.world.padEnd(7)}  dearest step so far after the warm-up ${r.max} ms`);
    }
    const data = await page.run('return __steps.result();');
    if (data.error) throw new Error(`the result: ${data.error}`);
    Object.assign(run, data);
    run.road = await page.run('return __steps.compareRoad();');
    if (run.road.error) throw new Error(`the road: ${run.road.error}`);
    run.errors = page.logs.slice(0, 5);
    run.after = load();
  } finally {
    page.close();
  }
  return run;
}

// The lines of the walk: held, or told. Each { ok, hard, text }.
function stepsGates(run) {
  const lines = [];
  const warm = run.walk.warm * 60;
  const counted = run.ms.slice(warm);
  const sorted = [...counted].sort((a, b) => a - b);
  const f = (v, d = 2) => (v === null || v === undefined ? '-' : String(round(v, d)));
  const road = run.survey.slice(warm);
  const roadSorted = [...road].sort((a, b) => a - b);
  // The steps over the line, and what the road took in each.
  const overSteps = [];
  for (let i = 0; i < counted.length; i++) if (counted[i] > STEPS_LIMITS.line) overSteps.push({ step: warm + i, ms: counted[i], road: road[i] });
  const madeDear = overSteps.filter((x) => x.road > STEPS_LIMITS.share);
  lines.push({ ok: roadSorted[roadSorted.length - 1] <= STEPS_LIMITS.slice, hard: true,
    text: `the road's own share of a step (Road.update, over ${road.length} steps after the first ${run.walk.warm} s): at most ${f(roadSorted[roadSorted.length - 1])} ms, held to ${STEPS_LIMITS.slice} (the 99.9th percentile ${f(quantile(roadSorted, 0.999))}; the dearest single call ${f(run.maxCall)} ms in ${run.calls} calls)` });
  // What took what in a step over the line: the road (laid inside the physics), the terrain, the
  // forest, the city, the road mesh, the rest of the parts, and what no part accounts for.
  const slowOf = new Map(run.slow.map((x) => [x.step, x]));
  const explain = (x) => {
    const p = (slowOf.get(x.step) || { parts: {} }).parts;
    const v = (k) => p[k] || 0;
    const others = ['traffic', 'camera', 'director', 'look', 'props', 'clutter', 'atmosphere'].reduce((a, k) => a + v(k), 0) + Math.max(0, v('physics') - v('survey'));
    return `step ${x.step} (${f(x.step / 60, 1)} s) ${f(x.ms)} ms: the road ${f(x.road, 1)}, terrain ${f(v('terrain'), 1)}, forest ${f(v('forest'), 1)}, city ${f(v('city'), 1)}, road mesh ${f(v('roadmesh'), 1)}, the others ${f(others, 1)}, the rest ${f(v('rest'), 1)}`;
  };
  lines.push({ ok: true, hard: false,
    text: `the steps over ${STEPS_LIMITS.line} ms in which the road took more than ${STEPS_LIMITS.share} ms: ${madeDear.length}, told, not held (the road's slice is laid at the start of the frame, and cannot see that the land or the road mesh has filled it)` });
  for (const x of madeDear.sort((a, b) => b.ms - a.ms).slice(0, 12)) lines.push({ ok: true, hard: false, text: `  with the road above ${STEPS_LIMITS.share} ms: ${explain(x)}` });
  lines.push({ ok: true, hard: false,
    text: `the whole step, against the line of ${STEPS_LIMITS.line} ms: the dearest of ${sorted.length} steps ${f(sorted[sorted.length - 1])} ms, ${overSteps.length} over the line (the 99.9th percentile ${f(quantile(sorted, 0.999))}, the 99th ${f(quantile(sorted, 0.99))}, the median ${f(quantile(sorted, 0.5))} ms)` });
  for (const x of overSteps.filter((o) => !madeDear.includes(o)).sort((a, b) => b.ms - a.ms).slice(0, 12)) lines.push({ ok: true, hard: false, text: `  over the line: ${explain(x)}` });
  lines.push({ ok: run.short === 0, hard: true,
    text: `the road is classified more than MIN_AHEAD (${run.minAhead} m) ahead of the car after every step: ${run.short} steps short, the least ${f(run.shortest, 0)} m` });
  // The steps after the turn, where the road is laid again.
  if (run.turned && run.turnStep >= 0) {
    const after = run.ms.slice(run.turnStep, run.turnStep + 600).sort((a, b) => a - b);
    lines.push({ ok: true, hard: false,
      text: `the 10 s after the turn (at ${run.turnStep / 60} s, the road cut and laid again, in ${run.relayEnd >= 0 ? run.relayEnd - run.turnStep + 1 : 'more than the walk had'} steps): the dearest step ${f(after[after.length - 1])} ms, the 99th percentile ${f(quantile(after, 0.99))}, the median ${f(quantile(after, 0.5))}` });
  } else if (run.walk.turnAt) {
    lines.push({ ok: true, hard: false, text: `the road was not turned toward the next world (Game.nextWorld gave ${run.turned})` });
  }
  const rows = run.rounds;
  // The steps in which new road came: the one a round was classified in, and the three
  // after it, in which the road mesh is built (a few chunks a step).
  if (rows.length && run.mesh) {
    const at = rows.filter((r) => r.last >= warm).flatMap((r) => [0, 1, 2, 3].map((k) => r.last + k));
    const dear = at.map((i) => [run.ms[i], run.mesh[i], run.survey[i]]).sort((a, b) => b[0] - a[0]);
    lines.push({ ok: true, hard: false,
      text: `the steps with new road (${rows.filter((r) => r.last >= warm).length} rounds, each with the three steps after it): the dearest ${f(dear[0][0])} ms, of which the road mesh ${f(dear[0][1])} and the road's laying ${f(dear[0][2])}; the road mesh's dearest step of them ${f(Math.max(...at.map((i) => run.mesh[i])))} ms, the road's laying ${f(Math.max(...at.map((i) => run.survey[i])))} ms` });
  }
  if (rows.length) {
    const total = (r) => r.plan + r.solve + r.commit + r.classify;
    const per = (k) => `${f(mean(rows.map((r) => r[k])), 2)} (dearest ${f(Math.max(...rows.map((r) => r[k])), 1)})`;
    lines.push({ ok: true, hard: false,
      text: `${rows.length} rounds of road, ms each, mean (dearest): the plan ${per('plan')}, the profile fit ${per('solve')}, the commit ${per('commit')}, the classification ${per('classify')}; all of it ${f(mean(rows.map(total)), 2)} (${f(Math.max(...rows.map(total)), 1)}), in ${f(mean(rows.map((r) => r.calls)), 0)} calls (the dearest ${f(Math.max(...rows.map((r) => r.max)), 2)} ms), over ${f(mean(rows.map((r) => r.last - r.first + 1)), 1)} steps` });
    for (const r of [...rows].sort((a, b) => total(b) - total(a)).slice(0, 5)) {
      lines.push({ ok: true, hard: false,
        text: `  a round at ${String(r.s).padStart(6)} m: ${f(total(r), 1)} ms (the plan ${f(r.plan, 1)}, the fit ${f(r.solve, 1)}, the commit ${f(r.commit, 1)}, the classification ${f(r.classify, 1)}) in ${r.calls} calls, the dearest ${f(r.max, 2)} ms, over ${r.last - r.first + 1} steps` });
    }
  }
  for (const s of [...run.slow].filter((x) => x.step >= warm).sort((a, b) => b.ms - a.ms).slice(0, 6)) {
    const top = Object.entries(s.parts).filter(([k]) => !k.startsWith('mesh.')).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k === 'survey' ? 'road' : k} ${f(v, 1)}`).join(', ');
    lines.push({ ok: true, hard: false, text: `  step ${s.step} (${f(s.step / 60, 1)} s): ${f(s.ms)} ms: ${top}` });
  }
  lines.push({ ok: true, hard: false, text: `the walk: ${f(run.distance, 0)} m, the bakers ${run.bakers ? (run.bakers.failed ? 'failed' : run.bakers.ready ? 'up' : 'not up') : 'none'}, through ${run.path.map((p) => `${p.id} from ${p.t} s`).join(', ')}; ${run.cuts} cut${run.cuts === 1 ? '' : 's'}; the machine before ${run.before.loadavg.join(' ')} and after ${run.after ? run.after.loadavg.join(' ') : '-'} (${run.before.uptime})` });
  if (run.errors && run.errors.length) lines.push({ ok: true, hard: false, text: `the page logged ${run.errors.length}: ${run.errors.join(' | ')}` });
  return lines;
}

// The line about the road the page laid, from what the page compared (compareRoad):
// { ok, text }, or null for a run that kept no road.
function stepsRoadLine(run) {
  const r = run.road;
  if (!r) return null;
  const ok = r.digest === r.refDigest && r.cuts === r.refCuts;
  return { ok,
    text: `the road the page laid, samples ${r.lo} to ${r.hi} (${r.hi - r.lo + 1} of them, ${r.cuts} cut${r.cuts === 1 ? '' : 's'}), ${ok ? 'is' : 'is NOT'} the road laid a round at a time in the page: hash ${r.digest} and ${r.refDigest} (${r.refCuts} cut${r.refCuts === 1 ? '' : 's'})${r.which && r.which.length ? `; the first that differ: ${r.which.join(' | ')}` : ''}` };
}

async function stepsMain() {
  const num = (name, fallback) => (args.includes(name) ? Number(opt(name)) : fallback);
  const cfg = {
    ...STEPS,
    seconds: num('--seconds', STEPS.seconds), warm: num('--warm', STEPS.warm), turnAt: num('--turn-at', STEPS.turnAt),
    worldLen: num('--worldlen', STEPS.worldLen), pace: opt('--pace', STEPS.pace), stretch: num('--stretch', STEPS.stretch),
    detail: has('--road-detail'),
  };
  const out = opt('--write', ROOT + 'out/perf-steps.json');
  let run = null;
  if (has('--gates')) {
    run = JSON.parse(readFileSync(opt('--gates'), 'utf8'));
  } else {
    const server = serve();
    try {
      if (!(await waitForServer())) throw new Error('the dev server did not come up');
      run = await stepsRun(cfg);
    } finally {
      server.kill();
      await sleep(800);
    }
  }
  const lines = stepsGates(run);
  const roadLine = stepsRoadLine(run);
  if (roadLine) lines.splice(2, 0, { ok: roadLine.ok, hard: true, text: roadLine.text });
  run.gates = lines;
  if (!has('--gates')) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(run) + '\n');
  }
  console.log('');
  let failed = 0;
  for (const l of lines) {
    console.log(`${l.ok ? (l.hard ? 'ok  ' : 'note') : l.hard ? 'FAIL' : 'note'} ${l.text}`);
    if (!l.ok && l.hard) failed++;
  }
  if (!has('--gates')) console.log(`\nwritten: ${out}`);
  if (failed) {
    console.error(`\nFAILED: ${failed} limit(s) of ${lines.filter((l) => l.hard).length}`);
    return false;
  }
  console.log(`\nOK: ${lines.filter((l) => l.hard).length} limit(s) held`);
  return true;
}

// --- main ---------------------------------------------------------------------

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const has = (name) => args.includes(name);
if (has('--soak')) process.exit((await soakMain()) ? 0 : 1);
if (has('--steps')) process.exit((await stepsMain()) ? 0 : 1);
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
