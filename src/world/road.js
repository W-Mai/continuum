// The road, surveyed across the land instead of laid over it.
//
// The surveyor (surveyor.js) decides where the centreline goes: valleys,
// saddles, serpentines, the odd spiral. Behind it a profile solver fits a
// smooth, grade-limited elevation to the ground, and the result is classified:
// where the road stands well clear of the land it becomes a bridge, where it
// runs deep under the land a tunnel, and where it passes over itself the upper
// level is always a bridge.
//
// Once a stretch is committed it never changes. The road mesh, the terrain
// corridor, the physics and the autopilot all read the same committed samples,
// so nothing that is drawn can disagree with what is driven.

import { clamp, mulberry32 } from './noise.js';
import { Surveyor, STEP } from './surveyor.js';

export { STEP };
export const LANE = 1.9;          // lane centre from the centreline
export const HALF_PAVED = 4.6;    // asphalt edge
export const HALF_FLAT = 6.4;     // verge: where the platform meets cut or fill
export const DECK_DEPTH = 2.3;    // bridge girder below the running surface
export const GROUND = 0;
export const BRIDGE = 1;
export const TUNNEL = 2;

const AHEAD = 6500;               // committed road kept ahead of the car
const MIN_AHEAD = 2000;           // ...of which this much at once, whatever it costs
const BEHIND = 2600;              // kept behind, so tiles behind can still carve it
const LEAD = 1000;                // the plan runs this far past the committed end
const REBASE_LIMIT = 20000;
const CELL = 64;
const TAU = Math.PI * 2;

export class Road {
  constructor(land, seed = 0, opts = {}) {
    this.land = land;
    this.seed = seed;
    this.origin = { x: 0, z: 0 };
    this.rebases = 0;
    this.samples = new Map();   // index -> sample
    this.cells = new Map();     // grid cell -> segment start indices
    this.first = 0;             // lowest live index
    this.planned = -1;          // last index with horizontal alignment
    this.committed = -1;        // last index with final elevation
    this.classified = -1;       // last index with a final structure kind
    this.solution = new Map();  // working elevations for uncommitted samples

    // Start in a valley near a seeded spot, heading somewhere seeded.
    const rand = mulberry32(seed ^ 0x9a7e);
    const cx = (rand() - 0.5) * 2e5;
    const cz = (rand() - 0.5) * 2e5;
    let bx = cx;
    let bz = cz;
    let bh = Infinity;
    for (let i = -6; i <= 6; i++) {
      for (let j = -6; j <= 6; j++) {
        const x = cx + i * 300;
        const z = cz + j * 300;
        const h = land.heightAtCoarse(x, z);
        if (h < bh) {
          bh = h;
          bx = x;
          bz = z;
        }
      }
    }
    this.origin.x = bx;
    this.origin.z = bz;
    const theta0 = rand() * TAU;
    // The worlds are laid out along the way the road sets out.
    if (land.setAxis) land.setAxis(bx, bz, theta0);
    this.surveyor = new Surveyor(land, seed, bx, bz, theta0);
    const sv = this.surveyor;
    this.samples.set(0, {
      ax: bx, az: bz, theta: sv.theta, kappa: 0, g: sv.yPlan, gmax: 0.08,
      lockGrade: NaN, mode: 'cruise',
      y: 0, grade: 0, bank: 0, kind: GROUND, gl: sv.yPlan, gr: sv.yPlan,
    });
    this.planned = 0;
    this._lastPrune = 0;
    this.cuts = 0;              // how many times the road ahead was dropped and surveyed again
    this.cutAt = -1;            // the sample the last cut kept

    this.ensure(opts.ahead || AHEAD);
  }

  get start() { return this.first * STEP; }
  get end() { return this.classified * STEP; }
  get stats() { return this.surveyor.stats; }

  // --- generation ------------------------------------------------------------

  // Survey, solve, commit and classify until the road is classified to
  // sAhead, in rounds of up to 400 m; at most `rounds` of them.
  ensure(sAhead, rounds = Infinity) {
    const want = Math.ceil(sAhead / STEP);
    for (let n = 0; this.classified < want && n < rounds; n++) {
      this._plan(this.committed + Math.ceil((LEAD + 400) / STEP));
      this._solve();
      this._commit(Math.min(this.planned - Math.ceil(LEAD / STEP), this.committed + 200));
      this._classify();
    }
  }

  // --- cutting ---------------------------------------------------------------

  // Where the road may be cut to be surveyed again from: the first sample at
  // or past arc length sMin in a long run of one kind of road, open ground or
  // viaduct (in the city and over the cloud the road is all viaduct), that
  // the surveyor laid cruising: no tunnel and no serpentine is cut in half.
  // -1 when the committed road has no such place.
  cutPoint(sMin) {
    const PAD = 30;
    const i0 = Math.max(this.first + PAD, Math.ceil(sMin / STEP));
    let run = 0;
    let kind = -1;
    for (let i = i0 - PAD; i <= this.classified; i++) {
      const p = this.samples.get(i);
      const ok = p && p.kind !== TUNNEL && p.mode === 'cruise';
      run = ok && p.kind === kind ? run + 1 : ok ? 1 : 0;
      kind = ok ? p.kind : -1;
      if (run > 2 * PAD && i - PAD >= i0) return i - PAD;
    }
    return -1;
  }

  // Drop the road past sample i and survey it again from there, the worlds
  // ahead having changed (Game._turn). Returns the dropped samples' absolute
  // positions, flat: x, z, x, z...
  cut(i) {
    const dropped = [];
    for (let k = i + 1; k <= this.planned; k++) {
      const p = this.samples.get(k);
      if (p) dropped.push(p.ax, p.az);
      this.samples.delete(k);
    }
    this.solution.clear();
    for (const [key, list] of this.cells) {
      const kept = list.filter((j) => j < i);
      if (kept.length) this.cells.set(key, kept);
      else this.cells.delete(key);
    }
    let lastStack = -1e9;
    for (let k = i; k >= Math.max(this.first, i - 400); k--) {
      if (this.samples.get(k).mode !== 'cruise') {
        lastStack = k * STEP;
        break;
      }
    }
    this.surveyor = Surveyor.resume(this.surveyor, this.samples.get(i), i, this.seed, lastStack);
    this.planned = i;
    this.committed = i;
    this.classified = i;
    this.cuts++;
    this.cutAt = i;
    return dropped;
  }

  _plan(toIndex) {
    while (this.planned < toIndex) {
      const smp = this.surveyor.step();
      this.planned++;
      this.samples.set(this.planned, smp);
    }
  }

  // Fit elevations to the uncommitted samples: pull toward the smoothed ground,
  // relax for vertical curves, clamp to the grade limit, keep loop grades.
  _solve() {
    const tail = 40;
    const i0 = Math.max(this.first, this.committed - tail);
    const i1 = this.planned;
    const n = i1 - i0 + 1;
    const T = new Float64Array(n);
    const Y = new Float64Array(n);
    const G = new Float64Array(n);
    const lockG = new Float64Array(n);
    const locked = new Uint8Array(n);
    const ground = new Float64Array(n);
    const floor = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      const smp = this.samples.get(i0 + i);
      // On a serpentine the target is the surveyor's own grade line, which the
      // legs were designed against: relaxing toward the raw ground there would
      // let the solver shortcut a flight through the hill and bury hairpins.
      // Elsewhere it is the design target: the ground, or bridge height over
      // water.
      const tgt = smp.t === undefined ? smp.g : smp.t;
      ground[i] = smp.mode === 'cruise' ? tgt : smp.yPlan;
      G[i] = smp.gmax;
      lockG[i] = smp.lockGrade;
      floor[i] = this.land.floorAt ? this.land.floorAt(smp.ax, smp.az) : -Infinity;
      if (i0 + i <= this.committed) {
        Y[i] = smp.y;
        locked[i] = 1;
      } else {
        const prev = this.solution.get(i0 + i);
        Y[i] = prev !== undefined ? prev : tgt + 0.6;
      }
    }
    // Ground smoothed over 40 m either side: small humps become cuts and fills,
    // not bumps in the road.
    const R = 20;
    let acc = 0;
    let cnt = 0;
    for (let i = 0; i < Math.min(n, R); i++) {
      acc += ground[i];
      cnt++;
    }
    for (let i = 0; i < n; i++) {
      if (i + R < n) {
        acc += ground[i + R];
        cnt++;
      }
      if (i - R - 1 >= 0) {
        acc -= ground[i - R - 1];
        cnt--;
      }
      T[i] = acc / cnt + 0.6;
    }

    const tmp = new Float64Array(n);
    const ITER = this.committed < 0 ? 260 : 120;
    for (let it = 0; it < ITER; it++) {
      for (let i = 0; i < n; i++) {
        if (locked[i] || i === 0 || i === n - 1) {
          tmp[i] = Y[i];
          continue;
        }
        const lap = 0.5 * (Y[i - 1] + Y[i + 1]) - Y[i];
        tmp[i] = Y[i] + 0.5 * lap + 0.06 * (T[i] - Y[i]);
      }
      Y.set(tmp);
      if (n > 1 && !locked[n - 1]) Y[n - 1] = Y[n - 2] + (T[n - 1] - T[n - 2]);
      // Backward then forward, so the join with the committed road holds;
      // neither may take the road under a liquid that shows (floor).
      for (let i = n - 2; i >= 0; i--) {
        if (locked[i]) continue;
        const g = Math.min(G[i], G[i + 1]) * STEP;
        Y[i] = Math.max(floor[i], clamp(Y[i], Y[i + 1] - g, Y[i + 1] + g));
      }
      for (let i = 1; i < n; i++) {
        if (locked[i]) continue;
        if (!Number.isNaN(lockG[i])) {
          Y[i] = Y[i - 1] + lockG[i] * STEP;
          continue;
        }
        const g = Math.min(G[i], G[i - 1]) * STEP;
        Y[i] = Math.max(floor[i], clamp(Y[i], Y[i - 1] - g, Y[i - 1] + g));
      }
    }
    for (let i = 0; i < n; i++) {
      if (!locked[i]) this.solution.set(i0 + i, Y[i]);
    }
  }

  _commit(toIndex) {
    for (let i = this.committed + 1; i <= toIndex; i++) {
      const smp = this.samples.get(i);
      smp.y = this.solution.get(i);
      this.solution.delete(i);
    }
    // The sample just past the commit keeps its working elevation, which is
    // good enough for the last grade; the next commit recomputes it.
    const yAt = (i) => {
      if (i <= toIndex) return this.samples.get(i).y;
      const w = this.solution.get(i);
      return w !== undefined ? w : this.samples.get(i).y;
    };
    const fromGrade = Math.max(this.committed, this.first);
    for (let i = fromGrade; i <= toIndex; i++) {
      const b = this.samples.get(i);
      const ya = i > this.first ? this.samples.get(i - 1).y : b.y;
      const span = i > this.first ? 2 * STEP : STEP;
      b.grade = (yAt(i + 1) - ya) / span;
      if (i > this.committed) {
        b.bank = clamp(b.kappa * 9, -0.075, 0.075);
        const nx = -Math.sin(b.theta);
        const nz = Math.cos(b.theta);
        b.gl = this.land.heightAt(b.ax - nx * HALF_PAVED, b.az - nz * HALF_PAVED);
        b.gr = this.land.heightAt(b.ax + nx * HALF_PAVED, b.az + nz * HALF_PAVED);
      }
    }
    // Segments [i, i+1] whose two ends are now final.
    for (let i = fromGrade; i < toIndex; i++) this._index(i);
    this.committed = toIndex;
  }

  _cellKey(cx, cz) {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  _index(i) {
    const a = this.samples.get(i);
    const b = this.samples.get(i + 1);
    if (!a || !b) return;
    const cx = Math.floor((a.ax + b.ax) * 0.5 / CELL);
    const cz = Math.floor((a.az + b.az) * 0.5 / CELL);
    const key = this._cellKey(cx, cz);
    let list = this.cells.get(key);
    if (!list) {
      list = [];
      this.cells.set(key, list);
    }
    list.push(i);
  }

  // Visit committed segments [i, i+1] whose midpoint lies within `r` (plus a
  // cell) of an absolute point.
  forEachSegmentNear(ax, az, r, fn) {
    const c0x = Math.floor((ax - r - 2) / CELL);
    const c1x = Math.floor((ax + r + 2) / CELL);
    const c0z = Math.floor((az - r - 2) / CELL);
    const c1z = Math.floor((az + r + 2) / CELL);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const list = this.cells.get(this._cellKey(cx, cz));
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          if (i < this.first || i >= this.committed) continue;
          fn(i);
        }
      }
    }
  }

  // Structures. A bridge wherever the road would stand well clear of the land,
  // or over another part of itself; a tunnel wherever the land stands well
  // above it across its whole width. Short structures become cuts and fills,
  // short gaps between two of the same kind are bridged or bored through,
  // which is what real engineers do with them too.
  _classify() {
    const from = this.classified + 1;
    const to = this.committed - 80;
    if (to < from) return;
    const look = this.committed;
    const cand = new Uint8Array(look - from + 1);
    const prev = this.classified >= 0 ? this.samples.get(this.classified).kind : GROUND;
    let inBridge = prev === BRIDGE;
    let inTunnel = prev === TUNNEL;
    for (let i = from; i <= look; i++) {
      const smp = this.samples.get(i);
      // Weighted toward the high side, but a road hanging off a steep hillside
      // on one edge still becomes a hillside viaduct rather than a 30 m fill.
      const hiG = Math.max(smp.g, smp.gl, smp.gr);
      const loG = Math.min(smp.g, smp.gl, smp.gr);
      const clear = smp.y - (0.6 * hiG + 0.4 * loG);
      const cover = loG - smp.y;
      let over = false;
      this.forEachSegmentNear(smp.ax, smp.az, 10, (j) => {
        if (over || Math.abs(j - i) < 60) return;
        const o = this.samples.get(j);
        const d = Math.hypot(o.ax - smp.ax, o.az - smp.az);
        if (d < HALF_FLAT + 4 && o.y < smp.y - 6) over = true;
      });
      inTunnel = inTunnel ? cover > 11 : cover > 20;
      if (inBridge) inBridge = clear > 3.2 || over;
      else inBridge = clear > 7 || over;
      cand[i - from] = inTunnel && !over ? TUNNEL : inBridge ? BRIDGE : GROUND;
    }
    // Run-length clean-up with the lookahead we have.
    const MIN = { [BRIDGE]: 20, [TUNNEL]: 26 };       // samples: 40 m, 52 m
    const GAP = { [BRIDGE]: 16, [TUNNEL]: 30 };       // samples: 32 m, 60 m
    const runs = [];
    let k = 0;
    while (k < cand.length) {
      let e = k;
      while (e + 1 < cand.length && cand[e + 1] === cand[k]) e++;
      runs.push([k, e, cand[k]]);
      k = e + 1;
    }
    for (let r = 0; r < runs.length; r++) {
      const [a, b, v] = runs[r];
      const len = b - a + 1;
      const isLast = r === runs.length - 1;
      const isFirst = r === 0 && from > 0;
      if (isLast || isFirst) continue;
      if (v !== GROUND && len < MIN[v]) cand.fill(GROUND, a, b + 1);
      else if (v === GROUND && r > 0 && r < runs.length - 1) {
        const before = runs[r - 1][2];
        const after = runs[r + 1][2];
        if (before === after && before !== GROUND && len < GAP[before]) cand.fill(before, a, b + 1);
      }
    }
    for (let i = from; i <= to; i++) this.samples.get(i).kind = cand[i - from];
    this.classified = to;
  }

  // --- queries ----------------------------------------------------------------

  // Interpolated frame at arc length s, in local (rebased) coordinates.
  at(s) {
    const f = s / STEP;
    const i = Math.floor(f);
    const a = this.samples.get(i);
    if (!a || i > this.classified) return null;
    const b = this.samples.get(i + 1) || a;
    const t = f - i;
    return {
      x: a.ax + (b.ax - a.ax) * t - this.origin.x,
      z: a.az + (b.az - a.az) * t - this.origin.z,
      y: a.y + (b.y - a.y) * t,
      theta: a.theta + (b.theta - a.theta) * t,
      kappa: a.kappa + (b.kappa - a.kappa) * t,
      grade: a.grade + (b.grade - a.grade) * t,
      bank: a.bank + (b.bank - a.bank) * t,
      kind: t < 0.5 ? a.kind : b.kind,
    };
  }

  // Running surface at a lateral offset (positive toward the left normal).
  surfaceAt(s, lateral) {
    const p = this.at(s);
    if (!p) return 0;
    return p.y - p.bank * clamp(lateral, -HALF_FLAT, HALF_FLAT);
  }

  lateralOf(s, x, z) {
    const p = this.at(s);
    if (!p) return 0;
    return (x - p.x) * -Math.sin(p.theta) + (z - p.z) * Math.cos(p.theta);
  }

  roadSurfaceAt(s, x, z) {
    return this.surfaceAt(s, this.lateralOf(s, x, z));
  }

  // Arc length closest to a local point, searched near a hint. A wide search
  // would find the wrong level wherever the road passes over itself.
  nearestS(x, z, sHint, span = 40) {
    const ax = x + this.origin.x;
    const az = z + this.origin.z;
    const lo = Math.max(this.first, Math.floor((sHint - span) / STEP));
    const hi = Math.min(this.classified - 1, Math.ceil((sHint + span) / STEP));
    let best = -1;
    let bestD = Infinity;
    for (let i = lo; i <= hi; i++) {
      const p = this.samples.get(i);
      const d = (p.ax - ax) ** 2 + (p.az - az) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return { s: sHint, dist: Infinity };
    // Project onto the neighbouring segment for a continuous answer.
    let s = best * STEP;
    for (const j of [best - 1, best]) {
      const a = this.samples.get(j);
      const b = this.samples.get(j + 1);
      if (!a || !b) continue;
      const ex = b.ax - a.ax;
      const ez = b.az - a.az;
      const t = ((ax - a.ax) * ex + (az - a.az) * ez) / (ex * ex + ez * ez);
      if (t >= 0 && t <= 1) {
        s = (j + t) * STEP;
        const px = a.ax + ex * t;
        const pz = a.az + ez * t;
        bestD = (px - ax) ** 2 + (pz - az) ** 2;
        break;
      }
    }
    return { s, dist: Math.sqrt(bestD) };
  }

  maxCurvatureAhead(sFrom, span) {
    let m = 0;
    for (let s = sFrom; s <= sFrom + span; s += STEP) {
      const p = this.samples.get(Math.floor(s / STEP));
      if (p) m = Math.max(m, Math.abs(p.kappa));
    }
    return m;
  }

  // Keep the window around the car and move the origin when it drifts far.
  // Once 2 km ahead are classified, at most two rounds a frame, so a road
  // cut to be surveyed again (cut) is laid over a few frames, not in one.
  update(sCar, rounds) {
    const lim = rounds !== undefined ? rounds : this.classified * STEP > sCar + MIN_AHEAD ? 2 : Infinity;
    this.ensure(sCar + AHEAD, lim);
    const keepFrom = Math.floor((sCar - BEHIND) / STEP);
    while (this.first < keepFrom) {
      this.samples.delete(this.first);
      this.first++;
    }
    if (this.first - this._lastPrune > 512) {
      this._lastPrune = this.first;
      this._pruneCells();
    }
    return this._maybeRebase(sCar);
  }

  _pruneCells() {
    for (const [key, list] of this.cells) {
      const kept = list.filter((i) => i >= this.first);
      if (kept.length) this.cells.set(key, kept);
      else this.cells.delete(key);
    }
  }

  _maybeRebase(sCar) {
    const p = this.at(sCar);
    if (!p || Math.hypot(p.x, p.z) < REBASE_LIMIT) return null;
    const dx = p.x;
    const dz = p.z;
    this.origin.x += dx;
    this.origin.z += dz;
    this.rebases++;
    return { dx, dz };
  }
}

// How fast a bend can be driven at a given lateral acceleration.
export function cornerSpeed(kappa, lateralG = 0.45) {
  const k = Math.max(Math.abs(kappa), 1e-4);
  return Math.sqrt(lateralG * 9.81 / k);
}
