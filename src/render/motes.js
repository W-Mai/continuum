import * as THREE from 'three';
import { WORLDS } from '../world/worlds.js';
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

const NONE = { density: 0, size: 0.04, rise: 0, current: 0, sway: 0, flicker: 0, glow: 0, color: 0xffffff };
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
uniform vec3 uLight[2];
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
  float px = uSize[w] * (0.6 + 0.8 * fract(seed.w * 91.0)) * uPx / max(depth, 0.1);
  // Out at the walls of the box, and right against the lens, they fade.
  float a = smoothstep(${BOX / 2}.0, ${(BOX * 0.3).toFixed(1)}, length(p)) * smoothstep(0.5, 2.0, depth);
  a *= mix(1.0, 0.45 + 0.55 * sin(uTime * (4.0 + 5.0 * seed.x) + ph), uFlicker[w]);
  // Under a pixel and a half they dim instead of shrinking, so they do not
  // shimmer.
  a *= clamp(px / 1.5, 0.0, 1.0);
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

export class Motes {
  constructor(scene) {
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
      uLight: { value: [new THREE.Vector3(), new THREE.Vector3()] },
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
    // Each world's drift so far, per pace, wrapped to the box in double
    // precision.
    this.drift = KINDS.map(() => PACE.map(() => [0, 0, 0]));
    this.shown = 0;
  }

  // at: the two worlds the camera is between and the blend ({ a, b, t });
  // origin: the floating origin; heightPx: the drawing buffer's height.
  update(dt, camera, at, origin, heightPx) {
    const u = this.uniforms;
    const A = KINDS[at.a];
    const B = KINDS[at.b];
    const t = at.a === at.b ? 0 : at.t;
    const share = A.density * (1 - t) + B.density * t;
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
    if (!this.points.visible) return;
    const c = camera.position;
    u.uCam.value.copy(c);
    const wrap = (v) => ((v % BOX) + BOX) % BOX;
    u.uCamMod.value.set(wrap(c.x + origin.x), wrap(c.y), wrap(c.z + origin.z));
    u.uT.value = t;
    u.uDensity.value.set(A.density, B.density);
    u.uSize.value.set(A.size, B.size);
    u.uSway.value.set(A.sway, B.sway);
    u.uFlicker.value.set(A.flicker, B.flicker);
    u.uLight.value[0].set(A.light.r, A.light.g, A.light.b);
    u.uLight.value[1].set(B.light.r, B.light.g, B.light.b);
    u.uPx.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
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
