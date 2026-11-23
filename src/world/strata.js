// The beds of a rock face, as one function.
//
// A cliff of layered rock is a stack of beds, each standing out of the face
// by its own measure: a hard one on a ledge, a soft one cut back. `stairs`
// is that face laid against a count of beds, flat across a bed and a short
// riser between one bed and the next. The land's tiles push their vertices by
// it along the normal (render/terrain.js reads what bakery.js bakes with it),
// and the rock's normal map (groundtex.js) has the same function for its
// beds, at the size of a hand's breadth to a man's height.
//
// No three.js here: the same arithmetic runs on the page and in the baking
// workers, and the same bits come out. Only + - * / and floor, no sin or cos.

import { hash2 } from './noise.js';

// How the land's face is pushed.
export const FACE = {
  amp: 0.6,             // the most a vertex goes in or out of the face, m
  slope: [0.3, 0.37],   // from this steep (1 - normal.y) it is pushed, whole at the second: a cut is 0.375
  road: [12, 20],       // not within this far of the road, whole beyond the second (m)
  beds: [7.5, 19],      // the thickness of the beds the face is made of, thin and thick (m): the grid has a vertex every 2 m across
  share: 0.45,          // the thin beds' share of how far the face is pushed
  rise: 0.16,           // the share of a bed a riser takes
};

// How far a bed stands out of the face, -1 to 1: bed k of a face of this seed.
export function standing(k, seed) {
  return hash2(k, 0x51ed, seed) * 2 - 1;
}

// The face at phase p (the count of beds up it): flat across a bed, and over
// the first `rise` of it a smooth riser from how the bed below stood to how
// this one does. -1 to 1. With a period the beds go round: a face that
// repeats after that many of them.
export function stairs(p, seed = 0, rise = FACE.rise, period = 0) {
  const k = Math.floor(p);
  const f = p - k;
  const lo = standing(period ? (((k - 1) % period) + period) % period : k - 1, seed);
  const hi = standing(period ? ((k % period) + period) % period : k, seed);
  if (f >= rise) return hi;
  const t = f / rise;
  return lo + (hi - lo) * (t * t * (3 - 2 * t));
}

// Smooth value noise on a lattice, -1 to 1.
function vnoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  let fx = x - ix;
  let fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  const top = a + (b - a) * fx;
  return (top + (c + (d - c) * fx - top) * fz) * 2 - 1;
}

// Where a point of the land is in the beds, as a height (m): the beds lie
// level on the whole, dip a little (1 in 14), and swell and sag with the
// ground (some twenty metres over a hundred, six over fifty).
export function bedHeight(x, y, z) {
  return y + x * 0.0575 + z * 0.0412 + 21 * vnoise(x / 180, z / 180, 0x7a1) + 6 * vnoise(x / 47, z / 47, 0x7a2);
}

function smooth(a, b, v) {
  const t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
  return t * t * (3 - 2 * t);
}

// How far the face is pushed out along its normal (m, negative in) at a vertex
// of the land: its place, its slope (1 - normal.y of the land as it was
// shaped) and its distance to the nearest road. 0 on ground that is not steep
// and anywhere near the road, where the land is the road's.
export function faceStep(x, y, z, slope, road) {
  const w = smooth(FACE.slope[0], FACE.slope[1], slope) * smooth(FACE.road[0], FACE.road[1], road);
  if (w <= 0) return 0;
  const h = bedHeight(x, y, z);
  const thin = stairs(h / FACE.beds[0] + 0.37, 0x1b);
  const thick = stairs(h / FACE.beds[1], 0x2c);
  return FACE.amp * w * (thick + (thin - thick) * FACE.share);
}
