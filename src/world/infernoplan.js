// Where the inferno's own things are and when they happen: the splashes off the
// lava, the vents that throw up a column of fire, the light the lava throws up
// on what stands near it, and the way the lava's crust drifts. Each is a pure
// function of the land, the road, the seed and the clock, so the same place has
// the same things each time the car comes by; nothing here touches three.js.
//
//  - A splash comes every 2 to 6 s (4 on average) somewhere on the lava within
//    300 m of the lens (where none is found it looks again half a second on): 12 to 30 drops thrown up at 6 to 14 m/s, each on its
//    own parabola. A drop that comes down on the lava is gone where it meets
//    it; one that comes down on the bank lies there as a red spot that goes
//    dark over 4 s. When and how is drawn from the splash's number and the
//    seed; where is drawn from that and where the lens is when it comes.
//  - A vent is one to a kilometre of road at most: in a crack of the rock
//    40 m and more from the road, on ground the road has not shaped, out of
//    the lava and not steep. It throws up a column of fire for 1.5 s in
//    every 6, each vent at a time of its own, and lights the ground for 30 m
//    round while it does.
//  - The light off the lava: for a point of the land within 60 m of lava, the
//    way to the nearest lava and how near it is (world/bakery.js lays it into
//    the land's tiles).
//
// A vent belongs to the inferno by its own draw across a border (as the trees
// do), so they thin out as the next world comes in; the splashes and the light
// go by where the lava is.

import { WORLD_INDEX } from './worlds.js';
import { hash3 } from './cavernplan.js';

export const INFERNO = WORLD_INDEX.inferno;

// --- splashes ----------------------------------------------------------------------

// apart: the seconds between two, from least to most; reach: how far from the lens
// one may be (m); drops: how many, from least to most; speed: how fast they are thrown
// (m/s), from least to most; rise: how steeply (rad over the level), from least to
// most; tries: the points looked at for lava; deep: how far under the surface the land
// must be for it to be lava there (m); lift: how far over the surface a drop starts (m);
// spot: how long a drop that comes down on the bank glows there (s); g: m/s²; step: the
// step a drop's way is looked at in (s); grid: the cells the ground round a splash is
// looked at in (n a side, m apart); front: the share of the tries laid in the lens's view; retry: a splash that finds
// no lava waits this long and looks again (s), so that they come as often wherever there is lava in reach.
export const SPLASH = {
  apart: [2, 6], reach: 300, drops: [12, 30], speed: [6, 14], rise: [0.75, 1.4], tries: 48, deep: 0.25, lift: 0.1,
  spot: 4, g: 9.81, step: 0.01, grid: [17, 3], front: 0.5, retry: 0.5,
};

// The seconds from splash n - 1 to splash n of a run of seed (n from 1).
export function splashGap(n, seed) {
  return SPLASH.apart[0] + (SPLASH.apart[1] - SPLASH.apart[0]) * hash3(n, 91, seed | 0);
}

// --- vents -----------------------------------------------------------------------------

// every: metres of road to a vent's cell; off: how far from the road's centre line (m),
// from least to most; clear: the nearest the road may come to it anywhere (m); steep: the
// steepest ground one is in; above: how far over the lava's surface its ground must be
// (m); period, burst: s; light: how far round it lights the ground (m); tall: how high
// the column goes (m); tries: places looked at in a cell.
export const VENT = { every: 1000, off: [46, 170], clear: 40, steep: 0.4, above: 1.5, period: 6, burst: 1.5, light: 30, tall: 16, tries: 5 };

// How much a vent of phase `phase` (0 to 1) is burning at clock t (s): 0 between, up to 1
// while it burns (it comes up in a tenth of a second and dies over the last third).
export function ventBurn(phase, t) {
  const u = (((t / VENT.period + phase) % 1) + 1) % 1 * VENT.period;
  if (u >= VENT.burst) return 0;
  const up = Math.min(1, u / 0.1);
  const down = Math.min(1, (VENT.burst - u) / (VENT.burst / 3));
  return up * down;
}

// --- the light off the lava --------------------------------------------------------

// reach: the light reaches this far from lava (m); grid: the spacing the lava is looked for
// at, by the tile's level (m; none past the last); deep: as the splashes'.
export const GLOW = { reach: 60, grid: [6, 8, 12], deep: 0.25 };

// For a land tile (world/bakery.js): the way to the nearest lava from each of its vertices
// and how near it is, as three numbers a vertex: the unit way (x, y, z: down to the lava's
// surface) times (1 - d / 60)², d the distance (m); 0 where there is no lava within 60 m.
// land: the land (lavaLevel, heightAtCoarse); x0, z0: the tile's corner; step, n: its vertices
// (n a side); H(i, j): the height at its vertex; level: its level. Null where there is no
// lava near the tile at all.
export function lavaGlow(land, x0, z0, step, n, H, level) {
  if (!land.lavaLevel || level >= GLOW.grid.length) return null;
  const size = step * (n - 1);
  const R = GLOW.reach;
  // A world of lava anywhere near the tile? (Worlds are kilometres long: nine points tell.)
  let any = false;
  for (let j = 0; j < 3 && !any; j++) {
    for (let i = 0; i < 3 && !any; i++) {
      if (land.lavaLevel(x0 - R + (size + 2 * R) * i / 2, z0 - R + (size + 2 * R) * j / 2) > -Infinity) any = true;
    }
  }
  if (!any) return null;
  const g = GLOW.grid[level];
  const G = Math.ceil((size + 2 * R) / g) + 1;
  const gx0 = x0 - R;
  const gz0 = z0 - R;
  const h = land.heightAtCoarse || land.heightAt;
  // The nearest lava found for each cell of the grid: its place, or NaN.
  const nx = new Float64Array(G * G).fill(NaN);
  const nz = new Float64Array(G * G);
  const ny = new Float64Array(G * G);
  let lava = 0;
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const ax = gx0 + i * g;
      const az = gz0 + j * g;
      const L = land.lavaLevel(ax, az);
      if (L === -Infinity || !(h(ax, az) < L - GLOW.deep)) continue;
      const k = j * G + i;
      nx[k] = ax;
      nz[k] = az;
      ny[k] = L;
      lava++;
    }
  }
  if (!lava) return null;
  // Two sweeps of the grid, each cell taking the nearer of its own and its neighbours' nearest.
  const take = (k, q) => {
    if (Number.isNaN(nx[q])) return;
    const cx = gx0 + (k % G) * g;
    const cz = gz0 + Math.floor(k / G) * g;
    if (Number.isNaN(nx[k]) || (nx[q] - cx) ** 2 + (nz[q] - cz) ** 2 < (nx[k] - cx) ** 2 + (nz[k] - cz) ** 2) {
      nx[k] = nx[q];
      nz[k] = nz[q];
      ny[k] = ny[q];
    }
  };
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const k = j * G + i;
      if (i > 0) take(k, k - 1);
      if (j > 0) {
        take(k, k - G);
        if (i > 0) take(k, k - G - 1);
        if (i < G - 1) take(k, k - G + 1);
      }
    }
  }
  for (let j = G - 1; j >= 0; j--) {
    for (let i = G - 1; i >= 0; i--) {
      const k = j * G + i;
      if (i < G - 1) take(k, k + 1);
      if (j < G - 1) {
        take(k, k + G);
        if (i < G - 1) take(k, k + G + 1);
        if (i > 0) take(k, k + G - 1);
      }
    }
  }
  const out = new Float32Array(n * n * 3);
  let lit = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const ax = x0 + i * step;
      const az = z0 + j * step;
      const y = H(i, j);
      // The nearest lava of the cell the vertex is in and of the three others round it.
      const fi = Math.min(G - 2, Math.floor((ax - gx0) / g));
      const fj = Math.min(G - 2, Math.floor((az - gz0) / g));
      let best = Infinity;
      let bx = 0;
      let by = 0;
      let bz = 0;
      for (const k of [fj * G + fi, fj * G + fi + 1, (fj + 1) * G + fi, (fj + 1) * G + fi + 1]) {
        if (Number.isNaN(nx[k])) continue;
        const d = (nx[k] - ax) ** 2 + (nz[k] - az) ** 2;
        if (d < best) {
          best = d;
          bx = nx[k];
          by = ny[k];
          bz = nz[k];
        }
      }
      if (best === Infinity || y < by) continue;
      const dx = bx - ax;
      const dy = by - y;
      const dz = bz - az;
      const d = Math.hypot(dx, dy, dz);
      if (d >= R) continue;
      const w = (1 - d / R) ** 2 / Math.max(d, 1e-3);
      const v = (j * n + i) * 3;
      out[v] = dx * w;
      out[v + 1] = dy * w;
      out[v + 2] = dz * w;
      lit++;
    }
  }
  return lit ? out : null;
}

export class InfernoPlan {
  // land, road, corridor, worlds as the game has them (absolute coordinates).
  constructor({ land, road, corridor, worlds, seed }) {
    this.land = land;
    this.road = road;
    this.corridor = corridor;
    this.worlds = worlds;
    this.seed = seed | 0;
    this._w = { a: 0, b: 0, t: 0, u: 0 };
    this._h = (x, z) => this.corridor.heightAt(x, z);
    this.vents = new Map();
  }

  // Whether a thing at an absolute point with its own draw u (0 to 1) is the inferno's.
  mine(ax, az, u) {
    const w = this.worlds.at(ax, az, this._w);
    return (u < w.t ? w.b : w.a) === INFERNO;
  }

  // How much of the world at an absolute point is the inferno's (0 to 1).
  share(ax, az) {
    const w = this.worlds.at(ax, az, this._w);
    const t = w.a === w.b ? 0 : w.t;
    return (w.a === INFERNO ? 1 - t : 0) + (w.b === INFERNO ? t : 0);
  }

  // The surface of the lava at an absolute point, where there is lava there (the land under it), else null.
  lavaAt(ax, az) {
    const L = this.land.lavaLevel ? this.land.lavaLevel(ax, az) : -Infinity;
    if (L === -Infinity) return null;
    return this._h(ax, az) < L - SPLASH.deep ? L : null;
  }

  // --- splashes ------------------------------------------------------------------

  // Splash n, coming while the lens is at absolute (ax, az) looking along (lx, lz) (unit, on the
  // ground), or null where none of the places tried is lava. { n, x, y, z (absolute: where it
  // rises from), drops: [{ vx, vy, vz, t (s it flies), shore (it comes down on the bank: 1),
  // ex, ey, ez (where it comes down, absolute) }] }.
  splash(n, ax, az, lx = 1, lz = 0) {
    const S = SPLASH;
    const seed = this.seed;
    const head = Math.atan2(lz, lx);
    let at = null;
    for (let i = 0; i < S.tries && !at; i++) {
      const front = i < S.tries * S.front;
      const a = front ? head + (hash3(n, 100 + i, seed) - 0.5) * 1.4 : hash3(n, 100 + i, seed) * Math.PI * 2;
      const r = S.reach * Math.sqrt(0.02 + 0.98 * hash3(n, 1000 + i, seed));
      const x = ax + Math.cos(a) * r;
      const z = az + Math.sin(a) * r;
      const L = this.lavaAt(x, z);
      if (L !== null) at = { x, z, L };
    }
    if (!at) return null;
    const y0 = at.L + S.lift;
    // The ground round it, on a grid, for where its drops come down.
    const [N, cell] = S.grid;
    const half = (N - 1) / 2 * cell;
    const gh = new Float64Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) gh[j * N + i] = this._h(at.x - half + i * cell, at.z - half + j * cell);
    const ground = (x, z) => {
      const fx = Math.min(N - 1.0001, Math.max(0, (x - at.x + half) / cell));
      const fz = Math.min(N - 1.0001, Math.max(0, (z - at.z + half) / cell));
      const i = Math.floor(fx);
      const j = Math.floor(fz);
      const tx = fx - i;
      const tz = fz - j;
      const a = gh[j * N + i] + (gh[j * N + i + 1] - gh[j * N + i]) * tx;
      const b = gh[(j + 1) * N + i] + (gh[(j + 1) * N + i + 1] - gh[(j + 1) * N + i]) * tx;
      return a + (b - a) * tz;
    };
    const count = S.drops[0] + Math.floor((S.drops[1] - S.drops[0] + 1) * hash3(n, 180, seed));
    const drops = [];
    for (let k = 0; k < count; k++) {
      const az0 = hash3(n, 200 + k, seed) * Math.PI * 2;
      const el = S.rise[0] + (S.rise[1] - S.rise[0]) * hash3(n, 300 + k, seed);
      const v = S.speed[0] + (S.speed[1] - S.speed[0]) * hash3(n, 400 + k, seed);
      const vx = Math.cos(az0) * Math.cos(el) * v;
      const vz = Math.sin(az0) * Math.cos(el) * v;
      const vy = Math.sin(el) * v;
      // Its way, looked at every step on the way down, to where it meets the lava or the bank.
      // How far over what is under it it is at t (m).
      const over = (t) => y0 + vy * t - 0.5 * S.g * t * t - Math.max(ground(at.x + vx * t, at.z + vz * t), at.L);
      let t = S.step;
      while (t < 8 && over(t + S.step) > 0) t += S.step;
      // Where it crossed, against the land itself (the grid is coarser than a steep bank): from a little before the
      // grid has it, halved twelve times.
      const real = (t) => y0 + vy * t - 0.5 * S.g * t * t - Math.max(this._h(at.x + vx * t, at.z + vz * t), at.L);
      let a = Math.max(S.step, t - 0.1);
      while (a > S.step && real(a) <= 0) a = Math.max(S.step, a - 0.1);
      let b = t + S.step;
      while (b < 8 && real(b) > 0) b += 0.05;
      for (let i = 0; i < 12; i++) {
        const m = (a + b) / 2;
        if (real(m) > 0) a = m;
        else b = m;
      }
      t = b;
      const ey = y0 + vy * t - 0.5 * S.g * t * t;
      const shore = this._h(at.x + vx * t, at.z + vz * t) > at.L ? 1 : 0;
      drops.push({ vx, vy, vz, t, shore, ex: at.x + vx * t, ey, ez: at.z + vz * t });
    }
    return { n, x: at.x, y: y0, z: at.z, L: at.L, drops };
  }

  // --- vents ---------------------------------------------------------------------

  // The vent of the kilometre of road k, or null; undefined where the road is not laid yet.
  // { ax, az, y (its ground), phase (0 to 1), s, side, k }.
  vent(k) {
    if (this.vents.has(k)) return this.vents.get(k);
    const V = VENT;
    const seed = this.seed;
    const s0 = (k + 0.15 + 0.7 * hash3(k, 501, seed)) * V.every;
    if (!this.road.at(s0 - 60) || !this.road.at(s0 + 60)) return undefined;
    let found = null;
    const first = hash3(k, 502, seed) < 0.5 ? -1 : 1;
    for (let n = 0; n < V.tries && !found; n++) {
      const s = s0 + (n >> 1) * 53 * (n % 4 < 2 ? 1 : -1);
      const side = n % 2 === 0 ? first : -first;
      const off = V.off[0] + (V.off[1] - V.off[0]) * hash3(k, 510 + n, seed);
      const p = this.road.at(s);
      if (!p) continue;
      const o = this.road.origin;
      const ax = p.x + o.x - Math.sin(p.theta) * off * side;
      const az = p.z + o.z + Math.cos(p.theta) * off * side;
      if (!this.mine(ax, az, hash3(k, 503, seed))) continue;
      const y = this._h(ax, az);
      const L = this.land.lavaLevel ? this.land.lavaLevel(ax, az) : -Infinity;
      if (L !== -Infinity && y < L + V.above) continue;
      if (Math.abs(y - this.land.heightAt(ax, az)) > 0.3) continue;
      const gx = (this._h(ax + 3, az) - this._h(ax - 3, az)) / 6;
      const gz = (this._h(ax, az + 3) - this._h(ax, az - 3)) / 6;
      if (Math.hypot(gx, gz) > V.steep) continue;
      if (this._nearRoad(ax, az, V.clear)) continue;
      found = { ax, az, y, phase: hash3(k, 504, seed), s, side, k };
    }
    this.vents.set(k, found);
    return found;
  }

  // The vents along the road from s0 to s1 (metres of road), those that are laid.
  ventsAlong(s0, s1, out = []) {
    out.length = 0;
    for (let k = Math.floor(s0 / VENT.every); k <= Math.floor(s1 / VENT.every); k++) {
      const v = this.vent(k);
      if (v) out.push(v);
    }
    return out;
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

  // What is kept of the road before s that has been cut away (the worlds turned).
  forget(s) {
    for (const k of [...this.vents.keys()]) if ((k + 1) * VENT.every > s) this.vents.delete(k);
  }

  // Keep what is near the car only.
  prune(s) {
    for (const k of [...this.vents.keys()]) if (Math.abs((k + 0.5) * VENT.every - s) > 6000) this.vents.delete(k);
  }
}
