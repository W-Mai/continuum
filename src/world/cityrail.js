// The city's elevated railway: a viaduct that runs beside the road, on one side of it and
// 60 to 120 m off, only where the land is the city's, and the trains that run on it.
//
// Where it runs is worked out from the road, every RAIL.step metres of the road's own length
// (a node): the road's middle averaged over RAIL.window metres before and after (so the
// railway does not follow every bend of the road, and takes its bends wide), and from there
// RAIL.off metres to the side the seed picks, across the averaged way. The deck is RAIL.deck
// over the ground there. A node is the railway's only where both it and the road by it are
// the city's (a share of RAIL.share at least) and the road comes no nearer to it than
// RAIL.clear[0]: between two such nodes is a span of the viaduct, on a pier at each end.
// The road is committed and does not change, so a node is worked out once, as the road is
// laid past it, and stays until the road is cut there (a turn of the worlds, world/turn.js).
// The towers keep off the spans (render/city.js asks `near`).
//
// The trains: one sets out every TRAIN.every seconds of the game's clock, TRAIN.lead metres
// ahead of the car along the railway, and comes toward it at TRAIN.speed, so it goes by the
// car a quarter of a minute later; it is TRAIN.cars carriages of TRAIN.car metres with a gap
// of TRAIN.gap between them. A train is only where there is railway: off its ends it is not
// drawn. All of it is plain numbers, so the checks run it in node.

import { hash1 } from './noise.js';
import { STEP } from './road.js';
import { WORLD_INDEX } from './worlds.js';

export const RAIL = {
  step: 30,          // m of road between two nodes (a pier at each)
  window: 210,       // m of road before and after a node, averaged for the way the railway runs
  off: [72, 100],    // m off the road's averaged middle (the seed picks within this)
  deck: 15,          // m over the ground, the top of the deck
  share: 0.6,        // how much of the city the land is, at least, where it runs
  clear: [60, 120],  // m: the nearest the road may come to a node, and the farthest it may be
  keep: 3200,        // m of road behind the car the nodes are kept for
};

export const TRAIN = {
  every: 40,         // s
  speed: 25,         // m/s
  lead: 800,         // m ahead of the car (along the railway) a train sets out
  life: 70,          // s a train runs for
  cars: 8,
  car: 19,           // m, a carriage
  gap: 1,            // m between two
};
export const TRAIN_LENGTH = TRAIN.cars * (TRAIN.car + TRAIN.gap) - TRAIN.gap;

const CELL = 128;
const cellKey = (cx, cz) => (cx + 1048576) * 2097152 + (cz + 1048576);

export class CityRail {
  // road: world/road.js; land: its land (heightAt, worlds); seed.
  constructor(road, land, seed = 0) {
    this.road = road;
    this.land = land;
    this.worlds = land.worlds;
    this.side = hash1(seed * 7 + 3, 0x7a11) < 0.5 ? -1 : 1;
    this.off = RAIL.off[0] + (RAIL.off[1] - RAIL.off[0]) * hash1(seed * 7 + 5, 0x7a12);
    this.nodes = new Map();      // k -> { k, x, y, z, L, ok, gap }; road length k * step
    this.k0 = 0;                 // the lowest and highest k held (contiguous)
    this.k1 = -1;
    this.cells = new Map();      // CELL grid -> Set of k (the spans k..k+1 that are the railway's)
    this.rev = 0;                // changes when what there is of it does
    this._cuts = road.cuts;
    this._w = { a: 0, b: 0, t: 0, u: 0 };
    this.trains = [];            // { n, a, t0 } a train sets out at t0 with its head at L = a
    this._seen = -1;             // the last train set out (its number)
  }

  share(ax, az) {
    const w = this.worlds.at(ax, az, this._w);
    const city = WORLD_INDEX.city;
    return (w.a === city ? 1 - w.t : 0) + (w.b === city ? w.t : 0);
  }

  // The road's absolute middle at s, or null.
  _roadAt(s) {
    const p = this.road.at(s);
    if (!p) return null;
    return { x: p.x + this.road.origin.x, z: p.z + this.road.origin.z, theta: p.theta };
  }

  // Lay the nodes the road now has room for, and let go of those it has left behind.
  update(sCar) {
    const road = this.road;
    if (road.cuts !== this._cuts) {
      // The road past its cut is gone: so are the nodes that took any of it in.
      this._cuts = road.cuts;
      const from = Math.floor((road.cutAt * STEP - RAIL.window) / RAIL.step);
      while (this.k1 >= this.k0 && this.k1 >= from) this._drop(this.k1--);
      this.rev++;
    }
    const lo = Math.ceil((road.start + RAIL.window) / RAIL.step);
    const hi = Math.floor((road.end - RAIL.window) / RAIL.step);
    if (this.k1 < this.k0) {
      this.k0 = Math.max(lo, Math.floor((sCar - RAIL.keep) / RAIL.step));
      this.k1 = this.k0 - 1;
    }
    // The road laid since, where it comes back near the railway: the spans it comes too near are none.
    if (this._laid === undefined || this._laid < road.first) this._laid = road.first;
    for (; this._laid < road.committed; this._laid += 2) {
      const q = road.samples.get(this._laid);
      if (q && this._spoil(q.ax, q.az)) this.rev++;
    }
    let added = false;
    while (this.k1 < hi) {
      const k = this.k1 + 1;
      const n = this._node(k);
      if (!n) break;
      this.nodes.set(k, n);
      this.k1 = k;
      if (n.ok && this.nodes.get(k - 1) && this.nodes.get(k - 1).ok) this._index(k - 1, true);
      added = true;
    }
    const keepFrom = Math.floor((sCar - RAIL.keep) / RAIL.step);
    while (this.k0 < keepFrom && this.k0 <= this.k1) this._drop(this.k0++);
    if (added) this.rev++;
  }

  _node(k) {
    const s = k * RAIL.step;
    let sx = 0;
    let sz = 0;
    let cx = 0;
    let cz = 0;
    let n = 0;
    for (let d = -RAIL.window; d <= RAIL.window; d += 15) {
      const p = this._roadAt(s + d);
      if (!p) return null;
      sx += p.x;
      sz += p.z;
      cx += Math.cos(p.theta);
      cz += Math.sin(p.theta);
      n++;
    }
    const mx = sx / n;
    const mz = sz / n;
    const l = Math.hypot(cx, cz) || 1;
    // Across the averaged way, to the left of it (as world/road.js's lateral) times the side.
    const nx = -cz / l;
    const nz = cx / l;
    const x = mx + nx * this.off * this.side;
    const z = mz + nz * this.off * this.side;
    const y = this.land.heightAt(x, z) + RAIL.deck;
    // How near the road comes: over the stretch the node is of, and any other part of it that passes by.
    let gap = Infinity;
    for (let d = -400; d <= 400; d += 6) {
      const p = this._roadAt(s + d);
      if (p) gap = Math.min(gap, Math.hypot(p.x - x, p.z - z));
    }
    const road = this.road;
    road.forEachSegmentNear(x, z, RAIL.clear[0], (i) => {
      const q = road.samples.get(i);
      if (q) gap = Math.min(gap, Math.hypot(q.ax - x, q.az - z));
    });
    const here = this._roadAt(s);
    const ok = gap >= RAIL.clear[0] && gap <= RAIL.clear[1]
      && this.share(x, z) >= RAIL.share && this.share(here.x, here.z) >= RAIL.share;
    const prev = this.nodes.get(k - 1);
    const L = prev ? prev.L + Math.hypot(x - prev.x, z - prev.z) : 0;
    return { k, x, y, z, L, ok, gap };
  }

  _index(k, add) {
    const a = this.nodes.get(k);
    const b = this.nodes.get(k + 1);
    if (!a || !b) return;
    const x0 = Math.floor((Math.min(a.x, b.x) - 8) / CELL);
    const x1 = Math.floor((Math.max(a.x, b.x) + 8) / CELL);
    const z0 = Math.floor((Math.min(a.z, b.z) - 8) / CELL);
    const z1 = Math.floor((Math.max(a.z, b.z) + 8) / CELL);
    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        const key = cellKey(i, j);
        let set = this.cells.get(key);
        if (add) {
          if (!set) this.cells.set(key, (set = new Set()));
          set.add(k);
        } else if (set) {
          set.delete(k);
          if (!set.size) this.cells.delete(key);
        }
      }
    }
  }

  // The nodes of the spans nearer than RAIL.clear[0] to an absolute point are the railway's no more.
  _spoil(ax, az) {
    const r = RAIL.clear[0];
    let any = false;
    const i0 = Math.floor((ax - r) / CELL);
    const i1 = Math.floor((ax + r) / CELL);
    const j0 = Math.floor((az - r) / CELL);
    const j1 = Math.floor((az + r) / CELL);
    const hit = [];
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const set = this.cells.get(cellKey(i, j));
        if (!set) continue;
        for (const k of set) {
          const a = this.nodes.get(k);
          const b = this.nodes.get(k + 1);
          if (segDist(ax, az, a.x, a.z, b.x, b.z) < r) hit.push(k);
        }
      }
    }
    for (const k of hit) {
      for (const m of [k, k + 1]) {
        const n = this.nodes.get(m);
        if (!n || !n.ok) continue;
        n.ok = false;
        this._index(m - 1, false);
        this._index(m, false);
        any = true;
      }
    }
    return any;
  }

  _drop(k) {
    this._index(k - 1, false);
    this._index(k, false);
    this.nodes.delete(k);
    this.rev++;
  }

  // Whether the span from node k to the next is the railway's.
  span(k) {
    const a = this.nodes.get(k);
    const b = this.nodes.get(k + 1);
    return !!(a && b && a.ok && b.ok);
  }

  // How far an absolute point is from the railway's middle line (its spans), looked for within r
  // (at most CELL); Infinity if there is none so near.
  near(ax, az, r = 40) {
    let best = Infinity;
    const i0 = Math.floor((ax - r) / CELL);
    const i1 = Math.floor((ax + r) / CELL);
    const j0 = Math.floor((az - r) / CELL);
    const j1 = Math.floor((az + r) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const set = this.cells.get(cellKey(i, j));
        if (!set) continue;
        for (const k of set) {
          const a = this.nodes.get(k);
          const b = this.nodes.get(k + 1);
          best = Math.min(best, segDist(ax, az, a.x, a.z, b.x, b.z));
        }
      }
    }
    return best;
  }

  // The node k whose length along the railway is the last at or before L (binary search), or -1.
  _find(L) {
    let lo = this.k0;
    let hi = this.k1;
    if (hi < lo || L < this.nodes.get(lo).L || L > this.nodes.get(hi).L) return -1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.nodes.get(m).L <= L) lo = m;
      else hi = m;
    }
    return lo;
  }

  // The point of the railway's middle line (the top of the deck) L metres along it, into out
  // ({ x, y, z, ok }: ok if it is on a span of the viaduct); null off its ends.
  at(L, out = {}) {
    const k = this._find(L);
    if (k < 0) return null;
    const a = this.nodes.get(k);
    const b = this.nodes.get(k + 1) || a;
    const t = b.L > a.L ? (L - a.L) / (b.L - a.L) : 0;
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    out.z = a.z + (b.z - a.z) * t;
    out.ok = this.span(k);
    return out;
  }

  // How far along the railway the node of road length s is (between the nodes either side of it).
  lengthAt(s) {
    const f = s / RAIL.step;
    const k = Math.floor(f);
    const a = this.nodes.get(k);
    const b = this.nodes.get(k + 1);
    if (!a || !b) return null;
    return a.L + (b.L - a.L) * (f - k);
  }

  // The trains at a time t (s, the game's clock), the car at road length sCar: sets a train out
  // when its time comes and the car is by the railway, lets go of those that have run their
  // time. Returns the trains, [{ n, head }] (head: L of the front of it; the rest of it is behind,
  // at greater L).
  runTrains(t, sCar) {
    const n = Math.floor(t / TRAIN.every);
    if (n !== this._seen) {
      this._seen = n;
      const carL = this.lengthAt(sCar);
      const k = Math.round(sCar / RAIL.step);
      if (carL !== null && this.span(k) && !this.trains.some((r) => r.n === n)) {
        // A train set out late (the page began between two) is put where it would be by now,
        // the car having come on at the train's own speed.
        const late = t - n * TRAIN.every;
        this.trains.push({ n, a: carL + TRAIN.lead - TRAIN.speed * late, t0: n * TRAIN.every });
      }
    }
    this.trains = this.trains.filter((r) => t - r.t0 < TRAIN.life && t >= r.t0);
    for (const r of this.trains) r.head = r.a - TRAIN.speed * (t - r.t0);
    return this.trains;
  }

  // Forget the trains (the page put the car somewhere else).
  resetTrains() {
    this.trains = [];
    this._seen = -1;
  }
}

export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
