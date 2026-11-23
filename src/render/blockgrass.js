// The block style's grass (render/grass.js draws it from the ground map the
// other styles' blades are drawn from): tufts of two square sheets that cross
// on a vertical line, each a picture of 16 by 16 texels, laid on the land
// where the land's shader says grass grows. A sheet is one of four pictures of
// grass, in tones to be laid on the colour of the ground under it, or one of
// four flowers, in colours of their own. The texels are taken as they are (the
// nearest one, no blending between them) and a texel with nothing in it is not
// drawn, so the edges are the pictures' own: nothing is blended and the sheets
// write the depth as the land does.
//
// All sheets of all rings and the flowers are one mesh, one draw call: each
// vertex says which cell of which ring it is a corner of, and a sheet's place,
// size, turn and picture come from the integer hash of the cell in the vertex
// shader, as a blade's do. Its foot's height, colour and whether grass grows
// there are read from the ground map. A ring, high or middle tier, comes in and
// goes out over a few metres: a sheet is thinned out by its own random number
// and shrinks as it goes, not made transparent. The low tier draws none.

import * as THREE from 'three';
import { withAtmosphere, compileObjects } from './atmosphere.js';
import { MARK, pairProgram } from './style.js';

export const SHEET_TEXELS = 16;
// Pictures in the atlas: four of grass, then four of flowers.
export const SHEET_PICTURES = 8;

// How big a sheet is, m across and up: twice the height of the grass the world
// gives (its `grass.height`), kept between these. A flower's is a share of it.
export const SHEET_SIZE = [0.5, 1.1];

// The rings: the cell a tuft stands in (m), how far out the cells go, where they
// come in and where they go out (metres from the lens), and the size of a tuft
// of it, a share of the size above. The flowers are a ring too, of the same
// kind of sheet. At the middle tier the cells are farther apart (SHEET_MID.cell:
// 0.57 of the tufts) and the flowers reach a little less far.
export const SHEET_RINGS = [
  { cell: 0.75, reach: [0, 15], from: [0, 0], to: [11, 15], size: 1, flower: 0 },
  { cell: 0.8, reach: [11, 34], from: [11, 15], to: [26, 34], size: 1, flower: 0 },
  { cell: 0.9, reach: [26, 60], from: [26, 34], to: [48, 60], size: 1.05, flower: 0 },
  { cell: 1.7, reach: [0, 40], from: [0, 0], to: [28, 40], size: 0.62, flower: 1 },
];
export const SHEET_MID = { cell: 1.29, flowerReach: 0.7 };

// The flowers' four colours (sRGB), as the painted style has them; a flower is
// drawn in them at the light the ground under it has, three times over (the
// same share the painted style's flowers take).
export const FLOWER_COLOURS = [[0.98, 0.97, 0.9], [1.0, 0.84, 0.25], [0.98, 0.62, 0.72], [0.6, 0.7, 1.0]];
const FLOWER_LIGHT = 3.2;
// What a tone in a picture of grass is multiplied by: tones go up to this.
const TONE_MAX = 1.25;

const hash = (i) => {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

// The atlas, made here: 8 pictures of 16 by 16 texels side by side, rows from
// the foot up. A grass picture is blades of different heights, each darker at
// its foot and lighter toward its tip, with a lighter texel at the very tip,
// standing on a foot that is whole; its three channels are all one tone (as a
// share of TONE_MAX), which is multiplied by the colour of the ground. A flower
// picture is a stem with two leaves and a head of 4 by 4 texels with a lighter
// middle, in the colours as light is added (linear). Texels are either all or
// nothing in alpha.
export function sheetAtlas() {
  const S = SHEET_TEXELS;
  const W = S * SHEET_PICTURES;
  const data = new Uint8Array(W * S * 4);
  const put = (pic, x, y, r, g, b) => {
    if (x < 0 || x >= S || y < 0 || y >= S) return;
    const o = (y * W + pic * S + x) * 4;
    data[o] = Math.max(0, Math.min(255, Math.round(r * 255)));
    data[o + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
    data[o + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
    data[o + 3] = 255;
  };
  const tone = (pic, x, y, t) => put(pic, x, y, t / TONE_MAX, t / TONE_MAX, t / TONE_MAX);
  for (let pic = 0; pic < 4; pic++) {
    const r = (k) => hash(pic * 131.7 + k * 7.31);
    let x = Math.floor(r(0) * 2);
    let k = 1;
    // Its foot: two rows across, dark.
    for (let fx = 0; fx < S; fx++) {
      tone(pic, fx, 0, 0.5 + 0.12 * r(100 + fx));
      tone(pic, fx, 1, 0.58 + 0.12 * r(120 + fx));
    }
    while (x < S) {
      // A blade: one or two texels wide, the top two rows of a wide one a
      // single texel, so that it ends in a point of steps; it may lean a texel
      // over in its upper half; a short one now and then.
      const width = r(k++) < 0.6 ? 2 : 1;
      const height = r(k++) < 0.25 ? 4 + Math.floor(r(k++) * 3) : 7 + Math.floor(r(k++) * 9);
      const lean = r(k++) < 0.4 ? (r(k++) < 0.5 ? -1 : 1) : 0;
      const tipSide = r(k++) < 0.5 ? 0 : 1;
      for (let y = 2; y < height; y++) {
        const up = y / (height - 1);
        const xx = x + (y > height * 0.55 ? lean : 0);
        const narrow = width === 2 && y >= height - 2 && height > 6;
        for (let d = 0; d < width; d++) {
          if (narrow && d !== tipSide) continue;
          // The far side of a wide blade is the darker.
          let t = 0.62 + 0.5 * up + (r(200 + y * 17 + x) - 0.5) * 0.12 - (d ? 0.1 : 0);
          if (y === height - 1) t += 0.16;
          tone(pic, xx + d, y, t);
        }
      }
      x += width + 1 + Math.floor(r(k++) * 2);
    }
  }
  FLOWER_COLOURS.forEach((c, i) => {
    const pic = 4 + i;
    const lin = c.map(toLinear);
    const centre = i === 0 ? [1.0, 0.69, 0.05] : [lin[0] * 0.55 + 0.45, lin[1] * 0.55 + 0.45, lin[2] * 0.55 + 0.4];
    const stem = 8 + (i === 1 ? 1 : 0);
    for (let y = 0; y < stem; y++) {
      put(pic, 7, y, 0.09, 0.34, 0.07);
      put(pic, 8, y, 0.06, 0.26, 0.05);
    }
    for (const [lx, ly] of [[5, 2], [6, 2], [5, 3], [9, 3], [10, 3], [10, 4]]) put(pic, lx, ly, 0.13, 0.46, 0.09);
    // The head: 4 by 4, its corners left off, a lighter middle.
    for (let hy = 0; hy < 4; hy++) {
      for (let hx = 0; hx < 4; hx++) {
        if ((hx === 0 || hx === 3) && (hy === 0 || hy === 3)) continue;
        const mid = (hx === 1 || hx === 2) && (hy === 1 || hy === 2);
        const c3 = mid ? centre : lin;
        put(pic, 6 + hx, stem + hy, c3[0], c3[1], c3[2]);
      }
    }
  });
  const tex = new THREE.DataTexture(data, W, S, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  tex.name = 'BlockGrass.atlas';
  return tex;
}

// The cells of the rings, as the vertices of their sheets: eight to a tuft (a
// sheet is four, two sheets), each with the cell it belongs to (i, j from the
// cell the lens is in), its ring, and nothing: which corner it is the shader
// takes from the vertex's number.
function sheetGeometry(rings) {
  const cells = [];
  rings.forEach((ring, r) => {
    const r0 = ring.reach[0] / ring.cell;
    const r1 = ring.reach[1] / ring.cell;
    const n = Math.ceil(r1);
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        const d = Math.hypot(i + 0.5, j + 0.5);
        if (d >= r0 && d < r1) cells.push(i, j, r);
      }
    }
  });
  const N = cells.length / 3;
  const per = rings.map(() => 0);
  for (let b = 0; b < N; b++) per[cells[b * 3 + 2]]++;
  const cel = new Int16Array(N * 8 * 4);
  const idx = new Uint32Array(N * 12);
  for (let b = 0; b < N; b++) {
    for (let v = 0; v < 8; v++) {
      const o = (b * 8 + v) * 4;
      cel[o] = cells[b * 3];
      cel[o + 1] = cells[b * 3 + 1];
      cel[o + 2] = cells[b * 3 + 2];
    }
    const k = b * 8;
    idx.set([k, k + 1, k + 2, k, k + 2, k + 3, k + 4, k + 5, k + 6, k + 4, k + 6, k + 7], b * 12);
  }
  const g = new THREE.BufferGeometry();
  const a = new THREE.Int16BufferAttribute(cel, 4);
  a.gpuType = THREE.IntType;
  g.setAttribute('aSheet', a);
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.userData = { tufts: N, sheets: N * 2, triangles: N * 4, vertices: N * 8, perRing: per, bytes: cel.byteLength + idx.byteLength };
  return g;
}

const SHEET_PARS = /* glsl */`
attribute ivec4 aSheet;
uniform vec4 uSA[4];       // per ring: cell, fade in from, fade in to, size
uniform vec4 uSB[4];       // fade out from, fade out to, 1 for flowers, salt
uniform vec4 uSL[4];       // the lens's cell (x, z), where that cell's corner is (x, z, in the scene's coordinates)
uniform vec4 uSheet;       // the size of a sheet, how many flowers, the seed
uniform vec4 uMapRect;
uniform vec3 uMapNF;
uniform sampler2D uMapTex;
uniform sampler2D uMapDepth;
varying vec3 vSheetCol;
varying vec2 vSheetUv;
uvec3 pcg3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 sdraw(ivec2 c, uint salt, uint ring) {
  uvec3 h = pcg3(uvec3(uint(c.x), uint(c.y), salt + uint(uSheet.z) * 7919u + ring * 104729u));
  return vec3(h & 0xffffffu) / 16777216.0;
}
float snoise(vec2 p, uint salt) {
  vec2 i = floor(p);
  vec2 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  return mix(mix(sdraw(c, salt, 9u).x, sdraw(c + ivec2(1, 0), salt, 9u).x, f.x), mix(sdraw(c + ivec2(0, 1), salt, 9u).x, sdraw(c + ivec2(1, 1), salt, 9u).x, f.x), f.y);
}
float sheetMapDepth(ivec2 i) {
  return texelFetch(uMapDepth, clamp(i, ivec2(0), ivec2(int(uMapNF.z) - 1)), 0).r;
}
`;

// A vertex of a tuft: the cell it belongs to, the map under its foot, and the
// corner of its sheet stood there. Out of the clip volume when it is not to be seen.
const SHEET_VERTEX = /* glsl */`
vec3 transformed;
{
  int vid = gl_VertexID & 7;
  int sheet = vid >> 2;
  int corner = vid & 3;
  float cx = (corner == 1 || corner == 2) ? 1.0 : -1.0;
  float cy = corner >= 2 ? 1.0 : 0.0;
  int ring = aSheet.z;
  vec4 A = uSA[ring];
  vec4 B = uSB[ring];
  vec4 L = uSL[ring];
  uint salt = uint(B.w);
  ivec2 cell = ivec2(L.xy) + aSheet.xy;
  vec3 r1 = sdraw(cell, 1u, salt);
  vec3 r2 = sdraw(cell, 2u, salt);
  vec3 r3 = sdraw(cell, 3u, salt);
  vec2 foot2 = L.zw + (vec2(aSheet.xy) + r1.xy) * A.x;
  vec2 abs2 = (vec2(cell) + r1.xy) * A.x;
  vec2 uv = vec2(foot2.x - uMapRect.x, uMapRect.y - foot2.y) / uMapRect.z;
  vec2 tc = uv * uMapNF.z - 0.5;
  ivec2 i0 = ivec2(floor(tc));
  vec2 f = tc - vec2(i0);
  float y0 = mix(mix(sheetMapDepth(i0), sheetMapDepth(i0 + ivec2(1, 0)), f.x), mix(sheetMapDepth(i0 + ivec2(0, 1)), sheetMapDepth(i0 + ivec2(1, 1)), f.x), f.y);
  float gy = uMapRect.w - (uMapNF.x + y0 * (uMapNF.y - uMapNF.x)) - 0.02;
  vec4 g = textureLod(uMapTex, uv, 0.0);
  vec3 foot = vec3(foot2.x, gy, foot2.y);
  float bd = distance(foot, cameraPosition);
  float keep = (A.z <= A.y ? 1.0 : smoothstep(A.y, A.z, bd)) * (1.0 - smoothstep(B.x, B.y, bd));
  bool flower = B.z > 0.5;
  // A flower stands where the drifts of them are, ten metres across.
  float drift = smoothstep(0.42, 0.68, snoise(abs2 / 10.0 + 11.0, 41u));
  float chance = flower ? uSheet.y * (0.04 + 0.5 * drift) : 1.0;
  float live = smoothstep(0.0, 0.18, keep * (flower ? 1.0 : g.a) - r2.z * 0.82);
  bool gone = live <= 0.0 || uv.x < 0.01 || uv.x > 0.99 || uv.y < 0.01 || uv.y > 0.99 || g.a < (flower ? 0.5 : 0.001) || (flower && r2.x > chance);
  vec4 clip0 = projectionMatrix * viewMatrix * vec4(foot + vec3(0.0, 0.5, 0.0), 1.0);
  gone = gone || clip0.w < -1.0 || abs(clip0.x) > clip0.w + 2.5 || abs(clip0.y) > clip0.w + 2.5;
  float size = uSheet.x * A.w * mix(0.8, 1.15, r3.z) * mix(0.55, 1.0, live);
  float yaw = r1.z * 3.14159265;
  vec2 along = vec2(cos(yaw), sin(yaw));
  if (sheet == 1) along = vec2(-along.y, along.x);
  vec3 p = foot + vec3(along.x * cx * size * 0.5, cy * size, along.y * cx * size * 0.5);
  transformed = gone ? vec3(1e9) : p;
  // The picture: one of the four of grass or of flowers, turned over for half of them.
  float pick = 0.0;
  if (flower) {
    float clump = sdraw(ivec2(floor(abs2 / 7.0)), 21u, 9u).x;
    float u = r3.x < 0.8 ? clump : r3.y;
    pick = 4.0 + (u < 0.4 ? 0.0 : (u < 0.66 ? 1.0 : (u < 0.86 ? 2.0 : 3.0)));
  } else {
    pick = floor(r3.x * 4.0);
  }
  float across = r3.y < 0.5 ? (cx * 0.5 + 0.5) : (0.5 - cx * 0.5);
  vSheetUv = vec2((pick + 0.01 + 0.98 * across) / ${SHEET_PICTURES}.0, 0.01 + 0.98 * cy);
  float lum = dot(g.rgb, vec3(0.2126, 0.7152, 0.0722));
  vSheetCol = flower ? vec3(lum * ${FLOWER_LIGHT.toFixed(1)}) : g.rgb * ${TONE_MAX.toFixed(2)};
}
`;

export class Sheets {
  // shared: the uniforms the ground map's are in (grass.js's), env: seed.
  constructor(shared, seed) {
    this.seed = seed || 0;
    this.atlas = sheetAtlas();
    this.uniforms = {
      uSA: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
      uSB: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
      uSL: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
      uSheet: { value: new THREE.Vector4(1, 1, this.seed, 0) },
      uSheetTex: { value: this.atlas },
      uMapRect: shared.uMapRect,
      uMapNF: shared.uMapNF,
      uMapTex: shared.uMapTex,
      uMapDepth: shared.uMapDepth,
    };
    this.geo = null;
    this.mesh = null;
    this.mat = null;
    this.rings = [];
    this.tier = null;
    this.stats = { tufts: 0, sheets: 0, triangles: 0, vertices: 0, bytes: 0 };
  }

  // The material of the sheets, made once and kept (its program stays built
  // when the mesh is let go of and made again).
  _material() {
    if (this.mat) return this.mat;
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    mat.userData.mark = MARK.leaf;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      const swap = (src, from, to) => {
        if (src.split(from).length !== 2) throw new Error(`block grass: ${JSON.stringify(from)} is not once in the shader`);
        return src.replace(from, to);
      };
      shader.vertexShader = swap(swap(shader.vertexShader, '#include <common>', `#include <common>\n${SHEET_PARS}`), '#include <begin_vertex>', SHEET_VERTEX);
      shader.fragmentShader = swap(swap(shader.fragmentShader, '#include <common>',
        '#include <common>\nvarying vec3 vSheetCol;\nvarying vec2 vSheetUv;\nuniform sampler2D uSheetTex;'), '#include <color_fragment>',
      'vec4 sheetTexel = texture2D(uSheetTex, vSheetUv);\nif (sheetTexel.a < 0.5) discard;\ndiffuseColor.rgb = vSheetCol * sheetTexel.rgb;');
    };
    mat.customProgramCacheKey = () => 'continuum-grass-sheets';
    this.mat = withAtmosphere(mat);
    return this.mat;
  }

  // The mesh for a tier: the middle one has its cells farther apart and the
  // flowers a little nearer.
  build(tier, group) {
    this.release(group);
    const mid = tier === 'mid';
    const near = SHEET_RINGS.filter((r) => !r.flower);
    const flowers = SHEET_RINGS.find((r) => r.flower);
    this.rings = [...near, flowers].map((r) => ({
      ...r,
      cell: r.cell * (mid ? SHEET_MID.cell : 1),
      reach: r.flower && mid ? [r.reach[0], r.reach[1] * SHEET_MID.flowerReach] : r.reach,
      to: r.flower && mid ? [r.to[0], r.to[1] * SHEET_MID.flowerReach] : r.to,
    }));
    this.geo = sheetGeometry(this.rings);
    const u = this.uniforms;
    this.rings.forEach((r, i) => {
      u.uSA.value[i].set(r.cell, r.from[0], r.from[1], r.size);
      u.uSB.value[i].set(r.to[0], r.to[1], r.flower, i);
    });
    this.mesh = new THREE.Mesh(this.geo, this._material());
    this.mesh.frustumCulled = false;
    this.mesh.name = 'grass-sheets';
    group.add(this.mesh);
    this.tier = tier;
    this.stats = { ...this.geo.userData, flowers: this.geo.userData.perRing[this.rings.length - 1] };
    return this.mesh;
  }

  // Build the program the sheets are drawn with ahead, while the page is
  // drawn in a style that has none of them. It is the program of the lit
  // materials that are not of the paired paints (the real style's kind, which
  // the block style shares), whichever kind is being warmed when this is
  // asked.
  warm(renderer, scene, camera, tier) {
    const was = pairProgram.on;
    pairProgram.on = false;
    try {
      const group = new THREE.Group();
      const mesh = this.build(tier, group);
      compileObjects(renderer, scene, camera, [mesh]);
      this.release(group);
    } finally {
      pairProgram.on = was;
    }
  }

  // Every frame: where the lens is (absolute metres), the floating origin and
  // what the worlds there say of the grass: the lattice of each ring comes to
  // the lens, the sheets to the size the grass is, the flowers to their number.
  frame(ax, az, origin, here) {
    const u = this.uniforms;
    this.rings.forEach((r, i) => {
      const c0x = Math.floor(ax / r.cell);
      const c0z = Math.floor(az / r.cell);
      u.uSL.value[i].set(c0x, c0z, c0x * r.cell - origin.x, c0z * r.cell - origin.z);
    });
    u.uSheet.value.x = Math.min(SHEET_SIZE[1], Math.max(SHEET_SIZE[0], 2 * here.height));
    u.uSheet.value.y = here.flowers;
  }

  // The mesh let go of (the material and the pictures are kept).
  release(group) {
    if (this.mesh) group.remove(this.mesh);
    if (this.geo) this.geo.dispose();
    this.mesh = null;
    this.geo = null;
    this.rings = [];
    this.tier = null;
  }

  dispose(group) {
    this.release(group);
    if (this.mat) this.mat.dispose();
    this.mat = null;
    this.atlas.dispose();
  }
}
