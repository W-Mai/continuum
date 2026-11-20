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
//
// The road is laid in rounds of 400 m: plan, fit the profile, commit, classify.
// A round costs a few milliseconds and now and then twenty, so update() can
// lay it in pieces, a frame's worth at a time (budgetMs): the surveyor gives
// the work back between samples and inside its route search and the design of
// a serpentine, the profile fit between passes. The pieces run in the order
// the whole round does, on the same numbers, so a road comes out the same
// whatever was left half done between two frames, and nothing outside reads
// what is not classified yet.

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
export const MIN_AHEAD = 600;     // ...of which this much at once, whatever it costs
const BEHIND = 2600;              // kept behind, so tiles behind can still carve it
const LEAD = 1000;                // the plan runs this far past the committed end
const REBASE_LIMIT = 20000;
const CELL = 64;
const ROLL_BLOCK = 600;           // samples: where a roller may be laid, one at most
const TAU = Math.PI * 2;
const FIT_PASSES = 8;             // passes of the profile fit between two looks at the clock
// The stages of a round.
const PLAN = 0;
const SOLVE = 1;
const SEAL = 2;                   // commit and classify, in one go

const wallClock = () => performance.now();

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
    this._rolls = new Map();    // the stretches of road that roll, by block (_rollSection)
    this.cutAt = -1;            // the sample the last cut kept
    this.budget = Infinity;     // rounds update() may still lay past MIN_AHEAD (the game sets it a frame)
    this.budgetMs = Infinity;   // ...and the milliseconds it may spend on them
    this.clock = opts.clock || wallClock;   // what it reads the milliseconds by
    this._round = null;         // the round in progress, put down between two pieces: { stage, to }
    this._piece = null;         // ...the surveyor's sample being laid, a generator
    this._fit = null;           // ...and the profile being fitted

    this.ensure(opts.ahead || AHEAD);
  }

  get start() { return this.first * STEP; }
  get end() { return this.classified * STEP; }
  get stats() { return this.surveyor.stats; }

  // --- generation ------------------------------------------------------------

  // Survey, solve, commit and classify until the road is classified to
  // sAhead, in rounds of up to 400 m; at most `rounds` of them, each done in
  // full here and now (a round update() has put down half done is taken up and
  // finished first). Returns how many it did.
  ensure(sAhead, rounds = Infinity) {
    const want = Math.ceil(sAhead / STEP);
    let n = 0;
    for (; (this._round || this.classified < want) && n < rounds; n++) {
      if (!this._round) this._begin();
      this._advance(Infinity);
    }
    return n;
  }

  // The road as it stands at the end of a round: the one in progress, if there
  // is one, finished.
  settle() {
    if (this._round) this._advance(Infinity);
  }

  // --- a round, in pieces ------------------------------------------------------

  _begin() {
    this._round = { stage: PLAN, to: this.committed + Math.ceil((LEAD + 400) / STEP) };
  }

  _late(end) {
    return end !== Infinity && this.clock() >= end;
  }

  // Work on the round in progress until it is finished (true) or the clock
  // reaches `end` (false); it stops between pieces, and does one at least.
  _advance(end) {
    const r = this._round;
    if (r.stage === PLAN) {
      if (!this._planSome(r.to, end)) return false;
      r.stage = SOLVE;
      if (this._late(end)) return false;
    }
    if (r.stage === SOLVE) {
      if (!this._solveSome(end)) return false;
      r.stage = SEAL;
      if (this._late(end)) return false;
    }
    this._commit(Math.min(this.planned - Math.ceil(LEAD / STEP), this.committed + 200));
    this._classify();
    this._round = null;
    return true;
  }

  // Lay road for a frame, past MIN_AHEAD: at most `budget` rounds and for at
  // most `budgetMs`. A round the time runs out on is put down between two
  // pieces and taken up where it was by the next call; one that is due is
  // begun at once, whatever is left of the time.
  _lay(want) {
    if (!this._round) {
      if (this.classified >= want || !(this.budget > 0)) return;
      this._begin();
    }
    const timed = this.budgetMs < Infinity;
    if (timed && !(this.budgetMs > 0)) return;
    const t0 = timed ? this.clock() : 0;
    const end = timed ? t0 + this.budgetMs : Infinity;
    let done = 0;
    for (;;) {
      if (!this._advance(end)) break;
      done++;
      if (done >= this.budget || this._late(end) || this.classified >= want) break;
      this._begin();
    }
    this.budget -= done;
    if (timed) this.budgetMs -= this.clock() - t0;
  }

  // --- cutting ---------------------------------------------------------------

  // Where the road may be cut to be surveyed again from: the first sample at
  // or past arc length sMin in a long run of one kind of road, open ground or
  // viaduct (in the city and over the cloud the road is all viaduct), that
  // the surveyor laid cruising: no tunnel and no serpentine is cut in half.
  // -1 when the committed road has no such place. (The round in progress is
  // finished first, so that this is the road, and the surveyor, as they are at
  // the end of a round, with the worlds as they were while it was laid.)
  cutPoint(sMin) {
    this.settle();
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
    // What was being laid past i goes with the rest of the road past it.
    this._round = null;
    this._piece = null;
    this._fit = null;
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
    // What was settled about the road past the cut is not settled any more.
    for (const [b, sec] of this._rolls) if (!sec || sec.start > i) this._rolls.delete(b);
    this.planned = i;
    this.committed = i;
    this.classified = i;
    this.cuts++;
    this.cutAt = i;
    return dropped;
  }

  // The surveyor lays samples up to index `to`, a piece of one at a time, until
  // it has (true) or the clock reaches `end` (false).
  _planSome(to, end) {
    const sv = this.surveyor;
    for (;;) {
      if (!this._piece) {
        if (this.planned >= to) return true;
        this._piece = sv.pieces();
      }
      const r = this._piece.next();
      if (r.done) {
        this._piece = null;
        this.planned++;
        this.samples.set(this.planned, r.value);
      }
      if (this._late(end)) return !this._piece && this.planned >= to;
    }
  }

  // The profile fit, a few passes at a time, until it is done (true) or the
  // clock reaches `end` (false).
  _solveSome(end) {
    const f = this._fit || (this._fit = this._fitBegin());
    do {
      this._fitRun(f, Math.min(f.iter, f.it + FIT_PASSES));
    } while (f.it < f.iter && !this._late(end));
    if (f.it < f.iter) return false;
    this._fitEnd(f);
    this._fit = null;
    return true;
  }

  // Fit elevations to the uncommitted samples: pull toward the smoothed ground,
  // relax for vertical curves, clamp to the grade limit, keep loop grades.
  // The state of the fit is the object this returns; _fitRun makes its passes.
  _fitBegin() {
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
        // The road without its crests: the rollers are laid on at the end
        // (_commit) and the profile is solved without them.
        Y[i] = smp.y0 !== undefined ? smp.y0 : smp.y;
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

    return {
      i0, n, T, Y, G, lockG, locked, floor, tmp: new Float64Array(n),
      it: 0, iter: this.committed < 0 ? 260 : 120,
    };
  }

  // Passes it to upto - 1 of the fit.
  _fitRun(f, upto) {
    const { n, T, Y, G, lockG, locked, floor, tmp } = f;
    for (let it = f.it; it < upto; it++) {
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
    f.it = upto;
  }

  _fitEnd(f) {
    for (let i = 0; i < f.n; i++) {
      if (!f.locked[i]) this.solution.set(f.i0 + i, f.Y[i]);
    }
  }

  _commit(toIndex) {
    for (let i = this.committed + 1; i <= toIndex; i++) {
      const smp = this.samples.get(i);
      smp.y0 = this.solution.get(i);
      const roll = this._rollAdd(i);
      smp.y = smp.y0 + roll;
      smp.roll = roll !== 0;           // the road rolls here on purpose
      this.solution.delete(i);
    }
    // The sample just past the commit keeps its working elevation, which is
    // good enough for the last grade; the next commit recomputes it.
    const yAt = (i) => {
      if (i <= toIndex) return this.samples.get(i).y;
      const w = this.solution.get(i);
      return (w !== undefined ? w : this.samples.get(i).y) + this._rollAdd(i);
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

  // --- rollers -----------------------------------------------------------------
  //
  // Now and then, on a straight, the road rolls: three to five crests in a row,
  // sixty-odd metres from one to the next and two metres high either way,
  // sharp enough that a car at speed leaves the ground at the top of each
  // (飞坡). The crests are laid on the solved profile when a sample is
  // committed (smp.y = smp.y0 + the roll), so the road, its verge and the land
  // cut and filled to it all see the same road, and the profile solver never
  // sees them. Where they are is the seed's and the road's alone: one stretch
  // at most in a block of ROLL_BLOCK samples, in the worlds that roll (the
  // land's `roll`), only where the plan holds straight and cruising for the
  // whole of it, and not in the first block, where the road starts.

  _rollSection(b) {
    if (this._rolls.has(b)) return this._rolls.get(b);
    if (!this.land.roll || b < 1) return null;
    const rnd = mulberry32((this.seed ^ Math.imul(b + 1, 0x9e3779b1)) >>> 0);
    const start = b * ROLL_BLOCK + 60 + Math.floor(rnd() * (ROLL_BLOCK - 330));
    const lam = 29 + Math.floor(rnd() * 5);
    const n = 3 + Math.floor(rnd() * 3);
    const amp = 1.5 + rnd() * 0.6;
    const draw = rnd();
    const end = start + n * lam;
    // Everything the section needs of the plan has to be there to say yes or no.
    const last = this.samples.get(end + 8);
    const first = this.samples.get(start - 8);
    if (!last || !first) return undefined;
    let sec = null;
    const mid = this.samples.get(start + Math.floor((end - start) / 2));
    if (draw < this.land.roll(mid.ax, mid.az)) {
      sec = { start, end, lam, n, amp };
      for (let j = start - 8; j <= end + 8; j += 2) {
        const p = this.samples.get(j);
        if (!p || p.mode !== 'cruise' || Math.abs(p.kappa) > 0.0035 || !Number.isNaN(p.lockGrade)) {
          sec = null;
          break;
        }
      }
    }
    this._rolls.set(b, sec);
    return sec;
  }

  // How far the roll lifts sample i: nothing outside a section, and the
  // crests grow in over the first hump and out over the last.
  _rollAdd(i) {
    if (!this.land.roll) return 0;
    const sec = this._rollSection(Math.floor(i / ROLL_BLOCK));
    if (!sec || i <= sec.start || i >= sec.end) return 0;
    const u = (i - sec.start) / sec.lam;
    const ramp = (x) => { const t = clamp(x / 0.9, 0, 1); return t * t * (3 - 2 * t); };
    return sec.amp * ramp(u) * ramp(sec.n - u) * Math.sin(u * TAU);
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
      roll: !!(a.roll || b.roll),
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
  // Given `rounds`, that many rounds are done in full. Otherwise, once
  // MIN_AHEAD is classified, the road is laid only as far as `budget` rounds
  // and `budgetMs` milliseconds have left for the frame (the game gives it a
  // little of each a frame), so a road cut to be surveyed again (cut) is laid
  // over a few frames, not in one; short of MIN_AHEAD it is laid in full.
  update(sCar, rounds) {
    if (rounds !== undefined) this.ensure(sCar + AHEAD, rounds);
    else if (this.classified * STEP > sCar + MIN_AHEAD) this._lay(Math.ceil((sCar + AHEAD) / STEP));
    else this.ensure(sCar + AHEAD);
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

  // Whether the road is still short of how far ahead it is kept: being laid
  // again after a cut.
  relaying(sCar) {
    return this.classified * STEP < sCar + AHEAD - 400;
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
