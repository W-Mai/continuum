// The Upside Down (world 'upside'): what is in it that is not land, and what
// happens at the way in.
//
//  - The turn. Where the world ahead is the Upside Down the view is turned
//    over (render/twist.js): the table of angles by depth is laid here from
//    the share of it in the world at each point of the road ahead, so
//    approaching it the road twists about the line of sight, and once in it
//    the whole world is the other way up. A car on the wheel steers the
//    other way then, as left and right have changed places on the screen.
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
import { TWIST_N, setTwist, twistDepth, twistAngle } from './twist.js';
import { Creep, creepU } from './creep.js';

const UP = WORLD_INDEX.upside;
// The world is turned over between these shares of the blend into it: the
// look (sky, haze, light) changes over all of it, the turn over its middle.
const FLIP = [0.4, 0.62];
const EYE = 8;               // the camera's usual distance from the car
const FRUSTUM_TO = 10;       // entries of the table (to 600 m) that decide whether the frustum test is off

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
    this.angles = new Float32Array(TWIST_N);
    this.turning = false;       // the view is turned about the line of sight at all
    this.roll = 0;              // by how much, a car's length ahead of the lens
    this.share = 0;             // how much the world under the car is the Upside Down
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
    this._culled = new Map();
  }

  // How much of the Upside Down the world is at an absolute point.
  shareAt(ax, az) {
    const worlds = this.env.worlds;
    if (!worlds) return 0;
    const w = worlds.at(ax, az, this._w);
    const f = smoothstep(FLIP[0], FLIP[1], w.t);
    return (w.a === UP ? 1 - f : 0) + (w.b === UP && w.a !== UP ? f : 0);
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

  // Lay the twist table from the road ahead, and keep the frustum test off
  // while the view is turned about the line of sight (what is out of the
  // frustum before the turn can be in it after).
  _twist(sCar, origin, scene) {
    const road = this.env.road;
    const top = road.classified * STEP - 2;
    let last = 0;
    for (let i = 0; i < TWIST_N; i++) {
      const s = Math.min(sCar + twistDepth(i) - EYE, top);
      const p = road.at(s);
      if (p) last = this.shareAt(p.x + origin.x, p.z + origin.z);
      this.angles[i] = Math.PI * last;
    }
    this.turning = setTwist(this.angles);
    this.roll = twistAngle(EYE + 6, this.angles);
    this.share = this.angles[1] / Math.PI;
    // The first of the table is the lens's own place on the road, so a lens
    // beside the road in a world that is not the road's is a little out.
    // Out to 600 m: what is further is only the far land, and a mountain's
    // being left out for a moment is not seen.
    let varies = false;
    for (let i = 1; i <= FRUSTUM_TO; i++) if (Math.abs(this.angles[i] - this.angles[0]) > 1e-3) varies = true;
    this._frustum(scene, varies);
  }

  _frustum(scene, off) {
    if (off) {
      scene.traverse((o) => {
        if (o.isMesh && !this._culled.has(o) && o.frustumCulled) {
          this._culled.set(o, true);
          o.frustumCulled = false;
        }
      });
    } else if (this._culled.size) {
      for (const o of this._culled.keys()) o.frustumCulled = true;
      this._culled.clear();
    }
  }

  // Every frame. ctx: camera, car, sCar, origin, upside (the look's number),
  // scene.
  update(dt, ctx) {
    this.time += dt;
    timeUniform.value = this.time % 3600;
    const { camera, car, sCar, origin } = ctx;
    this._twist(sCar, origin, ctx.scene);
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
