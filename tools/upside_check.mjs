// The Upside Down (render/upside.js, render/twist.js).
//
// Runs the page headless in the shortened loop that goes from space into it
// (worlds 1500 m long), drives it from the page, and asserts:
//  - the world is there, last in the list, and its look is its own;
//  - the road turns over across a stretch of 40 to 300 m: before it, the
//    view is as it was; after it, it is turned half round (the angle at the
//    car is a half turn), steering is reversed, and the frame is the other
//    way up (the sky, which is the brighter, is at the bottom);
//  - while it turns the frustum test is off, and once it has turned it is
//    on again;
//  - in it there is lightning (a flash lights the sky) and things that
//    stand by the road and lean toward the car;
//  - every style draws the turned world without an error.
//
// Usage: node tools/upside_check.mjs
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
const PORT = 8181;
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// The page, headless, and a way to run code in it; errors the page logs
// come back with it.
async function openPage(query) {
  const profile = `${tmpdir()}/continuum-upside-${process.pid}-${Date.now()}`;
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--window-size=960,540', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
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
  for (let i = 0; i < 600; i++) {
    title = await ev('document.title');
    if (title === 'GAME_DONE' || String(title).startsWith('GAME_FAIL')) break;
    await sleep(500);
  }
  if (title !== 'GAME_DONE') throw new Error(`page: ${title}`);
  return {
    logs,
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

// In the page: where the share of the Upside Down along the road goes from
// nothing to all.
const FIND = `
  const o = g.road.origin;
  const top = g.road.classified * 2 - 4;
  let s0 = null, s1 = null;
  for (let s = 120; s < top; s += 4) {
    const p = g.road.at(s);
    if (!p) continue;
    const sh = g.upside.shareAt(p.x + o.x, p.z + o.z);
    if (s0 === null && sh > 0.03) s0 = s;
    if (s1 === null && sh > 0.97) s1 = s;
  }
  const list = g.worlds.list;
  const last = list[list.length - 1];
  return { s0, s1, last: last.id, lookUp: last.look.upside, count: list.length };
`;

// In the page: the car put on the road at s, running; what the view is like
// there. Mean brightness of the top and bottom thirds of the frame, as
// drawn, and again with the turn taken off (the same scene the way up it was).
const AT = (s, extra = '') => `
  const p = g.road.at(${s});
  g.autoMode = true;
  g.sCar = ${s};
  g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(${s}, 1.9) + 0.3);
  g.car.vx = 22;
  for (let i = 0; i < 90; i++) g.update(1 / 60);
  ${extra}
  const T = await import('./src/render/twist.js');
  const measure = async () => {
    g.render();
    const c = document.getElementById('view');
    const img = new Image();
    img.src = c.toDataURL('image/png');
    await img.decode();
    const w = img.width, h = img.height;
    const cv = new OffscreenCanvas(w, h);
    const cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0);
    const px = cx.getImageData(0, 0, w, h).data;
    const band = (y0, y1) => {
      let sum = 0, n = 0, hot = 0;
      for (let y = Math.floor(h * y0); y < Math.floor(h * y1); y += 2) for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * 4;
        const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
        sum += l; n++;
        if (l > 0.93) hot++;
      }
      return { mean: sum / n, hot };
    };
    return { top: band(0, 0.33), bottom: band(0.67, 1) };
  };
  const up = g.upside;
  const drawn = await measure();
  const state = { roll: up.roll, turning: up.turning, culledOff: up._culled.size, tentacles: up.mesh.count, flash: up.flash, share: up.share };
  const saved = Array.from(T.twistU.uTwistTab.value);
  T.setTwist(new Float32Array(16));
  const straight = await measure();
  T.setTwist(saved);
  return { ...state, top: drawn.top.mean, bottom: drawn.bottom.mean, hotBottom: drawn.bottom.hot, topStraight: straight.top.mean, bottomStraight: straight.bottom.mean };
`;

// In the page: a wheel held over for a second: which way the car turns.
const STEER = (s) => `
  const p = g.road.at(${s});
  g.autoMode = false;
  g.sCar = ${s};
  g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(${s}, 1.9) + 0.3);
  g.car.vx = 14;
  g.driver.read = () => ({ steer: 0.6, throttle: 0.3, brake: 0 });
  const y0 = g.car.yaw;
  for (let i = 0; i < 40; i++) g.update(1 / 60);
  const dy = g.car.yaw - y0;
  g.autoMode = true;
  return { dy };
`;

const failures = [];
function check(ok, text) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failures.push(text);
}
const f2 = (v) => (typeof v === 'number' ? v.toFixed(2) : String(v));

const server = serve();
try {
  if (!(await waitForServer())) throw new Error('the dev server did not come up');
  const page = await openPage('seed=7&world=space&worldlen=1500&run=60&cam=chase&style=real');
  try {
    const found = await page.run(FIND);
    check(found.last === 'upside' && found.count === 12 && found.lookUp === 1, `the Upside Down is the twelfth world, and its look is its own (${found.last}, ${found.count} worlds)`);
    const span = found.s1 - found.s0;
    check(found.s0 !== null && span >= 40 && span <= 300, `the road turns over across ${span} m (from ${found.s0} to ${found.s1})`);

    const mid = (found.s0 + found.s1) / 2;
    const before = await page.run(AT(found.s0 - 150));
    check(Math.abs(before.roll) < 0.05, `before the turn the view is as it was (turned ${f2(before.roll)} rad at the car)`);

    const during = await page.run(AT(mid - 10));
    check(during.turning && during.roll > 0.3 && during.roll < 2.9, `half way the road is turned about the line of sight (${f2(during.roll)} rad)`);
    check(during.culledOff > 100, `and the frustum test is off for what is drawn (${during.culledOff} meshes)`);

    const after = await page.run(AT(found.s1 + 120));
    check(Math.abs(after.roll - Math.PI) < 0.08, `in it the view is turned half round (${f2(after.roll)} rad)`);
    check(after.bottom > after.top && after.topStraight > after.bottomStraight,
      `the sky is the brighter, and now at the bottom, where turned back it is at the top (${f2(after.bottom)} under ${f2(after.top)}; ${f2(after.topStraight)} over ${f2(after.bottomStraight)})`);
    check(after.culledOff === 0, `once it has turned the frustum test is on again (${after.culledOff} meshes off)`);

    const up = await page.run(STEER(found.s0 - 150));
    const down = await page.run(STEER(found.s1 + 120));
    check(up.dy * down.dy < 0 && Math.abs(down.dy) > 0.05, `the wheel is turned the other way once it is over (${f2(up.dy)} rad, then ${f2(down.dy)})`);

    // A flash in it lights the sky, and there are things by the road.
    const flash = await page.run(AT(found.s1 + 120, `g.upside._next = 99; g.upside._age = 0.1;
      const d = new g.camera.position.constructor(); g.camera.getWorldDirection(d);
      g.upside.bolt.set(Math.atan2(d.z, d.x), 0.95, 31, 0); g.update(1 / 60);`));
    check(flash.flash > 0.3 && flash.hotBottom > 20, `a flash of lightning lights the sky (flash ${f2(flash.flash)}, ${flash.hotBottom} bright pixels)`);
    const tent = await page.run(AT(found.s1 + 300, 'for (let i = 0; i < 240; i++) g.update(1 / 60);'));
    check(tent.tentacles > 5, `things stand by the road (${tent.tentacles})`);
  } finally {
    page.close();
  }
  // Every style draws it.
  for (const style of ['paint', 'ink', 'cel', 'print', 'pixel', 'block']) {
    const p2 = await openPage(`seed=7&world=upside&run=90&cam=chase&style=${style}`);
    try {
      const r = await p2.run('g.render(); return { roll: g.upside.roll, style: g.style.id };');
      check(!r.error && Math.abs(r.roll - Math.PI) < 0.08 && p2.logs.length === 0, `${style} draws it, turned over, without an error${p2.logs.length ? ' (' + p2.logs[0] + ')' : ''}`);
    } finally {
      p2.close();
    }
  }
} finally {
  server.kill();
}

if (failures.length) {
  console.error(`\nFAILED: ${failures.length} check(s)`);
  process.exit(1);
}
console.log('\nOK: the road turns over on the way in, and the world is the other way up');
