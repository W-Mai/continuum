// Clouds baked into the sky: heaps of balls (world/cloudsets.js), a distance
// field of them ray-marched once into a cube map, and the sky shader
// (render/atmosphere.js) reads the cube instead of working the clouds out
// again for every pixel of every frame.
//
// Each texel of the cube holds four numbers, in bytes:
//   R  the light: a half lambert against a raised sun, times the heap's own
//      shadow on itself (a few steps toward the sun),
//   G  the heap's big form: 0 to 0.2 is the flat underside, 0.25 to 0.85 the
//      way from the shaded side to the middle tones (the balls alone, not
//      the bumps),
//   B  the air: how much of the way to the horizon's colour it is far off,
//   A  the cover: 1 where the ray meets a cloud, less to 0 for a ray that
//      passes it by less than a texel.
//
// A sky has two cubes, one drawn from and one to bake into. When the world a
// little ahead of the lens wants another set, it is baked into the free cube
// a strip a frame, and when it is done the two are crossed over twenty
// seconds. The set is baked for the seed alone, so it is the same each time.

import * as THREE from 'three';
import { layoutClouds, MAX_HEAPS, MAX_BALLS, HEAP_SMOOTH, MAX_HEAP_BALLS } from '../world/cloudsets.js';
import { fillCloudNoise, CLOUD_NOISE_N } from '../world/cloudnoise.js';

// A face of the cube in texels, the steps of the march, by tier.
const SIZE = { high: 768, mid: 512, low: 384 };
const STEPS = { high: 200, mid: 150, low: 96 };
// A face is baked in this many strips, one a frame.
export const STRIPS = 8;
export const FADE_SECONDS = 20;
// The noise is filled this many slices a frame (64 in all).
const NOISE_SLICES = 16;

// The sun the clouds are lit by: the world's, raised, so that the lit side is
// the whole of the sunward side and the top is white.
const SUN_ELEV = 0.6;
const SUN_AZ = 2.35;
const SUN = new THREE.Vector3(
  Math.cos(SUN_ELEV) * Math.cos(SUN_AZ),
  Math.sin(SUN_ELEV) + 1.2,
  Math.cos(SUN_ELEV) * Math.sin(SUN_AZ),
).normalize();

const SUN_BIG = new THREE.Vector3(
  Math.cos(SUN_ELEV) * Math.cos(SUN_AZ),
  Math.sin(SUN_ELEV),
  Math.cos(SUN_ELEV) * Math.sin(SUN_AZ),
).normalize();

const vert = /* glsl */`
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const frag = /* glsl */`
precision highp float;
precision highp sampler2D;
precision highp sampler3D;

out vec4 outColor;

uniform int uFace;
uniform float uSize;
uniform float uTexAng;
uniform int uSteps;
uniform sampler2D uBalls;
uniform sampler3D uNoise;
uniform vec4 uHeapInfo[${MAX_HEAPS}];
uniform vec4 uHeapBound[${MAX_HEAPS}];
uniform float uHeapUnit[${MAX_HEAPS}];
uniform vec3 uSun;
uniform vec3 uSunBig;


float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
float smax(float a, float b, float k) {
  return -smin(-a, -b, k);
}

// The balls of heap h joined: the field of the big form.
float heapBig(int h, vec3 p) {
  vec4 info = uHeapInfo[h];
  int first = int(info.x);
  int count = int(info.y);
  float d = 1e9;
  for (int i = 0; i < ${MAX_HEAP_BALLS}; i++) {
    if (i >= count) break;
    vec4 b = texelFetch(uBalls, ivec2(first + i, 0), 0);
    d = smin(d, length(p - b.xyz) - b.w, info.w);
  }
  return d;
}

// The three sizes of bump, in metres across and how far they stand out.
const vec3 BUMP_SIZE = vec3(2.4, 1.0, 0.36);
const vec3 BUMP_AMP = vec3(0.26, 0.22, 0.2);
const vec3 BUMP_W = vec3(1.0, 1.0, 1.0);

float bumps(int h, vec3 p) {
  float u = uHeapUnit[h];
  float s = 0.0;
  for (int k = 0; k < 3; k++) {
    float size = u * BUMP_SIZE[k];
    s += BUMP_AMP[k] * size * textureLod(uNoise, p / (size * 4.0), 0.0).r;
  }
  return s;
}
float bumpMax(int h) {
  float u = uHeapUnit[h];
  return u * (BUMP_AMP.x * BUMP_SIZE.x + BUMP_AMP.y * BUMP_SIZE.y + BUMP_AMP.z * BUMP_SIZE.z);
}

// Heap h with its bumps and its flat base.
float heapFull(int h, vec3 p) {
  float amax = bumpMax(h);
  float base = uHeapInfo[h].z;
  float plane = base - p.y;
  float d = heapBig(h, p);
  if (d > amax) return max(d - 0.65 * amax, plane);
  d = d + 0.35 * amax - bumps(h, p);
  return smax(d, plane, uHeapInfo[h].w * 0.4);
}

int gHeap = 0;
float map(vec3 p) {
  float db[${MAX_HEAPS}];
  float best = 1e9;
  int bi = 0;
  for (int h = 0; h < ${MAX_HEAPS}; h++) {
    vec4 b = uHeapBound[h];
    db[h] = length(p - b.xyz) - b.w;
    if (db[h] < best) {
      best = db[h];
      bi = h;
    }
  }
  float d = heapFull(bi, p);
  gHeap = bi;
  for (int h = 0; h < ${MAX_HEAPS}; h++) {
    if (h != bi && db[h] < d) {
      float dh = heapFull(h, p);
      if (dh < d) {
        d = dh;
        gHeap = h;
      }
    }
  }
  return d;
}

// The direction of a texel of a face (the cube map's own convention).
vec3 faceDir(int face, vec2 sc) {
  vec3 d;
  if (face == 0) d = vec3(1.0, -sc.y, -sc.x);
  else if (face == 1) d = vec3(-1.0, -sc.y, sc.x);
  else if (face == 2) d = vec3(sc.x, 1.0, sc.y);
  else if (face == 3) d = vec3(sc.x, -1.0, -sc.y);
  else if (face == 4) d = vec3(sc.x, -sc.y, 1.0);
  else d = vec3(-sc.x, -sc.y, -1.0);
  return normalize(d);
}

void main() {
  vec2 sc = gl_FragCoord.xy / uSize * 2.0 - 1.0;
  vec3 dir = faceDir(uFace, sc);
  outColor = vec4(0.0);
  if (dir.y < 0.002) return;

  vec3 o = vec3(0.0, 70.0, 0.0);
  float t = max((520.0 - o.y) / dir.y, 0.0);
  float tEnd = min((14500.0 - o.y) / dir.y, 70000.0);
  float best = 1e9;
  float tBest = t;
  float tPrev = t;
  bool hit = false;
  for (int i = 0; i < 256; i++) {
    if (i >= uSteps) break;
    float w = max(t * uTexAng, 1.0);
    float d = map(o + dir * t);
    float ratio = d / w;
    if (ratio < best) {
      best = ratio;
      tBest = t;
    }
    if (d < max(0.3 * w, 2.0)) {
      hit = true;
      break;
    }
    tPrev = t;
    t += max(d * 0.5, 30.0);
    if (t > tEnd) break;
  }
  float ts = tBest;
  if (hit) {
    float lo = tPrev;
    float hi = t;
    float w = max(hi * uTexAng, 1.0);
    for (int i = 0; i < 6; i++) {
      float mid = 0.5 * (lo + hi);
      if (map(o + dir * mid) < max(0.3 * w, 2.0)) hi = mid; else lo = mid;
    }
    ts = hi;
  }
  float cover = hit ? 1.0 : clamp(1.0 - best, 0.0, 1.0);
  if (cover <= 0.0) return;

  vec3 p = o + dir * ts;
  float e = max(ts * uTexAng * 0.7, 12.0);
  map(p);
  int h0 = gHeap;
  vec2 k = vec2(1.0, -1.0);
  vec3 n = normalize(k.xyy * map(p + k.xyy * e) + k.yyx * map(p + k.yyx * e) + k.yxy * map(p + k.yxy * e) + k.xxx * map(p + k.xxx * e));
  float r0 = uHeapInfo[h0].w / ${HEAP_SMOOTH.toFixed(4)};
  float eb = r0 * 0.04;
  vec3 nb = normalize(k.xyy * heapBig(h0, p + k.xyy * eb) + k.yyx * heapBig(h0, p + k.yyx * eb) + k.yxy * heapBig(h0, p + k.yxy * eb) + k.xxx * heapBig(h0, p + k.xxx * eb));

  // The heap's shadow on itself: a few steps toward the sun, each short of
  // the distance it would be from the surface if nothing stood in the way.
  vec3 nn = normalize(mix(nb, n, 0.45));
  float nl = max(dot(nn, uSun), 0.2);
  float occ = 0.0;
  float wsum = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float s = uHeapUnit[h0] * (0.18 + 0.32 * fi * fi);
    float w = 1.0 / (1.0 + fi);
    occ += w * clamp((s * nl - map(p + uSun * s)) / (s * nl), 0.0, 1.0);
    wsum += w;
  }
  occ /= wsum;
  float lit = (0.5 + 0.5 * dot(nn, uSun)) * exp(-occ * 1.6);

  float big = 0.25 + 0.6 * (0.5 + 0.5 * dot(nb, uSunBig));
  float under = smoothstep(-0.4, -0.8, n.y);
  big = mix(big, 0.2 * (1.0 - under), smoothstep(0.0, 0.15, under));

  float air = 1.0 - exp(-ts / 200000.0);
  outColor = vec4(lit, big, air, cover);
}
`;

// A cube that has nothing in it, for the sky to read before there is one.
function emptyCube() {
  const faces = [];
  for (let i = 0; i < 6; i++) {
    const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
    t.needsUpdate = true;
    faces.push(t);
  }
  const cube = new THREE.CubeTexture(faces);
  cube.needsUpdate = true;
  return cube;
}

function makeTarget(size) {
  return new THREE.WebGLCubeRenderTarget(size, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    generateMipmaps: false,
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
}

export class Clouds {
  // opts.seed: the game's; opts.sync: bake all of a set in the frame it is
  // asked for (headless runs); opts.tier: high, mid or low.
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.seed = opts.seed || 0;
    this.axis = opts.axis || 0;
    this.sync = !!opts.sync;
    this.tier = SIZE[opts.tier] ? opts.tier : 'high';
    // The uniforms the sky reads: the cube drawn, the one it is crossing to,
    // and how far across it is (0: only the first).
    const none = emptyCube();
    this.uniforms = {
      uCloudA: { value: none },
      uCloudB: { value: none },
      uCloudT: { value: 0 },
    };
    this.none = none;
    this.cubes = [null, null];
    this.live = -1;                 // the cube drawn from, -1 before there is one
    this.set = null;                // its set's name
    this.target = null;             // the set being baked, or crossed to
    this.job = null;
    this.fade = 0;                  // seconds into the crossing, 0 when not crossing
    this.crossing = false;
    this.baked = false;             // some set is ready to be drawn
    this.bakes = 0;                 // sets baked
    this.frames = 0;                // frames in which a strip was baked
    this.noise = null;
    this.noiseRows = 0;
    this.scene = null;
    // The last cube drawn into, for the sky's light to be baked again when
    // the clouds have changed.
    this.changed = false;
  }

  _prepare() {
    if (this.scene) return;
    const noise = new Uint8Array(CLOUD_NOISE_N ** 3);
    this.noiseData = noise;
    this.noiseTex = new THREE.Data3DTexture(noise, CLOUD_NOISE_N, CLOUD_NOISE_N, CLOUD_NOISE_N);
    this.noiseTex.format = THREE.RedFormat;
    this.noiseTex.type = THREE.UnsignedByteType;
    this.noiseTex.minFilter = THREE.LinearFilter;
    this.noiseTex.magFilter = THREE.LinearFilter;
    this.noiseTex.wrapS = this.noiseTex.wrapT = this.noiseTex.wrapR = THREE.RepeatWrapping;
    this.noiseTex.unpackAlignment = 1;
    this.noiseRows = 0;
    this.ballTex = new THREE.DataTexture(new Float32Array(MAX_BALLS * 4), MAX_BALLS, 1, THREE.RGBAFormat, THREE.FloatType);
    this.ballTex.minFilter = THREE.NearestFilter;
    this.ballTex.magFilter = THREE.NearestFilter;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uFace: { value: 0 },
        uSize: { value: 768 },
        uTexAng: { value: 2 / 768 },
        uSteps: { value: 200 },
        uBalls: { value: this.ballTex },
        uNoise: { value: this.noiseTex },
        uHeapInfo: { value: Array.from({ length: MAX_HEAPS }, () => new THREE.Vector4()) },
        uHeapBound: { value: Array.from({ length: MAX_HEAPS }, () => new THREE.Vector4(0, -1e7, 0, 0)) },
        uHeapUnit: { value: new Float32Array(MAX_HEAPS) },
        uSun: { value: SUN.clone() },
        uSunBig: { value: SUN_BIG.clone() },
      },
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(mesh);
    this.camera = new THREE.Camera();
  }

  // The noise, filled a few slices a frame (all at once when asked).
  _fillNoise(all) {
    const n = CLOUD_NOISE_N;
    if (this.noiseRows >= n) return true;
    const to = all ? n : Math.min(n, this.noiseRows + NOISE_SLICES);
    fillCloudNoise(this.noiseData, n, this.noiseRows, to);
    this.noiseRows = to;
    this.noiseTex.needsUpdate = true;
    return to >= n;
  }

  // Build the program ahead of its first strip, onto a one-pixel target.
  warm() {
    this._prepare();
    const r = this.renderer;
    if (!this._warmTarget) this._warmTarget = new THREE.WebGLRenderTarget(1, 1);
    const was = r.getRenderTarget();
    r.setRenderTarget(this._warmTarget);
    const p = r.compileAsync ? r.compileAsync(this.scene, this.camera) : (r.compile(this.scene, this.camera), null);
    r.setRenderTarget(was);
    return p;
  }

  // Ask for a set: baked into the free cube if it is not what is drawn (or
  // being baked or crossed to already).
  want(name) {
    if (!name || name === this.set || name === this.target) return;
    this.pending = name;
  }

  _start(name) {
    this._prepare();
    const size = SIZE[this.tier];
    const free = this.live < 0 ? 0 : 1 - this.live;
    let rt = this.cubes[free];
    if (rt && rt.width !== size) {
      rt.dispose();
      rt = null;
    }
    if (!rt) rt = this.cubes[free] = makeTarget(size);
    const set = layoutClouds(name, this.seed, this.axis);
    const u = this.material.uniforms;
    this.ballTex.image.data.set(set.balls);
    this.ballTex.needsUpdate = true;
    for (let h = 0; h < MAX_HEAPS; h++) {
      u.uHeapInfo.value[h].fromArray(set.info, h * 4);
      u.uHeapBound.value[h].fromArray(set.bound, h * 4);
      u.uHeapUnit.value[h] = h < set.count ? set.widths[h] * 0.07 : 1;
    }
    u.uSize.value = size;
    u.uTexAng.value = 2 / size;
    u.uSteps.value = STEPS[this.tier];
    this.job = { name, free, face: 0, strip: 0, size };
    this.target = name;
    this.pending = null;
  }

  // One strip of the job: a face a strip tall.
  _strip() {
    const r = this.renderer;
    const j = this.job;
    const rt = this.cubes[j.free];
    const h = j.size / STRIPS;
    rt.scissor.set(0, j.strip * h, j.size, h);
    rt.scissorTest = true;
    this.material.uniforms.uFace.value = j.face;
    const was = r.getRenderTarget();
    const cube = r.getActiveCubeFace();
    const mip = r.getActiveMipmapLevel();
    const info = r.info.render;
    const kept = [info.calls, info.triangles, info.points, info.lines];
    const clear = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(rt, j.face);
    r.render(this.scene, this.camera);
    r.setRenderTarget(was, cube, mip);
    r.autoClear = clear;
    [info.calls, info.triangles, info.points, info.lines] = kept;
    rt.scissorTest = false;
    this.frames++;
    j.strip++;
    if (j.strip >= STRIPS) {
      j.strip = 0;
      j.face++;
    }
    // The face under (-Y) is not baked: nothing reads it.
    if (j.face === 3) j.face = 4;
    return j.face >= 6;
  }

  _finish() {
    const j = this.job;
    this.job = null;
    this.bakes++;
    if (this.live < 0 || this.tier === 'low' || this.sync) {
      this._take(j.free, j.name);
    } else {
      this.uniforms.uCloudB.value = this.cubes[j.free].texture;
      this.uniforms.uCloudT.value = 0;
      this.fade = 1e-6;
      this.crossing = true;
      this.crossTo = { free: j.free, name: j.name };
    }
    this.changed = true;
  }

  // The cube free is the one drawn from now.
  _take(free, name) {
    const was = this.live;
    this.live = free;
    this.set = name;
    this.target = null;
    this.baked = true;
    this.uniforms.uCloudA.value = this.cubes[free].texture;
    this.uniforms.uCloudB.value = this.none;
    this.uniforms.uCloudT.value = 0;
    this.crossing = false;
    this.fade = 0;
    // (The cube left is free to bake into; it keeps what it has until then.)
    void was;
  }

  // Every frame. dt: seconds. on: whether any style in use draws these
  // clouds; nothing is baked, or crossed, while none does.
  update(dt, on) {
    if (!on) return;
    this._prepare();
    if (this.crossing) {
      this.fade += dt;
      const k = Math.min(1, this.fade / FADE_SECONDS);
      this.uniforms.uCloudT.value = k * k * (3 - 2 * k);
      if (k >= 1) {
        const c = this.crossTo;
        this._take(c.free, c.name);
        this.changed = true;
      } else if (Math.floor(this.fade / 2) !== Math.floor((this.fade - dt) / 2)) {
        this.changed = true;
      }
      return;
    }
    if (!this.job && this.pending) {
      if (this._fillNoise(this.sync)) this._start(this.pending);
      return;
    }
    if (!this.job && !this.set && this.noiseRows < CLOUD_NOISE_N) this._fillNoise(this.sync);
    if (this.job) {
      if (this.sync) {
        while (!this._strip());
        this._finish();
      } else if (this._strip()) {
        this._finish();
      }
    }
  }

  // Whether the sky's light wants baking again for the clouds (once, per ask).
  takeChanged() {
    const c = this.changed;
    this.changed = false;
    return c;
  }

  // For the page's diagnostics and the checks.
  state() {
    return { baked: this.baked, set: this.set, target: this.target, bakes: this.bakes, frames: this.frames, size: this.size, crossing: this.crossing, fade: +this.fade.toFixed(2) };
  }

  get size() {
    return SIZE[this.tier];
  }

  dispose() {
    for (const c of this.cubes) if (c) c.dispose();
    if (this.noiseTex) this.noiseTex.dispose();
    if (this.ballTex) this.ballTex.dispose();
    if (this.material) this.material.dispose();
    this.none.dispose();
  }
}
