// What spreads over the ground in the Upside Down: roots, black and glossy,
// that come in out of the dark country at the edge of the land and creep
// across it toward the road, forking as they go, and stop at the shoulder.
// Where a root has got to, a tentacle stands up out of its end.
//
// A root is a chain of short tubes, laid on the ground when it is begun and
// grown by the vertex shader from then on: each segment has a time to start
// and a time to take, so the CPU does nothing while it spreads. It is a few
// metres a second, fast enough to see it come at the road as the car does.
// How far the Upside Down has got over what the car has driven (`creepU.uInfect`,
// 0 at the way in and 1 after a minute and a half) sets how many roots there
// are, how many tentacles, and how thick the veins on the ground are drawn
// (render/terrain.js).

import * as THREE from 'three';
import { GROUND, HALF_FLAT } from '../world/road.js';
import { atmo } from './atmosphere.js';
import { styleU } from './style.js';
import { twistU, TWIST_PARS } from './twist.js';

export const creepU = { uInfect: { value: 0 } };

const MAX_SEG = 1100;
const MAX_ROOTS = 16;
const SIDES = 5;
const SPEED = [4.5, 8];            // m/s a root grows at, from the slowest to the quickest

const VERTEX = /* glsl */`
${TWIST_PARS}
attribute vec4 aA;      // where a segment starts, and when it begins to grow
attribute vec4 aB;      // where it ends, and how long it takes
attribute vec3 aR;      // its radius at the start and at the end, and its own draw
uniform float uClock;
uniform vec3 uCam;
uniform vec3 fogParams;
uniform vec3 uFogCol;
uniform float uFlash;
varying vec3 vCol;
void main() {
  float g = clamp( ( uClock - aA.w ) / max( aB.w, 1e-3 ), 0.0, 1.0 );
  vCol = vec3( 0.0 );
  if ( g <= 0.0 ) {
    gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    return;
  }
  vec3 d = aB.xyz - aA.xyz;
  float len = max( length( d ), 1e-3 );
  vec3 T = d / len;
  vec3 S = normalize( cross( T, abs( T.y ) > 0.9 ? vec3( 1.0, 0.0, 0.0 ) : vec3( 0.0, 1.0, 0.0 ) ) );
  vec3 U = cross( S, T );
  float along = position.y * g;
  vec3 c = aA.xyz + d * along;
  float r = mix( aR.x, aR.y, along );
  // The tip of a root still growing is round.
  float growing = 1.0 - step( 0.999, g );
  r *= mix( 1.0, 0.3, growing * smoothstep( 0.55, 1.0, position.y ) );
  vec3 N = S * position.x + U * position.z;
  vec3 wp = c + N * r;
  vec4 mv = viewMatrix * vec4( wp, 1.0 );
  gl_Position = projectionMatrix * twistView( mv );
  // Black, with the red of what is under the skin at the head of the growth,
  // a slow pulse along it, and a sheen at the edges.
  float age = uClock - aA.w;
  float head = growing * smoothstep( 0.4, 1.0, position.y );
  float fresh = 1.0 - smoothstep( 1.0, 5.0, age );
  float pulse = 0.5 + 0.5 * sin( uClock * 2.0 - ( aA.x * 0.31 + aA.z * 0.23 ) + aR.z * 6.0 );
  float rim = pow( 1.0 - abs( dot( normalize( N ), normalize( uCam - wp ) ) ), 2.0 );
  vec3 col = vec3( 0.045, 0.012, 0.012 );
  col += vec3( 0.95, 0.12, 0.05 ) * ( 0.12 * head + 0.02 * fresh + 0.012 * pulse + 0.02 * uFlash );
  col += vec3( 0.35, 0.08, 0.06 ) * rim * 0.22;
  vCol = mix( col, uFogCol, 1.0 - exp( -max( -mv.z, 0.0 ) * fogParams.x * 0.9 ) );
}
`;

const FRAGMENT = /* glsl */`
uniform float uStyleMark;
varying vec3 vCol;
void main() {
  // Marked as the animals are, so a style that inks them inks these.
  gl_FragColor = vec4( vCol, mix( 1.0, 0.3, uStyleMark ) );
}
`;

function tubeGeometry() {
  const pos = [];
  const idx = [];
  for (let e = 0; e < 2; e++) {
    for (let s = 0; s < SIDES; s++) {
      const a = (s / SIDES) * Math.PI * 2;
      pos.push(Math.cos(a), e, Math.sin(a));
    }
  }
  for (let s = 0; s < SIDES; s++) {
    const n = (s + 1) % SIDES;
    idx.push(s, n, SIDES + n, s, SIDES + n, SIDES + s);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Creep {
  // env: road, groundAt(x, z), worlds, seed; onTip(x, y, z, wait, size): where
  // a tentacle may stand up when a root gets there.
  constructor(scene, env, onTip) {
    this.env = env;
    this.onTip = onTip;
    this.rand = mulberry32((env.seed || 0) ^ 0xc4ee9);
    const geo = tubeGeometry();
    this.A = new Float32Array(MAX_SEG * 4).fill(0);
    this.B = new Float32Array(MAX_SEG * 4).fill(0);
    this.R = new Float32Array(MAX_SEG * 3).fill(0);
    for (let i = 0; i < MAX_SEG; i++) this.A[i * 4 + 3] = 1e9;
    for (const [name, arr, n] of [['aA', this.A, 4], ['aB', this.B, 4], ['aR', this.R, 3]]) {
      const attr = new THREE.InstancedBufferAttribute(arr, n);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, attr);
    }
    geo.instanceCount = MAX_SEG;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = geo;
    this.uniforms = {
      uClock: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uFogCol: { value: new THREE.Color() },
      uFlash: { value: 0 },
      uStyleMark: styleU.uStyleMark,
      fogParams: atmo.fogParams,
      ...twistU,
    };
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.free = Array.from({ length: MAX_SEG }, (_, i) => MAX_SEG - 1 - i);
    this.roots = [];
    this.clock = 0;
    this.spawnClock = 0;
    this.shown = 0;
    this._w = { a: 0, b: 0, t: 0, u: 0 };
  }

  // The floating origin has moved.
  shift(dx, dz) {
    for (let i = 0; i < MAX_SEG; i++) {
      this.A[i * 4] -= dx;
      this.A[i * 4 + 2] -= dz;
      this.B[i * 4] -= dx;
      this.B[i * 4 + 2] -= dz;
    }
    for (const r of this.roots) {
      r.x -= dx;
      r.z -= dz;
    }
    this.geo.attributes.aA.needsUpdate = true;
    this.geo.attributes.aB.needsUpdate = true;
  }

  _seg(ax, ay, az, bx, by, bz, t0, dur, r0, r1, draw, root) {
    const i = this.free.pop();
    if (i === undefined) return false;
    this.A.set([ax, ay, az, t0], i * 4);
    this.B.set([bx, by, bz, dur], i * 4);
    this.R.set([r0, r1, draw], i * 3);
    root.slots.push(i);
    return true;
  }

  // One root: out at the edge of the land, 15 to 45 m off the road, wandering
  // in to the verge and, once there, a little way along it; with forks.
  _grow(s, side, k) {
    const env = this.env;
    const road = env.road;
    const p = road.at(s);
    if (!p || p.kind !== GROUND) return false;
    const rand = this.rand;
    const nx = -Math.sin(p.theta) * side;
    const nz = Math.cos(p.theta) * side;
    const lat0 = HALF_FLAT + 12 + rand() * 32;
    let x = p.x + nx * lat0;
    let z = p.z + nz * lat0;
    if (env.worlds && env.worlds.main(x + road.origin.x, z + road.origin.z) !== env.up) return false;
    const root = { slots: [], x: p.x, z: p.z, side, born: this.clock };
    const speed = SPEED[0] + (SPEED[1] - SPEED[0]) * rand();
    // Headed for the road, with some wander; along the road's own line the
    // lateral distance is read at its centre (a bend is small over 50 m).
    let h = Math.atan2(-nz, -nx) + (rand() - 0.5) * 1.1;
    let t0 = this.clock + rand() * 0.4;
    let y = env.groundAt(x, z);
    const thick = 0.15 + 0.08 * rand() + 0.06 * k;
    let along = 0;
    const draw = rand();
    const tips = [];
    const walk = (x0, z0, y0, h0, n, thick0, depth) => {
      let cx = x0;
      let cz = z0;
      let cy = y0;
      let hh = h0;
      let tt = t0;
      let alongSide = 0;
      for (let j = 0; j < n; j++) {
        const len = 1.4 + rand() * 0.9;
        hh += (rand() - 0.5) * 0.85;
        const lat = (cx - p.x) * nx + (cz - p.z) * nz;
        // Not onto the asphalt: at the shoulder it turns along the road.
        if (lat < HALF_FLAT + 2.2) {
          const sgn = alongSide || (rand() < 0.5 ? 1 : -1);
          alongSide = sgn;
          const tx = -nz * sgn;
          const tz = nx * sgn;
          const want = Math.atan2(tz, tx) + (rand() - 0.5) * 0.4;
          hh += Math.atan2(Math.sin(want - hh), Math.cos(want - hh)) * 0.6;
          if (lat < HALF_FLAT + 1.2) hh += Math.atan2(Math.sin(Math.atan2(nz, nx) - hh), Math.cos(Math.atan2(nz, nx) - hh)) * 0.8;
          if (j > n * 0.6) break;
        }
        const ex = cx + Math.cos(hh) * len;
        const ez = cz + Math.sin(hh) * len;
        const ey = env.groundAt(ex, ez);
        const r0 = thick0 * (1 - 0.7 * (j / n));
        const r1 = thick0 * (1 - 0.7 * ((j + 1) / n));
        const dur = len / speed;
        if (!this._seg(cx, cy + r0 * 0.4, cz, ex, ey + r1 * 0.4, ez, tt, dur, r0, r1, draw, root)) return;
        tt += dur;
        cx = ex;
        cz = ez;
        cy = ey;
        // A fork: thinner, and off to one side.
        if (depth < 2 && j > 2 && j < n - 3 && rand() < 0.15) {
          const save = t0;
          t0 = tt;
          walk(cx, cz, cy, hh + (rand() < 0.5 ? -1 : 1) * (0.6 + rand() * 0.5), 3 + Math.floor(rand() * 5), thick0 * 0.6, depth + 1);
          t0 = save;
        }
      }
      tips.push([cx, cy, cz, tt]);
    };
    walk(x, z, y, h, 12 + Math.floor(rand() * 10), thick, 0);
    // Where a root has got to, something comes up out of it.
    for (const [tx, ty, tz, tt] of tips) {
      if (this.onTip && rand() < 0.7) this.onTip(tx, ty, tz, Math.max(0, tt - this.clock), 0.6 + rand() * 0.8);
    }
    root.last = this.clock + 60;
    this.roots.push(root);
    return true;
  }

  // Every frame. ctx: car, sCar, camera, fogColor, flash, k (how much of the
  // Upside Down the look is), infect (0..1).
  update(dt, ctx) {
    this.clock += dt;
    const { car, sCar, k } = ctx;
    const u = this.uniforms;
    u.uClock.value = this.clock;
    u.uCam.value.copy(ctx.camera.position);
    u.uFogCol.value.copy(ctx.fogColor);
    u.uFlash.value = ctx.flash || 0;

    // Roots well behind the car are gone.
    const fx = Math.cos(car.yaw);
    const fz = Math.sin(car.yaw);
    for (let i = this.roots.length - 1; i >= 0; i--) {
      const r = this.roots[i];
      const ahead = (r.x - car.x) * fx + (r.z - car.z) * fz;
      if (ahead < -90 || k < 0.15) {
        for (const slot of r.slots) {
          this.A[slot * 4 + 3] = 1e9;
          this.free.push(slot);
        }
        this.geo.attributes.aA.needsUpdate = true;
        this.roots.splice(i, 1);
      }
    }

    const infect = ctx.infect || 0;
    const want = Math.round(MAX_ROOTS * Math.min(1, Math.max(0, (k - 0.3) / 0.6)) * (0.35 + 0.65 * infect));
    this.spawnClock -= dt;
    if (this.spawnClock <= 0 && this.roots.length < want) {
      this.spawnClock = 0.35;
      for (let attempt = 0; attempt < 4; attempt++) {
        const s = sCar + 45 + this.rand() * 180;
        if (this._grow(s, this.rand() < 0.5 ? -1 : 1, infect)) {
          this.geo.attributes.aA.needsUpdate = true;
          this.geo.attributes.aB.needsUpdate = true;
          this.geo.attributes.aR.needsUpdate = true;
          break;
        }
      }
    }
    this.shown = MAX_SEG - this.free.length;
    this.mesh.visible = this.shown > 0;
  }
}
