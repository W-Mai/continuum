// What the inferno has of its own, beside its basalt, its spires and its rivers
// of lava (world/infernoplan.js says where and when): lava that splashes up and
// comes down again, on the lava where it is gone, on the bank where it lies as
// a red spot going dark; vents in the rock that throw up a column of fire with
// sparks in it and light the ground round them while they burn; the light the
// lava throws up on the land near it, on the side that faces it (the land's own
// shader, render/terrain.js, from what world/bakery.js lays in its tiles), and
// the light from below (the hemisphere's ground colour) flickering. The heat
// haze over the lava is the desert's pass (render/post.js, HAZE) with a test of
// its own; the drift of the crust is the lava's (render/water.js).
//
// Out of reach of the inferno nothing is drawn and nothing is worked out. Each
// draws by the tier (render/quality.js): all of it at 'high'; at 'mid' half the
// drops of a splash and half the sparks, and the haze without its fine layer;
// at 'low' none of it (and no haze, no light off the lava, no flicker). Drops
// and sparks are squares in the block style and flat discs in the painted one;
// the column's edges go in steps in the block style.

import * as THREE from 'three';
import { atmo, compileObjects } from './atmosphere.js';
import { styleU } from './style.js';
import { twistU, TWIST_PARS } from './twist.js';
import { SPLASH, VENT, splashGap, ventBurn, INFERNO } from '../world/infernoplan.js';
import { hash3 } from '../world/cavernplan.js';

// reach: how far off (m) the inferno may be for any of it to be worked out; slots: the
// splashes drawn at once; drops: the most drops a splash has; vents: how many are drawn
// at once and how far off (m); sparks: to a vent; rings: the light round a vent, its
// rings (share of its radius) and the points of each; lift: how far over the ground
// the light lies (m); flicker: how far the light from below goes up and down (share)
// and its two periods (s); glow: what the light off the lava is on the land that faces
// it, over the colour of the light from below; hot, cool: a drop's colour as it leaves
// the lava and as it comes down (linear, glowing); spot: a spot's on the bank; fire: the
// column's at its heart and at its edge; pool: the light a burning vent lays on the
// ground at its middle; ember: what is left of it between (share).
export const INFERNO_VIEW = {
  reach: 2000,
  slots: 4,
  drops: SPLASH.drops[1],
  vents: { max: 3, range: 1500 },
  sparks: 24,
  rings: [[0, 1], [0.08, 16], [0.2, 16], [0.38, 16], [0.62, 16], [1, 16]],
  lift: 0.08,
  flicker: [0.08, 1.7, 0.6],
  glow: 0.9,
  hot: [9, 4.2, 0.9],
  cool: [3.2, 0.6, 0.08],
  spot: [1.6, 0.18, 0.03],
  fire: [[12, 7, 2.4], [5, 1.1, 0.12]],
  pool: [1.5, 0.42, 0.1],
  ember: 0.06,
};

// The light off the lava on the land (render/terrain.js reads it): its colour and strength, 0 where there is none.
export const lavaU = { uLavaLit: { value: new THREE.Vector3() } };

const V = INFERNO_VIEW;
const vec3 = (a) => `vec3(${a.map((x) => x.toFixed(3)).join(', ')})`;

// Added on to what is behind it, the alpha (the marks of the styles) left as it is.
const ADD = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
};

// A round point (a square in the block style, a flat disc in the painted).
const POINT_FRAG = /* glsl */`
uniform float uPair;
uniform float uPaintInv;
uniform float uBlock;
varying vec3 vCol;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float r = length(q);
  float m = 1.0;
  if (uBlock < 0.5) {
    if (r > 0.5) discard;
    m = smoothstep(0.5, 0.1, r);
    m = mix(m, step(r, 0.42), uPair);
  }
  gl_FragColor = vec4(vCol * m * mix(1.0, uPaintInv * 0.6, uPair), 0.0);
}`;

function pointUniforms() {
  return {
    ...twistU,
    uPair: styleU.uPair,
    uPaintInv: styleU.uPaintInv,
    fogParams: atmo.fogParams,
    uBlock: { value: 0 },
    uPx: { value: 700 },
    uShare: { value: 1 },
    uNow: { value: 0 },
  };
}

// --- splashes -----------------------------------------------------------------------

function splashMaterial() {
  return new THREE.ShaderMaterial({
    ...ADD,
    uniforms: pointUniforms(),
    vertexShader: /* glsl */`
${TWIST_PARS}
attribute vec3 aV;        // how it is thrown (m/s)
attribute vec4 aT;        // when (s, on uNow's clock; under -1e4: none), how long it flies (s), on the bank (1), a draw of its own
uniform float uNow;
uniform float uPx;
uniform float uShare;
uniform vec3 fogParams;
varying vec3 vCol;
void main() {
  float age = uNow - aT.x;
  vec3 p = position;
  float size = 0.0;
  vCol = vec3(0.0);
  if (aT.x > -1e4 && age >= 0.0 && aT.w <= uShare) {
    if (age < aT.y) {
      p += aV * age - vec3(0.0, ${(SPLASH.g / 2).toFixed(3)} * age * age, 0.0);
      float k = age / aT.y;
      vCol = mix(${vec3(V.hot)}, ${vec3(V.cool)}, k);
      size = mix(0.34, 0.22, k);
    } else if (aT.z > 0.5 && age < aT.y + ${SPLASH.spot.toFixed(1)}) {
      float t = aT.y;
      p += aV * t - vec3(0.0, ${(SPLASH.g / 2).toFixed(3)} * t * t - 0.06, 0.0);
      float f = 1.0 - (age - t) / ${SPLASH.spot.toFixed(1)};
      vCol = ${vec3(V.spot)} * f * f;
      size = 0.3;
    }
  }
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * twistView(mv);
  float d = max(-mv.z, 0.5);
  vCol *= exp(-d * fogParams.x);
  gl_PointSize = size > 0.0 ? clamp(size * uPx / d, 1.5, 48.0) : 0.0;
  if (size <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`,
    fragmentShader: POINT_FRAG,
  });
}

// --- the columns of fire --------------------------------------------------------------

const RIB = 12;       // the column's rows

function columnMaterial() {
  return new THREE.ShaderMaterial({
    ...ADD,
    side: THREE.DoubleSide,
    uniforms: {
      ...twistU,
      uPair: styleU.uPair,
      uPaintInv: styleU.uPaintInv,
      fogParams: atmo.fogParams,
      uBlock: { value: 0 },
      uNow: { value: 0 },
      uVent: { value: Array.from({ length: V.vents.max }, () => new THREE.Vector4()) },
    },
    vertexShader: /* glsl */`
${TWIST_PARS}
attribute vec3 aRib;      // the vent, how far up (0 to 1), which side (-1, 1)
uniform vec4 uVent[${V.vents.max}];    // where its foot is (local) and how much it burns (0: not)
uniform float uNow;
uniform vec3 fogParams;
varying vec2 vRib;
varying float vBurn;
varying float vFog;
void main() {
  int k = int(aRib.x + 0.5);
  vec4 vt = uVent[k];
  float b = vt.w;
  float seed = float(k) * 7.31;
  // Up as it comes, then standing and flickering; the rows bend a little and the top comes and goes.
  float tall = ${VENT.tall.toFixed(1)} * (0.25 + 0.75 * sqrt(b)) * (0.85 + 0.15 * sin(uNow * 17.0 + seed));
  float v = aRib.y;
  float w = (0.35 + 1.9 * pow(1.0 - v, 0.7)) * (0.9 + 0.1 * sin(uNow * 23.0 + v * 9.0 + seed));
  vec3 base = vt.xyz;
  vec3 toLens = cameraPosition - base;
  vec3 side = normalize(vec3(toLens.z, 0.0, -toLens.x) + vec3(1e-4, 0.0, 0.0));
  vec3 sway = vec3(sin(uNow * 3.1 + v * 4.0 + seed), 0.0, cos(uNow * 2.7 + v * 3.0 + seed)) * 0.6 * v * v;
  vec3 p = base + vec3(0.0, v * tall, 0.0) + side * aRib.z * w * 0.5 + sway;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * twistView(mv);
  if (b <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vRib = vec2(aRib.z, v);
  vBurn = b;
  vFog = exp(-max(-mv.z, 0.0) * fogParams.x);
}`,
    fragmentShader: /* glsl */`
uniform float uPair;
uniform float uPaintInv;
uniform float uBlock;
uniform float uNow;
varying vec2 vRib;
varying float vBurn;
varying float vFog;
void main() {
  float u = abs(vRib.x);
  float v = vRib.y;
  // In steps, in the block style.
  u = mix(u, floor(u * 4.0 + 0.5) / 4.0, uBlock);
  v = mix(v, floor(v * 6.0) / 6.0, uBlock);
  float heart = 1.0 - smoothstep(0.0, 0.55, u);
  float edge = 1.0 - smoothstep(0.35, 1.0, u);
  float tongue = 0.75 + 0.25 * sin(v * 19.0 - uNow * 14.0 + vRib.x * 3.0);
  float up = pow(1.0 - v, 1.3);
  vec3 c = mix(${vec3(V.fire[1])}, ${vec3(V.fire[0])}, heart * (1.0 - v * 0.7)) * edge * up * tongue * vBurn;
  // The painted style: two flat colours, the heart and the flame.
  vec3 flat2 = mix(vec3(0.9, 0.32, 0.06), vec3(1.0, 0.82, 0.4), step(0.5, heart * (1.0 - v))) * step(0.3, edge * up) * uPaintInv * vBurn;
  c = mix(c, flat2, uPair);
  gl_FragColor = vec4(c * vFog, 0.0);
}`,
  });
}

function columnGeometry() {
  const geo = new THREE.BufferGeometry();
  const n = V.vents.max;
  const rib = new Float32Array(n * (RIB + 1) * 2 * 3);
  const idx = [];
  for (let k = 0; k < n; k++) {
    for (let j = 0; j <= RIB; j++) {
      for (let s = 0; s < 2; s++) {
        const o = ((k * (RIB + 1) + j) * 2 + s) * 3;
        rib[o] = k;
        rib[o + 1] = j / RIB;
        rib[o + 2] = s ? 1 : -1;
      }
      if (j < RIB) {
        const a = (k * (RIB + 1) + j) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rib.length), 3));
  geo.setAttribute('aRib', new THREE.BufferAttribute(rib, 3));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  return geo;
}

// --- sparks ---------------------------------------------------------------------------------

function sparkMaterial(vents) {
  const m = new THREE.ShaderMaterial({
    ...ADD,
    uniforms: { ...pointUniforms(), uVent: vents.uniforms.uVent, uBurnAge: { value: new Array(V.vents.max).fill(99) } },
    vertexShader: /* glsl */`
${TWIST_PARS}
attribute vec4 aInfo;     // the vent, three draws of its own
uniform vec4 uVent[${V.vents.max}];
uniform float uBurnAge[${V.vents.max}];   // s since its last burst began
uniform float uPx;
uniform float uShare;
uniform vec3 fogParams;
varying vec3 vCol;
void main() {
  int k = int(aInfo.x + 0.5);
  float age = uBurnAge[k] - aInfo.y * ${(VENT.burst * 0.8).toFixed(2)};
  float life = 1.4 + 1.2 * aInfo.z;
  vec3 p = uVent[k].xyz;
  float size = 0.0;
  vCol = vec3(0.0);
  if (age > 0.0 && age < life && aInfo.w <= uShare) {
    float a = aInfo.z * 40.0;
    vec3 vel = vec3(cos(a) * (1.0 + 2.5 * aInfo.w), 9.0 + 9.0 * fract(aInfo.z * 13.7), sin(a) * (1.0 + 2.5 * aInfo.w));
    p += vel * age - vec3(0.0, 4.0 * age * age, 0.0);
    float f = 1.0 - age / life;
    vCol = ${vec3(V.hot)} * f * f;
    size = 0.2;
  }
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * twistView(mv);
  float d = max(-mv.z, 0.5);
  vCol *= exp(-d * fogParams.x);
  gl_PointSize = size > 0.0 ? clamp(size * uPx / d, 1.0, 24.0) : 0.0;
  if (size <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`,
    fragmentShader: POINT_FRAG,
  });
  return m;
}

// --- the light round a vent ---------------------------------------------------------------

const POOL_VERTS = V.rings.reduce((n, [, k]) => n + k, 0);

function poolGeometry() {
  const n = V.vents.max;
  const geo = new THREE.BufferGeometry();
  const pool = new Float32Array(n * POOL_VERTS * 3);
  const idx = [];
  for (let k = 0; k < n; k++) {
    let v = k * POOL_VERTS;
    const starts = [];
    for (const [r, m] of V.rings) {
      starts.push([v, m]);
      for (let i = 0; i < m; i++, v++) {
        const a = (i / m) * Math.PI * 2;
        pool[v * 3] = Math.cos(a) * r;
        pool[v * 3 + 1] = Math.sin(a) * r;
        pool[v * 3 + 2] = k;
      }
    }
    // The middle to the first ring, then a quad to each edge between rings (all of 16 points).
    const [c] = starts[0];
    const [r1, m1] = starts[1];
    for (let i = 0; i < m1; i++) idx.push(c, r1 + i, r1 + ((i + 1) % m1));
    for (let q = 1; q < starts.length - 1; q++) {
      const [a0, m] = starts[q];
      const [b0] = starts[q + 1];
      for (let i = 0; i < m; i++) {
        const a = a0 + i;
        const b = a0 + ((i + 1) % m);
        const cc = b0 + i;
        const d = b0 + ((i + 1) % m);
        idx.push(a, cc, b, b, cc, d);
      }
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * POOL_VERTS * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aPool', new THREE.BufferAttribute(pool, 3));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  return geo;
}

function poolMaterial(vents) {
  return new THREE.ShaderMaterial({
    ...ADD,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
    uniforms: { ...twistU, uPair: styleU.uPair, uPaintInv: styleU.uPaintInv, fogParams: atmo.fogParams, uBlock: { value: 0 }, uVent: vents.uniforms.uVent },
    vertexShader: /* glsl */`
${TWIST_PARS}
attribute vec3 aPool;     // across the light (over its radius), the vent
uniform vec4 uVent[${V.vents.max}];
uniform vec3 fogParams;
varying vec2 vPool;
varying float vBurn;
varying float vFog;
void main() {
  int k = int(aPool.z + 0.5);
  vec4 vt = uVent[k];
  // position: the ground under the point (y) as far off its vent as it is (x, z), the vent's place laid on.
  vec3 p = vec3(vt.x + position.x, position.y, vt.z + position.z);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * twistView(mv);
  if (vt.w < 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vPool = aPool.xy;
  vBurn = max(vt.w, 0.0);
  vFog = exp(-max(-mv.z, 0.0) * fogParams.x);
}`,
    fragmentShader: /* glsl */`
uniform float uPair;
uniform float uPaintInv;
uniform float uBlock;
varying vec2 vPool;
varying float vBurn;
varying float vFog;
void main() {
  vec2 q = abs(vPool);
  float r2 = mix(dot(vPool, vPool), max(q.x, q.y) * max(q.x, q.y), uBlock);
  float win = max(0.0, 1.0 - r2);
  // The fire's light, falling away from a core of a tenth of the radius; the crack's own glow, small, between bursts.
  float light = win * win / (1.0 + r2 / 0.03);
  float crack = (1.0 - smoothstep(0.0, 0.012, r2)) * ${V.ember.toFixed(3)} * 8.0;
  vec3 c = ${vec3(V.pool)} * (light * (vBurn + ${V.ember.toFixed(3)}) + crack);
  // The painted style: a flat ellipse of the light with a clear edge while it burns.
  float e = fwidth(r2) * 1.2 + 1e-4;
  vec3 flat2 = vec3(0.85, 0.3, 0.07) * (1.0 - smoothstep(0.3 - e, 0.3 + e, r2)) * 0.5 * vBurn * uPaintInv;
  c = mix(c, flat2, uPair);
  gl_FragColor = vec4(c * vFog, 0.0);
}`,
  });
}

// --- the whole ----------------------------------------------------------------------------

export class Inferno {
  // env: plan (InfernoPlan), road, worlds, groundAt(x, z) (local); tier: the one to begin with.
  constructor(scene, env, tier = 'high') {
    this.env = env;
    this.scene = scene;
    this.tier = tier;
    // The splashes: a slot of points to each, written as one comes.
    const N = V.slots * V.drops;
    const geo = new THREE.BufferGeometry();
    this._pos = new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this._vel = new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const t = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) t[i * 4] = -1e5;
    this._t = new THREE.BufferAttribute(t, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this._pos);
    geo.setAttribute('aV', this._vel);
    geo.setAttribute('aT', this._t);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.splashMaterial = splashMaterial();
    this.drops = new THREE.Points(geo, this.splashMaterial);
    this.drops.frustumCulled = false;
    this.drops.renderOrder = 2;
    this.drops.visible = false;
    scene.add(this.drops);
    // The vents: the column, its sparks and its light.
    this.columnMaterial = columnMaterial();
    this.columns = new THREE.Mesh(columnGeometry(), this.columnMaterial);
    this.columns.frustumCulled = false;
    this.columns.renderOrder = 2;
    this.columns.visible = false;
    scene.add(this.columns);
    const sgeo = new THREE.BufferGeometry();
    const S = V.vents.max * V.sparks;
    const info = new Float32Array(S * 4);
    for (let i = 0; i < S; i++) {
      info[i * 4] = Math.floor(i / V.sparks);
      info[i * 4 + 1] = hash3(i, 1, 77);
      info[i * 4 + 2] = hash3(i, 2, 77);
      info[i * 4 + 3] = hash3(i, 3, 77);
    }
    sgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(S * 3), 3));
    sgeo.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
    sgeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.sparkMaterial = sparkMaterial(this.columnMaterial);
    this.sparks = new THREE.Points(sgeo, this.sparkMaterial);
    this.sparks.frustumCulled = false;
    this.sparks.renderOrder = 2;
    this.sparks.visible = false;
    scene.add(this.sparks);
    this.poolMaterial = poolMaterial(this.columnMaterial);
    this.pools = new THREE.Mesh(poolGeometry(), this.poolMaterial);
    this.pools.frustumCulled = false;
    this.pools.renderOrder = 2;
    this.pools.visible = false;
    scene.add(this.pools);

    this.on = false;          // the inferno is in reach
    this.clock = 0;           // s
    this.share = 0;           // how much of the world under the lens is the inferno's
    this.haze = 0;            // how much heat haze over the lava (0 to 1), before the style's share of it
    this.flicker = 1;         // what the light from below is multiplied by
    this.splashes = 0;        // splashes so far
    this.splashNear = null;   // the last, from the lens: { dx, dy, dz, d }
    this.splashList = [];     // the splashes being drawn: { s (InfernoPlan.splash), t0 (clock), slot }
    this.ventList = [];       // the vents drawn: { v, slot, burn }
    this._next = null;
    this._n = 1;
    this._slot = 0;
    this._base = 0;           // the clock uNow is from
    this._ventKey = new Array(V.vents.max).fill('');
    this._vents = [];
    this._seed = env.plan.seed;
    this._lens = new THREE.Vector3();
    this._lit = new THREE.Color();
  }

  setTier(t) {
    this.tier = t;
  }

  // The floating origin has moved: the splashes in flight are laid out again, and the vents' light.
  shift() {
    for (const e of this.splashList) this._write(e);
    this._ventKey.fill('');
  }

  // How much of the world under a look ({ a, b, t }) is the inferno's.
  static share(at) {
    if (!at || at.a < 0) return 0;
    const t = at.a === at.b ? 0 : at.t;
    return (at.a === INFERNO ? 1 - t : 0) + (at.b === INFERNO ? t : 0);
  }

  _hide() {
    for (const m of [this.drops, this.columns, this.sparks, this.pools]) m.visible = false;
    this.splashList = [];
    this.ventList = [];
    this._ventKey.fill('');
    const t = this._t.array;
    for (let i = 0; i < t.length; i += 4) t[i] = -1e5;
    this._t.needsUpdate = true;
    this.haze = 0;
    this.flicker = 1;
    this.share = 0;
    lavaU.uLavaLit.value.set(0, 0, 0);
  }

  // Every frame. dt: s (0 in the photo mode: the world stands still); camera; ctx: { at (the look under the
  // lens), sCar, blocks (0 to 1: how far the style is the block's), px (the pixels a metre makes at a metre),
  // ground (the colour of the light from below, linear), settle }.
  update(camera, dt, ctx) {
    const o = this.env.road.origin;
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    this.on = this.env.worlds.reaches(ax, az, V.reach, (w) => w.id === 'inferno');
    this.clock += dt;
    if (!this.on || this.tier === 'low') {
      if (this.drops.visible || this.columns.visible || this.pools.visible || this.haze || this.flicker !== 1 || this.splashList.length) this._hide();
      return;
    }
    const share = Inferno.share(ctx.at);
    this.share = share;
    this.haze = share;
    const [amp, p1, p2] = V.flicker;
    const c = this.clock;
    this.flicker = 1 + amp * share * (0.5 * Math.sin((c / p1) * Math.PI * 2) + 0.5 * Math.sin((c / p2) * Math.PI * 2 + 1.3));
    // The light off the lava on the land: the light from below's colour, as much as there is of the inferno, flickering with it.
    const g = ctx.ground || this._lit.setRGB(1, 0.3, 0.05);
    lavaU.uLavaLit.value.set(g.r, g.g, g.b).multiplyScalar(V.glow * share * this.flicker);
    const blocks = ctx.blocks || 0;
    const px = ctx.px || 700;
    const mid = this.tier === 'mid' ? 0.5 : 1;
    for (const m of [this.splashMaterial, this.sparkMaterial]) {
      m.uniforms.uBlock.value = blocks;
      m.uniforms.uPx.value = px;
      m.uniforms.uShare.value = mid;
    }
    this.columnMaterial.uniforms.uBlock.value = blocks;
    this.poolMaterial.uniforms.uBlock.value = blocks;
    this._splashes(camera, dt, ctx, share);
    this._ventsUpdate(camera, ctx);
  }

  // A splash's drops written into its slot, from where it is (absolute) to where the origin is now.
  _write(e) {
    const o = this.env.road.origin;
    const s = e.s;
    const pos = this._pos.array;
    const vel = this._vel.array;
    const t = this._t.array;
    for (let i = 0; i < V.drops; i++) {
      const k = e.slot * V.drops + i;
      const d = s.drops[i];
      if (!d) {
        t[k * 4] = -1e5;
        continue;
      }
      pos[k * 3] = s.x - o.x;
      pos[k * 3 + 1] = s.y;
      pos[k * 3 + 2] = s.z - o.z;
      vel[k * 3] = d.vx;
      vel[k * 3 + 1] = d.vy;
      vel[k * 3 + 2] = d.vz;
      t[k * 4] = e.t0 - this._base;
      t[k * 4 + 1] = d.t;
      t[k * 4 + 2] = d.shore;
      t[k * 4 + 3] = (i % 2) * 0.5 + 0.25;
    }
    this._pos.needsUpdate = true;
    this._vel.needsUpdate = true;
    this._t.needsUpdate = true;
  }

  _splashes(camera, dt, ctx, share) {
    const plan = this.env.plan;
    const o = this.env.road.origin;
    if (this._next === null) this._next = this.clock + splashGap(this._n, this._seed) * 0.5;
    if (!ctx.settle && dt > 0 && this.clock >= this._next) {
      let s = null;
      if (share >= 0.5) {
        camera.getWorldDirection(this._lens);
        const l = Math.hypot(this._lens.x, this._lens.z) || 1;
        const ax = camera.position.x + o.x;
        const az = camera.position.z + o.z;
        s = plan.splash(this._n, ax, az, this._lens.x / l, this._lens.z / l);
        if (s) {
          // The clock the drops go by starts again now and then, so that it stays fine.
          if (this.clock - this._base > 600) {
            this._base = this.clock;
            for (const e of this.splashList) this._write(e);
          }
          const e = { s, t0: this.clock, slot: this._slot };
          this._slot = (this._slot + 1) % V.slots;
          this.splashList = this.splashList.filter((q) => q.slot !== e.slot);
          this.splashList.push(e);
          this._write(e);
          this.splashes++;
          const dx = s.x - ax;
          const dz = s.z - az;
          const dy = s.y - camera.position.y;
          this.splashNear = { dx, dy, dz, d: Math.hypot(dx, dy, dz), n: this.splashes };
        }
      }
      // (One that found no lava looks again a moment on.)
      if (s) {
        this._n++;
        this._next = Math.max(this._next + splashGap(this._n, this._seed), this.clock);
      } else {
        this._next = this.clock + SPLASH.retry;
      }
    }
    // Gone when the last of its spots has gone dark.
    const keep = this.splashList.filter((e) => this.clock - e.t0 < Math.max(...e.s.drops.map((d) => d.t)) + SPLASH.spot);
    this.splashList = keep;
    this.splashMaterial.uniforms.uNow.value = this.clock - this._base;
    this.drops.visible = keep.length > 0;
  }

  _ventsUpdate(camera, ctx) {
    const plan = this.env.plan;
    const o = this.env.road.origin;
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    const R = V.vents.range;
    const near = plan.ventsAlong(ctx.sCar - R, ctx.sCar + R, this._vents)
      .filter((v) => Math.hypot(v.ax - ax, v.az - az) < R)
      .sort((p, q) => Math.hypot(p.ax - ax, p.az - az) - Math.hypot(q.ax - ax, q.az - az))
      .slice(0, V.vents.max);
    const u = this.columnMaterial.uniforms;
    const ages = this.sparkMaterial.uniforms.uBurnAge.value;
    const pos = this.pools.geometry.attributes.position;
    let wrote = false;
    const list = [];
    for (let k = 0; k < V.vents.max; k++) {
      const v = near[k];
      if (!v) {
        u.uVent.value[k].set(0, 0, 0, -1);
        ages[k] = 99;
        this._ventKey[k] = '';
        continue;
      }
      const burn = ventBurn(v.phase, this.clock);
      u.uVent.value[k].set(v.ax - o.x, v.y, v.az - o.z, burn);
      // Seconds since its last burst began.
      ages[k] = ((((this.clock / VENT.period + v.phase) % 1) + 1) % 1) * VENT.period;
      list.push({ v, burn });
      // The ground under its light, found once for each vent a slot takes.
      const key = `${v.k}`;
      if (this._ventKey[k] !== key) {
        this._ventKey[k] = key;
        const arr = pos.array;
        const pool = this.pools.geometry.attributes.aPool.array;
        for (let i = 0; i < POOL_VERTS; i++) {
          const j = k * POOL_VERTS + i;
          const dx = pool[j * 3] * VENT.light;
          const dz = pool[j * 3 + 1] * VENT.light;
          arr[j * 3] = dx;
          arr[j * 3 + 1] = this.env.groundAt(v.ax - o.x + dx, v.az - o.z + dz) + V.lift;
          arr[j * 3 + 2] = dz;
        }
        wrote = true;
      }
    }
    if (wrote) pos.needsUpdate = true;
    this.ventList = list;
    this.columnMaterial.uniforms.uNow.value = this.clock % 1000;
    const any = list.length > 0;
    this.columns.visible = list.some((e) => e.burn > 0);
    this.sparks.visible = any;
    this.pools.visible = any;
  }

  // The light from below as it is now, for the lights of the frame: the colour given, times the flicker.
  lightFromBelow(color) {
    if (this.flicker !== 1) color.multiplyScalar(this.flicker);
    return color;
  }

  _meshes() {
    return [this.drops, this.columns, this.sparks, this.pools];
  }

  warm(renderer, scene, camera) {
    return compileObjects(renderer, scene, camera, this._meshes());
  }

  stats() {
    return {
      on: this.on, tier: this.tier, share: this.share, haze: this.haze, flicker: this.flicker, clock: this.clock,
      splashes: this.splashes, flying: this.splashList.length,
      vents: this.ventList.map((e) => ({ ax: e.v.ax, az: e.v.az, y: e.v.y, k: e.v.k, burn: e.burn })),
      lavaLit: lavaU.uLavaLit.value.toArray(),
    };
  }

  dispose() {
    for (const m of this._meshes()) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    for (const m of [this.splashMaterial, this.columnMaterial, this.sparkMaterial, this.poolMaterial]) m.dispose();
    lavaU.uLavaLit.value.set(0, 0, 0);
  }
}
