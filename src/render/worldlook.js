// The worlds on the GPU, and the sky and light between them.
//
// Every material that changes from one world to the next computes, per pixel,
// which world it is in, from the same axis, the same border warp and the same
// integer hash as world/worlds.js. Their colours come from one small palette
// texture, a row per world. The sky and light are blended on the CPU for the
// camera's position and handed to the atmosphere.

import * as THREE from 'three';
import { WORLDS, WARP_AMP, WARP_SCALE } from '../world/worlds.js';
import { ALPINE_LOOK } from './atmosphere.js';

// Palette texels, in this order, then four of parameters.
export const PAL_COLORS = [
  'grassLow', 'grassHigh', 'rock', 'rockDark', 'scree', 'snow',
  'gravel', 'fill', 'forestFloor', 'canopy', 'sand', 'waterDeep', 'waterShallow',
];
const P0 = PAL_COLORS.length;          // snowLine, treeLine, water level, has water
const P1 = P0 + 1;                     // vegetated, shore band, strata, how much grass
const P2 = P0 + 2;                     // liquid: glow, roughness, opacity, cloud
const P3 = P0 + 3;                     // liquid: lava; cave roof; grime; -

const WATER_DEFAULT = { waterDeep: 0x123a46, waterShallow: 0x3f7f86 };
const LIQUID_DEFAULT = { glow: 0, rough: 0.1, opacity: 0.92, cloud: 0, lava: 0 };

function makePalette() {
  const w = P3 + 1;
  const h = WORLDS.length;
  const data = new Float32Array(w * h * 4);
  const c = new THREE.Color();
  WORLDS.forEach((world, row) => {
    PAL_COLORS.forEach((key, col) => {
      const hex = world.ground[key] !== undefined ? world.ground[key]
        : world.water && world.water[key] !== undefined ? world.water[key] : WATER_DEFAULT[key];
      c.set(hex);
      data.set([c.r, c.g, c.b, 1], (row * w + col) * 4);
    });
    const p = world.params;
    const l = { ...LIQUID_DEFAULT, ...(world.liquid || {}) };
    data.set([p.snowLine, p.treeLine, p.water === null ? -1e4 : p.water, p.water === null ? 0 : 1], (row * w + P0) * 4);
    data.set([p.vegetated, p.shore, p.strata, (world.grass && world.grass.amount) || 0], (row * w + P1) * 4);
    data.set([l.glow, l.rough, l.opacity, l.cloud], (row * w + P2) * 4);
    data.set([l.lava, p.cave || 0, p.grime || 0, 0], (row * w + P3) * 4);
  });
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

// Shared by every material that takes part: set by bindWorlds() and kept
// current by syncWorlds(). uWorldOrigin is the floating origin, so local
// positions + it = absolute. The schedule reaches the shaders as a window of
// segments around the camera: where each starts in progress u, its world,
// and the blend into it.
export const WORLD_SEGS = 16;
const WINDOW = 14000;   // metres of progress either side of the camera: the horizon and the warp
export const worldUniforms = {
  uWorldAxis: { value: new THREE.Vector4(0, 0, 1, 0) },                      // origin x, z; direction
  uWorldSpan: { value: new THREE.Vector4(7000, 1500, WARP_AMP, WARP_SCALE) },  // length, blend, warp
  uWorldShift: { value: new THREE.Vector3(0, 0, 0) },                        // shift, lowest u, ready
  uSegU: { value: new Float32Array(WORLD_SEGS) },
  uSegW: { value: new Float32Array(WORLD_SEGS) },
  uSegB: { value: new Float32Array(WORLD_SEGS) },
  uSegN: { value: 1 },
  uWorldPal: { value: makePalette() },
  uWorldOrigin: { value: new THREE.Vector2() },
};

export function setWorldOrigin(x, z) {
  worldUniforms.uWorldOrigin.value.set(x, z);
}

export function bindWorlds(map) {
  const u = worldUniforms;
  u.uWorldAxis.value.set(map.ox, map.oz, map.dx, map.dz);
  u.uWorldSpan.value.set(map.len, map.blend, WARP_AMP, WARP_SCALE);
  u.uWorldShift.value.set(map.shift, map.segs[0].u, map.ready ? 1 : 0);
  synced.key = '';
}

// The window of segments around an absolute point (the camera), uploaded
// when it moves on to another segment or the schedule changes.
const synced = { key: '' };
export function syncWorlds(map, ax, az) {
  const uc = map.u(ax, az);
  const { from, segs } = map.window(uc - WINDOW, uc + WINDOW, WORLD_SEGS);
  const key = `${map.version}:${from}:${segs.length}`;
  if (key === synced.key) return;
  synced.key = key;
  const u = worldUniforms;
  for (let i = 0; i < WORLD_SEGS; i++) {
    const s = segs[Math.min(i, segs.length - 1)];
    u.uSegU.value[i] = i < segs.length ? s.u : 1e9 + i;
    u.uSegW.value[i] = s.w;
    u.uSegB.value[i] = s.blend;
  }
  u.uSegN.value = segs.length;
}

// GLSL: worldAt(absolute xz) -> the world, the one it turns into, how far;
// worldPal(c) and worldPar(i) read the palette for the pair at this pixel.
export const WORLD_GLSL = /* glsl */`
uniform vec4 uWorldAxis;
uniform vec4 uWorldSpan;
uniform vec3 uWorldShift;
uniform float uSegU[${WORLD_SEGS}];
uniform float uSegW[${WORLD_SEGS}];
uniform float uSegB[${WORLD_SEGS}];
uniform int uSegN;
uniform sampler2D uWorldPal;
uniform vec2 uWorldOrigin;
int wA;
int wB;
float wT;
float wLattice(ivec2 p) {
  uint h = (uint(p.x) * 0x8da6b343u) ^ (uint(p.y) * 0xd8163841u);
  h ^= h >> 13u;
  h *= 0x5bd1e995u;
  h ^= h >> 15u;
  return float(h & 0xffffffu) / 16777216.0;
}
float worldWarp(vec2 p) {
  vec2 q = p / uWorldSpan.w;
  vec2 i = floor(q);
  vec2 f = q - i;
  f = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  float a = wLattice(c);
  float b = wLattice(c + ivec2(1, 0));
  float d = wLattice(c + ivec2(0, 1));
  float e = wLattice(c + ivec2(1, 1));
  float v = a + (b - a) * f.x + (d + (e - d) * f.x - (a + (b - a) * f.x)) * f.y;
  return (v - 0.5) * 2.0 * uWorldSpan.z;
}
void worldAt(vec2 p) {
  float u = uWorldShift.y + 600.0;
  if (uWorldShift.z > 0.5) {
    u = dot(p - uWorldAxis.xy, uWorldAxis.zw) + worldWarp(p) + uWorldShift.x;
    u = max(u, uWorldShift.y);
  }
  // The segment u is in, within the window: the last that starts at or before u.
  int i = 0;
  for (int k = 1; k < ${WORLD_SEGS}; k++) {
    if (k < uSegN && uSegU[k] <= u) i = k;
  }
  int j = min(i + 1, uSegN - 1);
  wA = int(uSegW[i] + 0.5);
  wB = int(uSegW[j] + 0.5);
  wT = j > i ? smoothstep(uSegU[j] - uSegB[j], uSegU[j], u) : 0.0;
}
// Away from a border the pair's blend is exactly 0, and the second world's
// row is never read.
vec3 worldPal(int c) {
  vec3 a = texelFetch(uWorldPal, ivec2(c, wA), 0).rgb;
  if (wT <= 0.0) return a;
  return mix(a, texelFetch(uWorldPal, ivec2(c, wB), 0).rgb, wT);
}
vec4 worldPar(int i) {
  vec4 a = texelFetch(uWorldPal, ivec2(${P0} + i, wA), 0);
  if (wT <= 0.0) return a;
  return mix(a, texelFetch(uWorldPal, ivec2(${P0} + i, wB), 0), wT);
}
// A world's water shows where its share of the blend is over a third.
float worldWet() {
  float a = texelFetch(uWorldPal, ivec2(${P0}, wA), 0).w;
  if (wT <= 0.0) return a;
  return mix(a, texelFetch(uWorldPal, ivec2(${P0}, wB), 0).w, wT);
}
`;

export const PAL = Object.fromEntries(PAL_COLORS.map((k, i) => [k, i]));
// The texel of the liquid's second parameters: lava, and the cave roof flag.
export const PAL_P3 = P3;

// --- sky and light between worlds ----------------------------------------------------

const COLOR_KEYS = ['sunColor', 'zenith', 'horizon', 'ground', 'glow', 'skyLight', 'groundLight'];
const NUMBER_KEYS = ['sunIntensity', 'clouds', 'fogDensity', 'fogBase', 'fogFalloff',
  'hemiIntensity', 'envIntensity', 'exposure', 'stars', 'planet', 'upside', 'paintStars'];

const PAINT_SKY_DEFAULT = [[0.035, 0.25, 0.62], [0.08, 0.39, 0.72], [0.38, 0.70, 0.84]];
// How a painted sky's three colours are laid up the dome: how much of it is a
// night's, three bands (0: a day's gradient, as it always was), the height (the
// sine of the elevation) the horizon's band reaches to, the height the middle's
// does, and how soft their edges are.
const PAINT_SHAPE_DEFAULT = [0, 0.15, 0.3, 0.02];
// What the painted style does to a world that is lit by night: the colour its
// dark sides are pulled to and (the fourth number) whether it is done at all,
// the tint its lit sides are laid in and the level they are laid at, the
// tint of the paints that materials give themselves (the road's) and of the
// lines painted on it, and how much of their paints the figures (the car, the
// other cars, the animals) have there (0: none, they keep the light the other
// styles give them; 1: all). A world with none has no night of its own: 0,
// and nothing is changed.
const DUSK_DEFAULT = [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0];
// The paint of a baked cloud (render/clouds.js): its lit top, middle, shaded
// side and underside, linear RGB. A world's own, or this.
const CLOUD_PAINT_DEFAULT = [[1.72, 1.70, 1.66], [0.50, 0.62, 0.80], [0.36, 0.48, 0.68], [0.30, 0.41, 0.58]];

// Each world's look, with the alpine sun direction (shadows are baked into the
// tiles, so the sun stands in the same place in every world) and colours as
// linear THREE.Colors ready to mix.
const LOOKS = WORLDS.map((w) => {
  const look = { sunElev: ALPINE_LOOK.sunElev, sunAz: ALPINE_LOOK.sunAz };
  for (const k of NUMBER_KEYS) look[k] = w.look[k] !== undefined ? w.look[k] : 0;
  for (const k of COLOR_KEYS) look[k] = new THREE.Color(w.look[k]);
  // The painted style's sky: zenith, middle and horizon in linear light, and
  // whether the world has one. A world without keeps the default's colours,
  // so that across a border to it they do not drift toward something else.
  look.paintK = w.look.paintSky ? 1 : 0;
  look.paint = Float32Array.from((w.look.paintSky || PAINT_SKY_DEFAULT).flat());
  // Which set of clouds the world's sky has (none: the sky keeps the one it has).
  look.cloudSet = w.look.cloudSet || null;
  look.cloudPaint = Float32Array.from((w.look.cloudPaint || CLOUD_PAINT_DEFAULT).flat());
  look.paintShape = Float64Array.from(w.look.paintShape ? [1, ...w.look.paintShape] : PAINT_SHAPE_DEFAULT);
  // A painted night that gives a set of clouds is laid with them.
  look.nightClouds = w.look.paintShape && w.look.cloudSet ? 1 : 0;
  const d = w.look.dusk;
  look.dusk = Float32Array.from(d ? [...d.shade, 1, ...d.lit, d.level, ...(d.own || [1, 1, 1]), ...(d.line || [1, 1, 1]), d.figures || 0] : DUSK_DEFAULT);
  return look;
});

export function worldLook(i) {
  return LOOKS[i];
}

// out = a mixed with b; colours mixed in linear light.
export function mixLooks(out, a, b, t) {
  out.sunElev = a.sunElev;
  out.sunAz = a.sunAz;
  for (const k of NUMBER_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  // Fog density spans an order of magnitude between worlds: mix its log; the
  // fog's height falloff likewise (the deep sea's is a million metres).
  out.fogDensity = Math.exp(Math.log(a.fogDensity) + (Math.log(b.fogDensity) - Math.log(a.fogDensity)) * t);
  out.fogFalloff = Math.exp(Math.log(a.fogFalloff) + (Math.log(b.fogFalloff) - Math.log(a.fogFalloff)) * t);
  out.paintK = a.paintK + (b.paintK - a.paintK) * t;
  const op = out.paint || (out.paint = new Float32Array(9));
  for (let i = 0; i < 9; i++) op[i] = a.paint[i] + (b.paint[i] - a.paint[i]) * t;
  const oc = out.cloudPaint || (out.cloudPaint = new Float32Array(12));
  for (let i = 0; i < 12; i++) oc[i] = a.cloudPaint[i] + (b.cloudPaint[i] - a.cloudPaint[i]) * t;
  const os = out.paintShape || (out.paintShape = new Float64Array(4));
  for (let i = 0; i < 4; i++) os[i] = a.paintShape[i] + (b.paintShape[i] - a.paintShape[i]) * t;
  out.nightClouds = a.nightClouds + (b.nightClouds - a.nightClouds) * t;
  const od = out.dusk || (out.dusk = new Float32Array(15));
  for (let i = 0; i < 15; i++) od[i] = a.dusk[i] + (b.dusk[i] - a.dusk[i]) * t;
  // The set of the world that has more of the point (the one it is in, if the other has none).
  out.cloudSet = (t < 0.5 ? a.cloudSet || b.cloudSet : b.cloudSet || a.cloudSet) || null;
  for (const k of COLOR_KEYS) (out[k] || (out[k] = new THREE.Color())).copy(a[k]).lerp(b[k], t);
  return out;
}
