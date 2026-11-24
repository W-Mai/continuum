// The hills' farmland, as numbers: the land is cut into fields, each a cover of
// its own (wheat, rape, ploughed earth, pasture, fallow, clover, or stubble with
// stacks of straw standing in it), with a bank between one and the next that a
// hedge grows on in some places.
//
// A field is the ground nearest to one point of a jittered lattice (a Voronoi
// cell), so it is told from an absolute position alone: the land's shader
// (render/fieldshade.js) works it out for each pixel, with the same integer
// hash and the same arithmetic as here, and the trees (world/vegetation.js), the
// stacks of straw (render/clutter.js) and the checks ask this file. Nothing here
// touches three.js, and nothing depends on the seed: where the road sets out
// (its absolute position) is what differs from one seed to the next.

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// cell: metres between the lattice's points; stray: how far a point is from the middle of
// its cell, as a share of the cell (the whole width of the range: 0.8 is 0.4 either way);
// ridge: the bank between two fields (m across); slope, road, wood: where a field is laid, by how
// steep the ground is (1 - the normal's y: whole under the first number, none over the second),
// how far from the road's middle (m: none under the first, whole over the second) and how
// thick the trees baked into the land are (whole under the first, none over the second);
// furrow: metres between the furrows of ploughed ground; row: metres between the lines of drilled
// crop; even: from how far off (m) the fields are drawn as patches of colour of the lightness of the land under
// them (a share of it, from 0 to the whole by the second number), not as the lighter and darker they are close by; stack: the stacks of straw (a field's own number of them, the metres between the rows, between
// the stacks of a row, and how near the edge of the field the nearest is).
export const FIELD = {
  cell: 150,
  stray: 0.8,
  ridge: 1.5,
  slope: [0.07, 0.12],
  road: [20, 32],
  wood: [0.03, 0.14],
  furrow: 7,
  row: 3.2,
  even: [120, 350],
  stack: { count: [6, 14], rows: 22, along: 10, edge: 7, radius: 0.65 },
};

// What a field may be, by the share of the fields that are: its colour as the land is seen in
// the real style (sRGB), the flat colour of it in a style of flat paints, how much of the
// land's grass grows on it (the blades the painted styles lay), and the second colour that
// flecks it, if it has one. The shader's table is made from this.
export const CROPS = [
  { id: 'wheat', share: 0.225, color: 0x84a03a, flat: 0x84a03a, grass: 0.9 },
  { id: 'rape', share: 0.13, color: 0xd9b624, flat: 0xd9b624, grass: 0.9 },
  { id: 'ploughed', share: 0.18, color: 0x5f4630, flat: 0x5f4630, grass: 0 },
  { id: 'pasture', share: 0.22, color: 0x3f6b2b, flat: 0x3f6b2b, grass: 1 },
  { id: 'fallow', share: 0.12, color: 0xa08e56, flat: 0xa08e56, grass: 0.6 },
  { id: 'clover', share: 0.1, color: 0x6f7a4c, flat: 0x867a6c, grass: 1, fleck: 0xa4609a },
  { id: 'stubble', share: 0.025, color: 0xc4b068, flat: 0xc4b068, grass: 0.15 },
];
export const CROP = Object.fromEntries(CROPS.map((c, i) => [c.id, i]));
const CUT = CROPS.map((c, i) => CROPS.slice(0, i + 1).reduce((s, e) => s + e.share, 0));

// The same integer hash as the shader's (render/fieldshade.js): a cell and a salt to a number in [0, 1).
export function fieldHash(ix, iz, salt) {
  let h = (Math.imul(ix, 0x8da6b343) ^ Math.imul(iz, 0xd8163841) ^ Math.imul(salt, 0x2545f491)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return (h & 0xffffff) / 16777216;
}

// Which crop (an index into CROPS) a number in [0, 1) is.
export function cropOf(u) {
  for (let i = 0; i < CUT.length; i++) if (u < CUT[i]) return i;
  return CUT.length - 1;
}

// The point of lattice cell (ix, iz), in metres from the corner of the cell: out [x, z].
function point(ix, iz, out) {
  out[0] = (0.5 + (fieldHash(ix, iz, 1) - 0.5) * FIELD.stray) * FIELD.cell;
  out[1] = (0.5 + (fieldHash(ix, iz, 2) - 0.5) * FIELD.stray) * FIELD.cell;
  return out;
}

// The crop of the field whose point is in lattice cell (ix, iz), the tone it is laid in (a
// number in [0, 1)) and the way its rows run (radians, from 0 to a half turn).
export const cropAt = (ix, iz) => cropOf(fieldHash(ix, iz, 3));
export const toneAt = (ix, iz) => fieldHash(ix, iz, 4);
export const rowAt = (ix, iz) => fieldHash(ix, iz, 6) * Math.PI;

const PX = new Float64Array(9);
const PZ = new Float64Array(9);
const TMP = [0, 0];

// The field at an absolute point: out.ix, out.iz (the lattice cell of its point), out.crop, out.edge (the
// metres to the nearest border of it, into it), out.jx, out.jz (the cell of the field across that border),
// out.crop2 (its crop). The points of the 3 by 3 cells round the point's own are looked at; the nearest is
// the field, and the border is the nearest of the lines half way to the others.
export function fieldAt(ax, az, out = {}) {
  const S = FIELD.cell;
  const c0x = Math.floor(ax / S);
  const c0z = Math.floor(az / S);
  // (Everything from here in metres from the corner of the point's own cell: the numbers stay small.)
  const px = ax - c0x * S;
  const pz = az - c0z * S;
  let best = Infinity;
  let bi = 0;
  for (let k = 0; k < 9; k++) {
    const di = (k % 3) - 1;
    const dj = Math.floor(k / 3) - 1;
    point(c0x + di, c0z + dj, TMP);
    PX[k] = TMP[0] + di * S;
    PZ[k] = TMP[1] + dj * S;
    const dx = PX[k] - px;
    const dz = PZ[k] - pz;
    const d = dx * dx + dz * dz;
    if (d < best) {
      best = d;
      bi = k;
    }
  }
  const mx = PX[bi];
  const mz = PZ[bi];
  let edge = Infinity;
  let bj = bi;
  for (let k = 0; k < 9; k++) {
    if (k === bi) continue;
    const nx = PX[k] - mx;
    const nz = PZ[k] - mz;
    const d = (((mx + PX[k]) * 0.5 - px) * nx + ((mz + PZ[k]) * 0.5 - pz) * nz) / Math.hypot(nx, nz);
    if (d < edge) {
      edge = d;
      bj = k;
    }
  }
  out.ix = c0x + (bi % 3) - 1;
  out.iz = c0z + Math.floor(bi / 3) - 1;
  out.jx = c0x + (bj % 3) - 1;
  out.jz = c0z + Math.floor(bj / 3) - 1;
  out.edge = edge;
  out.crop = cropAt(out.ix, out.iz);
  out.crop2 = cropAt(out.jx, out.jz);
  return out;
}

// The point of a field, in absolute metres: out [x, z].
export function fieldPoint(ix, iz, out = [0, 0]) {
  point(ix, iz, out);
  out[0] += ix * FIELD.cell;
  out[1] += iz * FIELD.cell;
  return out;
}

// Whether a point of the land is one a field lies on, from 0 to 1: the slope of it (1 - the normal's
// y), its distance from the road's middle (m) and the baked thickness of the trees there. As the shader has it.
export function fieldMask(slope, road, wood) {
  return (1 - smooth(FIELD.slope[0], FIELD.slope[1], slope)) * smooth(FIELD.road[0], FIELD.road[1], road)
    * (1 - smooth(FIELD.wood[0], FIELD.wood[1], wood));
}

// --- the hedges on the banks ---------------------------------------------------------

// The share of the banks that have a hedge, and how it thins out from the middle of the bank (m).
export const HEDGE = { share: 0.55, reach: [1.4, 3.2] };

// Whether the border between two fields (lattice cells a and b) has a hedge.
export function hedged(ax, az, bx, bz) {
  const flip = ax > bx || (ax === bx && az > bz);
  const [x0, z0, x1, z1] = flip ? [bx, bz, ax, az] : [ax, az, bx, bz];
  return fieldHash(x0 * 131 + x1, z0 * 131 + z1, 11) < HEDGE.share;
}

// How much of a hedge there is at an absolute point, from 0 (none) to 1 (the middle of one): it lies
// along a bank that has one, a few metres wide.
export function hedgeAt(ax, az, scratch = {}) {
  const f = fieldAt(ax, az, scratch);
  if (f.edge > HEDGE.reach[1]) return 0;
  if (!hedged(f.ix, f.iz, f.jx, f.jz)) return 0;
  return 1 - smooth(HEDGE.reach[0], HEDGE.reach[1], f.edge);
}

// --- the stacks of straw in a stubble field ------------------------------------------

const stacks = new Map();

// The stacks of straw of the field whose point is in lattice cell (ix, iz), if its crop is stubble: [{ x, z, yaw, size }] in
// absolute metres, or []. A field has 6 to 14, in rows along the way the field's rows run, a few metres in from its edges.
export function stacksOf(ix, iz) {
  const key = ix * 100003 + iz;
  let list = stacks.get(key);
  if (list) return list;
  list = [];
  if (cropAt(ix, iz) === CROP.stubble) {
    const S = FIELD.stack;
    const n = S.count[0] + Math.floor(fieldHash(ix, iz, 7) * (S.count[1] - S.count[0] + 1));
    const a = rowAt(ix, iz);
    const rx = Math.cos(a);
    const rz = Math.sin(a);
    const [x0, z0] = fieldPoint(ix, iz);
    const scratch = {};
    // Candidates: rows across the way the field runs, a stack to each place along them, nearest the middle first.
    const spots = [];
    for (let r = -3; r <= 3; r++) {
      for (let k = -6; k <= 6; k++) {
        const jitter = (fieldHash(ix * 7 + r, iz * 7 + k, 8) - 0.5) * 1.2;
        const along = k * S.along + jitter;
        const across = r * S.rows + (fieldHash(ix * 7 + r, iz * 7 + k, 9) - 0.5) * 1.2;
        const x = x0 + rx * along - rz * across;
        const z = z0 + rz * along + rx * across;
        spots.push({ x, z, d: Math.hypot(along, across * 1.4) });
      }
    }
    spots.sort((p, q) => p.d - q.d);
    for (const p of spots) {
      if (list.length >= n) break;
      const f = fieldAt(p.x, p.z, scratch);
      if (f.ix !== ix || f.iz !== iz || f.edge < S.edge) continue;
      list.push({ x: p.x, z: p.z, yaw: fieldHash(Math.round(p.x * 4), Math.round(p.z * 4), 10) * Math.PI * 2, size: 0.92 + 0.22 * fieldHash(Math.round(p.x * 4), Math.round(p.z * 4), 12) });
    }
  }
  if (stacks.size > 600) stacks.clear();
  stacks.set(key, list);
  return list;
}
