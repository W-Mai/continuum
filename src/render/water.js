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

// Tileable wave heights as a normal map: a few octaves of wrapped value noise.
function waveTexture() {
  const N = 256;
  const h = new Float32Array(N * N);
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (const [cells, amp] of [[8, 1], [16, 0.5], [32, 0.25], [64, 0.12]]) {
    const g = new Float32Array(cells * cells).map(rnd);
    for (let y = 0; y < N; y++) {
      const fy = (y / N) * cells;
      const y0 = Math.floor(fy);
      let ty = fy - y0;
      ty = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < N; x++) {
        const fx = (x / N) * cells;
        const x0 = Math.floor(fx);
        let tx = fx - x0;
        tx = tx * tx * (3 - 2 * tx);
        const at = (i, j) => g[((j % cells) * cells) + (i % cells)];
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
        const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
        h[y * N + x] += (a + (b - a) * ty) * amp;
      }
    }
  }
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)];
      const dy = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
      const k = (y * N + x) * 4;
      data[k] = Math.max(0, Math.min(255, 128 - dx * 300));
      data[k + 1] = Math.max(0, Math.min(255, 128 - dy * 300));
      data[k + 2] = 255;
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
vec3 tWaterN;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
worldAt(vWPos.xz);
float wShow = smoothstep(0.35, 0.65, worldWet());
if (wShow < 0.01) discard;
float wDist = length(vWPos - (cameraPosition + vec3(uOffset.x, 0.0, uOffset.y)));
// Two wave trains crossing, finer close up; flattened with distance, where
// they would only shimmer.
vec2 q = vWPos.xz;
vec2 n1 = texture2D(uWave, q / 37.0 + vec2(uTime * 0.012, uTime * 0.007)).xy - 0.5;
vec2 n2 = texture2D(uWave, q / 13.0 + vec2(-uTime * 0.017, uTime * 0.021)).xy - 0.5;
vec2 n3 = texture2D(uWave, q / 230.0 + vec2(uTime * 0.003, -uTime * 0.002)).xy - 0.5;
vec2 slope = (n1 * 0.9 + n2 * 0.55) * (1.0 - smoothstep(120.0, 900.0, wDist)) + n3 * 0.5;
tWaterN = normalize(vec3(-slope.x, 1.0, -slope.y));
vec3 deep = worldPal(${PAL.waterDeep});
vec3 shallow = worldPal(${PAL.waterShallow});
vec3 viewDir = normalize(cameraPosition + vec3(uOffset.x, 0.0, uOffset.y) - vWPos);
float down = clamp(viewDir.y, 0.0, 1.0);
diffuseColor.rgb = mix(deep, shallow, pow(down, 1.5) * 0.8);
diffuseColor.a = wShow * mix(0.97, 0.86, down);`)
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
