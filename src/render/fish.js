import * as THREE from 'three';
import { WORLDS } from '../world/worlds.js';
import { atmo } from './atmosphere.js';

// Fish that light themselves, in the deep sea: schools of small glowing fish
// milling round a slow circle, scattered through the water around the lens.
//
// Like the motes (render/motes.js), nothing is kept on the CPU. Each school
// has a fixed seed that places it in a box riding with the camera, wrapped
// in absolute coordinates, so a school stays where it is while the car
// drives past it. The vertex shader swims each fish: the school's centre
// circles, the fish turns round it on its own radius and depth, faces the
// way it is going and swings its tail. Which worlds have them, how big and
// in what light is each world's `fish` (world/worlds.js); across a border a
// school belongs to the world by its own draw, so they thin out with the
// sea.

const SCHOOLS = 24;
const PER_SCHOOL = 24;
const BOX = 160;        // metres across, round the camera
const BAND = 40;        // metres of water they swim in, from 10 under the lens
const RATE = 0.0075;    // rad/s; every rate of the swim is a multiple of it
const PERIOD = (2 * Math.PI) / RATE;

const NONE = { density: 0, size: 0.5, glow: 0, color: 0xffffff };
const KINDS = WORLDS.map((w) => {
  const f = { ...NONE, ...(w.fish || {}) };
  return { ...f, light: new THREE.Color(f.color).multiplyScalar(f.glow) };
});

// One fish a unit long, nose at +z: a flattened diamond of a body and a
// forked tail. aWag says how far each vertex swings with the tail.
function fishGeometry() {
  const P = [
    [0, 0, 0.5], [0, 0.16, 0.08], [0.08, 0, 0.08], [0, -0.13, 0.08], [-0.08, 0, 0.08],
    [0, 0, -0.28], [0, 0.2, -0.5], [0, -0.2, -0.5],
  ];
  const wag = [0, 0.15, 0.15, 0.15, 0.15, 0.55, 1, 1];
  const shade = [1, 0.8, 0.9, 0.55, 0.9, 0.7, 0.5, 0.5];
  const idx = [
    0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1,
    5, 2, 1, 5, 3, 2, 5, 4, 3, 5, 1, 4,
    5, 6, 7,
  ];
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P.flat(), 3));
  g.setAttribute('aWag', new THREE.Float32BufferAttribute(wag, 1));
  g.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 1));
  g.setIndex(idx);
  return g;
}

const VERTEX = /* glsl */`
attribute float aWag;
attribute float aShade;
attribute vec4 aSchool;   // the school's place in the box (xyz) and its own draw
attribute vec4 aFish;     // where in the school (xyz, -1..1) and the fish's phase
uniform vec3 uCam;
uniform vec3 uCamMod;
uniform float uTime;
uniform vec2 uDensity;
uniform vec2 uSize;
uniform vec3 uLight[2];
uniform float uT;
uniform vec3 fogParams;
varying vec3 vLight;
// Every rate of the swim is a whole multiple of W, so the clock can wrap at
// 2 pi / W without a fish jumping.
const float W = ${RATE};

vec3 swim(float t) {
  float ph = aSchool.w * 6.2832;
  // The school's centre goes round a slow circle, rising and falling.
  vec3 c = vec3(sin(t * 8.0 * W + ph) * 16.0, sin(t * 6.0 * W + ph * 1.7) * 3.0, cos(t * 8.0 * W + ph) * 16.0);
  // The fish mills round it, each on its own radius, depth and speed.
  float fp = aFish.w * 6.2832;
  vec3 o = aFish.xyz * vec3(5.5, 2.2, 5.5);
  float a = t * W * floor((0.3 + 0.25 * aFish.w) / W + 0.5) + fp;
  return c + vec3(o.x * cos(a) - o.z * sin(a), o.y + 0.5 * sin(t * 108.0 * W + fp), o.x * sin(a) + o.z * cos(a));
}

void main() {
  int w = fract(aSchool.w * 7.31) < uT ? 1 : 0;
  vLight = vec3(0.0);
  if (fract(aSchool.w * 3.17) >= uDensity[w]) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 base = mod(aSchool.xyz * vec3(${BOX}.0, ${BAND}.0, ${BOX}.0) - uCamMod, vec3(${BOX}.0, ${BAND}.0, ${BOX}.0))
    - vec3(${BOX / 2}.0, 10.0, ${BOX / 2}.0);
  vec3 p0 = swim(uTime);
  vec3 fwd = swim(uTime + 0.15) - p0;
  fwd = length(fwd) > 1e-4 ? normalize(fwd) : vec3(0.0, 0.0, 1.0);
  vec3 side = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
  vec3 up = cross(side, fwd);
  vec3 lp = position;
  lp.x += aWag * 0.16 * sin(uTime * 935.0 * W + aFish.w * 40.0);
  vec3 wp = uCam + base + p0 + (side * lp.x + up * lp.y + fwd * lp.z) * uSize[w];
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  // Faded at the box's walls, where a school wraps round, and into the haze.
  float edge = smoothstep(${BOX / 2}.0, ${BOX * 0.32}, length(base.xz));
  vLight = uLight[w] * aShade * edge * exp(-max(d, 0.0) * fogParams.x * 0.9);
}
`;

const FRAGMENT = /* glsl */`
varying vec3 vLight;
void main() {
  gl_FragColor = vec4(vLight, 1.0);
}
`;

export class Fish {
  constructor(scene) {
    const rand = mulberry32(0xf15b);
    const geo = fishGeometry();
    const count = SCHOOLS * PER_SCHOOL;
    const school = new Float32Array(count * 4);
    const fish = new Float32Array(count * 4);
    for (let s = 0; s < SCHOOLS; s++) {
      const seed = [rand(), rand(), rand(), rand()];
      for (let k = 0; k < PER_SCHOOL; k++) {
        const i = s * PER_SCHOOL + k;
        school.set(seed, i * 4);
        // A point in the unit ball, denser toward the middle.
        let x;
        let y;
        let z;
        do {
          x = rand() * 2 - 1;
          y = rand() * 2 - 1;
          z = rand() * 2 - 1;
        } while (x * x + y * y + z * z > 1);
        fish.set([x, y, z, rand()], i * 4);
      }
    }
    geo.setAttribute('aSchool', new THREE.InstancedBufferAttribute(school, 4));
    geo.setAttribute('aFish', new THREE.InstancedBufferAttribute(fish, 4));
    geo.instanceCount = count;
    this.uniforms = {
      uCam: { value: new THREE.Vector3() },
      uCamMod: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uDensity: { value: new THREE.Vector2() },
      uSize: { value: new THREE.Vector2(0.5, 0.5) },
      uLight: { value: [new THREE.Vector3(), new THREE.Vector3()] },
      uT: { value: 0 },
      fogParams: atmo.fogParams,
    };
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.shown = 0;
  }

  // at: the two worlds the camera is between and the blend ({ a, b, t });
  // origin: the floating origin.
  update(dt, camera, at, origin) {
    const u = this.uniforms;
    const A = KINDS[at.a];
    const B = KINDS[at.b];
    const t = at.a === at.b ? 0 : at.t;
    const share = A.density * (1 - t) + B.density * t;
    this.shown = Math.round(share * SCHOOLS);
    this.mesh.visible = share > 0.01;
    u.uTime.value = (u.uTime.value + dt) % PERIOD;
    if (!this.mesh.visible) return;
    const c = camera.position;
    u.uCam.value.copy(c);
    const wrap = (v, m) => ((v % m) + m) % m;
    u.uCamMod.value.set(wrap(c.x + origin.x, BOX), wrap(c.y, BAND), wrap(c.z + origin.z, BOX));
    u.uT.value = t;
    u.uDensity.value.set(A.density, B.density);
    u.uSize.value.set(A.size, B.size);
    u.uLight.value[0].set(A.light.r, A.light.g, A.light.b);
    u.uLight.value[1].set(B.light.r, B.light.g, B.light.b);
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
