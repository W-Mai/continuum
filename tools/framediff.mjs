// How many pixels of two sets of frames differ, and by how much.
//
// The frames are what `tools/look.mjs --dump --out <dir>` writes: <shot>-<style>.png.
// A pair is the same file in both directories. A pixel differs by `levels` when
// a channel of it (of 255) is that far from the other's; alpha is left out.
//
// Usage: node tools/framediff.mjs <before dir> <after dir> [--shots a,b] [--styles x,y]
//          [--levels 3] [--limit 0.002] [--out dir]
//   --limit   fail (exit 1) when more than this share of a frame differs by `levels` or more
//   --out     write each differing pair's difference as a picture: red where over `levels`,
//             grey where by less, black where none

import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const dirs = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (dirs.length < 2) {
  console.error('usage: node tools/framediff.mjs <before dir> <after dir> [--shots a,b] [--styles x,y] [--levels 3] [--limit 0.002] [--out dir]');
  process.exit(2);
}
const [before, after] = dirs.map((d) => d.replace(/\/?$/, '/'));
const LEVELS = Number(opt('--levels', 3));
const LIMIT = opt('--limit', null) === null ? null : Number(opt('--limit'));
const shots = opt('--shots', null) ? opt('--shots').split(',') : null;
const styles = opt('--styles', null) ? opt('--styles').split(',') : null;
const outDir = opt('--out', null) ? opt('--out').replace(/\/?$/, '/') : null;

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

function encodePNG(w, h, rgba) {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  const crc = (b) => {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const frames = (dir) => readdirSync(dir).filter((f) => /^[a-z]+-[a-z]+\.png$/.test(f)).sort();
const have = new Set(frames(after));
const names = frames(before).filter((f) => have.has(f)).filter((f) => {
  const [shot, style] = f.replace(/\.png$/, '').split('-');
  return (!shots || shots.includes(shot)) && (!styles || styles.includes(style));
});
const missing = frames(before).filter((f) => !have.has(f));
if (!names.length) {
  console.error(`no frame is in both ${before} and ${after}`);
  process.exit(2);
}
if (outDir) mkdirSync(outDir, { recursive: true });

let worst = 0;
let failed = 0;
for (const f of names) {
  const a = decodePNG(readFileSync(before + f));
  const b = decodePNG(readFileSync(after + f));
  const id = f.replace(/\.png$/, '').replace('-', ':');
  if (a.w !== b.w || a.h !== b.h) {
    console.log(`${id.padEnd(14)} not the same size: ${a.w}x${a.h} and ${b.w}x${b.h}`);
    failed++;
    continue;
  }
  const n = a.w * a.h;
  let over = 0;
  let any = 0;
  let largest = 0;
  const pic = outDir ? new Uint8Array(n * 4) : null;
  for (let i = 0; i < n; i++) {
    const d = Math.max(Math.abs(a.data[i * 4] - b.data[i * 4]), Math.abs(a.data[i * 4 + 1] - b.data[i * 4 + 1]), Math.abs(a.data[i * 4 + 2] - b.data[i * 4 + 2]));
    if (d > 0) any++;
    if (d >= LEVELS) over++;
    if (d > largest) largest = d;
    if (pic) {
      pic[i * 4 + 3] = 255;
      if (d >= LEVELS) pic[i * 4] = 255;
      else if (d > 0) pic[i * 4] = pic[i * 4 + 1] = pic[i * 4 + 2] = 96;
    }
  }
  const share = over / n;
  if (share > worst) worst = share;
  const bad = LIMIT !== null && share > LIMIT;
  if (bad) failed++;
  console.log(`${id.padEnd(14)} ${String(over).padStart(7)} of ${n} px differ by ${LEVELS} or more (${(share * 100).toFixed(4)}%), ${any} by any, the most ${largest}${bad ? '  OVER' : ''}`);
  if (pic && any) writeFileSync(`${outDir}${f.replace(/\.png$/, '')}-diff.png`, encodePNG(a.w, a.h, pic));
}
if (missing.length) console.log(`only in ${before}: ${missing.join(' ')}`);
console.log(`${names.length} frames, the worst ${(worst * 100).toFixed(4)}%${LIMIT !== null ? (failed ? `; FAILED: ${failed} over ${(LIMIT * 100).toFixed(2)}%` : `; all within ${(LIMIT * 100).toFixed(2)}%`) : ''}`);
process.exit(failed ? 1 : 0);
