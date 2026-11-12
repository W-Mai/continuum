// Rivers, lakes and the sea: one water surface at the worlds' water level,
// centred on the camera and dense near it, nine kilometres across.
//
// It shows only where a world has water, decided per pixel from the same
// world palette the terrain reads (render/worldlook.js), and fades in across a
// border at the threshold the road uses to keep clear of it
// (world/worlds.js). Waves are two scrolling normal maps; the reflections are
// the sky's own environment map, so the water darkens and brightens with the
// world above it.

import * as THREE from 'three';
import { withAtmosphere } from './atmosphere.js';
import { worldUniforms, WORLD_GLSL, PAL } from './worldlook.js';

const RADIUS = 9000;
const RINGS = 56;
const SEGMENTS = 128;

function discGeometry() {
  const pos = [0, 0, 0];
  const idx = [];
  for (let r = 1; r <= RINGS; r++) {
    const rad = RADIUS * Math.pow(r / RINGS, 2.3);
    for (let s = 0; s < SEGMENTS; s++) {
      const a = (s / SEGMENTS) * Math.PI * 2;
      pos.push(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    }
  }
  const ring = (r, s) => 1 + (r - 1) * SEGMENTS + (s % SEGMENTS);
  for (let s = 0; s < SEGMENTS; s++) idx.push(0, ring(1, s + 1), ring(1, s));
  for (let r = 1; r < RINGS; r++) {
    for (let s = 0; s < SEGMENTS; s++) {
      idx.push(ring(r, s), ring(r, s + 1), ring(r + 1, s + 1));
      idx.push(ring(r, s), ring(r + 1, s + 1), ring(r + 1, s));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

// In-place radix-2 FFT of n complex values held in two arrays, n a power of two.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const wr = Math.cos((2 * Math.PI) / len);
    const wi = Math.sin((2 * Math.PI) / len);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

// Tileable wave heights as a normal map, with the heights themselves in blue.
// They are made as a spectrum and turned back into space, so they have no
// lattice: value noise lines its slopes up along its cells, and seen edge-on
// from high over the cloud the lines read as a grid.
function waveTexture() {
  const N = 256;
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const unit = (v) => Math.min(1, Math.max(0, v));
  // Wavelengths from a quarter of the tile down to a few pixels, amplitude
  // falling as 1/k², so every octave carries the same share of the slope.
  const re = new Float64Array(N * N);
  const im = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    const ky = y < N / 2 ? y : y - N;
    for (let x = 0; x < N; x++) {
      const kx = x < N / 2 ? x : x - N;
      const k = Math.hypot(kx, ky);
      const a = k < 1 ? 0 : (unit((k - 2.4) / 1.6) * unit((56 - k) / 16.8)) / (k * k);
      re[y * N + x] = gauss() * a;
      im[y * N + x] = gauss() * a;
    }
  }
  const lr = new Float64Array(N);
  const li = new Float64Array(N);
  for (const across of [true, false]) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const at = across ? j * N + i : i * N + j;
        lr[i] = re[at];
        li[i] = im[at];
      }
      fft(lr, li);
      for (let i = 0; i < N; i++) {
        const at = across ? j * N + i : i * N + j;
        re[at] = lr[i];
        im[at] = li[i];
      }
    }
  }
  const h = re;
  const at = (x, y) => h[((y + N) % N) * N + ((x + N) % N)];
  let mean = 0;
  for (const v of h) mean += v;
  mean /= N * N;
  let spread = 0;
  let slope = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      spread += (at(x, y) - mean) ** 2;
      slope += (at(x + 1, y) - at(x - 1, y)) ** 2;
    }
  }
  spread = Math.sqrt(spread / (N * N));
  // The slope and the spread of heights the value noise had, so water, lava
  // and cloud keep their look.
  const gain = 14.2 / Math.sqrt(slope / (N * N));
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const k = (y * N + x) * 4;
      data[k] = Math.max(0, Math.min(255, 128 - (at(x + 1, y) - at(x - 1, y)) * gain));
      data[k + 1] = Math.max(0, Math.min(255, 128 - (at(x, y + 1) - at(x, y - 1)) * gain));
      data[k + 2] = Math.round(255 * unit(0.53 + (0.19 * (at(x, y) - mean)) / spread));
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export class Water {
  constructor(scene, level = 0) {
    this.level = level;
    this.uniforms = {
      uWave: { value: waveTexture() },
      uTime: { value: 0 },
      uOffset: { value: new THREE.Vector2() },
    };
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.1, metalness: 0, transparent: true, depthWrite: true,
      side: THREE.DoubleSide,
    });
    const uniforms = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms, worldUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec2 uOffset;\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz + vec3(uOffset.x, 0.0, uOffset.y);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D uWave;
uniform float uTime;
uniform vec2 uOffset;
varying vec3 vWPos;
${WORLD_GLSL}
vec3 tWaterN;
vec3 tLiquidGlow;
float tLiquidRough;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
worldAt(vWPos.xz);
float wShow = smoothstep(0.35, 0.65, worldWet());
if (wShow < 0.01) discard;
vec4 liq = worldPar(2);     // glow, roughness, opacity, cloud
float lava = worldPar(3).x;
float cloud = liq.w;
vec3 camW = cameraPosition + vec3(uOffset.x, 0.0, uOffset.y);
float wDist = length(vWPos - camW);
// Water: two wave trains crossing, finer close up, flattened with distance,
// where they would only shimmer. Lava creeps and cloud drifts, both slowly,
// in broad swells.
vec2 q = vWPos.xz;
float speed = mix(1.0, 0.12, max(lava, cloud));
// The broad layers are turned against each other, so the repeats of the
// texture never line up into a grid, which from high over the cloud they would.
const mat2 R1 = mat2(0.8, 0.6, -0.6, 0.8);
const mat2 R2 = mat2(0.92, -0.39, 0.39, 0.92);
vec4 w1 = texture2D(uWave, q / 37.0 + vec2(uTime * 0.012, uTime * 0.007) * speed);
vec4 w2 = texture2D(uWave, q / 13.0 + vec2(-uTime * 0.017, uTime * 0.021) * speed);
vec4 w3 = texture2D(uWave, R1 * q / 230.0 + vec2(uTime * 0.003, -uTime * 0.002) * speed);
vec4 w4 = texture2D(uWave, R2 * q / 900.0 + vec2(uTime * 0.0012, uTime * 0.0007));
vec4 w5 = texture2D(uWave, R2 * R2 * q / 3700.0 + vec2(-uTime * 0.0004, uTime * 0.0003));
vec2 fine = (w1.xy - 0.5) * 0.9 + (w2.xy - 0.5) * 0.55;
vec2 slope = fine * (1.0 - smoothstep(120.0, 900.0, wDist)) + (w3.xy - 0.5) * 0.5;
vec2 swell = (w3.xy - 0.5) * 1.4 + (w4.xy - 0.5) * 1.1;
slope = mix(slope, swell, max(cloud, lava * 0.6));
tWaterN = normalize(vec3(-slope.x, 1.0, -slope.y));
vec3 deep = worldPal(${PAL.waterDeep});
vec3 shallow = worldPal(${PAL.waterShallow});
vec3 viewDir = normalize(camW - vWPos);
float down = clamp(viewDir.y, 0.0, 1.0);
vec3 waterCol = mix(deep, shallow, pow(down, 1.5) * 0.8);
// Cloud: bright tops, shadowed hollows. Lava: a dark crust broken by molten
// cracks that glow.
float tops = w3.z * 0.45 + w4.z * 0.33 + w5.z * 0.22;
vec3 cloudCol = mix(deep, shallow, smoothstep(0.25, 0.75, tops));
float crust = smoothstep(0.38, 0.6, w3.z * 0.55 + w1.z * 0.25 + w4.z * 0.2);
vec3 lavaCol = mix(shallow * 0.6, deep, crust);
diffuseColor.rgb = mix(mix(waterCol, cloudCol, cloud), lavaCol, lava);
tLiquidGlow = shallow * liq.x * mix(1.0, (1.0 - crust) * 1.6 + 0.05, lava) * mix(1.0, 0.5 + 0.5 * tops, cloud);
// Seen from below (the deep sea), the surface is the brightest thing there is.
if (!gl_FrontFacing) tLiquidGlow += shallow * 1.4;
tLiquidRough = liq.y;
diffuseColor.a = wShow * clamp(mix(liq.z + 0.06, liq.z - 0.05, down) + max(lava, cloud), 0.0, 1.0);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = tLiquidRough;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += tLiquidGlow;`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize((viewMatrix * vec4(tWaterN, 0.0)).xyz);`);
    };
    mat.customProgramCacheKey = () => 'continuum-water';
    this.material = withAtmosphere(mat);
    this.mesh = new THREE.Mesh(discGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }

  setOrigin(x, z) {
    this.uniforms.uOffset.value.set(x, z);
  }

  // Centred under the camera, stepped so the rings do not crawl over the waves.
  update(dt, camera) {
    this.uniforms.uTime.value += dt;
    const step = 32;
    this.mesh.position.set(Math.round(camera.position.x / step) * step, this.level,
      Math.round(camera.position.z / step) * step);
  }
}
