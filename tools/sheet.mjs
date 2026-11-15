// Before and after, side by side: a sheet of frames, a shot to a row.
//
// Reads two directories, each written by one run of
// `node tools/look.mjs --dump --out <dir>` (a frame <shot>-<style>.png for
// each shot and style, and the run's numbers in look.json), pairs the frames
// by shot and style, and lays them out with the frame before on the left and
// the frame after on the right, 960x433 each. Top left in each: the shot and
// the style; bottom right: what the frame cost (milliseconds, draw calls) and
// one number of the picture, named with --metric, from that run's look.json.
// A third column (--ref) holds a picture to compare with, scaled to fit the
// same cell. At most six rows to a sheet; JPEG.
//
// The sheet is composed on a 2D canvas in headless Chrome (no dependency).
// Every cell sits in the same gutter, on the JPEG's 16 px grid, so two equal
// frames come out of the JPEG equal too; each row is said to be the same or
// not, from the JPEG as it was written.
//
// Usage:
//   node tools/sheet.mjs out/before/P1-6 out/after/P1-6 [--metric ground.near.upright]
//        [--shots hills,wood] [--styles paint] [--ref ref.jpg] [--out out/sheet/P1-6]
// writes out/sheet/<after's name>-1.jpg, -2.jpg, ... (or <--out>-1.jpg, ...).
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, resolve } from 'node:path';

const CHROME = process.env.CHROME || ({
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
}[process.platform] || '/usr/bin/google-chrome-stable');
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The sheet's measures, px. Cells and gutters are whole multiples of 16 (a
// JPEG's block with its colour halved) but the cell's height, which is the
// frame's 1280x577 at 960 wide.
const CW = 960;
const CH = 433;
const GAP = 16;
const HEAD = 48;
const ROWS = 6;
const MAX_BYTES = 2 * 1024 * 1024;

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const flags = new Set(['--metric', '--shots', '--styles', '--ref', '--out']);
const dirs = args.filter((a, i) => !a.startsWith('--') && !flags.has(args[i - 1]));
if (dirs.length !== 2) {
  console.error('usage: node tools/sheet.mjs <before dir> <after dir> [--metric a.b.c] [--shots …] [--styles …] [--ref image] [--out prefix]');
  process.exit(2);
}
const [before, after] = dirs.map((d) => resolve(d));
const metric = opt('--metric', null);
const onlyShots = opt('--shots', null) && opt('--shots').split(',');
const onlyStyles = opt('--styles', null) && opt('--styles').split(',');
const ref = opt('--ref', null);
const prefix = resolve(opt('--out', `${ROOT}out/sheet/${basename(after)}`));

// The frames in a directory: <shot>-<style>.png, not the maps.
const framesIn = (dir) => new Set(readdirSync(dir).filter((f) => /^[a-z0-9]+-[a-z]+\.png$/.test(f)).map((f) => f.slice(0, -4)));
const numbersIn = (dir) => {
  try {
    return JSON.parse(readFileSync(`${dir}/look.json`, 'utf8'));
  } catch {
    return {};
  }
};
for (const d of [before, after]) if (!existsSync(d) || !statSync(d).isDirectory()) throw new Error(`not a directory: ${d}`);
const fa = framesIn(before);
const fb = framesIn(after);
const na = numbersIn(before);
const nb = numbersIn(after);
// In the order the run measured them (look.json's), then any others.
const order = [...Object.keys(na).map((id) => id.replace(':', '-')), ...[...fa].sort()];
const pairs = [...new Set(order)].filter((k) => fa.has(k) && fb.has(k)).filter((k) => {
  const [shot, style] = k.split('-');
  return (!onlyShots || onlyShots.includes(shot)) && (!onlyStyles || onlyStyles.includes(style));
});
if (!pairs.length) {
  console.error(`no frame is in both ${before} and ${after}`);
  process.exit(1);
}

const dig = (o, path) => path.split('.').reduce((v, k) => (v === null || v === undefined ? undefined : v[k]), o);
const fmt = (v) => (v === null || v === undefined ? '–' : typeof v === 'number' ? String(+v.toFixed(4)) : String(v));
const caption = (nums, k) => {
  const r = nums[k.replace('-', ':')];
  if (!r) return '';
  const parts = [`${fmt(dig(r, 'cost.ms'))} ms`, `${fmt(dig(r, 'cost.calls'))} calls`];
  if (metric) parts.push(`${metric} ${fmt(dig(r, metric))}`);
  return parts.join('  ·  ');
};

// A blank page in headless Chrome, and a way to run code in it.
async function browser() {
  const profile = `${tmpdir()}/continuum-sheet-${process.pid}-${Date.now()}`;
  const env = { ...process.env };
  delete env.DISPLAY;
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], env });
  const close = async () => {
    chrome.kill();
    await sleep(500);
    rmSync(profile, { recursive: true, force: true });
  };
  try {
    const devtools = await new Promise((res, rej) => {
      let text = '';
      const t = setTimeout(() => rej(new Error('Chrome did not start')), 20000);
      chrome.on('error', rej);
      chrome.stderr.on('data', (d) => {
        text += d;
        const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(text);
        if (m) { clearTimeout(t); res(new URL(m[1])); }
      });
    });
    let page = null;
    for (let i = 0; i < 50 && !page; i++) {
      const list = await (await fetch(`http://${devtools.host}/json/list`)).json();
      page = list.find((t) => t.type === 'page');
      if (!page) await sleep(200);
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    });
    const run = (body) => new Promise((res, rej) => {
      pending.set(++id, (msg) => {
        const r = msg.result;
        if (msg.error) rej(new Error(msg.error.message));
        else if (r.exceptionDetails) rej(new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text));
        else res(r.result.value);
      });
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: `(async () => { ${body} })()`, returnByValue: true, awaitPromise: true } }));
    });
    return { run, close };
  } catch (e) {
    await close();
    throw e;
  }
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const dataURL = (file) => `data:${MIME[extname(file).toLowerCase()] || 'image/png'};base64,${readFileSync(file).toString('base64')}`;

// In the page: a picture into the page's list of them, by name.
const LOAD = (name, url) => `
  const im = new Image();
  im.src = ${JSON.stringify(url)};
  await im.decode();
  (window.__img = window.__img || {})[${JSON.stringify(name)}] = im;
  return [im.naturalWidth, im.naturalHeight];
`;

// In the page: one sheet. rows: [label, before, after, caption before, caption after].
const SHEET = (rows, heads, quality) => `
  const rows = ${JSON.stringify(rows)}, heads = ${JSON.stringify(heads)};
  const cols = heads.length, CW = ${CW}, CH = ${CH}, GAP = ${GAP}, HEAD = ${HEAD};
  const cv = document.createElement('canvas');
  cv.width = GAP + cols * (CW + GAP);
  cv.height = HEAD + rows.length * (CH + GAP);
  const cx = cv.getContext('2d');
  cx.fillStyle = '#16181c';
  cx.fillRect(0, 0, cv.width, cv.height);
  cx.textBaseline = 'middle';
  cx.font = '600 20px Helvetica, Arial, sans-serif';
  cx.fillStyle = '#e8e6e1';
  heads.forEach((t, c) => cx.fillText(t, GAP + c * (CW + GAP) + 4, HEAD / 2));
  // Each cell is drawn on a canvas of its own and copied in whole, pixel for
  // pixel: scaling or writing at a different place on the sheet need not give
  // the same pixels.
  const cell = document.createElement('canvas');
  cell.width = CW; cell.height = CH;
  const kx = cell.getContext('2d', { willReadFrequently: true });
  kx.textBaseline = 'middle';
  // A picture fitted whole into the cell, centred, on black.
  const fit = (im) => {
    kx.fillStyle = '#000';
    kx.fillRect(0, 0, CW, CH);
    const k = Math.min(CW / im.naturalWidth, CH / im.naturalHeight);
    const w = Math.round(im.naturalWidth * k), h = Math.round(im.naturalHeight * k);
    kx.drawImage(im, (CW - w) >> 1, (CH - h) >> 1, w, h);
  };
  const tag = (text, x, y, right) => {
    if (!text) return;
    kx.font = '600 19px Helvetica, Arial, sans-serif';
    const w = Math.ceil(kx.measureText(text).width) + 16;
    const x0 = right ? x - w : x;
    kx.fillStyle = 'rgba(0, 0, 0, 0.62)';
    kx.fillRect(x0, y - 15, w, 30);
    kx.fillStyle = '#fff';
    kx.fillText(text, x0 + 8, y + 1);
  };
  rows.forEach((row, r) => {
    const y = HEAD + r * (CH + GAP);
    const cells = [[row[1], row[3]], [row[2], row[4]]];
    if (cols > 2) cells.push(['__ref', '']);
    cells.forEach(([name, cap], c) => {
      fit(window.__img[name]);
      if (name !== '__ref') tag(row[0], 8, 23, false);
      tag(cap, CW - 8, CH - 23, true);
      cx.putImageData(kx.getImageData(0, 0, CW, CH), GAP + c * (CW + GAP), y);
    });
  });
  const url = cv.toDataURL('image/jpeg', ${quality});
  // Read the JPEG back as it was written: is each row's pair the same?
  const back = new Image();
  back.src = url;
  await back.decode();
  const rd = document.createElement('canvas');
  rd.width = cv.width; rd.height = cv.height;
  const rx = rd.getContext('2d', { willReadFrequently: true });
  rx.drawImage(back, 0, 0);
  const same = rows.map((_, r) => {
    const y = HEAD + r * (CH + GAP);
    const a = rx.getImageData(GAP, y, CW, CH).data, b = rx.getImageData(GAP + CW + GAP, y, CW, CH).data;
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    return diff;
  });
  return { url, same };
`;

const sheets = [];
for (let i = 0; i < pairs.length; i += ROWS) sheets.push(pairs.slice(i, i + ROWS));
const heads = [`before  ${before.replace(ROOT, '')}`, `after  ${after.replace(ROOT, '')}`];
if (ref) heads.push(`reference  ${basename(ref)}`);
mkdirSync(dirname(prefix), { recursive: true });

const page = await browser();
try {
  if (ref) await page.run(LOAD('__ref', dataURL(ref)));
  for (let s = 0; s < sheets.length; s++) {
    const rows = [];
    for (const k of sheets[s]) {
      await page.run(LOAD(`a:${k}`, dataURL(`${before}/${k}.png`)));
      await page.run(LOAD(`b:${k}`, dataURL(`${after}/${k}.png`)));
      const [shot, style] = k.split('-');
      rows.push([`${shot} · ${style}`, `a:${k}`, `b:${k}`, caption(na, k), caption(nb, k)]);
    }
    // As good a JPEG as fits in 2 MB.
    let out = null;
    for (const q of [0.88, 0.8, 0.72, 0.64, 0.56]) {
      out = await page.run(SHEET(rows, heads, q));
      out.bytes = Buffer.from(out.url.slice(out.url.indexOf(',') + 1), 'base64');
      out.q = q;
      if (out.bytes.length <= MAX_BYTES) break;
    }
    const file = `${prefix}-${s + 1}.jpg`;
    writeFileSync(file, out.bytes);
    console.log(`${file}  ${rows.length} rows, ${(out.bytes.length / 1048576).toFixed(2)} MB (quality ${out.q})`);
    sheets[s].forEach((k, r) => console.log(`  ${k.padEnd(16)} ${out.same[r] === 0 ? 'the same' : `differs (${out.same[r]} channel values)`}`));
    await page.run('window.__img = { __ref: (window.__img || {}).__ref }; return 0;');
  }
} finally {
  await page.close();
}
