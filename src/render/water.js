// Water surface for the coastal and river biomes.
//
// A single large grid that follows the camera, displaced in the vertex shader so
// it costs nothing on the CPU. Not a physical simulation: the goal is a surface
// that reads as water at speed, with moving specular breakup and a shoreline
// fade rather than a hard edge against the beach.

import * as THREE from 'three';

const waterVert = `
uniform float uTime;
uniform float uAmp;
varying vec3 vWorld;
varying vec2 vUv;
varying float vWave;

// Two crossing swells plus a fine ripple. Frequencies are in metres so the wave
// size stays put no matter how large the grid is scaled.
float waveHeight(vec2 w, float t) {
  float h = 0.0;
  h += sin(w.x * 0.085 + t * 1.30) * cos(w.y * 0.061 - t * 0.90) * 0.55;
  h += sin(w.x * 0.190 - t * 1.85) * cos(w.y * 0.230 + t * 1.20) * 0.28;
  h += sin((w.x + w.y) * 0.470 + t * 2.60) * 0.10;
  return h;
}

void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  float t = uTime;
  float h = waveHeight(world.xz, t);
  vWave = h;
  world.y += h * uAmp;
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const waterFrag = `
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uSky;
uniform vec3 uSunDir;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uOpacity;
varying vec3 vWorld;
varying vec2 vUv;
varying float vWave;

void main() {
  // Fake a normal from the wave gradient; a real one needs the derivative of the
  // whole stack, and the difference is invisible on moving water.
  float e = 1.4;
  float t = 0.0;
  float hx = sin((vWorld.x + e) * 0.190) - sin((vWorld.x - e) * 0.190);
  float hz = cos((vWorld.z + e) * 0.230) - cos((vWorld.z - e) * 0.230);
  vec3 n = normalize(vec3(-hx * 0.35, 1.0, -hz * 0.35));

  vec3 viewDir = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);

  float depth = clamp(vWave * 0.6 + 0.5, 0.0, 1.0);
  vec3 col = mix(uShallow, uDeep, depth);

  // Sky reflection at grazing angles. Capped hard: a bright sky driven at full
  // strength turns the whole sea into a white sheet, which is what made the
  // coast look like a snowfield rather than water.
  col = mix(col, uSky * 0.55, fres * 0.30);

  // Specular sun glitter, tight enough to sparkle instead of washing out.
  vec3 h = normalize(viewDir + normalize(uSunDir));
  float spec = pow(max(dot(n, h), 0.0), 220.0);
  col += spec * 0.35;

  float d = length(vWorld.xz - cameraPosition.xz);
  float fog = smoothstep(uFogNear, uFogFar, d);
  col = mix(col, uFogColor, fog);

  // Water is opaque everywhere it exists. Fading it out near the road left the
  // terrain visible underneath, and because the beach is graded down toward the
  // sea that gap showed sky. The shoreline comes from the terrain dropping below
  // sea level instead, which needs no alpha trick.
  gl_FragColor = vec4(col, uOpacity);
}
`;

export function createWater() {
  // Dense enough near the camera to show waves, coarse at the horizon. A plain
  // plane would either be enormous or visibly faceted.
  const geo = new THREE.PlaneGeometry(3000, 3000, 120, 120);
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.ShaderMaterial({
    vertexShader: waterVert,
    fragmentShader: waterFrag,
    transparent: true,
    uniforms: {
      uTime: { value: 0 },
      uAmp: { value: 1.0 },
      uShallow: { value: new THREE.Color(0x3f8fa8) },
      uDeep: { value: new THREE.Color(0x123a52) },
      uSky: { value: new THREE.Color(0xcfe4f0) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.6) },
      uFogColor: { value: new THREE.Color(0xc2dae4) },
      uFogNear: { value: 200 },
      uFogFar: { value: 2200 },
      uOpacity: { value: 0.9 },
    },
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  // Drawn after the road so the transparency sorts against it correctly.
  mesh.renderOrder = 2;
  return mesh;
}

export function applyWater(water, blended, camPos, time) {
  const u = water.material.uniforms;
  u.uTime.value = time;
  u.uAmp.value = blended.waterAmp !== undefined ? blended.waterAmp : 1.0;
  if (blended.waterShallow !== undefined) u.uShallow.value.setHex(blended.waterShallow);
  if (blended.waterDeep !== undefined) u.uDeep.value.setHex(blended.waterDeep);
  u.uSky.value.setHex(blended.skyBottom !== undefined ? blended.skyBottom : 0xcfe4f0);
  u.uFogColor.value.setHex(blended.fogColor !== undefined ? blended.fogColor : 0xc2dae4);
  u.uFogNear.value = blended.fogNear !== undefined ? blended.fogNear : 200;
  u.uFogFar.value = blended.fogFar !== undefined ? blended.fogFar : 2200;

  // The water level has to be relative to the road, not an absolute height: the
  // world is graded, so a fixed level either floods every valley or hovers above
  // every crest. Sea level is a fixed drop below the carriageway at the player's
  // own position, which is what a coast road actually is.
  const seaY = (blended.roadElevAtPlayer !== undefined ? blended.roadElevAtPlayer : 0)
    - (blended.waterLevel !== undefined ? Math.abs(blended.waterLevel) : 3.2);
  water.position.set(camPos.x, seaY, camPos.z);

  const visible = (blended.waterPresent || 0) > 0.02;
  water.visible = visible;
  u.uOpacity.value = Math.min(0.92, (blended.waterPresent || 0) * 0.92);
}
