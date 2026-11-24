// Where the hills' own things by the road are: the dry-stone walls along its verge, the
// line of poles beside it with its wires, and the farm tracks that leave it for the
// fields. (The fields are world/fields.js.) Each is a pure function of the land, the
// road and the seed, so the same place has the same things each time the car comes by;
// nothing here touches three.js.
//
//  - A wall is a run of pieces 6 m long, 1.1 m high and half a metre thick, two metres
//    outside the verge, on the side of the road a run (240 m of it) draws; about two runs
//    in five have one. A piece stands only where the road is on the ground and the ground by
//    it is as the land made it (no cut, no fill) and level enough.
//  - A pole is 8 m of wood, every 45 m along one side of the road, three wires hung from
//    it. The side is drawn for a run of 900 m of road, and where it changes the wires cross
//    the road. No pole stands on a bridge, in a tunnel or in or by a bend tighter than 60 m.
//  - A farm track leaves the verge into the fields, once in 600 m of road, 80 to 200 m
//    long, and ends in the grass.
//
// A thing belongs to the hills by its own draw across a border (as the trees and the
// things on the ground do), so each of them thins out as the next world comes in.

import { WORLD_INDEX } from './worlds.js';
import { HALF_FLAT, GROUND, STEP } from './road.js';

export const HILLS = WORLD_INDEX.hills;

function hash3(a, b, c) {
  let h = (Math.imul(a | 0, 0x8da6b343) ^ Math.imul(b | 0, 0xd8163841) ^ Math.imul(c | 0, 0x2545f491)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// unit: the length of a piece (m); height, thick: of a wall; off: its middle's distance outside the
// verge (m); run: the metres of road a run is, share: the share of runs that have a wall, edge: how
// far in from the ends of a run the wall starts and ends, at the most (m); chunk: the metres of road
// worked out at a time; grade, across, level: the steepest a piece may lie along itself (rise over run), the
// most the ground may rise or fall over the metre across it (m: the face of a cut is steeper than a fill), and how
// far the ground at its middle may be from the road's own level (m); solid: the radius of the circles a car runs into, one
// every `ring` metres; range: how far off it is drawn (m).
export const WALL = {
  unit: 6, height: 1.1, thick: 0.5, off: 2, run: 240, share: 0.46, edge: 36, chunk: 60,
  grade: 0.25, across: 0.7, level: 1.4, solid: 0.55, ring: 1.5, range: 340,
};

// every: the metres between poles along the line; height: of a pole; off: how far outside the verge it stands;
// run: the metres of road that have a side; part: how many poles of the line are the hills' in one draw (the line
// is the hills' or not in pieces of that many); tight: the radius (m) of a bend that has no pole in it; sag: how far the
// wires hang at the middle of a span of `every` m; wires: where each is hung on the pole, [across, up] (m); arm: the
// cross-arm's height; range: how far off it is drawn (m); solid: the radius of a pole as a car runs into it (m);
// reach: the shortest and the longest span that has wires (m).
export const POLE = {
  every: 45, height: 8, off: 1.3, run: 900, part: 8, tight: 60, sag: 0.6, arm: 7.3,
  wires: [[0, 8.05], [-0.95, 7.45], [0.95, 7.45]], range: 500, solid: 0.22, reach: [25, 62],
};

// every: the metres of road to a farm track's cell; length: from the least to the most (m); width: of the dirt
// (m); points: how many it is laid in; bend: how much a piece may turn from the one before (rad); apart: how
// far in from the cell's ends the track leaves it (m); slope: the steepest the ground it crosses may be (1 - the
// normal's y).
export const TRACK = { every: 600, length: [80, 200], width: 2.4, points: 4, bend: 0.5, apart: 120, slope: 0.1, share: 0.9 };

// The wires' catenary: the metres a wire hangs below the line between its ends, at x m from the middle of a span
// of `span` m, for a sag of `sag` m at the middle.
export function hang(x, span, sag) {
  const h = span / 2;
  let c = (span * span) / (8 * sag);
  for (let i = 0; i < 3; i++) {
    const f = c * (Math.cosh(h / c) - 1) - sag;
    const df = Math.cosh(h / c) - 1 - (h / c) * Math.sinh(h / c);
    c -= f / df;
  }
  return c * (Math.cosh(h / c) - Math.cosh(x / c));
}

export class HillsPlan {
  // env: land, road, corridor, worlds, seed; wood(ax, az, h): the density of the trees there (world/vegetation.js).
  constructor(env) {
    this.land = env.land;
    this.road = env.road;
    this.corridor = env.corridor;
    this.worlds = env.worlds;
    this.seed = env.seed | 0;
    this.wood = env.wood || null;
    this._w = { a: 0, b: 0, t: 0, u: 0 };
    this.chunks = new Map();
    this.runs = new Map();
    this.tracksOf = new Map();
  }

  // Whether a thing at an absolute point, which has its own draw u (0 to 1), is the hills': the world it
  // belongs to is the first of the two there where the draw is over the blend, the second where it is under.
  mine(ax, az, u) {
    const w = this.worlds.at(ax, az, this._w);
    return (u < w.t ? w.b : w.a) === HILLS;
  }

  // The point at a lateral offset of the road's place p (local coordinates to absolute), into out [x, z].
  _at(p, lat, out) {
    const o = this.road.origin;
    out[0] = p.x + o.x - Math.sin(p.theta) * lat;
    out[1] = p.z + o.z + Math.cos(p.theta) * lat;
    return out;
  }

  // --- the walls ----------------------------------------------------------------

  // The wall of the run `run`, if it has one: { side, from, to } (metres along the road), or null.
  wallRun(run) {
    const W = WALL;
    if (hash3(run, 1, this.seed) >= W.share) return null;
    return {
      side: hash3(run, 2, this.seed) < 0.5 ? -1 : 1,
      from: run * W.run + hash3(run, 3, this.seed) * W.edge,
      to: (run + 1) * W.run - hash3(run, 4, this.seed) * W.edge,
    };
  }

  // The pieces of wall of the 60 m of road k (from k * 60), each { i, s (its middle), side, ax, az (its middle,
  // absolute), x0, z0, y0, x1, z1, y1 (its ends, absolute, the ground's height at them), yaw, seed }; [] where there are
  // none; undefined where the road is not laid yet (it is worked out again later).
  walls(k) {
    if (this.chunks.has(k)) return this.chunks.get(k);
    const W = WALL;
    const per = Math.round(W.chunk / W.unit);
    const s0 = k * W.chunk;
    if (!this.road.at(s0 - 2) || !this.road.at(s0 + W.chunk + 2)) return undefined;
    // (Where a farm track leaves the road is known first: no wall stands across its mouth.)
    for (let t = Math.floor((s0 - W.unit) / TRACK.every); t <= Math.floor((s0 + W.chunk + W.unit) / TRACK.every); t++) {
      if (this.track(t) === undefined) return undefined;
    }
    const out = [];
    const a = [0, 0];
    const b = [0, 0];
    const m = [0, 0];
    const road = this.road;
    const lat = (HALF_FLAT + W.off);
    for (let n = 0; n < per; n++) {
      const i = k * per + n;
      const s = (i + 0.5) * W.unit;
      const run = this.wallRun(Math.floor(s / W.run));
      if (!run || s - W.unit / 2 < run.from || s + W.unit / 2 > run.to) continue;
      const p0 = road.at(s - W.unit / 2);
      const p1 = road.at(s + W.unit / 2);
      const pm = road.at(s);
      if (!p0 || !p1 || !pm || p0.kind !== GROUND || p1.kind !== GROUND || pm.kind !== GROUND) continue;
      const side = run.side;
      if (this._atTrack(s, side)) continue;
      this._at(p0, lat * side, a);
      this._at(p1, lat * side, b);
      this._at(pm, lat * side, m);
      if (!this.mine(m[0], m[1], hash3(i, 5, this.seed))) continue;
      const hy0 = this.corridor.heightAt(a[0], a[1]);
      const hy1 = this.corridor.heightAt(b[0], b[1]);
      const hym = this.corridor.heightAt(m[0], m[1]);
      // The ground is level along the piece, near the road's own height, and does not fall away or climb across it as
      // the face of a cut does.
      if (Math.abs(hy1 - hy0) > W.grade * W.unit) continue;
      if (Math.abs(hym - (road.surfaceAt(s, lat * side) - 0.3)) > W.level) continue;
      const cx = Math.cos(pm.theta) * 0 - Math.sin(pm.theta) * 0.5;
      const cz = Math.cos(pm.theta) * 0.5;
      if (Math.abs(this.corridor.heightAt(m[0] + cx, m[1] + cz) - this.corridor.heightAt(m[0] - cx, m[1] - cz)) > W.across) continue;
      out.push({
        i, s, side, ax: m[0], az: m[1], x0: a[0], z0: a[1], y0: hy0, x1: b[0], z1: b[1], y1: hy1,
        yaw: Math.atan2(b[0] - a[0], b[1] - a[1]), seed: hash3(i, 6, this.seed),
      });
    }
    this.chunks.set(k, out);
    return out;
  }

  // Whether a farm track leaves the road by s on a side: the wall leaves a gap at its mouth.
  _atTrack(s, side) {
    for (let k = Math.floor((s - 12) / TRACK.every); k <= Math.floor((s + 12) / TRACK.every); k++) {
      const t = this.track(k);
      if (t && t.side === side && Math.abs(t.s - s) < WALL.unit * 1.5 + TRACK.width) return true;
    }
    return false;
  }

  // The circles of a piece of wall that a car runs into, [x, z, radius, ...] added to out.
  ring(seg, out) {
    const W = WALL;
    const n = Math.round(W.unit / W.ring);
    for (let q = 0; q < n; q++) {
      const t = (q + 0.5) / n;
      out.push(seg.x0 + (seg.x1 - seg.x0) * t, seg.z0 + (seg.z1 - seg.z0) * t, W.solid);
    }
    return out;
  }

  // --- the poles ----------------------------------------------------------------

  // The poles of the run `run` of the road (POLE.run m of it from run * POLE.run): [{ s, side, ax, az, y,
  // yaw, run }] in order along the road, as far as the hills have the line. The run's line is laid to stand
  // `every` m apart as the line itself goes (along the offset of the poles, not the road's middle), so on a bend
  // it is `every` m between them there too. [] where there are none; undefined where the road is not laid yet.
  poleRun(run) {
    if (this.runs.has(run)) return this.runs.get(run);
    const P = POLE;
    const s0 = run * P.run;
    const road = this.road;
    if (!road.at(s0 - 2) || !road.at(s0 + P.run + 2)) return undefined;
    const side = hash3(run, 21, this.seed) < 0.5 ? -1 : 1;
    const lat = (HALF_FLAT + P.off) * side;
    // The line along the run, a point every 2 m of road, and its length.
    const n = Math.round(P.run / STEP);
    const px = new Float64Array(n + 1);
    const pz = new Float64Array(n + 1);
    const acc = new Float64Array(n + 1);
    const at = [0, 0];
    for (let i = 0; i <= n; i++) {
      const p = road.at(s0 + i * STEP);
      this._at(p, lat, at);
      px[i] = at[0];
      pz[i] = at[1];
      acc[i] = i === 0 ? 0 : acc[i - 1] + Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]);
    }
    const total = acc[n];
    const count = Math.max(1, Math.round(total / P.every));
    const gap = total / count;
    const list = [];
    let j = 0;
    for (let q = 0; q < count; q++) {
      const want = (q + 0.5) * gap;
      while (j < n - 1 && acc[j + 1] < want) j++;
      const f = (want - acc[j]) / Math.max(acc[j + 1] - acc[j], 1e-6);
      const s = s0 + (j + f) * STEP;
      const p = road.at(s);
      if (!p) continue;
      // Not on a bridge or in a tunnel, nor beside the end of one, nor within a bend tighter than `tight` or near one.
      let clear = p.kind === GROUND;
      for (let d = -P.every; d <= P.every && clear; d += 9) {
        const q = road.at(s + d);
        if (!q || q.kind !== GROUND || Math.abs(q.kappa) > 1 / P.tight) clear = false;
      }
      if (!clear) continue;
      const ax = px[j] + (px[j + 1] - px[j]) * f;
      const az = pz[j] + (pz[j + 1] - pz[j]) * f;
      if (!this.mine(ax, az, hash3(run * 64 + Math.floor(q / P.part), 22, this.seed))) continue;
      list.push({ s, side, ax, az, y: this.corridor.heightAt(ax, az), yaw: Math.PI / 2 - p.theta, run, q });
    }
    this.runs.set(run, list);
    return list;
  }

  // --- the farm tracks ------------------------------------------------------------

  // The farm track of the 600 m of road k, or null; undefined where the road is not laid yet. { s, side, n (points),
  // pts: [x, z] absolute a pair to a point, from the verge out, len (m) }. Four places are tried, the cell's own
  // first, for ground it can leave the road on and cross.
  track(k) {
    if (this.tracksOf.has(k)) return this.tracksOf.get(k);
    const T = TRACK;
    const road = this.road;
    const from = k * T.every + T.apart;
    if (!road.at(from - 20) || !road.at(from + T.every - 2 * T.apart + 20)) return undefined;
    let found = null;
    if (hash3(k, 33, this.seed) < T.share) {
      const room = T.every - 2 * T.apart;
      const first = hash3(k, 31, this.seed);
      for (let n = 0; n < 4 && !found; n++) {
        found = this._trackFrom(k, from + ((first + n / 4) % 1) * room, n);
      }
    }
    this.tracksOf.set(k, found);
    return found;
  }

  // The track that leaves the road at s, or null; n is the try it is.
  _trackFrom(k, s, n) {
    const T = TRACK;
    const road = this.road;
    const p = road.at(s);
    const side = hash3(k, 32 + n * 16, this.seed) < 0.5 ? -1 : 1;
    const mouth = this._at(p, HALF_FLAT * side, [0, 0]);
    if (!this.mine(mouth[0], mouth[1], hash3(k, 34, this.seed)) || ![-12, 0, 12].every((d) => { const q = road.at(s + d); return q && q.kind === GROUND; })) return null;
    // Out from the road (its normal, to the side the track leaves it on), a little off square, in pieces that
    // turn a little from one another.
    const nx = -Math.sin(p.theta) * side;
    const nz = Math.cos(p.theta) * side;
    let heading = Math.atan2(nz, nx) + (hash3(k, 35 + n * 16, this.seed) - 0.5) * 0.9;
    const len = T.length[0] + (T.length[1] - T.length[0]) * hash3(k, 36 + n * 16, this.seed);
    const pts = [mouth[0], mouth[1]];
    let good = 1;
    let x = mouth[0];
    let z = mouth[1];
    const step = len / (T.points - 1);
    for (let i = 1; i < T.points; i++) {
      heading += (hash3(k, 40 + i + n * 16, this.seed) - 0.5) * T.bend;
      x += Math.cos(heading) * step;
      z += Math.sin(heading) * step;
      if (!this._tracked(x, z)) break;
      pts.push(x, z);
      good++;
    }
    if (good < 3) return null;
    while (pts.length < T.points * 2) pts.push(pts[pts.length - 2], pts[pts.length - 1]);
    let l = 0;
    for (let i = 1; i < good; i++) l += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    return { s, side, n: good, pts, len: l, k };
  }

  // Whether a track may run over the ground at an absolute point: level and clear of the trees.
  _tracked(ax, az) {
    const h = (x, z) => this.land.heightAt(x, z);
    const gx = (h(ax + 2, az) - h(ax - 2, az)) / 4;
    const gz = (h(ax, az + 2) - h(ax, az - 2)) / 4;
    const slope = 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz);
    if (slope > TRACK.slope) return false;
    const y = this.corridor.heightAt(ax, az);
    return !this.wood || this.wood(ax, az, y, slope) < 0.1;
  }

  // --- keeping ------------------------------------------------------------------

  // Let go of what is far behind the car (s along the road).
  prune(s) {
    for (const k of this.chunks.keys()) if (Math.abs((k + 0.5) * WALL.chunk - s) > 3000) this.chunks.delete(k);
    for (const k of this.runs.keys()) if (Math.abs((k + 0.5) * POLE.run - s) > 3600) this.runs.delete(k);
    for (const k of this.tracksOf.keys()) if (Math.abs((k + 0.5) * TRACK.every - s) > 3600) this.tracksOf.delete(k);
  }

  // Forget the plans of the road that is gone (the road is cut and laid again after a turn), from s on.
  forget(s) {
    for (const k of this.chunks.keys()) if ((k + 1) * WALL.chunk > s) this.chunks.delete(k);
    for (const k of this.runs.keys()) if ((k + 1) * POLE.run > s) this.runs.delete(k);
    for (const k of this.tracksOf.keys()) if ((k + 1) * TRACK.every > s) this.tracksOf.delete(k);
  }
}
