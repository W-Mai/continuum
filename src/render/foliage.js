// What the real style's trees are drawn with: the textures (the cards of leaves and needles and the bark,
// drawn by world/foliage.js in a worker), the trees built of them near and middle (render/treegeo.js), a picture
// of each kind from eight sides for what is far off, and the materials that light all of it.
//
// The leaves are not blended: a card's picture has an alpha, and a pixel of it is drawn where the alpha is
// over a threshold that is a 4 x 4 ordered dither laid on the world, in cells as wide as a pixel is on the
// surface, so the pattern keeps its place on a leaf as the lens goes by, and the depth the occlusion pass reads
// has the holes the frame has. What a leaf casts into the sun's shadow maps is left out by a hash of 4 cm cells
// of the world (the shadow's own), so that the shadow of a crown is the dapple of its leaves and stands still.
// A smaller picture of the card (a lower mip) has less of it that is leaf, and its alpha is lifted a little
// (LEAF.mip a level) so that a crown seen from far off is not thinner than one seen near.
//
// A leaf's light is the physical model's, from the normal the crown gives it (the card's own, leant to the
// crown's outward one), and the sun that falls on the far side of a leaf shows through it, yellower, by how
// much the lens looks toward the sun. The impostor of a kind is the tree drawn from eight sides at the start,
// without light, in the colours of its cards; it is lit as the tree is, from the normal of the crown's ellipsoid
// at each pixel.
//
// The textures are made at the tier the game started at and stay: a change of tier only changes which of
// the two builds a near tree is drawn with.

import * as THREE from 'three';
import { styleU, MARK } from './style.js';
import { withAtmosphere, withSunMask, compileObjects } from './atmosphere.js';
import { LEAF_KINDS, bakeFoliage, foliageBytes, FOLIAGE_MEANS } from '../world/foliage.js';
import { treeGeometry, TREE_KINDS, TREE_NAMES, LEAN } from './treegeo.js';

// The tiers: the width of each of the eight pictures of an impostor, and which build a near tree has.
export const FOLIAGE_LEVELS = { high: { cell: 256, near: 0 }, mid: { cell: 128, near: 1 }, low: { cell: 128, near: 1 } };
// How much of a leaf's light shows through it (the sun on its far face: pass of what the near face would have
// had; and, looking toward the sun, a forward lobe: through), and the yellowness of what does.
const LEAF = { through: 0.3, pass: 0.55, tint: [0.9, 1.0, 0.4], mip: 0.12, rough: 0.88, bark: 1.6 };
const SIZE_OF_VIEWS = 8;

// The dither: a Bayer matrix of 4 x 4 over cells of the world, the cell the width of a pixel on the surface,
// in whole powers of two of 5 mm, the two nearest kinds blended by how far between them it is.
const DITHER = /* glsl */`
float leafBayer( ivec3 c ) {
  const float B[16] = float[16]( 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 );
  ivec2 q = ivec2( c.x + 3 * c.z, c.y + 5 * c.z ) & 3;
  return ( B[ q.y * 4 + q.x ] + 0.5 ) / 16.0;
}
float leafThreshold( vec3 cw ) {
  float fp = length( fwidth( cw ) );
  float lv = log2( max( fp, 0.005 ) / 0.005 );
  float k0 = floor( lv );
  float s0 = 0.005 * exp2( k0 );
  float t0 = leafBayer( ivec3( floor( cw / s0 ) ) );
  float t1 = leafBayer( ivec3( floor( cw / ( s0 * 2.0 ) ) ) );
  return mix( t0, t1, smoothstep( 0.3, 0.7, lv - k0 ) );
}
// The point in the world a fragment is at, from where the lens is (the origin's digits taken whole to 1 km).
vec3 leafWorld() {
  return cameraPosition - vViewPosition * mat3( viewMatrix ) + mod( uOriginAbs, 1024.0 );
}`;

const srgb = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

// A texture of bytes with all its mips.
function textureOf(bytes, size, colour) {
  const mips = [];
  let at = 0;
  for (let s = size; s >= 1; s >>= 1) {
    mips.push({ data: bytes.subarray(at * 4, (at + s * s) * 4), width: s, height: s });
    at += s * s;
  }
  const tex = new THREE.DataTexture(mips[0].data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.mipmaps = mips;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.unpackAlignment = 1;
  if (colour) {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  } else {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  }
  tex.needsUpdate = true;
  return tex;
}

// The vertex and fragment patches every leaf material has, on the model's own program (before the style's light
// is laid on it): which part a pixel is of (the bark of a limb or foliage), the card's picture as the colour and
// the alpha of the foliage, the bark's cavity as a dark on the bark, the dither, and the normal as it is.
function patchLeaf(shader, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aPart;\nvarying float vPart;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPart = aPart;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
varying float vPart;
uniform float uAtlas;
${DITHER}`)
    .replace('#include <map_fragment>', `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  float isLeaf = step( 0.5, vPart );
  diffuseColor.rgb *= mix( vec3( 1.0 ), sampledDiffuseColor.rgb, isLeaf );
  diffuseColor.a *= mix( 1.0, sampledDiffuseColor.a, isLeaf );
  // The bark's cavity darkens the furrows.
  diffuseColor.rgb *= mix( mix( 0.5, 1.0, texture2D( normalMap, vNormalMapUv ).a ), 1.0, isLeaf );
#endif`)
    .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
if ( vPart > 0.5 ) {
  vec2 tw = dFdx( vMapUv * uAtlas );
  vec2 th = dFdy( vMapUv * uAtlas );
  float lodTex = 0.5 * log2( max( max( dot( tw, tw ), dot( th, th ) ), 1.0 ) );
  float a = diffuseColor.a * ( 1.0 + ${LEAF.mip.toFixed(3)} * max( lodTex, 0.0 ) );
  if ( a < leafThreshold( leafWorld() ) ) discard;
}`)
    // Both faces of a card are lit as the crown's normal says, not turned over with the side drawn.
    .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin
      .replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = vPart > 0.5 ? 1.0 : ( gl_FrontFacing ? 1.0 : - 1.0 );'))
    ;
  // The bark's normal map is not laid on the foliage (its picture is not the bark's).
  shader.fragmentShader = shader.fragmentShader.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * ( 1.0 - step( 0.5, vPart ) );');
}

// The light that shows through a leaf: laid over the style's own direct light after it, once the program
// has its style's light in it.
function throughLeaf(material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    const anchor = '#define RE_IndirectSpecular RE_IndirectSpecular_Style';
    if (shader.fragmentShader.split(anchor).length !== 2) throw new Error('foliage: the style\'s light is not once in the program');
    shader.fragmentShader = shader.fragmentShader.replace(anchor, `${anchor}
void RE_Direct_Leaf( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Style( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  if ( vPart > 0.5 ) {
    float back = pow( saturate( dot( - directLight.direction, geometryViewDir ) ), 3.0 );
    float far = saturate( dot( - geometryNormal, directLight.direction ) );
    reflectedLight.directDiffuse += directLight.color * material.diffuseColor * ( RECIPROCAL_PI * ( ${LEAF.through.toFixed(3)} * back + ${LEAF.pass.toFixed(3)} * far ) ) * vec3( ${LEAF.tint.map((x) => x.toFixed(2)).join(', ')} );
  }
}
#undef RE_Direct
#define RE_Direct RE_Direct_Leaf`);
  };
  const below = material.customProgramCacheKey;
  material.customProgramCacheKey = () => (below ? below.call(material) : '') + '|leaf';
  return material;
}

// The impostor: one card on each tree that turns to the lens, with the picture of the tree from the side nearest
// the lens's (two of the eight, by how far between them), and its light worked out from the crown it stands for.
// The geometry's position is the tree's foot; aCorner says which corner of the card a vertex is; aBill is the tree's
// width, height and turn.
function patchBillboard(shader, uniforms, kind) {
  Object.assign(shader.uniforms, uniforms);
  const k = TREE_KINDS[kind];
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
attribute vec2 aCorner;
attribute vec4 aBill;
varying vec4 vBill;
varying vec2 vBillUV;
varying vec3 vBillR;
varying vec3 vBillF;`)
    .replace('#include <begin_vertex>', `vec3 transformed = vec3( 0.0 );
{
  vec3 base = position;
  vec4 bw = modelMatrix * vec4( base, 1.0 );
  vec2 d2 = cameraPosition.xz - bw.xz;
  vec2 f = d2 / max( length( d2 ), 1e-3 );
  vec2 rt = vec2( f.y, - f.x );
  transformed = base + vec3( rt.x, 0.0, rt.y ) * ( aCorner.x * aBill.x * ${k.reach.toFixed(3)} ) + vec3( 0.0, ( aCorner.y * 1.06 - 0.03 ) * aBill.y, 0.0 );
  float cp = cos( aBill.z );
  float sp = sin( aBill.z );
  vec2 loc = vec2( dot( f, vec2( cp, - sp ) ), dot( f, vec2( sp, cp ) ) );
  float ang = atan( loc.y, loc.x ) * 1.27323954;
  ang = ang < 0.0 ? ang + 8.0 : ang;
  float i0 = min( floor( ang ), 7.0 );
  vBill = vec4( i0, mod( i0 + 1.0, 8.0 ), ang - i0, 0.0 );
  vBillUV = vec2( aCorner.x * 0.5 + 0.5, aCorner.y );
  vBillR = vec3( rt.x, 0.0, rt.y );
  vBillF = vec3( f.x, 0.0, f.y );
}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
varying vec4 vBill;
varying vec2 vBillUV;
varying vec3 vBillR;
varying vec3 vBillF;
uniform sampler2D uBill;
uniform float uBillGain;
${DITHER}`)
    .replace('#include <map_fragment>', `{
  vec2 uvc = vec2( clamp( vBillUV.x, 0.006, 0.994 ), clamp( vBillUV.y, 0.004, 0.996 ) );
  vec4 s0 = texture2D( uBill, vec2( ( vBill.x + uvc.x ) * ${(1 / SIZE_OF_VIEWS).toFixed(5)}, uvc.y ) );
  vec4 s1 = texture2D( uBill, vec2( ( vBill.y + uvc.x ) * ${(1 / SIZE_OF_VIEWS).toFixed(5)}, uvc.y ) );
  vec4 s = mix( s0, s1, vBill.z );
  diffuseColor.rgb *= s.rgb * uBillGain;
  diffuseColor.a *= s.a;
  if ( diffuseColor.a < leafThreshold( leafWorld() ) ) discard;
}`)
    .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin
      .replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;')
      .replace('vec3 normal = normalize( vNormal );', `// The crown's ellipsoid, as it faces at this point of the card, leant by the share the cards lean.
  vec2 ep = vec2( ( vBillUV.x * 2.0 - 1.0 ) * ${k.reach.toFixed(3)} / ${k.radii[0].toFixed(3)}, ( vBillUV.y * 1.06 - 0.03 - ${k.centre[1].toFixed(3)} ) / ${k.radii[1].toFixed(3)} );
  // (Below the crown it is the trunk that is there: its normal does not turn down.)
  ep.y = max( ep.y, - 0.35 );
  float ez = sqrt( max( 1.0 - dot( ep, ep ), 0.0 ) );
  vec3 ne = normalize( vec3( ep.x / ${k.radii[0].toFixed(3)}, ep.y / ${k.radii[1].toFixed(3)}, ez / ${k.radii[0].toFixed(3)} ) );
  vec3 nw = normalize( mix( vBillF, normalize( vBillR * ne.x + vec3( 0.0, 1.0, 0.0 ) * ne.y + vBillF * ne.z ), ${LEAN.toFixed(2)} ) );
  vec3 normal = normalize( ( viewMatrix * vec4( nw, 0.0 ) ).xyz );`));
}

export class Foliage {
  // renderer: what the pictures of the kinds are drawn with; tier: the game's, which the textures are made at;
  // bakers: the pool the textures are asked of (none: made here).
  constructor(renderer, { tier = 'high', bakers = null } = {}) {
    this.renderer = renderer;
    this.tier = tier;
    this.bakers = bakers;
    this.ready = false;
    this.asked = false;
    this.tex = null;               // { atlas, bark }
    this.geo = new Map();          // `${kind}:${level}` -> geometry
    this.impostors = new Map();    // kind -> render target
    this.lit = null;               // the material of the trees' meshes
    this.depth = null;             // what the leaves cast into the sun's shadow maps
    this.bill = new Map();         // kind -> the impostor's material
    this.level = FOLIAGE_LEVELS[tier] || FOLIAGE_LEVELS.high;
    this.ms = 0;                   // time made on the page
    this.page = 0;                 // how many of the textures were made here, not in a worker
    this.uniforms = { uAtlas: { value: 512 } };
  }

  // The textures and the impostors still to come: 0 when everything is there. Asks the pool for the textures
  // where there is one, makes them here where there is none (or it has failed).
  grain() {
    if (this.ready) return 0;
    if (!this.tex) {
      const b = this.bakers;
      if (b && !b.failed) {
        if (!b.ready) return 2;
        if (!this.asked) {
          this.asked = true;
          const id = b.post({ type: 'foliage', tier: this.tier }, [], (r) => this._adopt(r.foliage));
          if (!id) this.asked = false;
        }
        return 2;
      }
      const t0 = performance.now();
      this._adopt(bakeFoliage(this.tier));
      this.page = 2;
      this.ms += performance.now() - t0;
    }
    if (this.tex) this._finish();
    return this.ready ? 0 : 1;
  }

  _adopt(items) {
    if (this.tex) return;
    const atlas = items.find((i) => i.name === 'atlas');
    const bark = items.find((i) => i.name === 'bark');
    this.tex = { atlas: textureOf(atlas.a, atlas.size, true), bark: textureOf(bark.a, bark.size, false) };
    this.uniforms.uAtlas.value = atlas.size;
  }

  // The textures are in: the pictures of the kinds, and the materials.
  _finish() {
    const t0 = performance.now();
    this._materials();
    for (const kind of TREE_NAMES) this._impostor(kind);
    this.ready = true;
    this.ms += performance.now() - t0;
  }

  _materials() {
    const { atlas, bark } = this.tex;
    const lit = new THREE.MeshStandardMaterial({ map: atlas, normalMap: bark, vertexColors: true, roughness: LEAF.rough, metalness: 0, side: THREE.DoubleSide });
    lit.normalScale.set(LEAF.bark, LEAF.bark);
    lit.userData.mark = MARK.tree;
    lit.userData.styleClump = true;
    const on = (shader) => patchLeaf(shader, this.uniforms);
    lit.onBeforeCompile = on;
    lit.customProgramCacheKey = () => 'continuum-leaf';
    this.lit = throughLeaf(withSunMask(withAtmosphere(lit), true));
    // What a leaf casts into the shadow map: the pixels of the card that are leaf, taken or not by chance
    // on the world, in cells of 4 cm, so the shadow of a crown is the dapple of its leaves and stands still.
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, side: THREE.DoubleSide });
    depth.onBeforeCompile = (shader) => {
      shader.uniforms.uOriginAbs = styleU.uOriginAbs;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aPart;\nvarying float vPart;\nvarying vec3 vWorldCast;')
        .replace('#include <project_vertex>', `#include <project_vertex>
vPart = aPart;
{
  vec4 wc = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    wc = instanceMatrix * wc;
  #endif
  vWorldCast = ( modelMatrix * wc ).xyz;
}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vPart;\nvarying vec3 vWorldCast;\nuniform vec3 uOriginAbs;')
        .replace('#include <map_fragment>', `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  float isLeaf = step( 0.5, vPart );
  diffuseColor.a *= mix( 1.0, sampledDiffuseColor.a, isLeaf );
#endif`)
        .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
if ( vPart > 0.5 ) {
  uvec3 cp = uvec3( ivec3( floor( ( vWorldCast + mod( uOriginAbs, 1024.0 ) ) / 0.04 ) ) + 100000 );
  float h = float( ( cp.x * 73856093u ^ cp.y * 19349663u ^ cp.z * 83492791u ) & 65535u ) / 65536.0;
  if ( diffuseColor.a < h ) discard;
}`);
    };
    depth.customProgramCacheKey = () => 'continuum-leaf-depth';
    this.depth = depth;
  }

  // The tier the game is at now: which build a near tree has (the pictures stay as wide as they were made).
  // Whether that is another than it was.
  setTier(tier) {
    const next = (FOLIAGE_LEVELS[tier] || FOLIAGE_LEVELS.high).near;
    const changed = next !== this.level.near;
    this.level = { ...this.level, near: next };
    return changed;
  }

  // The tree of a kind at a level of detail for a draw: the level the tier has near trees at is the build that is
  // for them, the other the middle one (lod 0 the full tree, 1 the three-tier one in the forest's own terms).
  geometry(kind, lod) {
    const level = lod === 0 ? this.level.near : 1;
    const key = `${kind}:${level}`;
    let g = this.geo.get(key);
    if (!g) {
      g = treeGeometry(kind, level);
      this.geo.set(key, g);
    }
    return g;
  }

  // A kind seen from eight sides, drawn into one target (its cell as wide as the tier's), unlit, in the colours
  // of its cards and bark with the shade of the crown in its vertices; alpha where the tree is.
  _impostor(kind) {
    const cell = this.level.cell;
    const rt = new THREE.WebGLRenderTarget(cell * SIZE_OF_VIEWS, cell, {
      colorSpace: THREE.SRGBColorSpace,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    const r = this.renderer;
    const geometry = this.geometry(kind, 0);
    const material = new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: this.tex.atlas }, uBark: { value: this.tex.bark } },
      side: THREE.DoubleSide,
      vertexColors: true,
      vertexShader: `
        attribute float aPart;
        varying vec2 vUv;
        varying vec3 vCol;
        varying float vPart;
        void main() {
          vUv = uv;
          vCol = color;
          vPart = aPart;
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,
      fragmentShader: `
        uniform sampler2D uAtlas;
        uniform sampler2D uBark;
        varying vec2 vUv;
        varying vec3 vCol;
        varying float vPart;
        void main() {
          if ( vPart > 0.5 ) {
            vec4 t = texture2D( uAtlas, vUv, -1.5 );
            if ( t.a < 0.45 ) discard;
            gl_FragColor = vec4( t.rgb * vCol, 1.0 );
          } else {
            gl_FragColor = vec4( vCol * mix( 0.5, 1.0, texture2D( uBark, vUv ).a ), 1.0 );
          }
        }`,
    });
    const mesh = new THREE.Mesh(geometry, material);
    const scene = new THREE.Scene();
    scene.add(mesh);
    const reach = TREE_KINDS[kind].reach;
    const cam = new THREE.OrthographicCamera(-reach, reach, 0.53, -0.53, 0.1, 10);
    const own = (FOLIAGE_MEANS[LEAF_KINDS[TREE_KINDS[kind].tile]] || {}).rgb;
    const mean = own && own[0] + own[1] + own[2] > 0 ? own : [0.03, 0.07, 0.02];
    const back = r.getRenderTarget();
    const clear = r.getClearColor(new THREE.Color());
    const alpha = r.getClearAlpha();
    const auto = r.autoClear;
    const shadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.autoClear = false;
    // The colour of what is not the tree is the tree's own, so the mips do not take the dark in at its edge.
    rt.viewport.set(0, 0, cell * SIZE_OF_VIEWS, cell);
    rt.scissorTest = false;
    r.setRenderTarget(rt);
    r.setClearColor(new THREE.Color(mean[0], mean[1], mean[2]), 0);
    r.clear();
    rt.scissorTest = true;
    for (let i = 0; i < SIZE_OF_VIEWS; i++) {
      const a = (i / SIZE_OF_VIEWS) * Math.PI * 2;
      cam.position.set(Math.cos(a) * 3, 0.5, Math.sin(a) * 3);
      cam.lookAt(0, 0.5, 0);
      cam.updateMatrixWorld();
      rt.viewport.set(i * cell, 0, cell, cell);
      rt.scissor.set(i * cell, 0, cell, cell);
      r.setRenderTarget(rt);
      r.render(scene, cam);
    }
    rt.scissorTest = false;
    r.setRenderTarget(back);
    r.setClearColor(clear, alpha);
    r.autoClear = auto;
    r.shadowMap.autoUpdate = shadow;
    material.dispose();
    this.impostors.set(kind, rt);
    this.bill.set(kind, this._billboardMaterial(kind, rt.texture));
  }

  // The material the impostors of a kind are drawn with, lit as the leaves are.
  _billboardMaterial(kind, texture) {
    const std = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: LEAF.rough, metalness: 0, side: THREE.DoubleSide });
    std.userData.mark = MARK.tree;
    std.userData.styleClump = true;
    const uniforms = { uBill: { value: texture }, uBillGain: { value: TREE_KINDS[kind].gain } };
    std.userData.uniforms = uniforms;
    std.onBeforeCompile = (shader) => patchBillboard(shader, uniforms, kind);
    std.customProgramCacheKey = () => `continuum-bill-${kind}`;
    return throughBillboard(withSunMask(withAtmosphere(std), true));
  }

  // The impostors of a tile's trees of a kind (bin: n, mats, suns, cols; planted by world/bakery.js) as one mesh:
  // four corners to a tree, with its foot, its size and turn, its tint and the sun on it.
  billboards(kind, bin) {
    const n = bin.n;
    const pos = new Float32Array(n * 12);
    const corner = new Float32Array(n * 8);
    const info = new Float32Array(n * 16);
    const col = new Float32Array(n * 12);
    const sun = new Float32Array(n * 4);
    const index = n * 4 < 65536 ? new Uint16Array(n * 6) : new Uint32Array(n * 6);
    const { mats, cols, suns } = bin;
    const C = [-1, 0, 1, 0, 1, 1, -1, 1];
    for (let i = 0; i < n; i++) {
      const m = i * 16;
      const w = Math.hypot(mats[m], mats[m + 2]);
      const h = mats[m + 5];
      const psi = Math.atan2(-mats[m + 2], mats[m]);
      for (let c = 0; c < 4; c++) {
        const v = i * 4 + c;
        pos[v * 3] = mats[m + 12];
        pos[v * 3 + 1] = mats[m + 13];
        pos[v * 3 + 2] = mats[m + 14];
        corner[v * 2] = C[c * 2];
        corner[v * 2 + 1] = C[c * 2 + 1];
        info[v * 4] = w;
        info[v * 4 + 1] = h;
        info[v * 4 + 2] = psi;
        col[v * 3] = cols[i * 3];
        col[v * 3 + 1] = cols[i * 3 + 1];
        col[v * 3 + 2] = cols[i * 3 + 2];
        sun[v] = suns[i];
      }
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    geo.setAttribute('aBill', new THREE.BufferAttribute(info.subarray(0, n * 16), 4));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSun', new THREE.BufferAttribute(sun, 1));
    // (A normal the program expects and the impostor does not use: the light is worked out from the crown, up here.)
    const up = new Int8Array(n * 12);
    for (let v = 0; v < n * 4; v++) up[v * 3 + 1] = 127;
    geo.setAttribute('normal', new THREE.BufferAttribute(up, 3, true));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    return geo;
  }

  // What a program of each material is built ahead for (render/atmosphere.js compileObjects): one object of each.
  warm(scene, camera) {
    if (!this.ready) return Promise.resolve();
    const g = this.geometry(TREE_NAMES[0], 1);
    const gg = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv', 'color', 'aPart']) gg.setAttribute(name, g.getAttribute(name));
    gg.setAttribute('aSun', new THREE.InstancedBufferAttribute(new Float32Array(1), 1));
    gg.setIndex(g.getIndex());
    const inst = new THREE.InstancedMesh(gg, this.lit, 1);
    inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3);
    const objects = [inst];
    for (const [kind, mat] of this.bill) {
      const b = this.billboards(kind, { n: 1, mats: new Float32Array(16).fill(1), cols: new Float32Array(3), suns: new Float32Array(1) });
      objects.push(new THREE.Mesh(b, mat));
    }
    return compileObjects(this.renderer, scene, camera, objects).then(() => {
      for (const o of objects) {
        o.geometry.dispose();
        if (o.isInstancedMesh) o.dispose();
      }
    });
  }

  // Bytes of the textures held, mips and all, and how many textures that is.
  get bytes() {
    if (!this.tex) return { textures: 0, bytes: 0 };
    let bytes = 0;
    const b = foliageBytes(this.tier);
    bytes += b.atlas + b.bark;
    const cell = this.level.cell;
    bytes += TREE_NAMES.length * Math.round(cell * SIZE_OF_VIEWS * cell * 4 * (4 / 3));
    return { textures: 2 + this.impostors.size, bytes };
  }

  dispose() {
    for (const g of this.geo.values()) g.dispose();
    this.geo.clear();
    for (const rt of this.impostors.values()) rt.dispose();
    this.impostors.clear();
    for (const m of this.bill.values()) m.dispose();
    this.bill.clear();
    if (this.lit) this.lit.dispose();
    if (this.depth) this.depth.dispose();
    if (this.tex) {
      this.tex.atlas.dispose();
      this.tex.bark.dispose();
    }
    this.tex = null;
    this.ready = false;
  }
}

// The impostor's light is the leaf's, and what comes through it.
function throughBillboard(material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    const anchor = '#define RE_IndirectSpecular RE_IndirectSpecular_Style';
    if (shader.fragmentShader.split(anchor).length !== 2) throw new Error('foliage: the style\'s light is not once in the impostor\'s program');
    shader.fragmentShader = shader.fragmentShader.replace(anchor, `${anchor}
void RE_Direct_Bill( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Style( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  float back = pow( saturate( dot( - directLight.direction, geometryViewDir ) ), 3.0 );
  float far = saturate( dot( - geometryNormal, directLight.direction ) );
  reflectedLight.directDiffuse += directLight.color * material.diffuseColor * ( RECIPROCAL_PI * ( ${LEAF.through.toFixed(3)} * back + ${LEAF.pass.toFixed(3)} * far ) ) * vec3( ${LEAF.tint.map((x) => x.toFixed(2)).join(', ')} );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Bill`);
  };
  const below = material.customProgramCacheKey;
  material.customProgramCacheKey = () => (below ? below.call(material) : '') + '|bill';
  return material;
}
