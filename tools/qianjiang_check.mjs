// The ink with a pale colour over it (浅绛). In node (no browser): it is the ink style's numbers and one
// more, the pale colour, which no other style has and which the low tier leaves off; its three colours fall
// in three cells of hue. In the page (one run of tools/look.mjs --dump, or a run of it already written):
// for each place, the ink and the ink with the colour, the colour's frame is as saturated as it is meant to
// be, the pixels with colour in them (the car's left out) fall in three cells of hue at most, the tones of
// the ink are the ink's, and the frame costs what the ink's does.
//
// Usage: node tools/qianjiang_check.mjs [--node-only] [--dir out/qianjiang] [--shots alpine,hills,valley]
//   --dir: read the frames and look.json a run of look.mjs --dump wrote there (with ink and qianjiang),
//   and when there is none there, make them (PORT moves look.mjs's server).

import { register } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

// style.js imports 'three' by name, which the page's import map resolves; here a hook does.
const vendor = new URL('./vendor/three.module.js', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    if (specifier === 'three') return { url: ${JSON.stringify(vendor)}, shortCircuit: true };
    return next(specifier, context);
  }`)}`);

const { STYLES, STYLE_PASS, Style, styleParams } = await import('../src/render/style.js');

const args = process.argv.slice(2);
const has = (k) => args.includes(k);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);

let failed = 0;
const say = (ok, text) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};

// The limits.
const SAT = [0.16, 0.24];      // frame.sat of the frame with the colour
const CELL = 0.05;             // a cell of hue counts when it holds this share of the pixels with colour
const CELLS = 3;               // and there are no more of those than this
const CHROMA = 0.03;           // a pixel has colour in it over this chroma (OKLab), as look.mjs's frame.hues has it
const TONE = 0.01;             // the mean tone of the ink (look.mjs's frame.ink.tone), the colour's frame against the ink's
const BAND = 0.03;             // the share of the frame in each band of tone (by OKLab's lightness alone), the same

// --- OKLab, as look.mjs measures a frame -----------------------------------------------------------------------------------

const lin = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
function lab(r, g, b) {
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const hueOf = (a, b) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;

// --- in node ---------------------------------------------------------------------------------------------------------------

const i = STYLES.findIndex((s) => s.id === 'qianjiang');
say(i > 0 && STYLES[i - 1].id === 'ink' && STYLES[i].name === '浅绛', `浅绛 is a style of its own, after the ink (${i} of ${STYLES.length})`);

const ink = styleParams('ink');
const qj = styleParams('qianjiang');
const differ = Object.keys(qj).filter((k) => JSON.stringify(qj[k]) !== JSON.stringify(ink[k]));
say(differ.length === 1 && differ[0] === 'qian' && qj.qian > 0 && qj.qian <= 1, `its numbers are the ink's but for the colour (${differ.join(', ')}: ${qj.qian})`);
for (const s of STYLES) if (s.id !== 'qianjiang') say(styleParams(s.id).qian === 0, `${s.id}: no colour over it`);

const inks = [0, 1, 2].map((k) => qj.qianInks.slice(k * 3, k * 3 + 3));
const cells = inks.map((c) => Math.floor(hueOf(...lab(...c).slice(1)) / 30));
say(new Set(cells).size === 3, `the three colours (汁绿, 花青, 赭) are in three cells of hue (${inks.map((c) => hueOf(...lab(...c).slice(1)).toFixed(0)).join('°, ')}°)`);

const u = STYLE_PASS.uniforms;
const pass = (id, tier) => {
  const st = new Style(id);
  st.tier = tier;
  st.sync();
  st.applyPass(u, 577);
  return u.uQian.value;
};
say(pass('qianjiang', 'high') === qj.qian && pass('qianjiang', 'mid') === qj.qian, `high and mid lay the colour (${qj.qian})`);
say(pass('qianjiang', 'low') === 0, 'low lays none: the ink as it is');
say(pass('ink', 'high') === 0, 'the ink lays none');
say(/if \(uQian > 0\.0 && sky < 0\.5\)/.test(STYLE_PASS.fragmentShader), 'the colour is in the ink\'s pass, behind its own number');

// --- in the page ------------------------------------------------------------------------------------------------------------

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
      bpp = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
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
      for (let k = 0; k < 3; k++) out[(y * w + x) * 4 + k] = line[x * bpp + k];
      out[(y * w + x) * 4 + 3] = 255;
    }
    [prev, line] = [line, prev];
  }
  return { w, h, data: out };
}

// The car in look.mjs's map: its colour (240, 80, 40), darkened with the distance.
const isCar = (r, g, b) => r > 60 && Math.abs(g / r - 80 / 240) < 0.04 && Math.abs(b / r - 40 / 240) < 0.04;

// The tones of a frame by its lightness alone, as look.mjs has them (t, 0 the paper's lightness and 1 the ink's),
// in six bands: under 0.1 (the paper, or near it), then 清 淡 重 浓 焦. (look.mjs's frame.ink.bands are of the
// pixels that are not the paper's colour: a pixel as light as the paper with a pale colour on it moves from the
// paper into the bands there, though it is no darker.)
function toneBands(dir, name) {
  const img = decodePNG(readFileSync(`${dir}/${name}.png`));
  const map = decodePNG(readFileSync(`${dir}/${name}-map.png`));
  const Lp = lab(...ink.paper)[0];
  const Li = lab(...ink.inkCol)[0];
  const bands = new Float64Array(6);
  let n = 0;
  for (let p = 0; p < img.w * img.h; p++) {
    const q = p * 4;
    if (isCar(map.data[q], map.data[q + 1], map.data[q + 2])) continue;
    const t = Math.min(1, Math.max(0, (Lp - lab(img.data[q] / 255, img.data[q + 1] / 255, img.data[q + 2] / 255)[0]) / (Lp - Li)));
    bands[t < 0.1 ? 0 : Math.min(5, 1 + Math.floor((t - 0.1) / 0.2))]++;
    n++;
  }
  return Array.from(bands, (v) => v / Math.max(n, 1));
}

// The cells of hue of a frame: the share of the pixels with colour in each of twelve cells of 30 degrees.
function hueCells(dir, name) {
  const img = decodePNG(readFileSync(`${dir}/${name}.png`));
  const map = decodePNG(readFileSync(`${dir}/${name}-map.png`));
  const cells = new Float64Array(12);
  let n = 0;
  for (let p = 0; p < img.w * img.h; p++) {
    const q = p * 4;
    if (isCar(map.data[q], map.data[q + 1], map.data[q + 2])) continue;
    const [, a, b] = lab(img.data[q] / 255, img.data[q + 1] / 255, img.data[q + 2] / 255);
    if (Math.hypot(a, b) <= CHROMA) continue;
    cells[Math.floor(hueOf(a, b) / 30) % 12]++;
    n++;
  }
  return { n: n / (img.w * img.h), cells: Array.from(cells, (v) => v / Math.max(n, 1)) };
}

if (!has('--node-only')) {
  const dir = opt('--dir', 'out/qianjiang');
  const shots = opt('--shots', 'alpine,hills,valley').split(',');
  if (!existsSync(`${dir}/look.json`)) {
    const run = spawnSync('node', ['tools/look.mjs', '--shots', shots.join(','), '--styles', 'ink,qianjiang', '--dump', '--out', dir], { stdio: 'inherit' });
    say(run.status === 0, 'look.mjs drew the frames');
  }
  const look = JSON.parse(readFileSync(`${dir}/look.json`, 'utf8'));
  const res = look.results || look;
  for (const shot of shots) {
    const a = res[`${shot}:ink`];
    const b = res[`${shot}:qianjiang`];
    if (!a || !b) {
      say(false, `${shot}: both frames are there`);
      continue;
    }
    say(b.frame.sat >= SAT[0] && b.frame.sat <= SAT[1], `${shot}: frame.sat ${b.frame.sat} (the ink's ${a.frame.sat}), in ${SAT[0]}–${SAT[1]}`);
    const hc = hueCells(dir, `${shot}-qianjiang`);
    const big = hc.cells.map((v, k) => [k * 30, v]).filter(([, v]) => v >= CELL);
    say(big.length <= CELLS, `${shot}: ${big.length} cells of hue hold ${CELL * 100}% or more of the ${(hc.n * 100).toFixed(1)}% of pixels with colour (${big.map(([h, v]) => `${h}°–${h + 30}° ${(v * 100).toFixed(1)}%`).join(', ')})`);
    const ba = toneBands(dir, `${shot}-ink`);
    const bb = toneBands(dir, `${shot}-qianjiang`);
    const apart = Math.max(...ba.map((v, k) => Math.abs(v - bb[k])));
    say(Math.abs(a.frame.ink.tone - b.frame.ink.tone) <= TONE && apart <= BAND,
      `${shot}: the ink is as deep (tone ${b.frame.ink.tone} against ${a.frame.ink.tone}; the six bands of lightness at most ${apart.toFixed(4)} apart: ${bb.map((v) => v.toFixed(3)).join(' ')})`);
    say(a.cost.calls === b.cost.calls && a.cost.triangles === b.cost.triangles && a.cost.textures === b.cost.textures,
      `${shot}: the same draws, triangles and textures (${b.cost.calls}, ${b.cost.triangles}, ${b.cost.textures}; programs ${b.cost.programs} against ${a.cost.programs})`);
  }
}

console.log(failed ? `\nFAILED: ${failed}` : '\nOK');
process.exit(failed ? 1 : 0);
