// Sky, aerial perspective and image-based light, from one set of numbers.
//
// The sky dome and the fog on every surface evaluate the same horizon colour
// and the same sun glow, so a ridge 6 km away dissolves into exactly the sky
// behind it. Fog thins with height (a valley fills with haze, a summit stands
// clear of it) and warms toward the sun. The environment map that lights the
// car paint and the wet-looking asphalt is rendered from this same sky.

import * as THREE from 'three';
import { patchLighting, styleU, skyStyle } from './style.js';

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
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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
uniform float uSkyDeep;
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

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  float mu = max(dot(d, uSunDir), 0.0);

  // Rayleigh-ish gradient: deep at the zenith, pale and bright at the horizon.
  float up = clamp(y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.42));
  col = mix(col, uGround, smoothstep(0.0, -0.18, y));
  // A deeper blue overhead, for the drawn styles (render/style.js).
  if (uSkyDeep > 0.0) col = mix(col, col * vec3(0.72, 0.88, 1.16), uSkyDeep * smoothstep(0.04, 0.75, y));

  // The same glow the fog uses, so the horizon and the haze agree exactly.
  col = mix(col, uGlow, pow(mu, 8.0) * (1.0 - 0.6 * smoothstep(0.0, 0.6, y)));
  // Mie halo and the disc.
  col += uSunColor * (pow(mu, 220.0) * 0.6 + pow(mu, 30.0) * 0.12);
  float disc = smoothstep(cos(uSunSize), cos(uSunSize * 0.82), dot(d, uSunDir));
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
    col = mix(col, cloud, cover * fade * 0.9 * (1.0 - uCumulus));
  }

  // Heaped cumulus, laid on the way a painter of animated films lays them:
  // cut sharp against the sky, white where the sun is on them, grey-violet
  // underneath; heaps overhead, and banks standing on the horizon.
  if (uCumulus > 0.0 && uCloud > 0.0 && y > -0.03) {
    float k = uCumulus * smoothstep(0.08, 0.4, uCloud);
    vec3 shade = mix(uHorizon, vec3(0.6, 0.62, 0.8), 0.6);
    vec3 white = mix(vec3(1.0, 0.985, 0.95), uSunColor, 0.15);
    vec2 cuv = d.xz / (y + 0.1) * 1.05 + vec2(uTime * 0.003, uTime * 0.0012);
    float n = fbm(cuv);
    float nl = fbm(cuv + normalize(uSunDir.xz + 1e-4) * 0.07);
    float edge = 0.62 - uCloud * 0.16;
    float heap = smoothstep(edge, edge + 0.02, n) * smoothstep(0.03, 0.2, y);
    float sunlit = smoothstep(-0.02, 0.05, nl - n + 0.012);
    col = mix(col, mix(shade, white, 0.25 + 0.75 * sunlit), heap * k);
    vec2 h2 = normalize(d.xz + 1e-5);
    float top = 0.03 + 0.2 * pow(fbm(h2 * 2.3 + 11.0), 1.8);
    float puff = (fbm(h2 * 14.0 + vec2(y * 12.0, 3.0)) - 0.5) * 0.07;
    float bank = smoothstep(top + puff + 0.004, top + puff - 0.004, y) * smoothstep(-0.03, 0.005, y);
    float rise = clamp(y / max(top, 1e-3), 0.0, 1.0);
    float sunSide = 0.5 + 0.5 * dot(h2, normalize(uSunDir.xz + 1e-4));
    vec3 bc = mix(shade * 0.96, white, smoothstep(0.25, 0.85, rise * 0.65 + sunSide * 0.35 + puff * 3.0));
    col = mix(col, bc, bank * k);
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
      ...skyStyle,
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
    u.uGlow.value.set(look.glow);
    u.uCloud.value = look.clouds;
    u.uStars.value = look.stars || 0;
    u.uPlanet.value = look.planet || 0;

    this.scene.fog.color.set(look.horizon);
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
    e.camera.update(r, e.scene);
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
