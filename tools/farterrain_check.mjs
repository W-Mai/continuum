// The far tiles' program (render/terrain.js, FAR_PROGRAM) against the land's own, in the page.
//
// Runs the page headless (seed 7, the real style, the high tier) at the worlds and road distances of the look's three
// places with the most far land (alpine: the alpine world at 900 m; valley: at 5000 m; desert: the desert at 2200 m),
// the car stood still and the lens at the chase, and holds:
//  - the frame: the same frame with every tile in the land's own program (farFrom Infinity) and with the tiles wholly
//    past FAR_LAND in the far one: the share of the pixels that differ by more than 3 of 255 in a channel, at most
//    `differ`; some tiles are far, and the far program is the one they are drawn with;
//  - the change: the frame just before a tile in sight changes program and just after (the line put a metre short of
//    the nearest point of its box and a metre past it, the lens where it is): the mean OKLab L of the land between 300
//    and 1500 m (the look's ground.far) and past 1500 m (ground.range) differs by at most `jump`;
//  - the page makes no errors.
// The land's pixels are those whose depth is the depth of the land drawn alone.
//
// Usage: PORT=8370 node tools/farterrain_check.mjs [--frames DIR]
//   --frames  each place's two frames (own-, far-) are written to DIR (PNG)

import { mkdirSync, writeFileSync } from 'node:fs';
import { serve, waitForServer, openPage, INIT, fromURL, metres, sleep } from './shadow_check.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const FRAMES = opt('--frames', null) ? opt('--frames').replace(/\/?$/, '/') : null;

const LIMIT = {
  differ: 0.002,     // of the pixels, by more than 3 of 255
  jump: 0.003,       // OKLab L, the land's mean in a zone, the frame before a tile changes program and after
  noise: 0.0001,     // of the pixels, between the same frame drawn twice (the alpine place has a few of its own)
};
const PLACES = [
  { name: 'alpine', world: 'alpine', s: 900 },
  { name: 'valley', world: 'alpine', s: 5000 },
  { name: 'desert', world: 'desert', s: 2200 },
];
const FAR = 4000;   // m, the depth read to

const results = [];
let failed = 0;
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
}
const num = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(d));

function keep(name, url) {
  if (!FRAMES) return;
  mkdirSync(FRAMES, { recursive: true });
  writeFileSync(`${FRAMES}${name}.png`, Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64'));
}

// In the page: the frames of a place, and the depth of the scene and of the land alone.
const FRAME = (s, FAR_LAND, LEVELS) => `
  const FAR_LAND = ${FAR_LAND};
  const LEVELS = ${JSON.stringify(LEVELS)};
  const sc = window.__sc;
  const t = g.terrain;
  sc.place(${s}, true, null);
  const draw = (from) => { t.farFrom = from; return sc.draw(); };
  const own = draw(Infinity);
  const again = draw(Infinity);
  const far = draw(FAR_LAND);
  const farTiles = t.farTiles;
  const onFar = [...t.tiles.values()].filter((m) => m.visible && m.material === t.farMaterial).length;
  const depth = sc.depth(${FAR});
  const shown = g.scene.children.map((o) => o.visible);
  g.scene.children.forEach((o) => { if (o !== t.group) o.visible = false; });
  t.farFrom = Infinity;
  g.render();
  const land = sc.depth(${FAR});
  g.scene.children.forEach((o, i) => { o.visible = shown[i]; });
  // The tile in sight nearest past the line: its box's nearest point from the lens.
  const c = g.camera.position;
  let best = Infinity;
  for (const m of t.tiles.values()) {
    if (!m.visible || m.userData.buried) continue;
    const size = LEVELS[m.userData.level];
    const b = m.geometry.boundingBox;
    const p = m.position;
    const dx = Math.max(p.x - c.x, 0, c.x - p.x - size);
    const dz = Math.max(p.z - c.z, 0, c.z - p.z - size);
    const dy = Math.max(b.min.y - c.y, 0, c.y - b.max.y);
    const d = Math.hypot(dx, dy, dz);
    if (d > FAR_LAND + 2 && d < best) best = d;
  }
  const before = draw(best + 1);
  const n0 = t.farTiles;
  const after = draw(best - 1);
  const n1 = t.farTiles;
  t.farFrom = FAR_LAND;
  return { own, again, far, farTiles, onFar, depth, land, line: best, before, after, changed: n1 - n0 };
`;

const LIN = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
function oklabL(img, i) {
  const r = LIN[img.data[i * 4]];
  const g = LIN[img.data[i * 4 + 1]];
  const b = LIN[img.data[i * 4 + 2]];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

function differ(A, B) {
  const n = A.w * A.h;
  let any = 0;
  let more = 0;
  let max = 0;
  for (let i = 0; i < n; i++) {
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(A.data[i * 4 + c] - B.data[i * 4 + c]));
    if (d > 0) any++;
    if (d > 3) more++;
    max = Math.max(max, d);
  }
  return { any: any / n, more: more / n, max, n };
}

// The land's mean L in each zone, in two frames.
function zones(A, B, depth, land) {
  const z = metres(depth, FAR);
  const zl = metres(land, FAR);
  const sum = { far: [0, 0, 0], range: [0, 0, 0] };
  for (let i = 0; i < z.length; i++) {
    if (zl[i] >= FAR * 0.999 || Math.abs(z[i] - zl[i]) > Math.max(0.3, z[i] * 0.002)) continue;
    const k = z[i] >= 300 && z[i] < 1500 ? 'far' : z[i] >= 1500 ? 'range' : null;
    if (!k) continue;
    sum[k][0] += oklabL(A, i);
    sum[k][1] += oklabL(B, i);
    sum[k][2]++;
  }
  const out = {};
  for (const k of Object.keys(sum)) {
    const [a, b, n] = sum[k];
    out[k] = n ? { a: a / n, b: b / n, d: Math.abs(a - b) / n, n } : { a: null, b: null, d: 0, n: 0 };
  }
  return out;
}

async function main() {
  const server = serve();
  let code = 0;
  const pages = [];
  try {
    if (!(await waitForServer())) throw new Error('the dev server did not come up');
    for (const world of [...new Set(PLACES.map((p) => p.world))]) {
      const page = await openPage(`seed=7&world=${world}&s=${PLACES.find((p) => p.world === world).s}&cam=chase&style=real&run=60`);
      pages.push(page);
      await page.run(INIT);
      const consts = await page.run(`const T = await import('./src/render/terrain.js'); const B = await import('./src/world/bakery.js'); return { far: T.FAR_LAND, levels: B.LAND_LEVELS };`);
      for (const place of PLACES.filter((p) => p.world === world)) {
        const r = await page.run(FRAME(place.s, consts.far, consts.levels));
        keep(`own-${place.name}`, r.own);
        keep(`far-${place.name}`, r.far);
        const own = fromURL(r.own);
        const noise = differ(own, fromURL(r.again));
        const d = differ(own, fromURL(r.far));
        check(`${place.name}: the same frame twice`, noise.any <= LIMIT.noise, `${num(noise.any * 100, 4)} % of the pixels differ (at most ${LIMIT.noise * 100} %)`);
        check(`${place.name}: the far tiles' program against the land's own`, d.more <= LIMIT.differ && r.farTiles > 0 && r.onFar > 0,
          `${num(d.more * 100, 4)} % of the pixels differ by more than 3 of 255 (at most ${LIMIT.differ * 100} %), ${num(d.any * 100, 4)} % at all, by ${d.max} at most; ${r.farTiles} tiles far, ${r.onFar} of them in sight; ${own.w}x${own.h}`);
        const zs = zones(fromURL(r.before), fromURL(r.after), fromURL(r.depth), fromURL(r.land));
        const jump = Math.max(zs.far.d, zs.range.d);
        check(`${place.name}: the frame a tile ${num(r.line, 0)} m off changes program in`, jump <= LIMIT.jump && r.changed > 0,
          `the land's mean L ${num(zs.far.a, 4)} → ${num(zs.far.b, 4)} from 300 to 1500 m (${zs.far.n} px), ${num(zs.range.a, 4)} → ${num(zs.range.b, 4)} past 1500 m (${zs.range.n} px): ${num(jump, 5)} at most (at most ${LIMIT.jump}); ${r.changed} tiles changed`);
      }
      check(`${world}: the page makes no errors`, page.logs.length === 0, page.logs.length ? page.logs.slice(0, 3).join(' | ') : 'none');
      page.close();
    }
    code = failed ? 1 : 0;
    console.log(failed ? `\nFAILED: ${failed} of ${results.length}` : `\nOK: ${results.length} checks held`);
  } catch (e) {
    console.error(e);
    code = 2;
  } finally {
    for (const p of pages) p.close();
    server.kill();
  }
  await sleep(300);
  process.exit(code);
}

await main();
