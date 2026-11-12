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
const P1 = P0 + 1;                     // vegetated, shore band, strata, -
const P2 = P0 + 2;                     // liquid: glow, roughness, opacity, cloud
const P3 = P0 + 3;                     // liquid: lava; cave roof; -, -

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
    data.set([p.vegetated, p.shore, p.strata, 0], (row * w + P1) * 4);
    data.set([l.glow, l.rough, l.opacity, l.cloud], (row * w + P2) * 4);
    data.set([l.lava, p.cave || 0, 0, 0], (row * w + P3) * 4);
  });
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

// Shared by every material that takes part: set once by bindWorlds().
// uWorldOrigin is the floating origin, so local positions + it = absolute.
export const worldUniforms = {
  uWorldAxis: { value: new THREE.Vector4(0, 0, 1, 0) },                      // origin x, z; direction
  uWorldSpan: { value: new THREE.Vector4(7000, 1500, WARP_AMP, WARP_SCALE) },  // length, blend, warp
  uWorldShift: { value: new THREE.Vector3(0, 0, 0) },                        // shift, lowest u, ready
  uWorldCount: { value: WORLDS.length },
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
  u.uWorldShift.value.set(map.shift, map.first * map.len, map.ready ? 1 : 0);
  u.uWorldCount.value = map.count;
}

// GLSL: worldAt(absolute xz) -> the world, the one it turns into, how far;
// worldPal(c) and worldPar(i) read the palette for the pair at this pixel.
export const WORLD_GLSL = /* glsl */`
uniform vec4 uWorldAxis;
uniform vec4 uWorldSpan;
uniform vec3 uWorldShift;
uniform int uWorldCount;
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
  float k = floor(u / uWorldSpan.x);
  float f = u - k * uWorldSpan.x;
  wT = smoothstep(uWorldSpan.x - uWorldSpan.y, uWorldSpan.x, f);
  wA = int(mod(k, float(uWorldCount)));
  wB = int(mod(k + 1.0, float(uWorldCount)));
}
vec3 worldPal(int c) {
  return mix(texelFetch(uWorldPal, ivec2(c, wA), 0).rgb, texelFetch(uWorldPal, ivec2(c, wB), 0).rgb, wT);
}
vec4 worldPar(int i) {
  return mix(texelFetch(uWorldPal, ivec2(${P0} + i, wA), 0), texelFetch(uWorldPal, ivec2(${P0} + i, wB), 0), wT);
}
// A world's water shows where its share of the blend is over a third.
float worldWet() {
  float a = texelFetch(uWorldPal, ivec2(${P0}, wA), 0).w;
  float b = texelFetch(uWorldPal, ivec2(${P0}, wB), 0).w;
  return mix(a, b, wT);
}
`;

export const PAL = Object.fromEntries(PAL_COLORS.map((k, i) => [k, i]));
// The texel of the liquid's second parameters: lava, and the cave roof flag.
export const PAL_P3 = P3;

// --- sky and light between worlds ----------------------------------------------------

const COLOR_KEYS = ['sunColor', 'zenith', 'horizon', 'ground', 'glow', 'skyLight', 'groundLight'];
const NUMBER_KEYS = ['sunIntensity', 'clouds', 'fogDensity', 'fogBase', 'fogFalloff',
  'hemiIntensity', 'envIntensity', 'exposure', 'stars', 'planet'];

// Each world's look, with the alpine sun direction (shadows are baked into the
// tiles, so the sun stands in the same place in every world) and colours as
// linear THREE.Colors ready to mix.
const LOOKS = WORLDS.map((w) => {
  const look = { sunElev: ALPINE_LOOK.sunElev, sunAz: ALPINE_LOOK.sunAz };
  for (const k of NUMBER_KEYS) look[k] = w.look[k] !== undefined ? w.look[k] : 0;
  for (const k of COLOR_KEYS) look[k] = new THREE.Color(w.look[k]);
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
  for (const k of COLOR_KEYS) (out[k] || (out[k] = new THREE.Color())).copy(a[k]).lerp(b[k], t);
  return out;
}
