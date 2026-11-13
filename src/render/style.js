// Styles of drawing: the same world drawn as it is, or the way a painter of
// animated films, an ink painter, an animator, a woodblock cutter or an old
// console would draw it.
//
// A style is one set of numbers, read in three places:
//  - the light on every lit material (patchLighting, called from
//    withAtmosphere in atmosphere.js): the sun's light in bands, the shade
//    tinted, less shine, crisper cast shadows, and the car marking itself in
//    the frame's alpha so the last pass can find it;
//  - the sky (atmosphere.js): heaped, painted clouds and a deeper blue;
//  - one pass after the final grade (render/post.js, STYLE_PASS): brush
//    strokes, ink, lines, a printer's few colours, pixels, paper.
// A change of style moves every number from one set to the other over
// SWITCH_SECONDS, so one style turns into the next instead of cutting. With
// the real style every one of them is off, and the frame is the frame as it
// was before there were styles.

import * as THREE from 'three';

export const SWITCH_SECONDS = 1.4;

export const STYLES = [
  { id: 'real', name: '写实' },
  { id: 'paint', name: '手绘' },
  { id: 'ink', name: '水墨' },
  { id: 'cel', name: '赛璐璐' },
  { id: 'print', name: '版画' },
  { id: 'pixel', name: '像素' },
];
export const STYLE_INDEX = Object.fromEntries(STYLES.map((s, i) => [s.id, i]));

// Everything off: the world as it is.
const BASE = {
  // Light (materials). lit: how far the sun's light is banded; rampAt: the
  // two band edges in the cosine of the sun's angle and their softness;
  // rampLv: the light in the dark, middle and lit band; shade: the sky's
  // light where the sun does not reach, tinted; spec: shine kept; shadow:
  // how crisp a cast shadow's edge is; mark: the car marks itself.
  lit: 0, rampAt: [0.2, 0.55, 0.06], rampLv: [0, 0.6, 1], shade: [1, 1, 1], spec: 1, shadow: 0, mark: 0,
  // Sky.
  cumulus: 0, deep: 0,
  // The last pass. paint: brush strokes (a Kuwahara filter), stroke: their
  // size; flat: flat colour (a blur that keeps to one surface), flatR: its
  // reach; line: lines at edges, lineW px wide, where the depth jumps
  // (between jump[0] and jump[1] of it) or its slope breaks (crease), only
  // on the car with lineCar, in lineCol or the colour under them darkened
  // (lineDark), fading out by lineFar metres, broken like a dry brush with
  // brush; ridge: where the land meets the sky, a line however far; ink:
  // an ink wash in five tones on paper, keep: the car keeps its colour;
  // blank: the sky left as paper; poster: brightness cut to levels; print:
  // the shadows printed in indigo and the lights left as paper, bokashi:
  // the sky printed as a band of indigo fading into the paper; pixel:
  // blocks, rows of them down the screen; dither: a console's palette,
  // dithered by ditherK; grain: paper; far: the distance turning blue; lift:
  // midtones raised; green: greens warmer in the light and cooler in the
  // shade.
  paint: 0, stroke: 1, flat: 0, flatR: 1.5,
  line: 0, lineW: 1, jump: [0.04, 0.12], crease: 0.8, lineCar: 0, lineCol: [0.1, 0.09, 0.08], lineDark: 0, lineFar: 600,
  brush: 0, ridge: 0,
  ink: 0, keep: 0, blank: 0, poster: 0, levels: 6, print: 0, bokashi: 0,
  pixel: 0, rows: 200, dither: 0, ditherK: 0.85, grain: 0,
  far: 0, lift: 0, green: 0,
  sat: 1, contrast: 1, warm: 0, vignette: 0, paper: [0.95, 0.93, 0.88], inkCol: [0.1, 0.09, 0.085],
};

const PRESETS = {
  real: {},
  // After the painted backgrounds of hand-drawn animated films: soft bands
  // of light, blue-violet shade, white heaped cumulus in a deep sky, greens
  // full and warm, the distance blue, everything laid on in gouache
  // strokes; only the car is inked, as a character on a painted ground is.
  paint: {
    lit: 0.85, rampAt: [0.06, 0.42, 0.14], rampLv: [0, 0.74, 1], shade: [0.84, 0.92, 1.32], spec: 0.35, shadow: 0.55, mark: 1,
    cumulus: 1, deep: 0.7,
    paint: 1, stroke: 1.7, line: 1, lineW: 1.4, lineCar: 1, lineCol: [0.17, 0.12, 0.1], lineDark: 0.55, lineFar: 300,
    far: 0.55, lift: 0.12, green: 0.6,
    grain: 0.28, sat: 1.32, contrast: 1.05, warm: 0.04, vignette: 0.12, paper: [0.98, 0.96, 0.91],
  },
  // Ink on paper: five tones of ink (焦 浓 重 淡 清) and the paper, sky and
  // haze left blank, near things and every ridge against the sky drawn with
  // a brush that runs dry, the forest far off only dabs of ink; the car's
  // orange the only colour on the page.
  ink: {
    mark: 1, flat: 1, flatR: 2.4, line: 1, lineW: 1.6, jump: [0.1, 0.3], crease: 0.25, lineFar: 700, ridge: 1,
    brush: 1, lineCol: [0.07, 0.065, 0.06],
    ink: 1, keep: 1, blank: 1, grain: 0.7, paper: [0.95, 0.92, 0.85], inkCol: [0.075, 0.07, 0.065], vignette: 0.16,
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
  // (bokashi), black key lines, cream paper with its grain.
  print: {
    lit: 0.6, rampAt: [0.12, 0.5, 0.03], rampLv: [0, 0.7, 1], shade: [0.9, 0.93, 1.08], spec: 0.2, shadow: 0.8,
    flat: 1, flatR: 2.2, line: 1, lineW: 1.4, jump: [0.06, 0.18], crease: 0.5, lineCol: [0.1, 0.09, 0.085], lineFar: 1500, ridge: 1,
    poster: 1, levels: 4, print: 1, bokashi: 1, lift: 0.24, grain: 0.8, sat: 1.08, contrast: 1.0, paper: [0.95, 0.91, 0.81], vignette: 0.1,
  },
  // An old console: 180 rows of blocks, eight levels a channel, ordered
  // dithering.
  pixel: { pixel: 1, rows: 180, dither: 1, ditherK: 0.45, levels: 8, sat: 1.18, contrast: 1.06 },
};

const clone = (o) => JSON.parse(JSON.stringify(o));
export const styleParams = (id) => ({ ...clone(BASE), ...clone(PRESETS[id] || {}) });

// The lit materials' share of a style (atmosphere.js assigns these to every
// material it hooks).
export const styleU = {
  uStyleLit: { value: 0 },
  uRampAt: { value: new THREE.Vector3(0.2, 0.55, 0.06) },
  uRampLv: { value: new THREE.Vector3(0, 0.6, 1) },
  uShadeTint: { value: new THREE.Vector3(1, 1, 1) },
  uSpecK: { value: 1 },
  uShadowK: { value: 0 },
  uStyleMark: { value: 0 },
};

// The sky's (atmosphere.js's sky material).
export const skyStyle = {
  uCumulus: { value: 0 },
  uSkyDeep: { value: 0 },
};

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
uniform vec3 uShadeTint;
uniform float uSpecK;
uniform float uShadowK;
uniform float uStyleMark;
uniform float uMarkSelf;`)
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
  reflectedLight.directDiffuse += r.directDiffuse * mix( 1.0, styleRamp( d ) / max( d, 1e-3 ), uStyleLit );
  reflectedLight.directSpecular += r.directSpecular * uSpecK;
}
void RE_IndirectDiffuse_Style( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  vec3 e = uStyleLit > 0.0 ? irradiance * mix( vec3( 1.0 ), uShadeTint, uStyleLit ) : irradiance;
  RE_IndirectDiffuse_Physical( e, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
}
void RE_IndirectSpecular_Style( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  if ( uStyleLit > 0.0 ) {
    RE_IndirectSpecular_Physical( radiance * uSpecK, irradiance, clearcoatRadiance * uSpecK, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
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
    .replace('#include <dithering_fragment>', `#include <dithering_fragment>
// The car, marked in the alpha for the last pass (render/post.js).
gl_FragColor.a = mix( gl_FragColor.a, 0.5, uStyleMark * uMarkSelf );`);
}

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
    uGrain: { value: 0 },
    uGrade: { value: new THREE.Vector4(1, 1, 0, 0) },
    uPaper: { value: new THREE.Vector3(1, 1, 1) },
    uInkCol: { value: new THREE.Vector3() },
    uBlank: { value: 0 },
    uBokashi: { value: 0 },
    uFar: { value: 0 },
    uLift: { value: 0 },
    uGreen: { value: 0 },
    uDitherK: { value: 0.85 },
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
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
    uniform float uGrain;
    uniform vec4 uGrade;
    uniform vec3 uPaper;
    uniform vec3 uInkCol;
    uniform float uBlank;
    uniform float uBokashi;
    uniform float uFar;
    uniform float uLift;
    uniform float uGreen;
    uniform float uDitherK;
    uniform mat4 uInvProj;
    uniform mat4 uCamWorld;
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

    // Brush strokes: the mean of whichever quarter of the neighbourhood is
    // the most even, blended by how even each is, so flat areas stay flat
    // and edges stay sharp.
    vec3 kuwahara(vec2 uv, vec2 s) {
      vec3 m0 = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0), m3 = vec3(0.0);
      vec3 q0 = vec3(0.0), q1 = vec3(0.0), q2 = vec3(0.0), q3 = vec3(0.0);
      for (int j = -3; j <= 3; j++) {
        for (int i = -3; i <= 3; i++) {
          vec3 c = texture2D(tDiffuse, uv + vec2(float(i), float(j)) * s).rgb;
          vec3 cc = c * c;
          if (i <= 0 && j <= 0) { m0 += c; q0 += cc; }
          if (i >= 0 && j <= 0) { m1 += c; q1 += cc; }
          if (i <= 0 && j >= 0) { m2 += c; q2 += cc; }
          if (i >= 0 && j >= 0) { m3 += c; q3 += cc; }
        }
      }
      m0 /= 16.0; m1 /= 16.0; m2 /= 16.0; m3 /= 16.0;
      float v0 = dot(q0 / 16.0 - m0 * m0, vec3(1.0));
      float v1 = dot(q1 / 16.0 - m1 * m1, vec3(1.0));
      float v2 = dot(q2 / 16.0 - m2 * m2, vec3(1.0));
      float v3 = dot(q3 / 16.0 - m3 * m3, vec3(1.0));
      float w0 = 1.0 / pow(1.0 + 600.0 * max(v0, 0.0), 4.0);
      float w1 = 1.0 / pow(1.0 + 600.0 * max(v1, 0.0), 4.0);
      float w2 = 1.0 / pow(1.0 + 600.0 * max(v2, 0.0), 4.0);
      float w3 = 1.0 / pow(1.0 + 600.0 * max(v3, 0.0), 4.0);
      return (m0 * w0 + m1 * w1 + m2 * w2 + m3 * w3) / (w0 + w1 + w2 + w3);
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
      // The sky is drawn on the far plane; the land ends well short of it.
      float zc = texture2D(tDepth, uv).r;
      float sky = step(0.999995, zc);
      float wc = invDepth(uv);
      float dist = 1.0 / wc;
      if (uPaint > 0.0) col = mix(col, kuwahara(uv, px * uPaintR), uPaint);
      if (uFlat > 0.0) col = mix(col, flatten(uv, px * uFlatR, wc), uFlat);

      // Grade: saturation, contrast, a warmer light, midtones raised.
      col = mix(vec3(luma(col)), col, uGrade.x);
      col = (col - 0.5) * uGrade.y + 0.5;
      col *= vec3(1.0 + uGrade.z, 1.0 + uGrade.z * 0.3, 1.0 - uGrade.z);
      col = clamp(col, 0.0, 1.0);
      if (uLift > 0.0) col = pow(col, vec3(1.0 - uLift));
      // Greens: warmer in the light, cooler in the shade.
      if (uGreen > 0.0) {
        float gm = clamp((col.g - max(col.r, col.b)) * 5.0, 0.0, 1.0);
        vec3 warm = col * vec3(1.16, 1.05, 0.74);
        vec3 cool = col * vec3(0.8, 0.96, 1.14);
        col = mix(col, mix(cool, warm, smoothstep(0.16, 0.5, luma(col))), gm * uGreen);
      }
      // The distance turning blue, layer behind layer.
      if (uFar > 0.0) {
        float f = smoothstep(450.0, 4500.0, dist) * (1.0 - sky);
        col = mix(col, vec3(0.5, 0.64, 0.84) * (0.55 + 0.65 * luma(col)), f * uFar * 0.6);
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
        tone = min(tone, 0.9) * (0.94 + 0.12 * vnoise(gl_FragCoord.xy * 0.006));
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
        if (uBrush > 0.0) {
          // A brush: thicker and thinner along the stroke, and now and then
          // running dry.
          float n1 = vnoise(gl_FragCoord.xy * 0.035);
          float n2 = vnoise(gl_FragCoord.xy * 0.09 + 17.0);
          e *= mix(1.0, (0.6 + 0.7 * n1) * smoothstep(0.08, 0.3, n2), uBrush);
        }
        vec3 lc = mix(uLineCol, base * 0.32, uLineDark);
        col = mix(col, lc, clamp(e, 0.0, 1.0) * uLine);
      }

      // Paper: a fine tooth, and fibres.
      if (uGrain > 0.0) {
        vec2 f = gl_FragCoord.xy;
        float g = vnoise(f * 0.75) * 0.5 + vnoise(f * 0.12) * 0.32 + vnoise(f * vec2(0.025, 0.6)) * 0.18;
        col *= mix(1.0, 0.9 + 0.13 * g, uGrain);
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
    u.uShadeTint.value.fromArray(c.shade);
    u.uSpecK.value = c.spec;
    u.uShadowK.value = c.shadow;
    u.uStyleMark.value = c.mark > 0.5 ? 1 : 0;
    skyStyle.uCumulus.value = c.cumulus;
    skyStyle.uSkyDeep.value = c.deep;
  }

  // Whether the last pass has anything to do.
  get drawn() {
    const c = this.cur;
    return c.paint > 0 || c.flat > 0 || c.line > 0 || c.ink > 0 || c.poster > 0 || c.print > 0 || c.bokashi > 0 || c.pixel > 0
      || c.dither > 0 || c.grain > 0 || c.far > 0 || c.lift > 0 || c.green > 0
      || c.sat !== 1 || c.contrast !== 1 || c.warm !== 0 || c.vignette > 0;
  }

  // The last pass's numbers.
  applyPass(u, height) {
    const c = this.cur;
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
    u.uGrain.value = c.grain;
    u.uGrade.value.set(c.sat, c.contrast, c.warm, c.vignette);
    u.uPaper.value.fromArray(c.paper);
    u.uInkCol.value.fromArray(c.inkCol);
    u.uBlank.value = c.blank;
    u.uBokashi.value = c.bokashi;
    u.uFar.value = c.far;
    u.uLift.value = c.lift;
    u.uGreen.value = c.green;
    u.uDitherK.value = c.ditherK;
  }
}
