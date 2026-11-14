// Styles of drawing: the same world drawn as it is, or the way a painter of
// animated films, an ink painter, an animator, a woodblock cutter or an old
// console would draw it.
//
// A style is one set of numbers, read in three places:
//  - the light on every lit material (patchLighting, called from
//    withAtmosphere in atmosphere.js): the sun's light in bands, the shade
//    tinted, less shine, crisper cast shadows, and the car marking itself in
//    the frame's alpha so the last pass can find it;
//  - the sky (atmosphere.js): heaped, painted clouds, towers of cumulus and
//    a deeper blue;
//  - one pass after the final grade (render/post.js, STYLE_PASS): brush
//    strokes, ink, lines, a printer's few colours, pixels, greens and the
//    distance repainted, a world of square texels.
// Two things besides come and go with a style: the small animals
// (render/critters.js; the style's fauna, mobs) and the trees built of
// blocks (render/forest.js; blocks).
// A change of style moves every number from one set to the other over
// SWITCH_SECONDS, so one style turns into the next instead of cutting. With
// the real style every one of them is off, and the frame is the frame as it
// was before there were styles.

import * as THREE from 'three';

export const SWITCH_SECONDS = 1.4;

// The wind that takes the clouds' shadows across the land, metres a second.
export const WIND = [6.5, 2.8];

export const STYLES = [
  { id: 'real', name: '写实' },
  { id: 'paint', name: '手绘' },
  { id: 'ink', name: '水墨' },
  { id: 'cel', name: '赛璐璐' },
  { id: 'print', name: '版画' },
  { id: 'pixel', name: '像素' },
  { id: 'block', name: '方块' },
];
export const STYLE_INDEX = Object.fromEntries(STYLES.map((s, i) => [s.id, i]));

// Everything off: the world as it is.
const BASE = {
  // Light (materials). lit: how far the sun's light is banded; rampAt: the
  // two band edges in the cosine of the sun's angle and their softness;
  // rampLv: the light in the dark, middle and lit band; sunTint: the sun's
  // light on the lit side, tinted; shade: the sky's light where the sun does
  // not reach, tinted, and shadeEnv: the environment's share of it; spec:
  // shine kept; shadow: how crisp a cast shadow's edge is; mark: the car
  // marks itself; albedoLift: the darkest greys painted lighter; cloudShade:
  // how dark the shadow of a cloud drifting over the land is; clump: leaves
  // lit as round clumps, each its own ball of light.
  lit: 0, rampAt: [0.2, 0.55, 0.06], rampLv: [0, 0.6, 1], sunTint: [1, 1, 1], shade: [1, 1, 1], shadeEnv: [1, 1, 1],
  spec: 1, shadow: 0, mark: 0, albedoLift: 0, cloudShade: 0, clump: 0,
  // Life: fauna, the small animals of a painted wood (birds, butterflies,
  // deer, rabbits, foxes, a cat), mobs, a block world's animals; blocks: the
  // trees built of blocks; drift: wind drawn across the air in long pale
  // lines, and petals falling on it (render/drift.js).
  fauna: 0, mobs: 0, blocks: 0, drift: 0,
  // Sky and air: cumulus, a layer of heaps overhead and banks on the
  // horizon, skyPaint: fewer of them, whiter, with a darker shaded side,
  // and only in a day's sky; towers, cumulus standing on the horizon (a
  // day's sky only); deep: the blue deeper overhead; blue: a deep, full
  // blue coming down close to the horizon, and skySat: fuller all over (a
  // day's sky only, and not in the light the sky sheds); blockSky: a square
  // sun and square clouds, by day; fog: the haze, thinned.
  cumulus: 0, skyPaint: 0, towers: 0, deep: 0, blue: 0, skySat: 0, blockSky: 0, fog: 1,
  // The last pass. paint: brush strokes (a Kuwahara filter in eight round
  // sectors), stroke: their size; flat: flat colour (a blur that keeps to
  // one surface), flatR: its reach; line: lines at edges, lineW px wide,
  // where the depth jumps (between jump[0] and jump[1] of it) or its slope
  // breaks (crease), only on the car with lineCar, in lineCol or the colour
  // under them darkened (lineDark), fading out by lineFar metres, broken
  // like a dry brush with brush; ridge: where the land meets the sky, a
  // line however far; ink: an ink wash in five tones on paper, keep: the
  // car keeps its colour; blank: the sky left as paper; poster: brightness
  // cut to levels; print: the shadows printed in indigo and the lights left
  // as paper, bokashi: the sky printed as a band of indigo fading into the
  // paper; pixel: blocks, rows of them down the screen; dither: a console's
  // palette, dithered by ditherK; far: the distance turning blue (under a
  // day's sky only); lift: midtones raised; dark: the darkest greens a deep
  // blue-green, never black; green: greens warmer in the light and cooler
  // in the shade; greenPal: greens repainted from three, greenShade,
  // greenMid and greenLit, each at the brightness it was; satDark: the
  // saturation spared on the darkest tones; block: the world in blocks, the
  // picture taken at the middle of square texels laid on every face of the
  // world (a texel is blockK of its distance, in whole powers of two of a
  // metre, so about the same number of pixels across at any distance), each
  // with its own small variation (blockJit) and each face shaded by the way
  // it faces (blockFace); meadow: patches of lighter and darker, yellower and
  // bluer green laid on grass, and flowers: flowers in drifts close by, both
  // on the world; glow: a soft glow round what is bright.
  // Nothing in it is fixed to the screen but the pixel blocks' dither: a
  // grain laid on the screen stays put while the world moves under it, and
  // reads as dirt on the lens. The blocks are laid on the world, not on the
  // screen: they move with it.
  paint: 0, stroke: 1, flat: 0, flatR: 1.5,
  line: 0, lineW: 1, jump: [0.04, 0.12], crease: 0.8, lineCar: 0, lineCol: [0.1, 0.09, 0.08], lineDark: 0, lineFar: 600,
  brush: 0, ridge: 0,
  ink: 0, keep: 0, blank: 0, poster: 0, levels: 6, print: 0, bokashi: 0,
  pixel: 0, rows: 200, dither: 0, ditherK: 0.85,
  block: 0, blockK: 0.012, blockJit: 0.14, blockFace: 0.55, meadow: 0, flowers: 0, glow: 0,
  far: 0, lift: 0, dark: 0, green: 0,
  greenPal: 0, greenShade: [0.16, 0.42, 0.42], greenMid: [0.3, 0.6, 0.25], greenLit: [0.56, 0.78, 0.36],
  sat: 1, satDark: 0, contrast: 1, warm: 0, vignette: 0, paper: [0.95, 0.93, 0.88], inkCol: [0.1, 0.09, 0.085],
};

const PRESETS = {
  real: {},
  // After the painted backgrounds of hand-drawn animated films: a deep,
  // full blue sky with towers of white cumulus on the horizon, clear air
  // with the distance turning blue, a warm sun, shade light and blue-grey
  // rather than dark, no black (the asphalt laid on a little lighter),
  // greens from a painter's three (blue-green, emerald, a fresh yellow-
  // green), crisp shapes of light and shadow, everything laid on in round
  // gouache strokes; only the car is inked, as a character on a painted
  // ground is.
  paint: {
    lit: 0.9, rampAt: [0.04, 0.3, 0.06], rampLv: [0, 0.82, 1], sunTint: [1.04, 1.0, 0.92],
    shade: [1.0, 1.05, 1.3], shadeEnv: [1.8, 1.7, 1.55], spec: 0.3, shadow: 0.9, mark: 1, albedoLift: 0.06,
    cloudShade: 0.5, clump: 1, fauna: 1, drift: 1,
    cumulus: 1, skyPaint: 1, towers: 1, blue: 0.85, skySat: 0.7, fog: 0.25,
    paint: 1, stroke: 1.8, line: 1, lineW: 1.4, lineCar: 1, lineCol: [0.17, 0.12, 0.1], lineDark: 0.55, lineFar: 300,
    far: 1, lift: 0.08, dark: 0.55, greenPal: 0.7, meadow: 1, flowers: 1, glow: 0.8,
    greenMid: [0.27, 0.57, 0.24], greenLit: [0.5, 0.74, 0.33],
    sat: 1.12, satDark: 1, contrast: 1.06,
  },
  // Ink on paper: five tones of ink (焦 浓 重 淡 清) and the paper, sky and
  // haze left blank, near things and every ridge against the sky drawn with
  // a brush that runs dry, the forest far off only dabs of ink; the car's
  // orange the only colour on the page.
  ink: {
    mark: 1, flat: 1, flatR: 2.4, line: 1, lineW: 1.6, jump: [0.1, 0.3], crease: 0.25, lineFar: 700, ridge: 1,
    brush: 1, lineCol: [0.07, 0.065, 0.06],
    ink: 1, keep: 1, blank: 1, paper: [0.95, 0.92, 0.85], inkCol: [0.075, 0.07, 0.065], vignette: 0.16,
  },
  // Cel animation: two hard tones and a highlight, flat colour, dark lines
  // in the colour of what they outline, a deep sky with heaped clouds.
  cel: {
    lit: 1, rampAt: [0.2, 0.8, 0.012], rampLv: [0, 0.82, 1], shade: [0.8, 0.88, 1.24], spec: 0.25, shadow: 1,
    cumulus: 1, deep: 0.85,
    flat: 1, flatR: 2, line: 1, lineW: 1.3, lineDark: 0.82, lineFar: 1800, ridge: 0.8,
    sat: 1.25, contrast: 1.05, poster: 0.35, levels: 6, green: 0.3,
  },
  // A woodblock print: a few flat colours, the shadows in indigo and the
  // lights left as paper, the sky a band of indigo fading into the paper
  // (bokashi), black key lines, cream paper.
  print: {
    lit: 0.6, rampAt: [0.12, 0.5, 0.03], rampLv: [0, 0.7, 1], shade: [0.9, 0.93, 1.08], spec: 0.2, shadow: 0.8,
    flat: 1, flatR: 2.2, line: 1, lineW: 1.4, jump: [0.06, 0.18], crease: 0.5, lineCol: [0.1, 0.09, 0.085], lineFar: 1500, ridge: 1,
    poster: 1, levels: 4, print: 1, bokashi: 1, lift: 0.24, sat: 1.08, contrast: 1.0, paper: [0.95, 0.91, 0.81], vignette: 0.1,
  },
  // An old console: 180 rows of blocks, eight levels a channel, ordered
  // dithering.
  pixel: { pixel: 1, rows: 180, dither: 1, ditherK: 0.45, levels: 8, sat: 1.18, contrast: 1.06 },
  // A world of blocks: every face of the land and the trees laid with square
  // texels that stay where they are on the world, each shaded by the way it
  // faces; hard light and shade, no shine, a plain light-blue sky with a
  // square sun and square white clouds, trees built of blocks, and a
  // farm's animals built of boxes.
  block: {
    lit: 1, rampAt: [0.08, 0.5, 0.01], rampLv: [0, 0.78, 1], sunTint: [1.02, 1.0, 0.94],
    shade: [1.0, 1.02, 1.1], shadeEnv: [1.5, 1.5, 1.45], spec: 0, shadow: 1, albedoLift: 0.06,
    // Blue-green sky: pale at the horizon, a full light blue above. The clouds below are few.
    mobs: 1, blocks: 1, blockSky: 1, blue: 0.85, skySat: 0.7, fog: 0.5,
    block: 1, poster: 0.5, levels: 10, lift: 0.04,
    greenPal: 0.8, greenShade: [0.14, 0.34, 0.12], greenMid: [0.3, 0.58, 0.2], greenLit: [0.48, 0.74, 0.28],
    sat: 1.25, satDark: 1, contrast: 1.02,
  },
};

const clone = (o) => JSON.parse(JSON.stringify(o));
export const styleParams = (id) => ({ ...clone(BASE), ...clone(PRESETS[id] || {}) });

// The lit materials' share of a style (atmosphere.js assigns these to every
// material it hooks).
export const styleU = {
  uStyleLit: { value: 0 },
  uRampAt: { value: new THREE.Vector3(0.2, 0.55, 0.06) },
  uRampLv: { value: new THREE.Vector3(0, 0.6, 1) },
  uSunTint: { value: new THREE.Vector3(1, 1, 1) },
  uShadeTint: { value: new THREE.Vector3(1, 1, 1) },
  uShadeEnv: { value: new THREE.Vector3(1, 1, 1) },
  uSpecK: { value: 1 },
  uShadowK: { value: 0 },
  uStyleMark: { value: 0 },
  uAlbedoLift: { value: 0 },
  // The shadow of a cloud: how dark, where the wind has taken it, the sun's
  // direction (world), and the floating origin (absolute metres: low
  // frequencies do not mind the digits).
  uCloudShade: { value: 0 },
  uCloudDrift: { value: new THREE.Vector2() },
  uSunDirW: { value: new THREE.Vector3(0, 1, 0) },
  uOriginAbs: { value: new THREE.Vector3() },
  uClump: { value: 0 },
};

// The floating origin modulo 1024 m, worked out in double precision: the
// blocks' texels are hashed by where they are in a 1 km square that repeats,
// so a texel keeps its picture when the origin moves, and the digits stay
// few enough for a texel a sixteenth of a metre across.
export const originMod = { value: new THREE.Vector3() };

// The sky's (atmosphere.js's sky material).
export const skyStyle = {
  uCumulus: { value: 0 },
  uSkyPaint: { value: 0 },
  uSkyDeep: { value: 0 },
  uSkyBlue: { value: 0 },
  uSkySat: { value: 0 },
  uTowers: { value: 0 },
  uBlockSky: { value: 0 },
};

// How much of a day's sky the world has (1 by day, 0 for a night, the
// inferno's or space's): set by atmosphere.js with each change of light.
export const skyDay = { value: 1 };

// Patch a lit material's fragment shader with the style's light. Every
// change is behind a uniform: with the real style the material lights as it
// always did, to the bit. The physical model's direct, diffuse sky and
// reflected light functions are swapped for ones that band, tint and dim
// them; three's light loops call them by name, so no other hook on the same
// chunks is disturbed.
export function patchLighting(fs) {
  return fs
    .replace('#include <common>', `#include <common>
uniform float uStyleLit;
uniform vec3 uRampAt;
uniform vec3 uRampLv;
uniform vec3 uSunTint;
uniform vec3 uShadeTint;
uniform vec3 uShadeEnv;
uniform float uSpecK;
uniform float uShadowK;
uniform float uStyleMark;
uniform float uAlbedoLift;
uniform float uMarkSelf;
uniform float uCreatureSelf;
uniform float uLiftSelf;
uniform float uCloudShade;
uniform vec2 uCloudDrift;
uniform vec3 uSunDirW;
uniform vec3 uOriginAbs;
uniform float uClump;
uniform float uClumpSelf;
float stHash( vec3 p ) {
  p = fract( p * 0.1031 );
  p += dot( p, p.zyx + 31.32 );
  return fract( ( p.x + p.y ) * p.z );
}
float stNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( stHash( vec3( i, 1.0 ) ), stHash( vec3( i + vec2( 1.0, 0.0 ), 1.0 ) ), f.x ),
    mix( stHash( vec3( i + vec2( 0.0, 1.0 ), 1.0 ) ), stHash( vec3( i + vec2( 1.0, 1.0 ), 1.0 ) ), f.x ), f.y );
}
// The shadow of a cloud on the land: broad soft patches, moved by the wind.
float stCloudShadow( vec2 xz ) {
  vec2 q = ( xz + uCloudDrift ) * 0.0017;
  float n = stNoise( q ) * 0.56 + stNoise( q * 2.31 + 7.1 ) * 0.3 + stNoise( q * 5.3 + 3.7 ) * 0.14;
  return smoothstep( 0.5, 0.62, n );
}`)
    .replace('#include <color_fragment>', `#include <color_fragment>
// A painter's palette has no black in it: a dark grey (the asphalt; a
// material opts in with userData.styleLift) laid on lighter and a little
// warm, the lighter the darker it was, and still in its order.
if ( uAlbedoLift * uLiftSelf > 0.0 ) {
  vec3 a = diffuseColor.rgb;
  float hi = max( a.r, max( a.g, a.b ) );
  float grey = 1.0 - smoothstep( 0.015, 0.05, hi - min( a.r, min( a.g, a.b ) ) );
  float under = max( 1.0 - hi / 0.3, 0.0 );
  diffuseColor.rgb = a + vec3( 1.0, 0.94, 0.86 ) * uAlbedoLift * under * under * grey;
}`)
    .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
// How much of a light a face gets, in bands: dark, middle, lit.
float styleRamp( float x ) {
  float w = uRampAt.z;
  return uRampLv.x + ( uRampLv.y - uRampLv.x ) * smoothstep( uRampAt.x - w, uRampAt.x + w, x )
    + ( uRampLv.z - uRampLv.y ) * smoothstep( uRampAt.y - w, uRampAt.y + w, x );
}
void RE_Direct_Style( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  if ( uStyleLit <= 0.0 ) {
    RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
    return;
  }
  // The diffuse light is linear in the light's colour, so banding it is a
  // factor on the result; the shine keeps the light as it is, only less of it.
  ReflectedLight r = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, r );
  float d = saturate( dot( geometryNormal, directLight.direction ) );
  // A cloud's shadow over the land: only the sun's light (the light whose
  // direction is the sun's) goes dim.
  if ( uCloudShade > 0.0 && dot( directLight.direction, normalize( mat3( viewMatrix ) * uSunDirW ) ) > 0.995 ) {
    vec3 cw = cameraPosition + geometryPosition * mat3( viewMatrix ) + uOriginAbs;
    float cs = 1.0 - uCloudShade * stCloudShadow( cw.xz );
    r.directDiffuse *= cs;
    r.directSpecular *= cs;
  }
  reflectedLight.directDiffuse += r.directDiffuse * mix( vec3( 1.0 ), uSunTint * ( styleRamp( d ) / max( d, 1e-3 ) ), uStyleLit );
  reflectedLight.directSpecular += r.directSpecular * uSpecK;
}
void RE_IndirectDiffuse_Style( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  vec3 e = uStyleLit > 0.0 ? irradiance * mix( vec3( 1.0 ), uShadeTint, uStyleLit ) : irradiance;
  RE_IndirectDiffuse_Physical( e, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
}
void RE_IndirectSpecular_Style( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  if ( uStyleLit > 0.0 ) {
    // The environment's diffuse light comes in here: its share of the shade.
    vec3 e = irradiance * mix( vec3( 1.0 ), uShadeEnv, uStyleLit );
    RE_IndirectSpecular_Physical( radiance * uSpecK, e, clearcoatRadiance * uSpecK, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  } else {
    RE_IndirectSpecular_Physical( radiance, irradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  }
}
#undef RE_Direct
#define RE_Direct RE_Direct_Style
#undef RE_IndirectDiffuse
#define RE_IndirectDiffuse RE_IndirectDiffuse_Style
#undef RE_IndirectSpecular
#define RE_IndirectSpecular RE_IndirectSpecular_Style`)
    .replace('#include <shadowmap_pars_fragment>', `#include <shadowmap_pars_fragment>
#ifdef USE_SHADOWMAP
// A cast shadow's soft edge drawn crisp.
float getShadowStyle( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
  float v = getShadow( shadowMap, shadowMapSize, shadowBias, shadowRadius, shadowCoord );
  return uShadowK > 0.0 ? mix( v, smoothstep( 0.3, 0.7, v ), uShadowK ) : v;
}
#define getShadow getShadowStyle
#endif`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
// Leaves in clumps (a material opts in with userData.styleClump): the
// light on a crown breaks into clusters, a metre or so across, as a
// painter lays the leaves, not into the facets of the model. A smooth
// swirl of bumps laid on the world (two scales of it), so it stays on the
// tree and has no seams.
if ( uClump * uClumpSelf > 0.0 ) {
  vec3 cw = cameraPosition + ( - vViewPosition ) * mat3( viewMatrix ) + uOriginAbs;
  vec3 p = cw * 3.8;
  vec3 g1 = vec3( sin( p.y + 1.7 * cos( 0.83 * p.z ) ), sin( p.z + 1.7 * cos( 0.83 * p.x ) ), sin( p.x + 1.7 * cos( 0.83 * p.y ) ) );
  vec3 q = cw * 8.3 + 3.1;
  vec3 g2 = vec3( sin( q.y + 1.3 * cos( 0.9 * q.z ) ), sin( q.z + 1.3 * cos( 0.9 * q.x ) ), sin( q.x + 1.3 * cos( 0.9 * q.y ) ) );
  vec3 bn = mat3( viewMatrix ) * ( g1 + 0.5 * g2 + vec3( 0.0, 0.3, 0.0 ) );
  // Leaves only: a trunk is brown (its red over its green), and stays smooth.
  float leafy = smoothstep( -0.01, 0.03, diffuseColor.g - diffuseColor.r );
  normal = normalize( normal + bn * 0.6 * uClump * uClumpSelf * leafy );
}`)
    .replace('#include <dithering_fragment>', `#include <dithering_fragment>
// The car, marked in the alpha for the last pass (render/post.js).
gl_FragColor.a = mix( gl_FragColor.a, 0.5 - 0.2 * uCreatureSelf, uStyleMark * uMarkSelf );`);
}

// The brush strokes' taps (kuwahara in STYLE_PASS): the 49 pixels of a disc
// of radius 4, each with its Gaussian weight shared out among the eight
// sectors of the disc it falls in: all of it to its own sector, and up to
// half of it to the next one round on its nearer side, so neighbouring
// sectors overlap. Worked out once here, not for every pixel.
const KUWAHARA_TAPS = (() => {
  const num = (v) => v.toFixed(6);
  const off = [];
  const lo = [];
  const hi = [];
  for (let j = -4; j <= 4; j++) {
    for (let i = -4; i <= 4; i++) {
      const rr = i * i + j * j;
      if (rr > 16.5) continue;
      const g = Math.exp(-rr / 18);
      const w = new Array(8).fill(rr < 0.5 ? g : 0);
      if (rr >= 0.5) {
        // Rounded so a tap on a sector's edge falls the same way every time.
        const a = Math.round((Math.atan2(j, i) + Math.PI) / (Math.PI / 4) * 1e6) / 1e6;
        const k0 = Math.floor(a) & 7;
        const f = a - Math.floor(a);
        w[k0] += g;
        w[(k0 + (f < 0.5 ? 7 : 1)) & 7] += g * (0.5 - Math.abs(f - 0.5));
      }
      off.push(`vec2(${i}.0, ${j}.0)`);
      lo.push(`vec4(${w.slice(0, 4).map(num).join(', ')})`);
      hi.push(`vec4(${w.slice(4).map(num).join(', ')})`);
    }
  }
  return { n: off.length, off: off.join(',\n      '), lo: lo.join(',\n      '), hi: hi.join(',\n      ') };
})();

// The last pass: reads the graded frame (alpha under 0.75 where the car
// marked itself) and the scene's depth.
export const STYLE_PASS = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uNearFar: { value: new THREE.Vector2(0.3, 14000) },
    uPaint: { value: 0 },
    uPaintR: { value: 1 },
    uFlat: { value: 0 },
    uFlatR: { value: 1 },
    uLine: { value: 0 },
    uLineW: { value: 1 },
    uLineCar: { value: 0 },
    uLineCol: { value: new THREE.Vector3() },
    uLineDark: { value: 0 },
    uLineFar: { value: 600 },
    uJump: { value: new THREE.Vector2(0.04, 0.12) },
    uCrease: { value: 0.8 },
    uRidge: { value: 0 },
    uBrush: { value: 0 },
    uInk: { value: 0 },
    uKeep: { value: 0 },
    uPoster: { value: 0 },
    uLevels: { value: 6 },
    uPrint: { value: 0 },
    uPixel: { value: 1 },
    uRows: { value: 200 },
    uDither: { value: 0 },
    uGrade: { value: new THREE.Vector4(1, 1, 0, 0) },
    uPaper: { value: new THREE.Vector3(1, 1, 1) },
    uInkCol: { value: new THREE.Vector3() },
    uBlank: { value: 0 },
    uBokashi: { value: 0 },
    uFar: { value: 0 },
    uLift: { value: 0 },
    uDark: { value: 0 },
    uGreen: { value: 0 },
    uGreenPal: { value: 0 },
    uGreenShade: { value: new THREE.Vector3() },
    uGreenMid: { value: new THREE.Vector3() },
    uGreenLit: { value: new THREE.Vector3() },
    uSatDark: { value: 0 },
    uDitherK: { value: 0.85 },
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uViewProj: { value: new THREE.Matrix4() },
    uOriginMod: { value: new THREE.Vector3() },
    uBlock: { value: 0 },
    uBlockK: { value: 0.012 },
    uBlockJit: { value: 0.14 },
    uBlockFace: { value: 0.55 },
    uMeadow: { value: 0 },
    uFlowers: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 uRes;
    uniform vec2 uNearFar;
    uniform float uPaint;
    uniform float uPaintR;
    uniform float uFlat;
    uniform float uFlatR;
    uniform float uLine;
    uniform float uLineW;
    uniform float uLineCar;
    uniform vec3 uLineCol;
    uniform float uLineDark;
    uniform float uLineFar;
    uniform vec2 uJump;
    uniform float uCrease;
    uniform float uRidge;
    uniform float uBrush;
    uniform float uInk;
    uniform float uKeep;
    uniform float uPoster;
    uniform float uLevels;
    uniform float uPrint;
    uniform float uPixel;
    uniform float uRows;
    uniform float uDither;
    uniform vec4 uGrade;
    uniform vec3 uPaper;
    uniform vec3 uInkCol;
    uniform float uBlank;
    uniform float uBokashi;
    uniform float uFar;
    uniform float uLift;
    uniform float uDark;
    uniform float uGreen;
    uniform float uGreenPal;
    uniform vec3 uGreenShade;
    uniform vec3 uGreenMid;
    uniform vec3 uGreenLit;
    uniform float uSatDark;
    uniform float uDitherK;
    uniform mat4 uInvProj;
    uniform mat4 uCamWorld;
    uniform mat4 uViewProj;
    uniform vec3 uOriginMod;
    uniform float uBlock;
    uniform float uBlockK;
    uniform float uBlockJit;
    uniform float uBlockFace;
    uniform float uMeadow;
    uniform float uFlowers;
    varying vec2 vUv;

    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    float vnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    // Ordered dithering, 4 by 4.
    float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
    float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

    // Inverse depth: straight across a plane in screen space, so a crease is
    // where its slope breaks and a silhouette where it jumps.
    float invDepth(vec2 uv) {
      float z = texture2D(tDepth, uv).r * 2.0 - 1.0;
      float n = uNearFar.x;
      float f = uNearFar.y;
      return (f + n - z * (f - n)) / (2.0 * n * f);
    }
    float invFromZ(float zb) {
      float z = zb * 2.0 - 1.0;
      float n = uNearFar.x;
      float f = uNearFar.y;
      return (f + n - z * (f - n)) / (2.0 * n * f);
    }
    vec3 worldFromZ(vec2 uv, float zb) {
      vec4 vp = uInvProj * vec4(uv * 2.0 - 1.0, zb * 2.0 - 1.0, 1.0);
      return (uCamWorld * vec4(vp.xyz / vp.w, 1.0)).xyz;
    }
    float hash13(vec3 p3) {
      p3 = fract(p3 * 0.1031);
      p3 += dot(p3, p3.zyx + 31.32);
      return fract((p3.x + p3.y) * p3.z);
    }
    // Value noise that repeats every 'period' cells, so what is laid on the
    // world by it does not jump when the floating origin wraps its 1 km.
    float pnoise(vec2 p, float period) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      vec2 a = mod(i, period);
      vec2 b = mod(i + 1.0, period);
      return mix(mix(hash12(a), hash12(vec2(b.x, a.y)), f.x), mix(hash12(vec2(a.x, b.y)), hash12(b), f.x), f.y);
    }

    // The way the surface at a pixel faces, from the depth: its neighbours'
    // points (the near side of a jump), crossed. Zero where it cannot say.
    vec3 depthNormal(vec2 uv, float zc, float wc, vec3 P) {
      vec2 d = 1.0 / uRes;
      vec2 ox = vec2(d.x, 0.0);
      vec2 oy = vec2(0.0, d.y);
      float zr = texture2D(tDepth, uv + ox).r;
      float zl = texture2D(tDepth, uv - ox).r;
      float zu = texture2D(tDepth, uv + oy).r;
      float zd = texture2D(tDepth, uv - oy).r;
      vec3 ex = abs(invFromZ(zr) - wc) < abs(wc - invFromZ(zl)) ? worldFromZ(uv + ox, zr) - P : P - worldFromZ(uv - ox, zl);
      vec3 ey = abs(invFromZ(zu) - wc) < abs(wc - invFromZ(zd)) ? worldFromZ(uv + oy, zu) - P : P - worldFromZ(uv - oy, zd);
      vec3 n = cross(ex, ey);
      float nl = length(n);
      if (nl < 1e-9) return vec3(0.0);
      n /= nl;
      return dot(n, uCamWorld[3].xyz - P) < 0.0 ? -n : n;
    }

    // A world of blocks. The face of the world a pixel is on is found from
    // the depth (the way its neighbours' points lie), and laid with square
    // texels s metres across on the plane of that face: the colour of the
    // frame where the middle of the texel is, a little lighter or darker by
    // the texel's own draw, as the picture on a block's face is. Texels stay
    // where they are on the world, so the world moves under them; their
    // draw comes from where they are in a 1 km square that repeats.
    vec3 blockTexel(vec3 P, vec3 n, int k, float s, vec3 col0, float dist) {
      int a = (k + 1) % 3;
      int b = (k + 2) % 3;
      vec3 Pw = P + uOriginMod;
      float ia = floor(Pw[a] / s);
      float ib = floor(Pw[b] / s);
      vec3 Q = Pw;
      Q[a] = (ia + 0.5) * s;
      Q[b] = (ib + 0.5) * s;
      // On the plane the pixel's own point and normal give, so the middle of
      // the texel is on the same surface, not in front of or behind it.
      Q[k] = Pw[k] - (n[a] * (Q[a] - Pw[a]) + n[b] * (Q[b] - Pw[b])) / n[k];
      vec4 cp = uViewProj * vec4(Q - uOriginMod, 1.0);
      vec3 c = col0;
      if (cp.w > 0.0) {
        vec2 q = cp.xy / cp.w * 0.5 + 0.5;
        if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) {
          float wq = invFromZ(texture2D(tDepth, q).r);
          float we = 1.0 / cp.w;
          // Only if that is the same surface; at an edge it is the pixel's own.
          if (abs(wq - we) < we * (0.012 + 1.5 * s / dist)) c = texture2D(tDiffuse, q).rgb;
        }
      }
      float per = 1024.0 / s;
      float h = hash13(vec3(mod(ia, per), mod(ib, per), float(k) * 7.0 + log2(s) + 20.0));
      // Where a texel is no wider than a pixel or two the variation would
      // only be noise.
      float vis = smoothstep(1.0, 3.0, s / (dist * 0.0018));
      return c * (1.0 + (h - 0.5) * uBlockJit * vis);
    }
    vec3 blockColor(vec2 uv, vec3 col0, float zc, float wc) {
      vec3 P = worldFromZ(uv, zc);
      vec3 n = depthNormal(uv, zc, wc, P);
      if (dot(n, n) < 0.5) return col0;
      vec3 cam = uCamWorld[3].xyz;
      vec3 an = abs(n);
      int k = (an.y >= an.x && an.y >= an.z) ? 1 : (an.x >= an.z ? 0 : 2);
      float dist = length(P - cam);
      // Texels in whole powers of two of a metre, two scales at a time and
      // the one blended into the other, so no seam where the scale changes.
      float L = log2(max(dist * uBlockK, 1.0 / 32.0));
      float L0 = floor(L);
      float f = L - L0;
      vec3 c = blockTexel(P, n, k, exp2(L0), col0, dist);
      if (f > 0.3) c = mix(c, blockTexel(P, n, k, exp2(L0 + 1.0), col0, dist), smoothstep(0.3, 0.7, f));
      // Each face shaded by the way it faces: the top full, the sides less,
      // the underside least.
      float face = k == 1 ? (n.y > 0.0 ? 1.0 : 0.5) : (k == 0 ? 0.78 : 0.62);
      return c * mix(1.0, face, uBlockFace);
    }

    // Brush strokes: a Kuwahara filter over eight sectors of a disc. Each
    // sector's mean is weighted by how even the sector is, so flat areas
    // stay flat and edges stay sharp; the round sectors lay round dabs where
    // the four squares of the plain filter laid streaks and blocks. The
    // sectors go four to a vec4: 0-3 in the A sums, 4-7 in the B ones.
    const vec2 KUW_OFF[${KUWAHARA_TAPS.n}] = vec2[${KUWAHARA_TAPS.n}](
      ${KUWAHARA_TAPS.off});
    const vec4 KUW_A[${KUWAHARA_TAPS.n}] = vec4[${KUWAHARA_TAPS.n}](
      ${KUWAHARA_TAPS.lo});
    const vec4 KUW_B[${KUWAHARA_TAPS.n}] = vec4[${KUWAHARA_TAPS.n}](
      ${KUWAHARA_TAPS.hi});
    vec3 kuwahara(vec2 uv, vec2 s) {
      vec4 nA = vec4(0.0);
      vec4 nB = vec4(0.0);
      vec4 rA = vec4(0.0);
      vec4 gA = vec4(0.0);
      vec4 bA = vec4(0.0);
      vec4 rB = vec4(0.0);
      vec4 gB = vec4(0.0);
      vec4 bB = vec4(0.0);
      vec4 qA = vec4(0.0);
      vec4 qB = vec4(0.0);
      for (int t = 0; t < ${KUWAHARA_TAPS.n}; t++) {
        vec3 c = texture2D(tDiffuse, uv + KUW_OFF[t] * s).rgb;
        float cc = dot(c, c);
        vec4 wa = KUW_A[t];
        vec4 wb = KUW_B[t];
        nA += wa;
        nB += wb;
        rA += wa * c.r;
        gA += wa * c.g;
        bA += wa * c.b;
        rB += wb * c.r;
        gB += wb * c.g;
        bB += wb * c.b;
        qA += wa * cc;
        qB += wb * cc;
      }
      rA /= nA;
      gA /= nA;
      bA /= nA;
      rB /= nB;
      gB /= nB;
      bB /= nB;
      // How uneven each sector is (its variance, the channels summed), and
      // its weight from that.
      vec4 xA = 1.0 + 500.0 * max(qA / nA - (rA * rA + gA * gA + bA * bA), 0.0);
      vec4 xB = 1.0 + 500.0 * max(qB / nB - (rB * rB + gB * gB + bB * bB), 0.0);
      xA *= xA;
      xB *= xB;
      vec4 wA = 1.0 / (xA * xA);
      vec4 wB = 1.0 / (xB * xB);
      vec3 acc = vec3(dot(rA, wA) + dot(rB, wB), dot(gA, wA) + dot(gB, wB), dot(bA, wA) + dot(bB, wB));
      return acc / (dot(wA, vec4(1.0)) + dot(wB, vec4(1.0)));
    }

    // Flat colour: the neighbourhood's mean over the same surface only (by
    // depth), so the texture of grass and rock goes and the edges of things
    // stay where they are.
    vec3 flatten(vec2 uv, vec2 s, float w0) {
      vec3 acc = vec3(0.0);
      float sum = 0.0;
      for (int j = -3; j <= 3; j++) {
        for (int i = -3; i <= 3; i++) {
          vec2 o = vec2(float(i), float(j)) * s;
          float k = exp(-abs(invDepth(uv + o) - w0) / (w0 * 0.03 + 1e-7)) * exp(-float(i * i + j * j) / 9.0);
          acc += texture2D(tDiffuse, uv + o).rgb * k;
          sum += k;
        }
      }
      return acc / max(sum, 1e-5);
    }

    void main() {
      vec2 px = 1.0 / uRes;
      vec2 uv = vUv;
      // Blocks: every pixel of one takes the colour at its middle. A block is
      // a whole number of screen pixels, so its edges are crisp.
      float block = 1.0;
      if (uPixel > 0.0) {
        block = mix(1.0, max(1.0, floor(uRes.y / uRows + 0.5)), uPixel);
        vec2 b = block * px;
        uv = (floor(vUv / b) + 0.5) * b;
      }
      vec4 src = texture2D(tDiffuse, uv);
      vec3 col = src.rgb;
      float car = 1.0 - step(0.75, src.a);
      // A small creature is marked lower than the car (0.3, not 0.5): the
      // brush that paints a hillside would wipe it out.
      float crit = 1.0 - step(0.4, src.a);
      // The sky is drawn on the far plane; the land ends well short of it.
      float zc = texture2D(tDepth, uv).r;
      float sky = step(0.999995, zc);
      float wc = invDepth(uv);
      float dist = 1.0 / wc;
      if (uPaint > 0.0) col = mix(col, kuwahara(uv, px * uPaintR * (1.0 - 0.65 * crit)), uPaint);
      if (uFlat > 0.0) col = mix(col, flatten(uv, px * uFlatR, wc), uFlat);
      if (uBlock > 0.0 && sky < 0.5) col = mix(col, blockColor(uv, col, zc, wc), uBlock);

      // Grade: saturation (spared on the darkest tones with satDark: there
      // it turns a dark grey ink-blue), contrast, a warmer light, midtones
      // raised.
      float sk = uGrade.x;
      if (uSatDark > 0.0) sk = mix(sk, mix(1.0, sk, smoothstep(0.08, 0.3, luma(col))), uSatDark);
      col = mix(vec3(luma(col)), col, sk);
      col = (col - 0.5) * uGrade.y + 0.5;
      col *= vec3(1.0 + uGrade.z, 1.0 + uGrade.z * 0.3, 1.0 - uGrade.z);
      col = clamp(col, 0.0, 1.0);
      if (uLift > 0.0) col = pow(col, vec3(1.0 - uLift));
      // The darkest greens a deep blue-green, not black: a painter's shade
      // under trees is a colour. Grey and blue-grey (a road, a rock) stay.
      if (uDark > 0.0) {
        float greenish = smoothstep(-0.01, 0.05, col.g - max(col.r, col.b));
        col += vec3(0.05, 0.12, 0.13) * (1.0 - smoothstep(0.0, 0.32, luma(col))) * greenish * uDark;
      }
      // Greens: warmer in the light, cooler in the shade.
      if (uGreen > 0.0) {
        float gm = clamp((col.g - max(col.r, col.b)) * 5.0, 0.0, 1.0);
        vec3 warm = col * vec3(1.16, 1.05, 0.74);
        vec3 cool = col * vec3(0.8, 0.96, 1.14);
        col = mix(col, mix(cool, warm, smoothstep(0.16, 0.5, luma(col))), gm * uGreen);
      }
      // Greens repainted from a painter's three, each at the brightness it
      // was: a blue-green in the shade, an emerald, a fresh yellow-green in
      // the sun. A meadow's yellow-green counts; a yellow does not.
      if (uGreenPal > 0.0) {
        float gy = clamp((col.g - 0.5 * (col.r + col.b)) * 4.0, 0.0, 1.0)
          * smoothstep(0.0, 0.04, col.g - col.r) * smoothstep(0.0, 0.04, col.g - col.b);
        float l = luma(col);
        vec3 pal = mix(uGreenShade, uGreenMid, smoothstep(0.06, 0.34, l));
        pal = mix(pal, uGreenLit, smoothstep(0.36, 0.78, l));
        pal *= (l + uGreenPal * 0.03) / max(luma(pal), 1e-4);
        col = mix(col, clamp(pal, 0.0, 1.0), gy * uGreenPal);
      }
      // A meadow painted, not flat: patches of lighter and darker, yellower
      // and bluer green a few metres across, laid on the ground; and, close
      // by, flowers in drifts. Both stay where they are on the world, and
      // are only on grass (green, facing up).
      if (uMeadow > 0.0 && sky < 0.5) {
        float gm = clamp((col.g - 0.5 * (col.r + col.b)) * 4.0, 0.0, 1.0)
          * smoothstep(0.0, 0.04, col.g - col.r) * smoothstep(0.0, 0.04, col.g - col.b);
        if (gm > 0.01 && dist < 300.0) {
          vec3 P = worldFromZ(uv, zc);
          vec3 Pw = P + uOriginMod;
          float v = (pnoise(Pw.xz / 8.0, 128.0) - 0.5) * 0.8 + (pnoise(Pw.xz / 3.2 + 5.0, 320.0) - 0.5) * 0.4;
          float reach = 1.0 - smoothstep(60.0, 300.0, dist);
          col = mix(col, col * vec3(1.0 + v * 0.5, 1.0 + v * 0.3, 1.0 - v * 0.7), gm * uMeadow * reach);
          if (uFlowers > 0.0 && dist < 48.0) {
            vec3 n = depthNormal(uv, zc, wc, P);
            float up = smoothstep(0.78, 0.92, n.y);
            vec2 g = Pw.xz / 0.64;
            vec2 ci = floor(g);
            vec2 cm = mod(ci, 1600.0);
            float h0 = hash13(vec3(cm, 1.0));
            float drift = smoothstep(0.42, 0.68, pnoise(Pw.xz / 10.0 + 11.0, 102.0));
            float on = step(1.0 - (0.04 + 0.5 * drift), h0);
            vec2 jit = vec2(hash13(vec3(cm, 2.0)), hash13(vec3(cm, 3.0))) - 0.5;
            float dd = length((fract(g) - 0.5 - jit * 0.5) * 0.64);
            float r = 0.075 + 0.04 * hash13(vec3(cm, 4.0));
            float spot = 1.0 - smoothstep(r * 0.65, r, dd);
            float pick = hash13(vec3(cm, 5.0));
            vec3 fc = pick < 0.4 ? vec3(0.98, 0.97, 0.9) : pick < 0.66 ? vec3(1.0, 0.84, 0.25) : pick < 0.86 ? vec3(0.98, 0.62, 0.72) : vec3(0.6, 0.7, 1.0);
            col = mix(col, fc, spot * on * up * gm * uFlowers * (1.0 - smoothstep(20.0, 48.0, dist)));
          }
        }
      }
      // The distance turning blue, layer behind layer, from a little way off.
      if (uFar > 0.0) {
        float f = (1.0 - exp(-max(dist - 150.0, 0.0) / 2600.0)) * (1.0 - sky);
        col = mix(col, vec3(0.5, 0.64, 0.84) * (0.55 + 0.65 * luma(col)), f * uFar * 0.7);
      }
      col = clamp(col, 0.0, 1.0);
      vec3 base = col;

      // Ink on paper: five tones of ink and the paper. Sky and haze stay
      // blank; only what is dark takes the ink, and a wash never goes as
      // dark as a line.
      if (uInk > 0.0) {
        float dens = pow(1.0 - smoothstep(0.04, 0.8, luma(col)), 2.4);
        float q = dens * 5.0;
        float qi = floor(q);
        float tone = (qi + smoothstep(0.25, 0.75, q - qi)) / 5.0;
        tone = min(tone, 0.9);
        // The land never quite the paper: far hills a pale wash. A bright sky
        // is left blank; a dark one (space) keeps its ink, the stars paper.
        tone = max(tone, 0.12 * (1.0 - sky));
        tone *= 1.0 - sky * uBlank * smoothstep(0.3, 0.5, luma(col));
        vec3 ink = mix(uPaper, uInkCol, clamp(tone, 0.0, 1.0));
        vec3 keep = mix(base, base * uPaper, 0.25);
        col = mix(col, mix(ink, keep, car * uKeep), uInk);
      }

      // A woodblock's few colours: the shadows printed in indigo, the lights
      // left as paper, the brightness cut to a few flat levels (the hue
      // kept); its sky a band of indigo printed fading into the paper.
      if (uPrint > 0.0) {
        float l = luma(col);
        col = mix(col, vec3(0.13, 0.2, 0.33) * (0.45 + l), (1.0 - smoothstep(0.06, 0.32, l)) * 0.45 * uPrint);
        col = mix(col, uPaper, smoothstep(0.6, 0.95, l) * 0.7 * uPrint);
      }
      if (uPoster > 0.0) {
        float l = max(luma(col), 1e-4);
        float q = l * uLevels;
        float lq = (floor(q) + smoothstep(0.4, 0.6, fract(q))) / uLevels;
        // A print grades its haze smoothly, as its sky.
        float k = uPoster * (1.0 - sky) * (1.0 - smoothstep(0.6, 0.85, l) * uPrint);
        col = mix(col, clamp(col * (lq / l), 0.0, 1.0), k);
      }
      if (uBokashi > 0.0 && sky > 0.0) {
        vec4 ray = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
        vec3 dir = normalize((uCamWorld * vec4(ray.xyz / ray.w, 0.0)).xyz);
        float e = smoothstep(0.0, 0.42, dir.y);
        float band = floor(e * 4.0) / 4.0;
        vec3 bok = mix(uPaper, vec3(0.12, 0.25, 0.45), mix(e, band, 0.35) * 0.95);
        // Only a day's sky: a night, the inferno's or space's keeps its own.
        col = mix(col, bok, uBokashi * sky * smoothstep(0.3, 0.5, luma(base)));
      }

      // Lines at the edges of things: where the depth jumps (outlines) or
      // its slope breaks (creases), fading with distance.
      if (uLine > 0.0) {
        vec2 o = px * max(uLineW, block);
        float wl = invDepth(uv - vec2(o.x, 0.0));
        float wr = invDepth(uv + vec2(o.x, 0.0));
        float wd = invDepth(uv - vec2(0.0, o.y));
        float wu = invDepth(uv + vec2(0.0, o.y));
        float wmax = max(max(max(wl, wr), max(wd, wu)), wc);
        float jump = max(max(abs(wl - wc), abs(wr - wc)), max(abs(wd - wc), abs(wu - wc))) / wmax;
        float crease = (abs(wl + wr - 2.0 * wc) + abs(wd + wu - 2.0 * wc)) / wc;
        float e = max(smoothstep(uJump.x, uJump.y, jump), smoothstep(0.012, 0.04, crease) * uCrease);
        e *= 1.0 - smoothstep(uLineFar * 0.4, uLineFar, 1.0 / wmax);
        // Where the land meets the sky, and where one ridge stands in front of
        // another far behind it: a line however far off it is.
        if (uRidge > 0.0) {
          float wsky = 1.0005 / uNearFar.y;
          float skyN = max(max(step(wl, wsky), step(wr, wsky)), max(step(wd, wsky), step(wu, wsky)));
          e = max(e, max((1.0 - sky) * skyN, smoothstep(0.3, 0.55, jump) * (1.0 - sky)) * uRidge);
        }
        if (uLineCar > 0.0) {
          float near = car;
          near = max(near, 1.0 - step(0.75, texture2D(tDiffuse, uv - vec2(o.x, 0.0)).a));
          near = max(near, 1.0 - step(0.75, texture2D(tDiffuse, uv + vec2(o.x, 0.0)).a));
          near = max(near, 1.0 - step(0.75, texture2D(tDiffuse, uv - vec2(0.0, o.y)).a));
          near = max(near, 1.0 - step(0.75, texture2D(tDiffuse, uv + vec2(0.0, o.y)).a));
          e *= mix(1.0, near, uLineCar);
        }
        if (uBrush > 0.0 && sky < 0.5) {
          // A brush, thicker and thinner along the stroke and now and then
          // running dry: noise laid on the world where the line is, so it
          // moves with the line. Far off the line is even.
          vec4 vp = uInvProj * vec4(uv * 2.0 - 1.0, zc * 2.0 - 1.0, 1.0);
          vec3 wp = (uCamWorld * vec4(vp.xyz / vp.w, 1.0)).xyz;
          float n1 = vnoise(wp.xz / 7.0) * 0.5 + vnoise(wp.xy / 7.0 + 13.0) * 0.5;
          float n2 = vnoise(wp.zy / 3.0 + 29.0) * 0.5 + vnoise(wp.xz / 3.0 + 41.0) * 0.5;
          float nearB = 1.0 - smoothstep(150.0, 450.0, dist);
          e *= mix(1.0, (0.6 + 0.7 * n1) * mix(1.0, smoothstep(0.12, 0.34, n2), 0.85), uBrush * nearB);
        }
        vec3 lc = mix(uLineCol, base * 0.32, uLineDark);
        col = mix(col, lc, clamp(e, 0.0, 1.0) * uLine);
      }

      // A console's palette, dithered block by block.
      if (uDither > 0.0) {
        float d = bayer4(mod(floor(gl_FragCoord.xy / block), 4.0)) - 0.5;
        float n = uLevels - 1.0;
        vec3 qc = floor(col * n + 0.5 + d * uDitherK) / n;
        col = mix(col, qc, uDither);
      }

      vec2 v = vUv - 0.5;
      col *= 1.0 - uGrade.w * dot(v, v) * 2.0;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

// The style being drawn, and the move from one to the next.
export class Style {
  constructor(id = 'real') {
    this.id = STYLE_INDEX[id] !== undefined ? id : 'real';
    this.cur = styleParams(this.id);
    this.from = clone(this.cur);
    this.to = clone(this.cur);
    this.t = 1;
    this.wind = [0, 0];   // how far the wind has taken the clouds' shadows
  }

  // The floating origin has moved: its digits for the shaders (absolute, for
  // broad things; modulo 1 km, for the blocks' texels).
  setOrigin(x, z) {
    styleU.uOriginAbs.value.set(x, 0, z);
    originMod.value.set(((x % 1024) + 1024) % 1024, 0, ((z % 1024) + 1024) % 1024);
  }

  // Every frame: the wind takes the clouds' shadows over the land.
  tick(dt) {
    this.wind[0] = (this.wind[0] + dt * WIND[0]) % 65536;
    this.wind[1] = (this.wind[1] + dt * WIND[1]) % 65536;
    styleU.uCloudDrift.value.set(this.wind[0], this.wind[1]);
  }

  // Draw in style id, turning into it over SWITCH_SECONDS (at once with
  // instant). Returns whether anything changed.
  set(id, instant = false) {
    if (STYLE_INDEX[id] === undefined || (id === this.id && this.t >= 1)) return false;
    this.id = id;
    this.from = clone(this.cur);
    this.to = styleParams(id);
    this.t = instant ? 1 : 0;
    if (instant) this.cur = clone(this.to);
    return true;
  }

  next() {
    return STYLES[(STYLE_INDEX[this.id] + 1) % STYLES.length].id;
  }

  get moving() {
    return this.t < 1;
  }

  // Every frame. Returns whether the numbers moved.
  update(dt) {
    if (this.t >= 1) return false;
    this.t = Math.min(1, this.t + dt / SWITCH_SECONDS);
    const k = this.t * this.t * (3 - 2 * this.t);
    const a = this.from;
    const b = this.to;
    for (const key of Object.keys(b)) {
      if (Array.isArray(b[key])) {
        for (let i = 0; i < b[key].length; i++) this.cur[key][i] = a[key][i] + (b[key][i] - a[key][i]) * k;
      } else {
        this.cur[key] = a[key] + (b[key] - a[key]) * k;
      }
    }
    if (this.t >= 1) this.cur = clone(b);
    return true;
  }

  // The lit materials' and the sky's numbers.
  applyScene() {
    const c = this.cur;
    const u = styleU;
    u.uStyleLit.value = c.lit;
    u.uRampAt.value.fromArray(c.rampAt);
    u.uRampLv.value.fromArray(c.rampLv);
    u.uSunTint.value.fromArray(c.sunTint);
    u.uShadeTint.value.fromArray(c.shade);
    u.uShadeEnv.value.fromArray(c.shadeEnv);
    u.uSpecK.value = c.spec;
    u.uShadowK.value = c.shadow;
    u.uStyleMark.value = c.mark > 0.5 ? 1 : 0;
    u.uAlbedoLift.value = c.albedoLift;
    u.uCloudShade.value = c.cloudShade;
    u.uClump.value = c.clump;
    skyStyle.uCumulus.value = c.cumulus;
    skyStyle.uSkyPaint.value = c.skyPaint;
    skyStyle.uSkyDeep.value = c.deep;
    skyStyle.uSkyBlue.value = c.blue;
    skyStyle.uSkySat.value = c.skySat;
    skyStyle.uTowers.value = c.towers;
    skyStyle.uBlockSky.value = c.blockSky;
  }

  // Whether the last pass has anything to do.
  get drawn() {
    const c = this.cur;
    return c.paint > 0 || c.flat > 0 || c.line > 0 || c.ink > 0 || c.poster > 0 || c.print > 0 || c.bokashi > 0 || c.pixel > 0
      || c.dither > 0 || c.far > 0 || c.lift > 0 || c.dark > 0 || c.green > 0 || c.greenPal > 0 || c.block > 0
      || c.sat !== 1 || c.contrast !== 1 || c.warm !== 0 || c.vignette > 0;
  }

  // The last pass's numbers.
  applyPass(u, height) {
    const c = this.cur;
    u.uBlock.value = c.block;
    u.uBlockK.value = c.blockK;
    u.uBlockJit.value = c.blockJit;
    u.uBlockFace.value = c.blockFace;
    u.uMeadow.value = c.meadow;
    u.uFlowers.value = c.flowers;
    u.uOriginMod.value.copy(originMod.value);
    u.uPaint.value = c.paint;
    u.uPaintR.value = c.stroke * Math.max(1, height / 760);
    u.uFlat.value = c.flat;
    u.uFlatR.value = c.flatR * Math.max(1, height / 760);
    u.uLine.value = c.line;
    u.uLineW.value = c.lineW * Math.max(1, height / 900);
    u.uLineCar.value = c.lineCar;
    u.uLineCol.value.fromArray(c.lineCol);
    u.uLineDark.value = c.lineDark;
    u.uLineFar.value = c.lineFar;
    u.uJump.value.fromArray(c.jump);
    u.uCrease.value = c.crease;
    u.uRidge.value = c.ridge;
    u.uBrush.value = c.brush;
    u.uInk.value = c.ink;
    u.uKeep.value = c.keep;
    u.uPoster.value = c.poster;
    u.uLevels.value = c.levels;
    u.uPrint.value = c.print;
    u.uPixel.value = c.pixel;
    u.uRows.value = c.rows;
    u.uDither.value = c.dither;
    u.uGrade.value.set(c.sat, c.contrast, c.warm, c.vignette);
    u.uPaper.value.fromArray(c.paper);
    u.uInkCol.value.fromArray(c.inkCol);
    u.uBlank.value = c.blank;
    u.uBokashi.value = c.bokashi;
    // The distance turns blue under a day's sky only; a night's, the
    // inferno's or space's air keeps its own colour.
    u.uFar.value = c.far * skyDay.value;
    u.uLift.value = c.lift;
    u.uDark.value = c.dark;
    u.uGreen.value = c.green;
    u.uGreenPal.value = c.greenPal;
    u.uGreenShade.value.fromArray(c.greenShade);
    u.uGreenMid.value.fromArray(c.greenMid);
    u.uGreenLit.value.fromArray(c.greenLit);
    u.uSatDark.value = c.satDark;
    u.uDitherK.value = c.ditherK;
  }
}
