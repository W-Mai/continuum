// The real style's water: the numbers, and the shader code laid into the sea's program when the style is drawn as
// it is lit (render/water.js): how deep the water is, from the frame as it stands behind it (render/waterback.js),
// shows in its colour and in how much of the bed is seen through it; where it is shallow there is foam, going to and
// fro with the swell; the frame is reflected in it, as far as the frame holds it, and the sky where it does not; a river
// flows the way its channel runs; and near the lens the surface rises and falls in four swells.

import { PAL_P4 } from './worldlook.js';

const f = (x) => {
  const s = String(x);
  return /[.e]/.test(s) ? s : `${s}.0`;
};
const v3 = (a) => `vec3( ${a.map(f).join(', ')} )`;

export const REAL = {
  // The water's own colour and opacity by how deep it is (m, straight down): the shallow colour over the first
  // 'deep' metres to the deep one, and the share of the light that is the water's own (not the bed's) by the length of
  // the ray through it: 1 - exp(-absorb * metres), from `floor` up to the world's opacity.
  depth: { deep: 2.2, absorb: 0.55, floor: 0.05 },
  // Foam: where the water over the bed is less than `depth` metres deep (`grow` more for each metre the lens is off, so that it is
  // not narrower than a pixel far off), broken up by a noise (`noise` m) and moved to and fro by `swash` m with a period of `period` s;
  // none from the first distance to the second.
  foam: { depth: 0.3, grow: 0.0025, swash: 0.12, period: 6, noise: 0.22, fade: [120, 500], albedo: [0.82, 0.86, 0.88] },
  // Everything the frame gives the water thins out between these distances (m from the lens) to what the water was.
  reach: [450, 1300],
  // How rough the surface is: the sharper of the two near the lens, the other far off (where the ripples that
  // roughen it are too small to be seen), over the distance between the two numbers.
  rough: { near: 0.09, far: 0.2, over: [200, 1500] },
  // The reflection of the frame: steps along the ray over the screen (the first short, the last the longest), how
  // far the ray goes (m), how far behind what the frame holds it may be and still hit it (the first number, and a share
  // of the distance of what it is behind), how much of the screen at its edge it fades out over, and how much
  // above the water the ray has to climb for the frame to be read at all (the sine).
  // The ray is of a calmer surface than the light is: `cut` of the finest ripples are left out of its normal (a mirror shows
  // the far bank whole, not in specks), and what it finds is read from the frame's smaller copies, the farther it has gone and the
  // rougher the water, the smaller (`blur`).
  ssr: { steps: 24, far: 500, thick: [0.35, 0.06], edge: 0.1, up: 0.12, reach: 900, cut: 0.75, blur: 0.35 },
  // How fast the pattern of a river's water moves (m/s), for each of three scales of ripple, and how long (s) the
  // way it runs, taken from the land, is held to as the lens goes on.
  flow: { speed: [0.7, 0.95, 1.45], hold: 1.2, ahead: 60 },
  // How much of the shallows' own ripples there are (the finest scale of them: 5.5 m across), the water where it is
  // less than the second number deep, to none at the third.
  ripple: { size: 5.5, slope: 0.4, from: 0.1, to: 0.8 },
  // How far from the lens the surface is moved by the swells, and how far from it their slope is in the shading.
  swellFade: [60, 100],
  // Where the real water has its frame: a world that has some is near from this far (m, along the road), and the land under
  // the water counts within `view` m of the lens (past it the water is 95 parts in 100 what it was without the frame, by `reach`, so
  // nothing is taken for it).
  near: 1200,
  view: 1170,
};

// The swells: wavelengths (m), shares of the height, ways they run (unit vectors x, z), and what they run at
// (deep water: omega = sqrt(g k)).
export const SWELLS = {
  length: [23, 11.5, 6.4, 3.6],
  share: [0.34, 0.27, 0.22, 0.17],
  dir: [[0.97, 0.243], [0.88, -0.475], [0.75, 0.66], [0.45, -0.893]],
  g: 9.81,
};
export const SWELL_K = SWELLS.length.map((l) => (2 * Math.PI) / l);
export const SWELL_W = SWELL_K.map((k) => Math.sqrt(SWELLS.g * k));

// What the swells' phases are at time t (s), taken mod 2 pi where it is worked out (so that a page left running for days
// keeps its numbers small).
export function swellPhases(t, out = []) {
  for (let i = 0; i < 4; i++) out[i] = (SWELL_W[i] * t) % (2 * Math.PI);
  return out;
}

// The height (m) at a point (x, z) at time t, from the same sum as the shader's: for the checks.
export function swellHeight(x, z, t, height) {
  let h = 0;
  for (let i = 0; i < 4; i++) {
    const d = SWELLS.dir[i];
    h += SWELLS.share[i] * 0.5 * height * Math.sin(SWELL_K[i] * (d[0] * x + d[1] * z) - SWELL_W[i] * t);
  }
  return h;
}

// --- shader code ----------------------------------------------------------------------------------------------

// The pieces of shader code, worked out from the numbers above as they are when a program is made (so that a number moved
// before the program is made is in it).
export function realChunks(fine = { from: 120, to: 900 }) {

// Shared by the vertex and the fragment shader.
const PARS = /* glsl */`
uniform vec4 uSwellPh;
uniform float uRealK;
const vec4 SW_K = vec4( ${SWELL_K.map((k) => k.toFixed(4)).join(', ')} );
const vec4 SW_X = vec4( ${SWELLS.dir.map((d) => d[0]).map(f).join(', ')} );
const vec4 SW_Z = vec4( ${SWELLS.dir.map((d) => d[1]).map(f).join(', ')} );
const vec4 SW_A = vec4( ${SWELLS.share.map(f).join(', ')} );

// The four swells at a point p of the water (m): the way they move it (x, height, z) for a height of \`height\` m from crest
// to trough, and their slope there (the rise over the run, along x and along z).
vec3 gerstner( vec2 p, float height, out vec2 slope ) {
  vec4 ph = SW_K * ( SW_X * p.x + SW_Z * p.y ) - uSwellPh;
  vec4 amp = SW_A * ( 0.5 * height );
  vec4 c = cos( ph );
  vec4 s = sin( ph );
  slope = vec2( dot( amp * SW_K * SW_X, c ), dot( amp * SW_K * SW_Z, c ) );
  return vec3( dot( amp * SW_X, c ), dot( amp, s ), dot( amp * SW_Z, c ) );
}

// What the world gives the water here (worldAt has been called): how much it flows, how high its swell is (m), how much of the
// ripples of the surface it keeps, and whether its shallows are shoals (1: the ripples of the shallows are doubled).
vec4 waterPar() {
  vec4 a = texelFetch( uWorldPal, ivec2( ${PAL_P4}, wA ), 0 );
  if ( wT <= 0.0 ) return a;
  return mix( a, texelFetch( uWorldPal, ivec2( ${PAL_P4}, wB ), 0 ), wT );
}
`;

const REAL_VERTEX_PARS = PARS;

// The surface rises and falls near the lens: the point is moved by the swells before it is placed.
const REAL_VERTEX = /* glsl */`
vec2 wp0 = ( modelMatrix * vec4( transformed, 1.0 ) ).xz + uOffset;
if ( uRealK > 0.0 && uSeaDry < 0.5 && uTwist.x < 0.5 ) {
  worldAt( wp0 );
  float wv = waterPar().y;
  if ( wv > 0.0 ) {
    float swellNear = 1.0 - smoothstep( ${f(REAL.swellFade[0])}, ${f(REAL.swellFade[1])}, length( wp0 - ( cameraPosition.xz + uOffset ) ) );
    vec2 swellSlope;
    transformed += gerstner( wp0, wv * swellNear * uRealK, swellSlope );
  }
}`;

// The reflection of the frame in the water.
const REFLECTION = /* glsl */`
// What the frame holds in the way the ray from p (the lens's space, the lens looking down -z) goes along r: ${REAL.ssr.steps} steps over
// the screen, each longer than the last; the colour where the ray first goes behind something the frame holds, and in
// the fourth number how much of it there is (less toward the screen's edges and the end of the ray).
vec4 frameReflection( vec3 p, vec3 r, float jitter, float rough ) {
  if ( r.z > -0.02 ) return vec4( 0.0 );
  vec4 c0 = uProj * vec4( p, 1.0 );
  vec4 c1 = uProj * vec4( p + r * ${f(REAL.ssr.far)}, 1.0 );
  float k0 = 1.0 / c0.w;
  float k1 = 1.0 / c1.w;
  vec2 s0 = c0.xy * k0 * 0.5 + 0.5;
  vec2 s1 = c1.xy * k1 * 0.5 + 0.5;
  vec2 ds = s1 - s0;
  float ux = ds.x > 1e-6 ? ( 0.998 - s0.x ) / ds.x : ( ds.x < -1e-6 ? ( 0.002 - s0.x ) / ds.x : 1e9 );
  float uy = ds.y > 1e-6 ? ( 0.998 - s0.y ) / ds.y : ( ds.y < -1e-6 ? ( 0.002 - s0.y ) / ds.y : 1e9 );
  float uEnd = min( 1.0, min( ux, uy ) );
  if ( uEnd <= 0.0 ) return vec4( 0.0 );
  ivec2 last = ivec2( uBack.xy ) - 1;
  float uPrev = 0.0;
  float uHit = -1.0;
  bool inFront = true;
  for ( int i = 0; i < ${REAL.ssr.steps}; i++ ) {
    float fs = min( ( float( i ) + 1.0 + jitter ) / ${REAL.ssr.steps}.0, 1.0 );
    float u = uEnd * fs * fs;
    float zr = 1.0 / mix( k0, k1, u );
    float zs = texelFetch( tBackDist, min( ivec2( ( s0 + ds * u ) * uBack.xy ), last ), 0 ).r;
    if ( zr > zs ) {
      // The ray has gone behind what the frame holds, from in front of it: where it crossed is between the last step and this one.
      if ( inFront ) {
        float lo = uPrev;
        float hi = u;
        for ( int j = 0; j < 5; j++ ) {
          float m = 0.5 * ( lo + hi );
          float zq = texelFetch( tBackDist, min( ivec2( ( s0 + ds * m ) * uBack.xy ), last ), 0 ).r;
          if ( 1.0 / mix( k0, k1, m ) > zq ) hi = m; else lo = m;
        }
        // A crossing of a surface is where the gap is small there; of something thin (a rail, a trunk) the ray goes on behind.
        float zh = texelFetch( tBackDist, min( ivec2( ( s0 + ds * hi ) * uBack.xy ), last ), 0 ).r;
        if ( 1.0 / mix( k0, k1, hi ) - zh < max( ${f(REAL.ssr.thick[0])}, ${f(REAL.ssr.thick[1])} * zh ) ) {
          uHit = hi;
          break;
        }
      }
      inFront = false;
    } else {
      inFront = true;
    }
    uPrev = u;
  }
  if ( uHit < 0.0 ) return vec4( 0.0 );
  float hi = uHit;
  vec2 s = s0 + ds * hi;
  float edge = min( min( s.x, 1.0 - s.x ), min( s.y, 1.0 - s.y ) );
  float fade = smoothstep( 0.0, ${f(REAL.ssr.edge)}, edge ) * ( 1.0 - smoothstep( 0.75, 1.0, uHit / uEnd ) );
  float lod = log2( 1.0 + ${f(REAL.ssr.blur)} * length( ds * hi * uBack.xy ) * rough );
  return vec4( textureLod( tBackColor, s, lod ).rgb, fade );
}
`;

// The fragment shader's declarations.
const REAL_PARS = /* glsl */`
uniform sampler2D tBackColor;
uniform sampler2D tBackDist;
uniform vec4 uBack;
uniform vec2 uFull;
uniform mat4 uProj;
uniform vec4 uFlowA;
uniform vec2 uFlowB;
${PARS}
float tReal;
float tShow;
float tAlpha;
vec4 tSsr;
${REFLECTION}
`;

// The lines of the sea's shader the real water changes: each is what the other programs have, in the way the real
// one has it.
const REAL_LINES = {
  // The old drift of the pattern is left to the sea: a river's runs along its channel.
  speed: ' * ( 1.0 - wr.x )',
  uv1: ' - uFlowA.xy * wr.x',
  uv2: ' - uFlowA.zw * wr.x',
  // The ripples that roughen the surface, as much as the world keeps of them (closes the bracket the sum of the two is in).
  fine: ') * mix( 1.0, wr.z, uRealK )',
};

// The finest ripples (the shallows'): read where the water is one that has them, near the lens (the slope of the coordinates is the
// whole frame's, so that the read is of the same detail where its neighbours do not take it).
const REAL_RIPPLE_FETCH = /* glsl */`
vec2 uv6 = R2 * R1 * q / ${f(REAL.ripple.size)} - uFlowB * wr.x;
vec2 uv6x = dFdx( uv6 );
vec2 uv6y = dFdy( uv6 );
vec4 w6 = vec4( 0.5 );
if ( wr.y > 0.0 && wDist < 160.0 ) w6 = textureGrad( uWave, uv6, uv6x, uv6y );`;

// The swell's slope, added to the surface's.
const REAL_SWELL = /* glsl */`
if ( wr.y > 0.0 ) {
  vec2 swellSlope;
  gerstner( vWPos.xz, wr.y * uRealK * ( 1.0 - smoothstep( ${f(REAL.swellFade[0])}, ${f(REAL.swellFade[1] + 10)}, wDist ) ), swellSlope );
  slope += swellSlope;
}`;

// What the real water does at the end of the map chunk: its depth, its colour and its opacity, the foam, the shallows'
// ripples, the reflection of the frame, how rough it is. Where it is not (a sea of cloud, of lava, the world has no swell)
// nothing is changed.
const REAL_BODY = /* glsl */`
tShow = wShow;
tAlpha = clamp( mix( liq.z + 0.06, liq.z - 0.05, down ) + max( lava, cloud ), 0.0, 1.0 );
tReal = 0.0;
tSsr = vec4( 0.0 );
float rk = uRealK * step( 0.0001, wr.y ) * ( 1.0 - max( lava, cloud ) ) * step( vWPos.y, camW.y );
if ( rk > 0.0 ) {
  tReal = rk;
  float reachK = 1.0 - smoothstep( ${f(REAL.reach[0])}, ${f(REAL.reach[1])}, wDist );
  float zf = vViewPosition.z;
  float dw = uBack.w * reachK;
  // How much water is over the bed here: the length of the ray through it, and straight down.
  float rayLen = 1000.0;
  float h = 9.0;
  if ( dw > 0.0 ) {
    vec2 bd = texelFetch( tBackDist, ivec2( gl_FragCoord.xy * 0.5 ), 0 ).rg;
    // Something nearer than the water here is not what is under it: the farthest of the four pixels is.
    float zb = mix( bd.x, bd.y, smoothstep( 0.02, 0.3, zf - bd.x ) );
    rayLen = max( zb - zf, 0.0 ) * length( vViewPosition ) / zf;
    h = rayLen * down;
  }
  vec3 body = mix( shallow, deep, smoothstep( 0.0, ${f(REAL.depth.deep)}, h ) );
  float aBody = mix( ${f(REAL.depth.floor)}, liq.z, 1.0 - exp( -rayLen * ${f(REAL.depth.absorb)} ) );
  // Foam, where it is shallow, broken up and carried to and fro.
  float fn = w2.z * 0.55 + w1.z * 0.45;
  float swash = sin( 6.2832 * uTime / ${f(REAL.foam.period)} + 5.0 * w3.z );
  float foam = 1.0 - smoothstep( 0.02, ${f(REAL.foam.depth)} + ${f(REAL.foam.grow)} * wDist, h + ${f(REAL.foam.swash)} * swash - ( fn - 0.5 ) * ${f(REAL.foam.noise)} );
  foam *= dw * ( 1.0 - smoothstep( ${f(REAL.foam.fade[0])}, ${f(REAL.foam.fade[1])}, wDist ) );
  body = mix( body, ${v3(REAL.foam.albedo)}, foam );
  aBody = max( aBody, foam * 0.94 );
  diffuseColor.rgb = mix( diffuseColor.rgb, body, dw );
  tAlpha = max( mix( tAlpha, aBody, dw ), 0.02 );
  // How rough the surface is here, and what the ray's surface is (the swell and the broad ripples, a share of the fine ones).
  float roughHere = mix( ${f(REAL.rough.near)}, ${f(REAL.rough.far)}, smoothstep( ${f(REAL.rough.over[0])}, ${f(REAL.rough.over[1])}, wDist ) );
  vec2 slopeRay = slope - fine * ( 1.0 - smoothstep( ${f(fine.from)}, ${f(fine.to)}, wDist ) ) * ${f(REAL.ssr.cut)};
  // In the shallows the surface is ruffled finer (twice as much where the world's shallows are shoals).
  float shallowK = ( 1.0 - smoothstep( ${f(REAL.ripple.from)}, ${f(REAL.ripple.to)}, h ) ) * dw;
  slope += ( w6.xy - 0.5 ) * ${f(REAL.ripple.slope)} * shallowK * ( 1.0 + wr.w );
  tWaterN = normalize( vec3( -slope.x, 1.0, -slope.y ) );
  // The reflection of the frame.
  if ( uBack.z > 0.5 && wDist < ${f(REAL.ssr.reach)} ) {
    vec3 nRay = normalize( vec3( -slopeRay.x, 1.0, -slopeRay.y ) );
    vec3 nV = normalize( ( viewMatrix * vec4( nRay, 0.0 ) ).xyz );
    vec3 pV = -vViewPosition;
    vec3 rW = reflect( -viewDir, nRay );
    // (The world's own noise, not the screen's: it stays on the water as the lens goes.)
    float jit = fract( sin( dot( floor( vWPos.xz * 2.0 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
    tSsr = frameReflection( pV, reflect( normalize( pV ), nV ), jit, roughHere );
    tSsr.a *= smoothstep( 0.0, ${f(REAL.ssr.up)}, rW.y ) * reachK * ( 1.0 - foam );
  }
  tLiquidRough = mix( tLiquidRough, roughHere, rk );
  tLiquidRough = mix( tLiquidRough, 0.85, foam );
}`;

// Before the lights are added up: the frame's reflection stands for the sky's where it has one.
const REAL_LIGHT = /* glsl */`
#if defined( RE_IndirectSpecular )
if ( tReal > 0.0 ) radiance = mix( radiance, tSsr.rgb, tSsr.a );
#endif
`;

// After the colour is made: where the water is the real water, its reflection is not thinned by how much of the bed is
// seen through it (the light of the sky is added as it is, and the water's own light and the bed's make up the rest).
const REAL_OPAQUE = /* glsl */`
if ( tReal > 0.0 ) gl_FragColor = vec4( min( totalDiffuse + totalEmissiveRadiance + totalSpecular / tAlpha, vec3( 30000.0 ) ), tShow * tAlpha );
`;

  return { REAL_VERTEX_PARS, REAL_VERTEX, REAL_PARS, REAL_LINES, REAL_RIPPLE_FETCH, REAL_SWELL, REAL_BODY, REAL_LIGHT, REAL_OPAQUE };
}
