// Wind, and what it carries, for the painted style (手绘): long pale lines of
// wind drawn across the air a stroke at a time, as a hand-drawn film draws a
// gust, and petals coming down on it, turning over as they fall.
//
// Neither is a plane of a texture. A line is a ribbon turned to the lens,
// pointed at both ends, that draws itself on along a long curve (now and then
// ending in a loop) and wipes itself off again; a petal is a little flat leaf
// tumbling about a slant axis. Both are opaque, so the last pass (render/
// style.js) draws them as it draws the rest, and both live in a box of air
// that follows the camera, as the butterflies do (render/critters.js), so
// there is a fixed number of them wherever the road goes.

import * as THREE from 'three';
import { WORLDS } from '../world/worlds.js';
import { atmo } from './atmosphere.js';
import { WIND } from './style.js';

// [lines of wind, petals] a world has, a share of the full number.
const DRIFT = {
  alpine: [0.9, 0.8], hills: [1, 1], river: [0.8, 0.9], coast: [1, 0.35], desert: [0.7, 0], heaven: [0.6, 0.5], city: [0.35, 0.35],
};
// The petals' colours where they are not cherry: the coast's blossom is
// paler, heaven's is gold.
const PETAL = { coast: [1.0, 0.94, 0.93, 0.55], heaven: [1.0, 0.84, 0.46, 0.75] };

const WIND_LEN = Math.hypot(WIND[0], WIND[1]);
const WIND_DIR = new THREE.Vector2(WIND[0] / WIND_LEN, WIND[1] / WIND_LEN);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- the lines ---------------------------------------------------------------

const LINE_BOX = 96;
const LINE_SEGS = 28;
const LINE_VERTEX = /* glsl */`
attribute vec2 aRib;      // along the line 0..1, the side of it -1 or 1
attribute vec4 aSeed;     // where in the box (xz, 0..1), a height, its own draw
uniform vec3 uCam;
uniform vec3 uCamMod;
uniform float uTime;
uniform float uShare;
uniform float uGround;
uniform vec2 uWind;
uniform vec2 uFwd;        // where the lens looks, along the ground
uniform vec3 fogParams;
uniform vec3 uFogCol;
uniform vec3 uCol;
varying vec3 vCol;

// A line, in metres from where it starts: long along the wind, an S in the
// height and a slow sway to the side, and in half of them a loop at its end.
vec3 route( float u, float draw ) {
  float L = 18.0 + 14.0 * fract( draw * 7.3 );
  vec2 side = vec2( -uWind.y, uWind.x );
  float lift = 1.1 * sin( u * 5.4 + draw * 40.0 ) + 0.6 * sin( u * 13.0 + draw * 13.0 );
  float sway = 1.8 * sin( u * 4.4 + draw * 23.0 );
  float k = clamp( ( u - 0.68 ) / 0.32, 0.0, 1.0 );
  float th = k * 6.2832;
  float R = 1.4 + 1.1 * fract( draw * 11.0 );
  float on = step( 0.5, fract( draw * 3.7 ) );
  vec2 loop = on * R * vec2( sin( th ), 1.0 - cos( th ) );
  float a = u * L + loop.x;
  return vec3( uWind.x * a + side.x * sway, lift + loop.y, uWind.y * a + side.y * sway );
}

void main() {
  vCol = vec3( 0.0 );
  if ( fract( aSeed.w * 3.17 ) >= uShare ) {
    gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    return;
  }
  float draw = aSeed.w;
  // Drawn on, then wiped off: the visible stretch runs from tail to head.
  float phase = fract( uTime / 3.8 + draw * 5.0 );
  float head = smoothstep( 0.0, 0.5, phase );
  float tail = smoothstep( 0.42, 0.95, phase );
  float span = max( head - tail, 0.0 );
  float u = tail + span * aRib.x;
  // The box of air is held ahead of the lens, where it is looking.
  vec2 mid = uFwd * ${(LINE_BOX * 0.26).toFixed(1)};
  vec2 anchor = mod( aSeed.xz * ${LINE_BOX}.0 + uWind * uTime * 1.2 - uCamMod.xz - mid, ${LINE_BOX}.0 ) - ${LINE_BOX / 2}.0 + mid;
  vec3 origin = vec3( uCam.x + anchor.x, uGround + 0.8 + pow( aSeed.y, 1.5 ) * 12.0, uCam.z + anchor.y );
  vec3 p = origin + route( u, draw );
  vec3 q = origin + route( clamp( u + 0.012, 0.0, 1.0 ), draw );
  vec3 r = origin + route( clamp( u - 0.012, 0.0, 1.0 ), draw );
  vec3 tang = normalize( q - r + vec3( 1e-5 ) );
  vec3 look = p - uCam;
  float d = length( look );
  vec3 across = normalize( cross( tang, look / max( d, 1e-3 ) ) + vec3( 1e-5 ) );
  // Pointed at both ends; thin where the line is just starting; never thinner
  // than a pixel or two, however far; not at the lens; gone at the box's edge.
  float taper = pow( sin( 3.14159 * aRib.x ), 0.7 );
  float grow = smoothstep( 0.0, 0.12, span );
  float edge = 1.0 - smoothstep( ${(LINE_BOX * 0.3).toFixed(1)}, ${(LINE_BOX * 0.5).toFixed(1)}, length( anchor - mid ) );
  float near = smoothstep( 3.0, 10.0, d );
  float width = max( 0.075, d * 0.0036 ) * taper * grow * edge * near;
  vec3 wp = p + across * aRib.y * width;
  vec4 mv = viewMatrix * vec4( wp, 1.0 );
  gl_Position = projectionMatrix * mv;
  vCol = mix( uCol, uFogCol, 1.0 - exp( -max( -mv.z, 0.0 ) * fogParams.x * 0.9 ) );
}
`;

// --- the petals --------------------------------------------------------------

const PETAL_BOX = 44;
const PETAL_TOP = 18;
const PETAL_VERTEX = /* glsl */`
attribute vec3 aCorner;   // a corner of the petal (xy), how light it is
attribute vec4 aSeed;     // where in the box (xz, 0..1), a height, its own draw
uniform vec3 uCam;
uniform vec3 uCamMod;
uniform float uTime;
uniform float uShare;
uniform float uSize;
uniform float uGround;
uniform vec2 uWind;
uniform vec4 uTint;       // a colour the petals lean to, and how far
uniform vec2 uFwd;        // where the lens looks, along the ground
uniform float uLight;
uniform vec3 fogParams;
uniform vec3 uFogCol;
varying vec3 vCol;

void main() {
  vCol = vec3( 0.0 );
  if ( fract( aSeed.w * 3.17 ) >= uShare ) {
    gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    return;
  }
  float ph = aSeed.w * 6.2832;
  float fall = 0.45 + 0.4 * fract( aSeed.w * 9.1 );
  vec2 drift = uWind * ( 2.0 + 1.8 * fract( aSeed.w * 4.3 ) );
  vec2 mid = uFwd * ${(PETAL_BOX * 0.2).toFixed(1)};
  vec2 anchor = mod( aSeed.xz * ${PETAL_BOX}.0 + drift * uTime - uCamMod.xz - mid, ${PETAL_BOX}.0 ) - ${PETAL_BOX / 2}.0 + mid;
  float hy = mod( aSeed.y * ${PETAL_TOP}.0 - uTime * fall, ${PETAL_TOP}.0 );
  // Blown about as it falls: a sway, and a little lift now and then.
  vec3 flutter = vec3( sin( uTime * 1.3 + ph ) * 0.7, 0.18 * sin( uTime * 2.3 + ph * 2.0 ), cos( uTime * 1.1 + ph * 1.7 ) * 0.7 );
  vec3 c = vec3( uCam.x + anchor.x, uGround + 0.25 + hy, uCam.z + anchor.y ) + flutter;
  float edge = 1.0 - smoothstep( ${(PETAL_BOX * 0.3).toFixed(1)}, ${(PETAL_BOX * 0.5).toFixed(1)}, length( anchor - mid ) );
  float vert = smoothstep( 0.0, 1.0, hy ) * ( 1.0 - smoothstep( ${PETAL_TOP - 3}.0, ${PETAL_TOP}.0, hy ) );
  float near = smoothstep( 1.6, 5.0, distance( c, uCam ) );
  float size = uSize * edge * vert * near * ( 0.75 + 0.5 * fract( aSeed.w * 13.0 ) );
  // Turning over about a slant axis.
  vec3 axis = normalize( vec3( sin( ph * 3.1 ), 0.55 + 0.45 * cos( ph * 1.7 ), cos( ph * 2.3 ) ) );
  float ang = uTime * ( 1.3 + 1.9 * fract( aSeed.w * 6.1 ) ) + ph;
  float ca = cos( ang );
  float sa = sin( ang );
  vec3 lp = vec3( aCorner.xy, 0.0 );
  lp = lp * ca + cross( axis, lp ) * sa + axis * dot( axis, lp ) * ( 1.0 - ca );
  vec4 mv = viewMatrix * vec4( c + lp * size, 1.0 );
  gl_Position = projectionMatrix * mv;
  float pick = fract( aSeed.w * 5.3 );
  vec3 petal = pick < 0.35 ? vec3( 1.0, 0.6, 0.72 ) : pick < 0.65 ? vec3( 1.0, 0.78, 0.85 )
    : pick < 0.85 ? vec3( 1.0, 0.92, 0.94 ) : vec3( 0.95, 0.42, 0.6 );
  petal = mix( petal, uTint.rgb * mix( 0.9, 1.1, fract( aSeed.w * 17.0 ) ), uTint.a );
  vec3 col = petal * mix( 0.78, 1.0, aCorner.z ) * ( 0.88 + 0.12 * sin( ang * 2.0 + ph ) ) * uLight * 0.6;
  vCol = mix( col, uFogCol, 1.0 - exp( -max( -mv.z, 0.0 ) * fogParams.x * 0.9 ) );
}
`;

const FRAGMENT = /* glsl */`
varying vec3 vCol;
void main() {
  gl_FragColor = vec4( vCol, 1.0 );
}
`;

// A ribbon of LINE_SEGS pieces: two vertices at each station along it.
function lineGeometry(count, seeds) {
  const rib = [];
  const idx = [];
  for (let i = 0; i <= LINE_SEGS; i++) {
    const u = i / LINE_SEGS;
    rib.push(u, -1, u, 1);
    if (i < LINE_SEGS) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((LINE_SEGS + 1) * 6), 3));
  g.setAttribute('aRib', new THREE.Float32BufferAttribute(rib, 2));
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  g.setIndex(idx);
  g.instanceCount = count;
  return g;
}

// A petal: a rounded leaf with a notch at the tip, about a unit long, as a
// fan of triangles from its middle.
function petalGeometry(count, seeds) {
  const ring = [];
  const N = 10;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    // Longer than wide, fuller toward the tip, with a notch where the tip is.
    const x = Math.sin(a) * 0.32 * (1 + 0.25 * Math.cos(a));
    const y = Math.cos(a) * 0.5 - (i === 0 ? 0.08 : 0);
    ring.push([x, y]);
  }
  const P = [[0, 0, 1]];
  for (const [x, y] of ring) P.push([x, y, 0.35 + 0.65 * (1 - Math.min(1, Math.hypot(x, y) / 0.5))]);
  const pos = [];
  for (const p of P) pos.push(p[0], p[1], p[2]);
  const idx = [];
  for (let i = 0; i < N; i++) idx.push(0, 1 + i, 1 + ((i + 1) % N));
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(P.length * 3), 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  g.setIndex(idx);
  g.instanceCount = count;
  return g;
}

export class Drift {
  constructor(scene) {
    const rand = mulberry32(0xd21f7);
    const lines = 60;
    const petals = 300;
    const lineSeed = new Float32Array(lines * 4).map(rand);
    const petalSeed = new Float32Array(petals * 4).map(rand);
    const wind = new THREE.Vector2().copy(WIND_DIR);
    const shared = () => ({
      uCam: { value: new THREE.Vector3() },
      uCamMod: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uShare: { value: 0 },
      uGround: { value: 0 },
      uWind: { value: wind },
      uFwd: { value: new THREE.Vector2(0, 1) },
      uFogCol: { value: new THREE.Color() },
      fogParams: atmo.fogParams,
    });
    this.lineU = { ...shared(), uCol: { value: new THREE.Color(0.97, 0.98, 1.0) } };
    this.petalU = { ...shared(), uSize: { value: 0.4 }, uTint: { value: new THREE.Vector4(1, 1, 1, 0) }, uLight: { value: 1 } };
    this.lines = new THREE.Mesh(lineGeometry(lines, lineSeed), new THREE.ShaderMaterial({
      uniforms: this.lineU, vertexShader: LINE_VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide,
    }));
    this.petals = new THREE.Mesh(petalGeometry(petals, petalSeed), new THREE.ShaderMaterial({
      uniforms: this.petalU, vertexShader: PETAL_VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide,
    }));
    for (const m of [this.lines, this.petals]) {
      m.frustumCulled = false;
      m.visible = false;
      scene.add(m);
    }
    this.counts = { lines, petals };
    this._fwd = new THREE.Vector3();
    this.shown = { lines: 0, petals: 0 };
  }

  // ctx: camera, style (its numbers), at (the world the camera is in),
  // origin, ground (the road's height), fogColor, light (0..1, the day).
  update(dt, ctx) {
    const { camera, style, at, origin } = ctx;
    const k = Math.max(0, Math.min(1, style.drift || 0));
    const idOf = (i) => WORLDS[i < 0 ? 0 : i].id;
    const A = DRIFT[idOf(at.a)] || [0, 0];
    const B = DRIFT[idOf(at.b)] || [0, 0];
    const t = at.a === at.b ? 0 : at.t;
    const lineShare = k * (A[0] * (1 - t) + B[0] * t);
    const petalShare = k * (A[1] * (1 - t) + B[1] * t);
    this.shown.lines = lineShare > 0.01 ? Math.round(lineShare * this.counts.lines) : 0;
    this.shown.petals = petalShare > 0.01 ? Math.round(petalShare * this.counts.petals) : 0;
    this.lines.visible = this.shown.lines > 0;
    this.petals.visible = this.shown.petals > 0;
    if (!this.lines.visible && !this.petals.visible) return;
    const c = camera.position;
    camera.getWorldDirection(this._fwd);
    const fl = Math.hypot(this._fwd.x, this._fwd.z);
    if (fl > 0.05) this._fwd.set(this._fwd.x / fl, 0, this._fwd.z / fl);
    else this._fwd.set(0, 0, 0);
    const wrap = (v, box) => ((v % box) + box) % box;
    const light = Math.max(0.35, Math.min(1, ctx.light === undefined ? 1 : ctx.light));
    for (const [u, box, share] of [[this.lineU, LINE_BOX, lineShare], [this.petalU, PETAL_BOX, petalShare]]) {
      u.uTime.value = (u.uTime.value + dt) % 3600;
      u.uShare.value = share;
      u.uCam.value.copy(c);
      u.uFwd.value.set(this._fwd.x, this._fwd.z);
      u.uCamMod.value.set(wrap(c.x + origin.x, box), 0, wrap(c.z + origin.z, box));
      u.uGround.value = ctx.ground;
      u.uFogCol.value.copy(ctx.fogColor);
    }
    // Wind drawn pale against a dim sky, petals as dim as the day.
    this.lineU.uCol.value.setRGB(0.97 * light, 0.98 * light, 1.0 * light);
    this.petalU.uLight.value = light;
    const tint = PETAL[idOf(at.a < 0 ? 0 : (t < 0.5 ? at.a : at.b))];
    if (tint) this.petalU.uTint.value.set(tint[0], tint[1], tint[2], tint[3]);
    else this.petalU.uTint.value.set(1, 1, 1, 0);
  }
}
