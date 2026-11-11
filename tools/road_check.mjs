// Road generator check: survey a long stretch for several seeds and report
// what was built (serpentines, viaducts, tunnels, cuttings) and anything that
// breaks the design rules. No renderer, no browser.
//
// Usage: node tools/road_check.mjs [km] [seed ...]

import { makeAlpine } from '../src/world/landform.js';
import { Road, STEP, GROUND, BRIDGE, TUNNEL } from '../src/world/road.js';

const args = process.argv.slice(2).map(Number);
const KM = args[0] || 16;
const SEEDS = args.length > 1 ? args.slice(1) : [7, 42, 3, 99, 11];

function survey(seed) {
  const land = makeAlpine(seed);
  const t0 = Date.now();
  const road = new Road(land, seed);
  const pts = [];
  let last = -1;
  for (let s = 0; s < KM * 1000; s += 50) {
    road.update(s);
    for (let i = Math.max(last + 1, road.first); i <= road.classified; i++) {
      const p = road.samples.get(i);
      pts.push({ s: i * STEP, ax: p.ax, az: p.az, y: p.y, g: p.g, gl: p.gl, gr: p.gr,
        kind: p.kind, kappa: p.kappa, grade: p.grade, mode: p.mode });
      last = i;
    }
  }
  const ms = Date.now() - t0;
  const r = { seed, ms, hairpins: 0, viaducts: [], tunnels: [], maxGrade: 0, minRadius: Infinity,
    maxCut: 0, maxFill: 0, buriedHairpins: 0, crossings: 0 };
  let run = null;
  const runs = [];
  for (const p of pts) {
    r.maxGrade = Math.max(r.maxGrade, Math.abs(p.grade));
    if (Math.abs(p.kappa) > 1e-6) r.minRadius = Math.min(r.minRadius, 1 / Math.abs(p.kappa));
    if (p.kind === GROUND) {
      r.maxCut = Math.max(r.maxCut, Math.max(p.g, p.gl, p.gr) - p.y);
      r.maxFill = Math.max(r.maxFill, p.y - Math.min(p.g, p.gl, p.gr));
    }
    if (p.mode === 'hairpin' && p.kind === TUNNEL) r.buriedHairpins += STEP;
    if (!run || run.kind !== p.kind) {
      run = { kind: p.kind, s0: p.s, s1: p.s, h: 0 };
      runs.push(run);
    }
    run.s1 = p.s;
    run.h = Math.max(run.h, p.y - Math.min(p.g, p.gl, p.gr));
  }
  for (const u of runs) {
    const len = u.s1 - u.s0 + STEP;
    if (u.kind === BRIDGE && len >= 40) r.viaducts.push([u.s0, len, Math.round(u.h)]);
    if (u.kind === TUNNEL) r.tunnels.push([u.s0, len]);
  }
  // Hairpins: separate turns tighter than 30 m.
  let inPin = false;
  for (const p of pts) {
    const pin = Math.abs(p.kappa) > 1 / 30;
    if (pin && !inPin) r.hairpins++;
    inPin = pin;
  }
  // Crossings: two stretches more than 200 m apart along the road that come
  // within a road width of each other at nearly the same height.
  const grid = new Map();
  const cell = 16;
  for (let i = 0; i < pts.length; i += 2) {
    const p = pts[i];
    const k = Math.floor(p.ax / cell) + ',' + Math.floor(p.az / cell);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  for (let i = 0; i < pts.length; i += 2) {
    const p = pts[i];
    const cx = Math.floor(p.ax / cell);
    const cz = Math.floor(p.az / cell);
    let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx++) {
      for (let dz = -1; dz <= 1 && !hit; dz++) {
        for (const j of grid.get((cx + dx) + ',' + (cz + dz)) || []) {
          const q = pts[j];
          if (Math.abs(q.s - p.s) < 200) continue;
          if (Math.hypot(q.ax - p.ax, q.az - p.az) < 9 && Math.abs(q.y - p.y) < 7) {
            hit = true;
            break;
          }
        }
      }
    }
    if (hit) r.crossings++;
  }
  const total = pts.length * STEP;
  const share = (kind) => +(100 * pts.filter((p) => p.kind === kind).length * STEP / total).toFixed(1);
  r.bridgePct = share(BRIDGE);
  r.tunnelPct = share(TUNNEL);
  r.minRadius = +r.minRadius.toFixed(1);
  r.maxGrade = +r.maxGrade.toFixed(3);
  r.maxCut = +r.maxCut.toFixed(1);
  r.maxFill = +r.maxFill.toFixed(1);
  r.longestViaduct = r.viaducts.reduce((a, b) => (b[1] > a[1] ? b : a), [0, 0, 0]);
  r.longestTunnel = r.tunnels.reduce((a, b) => (b[1] > a[1] ? b : a), [0, 0]);
  r.viaducts = r.viaducts.length;
  r.tunnels = r.tunnels.length;
  return r;
}

const rows = SEEDS.map(survey);
console.table(rows.map((r) => ({
  seed: r.seed, ms: r.ms, hairpins: r.hairpins, viaducts: r.viaducts, 'bridge%': r.bridgePct,
  tunnels: r.tunnels, 'tunnel%': r.tunnelPct, 'longest viaduct': r.longestViaduct.join('/'),
  'longest tunnel': r.longestTunnel.join('/'), 'max grade': r.maxGrade, 'min R': r.minRadius,
  'max cut': r.maxCut, 'max fill': r.maxFill, 'buried hairpin m': r.buriedHairpins, crossings: r.crossings,
})));

const fails = [];
for (const r of rows) {
  if (r.maxGrade > 0.1) fails.push(`seed ${r.seed}: grade ${r.maxGrade}`);
  if (r.minRadius < 13) fails.push(`seed ${r.seed}: radius ${r.minRadius} m`);
  if (r.crossings) fails.push(`seed ${r.seed}: ${r.crossings} level crossings with itself`);
}
if (fails.length) {
  console.error('FAIL\n' + fails.join('\n'));
  process.exit(1);
}
console.log('OK');
