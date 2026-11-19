// How long the page takes to show its first frame, from nothing.
//
// Loads the real page in a Chrome that has never seen it (a profile made for
// the run, so no cache), on the real GPU (ANGLE, as look.mjs --gpu: a run on
// SwiftShader fails rather than pass for it; --soft draws in software on
// purpose), with the processor slowed fourfold and the network held to
// 30 Mbit/s and 40 ms to a request (DevTools' own throttling:
// Emulation.setCPUThrottlingRate, Network.emulateNetworkConditions). It
// measures:
//  - first: seconds from the start of the navigation until the page sets
//    window.__ready, which it does as it hands over its first frame;
//  - over 50 ms: how many frames in the five seconds after that took more
//    than 50 ms, as the page's own requestAnimationFrame callbacks see them
//    (a gap between two of them), counting the ones that began after it was
//    ready;
//  - bytes: what came over the network, the page's requests and its workers',
//    Network.loadingFinished's encodedDataLength added up;
// and once more, with nothing slowed, how long the first frame takes (free).
// Each is the median of --times runs (three), a new browser for each.
//
// window.__boot, which the page keeps (src/boot.js), says when each step of
// the start was done: --marks prints them for the median run, and what the
// page left for after its first frame, with what each piece cost.
//
// Usage:
//   node tools/cold_check.mjs                       measure; print the table
//   node tools/cold_check.mjs --soft                in software, not on the GPU
//   node tools/cold_check.mjs --times 5 --marks
//   node tools/cold_check.mjs --root DIR            serve DIR (another checkout, a copy of main)
//   node tools/cold_check.mjs --name before --write tools/look/cold-baseline.json
//                                                   keep the numbers under a name
//   node tools/cold_check.mjs --check tools/look/cold-baseline.json [--against before]
//                                                   hold them to what is kept under that name:
//                                                   first no later and under 6 s, over 50 ms
//                                                   at most 3 more, bytes at most 20 KB more,
//                                                   free under 2.5 s (the limits on the GPU)
//   node tools/cold_check.mjs --frames DIR [--query 'style=paint&world=hills'] [--name real-hills]
//                                                   one load, slowed (--free: not), and the screen at the
//                                                   first frame and 0.25, 0.5, 1, 1.5, 2, 3 and 5 s after it, as PNGs
//                                                   (the start screen and the panels hidden), to look at
//                                                   what is drawn as the page comes up; not timed
//   node tools/cold_check.mjs --profile FILE        one load, slowed (--free: not), the main thread's
//                                                   profile kept in FILE and the dearest functions of each
//                                                   step of the start printed
// It waits for the machine to be quiet first (a load of 2 or less; --wait
// minutes, ten by default) and says so in what it writes if it was not.
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser; ANGLE=gl the backend --gpu uses.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir, cpus } from 'node:os';
import { dirname } from 'node:path';

const CHROME = process.env.CHROME || ({
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
}[process.platform] || '/usr/bin/google-chrome-stable');
const ANGLE = process.env.ANGLE
  || { darwin: 'metal', linux: 'vulkan', win32: 'd3d11' }[process.platform] || 'gl';
// Headless WebGL fails on Linux while DISPLAY is set.
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8198;
const TOOLS = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d);
const SOFT = has('--soft');
const TIMES = Number(opt('--times', 3));
const ROOT = opt('--root', TOOLS).replace(/\/?$/, '/');
const QUERY = opt('--query', 'seed=7');
const FRAMES = opt('--frames', '');
const PROFILE = opt('--profile', '');
const FREE = has('--free');
const WAIT = Number(opt('--wait', 10));

// What the throttled runs are held to (the machine's GPU runs; software only
// to the baseline), and what the page's own frames are measured over.
const SLOW = { cpu: 4, mbit: 30, latency: 40 };
const LIMITS = { first: 6, over: 3, bytes: 20 * 1024, free: 2.5 };
const AFTER = 5000;          // ms after ready the frames are counted over
const BIG = 50;              // ms: a frame longer than this is one over

// --- the machine ------------------------------------------------------------------

// Wait for a load of 2 or less (the first of loadavg's three: the last minute).
async function quiet() {
  const t0 = Date.now();
  while (loadavg()[0] > 2 && Date.now() - t0 < WAIT * 60000) {
    console.error(`load ${loadavg()[0].toFixed(1)}: waiting for the machine`);
    await sleep(15000);
  }
  return loadavg()[0] <= 2;
}

function serve() {
  return spawn('node', [TOOLS + 'tools/serve.mjs', String(PORT), ROOT], { stdio: ['ignore', 'ignore', 'inherit'] });
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

// --- DevTools -----------------------------------------------------------------------

// The browser's own endpoint, with every page and worker a session of it
// (flattened), so that the workers' requests are seen too.
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, method } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
        else resolve(msg.result);
      } else {
        for (const f of this.listeners) f(msg);
      }
    });
  }

  send(method, params = {}, sessionId = undefined) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(f) {
    this.listeners.push(f);
  }
}

// In every page before its own scripts: when __ready is set (the moment, by
// the page's clock) and when each requestAnimationFrame callback ran.
const WATCH = (clean) => `(() => {
  const ts = [];
  let value;
  let ready = null;
  Object.defineProperty(window, '__ready', {
    configurable: true,
    get: () => value,
    set: (v) => {
      value = v;
      if (v && ready === null) {
        ready = performance.now();
        ${clean ? `try { window.__first = document.getElementById('view').toDataURL('image/png'); } catch (e) { window.__first = String(e); }` : ''}
      }
    },
  });
  // (When it runs, not the frame's time it is given: a frame that was begun
  // while the page was still busy with the last carries the time it began.)
  const loop = () => { ts.push(performance.now()); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  window.__cold = { ts, get ready() { return ready; } };
  // (With the screen to be looked at: the start screen and the panels taken
  // away, once there is a page to put that on.)
  ${clean ? `const hide = () => {
    const style = document.createElement('style');
    style.textContent = '#boot, .panel, #brand, .note { visibility: hidden !important; }';
    document.documentElement.appendChild(style);
  };
  if (document.documentElement) hide();
  else document.addEventListener('readystatechange', hide, { once: true });` : ''}
})()`;

// What the page says when it is done, read in one go.
const REPORT = `JSON.stringify({
  ready: window.__cold.ready,
  origin: performance.timeOrigin,
  ts: window.__cold.ts.filter((t) => t >= window.__cold.ready - 1000),
  boot: window.__boot || null,
  title: document.title,
  gpu: (() => {
    const g = window.game;
    if (!g) return '';
    const gl = g.renderer.getContext();
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : '';
  })(),
  state: (() => {
    try {
      const s = window.game.snapshot();
      return { frame: s.frame, fps: s.fps, tiles: s.tiles, trees: s.trees, roadChunks: s.roadChunks, style: s.style, quality: s.quality, programs: window.game.renderer.info.programs.length };
    } catch (e) {
      return null;
    }
  })(),
})`;

// One load of the page, from a browser that is new. slow: with the processor
// and the network held back. Returns what was measured.
// frames: the seconds after ready at which the screen is taken (the start
// screen and the panels hidden); profile: the main thread's, from the start.
async function load({ slow, frames = null, profile = false }) {
  const dir = `${tmpdir()}/continuum-cold-${process.pid}-${Date.now()}`;
  const how = SOFT
    ? ['--disable-gpu', '--enable-unsafe-swiftshader']
    : ['--ignore-gpu-blocklist', '--enable-gpu', `--use-angle=${ANGLE}`];
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', ...how, '--mute-audio', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
    `--window-size=${SOFT ? '1280,720' : '1920,1223'}`, '--remote-debugging-port=0', `--user-data-dir=${dir}`,
    'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], env: CHROME_ENV });
  let ws = null;
  const exited = new Promise((resolve) => chrome.on('exit', resolve));
  const close = async () => {
    try { if (ws) ws.close(); } catch { /* gone */ }
    chrome.kill();
    const gone = await Promise.race([exited.then(() => true), sleep(4000).then(() => false)]);
    if (!gone) chrome.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const url = await new Promise((resolve, reject) => {
      let text = '';
      chrome.stderr.on('data', (d) => {
        text += d;
        const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(text);
        if (m) resolve(m[1]);
      });
      chrome.on('exit', () => reject(new Error('chrome exited: ' + text.slice(-300))));
    });
    ws = new WebSocket(url);
    await new Promise((r) => ws.addEventListener('open', r));
    const cdp = new Cdp(ws);
    let target = null;
    for (let i = 0; i < 100 && !target; i++) {
      const { targetInfos } = await cdp.send('Target.getTargets');
      target = targetInfos.find((t) => t.type === 'page');
      if (!target) await sleep(100);
    }
    if (!target) throw new Error('the browser opened no page');
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const S = (method, params) => cdp.send(method, params, sessionId);

    // Bytes: what each request was, from every session (the page's, and the
    // workers that attach to it and are held until their network is watched).
    const requests = new Map();
    const errors = [];
    const net = { downloadThroughput: SLOW.mbit * 1e6 / 8, uploadThroughput: SLOW.mbit * 1e6 / 8, latency: SLOW.latency, offline: false };
    cdp.on((msg) => {
      const p = msg.params;
      if (msg.method === 'Target.attachedToTarget') {
        const child = p.sessionId;
        (async () => {
          try {
            await cdp.send('Network.enable', {}, child);
            if (slow) await cdp.send('Network.emulateNetworkConditions', net, child).catch(() => {});
          } catch { /* a target that has none */ }
          if (p.waitingForDebugger) await cdp.send('Runtime.runIfWaitingForDebugger', {}, child).catch(() => {});
        })();
      } else if (msg.method === 'Network.requestWillBeSent') {
        requests.set(`${msg.sessionId}:${p.requestId}`, { url: p.request.url, bytes: 0 });
      } else if (msg.method === 'Network.loadingFinished') {
        const r = requests.get(`${msg.sessionId}:${p.requestId}`);
        if (r) r.bytes = p.encodedDataLength;
      } else if (msg.method === 'Runtime.exceptionThrown') {
        errors.push(String(p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text).slice(0, 300));
      } else if (msg.method === 'Runtime.consoleAPICalled' && p.type === 'error') {
        errors.push(p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
      }
    });
    await S('Page.enable');
    await S('Runtime.enable');
    await S('Network.enable');
    await S('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    await S('Page.addScriptToEvaluateOnNewDocument', { source: WATCH(!!frames) });
    if (slow) {
      await S('Emulation.setCPUThrottlingRate', { rate: SLOW.cpu });
      await S('Network.emulateNetworkConditions', net);
    }
    let profiled = 0;
    if (profile) {
      await S('Profiler.enable');
      await S('Profiler.setSamplingInterval', { interval: 500 });
      await S('Profiler.start');
      profiled = Date.now();
    }

    // (There is a moment, as a page is swapped for the next, with nothing to
    // ask: that is no answer, not a failure.)
    const ev = async (expression) => {
      try {
        const r = await S('Runtime.evaluate', { expression, returnByValue: true });
        return r.exceptionDetails ? undefined : r.result.value;
      } catch {
        return undefined;
      }
    };
    const t0 = Date.now();
    const nav = await S('Page.navigate', { url: `http://localhost:${PORT}/index.html?${QUERY}` });
    if (nav.errorText) throw new Error(`the page did not load: ${nav.errorText}`);
    // Until the page says it is ready (or that it failed), then the five
    // seconds after, and a moment more.
    let ready = null;
    for (let i = 0; i < 1200 && ready === null; i++) {
      await sleep(100);
      ready = (await ev('window.__cold ? window.__cold.ready : null')) ?? null;
      if (i === 100 && (await ev('typeof window.__cold')) !== 'object') throw new Error('the watcher did not start in the page');
      const title = await ev('document.title');
      if (String(title).startsWith('GAME_FAIL')) throw new Error(`page: ${title}`);
    }
    if (ready === null) throw new Error('the page was not ready in two minutes');
    const slept = Date.now();
    // The screen at each of the times asked for; it says when it was taken.
    const shots = [];
    for (const after of frames || []) {
      while (await ev(`performance.now() < ${ready + after * 1000}`)) await sleep(20);
      const asked = await ev('performance.now()');
      const shot = await S('Page.captureScreenshot', { format: 'png' });
      shots.push({ at: (asked - ready) / 1000, data: shot.data });
    }
    const still = frames ? await ev('window.__first') : null;
    while (await ev(`performance.now() < ${ready + AFTER + 700}`)) await sleep(100);
    const out = JSON.parse(await ev(REPORT));
    const cpu = profile ? (await S('Profiler.stop')).profile : null;
    if (!SOFT && /SwiftShader/i.test(out.gpu || '')) {
      throw new Error(`no GPU to draw on (the page was drawn by ${out.gpu}); not measuring the software renderer as if it were a GPU`);
    }

    // Frames over 50 ms: the gaps between callbacks that began after ready and
    // were over by AFTER ms on.
    let over = 0;
    let frameCount = 0;
    const ts = out.ts.filter((t) => t >= out.ready && t <= out.ready + AFTER);
    for (let i = 1; i < ts.length; i++) {
      frameCount++;
      if (ts[i] - ts[i - 1] > BIG) over++;
    }
    let bytes = 0;
    for (const r of requests.values()) bytes += r.bytes;
    return {
      first: Math.round(out.ready) / 1000,
      over,
      frames: frameCount,
      worst: ts.length > 1 ? Math.round(Math.max(...ts.slice(1).map((t, i) => t - ts[i]))) : 0,
      bytes,
      requests: requests.size,
      big: [...requests.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 4).map((r) => `${r.url.split('/').slice(-2).join('/')} ${r.bytes}`),
      gpu: out.gpu,
      boot: out.boot,
      state: out.state,
      errors: errors.slice(0, 4),
      shots,
      still,
      cpu,
      cpuFrom: profiled - out.origin,
      waited: Date.now() - slept,
      wall: (Date.now() - t0) / 1000,
    };
  } finally {
    await close();
  }
}

// --- the numbers ---------------------------------------------------------------------

const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// A run's marks as [name, ms since the page began, ms since the mark before].
function steps(boot) {
  if (!boot) return [];
  let last = 0;
  return boot.marks.map(([name, at]) => {
    const step = [name, at, Math.round((at - last) * 10) / 10];
    last = at;
    return step;
  });
}

const fixed = (n, d = 2) => n.toFixed(d);
const spaced = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

async function measure() {
  const calm = await quiet();
  const slow = [];
  const free = [];
  let gpu = '';
  for (let i = 0; i < TIMES; i++) {
    const r = await load({ slow: true });
    gpu = r.gpu || gpu;
    slow.push(r);
    console.error(`  slowed ${i + 1}: first ${fixed(r.first)} s, ${r.over} over ${BIG} ms in ${r.frames} frames, ${spaced(r.bytes)} bytes${r.errors.length ? ', ERRORS ' + r.errors.join(' | ') : ''}`);
  }
  for (let i = 0; i < TIMES; i++) {
    const r = await load({ slow: false });
    free.push(r);
    console.error(`  free ${i + 1}: first ${fixed(r.first)} s${r.errors.length ? ', ERRORS ' + r.errors.join(' | ') : ''}`);
  }
  // The run that has the median first frame, for the marks.
  const middle = (runs) => runs.slice().sort((a, b) => a.first - b.first)[Math.floor(runs.length / 2)];
  const mid = middle(slow);
  const midFree = middle(free);
  return {
    at: new Date().toISOString(),
    mode: SOFT ? 'soft' : 'gpu',
    gpu,
    machine: `${cpus().length} cores, load ${loadavg()[0].toFixed(1)}`,
    busy: !calm,
    slowed: { cpu: SLOW.cpu, mbit: SLOW.mbit, latency: SLOW.latency },
    first: median(slow.map((r) => r.first)),
    over: median(slow.map((r) => r.over)),
    bytes: median(slow.map((r) => r.bytes)),
    free: median(free.map((r) => r.first)),
    runs: {
      slowed: slow.map((r) => ({ first: r.first, over: r.over, frames: r.frames, worst: r.worst, bytes: r.bytes, requests: r.requests })),
      free: free.map((r) => ({ first: r.first })),
    },
    steps: steps(mid.boot),
    stepsFree: steps(midFree.boot),
    later: mid.boot ? mid.boot.later : [],
    programs: mid.boot ? mid.boot.programs : null,
    first_sets: mid.boot ? mid.boot.first : null,
    biggest: mid.big,
    state: mid.state,
  };
}

function show(r) {
  console.log(`first frame, from nothing: ${r.mode === 'soft' ? 'software' : 'GPU'} ${r.gpu}; ${r.machine}${r.busy ? '; the machine was not quiet' : ''}`);
  console.log(`  slowed (cpu x${r.slowed.cpu}, ${r.slowed.mbit} Mbit/s, ${r.slowed.latency} ms), ${r.runs.slowed.length} runs`);
  r.runs.slowed.forEach((x, i) => console.log(`    ${i + 1}  first ${fixed(x.first)} s   over ${BIG} ms ${String(x.over).padStart(3)} of ${x.frames}   worst ${x.worst} ms   ${spaced(x.bytes)} bytes in ${x.requests} requests`));
  console.log(`    median  first ${fixed(r.first)} s   over ${BIG} ms ${r.over}   ${spaced(r.bytes)} bytes`);
  console.log(`  free of throttling: first ${fixed(r.free)} s (${r.runs.free.map((x) => fixed(x.first)).join(', ')})`);
  console.log(`  biggest: ${r.biggest.join('; ')}`);
}

function showMarks(r) {
  console.log('  the start, in the median slowed run, and in the median free one (ms since the page began, ms since the step before):');
  const free = new Map((r.stepsFree || []).map(([name, at, step]) => [name, [at, step]]));
  for (const [name, at, step] of r.steps) {
    const f = free.get(name);
    console.log(`    ${name.padEnd(18)} ${String(at).padStart(8)} ${String(step).padStart(8)}   ${f ? `${String(f[0]).padStart(8)} ${String(f[1]).padStart(8)}` : ''}`);
  }
  if (r.programs) console.log(`  shader programs: ${r.programs.join(' -> ')}`);
  if (r.first_sets) console.log(`  the first frame waited for ${r.first_sets.lands} tiles of land and ${r.first_sets.trees} of trees (${r.first_sets.workers} workers, up at first: ${r.first_sets.up})`);
  if (r.later.length) {
    console.log('  left for after the first frame (queue):');
    for (const x of r.later) console.log(`    ${x.name.padEnd(18)} ${String(x.ms).padStart(8)} ms in ${x.steps} steps, from frame ${x.frame}`);
  }
}

// The limits, against what is kept under `against`.
function check(r, kept) {
  const rows = [];
  const gpu = r.mode === 'gpu';
  const row = (what, value, limit, ok) => rows.push({ what, value, limit, ok });
  row('first frame, slowed', `${fixed(r.first)} s`, `${fixed(kept.first)} s${gpu ? ` and ${LIMITS.first} s` : ''}`, r.first <= kept.first && (!gpu || r.first <= LIMITS.first));
  row(`frames over ${BIG} ms in the next ${AFTER / 1000} s`, r.over, `${kept.over} + ${LIMITS.over}`, r.over <= kept.over + LIMITS.over);
  row('bytes downloaded', spaced(r.bytes), `${spaced(kept.bytes)} + ${LIMITS.bytes / 1024} KB`, r.bytes <= kept.bytes + LIMITS.bytes);
  row('first frame, not slowed', `${fixed(r.free)} s`, gpu ? `${LIMITS.free} s` : 'none in software', !gpu || r.free <= LIMITS.free);
  for (const x of rows) console.log(`${x.ok ? 'ok  ' : 'FAIL'} ${x.what.padEnd(40)} ${String(x.value).padStart(12)}  (at most ${x.limit})`);
  return rows.every((x) => x.ok);
}

// --- run -----------------------------------------------------------------------------

// The main thread's profile (what the Profiler domain gives: nodes, and a
// sample of one of them each `timeDeltas`), the dearest functions of a span of
// the page's own time: by the time in them (self) and in them and what they
// call (inclusive).
function profileTop(profile, from, to, count, began) {
  const parent = new Map();
  const node = new Map(profile.nodes.map((n) => [n.id, n]));
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const name = (n) => `${n.callFrame.functionName || '(anonymous)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber + 1}`;
  const self = new Map();
  const inclusive = new Map();
  // `began` is the page's own time (ms) at which the profile began.
  let at = began;
  let total = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = (profile.timeDeltas[i + 1] ?? 0) / 1000;
    at += (profile.timeDeltas[i] ?? 0) / 1000;
    if (at < from || at > to) continue;
    total += dt;
    let n = node.get(profile.samples[i]);
    self.set(name(n), (self.get(name(n)) || 0) + dt);
    const seen = new Set();
    for (let id = n.id; id !== undefined; id = parent.get(id)) {
      const k = name(node.get(id));
      if (!seen.has(k)) {
        seen.add(k);
        inclusive.set(k, (inclusive.get(k) || 0) + dt);
      }
    }
  }
  const top = (m) => [...m].filter(([k]) => !/^\((root|idle)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, count)
    .map(([k, v]) => `${v.toFixed(0).padStart(7)} ms  ${k}`);
  return { total, self: top(self), inclusive: top(inclusive) };
}

if (FRAMES || PROFILE) {
  // One load, slowed (or not), for looking at: the screen as it comes up, or where the main thread's time goes.
  if (!existsSync(ROOT + 'index.html')) throw new Error(`no index.html in ${ROOT}`);
  const server = serve();
  try {
    if (!(await waitForServer())) throw new Error('server did not start');
    const r = await load({
      slow: !FREE,
      frames: FRAMES ? [0.25, 0.5, 1, 1.5, 2, 3, 5] : null,
      profile: !!PROFILE,
    });
    console.log(`first frame at ${fixed(r.first)} s, ${r.over} frames over ${BIG} ms in the next ${AFTER / 1000} s, ${spaced(r.bytes)} bytes${r.errors.length ? ', ERRORS ' + r.errors.join(' | ') : ''}`);
    if (r.state) console.log(`after that: frame ${r.state.frame}, ${r.state.fps} fps, ${r.state.tiles} tiles of land, ${r.state.trees} trees, ${r.state.programs} programs, ${r.state.style}, quality ${r.state.quality}`);
    if (FRAMES) {
      mkdirSync(FRAMES, { recursive: true });
      const name = opt('--name', 'frame');
      // (The frame itself is the page's, as it was drawn; the others are the screen, asked for at the time named, which they take a third of a second to answer.)
      if (r.still && r.still.startsWith('data:image/png')) {
        writeFileSync(`${FRAMES}/${name}-first.png`, Buffer.from(r.still.replace(/^data:image\/png;base64,/, ''), 'base64'));
        console.log(`${FRAMES}/${name}-first.png`);
      }
      for (const s of r.shots) {
        const file = `${FRAMES}/${name}-${s.at.toFixed(2)}s.png`;
        writeFileSync(file, Buffer.from(s.data, 'base64'));
        console.log(file);
      }
    }
    if (PROFILE || has('--marks')) {
      showMarks({ steps: steps(r.boot), stepsFree: [], programs: r.boot ? r.boot.programs : null, first_sets: r.boot ? r.boot.first : null, later: r.boot ? r.boot.later : [] });
    }
    if (PROFILE) {
      mkdirSync(dirname(PROFILE), { recursive: true });
      writeFileSync(PROFILE, JSON.stringify(r.cpu));
      const marks = r.boot ? r.boot.marks : [];
      const spans = [['all of it', -Infinity, Infinity]];
      for (let i = 1; i < marks.length; i++) {
        if (marks[i][1] - marks[i - 1][1] >= 80) spans.push([`${marks[i - 1][0]} -> ${marks[i][0]}`, marks[i - 1][1], marks[i][1]]);
      }
      const ready = marks.find((m) => m[0] === 'ready');
      if (ready) spans.push(['the 5 s after ready', ready[1], ready[1] + AFTER]);
      for (const [label, from, to] of spans) {
        const t = profileTop(r.cpu, from, to, label === 'all of it' ? 24 : 8, r.cpuFrom);
        console.log(`\n${label}  (${t.total.toFixed(0)} ms sampled)`);
        console.log('  by the time in the function itself:\n' + t.self.map((l) => '  ' + l).join('\n'));
        if (label === 'all of it' || label === 'the 5 s after ready') console.log('  and in what it calls too:\n' + t.inclusive.map((l) => '  ' + l).join('\n'));
      }
    }
  } finally {
    server.kill();
  }
  process.exit(0);
}

if (!existsSync(ROOT + 'index.html')) throw new Error(`no index.html in ${ROOT}`);
const server = serve();
let failed = false;
try {
  if (!(await waitForServer())) throw new Error('server did not start');
  const result = await measure();
  show(result);
  if (has('--marks')) showMarks(result);
  const file = opt('--write', '');
  if (file) {
    const kept = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    const name = opt('--name', 'now');
    kept[result.mode] = { ...(kept[result.mode] || {}), [name]: result };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(kept, null, 1) + '\n');
    console.log(`kept as ${result.mode}/${name} in ${file}`);
  }
  const against = opt('--check', '');
  if (against) {
    const name = opt('--against', 'before');
    const kept = JSON.parse(readFileSync(against, 'utf8'))[result.mode];
    if (!kept || !kept[name]) throw new Error(`${against} has nothing kept as ${result.mode}/${name}`);
    console.log(`against ${result.mode}/${name} (${kept[name].at.slice(0, 10)}):`);
    if (!check(result, kept[name])) failed = true;
  }
} catch (e) {
  console.error(e.message || e);
  failed = true;
} finally {
  server.kill();
}
process.exit(failed ? 1 : 0);
