// Puddles on the cavern's floor: water standing in its hollows, reflecting what
// glows over it, with the rings of a drop that has fallen spreading across it.
//
// Where they are comes from the plan (world/cavernplan.js): a block of land at a
// time, a few metres of shore at each of twelve points round the middle, at the
// level the water stands at, so that a puddle's edge is the contour of the ground
// and its surface is flat. Those near the lens are laid in one buffer (a fan of
// triangles to a puddle) and drawn after the land, over it, a little darker than
// the ground and as bright as the sky it reflects at a low angle. A drop falling
// into one (render/cavern.js says when and into which) sets three rings going
// from where it lands, each fainter than the last, gone in a second and a half.
//
// In the painted style a puddle is a flat patch of one colour with a clear edge
// and the rings are flat lines; in the block style the edge is hard.

import * as THREE from 'three';
import { twistU, TWIST_PARS } from './twist.js';
import { styleU } from './style.js';
import { atmo } from './atmosphere.js';
import { PUDDLE } from '../world/cavernplan.js';

// range, max: how far off puddles are drawn (m) and how many, at each tier; lift:
// how far over the water's level the surface lies (m); the rings: how many, how
// long after one another (s), how fast they spread (m/s), how long they last (s),
// how thick the first is (m) and how much thicker each grows to; sheen: the
// colour of the sky a puddle reflects where the sky's own is dark; water: the
// colour of the water over the ground (linear) and how much of it covers the
// ground at the middle.
export const PUDDLES = {
  range: { high: 170, mid: 110, low: 0 },
  max: { high: 24, mid: 12, low: 0 },
  lift: 0.012,
  ring: { count: 3, apart: 0.16, speed: 1.5, life: 1.5, width: 0.05, grow: 0.07 },
  sheen: [0.02, 0.04, 0.05],
  reflect: 2.5,
  water: [0.003, 0.009, 0.013],
  cover: 0.82,
  ripple: [0.55, 0.9, 1.0],
};

// The painted style's puddle: the colour it is laid in (as it comes out on the
// screen), the rings' colour, and how bright the ring's line is.
const PAINT = { water: [0.07, 0.19, 0.25], ring: [0.62, 0.92, 0.96], edge: 0.95 };

const FAN = PUDDLE.dirs + 1;

const v3 = (a) => `vec3(${a.map((x) => x.toFixed(4)).join(', ')})`;

function puddleMaterial(shared, sky) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: {
      ...twistU,
      uPair: styleU.uPair,
      uPaintInv: styleU.uPaintInv,
      uBlock: shared.uBlock,
      uTime: shared.uTime,
      uRange: { value: PUDDLES.range.high },
      uHorizon: sky.uHorizon,
      uZenith: sky.uZenith,
      fogParams: atmo.fogParams,
    },
    vertexShader: /* glsl */`
${TWIST_PARS}
attribute vec4 aOff;
attribute vec3 aRip;
uniform float uRange;
varying vec4 vOff;
varying vec3 vRip;
varying vec3 vWorld;
varying float vFade;
void main() {
  vOff = aOff;
  vRip = aRip;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vFade = 1.0 - smoothstep(uRange * 0.7, uRange, length(mv.xyz));
  gl_Position = projectionMatrix * twistView( mv );
}`,
    fragmentShader: /* glsl */`
uniform float uPair;
uniform float uPaintInv;
uniform float uBlock;
uniform float uTime;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 fogParams;
varying vec4 vOff;
varying vec3 vRip;
varying vec3 vWorld;
varying float vFade;
const float R_COUNT = ${PUDDLES.ring.count}.0;
// The rings of a drop that fell at vRip: how much of one there is at this point
// (0 to 1, the brightest of the three), and how recently it fell (1: just now).
float rings( out float fresh ) {
  float age = uTime - vRip.x;
  fresh = 0.0;
  if ( age < 0.0 || age > ${PUDDLES.ring.life.toFixed(2)} ) return 0.0;
  float d = length( vOff.xy - vRip.yz );
  float lit = 0.0;
  for ( int k = 0; k < ${PUDDLES.ring.count}; k++ ) {
    float t = age - float( k ) * ${PUDDLES.ring.apart.toFixed(3)};
    if ( t <= 0.0 || t > ${PUDDLES.ring.life.toFixed(2)} ) continue;
    float w = ${PUDDLES.ring.width.toFixed(3)} + ${PUDDLES.ring.grow.toFixed(3)} * t;
    float x = ( d - t * ${PUDDLES.ring.speed.toFixed(2)} ) / w;
    float a = 1.0 - t / ${PUDDLES.ring.life.toFixed(2)};
    lit = max( lit, exp( -x * x ) * a * a );
  }
  fresh = 1.0 - clamp( age / ${PUDDLES.ring.life.toFixed(2)}, 0.0, 1.0 );
  return lit;
}
void main() {
  float shore = vOff.z;
  float fresh;
  float ring = rings( fresh );
  vec3 V = normalize( cameraPosition - vWorld );
  float cosT = clamp( V.y, 0.0, 1.0 );
  vec4 col;
  if ( uPair > 0.0 ) {
    // The painted style's puddle: a patch of one flat colour with a clear edge, and the
    // rings drawn as flat lines.
    float e = fwidth( shore ) * 1.2 + 1e-4;
    float body = 1.0 - smoothstep( ${PAINT.edge.toFixed(2)} - e, ${PAINT.edge.toFixed(2)} + e, shore );
    float line = smoothstep( 0.22, 0.34, ring );
    vec3 c = mix( ${v3(PAINT.water)}, ${v3(PAINT.ring)}, line ) * uPaintInv;
    col = vec4( c, body * vFade );
  } else {
    // Water over the ground, reflecting the sky: more of it the lower the lens looks, the
    // sky's own at the horizon and the sheen of the roof's glow over it, and the rings lit.
    float fres = 0.04 + 0.96 * pow( 1.0 - cosT, 5.0 );
    float up = smoothstep( 0.0, 0.5, cosT );
    vec3 sky = mix( uHorizon, uZenith, up ) * ${PUDDLES.reflect.toFixed(1)} + ${v3(PUDDLES.sheen)} * ( 1.0 - 0.6 * up );
    vec3 c = ${v3(PUDDLES.water)} * ( 1.0 - fres ) + sky * fres;
    c *= exp( -length( cameraPosition - vWorld ) * fogParams.x );
    c += ${v3(PUDDLES.ripple)} * ring * ( 0.35 + 0.65 * fresh );
    float a = ${PUDDLES.cover.toFixed(2)} * ( 1.0 - smoothstep( 0.8, 1.0, shore ) );
    col = vec4( c, clamp( max( a * vFade, ring * vFade ), 0.0, 1.0 ) );
  }
  // The block style's edge is hard.
  col.a *= mix( 1.0, step( shore, 0.92 ), uBlock );
  gl_FragColor = col;
}`,
  });
}

export class Puddles {
  // env: plan (CavernPlan), origin() (the floating origin), sky (the atmosphere's uniforms).
  constructor(scene, env, shared) {
    this.env = env;
    this.scene = scene;
    const max = PUDDLES.max.high;
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(max * FAN * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.off = new THREE.BufferAttribute(new Float32Array(max * FAN * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.rip = new THREE.BufferAttribute(new Float32Array(max * FAN * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('aOff', this.off);
    geo.setAttribute('aRip', this.rip);
    const idx = new Uint16Array(max * PUDDLE.dirs * 3);
    for (let n = 0; n < max; n++) {
      for (let k = 0; k < PUDDLE.dirs; k++) {
        const b = n * PUDDLE.dirs * 3 + k * 3;
        idx[b] = n * FAN;
        idx[b + 1] = n * FAN + 1 + k;
        idx[b + 2] = n * FAN + 1 + ((k + 1) % PUDDLE.dirs);
      }
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    geo.setDrawRange(0, 0);
    this.material = puddleMaterial(shared, env.sky);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.blocks = new Map();        // block key -> { bx, bz, list: its puddles, as the plan gives them }
    this.list = [];                 // the puddles drawn, nearest first: the plan's, with .slot
    this.count = 0;
    this.known = 0;                 // puddles in the blocks that are laid
    this._rip = new Map();          // puddle key -> { t, x, z }: the last drop to fall in it
    this._dirty = true;
    this._last = { x: 1e9, z: 1e9 };
    this._tier = '';
    this._frame = 0;
    this._v = new THREE.Vector3();
  }

  // The floating origin has moved: the buffer is laid out again.
  shift() {
    this._dirty = true;
  }

  // Every frame in the cavern. tier: 'high', 'mid', 'low'. settle: the clock is standing still (the photo mode):
  // every block there is to lay is laid at once, not one a frame.
  update(camera, on, tier, shown = true, settle = false) {
    const mesh = this.mesh;
    const max = PUDDLES.max[tier] || 0;
    if (!on || !shown || max === 0) {
      if (mesh.visible) {
        mesh.visible = false;
        this.count = 0;
        this.list = [];
      }
      this._dirty = true;
      return;
    }
    const range = PUDDLES.range[tier];
    this.material.uniforms.uRange.value = range;
    const o = this.env.origin();
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    this._frame++;
    // The blocks round the lens: the nearest one not laid yet is, one a frame.
    const B = PUDDLE.block;
    const bx0 = Math.floor((ax - range) / B);
    const bx1 = Math.floor((ax + range) / B);
    const bz0 = Math.floor((az - range) / B);
    const bz1 = Math.floor((az + range) / B);
    let changed = false;
    for (let laid = settle ? 64 : 1; laid > 0; laid--) {
      let want = null;
      let wantD = Infinity;
      for (let bx = bx0; bx <= bx1; bx++) {
        for (let bz = bz0; bz <= bz1; bz++) {
          const d = Math.hypot((bx + 0.5) * B - ax, (bz + 0.5) * B - az);
          if (d > range + B * 0.71 || this.blocks.has(bx * 100003 + bz)) continue;
          if (d < wantD) {
            wantD = d;
            want = [bx, bz];
          }
        }
      }
      if (!want) break;
      const found = this.env.plan.puddlesIn(want[0], want[1]);
      if (found === undefined) break;
      this.blocks.set(want[0] * 100003 + want[1], { bx: want[0], bz: want[1], list: found });
      changed = true;
    }
    if (this.blocks.size > 60) {
      for (const [k, b] of this.blocks) {
        if (Math.hypot((b.bx + 0.5) * B - ax, (b.bz + 0.5) * B - az) > range + B * 2.5) {
          this.blocks.delete(k);
          changed = true;
        }
      }
    }
    const moved = Math.hypot(ax - this._last.x, az - this._last.z) > 6;
    if (!this._dirty && !changed && !moved && this._tier === tier) return;
    this._tier = tier;
    this._last.x = ax;
    this._last.z = az;
    this._dirty = false;
    // The nearest of the puddles of the blocks that are laid, as many as are drawn.
    const all = [];
    for (const b of this.blocks.values()) {
      for (const p of b.list) {
        p.dist = Math.hypot(p.ax - ax, p.az - az);
        if (p.dist < range) all.push(p);
      }
    }
    this.known = all.length;
    all.sort((a, b) => a.dist - b.dist);
    const take = all.slice(0, max);
    const P = PUDDLE;
    for (let n = 0; n < take.length; n++) {
      const p = take[n];
      p.slot = n;
      const rip = this._rip.get(p.key);
      const base = n * FAN;
      this.pos.setXYZ(base, p.ax - o.x, p.y + PUDDLES.lift, p.az - o.z);
      this.off.setXYZ(base, 0, 0, 0);
      this.off.setW(base, p.r);
      this.rip.setXYZ(base, rip ? rip.t : -1e4, rip ? rip.x : 0, rip ? rip.z : 0);
      for (let k = 0; k < P.dirs; k++) {
        const a = (k / P.dirs) * Math.PI * 2;
        const dx = Math.cos(a) * p.ext[k];
        const dz = Math.sin(a) * p.ext[k];
        const v = base + 1 + k;
        this.pos.setXYZ(v, p.ax - o.x + dx, p.y + PUDDLES.lift, p.az - o.z + dz);
        this.off.setXYZ(v, dx, dz, 1);
        this.off.setW(v, p.r);
        this.rip.setXYZ(v, rip ? rip.t : -1e4, rip ? rip.x : 0, rip ? rip.z : 0);
      }
    }
    this.list = take;
    this.count = take.length;
    this.pos.needsUpdate = true;
    this.off.needsUpdate = true;
    this.rip.needsUpdate = true;
    mesh.geometry.setDrawRange(0, take.length * P.dirs * 3);
    mesh.visible = take.length > 0;
  }

  // A drop falls into puddle p at clock time t: its rings start from where it landed.
  drop(p, t) {
    const rec = { t, x: p.hit[0], z: p.hit[1] };
    this._rip.delete(p.key);
    this._rip.set(p.key, rec);
    // (Only the latest few hundred are kept: a puddle left far behind has no more use for its rings.)
    if (this._rip.size > 300) this._rip.delete(this._rip.keys().next().value);
    if (p.slot === undefined || this.list[p.slot] !== p) return;
    for (let v = p.slot * FAN; v < (p.slot + 1) * FAN; v++) this.rip.setXYZ(v, rec.t, rec.x, rec.z);
    this.rip.needsUpdate = true;
  }

  // The puddle a drop falls into: among those that are drawn, 14 to 100 m off and within
  // 40 degrees of where the lens looks, the one that the draw h (0 to 1) picks; or, if there
  // is none, among those 8 to 140 m off in front of it. Null where there is none.
  pick(camera, h) {
    const o = this.env.origin();
    const dir = camera.getWorldDirection(this._v);
    const fl = Math.hypot(dir.x, dir.z) || 1;
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    for (const [lo, hi, cut] of [[14, 100, 0.766], [8, 140, 0.05]]) {
      const ok = this.list.filter((p) => {
        const dx = p.ax - ax;
        const dz = p.az - az;
        const d = Math.hypot(dx, dz);
        return d >= lo && d <= hi && (dx * dir.x + dz * dir.z) / (d * fl) >= cut;
      });
      if (ok.length) {
        ok.sort((a, b) => a.key - b.key);
        return ok[Math.min(ok.length - 1, Math.floor(h * ok.length))];
      }
    }
    return null;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.blocks.clear();
    this._rip.clear();
  }
}
