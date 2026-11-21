// A skylight: a shaft of cold white light from a hole in the roof to the floor,
// a patch of light on the ground where it lands, and the dust in the air lit
// wherever the shaft is (render/motes.js).
//
// Where they are comes from the plan (world/cavernplan.js): one in each kilometre
// of road, beside it, on level ground. The shaft is a cone of triangles, narrowest
// at the roof, drawn added on, no more than the tier allows at a time and the
// nearest ones: brightest where the view goes through the most of it (the cone
// is seen from inside as well as from outside), and from the roof, where it goes
// up into the rock, down to the floor, under which it goes a little. The patch
// is a pool of light like those under the crystals (render/crystalpools.js), laid
// on the ground it falls on, which the grass grows in (render/clutter.js).
//
// In the painted style the shaft is a flat column with a clear edge and the patch
// a flat ellipse; in the block style the patch is square.

import * as THREE from 'three';
import { twistU, TWIST_PARS } from './twist.js';
import { styleU } from './style.js';
import { atmo } from './atmosphere.js';
import { SKYLIGHT } from '../world/cavernplan.js';

// range, max: how far off a shaft is drawn (m), and how many, at each tier; sides,
// rings: of the cone; colour: the light's (linear), level: the cone's at the roof, patch: the patch's at its
// middle, floor: the share of the cone's the cone has at the floor; top: how far up into the rock the cone goes
// (m: the roof is drawn on a mesh that is coarse far off, and stands as much as that off its own height), under: how far under
// the lowest ground it goes (m); in: how long a shaft takes to come up to its
// light (s), when it comes into reach.
export const SHAFT = {
  range: { high: 900, mid: 700, low: 0 },
  max: { high: 2, mid: 1, low: 0 },
  sides: 24,
  rings: 7,
  colour: [0.66, 0.82, 1.0],
  level: 0.06,
  patch: 0.35,
  floor: 0.3,
  top: 60,
  under: 3,
  in: 1.5,
};

// The painted style's: the shaft's flat colour and how much of it is laid (column), the
// patch's ellipse (an edge out to this share of its square radius, a ring past it
// as bright as this, the level it is laid at).
const PAINT = { colour: [0.46, 0.66, 0.74], column: 0.45, edge: 0.5, ring: 0.3, level: 0.8 };

const SIDES = SHAFT.sides;
const CONE_VERTS = SHAFT.rings * (SIDES + 1);
const PATCH_VERTS = 25;
const VERTS = CONE_VERTS + PATCH_VERTS;
const CONE_TRIS = (SHAFT.rings - 1) * SIDES * 2;
const TRIS = CONE_TRIS + 32;
const MAX = SHAFT.max.high;

// The patch's unit offsets (the middle and two rings, as the crystals' pools).
const OFFSETS = (() => {
  const o = [[0, 0]];
  for (const [n, r] of [[8, 0.5], [16, 1]]) for (let k = 0; k < n; k++) o.push([Math.cos((k / n) * Math.PI * 2) * r, Math.sin((k / n) * Math.PI * 2) * r]);
  return o;
})();

function indexOf(slot) {
  const idx = [];
  const b = slot * VERTS;
  for (let j = 0; j < SHAFT.rings - 1; j++) {
    for (let k = 0; k < SIDES; k++) {
      const a = b + j * (SIDES + 1) + k;
      const c = a + SIDES + 1;
      idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  const p = b + CONE_VERTS;
  for (let k = 0; k < 8; k++) idx.push(p, p + 1 + k, p + 1 + ((k + 1) % 8));
  for (let k = 0; k < 8; k++) {
    const a = p + 1 + k;
    const bb = p + 1 + ((k + 1) % 8);
    const c = p + 9 + 2 * k;
    const d = p + 9 + 2 * k + 1;
    const e = p + 9 + ((2 * k + 2) % 16);
    idx.push(a, c, d, a, d, bb, bb, d, e);
  }
  return idx;
}

const v3 = (a) => `vec3(${a.map((x) => x.toFixed(4)).join(', ')})`;

function shaftMaterial(shared) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { ...twistU, uPair: styleU.uPair, uPaintInv: styleU.uPaintInv, uBlock: shared.uBlock, fogParams: atmo.fogParams },
    vertexShader: /* glsl */`
${TWIST_PARS}
attribute vec4 aInfo;     // how far up the shaft (0 floor, 1 roof), cone (0) or patch (1), how bright it is, the patch's radius
attribute vec2 aPool;
attribute vec3 aNormal;
uniform float uBlock;
uniform vec3 fogParams;
varying vec4 vInfo;
varying vec2 vPool;
varying vec3 vN;
varying vec3 vWorld;
varying float vFog;
void main() {
  vInfo = aInfo;
  vN = aNormal;
  float k = mix(1.0, 1.4142, uBlock * aInfo.y);
  vec3 p = position;
  p.xz += aPool * aInfo.w * (k - 1.0);
  vPool = aPool * k;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vFog = exp(-max(-mv.z, 0.0) * fogParams.x);
  gl_Position = projectionMatrix * twistView( mv );
}`,
    fragmentShader: /* glsl */`
uniform float uPair;
uniform float uPaintInv;
uniform float uBlock;
varying vec4 vInfo;
varying vec2 vPool;
varying vec3 vN;
varying vec3 vWorld;
varying float vFog;
void main() {
  vec3 col = ${v3(SHAFT.colour)};
  vec3 c;
  if ( vInfo.y < 0.5 ) {
    // The shaft: the more of it the view goes through the brighter, so it is brightest in the
    // middle and gone at its edge, and a little brighter toward the roof.
    float ndv = abs( dot( normalize( vN ), normalize( cameraPosition - vWorld ) ) );
    float body = pow( ndv, 2.0 ) * mix( ${SHAFT.floor.toFixed(2)}, 1.0, vInfo.x ) * ( 1.0 - smoothstep( 0.9, 1.0, vInfo.x ) );
    c = col * body * ${SHAFT.level.toFixed(3)} * vInfo.z * vFog;
    if ( uPair > 0.0 || uBlock > 0.0 ) {
      // A flat column with a clear edge, in one colour as it comes out on the screen.
      float e = fwidth( ndv ) * 1.2 + 1e-4;
      float flat_ = smoothstep( 0.2 - e, 0.2 + e, ndv );
      c = mix( c, ${v3(PAINT.colour)} * flat_ * ${PAINT.column.toFixed(2)} * vInfo.z * vFog * uPaintInv, max( uPair, uBlock ) );
    }
  } else {
    // The patch on the floor: a pool of light, as a crystal's.
    float r2 = dot( vPool, vPool );
    vec2 q = abs( vPool );
    r2 = mix( r2, max( q.x, q.y ) * max( q.x, q.y ), uBlock );
    float a = max( 0.0, 1.0 - r2 );
    c = col * a * a * ${SHAFT.patch.toFixed(3)} * vInfo.z * vFog;
    if ( uPair > 0.0 ) {
      float e = fwidth( r2 ) * 1.2 + 1e-4;
      float disc = 1.0 - smoothstep( ${PAINT.edge.toFixed(2)} - e, ${PAINT.edge.toFixed(2)} + e, r2 );
      float ring = ${PAINT.ring.toFixed(2)} * ( 1.0 - smoothstep( ${PAINT.edge.toFixed(2)}, 1.0, r2 ) );
      c = mix( c, ${v3(PAINT.colour)} * mix( ring, 1.0, disc ) * ${PAINT.level.toFixed(2)} * vInfo.z * vFog * uPaintInv, uPair );
    }
  }
  gl_FragColor = vec4( c, 1.0 );
}`,
  });
}

export class Skylights {
  // env: plan (CavernPlan), ceiling (baseAt), groundAt(x, z) (local), origin().
  constructor(scene, env, shared) {
    this.env = env;
    this.scene = scene;
    const geo = new THREE.BufferGeometry();
    const mk = (n) => new THREE.BufferAttribute(new Float32Array(MAX * VERTS * n), n).setUsage(THREE.DynamicDrawUsage);
    this.pos = mk(3);
    this.info = mk(4);
    this.pool = mk(2);
    this.nrm = mk(3);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('aInfo', this.info);
    geo.setAttribute('aPool', this.pool);
    geo.setAttribute('aNormal', this.nrm);
    const idx = [];
    for (let slot = 0; slot < MAX; slot++) idx.push(...indexOf(slot));
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    geo.setDrawRange(0, 0);
    this.material = shaftMaterial(shared);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.list = [];                   // the shafts drawn: { k, ax, az, r, top, bottom, level }
    this.count = 0;
    this._known = new Map();          // by cell of the road: what is fixed of a shaft (top, bottom, the ground under its patch)
    this._age = new Map();
    this._tier = '';
  }

  shift() {}

  _fix(q, k) {
    let f = this._known.get(k);
    if (f) return f;
    const o = this.env.origin();
    const base = this.env.ceiling.baseAt(q.ax, q.az);
    // (Not where the roof is let down across a border: it is not the cavern's roof yet.)
    if (!(this.env.ceiling.shareAt(q.ax, q.az) > 0.95)) return null;
    const top = base + SHAFT.top;
    const patch = q.r * SKYLIGHT.flare * 1.1;
    const ground = new Float32Array(PATCH_VERTS);
    let low = Infinity;
    for (let v = 0; v < PATCH_VERTS; v++) {
      ground[v] = this.env.groundAt(q.ax - o.x + OFFSETS[v][0] * patch, q.az - o.z + OFFSETS[v][1] * patch);
      low = Math.min(low, ground[v]);
    }
    f = { top, bottom: low - SHAFT.under, patch, ground };
    this._known.set(k, f);
    return f;
  }

  // Every frame in the cavern: sCar, the car's place along the road (the cells of the road
  // near it are looked at); tier; dt in seconds.
  update(camera, on, tier, sCar, dt, shown = true) {
    const mesh = this.mesh;
    const max = SHAFT.max[tier] || 0;
    if (!on || !shown || max === 0) {
      if (mesh.visible) {
        mesh.visible = false;
        this.count = 0;
        this.list = [];
      }
      return;
    }
    const range = SHAFT.range[tier];
    const o = this.env.origin();
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    const E = SKYLIGHT.every;
    // The shafts within reach: those of the cells of the road about the car, the nearest.
    const near = [];
    for (let k = Math.floor((sCar - 1600) / E); k <= Math.floor((sCar + 1600) / E); k++) {
      const q = this.env.plan.skylight(k);
      if (!q) continue;
      const d = Math.hypot(q.ax - ax, q.az - az);
      if (d < range) near.push({ k, q, d });
    }
    near.sort((a, b) => a.d - b.d);
    const take = near.slice(0, max);
    const live = new Set(take.map((e) => e.k));
    for (const k of this._age.keys()) if (!live.has(k)) this._age.delete(k);
    const list = [];
    for (let n = 0; n < take.length; n++) {
      const { k, q, d } = take[n];
      const f = this._fix(q, k);
      if (!f) continue;
      // (A shaft comes up to its light over SHAFT.in seconds; with the clock standing still it has it.)
      const age = dt > 0 ? (this._age.get(k) || 0) + dt : SHAFT.in;
      this._age.set(k, age);
      const level = Math.min(1, age / SHAFT.in) * (1 - THREE.MathUtils.smoothstep(d, range * 0.75, range));
      const e = level * level * (3 - 2 * level);
      this._write(n, q, f, e, o);
      list.push({ k, ax: q.ax, az: q.az, r: q.r, top: f.top, bottom: f.bottom, level: e, dist: d });
    }
    this.list = list;
    this.count = list.length;
    for (const a of [this.pos, this.info, this.pool, this.nrm]) a.needsUpdate = true;
    mesh.geometry.setDrawRange(0, list.length * TRIS * 3);
    mesh.visible = list.length > 0;
    if (this._known.size > 24) for (const k of this._known.keys()) if (!live.has(k) && Math.abs(k - sCar / E) > 4) this._known.delete(k);
  }

  // Shaft n of the plan q, fixed as f, lit to level e.
  _write(n, q, f, e, o) {
    const cx = q.ax - o.x;
    const cz = q.az - o.z;
    const b = n * VERTS;
    for (let j = 0; j < SHAFT.rings; j++) {
      const t = j / (SHAFT.rings - 1);
      const r = q.r * (SKYLIGHT.flare - (SKYLIGHT.flare - 1) * t);
      const y = f.bottom + (f.top - f.bottom) * t;
      for (let k = 0; k <= SIDES; k++) {
        const a = (k / SIDES) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const v = b + j * (SIDES + 1) + k;
        this.pos.setXYZ(v, cx + c * r, y, cz + s * r);
        this.info.setXYZW(v, t, 0, e, 0);
        this.pool.setXY(v, 0, 0);
        this.nrm.setXYZ(v, c, 0.05, s);
      }
    }
    for (let v = 0; v < PATCH_VERTS; v++) {
      const i = b + CONE_VERTS + v;
      this.pos.setXYZ(i, cx + OFFSETS[v][0] * f.patch, f.ground[v] + 0.06, cz + OFFSETS[v][1] * f.patch);
      this.info.setXYZW(i, 0, 1, e, f.patch);
      this.pool.setXY(i, OFFSETS[v][0], OFFSETS[v][1]);
      this.nrm.setXYZ(i, 0, 1, 0);
    }
  }

  // The shafts the dust is lit in, as the two vectors of the motes (x, z in local metres, radius,
  // how much each shines): the nearest two.
  beams(out, gain = 1) {
    const o = this.env.origin();
    for (let i = 0; i < 2; i++) {
      const s = this.list[i];
      if (s) out[i].set(s.ax - o.x, s.az - o.z, s.r * SKYLIGHT.flare, s.level * gain);
      else out[i].set(0, 0, 1, 0);
    }
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this._known.clear();
    this._age.clear();
  }
}
