// Bands of stuff the wind carries along a line: the snow blown off a ridge, the
// sand blown over a dune. One mesh, one draw, however many bands there are.
//
// A band is a ribbon that is laid along a line the caller gives it (the points are
// in the scene's coordinates, so over the land or wherever the caller wants it) and
// faces the lens as the line is seen. It has no body of its own: how thick it is
// at a place is worked out where it is drawn, from a noise that runs down the line
// with the wind (the same clock the clouds' shadows and the grass go by,
// `styleU.uCloudDrift`, so that it stands still in the photo mode), from the gust
// there (a field 61 m across and one of 17 m, carried with the wind: thick in a gust,
// thin in a lull) and from how near the lens is. The line wanders a little as the
// noise goes by.
//
// What the caller says, of the module:
//   new Plumes(scene, options)      options, each of them optional:
//     max       how many bands there are room for (6)
//     segments  the quads along a band (16)
//     color     the colour of the thick of it, sRGB hex (0xf4f8ff, snow)
//     shade     the colour of the thin of it and of the lee side, sRGB hex (0xb9cbe6)
//     flat      the colour it is in the painted styles, one flat paint, sRGB hex (0xeef4ff)
//     gain      how bright it is, in the units of the scene's light: a white that the sun is on is about 3 (1)
//     opacity   how thick it is where it is thickest, in a full gust (0.6)
//     lull      how much of that is left in a lull (0.3)
//     wisp      the size of the streaks in it, metres (12)
//     speed     how fast they run along it, metres a second (7)
//     flutter   how far the line wanders sideways and up, metres (2.5)
//     range     how far off it is drawn, metres; gone by the end of it (800)
//     near      how near the lens it begins to fade, metres (40)
//   plumes.setTier(tier)            'high' all the room there is, 'mid' half of it, 'low' none
//   plumes.set(bands)               the bands there are now, the one to be seen first first:
//                                   [{ key, pts: [x, y, z, ...] (two points or more), width (metres,
//                                   at its widest), strength (0 to 1, how thick it is, 1), seed }]
//                                   A band that was there and is not is let go over a second; the
//                                   points are read again each time, so call it when they have moved
//                                   (the floating origin has).
//   plumes.update(dt, { light (0 to 1), fog: [r, g, b] (linear), blocks (0 to 1, the block style),
//                       eye: the lens's position })
//   plumes.meshes(), plumes.dispose()
// The mesh joins the scene when the first band is set: a game that has none has no program for
// it and nothing to draw.

import * as THREE from 'three';
import { twistU, TWIST_PARS } from './twist.js';
import { styleU } from './style.js';
import { atmo } from './atmosphere.js';

const LEVELS = { high: 1, mid: 0.5, low: 0 };
const DEFAULTS = {
  max: 6, segments: 16, color: 0xf4f8ff, shade: 0xb9cbe6, flat: 0xeef4ff, gain: 1, opacity: 0.6, lull: 0.3, wisp: 12, speed: 7,
  flutter: 2.5, range: 800, near: 40,
};
// How long a band takes to come up or go (s).
const FADE = 1;
const lin = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

// The shape of a band across and along it: a root, a body that swells and a tail that thins out. u: 0 to 1 along it.
export function plumeHalfWidth(u, width) {
  const root = 0.18 + 0.82 * smooth(0, 0.3, u);
  const tail = 1 - 0.5 * smooth(0.5, 1, u);
  return 0.5 * width * root * tail;
}
function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const VERTEX = (max) => /* glsl */`
${TWIST_PARS}
attribute vec3 aDir;      // the way the line runs here (a unit vector, the scene's)
attribute vec4 aBand;     // which side of the line (-1 or 1), how far along it (0 to 1), half its width here (m), its slot
uniform vec4 uSlot[${max}];   // by slot: its seed, its length (m), how thick it is, how far up it has come (0 to 1)
uniform vec2 uCloudDrift;
uniform vec3 uOriginAbs;
uniform vec3 fogParams;
uniform float uWisp;
uniform float uSpeed;
uniform float uFlutter;
uniform float uRange;
uniform float uNear;
uniform float uGust;      // how much of the opacity a lull leaves
uniform float uOpacity;
varying vec4 vInfo;       // across (-1 to 1), along (0 to 1), how thick, the seed
varying vec3 vShape;      // the length (m), half the width here (m), how far the lens is (m)
float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
// The gust at a place: two fields, 61 m and 17 m across, carried downwind with the clouds' shadows.
float gustAt(vec2 a) {
  vec2 q = a - uCloudDrift;
  return smoothstep(0.3, 0.7, vn(q / 61.0) * 0.6 + vn(q / 17.0 + 5.0) * 0.4);
}
void main() {
  vec4 slot = uSlot[int(aBand.w + 0.5)];
  float u = aBand.y;
  vec3 p = position;
  // The line wanders as the wind goes by: up and down, a little across, more the further it has gone.
  float t = dot(uCloudDrift, vec2(0.918, 0.396)) * 0.1414;
  float ph = u * 5.0 + slot.x * 37.0 - t * 0.9;
  float sway = ( sin( ph ) + 0.45 * sin( ph * 2.3 + 1.7 ) ) * uFlutter * u;
  p.y += sway;
  p.xz += vec2( -aDir.z, aDir.x ) * sway * 0.4;
  float gust = gustAt(p.xz + uOriginAbs.xz);
  vec4 mv = viewMatrix * vec4( p, 1.0 );
  float d = max( -mv.z, 0.5 );
  // Across the line, in the plane of the screen.
  vec3 tv = mat3( viewMatrix ) * aDir;
  vec3 side = cross( tv, vec3( 0.0, 0.0, -1.0 ) );
  side = side / max( length( side ), 1e-4 );
  mv.xyz += side * aBand.x * aBand.z;
  gl_Position = projectionMatrix * twistView( mv );
  float fade = slot.w * (1.0 - smoothstep( uRange * 0.9, uRange, d )) * smoothstep( uNear * 0.5, uNear, d );
  vInfo = vec4( aBand.x, u, fade * slot.z * mix( uGust, 1.0, gust ), slot.x );
  vShape = vec3( slot.y, aBand.z, d );
}
`;

const FRAGMENT = /* glsl */`
uniform vec2 uCloudDrift;
uniform float uWisp;
uniform float uSpeed;
uniform float uOpacity;
uniform float uGain;
uniform vec3 uColor;
uniform vec3 uShade;
uniform vec3 uFlat;
uniform vec3 uFog;
uniform float uLight;
uniform float uPair;
uniform float uPaintInv;
uniform float uBlock;
uniform vec3 fogParams;
varying vec4 vInfo;
varying vec3 vShape;
float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float across = vInfo.x;
  float u = vInfo.y;
  // The block style: the band is made of squares a metre across.
  if ( uBlock > 0.5 ) {
    u = ( floor( u * vShape.x ) + 0.5 ) / vShape.x;
    across = ( floor( across * vShape.y ) + 0.5 ) / max( vShape.y, 1.0 );
  }
  float body = ( 1.0 - smoothstep( 0.15, 1.0, abs( across ) ) ) * smoothstep( 0.0, 0.1, u ) * ( 1.0 - smoothstep( 0.6, 1.0, u ) );
  // Streaks that run along the band with the wind.
  float t = dot( uCloudDrift, vec2( 0.918, 0.396 ) ) * 0.1414;
  vec2 q = vec2( ( u * vShape.x - uSpeed * t ) / uWisp, across * 1.4 + vInfo.w * 31.0 );
  float n = vn( q ) * 0.6 + vn( q * 2.3 + 7.3 ) * 0.4;
  float thick = body * smoothstep( 0.26, 0.88, n + 0.4 * body );
  float a = thick * vInfo.z * uOpacity;
  // The lit side of it, thick, and the shade of it, thin.
  vec3 col = mix( uShade, uColor, smoothstep( 0.2, 0.8, thick ) ) * uLight * uGain;
  col = mix( col, uFog, 0.18 * smoothstep( 300.0, 900.0, vShape.z ) );
  if ( uPair > 0.0 ) {
    // The painted styles: a flat paint with a hard edge.
    float f = smoothstep( 0.3, 0.34, body * ( n + 0.15 ) ) * vInfo.z * uOpacity * 1.25;
    a = mix( a, f, uPair );
    col = mix( col, uFlat * uPaintInv, uPair );
  }
  a *= exp( - vShape.z * fogParams.x );
  if ( a < 0.002 ) discard;
  gl_FragColor = vec4( col, min( a, 1.0 ) );
}
`;

export class Plumes {
  constructor(scene, options = {}) {
    const o = { ...DEFAULTS, ...options };
    this.options = o;
    this.scene = scene;
    this.level = 1;
    this.max = o.max;
    this.seg = o.segments;
    const nodes = this.seg + 1;
    this.nodes = nodes;
    const verts = this.max * nodes * 2;
    this.pos = new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.dir = new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.band = new THREE.BufferAttribute(new Float32Array(verts * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const idx = [];
    for (let b = 0; b < this.max; b++) {
      for (let i = 0; i < this.seg; i++) {
        const a = (b * nodes + i) * 2;
        idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', this.pos);
    geo.setAttribute('aDir', this.dir);
    geo.setAttribute('aBand', this.band);
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.uniforms = {
      ...twistU,
      uSlot: { value: Array.from({ length: this.max }, () => new THREE.Vector4()) },
      uCloudDrift: styleU.uCloudDrift,
      uOriginAbs: styleU.uOriginAbs,
      fogParams: atmo.fogParams,
      uPair: styleU.uPair,
      uPaintInv: styleU.uPaintInv,
      uBlock: { value: 0 },
      uWisp: { value: o.wisp },
      uSpeed: { value: o.speed },
      uFlutter: { value: o.flutter },
      uRange: { value: o.range },
      uNear: { value: o.near },
      uGust: { value: o.lull },
      uOpacity: { value: o.opacity },
      uGain: { value: o.gain },
      uColor: { value: lin(o.color) },
      uShade: { value: lin(o.shade) },
      uFlat: { value: lin(o.flat) },
      uFog: { value: new THREE.Color(1, 1, 1) },
      uLight: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX(this.max),
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // (A transparent two-sided material is drawn in two passes, and its program is built twice; this writes no depth, so
      // one pass is the same picture.)
      forceSinglePass: true,
      // Over what is there, and what it says of itself (the alpha) kept.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    // The slots: { key, fade, target } (key null: free).
    this.slots = Array.from({ length: this.max }, () => ({ key: null, fade: 0, target: 0 }));
    this.count = 0;                 // bands drawn
  }

  setTier(tier) {
    if (LEVELS[tier] === undefined) return;
    this.level = LEVELS[tier];
    if (this.level === 0) {
      for (const s of this.slots) {
        s.key = null;
        s.fade = 0;
        s.target = 0;
      }
      this._sync();
    }
  }

  // How many bands the tier has room for.
  get room() {
    return Math.floor(this.max * this.level + 1e-9);
  }

  // The bands there are now (see the top of the file).
  set(bands) {
    const room = this.room;
    const want = bands.slice(0, room);
    const keys = new Set(want.map((b) => b.key));
    for (const s of this.slots) if (s.key !== null && !keys.has(s.key)) s.target = 0;
    for (const b of want) {
      let slot = this.slots.findIndex((s) => s.key === b.key);
      if (slot < 0) slot = this.slots.findIndex((s) => s.key === null);
      if (slot < 0) continue;
      const s = this.slots[slot];
      if (s.key !== b.key) {
        s.key = b.key;
        s.fade = 0;
      }
      s.target = 1;
      this._write(slot, b);
    }
    this._sync();
  }

  // The points of a band, resampled to the nodes along it, into the buffers of its slot.
  _write(slot, b) {
    const n = this.nodes;
    const src = b.pts;
    const m = Math.floor(src.length / 3);
    if (m < 2) return;
    // Lengths along the line it was given.
    const cum = new Float64Array(m);
    for (let i = 1; i < m; i++) {
      cum[i] = cum[i - 1] + Math.hypot(src[i * 3] - src[(i - 1) * 3], src[i * 3 + 1] - src[(i - 1) * 3 + 1], src[i * 3 + 2] - src[(i - 1) * 3 + 2]);
    }
    const total = cum[m - 1] || 1;
    const P = new Float64Array(n * 3);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const at = (total * i) / (n - 1);
      while (j < m - 2 && cum[j + 1] < at) j++;
      const span = cum[j + 1] - cum[j] || 1;
      const t = Math.min(1, Math.max(0, (at - cum[j]) / span));
      for (let k = 0; k < 3; k++) P[i * 3 + k] = src[j * 3 + k] + (src[(j + 1) * 3 + k] - src[j * 3 + k]) * t;
    }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const c = Math.min(n - 1, i + 1);
      let dx = P[c * 3] - P[a * 3];
      let dy = P[c * 3 + 1] - P[a * 3 + 1];
      let dz = P[c * 3 + 2] - P[a * 3 + 2];
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l;
      dy /= l;
      dz /= l;
      const hw = plumeHalfWidth(i / (n - 1), b.width);
      for (const side of [-1, 1]) {
        const v = (slot * n + i) * 2 + (side + 1) / 2;
        this.pos.setXYZ(v, P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        this.dir.setXYZ(v, dx, dy, dz);
        this.band.setXYZW(v, side, i / (n - 1), hw, slot);
      }
    }
    const seed = b.seed === undefined ? 0 : b.seed;
    this.uniforms.uSlot.value[slot].set(seed, total, b.strength === undefined ? 1 : b.strength, this.slots[slot].fade);
    this.pos.needsUpdate = true;
    this.dir.needsUpdate = true;
    this.band.needsUpdate = true;
  }

  // The mesh is in the scene while there is a band and drawn while one is up.
  _sync() {
    const any = this.slots.some((s) => s.key !== null);
    if (any && !this.mesh.parent) this.scene.add(this.mesh);
    this.mesh.visible = any;
  }

  // Every frame. dt: s (0 where the world stands still); light 0 to 1; fog [r, g, b]; blocks 0 to 1.
  update(dt, ctx = {}) {
    const u = this.uniforms;
    if (ctx.light !== undefined) u.uLight.value = 0.55 + 0.45 * ctx.light;
    if (ctx.fog) u.uFog.value.setRGB(ctx.fog[0], ctx.fog[1], ctx.fog[2]);
    if (ctx.blocks !== undefined) u.uBlock.value = ctx.blocks;
    let n = 0;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.key === null) continue;
      const step = dt / FADE;
      const was = s.fade;
      s.fade = s.fade < s.target ? Math.min(s.target, s.fade + step) : Math.max(s.target, s.fade - step);
      // (Where the world stands still a band that is coming is there at once.)
      if (dt === 0) s.fade = s.target;
      if (s.fade !== was || dt === 0) u.uSlot.value[i].w = s.fade * s.fade * (3 - 2 * s.fade);
      if (s.fade <= 0 && s.target === 0) s.key = null;
      else n++;
    }
    this.count = n;
    if (n === 0 && this.mesh.visible) this.mesh.visible = false;
    else if (n > 0) this.mesh.visible = true;
  }

  meshes() {
    return [this.mesh];
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
