// The real style's motion blur at speed (render/lens.js).
//
// In node, without a browser:
//  - the setting (ui/settings.js, blur): on by default, off where the system asks
//    for less motion, on in a headless run, blur=0 and blur=1 in the address hold
//    it (and the panel cannot change it), what was chosen before is kept as 0 or 1;
//    the panel has a row for it and the interface its name in both languages.
//
// In the real page, headless (seed 7, the alpine valley at 5000 m, the car at
// 40 m/s, the chase lens with its shake and its look into the bends held off), the
// same moment drawn with the blur off and on:
//  - its numbers (render/lens.js, BLUR): it comes in from 25 m/s, six taps, a way of
//    12 pixels at most (in a frame of 720 rows), the high and the middle tier draw it
//    and the low does not;
//  - the car's pixels (marked in the scene's alpha while it is drawn) are the same,
//    pixel for pixel, in the frame as the final grade leaves it (the last pass's edge
//    search follows an edge for up to twenty pixels, and on the screen a few pixels of
//    the car's own edges take what is blurred beyond it: written out, not held);
//  - the rest of the frame is blurred: a good share of its pixels change;
//  - the frame with it off is the frame of a page that has none (no pass, no mark);
//  - on, it adds two draws and two programs and no more; at 20 m/s, in the hood
//    lens, with the setting off, in another style, in the low tier and in the photo
//    mode it is not drawn; a cut (the lens put somewhere else at once) has none;
//  - dispose lets go of its two targets.
//
// Usage: node tools/lens_check.mjs
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Settings, KEYS } from '../src/ui/settings.js';
import { TABLES } from '../src/ui/strings.js';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8197;
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const say = (ok, text) => {
  console.error(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};

// --- in node -------------------------------------------------------------------

{
  const store = (o = {}) => ({ getItem: (k) => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = v; } });
  const p = (q) => new URLSearchParams(q);
  say(new Settings({}).get('blur') === true, 'the setting is on by default');
  say(new Settings({ reduceMotion: true }).get('blur') === false, 'off where the system asks for less motion');
  say(new Settings({ run: true, reduceMotion: true }).get('blur') === true, 'on in a headless run');
  const off = new Settings({ params: p('blur=0'), reduceMotion: false });
  say(off.get('blur') === false && off.locked('blur') && off.set('blur', true) === false, 'blur=0 in the address holds it off and the panel cannot change it');
  say(new Settings({ params: p('blur=1'), reduceMotion: true }).get('blur') === true, 'blur=1 holds it on');
  const kept = {};
  const s = new Settings({ storage: store(kept) });
  s.set('blur', false);
  say(kept[KEYS.blur] === '0' && new Settings({ storage: store(kept) }).get('blur') === false, `what was chosen is kept (${KEYS.blur} = ${kept[KEYS.blur]})`);
  const html = readFileSync(ROOT + 'index.html', 'utf8');
  say(/<div class="row" data-key="blur">/.test(html), 'the panel has a row for it');
  say(TABLES.zh['set.blur'] === '运动模糊' && TABLES.en['set.blur'] === 'Motion blur', `its name: ${TABLES.zh['set.blur']}, ${TABLES.en['set.blur']}`);
}

// --- the page ------------------------------------------------------------------

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

async function openPage(query) {
  const profile = `${tmpdir()}/continuum-lens-${process.pid}-${Date.now()}`;
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
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
  const close = () => {
    chrome.kill();
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
  };
  let title = '';
  for (let i = 0; i < 600; i++) {
    title = await ev('document.title');
    if (title === 'GAME_DONE' || String(title).startsWith('GAME_FAIL')) break;
    await sleep(500);
  }
  if (title !== 'GAME_DONE') {
    close();
    throw new Error(`page: ${title}`);
  }
  return {
    run: async (body) => {
      const out = await ev(`(async () => { const g = game; ${body} })().then((v) => JSON.stringify(v), (e) => JSON.stringify({ error: e.message + ' ' + (e.stack || '').slice(0, 300) }))`);
      return JSON.parse(out);
    },
    close,
  };
}

// In the page: the car put on the road and run at 40 m/s, the lens as look.mjs has it; the same
// moment drawn with the blur off and on, the car's mark read from the scene's alpha.
const BLURRED = `
  const { BLUR } = await import('./src/render/lens.js');
  const S = 5000, V = 40;
  const p = g.road.at(S);
  g.autoMode = true;
  g.sCar = S;
  g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(S, 1.9) + 0.3);
  g.car.vx = V;
  g.setCamera('chase');
  g.chase.shaking = false;
  g.chase.lead = false;
  g.chase.snapTo(g.car, g.car.y || 0);
  // (The autopilot would slow for the bends: the car is held at the speed.)
  for (let i = 0; i < 150; i++) { g.pilot.vMax = V; g.car.vx = V; g.update(1 / 60); }
  const post = g.post, r = g.renderer, cv = g.canvas;
  const grab = () => {
    const c = document.createElement('canvas');
    c.width = cv.width;
    c.height = cv.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(cv, 0, 0);
    return x.getImageData(0, 0, c.width, c.height).data;
  };
  // raw: the frame as the final grade leaves it, the last pass (whose edge search reads up to
  // twenty pixels along an edge) not drawn.
  const draw = (on, raw = false) => {
    g.blurOn = on;
    g.render(1 / 60);
    if (raw) {
      post.setStyle(g.style);
      post.present.enabled = false;
      post.render(1 / 60);
    }
    return { px: grab(), calls: r.info.render.calls, programs: r.info.programs.length, drawn: post.blur.enabled && post.blur.ready, mark: (await_mark()) };
  };
  // The scene's alpha (half floats), the bottom row first.
  function await_mark() {
    const t = post.tap.target;
    const half = new Uint16Array(t.width * t.height * 4);
    r.readRenderTargetPixels(t, 0, 0, t.width, t.height, half);
    return { w: t.width, h: t.height, half };
  }
  const off0 = draw(false);
  const on = draw(true);
  const off = draw(false);
  const rawOn = draw(true, true);
  const rawOff = draw(false, true);
  const w = cv.width, h = cv.height;
  const f16 = (u) => { const e = (u >> 10) & 31, m = u & 1023; return e === 0 ? m / 1024 * 2 ** -14 : (1 + m / 1024) * 2 ** (e - 15); };
  const m = on.mark;
  const car = new Uint8Array(w * h);
  let marked = 0, markedOff = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((h - 1 - y) * w + x) * 4 + 3;
    const a = f16(m.half[i]);
    if (a >= 0.38 && a < 0.62) { car[y * w + x] = 1; marked++; }
    const b = f16(off.mark.half[i]);
    if (b >= 0.38 && b < 0.62) markedOff++;
  }
  // Every pixel of the car, before the last pass.
  let carDiffer = 0, carMost = 0;
  for (let k = 0; k < w * h; k++) if (car[k]) {
    const q = k * 4;
    const d = Math.max(Math.abs(rawOn.px[q] - rawOff.px[q]), Math.abs(rawOn.px[q + 1] - rawOff.px[q + 1]), Math.abs(rawOn.px[q + 2] - rawOff.px[q + 2]));
    if (d) carDiffer++;
    carMost = Math.max(carMost, d);
  }
  // On the screen, two pixels in from the outline.
  let inner = 0, differ = 0, most = 0, changed = 0, rest = 0;
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const k = y * w + x;
    let all = 1;
    for (let j = -2; j <= 2 && all; j++) for (let i = -2; i <= 2; i++) if (!car[k + j * w + i]) { all = 0; break; }
    const q = k * 4;
    const d = Math.max(Math.abs(on.px[q] - off.px[q]), Math.abs(on.px[q + 1] - off.px[q + 1]), Math.abs(on.px[q + 2] - off.px[q + 2]));
    if (all) {
      inner++;
      if (d) differ++;
      most = Math.max(most, d);
    } else if (!car[k]) {
      rest++;
      if (d > 2) changed++;
    }
  }
  let same = 0;
  for (let i = 0; i < off.px.length; i++) if (off.px[i] !== off0.px[i]) same++;
  const speed = g.car.speed;
  // What turns it off: each in turn, from the same moment.
  const offWhen = {};
  const tryIt = (name, set, unset) => {
    g.blurOn = true;
    set();
    g.render(1 / 60);
    offWhen[name] = !(post.blur.enabled && post.blur.ready);
    unset();
  };
  tryIt('setting', () => { g.blurOn = false; }, () => {});
  const v0 = g.car.vx;
  tryIt('20 m/s', () => { g.car.vx = 20; }, () => { g.car.vx = v0; });
  const tier = g.style.tier;
  tryIt('low tier', () => { g.style.tier = 'low'; }, () => { g.style.tier = tier; });
  const framing = g.chase.framing;
  tryIt('hood lens', () => { g.chase.framing = 'hood'; }, () => { g.chase.framing = framing; });
  tryIt('photo mode', () => { g.photo.state = 'on'; }, () => { g.photo.state = 'off'; });
  // A cut: the lens moved 40 m at once between a step and the frame.
  tryIt('cut', () => { g.post.blur.remember(g.camera); g.camera.position.x += 40; g.camera.updateMatrixWorld(); }, () => { g.camera.position.x -= 40; g.camera.updateMatrixWorld(); });
  g.style.set('ink', true);
  g.style.applyScene();
  tryIt('ink', () => {}, () => {});
  g.style.set('real', true);
  g.style.applyScene();
  g.blurOn = true;
  g.render(1 / 60);
  const before = r.info.memory.textures;
  post.blur.dispose();
  const after = r.info.memory.textures;
  return {
    blur: BLUR, size: [w, h, m.w, m.h], carDiffer, carMost, speed, marked, markedOff, inner, differ, most, rest, changed, same, offWhen,
    drawn: [off0.drawn, on.drawn, off.drawn], calls: [off.calls, on.calls], programs: [off0.programs, on.programs], textures: [before, after],
  };
`;

const server = serve();
if (!(await waitForServer())) {
  console.error('FAIL: no server');
  server.kill();
  process.exit(1);
}
try {
  const page = await openPage('seed=7&world=alpine&s=5000&cam=chase&style=real&run=60&hideui=1');
  const d = await page.run(BLURRED);
  page.close();
  if (d.error) throw new Error(d.error);
  const B = d.blur;
  say(B.from === 25 && B.taps === 6 && B.most === 12 && B.rows === 720,
    `it comes in from ${B.from} m/s, ${B.taps} taps along a way of ${B.most} px at most in ${B.rows} rows`);
  say(B.tiers.high > 0 && B.tiers.mid > 0 && B.tiers.low === 0, 'the high and the middle tier draw it, the low does not');
  say(d.speed > B.full, `the car runs at ${d.speed.toFixed(1)} m/s, over ${B.full}, where all of the blur is drawn`);
  say(d.drawn[1] && !d.drawn[0] && !d.drawn[2], 'it is drawn with the setting on, and not with it off');
  say(d.marked > 1000 && d.markedOff === 0, `the car is marked in the scene's alpha while it is drawn (${d.marked} px), and not otherwise (${d.markedOff})`);
  say(d.size[0] === d.size[2] && d.size[1] === d.size[3], `the scene is drawn at the canvas's size (${d.size[0]} x ${d.size[1]})`);
  say(d.carDiffer === 0, `the car's pixels (all ${d.marked} of them) are the same with it on and off before the last pass (${d.carDiffer} differ, by ${d.carMost} at most)`);
  // (The last pass's edge search follows an edge up to twenty pixels and reads what is blurred
  // beyond the car: on the screen a few of the pixels on the car's own edges move.)
  console.error(`     on the screen, two pixels in from the outline: ${d.differ} of ${d.inner} differ, by ${d.most} at most`);
  say(d.changed / d.rest > 0.2, `the rest of the frame is blurred (${(d.changed / d.rest * 100).toFixed(1)}% of its pixels change by more than 2 levels)`);
  say(d.same === 0, 'off, the frame is the same before and after it was drawn on');
  say(d.calls[1] - d.calls[0] === 2, `on, it adds ${d.calls[1] - d.calls[0]} draws (${d.calls[0]} to ${d.calls[1]})`);
  say(d.programs[1] - d.programs[0] === 2, `and ${d.programs[1] - d.programs[0]} programs (${d.programs[0]} to ${d.programs[1]})`);
  for (const [name, isOff] of Object.entries(d.offWhen)) say(isOff, `not drawn: ${name}`);
  say(d.textures[0] - d.textures[1] === 2, `dispose lets go of its targets (${d.textures[0]} textures to ${d.textures[1]})`);
} catch (e) {
  console.error(`FAIL: ${e.message}`);
  failed++;
} finally {
  server.kill();
}
if (failed) {
  console.error(`\n${failed} problem${failed > 1 ? 's' : ''}`);
  process.exit(1);
}
console.error('\nOK: the lens blurs what it sweeps past at speed, and never the car');
