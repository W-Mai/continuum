// Rivers, lakes and the sea: one water surface at the worlds' water level,
// centred on the camera and dense near it, nine kilometres across.
//
// It shows only where a world has water, decided per pixel from the same
// world palette the terrain reads (render/worldlook.js), and fades in across a
// border at the threshold the road uses to keep clear of it
// (world/worlds.js). Waves are scrolling normal maps; the reflections are the
// sky's own environment map, so the water darkens and brightens with the world
// above it.
//
// The real style (and the styles that read its frame) has a program of its
// own (render/waterlook.js): it reads the frame as it stands behind the water
// (render/waterback.js), which gives how deep the water is at each point (its
// colour, how much of the bed shows through, foam where it is shallow) and,
// on the high tier, what stands round it to reflect; a river's ripples go down
// its channel (the palette's flow column, the land's flowAt) and the surface
// near the lens rises and falls in four swells (the wave column). The
// painted, cel, print and block programs carry none of it.

import * as THREE from 'three';
import { withAtmosphere, skyBandsU, compileObjects, warmHooks } from './atmosphere.js';
import { twistU, twistLine, FOLD_NEED } from './twist.js';
import { worldUniforms, WORLD_GLSL, PAL } from './worldlook.js';
import { styleU, pairProgram } from './style.js';
import { WaterBack } from './waterback.js';
import { REAL, realChunks, swellPhases } from './waterlook.js';

// The painted style's lava (in the worlds lit by night): molten rock in two
// colours, as they come out on the screen (linear), with a hard edge between
// them, and the crust, darker, beyond the second. The colours are laid by the
// height the surface is worked out from (the crust's own, in the water's
// shader): the core under coreTo, the rim under rimTo, the crust above. Far
// off the fine layer of that height is left out (from far[0] to far[1] metres:
// its cracks are a pixel or two across, and the edges of them shimmer), and the
// height is raised a little (farAdd), so that a distant river is more crust.
const LAVA = { core: [1.6, 1.1, 0.3], rim: [0.9, 0.25, 0.05], coreTo: 0.48, rimTo: 0.56, far: [60, 250], farAdd: 0.08 };

// (Where the water's shader works out its lava: in the painted style's program only.)
const LAVA_PAINTED = `
if (uPair * lava > 0.0) {
  float lavaFar = smoothstep(${LAVA.far[0].toFixed(1)}, ${LAVA.far[1].toFixed(1)}, wDist);
  float n = mix(w3.z * 0.55 + w1.z * 0.25 + w4.z * 0.2, (w3.z * 0.55 + w4.z * 0.2) * 1.3333, lavaFar) + ${LAVA.farAdd.toFixed(2)} * lavaFar;
  float e = fwidth(n) * 1.2 + 0.004;
  float inRim = 1.0 - smoothstep(${LAVA.rimTo.toFixed(2)} - e, ${LAVA.rimTo.toFixed(2)} + e, n);
  float inCore = 1.0 - smoothstep(${LAVA.coreTo.toFixed(2)} - e, ${LAVA.coreTo.toFixed(2)} + e, n);
  vec3 molten = mix(vec3(${LAVA.rim.map((x) => x.toFixed(3)).join(', ')}), vec3(${LAVA.core.map((x) => x.toFixed(3)).join(', ')}), inCore);
  diffuseColor.rgb = mix(diffuseColor.rgb, deep * (1.0 - inRim), uPair * lava);
  tLiquidGlow = mix(tLiquidGlow, molten * inRim * uPaintInv, uPair * lava);
}`;

// The painted style's seas in the worlds lit by night. Seen from under it (the
// deep), the surface is the sky: its three bands, laid by how high the surface
// is seen as the sky's are (render/atmosphere.js, uPaintShape), and the light
// that comes down through it as flat patches, one colour, where a broad noise
// of the surface (the swell's) is over `at`, an edge a pixel wide, thinning
// out to the horizon. Seen from above (the cloud sea of space), it is three
// flat colours by the height of its tops: the hollows, the middle and the lit
// tops, each as it comes out on the screen (linear), and nothing of the sun's
// light in them.
const SEA = {
  patch: { at: 0.60, col: [0.30, 0.70, 0.68], from: 0.05, to: 0.22 },
  cloud: { lo: 0.47, hi: 0.59, deep: [0.12, 0.14, 0.36], mid: [0.30, 0.36, 0.66], lit: [0.62, 0.70, 0.92] },
};
const v3 = (a) => `vec3(${a.map((x) => x.toFixed(3)).join(', ')})`;

// (Where the water's shader works out its painted night's seas: in the painted
// style's program only.)
// (Which side the surface is seen from is the lens's height against it: a transparent material
// drawn on both sides is drawn in two passes, each with the side it draws as the front, so
// gl_FrontFacing is the same in both.)
const NIGHT_SEA = `
if (uPair * uDuskDark.w > 0.0) {
  float night = uPair * uDuskDark.w;
  if (camW.y < vWPos.y && lava < 0.01) {
    vec3 vd = normalize(vWPos - camW);
    float hh = clamp(vd.y, 0.0, 1.0);
    vec3 bands = mix(uPaintH, uPaintM, smoothstep(uPaintShape.y - uPaintShape.w, uPaintShape.y + uPaintShape.w, hh));
    bands = mix(bands, uPaintZ, smoothstep(uPaintShape.z - uPaintShape.w, uPaintShape.z + uPaintShape.w, hh));
    float swell = w3.z * 0.6 + w4.z * 0.4;
    float pe = fwidth(swell) * 1.2 + 0.004;
    float spot = smoothstep(${SEA.patch.at.toFixed(3)} - pe, ${SEA.patch.at.toFixed(3)} + pe, swell) * smoothstep(${SEA.patch.from.toFixed(2)}, ${SEA.patch.to.toFixed(2)}, hh);
    tSeaCol = mix(bands, ${v3(SEA.patch.col)}, spot) * uPaintInv;
    tSeaPaint = night;
  } else if (cloud > 0.0) {
    float ct = w3.z * 0.2 + w4.z * 0.5 + w5.z * 0.3;
    float ce = fwidth(ct) * 1.2 + 0.003;
    float up = smoothstep(${SEA.cloud.hi.toFixed(2)} - ce, ${SEA.cloud.hi.toFixed(2)} + ce, ct);
    float down = 1.0 - smoothstep(${SEA.cloud.lo.toFixed(2)} - ce, ${SEA.cloud.lo.toFixed(2)} + ce, ct);
    vec3 cc = mix(mix(${v3(SEA.cloud.mid)}, ${v3(SEA.cloud.lit)}, up), ${v3(SEA.cloud.deep)}, down);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.0), night * cloud);
    tLiquidGlow = mix(tLiquidGlow, cc * uPaintInv, night * cloud);
  }
}`;

// The block style's liquids (render/style.js, block): flat, and laid in cells,
// each a colour of its own. Water: cells a metre across, each in a loop of four
// colours, light or dark, that it steps through four times a second (twice, at
// the middle tier; the low tier's stand still), every cell a part of the way
// round the loop from the next by where it is. Lava: cells a metre across too,
// dark, glowing or bright by a noise over the cells that is carried slowly over
// them, so that the bright ones drift. A sea of cloud: white cells three metres
// across at two heights, the high ones whiter. Far off the cells are too small
// to change from one to the next and settle on the middle colour (calm).
const BLOCK_PARS = `
uniform vec2 uBlockLiq;
float bHash(ivec2 c, uint salt) {
  uint h = uint(c.x) * 374761393u + uint(c.y) * 668265263u + salt * 2246822519u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h ^= h >> 16u;
  return float(h & 0xffffffu) / 16777216.0;
}
float bNoise(vec2 p, uint salt) {
  vec2 i = floor(p);
  vec2 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  return mix(mix(bHash(c, salt), bHash(c + ivec2(1, 0), salt), f.x), mix(bHash(c + ivec2(0, 1), salt), bHash(c + ivec2(1, 1), salt), f.x), f.y);
}`;
const BLOCK_LIQUID = `
if (uBlockLiq.x > 0.0) {
  float bk = uBlockLiq.x;
  float bt = uBlockLiq.y;
  float calm = 1.0 - smoothstep(80.0, 260.0, wDist);
  float rate = bt > 0.75 ? 4.0 : (bt > 0.25 ? 2.0 : 0.0);
  tWaterN = normalize(mix(tWaterN, vec3(0.0, 1.0, 0.0), bk));
  if (cloud < 0.5 && lava < 0.5) {
    ivec2 wc = ivec2(floor(vWPos.xz));
    float tick = floor(uTime * rate + bHash(wc, 1u) * 4.0);
    float lit = step(0.5, bHash(wc, 11u + uint(mod(tick, 4.0))));
    vec3 cell = mix(deep, shallow, mix(0.6, 0.35 + 0.45 * lit, calm));
    diffuseColor.rgb = mix(diffuseColor.rgb, cell, bk * (1.0 - max(cloud, lava)));
  } else if (lava >= 0.5) {
    ivec2 lc = ivec2(floor(vWPos.xz));
    float v = bNoise(vec2(lc) * 0.27 + vec2(uTime * 0.09, uTime * 0.05) * step(0.25, bt), 3u) + (bHash(lc, 4u) - 0.5) * 0.16;
    float glowK = mix(0.8, v > 0.62 ? 1.7 : (v > 0.42 ? 0.8 : 0.12), calm);
    diffuseColor.rgb = mix(diffuseColor.rgb, deep * 0.9, bk * lava);
    tLiquidGlow = mix(tLiquidGlow, shallow * liq.x * glowK, bk * lava);
  } else {
    ivec2 cc = ivec2(floor(vWPos.xz / 3.0));
    float hi = step(0.55, bNoise(vec2(cc) * 0.33, 5u) + (bHash(cc, 6u) - 0.5) * 0.2);
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(deep, shallow, mix(0.3, 0.95, hi)), bk * cloud);
    tLiquidGlow = mix(tLiquidGlow, shallow * liq.x * mix(0.35, 1.0, hi), bk * cloud);
  }
}`;

const RADIUS = 9000;
const RINGS = 56;
const SEGMENTS = 128;
// While the world is wound over (render/twist.js) the sea is wound with the
// land, each corner of its disc by where it stands, and a triangle is drawn
// flat from corner to corner: the disc is then one of finer triangles
// (within some 100 m across where the fold is, against 300), so that the
// sea keeps to the land's own curve and its shore to the shore, and it is
// held on the middle of the wound stretch, where it is finest, and made
// WOUND_SCALE times as wide, to reach as far from the lens as the lens sees.
// And it is drawn from above only: the fold shows a great deal of the sea
// from underneath, where there is nothing of it to see, and the whole of
// the water's shader was worked at every pixel of that. (No lens is under a
// sea while anything is wound: the worlds either side of the Upside Down
// have none to be under.)
const WOUND_RINGS = 150;
const WOUND_SEGMENTS = 256;
const WOUND_SCALE = 1.8;
// A world's water shows where its share of the blend is over 0.35 (the
// fragment shader); under this at a corner there is none near it.
const DRY = 0.2;

function discGeometry(rings, segments) {
  const pos = [0, 0, 0];
  const idx = [];
  for (let r = 1; r <= rings; r++) {
    const rad = RADIUS * Math.pow(r / rings, 2.3);
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      pos.push(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    }
  }
  const ring = (r, s) => 1 + (r - 1) * segments + (s % segments);
  for (let s = 0; s < segments; s++) idx.push(0, ring(1, s + 1), ring(1, s));
  for (let r = 1; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      idx.push(ring(r, s), ring(r, s + 1), ring(r + 1, s + 1));
      idx.push(ring(r, s), ring(r + 1, s + 1), ring(r + 1, s));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

// The disc the real style draws where a world with real water is in reach: its rings are 1.6 m apart at the middle and 5.1 m
// at NEAR_FINE metres from it (where the surface is moved by the swells, and the sea's colour is the depth's), and past that
// they are the sea's own.
export const NEAR_FINE = 90;
export const NEAR_SEGMENTS = 128;

export function nearDiscGeometry() {
  const radii = [];
  let r = 0;
  while (r < NEAR_FINE) {
    r += 1.6 + 0.04 * r;
    radii.push(r);
  }
  const first = radii[radii.length - 1] + 4;
  for (let k = 1; k <= RINGS; k++) {
    const rad = RADIUS * Math.pow(k / RINGS, 2.3);
    if (rad > first) radii.push(rad);
  }
  const pos = [0, 0, 0];
  const idx = [];
  for (const rad of radii) {
    for (let s = 0; s < NEAR_SEGMENTS; s++) {
      const a = (s / NEAR_SEGMENTS) * Math.PI * 2;
      pos.push(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    }
  }
  const ring = (k, s) => 1 + k * NEAR_SEGMENTS + (s % NEAR_SEGMENTS);
  for (let s = 0; s < NEAR_SEGMENTS; s++) idx.push(0, ring(0, s + 1), ring(0, s));
  for (let k = 0; k < radii.length - 1; k++) {
    for (let s = 0; s < NEAR_SEGMENTS; s++) {
      idx.push(ring(k, s), ring(k, s + 1), ring(k + 1, s + 1));
      idx.push(ring(k, s), ring(k + 1, s + 1), ring(k + 1, s));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

// In-place radix-2 FFT of n complex values held in two arrays, n a power of two.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const wr = Math.cos((2 * Math.PI) / len);
    const wi = Math.sin((2 * Math.PI) / len);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

// Tileable wave heights as a normal map, with the heights themselves in blue.
// They are made as a spectrum and turned back into space, so they have no
// lattice: value noise lines its slopes up along its cells, and seen edge-on
// from high over the cloud the lines read as a grid.
function waveTexture() {
  const N = 256;
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const unit = (v) => Math.min(1, Math.max(0, v));
  // Wavelengths from a quarter of the tile down to a few pixels, amplitude
  // falling as 1/k², so every octave carries the same share of the slope.
  const re = new Float64Array(N * N);
  const im = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    const ky = y < N / 2 ? y : y - N;
    for (let x = 0; x < N; x++) {
      const kx = x < N / 2 ? x : x - N;
      const k = Math.hypot(kx, ky);
      const a = k < 1 ? 0 : (unit((k - 2.4) / 1.6) * unit((56 - k) / 16.8)) / (k * k);
      re[y * N + x] = gauss() * a;
      im[y * N + x] = gauss() * a;
    }
  }
  const lr = new Float64Array(N);
  const li = new Float64Array(N);
  for (const across of [true, false]) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const at = across ? j * N + i : i * N + j;
        lr[i] = re[at];
        li[i] = im[at];
      }
      fft(lr, li);
      for (let i = 0; i < N; i++) {
        const at = across ? j * N + i : i * N + j;
        re[at] = lr[i];
        im[at] = li[i];
      }
    }
  }
  const h = re;
  const at = (x, y) => h[((y + N) % N) * N + ((x + N) % N)];
  let mean = 0;
  for (const v of h) mean += v;
  mean /= N * N;
  let spread = 0;
  let slope = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      spread += (at(x, y) - mean) ** 2;
      slope += (at(x + 1, y) - at(x - 1, y)) ** 2;
    }
  }
  spread = Math.sqrt(spread / (N * N));
  // The slope and the spread of heights the value noise had, so water, lava
  // and cloud keep their look.
  const gain = 14.2 / Math.sqrt(slope / (N * N));
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const k = (y * N + x) * 4;
      data[k] = Math.max(0, Math.min(255, 128 - (at(x + 1, y) - at(x - 1, y)) * gain));
      data[k + 1] = Math.max(0, Math.min(255, 128 - (at(x, y + 1) - at(x, y - 1)) * gain));
      data[k + 2] = Math.round(255 * unit(0.53 + (0.19 * (at(x, y) - mean)) / spread));
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// The two fine wave trains, at 37 m and 13 m, fade out of the slope from 120 m to 900 m, and are
// not in it where the sea is wholly cloud (the slope is then the swell). Where the world is wound
// over (FOLD_ALPHA) they are not read where they are not in it; the lava's crust reads the first
// wherever it is.
const FINE = { from: 120, to: 900 };

// How often it is asked whether any world in the disc's reach has a sea.
const DRY_EVERY = 0.5;       // s
const hasSea = (world) => world.params.water !== null && world.params.water !== undefined;

// Whether a world has water the real style draws as water (its swell is over nothing: world/worlds.js, liquid.wave).
const hasRealSea = (world) => !!(world.liquid && world.liquid.wave > 0);

export class Water {
  // worlds: the map of the worlds (world/worlds.js), for where there is a sea.
  // opts: post, the chain that draws the scene (render/post.js), for the target its frame is in;
  // renderer, to build the programs that take the frame ahead of the first time it is wanted;
  // terrain, the land's tiles, for where the water may be in view; land, the land of the worlds, for the way a river runs; tier.
  constructor(scene, level = 0, worlds = null, opts = {}) {
    this.level = level;
    this.worlds = worlds;
    this.chain = opts.post || null;
    this.renderer = opts.renderer || null;
    this.terrain = opts.terrain || null;
    this.land = opts.land || null;
    this.tier = opts.tier || 'high';
    this._dry = 0;
    this.uniforms = {
      uWave: { value: waveTexture() },
      uTime: { value: 0 },
      uOffset: { value: new THREE.Vector2() },
      // 1: no world in the disc's reach has a sea, and none of it is drawn.
      uSeaDry: { value: 0 },
      // The real style's water (waterlook.js): how much of it there is (it comes in over half a second), the frame as it stands behind the
      // water (waterback.js: the colour and the distances; their size, whether the reflection of the frame is read, whether the depth is),
      // the lens's projection, the way the swells have gone round, and how far the pattern of a river has been carried.
      uRealK: { value: 0 },
      tBackColor: { value: null },
      tBackDist: { value: null },
      uBack: { value: new THREE.Vector4(1, 1, 0, 0) },
      uFull: { value: new THREE.Vector2(1, 1) },
      uProj: { value: new THREE.Matrix4() },
      uSwellPh: { value: new THREE.Vector4() },
      uFlowA: { value: new THREE.Vector4() },
      uFlowB: { value: new THREE.Vector2() },
    };
    // The real style's water: drawn so while the program is the real one (a style that is not painted and not blocks, and not
    // wound): its program has the code of it in it, the others have none; its frame is taken when the water is drawn.
    this.real = false;
    this.near = false;       // a world with real water is in reach
    this.close = false;      // and the land under the water is within the swells' reach of the lens: the disc is the finer one
    this._cells = [];        // the cells of the land that lie under the water near the lens, as [x, z, radius] (scene metres)
    this._frustum = new THREE.Frustum();
    this._pv = new THREE.Matrix4();
    this._inv = new THREE.Matrix4();
    this._sphere = new THREE.Sphere();
    this.off = false;        // kept off from outside (the checks)
    this.ssrOff = false;     // the reflection of the frame held off, the rest of the real water kept (the checks)
    this.back = new WaterBack();
    this.time = 0;           // the water's own clock, s
    this.flowDir = { x: 1, z: 0 };
    this._flow = [0, 0, 0, 0, 0, 0];
    this._flowSeen = 0;
    this._flowRaw = { x: 1, z: 0 };
    this._realK = 0;
    this._lens = new THREE.Vector3();
    this._cellsAt = { x: 1e9, z: 1e9 };
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.1, metalness: 0, transparent: true, depthWrite: true,
      side: THREE.DoubleSide,
    });
    // What a winding lifts into the sky is drawn thinner, not hazed (the
    // haze, render/atmosphere.js: FOLD_ALPHA, defined while anything is
    // wound, update).
    const uniforms = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      const paintOn = pairProgram.on;
      // The real style's water: the program with the code of it in it (waterlook.js), where the style is neither painted nor of blocks.
      const real = !paintOn && this.real;
      const { REAL_VERTEX_PARS, REAL_VERTEX, REAL_PARS, REAL_LINES, REAL_RIPPLE_FETCH, REAL_SWELL, REAL_BODY, REAL_LIGHT, REAL_OPAQUE } = real ? realChunks(FINE) : {};
      Object.assign(shader.uniforms, uniforms, worldUniforms, { uPair: styleU.uPair, uPaintInv: styleU.uPaintInv, uDuskDark: styleU.uDuskDark, uFlatLand: styleU.uFlatLand, uBlockLiq: styleU.uBlockLiq }, skyBandsU);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform vec2 uOffset;
uniform float uSeaDry;
varying vec3 vWPos;
${WORLD_GLSL}${real ? REAL_VERTEX_PARS : ''}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>${real ? REAL_VERTEX : ''}
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz + vec3(uOffset.x, 0.0, uOffset.y);`)
        // No sea where no world has one. The disc is drawn all round the
        // lens, and the pixels of it over a dry world are thrown away one
        // by one, each after the worth of a pixel's work: where the land
        // hides them that is little, but it is not nothing, and wound over
        // (render/twist.js) the dry side of the disc hangs across the whole
        // sky. So with no world that has a sea anywhere in the disc's reach
        // (uSeaDry, update) every corner of it is put past the far plane,
        // and none of it is drawn; and while the world is wound over, each
        // corner that stands in a dry world is (a triangle of three such is
        // not drawn; one with a wet corner is, all of it that shows).
        .replace('#include <fog_vertex>', `#include <fog_vertex>
if (uSeaDry > 0.5) {
  gl_Position.z = 2.0 * gl_Position.w;
} else if (uTwist.x > 0.5) {
  worldAt(vWPos.xz);
  if (worldWet() < ${DRY.toFixed(2)}) gl_Position.z = 2.0 * gl_Position.w;
}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D uWave;
uniform float uTime;
uniform vec2 uOffset;${paintOn ? '\nuniform float uPair;\nuniform float uFlatLand;\nuniform float uPaintInv;\nuniform vec4 uDuskDark;\nuniform vec3 uPaintZ;\nuniform vec3 uPaintM;\nuniform vec3 uPaintH;\nuniform vec4 uPaintShape;' : ''}
varying vec3 vWPos;
${WORLD_GLSL}
${FOLD_NEED}
${paintOn || real ? '' : BLOCK_PARS}
vec3 tWaterN;
vec3 tLiquidGlow;
float tLiquidRough;${paintOn ? '\nvec3 tSeaCol;\nfloat tSeaPaint;' : ''}${real ? REAL_PARS : ''}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
worldAt(vWPos.xz);
float wShow = smoothstep(0.35, 0.65, worldWet());
if (wShow < 0.01) discard;
vec4 liq = worldPar(2);     // glow, roughness, opacity, cloud
float lava = worldPar(3).x;
float cloud = liq.w;${real ? '\nvec4 wr = waterPar();     // flow, swell height, ripples' : ''}
vec3 camW = cameraPosition + vec3(uOffset.x, 0.0, uOffset.y);
float wDist = length(vWPos - camW);
// Water: two wave trains crossing, finer close up, flattened with distance,
// where they would only shimmer. Lava creeps and cloud drifts, both slowly,
// in broad swells.
vec2 q = vWPos.xz;
float speed = mix(1.0, 0.12, max(lava, cloud))${real ? REAL_LINES.speed : ''};
// The broad layers are turned against each other, so the repeats of the
// texture never line up into a grid, which from high over the cloud they would.
const mat2 R1 = mat2(0.8, 0.6, -0.6, 0.8);
const mat2 R2 = mat2(0.92, -0.39, 0.39, 0.92);
vec2 uvW1 = q / 37.0 + vec2(uTime * 0.012, uTime * 0.007) * speed${real ? REAL_LINES.uv1 : ''};
vec2 uvW2 = q / 13.0 + vec2(-uTime * 0.017, uTime * 0.021) * speed${real ? REAL_LINES.uv2 : ''};
bool fineOn = max(cloud, lava * 0.6) < 1.0;
vec4 w1 = vec4(0.5);
vec4 w2 = vec4(0.5);
if (NEED(fineOn && wDist < ${FINE.to.toFixed(1)})) w2 = texture2D(uWave, uvW2);
if (NEED(fineOn && (wDist < ${FINE.to.toFixed(1)} || lava > 0.0))) w1 = texture2D(uWave, uvW1);
vec4 w3 = texture2D(uWave, R1 * q / 230.0 + vec2(uTime * 0.003, -uTime * 0.002) * speed);
vec4 w4 = texture2D(uWave, R2 * q / 900.0 + vec2(uTime * 0.0012, uTime * 0.0007));
vec4 w5 = texture2D(uWave, R2 * R2 * q / 3700.0 + vec2(-uTime * 0.0004, uTime * 0.0003));${real ? REAL_RIPPLE_FETCH : ''}
vec2 fine = ${real ? '(' : ''}(w1.xy - 0.5) * 0.9 + (w2.xy - 0.5) * 0.55${real ? REAL_LINES.fine : ''};
vec2 slope = fine * (1.0 - smoothstep(${FINE.from.toFixed(1)}, ${FINE.to.toFixed(1)}, wDist)) + (w3.xy - 0.5) * 0.5;
vec2 swell = (w3.xy - 0.5) * 1.4 + (w4.xy - 0.5) * 1.1;
slope = mix(slope, swell, max(cloud, lava * 0.6));${real ? REAL_SWELL : ''}
tWaterN = normalize(vec3(-slope.x, 1.0, -slope.y));${paintOn ? '\n// A sea of flat paints (uFlatLand) is flat: no waves to light.\nif (uFlatLand > 0.0) tWaterN = vec3(0.0, 1.0, 0.0);' : ''}
vec3 deep = worldPal(${PAL.waterDeep});
vec3 shallow = worldPal(${PAL.waterShallow});
vec3 viewDir = normalize(camW - vWPos);
float down = clamp(viewDir.y, 0.0, 1.0);
vec3 waterCol = mix(deep, shallow, pow(down, 1.5) * 0.8);
// Cloud: bright tops, shadowed hollows. Lava: a dark crust broken by molten
// cracks that glow.
float tops = w3.z * 0.45 + w4.z * 0.33 + w5.z * 0.22;${paintOn ? '\n// A cloud sea of flat paints (uFlatLand) is two tones, the tops and the hollows, the edge between them a pixel wide.\nif (uFlatLand > 0.0) {\n  float topsW = max(fwidth(tops), 1e-4);\n  tops = mix(tops, smoothstep(0.5 - topsW, 0.5 + topsW, tops), uFlatLand);\n}' : ''}
vec3 cloudCol = mix(deep, shallow, smoothstep(0.25, 0.75, tops));
float crust = smoothstep(0.38, 0.6, w3.z * 0.55 + w1.z * 0.25 + w4.z * 0.2);
vec3 lavaCol = mix(shallow * 0.6, deep, crust);
diffuseColor.rgb = mix(mix(waterCol, cloudCol, cloud), lavaCol, lava);${paintOn ? '\n// ...in two colours: the water a little way off and farther off, a step where it is looked down on from over 11 degrees.\nif (uFlatLand > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, mix(deep, shallow, 0.5 + 0.35 * step(0.19, down)), uFlatLand * (1.0 - max(cloud, lava)));' : ''}
tLiquidGlow = shallow * liq.x * mix(1.0, (1.0 - crust) * 1.6 + 0.05, lava) * mix(1.0, 0.5 + 0.5 * tops, cloud);${paintOn ? '\ntSeaCol = vec3(0.0);\ntSeaPaint = 0.0;' + LAVA_PAINTED + NIGHT_SEA : real ? '' : BLOCK_LIQUID}
// Seen from below (the deep sea), the surface is the brightest thing there is.
if (!gl_FrontFacing) tLiquidGlow += shallow * 1.4;
tLiquidRough = liq.y;
diffuseColor.a = wShow * clamp(mix(liq.z + 0.06, liq.z - 0.05, down) + max(lava, cloud), 0.0, 1.0);${real ? REAL_BODY : ''}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = tLiquidRough;${paintOn ? '\nif (uFlatLand > 0.0) roughnessFactor = 1.0;' : real ? '' : '\nroughnessFactor = mix(roughnessFactor, 0.5, uBlockLiq.x);'}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += tLiquidGlow;`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize((viewMatrix * vec4(tWaterN, 0.0)).xyz);`)
        // Where it is the sky (the sea from under it, in a painted night) it is what it is
        // drawn as, the haze and the light left out.
        .replace('#include <fog_fragment>', paintOn ? `#include <fog_fragment>
gl_FragColor = vec4(mix(gl_FragColor.rgb, tSeaCol, tSeaPaint), mix(gl_FragColor.a, 1.0, tSeaPaint));` : '#include <fog_fragment>');
      // The real style's water: the reflection of the frame stands for the sky's, and the colour of the water is made so that the
      // reflection is not thinned by how much of the bed is seen through it.
      if (real) {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <lights_fragment_end>', `${REAL_LIGHT}#include <lights_fragment_end>`)
          .replace('#include <opaque_fragment>', `#include <opaque_fragment>\n${REAL_OPAQUE}`);
      }
    };
    mat.customProgramCacheKey = () => 'continuum-water' + (pairProgram.on ? '-painted' : this.real ? `-real${this._made || ''}` : '');
    // Drawn blended, so it has no mark in the alpha (render/style.js's MARK):
    // one would change how it blends.
    this.material = withAtmosphere(mat);
    this.flat = discGeometry(RINGS, SEGMENTS);
    this.fine = null;
    this.nearDisc = null;    // the finer disc of the real style (made when it is first wanted)
    this.wound = false;
    this.mesh = new THREE.Mesh(this.flat, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.receiveShadow = true;
    // The frame is taken as the water is about to be drawn (see _beforeDraw).
    this.mesh.onBeforeRender = (renderer, scene, camera) => this._beforeDraw(renderer, camera);
    scene.add(this.mesh);
    // The program changes with the style: where the paired paints come or go, so does the real water's (its code is in or out).
    pairProgram.listeners.push(this._onPair = () => this._sync());
    warmHooks.push(this._warm = (renderer, sc, camera) => this.warm(renderer, sc, camera));
    this._sync();
  }

  setOrigin(x, z) {
    this.uniforms.uOffset.value.set(x, z);
  }

  // How much there is to draw (high, mid, low): the real style's water takes the frame's colour for the reflection in the first,
  // and the distances for its depth (the colour of the water over the bed, the shallows' foam) in the first two.
  setTier(tier) {
    this.tier = tier;
  }

  // Whether the program is the real water's: in the styles that are neither painted nor of blocks, and not while the world is wound
  // over. Its code is in the program (waterlook.js), so a change of it is a change of program; the programs both are kept by three.
  _wantReal() {
    return !this.wound && !this.off && !pairProgram.on && !(styleU.uBlockLiq.value.x > 0);
  }

  // The program of the real water made again, from the numbers (waterlook.js, REAL) as they are now: a tool that moves one.
  remake() {
    this._made = (this._made || 0) + 1;
    this.material.needsUpdate = true;
  }

  // Kept off from outside, or let back (the checks that set the real water against the sea as it was).
  setReal(on) {
    this.off = !on;
    this._sync();
  }

  _sync() {
    const real = this._wantReal();
    if (real === this.real) return;
    this.real = real;
    this._dry = 0;
    this._realK = 0;
    if (!real) this.uniforms.uRealK.value = 0;
    this.material.needsUpdate = true;
  }

  // Built ahead (render/atmosphere.js, warmHooks; called with the programs of the paired paints the ones that are not drawn with):
  // the water's two programs that are not of the paired paints, the real water's and the plain one the block style has, whichever of
  // all three the style drawn is the program of; so that a change of style finds them.
  warm(renderer, scene, camera) {
    const was = { on: pairProgram.on, real: this.real };
    pairProgram.on = false;
    try {
      for (const real of [false, true]) {
        this.real = real;
        this.material.needsUpdate = true;
        compileObjects(renderer, scene, camera, [this.mesh]);
      }
    } finally {
      pairProgram.on = was.on;
      this.real = was.real;
      this.material.needsUpdate = true;
    }
  }

  // Everything the sea holds on the GPU, and its place in the scene.
  dispose() {
    const k = pairProgram.listeners.indexOf(this._onPair);
    if (k >= 0) pairProgram.listeners.splice(k, 1);
    const w = warmHooks.indexOf(this._warm);
    if (w >= 0) warmHooks.splice(w, 1);
    this.mesh.onBeforeRender = () => {};
    this.mesh.removeFromParent();
    this.flat.dispose();
    if (this.fine) this.fine.dispose();
    if (this.nearDisc) this.nearDisc.dispose();
    this.back.dispose();
    this.material.dispose();
    this.uniforms.uWave.value.dispose();
  }

  // The frame as it stands now is what the water reads of what is behind it: taken here, between what is drawn before the water and
  // the water itself (the mesh's own hook, three calls it as the mesh is about to be drawn), for the target the chain draws the scene
  // into, and only where the water is the real water and a world that has some is in reach.
  _beforeDraw(renderer, camera) {
    const b = this.uniforms.uBack.value;
    b.z = 0;
    b.w = 0;
    if (!this.real || !this.near || this.uniforms.uSeaDry.value > 0.5 || this.tier === 'low') return;
    const target = renderer.getRenderTarget();
    const c = this.chain && this.chain.composer;
    if (!target || !target.depthTexture || !c || (target !== c.renderTarget1 && target !== c.renderTarget2)) return;
    // Only where some water may be in view: a lens turned from it, or a world that has none in sight, takes nothing.
    if (!this._wetInView(camera)) return;
    const high = this.tier === 'high' && !this.ssrOff;
    this.back.take(renderer, target, camera, high);
    const u = this.uniforms;
    const [hw, hh] = WaterBack.half(target.width, target.height);
    u.tBackDist.value = this.back.dist.texture;
    u.tBackColor.value = this.back.colour.texture;
    u.uFull.value.set(target.width, target.height);
    u.uProj.value.copy(camera.projectionMatrix);
    b.set(hw, hh, high && !this.ssrOff ? 1 : 0, 1);
  }

  // The animation: the water's own clock, the swells' phases, the way a river is carried.
  save() {
    return { time: this.time, flow: this._flow.slice(), flowDir: { ...this.flowDir }, seen: this._flowSeen };
  }

  restore(state) {
    if (!state) return;
    this.time = state.time;
    this._flow = state.flow.slice();
    this.flowDir = { ...state.flowDir };
    this._flowSeen = state.seen;
    this._pose();
  }

  _pose() {
    const u = this.uniforms;
    swellPhases(this.time, this._phases || (this._phases = []));
    u.uSwellPh.value.set(this._phases[0], this._phases[1], this._phases[2], this._phases[3]);
    const f = this._flow;
    u.uFlowA.value.set(f[0], f[1], f[2], f[3]);
    u.uFlowB.value.set(f[4], f[5]);
  }

  // Centred under the camera, stepped so the rings do not crawl over the
  // waves; while the world is wound over, held on the wound stretch.
  update(dt, camera) {
    this.uniforms.uTime.value += dt;
    this.time += dt;
    const mesh = this.mesh;
    const wound = twistU.uTwist.value[0] > 0.5;
    const turned = wound !== this.wound;
    if (turned) {
      this.wound = wound;
      this.material.side = wound ? THREE.FrontSide : THREE.DoubleSide;
      // Its shader for a wound world is another (the haze): anywhere else
      // it is the one it always was. three keeps both once they are built.
      if (wound) this.material.defines.FOLD_ALPHA = '';
      else delete this.material.defines.FOLD_ALPHA;
      this.material.needsUpdate = true;
      // The disc not drawn is not kept on the GPU: it is given again when
      // it is next wanted.
      const idle = wound ? this.flat : this.fine;
      if (idle) idle.dispose();
    }
    this._sync();
    // Whether any world the disc reaches has a sea, and whether one that has real water is near the lens: now and then, and when
    // the disc is put somewhere else.
    this._dry -= dt;
    const o = this.uniforms.uOffset.value;
    if (this.worlds && (this._dry <= 0 || turned)) {
      this._dry = DRY_EVERY;
      // A disc under the lens is as far on by the next time this is asked.
      const reach = RADIUS * mesh.scale.x + 400;
      this.uniforms.uSeaDry.value = this.worlds.reaches(mesh.position.x + o.x, mesh.position.z + o.y, reach, hasSea) ? 0 : 1;
      this.near = this.real && !wound && this.uniforms.uSeaDry.value < 0.5
        && this.worlds.reaches(camera.position.x + o.x, camera.position.z + o.y, REAL.near, hasRealSea);
      // The programs that take the frame are built as a world with real water comes in reach, not before: kilometres before it is seen.
      if (this.near && this.renderer && this.tier !== 'low') this.back.warm(this.renderer);
      this._cellsAt.x = 1e9;
    }
    // Where the land lies under the water near the lens (a stretch of land is looked at again when the lens has gone 40 m).
    if (this.near && this.terrain && Math.hypot(camera.position.x - this._cellsAt.x, camera.position.z - this._cellsAt.z) > 40) {
      this._cellsAt.x = camera.position.x;
      this._cellsAt.z = camera.position.z;
      this._wetCells(camera);
    } else if (!this.near && this._cells.length) {
      this._cells.length = 0;
    }
    this.close = this.near && this._wetWithin(camera, REAL.swellFade[1] + 100);
    if (wound) {
      const l = twistLine;
      if (!this.fine) this.fine = discGeometry(WOUND_RINGS, WOUND_SEGMENTS);
      mesh.geometry = this.fine;
      mesh.position.set(l.x + l.dx * l.len / 2, this.level, l.z + l.dz * l.len / 2);
      mesh.scale.setScalar(WOUND_SCALE);
    } else {
      // Near a world with real water the disc is the finer one.
      if (this.close && !this.nearDisc) this.nearDisc = nearDiscGeometry();
      mesh.geometry = this.close ? this.nearDisc : this.flat;
      mesh.scale.setScalar(1);
      const step = 32;
      mesh.position.set(Math.round(camera.position.x / step) * step, this.level,
        Math.round(camera.position.z / step) * step);
    }
    // The real water's own state: how much of it there is, the way a river runs and how far it has carried the pattern of the water.
    const u = this.uniforms;
    // (It comes in by the frames of a page that is still too, the photo mode's.)
    if (this.real) this._realK = Math.min(1, this._realK + Math.max(dt, 1 / 60) * 2);
    u.uRealK.value = this.real ? this._realK : 0;
    if (this.real && this.land && this.land.flowAt) this._carry(dt, camera);
    this._pose();
  }

  // The cells of the land that lie under the water's level within REAL.view m of the lens, in worlds that have real water: the land's
  // tiles hold the lowest height of each of their cells. A sphere to a cell, as wide as the cell is across.
  _wetCells(camera) {
    const t = this.terrain;
    const out = this._cells;
    out.length = 0;
    const o = this.uniforms.uOffset.value;
    const cx = camera.position.x;
    const cz = camera.position.z;
    for (const k of t.rendered) {
      const mesh = t.tiles.get(k);
      const u = mesh && mesh.userData;
      if (!u || !u.mins || !mesh.geometry.boundingBox) continue;
      if (u.low === undefined) u.low = u.mins.reduce((a, b) => Math.min(a, b), Infinity);
      if (!(u.low < this.level - 0.05)) continue;
      const size = mesh.geometry.boundingBox.max.x;
      const mx = mesh.position.x + size / 2;
      const mz = mesh.position.z + size / 2;
      if (Math.hypot(mx - cx, mz - cz) - size * 0.71 > REAL.view) continue;
      const n = Math.round(Math.sqrt(u.mins.length));
      const cell = size / n;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          if (!(u.mins[j * n + i] < this.level - 0.05)) continue;
          const x = mesh.position.x + (i + 0.5) * cell;
          const z = mesh.position.z + (j + 0.5) * cell;
          if (Math.hypot(x - cx, z - cz) - cell * 0.71 > REAL.view) continue;
          if (this.worlds && !this.worlds.reaches(x + o.x, z + o.y, cell, hasRealSea)) continue;
          out.push([x, z, cell * 0.71 + 3]);
        }
      }
    }
  }

  // Whether any of those cells is within `far` metres of the lens, whichever way it looks.
  _wetWithin(camera, far) {
    const cells = this._cells;
    const cx = camera.position.x;
    const cz = camera.position.z;
    for (let i = 0; i < cells.length; i++) {
      if (Math.hypot(cells[i][0] - cx, cells[i][1] - cz) - cells[i][2] <= far) return true;
    }
    return false;
  }

  // Whether any of those cells is in the lens's view.
  _wetInView(camera) {
    const cells = this._cells;
    if (!cells.length) return false;
    camera.updateMatrixWorld();
    this._pv.multiplyMatrices(camera.projectionMatrix, this._inv.copy(camera.matrixWorld).invert());
    this._frustum.setFromProjectionMatrix(this._pv);
    const sp = this._sphere;
    for (let i = 0; i < cells.length; i++) {
      sp.center.set(cells[i][0], this.level, cells[i][1]);
      sp.radius = cells[i][2];
      if (this._frustum.intersectsSphere(sp)) return true;
    }
    return false;
  }

  // Where the river runs, as the land has it near the lens (and a way ahead of it), held to over a second or so, and the pattern
  // of the water carried on that way at the speed of each scale of its ripples: how far (in the widths of the texture the scale is
  // read at, kept under 1) it has gone.
  _carry(dt, camera) {
    const land = this.land;
    const o = this.uniforms.uOffset.value;
    this._flowSeen -= dt;
    if (this._flowSeen <= 0) {
      this._flowSeen = 0.1;
      const raw = this._flowRaw;
      const ax = camera.position.x + o.x;
      const az = camera.position.z + o.y;
      camera.getWorldDirection(this._lens);
      const there = land.flowAt(ax, az, { x: 0, z: 0 });
      const ahead = land.flowAt(ax + this._lens.x * REAL.flow.ahead, az + this._lens.z * REAL.flow.ahead, { x: 0, z: 0 });
      const x = there.x + ahead.x;
      const z = there.z + ahead.z;
      const n = Math.hypot(x, z);
      if (n > 1e-6) {
        raw.x = x / n;
        raw.z = z / n;
      }
    }
    const k = 1 - Math.exp(-dt / REAL.flow.hold);
    const d = this.flowDir;
    const x = d.x + (this._flowRaw.x - d.x) * k;
    const z = d.z + (this._flowRaw.z - d.z) * k;
    const n = Math.hypot(x, z) || 1;
    d.x = x / n;
    d.z = z / n;
    const f = this._flow;
    const sizes = [37, 13, REAL.ripple.size];
    for (let i = 0; i < 3; i++) {
      const step = (REAL.flow.speed[i] / sizes[i]) * dt;
      f[i * 2] = (f[i * 2] + d.x * step) % 1;
      f[i * 2 + 1] = (f[i * 2 + 1] + d.z * step) % 1;
    }
  }
}
