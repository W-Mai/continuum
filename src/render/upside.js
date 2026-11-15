// The Upside Down (world 'upside'): what is in it that is not land, and what
// happens at the way in.
//
//  - The turn. Where the road crosses into the Upside Down it is wound into
//    a corkscrew: a half turn about the way it runs, over a stretch of it,
//    the land with it (render/twist.js), and past it the whole world is the
//    other way up. The car drives along it and goes over with it, and the
//    view rolls with the car (render/turn.js). Here the stretch is found on
//    the road, and each frame the winding and the roll are laid from where
//    the car is on it. A car on the wheel steers the other way once it is
//    over, as left and right have changed places on the screen.
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
import { setTwist, clearTwist, twistEase, twistPoint } from './twist.js';
import { Creep, creepU } from './creep.js';

const UP = WORLD_INDEX.upside;
// The world is the other way up between these shares of the blend into it:
// the look (sky, haze, light) changes over all of it, the way up over its
// middle.
const FLIP = [0.4, 0.62];
// The corkscrew: the road is wound a half turn over this length of it, about
// the place where the world under it is half the Upside Down.
export const TWIST_LEN = 200;
// How far from the car, each way, the winding is followed: what is further
// is drawn as what is this far.
const REACH = 1200;
// Meshes are not tested against the frustum while there is winding this near
// the car (what is out of the frustum before it is turned can be in it after).
// Further off it is only the far land, and a mountain's being left out for a
// moment is not seen.
const CULL_OFF = 700;
const SCAN_STEP = 10;         // m, the road is read this often for the border
const SCAN_EVERY = 0.5;       // s
// A car this far along the road in a frame has been put there, not driven.
const JUMP = 40;

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
    this._culled = new Map();
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

  // The place nearest the car where the road crosses the border of the
  // Upside Down (the world under it is half of it), and the stretch about it
  // that is wound: a straight line from TWIST_LEN / 2 before it on the road
  // to as far after. The road, once laid, stays, so a stretch found is kept
  // until another is nearer.
  _findZone(sCar) {
    const road = this.env.road;
    const o = road.origin;
    const from = Math.max(road.start + 1, sCar - REACH - TWIST_LEN);
    const to = Math.min(road.classified * STEP - 2, sCar + REACH + TWIST_LEN);
    let best = null;
    let ps = 0;
    let pv = -1;
    for (let s = from; s <= to; s += SCAN_STEP) {
      const p = road.at(s);
      if (!p) continue;
      const v = this.shareAt(p.x + o.x, p.z + o.z);
      if (pv >= 0 && (pv < 0.5) !== (v < 0.5)) {
        const sm = ps + (s - ps) * (0.5 - pv) / (v - pv);
        if (!best || Math.abs(sm - sCar) < Math.abs(best.s - sCar)) best = { s: sm, into: v > pv };
      }
      ps = s;
      pv = v;
    }
    const z = this.zone;
    if (z && z.s > from && z.s < to) {
      // The road it is on has been read: it is kept if it is still the
      // nearest crossing (a road laid again after a turn may not cross there).
      if (best && Math.abs(z.s - best.s) < SCAN_STEP) return;
      this.zone = null;
    } else if (z) {
      // The road behind is let go of before the winding is out of reach.
      if (Math.abs(z.s - sCar) > REACH + TWIST_LEN) this.zone = null;
      else if (!best || Math.abs(z.s - sCar) <= Math.abs(best.s - sCar)) return;
    }
    if (!best) return;
    const a = road.at(best.s - TWIST_LEN / 2);
    const b = road.at(best.s + TWIST_LEN / 2);
    // Not all of it is laid yet: it is far ahead, and will be.
    if (!a || !b) return;
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    let len = Math.hypot(dx, dz);
    if (len < TWIST_LEN / 4) {
      // The road doubles back on itself here: along it where it crosses.
      const m = road.at(best.s);
      dx = Math.cos(m.theta);
      dz = Math.sin(m.theta);
      len = TWIST_LEN / 4;
    } else {
      dx /= len;
      dz /= len;
    }
    this.zone = {
      s: best.s, ax: a.x + o.x, az: a.z + o.z, p: { x: 0, z: 0 }, d: { x: dx, z: dz }, len,
      // Going in is a half turn from upright, going out a half turn on from
      // upside down: the same way round.
      lo: best.into ? 0 : Math.PI, span: Math.PI,
    };
  }

  // Every frame, once the chase or the director has put the camera where it
  // goes. Where the car is along the wound stretch gives the angle the road
  // has under it: the camera is rolled by that (render/turn.js), and the
  // world is drawn turned by its own angle less the car's (render/twist.js).
  turnView(dt, camera, car, sCar) {
    const o = this.env.road.origin;
    this.share = this.shareAt(car.x + o.x, car.z + o.z);
    const ds = this._s === undefined ? 0 : sCar - this._s;
    const jump = this._s === undefined || Math.abs(ds) > JUMP;
    this._s = sCar;
    this._scan -= dt;
    if (jump || this._scan <= 0) {
      this._scan = SCAN_EVERY;
      if (jump) this.zone = null;
      this._findZone(sCar);
    }
    const z = this.zone;
    const turn = this.turn;
    let u = 0;
    if (z) {
      z.p.x = z.ax - o.x;
      z.p.z = z.az - o.z;
      u = (car.x - z.p.x) * z.d.x + (car.z - z.p.z) * z.d.z;
      turn.set(dt, z.lo + z.span * twistEase(u / z.len), jump);
    } else {
      turn.set(dt, this.share > 0.5 ? Math.PI : 0, jump);
    }
    turn.apply(camera, car);
    this.twisted = z ? setTwist(z, camera, u, REACH) : (clearTwist(), false);
    this._frustum(this.twisted && u - CULL_OFF < z.len && u + CULL_OFF > 0);
    this.roll = turn.roll;
    this.rate = turn.rate;
    this.turning = turn.turning;
  }

  // How far over the world is wound at a point of the scene: 0 upright, π
  // the other way up (2π past the way out). Where the point is, and nothing
  // else, says.
  angleAt(x, z) {
    const zn = this.zone;
    if (!zn) return this.roll;
    return zn.lo + zn.span * twistEase(((x - zn.p.x) * zn.d.x + (z - zn.p.z) * zn.d.z) / zn.len);
  }

  // A point of the scene, where it is drawn this frame (as the shaders do
  // it). In place.
  drawn(v, camera) {
    camera.updateMatrixWorld();
    return twistPoint(v.applyMatrix4(camera.matrixWorldInverse)).applyMatrix4(camera.matrixWorld);
  }

  _frustum(off) {
    if (off) {
      this.scene.traverse((obj) => {
        if (obj.isMesh && obj.frustumCulled && !this._culled.has(obj)) {
          this._culled.set(obj, true);
          obj.frustumCulled = false;
        }
      });
    } else if (this._culled.size) {
      for (const obj of this._culled.keys()) obj.frustumCulled = true;
      this._culled.clear();
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
