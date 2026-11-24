// How steady the frames are: not what a frame costs on average, but how often one is late.
//
// The real page, on the real GPU (Chrome headless with --use-angle=metal, as look.mjs --gpu and
// air_check.mjs --gpu draw, but with the display's own pace: no --disable-gpu-vsync, no
// --disable-frame-rate-limit), 1920 by 1080, the high tier pinned, seed 7, worlds of 2.5 km
// (worldlen=2500), the autopilot at its own speed. Not run=: the page as a visitor has it, its own
// requestAnimationFrame loop, its workers baking the land and the trees. Beside the page's loop a second
// one records the time each frame began (the rAF timestamp) and, by wrapping Game.update and
// Game.render on the instance (src/ is not changed), how long the frame's step and drawing took and how
// many shader programs were made while it was drawn (a program the first frame to draw a material
// builds, and does not find built ahead: its cacheKey's continuum-… name is kept, or the material's type).
//
// The drive goes by a timetable of the run's length (--seconds, 300 by default): the style changes from
// the first of --styles to the second at 30% of it and to the third at 70% (one change only, at 30%, in
// a run under 200 s), and "next world" is clicked at 50% (the page's own button, #btnNext). The
// borders the car crosses are the stretches where the world under the car is blending (0 < t < 1 in
// WorldMap.at: the 1.5 km before a world begins, more or less by the warp); at 2.5 km a world and the
// autopilot's speed, a five-minute drive crosses about three.
//
// Counted from the first frame after the page is up and --skip seconds have gone (3; the frames before
// are reported apart, as "start"): every gap between two frames (ms); how many are over 25 ms and over
// 50 ms; the 99th percentile; the longest in the 1.4 s after each change of style; the longest while the
// car is in each border. Told beside them: the median gap (the display's pace), the longest frame and
// the frames that cost the most with what took the time (the step, the drawing, programs made), the
// JS heap's rise between collections a second (performance.memory with --enable-precise-memory-info:
// the sum of its rises over the run's time) and how many times it fell by a megabyte or more (a
// collection), the steps the quality ladder took (the scene's size comes down in slow windows), each frame
// in which a draw made a program, and the dearest tasks of the page's queue of work after the first frame
// (window.__boot.later).
//
// The limits, for five minutes; a shorter run has the count over 25 ms by its share of the five
// minutes, rounded down (60 s: 1), and the others as they are:
const LIMITS = [
  { key: 'over25', what: 'frames over 25 ms', most: 5, scaled: true },
  { key: 'over50', what: 'frames over 50 ms', most: 0 },
  { key: 'p99', what: '99th percentile of the gaps (ms)', most: 18 },
  { key: 'switchMax', what: 'longest frame in the 1.4 s of a change of style (ms)', most: 30 },
  { key: 'borderMax', what: 'longest frame while crossing a border (ms)', most: 25 },
];
// The machine these are for: an Apple M-series GPU, 1080p, nothing else heavy running. A run with the
// software renderer is refused (its frames are hundreds of milliseconds).
//
// Usage:
//   node tools/hitch_check.mjs                     five minutes, to out/hitch.json
//   node tools/hitch_check.mjs --seconds 60        a minute (the count over 25 ms scaled to it)
//   node tools/hitch_check.mjs --styles real,ink,paint --seed 7 --skip 3 --write out/hitch.json
//   node tools/hitch_check.mjs --seconds 60 --at 800   begin 800 m along the road (s=800), nearer the first border
//   node tools/hitch_check.mjs --root ~/.cache/continuum/<commit>   another tree (an export of a commit)
//   node tools/hitch_check.mjs --gates out/hitch.json   the limits again over a run kept (nothing is run)
//   node tools/hitch_check.mjs --node-only         the arithmetic on made-up gaps, no browser
// PORT=8371 moves the server it starts; CHROME=/path/to/chrome overrides the browser.
// Exits non-zero when a limit fails.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const opt = (name, fallback) => (has(name) ? args[args.indexOf(name) + 1] : fallback);
const SECONDS = Number(opt('--seconds', 300));
const SKIP = Number(opt('--skip', 3));
const SEED = Number(opt('--seed', 7));
const AT = Number(opt('--at', 0));
const STYLES = opt('--styles', 'real,ink,paint').split(',');
const WRITE = opt('--write', 'out/hitch.json');
const ROOT = resolve(opt('--root', new URL('..', import.meta.url).pathname)) + '/';
const PORT = Number(process.env.PORT) || 8373;
const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const SWITCH_MS = 1400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- the arithmetic (node) ---------------------------------------------------

// The q-th quantile of numbers (0..1), by the nearest rank.
function quantile(xs, q) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
}
const round = (v, k = 1) => (v === null || v === undefined ? null : Math.round(v * 10 ** k) / 10 ** k);

// The limits for a run of `seconds`.
function limitsFor(seconds) {
  return LIMITS.map((l) => ({ ...l, most: l.scaled ? Math.floor((l.most * seconds) / 300) : l.most }));
}

// From the frames the page recorded ({ t, gap, ... } a frame, t in ms from the start of the drive) and
// the events (changes of style, the click, at t), what is held and told.
function summarize(rec, seconds, skip) {
  const frames = rec.frames.filter((f) => f.t >= skip * 1000);
  const start = rec.frames.filter((f) => f.t < skip * 1000);
  const gaps = frames.map((f) => f.gap);
  const switches = rec.events.filter((e) => e.kind === 'style').map((e) => {
    const inside = frames.filter((f) => f.t >= e.t && f.t < e.t + SWITCH_MS);
    return { to: e.to, at: round(e.t / 1000, 1), frames: inside.length, max: round(Math.max(0, ...inside.map((f) => f.gap))) };
  });
  // The borders: runs of frames with the car's world blending.
  const borders = [];
  let cur = null;
  for (const f of frames) {
    if (f.border) {
      if (!cur || cur.from !== f.from || cur.to !== f.to) {
        cur = { from: f.from, to: f.to, t0: f.t, t1: f.t, s0: f.s, s1: f.s, max: 0, frames: 0 };
        borders.push(cur);
      }
      cur.t1 = f.t;
      cur.s1 = f.s;
      cur.frames++;
      cur.max = Math.max(cur.max, f.gap);
    } else cur = null;
  }
  const crossed = borders.map((b) => ({ from: b.from, to: b.to, at: round(b.t0 / 1000, 1), seconds: round((b.t1 - b.t0) / 1000, 1),
    metres: Math.round(b.s1 - b.s0), frames: b.frames, max: round(b.max), whole: b.t0 > (frames[0] ? frames[0].t : 0) && b.t1 < (frames.length ? frames[frames.length - 1].t : 0) }));
  // The heap: what it rose by between collections, a second; and the collections (falls of 1 MB or more).
  let rise = 0;
  let falls = 0;
  for (let i = 1; i < frames.length; i++) {
    const d = frames[i].heap - frames[i - 1].heap;
    if (d > 0) rise += d;
    else if (d <= -1e6) falls++;
  }
  const span = frames.length ? (frames[frames.length - 1].t - frames[0].t) / 1000 : 0;
  const top = (list, n) => list.slice().sort((a, b) => b.gap - a.gap).slice(0, n).map((f) => ({
    at: round(f.t / 1000, 2), gap: round(f.gap), update: round(f.upd), render: round(f.ren), busy: round(f.busy), event: round(f.ev), queue: f.queue,
    programs: f.made, made: f.names,
    world: f.border ? `${f.from}>${f.to} ${round(f.wt, 2)}` : f.from, style: f.style, kmh: Math.round(f.kmh), level: f.level,
  }));
  const worst = top(frames, 12);
  const out = {
    seconds: round(span, 1), frames: frames.length,
    over25: gaps.filter((g) => g > 25).length,
    over50: gaps.filter((g) => g > 50).length,
    p99: round(quantile(gaps, 0.99)),
    median: round(quantile(gaps, 0.5), 2),
    max: round(Math.max(0, ...gaps)),
    switchMax: switches.length ? Math.max(...switches.map((s) => s.max)) : null,
    borderMax: crossed.length ? Math.max(...crossed.map((b) => b.max)) : null,
    switches, borders: crossed,
    madeWhileDrawing: frames.reduce((n, f) => n + f.made, 0),
    drawn: rec.frames.filter((f) => f.made).map((f) => ({ at: round(f.t / 1000, 2), gap: round(f.gap), render: round(f.ren), style: f.style, made: f.names })),
    heap: { risePerSecond: span ? Math.round(rise / span) : null, collections: falls, endMB: frames.length ? round(frames[frames.length - 1].heap / 1e6, 1) : null },
    levels: [...new Set(frames.map((f) => f.level))],
    start: { frames: start.length, max: round(Math.max(0, ...start.map((f) => f.gap))), madeWhileDrawing: start.reduce((n, f) => n + f.made, 0), worst: top(start, 5) },
    worst,
  };
  return out;
}

// Each limit, held or not, as lines.
function gate(sum, seconds) {
  const lines = [];
  let failed = 0;
  for (const l of limitsFor(seconds)) {
    const v = sum[l.key];
    const ok = v !== null && v <= l.most;
    if (!ok) failed++;
    lines.push(`${ok ? 'ok  ' : 'FAIL'}  ${l.what}: ${v === null ? 'none measured' : v} (at most ${l.most}${l.scaled && seconds !== 300 ? `: 5 in 300 s, scaled to ${seconds} s` : ''})`);
  }
  return { lines, failed };
}

function selfTest() {
  const frames = [];
  let t = 0;
  for (let i = 0; i < 3600; i++) {
    const gap = i === 1000 ? 40 : i === 2000 ? 60 : i % 500 === 7 ? 26 : 16.7;
    t += gap;
    const border = i >= 1500 && i < 1800;
    frames.push({ t, gap, upd: 1, ren: 2, made: i === 2000 ? 1 : 0, names: i === 2000 ? ['continuum-city'] : [], s: i * 0.4, border,
      from: border ? 'hills' : 'hills', to: border ? 'river' : 'hills', wt: 0.5, style: 'real', kmh: 80, level: 0, heap: 5e6 + (i % 600) * 1e4 });
  }
  const sum = summarize({ frames, events: [{ kind: 'style', t: frames[1995].t, to: 'ink' }] }, 60, 0);
  const want = { over25: 10, over50: 1, max: 60, switchMax: 60, borderMax: 26, madeWhileDrawing: 1 };
  const bad = Object.entries(want).filter(([k, v]) => sum[k] !== v);
  if (sum.p99 !== 16.7) bad.push(['p99', sum.p99]);
  if (sum.borders.length !== 1 || sum.borders[0].frames !== 300) bad.push(['borders', JSON.stringify(sum.borders)]);
  if (sum.heap.collections !== 5) bad.push(['collections', sum.heap.collections]);
  if (limitsFor(60)[0].most !== 1 || limitsFor(300)[0].most !== 5) bad.push(['scaled', limitsFor(60)[0].most]);
  const g = gate(sum, 60);
  if (g.failed !== 4) bad.push(['gate', g.failed]);
  if (bad.length) {
    console.log('FAIL  the arithmetic:', bad.map(([k, v]) => `${k}=${v} (want ${want[k] ?? '...'})`).join(', '));
    process.exit(1);
  }
  console.log('ok    the arithmetic: counts over 25 and 50 ms, the 99th percentile, the change of style, a border, collections, the scaled limit');
}

// --- the page ----------------------------------------------------------------

// In the page: the recorder and the timetable. Resolves when the drive is over.
const DRIVE = (seconds, styles) => `
  const r = g.renderer;
  const progs = r.info.programs;
  const S = { frames: [], events: [], done: false };
  let upd = 0;
  let ren = 0;
  let made = 0;
  let names = [];
  const update = g.update;
  const render = g.render;
  g.update = function (dt) {
    const t0 = performance.now();
    const v = update.call(this, dt);
    upd += performance.now() - t0;
    return v;
  };
  // The programs made in compile or compileAsync (built ahead, by the page's queue or a world coming into
  // reach) are known as they are made; one that turns up after a render and is not known was made by a draw.
  const known = new Set(progs);
  const own = { compile: r.compile, compileAsync: r.compileAsync };
  for (const name of Object.keys(own)) {
    r[name] = function (...a) {
      try {
        return own[name].apply(this, a);
      } finally {
        for (const p of progs) known.add(p);
      }
    };
  }
  g.render = function (dt) {
    const t0 = performance.now();
    const v = render.call(this, dt);
    ren += performance.now() - t0;
    for (const p of progs) {
      if (known.has(p)) continue;
      known.add(p);
      made++;
      const m = /continuum-[\w|-]+/.exec(p.cacheKey || '');
      names.push(m ? m[0].slice(0, 60) : p.name || String(p.cacheKey || '').split(',')[0].slice(0, 40) || 'program');
    }
    return v;
  };
  const W = g.land.worlds;
  const at = { a: 0, b: 0, t: 0, u: 0 };
  const id = (i) => (W.list[i] ? W.list[i].id : String(i));
  const styles = ${JSON.stringify(styles)};
  const plan = [];
  plan.push({ t: 0.3 * ${seconds} * 1000, kind: 'style', to: styles[1] });
  plan.push({ t: 0.5 * ${seconds} * 1000, kind: 'next' });
  if (${seconds} >= 200 && styles[2]) plan.push({ t: 0.7 * ${seconds} * 1000, kind: 'style', to: styles[2] });
  plan.sort((p, q) => p.t - q.t);
  let t0 = null;
  let last = null;
  return await new Promise((resolve) => {
    // A record a frame: what was done in it (the page's step and drawing ran before this callback, the
    // timetable's event after) and the gap from its start to the next frame's, which that work holds up.
    let prev = null;
    const loop = (now) => {
      if (t0 === null) t0 = now;
      const t = now - t0;
      if (prev) {
        prev.gap = now - last;
        S.frames.push(prev);
      }
      const c = g.car;
      W.at(c.x + g.road.origin.x, c.z + g.road.origin.z, at);
      const border = at.a !== at.b && at.t > 0 && at.t < 1;
      const f = { t, gap: 0, upd, ren, made, names, s: g.sCar, border, from: id(at.a), to: id(at.b), wt: at.t,
        style: g.style.id, kmh: c.speedKmh, level: g.quality ? g.quality.level : -1, busy: performance.now() - now, ev: 0,
        queue: g.later.pending, heap: performance.memory ? performance.memory.usedJSHeapSize : 0 };
      upd = 0;
      ren = 0;
      made = 0;
      names = [];
      while (plan.length && t >= plan[0].t) {
        const e = plan.shift();
        const queue = g.later.pending;
        const e0 = performance.now();
        if (e.kind === 'style') g.setStyle(e.to);
        else document.getElementById('btnNext').click();
        f.ev += performance.now() - e0;
        S.events.push({ ...e, t, s: g.sCar, ms: Math.round((performance.now() - e0) * 10) / 10, queue });
      }
      prev = f;
      last = now;
      if (t >= ${seconds} * 1000) {
        g.update = update;
        g.render = render;
        Object.assign(r, own);
        resolve({ frames: S.frames, events: S.events, size: [innerWidth, innerHeight], canvas: [r.domElement.width, r.domElement.height],
          programs: progs.length, tier: g.tier, style: g.style.id, distance: Math.round(g.sCar),
          later: ((window.__boot && window.__boot.later) || []).slice().sort((a, b) => b.ms - a.ms).slice(0, 10) });
        return;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
`;

async function waitForServer(tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) return true;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  return false;
}

// The page, headless on the GPU, up (window.__ready), and a way to run code in it.
async function openPage(query) {
  const profile = `${tmpdir()}/continuum-hitch-${process.pid}-${Date.now()}`;
  const angle = process.platform === 'darwin' ? 'metal' : 'vulkan';
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu', `--use-angle=${angle}`,
    '--enable-precise-memory-info', '--mute-audio', '--hide-scrollbars', '--window-size=1920,1223', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, `http://localhost:${PORT}/index.html?${query}`], { stdio: ['ignore', 'ignore', 'pipe'], env: CHROME_ENV });
  const close = () => {
    chrome.kill();
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
  };
  try {
    const devtools = await new Promise((res, rej) => {
      let text = '';
      chrome.on('error', rej);
      chrome.stderr.on('data', (d) => {
        text += d;
        const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(text);
        if (m) res(new URL(m[1]));
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
    ws.addEventListener('close', () => {
      for (const done of pending.values()) done({ result: { value: JSON.stringify({ error: 'the page closed' }) } });
      pending.clear();
    });
    ws.send(JSON.stringify({ id: 9999, method: 'Runtime.enable' }));
    const ev = (expression) => new Promise((res) => {
      pending.set(++id, (r) => res(r && r.result ? (r.result.value !== undefined ? r.result.value : r.result.description) : r));
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    let up = false;
    let title = '';
    for (let i = 0; i < 240 && !up; i++) {
      title = await ev('document.title');
      if (String(title).startsWith('GAME_FAIL')) break;
      up = (await ev('window.__ready === true')) === true;
      if (!up) await sleep(250);
    }
    if (!up) throw new Error(`page: ${title} ${logs.join(' | ')}`);
    return {
      logs,
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

function report(sum, seconds, meta) {
  const g = gate(sum, seconds);
  console.log(`hitch: ${sum.seconds} s, ${sum.frames} frames, median ${sum.median} ms; over 25 ms ${sum.over25}, over 50 ms ${sum.over50}, p99 ${sum.p99} ms, `
    + `longest ${sum.max} ms; change of style ${sum.switchMax ?? '-'} ms, border ${sum.borderMax ?? '-'} ms; programs made by a draw ${sum.madeWhileDrawing}`
    + (meta ? ` (${meta.gpu}, ${meta.canvas.join('x')}, tier ${meta.tier})` : ''));
  for (const s of sum.switches) console.log(`  style -> ${s.to} at ${s.at} s: longest ${s.max} ms in ${s.frames} frames`);
  for (const e of (meta && meta.events) || []) console.log(`  ${e.kind}${e.to ? ' ' + e.to : ''} at ${round(e.t / 1000, 1)} s took ${e.ms} ms, ${e.queue} tasks of the page's queue left before it`);
  for (const b of sum.borders) console.log(`  border ${b.from} > ${b.to} at ${b.at} s, ${b.metres} m in ${b.seconds} s${b.whole ? '' : ' (cut by the run)'}: longest ${b.max} ms`);
  console.log(`  heap: +${sum.heap.risePerSecond} B/s between collections, ${sum.heap.collections} collections, ${sum.heap.endMB} MB at the end; quality levels ${sum.levels.join(',')}`);
  console.log(`  before --skip: ${sum.start.frames} frames, longest ${sum.start.max} ms, ${sum.start.madeWhileDrawing} programs made by a draw`);
  const line = (w) => `    ${String(w.gap).padStart(6)} ms at ${w.at} s  update ${w.update}  render ${w.render}  busy ${w.busy}`
    + (w.event ? `  event ${w.event}` : '') + `  queue ${w.queue}  ${w.world} ${w.style} ${w.kmh} km/h`
    + (w.programs ? `  programs made by a draw ${w.programs}: ${w.made.join(' ')}` : '');
  console.log('  the longest frames (what was done in the frame whose gap to the next it is):');
  for (const w of sum.worst.slice(0, 8)) console.log(line(w));
  if (sum.start.worst) for (const w of sum.start.worst.slice(0, 3)) console.log(line(w).replace('    ', '  start '));
  for (const d of sum.drawn || []) console.log(`  programs made by a draw at ${d.at} s (${d.style}, render ${d.render} ms, gap ${d.gap} ms): ${d.made.join(' ')}`);
  if (meta && meta.later && meta.later.length) {
    console.log(`  the page's queue, dearest tasks: ${meta.later.slice(0, 6).map((j) => `${j.name} ${j.ms} ms/${j.steps} (frame ${j.frame})`).join(', ')}`);
  }
  for (const line of g.lines) console.log(line);
  if (seconds !== 300) console.log(`(a run of ${seconds} s: a sample, not the five minutes the limits are for)`);
  return g.failed;
}

if (has('--node-only')) {
  selfTest();
  process.exit(0);
}
if (has('--gates')) {
  const kept = JSON.parse(readFileSync(opt('--gates'), 'utf8'));
  process.exit(report(kept.summary, kept.seconds, kept.meta) ? 1 : 0);
}

selfTest();
const server = spawn('node', [new URL('./serve.mjs', import.meta.url).pathname, String(PORT), ROOT], { stdio: ['ignore', 'ignore', 'inherit'] });
let failed = 0;
try {
  if (!(await waitForServer())) throw new Error(`no server on ${PORT}`);
  const page = await openPage(`seed=${SEED}&worldlen=2500&tier=high&style=${STYLES[0]}${AT ? `&s=${AT}` : ''}`);
  try {
    const meta = await page.run(`const gl = g.renderer.getContext(); const d = gl.getExtension('WEBGL_debug_renderer_info');
      return { gpu: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : '' };`);
    if (/SwiftShader|llvmpipe/i.test(meta.gpu || '')) throw new Error(`the frames are drawn by ${meta.gpu}, not a GPU`);
    const rec = await page.run(DRIVE(SECONDS, STYLES));
    if (rec.error) throw new Error(rec.error);
    Object.assign(meta, { size: rec.size, canvas: rec.canvas, tier: rec.tier, programs: rec.programs, distance: rec.distance, events: rec.events, later: rec.later });
    const summary = summarize(rec, SECONDS, SKIP);
    failed = report(summary, SECONDS, meta);
    if (page.logs.length) console.log('page errors:', page.logs.slice(0, 5).join(' | '));
    mkdirSync(dirname(resolve(WRITE)), { recursive: true });
    writeFileSync(WRITE, JSON.stringify({ seconds: SECONDS, skip: SKIP, seed: SEED, at: AT, styles: STYLES, limits: limitsFor(SECONDS), meta, summary,
      gaps: rec.frames.map((f) => round(f.gap, 2)) }) + '\n');
    console.log(`written: ${WRITE}`);
  } finally {
    page.close();
  }
} catch (e) {
  console.error(`hitch_check: ${e.message}`);
  failed = 1;
}
server.kill();
process.exit(failed ? 1 : 0);
