// A seed's road profile for the og image: every 8 m, the chainage, the grade
// line, the ground under it, the kind of road (0 open, 1 bridge, 2 tunnel) and
// whether it is a hairpin. The same numbers the HUD's profile draws.
//
// Usage: node tools/brand/profile.mjs <seed> <km> > profile.json

import { makeAlpine } from '../../src/world/landform.js';
import { Road, STEP } from '../../src/world/road.js';

const SEED = Number(process.argv[2] || 7);
const KM = Number(process.argv[3] || 12);
const road = new Road(makeAlpine(SEED), SEED);
const pts = [];
let next = 0;
for (let sCar = 0; next <= KM * 1000; sCar += 50) {
  road.update(sCar);
  const hi = Math.min(road.classified, Math.floor((sCar + 2000) / STEP));
  while (next <= hi * STEP && next <= KM * 1000) {
    const p = road.samples.get(Math.round(next / STEP));
    if (p) pts.push([next, +p.y.toFixed(2), +p.g.toFixed(2), p.kind, p.mode === 'hairpin' ? 1 : 0]);
    next += 8;
  }
}
process.stdout.write(JSON.stringify(pts));
