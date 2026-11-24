// Where the coast's own things lie and how its water goes up the beach: the swash of the
// waves, the sailing boats out on the water, the black rocks in the shallows and the low
// stone wall with a white fence that stands where the road runs by the sea. Each is a pure
// function of the land, the road and the seed, so the same place has the same things each
// time the car comes by; nothing here touches three.js.
//
//  - The swash is a height the sea's surface is lifted by near the shore, and so the
//    waterline walks up the beach and back: SWASH.period seconds for the round, a fifth
//    of a round out of step for each SWASH.apart metres along the shore. The same
//    numbers are in the shaders (render/swash.js), which take this file's constants.
//  - A boat sails a slow circle of its own, on water at least 450 m from any land (the
//    loop's near edge) and at most 3 km from it.
//  - A reef is a rock that stands in the shallows (0.25 to 3 m of water), off the road,
//    and comes out of the water; foam lies round it.
//  - The wall stands 0.55 m outside the verge wherever water is within 15 m of the
//    verge's outer edge, for at least 12 m of road; the fence on it has a post each 2 m.
//
// A thing belongs to the coast by its own draw across a border (as the trees and the things
// on the ground do), so each of them thins out as the next world comes in.

import { WORLD_INDEX } from './worlds.js';
import { HALF_FLAT, GROUND } from './road.js';
import { hash2 } from './noise.js';

export const COAST = WORLD_INDEX.coast;
const TAU = Math.PI * 2;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mod = (a, n) => a - n * Math.floor(a / n);

// --- the swash -------------------------------------------------------------------

// period: seconds from one run up the beach to the next; apart, step: the swash a point
// metres along the shore has is `step` of a round behind the one `apart` metres before it
// (so a round is `along` = apart / step metres long); dry: seconds the sand takes to dry
// after the water has left it. How high the sea is lifted at the most, and as far under the still
// level, is the world's own number (`liquid.swash` in worlds.js, in metres).
export const SWASH = { period: 8, apart: 30, step: 0.2, dry: 6 };
SWASH.along = SWASH.apart / SWASH.step;

// How far a point is along the way the worlds run (m), which is how the swash is put out of
// step along the shore (the shore runs the way the road does).
export const alongOf = (map, ax, az) => (ax - map.ox) * map.dx + (az - map.oz) * map.dz;

// The phase of the swash at a point `along` m along the shore, at clock t (s): radians, 0 to 2 pi.
export function swashPhase(t, along) {
  const f = t / SWASH.period + along / SWASH.along;
  return (f - Math.floor(f)) * TAU;
}

// How high the water is lifted there (m), for a swash `amp` m high either way.
export const swashLift = (amp, t, along) => amp * Math.sin(swashPhase(t, along));

// How wet the ground is, `alt` m over the still water level: 1 while the swash is over it, then
// less as it dries, to 0 after SWASH.dry seconds and for ground the swash never comes to.
export function swashWet(alt, amp, t, along) {
  const u = alt / amp;
  if (u >= 1) return 0;
  if (u <= -1) return 1;
  const th = swashPhase(t, along);
  // The water is over it while sin(th) is over u: th from a to pi - a.
  const a = Math.asin(u);
  if (mod(th - a, TAU) < Math.PI - 2 * a) return 1;
  const since = (mod(th - (Math.PI - a), TAU) * SWASH.period) / TAU;
  return 1 - smooth(0, SWASH.dry, since);
}

// --- boats ------------------------------------------------------------------------

// cell: metres on a side of the cells a boat is looked for in (one try to a cell, and the
// try is kept with chance `chance`); range: how far from the lens boats are laid; max: the
// most that are drawn at the high tier (half of them at the middle one); near, far: how far
// from land the circle's middle is at least (counted from the circle's near edge) and at
// most (to its far edge); loop: the radius of the circle it sails, from least to most (m);
// speed: how fast, from least to most (m/s); deep: the least water under it (m); length: the
// hull's length, from least to most (m); rock: how it rocks on the swell (m, rad, rad, s of a
// round) and how long a swell is (m).
export const BOATS = {
  cell: 300, chance: 0.85, range: 4200, max: 12, near: 450, far: 3000, loop: [30, 70], speed: [0.35, 0.8],
  deep: 8, length: [7, 11], rock: { heave: 0.28, roll: 0.07, pitch: 0.04, period: 6.5, wave: 70 },
};

// --- gulls ------------------------------------------------------------------------

// The first call of a gull is `first` s after the lens comes into the coast, and then one every `apart[0]` to `apart[1]`
// s, each gap by a draw of its own.
export const GULL = { first: 3.5, apart: [5, 15] };

// The seconds from call n - 1 to call n of a run (n from 1) on the coast of seed.
export function gullGap(n, seed) {
  return GULL.apart[0] + (GULL.apart[1] - GULL.apart[0]) * hash2(n, 0x6c01, seed | 0);
}

// --- reefs ------------------------------------------------------------------------

// block: metres on a side of the blocks of sea a reef is looked for in; lattice: the spacing
// of the tries (one in each square, put somewhere in it); depth: the water the rock stands in,
// least and most (m); rise: how high it comes out of the water (m), r: its radius where it
// stands (m); patch: the width of the patches the rocks gather in (m), and how few lie outside
// them (a share of the chance a try has inside one); chance: the chance a try has where the rocks
// are thickest; margin: how far off the road's verge the foot of it stays (m); foam: the radius of
// the foam round it, in the rock's own radii; range: how far from the lens they are drawn; max: how
// many (at the high tier).
export const REEF = {
  block: 96, lattice: 12, depth: [0.25, 3], rise: [0.5, 1.7], r: [0.8, 2.1], patch: 170, thin: 0.1, chance: 0.45,
  margin: 3, foam: 1.9, range: 520, max: 96,
};

// --- the wall -----------------------------------------------------------------------

// every: metres from one post of the fence to the next (and the length of a piece of wall);
// off: metres from the verge to the middle of the wall; reach: how far outside the verge
// water has to be for a wall to stand there; min: how many stations in a row of the road
// (7: 12 m) have water near for a wall to stand at them; above: how high over the water the
// wall's foot stands at the least; block: metres of road a plan block covers; range: how far
// from the lens it is drawn; height: the stone's height; thick: its thickness; post: the
// fence's height above the stone.
export const WALL = { every: 2, off: 0.55, reach: 15, min: 7, above: 0.3, block: 100, range: 450, height: 0.62, thick: 0.5, post: 1.0 };

export class CoastPlan {
  // land, road, corridor, worlds as the game has them (absolute coordinates).
  constructor({ land, road, corridor, worlds, seed }) {
    this.land = land;
    this.road = road;
    this.corridor = corridor;
    this.worlds = worlds;
    this.seed = seed | 0;
    this._w = { a: 0, b: 0, t: 0, u: 0 };
    this.boats = new Map();
    this.reefs = new Map();
    this.walls = new Map();
  }

  // Whether a thing at an absolute point, which has its own draw u (0 to 1), is the coast's:
  // the world it belongs to is the first of the two there where the draw is over the blend,
  // the second where it is under.
  mine(ax, az, u) {
    const w = this.worlds.at(ax, az, this._w);
    return (u < w.t ? w.b : w.a) === COAST;
  }

  // How much of the world at a point is the coast's (0 to 1).
  share(ax, az) {
    const w = this.worlds.at(ax, az, this._w);
    return (w.a === COAST ? 1 - w.t : 0) + (w.b === COAST && w.a !== w.b ? w.t : 0);
  }

  // The road near an absolute point: how far its centre line is, and whether any is laid within r.
  roadNear(ax, az, r) {
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
    return { dist, any: dist < Infinity };
  }

  // The ground as drawn at a point: the land's, and the road's shaping of it where the road is near.
  ground(ax, az) {
    return this.corridor.heightAt(ax, az);
  }

  // --- boats --------------------------------------------------------------------------

  // How far the nearest land is from a point of the sea (m), up to `limit` (Infinity if none is found): within 600 m on rings 30 m
  // apart with ninety points round each, so that a spit of land a few tens of metres across is found; farther out on rings 120 m
  // apart with thirty-six. Land is where the coarse land stands over the water.
  shoreDistance(ax, az, limit = BOATS.far + 400) {
    const h = this.land.heightAtCoarse;
    const ring = (r, n) => {
      const a0 = r * 0.37;
      for (let k = 0; k < n; k++) {
        const a = a0 + (k / n) * TAU;
        if (h(ax + r * Math.cos(a), az + r * Math.sin(a)) > -0.5) return true;
      }
      return false;
    };
    for (let r = 30; r <= Math.min(limit, 600); r += 30) if (ring(r, 90)) return r;
    for (let r = 720; r <= limit; r += 120) if (ring(r, 36)) return r;
    return Infinity;
  }

  // The boat of the cell (cx, cz), or null: { cx, cz (the middle of its circle, absolute), r
  // (the circle's radius), a0 (where it is on it at clock 0, rad), dir (1, or -1 the other way
  // round), rate (rad/s), length, shore (how far the circle's middle is from land), key }.
  boat(cx, cz) {
    const key = cx * 100003 + cz;
    if (this.boats.has(key)) return this.boats.get(key);
    const B = BOATS;
    const s = this.seed;
    let found = null;
    if (hash2(cx, cz, s ^ 0x6b01) < B.chance) {
      // (Its circle's middle is in the middle half of the cell, so that the circles of two boats do not meet.)
      const ax = (cx + 0.25 + 0.5 * hash2(cx, cz, s ^ 0x6b02)) * B.cell;
      const az = (cz + 0.25 + 0.5 * hash2(cx, cz, s ^ 0x6b03)) * B.cell;
      const r = B.loop[0] + (B.loop[1] - B.loop[0]) * hash2(cx, cz, s ^ 0x6b04);
      // (None where the coast is not the world: a boat is of the coast by its own draw.)
      if (this.mine(ax, az, hash2(cx, cz, s ^ 0x6b05)) && this.land.heightAtCoarse(ax, az) < -B.deep) {
        const shore = this.shoreDistance(ax, az);
        if (shore - r >= B.near && shore + r <= B.far) {
          // The circle is all sea: eight points of it as deep as a boat needs.
          let ok = true;
          for (let k = 0; k < 8 && ok; k++) {
            const a = (k / 8) * TAU;
            ok = this.land.heightAtCoarse(ax + r * Math.cos(a), az + r * Math.sin(a)) < -B.deep;
          }
          if (ok) {
            const speed = B.speed[0] + (B.speed[1] - B.speed[0]) * hash2(cx, cz, s ^ 0x6b06);
            found = {
              cx: ax, cz: az, r, a0: hash2(cx, cz, s ^ 0x6b07) * TAU, dir: hash2(cx, cz, s ^ 0x6b08) < 0.5 ? -1 : 1,
              rate: speed / r, length: B.length[0] + (B.length[1] - B.length[0]) * hash2(cx, cz, s ^ 0x6b09), shore, key,
            };
          }
        }
      }
    }
    this.boats.set(key, found);
    return found;
  }

  // The boats within `range` m of an absolute point, the nearest first (at most `max`). A cell not worked out yet takes about a
  // millisecond: `budget` of them are worked out (the nearest cells first), and the list has `.incomplete` when there were more.
  boatsNear(ax, az, range = BOATS.range, max = BOATS.max, budget = Infinity) {
    const c = BOATS.cell;
    const out = [];
    const todo = [];
    for (let cx = Math.floor((ax - range) / c); cx <= Math.floor((ax + range) / c); cx++) {
      for (let cz = Math.floor((az - range) / c); cz <= Math.floor((az + range) / c); cz++) {
        if (this.boats.has(cx * 100003 + cz)) {
          const b = this.boats.get(cx * 100003 + cz);
          if (b) {
            const d = Math.hypot(b.cx - ax, b.cz - az);
            if (d - b.r <= range) out.push({ b, d });
          }
        } else todo.push([Math.hypot((cx + 0.5) * c - ax, (cz + 0.5) * c - az), cx, cz]);
      }
    }
    todo.sort((p, q) => p[0] - q[0]);
    let left = budget;
    let incomplete = false;
    for (const [, cx, cz] of todo) {
      if (left-- <= 0) {
        incomplete = true;
        break;
      }
      const b = this.boat(cx, cz);
      if (!b) continue;
      const d = Math.hypot(b.cx - ax, b.cz - az);
      if (d - b.r <= range) out.push({ b, d });
    }
    out.sort((p, q) => p.d - q.d || p.b.key - q.b.key);
    const list = out.slice(0, max).map((e) => e.b);
    list.incomplete = incomplete;
    return list;
  }

  // The reefs of the block of sea (bx, bz), REEF.block metres on a side, as the land is drawn:
  // [] where there are none; undefined where no road is laid yet (it is looked for again later).
  // A reef is { ax, az, y (the sea floor under it), depth, top (how high over the water it comes),
  // r (its radius at the water), yaw, lump (a draw for its shape), key }.
  reefsIn(bx, bz) {
    const R = REEF;
    const key = bx * 100003 + bz;
    if (this.reefs.has(key)) return this.reefs.get(key);
    const x0 = bx * R.block;
    const z0 = bz * R.block;
    const cx = x0 + R.block / 2;
    const cz = z0 + R.block / 2;
    if (this.share(cx, cz) < 0.05) {
      this.reefs.set(key, []);
      return [];
    }
    const near0 = this.roadNear(cx, cz, 400);
    if (!near0.any) return undefined;
    const n = Math.round(R.block / R.lattice);
    const out = [];
    const s = this.seed;
    const h = this.land.heightAt;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const ai = Math.round(x0 / R.lattice) + i;
        const aj = Math.round(z0 / R.lattice) + j;
        const x = (ai + hash2(ai, aj, s ^ 0x7e01)) * R.lattice;
        const z = (aj + hash2(ai, aj, s ^ 0x7e02)) * R.lattice;
        // (Cheap first: the water's depth by the land as it is, and the road's shaping where it is near.)
        let y = h(x, z);
        if (!(y < -R.depth[0] + 0.1 && y > -R.depth[1] - 0.3)) continue;
        // Reefs gather in patches, thin elsewhere.
        const gather = R.thin + (1 - R.thin) * smooth(0.15, 0.55, patchNoise(x / R.patch, z / R.patch, s));
        if (hash2(ai, aj, s ^ 0x7e03) > gather * REEF.chance) continue;
        const near = this.roadNear(x, z, 80);
        if (near.dist < HALF_FLAT + R.margin + R.r[1]) continue;
        if (near.dist < 70) y = this.ground(x, z);
        const depth = -y;
        if (depth < R.depth[0] || depth > R.depth[1]) continue;
        if (!this.mine(x, z, hash2(ai, aj, s ^ 0x7e04))) continue;
        const lump = hash2(ai, aj, s ^ 0x7e05);
        const top = R.rise[0] + (R.rise[1] - R.rise[0]) * hash2(ai, aj, s ^ 0x7e06) ** 1.4;
        const r = R.r[0] + (R.r[1] - R.r[0]) * hash2(ai, aj, s ^ 0x7e07) ** 1.3;
        // A reef comes out of the water: it is as high as the water is deep, and the top besides; as wide as it is tall, about.
        out.push({
          ax: x, az: z, y, depth, top, r: Math.max(r, 0.45 * (depth + top)), yaw: hash2(ai, aj, s ^ 0x7e08) * TAU, lump,
          key: ai * 100003 + aj,
        });
      }
    }
    this.reefs.set(key, out);
    return out;
  }

  // A station of the wall: where the middle of it stands at `n` stations (WALL.every m) along the
  // road, on the side (1: the road's left, -1: its right): { ax, az, y (the ground there), ok
  // (water is within WALL.reach of the verge there, and the foot of the wall is over it) }, null
  // where the road is not on the ground there, undefined where it is not laid yet.
  wallStation(n, side) {
    const W = WALL;
    const road = this.road;
    const o = road.origin;
    const p = road.at(n * W.every);
    if (!p) return undefined;
    if (p.kind !== GROUND) return null;
    const sin = Math.sin(p.theta);
    const cos = Math.cos(p.theta);
    const at = (lat) => [p.x + o.x - sin * lat * side, p.z + o.z + cos * lat * side];
    const [ax, az] = at(HALF_FLAT + W.off);
    if (!this.mine(ax, az, hash2(n >> 3, side, this.seed ^ 0x3a01))) return null;
    const level = this.land.waterLevel(ax, az);
    if (level === -Infinity) return { ax, az, y: this.ground(ax, az), ok: false };
    const y = this.ground(ax, az);
    let wet = false;
    for (let d = 1; d <= W.reach && !wet; d += 2) {
      const [qx, qz] = at(HALF_FLAT + d);
      // (The land as it was made says first; the shaped ground only where that is near the water.)
      if (this.land.heightAt(qx, qz) < level + 0.6 && this.ground(qx, qz) < level - 0.05) wet = true;
    }
    return { ax, az, y, ok: wet && y > level + W.above };
  }

  // The pieces of wall of the block k of road (WALL.block metres of it from k * WALL.block) on a
  // side, as runs: [{ side, pts: [ax, y, az, ...] }], the stations of each run in order, a piece
  // of wall from each to the next. A station has a wall if water is near it and near WALL.min
  // stations in a row of the road that it is one of (a run of the wall is as long as that, or
  // is the end of one that goes on into the next block); [] where the road has none; undefined
  // where it is not laid yet.
  wallRuns(k) {
    if (this.walls.has(k)) return this.walls.get(k);
    const W = WALL;
    const per = Math.round(W.block / W.every);
    const n0 = k * per;
    const runs = [];
    const at = (n, side) => this.wallStation(n, side);
    let laid = true;
    const keep = (list) => {
      this.walls.set(k, list);
      return list;
    };
    // Cheap first: is any water within reach of the road in this block at all (coarse land, every 10 m)?
    let any = false;
    for (let n = n0 - W.min; n <= n0 + per + W.min && !any; n += 5) {
      const p = this.road.at(n * W.every);
      if (!p) {
        laid = false;
        break;
      }
      const o = this.road.origin;
      for (const side of [-1, 1]) {
        for (const d of [HALF_FLAT + 4, HALF_FLAT + 12, HALF_FLAT + 20]) {
          const qx = p.x + o.x - Math.sin(p.theta) * d * side;
          const qz = p.z + o.z + Math.cos(p.theta) * d * side;
          if (this.land.heightAtCoarse(qx, qz) < 1.5 && this.share(qx, qz) > 0.05) any = true;
        }
      }
    }
    if (!laid) return undefined;
    if (!any) return keep(runs);
    for (const side of [-1, 1]) {
      // The stations of the block and WALL.min either way, whether the water is near each.
      const st = [];
      for (let n = n0 - W.min; n <= n0 + per + W.min; n++) {
        const q = at(n, side);
        if (q === undefined) return undefined;
        st.push(q);
      }
      // How many stations in a row each is one of (a row that reaches the end of what is worked out counts as long enough).
      const row = new Array(st.length).fill(0);
      for (let a = 0; a < st.length;) {
        if (!st[a] || !st[a].ok) {
          a++;
          continue;
        }
        let b = a;
        while (b + 1 < st.length && st[b + 1] && st[b + 1].ok) b++;
        const len = a === 0 || b === st.length - 1 ? W.min : b - a + 1;
        for (let i = a; i <= b; i++) row[i] = len;
        a = b + 1;
      }
      let run = null;
      for (let n = n0; n <= n0 + per; n++) {
        const i = n - n0 + W.min;
        if (row[i] >= W.min) {
          if (!run) {
            run = { side, pts: [], from: n };
            runs.push(run);
          }
          run.pts.push(st[i].ax, st[i].y, st[i].az);
        } else run = null;
      }
    }
    // (A run of one station is no wall: a piece needs two.)
    return keep(runs.filter((r) => r.pts.length >= 6));
  }

  // Let go of what is far from `ax, az` (absolute) and from the road at s: the plans kept for
  // things that are no longer near.
  prune(sCar) {
    for (const k of this.walls.keys()) if (Math.abs((k + 0.5) * WALL.block - sCar) > 4000) this.walls.delete(k);
    if (this.boats.size > 400) this.boats.clear();
    if (this.reefs.size > 600) this.reefs.clear();
  }

  // Forget what was worked out for the road that is gone (the road is cut and laid again after a turn, and the worlds beyond the cut are
  // others): the walls from s on, and the boats and the reefs, which belong to the world at their place.
  forget(s) {
    for (const k of this.walls.keys()) if ((k + 1) * WALL.block > s) this.walls.delete(k);
    this.boats.clear();
    this.reefs.clear();
  }
}

// Where a boat is at clock t (s), and which way it points (rad, from +x round to +z): written to out.
export function boatAt(b, t, out = {}) {
  const a = b.a0 + b.dir * b.rate * t;
  out.x = b.cx + b.r * Math.cos(a);
  out.z = b.cz + b.r * Math.sin(a);
  out.yaw = Math.atan2(b.dir * Math.cos(a), -b.dir * Math.sin(a));
  return out;
}

// How the swell rocks a boat out at sea at clock t, at the absolute point (x, z): the heave
// (m), the roll and the pitch (rad), by a swell BOATS.rock.wave metres long that runs along +x
// and a little across, each boat a phase of its own by where it is.
export function boatRock(x, z, t, out = {}) {
  const R = BOATS.rock;
  const k = TAU / R.wave;
  const ph = k * (x * 0.94 + z * 0.34) - (TAU * t) / R.period;
  out.heave = R.heave * Math.sin(ph) + 0.35 * R.heave * Math.sin(2.3 * ph + 1.3);
  out.roll = R.roll * Math.cos(ph + 0.7);
  out.pitch = R.pitch * Math.sin(ph + 2.1);
  return out;
}

// A smooth noise of two numbers, 0 to 1 (a lattice of draws, eased between).
function patchNoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed ^ 0x7e10);
  const b = hash2(ix + 1, iz, seed ^ 0x7e10);
  const c = hash2(ix, iz + 1, seed ^ 0x7e10);
  const d = hash2(ix + 1, iz + 1, seed ^ 0x7e10);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
