import * as THREE from 'three';

// Sky dome and terrain. Both are shader driven so a biome change only pushes
// uniforms and never rebuilds geometry or recompiles.

const skyVert = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const skyFrag = `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uSunColor;
uniform vec2 uSunDir;
uniform float uSunElev;
uniform float uSunSize;
uniform float uStars;
uniform float uHaze;
varying vec3 vDir;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  float y = vDir.y;

  // Three-stop gradient. A pure two-stop mix puts the lightest value at the
  // horizon, which reads as a band of sky leaking under the terrain; the horizon
  // stop lets the fog colour meet the ground without a seam.
  vec3 col = mix(uBottom, uHorizon, smoothstep(-0.12, 0.06, y));
  col = mix(col, uTop, smoothstep(0.02, 0.62, y));

  // Test against a full 3D direction. Using only the horizontal pair yields an
  // azimuth band, which is why the sun drew as a full-height white column.
  vec3 sunDir = normalize(vec3(uSunDir.x, uSunElev, uSunDir.y));
  float sun = max(dot(normalize(vDir), sunDir), 0.0);
  float disc = smoothstep(0.9992, 0.9997, sun);
  float glow = pow(sun, 300.0) * 0.5 + pow(sun, 30.0) * 0.07;
  col += uSunColor * (disc * 1.2 + glow) * clamp(uSunSize * 0.012, 0.05, 1.2);
  col += uSunColor * uHaze * pow(max(0.0, 1.0 - abs(y) * 3.4), 3.0) * 0.05;

  if (uStars > 0.001) {
    vec2 cell = floor(vDir.xz * 260.0);
    vec2 f = fract(vDir.xz * 260.0) - 0.5;
    float r = hash(cell);
    float pts = smoothstep(0.38, 0.0, length(f)) * step(0.985, r);
    float twinkle = 0.65 + 0.35 * sin(r * 90.0);
    col += vec3(0.85, 0.9, 1.0) * pts * twinkle * uStars * smoothstep(0.0, 0.25, y);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createSky() {
  // Radius must sit inside the camera far plane or its top clips to the clear
  // colour and leaves a seam across the sky.
  const geo = new THREE.SphereGeometry(5200, 48, 32);
  const mat = new THREE.ShaderMaterial({
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x2f6fb5) },
      uHorizon: { value: new THREE.Color(0xa8cbe8) },
      uBottom: { value: new THREE.Color(0x8fb4d0) },
      uSunColor: { value: new THREE.Color(0xfff2dc) },
      uSunDir: { value: new THREE.Vector2(0.6, 0.8) },
      uSunElev: { value: 0.35 },
      uSunSize: { value: 42 },
      uStars: { value: 0 },
      uHaze: { value: 0.5 },
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
  u.uHorizon.value.setHex(blended.skyHorizon);
  u.uBottom.value.setHex(blended.skyBottom);
  u.uSunColor.value.setHex(blended.sunColor);
  u.uSunDir.value.set(blended.sunX, blended.sunZ);
  u.uSunElev.value = blended.sunElev;
  u.uSunSize.value = blended.sunSize;
  u.uStars.value = blended.starDensity;
  u.uHaze.value = blended.haze;
}

// Terrain: a single disc that follows the camera. Height is a pure function of
// world position, so there is nothing to stream and no seams where tiles would
// meet. Relief ramps with distance: flat verge, rolling mid-field, real ridges
// past a kilometre, which is what reads as a skyline rather than a wall.
const terrainVert = `
uniform float uAmp;
uniform float uRidged;
uniform float uDetail;
uniform vec3 uOffset;
varying float vHeight;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vSlope;

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
float fbm(vec2 p, int oct) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 7; i++) {
    if (i >= oct) break;
    v += a * noise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

const float VISIBLE_FLAT = 320.0;

float heightAt(vec2 w, float dist) {
  float big = fbm(w * 0.00055, 5);
  float mid = fbm(w * 0.0032, 4);
  float fine = fbm(w * 0.019, 3);

  if (uRidged > 0.5) {
    big = 1.0 - abs(big * 2.0 - 1.0);
    mid = 1.0 - abs(mid * 2.0 - 1.0);
    big = pow(big, 1.6);
  }

  float relief = (big - 0.45) * uAmp
               + (mid - 0.5) * uAmp * 0.22
               + (fine - 0.5) * uDetail;

  // The road is a level ribbon at y = 0.06, so the ground must stay BELOW that for
  // the whole visible stretch of road and only rise where the road no longer goes.
  // Any ramp starting inside the view buries the asphalt under the verge.
  float t = smoothstep(240.0, 700.0, dist);
  return -1.4 + relief * t;
}

void main() {
  vec3 p = position;
  vec2 w = p.xz + uOffset.xz;
  float dist = length(p.xz);
  float h = heightAt(w, dist);

  // Central differences for a real normal, so lighting picks out the landforms.
  float e = 3.0;
  float hx = heightAt(w + vec2(e, 0.0), dist) - heightAt(w - vec2(e, 0.0), dist);
  float hz = heightAt(w + vec2(0.0, e), dist) - heightAt(w - vec2(0.0, e), dist);
  vNormal = normalize(vec3(-hx / (2.0 * e), 1.0, -hz / (2.0 * e)));
  vSlope = length(vec2(hx, hz)) / (2.0 * e);

  p.y += h;
  vHeight = h;
  vWorld = vec3(w.x, p.y, w.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const terrainFrag = `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorRock;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uFogColor;
uniform vec3 uCamPos;
uniform float uDetail;
varying float vHeight;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vSlope;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  // Break up the flat vertex colour with two scales of noise, then blend rock in
  // on steep faces so hillsides are not a single wash.
  float n1 = vnoise(vWorld.xz * 0.06);
  float n2 = vnoise(vWorld.xz * 0.31);
  float shade = mix(0.78, 1.14, n1 * 0.6 + n2 * 0.4);

  vec3 col = mix(uColorA, uColorB, smoothstep(-40.0, 220.0, vHeight)) * shade;
  float rockness = smoothstep(0.55, 1.35, vSlope);
  col = mix(col, uColorRock * shade, rockness * 0.75);

  float light = 0.55 + 0.65 * clamp(dot(vNormal, normalize(vec3(0.45, 0.82, 0.35))), 0.0, 1.0);
  col *= light;

  float d = length(vWorld.xz - uCamPos.xz);
  float fog = smoothstep(uFogNear, uFogFar, d);
  col = mix(col, uFogColor, fog);

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createTerrain() {
  // A real polar grid, not CircleGeometry.
  //
  // CircleGeometry is a fan of segments around one centre vertex, so a 4200 m
  // disc ends up as 220 triangles each spanning the full radius. The height field
  // is then interpolated across triangles the size of a city block, which reads
  // as a warped sheet cutting through the road. This builds RINGS x SEGMENTS
  // vertices with the radius biased toward the camera: fine where the car is,
  // coarse at the horizon.
  const RINGS = 180;
  const SEGMENTS = 220;
  const R_MAX = 4200;

  const verts = [0, 0, 0];
  const idx = [];
  const radial = (k) => Math.pow(k / RINGS, 2.1) * R_MAX;

  for (let k = 1; k <= RINGS; k++) {
    const r = radial(k);
    for (let a = 0; a < SEGMENTS; a++) {
      const t = (a / SEGMENTS) * Math.PI * 2;
      verts.push(Math.cos(t) * r, 0, Math.sin(t) * r);
    }
  }

  for (let a = 0; a < SEGMENTS; a++) {
    const b = (a + 1) % SEGMENTS;
    idx.push(0, 1 + a, 1 + b);
  }
  for (let k = 1; k < RINGS; k++) {
    const inner = 1 + (k - 1) * SEGMENTS;
    const outer = 1 + k * SEGMENTS;
    for (let a = 0; a < SEGMENTS; a++) {
      const b = (a + 1) % SEGMENTS;
      idx.push(inner + a, outer + a, outer + b);
      idx.push(inner + a, outer + b, inner + b);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  geo.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
  geo.computeVertexNormals();

  const mat = new THREE.ShaderMaterial({
    vertexShader: terrainVert,
    fragmentShader: terrainFrag,
    uniforms: {
      uAmp: { value: 260 },
      uRidged: { value: 1 },
      uDetail: { value: 7 },
      uOffset: { value: new THREE.Vector3() },
      uColorA: { value: new THREE.Color(0x3f6b3a) },
      uColorB: { value: new THREE.Color(0x8fa87c) },
      uColorRock: { value: new THREE.Color(0x6b6459) },
      uFogNear: { value: 220 },
      uFogFar: { value: 2100 },
      uFogColor: { value: new THREE.Color(0xbcd8ec) },
      uCamPos: { value: new THREE.Vector3() },
    },
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.position.y = 0;
  mesh.receiveShadow = false;
  return mesh;
}

export function applyTerrain(terrain, blended, camPos) {
  const u = terrain.material.uniforms;
  u.uAmp.value = blended.terrainAmp;
  u.uRidged.value = blended.terrainRidged ? 1 : 0;
  u.uDetail.value = blended.terrainDetail;
  u.uOffset.value.set(camPos.x, 0, camPos.z);
  u.uColorA.value.setHex(blended.terrainA);
  u.uColorB.value.setHex(blended.terrainB);
  u.uColorRock.value.setHex(blended.terrainRock);
  u.uFogNear.value = blended.fogNear;
  u.uFogFar.value = blended.fogFar;
  u.uFogColor.value.setHex(blended.fogColor);
  u.uCamPos.value.set(camPos.x, camPos.y, camPos.z);
  terrain.position.x = camPos.x;
  terrain.position.z = camPos.z;
  // Follow the camera's height so the verge stays under the road when the car
  // climbs a slope instead of the ground dropping away from it.
  terrain.position.y = 0;
}
