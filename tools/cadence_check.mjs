// How often the sun's far shadow map is drawn, and that a map drawn some metres back draws the frame as a new one does.
//
// Runs the page headless (seed 7, the hills, the real style, the high tier, farshadow=alt: the page's own cadence
// of the far map) and holds it to:
//  - the drive: 20 seconds of the autopilot at 22 m/s, the near map drawn in every frame and the far map in no more
//    than `share` of them. The frames are stepped without being drawn, and the far map is taken as drawn where the
//    page would draw it (the decision is the page's own, render/atmosphere.js _farWanted); 24 frames that are drawn
//    before it hold that to what the renderer does, frame by frame;
//  - the frame: at two places, the far map as stale as the page lets it be (and a frame more: the frame the page
//    has it due in, drawn with the old one) against the same frame with the far map drawn in it: the pixels that differ at all, and by more than
//    2 of 255, and where the edges of the shadows between 35 and 180 m are (the rows of the frame, an edge being a
//    step of at least 8 % of the brightness, where the two frames differ near it): they move by at most `edge` px.
//    The same frame drawn twice differs in a few pixels of its own (`noise` at most); an edge within 4 px of one of
//    those is passed over;
//  - what the shadow passes cost: the triangles of each map's pass in a frame that draws it, and so in a frame on
//    average at the cadence of the drive.
//
// Usage: PORT=8366 node tools/cadence_check.mjs [--frames DIR]
//   --frames  the two frames of each place (stale-, fresh-) are written to DIR (PNG)

import { mkdirSync, writeFileSync } from 'node:fs';
import { serve, waitForServer, openPage, INIT, fromURL, luma, metres, sleep } from './shadow_check.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const FRAMES = opt('--frames', null) ? opt('--frames').replace(/\/?$/, '/') : null;

const LIMIT = {
  share: 0.1,        // of the frames of the drive that draw the far map
  differ: 0.001,     // of the pixels, between the stale far map and a new one
  edge: 1,           // px, an edge of a shadow between 35 and 180 m (as the car's shadow in shadow_check: a far map
                     // two frames old, as the page had it every other frame, moves one by 0.84 px already)
  noise: 0.0001,     // of the pixels, between the same frame drawn twice
};

const results = [];
let failed = 0;
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
}
const num = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(d));

async function drive(page) {
  return page.run(`
    const sc = window.__sc;
    sc.place(5000, false, null);
    const a = g.atmosphere;
    // What each map's pass draws in triangles, in frames that draw it.
    const tris = [0, 0], frames = [0, 0];
    const direct = g.renderer.renderBufferDirect;
    g.renderer.renderBufferDirect = function (camera) {
      const material = arguments[3];
      if (material && material.isMeshDepthMaterial && camera.userData && camera.userData.cascade !== undefined) {
        const before = g.renderer.info.render.triangles;
        const done = direct.apply(this, arguments);
        tris[camera.userData.cascade] += g.renderer.info.render.triangles - before;
        return done;
      }
      return direct.apply(this, arguments);
    };
    const drawn = () => a.farDraws;
    for (let i = 0; i < 4; i++) { g.pilot.vMax = 22; g.update(1 / 60); sc.draw(); }
    tris[0] = tris[1] = 0;
    // 24 frames drawn: the far map is drawn in each one the page has it due in, and in no other.
    let agree = 0, due = 0;
    for (let i = 0; i < 24; i++) {
      g.pilot.vMax = 22;
      g.update(1 / 60);
      const want = a._farDue && a._farOn;
      const n = drawn();
      sc.draw();
      const did = drawn() > n;
      frames[0]++;
      if (did) frames[1]++;
      if (did === want) agree++;
      if (want) due++;
    }
    g.renderer.renderBufferDirect = direct;
    // 20 seconds of the drive, stepped: where the page would draw the far map, it is taken as drawn.
    const s0 = g.sCar;
    let farN = 0, origins = 0;
    let ox = a._farO.x, oz = a._farO.z;
    const N = 1200;
    for (let i = 0; i < N; i++) {
      g.pilot.vMax = 22;
      g.update(1 / 60);
      if (a._farDue && a._farOn) {
        a._farDue = false;
        a._farDrawn();
        farN++;
        if (a._farO.x !== ox || a._farO.z !== oz) { origins++; ox = a._farO.x; oz = a._farO.z; }
      }
    }
    return { agree, due, real: frames, nearTris: tris[0] / Math.max(1, frames[0]), farTris: tris[1] / Math.max(1, frames[1]),
      farN, N, metres: g.sCar - s0, origins, speed: g.car.speed, farOn: a._farOn };
  `);
}

// The far map as stale as the page lets it be against a new one, in the same frame.
async function frame(page, s) {
  return page.run(`
    const sc = window.__sc;
    const { styleU } = await import('./src/render/style.js');
    sc.place(${s}, false, null);
    const a = g.atmosphere;
    // A frame drawn in which the far map is: from there it is stepped on, not drawn, until the page has it due again
    // (the frame it is due in is drawn with the old one: a frame more than the page lets it be).
    for (let i = 0; i < 40; i++) {
      g.pilot.vMax = 22;
      g.update(1 / 60);
      a._farDue = true;
      sc.draw();
      const n = a.farDraws;
      let moved = 0, k = 0;
      const far = a.cascades[1];
      while (k++ < 600) {
        g.pilot.vMax = 22;
        g.update(1 / 60);
        moved = Math.hypot(far.x - a._farAt.x, far.z - a._farAt.z);
        if (a._farDue || a._farO.x !== styleU.uOriginAbs.value.x) break;
      }
      if (a._farO.x !== styleU.uOriginAbs.value.x || a._farO.z !== styleU.uOriginAbs.value.z || !a._farDue || a._farSince < 2) continue;
      a._farDue = false;
      const stale = sc.draw();
      const again = sc.draw();
      a._farDue = true;
      const fresh = sc.draw();
      const depth = sc.depth(400);
      return { stale, again, fresh, depth, moved, stepped: k, drawnStale: a.farDraws - n };
    }
    return null;
  `);
}

function compare(r) {
  const A = fromURL(r.stale);
  const B = fromURL(r.fresh);
  const C = fromURL(r.again);
  const n = A.w * A.h;
  let any = 0, more = 0, same = 0;
  const noisy = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let d = 0, e = 0;
    for (let c = 0; c < 3; c++) {
      d = Math.max(d, Math.abs(A.data[i * 4 + c] - B.data[i * 4 + c]));
      e = Math.max(e, Math.abs(A.data[i * 4 + c] - C.data[i * 4 + c]));
    }
    if (d > 0) any++;
    if (d > 2) more++;
    if (e > 0) {
      same++;
      noisy[i] = 1;
    }
  }
  // The edges of the shadows between 35 and 180 m: along each row, a step of 8 % of the brightness in the new
  // frame, its place (the centre of the step's slope over 5 pixels) in either frame.
  const D = fromURL(r.depth);
  const z = metres(D, 400);
  const la = luma(A);
  const lb = luma(B);
  const { w, h } = A;
  const shifts = [];
  const place = (L, y, x) => {
    let s = 0, m = 0;
    for (let k = -2; k <= 2; k++) {
      const g = Math.abs(L[y * w + x + k + 1] - L[y * w + x + k]);
      s += g;
      m += g * (x + k + 0.5);
    }
    return s > 0 ? m / s : null;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 3; x < w - 4; x++) {
      const i = y * w + x;
      if (z[i] < 35 || z[i] > 180 || z[i + 1] < 35 || z[i + 1] > 180) continue;
      const gb = Math.abs(lb[i + 1] - lb[i]);
      const ga = Math.abs(la[i + 1] - la[i]);
      if (gb < 0.08 || ga < 0.08 || gb < Math.abs(lb[i] - lb[i - 1]) || gb < Math.abs(lb[i + 2] - lb[i + 1])) continue;
      // (Where the two frames differ near it: an edge of the frame, not only one of the shadow's, is passed over
      // where they do not.)
      let near = false;
      let quiet = true;
      for (let k = -3; k <= 4 && !near; k++) if (la[i + k] !== lb[i + k]) near = true;
      for (let dy = -4; dy <= 4 && quiet; dy++) for (let k = -4; k <= 5 && quiet; k++) {
        const j = (y + dy) * w + x + k;
        if (j >= 0 && j < n && noisy[j]) quiet = false;
      }
      if (!near || !quiet) continue;
      const pa = place(la, y, x);
      const pb = place(lb, y, x);
      if (pa !== null && pb !== null) shifts.push(Math.abs(pa - pb));
    }
  }
  shifts.sort((p, q) => p - q);
  return {
    any: any / n, more: more / n, same, w, h,
    edges: shifts.length, edgeMax: shifts.length ? shifts[shifts.length - 1] : 0, edgeP95: shifts.length ? shifts[Math.floor(shifts.length * 0.95)] : 0,
  };
}

function keep(name, url) {
  if (!FRAMES) return;
  mkdirSync(FRAMES, { recursive: true });
  writeFileSync(`${FRAMES}${name}.png`, Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64'));
}

async function main() {
  const server = serve();
  let code = 0;
  let page = null;
  try {
    if (!(await waitForServer())) throw new Error('the dev server did not come up');
    page = await openPage('seed=7&world=hills&s=5000&cam=chase&style=real&run=60&farshadow=alt');
    await page.run(INIT);
    const d = await drive(page);
    check('drawn frames: the far map where it is due', d.agree === 24 && d.due > 0 && d.farOn, `${d.agree} of 24 frames drawn as decided (${d.due} with it due; near pass ${d.real[0]} of ${d.real[0]}, far ${d.real[1]})`);
    const share = d.farN / d.N;
    check('the far map in 20 s of the drive', share <= LIMIT.share && d.farN > 0, `${d.farN} of ${d.N} frames (${num(share * 100, 1)} %, at most ${LIMIT.share * 100} %) over ${num(d.metres, 0)} m, ${d.origins} of them for the floating origin; the near map in all of them`);
    const avg = d.nearTris + d.farTris * share;
    const was = d.nearTris + d.farTris * 0.5;
    console.log(`      triangles of a pass: near ${Math.round(d.nearTris)}, far ${Math.round(d.farTris)}; a frame on average ${Math.round(avg)} (every other frame it would be ${Math.round(was)}, ${num((1 - avg / was) * 100, 1)} % fewer)`);
    let i = 0;
    for (const s of [5000, 9000]) {
      const r = await frame(page, s);
      if (!r) {
        check(`the frame at ${s}`, false, 'no stretch of the drive that keeps the far map that long');
        continue;
      }
      keep(`stale-${s}`, r.stale);
      keep(`fresh-${s}`, r.fresh);
      const c = compare(r);
      check(`the same frame twice at ${s}`, c.same / (c.w * c.h) <= LIMIT.noise, `${c.same} pixels differ (${num(c.same / (c.w * c.h) * 100, 4)} %, at most ${LIMIT.noise * 100} %)`);
      check(`a far map ${num(r.moved, 1)} m and ${r.stepped} frames back at ${s}`, c.any <= LIMIT.differ && r.drawnStale === 1,
        `${num(c.any * 100, 3)} % of the pixels differ (at most ${LIMIT.differ * 100} %), ${num(c.more * 100, 3)} % by more than 2 of 255; ${c.w}x${c.h}`);
      check(`edges of the shadows from 35 to 180 m at ${s}`, c.edgeMax <= LIMIT.edge, `${c.edges} edges where the frames differ, moved at most ${num(c.edgeMax, 3)} px (95th ${num(c.edgeP95, 3)}; at most ${LIMIT.edge})`);
      i++;
    }
    check('the page makes no errors', page.logs.length === 0, page.logs.length ? page.logs.slice(0, 3).join(' | ') : 'none');
    code = failed ? 1 : 0;
    console.log(failed ? `\nFAILED: ${failed} of ${results.length}` : `\nOK: ${results.length} checks held`);
  } catch (e) {
    console.error(e);
    code = 2;
  } finally {
    if (page) page.close();
    server.kill();
  }
  await sleep(300);
  process.exit(code);
}

await main();
