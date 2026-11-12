// A seed's road profile for the og image, through the worlds as the game
// builds them: every few metres the chainage, the grade line, the ground
// under it, the kind of road (0 open, 1 bridge, 2 tunnel), whether it is a
// hairpin, the world it is in, the level of the liquid there (water, lava or
// cloud; null where there is none), whether the road floats with no piers and
// whether the liquid is cloud. The same numbers the HUD's profile draws.
//
// Usage: node tools/brand/profile.mjs <seed> <km> [every m] > profile.json
//   { worlds: [name, ...], every, rows: [[s, y, ground, kind, hairpin, world, liquid, floats, cloud], ...] }

import { makeWorldLand, WORLDS } from '../../src/world/worlds.js';
import { Road, STEP } from '../../src/world/road.js';

const SEED = Number(process.argv[2] || 7);
const KM = Number(process.argv[3] || 12);
const EVERY = Number(process.argv[4] || 8);
const land = makeWorldLand(SEED);
const road = new Road(land, SEED);
const pts = [];
let next = 0;
for (let sCar = 0; next <= KM * 1000; sCar += 50) {
  road.update(sCar);
  const hi = Math.min(road.classified, Math.floor((sCar + 2000) / STEP));
  while (next <= hi * STEP && next <= KM * 1000) {
    const p = road.samples.get(Math.round(next / STEP));
    if (p) {
      const lvl = land.waterLevel(p.ax, p.az);
      const w = land.worlds.main(p.ax, p.az);
      // Whether the liquid here is cloud: by the share of each world's
      // liquid in the blend, so a border where the cloud thins out is still
      // cloud until the other world's water has the larger share.
      const at = land.worlds.at(p.ax, p.az, {});
      const ka = WORLDS[at.a].params.water === null ? 0 : 1 - at.t;
      const kb = WORLDS[at.b].params.water === null ? 0 : at.t;
      const kc = (WORLDS[at.a].liquid?.cloud ? ka : 0) + (WORLDS[at.b].liquid?.cloud ? kb : 0);
      pts.push([next, +p.y.toFixed(2), +p.g.toFixed(2), p.kind, p.mode === 'hairpin' ? 1 : 0,
        w, lvl === -Infinity ? null : +lvl.toFixed(2), land.floats(p.ax, p.az) ? 1 : 0, kc > 0.5 * (ka + kb) && kc > 0 ? 1 : 0]);
    }
    next += EVERY;
  }
}
process.stdout.write(JSON.stringify({ worlds: WORLDS.map((w) => w.name), every: EVERY, rows: pts }));
