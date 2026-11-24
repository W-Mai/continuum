// Where the desert's own small things are: the old billboards by its road and
// the line of telegraph poles beside it, the dust devils walking over its
// flats, and the tumbleweeds the wind rolls across the road. Each is a pure
// function of the land, the road, the seed and the clock, so the same place has
// the same things each time the car comes by; nothing here touches three.js.
//
//  - A billboard stands in every 1.2 km of road, 5 to 9 m outside the verge,
//    on ground the road has not shaped, its face turned to the traffic that
//    comes to it.
//  - The poles stand every 45 m along one side of the road, 9 m outside the
//    verge; the side changes each 2 km, and a pole is left out where the road
//    is not on the ground (a bridge, a cutting) or where the ground is steep.
//  - A dust devil is one to each cell of 2 km² (a square of 1414 m), one after
//    another: each lives 60 to 120 s of a turn of 360 s, starts on level
//    ground (slope under 0.1) and walks down the wind at 3 m/s, all its way on
//    level ground (looked at every 8 m); a cell where no such way is found has
//    none that turn. So within 2 km of a point there are none, one or two at a
//    time, and now and then three.
//  - A tumbleweed comes every 14 to 26 s (20 on average): it starts upwind of
//    the road ahead of the car and rolls across it with the wind, bouncing;
//    when it starts and where it crosses are drawn from its number and the
//    seed, where the road is is the road's.
//
// A thing belongs to the desert by its own draw across a border (as the trees
// do), so each of them thins out as the next world comes in.

import { WORLD_INDEX, WIND } from './worlds.js';
import { HALF_FLAT, GROUND } from './road.js';
import { hash3 } from './cavernplan.js';

export const DESERT = WORLD_INDEX.desert;

// The way the wind blows over the sand (unit, x and z): the dunes stand across it (world/worlds.js).
export const WIND_DIR = [Math.cos(WIND), Math.sin(WIND)];

// How steep the ground is at an absolute point: the length of its gradient,
// over `d` metres either way. h(x, z) is the height of the ground.
export function slopeAt(h, x, z, d = 4) {
  const gx = (h(x + d, z) - h(x - d, z)) / (2 * d);
  const gz = (h(x, z + d) - h(x, z - d)) / (2 * d);
  return Math.hypot(gx, gz);
}

// --- billboards --------------------------------------------------------------------

// every: metres of road to a billboard's cell; spread: how far from the middle of
// the cell it may stand (half either way); off: metres outside the verge, from
// least to most; width, height: the panel's (m); lift: how high its foot is over
// the ground (m); post: the posts' spacing (m); fall: the most the ground may fall
// or rise between its posts (m); turn: how far it is turned from square to the
// road toward the traffic it faces (rad).
export const BOARD = { every: 1200, spread: 500, off: [5, 9], width: 6.4, height: 3.2, lift: 2.6, post: 4.2, fall: 1.2, turn: 0.32 };

// --- poles ---------------------------------------------------------------------------

// every: metres of road between two poles; off: outside the verge (m); side: metres
// of road to a stretch on one side; tall: a pole's height (m); steep: the steepest
// ground one stands on; lean: the most a pole leans (rad).
export const POLE = { every: 45, off: 9, side: 2000, tall: 7.6, steep: 0.45, lean: 0.06 };

// --- dust devils ---------------------------------------------------------------------

// cell: metres on a side of a cell (2 km²); turn: seconds of a turn (one devil at most
// a turn); life: from least to most it lives (s); speed: m/s; height: how tall the
// column is (m); radius: at its foot and at its top (m); slope: the steepest ground it
// walks over; spread: how far its way may be turned off the wind (rad); tries: the
// points of a cell tried for a level start; step: its way is looked at every so many
// metres; points: the points of its column; reach: the car is in it within this many
// metres of its axis; push: the sideways push in it (m/s²) and how long one lasts (s).
export const DEVIL = {
  cell: 1414, turn: 360, life: [60, 120], speed: 3, height: 30, radius: [2.2, 9], slope: 0.1, spread: 0.5,
  tries: 6, step: 8, points: 120, reach: 6, push: [0.3, 2],
};

// --- tumbleweeds ---------------------------------------------------------------------

// apart: the seconds between two, from least to most; ahead: how far ahead of the car
// one crosses the road (m along it), from least to most; up, down: where it starts
// upwind of the road and where it is gone downwind (m); speed: m/s, from least to most;
// size: across (m); hop: how high it bounces (m) and how far apart its bounces are (m);
// hit: the car breaks one within this many metres of it; met: one has been met that
// crosses the road this near the car (m along the road).
export const WEED = { apart: [14, 26], ahead: [40, 150], up: 34, down: 40, speed: [4.5, 6.5], size: 0.8, hop: [0.55, 4.5], hit: 1.6, met: 220 };

// The seconds from tumbleweed n - 1 to tumbleweed n of a run of seed (n from 1).
export function weedGap(n, seed) {
  return WEED.apart[0] + (WEED.apart[1] - WEED.apart[0]) * hash3(n, 71, seed | 0);
}

// Where a tumbleweed is, `age` seconds after it started on its way `w` (from
// DesertPlan.weed): { x, z, y (over the ground, m), roll (rad), done }.
export function weedAt(w, age, out = {}) {
  const d = Math.min(age * w.speed, w.len);
  out.x = w.ax + w.dx * d;
  out.z = w.az + w.dz * d;
  const ph = d / WEED.hop[1] + w.phase;
  // A bounce is a parabola, smaller each time it lands, the size of the ball off the ground at the least.
  const f = ph - Math.floor(ph);
  out.y = WEED.size / 2 + WEED.hop[0] * (0.55 + 0.45 * hash3(Math.floor(ph), 72, w.n)) * 4 * f * (1 - f);
  out.roll = d / (WEED.size / 2);
  out.done = d >= w.len;
  return out;
}

export class DesertPlan {
  // land, road, corridor, worlds as the game has them (absolute coordinates).
  constructor({ land, road, corridor, worlds, seed }) {
    this.land = land;
    this.road = road;
    this.corridor = corridor;
    this.worlds = worlds;
    this.seed = seed | 0;
    this._w = { a: 0, b: 0, t: 0, u: 0 };
    this._h = (x, z) => this.corridor.heightAt(x, z);
    this.boards = new Map();
    this.poles = new Map();
    this.devils = new Map();
  }

  // Whether a thing at an absolute point with its own draw u (0 to 1) is the desert's.
  mine(ax, az, u) {
    const w = this.worlds.at(ax, az, this._w);
    return (u < w.t ? w.b : w.a) === DESERT;
  }

  // How much of the world at an absolute point is the desert's (0 to 1).
  share(ax, az) {
    const w = this.worlds.at(ax, az, this._w);
    const t = w.a === w.b ? 0 : w.t;
    return (w.a === DESERT ? 1 - t : 0) + (w.b === DESERT ? t : 0);
  }

  // Whether the land the road has shaped is as it was at a point.
  unshaped(ax, az, tol = 0.05) {
    return Math.abs(this.corridor.heightAt(ax, az) - this.land.heightAt(ax, az)) <= tol;
  }

  // A point lat metres to the left of the road at s (absolute), with the road's
  // heading; null where the road is not laid or is not on the ground.
  _beside(s, lat) {
    const p = this.road.at(s);
    if (!p || p.kind !== GROUND) return null;
    const o = this.road.origin;
    return { ax: p.x + o.x - Math.sin(p.theta) * lat, az: p.z + o.z + Math.cos(p.theta) * lat, theta: p.theta };
  }

  // --- billboards ----------------------------------------------------------------

  // The billboard of the 1.2 km of road k, or null; undefined where the road is
  // not laid yet. { ax, az, y (the lower of the ground under its posts), nx, nz (the
  // way its face looks, unit), s, side, tint (0 to 1), face (0 or 1: which of its
  // two faces is to the traffic), k }.
  board(k) {
    if (this.boards.has(k)) return this.boards.get(k);
    const B = BOARD;
    const s0 = (k + 0.5) * B.every + (hash3(k, 61, this.seed) - 0.5) * B.spread;
    if (!this.road.at(s0 - 40) || !this.road.at(s0 + 40)) return undefined;
    let found = null;
    const first = hash3(k, 62, this.seed) < 0.5 ? -1 : 1;
    const off = B.off[0] + (B.off[1] - B.off[0]) * hash3(k, 63, this.seed);
    for (let n = 0; n < 6 && !found; n++) {
      const s = s0 + (n >> 1) * 37 * (n % 4 < 2 ? 1 : -1);
      const side = n % 2 === 0 ? first : -first;
      const lat = (HALF_FLAT + off + B.width / 2 * Math.sin(B.turn)) * side;
      const q = this._beside(s, lat);
      if (!q || !this.mine(q.ax, q.az, hash3(k, 64, this.seed))) continue;
      // Square to the road, its face to the traffic that comes to it, turned toward the road by BOARD.turn.
      const tx = Math.cos(q.theta);
      const tz = Math.sin(q.theta);
      const nx = -tx * Math.cos(B.turn) + tz * side * Math.sin(B.turn);
      const nz = -tz * Math.cos(B.turn) - tx * side * Math.sin(B.turn);
      // The posts, along the panel, and the ground under each.
      const h = this._h;
      const ya = h(q.ax - nz * B.post / 2, q.az + nx * B.post / 2);
      const yb = h(q.ax + nz * B.post / 2, q.az - nx * B.post / 2);
      if (Math.abs(ya - yb) > B.fall || !this.unshaped(q.ax, q.az, 0.3)) continue;
      // (It must not stand over the road where the road bends back toward it.)
      if (this._nearRoad(q.ax, q.az, HALF_FLAT + 3 + B.width / 2)) continue;
      found = {
        ax: q.ax, az: q.az, y: Math.min(ya, yb), nx, nz, s, side, k,
        tint: hash3(k, 65, this.seed), face: hash3(k, 66, this.seed) < 0.5 ? 0 : 1,
      };
    }
    this.boards.set(k, found);
    return found;
  }

  // Whether the road's centre line comes within r of an absolute point.
  _nearRoad(ax, az, r) {
    let near = false;
    const road = this.road;
    road.forEachSegmentNear(ax, az, r, (i) => {
      if (near) return;
      const a = road.samples.get(i);
      const b = road.samples.get(i + 1);
      if (!a || !b) return;
      const ex = b.ax - a.ax;
      const ez = b.az - a.az;
      const t = Math.max(0, Math.min(1, ((ax - a.ax) * ex + (az - a.az) * ez) / (ex * ex + ez * ez || 1)));
      if (Math.hypot(ax - (a.ax + ex * t), az - (a.az + ez * t)) < r) near = true;
    });
    return near;
  }

  // --- poles -----------------------------------------------------------------------

  // The pole of station k (POLE.every metres of road apart), or null; undefined
  // where the road is not laid yet. { ax, az, y, theta (the road's heading there),
  // lean: [x, z] (rad), side, s }.
  pole(k) {
    if (this.poles.has(k)) return this.poles.get(k);
    const P = POLE;
    const s = k * P.every;
    if (!this.road.at(s - 2) || !this.road.at(s + 2)) return undefined;
    const block = Math.floor(s / P.side);
    const side = hash3(block, 81, this.seed) < 0.5 ? -1 : 1;
    const q = this._beside(s, (HALF_FLAT + P.off) * side);
    let found = null;
    if (q && this.mine(q.ax, q.az, hash3(k, 82, this.seed)) && slopeAt(this._h, q.ax, q.az, 2) < P.steep
      && !this._nearRoad(q.ax, q.az, HALF_FLAT + 2)) {
      found = {
        ax: q.ax, az: q.az, y: this._h(q.ax, q.az), theta: q.theta, side, s, k,
        lean: [(hash3(k, 83, this.seed) - 0.5) * 2 * P.lean, (hash3(k, 84, this.seed) - 0.5) * 2 * P.lean],
      };
    }
    this.poles.set(k, found);
    return found;
  }

  // --- dust devils -------------------------------------------------------------------

  // The devil of cell (i, j) in its turn n, or null: { ax, az (where it starts), dx, dz
  // (its way, unit), t0 (when it starts, s), life (s), key }. Its way is level all along.
  devil(i, j, n) {
    const key = `${i},${j},${n}`;
    if (this.devils.has(key)) return this.devils.get(key);
    const D = DEVIL;
    const seed = this.seed;
    const id = Math.imul(i, 7919) + Math.imul(j, 104729);
    const life = D.life[0] + (D.life[1] - D.life[0]) * hash3(id, n * 8 + 1, seed);
    const t0 = n * D.turn + (D.turn - life) * hash3(id, n * 8 + 2, seed);
    const turn = (hash3(id, n * 8 + 3, seed) - 0.5) * 2 * D.spread;
    const dx = Math.cos(WIND + turn);
    const dz = Math.sin(WIND + turn);
    const len = life * D.speed;
    let found = null;
    for (let q = 0; q < D.tries && !found; q++) {
      const ax = (i + 0.1 + 0.8 * hash3(id, n * 64 + q * 2 + 9, seed)) * D.cell;
      const az = (j + 0.1 + 0.8 * hash3(id, n * 64 + q * 2 + 10, seed)) * D.cell;
      if (!this.mine(ax, az, hash3(id, n * 8 + 4, seed))) continue;
      const steps = Math.ceil(len / D.step);
      let ok = true;
      for (let q2 = 0; ok && q2 <= steps; q2++) {
        const d = (len * q2) / steps;
        if (slopeAt(this._h, ax + dx * d, az + dz * d) >= D.slope) ok = false;
      }
      if (ok) found = { ax, az, dx, dz, t0, life, key };
    }
    this.devils.set(key, found);
    return found;
  }

  // The devils alive at time t (s) within r metres of an absolute point, written to
  // out as { d (the devil), x, z (where it is), age (s), fade (0 to 1: how much of it
  // there is: it comes up over its first 6 s and goes over its last 10) }.
  devilsAt(t, ax, az, r, out = []) {
    const D = DEVIL;
    out.length = 0;
    const n = Math.floor(t / D.turn);
    const reach = r + D.life[1] * D.speed;
    for (let i = Math.floor((ax - reach) / D.cell); i <= Math.floor((ax + reach) / D.cell); i++) {
      for (let j = Math.floor((az - reach) / D.cell); j <= Math.floor((az + reach) / D.cell); j++) {
        for (const m of [n - 1, n]) {
          if (m < 0) continue;
          const d = this.devil(i, j, m);
          if (!d) continue;
          const age = t - d.t0;
          if (age < 0 || age > d.life) continue;
          const x = d.ax + d.dx * age * D.speed;
          const z = d.az + d.dz * age * D.speed;
          if ((x - ax) * (x - ax) + (z - az) * (z - az) > r * r) continue;
          const fade = Math.min(1, age / 6, (d.life - age) / 10);
          out.push({ d, x, z, age, fade });
        }
      }
    }
    return out;
  }

  // --- tumbleweeds -----------------------------------------------------------------

  // The way of tumbleweed n, set off with the car at sCar going `speed` m/s: it
  // crosses the road ahead of it. { n, ax, az (where it starts), dx, dz (its way),
  // len (m), speed (m/s), cross (s along the road where it crosses), at (how far
  // along its way the road is, m), phase } or null (the road there is not the
  // desert's, or not laid, or not on the ground).
  weed(n, sCar, speed) {
    const W = WEED;
    const seed = this.seed;
    const ahead = W.ahead[0] + (W.ahead[1] - W.ahead[0]) * hash3(n, 73, seed);
    const v = W.speed[0] + (W.speed[1] - W.speed[0]) * hash3(n, 74, seed);
    // It is on its way for as long as it takes to reach the road; the car goes on meanwhile.
    const cross = sCar + ahead + Math.max(0, speed) * (W.up / v) * 0.85;
    const p = this.road.at(cross);
    if (!p || p.kind !== GROUND) return null;
    const o = this.road.origin;
    const cx = p.x + o.x;
    const cz = p.z + o.z;
    if (!this.mine(cx, cz, hash3(n, 75, seed))) return null;
    // Across the road, leaning down the wind along it.
    const tx = Math.cos(p.theta);
    const tz = Math.sin(p.theta);
    const nx = -tz;
    const nz = tx;
    const along = WIND_DIR[0] * tx + WIND_DIR[1] * tz;
    const acr = WIND_DIR[0] * nx + WIND_DIR[1] * nz;
    const sgn = acr < 0 ? -1 : 1;
    let dx = nx * sgn + tx * along * 0.6;
    let dz = nz * sgn + tz * along * 0.6;
    const l = Math.hypot(dx, dz);
    dx /= l;
    dz /= l;
    return {
      n, ax: cx - dx * W.up, az: cz - dz * W.up, dx, dz, len: W.up + W.down, speed: v, cross, at: W.up,
      phase: hash3(n, 76, seed),
    };
  }

  // Let go of the plans far from s (m along the road) and from an absolute point.
  prune(s, ax, az) {
    for (const k of this.boards.keys()) if (Math.abs((k + 0.5) * BOARD.every - s) > 5000) this.boards.delete(k);
    for (const k of this.poles.keys()) if (Math.abs(k * POLE.every - s) > 2000) this.poles.delete(k);
    for (const [key, d] of this.devils) {
      const [i, j] = key.split(',').map(Number);
      if (Math.abs((i + 0.5) * DEVIL.cell - ax) > 6000 || Math.abs((j + 0.5) * DEVIL.cell - az) > 6000 || (d === null && this.devils.size > 400)) this.devils.delete(key);
    }
  }

  // Forget the plans of the road that is gone (the road is cut and laid again after a turn), from s on.
  forget(s) {
    for (const k of this.boards.keys()) if ((k + 1) * BOARD.every > s - BOARD.spread) this.boards.delete(k);
    for (const k of this.poles.keys()) if (k * POLE.every > s - 2) this.poles.delete(k);
  }
}
