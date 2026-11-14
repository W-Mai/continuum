// Sky, aerial perspective and image-based light, from one set of numbers.
//
// The sky dome and the fog on every surface evaluate the same horizon colour
// and the same sun glow, so a ridge 6 km away dissolves into exactly the sky
// behind it. Fog thins with height (a valley fills with haze, a summit stands
// clear of it) and warms toward the sun. The environment map that lights the
// car paint and the wet-looking asphalt is rendered from this same sky.

import * as THREE from 'three';
import { patchLighting, styleU, skyStyle, skyDay } from './style.js';
import { twistU, TWIST_PARS } from './twist.js';

// Shared uniform objects: every material that opts in references these, so a
// change of light or weather is one assignment, not a traversal.
export const atmo = {
  fogParams: { value: new THREE.Vector3(0.00016, 0, 650) },   // density, base height, falloff
  fogSunDir: { value: new THREE.Vector3(0.5, 0.4, 0.5).normalize() },
  fogSunColor: { value: new THREE.Color(0xffd7a8) },
  // Scales the sky's image-based light (diffuse and reflections) on every
  // material: the sky goes out in a tunnel. three.js r160 has no
  // scene.environmentIntensity, so it is applied in the shader.
  uEnvScale: { value: 1 },
  // The view turned over (render/twist.js).
  ...twistU,
};

// Height fog with sun in-scatter. vFogWorld is rebuilt from the view-space
// position with the camera's own matrices, which every three.js vertex shader
// has, so this works for sprites and points as well as meshes.
THREE.ShaderChunk.fog_pars_vertex = `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif
`;
THREE.ShaderChunk.fog_vertex = `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = cameraPosition + transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
#endif
`;
THREE.ShaderChunk.fog_pars_fragment = `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec3 fogParams;
  uniform vec3 fogSunDir;
  uniform vec3 fogSunColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
`;
THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  float fogFactor;
  vec3 fogCol = fogColor;
  if ( fogParams.z > 0.5 ) {
    vec3 fogRay = vFogWorld - cameraPosition;
    float fogDist = length( fogRay );
    vec3 fogDir = fogRay / max( fogDist, 1e-3 );
    float k = 1.0 / fogParams.z;
    float hc = ( cameraPosition.y - fogParams.y ) * k;
    float dy = fogRay.y * k;
    float spread = abs( dy ) > 1e-4 ? ( 1.0 - exp( - dy ) ) / dy : 1.0;
    float optical = fogParams.x * fogDist * exp( - hc ) * spread;
    fogFactor = 1.0 - exp( - optical );
    float sunAmt = pow( max( dot( fogDir, fogSunDir ), 0.0 ), 8.0 );
    fogCol = mix( fogColor, fogSunColor, sunAmt );
  } else {
    #ifdef FOG_EXP2
      fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
  }
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );
#endif
`;

// Opt a material into the shared atmosphere uniforms, chaining any existing
// onBeforeCompile hook. It also takes the style's light (render/style.js);
// a material with userData.styleMark (the car's) marks itself for the
// style's last pass.
export function withAtmosphere(material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    Object.assign(shader.uniforms, atmo, styleU);
    shader.uniforms.uMarkSelf = { value: material.userData.styleMark ? 1 : 0 };
    shader.uniforms.uCreatureSelf = { value: material.userData.styleCreature ? 1 : 0 };
    shader.uniforms.uLiftSelf = { value: material.userData.styleLift ? 1 : 0 };
    shader.uniforms.uClumpSelf = { value: material.userData.styleClump ? 1 : 0 };
    if (prev) prev.call(material, shader, renderer);
    // At this point iblIrradiance, radiance and clearcoatRadiance hold only
    // the environment's contribution.
    shader.fragmentShader = patchLighting(shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uEnvScale;')
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
#if defined( RE_IndirectSpecular )
  iblIrradiance *= uEnvScale;
  radiance *= uEnvScale;
  #ifdef USE_CLEARCOAT
    clearcoatRadiance *= uEnvScale;
  #endif
#endif`));
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  material.customProgramCacheKey = () => key + '|atmo';
  return material;
}

// The sun as seen from the car: how much of it gets past the ridges. Set each
// frame by the game; the car and the traffic read it.
export const sunMask = { value: 1 };

// How much of the sky's light reaches the inside of a tunnel bore, and the car,
// as seen from where the camera is. Both are 1 unless the lens is outside and
// the subject inside: then the bore reads as the dark mouth it is.
export const boreSky = { value: 1 };
export const carSky = { value: 1 };

// Scale the sky's share of the light on a material (hemisphere fill and the
// environment) by a uniform, where a fragment expression is 1: the tunnel
// bore everywhere, the asphalt only inside one.
export function withSkyScale(material, uniform, where = '1.0') {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(material, shader, renderer);
    shader.uniforms.uSkyScale = uniform;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSkyScale;')
      .replace('#include <lights_fragment_end>', `{
  float skyK = mix(1.0, uSkyScale, ${where});
  irradiance *= skyK;
  #if defined( RE_IndirectSpecular )
    iblIrradiance *= skyK;
    radiance *= skyK;
  #endif
}
#include <lights_fragment_end>`);
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  material.customProgramCacheKey = () => key + '|sky';
  return material;
}

// Scale direct sunlight by a mask, either per vertex (aSun, baked by the road
// mesh from the same ray march the terrain uses) or by the shared uniform.
// Without it the road and the car stay sunlit in the shadow a ridge casts on
// the whole valley, which is the first thing the eye notices.
export function withSunMask(material, perVertex) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(material, shader, renderer);
    if (perVertex) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSun;\nvarying float vSunMask;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSunMask = aSun;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vSunMask;');
    } else {
      shader.uniforms.uSunMask = sunMask;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uSunMask;\n#define vSunMask uSunMask');
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>',
      THREE.ShaderChunk.lights_fragment_begin.replace(
        'getDirectionalLightInfo( directionalLight, directLight );',
        'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= vSunMask;',
      ));
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  material.customProgramCacheKey = () => key + (perVertex ? '|sunv' : '|sunu');
  return material;
}

const skyVert = /* glsl */`
${TWIST_PARS}
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * twistSky(modelViewMatrix * vec4(position, 1.0));
  gl_Position = p.xyww;   // on the far plane
}
`;

const skyFrag = /* glsl */`
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uGlow;
uniform float uSunSize;
uniform float uTime;
uniform float uCloud;
uniform float uStars;
uniform float uPlanet;
uniform float uCumulus;
uniform float uSkyPaint;
uniform float uSkyDeep;
uniform float uSkyBlue;
uniform float uSkySat;
uniform float uTowers;
uniform float uBlockSky;
uniform float uUpside;
uniform float uFlash;
uniform vec4 uBolt;
varying vec3 vDir;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash3(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p;
    a *= 0.5;
  }
  return v;
}
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}
// Where a bolt is across its own line, a point t of the way down it: the
// line wanders, in three sizes.
float boltOff(float t, float seed) {
  return 0.07 * (vnoise(vec2(t * 6.0, seed)) - 0.5) + 0.025 * (vnoise(vec2(t * 19.0, seed + 5.0)) - 0.5)
    + 0.008 * (vnoise(vec2(t * 61.0, seed + 9.0)) - 0.5);
}

void main() {
  vec3 d = normalize(vDir);
  // How wide a pixel is, in radians: for edges drawn in the sky.
  float pxAng = max(length(fwidth(d)), 1e-5);
  float y = d.y;
  float mu = max(dot(d, uSunDir), 0.0);

  // Rayleigh-ish gradient: deep at the zenith, pale and bright at the horizon.
  float up = clamp(y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.42));
  col = mix(col, uGround, smoothstep(0.0, -0.18, y));
  // A day's sky, as against a night's, the inferno's or space's: the painted
  // style's blue and clouds are for a day; the others keep their own.
  float day = smoothstep(0.02, 0.06, dot(uZenith, vec3(0.2126, 0.7152, 0.0722)));
  // A deeper blue overhead, for the drawn styles (render/style.js).
  if (uSkyDeep > 0.0) col = mix(col, col * vec3(0.72, 0.88, 1.16), uSkyDeep * smoothstep(0.04, 0.75, y));
  // A fuller blue all the way down, and a deep one coming down close to the
  // horizon: the sky is drawn before the exposure, which would bleach a pale
  // blue white.
  if (uSkySat > 0.0) {
    float sl = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = max(mix(vec3(sl), col, 1.0 + uSkySat * day), 0.0);
  }
  if (uSkyBlue > 0.0) {
    vec3 kd = mix(vec3(0.97, 0.99, 1.02), vec3(0.3, 0.52, 1.04), smoothstep(0.0, 0.38, y));
    col = mix(col, col * kd, uSkyBlue * day);
  }

  // The same glow the fog uses, so the horizon and the haze agree exactly.
  col = mix(col, uGlow, pow(mu, 8.0) * (1.0 - 0.6 * smoothstep(0.0, 0.6, y)));
  // Mie halo and the disc.
  col += uSunColor * (pow(mu, 220.0) * 0.6 + pow(mu, 30.0) * 0.12);
  float disc = smoothstep(cos(uSunSize), cos(uSunSize * 0.82), dot(d, uSunDir)) * (1.0 - uBlockSky * day);
  col += uSunColor * disc * 22.0;

  // A layer of cumulus seen from below: projected onto a plane, thinned toward
  // the horizon, lit warm on the sun side and grey on the shadow side.
  if (y > 0.0 && uCloud > 0.0) {
    vec2 uv = d.xz / (y + 0.12) * 1.8 + vec2(uTime * 0.004, uTime * 0.0015);
    float n = fbm(uv);
    float cover = smoothstep(0.58 - uCloud * 0.25, 0.86, n);
    float lit = 0.55 + 0.45 * pow(mu, 3.0);
    vec3 cloud = mix(uHorizon * 0.78, uSunColor * 1.05, lit) * (0.82 + 0.25 * fbm(uv * 2.7));
    float fade = smoothstep(0.02, 0.22, y);
    col = mix(col, cloud, cover * fade * 0.9 * (1.0 - uCumulus) * (1.0 - uBlockSky * day));
  }

  // Heaped cumulus, laid on the way a painter of animated films lays them:
  // cut sharp against the sky, white where the sun is on them, grey-violet
  // underneath; heaps overhead, and banks standing on the horizon.
  if (uCumulus > 0.0 && uCloud > 0.0 && y > -0.03) {
    float k = uCumulus * smoothstep(0.08, 0.4, uCloud);
    // Painted (uSkyPaint): only in a day's sky; fewer heaps, whiter, and a
    // shaded side dark enough that the exposure and the tone curve leave one.
    vec3 shade = mix(uHorizon, vec3(0.6, 0.62, 0.8), 0.6);
    float edge = 0.62 - uCloud * 0.16;
    if (uSkyPaint > 0.0) {
      k *= mix(1.0, day, uSkyPaint);
      shade *= mix(1.0, 0.62, uSkyPaint);
      edge = mix(edge, 0.66 - uCloud * 0.14, uSkyPaint);
    }
    vec3 white = mix(vec3(1.0, 0.985, 0.95), uSunColor, 0.15);
    vec2 cuv = d.xz / (y + 0.1) * 1.05 + vec2(uTime * 0.003, uTime * 0.0012);
    float n = fbm(cuv);
    float nl = fbm(cuv + normalize(uSunDir.xz + 1e-4) * 0.07);
    float heap = smoothstep(edge, edge + 0.02, n) * smoothstep(0.03, 0.2, y);
    float sunlit = smoothstep(-0.02, 0.05, nl - n + 0.012);
    float lit = 0.25 + 0.75 * sunlit;
    if (uSkyPaint > 0.0) lit = mix(lit, 0.4 + 0.6 * sunlit, uSkyPaint);
    col = mix(col, mix(shade, white, lit), heap * k);
    vec2 h2 = normalize(d.xz + 1e-5);
    float top = 0.03 + 0.2 * pow(fbm(h2 * 2.3 + 11.0), 1.8);
    float puff = (fbm(h2 * 14.0 + vec2(y * 12.0, 3.0)) - 0.5) * 0.07;
    float bank = smoothstep(top + puff + 0.004, top + puff - 0.004, y) * smoothstep(-0.03, 0.005, y);
    float rise = clamp(y / max(top, 1e-3), 0.0, 1.0);
    float sunSide = 0.5 + 0.5 * dot(h2, normalize(uSunDir.xz + 1e-4));
    vec3 bc = mix(shade * 0.96, white, smoothstep(0.25, 0.85, rise * 0.65 + sunSide * 0.35 + puff * 3.0));
    col = mix(col, bc, bank * k);
  }

  // Towers of cumulus standing on the horizon, as the painters of
  // hand-drawn animated films lay them in: a heap of lumpy puffs on a flat
  // base, cut sharp against the sky, white where the sun is on them,
  // blue-grey on the shaded side, in the folds between puffs and
  // underneath, a bright rim when the sun is behind them. Each puff is a
  // ball seen from the front with a ragged rim; the front-most one at a
  // point gives the normal the sun lights, and where the next one is
  // nearly as near, there is a fold.
  if (uTowers > 0.0 && uCloud > 0.0 && day > 0.0 && y > 0.0 && y < 0.85) {
    float k = uTowers * smoothstep(0.08, 0.4, uCloud) * day;
    float az = atan(d.z, d.x);
    float el = asin(clamp(y, -1.0, 1.0));
    float sunAz = atan(uSunDir.z, uSunDir.x);
    float sunEl = asin(clamp(uSunDir.y, -1.0, 1.0));
    vec3 white = mix(vec3(1.02, 1.0, 0.96), uSunColor, 0.18);
    vec3 shade = mix(uHorizon, vec3(0.44, 0.52, 0.82), 0.66) * 0.58;
    for (int c = 0; c < 9; c++) {
      float fc = float(c);
      float ca = (fc + 0.2 + 0.6 * hash(vec2(fc, 7.1))) / 9.0 * 6.2832 - 3.1416;
      float s = 0.06 + 0.08 * hash(vec2(fc, 3.3));
      // They stand behind the ridges, their feet in the haze.
      float base = 0.03 + 0.12 * hash(vec2(fc, 9.7));
      float tall = 0.8 + 0.9 * hash(vec2(fc, 5.3));
      float da = mod(az - ca + 3.1416, 6.2832) - 3.1416;
      if (abs(da) > s * 3.4) continue;
      vec2 p = vec2(da * cos(el), el - base);
      if (p.y < -0.01 || p.y > s * 4.0 * tall) continue;
      // Fourteen puffs: five along the base, four over them, three, two,
      // smaller as they go up, each a little off its row.
      float best = -1.0;
      float second = -1.0;
      vec2 q0 = vec2(0.0);
      float r0 = 1.0;
      for (int i = 0; i < 14; i++) {
        float fi = float(i);
        float row = i < 5 ? 0.0 : i < 9 ? 1.0 : i < 12 ? 2.0 : 3.0;
        float first = row == 0.0 ? 0.0 : row == 1.0 ? 5.0 : row == 2.0 ? 9.0 : 12.0;
        float count = 5.0 - row;
        float slot = fi - first - (count - 1.0) * 0.5;
        float hx = hash(vec2(fc * 23.0 + fi, 1.3));
        float hy = hash(vec2(fc * 23.0 + fi, 8.9));
        float spread = 0.86 - row * 0.1;
        vec2 cp = vec2((slot * spread + (hx - 0.5) * 0.45) * s, (0.45 + row * 0.62 * tall + (hy - 0.5) * 0.3) * s);
        float r = s * (0.62 - row * 0.07 + 0.2 * hash(vec2(fc * 23.0 + fi, 4.4)));
        vec2 q = p - cp;
        // A ragged rim: the radius swells and dips round the puff.
        float th = atan(q.y, q.x);
        float ph = hash(vec2(fc * 23.0 + fi, 6.6)) * 6.2832;
        r *= 1.0 + 0.07 * sin(th * 5.0 + ph) + 0.04 * sin(th * 11.0 - ph * 1.7);
        float z = r * r - dot(q, q);
        if (z > best) {
          second = best;
          best = z;
          q0 = q;
          r0 = r;
        } else if (z > second) {
          second = z;
        }
      }
      float aa = 3.0 * r0 * pxAng + 1e-7;
      float cover = smoothstep(0.0, aa, best) * smoothstep(0.0, 1.5 * pxAng, p.y);
      if (cover <= 0.0) continue;
      vec3 n3 = normalize(vec3(q0, sqrt(max(best, 0.0))));
      float dsa = mod(sunAz - ca + 3.1416, 6.2832) - 3.1416;
      vec3 l3 = normalize(vec3(sin(dsa) * cos(sunEl) * 1.3, sin(sunEl) + 0.55, -cos(dsa) * cos(sunEl)));
      float lit = dot(n3, l3);
      // Light and shade in two values with a short step between, the way a
      // painter lays them; a touch warmer at the top of the lit side.
      vec3 cc = mix(shade, white, smoothstep(0.05, 0.3, lit));
      cc += white * 0.12 * smoothstep(0.55, 0.95, lit);
      float fold = (1.0 - smoothstep(0.0, r0 * r0 * 0.22, best - max(second, 0.0))) * step(0.0, second);
      cc = mix(cc, shade * 1.05, fold * 0.55);
      // Flat and darker underneath; a bright rim against a low sun behind.
      cc = mix(cc, shade * 0.9, (1.0 - smoothstep(0.0, s * 0.8, p.y)) * 0.6);
      float back = smoothstep(0.3, 1.0, cos(dsa));
      cc += white * pow(1.0 - n3.z, 3.0) * back * 0.6;
      // Feet in the haze: the lower part of a tower fades into the horizon.
      cc = mix(cc, uHorizon, (1.0 - smoothstep(0.0, s * 0.7, p.y)) * 0.3);
      col = mix(col, cc, cover * k);
    }
  }

  // A world of blocks' sky (render/style.js, blockSky), by day: a square
  // sun, and clouds that are flat squares of white, a cell of them 12 m
  // across on a plane high above, taken along by the wind.
  if (uBlockSky > 0.0 && day > 0.0) {
    vec3 sr = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
    vec3 su = cross(sr, uSunDir);
    float sq = step(0.0, dot(d, uSunDir)) * (1.0 - smoothstep(0.052, 0.056, max(abs(dot(d, sr)), abs(dot(d, su)))));
    col += uSunColor * sq * 22.0 * uBlockSky * day;
    if (uCloud > 0.0 && y > 0.02) {
      vec2 cp = d.xz / (y + 0.04) * 130.0 + vec2(uTime * 1.3, uTime * 0.2);
      vec2 cell = floor(cp / 12.0);
      float cn = vnoise(cell * 0.31) * 0.62 + vnoise(cell * 0.83 + 9.0) * 0.38;
      float on = step(0.7 - uCloud * 0.1, cn);
      col = mix(col, vec3(0.84 + 0.1 * hash(cell)), on * smoothstep(0.02, 0.12, y) * 0.95 * uBlockSky * day);
    }
  }

  // The Upside Down (world look 'upside'): the cloud lit from inside, red,
  // by lightning, a bolt of it forking down, and, when it flashes bright,
  // the shape of something enormous standing on the horizon behind.
  if (uUpside > 0.0 && uFlash > 0.003) {
    float az = atan(d.z, d.x);
    float el = asin(clamp(y, -1.0, 1.0));
    float da = mod(az - uBolt.x + 3.1416, 6.2832) - 3.1416;
    float lc = fbm(d.xz / (abs(y) + 0.2) * 1.4 + 3.0);
    col += vec3(1.0, 0.2, 0.12) * uFlash * uUpside * (0.2 + 0.9 * lc) * smoothstep(-0.1, 0.25, y) * 0.5;
    float top = uBolt.y;
    float t = (top - el) / (top + 0.04);
    if (t > 0.0 && t < 1.0) {
      float off = boltOff(t, uBolt.z);
      float dx = (da - off) * cos(el);
      float w = max(mix(0.0045, 0.0018, t), pxAng * 1.3);
      float core = exp(-dx * dx / (w * w));
      float halo = exp(-abs(dx) / 0.035) * 0.22;
      float t2 = t - 0.34;
      float fork = 0.0;
      if (t2 > 0.0) {
        float dx2 = (da - off - boltOff(t, uBolt.z + 17.0) * 0.8 - t2 * (fract(uBolt.z * 7.0) > 0.5 ? 0.22 : -0.22)) * cos(el);
        float w2 = max(0.0014, pxAng * 1.3);
        fork = exp(-dx2 * dx2 / (w2 * w2)) * smoothstep(0.7, 0.2, t2);
      }
      vec3 bolt = mix(vec3(1.0, 0.55, 0.45), vec3(1.0, 0.92, 0.9), core) * (core + 0.7 * fork + halo);
      col += bolt * 6.0 * uFlash * uUpside * smoothstep(0.0, 0.03, t) * smoothstep(1.0, 0.92, t);
    }
    if (uBolt.w > 0.0 && uFlash > 0.02) {
      float sa = mod(az - (uBolt.x + 0.9) + 3.1416, 6.2832) - 3.1416;
      vec2 p = vec2(sa * cos(el), el - 0.34) / 0.6;
      if (abs(p.x) < 1.3 && abs(p.y) < 1.1) {
        float m = 0.0;
        m = max(m, 1.0 - smoothstep(0.0, 0.03, length((p - vec2(0.0, 0.05)) * vec2(1.0, 0.8)) - 0.14));
        m = max(m, 1.0 - smoothstep(0.0, 0.03, length(p - vec2(0.0, -0.12)) - 0.07));
        for (int i = 0; i < 4; i++) {
          float fi = float(i);
          for (int k = 0; k < 2; k++) {
            float sg = k == 0 ? -1.0 : 1.0;
            vec2 a = vec2(sg * 0.06, -0.12 + 0.07 * fi);
            vec2 knee = vec2(sg * (0.4 + 0.12 * fi), 0.42 - 0.05 * fi);
            vec2 foot = vec2(sg * (0.75 + 0.1 * fi), -0.55 - 0.1 * fi);
            float dl = min(segDist(p, a, knee), segDist(p, knee, foot));
            m = max(m, 1.0 - smoothstep(0.008, 0.03, dl));
          }
        }
        col *= 1.0 - m * 0.88 * uBolt.w * smoothstep(0.02, 0.4, uFlash) * uUpside;
      }
    }
  }

  // Stars, out where the sky is black: a sparse field of steady points.
  if (uStars > 0.0 && y > -0.08) {
    vec3 sd = d * 420.0;
    vec3 cell = floor(sd);
    float hs = hash3(cell);
    float star = step(0.9972, hs) * smoothstep(0.34, 0.0, length(fract(sd) - 0.5)) * (0.35 + 0.65 * fract(hs * 97.0));
    col += vec3(star) * uStars * 2.6 * (1.0 - smoothstep(0.9, 1.0, mu));
  }
  // A planet over the horizon, a quarter turn round from the sun, so it hangs
  // half lit: banded by latitude, dimming toward its limb, its night side
  // nearly black, a thin rim of atmosphere on the lit edge.
  if (uPlanet > 0.0) {
    vec3 pd = normalize(vec3(-uSunDir.z, 0.2, uSunDir.x));
    float r = 0.15;
    vec3 right = normalize(cross(pd, vec3(0.0, 1.0, 0.0)));
    vec3 upv = cross(right, pd);
    vec2 pq = vec2(dot(d, right), dot(d, upv)) / r;
    float inside = dot(d, pd) > 0.0 ? 1.0 - dot(pq, pq) : -1.0;
    if (inside > -0.08) {
      float zz = sqrt(max(inside, 0.0));
      // The near face of the sphere looks back along -pd.
      vec3 n = normalize(pq.x * right + pq.y * upv - zz * pd);
      float lit = smoothstep(-0.12, 0.55, dot(n, uSunDir));
      float bands = fbm(vec2(n.y * 4.6, dot(n, right) * 0.7) + 3.7);
      vec3 surf = mix(vec3(0.2, 0.3, 0.44), vec3(0.78, 0.76, 0.72), smoothstep(0.3, 0.75, bands));
      float disc = smoothstep(0.0, 0.02, inside);
      float limb = 0.55 + 0.45 * zz;
      col = mix(col, surf * (0.015 + 0.8 * lit) * limb, disc * uPlanet);
      float rim = smoothstep(-0.08, 0.0, inside) * (1.0 - smoothstep(0.0, 0.06, inside));
      col += vec3(0.35, 0.55, 1.0) * rim * lit * 0.6 * uPlanet;
    }
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

export class Atmosphere {
  constructor(renderer, scene, look) {
    this.renderer = renderer;
    this.scene = scene;
    this.look = look;

    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3() },
      uGlow: { value: new THREE.Color() },
      uSunSize: { value: 0.012 },
      uTime: { value: 0 },
      uCloud: { value: 0.5 },
      uStars: { value: 0 },
      uPlanet: { value: 0 },
      // The Upside Down's lightning: how much the look is its own, the
      // flash, and the bolt (azimuth, height, draw, the share of the
      // silhouette that shows).
      uUpside: { value: 0 },
      uFlash: { value: 0 },
      uBolt: { value: new THREE.Vector4() },
      ...skyStyle,
      ...twistU,
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.sky.scale.setScalar(4000);
    scene.add(this.sky);

    scene.fog = new THREE.FogExp2(0xbfd2e2, 0.0001);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70;
    sc.right = 70;
    sc.top = 70;
    sc.bottom = -70;
    sc.near = 10;
    sc.far = 900;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.1;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
    scene.add(this.hemi);

    this.apply(look);
  }

  apply(look, rebake = true) {
    this.look = look;
    const u = this.uniforms;
    const sunDir = this.sunDir || (this.sunDir = new THREE.Vector3());
    sunDir.set(
      Math.cos(look.sunElev) * Math.cos(look.sunAz),
      Math.sin(look.sunElev),
      Math.cos(look.sunElev) * Math.sin(look.sunAz),
    ).normalize();
    u.uZenith.value.set(look.zenith);
    u.uHorizon.value.set(look.horizon);
    u.uGround.value.set(look.ground);
    u.uSunColor.value.set(look.sunColor);
    u.uSunDir.value.copy(sunDir);
    styleU.uSunDirW.value.copy(sunDir);
    u.uGlow.value.set(look.glow);
    u.uCloud.value = look.clouds;
    u.uStars.value = look.stars || 0;
    u.uUpside.value = look.upside || 0;
    u.uPlanet.value = look.planet || 0;

    this.scene.fog.color.set(look.horizon);
    // How much of a day's sky this is (the sky shader's own measure): a
    // painted style's distance turns blue only under one.
    const z = u.uZenith.value;
    const zl = z.r * 0.2126 + z.g * 0.7152 + z.b * 0.0722;
    skyDay.value = THREE.MathUtils.smoothstep(zl, 0.02, 0.06);
    atmo.fogParams.value.set(look.fogDensity, look.fogBase, look.fogFalloff);
    atmo.fogSunDir.value.copy(sunDir);
    atmo.fogSunColor.value.set(look.glow);

    this.sun.color.set(look.sunColor);
    this.sun.intensity = look.sunIntensity;
    this.hemi.color.set(look.skyLight);
    this.hemi.groundColor.set(look.groundLight);
    this.hemi.intensity = look.hemiIntensity;
    this.scene.environmentIntensity = look.envIntensity;
    if (rebake) this._envDirty = true;
  }

  // Render the sky alone into a cube map and prefilter it, so reflections and
  // ambient light come from the sky the player is actually looking at. The
  // sky's scene, the cube, the prefilter and its output are kept and drawn
  // into again: making them anew for each bake, and throwing the last ones
  // away, cost 8-30 ms a time (new targets, the prefilter's shaders built
  // again, every material set up again for a new texture) against 0.3 ms.
  bakeEnvironment() {
    const r = this.renderer;
    if (!this._env) {
      const scene = new THREE.Scene();
      // The dome itself follows the camera; the cube camera sits at the
      // origin, and outside the sphere it sees nothing.
      const sky = new THREE.Mesh(this.sky.geometry, this.sky.material);
      sky.scale.setScalar(10);
      sky.frustumCulled = false;
      scene.add(sky);
      const cube = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
      this._env = { scene, cube, camera: new THREE.CubeCamera(0.1, 100, cube), pmrem: new THREE.PMREMGenerator(r), out: null };
    }
    const e = this._env;
    // The painted style's deep sky is how it looks, not how much blue it
    // sheds: lit by it, a grey road went navy. The light comes from the sky
    // as it is; the clouds stay in it.
    const sat = skyStyle.uSkySat.value;
    const blue = skyStyle.uSkyBlue.value;
    skyStyle.uSkySat.value = 0;
    skyStyle.uSkyBlue.value = 0;
    e.camera.update(r, e.scene);
    skyStyle.uSkySat.value = sat;
    skyStyle.uSkyBlue.value = blue;
    e.out = e.pmrem.fromCubemap(e.cube.texture, e.out);
    this.scene.environment = e.out.texture;
    this.bakes = (this.bakes || 0) + 1;
    this._envDirty = false;
  }

  // Follow the car: the shadow frustum stays tight around it and the dome is
  // centred on the camera.
  update(dt, camera, focus) {
    this.uniforms.uTime.value += dt;
    this.sky.position.copy(camera.position);
    const d = this.sunDir;
    this.sun.position.set(focus.x + d.x * 400, focus.y + d.y * 400, focus.z + d.z * 400);
    this.sun.target.position.set(focus.x, focus.y, focus.z);
    this.sun.target.updateMatrixWorld();
    if (this._envDirty) this.bakeEnvironment();
  }
}

// The alpine afternoon: a warm sun high enough to light the valley floors,
// low enough to rake across the ridges; cool blue shade; a thin haze that keeps
// the far ranges in layers.
export const ALPINE_LOOK = {
  sunElev: 0.6,
  sunAz: 2.35,
  sunColor: 0xfff0dc,
  sunIntensity: 3.6,
  zenith: 0x2f63a8,
  horizon: 0xc4d6e6,
  ground: 0x6f6b5c,
  glow: 0xffd9ae,
  clouds: 0.55,
  fogDensity: 0.00017,
  fogBase: 0,
  fogFalloff: 720,
  // The sky dome already lights everything through the environment map; the
  // hemisphere light only adds a little directional bias (sky above, warm
  // ground bounce below), or the shade turns blue and flat.
  skyLight: 0xb9c9dc,
  groundLight: 0x6e6550,
  hemiIntensity: 0.22,
  envIntensity: 1.0,
  exposure: 2.0,
};
