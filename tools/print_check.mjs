// The print style (render/style.js) draws what it says it draws, in the places
// the look rules (tools/look/print.json) cannot reach. In the real page, headless:
//  - the inks: a frame of a day's world is in the six inks and the paper, the
//    steps of its sky and the three tones of its clouds, and next to nothing
//    else; each world has the inks of its look, and between two worlds they are
//    the mean of the two;
//  - the plates of colour stand off the key line: a frame with the offset and
//    the same frame without it are the same but within a few pixels of a line,
//    and the offset leaves a thread of bare paper beside the lines that there is
//    not without it;
//  - the grain of the wood is a few hundredths of the colour, in the flat of
//    the ground and the sky, it breaks none of the frame's flat colour, and
//    nothing else in the frame moves with it; the low tier has none of it, and
//    the plates in register;
//  - what the scene costs: the print draws what the cel style does, less its
//    grass;
//  - a change away from the style takes all of it with it.
//
// Usage: node tools/print_check.mjs
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
const PORT = Number(process.env.PORT) || 8179;
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
  const profile = `${tmpdir()}/continuum-print-${process.pid}-${Date.now()}`;
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
  g.chase.lead = false;
  g.chase.snapTo(g.car, g.car.y || 0);
  for (let i = 0; i < 90; i++) { g.pilot.vMax = 22; g.update(1 / 60); }
  g.post.setStyle(g.style);
  return { style: g.style.id };
`;

// In the page: what the scene costs in the style it is drawn in. The sun's far shadow map is drawn in every other
// frame (render/atmosphere.js), and a frame that draws it has more calls and triangles than one that does not, so
// the frame counted is the first that draws it and keeps the count of it: two styles are always counted in the
// same phase. (The grass, at a place it has not drawn at, draws the scene once into a target of one pixel for the
// sun's shadow maps and clears the count after it: that frame draws the far map and does not count it.)
const COST = `
  const a = g.atmosphere;
  const info = g.renderer.info;
  const reset = info.reset;
  let drawn = false;
  let lost = false;
  a._farDrawn = function () { drawn = true; return Object.getPrototypeOf(this)._farDrawn.call(this); };
  info.reset = function () { if (drawn) lost = true; return reset.call(this); };
  let out = null;
  for (let i = 0; i < 8 && !out; i++) {
    if (a._farOn) a._farDue = true;
    drawn = false;
    lost = false;
    g.render();
    if ((drawn && !lost) || !a._farOn) out = { calls: info.render.calls, triangles: info.render.triangles, programs: info.programs ? info.programs.length : null };
  }
  delete a._farDrawn;
  info.reset = reset;
  return out || { error: 'no frame of eight drew the far shadow map and kept the count of it' };
`;

// In the page: the frame as the canvas has it, as numbers kept in the page (window.__frames[name]).
const FRAME = (name) => `
  g.render();
  const canvas = document.getElementById('view');
  const c = document.createElement('canvas');
  c.width = canvas.width;
  c.height = canvas.height;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(canvas, 0, 0);
  const data = cx.getImageData(0, 0, c.width, c.height).data;
  (window.__frames = window.__frames || {})[${JSON.stringify(name)}] = { w: c.width, h: c.height, data };
  return { w: c.width, h: c.height };
`;

// In the page: how much of a frame is the style's colours: of its pixels, the share within 0.05 of OKLab
// of a colour the style prints (the inks, the paper, the steps of the sky, a cloud's tones; the paper and
// the inks a few hundredths lighter or darker for the grain).
const INKS = (name) => `
  const f = window.__frames[${JSON.stringify(name)}];
  const m = await import('./src/render/style.js');
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const lab = (r, g, b) => {
    const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const mm = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    return [0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s];
  };
  const paper = g.style.cur.paper;
  const inks = [];
  for (let i = 0; i < 6; i++) inks.push([m.PRINT_INKS[i * 3], m.PRINT_INKS[i * 3 + 1], m.PRINT_INKS[i * 3 + 2]]);
  const pale = m.PRINT_CLOUD.pale;
  const shade = pale.map((v, i) => v + (inks[0][i] - v) * m.PRINT_CLOUD.shade);
  const colours = [...inks, paper, pale, shade];
  // The steps of the sky: the paper and the first ink, a third, two thirds, all.
  for (const t of [1 / 3, 2 / 3]) colours.push(paper.map((v, i) => v + (inks[0][i] - v) * t));
  // The same a few hundredths lighter and darker: the grain.
  const all = [];
  for (const k of [0.95, 1, 1.05]) for (const c of colours) all.push(lab(Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)));
  let near = 0;
  for (let i = 0; i < f.data.length; i += 4) {
    const L = lab(f.data[i] / 255, f.data[i + 1] / 255, f.data[i + 2] / 255);
    let best = 9;
    for (const q of all) {
      const d = Math.hypot(L[0] - q[0], L[1] - q[1], L[2] - q[2]);
      if (d < best) best = d;
    }
    if (best < 0.05) near++;
  }
  return { share: near / (f.w * f.h) };
`;

try {
  if (!(await waitForServer())) throw new Error('server did not start');
  const page = await openPage('seed=7&world=hills&s=5000&cam=chase&style=print&run=60');
  try {
    // The inks of a frame.
    await page.run(PLACE(5000, 'print'));
    await page.run(FRAME('print'));
    const inks = await page.run(INKS('print'));
    say(inks.share > 0.9, `print: the frame is the style's colours: ${(inks.share * 100).toFixed(1)} % of its pixels are within 0.05 of an ink, the paper, a step of the sky or a tone of a cloud`);

    // The numbers of the style in the page.
    const nums = await page.run('const c = g.style.cur; return { print: c.print, pair: c.pair, flat: c.flat, line: c.line, key: c.key, regist: c.regist, wood: c.wood, wantFlat: g.post.stylePass.wantFlat, grass: g.grass.group.visible };');
    say(nums.print === 1 && nums.pair === 1 && nums.flat === 0 && nums.line === 0 && nums.key === 1 && nums.regist >= 1 && nums.wood > 0 && nums.wantFlat === false,
      `print: the paints in two, no flat colour pass, its own key plate (${JSON.stringify(nums)})`);
    say(nums.grass === false, 'print: no grass');

    // The plates of colour stand off the key plate: the frame with the offset and without it, and with no key
    // plate at all, for where the lines are (the pixels the key plate changes, in either frame).
    await page.run('window.__key = g.style.cur.key; g.style.cur.key = 0; return 0;');
    await page.run(FRAME('nokey'));
    await page.run('g.style.cur.key = window.__key; window.__regist = g.style.cur.regist; g.style.cur.regist = 0; return 0;');
    await page.run(FRAME('aligned'));
    await page.run('g.style.cur.regist = window.__regist; return 0;');
    await page.run(FRAME('off'));
    const reg = await page.run(`
      const a = window.__frames.aligned;
      const b = window.__frames.off;
      const c = window.__frames.nokey;
      const w = a.w, h = a.h;
      const same = (p, q, i) => p.data[i * 4] === q.data[i * 4] && p.data[i * 4 + 1] === q.data[i * 4 + 1] && p.data[i * 4 + 2] === q.data[i * 4 + 2];
      const dark = (f, i) => f.data[i * 4] + f.data[i * 4 + 1] + f.data[i * 4 + 2] < 3 * 70;
      // Where a line is, in either frame: the pixels within 3 of one the key plate changes.
      const near = new Uint8Array(w * h);
      let lines = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (same(a, c, i) && same(b, c, i)) continue;
        lines++;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) near[yy * w + xx] = 1;
        }
      }
      let far = 0, farSame = 0;
      for (let i = 0; i < w * h; i++) if (!near[i]) { far++; if (same(a, b, i)) farSame++; }
      // The paper bare beside a line: a pixel the colour of the paper, with a dark one to its left or above it.
      const paper = g.style.cur.paper.map((v) => v * 255);
      const isPaper = (f, i) => Math.abs(f.data[i * 4] - paper[0]) + Math.abs(f.data[i * 4 + 1] - paper[1]) + Math.abs(f.data[i * 4 + 2] - paper[2]) < 36;
      const bare = (f) => {
        let n = 0;
        for (let y = 1; y < h; y++) for (let x = 1; x < w; x++) {
          const i = y * w + x;
          if (isPaper(f, i) && (dark(f, i - 1) || dark(f, i - w))) n++;
        }
        return n;
      };
      return { farSame: farSame / far, far: far / (w * h), lines: lines / (w * h), bareAligned: bare(a), bareOff: bare(b) };
    `);
    say(reg.lines > 0.005 && reg.lines < 0.15, `print: a key plate of lines (${(reg.lines * 100).toFixed(1)} % of the frame is changed by it)`);
    say(reg.farSame > 0.9999,`print: the plates are laid off the key plate by a displacement and nothing else: ${(reg.farSame * 100).toFixed(3)} % of the pixels more than 3 from a line (${(reg.far * 100).toFixed(0)} % of the frame) are as they are with no offset`);
    say(reg.bareOff > reg.bareAligned * 1.5 && reg.bareOff > 200, `print: a thread of paper bare on one side of the lines (${reg.bareOff} pixels of paper with a line to the left or above, ${reg.bareAligned} with the plates aligned)`);

    // The grain: a few hundredths of the colour, in the flat of the land, and the frame is otherwise the same.
    await page.run('window.__wood = g.style.cur.wood; g.style.cur.wood = 0; return 0;');
    await page.run(FRAME('plain'));
    await page.run('g.style.cur.wood = window.__wood; return 0;');
    await page.run(FRAME('grained'));
    const wood = await page.run(`
      const a = window.__frames.plain;
      const b = window.__frames.grained;
      let differ = 0, big = 0, sum = 0;
      for (let i = 0; i < a.w * a.h; i++) {
        const d = Math.max(Math.abs(a.data[i * 4] - b.data[i * 4]), Math.abs(a.data[i * 4 + 1] - b.data[i * 4 + 1]), Math.abs(a.data[i * 4 + 2] - b.data[i * 4 + 2]));
        if (d > 0) { differ++; sum += d; }
        if (d > 14) big++;
      }
      // The share of a frame that is flat: a pixel within 0.008 of L (OKLab) of each of its four neighbours.
      const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      const flatOf = (f) => {
        const L = new Float32Array(f.w * f.h);
        for (let i = 0; i < L.length; i++) {
          const r = lin(f.data[i * 4] / 255), g = lin(f.data[i * 4 + 1] / 255), bl = lin(f.data[i * 4 + 2] / 255);
          const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
          L[i] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
        }
        let k = 0, c = 0;
        for (let y = 1; y < f.h - 1; y++) for (let x = 1; x < f.w - 1; x++) {
          const i = y * f.w + x;
          c++;
          if (Math.abs(L[i] - L[i - 1]) < 0.008 && Math.abs(L[i] - L[i + 1]) < 0.008 && Math.abs(L[i] - L[i - f.w]) < 0.008 && Math.abs(L[i] - L[i + f.w]) < 0.008) k++;
        }
        return k / c;
      };
      return { differ: differ / (a.w * a.h), big: big / (a.w * a.h), mean: differ ? sum / differ : 0, flatPlain: flatOf(a), flatGrained: flatOf(b) };
    `);
    say(wood.differ > 0.02 && wood.differ < 0.8, `print: a grain in a part of the frame: ${(wood.differ * 100).toFixed(1)} % of its pixels change with it`);
    say(wood.big < 0.002, `print: and it is a few hundredths of the colour (${(wood.big * 100).toFixed(3)} % of the pixels change by more than 14 of 255, the mean change ${wood.mean.toFixed(1)})`);
    say(wood.flatGrained > wood.flatPlain - 0.012, `print: and it breaks none of the flat colour: ${(wood.flatGrained * 100).toFixed(1)} % of the pixels are flat with it, ${(wood.flatPlain * 100).toFixed(1)} % without`);

    // The low tier prints without the grain and with the plates in register.
    const tiers = await page.run(`
      const u = g.post.stylePass.uniforms;
      g.render();
      const high = { wood: u.uWood.value, regist: u.uRegist.value };
      g.style.tier = 'low';
      g.render();
      const low = { wood: u.uWood.value, regist: u.uRegist.value };
      g.style.tier = 'high';
      g.render();
      return { high, low };
    `);
    say(tiers.high.wood > 0 && tiers.high.regist >= 1 && tiers.low.wood === 0 && tiers.low.regist === 0, `print: the low tier has no grain and no offset, the high tier has both (${JSON.stringify(tiers)})`);

    // What the scene costs, against the cel style that it is laid on.
    await page.run(PLACE(5000, 'cel'));
    const cel = await page.run(COST);
    await page.run(PLACE(5000, 'print'));
    const print = await page.run(COST);
    await page.run(PLACE(5000, 'real'));
    const real = await page.run(COST);
    const lost = [cel, print, real].find((c) => c.error);
    say(!lost, `print: the cost of each style is of a frame that draws the sun's far shadow map${lost ? ` (${lost.error})` : ''}`);
    if (!lost) {
      say(print.calls <= cel.calls && print.triangles <= cel.triangles, `print: draws what the cel style does, less its grass (${print.calls} calls and ${print.triangles} triangles, the cel style's ${cel.calls} and ${cel.triangles})`);
      say(print.calls <= real.calls + 2 && print.triangles <= real.triangles * 1.001, `print: and about what the real style does (the real style's ${real.calls} calls and ${real.triangles} triangles)`);
    }

    // The inks of a look, and between two worlds' the mix of the two, by how far along the border the lens is.
    const looks = await page.run(`
      const m = await import('./src/render/worldlook.js');
      const w = await import('./src/render/style.js');
      const a = m.worldLook(0);
      const b = Object.assign({}, m.worldLook(1));
      b.print = Float32Array.from(a.print, (v) => 1 - v);
      const out = {};
      m.mixLooks(out, a, b, 0.25);
      const mixed = Array.from(out.print).every((v, i) => Math.abs(v - (a.print[i] * 0.75 + b.print[i] * 0.25)) < 1e-6);
      const same = Array.from(a.print).every((v, i) => Math.abs(v - w.PRINT_INKS[i]) < 1e-6);
      return { numbers: out.print.length, mixed, same };
    `);
    say(looks.error === undefined && looks.numbers === 18 && looks.mixed && looks.same, `print: a look's six inks mix across a border as the other numbers of a look do, and a world that says none has the page's (${JSON.stringify(looks)})`);

    // A change away from the style takes all of it with it.
    await page.run(PLACE(5000, 'real'));
    const gone = await page.run('g.render(); return { print: g.style.cur.print, pair: g.style.cur.pair, enabled: g.post.stylePass.enabled };');
    say(gone.print === 0 && gone.pair === 0 && gone.enabled === false, `real after print: no inks, no paints, no last pass (${JSON.stringify(gone)})`);
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
