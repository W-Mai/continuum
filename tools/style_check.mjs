// The styles of drawing (render/style.js) draw what they say they draw.
//
// Runs the real page headless in each style on the same stretch of road,
// behind the car, and reads the frame:
//  - every style draws a frame with something in it, unlike the real one;
//  - 水墨 (ink) is ink on paper: next to no colour but the car's, which
//    keeps the red it has in the real frame, and much of the page is paper
//    or a light wash on it;
//  - 手绘 (paint) and 赛璐璐 (cel) are fuller in colour and flatter in
//    texture than the real frame;
//  - 版画 (print) prints a band of indigo across a day's sky;
//  - 像素 (pixel) is made of square blocks of whole pixels, in a palette of
//    eight levels a channel;
//  - 方块 (block) lays square texels on the world: the road is in runs of
//    one colour, the colour fuller;
//  - nothing in 手绘, 水墨, 版画 or 方块 is fixed to the screen: a grain
//    laid on the screen stays put while the world moves under it, and reads
//    as dirt on the lens;
//  - the real style has no animals; 手绘 has deer and the like by the road
//    and birds and butterflies in the air; 方块 has a farm's;
// and a change of style: half way through its 1.4 s it is half way, the sky
// is drawn again only a dozen times on the way, and turning back to the real
// style turns the last pass off and draws nearly the frame of a run that
// never left it.
//
// Usage: node tools/style_check.mjs
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { inflateSync } from 'node:zlib';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
// Headless WebGL fails on Linux while DISPLAY is set.
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = 8175;
const ROOT = new URL('..', import.meta.url).pathname;
// Behind the car on the serpentine below the first viaduct, 4 s in.
const BASE = 'seed=7&s=5260&cam=chase';
const STEPS = 240;
// Each style's paper (render/style.js).
const PAPER = { ink: [0.95, 0.92, 0.85], print: [0.95, 0.91, 0.81] };
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

// A headless run: its diagnostics and its frame.
function run(query, steps) {
  const profile = `${tmpdir()}/continuum-style-${process.pid}-${Date.now()}`;
  return new Promise((resolve, reject) => {
    const args = [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
      '--hide-scrollbars', '--window-size=1280,720',
      `--virtual-time-budget=${steps * 100 + 30000}`, '--dump-dom',
      `--user-data-dir=${profile}`, `http://localhost:${PORT}/index.html?${query}&run=${steps}`,
    ];
    const p = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'ignore'], env: CHROME_ENV });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('exit', () => {
      rmSync(profile, { recursive: true, force: true });
      const d = /<script id="diag"[^>]*>([\s\S]*?)<\/script>/.exec(out);
      const f = /<script id="frame"[^>]*>([\s\S]*?)<\/script>/.exec(out);
      const t = /<title>([^<]*)<\/title>/.exec(out);
      if (!d || !f) {
        resolve({ error: `no frame (${t ? t[1] : 'no title'})` });
        return;
      }
      resolve({
        diag: JSON.parse(d[1]),
        image: decodePNG(Buffer.from(f[1].replace(/^data:image\/png;base64,/, '').trim(), 'base64')),
      });
    });
    p.on('error', reject);
  });
}

// An 8-bit RGB or RGBA PNG, as canvas.toDataURL writes one, to RGBA bytes.
function decodePNG(buf) {
  let p = 8;
  let w = 0;
  let h = 0;
  let bpp = 4;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0 || (data[9] !== 6 && data[9] !== 2)) throw new Error('unexpected PNG format');
      bpp = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  let line = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1);
    const f = raw[o];
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = raw[o + 1 + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const q = a + b - c;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - b);
        const pc = Math.abs(q - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[i] = line[x * bpp];
      out[i + 1] = line[x * bpp + 1];
      out[i + 2] = line[x * bpp + 2];
      out[i + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    [prev, line] = [line, prev];
  }
  return { w, h, data: out };
}

// What a frame is like: how bright and how varied, how much colour, how much
// fine texture (the median size of the luma's Laplacian, so that the thin
// lines a style draws do not count), how much of it is red like the car, how
// much is the given paper or a light wash on it (bright, in the paper's hue:
// the grain and the vignette darken a page, they do not tint it).
function measure(img, paper = [0.95, 0.92, 0.85]) {
  const { w, h, data } = img;
  const n = w * h;
  const luma = new Float32Array(n);
  const pg = paper[1] / paper[0];
  const pb = paper[2] / paper[0];
  let sum = 0;
  let sum2 = 0;
  let satSum = 0;
  let red = 0;
  let paperish = 0;
  const sats = [];
  for (let i = 0; i < n; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    luma[i] = l;
    sum += l;
    sum2 += l * l;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const s = mx > 1e-3 ? (mx - mn) / mx : 0;
    satSum += s;
    const isRed = r > 0.35 && r > 1.6 * g && r > 1.6 * b;
    if (isRed) red++;
    else if (i % 7 === 0) sats.push(s);
    if (l > 0.55 && r > 0.05 && Math.abs(g / r - pg) < 0.03 && Math.abs(b / r - pb) < 0.05) paperish++;
  }
  const laps = [];
  for (let y = 1; y < h - 1; y += 3) {
    for (let x = 1; x < w - 1; x += 3) {
      const i = y * w + x;
      laps.push(Math.abs(4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - w] - luma[i + w]));
    }
  }
  sats.sort((a, b) => a - b);
  laps.sort((a, b) => a - b);
  const mean = sum / n;
  return {
    mean: +mean.toFixed(3),
    std: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(3),
    sat: +(satSum / n).toFixed(3),
    sat95: +sats[Math.floor(0.95 * (sats.length - 1))].toFixed(3),
    texture: +laps[laps.length >> 1].toFixed(4),
    red,
    paper: +(paperish / n).toFixed(3),
  };
}

// How blue the top of a frame is: the 90th percentile of blue less red over
// its top rows, where an open sky is.
function topBlue(img, rows = 0.06) {
  const { w, h, data } = img;
  const v = [];
  for (let y = 0; y < Math.floor(h * rows); y++) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      v.push((data[i + 2] - data[i]) / 255);
    }
  }
  v.sort((a, b) => a - b);
  return +v[Math.floor(0.9 * (v.length - 1))].toFixed(3);
}

function meanDiff(a, b) {
  let d = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    d += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
  }
  return d / (a.data.length / 4) / 3 / 255;
}

// How flat the road near the lens is: the share of pixels, in the lower
// middle of the frame, whose right-hand neighbour is exactly their colour.
// A world laid with square texels, several pixels across each, has runs of
// them; a frame drawn as it is has none to speak of.
function flatRuns(img) {
  const { w, h, data } = img;
  let same = 0;
  let total = 0;
  for (let y = Math.floor(h * 0.62); y < h - 4; y++) {
    for (let x = Math.floor(w * 0.3); x < Math.floor(w * 0.7) - 1; x++) {
      const i = (y * w + x) * 4;
      if (data[i] === data[i + 4] && data[i + 1] === data[i + 5] && data[i + 2] === data[i + 6]) same++;
      total++;
    }
  }
  return same / total;
}

// A frame's fine detail: its luma (0-255, whole numbers) less the mean of
// the 5 by 5 pixels round it.
function fine(img) {
  const { w, h, data } = img;
  const l = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) l[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let j = -2; j <= 2; j++) {
        const yy = Math.min(h - 1, Math.max(0, y + j)) * w;
        for (let i = -2; i <= 2; i++) s += l[yy + Math.min(w - 1, Math.max(0, x + i))];
      }
      out[y * w + x] = l[y * w + x] - Math.round(s / 25);
    }
  }
  return out;
}

// A pattern fixed to the screen: two real frames a moment apart pick out
// where the scene is smooth at both moments (no fine detail in either);
// there, fine detail that two styled frames share at the same pixels stays
// put while the world moves. Their correlation: about 0 when nothing in the
// style is fixed to the screen, a paper grain laid on it 0.1-0.2.
function fixedPattern(realA, realB, styleA, styleB) {
  const [ra, rb, sa, sb] = [realA, realB, styleA, styleB].map(fine);
  let n = 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < ra.length; i++) {
    if (ra[i] !== 0 || rb[i] !== 0) continue;
    n++;
    mx += sa[i];
    my += sb[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < ra.length; i++) {
    if (ra[i] !== 0 || rb[i] !== 0) continue;
    sxy += (sa[i] - mx) * (sb[i] - my);
    sxx += (sa[i] - mx) ** 2;
    syy += (sb[i] - my) ** 2;
  }
  return { corr: sxy / Math.sqrt(sxx * syy), smooth: n / ra.length };
}

// The share of pixels that are the colour of their block's first pixel, for
// blocks of `size` pixels, and the share of channels on one of `levels`.
// The shader counts blocks from the bottom left, as gl_FragCoord does; the
// image's rows run from the top.
function blocks(img, size, levels) {
  const { w, h, data } = img;
  let same = 0;
  let total = 0;
  let onLevel = 0;
  for (let y = 0; y < h; y++) {
    const y0 = h - 1 - Math.floor((h - 1 - y) / size) * size;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const j = (y0 * w + Math.floor(x / size) * size) * 4;
      if (data[i] === data[j] && data[i + 1] === data[j + 1] && data[i + 2] === data[j + 2]) same++;
      for (let c = 0; c < 3; c++) {
        const v = data[i + c] / 255 * (levels - 1);
        if (Math.abs(v - Math.round(v)) * 255 / (levels - 1) <= 1.5) onLevel++;
      }
      total++;
    }
  }
  return { same: same / total, onLevel: onLevel / (total * 3) };
}

const problems = [];
const say = (ok, line) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${line}`);
  if (!ok) problems.push(line);
};

const server = serve();
try {
  if (!(await waitForServer())) throw new Error('server did not start');
  const frames = {};
  for (const id of ['real', 'paint', 'ink', 'cel', 'print', 'pixel', 'block']) {
    const r = await run(`${BASE}&style=${id}`, STEPS);
    if (r.error) {
      say(false, `${id}: ${r.error}`);
      continue;
    }
    frames[id] = r;
    r.m = measure(r.image, PAPER[id]);
    console.log(`     ${id.padEnd(6)} ${JSON.stringify(r.m)}`);
    say(r.diag.style === id && r.diag.styleT === 1 && r.diag.styled === (id !== 'real'),
      `${id}: drawn in its style (style ${r.diag.style}, t ${r.diag.styleT}, last pass ${r.diag.styled})`);
  }
  const real = frames.real;
  if (real) {
    say(real.m.red > 400, `the car is in the real frame (${real.m.red} red pixels)`);
    for (const id of ['paint', 'ink', 'cel', 'print', 'pixel', 'block']) {
      const f = frames[id];
      if (!f) continue;
      const d = meanDiff(f.image, real.image);
      say(f.m.std > 0.05 && d > 0.02, `${id}: a frame with something in it (luma spread ${f.m.std}), not the real one (differs ${d.toFixed(3)})`);
    }
    const ink = frames.ink;
    if (ink) {
      say(ink.m.sat95 < 0.16, `ink: no colour but the car's (95th percentile saturation ${ink.m.sat95})`);
      say(ink.m.red > real.m.red * 0.5, `ink: the car keeps its red (${ink.m.red} red pixels, real ${real.m.red})`);
      say(ink.m.paper > 0.2 && ink.m.paper < 0.95, `ink: much of the page is paper or a light wash, not all of it (${ink.m.paper}, real ${real.m.paper})`);
    }
    for (const id of ['paint', 'cel']) {
      const f = frames[id];
      if (!f) continue;
      say(f.m.sat > real.m.sat * 1.05, `${id}: fuller colour (saturation ${f.m.sat}, real ${real.m.sat})`);
      say(f.m.texture < real.m.texture * 0.85, `${id}: flatter texture (${f.m.texture}, real ${real.m.texture})`);
    }
    // A world of blocks: laid with square texels, so the road near the lens
    // is in runs of the one colour, and the colour is fuller.
    const block = frames.block;
    if (block) {
      const fr = flatRuns(real.image);
      const fb = flatRuns(block.image);
      say(fb > fr + 0.4, `block: the road is laid in square texels (${(fb * 100).toFixed(0)} % of its pixels start a run, real ${(fr * 100).toFixed(0)} %)`);
      say(block.m.sat > real.m.sat * 1.15, `block: fuller colour (saturation ${block.m.sat}, real ${real.m.sat})`);
    }
    const pixel = frames.pixel;
    if (pixel) {
      const size = Math.max(1, Math.round(pixel.image.h / 180));
      const b = blocks(pixel.image, size, 8);
      say(b.same > 0.98, `pixel: blocks of ${size} px (${(b.same * 100).toFixed(1)} % of pixels are their block's colour)`);
      say(b.onLevel > 0.98, `pixel: eight levels a channel (${(b.onLevel * 100).toFixed(1)} % of channels on one)`);
    }
  }

  // A print's sky, where there is one to see: a band of indigo at the top.
  const SKY = 'seed=7&s=6000&cam=chase';
  const skyReal = await run(SKY, 300);
  const skyPrint = await run(`${SKY}&style=print`, 300);
  if (skyReal.error || skyPrint.error) say(false, `print's sky: ${skyReal.error || skyPrint.error}`);
  else {
    const br = topBlue(skyReal.image);
    const bp = topBlue(skyPrint.image);
    say(bp > 0.13 && bp > br + 0.06, `print: a band of indigo across the top of the sky (blue over red ${bp}, real ${br})`);
  }

  // Life: every style has the animals of a wood (birds in the sky, by the
  // road deer and the like), the block one a farm's made of boxes instead. In
  // the hills, seven seconds in. Wind and petals are the painted style's alone.
  const HILLS = 'seed=7&world=hills&s=1500&cam=chase';
  const lifeReal = await run(HILLS, 420);
  const lifePaint = await run(`${HILLS}&style=paint`, 420);
  const lifeBlock = await run(`${HILLS}&style=block`, 420);
  const lifeInk = await run(`${HILLS}&style=ink`, 420);
  if (lifeReal.error || lifePaint.error || lifeBlock.error || lifeInk.error) {
    say(false, `life: ${lifeReal.error || lifePaint.error || lifeBlock.error || lifeInk.error}`);
  } else {
    const [r, p, b, k] = [lifeReal.diag, lifePaint.diag, lifeBlock.diag, lifeInk.diag];
    say(r.critters >= 3 && r.flyers >= 40, `real: small animals by the road and birds and butterflies in the air (${r.critters} walking, ${r.flyers} flying)`);
    say(k.critters >= 3 && k.flyers >= 40, `ink: the same animals, drawn in ink (${k.critters} walking, ${k.flyers} flying)`);
    say(p.critters >= 3 && p.flyers >= 40, `paint: small animals by the road and birds and butterflies in the air (${p.critters} walking, ${p.flyers} flying)`);
    say(b.critters >= 3 && b.flyers >= 40, `block: a farm's animals by the road, and birds in the air (${b.critters} walking, ${b.flyers} flying)`);
    say(r.drifting === 0 && b.drifting === 0, `real and block: no wind or petals drawn in the air (${r.drifting}, ${b.drifting})`);
    say(p.drifting >= 30, `paint: wind drawn across the air, and petals falling on it (${p.drifting})`);
    say(b.treeKinds >= r.treeKinds + 2, `block: the trees are of several kinds, each its own (${b.treeKinds} against ${r.treeKinds})`);
    // And gone with the style: back to the real style the wind and the
    // petals are gone, the animals are the wood's again, and the trees are
    // the trees again.
    const goneP = await run(`${HILLS}&style=paint&styleat=real@200`, 420);
    const goneB = await run(`${HILLS}&style=block&styleat=real@200`, 420);
    if (goneP.error || goneB.error) say(false, `back from life: ${goneP.error || goneB.error}`);
    else {
      say(goneP.diag.critters >= 3 && goneP.diag.flyers >= 40 && goneP.diag.drifting === 0,
        `paint, then real: the animals stay and the wind is gone (${goneP.diag.critters} walking, ${goneP.diag.flyers} flying, ${goneP.diag.drifting} drifting)`);
      const d = meanDiff(goneB.image, lifeReal.image);
      say(goneB.diag.critters >= 1 && d < 0.03,
        `block, then real: the farm's animals have given way to the wood's (${goneB.diag.critters} walking) and the trees are trees again (frame within ${d.toFixed(4)} of a run that stayed)`);
    }
  }

  // Nothing laid on the screen: the styles that once had a paper grain or
  // an ink's mottle, on the same road half a second on, the world moved
  // under the lens. (The pixel style's dither is its own.)
  const skyLater = await run(SKY, 330);
  if (skyReal.error || skyLater.error) say(false, `half a second on: ${skyReal.error || skyLater.error}`);
  else {
    for (const id of ['paint', 'ink', 'print', 'block']) {
      const a = id === 'print' ? skyPrint : await run(`${SKY}&style=${id}`, 300);
      const b = await run(`${SKY}&style=${id}`, 330);
      if (a.error || b.error) {
        say(false, `${id} half a second on: ${a.error || b.error}`);
        continue;
      }
      const p = fixedPattern(skyReal.image, skyLater.image, a.image, b.image);
      say(p.corr < 0.09, `${id}: nothing fixed to the screen (detail shared by frames half a second apart ${p.corr.toFixed(3)}, `
        + `where the scene is smooth, ${(p.smooth * 100).toFixed(0)} % of the frame)`);
    }
  }

  // A change of style: half way after half its time; the sky drawn again a
  // dozen times at most on the way; back to the real style, the last pass
  // off and nearly the frame of a run that never left it.
  const plain = await run(BASE, 102);
  const half = await run(`${BASE}&styleat=ink@60`, 102);
  if (plain.error || half.error) say(false, `a change of style: ${plain.error || half.error}`);
  else {
    say(half.diag.style === 'ink' && half.diag.styleT > 0.45 && half.diag.styleT < 0.55,
      `half way through a change, half way (t ${half.diag.styleT})`);
    const extra = half.diag.envBakes - plain.diag.envBakes;
    say(extra <= 14, `the sky drawn again ${extra} times on the way`);
  }
  const back = await run(`${BASE}&styleat=ink@40,real@140`, 300);
  const stay = await run(BASE, 300);
  if (back.error || stay.error) say(false, `back to the real style: ${back.error || stay.error}`);
  else {
    const d = meanDiff(back.image, stay.image);
    say(back.diag.style === 'real' && back.diag.styleT === 1 && !back.diag.styled && d < 0.03,
      `back to the real style: last pass ${back.diag.styled ? 'on' : 'off'}, frame within ${d.toFixed(4)} of a run that stayed`);
  }
} catch (e) {
  console.error(e);
  problems.push(String(e));
} finally {
  server.kill();
}
console.log(problems.length ? `FAIL: ${problems.length} problems` : 'OK: every style draws what it says it draws');
process.exit(problems.length ? 1 : 0);
