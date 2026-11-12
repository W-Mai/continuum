// Terrain: a quadtree of tiles baked on the CPU from the land the road has
// shaped (corridor.js). Heights, normals, sun visibility and ambient occlusion
// are computed once per tile, so the GPU only shades. Near tiles are 2 m apart,
// the far ring 64 m, and the horizon is 6 km out.
//
// The material layers grass, scree, rock and snow by slope and altitude, puts
// raw rock wherever the road cut into the hill, gravel along the verge, and
// shades rock with a triplanar detail map so cliffs are not smeared texture.

import * as THREE from 'three';
import { withAtmosphere } from './atmosphere.js';
import { worldUniforms, WORLD_GLSL, PAL } from './worldlook.js';
import { REACH, TUNNEL_H } from '../world/corridor.js';
import { HALF_FLAT } from '../world/road.js';
import { bakeLand, landBox, LAND_LEVELS, LAND_RES, LAND_EDGES } from '../world/bakery.js';
import { FOREST_FAR } from './forest.js';

const RES = LAND_RES;
const MAX_PORTALS = 8;
const LEVELS = LAND_LEVELS;
const TOP = LEVELS.length - 1;

// --- detail texture -----------------------------------------------------------

function tileableNoise(size, cells, seed) {
  // Value noise on a lattice that wraps, so the texture tiles seamlessly.
  const g = new Float32Array(cells * cells);
  let s = seed >>> 0;
  for (let i = 0; i < g.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    g[i] = s / 4294967296;
  }
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells;
    const y0 = Math.floor(fy);
    let ty = fy - y0;
    ty = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const x0 = Math.floor(fx);
      let tx = fx - x0;
      tx = tx * tx * (3 - 2 * tx);
      const a = g[(y0 % cells) * cells + (x0 % cells)];
      const b = g[(y0 % cells) * cells + ((x0 + 1) % cells)];
      const c = g[((y0 + 1) % cells) * cells + (x0 % cells)];
      const d = g[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
      out[y * size + x] = (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
    }
  }
  return out;
}

function makeDetailTexture() {
  const N = 512;
  const oct = (cellsList, seeds, gains) => {
    const acc = new Float32Array(N * N);
    let norm = 0;
    cellsList.forEach((c, i) => {
      const n = tileableNoise(N, c, seeds[i]);
      for (let k = 0; k < acc.length; k++) acc[k] += n[k] * gains[i];
      norm += gains[i];
    });
    for (let k = 0; k < acc.length; k++) acc[k] /= norm;
    return acc;
  };
  // R: rock albedo (blocky strata + grain), G: vegetation mottle, A: rock height.
  const rock = oct([8, 16, 32, 64, 128], [11, 12, 13, 14, 15], [1, 0.55, 0.35, 0.22, 0.14]);
  const veg = oct([16, 32, 64, 128, 256], [21, 22, 23, 24, 25], [1, 0.7, 0.5, 0.35, 0.25]);
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const k = y * N + x;
      const hx = rock[y * N + ((x + 1) % N)] - rock[y * N + ((x + N - 1) % N)];
      const hy = rock[((y + 1) % N) * N + x] - rock[((y + N - 1) % N) * N + x];
      // Ridged strata read as layered rock rather than cloud.
      const strata = 1 - Math.abs(Math.sin(rock[k] * 18.0));
      data[k * 4] = Math.max(0, Math.min(255, (rock[k] * 0.7 + strata * 0.3) * 255));
      data[k * 4 + 1] = Math.max(0, Math.min(255, veg[k] * 255));
      data[k * 4 + 2] = Math.max(0, Math.min(255, 128 + hx * 900));
      data[k * 4 + 3] = Math.max(0, Math.min(255, 128 + hy * 900));
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

// --- material ---------------------------------------------------------------

export function makeTerrainMaterial(land, look) {
  const detail = makeDetailTexture();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  // Ground colours, snow and tree lines come per pixel from the world
  // palette (render/worldlook.js): a tile can straddle a border.
  const uniforms = {
    uDetail: { value: detail },
    uOffset: { value: new THREE.Vector2() },
    // The mouths of the tunnels nearest the camera (TerrainField.setPortals):
    // x, z, and the way out of the bore; and the road's height there.
    uPortal: { value: Array.from({ length: MAX_PORTALS }, () => new THREE.Vector4()) },
    uPortalY: { value: new Array(MAX_PORTALS).fill(0) },
    uPortals: { value: 0 },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, worldUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 aShade;
attribute vec3 aSurf;
varying vec3 vShade;
varying vec3 vSurf;
varying vec3 vTPos;
varying vec3 vTNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vShade = aShade;
vSurf = aSurf;
vTPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTNormal = normalize(mat3(modelMatrix) * objectNormal);`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uDetail;
uniform vec2 uOffset;
uniform vec4 uPortal[${MAX_PORTALS}];
uniform float uPortalY[${MAX_PORTALS}];
uniform int uPortals;
${WORLD_GLSL}
varying vec3 vShade;
varying vec3 vSurf;
varying vec3 vTPos;
varying vec3 vTNormal;
float tSunVis;
float tCanopy;
float tCrev;
vec3 tDetailNormal;

vec4 triplanar(vec3 p, vec3 w, float scale) {
  vec4 a = texture2D(uDetail, p.zy * scale);
  vec4 b = texture2D(uDetail, p.xz * scale);
  vec4 c = texture2D(uDetail, p.xy * scale);
  return a * w.x + b * w.y + c * w.z;
}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
// Under the road's own platform the asphalt and the verge are the ground.
// The land, drawn on a 2 m grid, cannot follow the crease at the foot of a
// cut; left in, it pokes through the gravel in teeth.
if (vSurf.z < ${(HALF_FLAT - 0.05).toFixed(2)}) discard;
// The mouth of a tunnel: the land's height cannot step straight from the
// road up to the hill over the bore, so its face would hang across the
// opening. It is cut away there, from just above the road to over the
// vault; the portal's headwall stands over the edges of the cut.
for (int k = 0; k < ${MAX_PORTALS}; k++) {
  if (k >= uPortals) break;
  vec4 P = uPortal[k];
  vec2 d = vTPos.xz - P.xy;
  float along = dot(d, P.zw);
  float lat = dot(d, vec2(-P.w, P.z));
  float up = vTPos.y - uPortalY[k];
  if (abs(lat) < 6.0 && along > -4.5 && along < 3.0 && up > 0.3 && up < ${(TUNNEL_H + 1.4).toFixed(1)}) discard;
}
vec3 wp = vTPos + vec3(uOffset.x, 0.0, uOffset.y);
// This pixel's world, and the one it is turning into. uOffset wraps to keep
// texture coordinates small, so the world is found from the true origin.
worldAt(vTPos.xz + uWorldOrigin);
vec3 uGrassLow = worldPal(${PAL.grassLow});
vec3 uGrassHigh = worldPal(${PAL.grassHigh});
vec3 uRock = worldPal(${PAL.rock});
vec3 uRockDark = worldPal(${PAL.rockDark});
vec3 uScree = worldPal(${PAL.scree});
vec3 uSnow = worldPal(${PAL.snow});
vec3 uGravel = worldPal(${PAL.gravel});
vec3 uFill = worldPal(${PAL.fill});
vec3 uForestFloor = worldPal(${PAL.forestFloor});
vec3 uCanopy = worldPal(${PAL.canopy});
vec3 uSand = worldPal(${PAL.sand});
vec4 wP0 = worldPar(0);
vec4 wP1 = worldPar(1);
float uSnowLine = wP0.x;
float uTreeLine = wP0.y;
float wWater = wP0.z;
float wHasWater = worldWet();
float wVeg = wP1.x;
float wShore = wP1.y;
float wStrata = wP1.z;
vec3 wn = normalize(vTNormal);
vec3 tw = pow(abs(wn), vec3(4.0));
tw /= (tw.x + tw.y + tw.z);
float slope = 1.0 - clamp(wn.y, 0.0, 1.0);
float alt = vTPos.y;
float dist = length(vTPos - cameraPosition);
float forest = vShade.z;

vec4 dN = triplanar(wp, tw, 1.0 / 23.0);
vec4 dF = triplanar(wp, tw, 1.0 / 211.0);
vec4 dM = texture2D(uDetail, wp.xz / 1400.0);
vec4 dG = texture2D(uDetail, wp.xz / 4.7);
float vegN = mix(dN.g, dF.g, smoothstep(60.0, 400.0, dist));
float nearCam = 1.0 - smoothstep(18.0, 90.0, dist);

// Weights, each broken up by noise so no boundary is a contour line. Rock
// shows from about 43 degrees, scree above the tree line from about 26.
// Turf breaks off at a crag along a ragged but sharp edge: the noise decides
// where, and the screen derivative keeps the edge about a pixel soft so it
// does not shimmer. Far away, where the noise has mipped out, the edge widens
// again and the broad noise takes over the raggedness.
float farW = smoothstep(300.0, 2000.0, dist);
float rockH = slope + (dF.r - 0.44) * 0.3 + (dM.g - 0.49) * mix(0.16, 0.4, farW) + (dN.r - 0.44) * 0.16;
float rockAA = max(fwidth(rockH) * 1.2, mix(0.008, 0.035, farW));
float rockW = smoothstep(0.265 - rockAA, 0.265 + rockAA, rockH);
rockW = max(rockW, smoothstep(1.2, 4.0, vSurf.x));          // fresh road cuts
float high = smoothstep(uTreeLine - 120.0, uTreeLine + 160.0, alt + (dM.r - 0.5) * 220.0);
float screeW = smoothstep(0.10, 0.19, slope + (dN.g - 0.5) * 0.12) * (1.0 - rockW) * high;
float snowW = smoothstep(uSnowLine - 70.0, uSnowLine + 40.0, alt + (dF.g - 0.5) * 160.0 + (dM.r - 0.5) * 120.0)
  * (1.0 - smoothstep(0.30, 0.48, slope));
float vergeW = (1.0 - smoothstep(6.0, 7.4, vSurf.z + (dN.g - 0.5) * 1.6)) * (1.0 - snowW);
float fillW = smoothstep(0.4, 2.0, vSurf.y) * (1.0 - smoothstep(9.0, 30.0, vSurf.z));

// Meadow: greener low down, drier and more olive toward the tree line, in
// patches at two scales, mottled near the camera, stony where it steepens.
vec3 grass = mix(uGrassLow, uGrassHigh, smoothstep(40.0, 560.0, alt + (dM.g - 0.5) * 260.0));
// Drier, paler swards and lusher, darker ones, tens of metres across. The
// thresholds sit on the noise's own spread, so each covers about a quarter
// of the meadow; whole hillsides shift cooler at the larger scale. On bare
// sand (wVeg 0) the same patches are only lighter and darker.
float dry = smoothstep(0.5, 0.64, dF.g);
float lush = 1.0 - smoothstep(0.33, 0.45, dF.g);
grass = mix(grass, grass * mix(vec3(1.07), vec3(1.15, 1.06, 0.74), wVeg), dry * 0.6);
grass = mix(grass, grass * mix(vec3(0.9), vec3(0.76, 0.88, 0.72), wVeg), lush * 0.5);
grass = mix(grass, grass * mix(vec3(0.93), vec3(0.8, 0.9, 0.85), wVeg), smoothstep(0.48, 0.66, dM.r) * 0.5);
grass *= 0.78 + 0.44 * vegN;
grass *= mix(1.0, 0.78 + 0.44 * dG.g, nearCam);
// Lusher and darker in hollows and gullies, where water collects; paler and
// drier on the spurs between them.
float hollow = clamp((0.9 - vShade.y) * 2.2, 0.0, 1.0);
grass = mix(grass * mix(vec3(1.03), vec3(1.06, 1.03, 0.9), wVeg), grass * mix(vec3(0.9), vec3(0.78, 0.92, 0.74), wVeg), hollow);
// Where it steepens toward rock, thinner and more olive turf; the stones
// themselves are the outcrops below, not a grey wash over the grass.
grass = mix(grass, mix(uScree * 0.72, uGrassHigh * 0.62, 0.45 + 0.4 * dN.g), smoothstep(0.1, 0.26, slope) * 0.35);
// Rocks breaking through the turf where it steepens toward the crags, in
// clusters, the same stone as the crags; none on the open meadow and none
// on fill the road builders laid. The mask is a blurred sample so they are
// compact blocks rather than lace, sharp edged, with the turf a little darker
// just around them where they shade it.
float oN = texture2D(uDetail, wp.xz / 19.0, 2.0).r;
float oH = oN * 0.7 + dF.r * 0.3 + smoothstep(0.1, 0.26, slope) * 0.3 + (dM.r - 0.44) * 0.3 - 0.06;
float oAA = max(fwidth(oH) * 1.2, 0.006);
float onCut = 1.0 - smoothstep(1.2, 4.0, vSurf.x);
float outcrop = smoothstep(0.65 - oAA, 0.65 + oAA, oH) * onCut;
grass *= 1.0 - 0.15 * smoothstep(0.61, 0.65, oH) * (1.0 - outcrop) * onCut;

vec3 rock = mix(uRockDark, uRock, 0.3 + 0.5 * dN.r + 0.2 * dF.r);
rock *= 0.82 + 0.3 * dM.r;
// Cliff bands: beds tens of metres thick, each its own tone, warm ochre or
// cool grey, so a mountain face reads as a stack of limestone and not as one
// grey sheet. The beds are gently folded, rising and falling by a few tens
// of metres over a kilometre so they dip across a face, and no two are the
// same thickness. Every few beds is a softer, darker marl. The bedding shows
// fully only on real cliffs: on a broken slope debris covers it, and there
// the bands would only trace the contour lines.
float bedShow = 0.3 + 0.7 * max(smoothstep(0.3, 0.5, slope), smoothstep(1.2, 4.0, vSurf.x));
float fold = texture2D(uDetail, wp.xz / 5200.0 + 0.37).r;
float bedY = wp.y + (fold - 0.44) * 200.0 + (dM.g - 0.49) * 40.0;
float bandN = bedY / 29.0 + texture2D(uDetail, vec2(bedY / 2600.0, 0.71)).g * 5.0 + dF.r * 1.2;
float bedRand = fract(sin(floor(bandN) * 78.233) * 43758.5453);
float bandF = fract(bandN);
float marl = step(0.74, bedRand);
vec3 bedTone = mix(vec3(0.92, 0.93, 0.97), vec3(1.1, 1.0, 0.85), fract(bedRand * 7.13)) * (0.88 + 0.24 * fract(bedRand * 3.71));
bedTone = mix(bedTone, bedTone * vec3(0.86, 0.83, 0.8), marl);
bedTone *= 0.9 + 0.14 * smoothstep(0.0, 0.5, bandF);   // each bed darker at its foot
// How strongly a world's rock is bedded: faint in the hills, strong in the
// desert's sandstone.
bedTone = mix(vec3(1.0), bedTone, wStrata);
rock *= mix(vec3(1.0), bedTone, bedShow);
// Bedding planes: bands a few metres apart, folded with the beds. They fade
// out with distance, where they would alias into scan lines; close up, a
// finer grain and thinner beds, which is what a fresh road cut shows.
float strata = sin(bedY * 0.42 + dF.r * 9.0 + dM.g * 5.0) * 0.5 + 0.5;
rock *= mix(1.0, 0.84 + 0.26 * strata * strata, bedShow * (1.0 - smoothstep(250.0, 1200.0, dist)));
// Crevices: the same detail darkens the sky light in the cracks between
// blocks, which is what keeps a rock face in shade from reading as plaster.
float crev = 0.7 + 0.45 * dN.r;
float fineW = 1.0 - smoothstep(30.0, 140.0, dist);
if (fineW > 0.0) {
  vec4 dR = triplanar(wp, tw, 1.0 / 5.5);
  float beds = sin(bedY * 2.1 + dR.r * 5.0 + dN.r * 3.0) * 0.5 + 0.5;
  rock *= mix(1.0, (0.78 + 0.34 * dR.r) * (0.88 + 0.2 * beds), fineW);
  crev *= mix(1.0, 0.62 + 0.5 * smoothstep(0.2, 0.75, dR.r) * (0.7 + 0.3 * beds), fineW);
}
tCrev = mix(1.0, min(crev, 1.0), rockW);
// Water streaks: dark stains running down the natural faces, stretched ten
// times along the fall line. Fresh road cuts have not weathered yet.
float stX = texture2D(uDetail, vec2(wp.z / 9.0, wp.y / 95.0)).r;
float stZ = texture2D(uDetail, vec2(wp.x / 9.0, wp.y / 95.0)).r;
float streak = mix(stZ, stX, tw.x / max(tw.x + tw.z, 1e-3));
rock *= 1.0 - smoothstep(0.3, 0.55, slope) * 0.4 * smoothstep(0.45, 0.72, streak) * (1.0 - smoothstep(1.2, 4.0, vSurf.x));
rock *= 1.0 + 0.22 * smoothstep(1.2, 6.0, vSurf.x);
rock = mix(rock, rock * vec3(1.05, 0.98, 0.9), smoothstep(1.2, 6.0, vSurf.x));
vec3 scree = uScree * (0.85 + 0.3 * dN.r);
vec3 snow = uSnow * (0.93 + 0.07 * dN.g);
// Under the spruce near the camera, needles and moss in the trees' shade;
// past the instanced trees, the canopy itself.
vec3 floorCol = mix(uForestFloor, uGrassLow * 0.6, dN.g * 0.5) * (0.75 + 0.3 * dG.g * nearCam);
float canopyW = smoothstep(${(FOREST_FAR - 380).toFixed(1)}, ${(FOREST_FAR - 60).toFixed(1)}, dist);
vec3 canopy = uCanopy * (0.72 + 0.4 * dF.g) * (0.85 + 0.3 * vegN);
tCanopy = smoothstep(0.08, 0.5, forest) * canopyW * (1.0 - rockW);

vec3 col = grass;
col = mix(col, scree, screeW);
col = mix(col, uFill * (0.85 + 0.3 * dN.g), fillW * 0.8);
col = mix(col, floorCol, smoothstep(0.08, 0.45, forest) * (1.0 - canopyW) * 0.92);
col = mix(col, rock * 0.95, outcrop * (1.0 - fillW) * 0.9);
col = mix(col, rock, rockW);
// Ledges on natural cliffs: the top of each bed holds turf below the tree
// line and scree above it, wider on the marl. Only on a real face: on a
// broken slope they would make stripes along the contours.
float ledgeH = bandF + (dN.g - 0.49) * 0.1 + mix(0.0, 0.16, marl);
// (the derivative of the unwrapped phase, so the seam between beds is clean)
float ledgeAA = max(fwidth(bandN + dN.g * 0.1) * 1.2, 0.01);
float ledgeW = smoothstep(0.9 - ledgeAA, 0.9 + ledgeAA, ledgeH)
  * smoothstep(0.3, 0.42, slope) * (1.0 - smoothstep(0.55, 0.78, slope)) * rockW * onCut;
col = mix(col, mix(grass * 0.9, scree, high), ledgeW * 0.85);
col = mix(col, canopy, tCanopy);
// Shores: a band of sand above the water line, and below it the ground wet
// and dark under the water.
if (wHasWater > 0.01) {
  float shoreH = alt - wWater + (dN.g - 0.5) * 0.8 + (dF.r - 0.5) * 1.4;
  float sandW = (1.0 - smoothstep(wShore * 0.7, wShore + 0.6, shoreH)) * (1.0 - rockW * 0.6) * wHasWater;
  col = mix(col, uSand * (0.88 + 0.24 * dN.g) * (0.92 + 0.12 * dG.g * nearCam), sandW);
  col *= mix(1.0, 0.6, (1.0 - smoothstep(-0.5, 0.15, shoreH)) * wHasWater);
}
// Broad albedo variation, strongest far away where detail has mipped out:
// whole hillsides a little lighter or darker, as soil and cover change.
col *= mix(1.0, 0.74 + 0.5 * dM.g * (0.6 + 0.8 * dF.r), smoothstep(200.0, 1500.0, dist));
col = mix(col, uGravel * (0.85 + 0.3 * dN.g), vergeW);
col = mix(col, snow, snowW);
diffuseColor.rgb = col;

// Detail normal: tree-scale bumps strong on rock and faint on grass, plus a
// broad undulation everywhere so a meadow is not a sheet; none on snow.
vec2 dnN = (vec2(dN.b, dN.a) - 0.5) * 2.0;
vec2 dnF = (vec2(dF.b, dF.a) - 0.5) * 2.0;
vec2 dn = dnN * mix(0.3, 1.4, max(rockW, outcrop)) * (1.0 - smoothstep(150.0, 900.0, dist)) + dnF * 0.45;
dn *= 1.0 - snowW * 0.8;
tDetailNormal = normalize(wn + vec3(dn.x, 0.0, dn.y));
tSunVis = vShade.x;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(0.97, 0.86, rockW);
roughnessFactor = mix(roughnessFactor, 0.55, snowW);
roughnessFactor = mix(roughnessFactor, 1.0, tCanopy);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize((viewMatrix * vec4(tDetailNormal, 0.0)).xyz);`)
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
        'getDirectionalLightInfo( directionalLight, directLight );',
        // Sun past the ridges, and only on ground that really faces it: the
        // detail normal may tilt a shaded wall toward the sun, but the wall
        // itself still has its back to it (and the shadow map is unreliable
        // that close to grazing).
        `getDirectionalLightInfo( directionalLight, directLight );
\t\tdirectLight.color *= tSunVis * smoothstep( -0.02, 0.22, dot( normalize( vNormal ), directLight.direction ) );`,
      ))
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
reflectedLight.indirectDiffuse *= vShade.y * tCrev;
reflectedLight.indirectSpecular *= vShade.y;`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
#ifdef TERRAIN_DEBUG
gl_FragColor = vec4(vShade.x, vShade.y * 0.5, clamp(vSurf.z / 44.0, 0.0, 1.0), 1.0);
if (any(isnan(diffuseColor.rgb))) gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
#endif`);
    if (land.debug) shader.defines = { ...(shader.defines || {}), TERRAIN_DEBUG: 1 };
  };
  mat.customProgramCacheKey = () => 'continuum-terrain';
  return withAtmosphere(mat);
}

// --- tiles --------------------------------------------------------------------

export class TerrainField {
  constructor(scene, land, corridor, look, opts = {}) {
    this.land = land;
    this.corridor = corridor;
    this.veg = opts.vegetation || null;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    this.material = makeTerrainMaterial(land, look);
    this.sunDir = new THREE.Vector3(0.5, 0.5, 0.5).normalize();
    this.tiles = new Map();      // key -> tile
    this.rendered = new Set();
    this.queue = [];
    this.origin = { x: 0, z: 0 };
    this.detail = 1;             // scales how near a tile splits (setDetail)
    this.budgetMs = opts.budgetMs || 4;
    this.generated = 0;
    this.buried = 0;             // tiles left empty under cloud or lava
    this.indexCache = new Map();
    this.baking = null;          // the tile being baked over several frames
    // Tiles to bake again (the land or the road under them changed, see
    // markStale): drawn as they are until the new one is ready. Not while
    // holdStale, when the road they are to be carved by is still being laid.
    this.stale = new Set();
    this.holdStale = false;
    // Workers that bake tiles off the page (render/bakers.js), once they are
    // up; until then, and in headless runs, the page bakes them itself.
    this.bakers = null;
    this.env = { land, corridor, veg: this.veg };
    this.inflight = new Map();   // key -> id of the job out for it
    this.done = [];              // { k, l, i, j, id, r }: jobs back, meshes to build
  }

  // Mark the tiles test(x0, z0, size) picks (absolute corner, metres) to be
  // baked again, the one in the oven and the ones out in a worker included.
  markStale(test) {
    for (const [k, mesh] of this.tiles) {
      const { x0, z0, level } = mesh.userData;
      if (test(x0, z0, LEVELS[level])) this.stale.add(k);
    }
    for (const k of [...this.inflight.keys()]) {
      const [l, i, j] = k.split(':').map(Number);
      if (test(i * LEVELS[l], j * LEVELS[l], LEVELS[l])) this.inflight.delete(k);
    }
    if (this.baking) {
      const s = LEVELS[this.baking.l];
      if (test(this.baking.i * s, this.baking.j * s, s)) this.baking = null;
    }
  }

  setSun(dir) {
    this.sunDir.copy(dir).normalize();
  }

  key(level, ix, iz) {
    return level + ':' + ix + ':' + iz;
  }

  // How fine the land is drawn (1 at full quality): a tile splits into
  // finer ones within 1.15 * detail of its own size from the camera.
  setDetail(f) {
    this.detail = f;
  }

  // Which tiles should be drawn for a camera at absolute (cx, cz).
  _select(cx, cz) {
    const want = [];
    const size = LEVELS[TOP];
    const rx = Math.floor(cx / size);
    const rz = Math.floor(cz / size);
    const visit = (level, ix, iz) => {
      const s = LEVELS[level];
      const x0 = ix * s;
      const z0 = iz * s;
      const dx = Math.max(x0 - cx, 0, cx - (x0 + s));
      const dz = Math.max(z0 - cz, 0, cz - (z0 + s));
      const d = Math.hypot(dx, dz);
      if (level > 0 && d < s * 1.15 * this.detail) {
        for (let j = 0; j < 2; j++) {
          for (let i = 0; i < 2; i++) visit(level - 1, ix * 2 + i, iz * 2 + j);
        }
      } else if (d < 6500) {
        want.push([level, ix, iz]);
      }
    };
    for (let j = -2; j <= 2; j++) {
      for (let i = -2; i <= 2; i++) visit(TOP, rx + i, rz + j);
    }
    return want;
  }

  // Bake one tile. Heights come from the natural land shaped by the road;
  // everything the shader needs per vertex is computed here, once. A
  // generator, so a tile can be baked over several frames (update() resumes
  // it within the frame budget); _build() runs it to the end in one go.
  _build(level, ix, iz) {
    const gen = this._bake(level, ix, iz);
    let r = gen.next();
    while (!r.done) r = gen.next();
    return r.value;
  }

  // Bake one tile on the page, a slice at a time (world/bakery.js), then
  // build its mesh.
  *_bake(level, ix, iz) {
    const [bx, bz, bs, bb] = landBox(level, ix, iz);
    const ctx = this.corridor.prepare(bx, bz, bs, bb);
    yield;
    const r = yield* bakeLand(this.env, level, ix, iz, ctx, this.sunDir);
    return this._mesh(level, ix, iz, r);
  }

  // Send one tile out to the workers (render/bakers.js). What comes back is
  // built in update(), if the job is still the one out for that tile:
  // markStale() and invalidate() forget a job whose tile is to change.
  _send(level, ix, iz, k) {
    const ctx = this.corridor.prepare(...landBox(level, ix, iz));
    const s = this.sunDir;
    const job = { type: 'land', level, ix, iz, ctx, sun: { x: s.x, y: s.y, z: s.z } };
    const id = this.bakers.post(job, [ctx.seg.buffer, ctx.bStart.buffer, ctx.bIds.buffer],
      (r) => this.done.push({ k, l: level, i: ix, j: iz, id, r }));
    if (id) this.inflight.set(k, id);
  }

  // A tile's mesh from its baked arrays, however they were baked.
  _mesh(level, ix, iz, r) {
    const size = LEVELS[level];
    const x0 = ix * size;
    const z0 = iz * size;
    if (r.buried) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
      mesh.visible = false;
      mesh.matrixAutoUpdate = false;
      mesh.userData = { level, ix, iz, x0, z0, buried: true };
      this.buried++;
      return mesh;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(r.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(r.nrm, 3));
    geo.setAttribute('aShade', new THREE.BufferAttribute(r.shade, 3));
    geo.setAttribute('aSurf', new THREE.BufferAttribute(r.surf, 3));
    geo.setIndex(this._indices());
    geo.boundingBox = new THREE.Box3(
      new THREE.Vector3(0, r.hmin - r.drop, 0), new THREE.Vector3(size, r.hmax, size),
    );
    geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());

    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = true;
    mesh.castShadow = level === 0;
    mesh.matrixAutoUpdate = false;
    mesh.userData = { level, ix, iz, x0, z0 };
    this.generated++;
    return mesh;
  }

  // The one index every tile shares: the grid, and the skirts in the order
  // bakeLand lays them (LAND_EDGES).
  _indices() {
    const key = 'i';
    if (this.indexCache.has(key)) return this.indexCache.get(key);
    const N = RES + 1;
    const idx = [];
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const a = j * N + i;
        idx.push(a, a + N, a + 1, a + 1, a + N, a + N + 1);
      }
    }
    LAND_EDGES.forEach(([ia, ja, di, dj], e) => {
      const start = N * N + e * N;
      for (let t = 0; t < RES; t++) {
        const e0 = (ja + dj * t) * N + (ia + di * t);
        const e1 = (ja + dj * (t + 1)) * N + (ia + di * (t + 1));
        const s0 = start + t;
        const s1 = start + t + 1;
        idx.push(e0, s0, e1, e1, s0, s1);
        idx.push(e0, e1, s0, e1, s1, s0);
      }
    });
    const attr = new THREE.BufferAttribute(new Uint32Array(idx), 1);
    this.indexCache.set(key, attr);
    return attr;
  }

  _place(mesh) {
    mesh.position.set(mesh.userData.x0 - this.origin.x, 0, mesh.userData.z0 - this.origin.z);
    mesh.updateMatrix();
  }

  setOrigin(x, z) {
    this.origin.x = x;
    this.origin.z = z;
    for (const t of this.tiles.values()) this._place(t);
    const u = this.material.userData.uniforms;
    // Texture coordinates in absolute space, wrapped to keep them small.
    u.uOffset.value.set(x % 8192, z % 8192);
  }

  // The tunnel mouths to cut the land away at: the nearest MAX_PORTALS of
  // them, as { x, z, ox, oz, y } in absolute coordinates, (ox, oz) the way
  // out of the bore and y the road's height at the portal.
  setPortals(list) {
    const u = this.material.userData.uniforms;
    const n = Math.min(MAX_PORTALS, list.length);
    for (let k = 0; k < n; k++) {
      const p = list[k];
      u.uPortal.value[k].set(p.x - this.origin.x, p.z - this.origin.z, p.ox, p.oz);
      u.uPortalY.value[k] = p.y;
    }
    u.uPortals.value = n;
  }

  // Bring the drawn set up to date. Tiles still being built are covered by
  // whatever was drawn there before (an ancestor, or the old children), so
  // there is never a hole.
  update(camAbsX, camAbsZ, sync = false) {
    const want = this._select(camAbsX, camAbsZ);
    const missing = [];
    const ready = (k) => this.tiles.has(k) && (this.holdStale || !this.stale.has(k));
    for (const [l, i, j] of want) {
      if (!ready(this.key(l, i, j))) missing.push([l, i, j]);
    }
    // Coarse first: they cover the most ground for the least work.
    missing.sort((a, b) => b[0] - a[0]
      || Math.hypot((a[1] + 0.5) * LEVELS[a[0]] - camAbsX, (a[2] + 0.5) * LEVELS[a[0]] - camAbsZ)
      - Math.hypot((b[1] + 0.5) * LEVELS[b[0]] - camAbsX, (b[2] + 0.5) * LEVELS[b[0]] - camAbsZ));
    const t0 = performance.now();
    const add = (l, i, j, mesh) => {
      const k = this.key(l, i, j);
      const old = this.tiles.get(k);
      if (old) {
        this.group.remove(old);
        old.geometry.dispose();
        if (old.userData.buried) this.buried--;
      }
      this.stale.delete(k);
      this._place(mesh);
      this.tiles.set(k, mesh);
      this.group.add(mesh);
    };
    if (sync) {
      this.baking = null;
      for (const [l, i, j] of missing) add(l, i, j, this._build(l, i, j));
    } else if (this.bakers && this.bakers.ready) {
      // In the workers: here only the meshes are built from what comes
      // back, while the frame's budget lasts, and more tiles sent out, as
      // many as the workers have room for, coarse first.
      this.baking = null;
      const keys = new Set(missing.map(([l, i, j]) => this.key(l, i, j)));
      while (this.done.length && performance.now() - t0 < this.budgetMs) {
        const d = this.done.shift();
        if (this.inflight.get(d.k) !== d.id) continue;
        this.inflight.delete(d.k);
        if (keys.has(d.k) && !ready(d.k)) add(d.l, d.i, d.j, this._mesh(d.l, d.i, d.j, d.r));
      }
      for (const [l, i, j] of missing) {
        if (!this.bakers.free) break;
        const k = this.key(l, i, j);
        if (!this.inflight.has(k) && !ready(k)) this._send(l, i, j, k);
      }
    } else {
      // No workers (yet, or any more): whatever was out with them is baked
      // here.
      this.inflight.clear();
      this.done.length = 0;
      // One tile at a time, a slice at a time, until the frame's budget is
      // spent: a near tile takes 5-10 ms to bake, more than a frame can give.
      // A tile nobody wants any more is dropped half-baked.
      if (this.baking && !want.some(([l, i, j]) => this.key(l, i, j) === this.baking.key)) this.baking = null;
      let next = 0;
      while (performance.now() - t0 < this.budgetMs) {
        if (!this.baking) {
          while (next < missing.length && ready(this.key(...missing[next]))) next++;
          if (next >= missing.length) break;
          const [l, i, j] = missing[next++];
          this.baking = { key: this.key(l, i, j), l, i, j, gen: this._bake(l, i, j) };
        }
        const r = this.baking.gen.next();
        if (r.done) {
          const { l, i, j } = this.baking;
          add(l, i, j, r.value);
          this.baking = null;
        }
      }
    }

    const draw = new Set();
    for (const [l, i, j] of want) {
      const k = this.key(l, i, j);
      if (this.tiles.has(k)) {
        draw.add(k);
        continue;
      }
      // Cover with the nearest ready ancestor...
      let cover = null;
      for (let L = l + 1, ii = i >> 1, jj = j >> 1; L <= TOP; L++, ii >>= 1, jj >>= 1) {
        const ak = this.key(L, ii, jj);
        if (this.tiles.has(ak)) {
          cover = ak;
          break;
        }
      }
      if (cover) draw.add(cover);
      else {
        // ...or with whatever smaller tiles were drawn there last frame.
        for (const rk of this.rendered) {
          const [rl, ri, rj] = rk.split(':').map(Number);
          if (rl < l && (ri >> (l - rl)) === i && (rj >> (l - rl)) === j) draw.add(rk);
        }
      }
    }
    // An ancestor in the set hides its descendants.
    for (const k of [...draw]) {
      const [l, i, j] = k.split(':').map(Number);
      for (let L = l + 1, ii = i >> 1, jj = j >> 1; L <= TOP; L++, ii >>= 1, jj >>= 1) {
        if (draw.has(this.key(L, ii, jj))) {
          draw.delete(k);
          break;
        }
      }
    }
    for (const [k, mesh] of this.tiles) mesh.visible = draw.has(k) && !mesh.userData.buried;
    this.rendered = draw;

    // Forget tiles far from anything wanted.
    if (this.tiles.size > 260) {
      const wantKeys = new Set(want.map(([l, i, j]) => this.key(l, i, j)));
      for (const [k, mesh] of this.tiles) {
        if (draw.has(k) || wantKeys.has(k)) continue;
        this.group.remove(mesh);
        mesh.geometry.dispose();
        this.tiles.delete(k);
        this.stale.delete(k);
        if (this.tiles.size <= 200) break;
      }
    }
    return missing.length;
  }

  // Drop every tile that intersects a box: used when new road is committed
  // through ground that was baked before the road reached it.
  invalidate(ax0, az0, ax1, az1) {
    const hit = (x0, z0, s) => !(x0 > ax1 + REACH || x0 + s < ax0 - REACH || z0 > az1 + REACH || z0 + s < az0 - REACH);
    // A tile half-baked from the old road would come out wrong: start it over.
    if (this.baking) {
      const { l, i, j } = this.baking;
      const s = LEVELS[l];
      if (hit(i * s, j * s, s)) this.baking = null;
    }
    for (const k of [...this.inflight.keys()]) {
      const [l, i, j] = k.split(':').map(Number);
      if (hit(i * LEVELS[l], j * LEVELS[l], LEVELS[l])) this.inflight.delete(k);
    }
    for (const [k, mesh] of this.tiles) {
      const { x0, z0, level } = mesh.userData;
      if (!hit(x0, z0, LEVELS[level])) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      this.tiles.delete(k);
      this.stale.delete(k);
    }
  }
}
