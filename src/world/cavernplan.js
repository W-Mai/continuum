// Where the cavern's own small things lie: the puddles on its floor, the
// skylights in its roof and the mine track by its road. Each is a pure
// function of the land, the road and the seed, so the same place has the same
// things each time the car comes by; nothing here touches three.js.
//
//  - A puddle is a low place in the floor (concavity: the ring of ground five
//    metres round it is higher than it, on average, by at least a share of
//    half a metre). Water stands at a level above the lowest point and fills
//    what is below that level, so its shore is the contour of the ground, not
//    a circle laid on it. None is on the road or on land the road has shaped.
//  - A skylight is one in every kilometre of road, 22 to 54 m off it, on ground
//    that is level and as the land made it.
//  - A track is a stretch of narrow rails beside the road, 3 m outside its
//    shoulder, one in each 500 m where the ground there is level.
//
// A thing belongs to the cavern by its own draw across a border (as the
// trees and the things on the ground do), so each of them thins out as the
// next world comes in.

import { WORLD_INDEX } from './worlds.js';
import { HALF_FLAT, GROUND, STEP } from './road.js';

export const CAVERN = WORLD_INDEX.cavern;

export function hash3(a, b, c) {
  let h = (Math.imul(a | 0, 0x8da6b343) ^ Math.imul(b | 0, 0xd8163841) ^ Math.imul(c | 0, 0x2545f491)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- puddles -------------------------------------------------------------------

// block: metres on a side of the blocks of land a puddle is looked for in;
// lattice: the spacing of the points of a block tried for a hollow (m); ring,
// depth: how concavity is measured (below); at: the concavity a puddle needs;
// slope: the steepest ground a puddle is on (rise over run, over two metres
// either way); wall: the most the ring may stand over the puddle (a hollow, not
// the foot of a cliff); r: the mean radius a puddle has, from least to most (m);
// reach: the farthest the shore goes (m); dirs: the points of the shore; step:
// the spacing of the points it is looked for along each; apart: the closest two
// puddles of a block are (m); margin: how far off the road, beyond its verge, a
// puddle's shore stays.
export const PUDDLE = { block: 96, lattice: 6, ring: 5, depth: 0.3, at: 0.6, slope: 0.18, wall: 2.5, r: [1, 4], reach: 5.5, dirs: 12, step: 0.4, apart: 9, margin: 2.5 };

// How much lower a point is than the ground round it: the mean height of eight
// points on a ring of PUDDLE.ring metres, less the height there, over
// PUDDLE.depth, from 0 to 1. h(x, z) is the height of the ground.
export function concavity(h, x, z) {
  const c = h(x, z);
  let m = 0;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    m += h(x + PUDDLE.ring * Math.cos(a), z + PUDDLE.ring * Math.sin(a));
  }
  return Math.min(1, Math.max(0, (m / 8 - c) / PUDDLE.depth));
}

// --- skylights -------------------------------------------------------------------

// every: metres of road to a skylight's cell, spread: how far from the middle
// of the cell it stands (half of it either way), lat: the metres off the road
// it is tried at, r: its radius at the roof, from least to most, level: the
// steepest the floor under it may be (rise over run), flare: how much wider
// it is at the floor than at the roof.
export const SKYLIGHT = { every: 1000, spread: 260, lat: [22, 32, 42, 54], r: [6, 10], level: 0.25, flare: 1.25 };

// --- the track ---------------------------------------------------------------------

// every: metres of road to a track's cell, length, from least to most (m),
// off: the metres off the road's verge, gauge: between the rails, unit: the
// length one piece of it is laid in, grade: the steepest it runs along itself,
// cross: the steepest the ground leans across it (rise over the gauge), apart:
// how far above or below the road's own level the ground may be, look: how far
// along the cell a track is looked for (m).
export const TRACK = { every: 500, length: [36, 90], off: 3, gauge: 0.8, unit: 2, grade: 0.16, cross: 0.5, apart: 4, look: 220 };

// The drops that fall into the puddles: the first comes `first` seconds after the lens comes into the
// cavern, and then one every `apart[0]` to `apart[1]` seconds, each gap by a draw of its own.
export const DRIP = { first: 1.6, apart: [2.2, 5.8] };

// The seconds from drop n - 1 to drop n of a run (n from 1) in the cavern of seed.
export function dripGap(n, seed) {
  return DRIP.apart[0] + (DRIP.apart[1] - DRIP.apart[0]) * hash3(n, 31, seed | 0);
}

export class CavernPlan {
  // land, road, corridor, worlds as the game has them (absolute coordinates).
  constructor({ land, road, corridor, worlds, seed }) {
    this.land = land;
    this.road = road;
    this.corridor = corridor;
    this.worlds = worlds;
    this.seed = seed | 0;
    this._w = { a: 0, b: 0, t: 0, u: 0 };
    this._h = (x, z) => this.land.heightAt(x, z);
    this.skylights = new Map();
    this.tracks = new Map();
  }

  // Whether a thing at an absolute point, which has its own draw u (0 to 1), is
  // the cavern's: the world it belongs to is the first of the two there where
  // the draw is over the blend, the second where it is under.
  mine(ax, az, u) {
    const w = this.worlds.at(ax, az, this._w);
    return (u < w.t ? w.b : w.a) === CAVERN;
  }

  // Whether either of the two worlds at the road's place s is the cavern.
  _worldHas(s) {
    const p = this.road.at(s);
    if (!p) return false;
    const o = this.road.origin;
    const w = this.worlds.at(p.x + o.x, p.z + o.z, this._w);
    return w.a === CAVERN || w.b === CAVERN;
  }

  // The road near an absolute point: how far its centre line is, the kind of
  // the nearest stretch, and whether any is laid within r.
  roadNear(ax, az, r) {
    const road = this.road;
    let dist = Infinity;
    let kind = GROUND;
    road.forEachSegmentNear(ax, az, r, (i) => {
      const a = road.samples.get(i);
      const b = road.samples.get(i + 1);
      if (!a || !b) return;
      const ex = b.ax - a.ax;
      const ez = b.az - a.az;
      const t = Math.max(0, Math.min(1, ((ax - a.ax) * ex + (az - a.az) * ez) / (ex * ex + ez * ez || 1)));
      const d = Math.hypot(ax - (a.ax + ex * t), az - (a.az + ez * t));
      if (d < dist) {
        dist = d;
        kind = i <= road.classified ? a.kind : GROUND;
      }
    });
    return { dist, kind, any: dist < Infinity };
  }

  // Whether the land the road has shaped is as it was at a point.
  unshaped(ax, az, tol = 0.04) {
    return Math.abs(this.corridor.heightAt(ax, az) - this.land.heightAt(ax, az)) <= tol;
  }

  // --- puddles ----------------------------------------------------------------

  // The puddles of the block of land (bx, bz), PUDDLE.block metres on a side:
  // each hollow in it that is low enough and level enough, off the road and on
  // land as it was. [] where there are none; undefined where no road is laid yet
  // (it is looked for again later). A puddle is { ax, az, y (the water's level),
  // r (mean radius), ext (the shore's distances, dirs of them from +x round),
  // conc, hit: [x, z] where a drop falls, from the middle, key }.
  puddlesIn(bx, bz) {
    const P = PUDDLE;
    const h = this._h;
    const x0 = bx * P.block;
    const z0 = bz * P.block;
    const n = Math.round(P.block / P.lattice);
    const rand = mulberry32((hash3(bx, bz, this.seed ^ 0x5d1e) * 4294967296) >>> 0);
    // (None where neither of the worlds is the cavern.)
    const w = this.worlds.at(x0 + P.block / 2, z0 + P.block / 2, this._w);
    if (w.a !== CAVERN && w.b !== CAVERN) return [];
    const near0 = this.roadNear(x0 + P.block / 2, z0 + P.block / 2, 400);
    if (!near0.any) return undefined;
    // The hollows of the lattice: lower than the eight round them, taken down
    // to the bottom, and kept if the bottom is in the block.
    const g = new Float64Array((n + 3) * (n + 3));
    const at = (i, j) => (j + 1) * (n + 3) + (i + 1);
    for (let j = -1; j <= n + 1; j++) for (let i = -1; i <= n + 1; i++) g[at(i, j)] = h(x0 + i * P.lattice, z0 + j * P.lattice);
    const out = [];
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const c = g[at(i, j)];
        let hollow = true;
        for (let dj = -1; dj <= 1 && hollow; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && g[at(i + di, j + dj)] <= c) hollow = false;
        if (!hollow) continue;
        let x = x0 + i * P.lattice;
        let z = z0 + j * P.lattice;
        let step = 1.5;
        for (let it = 0; it < 40 && step > 0.15; it++) {
          let best = h(x, z);
          let qx = x;
          let qz = z;
          for (let k = 0; k < 8; k++) {
            const a = (k * Math.PI) / 4;
            const px = x + step * Math.cos(a);
            const pz = z + step * Math.sin(a);
            const ph = h(px, pz);
            if (ph < best - 1e-4) {
              best = ph;
              qx = px;
              qz = pz;
            }
          }
          if (qx === x && qz === z) step *= 0.5;
          else {
            x = qx;
            z = qz;
          }
        }
        if (Math.floor(x / P.block) !== bx || Math.floor(z / P.block) !== bz) continue;
        if (out.some((q) => Math.hypot(q.ax - x, q.az - z) < P.apart)) continue;
        const p = this._puddle(x, z, rand);
        if (p) out.push(p);
      }
    }
    return out;
  }

  // The puddle in the hollow whose bottom is (x, z), or null.
  _puddle(x, z, rand) {
    const P = PUDDLE;
    const h = this._h;
    const conc = concavity(h, x, z);
    if (conc < P.at) return null;
    const y0 = h(x, z);
    // Level, not the foot of a cliff: the slope over 2 m either way, and the ring.
    const gx = (h(x + 2, z) - h(x - 2, z)) / 4;
    const gz = (h(x, z + 2) - h(x, z - 2)) / 4;
    if (Math.hypot(gx, gz) > P.slope) return null;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      if (h(x + P.ring * Math.cos(a), z + P.ring * Math.sin(a)) - y0 > P.wall) return null;
    }
    // Off the road, and the cavern's by its own draw, and on land the road has not shaped.
    const near = this.roadNear(x, z, 120);
    if (near.dist < HALF_FLAT + P.margin + P.reach) return null;
    if (!this.mine(x, z, hash3(Math.round(x * 4), Math.round(z * 4), this.seed))) return null;
    if (!this.unshaped(x, z)) return null;
    // The radius it has, and the level of water that gives the shore that radius on average.
    const rWant = P.r[0] + (P.r[1] - P.r[0]) * Math.pow(rand(), 0.8);
    const ext = new Float32Array(P.dirs);
    let open = 0;
    const shore = (level) => {
      let sum = 0;
      open = 0;
      for (let k = 0; k < P.dirs; k++) {
        const a = (k / P.dirs) * Math.PI * 2;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        let prev = y0;
        let e = P.reach;
        let closed = false;
        for (let m = 1; m * P.step <= P.reach; m++) {
          const d = m * P.step;
          const gh = h(x + dx * d, z + dz * d);
          if (gh >= level) {
            e = d - P.step + (P.step * (level - prev)) / Math.max(gh - prev, 1e-6);
            closed = true;
            break;
          }
          prev = gh;
        }
        if (!closed) open++;
        ext[k] = Math.max(0.3, e);
        sum += ext[k];
      }
      return sum / P.dirs;
    };
    let lo = y0 + 0.01;
    let hi = y0 + 0.6;
    if (shore(hi) < P.r[0] && !open) return null;
    let level = lo;
    for (let it = 0; it < 7; it++) {
      level = (lo + hi) / 2;
      const r = shore(level);
      if (r < rWant && !open) lo = level;
      else hi = level;
    }
    // (The water must be held all the way round: a hollow with a way out for it is not a puddle.)
    level = hi;
    let r = shore(level);
    if (open || r < P.r[0]) {
      level = lo;
      r = shore(level);
    }
    if (open || r < P.r[0]) return null;
    let reach = 0;
    for (let k = 0; k < P.dirs; k++) reach = Math.max(reach, ext[k]);
    if (near.dist < HALF_FLAT + P.margin + reach) return null;
    for (let k = 0; k < P.dirs; k += 3) {
      const a = (k / P.dirs) * Math.PI * 2;
      if (!this.unshaped(x + Math.cos(a) * (ext[k] + 1.5), z + Math.sin(a) * (ext[k] + 1.5))) return null;
    }
    const ha = rand() * Math.PI * 2;
    const hr = 0.5 * r * Math.sqrt(rand());
    return { ax: x, az: z, y: level, r, ext, conc, hit: [Math.cos(ha) * hr, Math.sin(ha) * hr], key: Math.round(x * 8) * 100003 + Math.round(z * 8) };
  }

  // --- skylights ----------------------------------------------------------------

  // The skylight of the kilometre of road k, or null; undefined where the road
  // is not laid yet. { ax, az, r, s (along the road), side, lat }.
  skylight(k) {
    if (this.skylights.has(k)) return this.skylights.get(k);
    const S = SKYLIGHT;
    const road = this.road;
    const o = road.origin;
    let found = null;
    const s0 = (k + 0.5) * S.every + (hash3(k, 11, this.seed) - 0.5) * S.spread;
    const first = hash3(k, 12, this.seed) < 0.5 ? -1 : 1;
    const r = S.r[0] + (S.r[1] - S.r[0]) * hash3(k, 13, this.seed);
    if (!road.at(s0 - 60) || !road.at(s0 + 60)) return undefined;
    // (None where neither of the worlds is the cavern.)
    if (!this._worldHas(s0)) {
      this.skylights.set(k, null);
      return null;
    }
    for (let n = 0; n < 8 && !found; n++) {
      const s = s0 + ((n >> 1) % 2 === 0 ? 1 : -1) * (n >> 2) * 70;
      const side = n % 2 === 0 ? first : -first;
      const lat = S.lat[(n >> 1) % S.lat.length] + (n >> 2) * 6;
      const p = road.at(s);
      if (!p || p.kind !== GROUND) continue;
      const ax = p.x + o.x - Math.sin(p.theta) * lat * side;
      const az = p.z + o.z + Math.cos(p.theta) * lat * side;
      if (!this.mine(ax, az, hash3(k, 14, this.seed))) continue;
      const near = this.roadNear(ax, az, 80);
      if (near.dist < lat - 6 || near.kind !== GROUND) continue;
      // Level, and as the land made it, as far as the light reaches.
      const h = this._h;
      const c = h(ax, az);
      let ok = this.unshaped(ax, az);
      for (let q = 0; ok && q < 8; q++) {
        const a = (q * Math.PI) / 4;
        const qx = ax + Math.cos(a) * r * 1.4;
        const qz = az + Math.sin(a) * r * 1.4;
        if (Math.abs(h(qx, qz) - c) > S.level * r * 1.4 || !this.unshaped(qx, qz)) ok = false;
      }
      if (ok) found = { ax, az, r, s, side, lat };
    }
    this.skylights.set(k, found);
    return found;
  }

  // The skylight that lights the ground a cell of 10 m about an absolute point
  // is in, if one does: { ax, az, r, world }. Only of the skylights that are
  // known (the ones near the lens are).
  litAt(ax, az) {
    for (const q of this.skylights.values()) {
      if (q && Math.hypot(ax - q.ax, az - q.az) < q.r * SKYLIGHT.flare + 8) return { ax: q.ax, az: q.az, r: q.r * SKYLIGHT.flare, world: CAVERN };
    }
    return null;
  }

  // --- the track ----------------------------------------------------------------

  // The track of the 500 m of road k, or null; undefined where the road is not
  // laid yet. { pts: [ax, y, az, lean, ...] (the middle of the track and how the
  // ground leans across it, to the road's left, a piece every TRACK.unit
  // metres), side, s (along the road), n (pieces), cart: the piece a cart
  // stands on (-1: none) }.
  track(k) {
    if (this.tracks.has(k)) return this.tracks.get(k);
    const T = TRACK;
    const road = this.road;
    const len = T.length[0] + (T.length[1] - T.length[0]) * hash3(k, 21, this.seed);
    const n = Math.round(len / T.unit);
    const from = (k + 0.04) * T.every + 0.5 * T.every * hash3(k, 22, this.seed);
    if (!road.at(from - 8) || !road.at(from + T.look + 8)) return undefined;
    // (None where neither of the worlds is the cavern.)
    if (!this._worldHas(from + T.look / 2)) {
      this.tracks.set(k, null);
      return null;
    }
    const first = hash3(k, 23, this.seed) < 0.5 ? -1 : 1;
    let found = null;
    for (let w = 0; w < 2 && !found; w++) {
      const side = w === 0 ? first : -first;
      // The ground along the look, every four metres: the longest run of it that is fit.
      const step = 2 * T.unit;
      const m = Math.floor(T.look / step);
      let runFrom = -1;
      let best = [0, 0];
      let prev = null;
      for (let i = 0; i <= m; i++) {
        const g = this._trackAt(from + i * step, side, null);
        const ok = g && Math.abs(g.y - g.level) <= T.apart && (prev === null || Math.abs(g.y - prev) <= T.grade * step);
        if (ok) {
          if (runFrom < 0) runFrom = i;
          if (i - runFrom > best[1] - best[0]) best = [runFrom, i];
        } else runFrom = -1;
        prev = ok ? g.y : null;
      }
      const room = (best[1] - best[0]) * step;
      if (room < T.length[0]) continue;
      const take = Math.min(n * T.unit, room);
      const pieces = Math.floor(take / T.unit);
      const s0 = from + best[0] * step + (room - take) * hash3(k, 27, this.seed);
      const pts = new Float64Array((pieces + 1) * 4);
      let ok = true;
      let last = null;
      for (let i = 0; i <= pieces && ok; i++) {
        const g = this._trackAt(s0 + i * T.unit, side, pts.subarray(i * 4, i * 4 + 4));
        if (!g || Math.abs(g.lean) > T.cross || (last !== null && Math.abs(g.y - last) > T.grade * T.unit)
          || (i % 6 === 0 && !this.mine(pts[i * 4], pts[i * 4 + 2], hash3(k, 24, this.seed)))) ok = false;
        last = g ? g.y : null;
      }
      if (!ok) continue;
      const cart = hash3(k, 25, this.seed) < 0.85 && pieces > 8 ? 4 + Math.floor(hash3(k, 26, this.seed) * (pieces - 8)) : -1;
      found = { pts, side, s: s0, n: pieces, cart };
    }
    this.tracks.set(k, found);
    return found;
  }

  // The middle of the track at s along the road, on side: its ground and the
  // road's level there, and how the ground leans across (rise to the road's
  // left over the gauge). Written to out as [ax, y, az, lean] if it is given.
  _trackAt(s, side, out) {
    const T = TRACK;
    const road = this.road;
    const o = road.origin;
    const p = road.at(s);
    if (!p || p.kind !== GROUND) return null;
    const lat = HALF_FLAT + T.off;
    const sin = Math.sin(p.theta);
    const cos = Math.cos(p.theta);
    const ax = p.x + o.x - sin * lat * side;
    const az = p.z + o.z + cos * lat * side;
    const y = this.corridor.heightAt(ax, az);
    let lean = 0;
    if (out) {
      const g2 = T.gauge / 2;
      lean = (this.corridor.heightAt(ax - sin * g2, az + cos * g2) - this.corridor.heightAt(ax + sin * g2, az - cos * g2)) / T.gauge;
      out[0] = ax;
      out[1] = y;
      out[2] = az;
      out[3] = lean;
    }
    return { y, level: road.surfaceAt(s, lat * side), lean };
  }

  // Let go of the plans of the road far from s (m along the road): a skylight more than 5 km off, a track
  // more than 3 km off.
  prune(s) {
    for (const k of this.skylights.keys()) if (Math.abs((k + 0.5) * SKYLIGHT.every - s) > 5000) this.skylights.delete(k);
    for (const k of this.tracks.keys()) if (Math.abs((k + 0.5) * TRACK.every - s) > 3000) this.tracks.delete(k);
  }

  // Forget the plans of the road that is gone (the road is cut and laid again
  // after a turn), from progress s on.
  forget(s) {
    for (const k of this.skylights.keys()) if ((k + 1) * SKYLIGHT.every > s) this.skylights.delete(k);
    for (const k of this.tracks.keys()) if ((k + 1) * TRACK.every > s) this.tracks.delete(k);
  }
}

// The step of the road's samples, for whoever lays things at one every so many metres.
export { STEP };
