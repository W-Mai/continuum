// The built road: asphalt, verges, guardrails, viaduct decks and piers, tunnel
// tubes and portals, generated in 64 m chunks from committed samples.
//
// Committed samples never change, so a chunk is built once. Its geometry is
// kept apart from the GPU and joined with the other chunks of its 512 m span
// into one mesh per material, so the road is a handful of draws a span rather
// than one per material per chunk; a span is joined again when a chunk comes
// or goes, and only the spans in sight are drawn. The floating origin moves
// the span groups. Paint is drawn by the asphalt shader from the lateral
// coordinate, so a line can never sink under the crown of the road.

import * as THREE from 'three';
import { twistU, TWIST_PARS } from './twist.js';
import {
  STEP, HALF_PAVED, HALF_FLAT, DECK_DEPTH, GROUND, BRIDGE, TUNNEL,
} from '../world/road.js';
import { TUNNEL_H } from '../world/corridor.js';
import { withAtmosphere, withSunMask, withSkyScale, boreSky, atmo } from './atmosphere.js';
import { pairProgram, styleU } from './style.js';
import { worldUniforms, WORLD_GLSL, PAL } from './worldlook.js';
import { fieldU, JUNCTION_PARS, JUNCTION_MAP } from './fieldshade.js';
import { WORLDS } from '../world/worlds.js';
import { sunVisibility } from '../world/sunlight.js';
import { makeRoadStrokeTexture } from './textures.js';
import { RoadSurfaces } from './surfaces.js';
import { MEANS } from '../world/surface.js';

const CHUNK = 32;                 // samples per chunk: 64 m
const SPAN = 8;                   // chunks joined into one mesh per material: 512 m
const AHEAD = 3600;
const BEHIND = 320;
const EDGE_LINE = 3.75;           // centre of the solid edge line
const PIER_EVERY = 36;            // metres between piers on a viaduct
// A pier that goes down into a sea of cloud with veils (the heaven's: world/heavenplan.js) goes into the white
// over MIST m: the sea's colour (linear) and how much of the lens's world is such a sea (w), and the sea's level (x)
// and the depth it is over (y); render/heaven.js keeps them. Where w is 0 the pier is what it was.
export const pierMist = { uPierMist: { value: new THREE.Vector4(1, 1, 1, 0) }, uPierMistAt: { value: new THREE.Vector2(0, 8) } };
function mistPier(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(mat, shader, renderer);
    Object.assign(shader.uniforms, pierMist);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vPierMistY;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
vPierMistY = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).y;
#else
vPierMistY = ( modelMatrix * vec4( transformed, 1.0 ) ).y;
#endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vPierMistY;\nuniform vec4 uPierMist;\nuniform vec2 uPierMistAt;')
      .replace('#include <map_fragment>', `#include <map_fragment>
if ( uPierMist.w > 0.0 ) diffuseColor.rgb = mix( diffuseColor.rgb, uPierMist.rgb, uPierMist.w * ( 1.0 - smoothstep( 0.0, uPierMistAt.y, vPierMistY - uPierMistAt.x ) ) );`);
  };
  return mat;
}
const MAX_PIERS = 1200;
const LAMP_H = 9;                 // a pole lamp's head over the crown
const LAMP_REACH = 2.8;           // how far its arm reaches in over the road
const TORCH_H = 2.3;              // a torch's post (the block style's lamp), and how far in its pool of light lies
const TORCH_REACH = 1.4;
const POOL_ALONG = 4;             // samples either side of the lamp its pool spans
const POOL_HALF = 6.5;            // and metres either side across
const MAX_LAMPS = 400;
const REFLECT_FAR = 280;          // how far off a lamp is thrown back by a wet road (m)
const REFLECT_I = 8;              // how bright, as a lamp's intensity over the square of its distance

// --- the painted style's road ----------------------------------------------------

// What the road is made of in the painted style (render/style.js, the paired
// paints): each material gives its own lit and shade paint (linear RGB) and
// lays the marks of a brush on them by where it is on the road, its
// kilometre and its metres across, so the marks stay on the road as it moves.
// The programs for the other styles have none of this in them.
const PAINT = {
  asphalt: { lit: [0.112, 0.108, 0.096], shade: [0.060, 0.060, 0.076] },
  concrete: { lit: [0.38, 0.37, 0.34], shade: [0.20, 0.205, 0.235] },
  girder: { lit: [0.20, 0.195, 0.185], shade: [0.10, 0.11, 0.15] },
  pier: { lit: [0.38, 0.37, 0.34], shade: [0.20, 0.205, 0.235] },
  portal: { lit: [0.34, 0.33, 0.30], shade: [0.175, 0.18, 0.21] },
  tunnel: { lit: [0.44, 0.42, 0.36], shade: [0.22, 0.23, 0.26] },
  rail: { lit: [0.13, 0.135, 0.14], shade: [0.07, 0.078, 0.105] },
  post: { lit: [0.12, 0.125, 0.13], shade: [0.045, 0.052, 0.08] },
  line: { lit: [0.86, 0.84, 0.78], shade: [0.447, 0.479, 0.577] },
  // The brush on the asphalt: a period of this many metres across and along
  // the road, the share of tone a stroke moves it by, and the wheel paths.
  strokeAcross: 3.5, strokeAlong: 14, strokeAmp: 0.05,
  wheelHalf: 0.25, wheelDark: 0.05,
  // The lines: how far the edge of one strays across (metres) and how much
  // its width changes (share), over 0.7 m; the share of its length that is
  // worn away and the length of a worn stretch (metres, from, and to); how
  // much a dash's length changes (share).
  edgeStray: 0.035, edgeWidth: 0.14, wornShare: 0.06, wornLen: [0.3, 1.2], dashVary: 0.05,
  // The verge's two gravels, and the brush's period across it.
  verge: { period: 2.2, cool: [0.95, 0.98, 1.01], warm: [1.03, 1.0, 0.94] },
  // The water's stains under a parapet's top and the brush on a pier.
  stain: 0.22, wall: 0.12,
  // A pier's foot, and the share of its height it takes to the full tone.
  pierFoot: 0.80, pierRise: 0.55,
};
const glsl3 = (a) => `vec3(${a.map((x) => x.toFixed(4)).join(', ')})`;
const strokeU = { value: null };

// --- the surfaces of the road in the other styles ----------------------------------

// What the real style (and the styles that are drawn from it) has of the road beyond a
// colour: the grain of the asphalt, the verge's gravel, the pores of the concrete and the
// spangle of the steel (world/surface.js), patches and cracks laid by the metre, the
// polish of the wheel paths, the paint's thickness and wear, water on a road that is
// wet (the world's wet, world/worlds.js) and the lamps in it. All of it is a function of
// where the point is on the road (metres along it, metres across), never of the screen.
const LAMPS_N = 6;               // lamps the wet road throws back, the nearest of them
const CARS_N = 4;                // and the lamps of cars it throws back (render/nightlight.js), the nearest of them
const REFL_N = LAMPS_N + CARS_N;
// What the asphalt's colour is lifted or dropped from, where its tile is not in hand: the mean
// of the stones' tone and of the cavity, and the factor each makes of them at the mean.
const A_TONE = MEANS.asphalt.tone.toFixed(3);
const A_CAV = MEANS.asphalt.cavity.toFixed(3);
const A_TONE_F = (0.62 + 0.8 * MEANS.asphalt.tone).toFixed(3);
const A_CAV_F = (0.55 + 0.45 * MEANS.asphalt.cavity).toFixed(3);
const TIER_K = {                 // wet, puddles, lamps (the grain's own switches are the surfaces held)
  high: [1, 1, 1],
  mid: [1, 0, 0],
  low: [0, 0, 0],
};
// The shared uniforms: the tiles (render/surfaces.js fills them), which of them are
// read, the tier's switches and the lamps, nearest first (RoadRenderer.setLens).
// How much the grain is laid (the tone of the stones, the dark of the gaps, the lean of the surface,
// each as a multiple of what the tile says), and the wet: how many of the low places hold water
// (a lower number, more water), how dark the film makes the asphalt, how rough it leaves it, how
// much brighter the sky is in it (and in the water that lies), the lamps' reflections' brightness.
const GRAIN = { tone: 1.15, cavity: 1.15, slope: 0.6 };
const WET = { puddle: 0.52, dark: 0.74, rough: 0.25, sky: 1.1, water: 0.9 };
const surfU = {
  uSurfAsphaltA: { value: null },
  uSurfAsphaltB: { value: null },
  uSurfVerge: { value: null },
  uSurfConcrete: { value: null },
  uSurfSteel: { value: null },
  uSurfHas: { value: new THREE.Vector4() },
  uRoadK: { value: new THREE.Vector4(1, 1, 1, 0) },
  uSurfLamp: { value: Array.from({ length: REFL_N }, () => new THREE.Vector4()) },
  uSurfLampC: { value: Array.from({ length: REFL_N }, () => new THREE.Vector3()) },
  uSurfLampN: { value: 0 },
};

// Noise by the metre, the width of a line in a pixel, and the frame of a surface from
// how a pair of coordinates runs over the screen (a normal map's, without a tangent in
// the mesh): T along the first, B along the second.
const SURF_PARS = `
float rfHash( float p ) {
  p = fract( p * 0.1031 );
  p *= p + 33.33;
  p *= p + p;
  return fract( p );
}
float rfHash2( vec2 p ) {
  vec3 q = fract( vec3( p.xyx ) * 0.1031 );
  q += dot( q, q.yzx + 33.33 );
  return fract( ( q.x + q.y ) * q.z );
}
float rfNoise( float x ) {
  float i = floor( x );
  float f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( rfHash( i ), rfHash( i + 1.0 ), f );
}
float rfNoise2( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( rfHash2( i ), rfHash2( i + vec2( 1.0, 0.0 ) ), f.x ),
    mix( rfHash2( i + vec2( 0.0, 1.0 ) ), rfHash2( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
// How much of a pixel a line covers: d its distance from the middle of it, w its half
// width, aa the pixel. A line thinner than a pixel is fainter, not lost.
float rfLine( float d, float w, float aa ) {
  float e = max( aa, 0.0015 );
  return ( 1.0 - smoothstep( w - e, w + e, d ) ) * min( 1.0, w / e );
}
mat3 rfFrame( vec3 p, vec3 n, vec2 uv ) {
  vec3 q0 = dFdx( p );
  vec3 q1 = dFdy( p );
  vec2 st0 = dFdx( uv );
  vec2 st1 = dFdy( uv );
  vec3 q1perp = cross( q1, n );
  vec3 q0perp = cross( n, q0 );
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max( dot( T, T ), dot( B, B ) );
  float scale = det == 0.0 ? 0.0 : inversesqrt( det );
  return mat3( T * scale, B * scale, n );
}`;

// The asphalt's own: patches and cracks. A repair is 3 to 12 m of the road's length, in
// one lane, both or a strip across part of one, a few per cent lighter or darker, with a
// bead of sealant round its edges; a crack runs along the road for 7 to 33 m, wandering
// a little, thinning out at its ends. Which cell of the road's length holds one is a hash
// of the cell, so it is the same repair wherever the road is looked at from.
const ASPHALT_REAL_PARS = `
uniform sampler2D uSurfAsphaltA;
uniform sampler2D uSurfAsphaltB;
uniform vec4 uSurfHas;
uniform vec4 uRoadK;
uniform vec4 uSurfLamp[ ${REFL_N} ];
uniform vec3 uSurfLampC[ ${REFL_N} ];
uniform float uSurfLampN;
varying vec4 vSurf;
vec2 rfSl;
float rfCav;
float rfRough;
float rfFilm;
float rfPud;
float rfPatch( float lat, float sL, float blk, float aaL, float aaS, out float seam ) {
  seam = 0.0;
  float cell = floor( sL / 16.0 );
  float id = cell + 256.0 * blk;
  if ( rfHash( id * 1.713 + 11.0 ) > 0.34 ) return 1.0;
  float len = 3.0 + 9.0 * rfHash( id * 2.371 + 3.0 );
  float s0 = cell * 16.0 + ( 16.0 - len ) * rfHash( id * 3.119 + 7.0 );
  float s1 = s0 + len;
  float ty = rfHash( id * 4.337 + 5.0 );
  float l0 = -4.7;
  float l1 = 4.7;
  if ( ty < 0.3 ) {
    l0 = 0.0;
  } else if ( ty < 0.6 ) {
    l1 = 0.0;
  } else if ( ty >= 0.75 ) {
    float c = ( rfHash( id * 5.713 + 1.0 ) * 2.0 - 1.0 ) * 3.0;
    float hw = 0.45 + 0.5 * rfHash( id * 6.131 + 2.0 );
    l0 = c - hw;
    l1 = c + hw;
  }
  float inS = smoothstep( s0 - aaS, s0 + aaS, sL ) * ( 1.0 - smoothstep( s1 - aaS, s1 + aaS, sL ) );
  float inL = smoothstep( l0 - aaL, l0 + aaL, lat ) * ( 1.0 - smoothstep( l1 - aaL, l1 + aaL, lat ) );
  float tone = ( rfHash( id * 7.919 + 4.0 ) < 0.5 ? -1.0 : 1.0 ) * ( 0.06 + 0.04 * rfHash( id * 8.233 + 6.0 ) );
  // The bead of sealant along its edges (not along the edge of the asphalt).
  float eS = min( abs( sL - s0 ), abs( sL - s1 ) );
  float eL = 9.0;
  if ( l0 > -4.6 ) eL = abs( lat - l0 );
  if ( l1 < 4.6 ) eL = min( eL, abs( lat - l1 ) );
  float nearL = smoothstep( l0 - 0.02, l0, lat ) * ( 1.0 - smoothstep( l1, l1 + 0.02, lat ) );
  float nearS = smoothstep( s0 - 0.02, s0, sL ) * ( 1.0 - smoothstep( s1, s1 + 0.02, sL ) );
  seam = max( rfLine( eS, 0.012, aaS ) * nearL, rfLine( eL, 0.012, aaL ) * nearS );
  return 1.0 + tone * inS * inL;
}
float rfCrack( float lat, float sL, float blk, float aaL ) {
  float cell = floor( sL / 64.0 );
  float id = cell + 64.0 * blk;
  if ( rfHash( id * 1.37 + 71.0 ) > 0.8 ) return 0.0;
  float len = 7.0 + 26.0 * rfHash( id * 2.91 + 9.0 );
  float u = sL - ( cell * 64.0 + ( 64.0 - len ) * rfHash( id * 3.53 + 2.0 ) );
  if ( u < 0.0 || u > len ) return 0.0;
  float c0 = ( rfHash( id * 4.77 + 8.0 ) * 2.0 - 1.0 ) * 3.2;
  c0 += c0 < 0.0 ? -0.5 : 0.5;
  float run = 0.16 * sin( u * 0.83 + id ) + 0.07 * sin( u * 2.9 + id * 1.7 );
  float taper = smoothstep( 0.0, 2.5, min( u, len - u ) );
  float w = ( 0.006 + 0.005 * rfNoise( u * 0.7 + id ) ) * taper;
  return rfLine( abs( lat - c0 - run ), w, aaL );
}`;

// Where the asphalt's colour, its roughness and the lean of its grain are worked out
// (in place of the map's), in the real style's program.
const ASPHALT_REAL_MAP = `#include <map_fragment>
// vRoad: x = lateral metres, y = arc length metres, z = 1 where the centre
// line is solid (bends, bridges, tunnels), plus 2 inside a tunnel. vSurf: x =
// metres along from the start of a block of 4096 of them, y = the block, z = how
// wet the world is here, w = how the road leans across (the bank).
float lat = vRoad.x;
float s = vRoad.y;
float sL = vSurf.x;
float blk = vSurf.y;
float tunnelRoad = step( 1.5, vRoad.z );
float solidLine = step( 0.5, mod( vRoad.z, 2.0 ) );
float aaL = fwidth( lat ) * 1.2 + 0.004;
float aaS = fwidth( sL ) * 1.2 + 0.004;
// The grain, in the tile at two sizes (the second a quarter as fine, turned about, so
// that neither repeats to the eye), as far as a stone is more than a few pixels.
float grain = uSurfHas.x * ( 1.0 - smoothstep( 24.0, 64.0, length( vViewPosition ) ) );
vec4 tA = vec4( 0.5, 0.5, ${MEANS.asphalt.rough.toFixed(3)}, 1.0 );
vec4 tA2 = tA;
vec2 tB = vec2( ${A_TONE}, 0.5 );
if ( uSurfHas.x > 0.0 ) {
  tA = texture2D( uSurfAsphaltA, vec2( lat, sL ) / 1.6 );
  tA2 = texture2D( uSurfAsphaltA, vec2( sL, lat ) / 6.4 );
  tB = texture2D( uSurfAsphaltB, vec2( lat, sL ) / 1.6 ).rg;
}
// Stones lighter, the mastic between darker, the tone of the whole what it was.
vec3 col = vec3( 0.0717, 0.0707, 0.0696 );
col *= ( 1.0 + ${GRAIN.tone.toFixed(2)} * ( mix( 0.62, 1.42, mix( ${A_TONE}, tB.r, grain ) ) - ${A_TONE_F} ) ) * ( 1.0 + ${GRAIN.cavity.toFixed(2)} * ( mix( 0.55, 1.0, mix( ${A_CAV}, tA.a, grain ) ) - ${A_CAV_F} ) );
col *= vec3( 1.0 + 0.08 * ( tB.g * 2.0 - 1.0 ) * grain, 1.0, 1.0 - 0.08 * ( tB.g * 2.0 - 1.0 ) * grain );
// Repairs and cracks.
float seam;
col *= rfPatch( lat, sL, blk, aaL, aaS, seam );
col *= 1.0 - 0.3 * seam;
col *= 1.0 - 0.55 * rfCrack( lat, sL, blk, aaL );
// Two wheel paths in each lane, where the tyres go: a little darker, and polished.
float trk = max( max( 1.0 - smoothstep( 0.16, 0.30, abs( lat + 2.8 ) ), 1.0 - smoothstep( 0.16, 0.30, abs( lat + 1.0 ) ) ),
  max( 1.0 - smoothstep( 0.16, 0.30, abs( lat - 1.0 ) ), 1.0 - smoothstep( 0.16, 0.30, abs( lat - 2.8 ) ) ) );
col *= 1.0 - 0.04 * trk;
// The paint. Its edges stray a little, and it wears: in places, in patches, and grain by grain.
float sd = lat < 0.0 ? -1.0 : 1.0;
float eStray = ( rfNoise( sL / 0.64 + sd * 31.7 ) * 2.0 - 1.0 ) * 0.012;
float eEdge = abs( lat ) - ${EDGE_LINE.toFixed(2)} - eStray;
float edge = 1.0 - smoothstep( 0.075 - aaL, 0.075 + aaL, abs( eEdge ) );
float cStray = ( rfNoise( sL / 0.64 + 5.3 + sd * 19.1 ) * 2.0 - 1.0 ) * 0.012;
float cEdge = solidLine > 0.5 ? abs( lat ) - 0.12 - cStray : lat - cStray;
float centre = 1.0 - smoothstep( 0.06 - aaL, 0.06 + aaL, abs( cEdge ) );
float dt = fract( ( s - 1.62 ) / 9.0 + 0.5 ) * 9.0 - 4.5;
centre *= solidLine > 0.5 ? 1.0 : 1.0 - smoothstep( 1.62 - aaS, 1.62 + aaS, abs( dt ) );
paint = max( edge, centre );
// (Each noise of the wear gives way to its mean where a pixel is wider than a fifth of its cell.)
float wearK1 = ( 1.0 - smoothstep( 0.05, 0.25, aaL * 9.0 ) ) * ( 1.0 - smoothstep( 0.05, 0.25, aaS * 7.0 ) );
float wearK2 = ( 1.0 - smoothstep( 0.05, 0.25, aaL * 31.0 ) ) * ( 1.0 - smoothstep( 0.05, 0.25, aaS * 23.0 ) );
float wearN = mix( 0.5, rfNoise2( vec2( lat * 9.0, sL * 7.0 ) ), wearK1 ) * 0.55 + mix( 0.5, rfNoise2( vec2( lat * 31.0, sL * 23.0 ) ), wearK2 ) * 0.45;
float wear = smoothstep( 0.42, 0.82, wearN * 0.7 + rfHash( floor( sL / 5.0 ) * 1.91 + blk * 7.3 ) * 0.45 ) * 0.85;
float paintA = paint * ( 1.0 - wear );
// The wet: a film over all of it, and water lying in the low places, along the low
// side of a road that leans and in the ruts, in patches along the road.
float wetV = vSurf.z * uRoadK.x * ( 1.0 - tunnelRoad );
float film = smoothstep( 0.0, 0.55, wetV );
float pud = 0.0;
if ( uRoadK.y > 0.5 ) {
  float low = clamp( vSurf.w * 40.0, -1.0, 1.0 );
  float lowBias = 0.42 + 0.58 * smoothstep( 0.5, 4.3, lat * sign( low ) ) * abs( low ) + 0.32 * trk;
  float lvl = ( rfNoise2( vec2( lat * 0.8, sL * 0.26 ) ) * 0.5 + rfNoise2( vec2( lat * 2.6, sL * 0.9 ) ) * 0.3 + rfNoise2( vec2( lat * 7.0, sL * 2.6 ) ) * 0.2 ) * lowBias;
  float lvlE = fwidth( lvl ) * 1.5 + 0.015;
  float lvlAt = ${WET.puddle.toFixed(2)} - 0.5 * wetV;
  // (Past 60 m the puddles give way to the film: their edges are finer than a pixel there and would crawl.)
  pud = smoothstep( lvlAt - lvlE, lvlAt + lvlE, lvl ) * smoothstep( 0.1, 0.35, wetV ) * ( 1.0 - smoothstep( 60.0, 150.0, length( vViewPosition ) ) );
}
col *= mix( 1.0, ${WET.dark.toFixed(2)}, film ) * mix( 1.0, 0.7, pud );
rfFilm = film;
rfPud = pud;
rfCav = mix( 1.0, min( 1.0, tA.a / ${(MEANS.asphalt.cavity + 0.067).toFixed(3)} ), grain );
// What leans the surface: the grain at its two sizes (less where the tyres have
// polished it, where water has filled it, and under paint), and the paint's own edge, 2 mm up.
rfSl = ( ( tA.rg * 2.0 - 1.0 ) + 0.45 * ( tA2.gr * 2.0 - 1.0 ) ) * ( ${(GRAIN.slope / 0.6).toFixed(3)} ) * grain;
rfSl *= ( 1.0 - 0.5 * trk ) * ( 1.0 - 0.45 * film ) * ( 1.0 - pud ) * ( 1.0 - 0.6 * paintA );
float eE = clamp( ( abs( eEdge ) - ( 0.075 - aaL ) ) / ( 2.0 * aaL ), 0.0, 1.0 );
float cE = clamp( ( abs( cEdge ) - ( 0.06 - aaL ) ) / ( 2.0 * aaL ), 0.0, 1.0 );
rfSl.x -= 0.002 * ( 6.0 * eE * ( 1.0 - eE ) / ( 2.0 * aaL ) * ( eEdge > 0.0 ? 1.0 : -1.0 ) * sd * ( 1.0 - wear )
  + 6.0 * cE * ( 1.0 - cE ) / ( 2.0 * aaL ) * ( cEdge > 0.0 ? 1.0 : -1.0 ) * ( solidLine > 0.5 ? sd : 1.0 ) * ( 1.0 - wear ) * ( solidLine > 0.5 ? 1.0 : 1.0 - smoothstep( 1.62 - aaS, 1.62 + aaS, abs( dt ) ) ) );
// The roughness: the tile's grain, the wheel paths polished, the paint, water.
float rr = mix( ${MEANS.asphalt.rough.toFixed(3)}, tA.b, uSurfHas.x );
rr = mix( rr, 0.62, trk );
rr = mix( rr, 0.6, paintA );
rr = mix( rr, ${WET.rough.toFixed(2)}, film );
rr = mix( rr, 0.05, pud );
rfRough = rr;
diffuseColor.rgb = mix( col, vec3( 0.86, 0.85, 0.80 ) * mix( 0.78, 1.0, rfCav ) * mix( 1.0, 0.85, film ), paintA * 0.92 );`;

// The light of the real style's asphalt that three has no place for: the sky in the
// water over a wet road, the lamps in it (the specular light of the nearest, as a
// lamp a few tens of centimetres across is seen in a surface that is rough, a long
// smear of light toward the lens, or smooth, the lamp itself), and the beads in the
// paint, which send the headlamps' light back along the way it came.
const ASPHALT_REAL_LIGHT = `{
#if defined( RE_IndirectSpecular )
  radiance *= 1.0 + ${WET.sky.toFixed(2)} * rfFilm + ${WET.water.toFixed(2)} * rfPud;
#endif
  if ( uRoadK.z > 0.5 && uSurfLampN > 0.5 && tunnelRoad < 0.5 ) {
    PhysicalMaterial lm = material;
    vec3 rfP = cameraPosition + geometryPosition * mat3( viewMatrix );
    for ( int i = 0; i < ${REFL_N}; i++ ) {
      if ( float( i ) >= uSurfLampN ) break;
      vec3 toL = uSurfLamp[ i ].xyz - rfP;
      float d2 = max( dot( toL, toL ), 1.0 );
      vec3 Lv = normalize( ( viewMatrix * vec4( toL, 0.0 ) ).xyz );
      lm.roughness = min( material.roughness + 0.5 / sqrt( d2 ), 1.0 );
      reflectedLight.directSpecular += BRDF_GGX( Lv, geometryViewDir, geometryNormal, lm ) * saturate( dot( geometryNormal, Lv ) )
        * uSurfLampC[ i ] * ( uSurfLamp[ i ].w / d2 ) * uSpecK;
    }
  }
#if NUM_SPOT_LIGHTS > 0
  {
    IncidentLight rl;
    getSpotLightInfo( spotLights[ 0 ], geometryPosition, rl );
    reflectedLight.directDiffuse += rl.color * diffuseColor.rgb * RECIPROCAL_PI * saturate( dot( geometryNormal, rl.direction ) )
      * paintA * 2.0 * pow( max( dot( rl.direction, geometryViewDir ), 0.0 ), 120.0 ) / uBeamLevel;
    // The dipped beam's light on the road: it comes in at a graze, and a rough road takes that
    // as if it came down more steeply, and the light on a square metre of it has a ceiling (render/headbeam.js).
    vec3 eb = rl.color * uBeamRoad;
    float em = max( max( eb.r, eb.g ), max( eb.b, 1e-5 ) );
    eb *= ( 1.0 - exp( - em / uBeamSat ) ) * uBeamSat / em;
    reflectedLight.directDiffuse += eb * diffuseColor.rgb * RECIPROCAL_PI;
  }
#endif
}`;



// The painted style's lights: a lamp's pool of light on the road is an ellipse
// with a clear edge (out to this share of the pool's square radius) in one flat
// colour, and a ring beyond it as bright as this at its edge, fading out; its
// glare is a disc (the share of the point's square radius), at this level, with
// a ring of this much round it.
const POOL = { edge: 0.5, ring: 0.3, level: 0.8 };
const GLARE = { core: 0.2, ring: 0.25, level: 0.9 };

// Shared by the road's materials in the painted style's program.
const PAINT_PARS = `
uniform sampler2D uStroke;
uniform float uHand;
float rdHash( float p ) {
  p = fract( p * 0.1031 );
  p *= p + 33.33;
  p *= p + p;
  return fract( p );
}
float rdNoise( float x ) {
  float i = floor( x );
  float f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( rdHash( i ), rdHash( i + 1.0 ), f );
}`;
// A parapet's concrete in the real style: poured against boards, in panels 0.6 m deep
// with a joint (a groove) between them, pores and the grain of the boards (the tile),
// the rain's streaks under the top, and the mud thrown up at the foot. Under the top,
// metres down the wall (vStain.x) and along the road (its s), set the whole of it.
const CONCRETE_REAL = {
  vertex: { pars: 'attribute vec2 aStain;\nvarying vec2 vStain;\nvarying float vStainS;', body: 'vStain = aStain;\nvStainS = mod( aStain.y, 4096.0 );' },
  pars: `
uniform sampler2D uSurfConcrete;
varying vec2 vStain;
varying float vStainS;
vec2 cnQ;
vec2 cnSl;
float cnR;`,
  map: `{
  float cd = vStain.x;
  float cs = vStainS;
  float cnK = uSurfHas.z * ( 1.0 - smoothstep( 22.0, 60.0, length( vViewPosition ) ) );
  cnQ = vec2( cs, cd );
  vec4 ct = vec4( 0.5, 0.5, ${MEANS.concrete.rough.toFixed(3)}, 1.0 );
  if ( uSurfHas.z > 0.0 ) ct = texture2D( uSurfConcrete, cnQ / 1.6 );
  float dd = ( fract( cd / 0.6 + 0.5 ) - 0.5 ) * 0.6;
  float joint = rfLine( abs( dd ), 0.004, fwidth( cd ) * 1.2 + 0.002 ) * smoothstep( 0.06, 0.2, cd );
  float stainN = rfNoise( cs / 0.3 ) * 0.6 + rfNoise( cs / 0.11 + 9.0 ) * 0.4;
  float stainRun = 0.5 + rfNoise( cs / 0.5 + 3.0 );
  float stain = smoothstep( 0.42, 0.66, stainN ) * smoothstep( 0.02, 0.12, cd ) * ( 1.0 - smoothstep( 0.3, 1.3, cd * stainRun ) );
  float mud = smoothstep( 0.62, 0.95, cd ) * ( 0.55 + 0.45 * rfNoise2( vec2( cs / 0.22, cd / 0.09 ) ) );
  diffuseColor.rgb *= mix( 1.0, mix( 0.78, 1.2, ct.a ), cnK ) * ( 1.0 - 0.22 * stain - 0.2 * joint );
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.55, 0.47, 0.38 ), mud );
  cnSl = ( ct.rg * 2.0 - 1.0 ) * cnK;
  cnSl.y += 0.5 * sign( dd ) * joint;
  cnR = mix( 0.88, ct.b, uSurfHas.z );
  cnR = mix( cnR, 0.72, stain * 0.6 );
  cnR = min( cnR + 0.08 * mud, 1.0 );
}`,
  rough: 'roughnessFactor = cnR;',
  normal: `{
  mat3 cnFr = rfFrame( - vViewPosition, normal, cnQ );
  normal = normalize( normal - cnFr[ 0 ] * cnSl.x - cnFr[ 1 ] * cnSl.y );
}`,
};

// Galvanized steel in the real style, the beams and the posts of a guardrail: crystals of
// zinc and the scratches of the rolling (the tile, seen along the beam, s, and up it,
// v), a bolt at each post, and the dirt of the road thrown up at the posts' feet. A post
// has 10 m added to its v (it is not the beam); what has no place on a beam is set at 1.5.
const RAIL_REAL = {
  key: 'steel',
  vertex: { pars: 'attribute vec2 aRail;\nvarying vec2 vRail;', body: 'vRail = vec2( mod( aRail.x, 4096.0 ), aRail.y );' },
  pars: `
uniform sampler2D uSurfSteel;
varying vec2 vRail;
vec2 stSl;
float stRough;
float stBolt;`,
  map: `{
  float stPost = step( 5.0, vRail.y );
  vec2 stQ = vec2( vRail.x, vRail.y - 10.0 * stPost );
  float stK = uSurfHas.w * ( 1.0 - smoothstep( 18.0, 55.0, length( vViewPosition ) ) );
  vec4 stT = vec4( 0.5, 0.5, ${MEANS.steel.rough.toFixed(3)}, 1.0 );
  if ( uSurfHas.w > 0.0 ) stT = texture2D( uSurfSteel, stQ / 1.6 );
  vec2 bq = vec2( ( fract( stQ.x / 4.0 + 0.5 ) - 0.5 ) * 4.0, stQ.y - 0.68 );
  stBolt = rfLine( length( bq ), 0.012, fwidth( stQ.x ) + fwidth( stQ.y ) + 0.002 ) * ( 1.0 - stPost ) * step( 0.4, stQ.y ) * step( stQ.y, 0.9 );
  diffuseColor.rgb *= mix( 1.0, mix( 0.82, 1.14, stT.a ), uSurfHas.w ) * ( 1.0 - 0.45 * stBolt ) * mix( 0.6, 1.0, smoothstep( -0.1, 0.35, stQ.y ) );
  stSl = ( stT.rg * 2.0 - 1.0 ) * stK - bq / 0.012 * 0.6 * stBolt;
  stRough = ( stT.b - ${MEANS.steel.rough.toFixed(3)} ) * uSurfHas.w;
}`,
  rough: 'roughnessFactor = mix( clamp( roughnessFactor + stRough, 0.05, 1.0 ), 0.55, stBolt );',
  normal: `{
  mat3 stFr = rfFrame( - vViewPosition, normal, vec2( vRail.x, vRail.y - 10.0 * step( 5.0, vRail.y ) ) );
  normal = normalize( normal - stFr[ 0 ] * stSl.x - stFr[ 1 ] * stSl.y );
}`,
};

// A wall's brush: strokes that run up it, by the metres along the wall and
// its height in the world, so they are on the wall whichever way it faces.
// The floating origin's share of the metres is taken to its place in the
// texture on its own, so that what changes from pixel to pixel is the few
// tens of metres of the lens to the wall, not a thousand of them.
const WALL_BRUSH = `
vec3 wallR = cameraPosition + ( - vViewPosition ) * mat3( viewMatrix );
vec3 wallN = normalize( vNormal ) * mat3( viewMatrix );
vec2 wallT = normalize( vec2( - wallN.z, wallN.x ) + vec2( 1e-4 ) );
float wallK = texture2D( uStroke, vec2( dot( wallR.xz, wallT ) + mod( dot( uOriginAbs.xz, wallT ), ${PAINT.strokeAlong.toFixed(1)} ),
  wallR.y + mod( uOriginAbs.y, ${PAINT.strokeAlong.toFixed(1)} ) ) / ${PAINT.strokeAlong.toFixed(1)} ).r - 0.5;`;

// A material of the road with paints of its own in the painted style. `body`
// runs where the paint is worked out and sets stOwnLit and stOwnShade
// (which start as the paints given); `vertex` gives a varying its value.
// Nothing is added to the program of any other style.
function painted(mat, name, paints, { vertex = null, pars = '', body = '', real = null } = {}) {
  mat.userData.paints = paints;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(mat, shader, renderer);
    // Both kinds of program take the same uniforms: three keeps those of the
    // program built last for the material, whichever kind is drawn.
    shader.uniforms.uStroke = strokeU;
    if (real) Object.assign(shader.uniforms, surfU);
    if (!pairProgram.on) {
      if (real) grained(shader, real);
      return;
    }
    if (vertex) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${vertex.pars}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertex.body}`);
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PAINT_PARS}\n${pars}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\nstOwnLit = uPairLit * uDuskOwn;\nstOwnShade = uPairShade;\n${body}`);
  };
  // Each has a program of its own only where there is something in it.
  const below = mat.customProgramCacheKey;
  mat.customProgramCacheKey = () => (below ? below.call(mat) : '') + (pairProgram.on ? '|painted-' + name : real ? '|real-' + (real.key || name) : '');
  return mat;
}

// What a material of the road has of its own in the real style's program, where it has
// paints of its own in the painted one (painted below): `vertex` {pars, body}, and in the
// fragment `pars`, `map` (after the map's), `rough` and `normal` (after theirs).
function grained(shader, g) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${g.vertex.pars}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${g.vertex.body}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nuniform vec4 uRoadK;\nuniform vec4 uSurfHas;\n${SURF_PARS}\n${g.pars}`)
    .replace('#include <map_fragment>', `#include <map_fragment>\n${g.map}`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${g.rough}`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${g.normal}`);
}

// --- materials ----------------------------------------------------------------

// How much of a bore's own lamplight the lens sees: all of it from inside, or
// out in the dark; out in the daylight the eye is set for the day and a bore
// is a dark hole with its lamps in it (RoadRenderer.setInside).
const boreLamp = { value: 1 };

// The verge's gravel in the real style: the tile of stones laid by the world's metres,
// lighter and darker stone, the gaps dark, damp where the world is.
const VERGE_REAL_PARS = `
uniform sampler2D uSurfVerge;
uniform vec4 uSurfHas;
uniform vec4 uRoadK;
vec2 vgQ;
vec2 vgSl;
float vgRough;`;
const VERGE_REAL_MAP = `{
  float vgK = uSurfHas.y * ( 1.0 - smoothstep( 22.0, 58.0, length( vViewPosition ) ) );
  vgQ = mod( vVergeXZ + uWorldOrigin, 1024.0 ) / 1.6;
  vec4 vgT = vec4( 0.5, 0.5, 1.0, ${MEANS.verge.cavity.toFixed(3)} );
  if ( uSurfHas.y > 0.0 ) vgT = texture2D( uSurfVerge, vgQ );
  float vgFilm = smoothstep( 0.0, 0.55, worldPar( 3 ).w * uRoadK.x );
  diffuseColor.rgb *= mix( 1.0, mix( 0.4, 1.24, vgT.a ), vgK ) * mix( 1.0, 0.72, vgFilm );
  vgSl = ( vgT.rg * 2.0 - 1.0 ) * vgK * ( 1.0 - 0.35 * vgFilm );
  vgRough = mix( mix( 1.0, vgT.b, uSurfHas.y ), 0.5, vgFilm );
}`;

// The verge is the gravel of the world it is in, the colour the terrain gives
// its own verge beyond it (render/terrain.js), so in a world of black basalt
// or cave dust it is not a band of alpine grit.
function vergeMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  mat.onBeforeCompile = (shader) => {
    const paintOn = pairProgram.on;
    Object.assign(shader.uniforms, worldUniforms);
    shader.uniforms.uStroke = strokeU;
    Object.assign(shader.uniforms, surfU);
    shader.uniforms.uJunction = fieldU.uJunction;
    shader.uniforms.uJunctions = fieldU.uJunctions;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec2 vVergeXZ;${paintOn ? '\nattribute vec2 aVerge;\nvarying vec2 vVergeRS;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vVergeXZ = (modelMatrix * vec4(transformed, 1.0)).xz;${paintOn ? '\nvVergeRS = aVerge;' : ''}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vVergeXZ;
${paintOn ? 'varying vec2 vVergeRS;\n' + PAINT_PARS : SURF_PARS + VERGE_REAL_PARS}
${JUNCTION_PARS}
${WORLD_GLSL}
float vergeHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vergeNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(vergeHash(i), vergeHash(i + vec2(1.0, 0.0)), f.x),
             mix(vergeHash(i + vec2(0.0, 1.0)), vergeHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`)
      .replace('#include <map_fragment>', paintOn ? `#include <map_fragment>
worldAt(vVergeXZ + uWorldOrigin);
// Two gravels laid in strokes, by the metres across the verge and along the road.
vec3 gravel = worldPal(${PAL.gravel});
float gravelK = smoothstep(0.2, 0.8, texture2D(uStroke, vec2(vVergeRS.x / ${PAINT.verge.period.toFixed(2)}, vVergeRS.y / ${(PAINT.verge.period * 4).toFixed(2)})).r);
diffuseColor.rgb = gravel * mix(${glsl3(PAINT.verge.cool)}, ${glsl3(PAINT.verge.warm)}, mix(0.5, gravelK, uHand));
${JUNCTION_MAP}` : `#include <map_fragment>
worldAt(vVergeXZ + uWorldOrigin);
// Grit: two scales of noise, the fine one fading out before it would shimmer.
vec2 gq = mod(vVergeXZ + uWorldOrigin, 1024.0);
float fine = 1.0 - smoothstep(0.08, 0.3, fwidth(gq.x) + fwidth(gq.y));
float grit = vergeNoise(gq * 1.3) * (1.0 - 0.45 * fine) + vergeNoise(gq * 4.7) * 0.45 * fine;
diffuseColor.rgb = worldPal(${PAL.gravel}) * (0.76 + 0.28 * grit);
${JUNCTION_MAP}
${VERGE_REAL_MAP}`);
    if (!paintOn) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vgRough;')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  mat3 vgFr = rfFrame( - vViewPosition, normal, vgQ );
  normal = normalize( normal - vgFr[ 0 ] * vgSl.x - vgFr[ 1 ] * vgSl.y );
}`);
    }
  };
  mat.customProgramCacheKey = () => 'continuum-verge' + (pairProgram.on ? '-painted' : '');
  return mat;
}

// The asphalt and its lines in the painted style, by metres across (lat) and
// along (s) the road.
const wornP = PAINT.wornShare * 6 / ((PAINT.wornLen[0] + PAINT.wornLen[1]) / 2);
const ASPHALT_PARS = `
float rdWorn( float s, float seed ) {
  float c = floor( s / 6.0 );
  float len = ${PAINT.wornLen[0].toFixed(3)} + ${(PAINT.wornLen[1] - PAINT.wornLen[0]).toFixed(3)} * rdHash( c * 7.31 + seed + 17.0 );
  float at = c * 6.0 + rdHash( c * 5.71 + seed + 9.0 ) * ( 6.0 - ${PAINT.wornLen[1].toFixed(3)} );
  float e = fwidth( s ) + 0.02;
  return step( rdHash( c * 3.17 + seed ), ${wornP.toFixed(4)} * uHand ) * smoothstep( at - e, at + e, s ) * ( 1.0 - smoothstep( at + len - e, at + len + e, s ) );
}`;
const ASPHALT_PAINT = `#include <map_fragment>
// vRoad: x = lateral metres, y = arc length metres, z = 1 where the centre
// line is solid (bends, bridges, tunnels), plus 2 inside a tunnel.
float lat = vRoad.x;
float s = vRoad.y;
float tunnelRoad = step( 1.5, vRoad.z );
float solidLine = step( 0.5, mod( vRoad.z, 2.0 ) );
float brush = texture2D( uStroke, vec2( lat / ${PAINT.strokeAcross.toFixed(3)}, s / ${PAINT.strokeAlong.toFixed(3)} ) ).r - 0.5;
float tone = 1.0 + brush * ${(2 * PAINT.strokeAmp).toFixed(4)} * uHand;
wheel = 0.0;
for ( int i = 0; i < 4; i++ ) {
  float c = ( float( i ) - 1.5 ) * 1.9;
  wheel = max( wheel, 1.0 - smoothstep( ${(PAINT.wheelHalf - 0.05).toFixed(3)}, ${(PAINT.wheelHalf + 0.05).toFixed(3)}, abs( lat - c ) ) );
}
tone *= 1.0 - ${PAINT.wheelDark.toFixed(3)} * uHand * wheel;
float aa = fwidth( lat ) * 1.2 + 0.004;
float sd = lat < 0.0 ? -1.0 : 1.0;
// The edge line: its edge strays a little across, and its width changes, every 0.7 m.
float eStray = ( rdNoise( s / 0.7 + sd * 31.7 ) * 2.0 - 1.0 ) * ${PAINT.edgeStray.toFixed(4)} * uHand;
float eHalf = 0.075 * ( 1.0 + ( rdNoise( s / 0.7 + sd * 11.3 + 57.0 ) * 2.0 - 1.0 ) * ${PAINT.edgeWidth.toFixed(4)} * uHand );
float edge = 1.0 - smoothstep( eHalf - aa, eHalf + aa, abs( abs( lat ) - ${EDGE_LINE.toFixed(2)} - eStray ) );
edge *= 1.0 - rdWorn( s, sd * 3.0 + 7.0 );
// The centre line: two solid lines on a bend, otherwise dashes, each a little different in length.
float cStray = ( rdNoise( s / 0.7 + 5.3 + sd * 19.1 ) * 2.0 - 1.0 ) * ${PAINT.edgeStray.toFixed(4)} * uHand;
float cHalf = 0.06 * ( 1.0 + ( rdNoise( s / 0.7 + 77.0 + sd * 3.0 ) * 2.0 - 1.0 ) * ${PAINT.edgeWidth.toFixed(4)} * uHand );
float cAt = solidLine > 0.5 ? abs( abs( lat ) - 0.12 - cStray ) : abs( lat - cStray );
float centre = 1.0 - smoothstep( cHalf - aa, cHalf + aa, cAt );
float dashLen = 0.36 * ( 1.0 + ( rdHash( floor( s / 9.0 ) * 2.3 + 4.0 ) * 2.0 - 1.0 ) * ${PAINT.dashVary.toFixed(4)} * uHand );
centre *= solidLine > 0.5 ? 1.0 - rdWorn( s, sd * 5.0 + 13.0 ) : step( fract( s / 9.0 ), dashLen );
paint = max( edge, centre );
stOwnLit = mix( uPairLit * tone * uDuskOwn, ${glsl3(PAINT.line.lit)} * uDuskLine, paint );
stOwnShade = mix( uPairShade * tone, ${glsl3(PAINT.line.shade)}, paint );
// What the lamps of a tunnel light up is the road's paint (the pools).
diffuseColor.rgb = stOwnLit * 0.5;`;

function asphaltMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0, envMapIntensity: 0.5 });
  // A painted style lays the asphalt on lighter (render/style.js).
  mat.userData.styleLift = true;
  mat.userData.paints = PAINT.asphalt;
  mat.onBeforeCompile = (shader) => {
    const paintOn = pairProgram.on;
    // Both kinds of program take the same uniforms: three keeps those of the
    // program built last for the material, whichever kind is drawn.
    shader.uniforms.uStroke = strokeU;
    Object.assign(shader.uniforms, surfU);
    shader.uniforms.uBoreLamp = boreLamp;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 aRoad;
varying vec3 vRoad;${paintOn ? '' : '\nattribute vec4 aSurf;\nvarying vec4 vSurf;'}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vRoad = aRoad;${paintOn ? '' : '\nvSurf = aSurf;'}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
${paintOn ? PAINT_PARS + ASPHALT_PARS : SURF_PARS + ASPHALT_REAL_PARS}
uniform float uBoreLamp;
varying vec3 vRoad;
float paint;
float wheel;`)
      .replace('#include <map_fragment>', paintOn ? ASPHALT_PAINT : ASPHALT_REAL_MAP)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
// In a tunnel the vault lamps, one every 7 m, throw pools on the carriageway;
// to a lens out in the daylight they hardly show (uBoreLamp).
float pool = 0.72 + 0.28 * cos(6.2832 * s / 7.0);
totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.82, 0.6) * tunnelRoad * pool * 0.6 * mix(0.1, 1.0, uBoreLamp);`);
    if (paintOn) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(0.94, 0.8, wheel * 0.5);
roughnessFactor = mix(roughnessFactor, 0.6, paint);`);
    } else {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = rfRough;')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  // The grain, the paint's edge and the sealant lean the surface, across and along the road.
  mat3 rfFr = rfFrame( - vViewPosition, normal, vec2( lat, sL ) );
  normal = normalize( normal - rfFr[ 0 ] * rfSl.x - rfFr[ 1 ] * rfSl.y );
}`)
        .replace('#include <lights_fragment_end>', ASPHALT_REAL_LIGHT + '\n#include <lights_fragment_end>')
        .replace('#include <aomap_fragment>', `{
  // The sky's light does not reach into the gaps between the stones.
  reflectedLight.indirectDiffuse *= rfCav;
  reflectedLight.indirectSpecular *= mix( 1.0, rfCav, 0.6 );
}`);
    }
  };
  mat.customProgramCacheKey = () => 'continuum-asphalt' + (pairProgram.on ? '-painted' : '');
  return withSkyScale(withAtmosphere(mat), boreSky, 'tunnelRoad');
}

function tunnelMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xbab4a6, roughness: 0.82, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBoreLamp = boreLamp;
    shader.uniforms.uBlockLiq = styleU.uBlockLiq;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aTube;
varying vec2 vTube;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vTube = aTube;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uBoreLamp;
uniform vec2 uBlockLiq;
varying vec2 vTube;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
// vTube: x = position round the profile (0 at the road edge, 1 at the crown),
// y = arc length. A row of lamps on each shoulder of the vault, and darker
// panels along the lower wall. To a lens out in the daylight (uBoreLamp
// low) the bore is dark and only the lamps show. In the block style a lamp
// is a torch's block, a square of light, in place of a long strip.
float lamp = smoothstep(0.035, 0.0, abs(vTube.x - 0.62)) * step(fract(vTube.y / 7.0), 0.42);
if (uBlockLiq.x > 0.0) {
  float torch = (1.0 - step(0.036, abs(vTube.x - 0.62))) * (1.0 - step(0.4, abs(fract(vTube.y / 7.0) - 0.5) * 7.0));
  lamp = mix(lamp, torch, uBlockLiq.x);
}
totalEmissiveRadiance += vec3(1.0, 0.78, 0.48) * lamp * 9.0 * mix(0.45, 1.0, uBoreLamp);
diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.14, 0.18, vTube.x));
// The lamps wash the vault and walls around them.
float wash = (0.4 + 0.6 * smoothstep(0.55, 0.0, abs(vTube.x - 0.62))) * (0.8 + 0.2 * cos(6.2832 * vTube.y / 7.0));
totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.83, 0.62) * wash * 0.22 * mix(0.1, 1.0, uBoreLamp);`);
  };
  mat.customProgramCacheKey = () => 'continuum-tunnel';
  // In the painted style the lining has the pair of paints given, and the
  // darker lower wall (the panels, which the paints would otherwise leave out).
  painted(mat, 'tunnel', PAINT.tunnel, {
    body: `
float panel = mix(0.55, 1.0, smoothstep(0.14, 0.18, vTube.x));
stOwnLit *= panel;
stOwnShade *= panel;`,
  });
  return withSkyScale(withAtmosphere(mat), boreSky);
}

// --- geometry helpers -----------------------------------------------------------

class Builder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.extra = [];
    this.sun = [];
    this.idx = [];
    this.n = 0;
    // Sun visibility stamped on every vertex made until it is changed.
    this.sunNow = 1;
  }

  vert(x, y, z, nx, ny, nz, e0 = 0, e1 = 0, e2 = 0) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.extra.push(e0, e1, e2);
    this.sun.push(this.sunNow);
    return this.n++;
  }

  quad(a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  }

  geometry(extraName = null, extraSize = 3) {
    if (!this.n) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aSun', new THREE.Float32BufferAttribute(this.sun, 1));
    if (extraName) {
      const e = extraSize === 3 ? this.extra : this.extra.filter((_, i) => i % 3 < extraSize);
      g.setAttribute(extraName, new THREE.Float32BufferAttribute(e, extraSize));
    }
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// The geometries of several chunks as one, each moved by (dx, dz) from the
// chunk's anchor to the span's. Every chunk's own vertices stay its own, so
// the normals and edges it was given are the ones it keeps.
function joinGeometries(parts) {
  let verts = 0;
  let ids = 0;
  for (const { geo } of parts) {
    verts += geo.getAttribute('position').count;
    ids += geo.index.count;
  }
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(parts[0].geo.attributes)) {
    const size = parts[0].geo.getAttribute(name).itemSize;
    const data = new Float32Array(verts * size);
    let at = 0;
    for (const { geo, dx, dz } of parts) {
      const a = geo.getAttribute(name);
      data.set(a.array, at);
      if (name === 'position') {
        for (let k = at; k < at + a.array.length; k += 3) {
          data[k] += dx;
          data[k + 2] += dz;
        }
      }
      at += a.array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(data, size));
  }
  const index = new (verts > 65535 ? Uint32Array : Uint16Array)(ids);
  let at = 0;
  let base = 0;
  for (const { geo } of parts) {
    const ix = geo.index.array;
    for (let k = 0; k < ix.length; k++) index[at + k] = ix[k] + base;
    at += ix.length;
    base += geo.getAttribute('position').count;
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

// How wet the world is where a point is (world/worlds.js, wet): the world's own, and across a
// border between two the way the one turns into the other.
const wetNow = { u: 0, a: 0, b: 0, t: 0, la: 0, lb: 0 };
function wetAt(land, ax, az) {
  const map = land.worlds;
  if (!map) return 0;
  const w = map.at(ax, az, wetNow);
  const a = WORLDS[w.a].wet || 0;
  const b = WORLDS[w.b].wet || 0;
  return a + (b - a) * w.t;
}

// A frame per sample: position relative to the chunk anchor, forward and left
// unit vectors, the running surface height and its bank, and how much sun
// reaches it past the mountains (none inside a tunnel).
function frames(road, i0, i1, ax0, az0, land, sun) {
  const out = [];
  for (let i = i0; i <= i1; i++) {
    const p = road.samples.get(i);
    const fx = Math.cos(p.theta);
    const fz = Math.sin(p.theta);
    out.push({
      i, s: i * STEP, x: p.ax - ax0, z: p.az - az0, y: p.y,
      fx, fz, lx: -fz, lz: fx, bank: p.bank, kind: p.kind, kappa: p.kappa,
      gl: p.gl, gr: p.gr, wet: wetAt(land, p.ax, p.az),
      sun: p.kind === TUNNEL ? 0 : sunVisibility(land, p.ax, p.az, p.y, sun),
    });
  }
  return out;
}

// Height of the running surface at a lateral offset.
const surf = (f, lat) => f.y - f.bank * lat;

// Extrude a cross-section (lat, up) along a run of frames. The profile is
// listed with the solid on its right, so each edge's outward normal is
// (-du, dl). Every edge gets its own vertices so corners stay crisp; `mirror`
// repeats the section on the other side of the centreline.
function extrude(b, fr, profile, mirror, tag) {
  for (const side of mirror ? [1, -1] : [1]) {
    for (let e = 0; e < profile.length - 1; e++) {
      const [l0, u0] = profile[e];
      const [l1, u1] = profile[e + 1];
      const dl = l1 - l0;
      const du = u1 - u0;
      const len = Math.hypot(dl, du) || 1;
      const nLat = (-du / len) * side;
      const nUp = dl / len;
      let pa = -1;
      let pb = -1;
      for (const f of fr) {
        b.sunNow = f.sun;
        const la = l0 * side;
        const lb = l1 * side;
        const nx = f.lx * nLat;
        const nz = f.lz * nLat;
        const ta = tag ? tag(e, 0) : 0;
        const tb = tag ? tag(e, 1) : 0;
        const a = b.vert(f.x + f.lx * la, surf(f, la) + u0, f.z + f.lz * la, nx, nUp, nz, ta, f.s);
        const c = b.vert(f.x + f.lx * lb, surf(f, lb) + u1, f.z + f.lz * lb, nx, nUp, nz, tb, f.s);
        if (pa >= 0) {
          if (side > 0) b.quad(pa, pb, c, a);
          else b.quad(pa, a, c, pb);
        }
        pa = a;
        pb = c;
      }
    }
  }
}

// The tunnel's inner section, from the road edge up the wall and over the vault
// to the crown, listed so the solid (the rock) is on the right.
function tunnelProfile() {
  const P = HALF_PAVED;
  const prof = [[P + 0.05, 0.0], [P + 0.45, 0.25], [P + 0.55, 1.1], [5.45, 4.1]];
  for (let k = 1; k <= 8; k++) {
    const t = (k / 8) * Math.PI * 0.5;
    prof.push([5.45 * Math.cos(t), 4.1 + (TUNNEL_H - 4.1) * Math.sin(t)]);
  }
  return prof.reverse();
}
const TUBE = tunnelProfile();
// The verge, from the asphalt edge to the foot of the cut or the top of the
// fill (the metres across it go in the vertices, for the painted style).
const VERGE = [[HALF_PAVED, -0.02], [5.3, -0.12], [HALF_FLAT, -0.2], [HALF_FLAT + 0.3, -0.9]];
// The parapet and the deck's edge on a viaduct, and how far below the parapet's
// top each point of it is goes in the vertices (the rain's stains).
const PARAPET = [
  [HALF_PAVED - 0.01, 0.0], [HALF_PAVED + 0.22, 0.06], [HALF_PAVED + 0.36, 0.32], [HALF_PAVED + 0.42, 0.95],
  [HALF_PAVED + 0.66, 0.95], [HALF_PAVED + 0.72, 0.0], [HALF_PAVED + 0.72, -0.42],
];
const PARAPET_TOP = 0.95;

// A box standing on frame f: centred `lat` across and `along` ahead of it,
// from y0 to y1, `ha` metres either way along the road and `hl` across.
// e goes on every vertex (a colour, for the lamps).
function box(b, f, lat, along, y0, y1, ha, hl, e = [0, 0, 0]) {
  const cx = f.x + f.lx * lat + f.fx * along;
  const cz = f.z + f.lz * lat + f.fz * along;
  const c = [[-ha, -hl], [ha, -hl], [ha, hl], [-ha, hl]].map(([u, v]) => [
    cx + f.fx * u + f.lx * v, cz + f.fz * u + f.lz * v,
  ]);
  for (let k = 0; k < 4; k++) {
    const [x0, z0] = c[k];
    const [x1, z1] = c[(k + 1) % 4];
    const l = Math.hypot(z1 - z0, x1 - x0) || 1;
    const nx = (z1 - z0) / l;
    const nz = -(x1 - x0) / l;
    b.quad(b.vert(x0, y0, z0, nx, 0, nz, ...e), b.vert(x1, y0, z1, nx, 0, nz, ...e),
      b.vert(x1, y1, z1, nx, 0, nz, ...e), b.vert(x0, y1, z0, nx, 0, nz, ...e));
  }
  for (const [y, ny] of [[y1, 1], [y0, -1]]) {
    const ids = c.map(([x, z]) => b.vert(x, y, z, 0, ny, 0, ...e));
    if (ny > 0) b.quad(ids[3], ids[2], ids[1], ids[0]);
    else b.quad(ids[0], ids[1], ids[2], ids[3]);
  }
}

// The head of a pole lamp, in its own frame: the pole's top at the origin,
// +x across toward the centreline, +z along the road. An arm out to the
// reach and the housing at its end, underneath which the glare sits.
function lampHeadGeometry() {
  const b = new Builder();
  const F = { x: 0, z: 0, fx: 0, fz: 1, lx: 1, lz: 0 };
  // (aRail: where the steel's grain is read, which for a lamp is nowhere in particular.)
  box(b, F, LAMP_REACH / 2, 0, -0.1, 0, 0.05, LAMP_REACH / 2, [0, 1.5, 0]);
  box(b, F, LAMP_REACH + 0.1, 0, -0.22, -0.08, 0.2, 0.42, [0, 1.5, 0]);
  return b.geometry('aRail', 2);
}

// The pool of light a lamp throws on the asphalt: added on, brightest under
// the head and gone by its edge, and fading out far off, where a real one
// sinks into the haze.
function poolMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: { ...twistU, uPair: styleU.uPair, uPaintInv: styleU.uPaintInv },
    vertexShader: /* glsl */`
${TWIST_PARS}
attribute vec2 aPool;
attribute vec3 aTint;
varying vec2 vPool;
varying vec3 vTint;
varying float vFade;
void main() {
  vPool = aPool;
  vTint = aTint;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vFade = 1.0 - smoothstep(400.0, 1000.0, distance(wp.xyz, cameraPosition));
  gl_Position = projectionMatrix * twistView( viewMatrix * wp );
}`,
    fragmentShader: /* glsl */`
uniform float uPair;
uniform float uPaintInv;
varying vec2 vPool;
varying vec3 vTint;
varying float vFade;
void main() {
  float r2 = dot(vPool, vPool);
  float a = max(0.0, 1.0 - r2);
  vec3 c = vTint * a * a * vFade;
  if (uPair > 0.0) {
    // The painted style's pool: an ellipse with a clear edge, one flat colour
    // as it comes out on the screen, and past the edge a ring that is soft.
    float e = fwidth(r2) * 1.2 + 1e-4;
    float disc = 1.0 - smoothstep(${POOL.edge.toFixed(2)} - e, ${POOL.edge.toFixed(2)} + e, r2);
    float ring = ${POOL.ring.toFixed(2)} * (1.0 - smoothstep(${POOL.edge.toFixed(2)}, 1.0, r2));
    c = mix(c, vTint * mix(ring, 1.0, disc) * vFade * ${POOL.level.toFixed(2)} * uPaintInv, uPair);
  }
  gl_FragColor = vec4(c, 1.0);
}`,
  });
}

// The mouth of a tunnel seen from inside it: daylight, more than an eye
// opened up for the dark can take. A veil of light over the opening, drawn
// only while the lens is in a bore (uInside), brightest from far down the
// tube and thinning as the lens comes out through it.
function mouthMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uInside: { value: 0 }, uColor: { value: new THREE.Color(0xfff2e0).multiplyScalar(2.2) }, ...twistU },
    vertexShader: /* glsl */`
${TWIST_PARS}
attribute vec3 aMouth;
varying float vEdge;
varying float vFar;
void main() {
  vEdge = aMouth.x;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vFar = smoothstep(4.0, 45.0, distance(wp.xyz, cameraPosition));
  gl_Position = projectionMatrix * twistView( viewMatrix * wp );
}`,
    fragmentShader: /* glsl */`
uniform float uInside;
uniform vec3 uColor;
varying float vEdge;
varying float vFar;
void main() {
  gl_FragColor = vec4(uColor * (1.0 - 0.6 * vEdge * vEdge) * vFar * uInside, 1.0);
}`,
  });
}

// A lamp's glare: a soft point that keeps three pixels however far off, so
// the lamps down the road read as a string of lights, dimmed by the haze.
// uHeight is the drawing buffer's height (RoadRenderer.setViewHeight).
function glareMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uHeight: { value: 720 }, fogParams: atmo.fogParams, uPair: styleU.uPair, uPaintInv: styleU.uPaintInv, ...twistU },
    vertexShader: /* glsl */`
${TWIST_PARS}
attribute vec3 aTint;
attribute float aSize;
uniform float uHeight;
uniform vec3 fogParams;
varying vec3 vTint;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * twistView( mv );
  float d = max(-mv.z, 1.0);
  float px = aSize * projectionMatrix[1][1] * uHeight * 0.5 / d;
  vTint = aTint * clamp(px / 3.0, 0.2, 1.0) * exp(-d * fogParams.x * 0.8);
  gl_PointSize = clamp(px, 3.0, 64.0);
}`,
    fragmentShader: /* glsl */`
uniform float uPair;
uniform float uPaintInv;
varying vec3 vTint;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  vec3 c = vTint * exp(-r2 * 5.0);
  if (uPair > 0.0) {
    // The painted style's lamp: a disc of the lamp's colour, flat, with a
    // soft ring round it.
    float m = max(max(vTint.r, vTint.g), max(vTint.b, 1e-3));
    float e = fwidth(r2) * 1.2 + 1e-4;
    float disc = 1.0 - smoothstep(${GLARE.core.toFixed(2)} - e, ${GLARE.core.toFixed(2)} + e, r2);
    float ring = ${GLARE.ring.toFixed(2)} * (1.0 - smoothstep(${GLARE.core.toFixed(2)}, 1.0, r2));
    c = mix(c, vTint / m * min(m, 1.0) * ${GLARE.level.toFixed(2)} * (disc + ring) * uPaintInv, uPair);
  }
  gl_FragColor = vec4(c, 1.0);
}`,
  });
}

// --- the renderer ------------------------------------------------------------

export class RoadRenderer {
  // opts: tier ('high', 'mid' or 'low': how much of the grain, the wet and the lamps' reflections
  // the road has), bakers (the pool of workers that draw the grain's tiles; none, and they are
  // drawn here), sync (a headless run: all of it now).
  constructor(scene, road, corridor, renderer, opts = {}) {
    this.road = road;
    this.corridor = corridor;
    this.bakers = opts.bakers || null;
    this.tier = TIER_K[opts.tier] ? opts.tier : 'high';
    this.surfaces = new RoadSurfaces(surfU, this.tier);
    this._applyTier();
    this.group = new THREE.Group();
    this.group.name = 'road';
    scene.add(this.group);
    this.origin = { x: 0, z: 0 };
    this.chunks = new Map();        // chunk index -> { ax, az, parts }
    this.spans = new Map();         // span index -> { group, ax, az, meshes, dirty }

    strokeU.value = makeRoadStrokeTexture();
    const ds = { side: THREE.DoubleSide };
    const lit = (m) => withSunMask(withAtmosphere(m), true);
    this.mat = {
      asphalt: withSunMask(asphaltMaterial(), true),
      verge: lit(vergeMaterial()),
      concrete: lit(painted(new THREE.MeshStandardMaterial({ color: 0xa3a097, roughness: 0.88 }), 'concrete', PAINT.concrete, {
        vertex: { pars: 'attribute vec2 aStain;\nvarying vec2 vStain;', body: 'vStain = aStain;' },
        pars: 'varying vec2 vStain;',
        real: CONCRETE_REAL,
        // Under the parapet's top the rain runs down in streaks, by the metres
        // along the road, some longer than others.
        body: `
float stainN = rdNoise(vStain.y / 0.3) * 0.6 + rdNoise(vStain.y / 0.11 + 9.0) * 0.4;
float stainRun = 0.5 + rdNoise(vStain.y / 0.5 + 3.0);
float stain = smoothstep(0.42, 0.66, stainN) * smoothstep(0.02, 0.12, vStain.x) * (1.0 - smoothstep(0.3, 1.3, vStain.x * stainRun));
stOwnLit *= 1.0 - ${PAINT.stain.toFixed(3)} * uHand * stain;
stOwnShade *= 1.0 - ${PAINT.stain.toFixed(3)} * uHand * stain;`,
      })),
      concreteDark: lit(painted(new THREE.MeshStandardMaterial({ color: 0x7a776f, roughness: 0.92 }), 'girder', PAINT.girder)),
      portal: lit(painted(new THREE.MeshStandardMaterial({ color: 0x9c988e, roughness: 0.9, ...ds }), 'portal', PAINT.portal)),
      rail: lit(painted(new THREE.MeshStandardMaterial({ color: 0xc2c6ca, roughness: 0.32, metalness: 0.85, ...ds }), 'rail', PAINT.rail, { real: RAIL_REAL })),
      post: lit(painted(new THREE.MeshStandardMaterial({ color: 0x8e9296, roughness: 0.5, metalness: 0.6, ...ds }), 'post', PAINT.post, { real: RAIL_REAL })),
      pier: lit(painted(new THREE.MeshStandardMaterial({ color: 0xa3a097, roughness: 0.88 }), 'pier', PAINT.pier, {
        vertex: { pars: 'varying float vPierH;', body: 'vPierH = position.y + 1.0;' },
        pars: 'varying float vPierH;',
        // From the foot, darker, to full at a share of its height; and the brush up it.
        body: `${WALL_BRUSH}
float pierTone = mix(${PAINT.pierFoot.toFixed(3)}, 1.0, clamp(vPierH / ${PAINT.pierRise.toFixed(3)}, 0.0, 1.0)) * (1.0 + wallK * ${(2 * PAINT.wall).toFixed(4)} * uHand);
stOwnLit *= pierTone;
stOwnShade *= pierTone;`,
      })),
      tunnel: withSunMask(tunnelMaterial(), true),
      pool: poolMaterial(),
      glare: glareMaterial(),
      mouth: mouthMaterial(),
    };
    // The tube is seen from inside; rendering both faces keeps it closed
    // whichever way a stretch of it was wound.
    this.mat.tunnel.side = THREE.DoubleSide;
    // The meshes of a span, in the order they are drawn: geometry kept per
    // chunk, material, and whether it casts a shadow.
    this._layers = [
      ['asphalt', this.mat.asphalt, false],
      ['verge', this.mat.verge, false],
      ['concrete', this.mat.concrete, true],
      ['dark', this.mat.concreteDark, true],
      ['portal', this.mat.portal, true],
      ['rail', this.mat.rail, true],
      ['post', this.mat.post, true],
      ['tube', this.mat.tunnel, true],
      ['mouth', this.mat.mouth, false],
    ];
    this.land = corridor.land;
    this.sunDir = new THREE.Vector3(0.5, 0.6, 0.5).normalize();

    // Piers: one unit-tall wall pier instanced and stretched to the ground.
    const pierGeo = new THREE.BoxGeometry(2.0, 1, 5.2);
    pierGeo.translate(0, -0.5, 0);
    this.pierSun = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PIERS).fill(1), 1);
    pierGeo.setAttribute('aSun', this.pierSun);
    this.piers = new THREE.InstancedMesh(pierGeo, mistPier(this.mat.pier), MAX_PIERS);
    this.piers.count = 0;
    this.piers.castShadow = true;
    this.piers.receiveShadow = true;
    this.piers.frustumCulled = false;
    this.group.add(this.piers);
    this.pierList = [];

    // Lamps over the whole built road: poles (a unit box stretched from foot
    // to head) and heads (the arm and the housing) instanced like the piers,
    // and the glare and the pools of light one buffer each (_syncLamps).
    const poleGeo = new THREE.BoxGeometry(0.18, 1, 0.18);
    poleGeo.translate(0, 0.5, 0);
    poleGeo.setAttribute('aRail', new THREE.BufferAttribute(Float32Array.from({ length: poleGeo.getAttribute('position').count * 2 }, (_, i) => (i % 2 ? 1.5 : 0)), 2));
    this.poleSun = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LAMPS).fill(1), 1);
    poleGeo.setAttribute('aSun', this.poleSun);
    const headGeo = lampHeadGeometry();
    this.headSun = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LAMPS).fill(1), 1);
    headGeo.setAttribute('aSun', this.headSun);
    this.poles = new THREE.InstancedMesh(poleGeo, this.mat.post, MAX_LAMPS);
    this.heads = new THREE.InstancedMesh(headGeo, this.mat.post, MAX_LAMPS);
    for (const m of [this.poles, this.heads]) {
      m.count = 0;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
    }
    // The block style's torches (setTorches): where a world's lamps are torches
    // (its `lamps.torch`), a post one block across and a block that glows on
    // top of it stand where the pole and its arm did; their glare and pool of
    // light are the lamp's own, put at the torch. Made when the style first
    // wants them, so that no other style has them to build.
    this.torchPosts = null;
    this.torchBlocks = null;
    this.torchWood = null;
    this.torchFlame = null;
    this.torchSun = null;
    this.torchStyle = false;    // the lamps with a torch to be are torches
    this.torchShapes = false;   // and the torches have a post and a block, not only their light
    this.torchTier = 'high';
    this._flame = 0;
    this.glare = new THREE.Points(new THREE.BufferGeometry(), this.mat.glare);
    this.pools = new THREE.Mesh(new THREE.BufferGeometry(), this.mat.pool);
    this.pools.renderOrder = 2;
    this.glare.renderOrder = 3;
    for (const m of [this.glare, this.pools]) {
      m.frustumCulled = false;
      m.visible = false;
      this.group.add(m);
    }
    this.lampList = [];
    this._refl = [];                // the lamps the wet road throws back, relative to the origin
    this._rank = new Float64Array(LAMPS_N);   // the lamps nearest the lens: how far (with those behind it set back), which, how far
    this._pick = new Int32Array(LAMPS_N);
    this._near = new Float64Array(LAMPS_N);
    // Every tunnel mouth on the built road, for the land to be cut away at.
    this.portalList = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._sc = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  setOrigin(x, z) {
    this.origin.x = x;
    this.origin.z = z;
    for (const sp of this.spans.values()) sp.group.position.set(sp.ax - x, 0, sp.az - z);
    this._syncPiers();
    this._syncLamps();
  }

  // How much of the grain, the wet and the lamps' reflections the road has (render/quality.js):
  // all of them at high, the grain and the wet film at mid, the road's patches and its paint at
  // low. Nothing is rebuilt; a tile that is wanted and not yet there is asked for.
  setTier(t) {
    if (!TIER_K[t] || t === this.tier) return;
    this.tier = t;
    this.surfaces.setTier(t);
    this._applyTier();
  }

  _applyTier() {
    const k = TIER_K[this.tier];
    surfU.uRoadK.value.set(k[0], k[1], k[2], 0);
    this.surfaces.setTier(this.tier);
    // Where no worker is to be had the tiles are made here, now: a headless run
    // and a page without workers (the first frame has them, which is what the
    // workers' being later is not for).
    if (this.bakers === null) this.surfaces.make();
  }

  // The grain's tiles: asked of a worker, or made here (one a frame) where one has failed; how
  // many are still to come.
  grain() {
    const s = this.surfaces;
    if (!s.pending()) return 0;
    const b = this.bakers;
    if (b && !b.failed) return s.request(b);
    s.asked.clear();
    return s.make(1);
  }

  // The lamps that the road throws back where it is wet, the LAMPS_N that are nearest the lens
  // (those behind it last, and the furthest ones fainter): where the lens is, the way it looks.
  // cars: the lamps of cars it throws back as well, as [{ x, y, z, i, c: [r, g, b] }] at most CARS_N of them (the lamps
  // of the cars' own lights, render/nightlight.js).
  setLens(cam, cars = null) {
    const out = surfU.uSurfLamp.value;
    const col = surfU.uSurfLampC.value;
    const extra = cars && cars.length ? Math.min(cars.length, CARS_N) : 0;
    const on = surfU.uRoadK.value.z > 0 && (this._refl.length > 0 || extra > 0);
    if (!on) {
      surfU.uSurfLampN.value = 0;
      this._nLamps = this._nCars = 0;
      return;
    }
    const p = cam.position;
    cam.getWorldDirection(this._v);
    const al = Math.hypot(this._v.x, this._v.z) || 1;
    const fx = this._v.x / al;
    const fz = this._v.z / al;
    const rank = this._rank;
    const pick = this._pick;
    const near = this._near;
    let n = 0;
    for (let i = 0; i < this._refl.length; i++) {
      const L = this._refl[i];
      const dx = L.x - p.x;
      const dz = L.z - p.z;
      const d = Math.hypot(dx, L.y - p.y, dz);
      if (d > REFLECT_FAR) continue;
      const r = d + (dx * fx + dz * fz < -8 ? 60 : 0);
      if (n === LAMPS_N && r >= rank[n - 1]) continue;
      let k = n < LAMPS_N ? n++ : n - 1;
      while (k > 0 && rank[k - 1] > r) {
        rank[k] = rank[k - 1];
        pick[k] = pick[k - 1];
        near[k] = near[k - 1];
        k--;
      }
      rank[k] = r;
      pick[k] = i;
      near[k] = d;
    }
    for (let i = 0; i < n; i++) {
      const L = this._refl[pick[i]];
      const fade = 1 - THREE.MathUtils.smoothstep(near[i], REFLECT_FAR * 0.65, REFLECT_FAR);
      out[i].set(L.x, L.y, L.z, REFLECT_I * fade);
      col[i].set(L.c[0], L.c[1], L.c[2]);
    }
    for (let i = 0; i < extra; i++) {
      const c = cars[i];
      out[n + i].set(c.x, c.y, c.z, c.i);
      col[n + i].set(c.c[0], c.c[1], c.c[2]);
    }
    this._nLamps = n;
    this._nCars = extra;
    surfU.uSurfLampN.value = n + extra;
  }

  // The cars' lamps are thrown back by the wet road only while the lights of the cars are drawn (they are put away with
  // the cars, and the road holds only its own lamps then).
  showCars(on) {
    surfU.uSurfLampN.value = (this._nLamps || 0) + (on ? this._nCars || 0 : 0);
  }

  // Lamps standing along the built road.
  get lamps() {
    return this.lampList.length;
  }

  // The heads of the pole lamps of the built road, where they shine from, as [{ x, y, z, c: [r, g, b] }] with the
  // origin taken off and the lamp's colour (render/nightlight.js lays the haze of the light under them).
  lampHeads() {
    return this._refl;
  }

  // The n tunnel mouths nearest an absolute point, nearest first.
  portalsNear(ax, az, n) {
    const d = (p) => (p.x - ax) ** 2 + (p.z - az) ** 2;
    return this.portalList.slice().sort((a, b) => d(a) - d(b)).slice(0, n);
  }

  // The drawing buffer's height in pixels, which sizes the lamps' glare.
  setViewHeight(px) {
    this.mat.glare.uniforms.uHeight.value = px;
  }

  // The block style's torches (a world's lamps that say they are torches) in place of
  // its poles, or the poles again; at the low tier only the light of them, no post and no
  // block. The lamps are laid out again when it changes.
  setTorches(on, tier = 'high') {
    const shapes = on && tier !== 'low';
    this.torchTier = tier;
    if (on === this.torchStyle && shapes === this.torchShapes) return;
    if (shapes && !this.torchPosts) this._makeTorches();
    this.torchStyle = on;
    this.torchShapes = shapes;
    this._syncLamps();
  }

  _makeTorches() {
    const lit = (m) => withSunMask(withAtmosphere(m), true);
    this.torchSun = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LAMPS).fill(1), 1);
    const postGeo = new THREE.BoxGeometry(0.3, 1, 0.3);
    postGeo.translate(0, 0.5, 0);
    postGeo.setAttribute('aSun', this.torchSun);
    const flameGeo = new THREE.BoxGeometry(0.46, 0.46, 0.46);
    flameGeo.translate(0, 0.23, 0);
    flameGeo.setAttribute('aSun', this.torchSun);
    this.torchWood = lit(new THREE.MeshStandardMaterial({ color: 0x6b4b2c, roughness: 0.92 }));
    this.torchFlame = lit(new THREE.MeshStandardMaterial({ color: 0xffc070, emissive: 0xff9440, emissiveIntensity: 2.4, roughness: 1 }));
    this.torchPosts = new THREE.InstancedMesh(postGeo, this.torchWood, MAX_LAMPS);
    this.torchBlocks = new THREE.InstancedMesh(flameGeo, this.torchFlame, MAX_LAMPS);
    for (const m of [this.torchPosts, this.torchBlocks]) {
      m.count = 0;
      m.castShadow = m === this.torchPosts;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.visible = false;
      this.group.add(m);
    }
  }

  // Every frame: a torch's block flickers (at the high tier).
  animate(dt) {
    if (!this.torchStyle || !this.torchShapes) return;
    this._flame = (this._flame + dt) % 200;
    const t = this._flame;
    this.torchFlame.emissiveIntensity = this.torchTier === 'high' ? 2.4 + 0.45 * Math.sin(t * 13.1) + 0.3 * Math.sin(t * 7.7 + 1.3) : 2.4;
  }

  // How far the lens is inside a bore (0..1), and how much daylight there is
  // outside (0..1): out in the day a bore is dark to the lens, and from
  // inside its mouth shines.
  setInside(v, daylight = 1) {
    this.mat.mouth.uniforms.uInside.value = v * daylight;
    boreLamp.value = Math.max(v, 1 - daylight);
  }

  // The road past sample i was dropped to be surveyed again (Road.cut):
  // drop every chunk that reaches past it, with its piers, lamps and
  // portals; update() builds them again from the new road.
  cutFrom(i) {
    for (const c of [...this.chunks.keys()]) {
      if ((c + 1) * CHUNK > i) this._drop(c);
    }
    this._join();
    this.pierList = this.pierList.filter((p) => this.chunks.has(p.chunk));
    this.lampList = this.lampList.filter((p) => this.chunks.has(p.chunk));
    this.portalList = this.portalList.filter((p) => this.chunks.has(p.chunk));
    this._syncPiers();
    this._syncLamps();
  }

  // Keep chunks built from just behind the car to far ahead. budget < 0 builds
  // everything at once (start-up and headless captures).
  update(sCar, budget = 3) {
    this.grain();
    const road = this.road;
    const first = Math.max(Math.ceil(road.first / CHUNK) + 1, Math.floor((sCar - BEHIND) / STEP / CHUNK));
    const last = Math.min(Math.floor(road.classified / CHUNK) - 1, Math.floor((sCar + AHEAD) / STEP / CHUNK));
    const near = Math.floor(sCar / STEP / CHUNK);
    const order = [];
    for (let c = first; c <= last; c++) if (!this.chunks.has(c)) order.push(c);
    order.sort((a, b) => Math.abs(a - near) - Math.abs(b - near));
    let built = 0;
    for (const c of order) {
      if (budget >= 0 && built >= budget) break;
      this._build(c);
      built++;
    }
    let dropped = false;
    for (const c of [...this.chunks.keys()]) {
      if (c >= first - 1 && c <= last + 1) continue;
      this._drop(c);
      dropped = true;
    }
    if (built || dropped) {
      this._join();
      this.pierList = this.pierList.filter((p) => this.chunks.has(p.chunk));
      this.lampList = this.lampList.filter((p) => this.chunks.has(p.chunk));
      this.portalList = this.portalList.filter((p) => this.chunks.has(p.chunk));
      this._syncPiers();
      this._syncLamps();
    }
    return order.length - built;
  }

  _build(c) {
    const road = this.road;
    const i0 = c * CHUNK;
    const i1 = i0 + CHUNK;
    const a0 = road.samples.get(i0);
    const ax0 = a0.ax;
    const az0 = a0.az;
    const fr = frames(road, i0, i1, ax0, az0, this.land, this.sunDir);

    // Asphalt across the whole chunk, whatever it stands on, with a crown.
    const asphalt = new Builder();
    const COLS = [-HALF_PAVED, -3.9, -2.6, -1.3, 0, 1.3, 2.6, 3.9, HALF_PAVED];
    let rowPrev = null;
    for (const f of fr) {
      asphalt.sunNow = f.sun;
      const solid = (Math.abs(f.kappa) > 1 / 220 || f.kind !== GROUND ? 1 : 0) + (f.kind === TUNNEL ? 2 : 0);
      const row = COLS.map((lat) => asphalt.vert(
        f.x + f.lx * lat, surf(f, lat) + 0.045 * (1 - (lat / HALF_PAVED) ** 2), f.z + f.lz * lat,
        0, 1, 0, lat, f.s, solid,
      ));
      if (rowPrev) {
        for (let k = 0; k < COLS.length - 1; k++) asphalt.quad(rowPrev[k], rowPrev[k + 1], row[k + 1], row[k]);
      }
      rowPrev = row;
    }
    const ag = asphalt.geometry('aRoad');
    ag.computeVertexNormals();
    // What the real style reads of the surface where it is on the road: the metres along it
    // from a block of 4096 (the texture and the cells of repairs and cracks repeat in such a
    // block, and the single floats keep their fineness), which block, how wet, which way it leans.
    const block = Math.floor(fr[0].s / 4096);
    const grain = new Float32Array(fr.length * COLS.length * 4);
    let at = 0;
    for (const f of fr) {
      for (let c = 0; c < COLS.length; c++) {
        grain[at++] = f.s - 4096 * block;
        grain[at++] = block;
        grain[at++] = f.wet;
        grain[at++] = f.bank;
      }
    }
    ag.setAttribute('aSurf', new THREE.BufferAttribute(grain, 4));

    // Runs of one structure kind. A run includes the first frame of the next
    // kind, so the pieces meet without a gap.
    const runs = [];
    let start = 0;
    for (let k = 1; k <= fr.length; k++) {
      if (k === fr.length || fr[k].kind !== fr[start].kind) {
        runs.push([start, Math.min(k, fr.length - 1), fr[start].kind]);
        start = k;
      }
    }

    const verge = new Builder();
    const concrete = new Builder();
    const dark = new Builder();
    const portal = new Builder();
    const rail = new Builder();
    const post = new Builder();
    const tube = new Builder();

    for (const [a, b, kind] of runs) {
      const run = fr.slice(a, b + 1);
      if (run.length < 2) continue;
      if (kind === GROUND) {
        // Verge: gravel from the asphalt edge to the foot of the cut or the
        // top of the fill, a little proud of the shaped ground, then straight
        // down under it. The land is drawn on a 2 m grid and its foot strays
        // from the true line by a few tens of centimetres; where the verge
        // met it at a glancing angle, that stray showed as big teeth of
        // slope over the gravel, and a steep edge keeps them small.
        extrude(verge, run, VERGE, true, (e, end) => VERGE[e + end][0]);
        // Guardrails where the land falls away, and round the outside of
        // every hairpin.
        for (const side of [1, -1]) {
          const needs = run.map((f) => {
            // gr is the natural ground at +HALF_PAVED along the left normal.
            const drop = surf(f, side * HALF_PAVED) - (side > 0 ? f.gr : f.gl);
            const outer = Math.abs(f.kappa) > 1 / 40 && Math.sign(f.kappa) === -side;
            return drop > 2.2 || outer;
          });
          let k = 0;
          while (k < run.length) {
            if (!needs[k]) {
              k++;
              continue;
            }
            let e = k;
            while (e + 1 < run.length && needs[e + 1]) e++;
            if (e > k) this._guardrail(rail, post, run.slice(k, e + 1), side, i1);
            k = e + 1;
          }
        }
      } else if (kind === BRIDGE) {
        const P = HALF_PAVED;
        // Parapet and deck edge, then the box girder underneath.
        extrude(concrete, run, PARAPET, true, (e, end) => PARAPET_TOP - PARAPET[e + end][1]);
        extrude(dark, run, [[P + 0.72, -0.42], [3.5, -DECK_DEPTH], [0, -DECK_DEPTH]], true);
        this._piers(run, c, i1);
      } else if (kind === TUNNEL) {
        extrude(tube, run, TUBE, true, (e, end) => 1 - (e + end) / (TUBE.length - 1));
      }
    }

    // Portals wherever a tunnel meets open road inside this chunk, and the
    // light of the day in their openings, for a lens inside the bore.
    const mouth = new Builder();
    for (let k = 0; k < fr.length - 1; k++) {
      const f = fr[k];
      if (f.kind !== TUNNEL) continue;
      const before = road.samples.get(f.i - 1);
      const after = road.samples.get(f.i + 1);
      if (before && before.kind !== TUNNEL) {
        this._portal(portal, f, -1);
        this._mouth(mouth, f, -1);
        this.portalList.push({ chunk: c, x: ax0 + f.x, z: az0 + f.z, ox: -f.fx, oz: -f.fz, y: f.y });
      }
      if (after && after.kind !== TUNNEL) {
        this._portal(portal, f, 1);
        this._mouth(mouth, f, 1);
        this.portalList.push({ chunk: c, x: ax0 + f.x, z: az0 + f.z, ox: f.fx, oz: f.fz, y: f.y });
      }
    }

    // Lamps, in the worlds that light their road: a pole with an arm over the
    // carriageway and the pool of light under it, or small lights set along
    // the top of the parapets. Each throws a glare that keeps a few pixels
    // however far down the road it stands. All of it is gathered over the
    // whole road (_syncLamps), like the piers, so lamps cost no draw calls
    // per chunk.
    for (const f of fr) {
      if (f.i >= i1 || f.kind === TUNNEL) continue;
      const spec = this._lampsAt(f.i);
      if (!spec || f.s % spec.every !== 0 || (spec.kind === 'bollard' && f.kind !== BRIDGE)) continue;
      const light = new THREE.Color(spec.color).multiplyScalar(spec.glow);
      const lamp = { chunk: c, tint: [light.r, light.g, light.b], glare: [], pole: null, pool: null, reflect: spec.kind !== 'bollard' };
      const abs = (lat) => [ax0 + f.x + f.lx * lat, az0 + f.z + f.lz * lat];
      if (spec.kind === 'bollard') {
        for (const side of [1, -1]) {
          const lat = side * (HALF_PAVED + 0.54);
          const [x, z] = abs(lat);
          lamp.glare.push([x, surf(f, lat) + 1.0, z, 0.7]);
        }
      } else {
        // Poles stand on alternate sides: on the parapet over a deck, behind
        // the verge on the ground.
        const side = (f.s / spec.every) % 2 === 0 ? 1 : -1;
        const deck = f.kind === BRIDGE;
        const lat = side * (deck ? HALF_PAVED + 0.54 : HALF_PAVED + 1.1);
        const top = surf(f, 0) + LAMP_H;
        const [x, z] = abs(lat);
        // The head's arm reaches toward the centreline: local +x is -side
        // times the left vector.
        const yaw = Math.atan2(side * f.lz, -side * f.lx);
        lamp.pole = { x, z, y0: surf(f, lat) + (deck ? 0.95 : -0.3), y1: top, yaw, sun: f.sun };
        const at = lat - side * (LAMP_REACH + 0.1);
        const [gx, gz] = abs(at);
        lamp.glare.push([gx, top - 0.26, gz, 1.6]);
        lamp.pool = this._pool(f.i, lat - side * LAMP_REACH, new THREE.Color(spec.color).multiplyScalar(spec.pool));
        if (spec.torch) {
          const foot = lamp.pole.y0;
          lamp.torch = { post: { x, z, y0: foot, y1: foot + TORCH_H, yaw, sun: f.sun }, glare: [[x, foot + TORCH_H + 0.45, z, 1.3]],
            pool: this._pool(f.i, lat - side * TORCH_REACH, new THREE.Color(spec.color).multiplyScalar(spec.pool)) };
        }
      }
      this.lampList.push(lamp);
    }

    // The geometry stays in memory until its span is joined (_join); nothing
    // is uploaded for a chunk of its own.
    const parts = {
      asphalt: ag,
      verge: verge.geometry('aVerge', 2),
      concrete: concrete.geometry('aStain', 2),
      dark: dark.geometry(),
      portal: portal.geometry(),
      rail: rail.geometry('aRail', 2),
      post: post.geometry('aRail', 2),
      tube: tube.geometry('aTube', 2),
      mouth: mouth.geometry('aMouth', 3),
    };
    this.chunks.set(c, { ax: ax0, az: az0, parts });
    const k = Math.floor(c / SPAN);
    let span = this.spans.get(k);
    if (!span) {
      // The span is laid out from the first of its chunks to be built.
      const group = new THREE.Group();
      group.position.set(ax0 - this.origin.x, 0, az0 - this.origin.z);
      this.group.add(group);
      span = { group, ax: ax0, az: az0, meshes: [], dirty: false };
      this.spans.set(k, span);
    }
    span.dirty = true;
  }

  // A chunk goes, with the geometry it was kept as.
  _drop(c) {
    const chunk = this.chunks.get(c);
    for (const g of Object.values(chunk.parts)) if (g) g.dispose();
    this.chunks.delete(c);
    const span = this.spans.get(Math.floor(c / SPAN));
    if (span) span.dirty = true;
  }

  // Join again every span whose chunks have changed: one mesh per material,
  // and a span with no chunks left goes.
  _join() {
    for (const [k, span] of this.spans) {
      if (!span.dirty) continue;
      span.dirty = false;
      for (const m of span.meshes) {
        span.group.remove(m);
        m.geometry.dispose();
      }
      span.meshes = [];
      const own = [];
      for (const [c, chunk] of this.chunks) if (Math.floor(c / SPAN) === k) own.push(c);
      if (!own.length) {
        this.group.remove(span.group);
        this.spans.delete(k);
        continue;
      }
      own.sort((a, b) => a - b);
      for (const [name, mat, cast] of this._layers) {
        const parts = [];
        for (const c of own) {
          const chunk = this.chunks.get(c);
          if (chunk.parts[name]) parts.push({ geo: chunk.parts[name], dx: chunk.ax - span.ax, dz: chunk.az - span.az });
        }
        if (!parts.length) continue;
        const m = new THREE.Mesh(joinGeometries(parts), mat);
        m.castShadow = cast;
        m.receiveShadow = true;
        m.name = 'road-' + name;
        span.group.add(m);
        span.meshes.push(m);
      }
    }
  }

  // What is wrong with the road as it stands, one line each: a span with no
  // chunks or a chunk with no span, a mesh that does not hold exactly what
  // its chunks do, a pier, lamp or portal that stands on a chunk that is gone.
  audit() {
    const bad = [];
    const ofSpan = new Map();
    for (const c of this.chunks.keys()) {
      const k = Math.floor(c / SPAN);
      ofSpan.set(k, [...(ofSpan.get(k) || []), c]);
    }
    for (const k of ofSpan.keys()) if (!this.spans.has(k)) bad.push(`span ${k} has chunks and no mesh`);
    for (const [k, span] of this.spans) {
      const own = ofSpan.get(k);
      if (!own) {
        bad.push(`span ${k} has no chunks`);
        continue;
      }
      if (span.group.parent !== this.group) bad.push(`span ${k} is not in the scene`);
      for (const [name] of this._layers) {
        let want = 0;
        for (const c of own) {
          const g = this.chunks.get(c).parts[name];
          if (g) want += g.getAttribute('position').count;
        }
        const mesh = span.meshes.find((m) => m.name === 'road-' + name);
        const have = mesh ? mesh.geometry.getAttribute('position').count : 0;
        if (want !== have) bad.push(`span ${k} ${name}: ${have} vertices, its chunks have ${want}`);
      }
    }
    for (const [what, list] of [['pier', this.pierList], ['lamp', this.lampList], ['portal', this.portalList]]) {
      const gone = list.filter((p) => !this.chunks.has(p.chunk)).length;
      if (gone) bad.push(`${gone} ${what}s stand on chunks that are gone`);
    }
    return bad;
  }

  // Everything the road holds on the GPU, and the road's place in the scene.
  dispose() {
    for (const c of [...this.chunks.keys()]) this._drop(c);
    this._join();
    this.group.parent?.remove(this.group);
    for (const m of [this.piers, this.poles, this.heads, this.torchPosts, this.torchBlocks]) {
      if (!m) continue;
      m.geometry.dispose();
      m.dispose();
    }
    if (this.torchWood) {
      this.torchWood.dispose();
      this.torchFlame.dispose();
    }
    this.glare.geometry.dispose();
    this.pools.geometry.dispose();
    for (const m of Object.values(this.mat)) m.dispose();
    this.surfaces.dispose();
    strokeU.value?.dispose();
    strokeU.value = null;
  }

  _guardrail(rail, post, run, side, iEnd) {
    const lat = side * (HALF_PAVED + 0.55);
    // W-beam: a folded steel strip 0.32 m tall on posts every 4 m.
    const prof = [[0, 0.52], [-0.06, 0.6], [0, 0.68], [-0.06, 0.76], [0, 0.84]];
    for (let e = 0; e < prof.length - 1; e++) {
      let pa = -1;
      let pb = -1;
      for (const f of run) {
        rail.sunNow = f.sun;
        const l0 = lat + prof[e][0] * side;
        const l1 = lat + prof[e + 1][0] * side;
        const nx = -f.lx * side;
        const nz = -f.lz * side;
        const a = rail.vert(f.x + f.lx * l0, surf(f, lat) + prof[e][1], f.z + f.lz * l0, nx, 0, nz, f.s, prof[e][1]);
        const b = rail.vert(f.x + f.lx * l1, surf(f, lat) + prof[e + 1][1], f.z + f.lz * l1, nx, 0, nz, f.s, prof[e + 1][1]);
        if (pa >= 0) rail.quad(pa, a, b, pb);
        pa = a;
        pb = b;
      }
    }
    for (const f of run) {
      if (f.i % 2 !== 0 || f.i >= iEnd) continue;
      post.sunNow = f.sun;
      const cx = f.x + f.lx * (lat + side * 0.12);
      const cz = f.z + f.lz * (lat + side * 0.12);
      const y0 = surf(f, lat) - 0.3;
      const y1 = surf(f, lat) + 0.8;
      const w = 0.07;
      const corners = [[-w, -w], [w, -w], [w, w], [-w, w]].map(([u, v]) => [
        cx + f.fx * u + f.lx * v, cz + f.fz * u + f.lz * v,
      ]);
      for (let k = 0; k < 4; k++) {
        const [x0, z0] = corners[k];
        const [x1, z1] = corners[(k + 1) % 4];
        const l = Math.hypot(z1 - z0, x1 - x0) || 1;
        const nx = (z1 - z0) / l;
        const nz = -(x1 - x0) / l;
        // (A post's height goes in with 10 m added: it is not the beam; render's RAIL_REAL.)
        const a = post.vert(x0, y0, z0, nx, 0, nz, f.s, 10 - 0.3);
        const b = post.vert(x1, y0, z1, nx, 0, nz, f.s, 10 - 0.3);
        const c2 = post.vert(x1, y1, z1, nx, 0, nz, f.s, 10 + 0.8);
        const d = post.vert(x0, y1, z0, nx, 0, nz, f.s, 10 + 0.8);
        post.quad(a, b, c2, d);
      }
    }
  }

  // Piers at fixed arc-length stations, so the same viaduct always stands on
  // the same piers; skipped where another level of road runs underneath.
  _piers(run, chunk, iEnd) {
    const road = this.road;
    for (const f of run) {
      if (f.i >= iEnd || f.kind !== BRIDGE || f.s % PIER_EVERY !== 0) continue;
      const smp = road.samples.get(f.i);
      // In a world where the road floats (space), no piers at all.
      if (this.land.floats && this.land.floats(smp.ax, smp.az)) continue;
      const top = f.y - DECK_DEPTH + 0.05;
      const ground = this.corridor.heightAt(smp.ax, smp.az);
      if (top - ground < 1.5) continue;
      let blocked = false;
      road.forEachSegmentNear(smp.ax, smp.az, 9, (j) => {
        if (blocked || Math.abs(j - f.i) < 40) return;
        const o = road.samples.get(j);
        if (Math.hypot(o.ax - smp.ax, o.az - smp.az) < 8 && o.y < top - 2) blocked = true;
      });
      if (blocked) continue;
      // Sun on the pier: taken halfway down, where most of it is seen.
      const sun = sunVisibility(this.land, smp.ax, smp.az, (top + ground) * 0.5, this.sunDir);
      this.pierList.push({ x: smp.ax, z: smp.az, top, bottom: ground - 1.5, theta: smp.theta, chunk, sun });
    }
  }

  // The opening of a portal at frame f (dir points out of the tunnel),
  // filled with the mouth's veil of light: a fan from the middle of the
  // opening round the tube's own section, a little inside the bore.
  _mouth(b, f, dir) {
    const off = -0.3 * dir;
    const at = (lat, up) => [f.x + f.lx * lat + f.fx * off, surf(f, lat) + up, f.z + f.lz * lat + f.fz * off];
    const rim = [...TUBE, ...TUBE.slice().reverse().map(([l, u]) => [-l, u])];
    const [cx, cy, cz] = at(0, TUNNEL_H * 0.45);
    const mid = b.vert(cx, cy, cz, f.fx * -dir, 0, f.fz * -dir, 0);
    const ids = rim.map(([l, u]) => {
      const [x, y, z] = at(l, u);
      return b.vert(x, y, z, f.fx * -dir, 0, f.fz * -dir, 1);
    });
    for (let k = 0; k < ids.length - 1; k++) b.idx.push(mid, ids[k], ids[k + 1]);
    b.idx.push(mid, ids[ids.length - 1], ids[0]);
  }

  // A portal: a concrete headwall around the opening, built as pillars either
  // side, a lintel over the crown and fans filling the corners above the vault.
  _portal(b, f, dir) {
    const W = 7.2;
    const H = TUNNEL_H + 1.6;
    const P = 5.6;
    const nx = f.fx * dir;
    const nz = f.fz * dir;
    const smp = this.road.samples.get(f.i);
    b.sunNow = sunVisibility(this.land, smp.ax + Math.cos(smp.theta) * dir * 3,
      smp.az + Math.sin(smp.theta) * dir * 3, f.y + 3, this.sunDir);
    const at = (lat, up, off) => [
      f.x + f.lx * lat + f.fx * off, surf(f, lat) + up, f.z + f.lz * lat + f.fz * off,
    ];
    const face = (pts, off) => {
      const ids = pts.map(([lat, up]) => {
        const [x, y, z] = at(lat, up, off);
        return b.vert(x, y, z, nx, 0, nz);
      });
      for (let k = 1; k < ids.length - 1; k++) b.idx.push(ids[0], ids[k], ids[k + 1]);
    };
    for (const off of [0.2 * dir, -1.4 * dir]) {
      face([[-W, -0.3], [-P, -0.3], [-P, H], [-W, H]], off);
      face([[P, -0.3], [W, -0.3], [W, H], [P, H]], off);
      face([[-P, TUNNEL_H + 0.2], [P, TUNNEL_H + 0.2], [P, H], [-P, H]], off);
      // Corners between the vault and the lintel: fanned from the corner,
      // down the pillar's edge, up the vault to the crown and back along the
      // lintel, so no triangle crosses the opening.
      for (const s of [1, -1]) {
        const fan = [[s * P, TUNNEL_H + 0.2], [s * P, 4.1]];
        for (let k = 0; k <= 8; k++) {
          const t = (k / 8) * Math.PI * 0.5;
          fan.push([s * 5.45 * Math.cos(t), 4.1 + (TUNNEL_H - 4.1) * Math.sin(t)]);
        }
        fan.push([0, TUNNEL_H + 0.2]);
        face(fan, off);
      }
    }
  }

  // How the road is lit at sample i: the lamps of the world it is mostly in,
  // or null.
  _lampsAt(i) {
    const worlds = this.land.worlds;
    const smp = this.road.samples.get(i);
    if (!worlds || !smp) return null;
    return WORLDS[worlds.main(smp.ax, smp.az)].lamps || null;
  }

  // A lamp's pool of light: a strip over the asphalt from POOL_ALONG samples
  // before sample i to as many after, centred `lat` across and kept on the
  // carriageway, following the road's curve, bank and crown. Absolute
  // coordinates; null where the strip would run into a tunnel.
  _pool(i, lat, tint) {
    const road = this.road;
    const rows = [];
    for (let j = i - POOL_ALONG; j <= i + POOL_ALONG; j++) {
      const p = road.samples.get(j);
      if (!p || p.kind === TUNNEL) return null;
      rows.push(p);
    }
    const cols = [-1, -0.5, 0, 0.5, 1].map((u) => THREE.MathUtils.clamp(lat + u * POOL_HALF, -HALF_PAVED, HALF_PAVED));
    const pool = { pos: [], uv: [], tint: [tint.r, tint.g, tint.b], cols: cols.length, rows: rows.length };
    rows.forEach((p, r) => {
      const lx = -Math.sin(p.theta);
      const lz = Math.cos(p.theta);
      for (const c of cols) {
        const y = p.y - p.bank * c + 0.045 * (1 - (c / HALF_PAVED) ** 2) + 0.04;
        pool.pos.push(p.ax + lx * c, y, p.az + lz * c);
        pool.uv.push((c - lat) / POOL_HALF, (r - POOL_ALONG) / POOL_ALONG);
      }
    });
    return pool;
  }

  // Lay out every lamp of the built road: poles and heads as instances, the
  // glare and the pools as one buffer each, relative to the floating origin.
  _syncLamps() {
    const o = this.origin;
    let n = 0;
    let nt = 0;
    const gPos = [];
    const gTint = [];
    const gSize = [];
    const pPos = [];
    const pUv = [];
    const pTint = [];
    const pIdx = [];
    const refl = [];
    for (const L of this.lampList) {
      // A pole's lamp is thrown back by a wet road, from where its head is.
      if (L.reflect && L.pole) {
        const g = L.glare[0];
        refl.push({ x: g[0] - o.x, y: g[1], z: g[2] - o.z, c: L.tint });
      }
      // A lamp that is a torch in this style: its post and block (but in the low tier), and the light.
      const T = this.torchStyle && L.torch ? L.torch : null;
      if (T && this.torchShapes && nt < MAX_LAMPS) {
        const p = T.post;
        this._v.set(p.x - o.x, p.y0, p.z - o.z);
        this._q.setFromAxisAngle(this._up, p.yaw);
        this._sc.set(1, p.y1 - p.y0, 1);
        this._m.compose(this._v, this._q, this._sc);
        this.torchPosts.setMatrixAt(nt, this._m);
        this._v.set(p.x - o.x, p.y1, p.z - o.z);
        this._sc.set(1, 1, 1);
        this._m.compose(this._v, this._q, this._sc);
        this.torchBlocks.setMatrixAt(nt, this._m);
        this.torchSun.setX(nt, p.sun);
        nt++;
      } else if (!T && L.pole && n < MAX_LAMPS) {
        const p = L.pole;
        this._v.set(p.x - o.x, p.y0, p.z - o.z);
        this._q.identity();
        this._sc.set(1, p.y1 - p.y0, 1);
        this._m.compose(this._v, this._q, this._sc);
        this.poles.setMatrixAt(n, this._m);
        this._v.set(p.x - o.x, p.y1, p.z - o.z);
        this._q.setFromAxisAngle(this._up, p.yaw);
        this._sc.set(1, 1, 1);
        this._m.compose(this._v, this._q, this._sc);
        this.heads.setMatrixAt(n, this._m);
        this.poleSun.setX(n, p.sun);
        this.headSun.setX(n, p.sun);
        n++;
      }
      for (const [x, y, z, size] of T ? T.glare : L.glare) {
        gPos.push(x - o.x, y, z - o.z);
        gTint.push(...L.tint);
        gSize.push(size);
      }
      const P = T ? T.pool : L.pool;
      if (P) {
        const base = pPos.length / 3;
        for (let k = 0; k < P.pos.length; k += 3) {
          pPos.push(P.pos[k] - o.x, P.pos[k + 1], P.pos[k + 2] - o.z);
          pTint.push(...P.tint);
        }
        pUv.push(...P.uv);
        for (let r = 0; r < P.rows - 1; r++) {
          for (let k = 0; k < P.cols - 1; k++) {
            const a = base + r * P.cols + k;
            pIdx.push(a, a + P.cols + 1, a + P.cols, a, a + 1, a + P.cols + 1);
          }
        }
      }
    }
    for (const m of [this.poles, this.heads]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    }
    if (this.torchPosts) {
      for (const m of [this.torchPosts, this.torchBlocks]) {
        m.count = nt;
        m.visible = nt > 0;
        m.instanceMatrix.needsUpdate = true;
      }
      this.torchSun.needsUpdate = true;
    }
    this.poleSun.needsUpdate = true;
    this.headSun.needsUpdate = true;
    this._refl = refl;
    const glare = new THREE.BufferGeometry();
    glare.setAttribute('position', new THREE.Float32BufferAttribute(gPos, 3));
    glare.setAttribute('aTint', new THREE.Float32BufferAttribute(gTint, 3));
    glare.setAttribute('aSize', new THREE.Float32BufferAttribute(gSize, 1));
    this.glare.geometry.dispose();
    this.glare.geometry = glare;
    this.glare.visible = gSize.length > 0;
    const pools = new THREE.BufferGeometry();
    pools.setAttribute('position', new THREE.Float32BufferAttribute(pPos, 3));
    pools.setAttribute('aPool', new THREE.Float32BufferAttribute(pUv, 2));
    pools.setAttribute('aTint', new THREE.Float32BufferAttribute(pTint, 3));
    pools.setIndex(pIdx);
    this.pools.geometry.dispose();
    this.pools.geometry = pools;
    this.pools.visible = pIdx.length > 0;
  }

  _syncPiers() {
    const m = this.piers;
    let n = 0;
    for (const p of this.pierList) {
      if (n >= MAX_PIERS) break;
      const h = p.top - p.bottom;
      // Tall piers are thicker, like the real ones.
      const w = 1 + Math.min(1.2, h / 90);
      this._v.set(p.x - this.origin.x, p.top, p.z - this.origin.z);
      this._q.setFromAxisAngle(this._up, -p.theta);
      this._sc.set(w, h, Math.min(1, 0.55 + h / 60));
      this._m.compose(this._v, this._q, this._sc);
      this.pierSun.setX(n, p.sun);
      m.setMatrixAt(n++, this._m);
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    this.pierSun.needsUpdate = true;
  }

  setSun(dir) {
    this.sunDir.copy(dir).normalize();
  }
}
