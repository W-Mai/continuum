// The Upside Down (world 'upside'): what is in it that is not land, and what
// happens at the way in.
//
//  - The turn. Where the road crosses into the Upside Down the world is
//    wound over: the road into a corkscrew, a half turn about the way it
//    runs, and the land folded over with it, more slowly the further from
//    the road it is (render/twist.js). Past it the whole world is the other
//    way up. The car drives along the corkscrew and goes over with it, and
//    the view rolls with the car (render/turn.js). Here the stretch is found
//    on the road, and each frame the winding and the roll are laid from
//    where the car is. The sky does not turn: under its horizon is the sky
//    of the other side, the same sky the other way up. What is drawn turned
//    is tested against the frustum where it is drawn. A car on the wheel
//    steers the other way once it is over, as left and right have changed
//    places on the screen.
//  - Lightning. In the cloud, at random, with a flash the whole world takes:
//    a bolt, a red glare, and now and then, for the length of a flash, the
//    shape of something enormous on the horizon (the sky shader draws it).
//  - Things that stand by the road and lean toward the car: tentacles, up out
//    of the ground, each with a sway of its own.

import * as THREE from 'three';
import { WORLDS, WORLD_INDEX } from '../world/worlds.js';
import { GROUND, HALF_FLAT, STEP } from '../world/road.js';
import { smoothstep } from '../world/noise.js';
import { withAtmosphere, withSunMask } from './atmosphere.js';
import { Turn } from './turn.js';
import { setTwist, clearTwist, twistAt, twistNear, twistRef, twistOff, twistPoint, twistTurned, twistReach, CAR, skyTurnU } from './twist.js';
import { Creep, creepU } from './creep.js';

const UP = WORLD_INDEX.upside;
// The world is the other way up between these shares of the blend into it:
// the look (sky, haze, light) changes over all of it, the way up over its
// middle.
const FLIP = [0.4, 0.62];
// The corkscrew: the road is wound a half turn over this length of it, about
// the place where the world under it is half the Upside Down.
export const TWIST_LEN = 500;
// It is wound about a straight line, and a road that bends away from the
// line is swung round it: the stretch is as long as the road keeps within
// ROAD_OFF m of one and is no more than ROAD_SLACK longer than it, shorter
// by TWIST_TRIM at a time, down to TWIST_MIN.
export const TWIST_MIN = 200;
const TWIST_TRIM = 50;
const ROAD_OFF = 30;
const ROAD_SLACK = 1.07;
// Where the road crosses the border on a bend, the stretch is put on the
// nearest straight enough length of road within this far of the crossing.
const TWIST_SHIFT = [0, 50, -50, 100, -100, 150, -150, 200, -200, 250, -250, 300, -300, 350, -350, 400, -400, 450, -450, 500, -500];
// How far along the road, each way, a winding is looked for and kept. The
// land is drawn 6.5 km out (render/terrain.js) and the fold of it reaches
// 1.5 km from the border (render/twist.js), so one this far up the road is
// not in sight yet.
export const REACH = 7000;
// Under the sky's horizon is the sky of the other side: toward the fold from
// any distance, and all round while the car is within SKY[0] m of the wound
// stretch (along its line) or in it, or within SKY_PAST[0] m of the border
// in the worlds' progress; from SKY[1] and SKY_PAST[1] m, away from the fold
// the dome's own ground is under its horizon, as anywhere else.
const SKY = [150, 400];
const SKY_PAST = [400, 1200];
// A layer no lens looks at.
const UNSEEN = 1 << 30;
const SCAN_STEP = 10;         // m, the road is read this often for the border
const SCAN_EVERY = 0.5;       // s
// A car this far along the road in a frame has been put there, not driven.
const JUMP = 40;

const _pv = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere();
const _c = new THREE.Vector3();

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- tentacles ---------------------------------------------------------------

// One unit tall, a gentle S, thick at the foot and fine at the tip, near
// black at the foot and red in the last of it.
function tentacleGeometry() {
  const sides = 6;
  const rings = 14;
  const pos = [];
  const nrm = [];
  const col = [];
  const idx = [];
  const foot = new THREE.Color(0x15101a);
  const tip = new THREE.Color(0xa01c20);
  const c = new THREE.Color();
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const cx = 0.1 * Math.sin(t * 3.1) * t;
    const cz = 0.07 * Math.cos(t * 2.3) * t;
    const rad = 0.075 * Math.pow(1 - t, 0.8) + 0.008;
    c.copy(foot).lerp(tip, Math.pow(t, 2.4));
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      pos.push(cx + nx * rad, t, cz + nz * rad);
      nrm.push(nx, 0.15, nz);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < sides; s++) {
      const a = r * sides + s;
      const b = r * sides + ((s + 1) % sides);
      idx.push(a, b + sides, b, a, a + sides, b + sides);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

const timeUniform = { value: 0 };
const carUniform = { value: new THREE.Vector3() };

function tentacleMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0, emissive: 0x3a0606, emissiveIntensity: 0.6 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTenTime = timeUniform;
    shader.uniforms.uTenCar = carUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTenTime;
uniform vec3 uTenCar;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  // Toward the car, the nearer it is the more (its own frame is the world's,
  // an instance is scaled and not turned), and a sway of its own.
  vec3 at = vec3( instanceMatrix[3].x, 0.0, instanceMatrix[3].z );
  vec2 toCar = uTenCar.xz - at.xz;
  float dist = length( toCar );
  float lean = smoothstep( 46.0, 7.0, dist );
  float ph = at.x * 0.37 + at.z * 0.53;
  float bend = position.y * position.y;
  transformed.xz += toCar / max( dist, 0.1 ) * bend * lean * 0.55;
  transformed.x += bend * 0.09 * sin( uTenTime * 1.1 + ph );
  transformed.z += bend * 0.09 * sin( uTenTime * 0.9 + ph * 1.7 + 1.3 );
}`);
  };
  mat.customProgramCacheKey = () => 'continuum-tentacle';
  return withSunMask(withAtmosphere(mat), false);
}

const MAX_TENTACLES = 70;

export class Upside {
  // env: road, groundAt(x, z), worlds (the schedule), seed.
  constructor(scene, env) {
    this.env = env;
    this.rand = mulberry32((env.seed || 0) ^ 0x7e11);
    this.turn = new Turn();
    this.turning = false;       // the view is on its way over
    this.roll = 0;              // the view's roll about the line of sight (π at rest in it)
    this.rate = 0;              // rad/s
    this.share = 0;             // how much the world under the car is the Upside Down
    this.scene = scene;
    // The stretch of road that is wound, nearest the car: null, or
    // { s: where on the road its middle is, ax, az: its start (absolute),
    //   p: its start (the scene's), d: the way it runs, len, lo, span }.
    this.zone = null;
    this.twisted = false;       // anything in reach is drawn turned
    this._scan = 0;
    this._u = 0;                // where the car is along the stretch's line
    this._car = { x: 0, y: 0, z: 0 };
    // The road as read for crossings so far (_read): from lo to `to` along
    // it, the crossings found (s, into), and the last sample read.
    this._seen = { cuts: -1, lo: 0, to: -Infinity, ps: 0, pv: -1, list: [] };
    // Meshes the frustum test is off for, as they are drawn turned (cull),
    // and how each mesh that stays where it is is wound.
    this._culled = new Map();
    this._cullPass = 0;
    this._wound = new WeakMap();
    this._s = undefined;        // where the car was along the road, a frame ago
    this._z = { share: 0, out: false };
    this.flash = 0;
    this.bolt = new THREE.Vector4(0, 0.9, 0, 0);
    this._age = 99;
    this._next = 4;
    this._strikes = 0;
    this.strikes = 0;           // how many there have been, for the thunder
    this._w = { a: 0, b: 0, t: 0, u: 0 };
    this.tentacles = [];
    // How far the Upside Down has got over the land the car has driven
    // through: 0 at the way in, 1 after a minute and a half (render/creep.js).
    this.infect = 0;
    this.creep = new Creep(scene, { road: env.road, groundAt: env.groundAt, worlds: env.worlds, seed: env.seed, up: UP },
      (x, y, z, wait, size) => this._tip(x, y, z, wait, size));
    this.mesh = new THREE.InstancedMesh(tentacleGeometry(), tentacleMaterial(), MAX_TENTACLES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.count = 0;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.dummy = new THREE.Object3D();
    this.spawnClock = 0;
    this.time = 0;
  }

  // How much of the Upside Down the world is at an absolute point, and
  // whether the point is on the way out of it (the world here is the Upside
  // Down, turning into another) or on the way in.
  zoneAt(ax, az) {
    const z = this._z;
    const worlds = this.env.worlds;
    if (!worlds) {
      z.share = 0;
      z.out = false;
      return z;
    }
    const w = worlds.at(ax, az, this._w);
    const f = smoothstep(FLIP[0], FLIP[1], w.t);
    z.out = w.a === UP;
    z.share = (z.out ? 1 - f : 0) + (w.b === UP && !z.out ? f : 0);
    return z;
  }

  shareAt(ax, az) {
    return this.zoneAt(ax, az).share;
  }

  // The floating origin has moved: so have the tentacles' coordinates.
  shift(dx, dz) {
    for (const t of this.tentacles) {
      t.x -= dx;
      t.z -= dz;
    }
    this.creep.shift(dx, dz);
  }

  // A root has come to a point: a tentacle stands up out of it when the root
  // gets there (wait, s), as big as the root is old.
  _tip(x, y, z, wait, scale) {
    if (this.tentacles.length >= MAX_TENTACLES) return;
    this.tentacles.push({ x, z, y: y - 0.4, size: (2.2 + this.rand() * 6) * scale, grow: 0, wait: wait + 0.3, leaving: false });
  }

  // Where the road crosses the border of the Upside Down (the world under it
  // is half of it), within REACH of the car. The road, once laid, stays, so
  // it is read once, as it is laid: only what is new of it each time. A road
  // cut and laid again (road.cuts) is read again from the start.
  _read(sCar) {
    const road = this.env.road;
    const o = road.origin;
    const seen = this._seen;
    const from = Math.max(road.start + 1, sCar - REACH - TWIST_LEN);
    const to = Math.min(road.classified * STEP - 2, sCar + REACH + TWIST_LEN);
    if (seen.cuts !== road.cuts || seen.to < from) {
      seen.cuts = road.cuts;
      seen.lo = from;
      seen.to = from - SCAN_STEP;
      seen.pv = -1;
      seen.list.length = 0;
    }
    for (let s = seen.to + SCAN_STEP; s <= to; s += SCAN_STEP) {
      seen.to = s;
      const p = road.at(s);
      if (!p) continue;
      const v = this.shareAt(p.x + o.x, p.z + o.z);
      if (seen.pv >= 0 && (seen.pv < 0.5) !== (v < 0.5)) {
        seen.list.push({ s: seen.ps + (s - seen.ps) * (0.5 - seen.pv) / (v - seen.pv), into: v > seen.pv });
      }
      seen.ps = s;
      seen.pv = v;
    }
    while (seen.list.length && seen.list[0].s < from) seen.list.shift();
    if (seen.lo < from) seen.lo = from;
    return seen;
  }

  // The crossing nearest the car, and the stretch by it that is wound: a
  // straight line from half its length before its middle on the road to as
  // far after. Its middle is the crossing where the road is straight enough
  // there, and the nearest such place along the road where it is not. A
  // stretch found is kept until another crossing is nearer.
  _findZone(sCar) {
    const road = this.env.road;
    const o = road.origin;
    const seen = this._read(sCar);
    let best = null;
    for (const c of seen.list) {
      if (!best || Math.abs(c.s - sCar) < Math.abs(best.s - sCar)) best = c;
    }
    const z = this.zone;
    if (z && z.cross >= seen.lo && z.cross <= seen.to) {
      // The road it is on has been read: it is kept if it is still the
      // nearest crossing (a road laid again after a turn may not cross there).
      if (best && Math.abs(z.cross - best.s) < SCAN_STEP) return;
      this.zone = null;
    } else if (z) {
      // The road behind is let go of before the winding is out of reach.
      if (Math.abs(z.cross - sCar) > REACH + TWIST_LEN) this.zone = null;
      else if (!best || Math.abs(z.cross - sCar) <= Math.abs(best.s - sCar)) return;
    }
    if (!best) return;
    // Not all of it is laid yet: it is far ahead, and will be.
    if (best.s > sCar && !road.at(best.s + TWIST_LEN / 2 + Math.max(...TWIST_SHIFT))) return;
    // How straight L of the road about s is: how far it strays from the
    // line between its ends, and how long that line is (nothing known
    // where it is not all laid).
    const lie = (s, L) => {
      const a = road.at(s - L / 2);
      const b = road.at(s + L / 2);
      if (!a || !b) return null;
      const cx = b.x - a.x;
      const cz = b.z - a.z;
      const cl = Math.hypot(cx, cz) || 1;
      let off = 0;
      for (let q = s - L / 2; q <= s + L / 2; q += SCAN_STEP) {
        const p = road.at(q);
        off = Math.max(off, Math.abs((p.x - a.x) * -cz + (p.z - a.z) * cx) / cl);
      }
      return { off, chord: cl };
    };
    let mid = best.s;
    let run = 0;
    let straightest = 0;
    search: for (const shift of TWIST_SHIFT) {
      for (let L = TWIST_LEN; L >= TWIST_MIN; L -= TWIST_TRIM) {
        const l = lie(best.s + shift, L);
        if (!l) continue;
        if (l.off <= ROAD_OFF && L <= l.chord * ROAD_SLACK) {
          mid = best.s + shift;
          run = L;
          break search;
        }
        // Nowhere straight: the shortest stretch, where it is straightest.
        if (L === TWIST_MIN && l.chord > straightest) {
          straightest = l.chord;
          mid = best.s + shift;
        }
      }
    }
    if (!run) run = TWIST_MIN;
    const a = road.at(mid - run / 2);
    const b = road.at(mid + run / 2);
    const m = road.at(mid);
    if (!a || !b || !m) return;
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    let len = Math.hypot(dx, dz);
    if (len < TWIST_MIN / 4) {
      // The road doubles back on itself here: along it at the middle.
      dx = Math.cos(m.theta);
      dz = Math.sin(m.theta);
      len = TWIST_MIN / 4;
    } else {
      dx /= len;
      dz /= len;
    }
    this.zone = {
      // Where the road crosses the border, the middle of the stretch on the
      // road, and how much of the road it is.
      cross: best.s, s: mid, run,
      ax: a.x + o.x, az: a.z + o.z, p: { x: 0, z: 0 }, d: { x: dx, z: dz }, len,
      // The road's height at the middle, and the worlds' progress there.
      y: m.y, ub: this.env.worlds ? this.env.worlds.rawU(m.x + o.x, m.z + o.z) : 0,
      // Going in is a half turn from upright, going out a half turn on from
      // upside down: the same way round.
      lo: best.into ? 0 : Math.PI, span: Math.PI,
    };
  }

  // Every frame, once the chase or the director has put the camera where it
  // goes. How far along the road the car is gives the angle the road has
  // under it: the camera is rolled by that (render/turn.js), and the world
  // is drawn turned by its own angle less the car's (render/twist.js), the
  // sky as _sky says. The frustum is seen to later (cull).
  turnView(dt, camera, car, sCar) {
    const o = this.env.road.origin;
    this.share = this.shareAt(car.x + o.x, car.z + o.z);
    const ds = this._s === undefined ? 0 : sCar - this._s;
    const jump = this._s === undefined || Math.abs(ds) > JUMP;
    this._s = sCar;
    this._scan -= dt;
    if (jump || this._scan <= 0) {
      this._scan = SCAN_EVERY;
      if (jump) {
        this.zone = null;
        this._seen.to = -Infinity;
      }
      this._findZone(sCar);
    }
    const z = this.zone;
    const turn = this.turn;
    const worlds = this.env.worlds;
    if (z && worlds) {
      z.p.x = z.ax - o.x;
      z.p.z = z.az - o.z;
      this._u = (car.x - z.p.x) * z.d.x + (car.z - z.p.z) * z.d.z;
      // Laid before the roll is read (the roll is the winding where the car
      // is), and again once the lens is rolled: the numbers go by how it is
      // drawn.
      this._car.x = car.x;
      this._car.y = car.y;
      this._car.z = car.z;
      setTwist(z, camera, car, sCar, worlds, o);
      turn.set(dt, twistRef(), jump);
      turn.apply(camera, car);
      this.twisted = setTwist(z, camera, car, sCar, worlds, o);
    } else {
      turn.set(dt, this.share > 0.5 ? Math.PI : 0, jump);
      turn.apply(camera, car);
      clearTwist();
      this.twisted = false;
      this._u = 0;
    }
    this._sky(z, car);
    this.roll = turn.roll;
    this.rate = turn.rate;
    this.turning = turn.turning;
  }

  // How far over the land is wound at a point of the scene: 0 upright, π
  // the other way up (2π past the way out). Where the point is, and nothing
  // else, says. (What is by the car is drawn as the car is: twistNear.)
  angleAt(x, z) {
    return this.twisted ? twistAt(x, z) : this.roll;
  }

  // A point of the scene, where it is drawn this frame (as the shaders do
  // it). In place.
  drawn(v, camera) {
    camera.updateMatrixWorld();
    return twistPoint(v.applyMatrix4(camera.matrixWorldInverse)).applyMatrix4(camera.matrixWorld);
  }

  // The sky (render/atmosphere.js, twistSky in render/twist.js). It is two
  // skies, the one the right way up for the world before the winding and
  // the same one a half turn round for the world past it, each above its own
  // horizon and the other's under it; so through the corkscrew, where the car
  // goes from under the one to under the other, the sky holds still on the
  // screen. The dome is turned as the world on the car's side of the middle
  // of the winding (its sky is then the dome's own, above its horizon), and
  // at the middle, where the car is on its side, as the other: the two skies
  // are a half turn apart, so nothing is seen to change. The other sky shows
  // under the horizon toward the fold, where the land has turned away from
  // under it; all round only by the winding itself (SKY, SKY_PAST).
  _sky(z, car) {
    const t = skyTurnU.uSkyTurn.value;
    t[0] = 0;
    t[1] = 0;
    t[2] = 0;
    t[3] = 0;
    if (!this.twisted) return;
    const worlds = this.env.worlds;
    const o = this.env.road.origin;
    const e = (twistRef() - z.lo) / z.span;
    const over = e >= 0.5;
    t[0] = z.span * (over ? 1 - e : -e);
    const u = this._u;
    const past = worlds.rawU(car.x + o.x, car.z + o.z) - z.ub;
    t[1] = Math.max(1 - smoothstep(SKY[0], SKY[1], u < 0 ? -u : Math.max(0, u - z.len)),
      1 - smoothstep(SKY_PAST[0], SKY_PAST[1], Math.abs(past)));
    // The way the fold lies from here: along the worlds' progress toward the
    // border; in the dome's own frame, which past the middle is the other
    // world's, across the winding's line from this one.
    let fx = past < 0 ? worlds.dx : -worlds.dx;
    let fz = past < 0 ? worlds.dz : -worlds.dz;
    if (over) {
      const k = 2 * (fx * z.d.x + fz * z.d.z);
      fx = k * z.d.x - fx;
      fz = k * z.d.z - fz;
    }
    t[2] = fx;
    t[3] = fz;
    const a = skyTurnU.uSkyAxis.value;
    a[0] = z.d.x;
    a[1] = 0;
    a[2] = z.d.z;
  }

  // Every frame, the last thing before it is drawn (the camera and all that
  // is in the scene are where they will be drawn). three tests each mesh
  // against the frustum where it stands, and a turned one is drawn somewhere
  // else: while anything is turned, each mesh three would test is tested
  // here where it is drawn, and if that is in view it is not left to three
  // (frustumCulled off). One wholly where the turn is the car's is left to
  // three as it was. A mesh's bounding sphere's centre is turned as the
  // shaders turn it, and tested at half again its radius, or more where the
  // sphere spans some of the winding (its parts turn by different angles:
  // the angle is read at its middle and at the four ends of it along the
  // winding's line and across). How a mesh is wound is a matter of where it
  // stands, so for one that stays where it is that is worked out once; what
  // the car adds to it by the car is added each frame. Nothing is turned:
  // every mesh as it was.
  cull(camera) {
    const touched = this._culled;
    if (!this.twisted) {
      if (touched.size) {
        for (const obj of touched.keys()) obj.frustumCulled = true;
        touched.clear();
      }
      return;
    }
    const zone = this.zone;
    const pass = ++this._cullPass;
    this.scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pv);
    const ref = twistRef();
    const lean = Math.abs(twistOff());
    const car = this._car;
    const o = this.env.road.origin;
    const view = camera.matrixWorldInverse;
    const back = camera.matrixWorld;
    const wound = this._wound;
    const { x: dx, z: dz } = zone.d;
    const walk = (obj) => {
      if (!obj.visible) return;
      if ((obj.isMesh || obj.isLine || obj.isPoints) && (obj.frustumCulled || touched.has(obj))) {
        let sphere;
        if (obj.boundingSphere !== undefined) {
          if (obj.boundingSphere === null) obj.computeBoundingSphere();
          sphere = obj.boundingSphere;
        } else {
          const g = obj.geometry;
          if (g.boundingSphere === null) g.computeBoundingSphere();
          sphere = g.boundingSphere;
        }
        _c.copy(sphere.center).applyMatrix4(obj.matrixWorld);
        const r = sphere.radius * obj.matrixWorld.getMaxScaleOnAxis();
        const ax = _c.x + o.x;
        const az = _c.z + o.z;
        let w = wound.get(obj);
        if (!w || w.zone !== zone || Math.abs(w.ax - ax) > 1 || Math.abs(w.az - az) > 1 || Math.abs(w.r - r) > 1) {
          if (!w) wound.set(obj, w = {});
          w.zone = zone;
          w.ax = ax;
          w.az = az;
          w.r = r;
          w.angle = twistAt(_c.x, _c.z);
          w.spread = Math.min(Math.PI, 1.25 * Math.max(
            Math.abs(twistAt(_c.x + dx * r, _c.z + dz * r) - w.angle), Math.abs(twistAt(_c.x - dx * r, _c.z - dz * r) - w.angle),
            Math.abs(twistAt(_c.x - dz * r, _c.z + dx * r) - w.angle), Math.abs(twistAt(_c.x + dz * r, _c.z - dx * r) - w.angle)));
        }
        // By the car it is turned as the car is, more or less of it: all
        // of that is allowed for where the mesh reaches into it.
        const angle = w.angle + twistNear(_c.x, _c.y, _c.z);
        const spread = lean > 0 && Math.hypot(_c.x - car.x, _c.y - car.y, _c.z - car.z) - r < CAR[1]
          ? Math.min(Math.PI, w.spread + lean) : w.spread;
        let show = false;
        if (angle !== ref || spread > 0) {
          _c.applyMatrix4(view);
          const rad = Math.max(1.5 * r, r + 2 * (twistReach(_c) + r) * Math.sin(spread / 2));
          twistTurned(_c, angle).applyMatrix4(back);
          show = _frustum.intersectsSphere(_sphere.set(_c, rad));
        }
        if (show) {
          obj.frustumCulled = false;
          touched.set(obj, pass);
        } else if (touched.has(obj)) {
          obj.frustumCulled = true;
          touched.delete(obj);
        }
        // What is there only for what the winding turns (the land's
        // underside, render/terrain.js) is not drawn where it turns nothing.
        if (obj.userData.woundOnly) obj.layers.mask = angle !== ref || spread > 0 ? 1 : UNSEEN;
      }
      const kids = obj.children;
      for (let i = 0; i < kids.length; i++) walk(kids[i]);
    };
    walk(this.scene);
    // What has left the scene, or is hidden, is given back as it was.
    for (const [obj, seen] of touched) {
      if (seen !== pass) {
        obj.frustumCulled = true;
        touched.delete(obj);
      }
    }
  }

  // Every frame. ctx: camera, car, sCar, origin, upside (the look's number).
  update(dt, ctx) {
    this.time += dt;
    timeUniform.value = this.time % 3600;
    const { camera, car, sCar } = ctx;
    carUniform.value.set(car.x, car.y, car.z);

    // Lightning: while the look is the Upside Down's, now and then.
    const k = ctx.upside || 0;
    this._age += dt;
    if (k > 0.2) {
      this._next -= dt;
      if (this._next <= 0) {
        this._next = 3 + this.rand() * 7;
        this._age = 0;
        this._strikes++;
        this.strikes++;
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        const az = Math.atan2(dir.z, dir.x) + (this.rand() - 0.5) * 2.4;
        this.bolt.set(az, 0.8 + this.rand() * 0.35, this.rand() * 80, this._strikes % 3 === 0 ? 1 : 0);
      }
    }
    // A first sharp flash, a second a moment after, and the glow left in the
    // cloud.
    const a = this._age;
    let f = 0;
    if (a < 1.1) {
      f = Math.exp(-a * 6) * (0.7 + 0.3 * Math.sin(a * 80)) + 0.7 * Math.exp(-((a - 0.2) * (a - 0.2)) / 0.003) + 0.25 * Math.exp(-a * 2.2);
    }
    this.flash = Math.min(1, Math.max(0, f)) * Math.min(1, k * 1.4);

    // The longer the car is in it, the further it has spread.
    this.infect = Math.min(1, Math.max(0, this.infect + dt * (k > 0.5 ? 1 / 90 : -1 / 12)));
    creepU.uInfect.value = this.infect;
    this.creep.update(dt, { car, sCar, camera, fogColor: ctx.fogColor, flash: this.flash, k, infect: this.infect });

    this._tentacles(dt, ctx, k);
  }

  // Tentacles by the road, in the Upside Down, grown out of the ground as
  // the car comes up and gone down into it behind.
  _tentacles(dt, ctx, k) {
    const { car, sCar } = ctx;
    const env = this.env;
    const want = Math.round(MAX_TENTACLES * smoothstep(0.35, 0.9, k) * (0.3 + 0.7 * this.infect));
    this.spawnClock -= dt;
    if (this.spawnClock <= 0 && this.tentacles.length < MAX_TENTACLES && this.tentacles.filter((t) => !t.leaving).length < want) {
      this.spawnClock = 0.3;
      for (let attempt = 0; attempt < 6; attempt++) {
        const s = sCar + 40 + this.rand() * 200;
        const p = env.road.at(s);
        if (!p || p.kind !== GROUND) continue;
        const side = this.rand() < 0.5 ? -1 : 1;
        const lat = HALF_FLAT + 2.5 + Math.pow(this.rand(), 1.6) * 30;
        const x = p.x - Math.sin(p.theta) * lat * side;
        const z = p.z + Math.cos(p.theta) * lat * side;
        if (env.worlds && env.worlds.main(x + ctx.origin.x, z + ctx.origin.z) !== UP) continue;
        const y = env.groundAt(x, z);
        this.tentacles.push({ x, z, y: y - 0.4, size: 2.2 + this.rand() * 6, grow: 0, leaving: false });
        break;
      }
    }
    let alive = 0;
    for (let i = this.tentacles.length - 1; i >= 0; i--) {
      const t = this.tentacles[i];
      const ahead = (t.x - car.x) * Math.cos(car.yaw) + (t.z - car.z) * Math.sin(car.yaw);
      if (!t.leaving && (ahead < -50 || k < 0.2)) t.leaving = true;
      // One that waits for a root to reach it stays down until it has.
      if (t.wait > 0) t.wait -= dt;
      const up = t.leaving || t.wait > 0 ? 0 : 1;
      t.grow += (up - t.grow) * Math.min(1, dt * (t.leaving ? 1.5 : 0.8));
      if (t.leaving && t.grow < 0.02) {
        this.tentacles.splice(i, 1);
        continue;
      }
      const d = this.dummy;
      d.position.set(t.x, t.y, t.z);
      d.rotation.set(0, 0, 0);
      d.scale.set(t.size, Math.max(1e-3, t.size * t.grow), t.size);
      d.updateMatrix();
      this.mesh.setMatrixAt(alive++, d.matrix);
    }
    this.mesh.count = alive;
    this.mesh.visible = alive > 0;
    if (alive) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
