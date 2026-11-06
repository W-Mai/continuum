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

// Integer-mixed hash. The usual sin(dot(...))*43758.5453 collapses to a constant
// once the coordinate passes a few thousand, and terrain coordinates do exactly
// that, which is why the ground had no texture at distance.
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
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
uniform float uCoastDrop;
uniform vec3 uCamPos;
uniform vec2 uRoadPoint;
varying float vHeight;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vSlope;

// Integer-mixed hash. The usual sin(dot(...))*43758.5453 collapses to a constant
// once the coordinate passes a few thousand, and terrain coordinates do exactly
// that, which is why the ground had no texture at distance.
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
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

float heightAt(vec2 w) {
  // Only long wavelengths. The road mesh samples this field every 2 m while a tile
  // samples it every 7 m, so anything finer than roughly 50 m is interpolated
  // differently by the two and the ground pushes through the asphalt. A smooth
  // field is what guarantees the road stays on top.
  float big = fbm(w * 0.00055, 4);

  if (uRidged > 0.5) {
    big = 1.0 - abs(big * 2.0 - 1.0);
    big = pow(big, 1.6);
  }

  float relief = (big - 0.45) * uAmp;

  // Everything here is a function of world position. Gating relief on distance to
  // the camera made the ground change height as the car drove, because distance to
  // the camera is not a property of the ground.
  float ground = roadElev(w) + relief * 0.55 - 1.2;

  // Sink the ground inside the road corridor. A tile's vertices are 7.3 m apart
  // while the road samples every 2 m, so on a steep biome the chord between two
  // terrain vertices sits above the asphalt even where both fields agree at every
  // sample. This is the one guarantee that holds at any sampling rate.
  float corridorDist = length(w - uRoadPoint);
  float corridorMask = 1.0 - smoothstep(7.0, 30.0, corridorDist);
  ground -= corridorMask * 2.5;

  // Coastline, also world-anchored: a fixed line of longitude, not a radius around
  // the camera.
  if (uCoastDrop > 0.001) {
    float sea = smoothstep(0.35, 1.0, fract(w.y * 0.00013 + 0.5));
    ground -= uCoastDrop * sea;
  }

  return ground;
}

void main() {
  // Each tile is its own mesh, so modelMatrix carries its world origin. Sampling
  // the height from that is what makes a tile cover fixed ground regardless of
  // where the car is.
  vec3 p = position;
  vec4 worldOrigin = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 w = p.xz + worldOrigin.xz;
  float dist = length(w - uCamPos.xz);
  float h = heightAt(w);

  // Central differences for a real normal, so lighting picks out the landforms.
  float e = 3.0;
  float hx = heightAt(w + vec2(e, 0.0)) - heightAt(w - vec2(e, 0.0));
  float hz = heightAt(w + vec2(0.0, e)) - heightAt(w - vec2(0.0, e));
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

// Integer-mixed hash. The usual sin(dot(...))*43758.5453 collapses to a constant
// once the coordinate passes a few thousand, and terrain coordinates do exactly
// that, which is why the ground had no texture at distance.
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
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
  // Four scales, all independent of the landform, so the ground carries texture
  // even where the surface is flat. Relying on vSlope left it a single wash.
  // vWorld arrives interpolated across triangles tens of metres wide near the
  // horizon, so frequencies fine enough to read as ground detail are gone before
  // the fragment. Keep the distance terms low and take the fine texture from
  // screen space, which does not interpolate.
  // Every term is a function of world position. Screen-space noise was a mistake:
  // it was pinned to the camera, so the texture slid across the ground as the car
  // moved and read as a grey film. The grid is dense enough to carry these now.
  float broad = vnoise(w * 0.009);
  float blotch = vnoise(w * 0.038);
  float grain = vnoise(w * 0.15);
  float fine = vnoise(w * 0.62);

  float v = broad * 0.30 + blotch * 0.27 + grain * 0.24 + fine * 0.19;
  return mix(0.46, 1.50, v);
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
  float jitter = (vnoise(w * 0.02) - 0.5) * 14.0;
  float band = smoothstep(-8.0 + jitter, 60.0 + jitter, rel);

  // Mix in a second colour by noise as well as by height: height banding is
  // invisible on flat ground, which is most of what is under the car.
  float tint = vnoise(w * 0.034) * 0.6 + vnoise(w * 0.13) * 0.4;
  vec3 col = mix(uColorA, uColorB, clamp(band * 0.55 + tint * 0.65, 0.0, 1.0));

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

// Terrain as a field of fixed world-space tiles.
//
// The previous version was one polar disc pinned to the camera, so the height field
// was sampled in grid-local coordinates: the same world point changed height as you
// drove, and the far edge jumped whenever the disc re-centred. Tiles are addressed
// by integer world indices, so a tile covers exactly the same ground regardless of
// where the car is, and its height is a pure function of world position.
const TILE_SIZE = 220;      // metres per tile edge
const TILE_SEGS = 30;       // quads per edge, so ~7 m resolution
const TILE_RADIUS = 5;      // tiles out from the car

function tileKey(ix, iz) {
  return ix + ',' + iz;
}

export function createTerrain() {
  const vertsPerEdge = TILE_SEGS + 1;
  const positions = new Float32Array(vertsPerEdge * vertsPerEdge * 3);
  const indices = new Uint32Array(TILE_SEGS * TILE_SEGS * 6);

  for (let r = 0; r < vertsPerEdge; r++) {
    for (let c = 0; c < vertsPerEdge; c++) {
      const i = (r * vertsPerEdge + c) * 3;
      positions[i] = (c / TILE_SEGS - 0.5) * TILE_SIZE;
      positions[i + 2] = (r / TILE_SEGS - 0.5) * TILE_SIZE;
    }
  }
  let k = 0;
  for (let r = 0; r < TILE_SEGS; r++) {
    for (let c = 0; c < TILE_SEGS; c++) {
      const a = r * vertsPerEdge + c;
      indices[k++] = a;
      indices[k++] = a + 1;
      indices[k++] = a + vertsPerEdge;
      indices[k++] = a + 1;
      indices[k++] = a + vertsPerEdge + 1;
      indices[k++] = a + vertsPerEdge;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();

  const mat = new THREE.ShaderMaterial({
    vertexShader: terrainVert,
    fragmentShader: terrainFrag,
    uniforms: {
      uAmp: { value: 260 },
      uRidged: { value: 1 },
      uDetail: { value: 7 },
      uCoastDrop: { value: 0 },
      uColorA: { value: new THREE.Color(0x3f6b3a) },
      uColorB: { value: new THREE.Color(0x8fa87c) },
      uColorRock: { value: new THREE.Color(0x6b6459) },
      uFogNear: { value: 220 },
      uFogFar: { value: 2100 },
      uFogColor: { value: new THREE.Color(0xbcd8ec) },
      uCamPos: { value: new THREE.Vector3() },
      uRoadPoint: { value: new THREE.Vector2() },
    },
    side: THREE.DoubleSide,
  });

  const group = new THREE.Group();
  group.name = 'terrain';
  group.material = mat;

  // One Mesh per tile rather than an InstancedMesh. An InstancedMesh with a custom
  // ShaderMaterial needs instanceMatrix wired by hand, and getting that wrong
  // rendered every tile stacked at the origin. Separate meshes cost 81 draw calls,
  // which is nothing, and their transforms just work.
  const TILES = (TILE_RADIUS * 2 + 1) ** 2;
  const pool = [];
  for (let i = 0; i < TILES; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.visible = false;
    group.add(m);
    pool.push(m);
  }

  group.userData = {
    pool, tiles: new Map(), free: pool.map((_, i) => TILES - 1 - i),
    TILE_SIZE, TILE_RADIUS,
  };
  return group;
}

// Place only the tiles that entered or left the window. A tile that stays keeps its
// transform untouched, so nothing shifts under the car.
function syncTiles(terrain, camPos) {
  const ud = terrain.userData;
  const { pool, tiles, free, TILE_SIZE, TILE_RADIUS } = ud;
  const cx = Math.round(camPos.x / TILE_SIZE);
  const cz = Math.round(camPos.z / TILE_SIZE);

  const wanted = new Set();
  for (let dz = -TILE_RADIUS; dz <= TILE_RADIUS; dz++) {
    for (let dx = -TILE_RADIUS; dx <= TILE_RADIUS; dx++) {
      // Round window: a square grid shows its corners at the horizon.
      if (dx * dx + dz * dz > TILE_RADIUS * TILE_RADIUS) continue;
      wanted.add(tileKey(cx + dx, cz + dz));
    }
  }

  for (const [key, mesh] of tiles) {
    if (wanted.has(key)) continue;
    mesh.visible = false;
    free.push(pool.indexOf(mesh));
    tiles.delete(key);
  }

  for (const key of wanted) {
    if (tiles.has(key)) continue;
    const slot = free.pop();
    if (slot === undefined) break;
    const parts = key.split(',');
    const mesh = pool[slot];
    mesh.position.set(Number(parts[0]) * TILE_SIZE, 0, Number(parts[1]) * TILE_SIZE);
    mesh.visible = true;
    tiles.set(key, mesh);
  }
}

export function applyTerrain(terrain, blended, camPos, car) {
  const u = terrain.material.uniforms;
  u.uAmp.value = blended.terrainAmp;
  u.uRidged.value = blended.terrainRidged ? 1 : 0;
  u.uDetail.value = blended.terrainDetail;
  u.uCoastDrop.value = blended.coastDrop || 0;
  u.uColorA.value.setHex(blended.terrainA);
  u.uColorB.value.setHex(blended.terrainB);
  u.uColorRock.value.setHex(blended.terrainRock);
  u.uFogNear.value = blended.fogNear;
  u.uFogFar.value = blended.fogFar;
  u.uFogColor.value.setHex(blended.fogColor);
  u.uCamPos.value.set(camPos.x, camPos.y, camPos.z);
  if (car) u.uRoadPoint.value.set(car.x, car.z);
  syncTiles(terrain, camPos);
}
