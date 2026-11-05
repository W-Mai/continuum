import * as THREE from 'three';

// Gradient dome plus a star field. Both are shader driven, so a biome change
// only pushes uniforms and never rebuilds geometry or recompiles.

const skyVert = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const skyFrag = `
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uSunColor;
uniform vec2 uSunDir;
uniform float uSunSize;
uniform float uStars;
varying vec3 vDir;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  // vDir.y runs -1..1 across the dome; map it so the horizon sits at h=0.5 and
  // the zenith at 1.0, then bias the curve so the zenith is reached smoothly.
  float h = clamp(vDir.y, 0.0, 1.0);
  vec3 col = mix(uBottom, uTop, pow(h, 0.55));

  // vDir is a 3-vector; its xz pair has to be taken as a vec2 explicitly.
  vec2 flatDir = normalize(vDir.xz + vec2(1e-5));
  float sun = max(dot(flatDir, normalize(uSunDir)), 0.0);
  float disc = smoothstep(1.0 - uSunSize * 0.0016, 1.0, sun);
  col += uSunColor * disc * 2.2;
  col += uSunColor * pow(sun, 24.0) * 0.35;

  if (uStars > 0.001) {
    vec2 cell = floor(vDir.xz * 260.0);
    vec2 f = fract(vDir.xz * 260.0) - 0.5;
    float r = hash(cell);
    float pts = smoothstep(0.38, 0.0, length(f)) * step(0.985, r);
    float twinkle = 0.65 + 0.35 * sin(r * 90.0);
    col += vec3(0.85, 0.9, 1.0) * pts * twinkle * uStars * smoothstep(0.0, 0.25, h);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createSky() {
  // Must sit inside the camera's far plane, or its top clips to the background
  // colour as a band across the sky.
  const geo = new THREE.SphereGeometry(5200, 48, 32);
  const mat = new THREE.ShaderMaterial({
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x2f6fb5) },
      uBottom: { value: new THREE.Color(0xbfe0f5) },
      uSunColor: { value: new THREE.Color(0xfff2dc) },
      uSunDir: { value: new THREE.Vector2(0.6, 0.8) },
      uSunSize: { value: 42 },
      uStars: { value: 0 },
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return mesh;
}

export function applySky(sky, blended) {
  const u = sky.material.uniforms;
  u.uTop.value.setHex(blended.skyTop);
  u.uBottom.value.setHex(blended.skyBottom);
  u.uSunColor.value.setHex(blended.sunColor);
  u.uSunDir.value.set(blended.sunX, blended.sunZ);
  u.uSunSize.value = blended.sunSize;
  u.uStars.value = blended.starDensity;
}

// Terrain height is a pure function of world position, so the mesh just follows
// the camera. Nothing to stream, and no seams where tiles would meet.
const terrainVert = `
uniform float uAmp;
uniform float uRidged;
uniform vec3 uOffset;
varying float vHeight;
varying vec3 vWorld;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.07;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 p = position;
  vec2 w = p.xz + uOffset.xz;
  float n = fbm(w * 0.0022);
  if (uRidged > 0.5) n = 1.0 - abs(n * 2.0 - 1.0);
  float dist = length(p.xz);
  // smoothstep with edge0 > edge1 is undefined in GLSL; write the falloff out
  // so height fades in with distance instead of flipping sign.
  // Height grows with distance from the road so nothing towers over the camera:
  // a flat apron near the asphalt, full relief only far away.
  // Full relief from just outside the road all the way out. Only the first few
  // metres stay flat so the verge meets the asphalt cleanly.
  // Relief grows with distance: flat verge for the first few metres, gentle
  // folds mid-field, real hills past the ridge line. A single blend factor
  // either flattens the whole view or buries the camera.
  // Ramp relief over distance: flat verge, gentle mid-field rolls, real ridges
  // only past a kilometre. That is what reads as a skyline instead of a wall.
  float near = smoothstep(10.0, 320.0, dist);
  float far = smoothstep(800.0, 3000.0, dist);
  float scale = near * (0.16 + 0.84 * far);
  float h = (n - 0.42) * uAmp * scale;
  p.y += h - 0.35;
  vHeight = h;
  vWorld = vec3(w.x, p.y, w.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const terrainFrag = `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uFogColor;
uniform vec3 uCamPos;
varying float vHeight;
varying vec3 vWorld;

void main() {
  vec3 col = mix(uColorA, uColorB, smoothstep(-30.0, 260.0, vHeight));
  float d = length(vWorld.xz - uCamPos.xz);
  float fog = smoothstep(uFogNear, uFogFar, d);
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createTerrain() {
  // The inner radius has to clear the road corridor plus its shoulders, or the
  // terrain sheet cuts a wedge across the asphalt on curves.
  // Must start just outside the road's own footprint: too wide and the camera
  // looks straight over it, leaving bare sky where ground should be.
  // A full disc, not a ring. The mesh follows the camera, so any hole in the
  // middle sits directly under the lens and reads as sky through the ground.
  const geo = new THREE.CircleGeometry(4200, 200);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    vertexShader: terrainVert,
    fragmentShader: terrainFrag,
    uniforms: {
      uAmp: { value: 260 },
      uRidged: { value: 1 },
      uOffset: { value: new THREE.Vector3() },
      uColorA: { value: new THREE.Color(0x3f6b3a) },
      uColorB: { value: new THREE.Color(0x8fa87c) },
      uFogNear: { value: 220 },
      uFogFar: { value: 2100 },
      uFogColor: { value: new THREE.Color(0xbcd8ec) },
      uCamPos: { value: new THREE.Vector3() },
    },
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.position.y = -0.6;
  return mesh;
}

export function applyTerrain(terrain, blended, camPos) {
  const u = terrain.material.uniforms;
  u.uAmp.value = blended.terrainAmp;
  u.uRidged.value = blended.terrainRidged ? 1 : 0;
  // The shader samples noise at (local + offset), and the mesh itself is moved
  // to the camera position, so the offset must stay at zero or the terrain is
  // displaced twice and leaves the frame.
  u.uOffset.value.set(0, 0, 0);
  u.uColorA.value.setHex(blended.terrainA);
  u.uColorB.value.setHex(blended.terrainB);
  u.uFogNear.value = blended.fogNear;
  u.uFogFar.value = blended.fogFar;
  u.uFogColor.value.setHex(blended.fogColor);
  u.uCamPos.value.set(camPos.x, camPos.y, camPos.z);
  terrain.position.x = camPos.x;
  terrain.position.z = camPos.z;
}
