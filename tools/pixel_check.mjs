// The pixel style (render/style.js, render/post.js) draws what it says it draws, in
// the places the look rules (tools/look/pixel.json) cannot reach:
//  - the grid: the canvas is cells of a block of whole pixels, the scene is drawn at
//    twice the cells across and up (640 by 360 on a 1920 by 1080 canvas, a ninth of its
//    pixels), brought down to the cells and laid out by the last pass; the sun's shadow
//    map is 1024 a side;
//  - the colours: every colour in a frame is one of the 24 of the world's palette, or
//    in a frame between two worlds, of the 48 of the two; a cell is a block of one
//    colour; the line round the car is the darkest grey of the palette;
//  - the change: a change into the style or out of it takes the scene through three
//    sizes in its 1.4 s, and no frame of it has a GL error;
//  - the grass: the outer ring of blades alone, half as many of them;
//  - the stars of a night are a cell wide, and a change away from the style takes all
//    of it with it: the grid, the shadow map, the grass and the width of a star.
//
// Usage: node tools/pixel_check.mjs
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
const PORT = Number(process.env.PORT) || 8181;
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
  const profile = `${tmpdir()}/continuum-pixel-${process.pid}-${Date.now()}`;
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

// In the page: the places along the road where the look is between two worlds, and how far (the palettes are the look's).
const BORDERS = `
  const lead = { a: 0, b: 0, t: 0 };
  const out = [];
  for (let s = 400; s < 30000; s += 100) {
    const p = g.road.at(s);
    if (!p) continue;
    g.worlds.at(p.x + g.road.origin.x + g.worlds.dx * 450, p.z + g.road.origin.z + g.worlds.dz * 450, lead);
    if (lead.a !== lead.b && lead.t > 0.3 && lead.t < 0.7) out.push([s, lead.a, lead.b, +lead.t.toFixed(2)]);
    if (out.length >= 3) break;
  }
  return out;
`;

// In the page: the frame as the canvas has it: how many colours, how many of its pixels
// are the colour of their cell, and how many colours are not in the palettes of the look
// (the world's behind and the world's ahead), the grid and the sizes it is drawn at, and
// the GL errors there were while it was.
const FRAME = `
  const gl = g.renderer.getContext();
  while (gl.getError() !== gl.NO_ERROR) { /* the ones from before */ }
  g.render();
  const errors = [];
  for (let e = gl.getError(), n = 0; e !== gl.NO_ERROR && n < 8; e = gl.getError(), n++) errors.push(e);
  const canvas = document.getElementById('view');
  const c = document.createElement('canvas');
  c.width = canvas.width;
  c.height = canvas.height;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(canvas, 0, 0);
  const d = cx.getImageData(0, 0, c.width, c.height).data;
  const w = c.width;
  const h = c.height;
  const grid = g.post._grid;
  const b = grid ? grid.block : 1;
  const seen = new Set();
  let same = 0;
  for (let y = 0; y < h; y++) {
    const y0 = h - 1 - Math.floor((h - 1 - y) / b) * b;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const j = (y0 * w + Math.floor(x / b) * b) * 4;
      if (d[i] === d[j] && d[i + 1] === d[j + 1] && d[i + 2] === d[j + 2]) same++;
      seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    }
  }
  const look = g._look;
  const inPalette = (pal) => {
    const s = new Set();
    if (pal) for (let k = 0; k < 24; k++) s.add((Math.round(pal.rgb[k * 3] * 255) << 16) | (Math.round(pal.rgb[k * 3 + 1] * 255) << 8) | Math.round(pal.rgb[k * 3 + 2] * 255));
    return s;
  };
  const A = inPalette(look.pixelA);
  const B = inPalette(look.pixelB);
  let outside = 0;
  for (const v of seen) if (!A.has(v) && !B.has(v)) outside++;
  const ink = look.pixelA ? (Math.round(look.pixelA.rgb[18 * 3] * 255) << 16) | (Math.round(look.pixelA.rgb[18 * 3 + 1] * 255) << 8) | Math.round(look.pixelA.rgb[18 * 3 + 2] * 255) : -1;
  // The cells of the darkest grey that have the car's colours beside them: the line round the car.
  const cols = grid ? grid.cols : 0;
  const rows = grid ? grid.rows : 0;
  const cell = (i, j) => {
    const x = Math.min(w - 1, i * b);
    const y = Math.max(0, h - 1 - j * b);
    const k = (y * w + x) * 4;
    return (d[k] << 16) | (d[k + 1] << 8) | d[k + 2];
  };
  let inked = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (cell(i, j) === ink) inked++;
  const st = g.snapshot();
  return {
    colours: seen.size, same: same / (w * h), outside, t: look.pixelT, errors,
    canvas: [w, h], scene: [g.post.size.x, g.post.size.y], grid: grid ? { block: grid.block, cols: grid.cols, rows: grid.rows, k: grid.k } : null,
    out: [g.post.pixelPass.out.width, g.post.pixelPass.out.height], level: g.post.pixelLevel, inked, cells: cols * rows,
    shadow: g.atmosphere.sun.shadow.mapSize.x, starPx: g.atmosphere.uniforms.uStarPx.value, world: st.world && st.world.id, pass: g.post.pixelPass.enabled,
  };
`;

// In the page: a change of style, stepped by hand in 1/15 s (the style's own numbers move, the
// world stands still): the size of the scene at each of its frames; a frame is drawn where the scene
// has a new size, and the GL errors of those are counted.
const CHANGE = (to) => `
  const gl = g.renderer.getContext();
  while (gl.getError() !== gl.NO_ERROR) { /* the ones from before */ }
  g.setStyle(${JSON.stringify(to)});
  const sizes = [];
  const levels = [];
  let errors = 0;
  let drawn = 0;
  let was = '';
  for (let i = 0; i < 24; i++) {
    if (g.style.update(1 / 15)) g.style.applyScene();
    g.post.setStyle(g.style);
    const size = g.post.size.x + 'x' + g.post.size.y;
    sizes.push(size);
    levels.push(g.post.pixelLevel);
    if (size !== was || i === 23) {
      was = size;
      g.render(1 / 15);
      drawn++;
      for (let e = gl.getError(), n = 0; e !== gl.NO_ERROR && n < 8; e = gl.getError(), n++) errors++;
    }
  }
  const distinct = [...new Set(sizes)];
  return { distinct, levels: [...new Set(levels)], changes: distinct.length - 1, errors, drawn, t: g.style.t, moving: g.style.moving, shadow: g.atmosphere.sun.shadow.mapSize.x };
`;

// In the page: a picture of the frame at twice the canvas's pixels (render/photo.js makes one by the
// chain's capture): the cells of it, as many pixels more to a cell, and the same cells as the canvas's own frame.
const PICTURE = `
  g.render();
  const canvas = document.getElementById('view');
  const c = document.createElement('canvas');
  c.width = canvas.width;
  c.height = canvas.height;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(canvas, 0, 0);
  const d = cx.getImageData(0, 0, c.width, c.height).data;
  const grid = g.post._grid;
  const W = canvas.width * 2;
  const H = canvas.height * 2;
  const pic = g.post.capture(W, H);
  const b2 = grid.block * 2;
  const seen = new Set();
  let same = 0;
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor(y / b2) * b2;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const j = (y0 * W + Math.floor(x / b2) * b2) * 4;
      if (pic.pixels[i] === pic.pixels[j] && pic.pixels[i + 1] === pic.pixels[j + 1] && pic.pixels[i + 2] === pic.pixels[j + 2]) same++;
      seen.add((pic.pixels[i] << 16) | (pic.pixels[i + 1] << 8) | pic.pixels[i + 2]);
    }
  }
  // The cell (i, j) of the picture and of the canvas's frame (rows from the bottom in the picture, from the top in the canvas).
  let cells = 0;
  let equal = 0;
  for (let j = 0; j < grid.rows; j++) {
    for (let i = 0; i < grid.cols; i++) {
      const p = ((j * b2) * W + i * b2) * 4;
      const y = Math.max(0, canvas.height - 1 - j * grid.block);
      const q = (y * canvas.width + Math.min(canvas.width - 1, i * grid.block)) * 4;
      cells++;
      if (pic.pixels[p] === d[q] && pic.pixels[p + 1] === d[q + 1] && pic.pixels[p + 2] === d[q + 2]) equal++;
    }
  }
  return { size: [pic.width, pic.height], block: b2, same: same / (W * H), colours: seen.size, cells, equal, scene: [g.post.size.x, g.post.size.y] };
`;

// In the page: a picture of the frame at twice the canvas's pixels in the style the page is in (the real one, after the
// pixel style): made at that size, and not blank.
const PICTURE_PLAIN = `
  g.render();
  const canvas = document.getElementById('view');
  const pic = g.post.capture(canvas.width * 2, canvas.height * 2);
  let lit = 0;
  for (let i = 0; i < pic.pixels.length; i += 4 * 97) if (pic.pixels[i] | pic.pixels[i + 1] | pic.pixels[i + 2]) lit++;
  return { size: [pic.width, pic.height], lit: lit / (pic.pixels.length / (4 * 97)), scene: [g.post.size.x, g.post.size.y], canvas: [canvas.width, canvas.height] };
`;

// In the page: what the grass is in this style.
const GRASS = `
  g.render();
  return { visible: g.grass.group.visible, blades: g.grass.stats.blades, flowers: g.grass.stats.flowers, rings: g.grass.rings.map((r) => r.id),
    near: g.grass.rings.length ? g.grass.rings[g.grass.rings.length - 1].geo.userData.blades : 0 };
`;

try {
  if (!(await waitForServer())) throw new Error('server did not start');
  const page = await openPage('seed=7&world=hills&s=5000&cam=chase&style=pixel&run=60');
  try {
    await page.run(PLACE(5000, 'pixel'));

    // The grid on this canvas, and in the world of the hills the palette of the hills.
    const hills = await page.run(FRAME);
    const block = Math.max(1, Math.round(hills.canvas[1] / 180));
    const grid = hills.grid;
    say(grid && grid.block === block && grid.cols === Math.ceil(hills.canvas[0] / block) && grid.rows === Math.ceil(hills.canvas[1] / block),
      `pixel: blocks of ${block} px, ${grid && grid.cols} cells across and ${grid && grid.rows} up on a canvas of ${hills.canvas.join(' by ')}`);
    say(grid && hills.scene[0] === grid.cols * grid.k && hills.scene[1] === grid.rows * grid.k && grid.k === Math.min(2, block),
      `pixel: the scene is drawn at ${hills.scene.join(' by ')}, ${grid && grid.k} pixels to a cell across and up`);
    say(grid && hills.out[0] === grid.cols && hills.out[1] === grid.rows, `pixel: the pass draws a frame of the cells, ${hills.out.join(' by ')}`);
    say(hills.shadow === 1024, `pixel: the sun's shadow map is ${hills.shadow} a side`);
    say(hills.same > 0.9999, `pixel: every cell is of one colour (${(hills.same * 100).toFixed(3)} % of the pixels are their cell's)`);
    say(hills.t === 0 && hills.colours <= 24 && hills.outside === 0, `pixel: ${hills.colours} colours in a world's own frame, none outside its palette (${hills.outside}); at most 24`);
    say(hills.inked > 20 && hills.inked < hills.cells * 0.05, `pixel: the line round the car is the darkest grey of the palette (${hills.inked} cells of ${hills.cells})`);
    say(hills.errors.length === 0, `pixel: no GL error in a frame (${hills.errors})`);
    say(Math.abs(hills.starPx - 1.2) < 1e-6, `pixel: a star is ${hills.starPx} px wide in the scene, a cell wide`);

    // A picture of the frame (the photo mode's): the same cells, in blocks twice as large.
    const pic = await page.run(PICTURE);
    say(!pic.error && pic.block === 2 * block && pic.same > 0.9999 && pic.colours <= 24,
      `pixel: a picture of ${pic.size && pic.size.join(' by ')} is cells of ${pic.block} px of one colour (${(pic.same * 100).toFixed(3)} %), ${pic.colours} colours`);
    say(!pic.error && pic.equal === pic.cells, `pixel: the picture's cells are the frame's own (${pic.equal} of ${pic.cells})`);

    // On a canvas of 1920 by 1080: 360 rows of scene, a ninth of the pixels, cells of six; and the change in and out of the style.
    await page.run('g.resize(1920, 1080); return 0;');
    const full = await page.run(FRAME);
    say(full.canvas[0] === 1920 && full.canvas[1] === 1080 && full.grid && full.grid.block === 6 && full.grid.cols === 320 && full.grid.rows === 180,
      `pixel: on 1920 by 1080, cells of ${full.grid && full.grid.block} px, ${full.grid && full.grid.cols} by ${full.grid && full.grid.rows}`);
    say(full.scene[0] === 640 && full.scene[1] === 360, `pixel: the scene is ${full.scene.join(' by ')}, ${(100 * full.scene[0] * full.scene[1] / (1920 * 1080)).toFixed(1)} % of the canvas's pixels (a ninth)`);
    say(full.same > 0.9999 && full.colours <= 24 && full.outside === 0, `pixel: ${full.colours} colours at 1080p, cells of one colour (${(full.same * 100).toFixed(3)} %)`);
    const out = await page.run(CHANGE('real'));
    say(out.changes === 3 && out.errors === 0 && out.levels.length === 4 && out.t === 1 && out.drawn > out.changes,
      `pixel to real: the scene went through ${out.changes} changes of size (${out.distinct.join(', ')}), ${out.errors} GL errors in ${out.drawn} frames`);
    const back = await page.run(FRAME);
    say(!back.grid && back.scene[0] === back.canvas[0] && back.scene[1] === back.canvas[1] && !back.pass && back.shadow === 2048 && Math.abs(back.starPx - 2.2) < 1e-6,
      `real after pixel: the scene is the canvas's ${back.scene.join(' by ')}, the pass is off, the shadow map ${back.shadow} a side, a star ${back.starPx} px`);
    const real = await page.run(GRASS);
    say(!real.visible, `real after pixel: no grass (${real.visible})`);
    const plain = await page.run(PICTURE_PLAIN);
    say(plain.size[0] === plain.canvas[0] * 2 && plain.size[1] === plain.canvas[1] * 2 && plain.lit > 0.9 && plain.scene[0] === plain.canvas[0],
      `real after pixel: a picture of ${plain.size.join(' by ')} is made (${(plain.lit * 100).toFixed(0)} % of it lit), the scene back at the canvas's size`);
    const into = await page.run(CHANGE('pixel'));
    say(into.changes === 3 && into.errors === 0 && into.levels.length === 4 && into.t === 1 && into.drawn > into.changes,
      `real to pixel: the scene went through ${into.changes} changes of size (${into.distinct.join(', ')}), ${into.errors} GL errors in ${into.drawn} frames`);
    say(into.shadow === 1024, `real to pixel: the shadow map is ${into.shadow} a side at the end of it`);
    await page.run('g.resize(innerWidth, innerHeight); return 0;');

    // Between two worlds: both palettes, and no colour that is of neither.
    const borders = await page.run(BORDERS);
    say(borders.length > 0, `pixel: places where the look is between two worlds were found (${JSON.stringify(borders)})`);
    if (borders.length) {
      const [s] = borders[0];
      await page.run(PLACE(s, 'pixel'));
      const mid = await page.run(FRAME);
      say(mid.t > 0.2 && mid.t < 0.8, `pixel: at ${s} m the look is ${(mid.t * 100).toFixed(0)} % of the way to the next world`);
      say(mid.colours <= 48 && mid.outside === 0, `pixel: ${mid.colours} colours between two worlds, none outside the two palettes (${mid.outside}); at most 48`);
      say(mid.same > 0.9999, `pixel: cells of one colour between two worlds (${(mid.same * 100).toFixed(3)} %)`);
      await page.run(PLACE(5000, 'pixel'));
    }

    // The grass: the outer ring alone, and half the blades of the painted style's.
    const grass = await page.run(GRASS);
    say(grass.visible && grass.rings.length === 1 && grass.rings[0] === 'far' && grass.blades > 1000 && grass.flowers === 0,
      `pixel: the outer ring of blades alone, no flowers (${grass.rings}, ${grass.blades} blades)`);
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
