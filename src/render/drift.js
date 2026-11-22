// Wind, and what it carries, for the painted style (手绘): long pale lines of
// wind drawn across the air a stroke at a time, as a hand-drawn film draws a
// gust, and petals coming down on it, turning over as they fall. And, for the
// cel style (赛璐璐), the lines a film draws round a fast car: thin white
// streaks along the way it goes, at the sides of the lens.
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
import { WIND, styleU } from './style.js';
import { twistU, TWIST_PARS } from './twist.js';

// [lines of wind, petals] a world has, a share of the full number.
const DRIFT = {
  alpine: [0.9, 0.8], hills: [1, 1], river: [0.8, 0.9], coast: [1, 0.35], desert: [0.7, 0], heaven: [0.6, 0.5], city: [0.35, 0],
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
${TWIST_PARS}
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

// How much of a gust there is at a time: slow swells, a lull between.
float gustAt( float t ) {
  return 0.2 + 0.8 * smoothstep( 0.3, 0.85, 0.5 + 0.5 * sin( t * 0.23 ) * sin( t * 0.137 + 1.7 ) );
}

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
  // Not every line every time round: whether it is drawn this time is
  // decided where it starts, by how much of a gust there is then, so the wind
  // comes in gusts with a few strokes between them, and a line is never taken
  // away in the middle of being drawn.
  float cyc = floor( uTime / 3.8 + draw * 5.0 );
  float roll = fract( sin( cyc * 12.9898 + draw * 78.233 ) * 43758.5453 );
  float gust = gustAt( ( cyc - draw * 5.0 ) * 3.8 );
  if ( roll >= gust * 0.55 ) {
    gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    return;
  }
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
  gl_Position = projectionMatrix * twistView( mv );
  vCol = mix( uCol, uFogCol, 1.0 - exp( -max( -mv.z, 0.0 ) * fogParams.x * 0.9 ) );
}
`;

// --- the petals --------------------------------------------------------------

const PETAL_BOX = 44;
const PETAL_TOP = 18;
const PETAL_VERTEX = /* glsl */`
${TWIST_PARS}
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
  gl_Position = projectionMatrix * twistView( mv );
  float pick = fract( aSeed.w * 5.3 );
  vec3 petal = pick < 0.35 ? vec3( 1.0, 0.6, 0.72 ) : pick < 0.65 ? vec3( 1.0, 0.78, 0.85 )
    : pick < 0.85 ? vec3( 1.0, 0.92, 0.94 ) : vec3( 0.95, 0.42, 0.6 );
  petal = mix( petal, uTint.rgb * mix( 0.9, 1.1, fract( aSeed.w * 17.0 ) ), uTint.a );
  vec3 col = petal * mix( 0.78, 1.0, aCorner.z ) * ( 0.88 + 0.12 * sin( ang * 2.0 + ph ) ) * uLight * 0.6;
  vCol = mix( col, uFogCol, 1.0 - exp( -max( -mv.z, 0.0 ) * fogParams.x * 0.9 ) );
}
`;

// --- the speed lines ---------------------------------------------------------

// Past SPEED_FROM m/s the air at the sides of the lens has streaks in it, thin
// white lines along the way the car goes, each standing in the world for
// SPEED_LIFE seconds (so the lens runs past it) and drawing itself on and off
// along its length. How many there are goes with the speed, up to SPEED_MAX.
const SPEED_MAX = 40;
const SPEED_LIFE = 0.25;
const SPEED_FROM = 33;
const SPEED_SIDE = [4, 20];     // metres to either side of the lens' way
const SPEED_AHEAD = [8, 54];    // metres ahead of the lens when one begins
const SPEED_UP = [-1.2, 5.8];   // metres over the lens' own height
const SPEED_VERTEX = /* glsl */`
${TWIST_PARS}
attribute vec2 aRib;      // along the line 0..1, the side of it -1 or 1
attribute vec4 aSeed;     // its rank among them (it is on when the share is over it), three draws of its own
uniform vec3 uCam;
uniform vec3 uDir;        // the way the car goes, along the ground
uniform vec3 uSide;       // across it, along the ground
uniform float uTime;
uniform float uShare;
uniform float uSpeed;
uniform float uPx;        // radians a pixel is across
uniform vec3 fogParams;
uniform vec3 uFogCol;
uniform vec3 uCol;
varying vec3 vCol;

float draw( float cyc, float k ) {
  return fract( sin( cyc * 12.9898 + k * 78.233 ) * 43758.5453 );
}

void main() {
  vCol = vec3( 0.0 );
  if ( aSeed.x >= uShare ) {
    gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    return;
  }
  // Each its own beat, and a life of its own (which side, how far ahead, how
  // high, how long) each time round.
  float t = uTime / ${SPEED_LIFE.toFixed(2)} + aSeed.y * 9.0;
  float cyc = floor( t );
  float phase = t - cyc;
  float a = draw( cyc, aSeed.z );
  float b = draw( cyc, aSeed.w + 3.7 );
  float c = draw( cyc, aSeed.y + 7.1 );
  float d = draw( cyc, aSeed.z + 11.3 );
  float side = ( a < 0.5 ? -1.0 : 1.0 ) * mix( ${SPEED_SIDE[0].toFixed(1)}, ${SPEED_SIDE[1].toFixed(1)}, b );
  float ahead = mix( ${SPEED_AHEAD[0].toFixed(1)}, ${SPEED_AHEAD[1].toFixed(1)}, c );
  float up = mix( ${SPEED_UP[0].toFixed(1)}, ${SPEED_UP[1].toFixed(1)}, d );
  float len = uSpeed * ( 0.26 + 0.2 * fract( a * 7.0 ) );
  // The lens has gone this far since the line began, and the line has not.
  vec3 mid = uCam + uDir * ( ahead - uSpeed * phase * ${SPEED_LIFE.toFixed(2)} ) + uSide * side + vec3( 0.0, up, 0.0 );
  // Drawn on from its tail to its head, then wiped off from the tail.
  float head = smoothstep( 0.0, 0.4, phase );
  float tail = smoothstep( 0.45, 1.0, phase );
  float span = max( head - tail, 0.0 );
  float u = tail + span * aRib.x;
  vec3 p = mid + uDir * ( u - 0.5 ) * len;
  vec3 look = p - uCam;
  float dist = length( look );
  vec3 across = normalize( cross( uDir, look / max( dist, 1e-3 ) ) + vec3( 1e-5 ) );
  // Pointed at both ends, two and a half pixels across at any distance, not at the lens.
  float taper = pow( sin( 3.14159 * aRib.x ), 0.6 );
  float width = max( 0.012, dist * uPx * 1.25 ) * taper * smoothstep( 3.0, 8.0, dist ) * step( 0.002, span );
  vec4 mv = viewMatrix * vec4( p + across * aRib.y * width, 1.0 );
  gl_Position = projectionMatrix * twistView( mv );
  vCol = mix( uCol, uFogCol, 1.0 - exp( -max( -mv.z, 0.0 ) * fogParams.x * 0.9 ) );
}
`;

// How many of the lines there are at a speed, a share of SPEED_MAX: none up to
// SPEED_FROM, then at once a good number (not one or two), more to the top speed.
export function speedShare(speed) {
  const s = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  return s(SPEED_FROM, SPEED_FROM + 1.5, speed) * (0.45 + 0.55 * s(SPEED_FROM + 1.5, 54, speed));
}

// A line: a straight ribbon of SPEED_SEGS pieces, two vertices at each station
// along it, pointed at both ends by the vertex shader (a ribbon of one piece
// would be as wide as its two ends are, which is nothing).
const SPEED_SEGS = 8;
function speedGeometry(count, seeds) {
  const rib = [];
  const idx = [];
  for (let i = 0; i <= SPEED_SEGS; i++) {
    const u = i / SPEED_SEGS;
    rib.push(u, -1, u, 1);
    if (i < SPEED_SEGS) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((SPEED_SEGS + 1) * 6), 3));
  g.setAttribute('aRib', new THREE.Float32BufferAttribute(rib, 2));
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  g.setIndex(idx);
  g.instanceCount = count;
  return g;
}

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
    const lines = 30;
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
      ...twistU,
    });
    this.lineU = { ...shared(), uCol: { value: new THREE.Color(0.97, 0.98, 1.0) } };
    this.petalU = { ...shared(), uSize: { value: 0.4 }, uTint: { value: new THREE.Vector4(1, 1, 1, 0) }, uLight: { value: 1 } };
    this.lines = new THREE.Mesh(lineGeometry(lines, lineSeed), new THREE.ShaderMaterial({
      uniforms: this.lineU, vertexShader: LINE_VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide,
    }));
    this.petals = new THREE.Mesh(petalGeometry(petals, petalSeed), new THREE.ShaderMaterial({
      uniforms: this.petalU, vertexShader: PETAL_VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide,
    }));
    // The speed lines: the first of the seeds is a line's rank (the share has room for the lines under it).
    const speedSeed = new Float32Array(SPEED_MAX * 4).map(rand);
    for (let i = 0; i < SPEED_MAX; i++) speedSeed[i * 4] = (i + 0.5) / SPEED_MAX;
    this.speedU = {
      uCam: { value: new THREE.Vector3() },
      uDir: { value: new THREE.Vector3(0, 0, 1) },
      uSide: { value: new THREE.Vector3(1, 0, 0) },
      uTime: { value: 0 },
      uShare: { value: 0 },
      uSpeed: { value: 0 },
      uPx: { value: 0.001 },
      uFogCol: { value: new THREE.Color() },
      uCol: { value: new THREE.Color(1, 1, 1) },
      fogParams: atmo.fogParams,
      ...twistU,
    };
    // Not into the depth: a line a pixel across would have an outline of its own drawn round it.
    this.speed = new THREE.Mesh(speedGeometry(SPEED_MAX, speedSeed), new THREE.ShaderMaterial({
      uniforms: this.speedU, vertexShader: SPEED_VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide, depthWrite: false,
    }));
    this.speed.renderOrder = 1;
    for (const m of [this.lines, this.petals, this.speed]) {
      m.frustumCulled = false;
      m.visible = false;
      scene.add(m);
    }
    this.counts = { lines, petals };
    this._fwd = new THREE.Vector3();
    this.shown = { lines: 0, petals: 0, speed: 0 };
  }

  // The speed lines, for a style that draws them: ctx.speed (m/s) and
  // ctx.heading (the way the car goes along the ground, [x, z]).
  _speed(dt, ctx) {
    const k = Math.max(0, Math.min(1, ctx.style.speedLines || 0));
    const share = k * speedShare(ctx.speed || 0);
    this.shown.speed = share > 0 ? Math.max(1, Math.round(share * SPEED_MAX)) : 0;
    this.speed.visible = this.shown.speed > 0;
    if (!this.speed.visible) return;
    const u = this.speedU;
    const h = ctx.heading || [0, 1];
    const hl = Math.hypot(h[0], h[1]) || 1;
    u.uTime.value = (u.uTime.value + dt) % 3600;
    u.uShare.value = (this.shown.speed + 0.01) / SPEED_MAX;
    u.uSpeed.value = ctx.speed;
    u.uPx.value = 2 * Math.tan(ctx.camera.fov * Math.PI / 360) / (ctx.height || 720);
    u.uCam.value.copy(ctx.camera.position);
    u.uDir.value.set(h[0] / hl, 0, h[1] / hl);
    u.uSide.value.set(-h[1] / hl, 0, h[0] / hl);
    u.uFogCol.value.copy(ctx.fogColor);
    const light = Math.max(0.35, Math.min(1, ctx.light === undefined ? 1 : ctx.light));
    u.uCol.value.setRGB(light, light, light);
  }

  // ctx: camera, style (its numbers), at (the world the camera is in),
  // origin, ground (the road's height), fogColor, light (0..1, the day),
  // speed and heading (the car's), height (the frame's, in pixels).
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
    this._speed(dt, ctx);
    if (!this.lines.visible && !this.petals.visible) return;
    const c = camera.position;
    camera.getWorldDirection(this._fwd);
    const fl = Math.hypot(this._fwd.x, this._fwd.z);
    if (fl > 0.05) this._fwd.set(this._fwd.x / fl, 0, this._fwd.z / fl);
    else this._fwd.set(0, 0, 0);
    const wrap = (v, box) => ((v % box) + box) % box;
    // (In a world lit by night, dimmer than a day's dim ones.)
    const light = Math.max(0.35 - 0.2 * Math.min(1, styleU.uDuskDark.value.w), Math.min(1, ctx.light === undefined ? 1 : ctx.light));
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
