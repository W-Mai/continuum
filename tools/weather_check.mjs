// The weather changes from one world to the next the way weather does.
//
// Runs the page headless (seed 7) on a road of two worlds at a time, and walks
// a point along the road from well before the border to past it, reading the
// sky, the light and the weather round the camera (render/weather.js) every
// twelve metres, without drawing:
//  - nothing jumps: the most any of them (the sun, the exposure, the
//    horizon's colour overhead and in all twenty-four directions) moves in
//    twelve metres is a few hundredths of all the way from one world's to the
//    other's;
//  - the front is seen coming: at the start of the border the horizon ahead
//    is already part-way to the next world's, and the one behind is still the
//    last world's;
//  - the whole thing is the next world's once the border is past, and was the
//    last world's before the front showed.
//
// Usage: node tools/weather_check.mjs
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = 8185;
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

async function openPage(query) {
  const profile = `${tmpdir()}/continuum-weather-${process.pid}-${Date.now()}`;
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--window-size=800,450', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
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

// In the page: the first border of the road, walked from 2.4 km before it to
// 300 m past it.
const WALK = `
  const W = g.worlds;
  const o = g.road.origin;
  const top = g.road.classified * 2 - 4;
  let s0 = null, s1 = null;
  for (let s = 60; s < top; s += 4) {
    const p = g.road.at(s);
    if (!p) continue;
    const w = W.at(p.x + o.x, p.z + o.z);
    if (w.a !== w.b && w.t > 0.001) {
      if (s0 === null) s0 = s;
      s1 = s;
    } else if (s0 !== null) break;
  }
  if (s0 === null) return { error: 'no border on this road' };
  const R = await import('./src/render/ring.js');
  const N = R.RING_N;
  const at = (s) => {
    const p = g.road.at(s);
    g._updateLook(p.x, p.z, 0.02, true);
    const l = g._look;
    return { s, sun: l.sunIntensity, exp: l.exposure, hz: [l.horizon.r, l.horizon.g, l.horizon.b], ring: Array.from(R.ringU.uRingH.value) };
  };
  const from = Math.max(60, s0 - 2400);
  const rows = [];
  for (let s = from; s <= s1 + 300 && s < top; s += 12) rows.push(at(s));
  const fwd = Math.floor((Math.atan2(W.dz, W.dx) / (2 * Math.PI) + 0.5) * N) % N;
  const back = (fwd + N / 2) % N;
  const start = at(s0);
  return { s0, s1, rows, fwd, back, N, start, a: g._lookAt.a, b: g._lookAt.b };
`;

const PAIRS = [['hills', 'desert'], ['river', 'city'], ['city', 'cavern'], ['abyss', 'heaven'], ['heaven', 'space'], ['space', 'upside']];

let failed = 0;
const say = (ok, text) => {
  console.error(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};

const server = serve();
if (!(await waitForServer())) {
  console.error('FAIL: no server');
  server.kill();
  process.exit(1);
}
let exitCode = 0;
try {
  for (const [a, b] of PAIRS) {
    const page = await openPage(`seed=7&world=${a}&loop=${a},${b}&worldlen=4000&run=5&cam=chase`);
    const d = await page.run(WALK);
    page.close();
    if (d.error) {
      say(false, `${a} to ${b}: ${d.error}`);
      continue;
    }
    const rows = d.rows;
    const first = rows[0];
    const last = rows[rows.length - 1];
    // Each kind of number against how far it goes at all between the two
    // worlds (the most and the least it is anywhere on the walk, in the
    // sky and in every direction round), and the step in twelve metres as a
    // share of that.
    const classes = (r) => [[r.sun], [r.exp], [r.hz[0]], [r.hz[1]], [r.hz[2]],
      ...[0, 1, 2, 3].map((c) => Array.from({ length: d.N }, (_, k) => r.ring[k * 4 + c]))];
    const lo = classes(first).map(() => Infinity);
    const hi = classes(first).map(() => -Infinity);
    for (const r of rows) {
      classes(r).forEach((vs, i) => {
        for (const v of vs) {
          if (v < lo[i]) lo[i] = v;
          if (v > hi[i]) hi[i] = v;
        }
      });
    }
    let jump = 0;
    let where = 0;
    for (let k = 1; k < rows.length; k++) {
      const x = classes(rows[k - 1]);
      const y = classes(rows[k]);
      for (let i = 0; i < x.length; i++) {
        const range = hi[i] - lo[i];
        if (range < 0.03) continue;
        for (let j = 0; j < x[i].length; j++) {
          const f = Math.abs(y[i][j] - x[i][j]) / range;
          if (f > jump) {
            jump = f;
            where = rows[k].s;
          }
        }
      }
    }
    say(jump < 0.06, `${a} to ${b}: nothing jumps (the most in 12 m is ${(jump * 100).toFixed(1)} % of the way, at ${where} m)`);
    const hzA = first.hz;
    const hzB = last.hz;
    const l1 = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
    const way = l1(hzA, hzB);
    const bin = (r, k) => [r.ring[k * 4], r.ring[k * 4 + 1], r.ring[k * 4 + 2]];
    if (way > 0.08) {
      const ahead = l1(bin(d.start, d.fwd), hzA) / way;
      const behind = l1(bin(d.start, d.back), hzA) / way;
      say(ahead > 0.25, `${a} to ${b}: the front is seen coming (at the start of the border the horizon ahead is ${(ahead * 100).toFixed(0)} % of the way to the next world's)`);
      say(behind < 0.1, `${a} to ${b}: and behind it is still the last world's (${(behind * 100).toFixed(0)} % of the way)`);
    }
    const end = l1(last.hz, bin(last, d.fwd)) / Math.max(way, 0.08);
    say(end < 0.15, `${a} to ${b}: past the border it is all the next world's (the horizon ahead is within ${(end * 100).toFixed(0)} % of the sky overhead)`);
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
console.error('\nOK: the weather changes smoothly, is seen coming, and is the next world\'s once the border is past');
process.exit(exitCode);
