// What the alpine world has of its own along the way, as numbers: the snow that
// stays under the snow line, the snow poles by the road, the waterfalls on the
// cliffs, the plumes of snow blown off the ridges, the cow bells. Each is a pure
// function of the land, the road and the seed, so the same place has the same
// things each time the car comes by; nothing here touches three.js.
//
//  - Snow stays in the hollows and on the slopes that turn their back on the sun,
//    for SNOW.below metres under the snow line (render/terrain.js has it in the
//    shader; the numbers are here so that a check can read the same ones).
//  - A snow pole stands by each side of the road every POLE.every metres of road that
//    runs on the ground, a little outside its verge.
//  - A waterfall falls down a cliff (ground steeper than FALL.slope over more than
//    FALL.drop metres of height), one in each FALL.every metres of road at most,
//    and not on the road's doorstep.
//  - A plume of snow trails from a ridge above the snow line, downwind: where the
//    ridge is, and how the plume lies down the lee of it, are worked out here; the
//    band that draws it is render/plumes.js, which is not the alpine's alone.
//  - A cow bell rings now and then from the slopes below the tree line.
//
// A thing belongs to the alpine world by its own draw across a border (as the trees
// and the things on the ground do), so each of them thins out as the next world
// comes in.

import { WORLD_INDEX } from './worlds.js';
import { HALF_FLAT, GROUND, STEP } from './road.js';
import { hash2 } from './noise.js';

export const ALPINE = WORLD_INDEX.alpine;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
// Three integers and a seed to [0, 1).
const hash3 = (a, b, c, seed = 0) => hash2(Math.imul(a | 0, 0x2545f491) ^ (b | 0), c | 0, seed | 0);

// --- the snow that stays -------------------------------------------------------------

// below: how far under the snow line (m) the snow stays; hollow: the least hollow
// ground (0 to 1, how much lower than what is round it, render/terrain.js) holds it;
// turned: the angle from the sun (degrees) past which a slope has turned its back on it.
export const SNOW = { below: 150, hollow: 0.5, turned: 100 };

// --- the snow poles --------------------------------------------------------------------

// every: metres of road between one pole and the next, on each side; chunk: the metres of road
// they are laid in a piece at a time; height: m; off: how far outside the verge of the road
// (its platform, HALF_FLAT from the middle) a pole stands, from least to most (m); lean: how
// far one may lean (rad); range: how far off they are drawn (m); alone: how far the nearest other
// road must be, beyond the verge, for a pole to stand there; ends: the metres of road
// kept clear at each end of a stretch that is not ground.
export const POLE = { every: 25, chunk: 200, height: 2.4, off: [0.5, 1.5], lean: 0.05, range: 300, alone: 3, ends: 12 };

// --- the waterfalls --------------------------------------------------------------------

// every: metres of road to a waterfall's cell; odds: how likely a cell is to have one; slope: the least
// steepness (rise over run) that the whole of a fall is down; drop: the least height it falls (m);
// width: from least to most (m); off: the closest to the road it is (m, from the middle of the
// road); reach: the farthest; hear: how far off it is heard (m); lat: the distances from the road
// that are looked at for a cliff; along: the metres of road between one look and the next;
// step: the metres of ground between one point of a fall's line and the next; mist: the
// points of spray at its foot; range: how far off it is drawn (m); rows: the most points a
// fall's line has; max: the tallest a fall is (m): the foot of a taller face has it, from partway down.
export const FALL = {
  every: 800, odds: 0.9, slope: 0.9, drop: 25, max: 110, width: [2, 4], off: 60, reach: 560,
  hear: 120, lat: [64, 92, 128, 172, 224, 284, 352, 424, 520], along: 40, step: 3, mist: 24, range: 1000, rows: 36,
};

// --- the plumes ------------------------------------------------------------------------

// reach: how far from the lens a plume is looked for (m); max: how many at once; cell: the
// size of the cells of the land a ridge is looked for in (m); length: from least to most (m);
// apart: the closest two plumes are (m); crest: how much lower the land is `step` metres up and
// down the wind of a ridge's crest (m); lift: how high over the land the plume is, at its root and at
// its end (m); width: how wide it is at its widest (m). The ridges over the snow line stand
// hundreds of metres over the road: from the road, one within 800 m is more than 27 degrees up, over the top
// of the picture, so the reach is of kilometres and the plumes are the size they are seen to be at that distance
// (a banner of snow off a big ridge is hundreds of metres long). It leaves the crest level and sinks `sink` metres to the metre it goes
// (not down the lee as the ground does), clear of the ground by `lift` at least.
export const PLUME = { reach: 3000, max: 6, cell: 96, length: [200, 520], apart: 300, crest: 10, step: 50, lift: [6, 30], width: [44, 110], sink: 0.12 };

// --- the cow bells ---------------------------------------------------------------------

// A bell rings every `apart[0]` to `apart[1]` seconds (each gap by a draw of its own), a run
// of `strikes[0]` to `strikes[1]` strokes `between[0]` to `between[1]` seconds apart, a ring having a pitch from
// `pitch` (Hz) and each of its strokes within 5% of it. It rings while the lens is under the tree line, with open grass slope (steeper than
// `slope[0]` and not so steep as `slope[1]`) within `reach` m of it on one side.
export const BELL = { first: 3.5, apart: [8, 20], strikes: [2, 4], between: [0.28, 0.7], pitch: [520, 790], slope: [0.08, 0.7], reach: 90 };

// The seconds from bell n - 1 to bell n (n from 1) of a run in a world seeded `seed`.
export function bellGap(n, seed) {
  return BELL.apart[0] + (BELL.apart[1] - BELL.apart[0]) * hash3(n, 71, 5, seed);
}

// How bell n sounds: how many strokes, when each comes after the first (s), its pitch (Hz), its
// level (0 to 1) and which ear it is nearer (-1 to 1); one more draw for the sound to vary by.
export function bellRing(n, seed) {
  const h = (k) => hash3(n, 72 + k, 6, seed);
  const count = BELL.strikes[0] + Math.floor(h(0) * (BELL.strikes[1] - BELL.strikes[0] + 1));
  const base = BELL.pitch[0] + (BELL.pitch[1] - BELL.pitch[0]) * h(1);
  const pan = (h(2) * 2 - 1) * 0.8;
  const strokes = [];
  let t = 0;
  for (let i = 0; i < count; i++) {
    strokes.push({ at: t, pitch: base * (1 + 0.05 * (h(3 + i) - 0.5) * 2), level: 0.55 + 0.45 * h(8 + i) });
    t += BELL.between[0] + (BELL.between[1] - BELL.between[0]) * h(14 + i);
  }
  return { strokes, pan, seed: h(20) };
}

export class AlpinePlan {
  // land, road, corridor, worlds as the game has them (absolute coordinates); wind: the way it blows, { x, z } (it is
  // made a unit vector).
  constructor({ land, road, corridor, worlds, seed, wind }) {
    this.land = land;
    this.road = road;
    this.corridor = corridor;
    this.worlds = worlds;
    this.seed = seed | 0;
    const w = wind || { x: 0.918, z: 0.396 };
    const n = Math.hypot(w.x, w.z) || 1;
    this.wind = { x: w.x / n, z: w.z / n };
    this.snowLine = land.snowLine;
    this.treeLine = land.treeLine;
    this._w = { a: 0, b: 0, t: 0, u: 0 };
    this._h = (x, z) => this.land.heightAt(x, z);
    this.chunks = new Map();
    this.falls = new Map();
    this.looking = new Map();
    this.cells = new Map();
    this.cellAt = new Map();
  }

  // Whether a thing at an absolute point, which has its own draw u (0 to 1), is the alpine's: the world it
  // belongs to is the first of the two there where the draw is over the blend, the second where it is under.
  mine(ax, az, u) {
    const w = this.worlds.at(ax, az, this._w);
    return (u < w.t ? w.b : w.a) === ALPINE;
  }

  // Whether either of the two worlds at an absolute point is the alpine's.
  worldHas(ax, az) {
    const w = this.worlds.at(ax, az, this._w);
    return w.a === ALPINE || w.b === ALPINE;
  }

  // The road near an absolute point: how far its middle is, the kind of the nearest stretch of it, and whether
  // any is laid within r.
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

  // The steepness of the land at a point (rise over run, by differences over 2 d metres), and the way it falls
  // (a unit vector, x and z) in out if it is given.
  slopeAt(x, z, d = 3, out = null) {
    const h = this._h;
    const gx = (h(x + d, z) - h(x - d, z)) / (2 * d);
    const gz = (h(x, z + d) - h(x, z - d)) / (2 * d);
    const g = Math.hypot(gx, gz);
    if (out) {
      out.x = g > 1e-9 ? -gx / g : 0;
      out.z = g > 1e-9 ? -gz / g : 0;
    }
    return g;
  }

  // --- the snow poles ------------------------------------------------------------------

  // The poles of the chunk c of road (POLE.chunk metres from c * POLE.chunk): each { ax, y, az (the foot), yaw (the
  // way along the road), lx, lz (how far it leans, rad), s (along the road), side (1 left, -1 right) }. [] where
  // there are none; undefined where the road is not laid yet (it is asked for again later).
  poles(c) {
    if (this.chunks.has(c)) return this.chunks.get(c);
    const P = POLE;
    const road = this.road;
    const o = road.origin;
    const s0 = c * P.chunk;
    if (!road.at(Math.max(s0 - P.ends, road.first * STEP, 0)) || !road.at(s0 + P.chunk + P.ends)) return undefined;
    const out = [];
    const n = Math.round(P.chunk / P.every);
    for (let i = 0; i < n; i++) {
      const s = s0 + (i + 0.5) * P.every;
      const p = road.at(s);
      if (!p || p.kind !== GROUND) continue;
      const a = road.at(s - P.ends);
      const b = road.at(s + P.ends);
      if (!a || !b || a.kind !== GROUND || b.kind !== GROUND) continue;
      const key = Math.floor(s / P.every);
      const sin = Math.sin(p.theta);
      const cos = Math.cos(p.theta);
      for (const side of [1, -1]) {
        const h = (k) => hash3(key, side * 3 + k, 11, this.seed);
        const lat = HALF_FLAT + P.off[0] + (P.off[1] - P.off[0]) * h(1);
        const ax = p.x + o.x - sin * lat * side;
        const az = p.z + o.z + cos * lat * side;
        // (Of the alpine's by its own draw, off any other road, and not in water.)
        if (!this.mine(ax, az, h(2))) continue;
        const near = this.roadNear(ax, az, 40);
        if (near.dist < lat - 0.4 || near.kind !== GROUND) continue;
        const y = this.corridor.heightAt(ax, az);
        if (this.land.waterLevel(ax, az) > y - 0.2) continue;
        const lean = P.lean * (h(3) * 2 - 1);
        const turn = h(4) * Math.PI * 2;
        out.push({ ax, y, az, yaw: p.theta, lx: lean * Math.cos(turn), lz: lean * Math.sin(turn), s, side, key });
      }
    }
    this.chunks.set(c, out);
    return out;
  }

  // --- the waterfalls ------------------------------------------------------------------

  // The line down a cliff from a point on it: the points from the lip (where the ground first is less steep than
  // FALL.slope, one step above the face) to the foot (where it is less steep again), every FALL.step metres of
  // ground, as [x, z, steepness] each, the face between them. Null if there is none, or it goes on for 180 m or more.
  _face(x, z) {
    const F = FALL;
    const dir = { x: 0, z: 0 };
    let px = x;
    let pz = z;
    let last = null;
    let steps = 0;
    for (; steps < 60; steps++) {
      const g = this.slopeAt(px, pz, 2.5, dir);
      if (g < F.slope) break;
      last = [dir.x, dir.z];
      px -= dir.x * F.step;
      pz -= dir.z * F.step;
    }
    if (steps >= 60 || steps < 3) return null;
    // From the lip down the face, the way it fell at the top of it to begin with.
    const path = [[px, pz, this.slopeAt(px, pz, 2.5)]];
    dir.x = last[0];
    dir.z = last[1];
    for (let i = 0; i < 90; i++) {
      px += dir.x * F.step;
      pz += dir.z * F.step;
      const g = this.slopeAt(px, pz, 2.5, dir);
      path.push([px, pz, g]);
      if (g < F.slope) return path;
    }
    return null;
  }

  // The waterfall of the 800 m of road k, or null; undefined where the road is not laid yet, or where the look for one
  // is not done (it is done in pieces of about `ms` milliseconds a call, `Infinity`: all at once). { ax, az (the foot),
  // pts: Float64Array of [x, y, z] from the top to the bottom, n, drop (m), steep (the least steepness along it), width
  // (m), dist (m from the road's middle, the nearest point of it), out: [x, z] (the way the face looks, a unit
  // vector), s (along the road, at its nearest), key }.
  fall(k, ms = Infinity) {
    if (this.falls.has(k)) return this.falls.get(k);
    const F = FALL;
    const road = this.road;
    const s0 = k * F.every;
    let look = this.looking.get(k);
    if (!look) {
      if (!road.at(s0 + 8) || !road.at(s0 + F.every - 8)) return undefined;
      look = this._look(k);
      this.looking.set(k, look);
    }
    const t0 = performance.now();
    for (;;) {
      const r = look.next();
      if (r.done) {
        this.looking.delete(k);
        this.falls.set(k, r.value);
        return r.value;
      }
      if (ms !== Infinity && performance.now() - t0 >= ms) return undefined;
    }
  }

  // The look for the waterfall of the road's cell k, a piece at a time (a candidate each).
  *_look(k) {
    const F = FALL;
    const road = this.road;
    const o = road.origin;
    const s0 = k * F.every;
    const at = road.at(s0 + F.every / 2);
    // (None where neither of the worlds is the alpine's, or where a draw of the cell's own says no.)
    if (!this.worldHas(at.x + o.x, at.z + o.z) || hash3(k, 81, 1, this.seed) >= F.odds) return null;
    let best = null;
    let bestValue = 0;
    const dir = { x: 0, z: 0 };
    const seen = [];
    const jitter = (i, j, m) => hash3(k, 90 + i * 17 + j, m, this.seed) - 0.5;
    for (let i = 0; i * F.along < F.every; i++) {
      const s = s0 + (i + 0.5) * F.along;
      const p = road.at(s);
      if (!p) continue;
      for (let j = 0; j < F.lat.length; j++) {
        for (const side of [1, -1]) {
          const lat = F.lat[j] * (1 + 0.2 * jitter(i, j, side + 2));
          const x = p.x + o.x - Math.sin(p.theta) * lat * side;
          const z = p.z + o.z + Math.cos(p.theta) * lat * side;
          // (A face already looked at is not looked at again.)
          if (this.slopeAt(x, z, 2.5, dir) < F.slope || seen.some((q) => (q[0] - x) ** 2 + (q[1] - z) ** 2 < 144)) continue;
          const path = this._face(x, z);
          yield;
          if (!path) continue;
          for (let m = 0; m < path.length; m += 2) seen.push(path[m]);
          const rated = this._rate(path, p, o);
          if (rated && rated.value > bestValue) {
            bestValue = rated.value;
            best = { ...rated, s, key: k };
          }
        }
      }
    }
    return best;
  }

  // How good a line down a cliff is for a waterfall, and what the waterfall is: null when it is not one. `p`, `o`: the
  // road, and its origin, where the line was looked for from.
  _rate(path, p, o) {
    const F = FALL;
    const n = path.length;
    const h = this._h;
    const pts = new Float64Array(n * 3);
    let steep = Infinity;
    let near = Infinity;
    for (let i = 0; i < n; i++) {
      const [x, z, g] = path[i];
      pts[i * 3] = x;
      pts[i * 3 + 1] = h(x, z);
      pts[i * 3 + 2] = z;
      if (i > 0 && i < n - 1) steep = Math.min(steep, g);
    }
    // The face is from the second point to the last but one; the drop is the height of it.
    let drop = pts[4] - pts[(n - 2) * 3 + 1];
    if (drop < F.drop) return null;
    // A face that is taller than a fall is, has the fall at its foot: the line starts partway down.
    let from = 0;
    if (drop > F.max) {
      const base = pts[(n - 2) * 3 + 1];
      while (from < n - 3 && pts[(from + 1) * 3 + 1] - base > F.max) from++;
      drop = pts[(from + 1) * 3 + 1] - base;
    }
    // Off the road, all along it, and in the alpine's own land.
    for (let i = from; i < n; i++) {
      const d = this.roadNear(pts[i * 3], pts[i * 3 + 2], F.off + 20).dist;
      if (d < F.off) return null;
    }
    const mx = (pts[(from + 1) * 3] + pts[(n - 2) * 3]) / 2;
    const mz = (pts[(from + 1) * 3 + 2] + pts[(n - 2) * 3 + 2]) / 2;
    near = this.roadNear(mx, mz, F.reach + 80).dist;
    if (!this.worldHas(pts[0], pts[2]) || !this.worldHas(pts[(n - 1) * 3], pts[(n - 1) * 3 + 2])) return null;
    if (!this.mine(mx, mz, hash3(Math.round(mx), Math.round(mz), 83, this.seed))) return null;
    // The way the face looks (down its fall), against the way to the road from the middle of it.
    const dx = pts[(n - 2) * 3] - pts[(from + 1) * 3];
    const dz = pts[(n - 2) * 3 + 2] - pts[(from + 1) * 3 + 2];
    const dl = Math.hypot(dx, dz) || 1;
    const ox = dx / dl;
    const oz = dz / dl;
    const rx = p.x + o.x - mx;
    const rz = p.z + o.z - mz;
    const rl = Math.hypot(rx, rz) || 1;
    const facing = (ox * rx + oz * rz) / rl;
    if (facing < 0.25) return null;
    const width = F.width[0] + (F.width[1] - F.width[0]) * hash3(Math.round(mx), Math.round(mz), 84, this.seed);
    // Taller, facing the road and nearer is better.
    const value = (Math.min(drop, 80) / 80) * (0.5 + 0.5 * facing) * (1 - 0.45 * clamp01((near - F.off) / (F.reach - F.off)));
    return { ax: pts[(n - 1) * 3], az: pts[(n - 1) * 3 + 2], pts: pts.slice(from * 3), n: n - from, drop, steep, width, dist: near, out: [ox, oz], value };
  }

  // --- the plumes ----------------------------------------------------------------------

  // The ridge of the cell (cx, cz) of the land (PLUME.cell metres on a side) that a plume trails from, or null: where the
  // crest is (ax, az, y), and the points of the plume's line from there downwind, [x, y, z] each, `pts`, which lie
  // over the lee of the ridge. A ridge is a crest across the wind: the highest point along it, by more than
  // PLUME.crest metres either way, and over the snow line.
  ridge(cx, cz) {
    const key = cx * 100003 + cz;
    if (this.cells.has(key)) return this.cells.get(key);
    const P = PLUME;
    const h = this._h;
    const w = this.wind;
    const C = P.cell;
    const r = (n) => hash3(cx, cz, 100 + n, this.seed);
    let x = (cx + r(1)) * C;
    let z = (cz + r(2)) * C;
    let y = h(x, z);
    let found = null;
    // Up to the crest along the wind (a few steps each way), then see whether it is one.
    if (y > this.snowLine - 160) {
      for (let it = 0; it < 8; it++) {
        const f = h(x + w.x * 12, z + w.z * 12);
        const b = h(x - w.x * 12, z - w.z * 12);
        if (f > y + 0.05 && f >= b) {
          x += w.x * 12;
          z += w.z * 12;
          y = f;
        } else if (b > y + 0.05) {
          x -= w.x * 12;
          z -= w.z * 12;
          y = b;
        } else break;
      }
      const ahead = h(x + w.x * P.step, z + w.z * P.step);
      const behind = h(x - w.x * P.step, z - w.z * P.step);
      if (y >= this.snowLine && y > ahead + P.crest && y > behind + P.crest && this.mine(x, z, r(3))) {
        const len = P.length[0] + (P.length[1] - P.length[0]) * r(4);
        const n = 9;
        const pts = new Float64Array(n * 3);
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1);
          const px = x + w.x * len * t;
          const pz = z + w.z * len * t;
          // Off the crest it goes level, sinking a little, and over the land where the land comes up to it, a little higher
          // the further it trails.
          pts[i * 3] = px;
          pts[i * 3 + 1] = Math.max(h(px, pz) + P.lift[0] + (P.lift[1] - P.lift[0]) * t, y + P.lift[0] - P.sink * len * t);
          pts[i * 3 + 2] = pz;
        }
        // (A root that is not over the crest, but over the lee slope it falls to, is not a plume.)
        pts[1] = Math.max(pts[1], y + P.lift[0]);
        found = { key, ax: x, az: z, y, len, width: P.width[0] + (P.width[1] - P.width[0]) * r(5), seed: r(6), pts, n };
      }
    }
    this.cells.set(key, found);
    this.cellAt.set(key, [cx, cz]);
    return found;
  }

  // The plumes within `reach` m of an absolute point, the nearest first, at most `max`, none closer than PLUME.apart to
  // another that is nearer: [{ ...ridge, dist }]. `view`, if it is given, says what is to be had: view.cell(x0, z0, x1, z1) whether a
  // cell of the land (absolute metres) may hold a plume that is wanted (a cell that cannot is not worked out), view.ridge(ridge,
  // dist) whether a ridge is. A cell not worked out yet is worked out, the nearest first, at most `budget` of them; the list has
  // `.skipped`, how many wanted cells were left for the next ask.
  plumesNear(ax, az, reach = PLUME.reach, max = PLUME.max, budget = Infinity, view = null) {
    const C = PLUME.cell;
    const found = [];
    const todo = [];
    const take = (q, d) => {
      if (q && d < reach && (!view || !view.ridge || view.ridge(q, d))) found.push({ ...q, dist: d });
    };
    for (let cx = Math.floor((ax - reach) / C); cx <= Math.floor((ax + reach) / C); cx++) {
      for (let cz = Math.floor((az - reach) / C); cz <= Math.floor((az + reach) / C); cz++) {
        const key = cx * 100003 + cz;
        if (this.cells.has(key)) {
          const q = this.cells.get(key);
          if (q) take(q, Math.hypot(q.ax - ax, q.az - az));
        } else if (!view || !view.cell || view.cell(cx * C, cz * C, (cx + 1) * C, (cz + 1) * C)) {
          todo.push([Math.hypot((cx + 0.5) * C - ax, (cz + 0.5) * C - az), cx, cz]);
        }
      }
    }
    todo.sort((a, b) => a[0] - b[0]);
    const n = Math.min(todo.length, budget);
    for (let i = 0; i < n; i++) {
      const q = this.ridge(todo[i][1], todo[i][2]);
      if (q) take(q, Math.hypot(q.ax - ax, q.az - az));
    }
    found.sort((a, b) => a.dist - b.dist);
    const kept = [];
    for (const q of found) {
      if (kept.length >= max) break;
      if (kept.some((k) => Math.hypot(k.ax - q.ax, k.az - q.az) < PLUME.apart)) continue;
      kept.push(q);
    }
    kept.skipped = todo.length - n;
    return kept;
  }

  // --- the bells -----------------------------------------------------------------------

  // Whether there is grass slope to be heard from at an absolute point: under the tree line, with open ground (not a cliff, not
  // the flat of a valley) on a side of it within BELL.reach metres.
  grassSlopeAt(ax, az) {
    const h = this._h;
    if (h(ax, az) >= this.treeLine) return false;
    let open = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const x = ax + Math.cos(a) * BELL.reach * 0.6;
      const z = az + Math.sin(a) * BELL.reach * 0.6;
      const g = this.slopeAt(x, z, 4);
      if (g > BELL.slope[0] && g < BELL.slope[1] && h(x, z) < this.treeLine) open++;
    }
    return open >= 2;
  }

  // --- the road gone --------------------------------------------------------------------

  // Let go of the plans of the road far from s (m along the road), and of the ridges far from an absolute point.
  prune(s, ax = null, az = null) {
    for (const c of this.chunks.keys()) if (Math.abs((c + 0.5) * POLE.chunk - s) > 2500) this.chunks.delete(c);
    for (const k of this.falls.keys()) if (Math.abs((k + 0.5) * FALL.every - s) > 4000) this.falls.delete(k);
    if (ax !== null) {
      const C = PLUME.cell;
      for (const [key, [cx, cz]] of this.cellAt) {
        if (Math.hypot((cx + 0.5) * C - ax, (cz + 0.5) * C - az) > PLUME.reach * 1.6) {
          this.cells.delete(key);
          this.cellAt.delete(key);
        }
      }
    }
  }

  // Forget the plans of the road that is gone (it is cut and laid again after a turn), from progress s on.
  forget(s) {
    for (const c of this.chunks.keys()) if ((c + 1) * POLE.chunk > s) this.chunks.delete(c);
    for (const k of this.falls.keys()) if ((k + 1) * FALL.every > s) this.falls.delete(k);
    for (const k of this.looking.keys()) if ((k + 1) * FALL.every > s) this.looking.delete(k);
    // (The worlds' schedule has changed, and which ridges are the alpine's with it.)
    this.cells.clear();
    this.cellAt.clear();
  }
}

// The step of the road's samples, for whoever lays things at one every so many metres.
export { STEP, smooth };
