// What the land's shader does with the ground's normal maps and its beds
// (render/terrain.js lays these into its program; render/ground.js holds the
// textures): the vertices pushed out of a rock face by the bed they are in,
// the rock's blocks, joints and beds, gravel and dirt along the road, ripples
// in sand and snow, the glint of sand and the blue of snow out of the sun.
//
// The program of the styles that paint the land in two flat paints has none of
// it: the land they draw is as it was.

import { WIND } from '../world/worlds.js';

// How far from the lens the beds are pushed out of the faces: whole to the
// first, gone at the second (m).
export const BED_FADE = [110, 250];

// The vertex shader: a vertex of a face with beds (aBed: the change of the normal, then how far it is
// pushed along it) goes there, by as much as the tier says and the lens is near enough for.
export const BED_COMMON = /* glsl */`
attribute vec4 aBed;
uniform vec4 uGroundK;
uniform vec3 uBedAt;
`;

export const BED_PUSH = /* glsl */`
vec3 bedNormal = objectNormal;
if (uGroundK.z > 0.0 && aBed.w != 0.0) {
  float bedK = uGroundK.z * (1.0 - smoothstep(${BED_FADE[0].toFixed(1)}, ${BED_FADE[1].toFixed(1)}, length((modelMatrix * vec4(transformed, 1.0)).xyz - uBedAt)));
  transformed += objectNormal * (aBed.w * bedK);
  bedNormal = normalize(objectNormal + aBed.xyz * bedK);
}`;

// The same, for the depth the sun's shadow is made from (there is no objectNormal there).
export const BED_DEPTH = /* glsl */`
if (uGroundK.z > 0.0 && aBed.w != 0.0) {
  float bedK = uGroundK.z * (1.0 - smoothstep(${BED_FADE[0].toFixed(1)}, ${BED_FADE[1].toFixed(1)}, length((modelMatrix * vec4(transformed, 1.0)).xyz - uBedAt)));
  transformed += normal * (aBed.w * bedK);
}`;

// The fragment shader's functions. A map is read with the slope of the place across a pixel
// (textureGrad), so it is read the same where a branch is taken by some pixels of a block and not others.
export const GROUND_COMMON = /* glsl */`
uniform sampler2D uRockN;
uniform sampler2D uFineN;
uniform vec4 uGroundK;
vec3 tSpark;
#ifdef FOLD_ALPHA
#define GATE( c ) NEED( c )
#else
#define GATE( c ) ( c )
#endif
// The rock's normal map through the three planes of the land (p the place, w the planes' weights, dx and dy
// how p changes across a pixel, beds how much of the beds to lay in the upright planes): how the normal
// changes, and in w how open to the sky the rock is there.
vec4 gRock( vec3 p, vec3 w, float scale, vec3 dx, vec3 dy, float beds ) {
  vec3 n = vec3( 0.0 );
  float sky = 0.0;
  if ( w.x > 0.004 ) {
    vec4 t = textureGrad( uRockN, p.zy * scale, dx.zy * scale, dy.zy * scale );
    vec2 s = ( t.rg - 0.5 ) * 3.0;
    s.y += ( t.b - 0.5 ) * 3.0 * beds;
    n += w.x * vec3( 0.0, -s.y, -s.x );
    sky += w.x * t.a;
  }
  if ( w.y > 0.004 ) {
    vec4 t = textureGrad( uRockN, p.xz * scale, dx.xz * scale, dy.xz * scale );
    vec2 s = ( t.rg - 0.5 ) * 3.0;
    n += w.y * vec3( -s.x, 0.0, -s.y );
    sky += w.y * t.a;
  }
  if ( w.z > 0.004 ) {
    vec4 t = textureGrad( uRockN, p.xy * scale, dx.xy * scale, dy.xy * scale );
    vec2 s = ( t.rg - 0.5 ) * 3.0;
    s.y += ( t.b - 0.5 ) * 3.0 * beds;
    n += w.z * vec3( -s.x, -s.y, 0.0 );
    sky += w.z * t.a;
  }
  return vec4( n, sky );
}
// Gravel, the same way.
vec3 gGrit( vec3 p, vec3 w, float scale, vec3 dx, vec3 dy ) {
  vec3 n = vec3( 0.0 );
  if ( w.x > 0.004 ) {
    vec2 s = ( textureGrad( uFineN, p.zy * scale, dx.zy * scale, dy.zy * scale ).rg - 0.5 ) * 4.0;
    n += w.x * vec3( 0.0, -s.y, -s.x );
  }
  if ( w.y > 0.004 ) {
    vec2 s = ( textureGrad( uFineN, p.xz * scale, dx.xz * scale, dy.xz * scale ).rg - 0.5 ) * 4.0;
    n += w.y * vec3( -s.x, 0.0, -s.y );
  }
  if ( w.z > 0.004 ) {
    vec2 s = ( textureGrad( uFineN, p.xy * scale, dx.xy * scale, dy.xy * scale ).rg - 0.5 ) * 4.0;
    n += w.z * vec3( -s.x, -s.y, 0.0 );
  }
  return n;
}
// Ripples of wind on level ground, their crests across the direction wind (unit, on the ground).
vec3 gRipple( vec2 p, vec2 dx, vec2 dy, float scale, vec2 wind ) {
  vec2 side = vec2( -wind.y, wind.x );
  vec4 t = textureGrad( uFineN, vec2( dot( p, wind ), dot( p, side ) ) * scale,
    vec2( dot( dx, wind ), dot( dx, side ) ) * scale, vec2( dot( dy, wind ), dot( dy, side ) ) * scale );
  vec2 s = ( t.ba - 0.5 ) * 1.2;
  vec2 d = -( s.x * wind + s.y * side );
  return vec3( d.x, 0.0, d.y );
}
float gGlint( vec2 p ) {
  vec3 q = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );
  q += dot( q, q.yzx + 33.33 );
  return fract( ( q.x + q.y ) * q.z );
}
`;

// The colour of dirt: where the road has cut, filled and laid its verge, patches wet and patches dry.
export const GROUND_ALBEDO = /* glsl */`
{
  float dirtW = uGroundK.y * max(vergeW, max(fillW * 0.85, (1.0 - onCut) * 0.7)) * (1.0 - snowW) * (1.0 - smoothstep(20.0, 70.0, dist));
  if (GATE(dirtW > 0.004)) {
    float wetN = dN.g * 0.6 + dG.g * 0.4;
    float wet = smoothstep(0.52, 0.6, wetN);
    float dry = 1.0 - smoothstep(0.4, 0.48, wetN);
    col = mix(col, col * vec3(0.7, 0.66, 0.64), wet * dirtW);
    col = mix(col, col * vec3(1.16, 1.11, 1.02), dry * dirtW);
  }
}
`;

// The blue the snow lets through out of the sun, at any distance.
const SNOW_BLUE = 'tSpark += vec3(0.02, 0.04, 0.08) * (uGroundK.y * snowW) * (1.0 - smoothstep(-0.12, 0.08, dot(tDetailNormal, uSunDirW))) * smoothstep(-0.05, 0.2, uSunDirW.y);';

// What the maps do to the normal, and the glint and the blue they add to the light.
export const GROUND_NORMAL = /* glsl */`
{
  tSpark = vec3(0.0);
  vec3 gdx = dFdx(wp);
  vec3 gdy = dFdy(wp);
  vec3 bump = vec3(0.0);
  float cutK = 1.0 - onCut;
  // The rock: blocks, joints and beds, as far as 140 m, and close by a finer read of it; from 40 m to 300 m a coarser
  // read (a tile of 64 m), the blocks and beds as big as they look from there. Its pattern is bent by a smooth noise
  // (the detail's, from high up its mips), so that its tiles do not show.
  float rockB = uGroundK.x * max(rockW, outcrop * (1.0 - fillW));
  float rockK = rockB * (1.0 - smoothstep(90.0, 140.0, dist));
  float rockC = rockB * smoothstep(40.0, 100.0, dist) * (1.0 - smoothstep(220.0, 300.0, dist));
  if (GATE(rockK > 0.004 || rockC > 0.004)) {
    float bedsK = smoothstep(0.28, 0.5, slope);
    vec3 bend = vec3(textureLod(uDetail, wp.xz / 131.0, 4.0).r, textureLod(uDetail, wp.zy / 131.0 + 0.3, 4.0).g, textureLod(uDetail, wp.xy / 97.0 + 0.6, 4.0).r) - 0.5;
    vec3 pw = wp + bend * 36.0;
    if (GATE(rockK > 0.004)) {
      vec4 r1 = gRock(pw, tw, 1.0 / 16.0, gdx, gdy, bedsK);
      vec3 b = r1.xyz;
      float sky = r1.w;
      float closeK = 1.0 - smoothstep(12.0, 30.0, dist);
      if (GATE(closeK > 0.0)) {
        vec4 r2 = gRock(pw + 3.7, tw, 1.0 / 3.6, gdx, gdy, 0.0);
        b += r2.xyz * 0.5 * closeK;
        sky = mix(sky, sky * r2.w, 0.5 * closeK);
      }
      bump += b * rockK * (1.0 - 0.45 * cutK);
      tCrev *= mix(1.0, sky, rockK);
    }
    if (GATE(rockC > 0.004)) {
      bump += gRock(pw + 11.0, tw, 1.0 / 64.0, gdx, gdy, bedsK).xyz * rockC * 0.6;
    }
  }
  // Gravel, where the road has cut, filled and laid its verge.
  float gritK = uGroundK.y * max(vergeW, max(smoothstep(0.35, 0.85, fillW), cutK * 0.75)) * (1.0 - snowW) * (1.0 - smoothstep(14.0, 38.0, dist));
  if (GATE(gritK > 0.004)) {
    bump += gGrit(wp, tw, 1.0 / 1.44, gdx, gdy) * gritK * 0.9;
  }
  // Sand: ripples across the wind on level ground, and none on a dune's far side; the glint of grains
  // against the sun, along the ground.
  vec2 wind = vec2(${Math.cos(WIND).toFixed(4)}, ${Math.sin(WIND).toFixed(4)});
  float sandA = worldPar(5).x * (1.0 - rockW) * (1.0 - screeW) * (1.0 - fillW) * (1.0 - vergeW) * (1.0 - snowW) * (1.0 - outcrop);
  if (wHasWater > 0.01) {
    float shoreS = alt - wWater + (dN.g - 0.5) * 0.8 + (dF.r - 0.5) * 1.4;
    sandA = max(sandA, (1.0 - smoothstep(wShore * 0.7, wShore + 0.6, shoreS)) * (1.0 - rockW * 0.6) * wHasWater);
  }
  float lee = 1.0 - smoothstep(0.02, 0.14, dot(wn.xz, wind));
  // (Sand the sea has just left is wet: smooth, and its grains do not glint: render/swash.js.)
  float sandK = uGroundK.y * sandA * lee * smoothstep(0.55, 0.8, wn.y) * (1.0 - tWet);
  if (GATE(sandK > 0.004 && dist < 240.0)) {
    bump += gRipple(wp.xz, gdx.xz, gdy.xz, 1.0 / 1.44, wind) * sandK * (1.0 - smoothstep(8.0, 38.0, dist)) * 0.9;
    bump += gRipple(wp.xz + 5.3, gdx.xz, gdy.xz, 1.0 / 8.64, wind) * sandK * (1.0 - smoothstep(40.0, 240.0, dist)) * 0.7;
  }
  float glintK = uGroundK.y * sandA * (1.0 - smoothstep(30.0, 75.0, dist)) * (1.0 - tWet);
  if (GATE(glintK > 0.004)) {
    vec3 vd = normalize(vTPos - cameraPosition);
    float along = (1.0 - smoothstep(0.08, 0.4, abs(vd.y))) * smoothstep(0.4, 0.95, dot(normalize(vd.xz + 1e-4), normalize(uSunDirW.xz + 1e-4)));
    float cell = exp2(ceil(log2(clamp(length(gdx.xz), 0.02, 0.5))));
    vec2 cellId = floor(wp.xz / cell);
    float grain = step(0.994, gGlint(cellId)) * (0.5 + 0.5 * gGlint(cellId + 17.0));
    tSpark += vec3(1.0, 0.92, 0.78) * (grain * along * glintK * vShade.x * 2.4);
  }
  // Snow: ripples as shallow as drifts, and the blue the snow lets through out of the sun.
  float snowK = uGroundK.y * snowW * (1.0 - smoothstep(25.0, 120.0, dist)) * smoothstep(0.45, 0.75, wn.y);
  if (GATE(snowK > 0.004)) {
    vec2 wind2 = vec2(${Math.cos(WIND + 1.2).toFixed(4)}, ${Math.sin(WIND + 1.2).toFixed(4)});
    bump += gRipple(wp.xz, gdx.xz, gdy.xz, 1.0 / 4.32, wind2) * snowK * 0.5;
  }
  // (Where nothing is laid the normal is not touched: the pixel is as it was without any of this. Where the reads
  // add up to more than the normal can take they are cut back, so that no wall turns its back on the light.)
  float bumpLen = length(bump);
  if (bumpLen > 0.0) tDetailNormal = normalize(tDetailNormal + bump * min(1.0, 0.9 / bumpLen));
  ${SNOW_BLUE}
}
`;

// The far tiles' program (render/terrain.js, FAR_PROGRAM): of all of this only the blue of the snow is left past
// 300 m, and the normal is the land's.
export const FAR_GROUND_COMMON = /* glsl */`
uniform vec4 uGroundK;
vec3 tSpark;
`;
export const FAR_SPARK = /* glsl */`
{
  tSpark = vec3(0.0);
  ${SNOW_BLUE}
}
`;
