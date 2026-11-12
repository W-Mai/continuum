// The director: picks camera shots from the road ahead and moves between them
// the way a film crew would.
//
// It reads the same committed road samples the car drives on, so it knows
// hundreds of metres ahead where the next viaduct, bend or hairpin is and has a
// camera standing there before the car arrives. Rigs that travel with the car
// (chase, side, lead, orbit) hand over by gliding round it; rigs that stand
// still (a long lens by the road, across the valley from a viaduct, high over
// a hairpin) are entered with a short dissolve. A shot is used only when
// nothing hides the car for most of it, neither the land nor a viaduct's own
// deck and parapet, and is dropped as soon as something gets in the way.

import * as THREE from 'three';
import { STEP, BRIDGE, TUNNEL, HALF_PAVED } from '../world/road.js';
import { mulberry32 } from '../world/noise.js';

const SHOT_MIN = 5;           // s before the director will cut away
const SHOT_MAX = 12;          // s before it wants something else
const GLIDE = 1.6;            // s, one travelling rig to another
const DISSOLVE = 0.45;        // s, into or out of a standing rig
const CHECK_EVERY = 0.25;     // s between sight-line checks during a shot
const LOST_AFTER = 0.4;       // s of blocked view before a shot is dropped
const DEG = Math.PI / 180;
// Seconds before a kind of shot may be used again. The set pieces are rare on
// purpose: a long lens on every bend stops being an event.
const COOLDOWN = { tele: 30, hairpin: 35, across: 30, orbit: 30, side: 8, lead: 8 };
// A viaduct's edge, as roadmesh.js builds it: the parapet rises from just
// outside the asphalt to 0.95 m over the deck, and the deck ends 0.72 m out.
const PARAPET_IN = HALF_PAVED + 0.3;
const DECK_EDGE = HALF_PAVED + 0.72;
const PARAPET_H = 0.95;
// Lens height over the car beside it: level with it on the ground; on a
// viaduct high enough to see the whole car, floor and all, over the parapet.
const SIDE_Y = 1.05;
const SIDE_Y_DECK = 2.4;
// A long lens standing beside a viaduct floats this far over the deck, so the
// parapet does not cut the car off at the waist.
const TELE_Y_DECK = 3.2;

// Framings that this module drives; the chase rig drives the rest.
export const DIRECTED = ['director', 'side', 'front'];

const ease = (t) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * c * (c * (c * 6 - 15) + 10);
};
const wrap = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};
const approach = (k, dt) => 1 - Math.exp(-k * dt);

// Vertical field of view that shows `width` metres at `dist`, for this screen.
function fovFor(width, dist, aspect, lo, hi) {
  const h = 2 * Math.atan(width / 2 / Math.max(dist, 0.1));
  const v = 2 * Math.atan(Math.tan(h / 2) / aspect) / DEG;
  return Math.min(hi, Math.max(lo, v));
}

class Pose {
  constructor() {
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.fov = 50;
    this.roll = 0;
  }

  copy(p) {
    this.pos.copy(p.pos);
    this.look.copy(p.look);
    this.fov = p.fov;
    this.roll = p.roll;
    return this;
  }
}

// --- rigs ---------------------------------------------------------------------
//
// A rig is one camera set-up. start() places it and says whether the shot is
// any good; update() moves it; done() says when the action it was set up for
// is over. `moving` rigs travel with the car, the rest stand still.

class Rig {
  constructor(type, moving) {
    this.type = type;
    this.moving = moving;
    this.pose = new Pose();
    this.age = 0;
    this.blocked = 0;
  }

  start() { return true; }

  done() { return false; }

  // Whether the line of sight is worth checking right now.
  watch() { return true; }

  // Whether the rig can still stand where it is.
  valid() { return true; }
}

class ChaseRig extends Rig {
  constructor() { super('chase', true); }

  update(ctx) {
    const c = ctx.chase;
    this.pose.pos.copy(c._pos);
    this.pose.look.copy(c._lookAt);
    this.pose.fov = c.fov.value;
    this.pose.roll = THREE.MathUtils.clamp(-(ctx.car.lateralG || 0) * 0.014, -0.05, 0.05);
  }

  watch() { return false; }
}

// Wherever the camera was, carried along with the car: the start of a glide
// out of a pose that belongs to no rig.
class HoldRig extends Rig {
  constructor(camera, look, car) {
    super('hold', true);
    const fx = Math.cos(car.yaw), fz = Math.sin(car.yaw);
    const rel = (p) => {
      const dx = p.x - car.x, dz = p.z - car.z;
      return [dx * fx + dz * fz, dx * -fz + dz * fx, p.y - car.y];
    };
    this.p = rel(camera.position);
    this.l = rel(look);
    this.pose.fov = camera.fov;
  }

  update(ctx) {
    const { car } = ctx;
    const fx = Math.cos(car.yaw), fz = Math.sin(car.yaw);
    const put = (v, [a, s, h]) => v.set(car.x + fx * a - fz * s, car.y + h, car.z + fz * a + fx * s);
    put(this.pose.pos, this.p);
    put(this.pose.look, this.l);
  }

  watch() { return false; }
}

// Alongside, just off the verge, level with the car.
class SideRig extends Rig {
  constructor(sign) {
    super('side', true);
    this.sign = sign;
    this.yaw = 0;
    this.y = null;
    this.wall = false;
  }

  start(ctx) {
    this.yaw = ctx.car.yaw;
    this.y = null;
    this.update(ctx, 0);
    return !ctx.tunnelWithin(0, 140) && !this.wall && ctx.clear(this.pose.pos, ctx.carPoint());
  }

  update(ctx, dt) {
    const { car } = ctx;
    this.yaw += wrap(car.yaw - this.yaw) * approach(3, dt || 1);
    const fx = Math.cos(this.yaw), fz = Math.sin(this.yaw);
    const nx = -fz, nz = fx;
    const off = this.sign * 8.2 - ctx.carLat;
    const p = this.pose.pos;
    p.set(car.x + nx * off, 0, car.z + nz * off);
    // A cut wall beside the road would put the lens up on the slope looking
    // down: that is a different shot, so the director drops this one.
    const g = ctx.groundAt(p.x, p.z);
    this.wall = g > car.y + 2.6;
    const want = Math.max(car.y + (ctx.deckNear ? SIDE_Y_DECK : SIDE_Y), g + 0.8);
    this.y = this.y === null || !dt ? want : this.y + (want - this.y) * approach(4, dt);
    p.y = Math.max(this.y, g + 0.3);
    this.pose.look.set(car.x, car.y + 0.8, car.z);
    // Frame the length of the car at its near flank, with room either side.
    const dist = Math.max(2, Math.abs(off) - 0.9);
    this.pose.fov = fovFor(4.5 / (ctx.aspect >= 1 ? 0.55 : 0.78), dist, ctx.aspect, 18, 74);
    this.pose.roll = 0;
  }

  valid() { return !this.wall; }
}

// Ahead on the road, looking back at the car coming on.
class LeadRig extends Rig {
  constructor() {
    super('lead', true);
    this.gap = null;
  }

  start(ctx) {
    this.gap = null;
    this.update(ctx, 0);
    return true;
  }

  update(ctx, dt) {
    const { car, road } = ctx;
    const want = (9 + car.speed * 0.06) * (ctx.aspect >= 1 ? 1 : 1.25);
    this.gap = this.gap === null ? want : this.gap + (want - this.gap) * approach(1.5, dt || 1);
    const s = ctx.sCar + this.gap;
    const q = road.at(s);
    if (!q) return;
    const lat = ctx.carLat * 0.4;
    const nx = -Math.sin(q.theta), nz = Math.cos(q.theta);
    const p = this.pose.pos;
    p.set(q.x + nx * lat, road.surfaceAt(s, lat) + 1.45, q.z + nz * lat);
    const ceil = ctx.ceilingAt(p.x, p.z, s);
    if (ceil !== null) p.y = Math.min(p.y, ceil - 0.8);
    this.pose.look.set(car.x, car.y + 0.6, car.z);
    this.pose.fov = ctx.aspect >= 1 ? 30 : 46;
    this.pose.roll = 0;
  }

  // In a bore the land is over both lens and car, but the bore is open.
  watch(ctx) { return !ctx.tunnelWithin(-6, (this.gap || 12) + 6); }
}

// A slow arc round the car from above: high bridges and passes.
class OrbitRig extends Rig {
  constructor(sign) {
    super('orbit', true);
    this.sign = sign;
    this.yaw = 0;
    this.y = null;
  }

  start(ctx) {
    this.yaw = ctx.car.yaw;
    this.y = null;
    this.update(ctx, 0);
    if (ctx.tunnelWithin(0, ctx.car.speed * SHOT_MAX)) return false;
    return ctx.clear(this.pose.pos, ctx.carPoint());
  }

  update(ctx, dt) {
    const { car } = ctx;
    this.yaw += wrap(car.yaw - this.yaw) * approach(1.2, dt || 1);
    const r = ctx.aspect >= 1 ? 24 : 30;
    // From behind the car's shoulder round toward its side, 6 degrees a second.
    const a = this.yaw + this.sign * (130 * DEG - this.age * 6 * DEG);
    const p = this.pose.pos;
    p.set(car.x + Math.cos(a) * r, 0, car.z + Math.sin(a) * r);
    // Height eases over the land below instead of stepping with it.
    const g = ctx.groundAt(p.x, p.z);
    const want = Math.max(car.y + 14, g + 10);
    this.y = this.y === null || !dt ? want : this.y + (want - this.y) * approach(2, dt);
    p.y = Math.max(this.y, g + 3);
    const fx = Math.cos(car.yaw), fz = Math.sin(car.yaw);
    this.pose.look.set(car.x + fx * 2, car.y + 0.4, car.z + fz * 2);
    this.pose.fov = ctx.aspect >= 1 ? 34 : 52;
    this.pose.roll = 0;
  }
}

// Standing rigs share one behaviour: the lens stays put, the head pans after
// the car with a little operator lag.
class StandingRig extends Rig {
  constructor(type) {
    super(type, false);
    this.aim = new THREE.Vector3();
    this.sEnd = 0;
    this.tMax = SHOT_MAX;
    this.fovSmooth = null;
  }

  aimAt(ctx, dt, fov) {
    const { car } = ctx;
    const target = this._t || (this._t = new THREE.Vector3());
    target.set(car.x, car.y + 0.6, car.z);
    if (!dt) this.aim.copy(target);
    else this.aim.lerp(target, approach(9, dt));
    this.pose.look.copy(this.aim);
    this.fovSmooth = this.fovSmooth === null || !dt ? fov : this.fovSmooth + (fov - this.fovSmooth) * approach(2.5, dt);
    this.pose.fov = this.fovSmooth;
    this.pose.roll = 0;
  }

  done(ctx) {
    return ctx.sCar > this.sEnd || this.age > this.tMax;
  }

  // The car's road positions from now to the end of the shot must be in view
  // for the opening of it and nearly all the rest.
  survey(ctx) {
    const n = 6;
    let seen = 0;
    for (let k = 0; k <= n; k++) {
      const s = ctx.sCar + (this.sEnd - ctx.sCar) * (k / n);
      const ok = ctx.clear(this.pose.pos, ctx.roadPoint(s), s);
      if (k < 3 && !ok) return false;
      if (ok) seen++;
    }
    return seen >= n;
  }
}

// A long lens by the road ahead, at the outside of the next bend.
class TeleRig extends StandingRig {
  constructor() { super('tele'); }

  start(ctx) {
    const { road, car } = ctx;
    const ahead = THREE.MathUtils.clamp(car.speed * 7.5, 120, 240);
    const sT = ctx.sCar + ahead;
    const bend = ctx.bendNear(sT, 60);
    const first = Math.abs(bend) > 1 / 400 ? -Math.sign(bend) : ctx.sunSide(sT);
    for (const sign of [first, -first]) {
      for (const lat of [10.5, 12.5]) {
        const q = road.at(sT);
        if (!q || q.kind === TUNNEL) return false;
        const nx = -Math.sin(q.theta), nz = Math.cos(q.theta);
        const p = this.pose.pos;
        p.set(q.x + nx * sign * lat, 0, q.z + nz * sign * lat);
        // Beside a viaduct the lens floats over the deck; anywhere else it
        // stands on the ground, a little under the road.
        const deck = q.kind === BRIDGE ? q.y + TELE_Y_DECK : q.y - 1.0;
        p.y = Math.max(ctx.groundAt(p.x, p.z) + 1.7, deck);
        if (ctx.treesAt(p.x, p.z, lat) > 0.25) continue;
        // Cut before the car draws level: alongside, the pan would outrun it.
        this.sEnd = sT - 8;
        if (!this.survey(ctx)) continue;
        this.update(ctx, 0);
        return true;
      }
    }
    return false;
  }

  update(ctx, dt) {
    const { car } = ctx;
    const p = this.pose.pos;
    const d = Math.hypot(car.x - p.x, car.y - p.y, car.z - p.z);
    this.aimAt(ctx, dt, fovFor(3.4 / 0.26, d, ctx.aspect, 6, ctx.aspect >= 1 ? 36 : 54));
  }
}

// Across the valley from a tall viaduct, level with the deck or a little over
// it: the whole span in the frame, piers and all, with the car crossing it.
// There is no shot from under a viaduct: from anywhere below the deck the
// parapet hides the car, and all that lens would film is concrete.
class AcrossRig extends StandingRig {
  constructor() { super('across'); this.tMax = 11; }

  start(ctx) {
    const { road, car } = ctx;
    const v = Math.max(car.speed, 8);
    const best = ctx.findAhead(v * 2, v * 6, (q) => q.kind === BRIDGE && q.y - q.g >= 18,
      (q) => q.y - q.g);
    if (!best) return false;
    const sB = best.s;
    const q = road.at(sB);
    const first = ctx.sunSide(sB);
    const nx = -Math.sin(q.theta), nz = Math.cos(q.theta);
    const fx = Math.cos(q.theta), fz = Math.sin(q.theta);
    for (const sign of [first, -first]) {
      for (const [lat, up] of [[110, 16], [140, 24], [90, 10]]) {
        const p = this.pose.pos;
        // A little back along the road, so the car crosses the frame instead
        // of running straight at the lens.
        p.set(q.x + nx * sign * lat - fx * 25, 0, q.z + nz * sign * lat - fz * 25);
        const ground = ctx.terrainAt(p.x, p.z);
        p.y = Math.max(q.y + up, ground + 6);
        // Not up on a hillside looking down: then the valley is not in it.
        if (p.y > q.y + up + 12) continue;
        if (ctx.treesAt(p.x, p.z, lat) > 0.3 && p.y - ground < 25) continue;
        this.sEnd = Math.min(sB + 90, ctx.sCar + v * this.tMax);
        if (!this.survey(ctx)) continue;
        this.update(ctx, 0);
        return true;
      }
    }
    return false;
  }

  update(ctx, dt) {
    const { car } = ctx;
    const p = this.pose.pos;
    const d = Math.hypot(car.x - p.x, car.y - p.y, car.z - p.z);
    this.aimAt(ctx, dt, fovFor(75, d, ctx.aspect, 14, ctx.aspect >= 1 ? 34 : 58));
  }
}

// High over the outside of a hairpin.
class HairpinRig extends StandingRig {
  constructor() { super('hairpin'); this.tMax = 13; }

  start(ctx) {
    const { road } = ctx;
    const run = ctx.hairpinAhead(90, 170);
    if (!run) return false;
    const q = road.at(run.apex);
    const out = -Math.sign(q.kappa || 1);
    const nx = -Math.sin(q.theta), nz = Math.cos(q.theta);
    const p = this.pose.pos;
    p.set(q.x + nx * out * 24, 0, q.z + nz * out * 24);
    p.y = Math.max(q.y + 38, ctx.terrainAt(p.x, p.z) + 18);
    this.sEnd = run.end + 40;
    if (!this.survey(ctx)) return false;
    this.update(ctx, 0);
    return true;
  }

  update(ctx, dt) {
    this.aimAt(ctx, dt, ctx.aspect >= 1 ? 40 : 58);
  }
}

// --- the director --------------------------------------------------------------

export class Director {
  /**
   * @param camera   the scene camera
   * @param world    { road, groundAt, terrainAt, ceilingAt, treesAt, solidAt, surfaceAt, sunDir, post }
   *                 groundAt/terrainAt/ceilingAt take local x, z; treesAt also the
   *                 distance from the road; solidAt a local x, y, z; surfaceAt
   *                 a local x, z, and gives a liquid's level or -Infinity.
   */
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.shot = null;
    this.prev = null;           // rig being glided away from
    this.glide = 0;             // 0..1
    this.pending = null;        // rig to cut to on the next frame
    this.mode = 'chase';        // the framing last driven
    this.active = false;
    this.clock = 0;
    this.checkClock = 0;
    this.history = [];          // { t, type, via } for diagnostics
    this.cuts = 0;
    this.glides = 0;
    this.lastUsed = {};         // type -> clock when last started
    this.drops = [];            // shots given up on, and why
    this.rand = mulberry32(((world.seed || 1) ^ 0xd1ec) >>> 0);
    this.pose = new Pose();
    this._a = new Pose();
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this.camS = 0;
  }

  // Floating origin moved: everything held in local coordinates moves with it.
  shift(dx, dz) {
    for (const rig of [this.shot, this.prev, this.pending]) {
      if (!rig) continue;
      rig.pose.pos.x -= dx; rig.pose.pos.z -= dz;
      rig.pose.look.x -= dx; rig.pose.look.z -= dz;
      if (rig.aim) { rig.aim.x -= dx; rig.aim.z -= dz; }
    }
    this.pose.pos.x -= dx; this.pose.pos.z -= dz;
    this.pose.look.x -= dx; this.pose.look.z -= dz;
  }

  get shotName() {
    return this.shot ? this.shot.type : 'chase';
  }

  // --- context: what rigs need to know about the world ---------------------------

  _context(dt, car, sCar, chase) {
    const w = this.world;
    const road = w.road;
    const here = road.at(sCar);
    const ctx = this.ctx || (this.ctx = {});
    ctx.dt = dt;
    ctx.car = car;
    ctx.sCar = sCar;
    ctx.road = road;
    ctx.chase = chase;
    ctx.aspect = this.camera.aspect || 16 / 9;
    ctx.carLat = road.lateralOf(sCar, car.x, car.z);
    ctx.carInTunnel = !!here && here.kind === TUNNEL;
    // On a viaduct, or about to be: rigs beside the car lift over the parapet
    // a moment before the deck starts.
    const ahead = road.at(sCar + Math.max(6, car.speed * 0.8));
    ctx.deckNear = (!!here && here.kind === BRIDGE) || (!!ahead && ahead.kind === BRIDGE);
    if (!ctx.groundAt) this._bind(ctx);
    return ctx;
  }

  _bind(ctx) {
    const w = this.world;
    const road = w.road;
    const v = new THREE.Vector3();
    const u = new THREE.Vector3();
    ctx.groundAt = (x, z) => w.groundAt(x, z);
    ctx.terrainAt = (x, z) => w.terrainAt(x, z);
    ctx.ceilingAt = (x, z, s) => w.ceilingAt(x, z, s);
    ctx.treesAt = (x, z, near) => (w.treesAt ? w.treesAt(x, z, near) : 0);
    ctx.solidAt = (x, y, z) => (w.solidAt ? w.solidAt(x, y, z) : false);
    ctx.surfaceAt = (x, z) => (w.surfaceAt ? w.surfaceAt(x, z) : -Infinity);
    ctx.carPoint = () => v.set(ctx.car.x, ctx.car.y + 0.8, ctx.car.z);
    ctx.roadPoint = (s) => {
      const q = road.at(s);
      if (!q) return v.set(ctx.car.x, ctx.car.y + 0.8, ctx.car.z);
      const nx = -Math.sin(q.theta), nz = Math.cos(q.theta);
      return v.set(q.x + nx * ctx.carLat, road.surfaceAt(s, ctx.carLat) + 0.8, q.z + nz * ctx.carLat);
    };
    // Is the line from a to b clear? b is on the road near chainage sB. The
    // lens must stand in the open, the land and anything solid over it (a
    // tower, the cavern's roof, cloud) must stay off the line, except for the
    // last few metres before b, which are the road's own platform; and where
    // b is on a viaduct, the line must leave the deck over the parapet, not
    // through it or under the deck. Nor does a line see through the surface
    // of a liquid, from either side: where the road dives into the deep sea,
    // a lens above the surface has lost the car.
    ctx.clear = (a, b, sB = ctx.sCar) => {
      u.copy(b).sub(a);
      const len = u.length();
      if (len < 1) return true;
      if (ctx.solidAt(a.x, a.y, a.z)) return false;
      const la = ctx.surfaceAt(a.x, a.z);
      const lb = ctx.surfaceAt(b.x, b.z);
      if (la > -Infinity && lb > -Infinity && (a.y > la) !== (b.y > lb)) return false;
      const steps = Math.min(48, Math.ceil(len / 5));
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        if (len * (1 - t) < 7) break;
        const x = a.x + u.x * t, y = a.y + u.y * t, z = a.z + u.z * t;
        if (w.terrainAt(x, z) > y + 0.2 || ctx.solidAt(x, y, z)) return false;
      }
      return overDeck(b, sB, len);
    };
    // Walk from b back toward a until the line is off the deck. Over the
    // carriageway it must stay above the deck; over the parapet, above that.
    // The step is sized so the line moves about 0.2 m sideways per step.
    const overDeck = (b, sB, len) => {
      let s = road.nearestS(b.x, b.z, sB, 12).s;
      const q0 = road.at(s);
      if (!q0 || q0.kind !== BRIDGE) return true;
      const ax = b.x - u.x, az = b.z - u.z;
      const lat0 = road.lateralOf(s, b.x, b.z);
      const rate = Math.abs(road.lateralOf(s, ax, az) - lat0) / len;
      const step = THREE.MathUtils.clamp(0.2 / Math.max(rate, 1e-3), 0.3, 4);
      const span = Math.max(6, step * 2 + 2);
      for (let d = step; d < len - 0.5; d += step) {
        const t = d / len;
        const x = b.x - u.x * t, y = b.y - u.y * t, z = b.z - u.z * t;
        s = road.nearestS(x, z, s, span).s;
        const q = road.at(s);
        if (!q || q.kind !== BRIDGE) return true;
        const lat = road.lateralOf(s, x, z);
        const m = Math.abs(lat);
        if (m > DECK_EDGE) return true;
        if (y < road.surfaceAt(s, lat) + (m > PARAPET_IN ? PARAPET_H : -0.05)) return false;
      }
      return true;
    };
    ctx.sample = (s) => road.samples.get(Math.round(s / STEP));
    // Inside the road's own clearance (on the carriageway, in a bore, through a
    // portal) is not inside the land, even where the land overhangs it.
    ctx.inEnvelope = (p, s) => {
      const near = road.nearestS(p.x, p.z, s, 60);
      if (near.dist > 6) return false;
      return p.y < road.surfaceAt(near.s, road.lateralOf(near.s, p.x, p.z)) + 7.5;
    };
    ctx.tunnelWithin = (from, to) => {
      for (let s = ctx.sCar + from; s <= ctx.sCar + to; s += 8) {
        const q = ctx.sample(s);
        if (q && q.kind === TUNNEL) return true;
      }
      return false;
    };
    // Signed curvature of the sharpest bend within `span` of s.
    ctx.bendNear = (s, span) => {
      let best = 0;
      for (let t = s - span; t <= s + span; t += 4) {
        const q = ctx.sample(t);
        if (q && Math.abs(q.kappa) > Math.abs(best)) best = q.kappa;
      }
      return best;
    };
    ctx.findAhead = (from, to, test, score) => {
      let best = null;
      for (let s = ctx.sCar + from; s <= ctx.sCar + to; s += STEP * 2) {
        const q = ctx.sample(s);
        if (!q || !test(q)) continue;
        const sc = score(q);
        if (!best || sc > best.score) best = { s, score: sc };
      }
      return best;
    };
    ctx.hairpinAhead = (from, to) => {
      for (let s = ctx.sCar + from; s <= ctx.sCar + to; s += STEP) {
        const q = ctx.sample(s);
        if (!q || q.mode !== 'hairpin') continue;
        let end = s;
        let apex = s;
        let k = 0;
        for (let t = s; t <= s + 200; t += STEP) {
          const r = ctx.sample(t);
          if (!r || r.mode !== 'hairpin') break;
          end = t;
          if (Math.abs(r.kappa) > k) { k = Math.abs(r.kappa); apex = t; }
        }
        return { start: s, apex, end };
      }
      return null;
    };
    // Which side of the road puts the sun behind a camera looking at it: the
    // car is lit from the front of the lens, not against it.
    ctx.sunSide = (s) => {
      const q = road.at(s);
      if (!q) return 1;
      const sun = w.sunDir;
      const nx = -Math.sin(q.theta), nz = Math.cos(q.theta);
      return nx * sun.x + nz * sun.z >= 0 ? 1 : -1;
    };
  }

  // --- choosing -----------------------------------------------------------------

  _ready(type) {
    const last = this.lastUsed[type];
    return last === undefined || this.clock - last >= (COOLDOWN[type] || 0);
  }

  // A shot set up for something about to happen on the road, if one is due.
  // The rarer the thing, the sooner it may interrupt the current shot.
  _event(ctx, age) {
    if (ctx.car.speed < 8) return null;
    for (const [type, minAge, make] of [
      ['across', 2.5, () => new AcrossRig()],
      ['hairpin', SHOT_MIN, () => new HairpinRig()],
    ]) {
      if (type === this.shotName || age < minAge || !this._ready(type)) continue;
      const rig = make();
      if (rig.start(ctx)) return rig;
    }
    return null;
  }

  // Something to cut to when nothing in particular is coming up. The chase is
  // the anchor the other shots return to, about every other shot.
  _filler(ctx) {
    const { car } = ctx;
    if (this.shotName !== 'chase' && this.rand() < 0.55) return new ChaseRig();
    const want = [];
    const straight = ctx.bendNear(ctx.sCar + 130, 130);
    const q = ctx.sample(ctx.sCar);
    const high = q && q.kind === BRIDGE && q.y - q.g > 22;
    if (ctx.carInTunnel) want.push('lead', 'chase');
    else {
      if (high) want.push('orbit');
      if (Math.abs(straight) < 1 / 500) want.push('side');
      if (Math.abs(ctx.bendNear(ctx.sCar + 200, 60)) > 1 / 300) want.push('tele');
      if (q && q.grade > 0.05) want.push('lead');
      want.push(this.rand() < 0.5 ? 'side' : 'lead', 'orbit', 'tele', 'side', 'lead', 'chase');
    }
    const sun = ctx.sunSide(ctx.sCar);
    for (const type of want) {
      if (type === this.shotName || !this._ready(type)) continue;
      const rig = type === 'chase' ? new ChaseRig()
        : type === 'side' ? new SideRig(sun)
          : type === 'lead' ? new LeadRig()
            : type === 'orbit' ? new OrbitRig(sun)
              : new TeleRig();
      if (car.speed < 8 && !rig.moving) continue;
      if (rig.start(ctx)) return rig;
    }
    return new ChaseRig();
  }

  // --- running --------------------------------------------------------------------

  /**
   * Runs after the chase rig has updated, and overrides the camera while the
   * framing is one this module drives, or while it hands the camera back.
   */
  update(dt, car, sCar, chase) {
    const framing = chase.framing;
    const ctx = this._context(dt, car, sCar, chase);
    this.clock += dt;
    if (framing !== this.mode) this._switch(ctx, framing);
    if (!this.active) return;

    // A cut decided last frame happens now, after that frame was held.
    if (this.pending) {
      const rig = this.pending;
      this.pending = null;
      this._begin(rig, 'cut');
      this.world.post.dissolve(DISSOLVE);
    }

    this.shot.age += dt;
    this.shot.update(ctx, dt);
    if (this.prev) {
      this.prev.age += dt;
      this.prev.update(ctx, dt);
      this.glide = Math.min(1, this.glide + dt / GLIDE);
      if (this.glide >= 1) this.prev = null;
    }

    if (framing === 'director') this._direct(ctx, dt);
    this._apply(ctx);

    // Handed back to the chase rig: once the move is over, let go.
    if (!DIRECTED.includes(framing) && !this.prev && !this.pending) {
      this.active = false;
      this.shot = null;
    }
  }

  // The framing changed under us: move to the new one without a jump. Out of a
  // standing rig, or inside a tunnel, that is a dissolve; otherwise a glide.
  _switch(ctx, framing) {
    this.mode = framing;
    if (!DIRECTED.includes(framing) && !this.active) return;
    let rig;
    if (framing === 'side') {
      rig = new SideRig(ctx.sunSide(ctx.sCar));
      if (!rig.start(ctx)) {
        rig = new SideRig(-rig.sign);
        rig.start(ctx);
      }
    } else {
      rig = framing === 'front' ? new LeadRig() : new ChaseRig();
      rig.start(ctx);
    }
    const here = new HoldRig(this.camera, this.active ? this.pose.look : ctx.chase._lookAt, ctx.car);
    const standing = this.active && this.shot && !this.shot.moving;
    // Until the move starts, the camera stays exactly where it is.
    if (!this.active || !this.shot) this.shot = here;
    this.active = true;
    this.prev = null;
    if (standing || ctx.carInTunnel) {
      this.pending = rig;
      this.world.post.hold();
    } else {
      this.pending = null;
      this._begin(rig, 'glide', here);
    }
  }

  _direct(ctx, dt) {
    const shot = this.shot;
    if (this.prev || this.pending) return;
    let next = null;

    // Drop a shot the land has got in front of.
    this.checkClock += dt;
    if (this.checkClock >= CHECK_EVERY) {
      this.checkClock = 0;
      const p = shot.pose.pos;
      const inside = p.y < ctx.terrainAt(p.x, p.z) - 0.3 && !ctx.inEnvelope(p, ctx.sCar);
      const lost = shot.watch(ctx) && !ctx.clear(p, ctx.carPoint());
      shot.blocked = lost || inside ? shot.blocked + CHECK_EVERY : 0;
      const why = inside ? 'inside' : !shot.valid(ctx) ? 'invalid' : shot.blocked >= LOST_AFTER ? 'blocked' : null;
      if (why) {
        this.drops.push({ t: +this.clock.toFixed(2), type: shot.type, why, age: +shot.age.toFixed(2) });
        if (this.drops.length > 30) this.drops.shift();
        next = this._filler(ctx);
      }
    }

    // Twice a second: is the action over, or is something worth a camera due?
    this.decideClock = (this.decideClock || 0) + dt;
    if (!next && this.decideClock >= 0.5) {
      this.decideClock = 0;
      if (shot.done(ctx)) next = this._filler(ctx);
      else next = this._event(ctx, shot.age);
      if (!next && shot.age >= SHOT_MAX) next = this._filler(ctx);
      // A travelling shot gives way early to a long lens on the bend ahead.
      if (!next && shot.moving && shot.age >= SHOT_MIN * 0.6 && this._ready('tele')
        && ctx.car.speed > 8 && Math.abs(ctx.bendNear(ctx.sCar + 190, 50)) > 1 / 250) {
        const tele = new TeleRig();
        if (tele.start(ctx)) next = tele;
      }
    }
    if (!next || next.type === shot.type) return;

    if (shot.moving && next.moving && !ctx.carInTunnel) this._begin(next, 'glide', shot);
    else {
      this.pending = next;
      this.world.post.hold();
    }
  }

  _begin(rig, via, from = null) {
    rig.age = 0;
    this.shot = rig;
    this.lastUsed[rig.type] = this.clock;
    this.prev = via === 'glide' ? from : null;
    this.glide = 0;
    this.glideTurn = null;
    this.checkClock = 0;
    if (via === 'cut') this.cuts++;
    else this.glides++;
    this.history.push({ t: +this.clock.toFixed(2), type: rig.type, via });
    if (this.history.length > 60) this.history.shift();
  }

  // Write the pose to the camera. During a glide the two rigs are blended in
  // the car's own frame, by angle round it, distance and height, so the lens
  // swings round the car rather than through it.
  _apply(ctx) {
    const { car } = ctx;
    const out = this.pose;
    out.copy(this.shot.pose);
    if (this.prev) {
      const w = ease(this.glide);
      const a = this.prev.pose;
      const b = this.shot.pose;
      const fx = Math.cos(car.yaw), fz = Math.sin(car.yaw);
      const polar = (p) => {
        const dx = p.x - car.x, dz = p.z - car.z;
        const along = dx * fx + dz * fz;
        const side = dx * -fz + dz * fx;
        return [Math.atan2(side, along), Math.hypot(along, side), p.y - car.y];
      };
      const [aa, ar, ah] = polar(a.pos);
      const [ba, br, bh] = polar(b.pos);
      let da = wrap(ba - aa);
      if (this.glideTurn === null) {
        // Straight through the car is never the way round: half a turn goes by
        // the target's side, and once chosen the way round is kept.
        if (Math.abs(Math.abs(da) - Math.PI) < 0.35) da = Math.abs(da) * (Math.sign(Math.sin(ba)) || 1);
      } else {
        while (da - this.glideTurn > Math.PI) da -= 2 * Math.PI;
        while (da - this.glideTurn < -Math.PI) da += 2 * Math.PI;
      }
      this.glideTurn = da;
      const ang = aa + da * w;
      const r = ar + (br - ar) * w;
      const h = ah + (bh - ah) * w;
      const dirx = fx * Math.cos(ang) - fz * Math.sin(ang);
      const dirz = fz * Math.cos(ang) + fx * Math.sin(ang);
      out.pos.set(car.x + dirx * r, car.y + h, car.z + dirz * r);
      out.look.copy(a.look).lerp(b.look, w);
      out.fov = a.fov + (b.fov - a.fov) * w;
      out.roll = a.roll + (b.roll - a.roll) * w;
      // Never below the land on the way round.
      const g = ctx.groundAt(out.pos.x, out.pos.z) + 0.6;
      if (out.pos.y < g && ctx.ceilingAt(out.pos.x, out.pos.z, ctx.sCar) === null) out.pos.y = g;
    }
    // Inside a tunnel the vault is the ceiling.
    const ceil = ctx.ceilingAt(out.pos.x, out.pos.z, ctx.sCar);
    if (ceil !== null && out.pos.y > ceil - 0.8) out.pos.y = ceil - 0.8;
    const cam = this.camera;
    cam.position.copy(out.pos);
    cam.lookAt(out.look);
    if (out.roll) cam.rotateZ(out.roll);
    if (Math.abs(cam.fov - out.fov) > 0.01) {
      cam.fov = out.fov;
      cam.updateProjectionMatrix();
    }
    this.camS = ctx.sCar;
  }

  // --- audit ------------------------------------------------------------------------

  /**
   * One frame of bookkeeping for headless checks: is the car in frame, is the
   * lens inside the land, did the camera jump without a dissolve.
   */
  audit(stats, car) {
    const cam = this.camera;
    cam.updateMatrixWorld();
    const v = this._v.set(car.x, car.y + 0.7, car.z).project(cam);
    const inFrame = v.z < 1 && Math.abs(v.x) < 0.92 && Math.abs(v.y) < 0.9;
    const w = this.world;
    const p = cam.position;
    const ctx = this.ctx;
    const inside = !!ctx && (p.y < w.terrainAt(p.x, p.z) - 0.3 || ctx.solidAt(p.x, p.y, p.z)) && !ctx.inEnvelope(p, this.camS);
    // In frame is not in sight: a hillside or a viaduct's parapet can stand
    // between the lens and the car. Not asked in a tunnel, or from a lens on
    // the carriageway itself.
    const aim = this._h || (this._h = new THREE.Vector3());
    const hidden = !!ctx && inFrame && !ctx.carInTunnel && !ctx.inEnvelope(p, this.camS)
      && !ctx.clear(p, aim.set(car.x, car.y + 0.8, car.z));
    stats.frames = (stats.frames || 0) + 1;
    stats.inFrame = (stats.inFrame || 0) + (inFrame ? 1 : 0);
    stats.hidden = (stats.hidden || 0) + (hidden ? 1 : 0);
    stats.inside = (stats.inside || 0) + (inside ? 1 : 0);
    stats.events = stats.events || [];
    const note = (what) => {
      if (stats.events.length < 24) {
        stats.events.push({ what, t: +this.clock.toFixed(2), shot: this.shotName,
          prev: this.prev ? this.prev.type : null, glide: +this.glide.toFixed(2),
          cam: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)], car: [+car.x.toFixed(1), +car.y.toFixed(1), +car.z.toFixed(1)] });
      }
    };
    if (inside) note('inside');
    if (!inFrame) note('out of frame');
    if (hidden) note('hidden');
    const last = stats._last;
    if (last) {
      const moved = Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z);
      const carMoved = Math.hypot(car.x - last.cx, car.z - last.cz);
      const jump = moved > Math.max(3, carMoved * 2 + 1);
      // The chase rig follows the ground under its own lens, and can step where
      // that ground does; that is the chase camera's own behaviour, counted
      // apart from anything the director did.
      if (jump && !last.cutting && last.shot === 'chase' && !last.gliding) {
        stats.chaseSteps = (stats.chaseSteps || 0) + 1;
      } else if (jump && !last.cutting) {
        stats.hardCuts = (stats.hardCuts || 0) + 1;
        note('hard cut ' + moved.toFixed(1) + ' m');
      }
      if (jump) stats.jumps = (stats.jumps || 0) + 1;
    }
    stats._last = { x: p.x, y: p.y, z: p.z, cx: car.x, cz: car.z, cutting: !!this.pending,
      shot: this.shotName, gliding: !!this.prev };
    const type = this.shotName;
    stats.time = stats.time || {};
    stats.time[type] = (stats.time[type] || 0) + 1;
  }
}
