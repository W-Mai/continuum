// Survey the road through every world without rendering, and check what the
// worlds ask of it: each world is reached in order, the road never runs under
// water, grades stay within the limit, every world gets a fair length of road,
// and every tree beside it is of a kind its worlds grow. Prints where each
// world starts along the road and what it is built of.
//
// Usage: node tools/world_check.mjs [km] [seed ...]

import { makeWorldLand, WORLDS } from '../src/world/worlds.js';
import { makeVegetation, FLORA } from '../src/world/vegetation.js';
import { Road, STEP, BRIDGE, TUNNEL } from '../src/world/road.js';

const KM = Number(process.argv[2]) || 70;
const SEEDS = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [7, 42, 3];
const problems = [];
const rows = [];

for (const seed of SEEDS) {
  const t0 = performance.now();
  const land = makeWorldLand(seed);
  const road = new Road(land, seed);
  const veg = makeVegetation(land, seed);
  const map = land.worlds;
  const seen = [];
  let cur = null;
  let next = 0;
  let maxGrade = 0;
  let wet = 0;
  let foreign = 0;
  for (let sCar = 0; sCar <= KM * 1000; sCar += 200) {
    road.update(sCar);
    const hi = Math.min(road.classified, Math.floor((sCar + 200) / STEP));
    for (let i = Math.max(next, road.first); i <= hi; i++) {
      const p = road.samples.get(i);
      if (!p) continue;
      const w = map.main(p.ax, p.az);
      if (!cur || cur.w !== w) {
        cur = { w, s0: i * STEP, s1: i * STEP, bridge: 0, tunnel: 0, n: 0 };
        seen.push(cur);
      }
      cur.s1 = i * STEP;
      cur.n++;
      if (p.kind === BRIDGE) cur.bridge++;
      if (p.kind === TUNNEL) cur.tunnel++;
      // (Where the road rolls on purpose it is steeper: that is the point of it.)
      if (!p.roll) maxGrade = Math.max(maxGrade, Math.abs(p.grade));
      const level = land.waterLevel(p.ax, p.az);
      // Under the deep sea, and on the way down into it or up out of it, the
      // road is meant to be under water.
      const wa = map.at(p.ax, p.az);
      const sunk = WORLDS[wa.a].params.underwater || (wa.t > 0 && WORLDS[wa.b].params.underwater);
      if (level !== -Infinity && p.y < level + 1 && !sunk) wet++;
      // Every tree is of a kind one of the two worlds here grows.
      const fa = FLORA.indexOf(WORLDS[wa.a].flora);
      const fb = FLORA.indexOf(WORLDS[wa.b].flora);
      if (fa >= 0 || fb >= 0) {
        for (const r of [0.02, 0.5, 0.98]) {
          const k = veg.species(p.ax, p.az, r);
          if (k !== fa && k !== fb) foreign++;
        }
      }
      next = i + 1;
    }
  }
  const ms = performance.now() - t0;
  // A serpentine near a border can cross it and come back: a short run of
  // one world between two of another is the border zone, not a world.
  const merged = [];
  for (let k = 0; k < seen.length; k++) {
    const r = seen[k];
    const last = merged[merged.length - 1];
    const nextRun = seen[k + 1];
    if (last && (last.w === r.w || (r.s1 - r.s0 < 1500 && nextRun && nextRun.w === last.w))) {
      last.s1 = r.s1;
      last.bridge += r.bridge;
      last.tunnel += r.tunnel;
      last.n += r.n;
      continue;
    }
    merged.push({ ...r });
  }
  for (const r of merged) {
    rows.push({
      seed, world: WORLDS[r.w].id, from: 'K' + (r.s0 / 1000).toFixed(1), km: +((r.s1 - r.s0) / 1000).toFixed(1),
      bridge: Math.round((r.bridge / r.n) * 100) + '%', tunnel: Math.round((r.tunnel / r.n) * 100) + '%',
    });
  }
  for (let k = 1; k < merged.length; k++) {
    if (merged[k].w !== (merged[k - 1].w + 1) % WORLDS.length) {
      problems.push(`seed ${seed}: ${WORLDS[merged[k - 1].w].id} is followed by ${WORLDS[merged[k].w].id}`);
    }
  }
  for (const r of merged.slice(1, -1)) {
    if (r.s1 - r.s0 < 3000) problems.push(`seed ${seed}: only ${((r.s1 - r.s0) / 1000).toFixed(1)} km of ${WORLDS[r.w].id}`);
  }
  if (wet) problems.push(`seed ${seed}: ${wet} samples of road under water`);
  if (foreign) problems.push(`seed ${seed}: ${foreign} trees of a kind neither world grows`);
  if (maxGrade > 0.1) problems.push(`seed ${seed}: grade ${(maxGrade * 100).toFixed(1)}%`);
  console.error(`seed ${seed}: ${KM} km in ${(ms / 1000).toFixed(1)} s, max grade ${(maxGrade * 100).toFixed(1)}%`);
}

console.table(rows);
if (problems.length) {
  console.error('\nFAIL:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.error(`\nOK: every world in order, no road under water, grades within 10%, no foreign trees`);
