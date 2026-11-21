// Threads of glow-worm light hanging from the roof of the cavern, and the drops
// that fall from it: one buffer of points, drawn added on.
//
// A thread is a string of small points (six to twelve, a metre or so apart)
// hanging from the rock where stalactites are, swaying a little, more the lower
// down the string. They are laid by cells of the roof in absolute coordinates, as
// the clutter is, the same ones each time, the nearest as many as the tier allows;
// where the string hangs from is the height of the roof's own surface there
// (render/ceiling.js), less the stalactite there. A drop is a point with two
// behind it, falling the last of its way into a puddle (render/cavern.js says where
// and when), and gone as it lands.
//
// In the painted style the points are flat discs of the colour of the roof's
// glow-worms; in the block style they are squares.

import * as THREE from 'three';
import { twistU, TWIST_PARS } from './twist.js';
import { styleU } from './style.js';
import { atmo } from './atmosphere.js';
import { hash3 } from '../world/cavernplan.js';

// max: the most threads at each tier; dots: from least to most a string has;
// gap: metres between its points; size: a point's, in metres; range: how far off
// a thread is drawn (m), cell: the cells of the roof they are laid by (m); stalactite:
// the least a stalactite may be, of the longest, where a thread hangs; sway: how far
// the foot of a string swings (m); into: how far up into the rock the string starts (m);
// colour, level: the light of a point (linear); drop: how many drops at once, a drop's
// size (m), colour and level.
export const WORMS = {
  max: { high: 96, mid: 48, low: 0 },
  dots: [6, 12],
  gap: [0.9, 1.6],
  size: [0.35, 0.6],
  range: 420,
  cell: 40,
  stalactite: 0.12,
  sway: 0.9,
  into: 0.5,
  colour: [0.35, 1.0, 0.85],
  level: 2.2,
  drop: { max: 4, tail: 2, size: 0.3, colour: [0.65, 0.9, 1.0], level: 4 },
};

// The painted style's points: the colour of the roof's glow-worms, as it comes out
// on the screen (render/ceiling.js), and a drop's.
const PAINT = { thread: [0.16, 0.82, 0.78], drop: [0.8, 0.95, 1.0] };

const MAXT = WORMS.max.high;
const PER = WORMS.dots[1];
const DROPS = WORMS.drop.max * (1 + WORMS.drop.tail);
const COUNT = MAXT * PER + DROPS;

const v3 = (a) => `vec3(${a.map((x) => x.toFixed(4)).join(', ')})`;

function wormMaterial(shared) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      ...twistU, uPair: styleU.uPair, uPaintInv: styleU.uPaintInv, uBlock: shared.uBlock, uTime: shared.uTime,
      fogParams: atmo.fogParams, uPx: { value: 700 },
    },
    vertexShader: /* glsl */`
${TWIST_PARS}
attribute vec4 aInfo;     // a thread's point: its string's phase, how far down the string (0 to 1), its size (m), 0; a drop's: 0, how bright, its size (m), 1 the head or 2 a tail
uniform float uTime;
uniform float uPx;
uniform vec3 fogParams;
varying vec3 vLight;
varying vec3 vFlat;
void main() {
  vec3 p = position;
  bool drop = aInfo.w > 0.5;
  if ( !drop ) {
    float swing = ${WORMS.sway.toFixed(2)} * aInfo.y * aInfo.y;
    p.x += swing * sin( uTime * 0.55 + aInfo.x * 6.2832 );
    p.z += swing * cos( uTime * 0.43 + aInfo.x * 8.1681 );
  }
  vec4 mv = viewMatrix * vec4( p, 1.0 );
  gl_Position = projectionMatrix * twistView( mv );
  float d = max( -mv.z, 1.0 );
  float px = aInfo.z * uPx / d;
  gl_PointSize = clamp( px, 2.0, 24.0 );
  float dim = clamp( px / 2.0, 0.3, 1.0 ) * exp( -d * fogParams.x );
  if ( drop ) {
    float k = aInfo.w < 1.5 ? 1.0 : 0.45;
    vLight = ${v3(WORMS.drop.colour)} * ${WORMS.drop.level.toFixed(1)} * aInfo.y * k * dim;
    vFlat = ${v3(PAINT.drop)} * aInfo.y * k;
  } else {
    vLight = ${v3(WORMS.colour)} * ${WORMS.level.toFixed(1)} * dim * ( 0.65 + 0.35 * sin( uTime * 0.9 + aInfo.x * 40.0 + aInfo.y * 9.0 ) );
    vFlat = ${v3(PAINT.thread)} * dim;
  }
}`,
    fragmentShader: /* glsl */`
uniform float uPair;
uniform float uPaintInv;
uniform float uBlock;
varying vec3 vLight;
varying vec3 vFlat;
void main() {
  float r = length( gl_PointCoord - 0.5 );
  vec3 c = vLight * mix( 1.0 - smoothstep( 0.1, 0.5, r ), 1.0, uBlock );
  if ( uPair > 0.0 ) {
    // The painted style's point: a flat disc.
    if ( r > 0.5 && uBlock < 0.5 ) discard;
    c = mix( c, vFlat * uPaintInv, uPair );
  }
  gl_FragColor = vec4( c, 1.0 );
}`,
  });
}

export class Glowworms {
  // env: ceiling (baseAt, spikesAt), origin().
  constructor(scene, env, shared) {
    this.env = env;
    this.scene = scene;
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.info = new THREE.BufferAttribute(new Float32Array(COUNT * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('aInfo', this.info);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    geo.setDrawRange(0, 0);
    this.material = wormMaterial(shared);
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.points.visible = false;
    scene.add(this.points);
    this.threads = 0;                 // the threads drawn
    this.dots = 0;                    // and their points
    this.drops = [];                  // [{ x, y, z, alpha }] in local metres
    this.cells = new Map();           // cell -> the thread it has, or null
    this._last = { x: 1e9, z: 1e9 };
    this._dirty = true;
    this._tier = '';
    this._droppedLast = false;
  }

  shift() {
    this._dirty = true;
  }

  // The thread of the cell of the roof (cx, cz), or null: where it hangs from (absolute x, z, and
  // the height of the rock there), and what it is made of.
  _thread(cx, cz) {
    const key = cx * 100003 + cz;
    if (this.cells.has(key)) return this.cells.get(key);
    const C = WORMS.cell;
    const h = (n) => hash3(cx, cz, 400 + n);
    const x = (cx + h(1)) * C;
    const z = (cz + h(2)) * C;
    let t = null;
    const sp = this.env.ceiling.spikesAt(x, z);
    const base = this.env.ceiling.baseAt(x, z);
    // (Where the roof is let down across a border it is not the roof of the cavern yet: no thread.)
    if (sp >= WORMS.stalactite && this.env.ceiling.shareAt(x, z) > 0.95 && h(3) < 0.9) {
      const n = WORMS.dots[0] + Math.floor(h(4) * (WORMS.dots[1] - WORMS.dots[0] + 1));
      t = { x, z, y: base - 30 * sp + WORMS.into, n: Math.min(PER, n), gap: WORMS.gap[0] + (WORMS.gap[1] - WORMS.gap[0]) * h(5), size: WORMS.size[0] + (WORMS.size[1] - WORMS.size[0]) * h(6), phase: h(7), key };
    }
    this.cells.set(key, t);
    return t;
  }

  // Every frame in the cavern. tier: 'high', 'mid', 'low'; px: pixels a metre makes at a metre.
  update(camera, on, tier, px, shown = true) {
    const pts = this.points;
    const max = WORMS.max[tier] || 0;
    if (!on || !shown || max === 0) {
      if (pts.visible) {
        pts.visible = false;
        this.threads = 0;
        this.dots = 0;
      }
      this._dirty = true;
      return;
    }
    this.material.uniforms.uPx.value = px;
    const o = this.env.origin();
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    const moved = Math.hypot(ax - this._last.x, az - this._last.z) > 24;
    let rewrite = false;
    if (this._dirty || moved || this._tier !== tier) {
      this._dirty = false;
      this._tier = tier;
      this._last.x = ax;
      this._last.z = az;
      const C = WORMS.cell;
      const R = WORMS.range;
      const list = [];
      for (let cx = Math.floor((ax - R) / C); cx <= Math.floor((ax + R) / C); cx++) {
        for (let cz = Math.floor((az - R) / C); cz <= Math.floor((az + R) / C); cz++) {
          const t = this._thread(cx, cz);
          if (!t) continue;
          const d = Math.hypot(t.x - ax, t.z - az);
          if (d < R) list.push([d, t]);
        }
      }
      list.sort((a, b) => a[0] - b[0]);
      let n = 0;
      let k = 0;
      for (const [, t] of list.slice(0, max)) {
        for (let i = 0; i < t.n; i++) {
          this.pos.setXYZ(k, t.x - o.x, t.y - i * t.gap, t.z - o.z);
          this.info.setXYZW(k, t.phase, t.n > 1 ? i / (t.n - 1) : 0, t.size * (i === t.n - 1 ? 1.4 : 1), 0);
          k++;
        }
        n++;
      }
      this.threads = n;
      this.dots = k;
      rewrite = true;
      if (this.cells.size > 1500) {
        for (const [key, t] of this.cells) if (t && Math.hypot(t.x - ax, t.z - az) > R * 2) this.cells.delete(key);
      }
    }
    // The drops go after the threads' points.
    let k = this.dots;
    for (const d of this.drops) {
      for (let i = 0; i <= WORMS.drop.tail; i++) {
        this.pos.setXYZ(k, d.x, d.y + (d.up || 0) * i, d.z);
        this.info.setXYZW(k, 0, d.alpha * (i === 0 ? 1 : 0.8), WORMS.drop.size * (i === 0 ? 1 : 0.8), i === 0 ? 1 : 2);
        k++;
      }
    }
    if (rewrite || this.drops.length || this._droppedLast) {
      this.pos.needsUpdate = true;
      this.info.needsUpdate = true;
    }
    this._droppedLast = this.drops.length > 0;
    pts.geometry.setDrawRange(0, k);
    pts.visible = k > 0;
  }

  // The drops now falling, [{ x, y, z, up, alpha }] in local metres: a point at (x, y, z) and
  // two more, each `up` higher than the one before (they are the head and its tail).
  setDrops(list) {
    this.drops = list.slice(0, WORMS.drop.max);
  }

  dispose() {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.material.dispose();
    this.cells.clear();
  }
}

