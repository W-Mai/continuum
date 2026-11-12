// Switching worlds on the way, without rendering: from each world to every
// other, drive 2.4 km into the first, ask for the second as the page does
// (src/world/turn.js: the road cut about a kilometre ahead, the border laid
// past it, the road surveyed again), and drive on into the new world.
// Checks what the drive meets: the road joins up where it was cut, the new
// world comes after one blend and nothing else comes between, the grade stays
// within the limit and the road never runs under a liquid but in the deep
// sea. Prints how far ahead of the request the blend starts and how much road
// it takes.
//
// Usage: node tools/switch_check.mjs [seed] [from,ids] [to,ids]

import { makeWorldLand, WORLDS, WORLD_INDEX } from '../src/world/worlds.js';
import { Road, STEP, BRIDGE, TUNNEL } from '../src/world/road.js';
import { turnWorlds, turnTo } from '../src/world/turn.js';

const SEED = Number(process.argv[2]) || 7;
const pick = (arg) => (arg ? arg.split(',').map((id) => WORLD_INDEX[id]) : WORLDS.map((_, i) => i));
const FROM = pick(process.argv[3]);
const TO = pick(process.argv[4]);
const S_ASK = 2400;
const problems = [];
const rows = [];
const t0 = performance.now();

for (const a of FROM) {
  for (const b of TO) {
    if (a === b) continue;
    const tag = `${WORLDS[a].id} -> ${WORLDS[b].id}`;
    const land = makeWorldLand(SEED, { start: WORLDS[a].id });
    const map = land.worlds;
    const road = new Road(land, SEED);
    for (let s = 0; s <= S_ASK; s += 200) road.update(s);
    const res = turnWorlds(road, map, S_ASK, turnTo(map, b));
    if (!res) {
      problems.push(`${tag}: nothing changed`);
      continue;
    }
    const ub = res.from + map.blend;
    road.update(S_ASK, Infinity);

    // Where it was cut, the new road carries straight on from the old: one
    // step on, turning by what the curvature there turns, at its grade.
    let join = '-';
    if (res.cut >= 0) {
      const q0 = road.samples.get(res.cut);
      const q1 = road.samples.get(res.cut + 1);
      const d = Math.hypot(q1.ax - q0.ax, q1.az - q0.az);
      const turn = Math.abs(q1.theta - q0.theta - 0.5 * (q0.kappa + q1.kappa) * STEP);
      const dk = Math.abs(q1.kappa - q0.kappa);
      const dy = Math.abs(q1.y - q0.y);
      join = `${d.toFixed(2)} m ${(turn * 180 / Math.PI).toFixed(2)}°`;
      if (Math.abs(d - STEP) > 0.2 || turn > 0.005 || dk > 0.004 || dy > STEP * 0.1) {
        problems.push(`${tag}: the road breaks at the cut (${join}, dk ${dk.toFixed(4)}, dy ${dy.toFixed(2)})`);
      }
    }

    // What the drive meets from the request on, until 4 km of progress into
    // the new world, read as the road is laid (it is let go behind the car).
    let lead = null;
    let full = null;
    let maxGrade = 0;
    let wet = 0;
    let bridges = 0;
    let tunnels = 0;
    let n = 0;
    const seen = [];
    let next = Math.floor(S_ASK / STEP);
    let done = false;
    for (let s = S_ASK; !done && s < S_ASK + 30000; s += 200) {
      road.update(s);
      const hi = Math.min(road.classified, Math.floor((s + 200) / STEP));
      for (let i = Math.max(next, road.first); i <= hi; i++) {
        const q = road.samples.get(i);
        next = i + 1;
        if (!q) continue;
        const w = map.at(q.ax, q.az);
        const share = w.b === b ? w.t : w.a === b ? 1 : 0;
        if (lead === null && share > 0.02) lead = i * STEP - S_ASK;
        if (full === null && share > 0.98) full = i * STEP - S_ASK;
        const m = w.t < 0.5 ? w.a : w.b;
        if (!seen.length || seen[seen.length - 1].w !== m) seen.push({ w: m, s0: i * STEP, s1: i * STEP });
        seen[seen.length - 1].s1 = i * STEP;
        maxGrade = Math.max(maxGrade, Math.abs(q.grade));
        const level = land.waterLevel(q.ax, q.az);
        const sunk = WORLDS[w.a].params.underwater || (w.t > 0 && WORLDS[w.b].params.underwater);
        if (level !== -Infinity && q.y < level + 1 && !sunk) wet++;
        if (q.kind === BRIDGE) bridges++;
        if (q.kind === TUNNEL) tunnels++;
        n++;
        if (map.u(q.ax, q.az) > ub + 4000) {
          done = true;
          break;
        }
      }
    }
    // A serpentine on the border can cross it and come back.
    const runs = [];
    for (let k = 0; k < seen.length; k++) {
      const r = seen[k];
      const last = runs[runs.length - 1];
      if (last && (last.w === r.w || (r.s1 - r.s0 < 1500 && seen[k + 1] && seen[k + 1].w === last.w))) {
        last.s1 = r.s1;
        continue;
      }
      runs.push({ ...r });
    }
    const order = runs.map((r) => WORLDS[r.w].id).join(' ');
    if (runs.length !== 2 || runs[0].w !== a || runs[1].w !== b) problems.push(`${tag}: met ${order}`);
    if (lead === null || full === null) problems.push(`${tag}: never reached ${WORLDS[b].id}`);
    if (wet) problems.push(`${tag}: ${wet} samples of road under a liquid`);
    if (maxGrade > 0.1) problems.push(`${tag}: grade ${(maxGrade * 100).toFixed(1)}%`);
    rows.push({
      switch: tag, cut: res.cut >= 0 ? 'K' + (res.cut * STEP / 1000).toFixed(2) : 'none', join,
      lead: lead === null ? '-' : Math.round(lead), blend: lead === null || full === null ? '-' : Math.round(full - lead),
      grade: +(maxGrade * 100).toFixed(1), bridge: Math.round(bridges / n * 100) + '%', tunnel: Math.round(tunnels / n * 100) + '%',
    });
  }
}

console.table(rows);
console.error(`${rows.length} switches in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
if (problems.length) {
  console.error('\nFAIL:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.error('\nOK: every switch joins up, meets only the world asked for, within its grade and above every liquid but the deep sea');
