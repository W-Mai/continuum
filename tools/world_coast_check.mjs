// What the coast has of its own is there, where it should be, goes as it should and costs what it should.
//
// In node first (no browser), over three seeds: the swash (world/coastplan.js) is a round of 8 s, a fifth of a round
// out of step for each 30 m along the shore, as high as the world says, and wets the ground it covers and dries it in
// 6 s; on the land as it is the waterline goes to and fro by about 1.8 m (the middle one of the beaches); the plan is the same
// each time it is asked; every boat is on deep water, at least 400 m and at most 3 km from any land, and goes at a slow
// walk; every reef stands in 0.25 to 3 m of water off the road; the wall stands 0.55 m outside the verge, in runs of at least
// 12 m, where there is water within 15 m of the verge, with a station every 2 m; the gulls call 5 to 15 s apart.
//
// Then in the page (the coast, seed 7, the place `coast` of tools/look.mjs, and `coastlow`, the lens low over the sea): twelve
// boats, all on the water and over 400 m from land; as many reefs as the plan has near and a ring of foam to each; the wall
// where the plan says; the waterline (the edge of the sea in the picture, put back on the world by the depth) 4 s on is 1 m or more
// from where it was and the foam on it is white over a fifth to seven tenths of the pixels within a metre of it; the sand the water has just
// left is darker than the dry sand by 15 per cent or more; the water's own change in a sixtieth of a second stays under 0.015; at the
// tiers: all at high, half at mid, nothing at low and the sea as it was; every style draws it with no GL error, and what it adds to a
// frame (draw calls, triangles, textures) is counted; a minute driven
// on the coast is heard (tools/sound_demo.mjs): a wave breaks 6 to 25 times and a gull calls 4 to 12 times, each where
// its call is due, with no clipping. Last the coast is disposed of and what it held is let go.
//
// Usage: node tools/world_coast_check.mjs [--node-only] [--only node,page,sound,look (some of them)] [--keep out/coast-check]
//   --keep: the frames the page draws are written there (each style with the coast's own things and without them, and a view each
//   of the boats, the rocks and the wall, so that they can be looked at).
// PORT=8199 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { makeWorldLand, WORLDS } from '../src/world/worlds.js';
import { Road, HALF_FLAT, GROUND } from '../src/world/road.js';
import { Corridor } from '../src/world/corridor.js';
import { readWav, band, level, peakOf } from './sound_measure.mjs';
import {
  CoastPlan, COAST, SWASH, BOATS, REEF, WALL, GULL, boatAt, swashLift, swashWet, swashPhase, alongOf, gullGap,
} from '../src/world/coastplan.js';

const ROOT = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const NODE_ONLY = args.includes('--node-only');
const KEEP = args.includes('--keep') ? args[args.indexOf('--keep') + 1] : null;

let failed = 0;
const say = (ok, text) => {
  console.error(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) failed++;
};
const span = (a) => (a.length ? `${Math.min(...a).toFixed(2)}..${Math.max(...a).toFixed(2)}` : 'none');
const quantile = (a, q) => {
  const s = a.slice().sort((x, y) => x - y);
  return s.length ? s[Math.floor((s.length - 1) * q)] : NaN;
};
const median = (a) => quantile(a, 0.5);
const AMP = WORLDS[COAST].liquid.swash;

// --- in node: the swash -------------------------------------------------------------------

function swashPart() {
  // A round is SWASH.period seconds, and the lift is as high as the world says either way of the still level.
  let max = 0;
  let min = 0;
  let mean = 0;
  let again = 0;
  const N = 800;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * SWASH.period;
    const l = swashLift(AMP, t, 1234.5);
    max = Math.max(max, l);
    min = Math.min(min, l);
    mean += l / N;
    again = Math.max(again, Math.abs(l - swashLift(AMP, t + SWASH.period, 1234.5)), Math.abs(l - swashLift(AMP, t + 5 * SWASH.period, 1234.5)));
  }
  say(Math.abs(max - AMP) < 1e-3 && Math.abs(min + AMP) < 1e-3 && Math.abs(mean) < 1e-3 && again < 1e-9,
    `the swash lifts the sea ${min.toFixed(3)} to ${max.toFixed(3)} m about the still level (the world says ${AMP} m each way), mean ${mean.toExponential(1)}, and goes round in ${SWASH.period} s (a round on differs by ${again.toExponential(1)} m)`);
  // A point 30 m on along the shore is a fifth of a round behind, 150 m on a whole round.
  const dPhase = (swashPhase(3, 30) - swashPhase(3, 0) + 2 * Math.PI) % (2 * Math.PI);
  const full = Math.abs(swashLift(AMP, 2.2, 150) - swashLift(AMP, 2.2, 0));
  say(Math.abs(dPhase - (2 * Math.PI) / 5) < 1e-9 && full < 1e-9, `the phase of the swash is a fifth of a round out of step for each ${SWASH.apart} m along the shore (${(dPhase / (2 * Math.PI)).toFixed(4)} of a round for 30 m), and the same again every ${SWASH.along} m`);
  // The ground: wet while the water is over it, half dry three seconds after the water has gone, dry after six, never wet over the top
  // of the swash. (The water leaves ground at height alt when the sine falls through alt over amp: at phase pi - asin(alt / amp).)
  const alt = 0.15;
  const gone = ((Math.PI - Math.asin(alt / AMP)) / (2 * Math.PI)) * SWASH.period;
  const at = (dt) => swashWet(alt, AMP, gone + dt, 0);
  say(at(-0.01) === 1 && at(0) >= 0.999 && Math.abs(at(SWASH.dry / 2) - 0.5) < 0.01 && at(SWASH.dry) < 1e-9 && at(SWASH.dry - 0.3) > 0 && at(SWASH.dry + 0.1) === 0,
    `ground ${alt} m over the still water is wet while the water is over it, half dry ${(SWASH.dry / 2).toFixed(1)} s after it has gone (${at(SWASH.dry / 2).toFixed(3)}) and dry ${SWASH.dry} s after (${at(SWASH.dry).toFixed(3)}; a third of a second before, ${at(SWASH.dry - 0.3).toFixed(3)})`);
  say(swashWet(AMP + 0.01, AMP, 1, 0) === 0 && swashWet(-AMP - 0.01, AMP, 1, 0) === 1,
    'ground over the top of the swash is never wet and ground under the bottom of it is always under water');
  // The waterline on the land as it is: where the sea's edge stands with the surface up and down, the half of the way between,
  // on a transect across each shore of the coast (a crossing of the land's height over the water level), seeds 7, 42, 3.
  for (const seed of [7, 42, 3]) {
    const land = makeWorldLand(seed, { start: 'coast' });
    const road = new Road(land, seed);
    road.update(300);
    const map = land.worlds;
    const at = (along, lat) => [map.ox + along * map.dx - lat * map.dz, map.oz + along * map.dz + lat * map.dx];
    const h = (along, lat) => {
      const [x, z] = at(along, lat);
      return land.heightAt(x, z);
    };
    const w = { a: 0, b: 0, t: 0, u: 0 };
    const half = [];
    for (let along = 0; along < 6000; along += 37) {
      let prev = h(along, -3500);
      for (let lat = -3499; lat < 3500; lat += 1) {
        const cur = h(along, lat);
        if ((prev < 0) !== (cur < 0)) {
          const [x, z] = at(along, lat);
          map.at(x, z, w);
          if (w.a === COAST && w.t === 0) {
            let a = lat - 1;
            let b = lat;
            for (let k = 0; k < 30; k++) {
              const m = (a + b) / 2;
              if ((h(along, m) < 0) === (prev < 0)) a = m;
              else b = m;
            }
            const c = (a + b) / 2;
            const dir = cur > prev ? 1 : -1;
            const reach = (target, sgn) => {
              for (let d = 0.05; d < 100; d += 0.05) {
                const v = h(along, c + dir * sgn * d);
                if (sgn > 0 ? v >= target : v <= target) return d;
              }
              return 100;
            };
            half.push((reach(AMP, 1) + reach(-AMP, -1)) / 2);
            lat += 20;
          }
        }
        prev = cur;
      }
    }
    const m = median(half);
    say(half.length > 300 && m > 1.2 && m < 2.6, `seed ${seed}: over ${half.length} shores the waterline goes to and fro by ${m.toFixed(2)} m either way of its middle (the middle one of them; a tenth go to and fro by less than ${quantile(half, 0.1).toFixed(2)} m and a tenth by more than ${quantile(half, 0.9).toFixed(2)}; 1.8 m is the aim)`);
  }
}

// --- in node: the plan ----------------------------------------------------------------------

function planOf(seed, start = 'coast') {
  const land = makeWorldLand(seed, { start });
  const road = new Road(land, seed);
  const corridor = new Corridor(road, land);
  const plan = new CoastPlan({ land, road, corridor, worlds: land.worlds, seed });
  return { land, road, corridor, plan };
}

// How far the nearest land is from a point (m), looked for finely: a point every 25 m on 90 directions round, out to `limit`.
function landWithin(land, x, z, limit) {
  for (let r = 25; r <= limit; r += 25) {
    for (let k = 0; k < 90; k++) {
      const a = (k / 90) * Math.PI * 2;
      if (land.heightAt(x + r * Math.cos(a), z + r * Math.sin(a)) > 0) return r;
    }
  }
  return Infinity;
}

const jsonOf = (v) => JSON.stringify(v, (k, x) => (x instanceof Float32Array || x instanceof Float64Array ? [...x] : x));

// How far outside the verge the water is, at the station n of the road on a side (m, looked for every quarter of a metre on the line
// out from the road, as the ground is drawn); Infinity where there is none within reach, or the road there is not on the ground.
function waterNear(P, n, side) {
  const r = P.road.at(n * WALL.every);
  if (!r || r.kind !== GROUND) return Infinity;
  const o = P.road.origin;
  for (let e = 0.25; e <= WALL.reach + 3; e += 0.25) {
    const lat = HALF_FLAT + e;
    const wx = r.x + o.x - Math.sin(r.theta) * lat * side;
    const wz = r.z + o.z + Math.cos(r.theta) * lat * side;
    if (P.corridor.heightAt(wx, wz) < P.land.waterLevel(wx, wz) - 0.05) return e;
  }
  return Infinity;
}

// The places the plan is held to, by seed: the places of the coast of each where the road runs by the sea.
const PLACES = { 7: [900, 2500, 4100], 42: [900, 5700, 5900], 3: [800, 3500, 5100] };

function planPart() {
  const gap = [];
  for (let n = 1; n < 400; n++) gap.push(gullGap(n, 7), gullGap(n, 42));
  say(Math.min(...gap) >= GULL.apart[0] && Math.max(...gap) <= GULL.apart[1], `a gull calls ${GULL.apart[0]} to ${GULL.apart[1]} s after the one before (${span(gap)} s over 800 gaps), the first ${GULL.first} s after the lens comes in`);
  for (const seed of [7, 42, 3]) {
    const A = planOf(seed);
    const B = planOf(seed);
    const boats = new Map();
    const reefs = new Map();
    const stat = {
      runs: 0, stations: 0, offMax: 0, lenMin: Infinity, lenMax: 0, waterMax: 0, rowMin: Infinity, low: 0, off: 0,
    };
    let same = true;
    // Three places along the coast, one with the road by the sea in each; the road as it is at each (it lets go of what is far behind).
    for (const sCar of PLACES[seed]) {
      for (const P of [A, B]) {
        for (let s = 200; s <= sCar + 700; s += 100) P.road.update(s);
        P.road.update(sCar + 700);
      }
      const o = A.road.origin;
      const p = A.road.at(sCar);
      const ax = p.x + o.x;
      const az = p.z + o.z;
      const q = B.road.at(sCar);
      const lo = A.plan.boatsNear(ax, az, BOATS.range, 99);
      const lo2 = B.plan.boatsNear(q.x + B.road.origin.x, q.z + B.road.origin.z, BOATS.range, 99);
      if (jsonOf(lo) !== jsonOf(lo2)) same = false;
      for (const b of lo) boats.set(b.key, b);
      for (let bx = Math.floor((ax - 700) / REEF.block); bx <= Math.floor((ax + 700) / REEF.block); bx++) {
        for (let bz = Math.floor((az - 700) / REEF.block); bz <= Math.floor((az + 700) / REEF.block); bz++) {
          const r = A.plan.reefsIn(bx, bz);
          if (r === undefined) continue;
          if (jsonOf(r) !== jsonOf(B.plan.reefsIn(bx, bz))) same = false;
          for (const e of r) reefs.set(e.key, { ...e, road: A.plan.roadNear(e.ax, e.az, 200).dist, ground: A.corridor.heightAt(e.ax, e.az) });
        }
      }
      for (let k = Math.floor((sCar - 300) / WALL.block); k <= Math.floor((sCar + 600) / WALL.block); k++) {
        const w = A.plan.wallRuns(k);
        if (w === undefined) continue;
        if (jsonOf(w) !== jsonOf(B.plan.wallRuns(k))) same = false;
        for (const run of w) {
          stat.runs++;
          const pts = run.pts;
          for (let i = 0; i < pts.length; i += 3) {
            stat.stations++;
            const x = pts[i];
            const z = pts[i + 2];
            const d = A.plan.roadNear(x, z, 40).dist;
            stat.offMax = Math.max(stat.offMax, Math.abs(d - (HALF_FLAT + WALL.off)));
            if (Math.abs(pts[i + 1] - A.corridor.heightAt(x, z)) > 1e-6) stat.off++;
            if (pts[i + 1] <= A.land.waterLevel(x, z) + WALL.above) stat.low++;
            // Water within reach of the verge, found on the line out from the road at the station and at the stations either way of it
            // (as the ground is drawn, every quarter of a metre): the row of stations that have water near, that it is one of.
            const m = run.from + i / 3;
            const found = waterNear(A, m, run.side);
            stat.waterMax = Math.max(stat.waterMax, found);
            let row = 1;
            for (let d = 1; d <= 8 && waterNear(A, m - d, run.side) <= WALL.reach + 1.1; d++) row++;
            for (let d = 1; d <= 8 && waterNear(A, m + d, run.side) <= WALL.reach + 1.1; d++) row++;
            stat.rowMin = Math.min(stat.rowMin, row);
            if (i) {
              const l = Math.hypot(pts[i] - pts[i - 3], pts[i + 2] - pts[i - 1]);
              stat.lenMin = Math.min(stat.lenMin, l);
              stat.lenMax = Math.max(stat.lenMax, l);
            }
          }
        }
      }
    }
    const name = `seed ${seed}`;
    say(same, `${name}: the boats, reefs and walls are the same each time they are asked for (${boats.size} boats, ${reefs.size} reefs, ${stat.runs} runs of wall at three places)`);
    // The boats: deep water the whole way round their circle, at least 400 m from land, within 3 km, at a slow walk.
    let nearest = Infinity;
    let farthest = 0;
    let shallow = 0;
    let fast = 0;
    let slow = Infinity;
    const rs = [];
    for (const b of boats.values()) {
      const q = {};
      for (let k = 0; k < 8; k++) {
        boatAt(b, (k / 8) * ((Math.PI * 2) / b.rate), q);
        const d = landWithin(A.land, q.x, q.z, BOATS.far + 400);
        nearest = Math.min(nearest, d);
        if (d !== Infinity) farthest = Math.max(farthest, d);
        if (A.land.heightAt(q.x, q.z) > -BOATS.deep + 0.5) shallow++;
      }
      const v = b.rate * b.r;
      fast = Math.max(fast, v);
      slow = Math.min(slow, v);
      rs.push(b.r);
    }
    say(boats.size >= 12 && nearest >= 400 && farthest <= BOATS.far + 125 && !shallow,
      `${name}: ${boats.size} boats, each over water ${BOATS.deep} m deep all the way round its circle (${shallow} points shallower), the nearest land 400 m or more off (${nearest} m, looked for every 25 m on 90 directions) and none farther than 3 km (${farthest} m)`);
    say(slow >= BOATS.speed[0] - 1e-9 && fast <= BOATS.speed[1] + 1e-9 && Math.min(...rs) >= BOATS.loop[0] && Math.max(...rs) <= BOATS.loop[1],
      `${name}: they go at ${slow.toFixed(2)} to ${fast.toFixed(2)} m/s round circles ${span(rs)} m in radius`);
    // The reefs: in 0.25 to 3 m of water as the land is drawn, off the road, standing out of the water.
    let dMin = Infinity;
    let dMax = 0;
    let roadMin = Infinity;
    let high = 0;
    for (const r of reefs.values()) {
      dMin = Math.min(dMin, -r.ground);
      dMax = Math.max(dMax, -r.ground);
      roadMin = Math.min(roadMin, r.road - r.r);
      if (!(r.top >= REEF.rise[0] - 1e-9 && r.top <= REEF.rise[1] + 1e-9)) high++;
    }
    say(reefs.size >= 40 && dMin >= REEF.depth[0] - 0.02 && dMax <= REEF.depth[1] + 0.02 && !high,
      `${name}: ${reefs.size} reefs, each in ${dMin.toFixed(2)} to ${dMax.toFixed(2)} m of water as the land is drawn (0.25 to 3), each coming out of it by ${REEF.rise[0]} to ${REEF.rise[1]} m`);
    say(roadMin >= HALF_FLAT + REEF.margin - 0.05, `${name}: none stands on the road or its verge (the nearest rock's foot is ${roadMin.toFixed(1)} m from the middle of the road, the verge is at ${HALF_FLAT})`);
    // The wall: each station 0.55 m outside the verge, water within 15 m of the verge's far edge, a piece 2 m long, a run 12 m at least.
    say(stat.runs >= 1 || seed === 7, `${name}: ${stat.runs} runs of wall (${stat.stations} stations) at the three places`);
    if (stat.runs) {
      say(stat.offMax < 0.12 && !stat.off && !stat.low, `${name}: every station is ${HALF_FLAT + WALL.off} m from the middle of the road (off by ${stat.offMax.toFixed(3)} m at the most), on the ground as it is drawn, and its foot is over the water by ${WALL.above} m or more (${stat.low} are not)`);
      say(stat.waterMax <= WALL.reach + 1.1 && stat.lenMin > 1.5 && stat.lenMax < 2.5 && stat.rowMin >= WALL.min,
        `${name}: water is within ${WALL.reach} m of the verge at each (the farthest ${stat.waterMax.toFixed(2)} m out), a piece of wall is ${stat.lenMin.toFixed(2)} to ${stat.lenMax.toFixed(2)} m long, and each station is one of ${WALL.min} or more in a row that have water near (the fewest ${stat.rowMin}: ${WALL.min * WALL.every - WALL.every} m of road or more)`);
    }
  }
}

// The waterline of a frame is found whether the land lies above the sea in it (the lens over the sea) or below it (the lens on the land,
// the sea beyond the beach), and a run of sea under 8 rows is no waterline.
function linePart() {
  const w = 3;
  const h = 60;
  // rows: [from, to, sea depth, land depth] each (a depth of 0: nothing is drawn there).
  const frame = (rows) => {
    const sea = new Float32Array(w * h);
    const land = new Float32Array(w * h);
    for (const [a, b, zs, zl] of rows) {
      for (let y = a; y < b; y++) {
        for (let x = 0; x < w; x++) {
          sea[y * w + x] = zs;
          land[y * w + x] = zl;
        }
      }
    }
    return { sea, land };
  };
  const at = (S) => waterlineOf(S, w, h, (x, y, z) => ({ x, y: 0, z: y * 0.5 + z }));
  // Land (the beach) at 62 m with the sea's plane hidden under it, then the sea at 60 m with the sea bed under it.
  const over = at(frame([[0, 20, 0, 0], [20, 40, 120, 62], [40, 60, 60, 70]]));
  say(over.every((p) => p && p.row === 40 && p.z === 60), `a waterline is found where the sea is below the land in the frame (row ${over[0] && over[0].row} of the 60)`);
  const beyond = at(frame([[0, 20, 0, 0], [20, 40, 100, 110], [40, 60, 130, 99]]));
  say(beyond.every((p) => p && p.row === 39 && p.z === 100), `and where it is above it (row ${beyond[0] && beyond[0].row})`);
  const thin = at(frame([[0, 20, 0, 0], [20, 26, 100, 110], [26, 60, 130, 99]]));
  say(thin.every((p) => p === null), 'a run of sea under 8 rows is no waterline');
  const none = at(frame([[0, 60, 0, 90]]));
  say(none.every((p) => p === null), 'nor is a frame with no sea in it');
}

const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const part = (name) => !ONLY || ONLY.includes(name);
if (part('node')) {
  swashPart();
  linePart();
  soundPart_node();
  planPart();
}
if (NODE_ONLY || (ONLY && ONLY.length === 1 && ONLY[0] === 'node')) {
  if (failed) {
    console.error(`\n${failed} problem${failed > 1 ? 's' : ''}`);
    process.exit(1);
  }
  console.error('\nOK: the plan of the coast');
  process.exit(0);
}

// --- in the page ----------------------------------------------------------------------------

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8192;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve(port = PORT) {
  return spawn('node', [ROOT + 'tools/serve.mjs', String(port), ROOT], { stdio: ['ignore', 'ignore', 'inherit'] });
}

async function waitForServer(port = PORT, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/`)).ok) return true;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  return false;
}

async function openPage(query) {
  const profile = `${tmpdir()}/continuum-coast-${process.pid}-${Date.now()}`;
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
  const logs = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') logs.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    if (msg.method === 'Runtime.exceptionThrown') logs.push(String(msg.params.exceptionDetails.text).slice(0, 300));
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
  let title = '';
  for (let i = 0; i < 900; i++) {
    title = await ev('document.title');
    if (title === 'GAME_DONE' || String(title).startsWith('GAME_FAIL')) break;
    await sleep(500);
  }
  if (title !== 'GAME_DONE') {
    chrome.kill();
    throw new Error(`page: ${title} ${logs.join(' | ')}`);
  }
  return {
    logs,
    run: async (body) => {
      const out = await ev(`(async () => { const g = game; ${body} })().then((v) => JSON.stringify(v), (e) => JSON.stringify({ error: e.message + ' ' + (e.stack || '').slice(0, 500) }))`);
      return JSON.parse(out);
    },
    close: () => {
      chrome.kill();
      setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
    },
  };
}

// In the page: the car put on the road at s of the coast, run for two and a half seconds, and the lens as the style gives it, or put by
// hand (eye: metres to the left of the road's middle, above the ground there, behind the car; it looks at the car, which stands still).
const PLACE = (s, eye = null) => `
  const p = g.road.at(${s});
  g.autoMode = true;
  g.sCar = ${s};
  g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(${s}, 1.9) + 0.3);
  g.car.vx = ${eye ? 0 : 22};
  g.setCamera('chase');
  g.chase.shaking = false;
  g.chase.lead = false;
  g.chase.snapTo(g.car, g.car.y || 0);
  g.style.wind[0] = 1000;
  g.style.wind[1] = 400;
  g.atmosphere.uniforms.uTime.value = 100;
  for (let i = 0; i < 150; i++) { g.pilot.vMax = ${eye ? 0 : 22}; g.update(1 / 60); }
  g.post.setStyle(g.style);
  g.atmosphere.bakeEnvironment();
  const eye = ${JSON.stringify(eye)};
  window.__eye = eye ? () => {
    const q = g.road.at(g.sCar - eye.back);
    const x = q.x - Math.sin(q.theta) * eye.side, z = q.z + Math.cos(q.theta) * eye.side;
    g.camera.position.set(x, g.groundAt(x, z) + eye.up, z);
    g.camera.up.set(0, 1, 0);
    g.camera.lookAt(g.car.x, g.car.y + 0.7, g.car.z);
    g.camera.updateMatrixWorld();
  } : null;
  if (window.__eye) window.__eye();
  return { world: g.snapshot().world.id, s: Math.round(g.sCar), stats: g.coast.stats() };
`;

// In the page: the boats that are drawn, from the instances themselves, and the plan's, against the sea (the world's own numbers).
const BOATS_NOW = `
  const THREE = await import('three');
  const cp = await import('./src/world/coastplan.js');
  const o = g.road.origin;
  const mesh = g.coast.boats.hulls;
  const sail = g.coast.boats.sails;
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const rows = [];
  const clock = g.water.time;
  const h = (x, z) => g.land.heightAt(x, z);
  const landWithin = (x, z) => {
    for (let r = 25; r <= 3500; r += 25) for (let k = 0; k < 90; k++) {
      const a = (k / 90) * Math.PI * 2;
      if (h(x + r * Math.cos(a), z + r * Math.sin(a)) > 0) return r;
    }
    return Infinity;
  };
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    v.setFromMatrixPosition(m);
    const ax = v.x + o.x, az = v.z + o.z;
    const b = g.coast.boats.list[i];
    const plan = cp.boatAt(b, clock, {});
    sail.getMatrixAt(i, m);
    const same = Math.abs(v.x - (m.elements[12])) + Math.abs(v.z - m.elements[14]);
    rows.push({ x: ax, z: az, y: v.y, depth: -h(ax, az), shore: landWithin(ax, az), off: Math.hypot(ax - plan.x, az - plan.z), sailOff: same, level: g.land.waterLevel(ax, az), key: b.key });
  }
  // The triangles of one boat: the hull's and the sail's.
  const tris = (geo) => (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
  return { count: mesh.count, drawn: mesh.visible && sail.visible, rows, hull: tris(mesh.geometry), sail: tris(sail.geometry), calls: 2 };
`;

// In the page: the reefs and the wall that are drawn, from the instances.
const SHORE_NOW = `
  const THREE = await import('three');
  const cp = await import('./src/world/coastplan.js');
  const { swashU, SWASH_FULL } = await import('./src/render/swash.js');
  const o = g.road.origin;
  const R = g.coast.reefs;
  const amp = swashU.uSwash.value.y * SWASH_FULL;
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const reefs = [];
  const foams = [];
  for (let i = 0; i < R.count; i++) {
    R.rocks.getMatrixAt(i, m);
    v.setFromMatrixPosition(m);
    const r = R.list[i];
    reefs.push({ x: v.x + o.x - r.ax, z: v.z + o.z - r.az, depth: r.depth, top: r.top, y: v.y, bed: r.y });
    R.foam.getMatrixAt(i, m);
    v.setFromMatrixPosition(m);
    foams.push({ y: v.y, radius: m.elements[0], rock: r.r, lift: amp > 0 ? cp.swashLift(amp, g.water.time, cp.alongOf(g.worlds, r.ax, r.az)) : 0 });
  }
  const W = g.coast.wall;
  const pieces = [];
  for (let i = 0; i < W.count; i++) {
    W.pieces.getMatrixAt(i, m);
    v.setFromMatrixPosition(m);
    pieces.push({ x: v.x + o.x, y: v.y, z: v.z + o.z, listed: W.list[i] });
  }
  const tris = (geo) => (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
  return { reefs, foams, pieces, wallTriangles: tris(W.pieces.geometry), reefTriangles: tris(R.rocks.geometry), foamTriangles: tris(R.foam.geometry), stats: g.coast.stats(), known: R.known };
`;

// The waterline of a shot, per column of the frame: where the lowest run of sea (8 rows or more) meets land at about its own distance,
// with the land above the run (the lens over the sea) or below it (the lens on the land and the sea beyond the beach). S: { sea, land }, the
// depth in metres of what the sea alone and what the land alone draw, 0 where there is nothing, rows from the top, w by h; point(x, row,
// depth) is the world point of a pixel ({ x, y, z }). It is written without anything outside it: the page is given its text.
function waterlineOf(S, w, h, point) {
  const pts = new Array(w).fill(null);
  for (let x = 0; x < w; x++) {
    const isSea = (yy) => S.sea[yy * w + x] > 0 && (S.land[yy * w + x] === 0 || S.sea[yy * w + x] <= S.land[yy * w + x]);
    // Land beside the sea at row yy, at row yl, at about the sea's distance.
    const beside = (yy, yl) => {
      if (yl < 0 || yl >= h) return false;
      const zs = S.sea[yy * w + x];
      const zl = S.land[yl * w + x];
      return zl > 0 && Math.abs(zl - zs) < 0.3 * zs + 1;
    };
    let y = h - 1;
    while (y >= 0) {
      if (!isSea(y)) {
        y--;
        continue;
      }
      let top = y;
      while (top - 1 >= 0 && isSea(top - 1)) top--;
      if (y - top >= 8) {
        const row = beside(top, top - 1) ? top : beside(y, y + 1) ? y : -1;
        if (row >= 0) {
          const zs = S.sea[row * w + x];
          const p = point(x, row, zs);
          pts[x] = { row, z: zs, x: p.x, zz: p.z, y: p.y };
          break;
        }
      }
      y = top - 1;
    }
  }
  return pts;
}

// In the page: the waterline of the frame, and how it moves. The sea alone and the land alone are drawn, each into a target of its own,
// and read back as the depth of what is nearest (as tools/look.mjs does for the map of what each pixel is): a pixel is sea where the sea is
// as near as the land or nearer. The waterline is, in each column of the frame, where the lowest run of sea pixels meets land at about
// the same distance; each point of it is put back on the world by its depth and the lens. The frame is drawn at the water's clock as it is,
// and 4 s on (the car and the lens as they were); the points of the one are put against the points of the other, column by column.
// And in the frame: how much of what is within a metre of the line is white (L over 0.85 in OKLab), and the sand the water has just
// left against the dry sand, by where the swash says each is. Nothing else moves between the frames: the water's clock is put back after.
const WATERLINE = `
  const THREE = await import('three');
  const { FullScreenQuad } = await import('./tools/vendor/postprocessing/Pass.js');
  const cp = await import('./src/world/coastplan.js');
  const { swashU, SWASH_FULL } = await import('./src/render/swash.js');
  const r = g.renderer, scene = g.scene, cam = g.camera;
  const w = g.post.size.x, h = g.post.size.y;
  const canvas = document.getElementById('view');
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(w, h) });
  const enc = new THREE.WebGLRenderTarget(w, h);
  const quad = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { tDepth: { value: rt.depthTexture }, uNF: { value: new THREE.Vector2(cam.near, cam.far) } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: [
      'precision highp float;',
      'uniform sampler2D tDepth; uniform vec2 uNF; varying vec2 vUv;',
      'void main() {',
      '  float d = texture2D(tDepth, vUv).r;',
      '  float z = uNF.x * uNF.y / (uNF.y - d * (uNF.y - uNF.x));',
      '  float v = d >= 0.999995 ? 1.0 : clamp(log2(1.0 + z) / log2(1.0 + uNF.y), 0.0, 0.99998);',
      '  float a = floor(v * 65535.0 + 0.5);',
      '  gl_FragColor = vec4(mod(a, 256.0) / 255.0, floor(a / 256.0) / 255.0, 0.0, 1.0);',
      '}'].join('\\n'),
    depthTest: false, depthWrite: false }));
  const kids = scene.children.slice();
  const vis = kids.map((k) => k.visible);
  // The depth (metres along the lens's axis, 0 where there is none) of what the roots draw alone; rows from the top.
  const depthOf = (roots) => {
    kids.forEach((k, i) => { k.visible = vis[i] && (k.isLight || roots.has(k)); });
    r.setRenderTarget(rt);
    r.clear();
    r.render(scene, cam);
    r.setRenderTarget(enc);
    quad.render(r);
    const buf = new Uint8Array(w * h * 4);
    r.readRenderTargetPixels(enc, 0, 0, w, h, buf);
    const out = new Float32Array(w * h);
    const k = Math.log2(1 + cam.far);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = ((h - 1 - y) * w + x) * 4;
      const a = buf[s] | (buf[s + 1] << 8);
      out[y * w + x] = a === 65535 ? 0 : Math.pow(2, (a / 65535) * k) - 1;
    }
    return out;
  };
  const decode = (url) => new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = im.width; c.height = im.height;
      const x = c.getContext('2d');
      x.drawImage(im, 0, 0);
      resolve({ w: im.width, h: im.height, data: x.getImageData(0, 0, im.width, im.height).data });
    };
    im.src = url;
  });
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lightness = (d, i) => {
    const r1 = lin(d[i]), g1 = lin(d[i + 1]), b1 = lin(d[i + 2]);
    const l = Math.cbrt(0.4122214708 * r1 + 0.5363325363 * g1 + 0.0514459929 * b1);
    const m = Math.cbrt(0.2119034982 * r1 + 0.6806995451 * g1 + 0.1073969566 * b1);
    const s = Math.cbrt(0.0883024619 * r1 + 0.2817188376 * g1 + 0.6299787005 * b1);
    return 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  };
  const th = Math.tan(cam.fov * Math.PI / 360);
  const aspect = cam.aspect;
  const point = (x, y, z, out) => out.set(((x + 0.5) / w * 2 - 1) * th * aspect * z, (1 - (y + 0.5) / h * 2) * th * z, -z).applyMatrix4(cam.matrixWorld);
  const draw = () => { if (window.__eye) window.__eye(); g.render(); };
  const shot = async () => {
    draw();
    const frame = await decode(canvas.toDataURL('image/png'));
    const sea = depthOf(new Set([g.water.mesh]));
    const land = depthOf(new Set([g.terrain.group]));
    return { frame, sea, land, clock: g.water.time, lift: swashU.uSwash.value.y * SWASH_FULL, y: swashU.uSwash.value.y };
  };
  const kept = g.water.save();
  const A = await shot();
  g.water.update(4, cam);
  const B = await shot();
  g.water.restore(kept);
  g.water.update(0, cam);
  // The frame of the first again with the lace of foam switched off (what the middle tier does; the rest of the swash as it was): the sand alone.
  const lace = swashU.uSwash.value.z;
  swashU.uSwash.value.z = 0;
  const C = await shot();
  swashU.uSwash.value.z = lace;
  draw();
  kids.forEach((k, i) => { k.visible = vis[i]; });
  r.setRenderTarget(null);
  rt.depthTexture.dispose(); rt.dispose(); enc.dispose(); quad.dispose();
  if (A.frame.w !== w || A.frame.h !== h) return { error: 'the frame is ' + A.frame.w + 'x' + A.frame.h + ', the targets ' + w + 'x' + h };
  const P = new THREE.Vector3();
  const Q = new THREE.Vector3();
  // The waterline of a shot: per column, the world point where the lowest run of sea (8 rows or more) meets land at about its distance.
  const waterlineOf = ${waterlineOf};
  const line = (S) => waterlineOf(S, w, h, (x, y, z) => point(x, y, z, new THREE.Vector3()));
  const LA = line(A), LB = line(B);
  const moved = [];
  const rows = [];
  for (let x = 0; x < w; x++) {
    if (!LA[x] || !LB[x]) continue;
    moved.push(Math.hypot(LA[x].x - LB[x].x, LA[x].zz - LB[x].zz));
    rows.push(Math.abs(LA[x].row - LB[x].row));
  }
  moved.sort((a, b) => a - b);
  // The white within a metre of the line, in a frame: pixels of the column whose point is within 1 m of the line's point there.
  const white = (S, L) => {
    let n = 0, lit = 0;
    for (let x = 0; x < w; x++) {
      const q = L[x];
      if (!q) continue;
      for (let dy = -40; dy <= 40; dy++) {
        const y = q.row + dy;
        if (y < 0 || y >= h) continue;
        const zz = Math.min(S.sea[y * w + x] || 1e9, S.land[y * w + x] || 1e9);
        if (!(zz < 1e9)) continue;
        point(x, y, zz, P);
        if (Math.hypot(P.x - q.x, P.z - q.zz) > 1) continue;
        n++;
        if (lightness(S.frame.data, (y * w + x) * 4) > 0.85) lit++;
      }
    }
    return { n, share: n ? lit / n : null };
  };
  const wA = white(A, LA), wB = white(B, LB);
  // The sand: pixels of land, off the water, on the beach (a height over the still water of a decimetre to a metre and a half), by the swash:
  // wet where the water has left it within the last 1.2 s (wetness 0.9 or more) or dry (none). The height is the land's as it is drawn.
  const sand = (S) => {
    const wetL = [], dryL = [];
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = y * w + x;
        const zl = S.land[i];
        if (!(zl > 8 && zl < 220)) continue;
        if (S.sea[i] > 0 && S.sea[i] <= zl) continue;
        point(x, y, zl, P);
        const alt = g.corridor.heightAt(P.x + g.road.origin.x, P.z + g.road.origin.z);
        if (alt < 0.02 || alt > 1.5) continue;
        const along = cp.alongOf(g.worlds, P.x + g.road.origin.x, P.z + g.road.origin.z);
        const lift = cp.swashLift(S.lift, S.clock, along);
        if (alt < lift + 0.005) continue;
        const wet = cp.swashWet(alt, S.lift, S.clock, along);
        const L = lightness(S.frame.data, i * 4);
        if (wet >= 0.9) wetL.push(L);
        else if (wet === 0 && alt > 0.3) dryL.push(L);
      }
    }
    const mean = (a) => (a.length ? a.reduce((p, q) => p + q, 0) / a.length : null);
    return { wet: wetL.length, dry: dryL.length, wetL: mean(wetL), dryL: mean(dryL) };
  };
  const sA = sand(A), sB = sand(B), sC = sand(C);
  return {
    columns: moved.length, median: moved[moved.length >> 1] ?? null, p10: moved[Math.floor(moved.length * 0.1)] ?? null, p90: moved[Math.floor(moved.length * 0.9)] ?? null,
    rowsMean: rows.length ? rows.reduce((p, q) => p + q, 0) / rows.length : null,
    whiteA: wA, whiteB: wB, sandA: sA, sandB: sB, sandC: sC, clockA: A.clock, clockB: B.clock, lift: A.lift,
  };
`;

// In the page: the coast's own tier set alone (the rest of the frame as it was: the sea is lifted and drawn as at the high tier), its
// things brought to the lens with the clock standing still, and the frame drawn: what is drawn of it, and what that adds.
const COAST_FRAME = (tier) => `
  g.setTier('high');
  g.coast.setTier(${JSON.stringify(tier)});
  if (window.__eye) window.__eye();
  g.coast.update(g.camera, 0, { at: g._wl || g._lookAt, sCar: g.sCar, blocks: g.style.cur.blocks, clock: g.water.time, settle: true });
  g.render();
`;

const COST = (tier) => `${COAST_FRAME(tier)}
  const r = g.renderer;
  return { tier: ${JSON.stringify(tier)}, calls: r.info.render.calls, triangles: r.info.render.triangles, programs: r.info.programs.length, geometries: r.info.memory.geometries,
    textures: r.info.memory.textures, stats: g.coast.stats(),
    visible: { hulls: g.coast.boats.hulls.visible, sails: g.coast.boats.sails.visible, rocks: g.coast.reefs.rocks.visible, foam: g.coast.reefs.foam.visible, wall: g.coast.wall.pieces.visible } };
`;

// In the page: the game's tier set (it sets the sea's and the coast's), a second of frames so that the swash has come in, and what the shaders are given.
const SWASH_TIER = (tier) => `
  g.setTier(${JSON.stringify(tier)});
  for (let i = 0; i < 70; i++) g.update(1 / 60);
  const { swashU } = await import('./src/render/swash.js');
  return { tier: ${JSON.stringify(tier)}, swash: swashU.uSwash.value.toArray(), stats: g.coast.stats() };
`;

// In the page: each style draws the coast, with it and without it (the tier set to low).
const STYLED = (id) => `
  g.setTier('high');
  g.style.set(${JSON.stringify(id)}, true);
  g.style.applyScene();
  g.post.setStyle(g.style);
  g.atmosphere.bakeEnvironment();
  for (let i = 0; i < 20; i++) g.style.update(0.1);
  g.style.applyScene();
  g.atmosphere.bakeEnvironment();
  const gl = g.renderer.getContext();
  const canvas = document.getElementById('view');
  const errors = () => { let n = 0; while (gl.getError() !== gl.NO_ERROR && n < 50) n++; return n; };
  const shot = (tier) => {
    g.setTier('high');
    g.coast.setTier(tier);
    if (window.__eye) window.__eye();
    g.coast.update(g.camera, 0, { at: g._wl || g._lookAt, sCar: g.sCar, blocks: g.style.cur.blocks, clock: g.water.time, settle: true });
    errors();
    g.render();
    const e = errors();
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const x = c.getContext('2d');
    x.drawImage(canvas, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
    return { errors: e, mean: sum / (d.length / 4), png: canvas.toDataURL('image/png'), stats: g.coast.stats() };
  };
  const low = shot('low');
  const high = shot('high');
  return { style: ${JSON.stringify(id)}, lowErrors: low.errors, highErrors: high.errors, lowMean: low.mean, highMean: high.mean, lowPng: low.png, highPng: high.png, drawn: high.stats };
`;

// In the page: the coast let go.
const DISPOSE = `
  g.setTier('high');
  g.update(1 / 60);
  g.render();
  const r = g.renderer;
  const { warmHooks } = await import('./src/render/atmosphere.js');
  const before = { geometries: r.info.memory.geometries, children: g.scene.children.length, hooks: warmHooks.length };
  g.coast.dispose();
  g.render();
  const after = { geometries: r.info.memory.geometries, children: g.scene.children.length, hooks: warmHooks.length };
  let thrown = null;
  try { g.coast.update = () => {}; for (let i = 0; i < 4; i++) { g.update(1 / 60); g.render(); } } catch (e) { thrown = e.message; }
  return { before, after, thrown };
`;

// In the page: a view of the coast's own things, with them and without (the coast's tier at the lowest: the sea and the sand are as
// they are in both), as two pictures. The lens is where PLACE put it (an eye), or looks at a boat (from `dist` m off, in the direction
// `angle`, with the field of view `fov`).
const PAIR = (view) => `
  const cp = await import('./src/world/coastplan.js');
  const o = g.road.origin;
  const canvas = document.getElementById('view');
  const view = ${JSON.stringify(view)};
  const fov0 = g.camera.fov;
  const settle = () => g.coast.update(g.camera, 0, { at: g._wl || g._lookAt, sCar: g.sCar, blocks: g.style.cur.blocks, clock: g.water.time, settle: true });
  g.setTier('high');
  g.coast.setTier('high');
  settle();
  if (view.boat !== undefined) {
    const b = g.coast.boats.list[view.boat];
    if (!b) return { error: 'there is no boat ' + view.boat };
    window.__eye = () => {
      const p = cp.boatAt(b, g.water.time, {});
      g.camera.position.set(p.x - Math.cos(view.angle) * view.dist - o.x, 3, p.z - Math.sin(view.angle) * view.dist - o.z);
      g.camera.up.set(0, 1, 0);
      g.camera.lookAt(p.x - o.x, 3.5, p.z - o.z);
      g.camera.fov = view.fov;
      g.camera.updateProjectionMatrix();
      g.camera.updateMatrixWorld();
    };
  }
  const shoot = (tier) => {
    g.coast.setTier(tier);
    if (window.__eye) window.__eye();
    settle();
    g.render();
    return canvas.toDataURL('image/png');
  };
  const high = shoot('high');
  const low = shoot('low');
  g.coast.setTier('high');
  g.camera.fov = fov0;
  g.camera.updateProjectionMatrix();
  return { high, low };
`;

const OLD = /^data:image\/png;base64,/;
const save = (keep, name, url) => keep && writeFileSync(`${keep}${name}.png`, Buffer.from(url.replace(OLD, ''), 'base64'));

async function pagePart() {
  const server = serve();
  if (!(await waitForServer())) {
    console.error('FAIL: no server');
    server.kill();
    process.exit(1);
  }
  const keep = KEEP ? (mkdirSync(KEEP, { recursive: true }), KEEP.replace(/\/?$/, '/')) : null;
  let page = null;
  try {
    // The place `coast` of tools/look.mjs (900 m into the coast, the chase lens). What the coast's own things add is counted against the same
    // frame with its tier at the lowest (the sea is as it is in both).
    page = await openPage('seed=7&world=coast&s=900&run=60&cam=chase&style=real');
    const placed = await page.run(PLACE(900));
    if (placed.error) throw new Error(placed.error);
    say(placed.world === 'coast', `the place is in the coast (${placed.world}, ${placed.s} m)`);
    const lowCost = await page.run(COST('low'));
    say(lowCost.stats.boats === 0 && lowCost.stats.reefs === 0 && lowCost.stats.walls === 0 && !Object.values(lowCost.visible).some(Boolean),
      `at the lowest tier none of it is drawn (${JSON.stringify(lowCost.stats)})`);
    const midCost = await page.run(COST('mid'));
    const highCost = await page.run(COST('high'));
    const add = (a, b) => ({ calls: a.calls - b.calls, triangles: a.triangles - b.triangles, programs: a.programs - b.programs, textures: a.textures - b.textures, geometries: a.geometries - b.geometries });
    const addHigh = add(highCost, lowCost);
    const addMid = add(midCost, lowCost);
    console.error(`     what it adds to a frame: at high ${addHigh.calls} calls, ${addHigh.triangles} triangles, ${addHigh.textures} textures and ${addHigh.geometries} geometries, at mid ${addMid.calls} calls and ${addMid.triangles} triangles; programs built when it was first drawn: ${addHigh.programs}`);
    say(addHigh.calls >= 1 && addHigh.calls <= 8, `at the high tier it adds at most 8 draw calls (${addHigh.calls})`);
    say(addHigh.triangles > 0 && addHigh.triangles <= 60000, `and at most 60 000 triangles (${addHigh.triangles})`);
    say(addHigh.textures === 0, `and no texture (${addHigh.textures})`);
    say(addMid.calls <= addHigh.calls && addMid.triangles <= 0.7 * addHigh.triangles, `at the middle tier half of that: ${addMid.calls} calls and ${addMid.triangles} triangles`);
    say(highCost.stats.boats === 12 && midCost.stats.boats === 6, `twelve boats at high, six at mid (${highCost.stats.boats}, ${midCost.stats.boats})`);
    say(midCost.stats.reefs <= highCost.stats.reefs / 2 + 1 && highCost.stats.reefs >= 10, `reefs: ${highCost.stats.reefs} at high (${highCost.stats.reefs >= REEF.max ? 'the most there is room for' : 'all the plan has near'}), at most half at mid (${midCost.stats.reefs})`);
    say(highCost.stats.walls >= 20 && midCost.stats.walls <= highCost.stats.walls, `the wall by the sea: ${highCost.stats.walls} pieces of it at high (2 m each), ${midCost.stats.walls} at mid`);
    // The game's tiers: what the sea and the sand are given (the swash lifts the sea at high and mid; the lace of foam on the sand is at high only; none at low).
    const swHigh = await page.run(SWASH_TIER('high'));
    const swMid = await page.run(SWASH_TIER('mid'));
    const swLow = await page.run(SWASH_TIER('low'));
    say(swHigh.swash[1] === 1 && swHigh.swash[2] === 1 && swMid.swash[1] === 1 && swMid.swash[2] === 0 && swLow.swash[1] === 0 && swLow.swash[2] === 0,
      `the sea is lifted by the swash at high and mid and not at low, the sand keeps the lace of foam at high only (${JSON.stringify(swHigh.swash)}, ${JSON.stringify(swMid.swash)}, ${JSON.stringify(swLow.swash)})`);
    await page.run(`${COAST_FRAME('high')} return 1;`);

    // The boats.
    const boats = await page.run(BOATS_NOW);
    if (boats.error) throw new Error(boats.error);
    say(boats.count === 12 && boats.drawn, `twelve boats are drawn (${boats.count}), in two draws (a hull and a sail each), ${boats.hull} and ${boats.sail} triangles to a boat (${boats.hull + boats.sail}; forty is the aim)`);
    say(boats.hull + boats.sail <= 44, 'a boat is some forty triangles at most');
    const wet = boats.rows.filter((b) => b.depth >= BOATS.deep && b.level === 0 && Math.abs(b.y) < 1.2 && b.off < 1e-3);
    say(wet.length === 12, `all twelve are on the water: ${wet.length} are over water ${BOATS.deep} m deep or more at the sea's level, within a metre of it, where the plan puts them (${span(boats.rows.map((b) => b.depth))} m deep)`);
    const far = boats.rows.map((b) => b.shore);
    say(Math.min(...far) > 400 && Math.max(...far) < 3100, `and each is over 400 m from land and not 3 km (${span(far)} m, looked for every 25 m on 90 directions)`);
    say(boats.rows.every((b) => b.sailOff < 1e-5), 'each sail rides its hull');

    // The reefs, the foam round them and the wall.
    const shore = await page.run(SHORE_NOW);
    if (shore.error) throw new Error(shore.error);
    say(shore.reefs.length >= 10 && shore.reefs.every((r) => Math.abs(r.x) < 1e-3 && Math.abs(r.z) < 1e-3 && r.depth >= 0.25 && r.depth <= 3.0), `${shore.reefs.length} rocks stand in the shallows, each in 0.25 to 3 m of water, where the plan puts it`);
    const over = shore.foams.map((f) => f.y - f.lift);
    say(shore.foams.length === shore.reefs.length && shore.foams.every((f) => Math.abs(f.y - f.lift - 0.05) < 0.01 && f.radius > f.rock),
      `each has its ring of foam, wider than the rock and a hand's breadth over the water as the swash lifts it (${span(over)} m over the still level, less the lift)`);
    say(shore.pieces.length === shore.stats.walls && shore.pieces.length >= 20, `${shore.pieces.length} pieces of wall are drawn, in ${shore.stats.runs} runs, ${shore.wallTriangles} triangles to a piece; the rocks are ${shore.reefTriangles} triangles and the foam ${shore.foamTriangles}`);

    // The waterline, from the frame of the lens low over the sea (the place `coastlow` of tools/look.mjs), 4 s on.
    const eye = { side: -60, up: 9, back: 30 };
    const low = await page.run(PLACE(900, eye));
    if (low.error) throw new Error(low.error);
    await page.run(COAST_FRAME('high'));
    const wl = await page.run(WATERLINE);
    if (wl.error) throw new Error(wl.error);
    const f2 = (x) => (x === null || x === undefined ? 'none' : x.toFixed(2));
    say(wl.columns >= 150 && wl.median >= 1, `the waterline in the frame (${wl.columns} columns), put back on the world by the depth, is ${f2(wl.median)} m on from where it was 4 s before in the middle one (a tenth are less than ${f2(wl.p10)} m, a tenth more than ${f2(wl.p90)} m; at least 1 m); the water's clock ${wl.clockA.toFixed(2)} then ${wl.clockB.toFixed(2)} s`);
    const shareOf = (a) => (a && a.share !== null ? a.share : NaN);
    say(shareOf(wl.whiteA) >= 0.2 && shareOf(wl.whiteA) <= 0.7 && shareOf(wl.whiteB) >= 0.2 && shareOf(wl.whiteB) <= 0.7,
      `within a metre of the waterline ${(shareOf(wl.whiteA) * 100).toFixed(1)}% and ${(shareOf(wl.whiteB) * 100).toFixed(1)}% of the pixels are white (L over 0.85; between 20% and 70%; ${wl.whiteA.n} and ${wl.whiteB.n} pixels)`);
    // The sand: the pixels the water covers or left within the last 1.2 s against the sand it does not reach, in the frame without the lace of foam
    // (the lace is white and lifts the mean of what it lies on: it is looked at, as it is, in the frames of the high tier).
    const darker = (sd) => (sd.dryL && sd.wetL ? 1 - sd.wetL / sd.dryL : NaN);
    const sc = wl.sandC;
    say(sc.wet >= 200 && sc.dry >= 200 && darker(sc) >= 0.15,
      `the sand the water has just left is ${(darker(sc) * 100).toFixed(1)}% darker than the dry sand (L ${sc.wetL && sc.wetL.toFixed(3)} against ${sc.dryL && sc.dryL.toFixed(3)}; ${sc.wet} and ${sc.dry} pixels; at least 15%)`);
    console.error(`     with the lace of foam on it (the high tier), the same sand is ${(darker(wl.sandA) * 100).toFixed(1)}% and ${(darker(wl.sandB) * 100).toFixed(1)}% darker in the two frames (${wl.sandA.wet} and ${wl.sandB.wet} pixels wet)`);
    // The same at the lens of the place `coast` itself (the chase lens: the beach is seen from the road, with the sea beyond it).
    await page.run(PLACE(900));
    await page.run(COAST_FRAME('high'));
    const wc = await page.run(WATERLINE);
    if (wc.error) console.error(`     the waterline at the chase lens could not be measured: ${wc.error}`);
    else {
      const dc = (sd) => (sd.dryL && sd.wetL ? 1 - sd.wetL / sd.dryL : NaN);
      console.error(`     at the chase lens: the waterline (${wc.columns} columns) is ${wc.median && wc.median.toFixed(2)} m on from where it was 4 s before in the middle one (tenth ${wc.p10 && wc.p10.toFixed(2)}, ninetieth ${wc.p90 && wc.p90.toFixed(2)} m), ${(shareOf(wc.whiteA) * 100).toFixed(1)}% and ${(shareOf(wc.whiteB) * 100).toFixed(1)}% of the pixels within a metre of it are white (${wc.whiteA.n} and ${wc.whiteB.n} pixels), the sand it has just left is ${(dc(wc.sandC) * 100).toFixed(1)}% darker than the dry sand (${wc.sandC.wet} and ${wc.sandC.dry} pixels)`);
    }
    // Back to the place for the rest.
    await page.run(PLACE(900));

    // The styles.
    const styles = [];
    await page.run(PLACE(900, eye));
    for (const id of ['real', 'paint', 'ink', 'cel', 'print', 'pixel', 'block']) {
      const r = await page.run(STYLED(id));
      if (r.error) {
        say(false, `${id}: ${r.error}`);
        continue;
      }
      styles.push(r);
      say(r.highErrors <= r.lowErrors && r.highMean > 0.5 && r.lowMean > 0.5, `${id}: it draws with the coast's own things (${r.highErrors} GL errors against ${r.lowErrors}, mean ${r.highMean.toFixed(1)} against ${r.lowMean.toFixed(1)})`);
      save(keep, `${id}-low`, r.lowPng);
      save(keep, `${id}-high`, r.highPng);
    }
    await page.run("g.style.set('real', true); g.style.applyScene(); g.setTier('high'); return 1;");
    if (keep) {
      // A look at each of the boats, the rocks and the wall, with them and without.
      for (const [name, place, view] of [
        ['boat', null, { boat: 0, dist: 90, angle: 0.6, fov: 30 }],
        ['rocks', { side: -24, up: 1.8, back: -40 }, {}],
        ['wall', { side: -9, up: 1.3, back: -20 }, {}],
      ]) {
        const at = await page.run(PLACE(900, place));
        if (at.error) throw new Error(at.error);
        const r = await page.run(PAIR(view));
        if (r.error) {
          say(false, `${name}: ${r.error}`);
          continue;
        }
        save(keep, `pair-${name}-high`, r.high);
        save(keep, `pair-${name}-low`, r.low);
      }
    }

    // Let go.
    const gone = await page.run(DISPOSE);
    say(!gone.thrown && gone.before.geometries - gone.after.geometries >= 4 && gone.before.children - gone.after.children >= 5 && gone.before.hooks - gone.after.hooks === 1,
      `disposed of: ${gone.before.geometries - gone.after.geometries} geometries and ${gone.before.children - gone.after.children} objects gone from the renderer and the scene, its hook let go (${gone.before.hooks - gone.after.hooks}), and the game goes on (${gone.thrown || 'no error'})`);
    if (page.logs.length) say(false, `the page logged errors: ${page.logs.slice(0, 3).join(' | ')}`);
  } finally {
    if (page) page.close();
    server.kill();
  }
}

// --- the sound of a minute on the coast, rendered by the page (tools/sound_demo.mjs) ---------------------------------

// The seconds at which the lens hears a gull call in a minute on the coast of a seed: the first GULL.first s after it comes in, then a gap of
// its own to each (the frame the call is made in is the one before the sound it asks for).
function gullsDue(seed, seconds) {
  const due = [];
  let t = 1 / 60 + GULL.first;
  for (let n = 1; t < seconds - 1; n++) {
    due.push(t - 1 / 60);
    t += gullGap(n, seed);
  }
  return due;
}

// What a rendered minute holds of the coast's sounds. mono, rate: the sound; due: when the gulls call. A wave breaking is a thump that sinks
// from 62 Hz to 38 Hz: its peaks stand over the band of 30 to 58 Hz (under the car's hum, which stays over 64 Hz) as high as `times` of the
// middle level there. A gull is two falling notes of 1.3 to 3 kHz: the level of that band in the second from its due time, against its
// level in the stretches of the minute that hold none.
function hearCoast(mono, rate, due, seconds) {
  const y = band(mono, rate, 30, 58);
  const env = new Float32Array(y.length);
  const k = 1 - Math.exp(-1 / (0.05 * rate));
  let e = 0;
  for (let i = 0; i < y.length; i++) {
    e += (Math.abs(y[i]) - e) * k;
    env[i] = e;
  }
  const sorted = Float32Array.from(env).sort();
  const limit = Math.max(4 * sorted[sorted.length >> 1], 0.01);
  const waves = [];
  const win = Math.round(0.1 * rate);
  for (let i = 0; i < env.length; i++) {
    if (env[i] < limit) continue;
    let top = true;
    for (let j = Math.max(0, i - win); j <= Math.min(env.length - 1, i + win) && top; j += 8) if (env[j] > env[i]) top = false;
    if (!top) continue;
    let o = i;
    while (o > 0 && env[o - 1] >= limit * 0.5) o--;
    if (!waves.length || o / rate - waves[waves.length - 1] >= 1.5) waves.push(o / rate);
  }
  const gull = (t) => level(mono, rate, t, t + 1, 1300, 3000);
  const quiet = [];
  for (let t = 1; t + 1 < seconds; t += 1.5) if (due.every((d) => t + 1 < d - 0.3 || t > d + 1.3)) quiet.push(gull(t));
  const base = median(quiet);
  return { waves, limit, base, calls: due.map((d) => gull(d - 0.05) - base) };
}

// The analysis is tried on a sound made for it: noise, a hum, thumps and calls where it is told they are.
function soundPart_node() {
  const rate = 44100;
  const seconds = 60;
  const mono = new Float32Array(rate * seconds);
  let seed = 12345;
  for (let i = 0; i < mono.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    mono[i] = ((seed / 4294967296) * 2 - 1) * 0.02 + 0.05 * Math.sin((2 * Math.PI * 85 * i) / rate);
  }
  const at = [];
  for (let t = 5; t < 56; t += 3.7) at.push(t);
  for (const t of at) {
    for (let i = 0; i < 0.9 * rate; i++) {
      const u = i / rate;
      const f = 62 * Math.pow(38 / 62, Math.min(1, u / 0.35));
      mono[Math.round(t * rate) + i] += 0.3 * Math.sin(2 * Math.PI * f * u) * Math.exp(-u / 0.18);
    }
  }
  const due = gullsDue(7, seconds);
  for (const d of due) {
    for (const [from, to, dur, delay] of [[2450, 1650, 0.3, 0], [2100, 1350, 0.42, 0.36]]) {
      let ph = 0;
      for (let i = 0; i < dur * rate; i++) {
        const u = i / rate;
        ph += (2 * Math.PI * from * Math.pow(to / from, u / dur)) / rate;
        mono[Math.round((d + delay) * rate) + i] += 0.03 * Math.sin(ph) * Math.exp(-u / 0.25);
      }
    }
  }
  const h = hearCoast(mono, rate, due, seconds);
  say(h.waves.length === at.length && h.waves.every((w, i) => Math.abs(w - at[i]) < 0.3),
    `a sound made of ${at.length} thumps, a hum and noise is heard as ${h.waves.length} waves, each within 0.3 s of where it was put`);
  say(h.calls.length >= 4 && h.calls.every((c) => c >= 6), `and its ${h.calls.length} gull calls each stand ${Math.min(...h.calls).toFixed(1)} dB or more over the band they are in`);
}

async function soundPart() {
  const wav = `${ROOT}out/coast-check-sea.wav`;
  const seconds = 60;
  mkdirSync(`${ROOT}out`, { recursive: true });
  const code = await new Promise((resolve) => {
    const p = spawn('node', [ROOT + 'tools/sound_demo.mjs', String(seconds), 'seed=7&world=coast&cam=chase', wav],
      { env: { ...process.env, PORT: String(PORT + 1) }, stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('exit', resolve);
  });
  if (code !== 0) {
    say(false, `the sound of a minute on the coast could not be rendered (tools/sound_demo.mjs exited ${code})`);
    return;
  }
  const w = readWav(readFileSync(wav).toString('base64'));
  const due = gullsDue(7, seconds);
  const h = hearCoast(w.mono, w.rate, due, seconds);
  say(h.waves.length >= 6 && h.waves.length <= 25, `rendered as sound, a minute on the coast has ${h.waves.length} waves to be heard breaking (6 to 25), found by the peaks of 30 to 58 Hz over ${h.limit.toFixed(4)}`);
  const heard = h.calls.filter((c) => c >= 4).length;
  say(due.length >= 4 && due.length <= 12 && heard >= due.length - 1,
    `${due.length} gulls call (4 to 12), at ${due.map((d) => d.toFixed(1)).join(', ')} s; ${heard} of them stand 4 dB or more over the level of 1.3 to 3 kHz elsewhere in the minute (${h.calls.map((c) => c.toFixed(1)).join(', ')} dB over ${h.base.toFixed(1)} dB)`);
  const loud = peakOf(w);
  say(loud < 0.9, `and the minute does not clip: its loudest sample is ${loud.toFixed(3)} of full scale, under 0.9`);
}

// --- the frame of the places `coast` and `coastlow`, as tools/look.mjs measures them ------------------------------------

async function lookPart() {
  const file = `${ROOT}out/coast-check-look.json`;
  mkdirSync(`${ROOT}out`, { recursive: true });
  const code = await new Promise((resolve) => {
    const p = spawn('node', [ROOT + 'tools/look.mjs', '--shots', 'coast,coastlow', '--styles', 'real', '--write', file, ...(KEEP ? ['--dump', '--out', KEEP.replace(/\/?$/, '/') + 'look'] : [])],
      { env: { ...process.env, PORT: String(PORT + 2) }, stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('exit', resolve);
  });
  if (code !== 0) {
    say(false, `the places coast and coastlow could not be measured (tools/look.mjs exited ${code})`);
    return;
  }
  const m = JSON.parse(readFileSync(file, 'utf8'));
  const low = m['coastlow:real'];
  say(low.water && low.water.shimmer !== null && low.water.shimmer <= 0.015, `the water of the place coastlow changes ${low.water && low.water.shimmer} (L, a pixel's mean) in a sixtieth of a second with the car standing still (at most 0.015)`);
  const coast = m['coast:real'];
  console.error(`     the place coast costs ${coast.cost.calls} calls and ${(coast.cost.triangles / 1e6).toFixed(3)} M triangles in the real style; coastlow ${low.cost.calls} and ${(low.cost.triangles / 1e6).toFixed(3)} M`);
}

if (part('page')) await pagePart();
if (part('sound')) await soundPart();
if (part('look')) await lookPart();

if (failed) {
  console.error(`\n${failed} problem${failed > 1 ? 's' : ''}`);
  process.exit(1);
}
console.error('\nOK: the coast has its waves, its boats, its rocks and its wall, where and as many as it should');
process.exit(0);
