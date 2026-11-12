// The surveyor: decides where the road goes.
//
// Two levels, like a real alignment study. A route search over the coarse land
// (A* on a 100 m grid) finds the corridor: along valley floors, over saddles
// rather than summits, round a massif when going round is cheaper than going
// over. Then a steering pass lays the actual centreline along that corridor
// with bounded curvature. Wherever the corridor climbs (or falls) faster than a
// road can, the climb is designed as a serpentine before any of it is laid: a
// program of straight legs, each leaning off the contour toward the top and
// ending in a hairpin onto the mirror heading. Every leg and every hairpin
// advances along the line to the top, so the flight cannot cross itself, and
// each leg is chosen by dry-running the real steering law over the land, so
// the hairpins sit on the hillside instead of inside it.
//
// Output is one sample every STEP metres in absolute world coordinates, plus a
// rough elevation guess the profile solver starts from.

import { makeSimplex, fbm, clamp, mulberry32 } from './noise.js';

export const STEP = 2;
export const G_ROAD = 0.08;       // grade a mountain road holds
export const G_LEG = 0.095;       // grade on serpentine legs
const G_HAIRPIN = 0.06;           // hairpins are laid flatter

const TAU = Math.PI * 2;
export const wrap = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};

// Curvature design, metres.
const R_MIN = 55;
const K_MAX = 1 / R_MIN;
const DK_CRUISE = K_MAX / 34;     // a 34 m clothoid to full lock
const LAG = 18;                   // metres for curvature to settle on its target
const K_HEAD = 1 / 60;            // heading error to curvature
const K_LEG = 1 / 30;             // tighter heading hold on serpentine legs
const R_HAIRPIN = 14;
const DK_HAIRPIN = (1 / R_HAIRPIN) / 16;

// Serpentine design: each leg leans this far off the contour toward the top
// (radians), and runs one of these lengths (metres) before its hairpin.
const LEG_ALPHAS = [0.04, 0.09, 0.16, 0.26, 0.4];
const LEG_LENGTHS = [30, 55, 85, 120, 160, 205, 255, 310, 370];
const MAX_LEGS = 40;
const LEG_ABORT = 120;            // cost past which a leg cannot be laid on this land

// Route search grid.
const CELLM = 100;
const NU = 62;
const NV = 61;
const I0 = 2;                     // cells behind the start the search may use
const LOOK = 120;                 // pure-pursuit lookahead along the route

class Heap {
  constructor() {
    this.k = [];
    this.v = [];
  }

  push(key, val) {
    const k = this.k;
    const v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }

  pop() {
    const k = this.k;
    const v = this.v;
    const top = v[0];
    const lk = k.pop();
    const lv = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && k[r] < k[l] ? r : l;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }

  get size() {
    return this.k.length;
  }
}

// One step of the steering law, shared by the real surveyor and the serpentine
// designer's dry runs, so a designed leg is laid exactly as it was simulated.
// Cruise and leg modes hold a heading through a clothoid-limited curvature;
// a hairpin ramps to full lock, holds, and ramps out onto its target heading.
function steer(st, ds) {
  let k = st.kappa;
  if (st.mode === 'cruise' || st.mode === 'leg') {
    const gain = st.mode === 'leg' ? K_LEG : K_HEAD;
    const want = clamp(gain * wrap(st.thetaTarget - st.theta), -K_MAX, K_MAX);
    k += clamp((want - k) * ds / LAG, -DK_CRUISE * ds, DK_CRUISE * ds);
  } else {
    const t = st.turn;
    // Angle still to turn, and the angle the ramp-out itself will take. The
    // ramp-out is latched once it starts, or the two estimates can cross back
    // and the turn never ends.
    const remaining = Math.abs(wrap(t.target - st.theta));
    const rampOut = (k * k) / (2 * t.dk);
    if (!t.leaving && remaining <= rampOut + Math.abs(k) * ds) t.leaving = true;
    if (t.leaving) {
      k -= Math.sign(k) * Math.min(Math.abs(k), t.dk * ds);
      if (Math.abs(k) < 1e-6) {
        k = 0;
        st.mode = 'leg';
        st.turn = null;
      }
    } else {
      k += clamp(t.k - k, -t.dk * ds, t.dk * ds);
    }
  }
  const thetaMid = st.theta + k * ds * 0.5;
  st.ax += Math.cos(thetaMid) * ds;
  st.az += Math.sin(thetaMid) * ds;
  st.theta += k * ds;
  st.kappa = k;
  st.s += ds;
}

const gradeFor = (mode) => (mode === 'cruise' ? G_ROAD : mode === 'hairpin' ? G_HAIRPIN : G_LEG);

const cloneState = (s) => ({
  ax: s.ax, az: s.az, theta: s.theta, kappa: s.kappa, s: s.s, yPlan: s.yPlan,
  mode: s.mode, thetaTarget: s.thetaTarget, turn: s.turn ? { ...s.turn } : null,
});

export class Surveyor {
  constructor(land, seed, ax, az, theta) {
    this.land = land;
    this.rand = mulberry32(seed ^ 0x5eed5);
    this.nMacro = makeSimplex(seed ^ 0x3ac0);
    this.ax = ax;
    this.az = az;
    this.theta = theta;
    this.theta0 = theta;
    this.kappa = 0;
    this.s = 0;
    const g0 = land.heightAt(ax, az);
    this.yPlan = land.designAt ? land.designAt(ax, az, g0) : g0;
    this.thetaTarget = theta;

    this.mode = 'cruise';        // cruise | leg | hairpin
    this.nextDecision = 0;
    this.lastStackEnd = -1e9;
    this.stack = null;
    this.turn = null;
    this.stats = { hairpins: 0, stacks: 0, replans: 0 };

    // The route: a smoothed polyline (absolute xz) with cumulative distance.
    this.rx = [];
    this.rz = [];
    this.rd = [];
    this.u = 0;                  // progress along the route, metres
    this.routeDist = 0;          // total distance the route has been planned
    this._appendRoute(this._search(ax, az, theta));
  }

  coarse(ax, az) {
    const g = this.land.heightAtCoarse(ax, az);
    // Water counts at bridge height: crossing it is flat, but costs a bridge.
    return this.land.designAt ? this.land.designAt(ax, az, g) : g;
  }

  // The big shapes plus the gullies: what a serpentine leg is laid against,
  // at design height (over water or cloud, the bridge height).
  relief(ax, az) {
    const g = (this.land.heightAtFar || this.land.heightAtCoarse)(ax, az);
    return this.land.designAt ? this.land.designAt(ax, az, g) : g;
  }

  // The general direction of travel drifts over tens of kilometres, so the
  // road crosses the map in long arcs instead of a straight line.
  _macro(dist) {
    return this.theta0 + 1.0 * fbm(this.nMacro, dist / 16000, 0.37, 2);
  }

  // A* over a grid aligned with the travel direction. Cost is the length of
  // road the move needs (a climb steeper than a leg can hold has to zigzag),
  // plus a price on every metre of height gained or lost, so valleys and
  // saddles win over summits.
  _search(x0, z0, th) {
    const ux = Math.cos(th);
    const uz = Math.sin(th);
    const vx = -uz;
    const vz = ux;
    const NI = NU + I0;
    const JH = (NV - 1) >> 1;
    const size = NI * NV;
    const H = new Float64Array(size);
    const W = new Uint8Array(size);
    const land = this.land;
    for (let a = 0; a < NI; a++) {
      const i = a - I0;
      for (let b = 0; b < NV; b++) {
        const j = b - JH;
        const x = x0 + (i * ux + j * vx) * CELLM;
        const z = z0 + (i * uz + j * vz) * CELLM;
        H[a * NV + b] = this.coarse(x, z);
        if (land.wetAt) W[a * NV + b] = land.wetAt(x, z, land.heightAtCoarse(x, z)) ? 1 : 0;
      }
    }
    const g = new Float64Array(size).fill(Infinity);
    const from = new Int32Array(size).fill(-1);
    const closed = new Uint8Array(size);
    const start = I0 * NV + JH;
    g[start] = 0;
    const heap = new Heap();
    heap.push((NU - 1) * CELLM, start);
    let goal = -1;
    const DIRS = [[1, 0], [1, 1], [1, -1], [0, 1], [0, -1], [-1, 0], [-1, 1], [-1, -1]];
    while (heap.size) {
      const c = heap.pop();
      if (closed[c]) continue;
      closed[c] = 1;
      const a = (c / NV) | 0;
      const b = c - a * NV;
      if (a === NI - 1) {
        goal = c;
        break;
      }
      for (const [da, db] of DIRS) {
        const na = a + da;
        const nb = b + db;
        if (na < 0 || na >= NI || nb < 0 || nb >= NV) continue;
        const n = na * NV + nb;
        if (closed[n]) continue;
        const d = (da && db ? Math.SQRT2 : 1) * CELLM;
        const dh = H[n] - H[c];
        const len = Math.max(d, Math.abs(dh) / G_LEG);
        // Edges of the window are discouraged so the route does not hug them.
        const edge = Math.abs(nb - JH) > JH - 3 ? d * 2 : 0;
        const back = da < 0 ? d * 1.5 : 0;
        // Height is expensive: every metre climbed costs like 15 m of road, so
        // the route goes round a massif or over its saddle, not its shoulder.
        const lift = dh > 0 ? 15 * dh : -9 * dh;
        // Cliffs are worse than their height: a serpentine up a 45 degree wall
        // has to be cut into rock the whole way.
        const steep = Math.max(0, Math.abs(dh) / d - 0.42) * d * 40;
        // Water is crossed on a bridge: allowed, but at two and a half times
        // the price of the road, so a narrow strait is bridged and a wide bay
        // is driven round.
        const wet = W[n] || W[c] ? d * 2.5 : 0;
        const cost = g[c] + len + lift + steep + edge + back + wet;
        if (cost < g[n]) {
          g[n] = cost;
          from[n] = c;
          heap.push(cost + (NI - 1 - na) * CELLM, n);
        }
      }
    }
    const cells = [];
    for (let c = goal; c >= 0; c = from[c]) cells.push(c);
    cells.reverse();
    const px = [];
    const pz = [];
    for (const c of cells) {
      const a = (c / NV) | 0;
      const b = c - a * NV;
      const i = a - I0;
      const j = b - JH;
      px.push(x0 + (i * ux + j * vx) * CELLM);
      pz.push(z0 + (i * uz + j * vz) * CELLM);
    }
    px[0] = x0;
    pz[0] = z0;
    return this._smooth(px, pz);
  }

  // Chaikin corner cutting, then resampling every 20 m: the grid path's 45
  // degree kinks become curves the steering can follow.
  _smooth(px, pz) {
    let x = px;
    let z = pz;
    for (let it = 0; it < 4; it++) {
      const nx = [x[0]];
      const nz = [z[0]];
      for (let i = 0; i < x.length - 1; i++) {
        nx.push(0.75 * x[i] + 0.25 * x[i + 1], 0.25 * x[i] + 0.75 * x[i + 1]);
        nz.push(0.75 * z[i] + 0.25 * z[i + 1], 0.25 * z[i] + 0.75 * z[i + 1]);
      }
      nx.push(x[x.length - 1]);
      nz.push(z[z.length - 1]);
      x = nx;
      z = nz;
    }
    const ox = [x[0]];
    const oz = [z[0]];
    let carry = 0;
    for (let i = 0; i < x.length - 1; i++) {
      const dx = x[i + 1] - x[i];
      const dz = z[i + 1] - z[i];
      const len = Math.hypot(dx, dz);
      let t = 20 - carry;
      while (t <= len) {
        ox.push(x[i] + dx * (t / len));
        oz.push(z[i] + dz * (t / len));
        t += 20;
      }
      carry = len - (t - 20);
    }
    return { x: ox, z: oz };
  }

  _appendRoute(path) {
    const base = this.rd.length ? this.rd[this.rd.length - 1] : 0;
    let d = base;
    for (let i = 0; i < path.x.length; i++) {
      if (this.rx.length) {
        d += Math.hypot(path.x[i] - this.rx[this.rx.length - 1], path.z[i] - this.rz[this.rz.length - 1]);
        if (i === 0) continue;
      }
      this.rx.push(path.x[i]);
      this.rz.push(path.z[i]);
      this.rd.push(d);
    }
    this.routeDist = d;
  }

  // Keep at least 3 km of route ahead. Re-plan from a point 1.2 km ahead so
  // the part the road is about to use never changes under it.
  _extendRoute() {
    if (this.routeDist - this.u > 3000) return;
    const keep = this.u + 1200;
    const k = this._indexAt(keep);
    this.rx.length = k + 1;
    this.rz.length = k + 1;
    this.rd.length = k + 1;
    const x0 = this.rx[k];
    const z0 = this.rz[k];
    const back = Math.max(0, k - 6);
    const th = Math.atan2(z0 - this.rz[back], x0 - this.rx[back]);
    // Lean the search toward the macro direction, without turning it round.
    const want = this._macro(this.rd[k]);
    const dirn = th + clamp(wrap(want - th), -0.6, 0.6);
    this._appendRoute(this._search(x0, z0, dirn));
    this.routeDist = this.rd[this.rd.length - 1];
    this.stats.replans++;
  }

  _indexAt(dist) {
    const rd = this.rd;
    let lo = 0;
    let hi = rd.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (rd[m] <= dist) lo = m;
      else hi = m - 1;
    }
    return lo;
  }

  _routePoint(dist) {
    const i = this._indexAt(dist);
    const j = Math.min(i + 1, this.rx.length - 1);
    const span = this.rd[j] - this.rd[i] || 1;
    const t = clamp((dist - this.rd[i]) / span, 0, 1);
    return { x: this.rx[i] + (this.rx[j] - this.rx[i]) * t, z: this.rz[i] + (this.rz[j] - this.rz[i]) * t };
  }

  // Advance the route parameter to the point nearest the surveyor.
  _track(maxAhead = 300) {
    const i0 = this._indexAt(this.u);
    const i1 = this._indexAt(this.u + maxAhead);
    let best = i0;
    let bestD = Infinity;
    for (let i = i0; i <= i1; i++) {
      const d = (this.rx[i] - this.ax) ** 2 + (this.rz[i] - this.az) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.u = Math.max(this.u, this.rd[best]);
  }

  decide() {
    this._extendRoute();
    this._track();
    const aim = this._routePoint(this.u + LOOK);
    this.thetaTarget = Math.atan2(aim.z - this.az, aim.x - this.ax);
    this.nextDecision = this.s + 14;
    if (this.s - this.lastStackEnd < 160) return;
    const climb = this._planClimb();
    if (climb) this._startSerpentine(climb);
  }

  // Does the route ahead climb (or fall) faster than a road can follow? If so,
  // find the whole steep section: it starts here, and it ends where the land
  // along the route eases back to an ordinary grade for a stretch. The
  // serpentine is then designed for all of it, not just the first few hundred
  // metres, or the road arrives at the foot of the wall already behind.
  _planClimb() {
    const hs = [];
    for (let d = 0; d <= 1400; d += 20) {
      const p = this._routePoint(this.u + d);
      hs.push({ d, h: this.coarse(p.x, p.z), p });
    }
    let up = 0;
    let down = 0;
    for (const e of hs) {
      up = Math.max(up, e.h - (this.yPlan + G_LEG * e.d));
      down = Math.max(down, this.yPlan - G_LEG * e.d - e.h);
    }
    if (up < 14 && down < 14) return null;
    const dir = up >= down ? 1 : -1;
    // Walk forward until 120 m of route in a row holds an ordinary grade.
    let end = hs.length - 1;
    let calm = 0;
    let started = false;
    for (let k = 1; k < hs.length; k++) {
      const g = dir * (hs[k].h - hs[k - 1].h) / 20;
      const owed = dir * (hs[k].h - this.yPlan) - G_LEG * hs[k].d;
      if (owed > 8) started = true;
      if (started && g < G_ROAD * 0.8) calm += 20;
      else calm = 0;
      if (started && calm >= 120) {
        end = k - 6;
        break;
      }
    }
    // The top is the highest (or lowest) point the section reaches.
    let best = hs[end];
    for (let k = 1; k <= end; k++) {
      if (dir * hs[k].h > dir * best.h) best = hs[k];
    }
    const dh = dir * (best.h - this.yPlan);
    const D = Math.hypot(best.p.x - this.ax, best.p.z - this.az);
    if (dh / G_LEG < D * 1.12 || D < 90) return null;
    return { dir, dh, D, tx: best.p.x, tz: best.p.z, th: best.h, u1: this.u + best.d };
  }

  // Lay out the serpentine as a program of legs: each a straight run on a fixed
  // heading, then a hairpin onto the mirror heading. Legs lean alternately left
  // and right of the line to the top, every heading has a forward component
  // along that line, and so does every hairpin, so the flight advances
  // monotonically and cannot cross itself. Each leg's lean and length are
  // chosen by dry-running the steering over the land (the same steer() the
  // road is then laid with) and keeping the one that stays closest to the
  // ground, the hairpins above all: a hairpin buried in the hill would have to
  // be a tunnel, and nobody builds those.
  _startSerpentine(c) {
    const A = Math.atan2(c.tz - this.az, c.tx - this.ax);
    const ux = Math.cos(A);
    const uz = Math.sin(A);
    const ox = this.ax;
    const oz = this.az;
    const legs = [];
    let st = cloneState(this);
    st.mode = 'leg';
    st.turn = null;
    let side = 0;
    for (let n = 0; n < MAX_LEGS; n++) {
      if (c.dir * (c.th - st.yPlan) < 8) break;
      const along = (st.ax - ox) * ux + (st.az - oz) * uz;
      if (along > c.D + 140) break;
      const sides = side ? [side] : [1, -1];
      let best = null;
      for (const sd of sides) {
        for (const a of LEG_ALPHAS) {
          const cand = this._tryLeg(st, A, sd, a, c.dir, ox, oz);
          if (n === 0) cand.cost += 4 * Math.abs(wrap(cand.psi - this.theta));
          if (!best || cand.cost < best.cost) best = cand;
        }
      }
      if (!best || best.cost > LEG_ABORT) break;
      legs.push({ psi: best.psi, L: best.L, sign: -best.sd / R_HAIRPIN, next: best.next });
      st = best.end;
      side = -best.sd;
    }
    if (legs.length < 2) {
      // This land will not take a serpentine: carry on along the route and let
      // the road find its own way (a cutting, a viaduct, a tunnel).
      this.lastStackEnd = this.s;
      this.stats.refused = (this.stats.refused || 0) + 1;
      return;
    }
    this.stack = { legs, i: 0, legStart: this.s, u1: c.u1 };
    this.mode = 'leg';
    this.stats.stacks++;
    this._leg();
  }

  // Dry-run one leg from state st: lean `a` off the contour toward side sd,
  // every candidate length, each followed by its hairpin. Returns the cheapest.
  _tryLeg(st, A, sd, a, dir, ox, oz) {
    const psi = A + sd * (Math.PI / 2 - a);
    const next = A - sd * (Math.PI / 2 - a);
    const nx = -Math.sin(A);
    const nz = Math.cos(A);
    const run = cloneState(st);
    run.thetaTarget = psi;
    const s0 = run.s;
    const y0 = run.yPlan;
    let acc = 0;
    let cnt = 0;
    let best = null;
    let li = 0;
    const misfit = (r, w) => {
      const e = this.relief(r.ax, r.az) - r.yPlan;
      const b = Math.max(0, e - 4);
      const f = Math.max(0, -e - 5);
      return w * (b * b + 0.5 * f * f);
    };
    while (li < LEG_LENGTHS.length) {
      this._dry(run);
      if (((run.s - s0) / STEP) % 3 === 0) {
        acc += misfit(run, 1);
        cnt++;
      }
      if (run.s - s0 < LEG_LENGTHS[li]) continue;
      // Hairpin from here, then a short way down the next leg.
      const hp = cloneState(run);
      hp.mode = 'hairpin';
      hp.turn = { k: -sd / R_HAIRPIN, dk: DK_HAIRPIN, target: next, leaving: false };
      let hAcc = 0;
      let hCnt = 0;
      for (let k = 0; k < 200 && hp.mode === 'hairpin'; k++) {
        this._dry(hp);
        if (k % 3 === 0) {
          hAcc += misfit(hp, 2.5);
          hCnt += 1;
        }
      }
      const climb = dir * (hp.yPlan - y0);
      const ideal = G_LEG * (hp.s - s0);
      const eff = clamp(climb / Math.max(1, ideal), -1, 1);
      const lat = (hp.ax - ox) * nx + (hp.az - oz) * nz;
      let cost = (acc + hAcc) / Math.max(1, cnt + hCnt) + 40 * (1 - eff) * (1 - eff);
      cost += Math.max(0, (Math.abs(lat) - 360) / 30) ** 2;
      if (!best || cost < best.cost) best = { cost, psi, next, sd, L: LEG_LENGTHS[li], end: hp };
      li++;
    }
    return best;
  }

  // One step of a dry run: the steering law plus the planned grade line over
  // the coarse land.
  _dry(r) {
    steer(r, STEP);
    const g = this.relief(r.ax, r.az);
    const gmax = gradeFor(r.mode);
    r.yPlan += clamp(g - r.yPlan, -gmax * STEP, gmax * STEP);
  }

  // Fly the designed program: hold the leg's heading for its length, then
  // hand over to the hairpin. step() moves on to the next leg when the hairpin
  // has unwound.
  _leg() {
    const st = this.stack;
    const leg = st.legs[st.i];
    this.thetaTarget = leg.psi;
    if (this.s - st.legStart >= leg.L) {
      this.mode = 'hairpin';
      this.turn = { k: leg.sign, dk: DK_HAIRPIN, target: leg.next, leaving: false };
      this.stats.hairpins++;
    }
  }

  _endSerpentine() {
    const st = this.stack;
    this.stack = null;
    this.mode = 'cruise';
    this.lastStackEnd = this.s;
    this.nextDecision = this.s;
    this.u = Math.max(this.u, st.u1);
    this._track(600);
  }

  // Advance one sample.
  step() {
    const ds = STEP;
    if (this.mode === 'cruise' && this.s >= this.nextDecision) this.decide();
    if (this.mode === 'leg' && this.stack) this._leg();

    const wasHairpin = this.mode === 'hairpin';
    steer(this, ds);
    const k = this.kappa;
    if (wasHairpin && this.mode === 'leg' && this.stack) {
      this.stack.i++;
      this.stack.legStart = this.s;
      if (this.stack.i >= this.stack.legs.length) this._endSerpentine();
    }

    // Orbit guard: an aim point inside the turning circle makes any pursuit
    // controller circle for ever. A net turn of most of a revolution within
    // 400 m means exactly that, so drop the aim and pick the route up further on.
    const hist = this._hist || (this._hist = new Float64Array(200));
    const slot = Math.round(this.s / ds) % 200;
    const old = hist[slot];
    hist[slot] = this.theta;
    if (this.s > 400 && Math.abs(this.theta - old) > 5.2 && this.mode !== 'hairpin') {
      if (this.stack) {
        this.stack = null;
        this.lastStackEnd = this.s;
      }
      this.mode = 'cruise';
      this.u += 250;
      this._track(800);
      this.nextDecision = this.s;
      hist.fill(this.theta);
      this.stats.orbits = (this.stats.orbits || 0) + 1;
    }

    const g = this.land.heightAt(this.ax, this.az);
    const tgt = this.land.designAt ? this.land.designAt(this.ax, this.az, g) : g;
    const gmax = gradeFor(this.mode);
    this.yPlan += clamp(tgt - this.yPlan, -gmax * ds, gmax * ds);

    return {
      ax: this.ax, az: this.az, theta: this.theta, kappa: k,
      g, t: tgt, gmax, lockGrade: NaN, mode: this.mode, yPlan: this.yPlan,
      y: 0, grade: 0, bank: 0, kind: 0, gl: g, gr: g,
    };
  }
}
