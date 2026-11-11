// Sky, aerial perspective and image-based light, from one set of numbers.
//
// The sky dome and the fog on every surface evaluate the same horizon colour
// and the same sun glow, so a ridge 6 km away dissolves into exactly the sky
// behind it. Fog thins with height (a valley fills with haze, a summit stands
// clear of it) and warms toward the sun. The environment map that lights the
// car paint and the wet-looking asphalt is rendered from this same sky.

import * as THREE from 'three';

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
// onBeforeCompile hook.
export function withAtmosphere(material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    Object.assign(shader.uniforms, atmo);
    if (prev) prev.call(material, shader, renderer);
    // At this point iblIrradiance, radiance and clearcoatRadiance hold only
    // the environment's contribution.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uEnvScale;')
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
#if defined( RE_IndirectSpecular )
  iblIrradiance *= uEnvScale;
  radiance *= uEnvScale;
  #ifdef USE_CLEARCOAT
    clearcoatRadiance *= uEnvScale;
  #endif
#endif`);
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  material.customProgramCacheKey = () => key + '|atmo';
  return material;
}

// The sun as seen from the car: how much of it gets past the ridges. Set each
// frame by the game; the car and the traffic read it.
export const sunMask = { value: 1 };

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
varying vec3 vDir;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
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
    col = mix(col, cloud, cover * fade * 0.9);
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

  apply(look) {
    this.look = look;
    const u = this.uniforms;
    const sunDir = new THREE.Vector3(
      Math.cos(look.sunElev) * Math.cos(look.sunAz),
      Math.sin(look.sunElev),
      Math.cos(look.sunElev) * Math.sin(look.sunAz),
    ).normalize();
    this.sunDir = sunDir;
    u.uZenith.value.set(look.zenith);
    u.uHorizon.value.set(look.horizon);
    u.uGround.value.set(look.ground);
    u.uSunColor.value.set(look.sunColor);
    u.uSunDir.value.copy(sunDir);
    u.uGlow.value.set(look.glow);
    u.uCloud.value = look.clouds;

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
    this._envDirty = true;
  }

  // Render the sky alone into a cube map and prefilter it, so reflections and
  // ambient light come from the sky the player is actually looking at.
  bakeEnvironment() {
    const r = this.renderer;
    const scene = new THREE.Scene();
    const sky = this.sky.clone();
    // The clone carries the dome's position, which follows the camera; the
    // cube camera sits at the origin, and outside the sphere it sees nothing.
    sky.position.set(0, 0, 0);
    sky.scale.setScalar(10);
    scene.add(sky);
    const target = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
    const cam = new THREE.CubeCamera(0.1, 100, target);
    cam.update(r, scene);
    const pmrem = new THREE.PMREMGenerator(r);
    const env = pmrem.fromCubemap(target.texture);
    target.dispose();
    pmrem.dispose();
    if (this.scene.environment) this.scene.environment.dispose();
    this.scene.environment = env.texture;
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
