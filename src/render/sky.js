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

// Mirrors baseElevation() in track.js. Both are functions of world position, so
// the road mesh and this terrain cannot drift apart; changing one means changing
// both.
float roadElev(vec2 w) {
  return 16.0 * sin(w.x * 0.0035 + 0.7) * cos(w.y * 0.0031 - 1.1)
       +  7.0 * sin(w.x * 0.0105 - 2.3) * cos(w.y * 0.0091 + 0.4);
}

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

  // The land follows the same world-space elevation the road does (see
  // baseElevation in track.js). Because both sides evaluate the same expression
  // of world position, the asphalt can never float above a valley or sink into a
  // hill: the corridor is graded, and relief only grows away from it.
  float t = smoothstep(700.0, 2600.0, dist);
  return roadElev(w) - 1.1 + relief * t * 0.55;
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

// Three scales of surface variation. Patch picks out field-sized variation,
// grain gives the close-up texture that a flat colour is missing, and speckle
// adds the fine mottle that reads as ground cover from a distance.
float terrainShade(vec2 w) {
  float blotch = vnoise(w * 0.035);
  float grain = vnoise(w * 0.21);
  float speckle = vnoise(w * 1.10);
  return mix(0.80, 1.16, blotch * 0.55 + grain * 0.30 + speckle * 0.15);
}

// Rock breaks through where the ground is steep. The threshold is biased by the
// same noise as the shading so the boundary is ragged instead of a contour line.
float rockMask(vec2 w) {
  float ragged = vnoise(w * 0.09) * 0.45 + vnoise(w * 0.42) * 0.25;
  // vSlope is routinely above 1 at this amplitude, so the cut sits high; the
  // noise tears the boundary so it does not read as a contour line.
  return smoothstep(1.05 + ragged * 0.9, 2.30 + ragged * 0.9, vSlope + ragged * 0.55);
}

// A little per-fragment tilt. The vertex normal only knows the large landform, so
// without this every slope shades like a smooth ramp.
vec3 perturbNormal(vec3 n, vec2 w, float amount) {
  float e = 0.6;
  float hx = vnoise((w + vec2(e, 0.0)) * 0.55) - vnoise((w - vec2(e, 0.0)) * 0.55);
  float hz = vnoise((w + vec2(0.0, e)) * 0.55) - vnoise((w - vec2(0.0, e)) * 0.55);
  return normalize(n + vec3(-hx, 0.0, -hz) * amount);
}

void main() {
  vec2 w = vWorld.xz;
  float shade = terrainShade(w);
  float rock = rockMask(w);

  float rel = vHeight - uCamPos.y;
  float jitter = (vnoise(w * 0.02) - 0.5) * 26.0;
  float band = smoothstep(-40.0 + jitter, 120.0 + jitter, rel);

  vec3 col = mix(uColorA, uColorB, band);

  float peak = smoothstep(180.0 + jitter, 420.0 + jitter, rel);
  col = mix(col, mix(uColorRock, uColorB, 0.35), peak * 0.60);

  col = mix(col, uColorRock, rock * 0.80);
  col *= shade;

  vec3 n = perturbNormal(normalize(vNormal), w, mix(0.10, 0.55, rock));
  float light = 0.52 + 0.66 * clamp(dot(n, normalize(vec3(0.45, 0.82, 0.35))), 0.0, 1.0);
  light += 0.06 * clamp(1.0 - abs(dot(n, vec3(0.0, 1.0, 0.0))), 0.0, 1.0);
  col *= light;

  float d = length(w - uCamPos.xz);
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
