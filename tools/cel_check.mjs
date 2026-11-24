// The cel style (render/style.js) draws what it says it draws, in the places
// the look rules (tools/look/cel.json) cannot reach:
//  - the speed lines (render/drift.js): none below 33 m/s, a good many just
//    above it, never more than 40, more the faster the car goes, and only in
//    this style; drawn in the frame as thin white lines, not into the depth;
//  - the grass (render/grass.js): 0.6 of the painted style's blades, two rings
//    of them, no flowers, two tones a blade, and not drawn into the depth,
//    which the last pass draws its lines at; the painted style's own grass is
//    three rings with flowers, drawn into the depth;
//  - a change away from the style takes all of it with it: the grass, the
//    speed lines, the paired paints, the flat land and the bands of the sky.
//
// Usage: node tools/cel_check.mjs
// PORT=8199 moves the server it starts. CHROME=/path/to/chrome overrides the browser.

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

const server = spawn('node', [ROOT + 'tools/serve.mjs', String(PORT), ROOT], { stdio: ['ignore', 'ignore', 'inherit'] });

async function waitForServer(tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) return true;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  return false;
}

// The page, headless, and a way to run code in it (game is the page's).
async function openPage(query) {
  const profile = `${tmpdir()}/continuum-cel-${process.pid}-${Date.now()}`;
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--mute-audio',
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
  ws.send(JSON.stringify({ id: 9999, method: 'Runtime.enable' }));
  const ev = (expression) => new Promise((resolve) => {
    pending.set(++id, (r) => resolve(r && r.result ? (r.result.value !== undefined ? r.result.value : r.result.description) : r));
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  });
  const close = () => {
    chrome.kill();
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
  };
  let title = '';
  for (let i = 0; i < 900; i++) {
    title = await ev('document.title');
    if (title === 'GAME_DONE' || String(title).startsWith('GAME_FAIL')) break;
    await sleep(500);
  }
  if (title !== 'GAME_DONE') {
    close();
    throw new Error(`page: ${title}`);
  }
  return {
    run: async (body) => JSON.parse(await ev(`(async () => { const g = game; ${body} })().then((v) => JSON.stringify(v), (e) => JSON.stringify({ error: e.message + ' ' + (e.stack || '').slice(0, 400) }))`)),
    close,
  };
}

const problems = [];
const say = (ok, line) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${line}`);
  if (!ok) problems.push(line);
};

// In the page: the car put on the road at s and run for a second and a half in a style.
const PLACE = (s, style) => `
  if (g.style.id !== ${JSON.stringify(style)}) { g.style.set(${JSON.stringify(style)}, true); g.style.applyScene(); }
  const p = g.road.at(${s});
  g.autoMode = true;
  g.sCar = ${s};
  g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(${s}, 1.9) + 0.3);
  g.car.vx = 22;
  g.setCamera('chase');
  g.chase.shaking = false;
  for (let i = 0; i < 90; i++) { g.pilot.vMax = 22; g.update(1 / 60); }
  g.post.setStyle(g.style);
  return { style: g.style.id };
`;

// In the page: how many speed lines there are with the car held at a speed (a few steps, so that the share has settled).
const LINES = (speed) => `
  for (let i = 0; i < 6; i++) { g.car.vx = ${speed}; g.update(1 / 60); }
  g.render();
  return { speed: g.car.speed, lines: g.drift.shown.speed, visible: g.drift.speed.visible, diag: g.snapshot().speedLines };
`;

// In the page: the frame with the speed lines and without them (their mesh put away), and how many pixels differ.
const LINE_PIXELS = (speed) => `
  for (let i = 0; i < 6; i++) { g.car.vx = ${speed}; g.update(1 / 60); }
  const canvas = document.getElementById('view');
  const read = () => {
    g.render();
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(canvas, 0, 0);
    return x.getImageData(0, 0, c.width, c.height).data;
  };
  const a = read();
  g.drift.speed.visible = false;
  const b = read();
  g.drift.speed.visible = true;
  let n = 0;
  let white = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) {
      n++;
      if (a[i] > 200 && a[i + 1] > 200 && a[i + 2] > 200) white++;
    }
  }
  return { differ: n / (canvas.width * canvas.height), white: n ? white / n : 0 };
`;

// In the page: what the grass is in this style.
const GRASS = `
  g.render();
  const meshes = g.grass.rings.map((r) => r.mat.depthWrite);
  return { visible: g.grass.group.visible, blades: g.grass.stats.blades, flowers: g.grass.stats.flowers,
    rings: g.grass.rings.length, near: g.grass.rings[0].geo.userData.blades, order: g.grass.rings.map((r) => r.mesh.renderOrder),
    flowerMesh: g.grass.flowers.mesh.visible, depthWrite: meshes, tones: g.grass.uniforms.uTwo.value.toArray() };
`;

try {
  if (!(await waitForServer())) throw new Error('server did not start');
  const page = await openPage('seed=7&world=hills&s=5000&cam=chase&style=cel&run=60');
  try {
    await page.run(PLACE(5000, 'cel'));

    // The speed lines.
    const at = {};
    for (const v of [20, 33, 36, 44, 56]) at[v] = await page.run(LINES(v));
    say(at[20].lines === 0 && !at[20].visible, `cel: no speed lines at 20 m/s (${at[20].lines})`);
    say(at[33].lines === 0, `cel: none yet at 33 m/s (${at[33].lines})`);
    say(at[36].lines >= 15 && at[36].lines <= 40 && at[36].diag === at[36].lines, `cel: 15 to 40 speed lines at 36 m/s (${at[36].lines}, the page says ${at[36].diag})`);
    say(at[44].lines > at[36].lines && at[56].lines >= at[44].lines, `cel: more of them the faster the car goes (${at[36].lines} at 36, ${at[44].lines} at 44, ${at[56].lines} at 56 m/s)`);
    say(at[56].lines <= 40, `cel: never more than 40 (${at[56].lines} at 56 m/s)`);
    const px = await page.run(LINE_PIXELS(44));
    say(px.differ > 0.0003 && px.differ < 0.03, `cel: they are in the frame, thin: ${(px.differ * 100).toFixed(2)} % of its pixels differ without them`);
    say(px.white > 0.3, `cel: white lines (${(px.white * 100).toFixed(0)} % of the pixels they change are white)`);

    // The grass.
    const cel = await page.run(GRASS);
    say(cel.visible && cel.blades > 10000, `cel: grass by the road (${cel.blades} blades)`);
    say(!cel.flowerMesh && cel.flowers === 0, `cel: no flowers in the grass (${cel.flowers})`);
    say(cel.depthWrite.every((d) => d === false) && cel.order.every((o) => o > 1), `cel: the blades are not drawn into the depth, and after the land (${cel.depthWrite}, render order ${cel.order})`);
    say(cel.tones[0] < 0.5 && cel.tones[1] < 1, `cel: a blade is two tones, its foot the darker (steps at ${cel.tones[0]}, foot ${cel.tones[1]})`);

    // The painted style next to it: all the blades, the flowers, a colour that runs up a blade, speed lines never.
    await page.run(PLACE(5000, 'paint'));
    const paint = await page.run(GRASS);
    say(paint.near > 0 && Math.abs(cel.near / paint.near - 0.6) < 0.05, `paint: the cel style has 0.6 of its blades to the metre (${cel.near} of ${paint.near} in the nearest ring, ${(cel.near / paint.near).toFixed(3)})`);
    say(cel.rings === 2 && paint.rings === 3, `paint: three rings of blades, the cel style the two nearer (${paint.rings}, ${cel.rings})`);
    say(paint.flowers > 0 && paint.flowerMesh, `paint: flowers in the grass (${paint.flowers})`);
    say(paint.depthWrite.every((d) => d === true) && paint.order.every((o) => o === 0), `paint: its blades are drawn into the depth, in the default order (${paint.depthWrite}, render order ${paint.order})`);
    const p36 = await page.run(LINES(36));
    say(p36.lines === 0 && !p36.visible, `paint: no speed lines at 36 m/s (${p36.lines})`);

    // A change away from the style takes its grass and its lines.
    await page.run(PLACE(5000, 'real'));
    const real = await page.run(LINES(36));
    say(real.lines === 0 && !real.visible, `real: no speed lines at 36 m/s (${real.lines})`);
    const g2 = await page.run('g.render(); return { grass: g.grass.group.visible, real: !!(g.grass.kind && g.grass.kind.real), two: !!(g.grass.kind && g.grass.kind.two), pair: g.style.cur.pair, flatLand: g.style.cur.flatLand, skyStep: g.style.cur.skyStep };');
    say(g2.real && !g2.two && g2.pair === 0 && g2.flatLand === 0 && g2.skyStep === 0, `real after cel: its own blades and not the cel's two tones, no paints, flat land or sky bands (${JSON.stringify(g2)})`);
  } finally {
    page.close();
  }
} catch (e) {
  say(false, String(e.stack || e));
} finally {
  server.kill();
}
console.log(problems.length ? `\n${problems.length} FAILED` : '\nall passed');
process.exit(problems.length ? 1 : 0);
