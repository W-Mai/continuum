// Where the valley's own things lie: the water round the lens, the row of poplars
// along the shore, the gravel bars in the river and the pier with its boat. Each is a
// pure function of the land, the road and the seed, so the same place has the same
// things each time the car comes by; nothing here touches three.js (the poplars are
// planted in the workers that bake the trees).
//
//  - The water grid is the land round the lens in cells of ten metres, each with how
//    deep the water is over it: what the mist is drawn over, how far the nearest water
//    is (the sound), and where the shore runs.
//  - A poplar stands on a lattice of nine metres laid over the land (each jittered by a
//    metre or so), wherever the shore is six and a half to thirteen and a half metres
//    off and the road is not near: a row of them along each bank.
//  - A gravel bar is a long low mound in the middle of a river that is wide and deep
//    enough to hold it, its top a hand's depth under the water; its edges are the
//    shallows.
//  - A pier is one in each 1500 m of road, where the water comes within 80 m of the
//    road: a deck on posts from the bank out over the water, a boat tied at its head.
//
// A thing belongs to the valley by the share it has of the world under it, so each of
// them thins out and goes as the next world comes in.

import { WORLD_INDEX } from './worlds.js';
import { HALF_FLAT, GROUND } from './road.js';

export const VALLEY = WORLD_INDEX.river;

export function hash3(a, b, c) {
  let h = (Math.imul(a | 0, 0x8da6b343) ^ Math.imul(b | 0, 0xd8163841) ^ Math.imul(c | 0, 0x2545f491)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const tmpW = { a: 0, b: 0, t: 0, u: 0 };

// How much of the world at an absolute point is the valley's, 0 to 1.
export function valleyShare(worlds, ax, az, out = tmpW) {
  const w = worlds.at(ax, az, out);
  return (w.a === VALLEY ? 1 - w.t : 0) + (w.b === VALLEY ? w.t : 0);
}

// Whether water stands over the ground at an absolute point.
export function isWet(land, ax, az) {
  const wl = land.waterLevel(ax, az);
  return wl !== -Infinity && land.heightAt(ax, az) < wl;
}

// How deep the water is over the ground at an absolute point (0 where none).
export function waterDepth(land, ax, az) {
  const wl = land.waterLevel(ax, az);
  return wl === -Infinity ? 0 : Math.max(0, wl - land.heightAt(ax, az));
}

// --- the water round the lens -----------------------------------------------------

// cell: metres on a side of a cell; n: cells across (a power of two), so that the grid
// reaches n * cell / 2 metres each way of the lens; wet: the depth (m) from which a cell
// is water.
export const WATER_GRID = { cell: 10, n: 64, wet: 0.05 };

// The land round a point in cells laid in absolute coordinates and kept in a wrap of
// n by n: a cell is worked out when the lens comes within reach of it and stays as it
// is while it is, so what the lens passes costs a row of cells every ten metres.
export class WaterGrid {
  constructor(land, grid = WATER_GRID) {
    this.land = land;
    this.cell = grid.cell;
    this.n = grid.n;
    this.wet = grid.wet;
    const n = this.n;
    this.depth = new Float32Array(n * n);       // m of water over the ground in the middle of the cell (0: none)
    this.mask = new Uint8Array(n * n);          // 255 where water stands there: the texture the mist is shaped by
    this.ci = new Int32Array(n * n).fill(0x7fffffff);
    this.cj = new Int32Array(n * n).fill(0x7fffffff);
    this.version = 0;
    this._todo = [];
  }

  // Work out the cells in reach of an absolute point that are not worked out yet, the
  // nearest first, `budget` of them at most. Returns how many are left.
  fill(ax, az, budget = 256) {
    const n = this.n;
    const c = this.cell;
    const i0 = Math.floor(ax / c) - n / 2;
    const j0 = Math.floor(az / c) - n / 2;
    const todo = this._todo;
    todo.length = 0;
    for (let j = j0; j < j0 + n; j++) {
      for (let i = i0; i < i0 + n; i++) {
        const k = (j & (n - 1)) * n + (i & (n - 1));
        if (this.ci[k] === i && this.cj[k] === j) continue;
        const dx = (i + 0.5) * c - ax;
        const dz = (j + 0.5) * c - az;
        todo.push([dx * dx + dz * dz, i, j, k]);
      }
    }
    if (!todo.length) return 0;
    if (todo.length > budget) todo.sort((p, q) => p[0] - q[0]);
    const land = this.land;
    const m = Math.min(budget, todo.length);
    for (let q = 0; q < m; q++) {
      const [, i, j, k] = todo[q];
      const d = waterDepth(land, (i + 0.5) * c, (j + 0.5) * c);
      this.depth[k] = d;
      this.mask[k] = d > this.wet ? 255 : 0;
      this.ci[k] = i;
      this.cj[k] = j;
    }
    this.version++;
    return todo.length - m;
  }

  // The depth in the cell an absolute point is in (0 where it is not worked out or dry).
  at(ax, az) {
    const n = this.n;
    const i = Math.floor(ax / this.cell);
    const j = Math.floor(az / this.cell);
    const k = (j & (n - 1)) * n + (i & (n - 1));
    return this.ci[k] === i && this.cj[k] === j ? this.depth[k] : 0;
  }

  // The nearest water to an absolute point within `max` metres: { dist (to the edge of the
  // cell), depth, ax, az }, or null.
  nearest(ax, az, max, out = { dist: 0, depth: 0, ax: 0, az: 0 }) {
    const n = this.n;
    const c = this.cell;
    const r = Math.min(Math.ceil(max / c), n / 2 - 1);
    const ci = Math.floor(ax / c);
    const cj = Math.floor(az / c);
    let best = Infinity;
    let at = -1;
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        const k = (j & (n - 1)) * n + (i & (n - 1));
        if (this.ci[k] !== i || this.cj[k] !== j || this.mask[k] === 0) continue;
        const dx = (i + 0.5) * c - ax;
        const dz = (j + 0.5) * c - az;
        const d = dx * dx + dz * dz;
        if (d < best) {
          best = d;
          at = k;
          out.ax = (i + 0.5) * c;
          out.az = (j + 0.5) * c;
        }
      }
    }
    if (at < 0) return null;
    out.dist = Math.max(0, Math.sqrt(best) - c * 0.5);
    out.depth = this.depth[at];
    return out.dist <= max ? out : null;
  }
}

// How far the nearest water is from an absolute point, by eight rays and a bisection
// where one meets it: Infinity beyond `reach` metres. (A touch over the true distance, at
// most by the cosine of an eighth of a turn.)
const RAYS = Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)]);
export function shoreDistance(land, ax, az, reach = 18, step = 2) {
  let best = Infinity;
  for (const [cx, cz] of RAYS) {
    for (let d = step; d <= Math.min(reach, best); d += step) {
      if (!isWet(land, ax + cx * d, az + cz * d)) continue;
      let lo = d - step;
      let hi = d;
      for (let it = 0; it < 3; it++) {
        const mid = (lo + hi) / 2;
        if (isWet(land, ax + cx * mid, az + cz * mid)) hi = mid;
        else lo = mid;
      }
      if (hi < best) best = hi;
      break;
    }
  }
  return best;
}

// --- the poplars --------------------------------------------------------------------

// every: metres between the points of the lattice a poplar may stand on; jitter: how far
// off its point it stands (m); band: the shore's distance from a poplar, from least to
// most (m); share: how many of the points that fit have one; world: the share of the
// valley a poplar's place has to have; clear: how far off the road's middle (m); above: how high
// over the water the ground is, at the least (m), and cut: how much the road may have cut or
// filled it.
export const POPLAR = { every: 9, jitter: 1.3, band: [6.5, 13.5], share: 0.94, world: 0.9, clear: 15, above: 0.6, cut: 0.4 };

const tmpShape = { h: 0, near: 0, cut: 0, fill: 0, kind: 0 };

// The poplars of the square of `size` metres from (x0, z0) (absolute): [ax, az, y (the
// ground the road has left), and four draws from 0 to 1 (height, width, turn, tint)] for
// each, added to out. env: land, corridor; ctx: the corridor's prepare() for the square.
export function poplarsIn(env, x0, z0, size, ctx, seed, out = []) {
  const { land, corridor } = env;
  const worlds = land.worlds;
  if (!worlds) return out;
  const P = POPLAR;
  // Where the valley is at the corners and the middle of it: none of it, nothing.
  let any = 0;
  for (const [fx, fz] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) any = Math.max(any, valleyShare(worlds, x0 + fx * size, z0 + fz * size));
  if (any < 0.5) return out;
  // Where water stands, probed every 16 m of the square and the 16 m round it.
  const probe = 16;
  const wet = [];
  for (let z = z0 - probe; z <= z0 + size + probe; z += probe) {
    for (let x = x0 - probe; x <= x0 + size + probe; x += probe) if (isWet(land, x, z)) wet.push(x, z);
  }
  if (!wet.length) return out;
  const reach2 = (P.band[1] + probe * 1.1) ** 2;
  const E = P.every;
  const a0 = Math.floor((x0 - P.jitter) / E - 0.5);
  const a1 = Math.ceil((x0 + size + P.jitter) / E - 0.5);
  const b0 = Math.floor((z0 - P.jitter) / E - 0.5);
  const b1 = Math.ceil((z0 + size + P.jitter) / E - 0.5);
  for (let b = b0; b <= b1; b++) {
    for (let a = a0; a <= a1; a++) {
      const ax = (a + 0.5) * E + (hash3(a, b, seed ^ 0x9a1) - 0.5) * 2 * P.jitter;
      const az = (b + 0.5) * E + (hash3(a, b, seed ^ 0x9a2) - 0.5) * 2 * P.jitter;
      if (ax < x0 || ax >= x0 + size || az < z0 || az >= z0 + size) continue;
      if (hash3(a, b, seed ^ 0x9a3) >= P.share) continue;
      let near = false;
      for (let q = 0; q < wet.length; q += 2) {
        const dx = wet[q] - ax;
        const dz = wet[q + 1] - az;
        if (dx * dx + dz * dz < reach2) {
          near = true;
          break;
        }
      }
      if (!near || valleyShare(worlds, ax, az) < P.world) continue;
      const d = shoreDistance(land, ax, az, P.band[1] + 2);
      if (d < P.band[0] || d > P.band[1]) continue;
      corridor.shape(ctx, ax, az, land.heightAt(ax, az), tmpShape);
      if (tmpShape.near < P.clear || tmpShape.cut + tmpShape.fill > P.cut || tmpShape.h - land.waterLevel(ax, az) < P.above) continue;
      out.push(ax, az, tmpShape.h, hash3(a, b, seed ^ 0x9a4), hash3(a, b, seed ^ 0x9a5), hash3(a, b, seed ^ 0x9a6), hash3(a, b, seed ^ 0x9a7));
    }
  }
  return out;
}

// --- the plan of the road's side --------------------------------------------------------

// every: metres of road to a pier's cell; road: how far off the road's verge the shore may
// be, from least to most (m); len: the pier's length (m), onLand: how much of it is on the
// bank; deck: how high its deck is over the water; wide: across the deck; deep: the water
// the head stands in at the least; bank: the least slope (rise over run) the ground has
// where it goes into the water; margin: how far off the road's verge any of it stays.
export const PIER = { every: 1500, road: [14, 80], len: [8, 14], onLand: 2.2, deck: 0.95, wide: 1.7, deep: 1.0, bank: 0.12, margin: 8 };

// every: metres of road to the cell the gravel bars are looked for in; per: the most of
// them in one; len, wide: a bar's length along the river and across it (m); bed: the
// river's bed under the water, top: the top of a bar under it (m); road: how far off the
// road a bar lies (m); deep: how much water has to be round it on every side (m); apart: the
// closest two bars lie (m); share: how many of the places that fit have one.
export const BAR = { every: 600, per: 2, len: [26, 44], wide: [9, 15], bed: -5, top: -0.22, road: [20, 190], deep: 3.4, apart: 70, share: 0.8 };

export class ValleyPlan {
  // land, road, corridor, worlds as the game has them (absolute coordinates).
  constructor({ land, road, corridor, worlds, seed }) {
    this.land = land;
    this.road = road;
    this.corridor = corridor;
    this.worlds = worlds;
    this.seed = seed | 0;
    this.piers = new Map();
    this.bars = new Map();
    this._w = { a: 0, b: 0, t: 0, u: 0 };
    this._flow = { x: 1, z: 0 };
  }

  // The road near an absolute point: how far its centre line is.
  roadDist(ax, az, r) {
    const road = this.road;
    let dist = Infinity;
    road.forEachSegmentNear(ax, az, r, (i) => {
      const a = road.samples.get(i);
      const b = road.samples.get(i + 1);
      if (!a || !b) return;
      const ex = b.ax - a.ax;
      const ez = b.az - a.az;
      const t = Math.max(0, Math.min(1, ((ax - a.ax) * ex + (az - a.az) * ez) / (ex * ex + ez * ez || 1)));
      const d = Math.hypot(ax - (a.ax + ex * t), az - (a.az + ez * t));
      if (d < dist) dist = d;
    });
    return dist;
  }

  // Whether the land the road has shaped is as it was at a point.
  unshaped(ax, az, tol = 0.04) {
    return Math.abs(this.corridor.heightAt(ax, az) - this.land.heightAt(ax, az)) <= tol;
  }

  // A point at `lat` metres to the road's `side` (-1 or 1) of road place s: [ax, az].
  _side(s, side, lat) {
    const p = this.road.at(s);
    const o = this.road.origin;
    return [p.x + o.x - Math.sin(p.theta) * lat * side, p.z + o.z + Math.cos(p.theta) * lat * side];
  }

  // The way the river runs at an absolute point (the land's), as a unit vector [x, z].
  flow(ax, az) {
    this.land.flowAt(ax, az, this._flow);
    return [this._flow.x, this._flow.z];
  }

  // --- piers -----------------------------------------------------------------------

  // The pier of the 1500 m of road k, or null; undefined where the road is not laid yet.
  // { k, s (along the road), ax, az (the end on the bank), sx, sz (where the bank is water's edge),
  //   hx, hz (the head), dx, dz (the way out over the water), len, y (the water), deck (its
  //   deck's height), posts: [x, z, y of the ground, ...], boat: { ax, az, yaw } }.
  pier(k) {
    if (this.piers.has(k)) return this.piers.get(k);
    const road = this.road;
    const P = PIER;
    const s0 = k * P.every;
    if (!road.at(s0 + 60) || !road.at(s0 + P.every - 60)) return undefined;
    const first = hash3(k, 41, this.seed) < 0.5 ? -1 : 1;
    let best = null;
    let bestScore = Infinity;
    for (let s = s0 + 80; s <= s0 + P.every - 80; s += 40) {
      const p = road.at(s);
      if (!p || p.kind !== GROUND) continue;
      const o = road.origin;
      if (valleyShare(this.worlds, p.x + o.x, p.z + o.z) < 0.9) continue;
      for (const side of [first, -first]) {
        const cand = this._pierAt(k, s, side);
        if (!cand) continue;
        const score = Math.abs(cand.road - 44) + 6 * hash3(k, Math.round(s), this.seed ^ 0x4e1);
        if (score < bestScore) {
          bestScore = score;
          best = cand;
        }
      }
    }
    this.piers.set(k, best);
    return best;
  }

  // A pier where the road at s meets water to its side, or null.
  _pierAt(k, s, side) {
    const P = PIER;
    const land = this.land;
    // Water along the way out from the road's verge, the first place that has it.
    let hit = -1;
    for (let lat = HALF_FLAT + P.road[0]; lat <= HALF_FLAT + P.road[1]; lat += 6) {
      const [x, z] = this._side(s, side, lat);
      if (isWet(land, x, z)) {
        hit = lat;
        break;
      }
    }
    if (hit < 0) return null;
    let lo = hit - 6;
    let hi = hit;
    for (let it = 0; it < 4; it++) {
      const mid = (lo + hi) / 2;
      const [x, z] = this._side(s, side, mid);
      if (isWet(land, x, z)) hi = mid;
      else lo = mid;
    }
    const [sx, sz] = this._side(s, side, hi);
    // The way down the bank (out over the water): against the slope of the ground, which has to be a bank.
    const e = 2.5;
    const gx = (land.heightAt(sx + e, sz) - land.heightAt(sx - e, sz)) / (2 * e);
    const gz = (land.heightAt(sx, sz + e) - land.heightAt(sx, sz - e)) / (2 * e);
    const g = Math.hypot(gx, gz);
    if (g < P.bank) return null;
    const dx = -gx / g;
    const dz = -gz / g;
    const len = P.len[0] + (P.len[1] - P.len[0]) * hash3(k, Math.round(s), this.seed ^ 0x4e2);
    const y = land.waterLevel(sx, sz);
    const ax = sx - dx * P.onLand;
    const az = sz - dz * P.onLand;
    const hx = ax + dx * len;
    const hz = az + dz * len;
    // The pier has water under it from the bank to the head, deep enough at the head, and open water either side of it.
    const nx = -dz;
    const nz = dx;
    if (waterDepth(land, hx, hz) < P.deep) return null;
    for (let t = P.onLand + 0.6; t <= len; t += 1.5) {
      if (!isWet(land, ax + dx * t, az + dz * t)) return null;
    }
    for (const c of [-2.6, 2.6]) {
      if (!isWet(land, hx + nx * c, hz + nz * c) || !isWet(land, hx + dx * 2 + nx * c, hz + dz * 2 + nz * c)) return null;
    }
    // Over the bank: its end is not buried in a hill, nor does it hang over a drop.
    const gA = land.heightAt(ax, az);
    if (gA < y - 0.3 || gA > y + P.deck + 1.2) return null;
    // Clear of the road, and on land as it was.
    const r = HALF_FLAT + P.margin;
    for (let t = 0; t <= len; t += 3) {
      if (this.roadDist(ax + dx * t, az + dz * t, r + 30) < r) return null;
    }
    if (!this.unshaped(sx, sz) || !this.unshaped(ax, az)) return null;
    const dist = this.roadDist(sx, sz, 140);
    // The posts, in pairs from the bank every three metres and one at the head; the ground each stands on.
    const posts = [];
    for (let t = 1.2; t < len - 0.2; t += 3) posts.push(t);
    posts.push(len - 0.25);
    const list = [];
    for (const t of posts) {
      for (const c of [-1, 1]) {
        const px = ax + dx * t + nx * c * (P.wide / 2 - 0.12);
        const pz = az + dz * t + nz * c * (P.wide / 2 - 0.12);
        list.push(px, pz, land.heightAt(px, pz));
      }
    }
    // The boat lies off the head, downstream of it and along the current, its bow toward the pier.
    const f = this.flow(hx, hz);
    const boat = { ax: hx + dx * 0.4 + f[0] * 2.4, az: hz + dz * 0.4 + f[1] * 2.4, yaw: Math.atan2(-f[0], -f[1]) };
    return { k, s, side, road: dist, ax, az, sx, sz, hx, hz, dx, dz, len, y, deck: y + P.deck, posts: list, boat };
  }

  // --- gravel bars -------------------------------------------------------------------

  // The bars of the 600 m of road k: [{ ax, az, len, wide, yaw, key }], [] where there are none;
  // undefined where the road is not laid yet.
  barsIn(k) {
    if (this.bars.has(k)) return this.bars.get(k);
    const road = this.road;
    const B = BAR;
    const s0 = k * B.every;
    if (!road.at(s0 + 30) || !road.at(s0 + B.every - 30)) return undefined;
    const land = this.land;
    const out = [];
    const o = road.origin;
    // Down a flat-bedded river: places mid-channel, found by walking out from the road across it.
    for (let s = s0 + 40; s < s0 + B.every - 20 && out.length < B.per; s += 50) {
      const p = road.at(s);
      if (!p || valleyShare(this.worlds, p.x + o.x, p.z + o.z) < 0.9) continue;
      for (const side of [-1, 1]) {
        if (out.length >= B.per) break;
        let d0 = -1;
        let d1 = -1;
        for (let lat = HALF_FLAT + B.road[0]; lat <= B.road[1] + 60; lat += 6) {
          const [x, z] = this._side(s, side, lat);
          const wet = isWet(land, x, z);
          if (wet && d0 < 0) d0 = lat;
          if (wet) d1 = lat;
          else if (d0 >= 0) break;
        }
        if (d0 < 0 || d1 - d0 < 54) continue;
        const key = k * 131 + Math.round((s - s0) / 50) * 2 + (side > 0 ? 1 : 0);
        if (hash3(key, 51, this.seed) >= B.share) continue;
        const lat = d0 + (d1 - d0) * (0.32 + 0.36 * hash3(key, 52, this.seed));
        if (lat < B.road[0] || lat > B.road[1]) continue;
        const [ax, az] = this._side(s, side, lat);
        const len = B.len[0] + (B.len[1] - B.len[0]) * hash3(key, 53, this.seed);
        const wide = B.wide[0] + (B.wide[1] - B.wide[0]) * hash3(key, 54, this.seed);
        const f = this.flow(ax, az);
        const yaw = Math.atan2(f[0], f[1]);
        // The whole of it over deep water, with water to spare all round.
        const c = Math.cos(yaw);
        const sn = Math.sin(yaw);
        let ok = true;
        for (let q = 0; q < 16 && ok; q++) {
          const a = (q / 16) * Math.PI * 2;
          const u = Math.cos(a) * (len / 2 + 4);
          const v = Math.sin(a) * (wide / 2 + 4);
          // (u along the way the river runs, v across it.)
          if (waterDepth(land, ax + sn * u + c * v, az + c * u - sn * v) < B.deep) ok = false;
        }
        if (!ok || waterDepth(land, ax, az) < B.deep) continue;
        if (out.some((b) => Math.hypot(b.ax - ax, b.az - az) < B.apart)) continue;
        out.push({ ax, az, len, wide, yaw, key });
      }
    }
    this.bars.set(k, out);
    return out;
  }

  // Let go of the plans of the road far from s (m along the road).
  prune(s) {
    for (const k of this.piers.keys()) if (Math.abs((k + 0.5) * PIER.every - s) > 5000) this.piers.delete(k);
    for (const k of this.bars.keys()) if (Math.abs((k + 0.5) * BAR.every - s) > 3000) this.bars.delete(k);
  }

  // Forget the plans of the road that is gone (the road is cut and laid again after a turn),
  // from progress s on.
  forget(s) {
    for (const k of this.piers.keys()) if ((k + 1) * PIER.every > s) this.piers.delete(k);
    for (const k of this.bars.keys()) if ((k + 1) * BAR.every > s) this.bars.delete(k);
  }
}
