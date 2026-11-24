// Where the deep sea's own things are and how they move: the moving light on
// its floor, the beams that come down from the surface, the bubbles (from the
// car's four pads and from vents in the floor), the jellyfish and the whale.
// Each is a pure function of the land, the road, the seed and the clock, so the
// same place has the same things each time the car comes by; nothing here
// touches three.js. The shaders that draw them (render/abyss.js, the caustic
// chunk in render/atmosphere.js) work the same numbers out the same way.
//
//  - The light on the floor (CAUSTIC) is two cellular patterns 3 m to a cell,
//    each scrolled its own way, the lesser of the two taken: bright threads
//    where both are far from a cell's middle. It is laid from above, in world
//    coordinates, on what faces up; its share of the sun is 1 at 60 m under the
//    surface and 0.3 at 140 m, and it fades out between 90 and 140 m from the lens.
//  - The beams (BEAMS) are long sheets from the surface 80 m down, 6 to 14 m wide,
//    in a box of 640 m that rides with the lens (they end 35 m over the floor, so a
//    lens by the road sees them from far off), each lit by the same pattern where
//    it meets the surface.
//  - A vent (VENT) is one in each 200 m of road, 14 to 40 m off it, on land the
//    road has not shaped; bubbles rise from it as they do from the pads.
//  - A bubble (BUBBLE) rises the whole of its life, faster as it goes, sways from
//    side to side, grows, and is gone at the end.
//  - The jellyfish (JELLY) are 30 in a box of 160 m that rides with the lens, each
//    held in the 22 m over the floor and under the surface.
//  - The whale (WHALE) comes at most once in each 5 km of road: for 50 s a shape
//    25 m long goes over the car, 60 to 120 m above it, 4 m/s faster than the car
//    along the road, and its shadow takes some of the light while it is over.
//
// A vent and a whale belong to the deep sea by their own draw across a border,
// as the trees do, so they thin out as the next world comes in.

import { WORLD_INDEX } from './worlds.js';
import { HALF_FLAT } from './road.js';

export const ABYSS = WORLD_INDEX.abyss;
export const SURFACE = 0;     // the sea's level (render/style.js's SEA_LEVEL)

export function hash3(a, b, c) {
  let h = (Math.imul(a | 0, 0x8da6b343) ^ Math.imul(b | 0, 0xd8163841) ^ Math.imul(c | 0, 0x2545f491)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const fract = (x) => x - Math.floor(x);
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// --- the light on the floor ----------------------------------------------------------

// cell: metres to a cell of each pattern; drift: how each is scrolled (m/s, x and z);
// repeat: the cells to the pattern's repeat (the hash is of the cell's number modulo it); lo, hi: the lesser distance
// to a cell's middle (of a cell) that is no light and all of it, in the sharp threads; soft: the
// same for a soft light under them, and its share (so that the dark between the threads moves too); strength: how far the
// sun's light swings either way of its mean with it; depth: [m under the surface, share]
// at the two ends; fade: the distances from the lens it fades out between (m); up: the
// least of a face's up-ness that has it, and the most.
export const CAUSTIC = {
  cell: 3, drift: [[0.42, 0.26], [-0.32, 0.38]], repeat: 289, lo: 0.35, hi: 0.6, soft: [0.1, 0.6, 0.25], strength: 0.8,
  depth: [[60, 1], [140, 0.3]], fade: [90, 140], up: [0.2, 0.7],
};

// The same hash the shader has (render/atmosphere.js, abHash): fract-based, so it
// is the same in floats and doubles to the last few bits.
export function abHash(x, y, salt = 0) {
  let px = fract(x * 0.1031 + salt);
  let py = fract(y * 0.1030 + salt);
  let pz = fract(x * 0.0973 + salt);
  const d = px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33);
  px += d;
  py += d;
  pz += d;
  return [fract((px + py) * pz), fract((px + pz) * py)];
}

// The distance from (x, y) (in cells) to the nearest middle of a cell; salt: which pattern (0 the first, its own
// hash for the second, so that the two do not lie on each other the same way).
export function cellDist(x, y, salt = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let best = 9;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const R = CAUSTIC.repeat;
      const h = abHash((((ix + i) % R) + R) % R, (((iy + j) % R) + R) % R, salt);
      const dx = ix + i + 0.15 + 0.7 * h[0] - x;
      const dy = iy + j + 0.15 + 0.7 * h[1] - y;
      best = Math.min(best, dx * dx + dy * dy);
    }
  }
  return Math.sqrt(best);
}

// The pattern at an absolute point (x, z) at time t, 0 to 1; one layer only (layers 1) for the mid tier.
export function causticAt(x, z, t, layers = 2) {
  const C = CAUSTIC;
  const ax = x / C.cell + C.drift[0][0] * t / C.cell;
  const az = z / C.cell + C.drift[0][1] * t / C.cell;
  let d = cellDist(ax, az);
  if (layers > 1) {
    // (Turned a quarter round, so that it repeats where the first does.)
    const bx = z / C.cell + C.drift[1][0] * t / C.cell + 17.3;
    const bz = -x / C.cell + C.drift[1][1] * t / C.cell + 5.1;
    d = Math.min(d, cellDist(bx, bz, 0.371));
  }
  return (1 - C.soft[2]) * smoothstep(C.lo, C.hi, d) + C.soft[2] * smoothstep(C.soft[0], C.soft[1], d);
}

// The mean of the pattern over the land (worked out once; the light swings about it, so
// that the floor is no lighter or darker on the whole for having it).
export function causticMean(layers = 2) {
  let m = 0;
  // (Over several moments too: how the two patterns lie on each other changes it by a few hundredths.)
  const n = 90;
  const times = [0, 37, 91, 173, 311, 517];
  for (const t of times) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) m += causticAt(i * 2.731 + 0.13, j * 2.677 + 0.41, t, layers);
  return m / (n * n * times.length);
}

// How much of the swing a point has: by how deep it is (y, m) and how far it is from the lens (m).
export function causticShare(y, dist) {
  const [[d0, k0], [d1, k1]] = CAUSTIC.depth;
  const deep = Math.min(1, Math.max(0, (SURFACE - y - d0) / (d1 - d0)));
  return (k0 + (k1 - k0) * deep) * (1 - smoothstep(CAUSTIC.fade[0], CAUSTIC.fade[1], dist));
}

// The factor on the sun's light at a point: 1 + strength * share * (pattern / mean - 1), for a face
// as up as `up` (the y of its normal).
export function causticLight(x, y, z, t, dist, up = 1, layers = 2, mean = causticMean(layers)) {
  const k = CAUSTIC.strength * causticShare(y, dist) * smoothstep(CAUSTIC.up[0], CAUSTIC.up[1], up);
  return 1 + k * (causticAt(x, z, t, layers) / mean - 1);
}

// --- the beams -------------------------------------------------------------------------

// count: at the high tier; box: metres across of the box they ride in round the lens;
// length: down from the surface (m); width: least and most (m); slant: the way they come
// down, as metres along x and z per metre down; light: their brightness at the top, of the
// sun's colour; fade: how far off they fade into the water (m).
export const BEAMS = { count: 8, box: 640, length: 80, width: [6, 14], slant: [0.22, 0.12], light: 0.1, fade: [220, 300] };

// The beam n of the box: where it stands in the box (0 to 1, x and z), how wide, and its own draw.
export function beamSeed(n, seed) {
  return {
    u: hash3(n, 71, seed), v: hash3(n, 72, seed),
    width: BEAMS.width[0] + (BEAMS.width[1] - BEAMS.width[0]) * hash3(n, 73, seed),
    draw: hash3(n, 74, seed),
  };
}

// Where beam n's top is (absolute x, z) for a lens at (cx, cz): its place in the box,
// wrapped round the lens, so a beam stays where it is in the world as the lens goes on.
export function beamTop(n, seed, cx, cz) {
  const b = beamSeed(n, seed);
  const B = BEAMS.box;
  const wrap = (v, c) => c + (((v - c) % B) + B * 1.5) % B - B / 2;
  return [wrap(b.u * B, cx), wrap(b.v * B, cz)];
}

// How lit a beam is now: the pattern where it meets the surface, read 6 m to a cell (the
// same noise as the floor's, larger), from 0.35 to 1.
export function beamLight(ax, az, t) {
  return 0.35 + 0.65 * causticAt(ax * 0.5, az * 0.5, t * 0.5, 2);
}

// --- bubbles -------------------------------------------------------------------------------

// rate: bubbles a second from each pad (high tier); life: how long one lasts (s); rise: its
// speed up at its start (m/s) and how much faster it goes each second (m/s²); sway: how far
// it goes from side to side (m) and how fast (rad/s); size: its diameter at its start (m)
// and how many times that at its end; slots: the most there are at once. A vent's bubbles
// rise the same way, vent of them a second and ventLife long.
export const BUBBLE = {
  rate: 12, life: 3, rise: [0.6, 0.45], sway: [0.12, 5.5], size: [0.05, 2.2], slots: 512,
  vent: 9, ventLife: 6, pads: [[1.35, 0.71], [1.35, -0.71], [-1.35, 0.71], [-1.35, -0.71]], padY: 0.25,
};

// Where a bubble is, from where it started, at age a (s), with its phase p (0 to 1):
// [dx, dy, dz, its diameter], or null when it has burst (life: how long it lasts).
export function bubbleAt(a, p, life = BUBBLE.life) {
  if (a < 0 || a >= life) return null;
  const B = BUBBLE;
  const ramp = Math.min(1, a / 0.6);
  const w = B.sway[1] * (0.8 + 0.4 * p);
  const ph = p * 6.2832;
  return [
    B.sway[0] * ramp * Math.sin(a * w + ph),
    B.rise[0] * a + 0.5 * B.rise[1] * a * a,
    B.sway[0] * ramp * Math.cos(a * w * 0.83 + ph * 1.7),
    B.size[0] * (1 + (B.size[1] - 1) * (a / life)) * (0.75 + 0.5 * p),
  ];
}

// A bubble's speed up at age a: always more than nothing.
export function bubbleRise(a) {
  return BUBBLE.rise[0] + BUBBLE.rise[1] * a;
}

// --- vents ---------------------------------------------------------------------------------

// every: metres of road to a vent's cell; spread: how far from the middle of the cell it
// stands (half of it either way); lat: the metres off the road it is tried at; reach: how
// far from the lens one gives bubbles (m).
export const VENT = { every: 200, spread: 120, lat: [14, 22, 30, 40], reach: 140 };

// --- the jellyfish ---------------------------------------------------------------------------

// count: at the high tier; box: metres across of the box round the lens; size: the bell's
// width, least and most (m); pulse: the seconds of a beat, least and most; bob: how far each
// goes up and down (m) and the seconds it takes, least and most; floor, top: how close to
// the floor and to the surface one comes (m); band: the height over the floor they keep about
// (m: where a lens by the road sees them); color, glow: its light.
export const JELLY = {
  count: 30, box: 160, size: [0.9, 2.2], pulse: [3, 5], bob: [5, 40, 70], floor: 4, top: 4, band: 22,
  color: 0xc8a0ff, glow: 0.55,
};

// Jellyfish n: its place in the box (u, v: 0 to 1), how high between the floor and the
// surface (h: 0 to 1), its size, the seconds of its beat and of its bob, and its phase.
export function jellySeed(n, seed) {
  const J = JELLY;
  return {
    u: hash3(n, 81, seed), v: hash3(n, 82, seed), h: hash3(n, 83, seed),
    size: J.size[0] + (J.size[1] - J.size[0]) * hash3(n, 84, seed),
    pulse: J.pulse[0] + (J.pulse[1] - J.pulse[0]) * hash3(n, 85, seed),
    bob: J.bob[1] + (J.bob[2] - J.bob[1]) * hash3(n, 86, seed),
    phase: hash3(n, 87, seed), draw: hash3(n, 88, seed),
  };
}

// Where jellyfish n is in the world (absolute x, z) for a lens at (cx, cz).
export function jellyXZ(j, cx, cz) {
  const B = JELLY.box;
  const wrap = (v, c) => c + (((v - c) % B) + B * 1.5) % B - B / 2;
  return [wrap(j.u * B, cx), wrap(j.v * B, cz)];
}

// Its height at time t over floor `ground` (m): somewhere in the JELLY.band metres over the floor
// by its own draw, going slowly up and down, never nearer the floor than JELLY.floor nor the
// surface than JELLY.top.
export function jellyY(j, ground, t) {
  const J = JELLY;
  const lo = ground + J.floor + J.size[1];
  const hi = SURFACE - J.top - J.size[1];
  if (hi <= lo) return null;
  const mid = lo + Math.min(hi - lo, J.band) * (0.1 + 0.8 * j.h);
  const y = mid + J.bob[0] * Math.sin((t / j.bob + j.phase) * 6.2832);
  return Math.min(hi, Math.max(lo, y));
}

// How far its bell is drawn in at time t: 0 open, 1 drawn in.
export function jellyBeat(j, t) {
  const f = fract(t / j.pulse + j.phase);
  // Drawn in quickly, opened slowly.
  return f < 0.3 ? smoothstep(0, 0.3, f) : 1 - smoothstep(0.3, 1, f);
}

// --- the whale --------------------------------------------------------------------------------

// every: metres of road to a whale's cell; from, to: where in the cell it may come (m);
// length: of the whale (m); over: how far above the car, least and most (m); speed: how much
// faster than the car it goes along the road (m/s); time: how long it is about (s); lat: how
// far to the side of the road (m, either way); under: the least depth of its back under the
// surface (m); shade: the most of the light its shadow takes; near, far: the distance along
// the road, behind or ahead of the car, inside which it is all of its shadow and beyond which
// none; call: the second of its pass at which it calls.
export const WHALE = {
  every: 5000, from: 600, to: 4200, length: 25, over: [60, 120], speed: 4, time: 50, lat: 26,
  under: 6, shade: 0.3, near: 25, far: 70, call: 18,
};

// The whale of the 5 km of road k: the road's place s it comes at, how far above the car,
// to which side, and its own draw; it comes at most once in those 5 km.
export function whaleSeed(k, seed) {
  const W = WHALE;
  return {
    k,
    s: k * W.every + W.from + (W.to - W.from) * hash3(k, 91, seed),
    over: W.over[0] + (W.over[1] - W.over[0]) * hash3(k, 92, seed),
    side: hash3(k, 93, seed) < 0.5 ? -1 : 1,
    draw: hash3(k, 94, seed),
  };
}

// Where the whale is along the road from the car, `tau` seconds into its pass (m: behind is less
// than 0), and how much of its shadow is on the car then (0 to 1).
export function whaleOffset(tau) {
  const W = WHALE;
  return -0.5 * W.speed * W.time + W.speed * tau;
}

export function whaleShade(tau) {
  const W = WHALE;
  if (tau < 0 || tau > W.time) return 0;
  const d = Math.abs(whaleOffset(tau));
  return 1 - smoothstep(W.near, W.far, d);
}

export class AbyssPlan {
  // road, worlds, groundAt (absolute x, z: the land's height), corridor (to know the land the
  // road has shaped), seed.
  constructor({ road, worlds, land, corridor, seed }) {
    this.road = road;
    this.worlds = worlds;
    this.land = land;
    this.corridor = corridor;
    this.seed = seed | 0;
    this._w = { a: 0, b: 0, t: 0, u: 0 };
    this.vents = new Map();
    this.mean = [causticMean(1), causticMean(2)];
  }

  // Whether a thing at an absolute point, with its own draw u (0 to 1), is the deep sea's.
  mine(ax, az, u) {
    const w = this.worlds.at(ax, az, this._w);
    return (u < w.t ? w.b : w.a) === ABYSS;
  }

  // How much of the world at an absolute point is the deep sea's.
  share(ax, az) {
    const w = this.worlds.at(ax, az, this._w);
    const t = w.a === w.b ? 0 : w.t;
    return (w.a === ABYSS ? 1 - t : 0) + (w.b === ABYSS ? t : 0);
  }

  // The vent of the 200 m of road k, or null; undefined where the road is not laid yet.
  // { ax, az, y (the floor there), s, side, lat, key }.
  vent(k) {
    if (this.vents.has(k)) return this.vents.get(k);
    const V = VENT;
    const road = this.road;
    const o = road.origin;
    const s0 = (k + 0.5) * V.every + (hash3(k, 61, this.seed) - 0.5) * V.spread;
    if (!road.at(s0 - 30) || !road.at(s0 + 30)) return undefined;
    let found = null;
    const first = hash3(k, 62, this.seed) < 0.5 ? -1 : 1;
    for (let n = 0; n < 8 && !found; n++) {
      const side = n % 2 === 0 ? first : -first;
      const lat = V.lat[n >> 1];
      const p = road.at(s0);
      const ax = p.x + o.x - Math.sin(p.theta) * lat * side;
      const az = p.z + o.z + Math.cos(p.theta) * lat * side;
      if (!this.mine(ax, az, hash3(k, 63, this.seed))) break;
      // On the land as it was, clear of the road and of what the road has shaped.
      if (lat < HALF_FLAT + 8) continue;
      const y = this.land.heightAt(ax, az);
      if (this.corridor && Math.abs(this.corridor.heightAt(ax, az) - y) > 0.05) continue;
      if (y > SURFACE - 8) continue;
      found = { ax, az, y, s: s0, side, lat, key: k };
    }
    this.vents.set(k, found);
    return found;
  }

  // The vents within `reach` of an absolute point, by the road near s.
  ventsNear(ax, az, s, reach = VENT.reach, out = []) {
    out.length = 0;
    const k0 = Math.floor((s - reach - VENT.spread) / VENT.every);
    const k1 = Math.floor((s + reach + VENT.spread) / VENT.every);
    for (let k = k0; k <= k1; k++) {
      const v = this.vent(k);
      if (v && Math.hypot(v.ax - ax, v.az - az) < reach) out.push(v);
    }
    return out;
  }

  // The whale of the 5 km of road k, or null where the road there is not the deep sea's (by the
  // whale's own draw) or is not laid yet.
  whale(k) {
    const w = whaleSeed(k, this.seed);
    const p = this.road.at(w.s);
    if (!p) return null;
    const o = this.road.origin;
    return this.mine(p.x + o.x, p.z + o.z, w.draw) ? w : null;
  }

  // The plans of the road far behind are let go of.
  prune(s) {
    for (const k of this.vents.keys()) if ((k + 1) * VENT.every < s - 2000) this.vents.delete(k);
  }
}
