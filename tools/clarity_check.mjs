// The picture is clean and crisp, and what it asks of the machine is no more
// than it was.
//
// In node, without a browser:
//  - the pacer (render/pacing.js) draws on every refresh of a 60, 75, 90 or
//    100 Hz display, on every second of a 120 Hz one, on every second of a
//    144 Hz one (72 a second), on every third of a 165 Hz one and every
//    fourth of a 240 Hz one; it takes a machine too slow to keep up (every
//    frame a missed refresh) for slow and not for a 30 Hz display; cap=0
//    draws on every refresh and cap=30 on half of 60;
//  - the quality ladder (render/quality.js) stays where it is at the rate it
//    is asked for, a 56 Hz display's included, comes down on a machine that
//    cannot keep up, a hitch counts for nothing, and goes back up once the
//    ban on the level it left has run out.
//
// In the real page, headless (seed 7), in the alpine and the desert:
//  - the same frame is drawn as the 2x2-averaged frame drawn at twice the
//    size (what four samples to a pixel would give), by the old way (nothing
//    after the grade) and the new (render/present.js), at the canvas's size
//    and at three quarters of it brought up: the new is closer to it by at
//    least 0.4 dB of PSNR at the canvas's size and 0.3 at three quarters, has
//    the detail between the edges of the reference to within 10-15% at the
//    canvas's size, and at three quarters has back much of what the old way
//    lost; no more of it is clipped to black or white;
//  - on a screen of twice the pixels (a device pixel ratio of 2) the canvas
//    has them all, the scene is drawn at three quarters of its size, the last
//    pass is on and the frame has about the light of the one drawn at 1;
//  - the land drawn after everything else solid (so the depth buffer turns
//    away what it would only have had painted over) changes under 0.01% of the
//    frame's pixels by more than 8 levels, and the stone left out of the
//    meadow changes under 0.005% of them by more than 3;
//  - the stars in the space world (one pixel, or two side by side, drawn to
//    be points) are as bright as they were: the brightest hundred keep 95% of
//    their light;
//  - the canvas itself has no multisampling (nothing is drawn into it but one
//    picture).
//
// Usage: node tools/clarity_check.mjs
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Pacer } from '../src/render/pacing.js';
import { Quality } from '../src/render/quality.js';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = 8186;
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const say = (ok, text) => {
  console.error(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};

// --- the pacer ---------------------------------------------------------------

// A display at hz for `seconds`, its refreshes a little uneven. The rate
// drawn is that of the seconds after the first, when the pacer has had its
// look at the display.
function display(hz, seconds, cap = 60, shape = (i, gap) => gap) {
  const pacer = new Pacer(cap);
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  let t = 5000;
  let drawn = 0;
  const n = Math.round(hz * seconds);
  for (let i = 0; i < n; i++) {
    t += shape(i, 1000 / hz + (rnd() - 0.5) * 0.6);
    if (pacer.refresh(t) && i >= hz) drawn++;
  }
  return { every: pacer.every, fps: drawn / (seconds - 1), target: pacer.target, hz: pacer.hz };
}

for (const [hz, every, fps] of [[60, 1, 60], [75, 1, 75], [90, 1, 90], [100, 1, 100], [120, 2, 60], [144, 2, 72], [165, 3, 55], [240, 4, 60]]) {
  const r = display(hz, 6);
  say(r.every === every && Math.abs(r.fps - fps) < fps * 0.04 && r.target <= 60,
    `a ${hz} Hz display is drawn on every ${every === 1 ? 'refresh' : `${every}th refresh`} (${r.fps.toFixed(1)} a second, the ladder told to expect ${r.target.toFixed(0)})`);
}
{
  const slow = display(60, 8, 60, () => 33.3);
  say(slow.every === 1 && slow.target === 60 && slow.hz === 0,
    `a machine that misses every refresh (a gap of 33 ms) is not taken for a 30 Hz display (draws on every refresh, expects ${slow.target})`);
  const uncapped = display(120, 6, 0);
  say(uncapped.every === 1 && Math.abs(uncapped.fps - 120) < 5, `cap=0 draws a 120 Hz display on every refresh (${uncapped.fps.toFixed(0)} a second)`);
  const half = display(60, 6, 30);
  say(half.every === 2 && Math.abs(half.fps - 30) < 2, `cap=30 draws a 60 Hz display on every second refresh (${half.fps.toFixed(0)} a second)`);
  // A 120 Hz display with a slow stretch in it stays on every second refresh.
  const bumpy = display(120, 12, 60, (i, gap) => (i % 97 < 10 ? gap * 3 : gap));
  say(bumpy.every === 2, `a 120 Hz display with a stretch of slow frames still draws on every second refresh (every ${bumpy.every})`);
}

// --- the quality ladder ------------------------------------------------------

function ladder(target = 60) {
  const game = {
    scale: 1,
    detail: 1,
    setRenderScale(s) { this.scale = s; },
    setDetail(d) { this.detail = d; },
    atmosphere: { sun: { shadow: { mapSize: { x: 2048, set(x) { this.x = x; } }, map: null } } },
  };
  const q = new Quality(game, 1, target);
  const run = (fps, seconds, hitch = 0) => {
    for (let t = 0, i = 0; t < seconds; t += 1 / fps, i++) q.update(hitch && i % 40 === 0 ? hitch : 1 / fps);
  };
  return { q, game, run };
}
{
  const a = ladder();
  a.run(60, 40);
  say(a.q.level === 0, `60 frames a second holds the first level (level ${a.q.level})`);
  const b = ladder();
  b.run(40, 60);
  say(b.q.level === 4 && Math.abs(b.game.scale - 0.5) < 1e-9, `40 a second walks down to the last level, half the size (level ${b.q.level}, scale ${b.game.scale})`);
  const c = ladder(56);
  c.run(56, 40);
  say(c.q.level === 0, `a 56 Hz display, told so, is not too slow at 56 a second (level ${c.q.level})`);
  const d = ladder();
  d.run(54, 40);
  say(d.q.level >= 1, `...and 54 a second against 60 is (level ${d.q.level})`);
  const e = ladder();
  e.run(60, 20, 0.4);
  say(e.q.level === 0, `a hitch of 0.4 s every 40 frames is not held against the machine (level ${e.q.level})`);
  const f = ladder();
  f.run(40, 20);
  const down = f.q.level;
  f.run(60, 60);
  const still = f.q.level;
  f.run(60, 400);
  say(down >= 2 && still >= down - 1 && f.q.level < down, `a level left for being too slow is not tried again for a minute, and is once that has run out (level ${down}, a minute later ${still}, in the end ${f.q.level})`);
  const g = ladder(30);
  g.run(30, 40);
  say(g.q.level === 0, `told the display is at 30, 30 a second is not slow (level ${g.q.level})`);
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

async function openPage(query, flags = [], size = '1000,620') {
  const profile = `${tmpdir()}/continuum-clarity-${process.pid}-${Date.now()}`;
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', ...flags, `--window-size=${size}`, '--remote-debugging-port=0', `--user-data-dir=${profile}`,
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
  for (let i = 0; i < 600; i++) {
    title = await ev('document.title');
    if (title === 'GAME_DONE' || String(title).startsWith('GAME_FAIL')) break;
    await sleep(500);
  }
  if (title !== 'GAME_DONE') throw new Error(`page: ${title}`);
  return {
    run: async (body) => {
      const out = await ev(`(async () => { const g = game; ${body} })().then((v) => JSON.stringify(v), (e) => JSON.stringify({ error: e.message }))`);
      return JSON.parse(out);
    },
    close: () => {
      chrome.kill();
      setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
    },
  };
}

// In the page: the frame by the old way and the new, at the canvas's size and
// at three quarters of it, against the frame drawn at twice the size and
// brought down by averaging 2x2 (a bilinear tap at the corner of four).
const CLARITY = `
  const post = g.post;
  const P = post.present;
  const cv = g.canvas;
  const grab = () => {
    const c = document.createElement('canvas');
    c.width = cv.width;
    c.height = cv.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(cv, 0, 0);
    return x.getImageData(0, 0, c.width, c.height).data;
  };
  const draw = (scale, last) => {
    g.setRenderScale(scale);
    post.setStyle(g.style);
    if (!last) P.enabled = false;
    post.render(1 / 60);
    return grab();
  };
  const ref = draw(2, false);
  const w = cv.width;
  const h = cv.height;
  const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const edge = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let lo = 255;
      let hi = 0;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const l = luma(ref, ((y + j) * w + x + i) * 4);
          if (l < lo) lo = l;
          if (l > hi) hi = l;
        }
      }
      edge[y * w + x] = hi - lo > 40 ? 1 : 0;
    }
  }
  const stats = (d) => {
    let sq = 0, n = 0, dt = 0, dn = 0, clip = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 2; x++) {
        const i = (y * w + x) * 4;
        sq += ((d[i] - ref[i]) ** 2 + (d[i + 1] - ref[i + 1]) ** 2 + (d[i + 2] - ref[i + 2]) ** 2) / 3;
        n++;
        if (d[i] === 0 || d[i] === 255 || d[i + 1] === 0 || d[i + 1] === 255 || d[i + 2] === 0 || d[i + 2] === 255) clip++;
        if (!edge[y * w + x] && !edge[y * w + x + 1]) {
          dt += Math.abs(luma(d, i + 4) - luma(d, i));
          dn++;
        }
      }
    }
    return { psnr: 10 * Math.log10(255 * 255 / (sq / n)), detail: dt / dn, clip: clip / n };
  };
  const out = { size: [w, h], ref: stats(ref) };
  out.old = stats(draw(1, false));
  out.neu = stats(draw(1, true));
  out.old75 = stats(draw(0.75, false));
  out.new75 = stats(draw(0.75, true));
  g.setRenderScale(1);
  return out;
`;

// In the page: the same frame with the land drawn in material order, and with
// the stone worked out for every pixel of it.
const EQUIVALENT = `
  const grab = () => {
    g.render();
    const c = document.createElement('canvas');
    c.width = g.canvas.width;
    c.height = g.canvas.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(g.canvas, 0, 0);
    return x.getImageData(0, 0, c.width, c.height).data;
  };
  const diff = (a, b) => {
    let mx = 0, o3 = 0, o8 = 0;
    const n = a.length / 4;
    for (let i = 0; i < a.length; i += 4) {
      const m = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      if (m > mx) mx = m;
      if (m > 3) o3++;
      if (m > 8) o8++;
    }
    return { max: mx, over3: o3 / n, over8: o8 / n };
  };
  for (let i = 0; i < 3; i++) g.render();
  const now = grab();
  const again = grab();
  const orders = g.terrain.group.children.map((m) => m.renderOrder);
  g.terrain.group.children.forEach((m) => { m.renderOrder = 0; });
  const inOrder = grab();
  g.terrain.group.children.forEach((m, i) => { m.renderOrder = orders[i]; });
  const m = g.terrain.material;
  const orig = m.onBeforeCompile;
  const key = m.customProgramCacheKey;
  m.onBeforeCompile = (shader, r) => {
    orig(shader, r);
    shader.fragmentShader = shader.fragmentShader.replace('if (rockW > 0.002 || outcrop > 0.002) {', 'if (true) {');
  };
  m.customProgramCacheKey = () => key.call(m) + '-allrock';
  m.needsUpdate = true;
  for (let i = 0; i < 3; i++) g.render();
  const allRock = grab();
  return {
    rerender: diff(now, again), order: diff(now, inOrder), stone: diff(now, allRock),
    landLast: orders.length > 0 && orders.every((o) => o === 1), tiles: orders.length,
    antialias: g.renderer.getContextAttributes().antialias,
  };
`;

// In the page: how bright the points in the top of the sky are, drawn the old
// way and the new: the mean of the brightest hundred.
const POINTS = `
  const post = g.post;
  const P = post.present;
  const cv = g.canvas;
  const draw = (last) => {
    post.setStyle(g.style);
    if (!last) P.enabled = false;
    post.render(1 / 60);
    const c = document.createElement('canvas');
    c.width = cv.width;
    c.height = cv.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(cv, 0, 0);
    return x.getImageData(0, 0, c.width, c.height).data;
  };
  const brightest = (d) => {
    const w = cv.width;
    const luma = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const found = [];
    for (let y = 2; y < Math.min(200, cv.height - 2); y++) {
      for (let x = 2; x < w - 2; x++) {
        const l = luma((y * w + x) * 4);
        let bg = 0;
        for (const j of [-2, 0, 2]) for (const i of [-2, 0, 2]) if (i || j) bg += luma(((y + j) * w + x + i) * 4);
        if (l > bg / 8 + 40) found.push(l);
      }
    }
    found.sort((a, b) => b - a);
    const top = found.slice(0, 100);
    return { n: found.length, mean: top.reduce((a, b) => a + b, 0) / Math.max(1, top.length) };
  };
  const old = brightest(draw(false));
  const neu = brightest(draw(true));
  return { old, neu };
`;

// In the page: what a screen of twice the pixels gets, and its light.
const SCREEN = `
  g.render();
  const c = document.createElement('canvas');
  c.width = g.canvas.width;
  c.height = g.canvas.height;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(g.canvas, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
  const P = g.post.present;
  return {
    dpr: devicePixelRatio, css: [innerWidth, innerHeight], canvas: [g.canvas.width, g.canvas.height],
    scene: [g.post.size.x, g.post.size.y], renderScale: g.renderScale, drawRatio: g.drawRatio,
    scaled: P.scaled, on: P.enabled, aa: P.aa, sharp: P.sharp, luma: s / (d.length / 4),
  };
`;

const server = serve();
if (!(await waitForServer())) {
  console.error('FAIL: no server');
  server.kill();
  process.exit(1);
}
let exitCode = 0;
try {
  for (const world of ['alpine', 'desert']) {
    const page = await openPage(`seed=7&world=${world}&run=90&hideui=1`);
    const d = await page.run(CLARITY);
    const e = await page.run(EQUIVALENT);
    const s = await page.run(SCREEN);
    page.close();
    if (d.error || e.error) {
      say(false, `${world}: ${d.error || e.error}`);
      continue;
    }
    const f = (v, k = 2) => v.toFixed(k);
    say(d.neu.psnr - d.old.psnr >= 0.4,
      `${world}: at the canvas's size the frame is closer to four samples to a pixel (${f(d.old.psnr)} dB before, ${f(d.neu.psnr)} after)`);
    say(d.new75.psnr - d.old75.psnr >= 0.3,
      `${world}: brought up from three quarters it is closer too (${f(d.old75.psnr)} dB before, ${f(d.new75.psnr)} after)`);
    const keep = d.neu.detail / d.ref.detail;
    say(keep >= 0.9 && keep <= 1.15,
      `${world}: between the edges it has the detail of the reference (${f(keep * 100, 0)}%, the old way ${f(d.old.detail / d.ref.detail * 100, 0)}%)`);
    const back = d.new75.detail / d.old75.detail;
    say(back >= 1.08,
      `${world}: brought up from three quarters it has more of it than the old stretch (${f(back * 100, 0)}% of what the old way had; ${f(d.new75.detail / d.ref.detail * 100, 0)}% of the reference's)`);
    say(d.neu.clip - d.old.clip <= 0.003 && d.new75.clip - d.old75.clip <= 0.003,
      `${world}: no more of it is clipped to black or white (${f(d.old.clip * 100, 2)}% before, ${f(d.neu.clip * 100, 2)}% after)`);
    say(e.rerender.max === 0, `${world}: the same frame drawn twice is the same pixels (the comparisons below mean something)`);
    say(e.landLast && e.order.over8 < 0.0001,
      `${world}: the land (${e.tiles} tiles) drawn after everything solid changes ${f(e.order.over8 * 100, 4)}% of the pixels by more than 8 levels (the most ${e.order.max})`);
    say(e.stone.over3 < 0.00005,
      `${world}: the stone left out of the meadow changes ${f(e.stone.over3 * 100, 4)}% of the pixels by more than 3 levels (the most ${e.stone.max})`);
    say(e.antialias === false, 'the canvas has no multisampling of its own');
  }

  // The stars of the space world.
  {
    const page = await openPage('seed=7&world=space&run=90&hideui=1');
    const d = await page.run(POINTS);
    page.close();
    if (d.error) {
      say(false, `space: ${d.error}`);
    } else {
      say(d.old.n > 100 && d.neu.mean >= d.old.mean * 0.95,
        `space: the stars are as bright as they were (the brightest hundred at ${(d.neu.mean / d.old.mean * 100).toFixed(1)}% of their light, ${d.neu.n} points against ${d.old.n})`);
    }
  }

  // A screen with twice the pixels, and a page of the same shape on one with
  // the pixels it has always had.
  const one = await openPage('seed=7&world=alpine&run=60&hideui=1', [], '640,520');
  const lumaAt1 = (await one.run(SCREEN)).luma;
  one.close();
  const page = await openPage('seed=7&world=alpine&run=60&hideui=1', ['--force-device-scale-factor=2'], '640,520');
  const s = await page.run(SCREEN);
  page.close();
  if (s.error) {
    say(false, `device pixel ratio 2: ${s.error}`);
  } else {
    say(s.dpr === 2 && s.canvas[0] === s.css[0] * 2, `a screen of twice the pixels: the canvas has all of them (${s.canvas[0]} x ${s.canvas[1]} for ${s.css[0]} x ${s.css[1]})`);
    say(Math.abs(s.renderScale - 0.75) < 1e-9 && Math.abs(s.scene[0] - s.canvas[0] * 0.75) <= 1 && s.drawRatio === 1.5,
      `the scene is drawn at three quarters of it, the 1.5 ratio it always was (${s.scene[0]} x ${s.scene[1]})`);
    say(s.scaled && s.on && s.aa > 0, 'the last pass is on, to clean it and bring it up');
    say(Math.abs(s.luma - lumaAt1) < lumaAt1 * 0.06, `its frame has the light of the one at 1 (${s.luma.toFixed(1)} against ${lumaAt1.toFixed(1)})`);
  }
} catch (e) {
  console.error(`FAIL: ${e.message}`);
  failed++;
  exitCode = 1;
} finally {
  server.kill();
}
if (failed) {
  console.error(`\n${failed} problem${failed > 1 ? 's' : ''}`);
  process.exit(1);
}
console.error('\nOK: clean and crisp, paced to the display, and no more to draw than before');
process.exit(exitCode);
