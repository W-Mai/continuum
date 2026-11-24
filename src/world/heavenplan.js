// The numbers of what the heaven has of its own, and where and when each of
// them is: the cloud sea's thickness and the ring of colour on it, the cranes
// that fly over it in skeins, the bell of its temples. Each is a pure function
// of its index, the seed and the clock, so the same drive has the same skeins
// and the same bells every time; nothing here touches three.js.
//
//  - The cloud sea is three sheets of the one rolling noise: the sea itself and
//    two thin veils over it, at 6 and 14 m, each read where the line from the
//    lens to the sea passes through it, so that close by they part and show the
//    sea's depth and far off they lie on it as one. Where an island or a pier
//    goes down into it, it goes into the white over MIST m, not at a line.
//  - The ring: round the point of the sea straight away from the sun, two faint
//    rings of colour, blue inside and red outside, as bright at most as GAIN
//    over the cloud.
//  - The cranes: skeins of 5 to 9 in a V, each flying straight and slow, 40 to
//    120 m over the sea, in a box that rides with the lens.
//  - The bell: within 400 m of a temple, one stroke every 20 to 40 seconds.

import { WORLD_INDEX } from './worlds.js';

export const HEAVEN = WORLD_INDEX.heaven;

export function hash3(a, b, c) {
  let h = (Math.imul(a | 0, 0x8da6b343) ^ Math.imul(b | 0, 0xd8163841) ^ Math.imul(c | 0, 0x2545f491)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// The veils: their height over the sea (m), how opaque each is where it is
// thickest, and where in the noise each is read (m, so that the three sheets
// are not the same pattern stacked); mist: the depth (m) over which a thing
// going down into the cloud goes white.
export const SHELLS = [
  { y: 6, opacity: 0.35, shift: [173, -611] },
  { y: 14, opacity: 0.18, shift: [-937, 389] },
];
export const MIST = 8;

// The ring round the point away from the sun: the radius of each ring and its
// width (degrees), and how much brighter than the cloud it is at its brightest.
export const HALO = { rings: [1.2, 2.3], width: 0.4, gain: 0.06 };

// The cranes: how many skeins each tier flies, how many cranes are in one
// (least, most), how wide the V opens (degrees between its arms), the height
// over the sea (m), the speed (m/s), the gap between two along an arm (m), the
// wing beats a second, the span of a crane's wings (m); box: the side of the box
// that rides with the lens (m).
export const CRANES = {
  skeins: { high: 4, mid: 2, low: 0 },
  count: [5, 9], spread: [40, 90], height: [40, 120],
  speed: 11, gap: 5.5, beat: 0.75, span: 2.3, box: 1400,
};

// Skein f (0, 1, ...): how many cranes, how wide its V (radians between the
// arms), how high over the sea, which way it flies (radians from +x toward +z),
// where it starts in the box (0..1, 0..1) and its own phase.
export function skein(f) {
  const c = CRANES;
  const n = c.count[0] + Math.floor(hash3(f, 1, 0x6b) * (c.count[1] - c.count[0] + 1));
  const spread = (c.spread[0] + (c.spread[1] - c.spread[0]) * hash3(f, 2, 0x6b)) * Math.PI / 180;
  return {
    n: Math.min(n, c.count[1]),
    spread,
    height: c.height[0] + (c.height[1] - c.height[0]) * hash3(f, 3, 0x6b),
    heading: hash3(f, 4, 0x6b) * Math.PI * 2,
    at: [hash3(f, 5, 0x6b), hash3(f, 6, 0x6b)],
    phase: hash3(f, 7, 0x6b),
  };
}

// Where crane i of a skein is from its leader: metres back along the way it
// flies, and to its side (+ right of the way, - left). The leader (0) is at the
// point of the V; the others go back along the two arms in turn.
export function placeInSkein(sk, i) {
  if (i === 0) return { back: 0, side: 0 };
  const rank = Math.ceil(i / 2);
  const s = i % 2 ? 1 : -1;
  const half = sk.spread / 2;
  return { back: rank * CRANES.gap * Math.cos(half), side: s * rank * CRANES.gap * Math.sin(half) };
}

// The bell: how near a temple the lens has to be (m), the seconds between two
// strokes (least, most), the first after the lens comes in reach, and the bell
// itself: its pitch (Hz), its five partials (times the pitch), the level of each,
// and how long it takes to die away (s).
export const BELL = {
  reach: 400, apart: [20, 40], first: 3,
  pitch: 196, partials: [0.56, 1, 1.19, 1.71, 2.74], levels: [0.5, 1, 0.55, 0.4, 0.25], decay: 6,
};

// The seconds from stroke n - 1 to stroke n (n from 1) in the heaven of seed.
export function bellGap(n, seed) {
  if (n <= 1) return BELL.first;
  return BELL.apart[0] + (BELL.apart[1] - BELL.apart[0]) * hash3(n, 41, seed | 0);
}

// How loud a stroke is at d metres from its temple, 0 to 1.
export function bellLevel(d) {
  if (!(d < BELL.reach)) return 0;
  return Math.min(1, 1.15 - 0.75 * (d / BELL.reach));
}

// --- the falls off the islands ---------------------------------------------------------
//
// Each island lets one to three thin falls down into the cloud, from where its ground has just come up out of the sea
// and is steeper than 0.7. An island is a piece of the land over the sea's level, found on a lattice of the coarse land:
// the land is cut in tiles, each tile looked at with a margin round it, the pieces over the sea found on the lattice,
// and a piece is the tile's whose highest point is in it (so an island that lies over two tiles is one island, of one
// tile). It is the heaven's by its own draw across a border (as the trees are). Its shore is the cells of it that have a
// cell of sea beside them; from each, in an order of its own draw, the ground is followed down to where it is a metre over
// the sea (the foot) and then up the way it rises most steeply while it is steeper than ISLE.slope: that is the line of
// the fall, from its lip to the cloud. A line that is not ISLE.drop[0] tall, comes within ISLE.off of the road's middle
// or within ISLE.apart of another fall of the island, or looks away from the road, is let go; the island takes its first
// 1 to 3 (its own draw).
//
// tile, margin, grid: the tiles, the margin round each and the lattice (m); slope: the steepness the face keeps to;
// foot: how far over the sea the foot is (m); drop: the least and most height of a fall (m); off: how far the road's
// middle is kept from every point of it (m); apart: from one fall of an island to the next (m); width: from least to
// most (m); step: the spacing of the points of a line (m); least: the fewest cells an island has; face, facing: a fall
// looks toward the road (the cosine of the way it falls against the way to the road's nearest point within `face` m is
// over `facing`), so that it is on the side of its island the road sees.
export const ISLE = {
  tile: 1024, margin: 512, grid: 24, slope: 0.7, foot: 1, drop: [12, 70], off: 30, apart: 80, width: [1.6, 3],
  step: 3, least: 4, count: [1, 3], face: 2500, facing: 0.25,
};

export class HeavenPlan {
  // land, road, worlds as the game has them (absolute coordinates); level: the sea's height.
  constructor({ land, road, worlds, seed, level = 0 }) {
    this.land = land;
    this.road = road;
    this.worlds = worlds;
    this.seed = seed | 0;
    this.level = level;
    this.tiles = new Map();    // tile key -> { islands, falls }
    this._w = { a: 0, b: 0, t: 0, u: 0 };
    this._h = (x, z) => this.land.heightAt(x, z);
  }

  // How steep the land is at an absolute point, and the way down it (a unit vector in out).
  slopeAt(x, z, d = 2.5, out = null) {
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

  // How far the road's middle is from an absolute point, within r (Infinity where none is laid there).
  roadDist(ax, az, r) {
    const road = this.road;
    let dist = Infinity;
    if (!road || !road.forEachSegmentNear) return dist;
    road.forEachSegmentNear(ax, az, r, (i) => {
      const a = road.samples.get(i);
      const b = road.samples.get(i + 1);
      if (!a || !b) return;
      const ex = b.ax - a.ax;
      const ez = b.az - a.az;
      const t = Math.max(0, Math.min(1, ((ax - a.ax) * ex + (az - a.az) * ez) / (ex * ex + ez * ez || 1)));
      dist = Math.min(dist, Math.hypot(ax - (a.ax + ex * t), az - (a.az + ez * t)));
    });
    return dist;
  }

  // The nearest point of the road's middle to an absolute point, within r: { d, x, z }, or null where none is laid there.
  roadPoint(ax, az, r) {
    const road = this.road;
    let best = null;
    if (!road || !road.forEachSegmentNear) return best;
    road.forEachSegmentNear(ax, az, r, (i) => {
      const a = road.samples.get(i);
      if (!a) return;
      const d = Math.hypot(ax - a.ax, az - a.az);
      if (!best || d < best.d) best = { d, x: a.ax, z: a.az };
    });
    return best;
  }

  // The tile an absolute point is in.
  static tileOf(ax, az) {
    return [Math.floor(ax / ISLE.tile), Math.floor(az / ISLE.tile)];
  }

  // The islands and falls of tile (tx, tz): { islands: [{ peak: [x, y, z], cells, falls }], falls: [...] }. A fall is
  // as render/waterfalls.js draws it: { pts (Float64Array of [x, y, z], absolute, from the lip to the foot), n, drop,
  // width, out: [x, z] (the way it falls, a unit vector), key, island, ax, az (the foot), slope (the least steepness of the
  // face) }.
  tile(tx, tz) {
    const key = tx * 100003 + tz;
    let t = this.tiles.get(key);
    if (!t) {
      t = this._tile(tx, tz);
      this.tiles.set(key, t);
    }
    return t;
  }

  // The falls of the tiles within r of an absolute point.
  near(ax, az, r) {
    const out = [];
    const T = ISLE.tile;
    for (let tx = Math.floor((ax - r) / T); tx <= Math.floor((ax + r) / T); tx++) {
      for (let tz = Math.floor((az - r) / T); tz <= Math.floor((az + r) / T); tz++) {
        for (const f of this.tile(tx, tz).falls) out.push(f);
      }
    }
    return out;
  }

  // Let go of the tiles far from a point.
  prune(ax, az, far = 4000) {
    for (const [k, t] of this.tiles) if (Math.hypot(t.cx - ax, t.cz - az) > far) this.tiles.delete(k);
  }

  _tile(tx, tz) {
    const I = ISLE;
    const G = I.grid;
    const x0 = tx * I.tile - I.margin;
    const z0 = tz * I.tile - I.margin;
    const N = Math.round((I.tile + 2 * I.margin) / G) + 1;
    const lvl = this.level;
    const hc = this.land.heightAtCoarse ? (x, z) => this.land.heightAtCoarse(x, z) : this._h;
    const H = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = hc(x0 + i * G, z0 + j * G);
    const label = new Int32Array(N * N).fill(-1);
    const islands = [];
    const falls = [];
    const inTile = (x, z) => x >= tx * I.tile && x < (tx + 1) * I.tile && z >= tz * I.tile && z < (tz + 1) * I.tile;
    for (let s = 0; s < N * N; s++) {
      if (label[s] >= 0 || !(H[s] > lvl)) continue;
      // One piece of land over the sea: its cells, its highest, the cells of its shore.
      const id = islands.length;
      const cells = [];
      const stack = [s];
      label[s] = id;
      let top = s;
      while (stack.length) {
        const c = stack.pop();
        cells.push(c);
        if (H[c] > H[top]) top = c;
        const ci = c % N;
        const cj = (c - ci) / N;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const n = nj * N + ni;
          if (label[n] < 0 && H[n] > lvl) {
            label[n] = id;
            stack.push(n);
          }
        }
      }
      const px = x0 + (top % N) * G;
      const pz = z0 + Math.floor(top / N) * G;
      islands.push(null);
      if (!inTile(px, pz) || cells.length < I.least) continue;
      // The heaven's, by the island's own draw.
      const u = hash3(Math.round(px), Math.round(pz), 61, this.seed);
      const w = this.worlds ? this.worlds.at(px, pz, this._w) : { a: HEAVEN, b: HEAVEN, t: 0 };
      if ((u < w.t ? w.b : w.a) !== HEAVEN) continue;
      const isle = { peak: [px, H[top], pz], cells: cells.length, falls: [], id: hash3(Math.round(px), Math.round(pz), 62, this.seed) };
      islands[id] = isle;
      const want = I.count[0] + Math.floor(hash3(Math.round(px), Math.round(pz), 63, this.seed) * (I.count[1] - I.count[0] + 1));
      const shore = cells.filter((c) => {
        const ci = c % N;
        const cj = (c - ci) / N;
        return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => {
          const ni = ci + di;
          const nj = cj + dj;
          return ni >= 0 && nj >= 0 && ni < N && nj < N && !(H[nj * N + ni] > lvl);
        });
      });
      const order = shore.map((c) => [c, hash3(c, 64, Math.round(px), this.seed)]).sort((a, b) => a[1] - b[1]);
      for (const [c] of order) {
        if (isle.falls.length >= Math.min(want, I.count[1])) break;
        const f = this._fall(x0 + (c % N) * G, z0 + Math.floor(c / N) * G);
        if (!f) continue;
        if (isle.falls.some((g) => Math.hypot(g.ax - f.ax, g.az - f.az) < I.apart)) continue;
        f.key = Math.floor(hash3(c, 65, Math.round(px), this.seed) * 1e6);
        f.island = isle.id;
        isle.falls.push(f);
        falls.push(f);
      }
    }
    return { islands: islands.filter(Boolean), falls, cx: (tx + 0.5) * I.tile, cz: (tz + 0.5) * I.tile };
  }

  // The fall at the shore by an absolute point, or null: down to the foot, then up the face to its lip.
  _fall(x, z) {
    const I = ISLE;
    const h = this._h;
    const lvl = this.level;
    const dir = { x: 0, z: 0 };
    let px = x;
    let pz = z;
    // Down to the foot: a metre over the sea.
    let k = 0;
    for (; k < 40 && h(px, pz) > lvl + I.foot; k++) {
      this.slopeAt(px, pz, 2.5, dir);
      if (dir.x === 0 && dir.z === 0) return null;
      px += dir.x * 1.5;
      pz += dir.z * 1.5;
    }
    if (k >= 40) return null;
    // Up the face, the way it rises most steeply, while it is steeper than ISLE.slope.
    const path = [[px, pz]];
    let least = Infinity;
    for (let i = 0; i < 60; i++) {
      const g = this.slopeAt(px, pz, 2.5, dir);
      if (i > 0 && g < I.slope) break;
      if (i === 0 && this.slopeAt(px - dir.x * 2.5, pz - dir.z * 2.5, 2.5) < I.slope) return null;
      least = Math.min(least, i === 0 ? this.slopeAt(px - dir.x * 2.5, pz - dir.z * 2.5, 2.5) : g);
      px -= dir.x * I.step;
      pz -= dir.z * I.step;
      path.push([px, pz]);
      if (h(px, pz) - lvl - I.foot >= I.drop[1]) break;
    }
    // A last step up a steep face can go past the tallest a fall is: the line starts where it is that tall.
    while (path.length > 4 && h(path[path.length - 1][0], path[path.length - 1][1]) - lvl - I.foot > I.drop[1]) path.pop();
    if (path.length < 4) return null;
    path.reverse();
    const n = path.length;
    const pts = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      pts[i * 3] = path[i][0];
      pts[i * 3 + 1] = h(path[i][0], path[i][1]);
      pts[i * 3 + 2] = path[i][1];
    }
    // The foot is laid on the sea, a little over it, so that its spray stands on the cloud.
    pts[(n - 1) * 3 + 1] = Math.max(pts[(n - 1) * 3 + 1], lvl + I.foot + 0.4);
    const drop = pts[1] - pts[(n - 1) * 3 + 1];
    if (drop < I.drop[0]) return null;
    for (let i = 0; i < n; i++) if (this.roadDist(pts[i * 3], pts[i * 3 + 2], I.off + 10) < I.off) return null;
    const dx = pts[(n - 1) * 3] - pts[0];
    const dz = pts[(n - 1) * 3 + 2] - pts[2];
    const dl = Math.hypot(dx, dz) || 1;
    const ax = pts[(n - 1) * 3];
    const az = pts[(n - 1) * 3 + 2];
    // Facing the road, as the alpine's falls are: the way it falls against the way to the road's nearest point.
    const r = this.roadPoint(ax, az, I.face);
    if (!r || ((dx / dl) * (r.x - ax) + (dz / dl) * (r.z - az)) / (r.d || 1) < I.facing) return null;
    const width = I.width[0] + (I.width[1] - I.width[0]) * hash3(Math.round(ax), Math.round(az), 66, this.seed);
    return { pts, n, drop, width, out: [dx / dl, dz / dl], ax, az, slope: least };
  }
}
