import * as THREE from 'three';
import { WORLDS } from '../world/worlds.js';
import { RAIN } from '../world/upsidefx.js';
import { twistU, TWIST_PARS } from './twist.js';

// What hangs in the air, or the water, around the lens: snow sinking through
// the deep sea, embers rising off the lava, dust in the cavern's still air.
//
// One field of points in a box that rides with the camera. Nothing is spawned
// or kept on the CPU: each point has a fixed seed, and the shader places it
// from that seed, its world's drift so far and where the camera is, wrapping
// it round the box. The points stay put in the world (and drift with it), so
// the car drives through them. How many show, how big, which way they go and
// how they glow is each world's `motes` (world/worlds.js). Across a border
// every point belongs to one world or the other by its own draw, as the trees
// do, so the embers thin out as the snow comes in and the two never add up.

const COUNT = 12000;
const BOX = 40;
// Three groups drift at their own pace, so the field does not move as a sheet.
const PACE = [0.6, 1.0, 1.5];

// In the light of a skylight (render/skylight.js) the dust is lit: its light is
// this many times what it was, at the middle of the shaft.
export const BEAM_GAIN = 4;

// maxPx: the biggest a point is drawn, in pixels: in daylight a speck near the
// lens is a speck, not a lamp out of focus.
const NONE = { density: 0, size: 0.04, rise: 0, current: 0, sway: 0, flicker: 0, glow: 0, color: 0xffffff, maxPx: 6 };
const KINDS = WORLDS.map((w) => {
  const m = { ...NONE, ...(w.motes || {}) };
  return { ...m, light: new THREE.Color(m.color).multiplyScalar(m.glow) };
});

const VERTEX = /* glsl */`
${TWIST_PARS}
attribute vec4 seed;
attribute vec2 pick;
uniform vec3 uCam;
uniform vec3 uCamMod;
uniform vec3 uDrift[${PACE.length * 2}];
uniform vec2 uDensity;
uniform vec2 uSize;
uniform vec2 uSway;
uniform vec2 uFlicker;
uniform vec2 uMax;
uniform vec3 uLight[2];
uniform vec4 uBeam[2];
uniform float uT;
uniform float uTime;
uniform float uPx;
varying vec3 vLight;
void main() {
  int w = pick.x < uT ? 1 : 0;
  vLight = vec3(0.0);
  if (seed.w >= uDensity[w]) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  int g = int(fract(seed.w * 37.0) * ${PACE.length}.0);
  vec3 p = mod(seed.xyz * ${BOX}.0 + uDrift[w * ${PACE.length} + g] - uCamMod, ${BOX}.0) - ${BOX / 2}.0;
  float ph = pick.y * 6.2832;
  p += uSway[w] * vec3(sin(uTime * 0.7 + ph), 0.5 * sin(uTime * 0.9 + ph * 1.7), cos(uTime * 0.6 + ph * 2.3));
  vec4 mv = viewMatrix * vec4(uCam + p, 1.0);
  gl_Position = projectionMatrix * twistView(mv);
  float depth = -mv.z;
  float px = min(uSize[w] * (0.6 + 0.8 * fract(seed.w * 91.0)) * uPx / max(depth, 0.1), uMax[w]);
  // Out at the walls of the box, and right against the lens, they fade.
  float a = smoothstep(${BOX / 2}.0, ${(BOX * 0.3).toFixed(1)}, length(p)) * smoothstep(0.5, 2.0, depth);
  a *= mix(1.0, 0.45 + 0.55 * sin(uTime * (4.0 + 5.0 * seed.x) + ph), uFlicker[w]);
  // Under a pixel and a half they dim instead of shrinking, so they do not
  // shimmer.
  a *= clamp(px / 1.5, 0.0, 1.0);
  // In a shaft of light the dust is lit: up to BEAM_GAIN times, by how far into the shaft (x, z, radius, how much it shines).
  if (uBeam[0].w + uBeam[1].w > 0.0) {
    vec2 q = uCam.xz + p.xz;
    float lit = 0.0;
    for (int i = 0; i < 2; i++) lit = max(lit, uBeam[i].w * (1.0 - smoothstep(uBeam[i].z * 0.75, uBeam[i].z, length(q - uBeam[i].xy))));
    a *= 1.0 + ${(BEAM_GAIN - 1).toFixed(1)} * lit;
  }
  vLight = uLight[w] * a;
  gl_PointSize = max(px, 1.5);
}
`;

const FRAGMENT = /* glsl */`
varying vec3 vLight;
void main() {
  float r = length(gl_PointCoord - 0.5);
  gl_FragColor = vec4(vLight * (1.0 - smoothstep(0.15, 0.5, r)), 1.0);
}
`;

// What of the rain there is at each tier: the share of RAIN.density.
const RAIN_TIER = { high: 1, mid: 0.5, low: 0 };

// The rain: the same points, each drawn as a streak, a thin line RAIN.length m long
// along the way up (the world's, not the screen's: the lens rolls over with the
// car, so on the screen the streaks turn with it). Both ends of the streak are
// projected as any point is, wound with the land where the land is wound, and the
// streak is a quad as wide as the line is, laid along them on the screen: a point
// drawn that long would be a square many times the line's area.
const RAIN_VERTEX = /* glsl */`
${TWIST_PARS}
attribute vec4 seed;
uniform vec3 uCam;
uniform vec3 uCamMod;
uniform vec3 uRainDrift[${PACE.length}];
uniform vec2 uView;
uniform float uLen;
uniform float uSway;
uniform float uTime;
uniform vec3 uLight;
varying vec3 vLight;
varying vec2 vQ;
varying float vHalf;
void main() {
  vLight = vec3(0.0);
  vQ = vec2(0.0);
  vHalf = 0.0;
  int g = int(fract(seed.w * 37.0) * ${PACE.length}.0);
  vec3 p = mod(seed.xyz * ${BOX}.0 + uRainDrift[g] - uCamMod, ${BOX}.0) - ${BOX / 2}.0;
  float ph = seed.w * 6.2832;
  p.x += uSway * sin(uTime * 0.7 + ph);
  p.z += uSway * cos(uTime * 0.6 + ph * 2.3);
  vec3 c = uCam + p;
  vec3 h = vec3(0.0, 0.5 * uLen, 0.0);
  vec4 a = projectionMatrix * twistView(viewMatrix * vec4(c - h, 1.0));
  vec4 b = projectionMatrix * twistView(viewMatrix * vec4(c + h, 1.0));
  float depth = -(viewMatrix * vec4(c, 1.0)).z;
  if (a.w < 0.05 || b.w < 0.05) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 d = 0.5 * uView * (b.xy / b.w - a.xy / a.w);
  float len = length(d);
  vec2 dir = len > 1e-3 ? d / len : vec2(0.0, 1.0);
  float half_ = 0.5 * len + 1.0;
  vec2 q = vec2(position.x * half_, position.y * ${(RAIN.width).toFixed(2)});
  vec2 off = dir * q.x + vec2(-dir.y, dir.x) * q.y;
  vec4 m = 0.5 * (a + b);
  gl_Position = vec4(m.xy + off * 2.0 / uView * m.w, m.z, m.w);
  vQ = q;
  vHalf = 0.5 * len;
  // Out at the walls of the box, and right against the lens, they fade.
  float k = smoothstep(${BOX / 2}.0, ${(BOX * 0.3).toFixed(1)}, length(p)) * smoothstep(0.5, 2.5, depth);
  // One that is a pixel long is dimmer for it.
  k *= clamp(len / 3.0, 0.2, 1.0);
  vLight = uLight * k * (0.55 + 0.45 * fract(seed.w * 91.0));
}
`;

const RAIN_FRAGMENT = /* glsl */`
varying vec3 vLight;
varying vec2 vQ;
varying float vHalf;
void main() {
  float along = 1.0 - smoothstep(vHalf - 0.5, vHalf + 1.0, abs(vQ.x));
  float across = 1.0 - smoothstep(0.25, ${RAIN.width.toFixed(2)}, abs(vQ.y));
  gl_FragColor = vec4(vLight * along * across, 1.0);
}
`;

export class Motes {
  constructor(scene, tier = 'high') {
    this.tier = tier;
    const rand = mulberry32(0x6d07e5);
    const seed = new Float32Array(COUNT * 4).map(rand);
    const pick = new Float32Array(COUNT * 2).map(rand);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    geo.setAttribute('pick', new THREE.BufferAttribute(pick, 2));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.uniforms = {
      uCam: { value: new THREE.Vector3() },
      uCamMod: { value: new THREE.Vector3() },
      uDrift: { value: Array.from({ length: PACE.length * 2 }, () => new THREE.Vector3()) },
      uDensity: { value: new THREE.Vector2() },
      uSize: { value: new THREE.Vector2() },
      uSway: { value: new THREE.Vector2() },
      uFlicker: { value: new THREE.Vector2() },
      uMax: { value: new THREE.Vector2(6, 6) },
      uLight: { value: [new THREE.Vector3(), new THREE.Vector3()] },
      uBeam: { value: [new THREE.Vector4(), new THREE.Vector4()] },
      uT: { value: 0 },
      uTime: { value: 0 },
      uPx: { value: 700 },
      ...twistU,
    };
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.points.visible = false;
    scene.add(this.points);
    this._makeRain(scene, seed);
    // Each world's drift so far, per pace, wrapped to the box in double
    // precision.
    this.drift = KINDS.map(() => PACE.map(() => [0, 0, 0]));
    this.shown = 0;
  }

  // The shafts of light the dust is lit in (render/skylight.js): the two
  // vectors are x, z (local metres), the radius and how much each shines.
  get beams() {
    return this.uniforms.uBeam.value;
  }

  // The streaks of the rain, as many as the points are, in the points' own seeds.
  _makeRain(scene, seed) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('seed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    const light = new THREE.Color(RAIN.color).multiplyScalar(RAIN.glow);
    this.rainUniforms = {
      uCam: this.uniforms.uCam,
      uCamMod: this.uniforms.uCamMod,
      uTime: this.uniforms.uTime,
      uRainDrift: { value: PACE.map(() => new THREE.Vector3()) },
      uView: { value: new THREE.Vector2(1280, 577) },
      uLen: { value: RAIN.length },
      uSway: { value: RAIN.sway },
      uLight: { value: new THREE.Vector3(light.r, light.g, light.b) },
      ...twistU,
    };
    this.rainMaterial = new THREE.ShaderMaterial({
      uniforms: this.rainUniforms,
      vertexShader: RAIN_VERTEX,
      fragmentShader: RAIN_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.rain = new THREE.Mesh(geo, this.rainMaterial);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 3;
    this.rain.visible = false;
    // (It joins the scene the first time it rains: a mesh in the scene has its program built
    // with all the rest at the start, a game that never has rain has no use for one.)
    this.rainDrift = PACE.map(() => [0, 0, 0]);
    this.streaks = 0;
    this._scene = scene;
  }

  setTier(tier) {
    if (RAIN_TIER[tier] !== undefined) this.tier = tier;
  }

  // The rain this frame: how many of the points are streaks, and where they have got to.
  _rain(dt, camera, share, origin, heightPx) {
    const r = this.rain;
    r.visible = share > 0.002;
    if (!r.visible) {
      this.streaks = 0;
      return;
    }
    if (!r.parent) this._scene.add(r);
    const ru = this.rainUniforms;
    const wrap = (v) => ((v % BOX) + BOX) % BOX;
    const c = camera.position;
    this.uniforms.uCam.value.copy(c);
    this.uniforms.uCamMod.value.set(wrap(c.x + origin.x), wrap(c.y), wrap(c.z + origin.z));
    for (let g = 0; g < PACE.length; g++) {
      const d = this.rainDrift[g];
      d[1] = (d[1] + RAIN.speed * PACE[g] * dt) % BOX;
      ru.uRainDrift.value[g].set(d[0], d[1], d[2]);
    }
    this.streaks = Math.round(COUNT * RAIN.density * share);
    r.geometry.instanceCount = this.streaks;
    ru.uView.value.set(heightPx * camera.aspect, heightPx);
  }

  // at: the two worlds the camera is between and the blend ({ a, b, t });
  // origin: the floating origin; heightPx: the drawing buffer's height; rain: how
  // much of the air's points are rain now (0 to 1, render/upside.js).
  update(dt, camera, at, origin, heightPx, rain = 0) {
    const u = this.uniforms;
    const A = KINDS[at.a];
    const B = KINDS[at.b];
    const t = at.a === at.b ? 0 : at.t;
    // Rain takes the place of the air's points: as much as there is of one is not of the other.
    const wet = rain > 0 ? Math.min(1, rain) * (RAIN_TIER[this.tier] > 0 ? 1 : 0) : 0;
    const keep = 1 - wet;
    const share = (A.density * (1 - t) + B.density * t) * keep;
    this.shown = Math.round(share * COUNT);
    this.points.visible = share > 0.002;
    u.uTime.value = (u.uTime.value + dt) % 3600;
    for (const [slot, i] of [[0, at.a], [1, at.b]]) {
      const k = KINDS[i];
      // The current runs the same way in every world; only its speed changes.
      const v = [k.current * 0.8, k.rise, k.current * 0.6];
      for (let g = 0; g < PACE.length; g++) {
        const d = this.drift[i][g];
        if (slot === 0 || at.a !== at.b) {
          for (let c = 0; c < 3; c++) d[c] = (d[c] + v[c] * PACE[g] * dt) % BOX;
        }
        u.uDrift.value[slot * PACE.length + g].set(d[0], d[1], d[2]);
      }
    }
    this._rain(dt, camera, wet * RAIN_TIER[this.tier], origin, heightPx);
    if (!this.points.visible) return;
    const c = camera.position;
    u.uCam.value.copy(c);
    const wrap = (v) => ((v % BOX) + BOX) % BOX;
    u.uCamMod.value.set(wrap(c.x + origin.x), wrap(c.y), wrap(c.z + origin.z));
    u.uT.value = t;
    u.uDensity.value.set(A.density * keep, B.density * keep);
    u.uSize.value.set(A.size, B.size);
    u.uSway.value.set(A.sway, B.sway);
    u.uFlicker.value.set(A.flicker, B.flicker);
    u.uMax.value.set(A.maxPx, B.maxPx);
    u.uLight.value[0].set(A.light.r, A.light.g, A.light.b);
    u.uLight.value[1].set(B.light.r, B.light.g, B.light.b);
    u.uPx.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }

  // Lets go of what it holds.
  dispose() {
    for (const o of [this.points, this.rain]) {
      this._scene.remove(o);
      o.geometry.dispose();
      o.material.dispose();
    }
  }
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
