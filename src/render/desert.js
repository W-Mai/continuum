// What the desert has of its own, beside its dunes, mesas and cacti: old
// billboards by the road with their paint peeling, a line of telegraph poles
// of bleached wood with their wires, dust devils walking over the flats, and
// tumbleweeds the wind rolls across the road (world/desertplan.js says where
// and when). The heat haze over the flats is a pass of the frame's
// (render/post.js, HAZE); this says how much of it there is.
//
// None of it is kept off the desert: out of reach of its world nothing is
// drawn and nothing is worked out. Each draws by the tier (render/quality.js):
// all of it at 'high'; at 'mid' the poles and their wires to half the
// distance, the dust devils with half their points, the haze without its fine
// layer; at 'low' none of it. The billboards and the poles are boxes, so the
// block style needs nothing for them; a tumbleweed is a box there, and a dust
// devil's points are squares.
//
// The car that drives into a dust devil is pushed sideways (0.3 m/s² for two
// seconds, the way the dust turns) and the frame goes yellow for a moment; one
// that hits a tumbleweed breaks it into twigs (render/effects.js, twigs).

import * as THREE from 'three';
import { withAtmosphere, withSunMask, compileObjects, atmo } from './atmosphere.js';
import { MARK, styleU } from './style.js';
import { twistU, TWIST_PARS } from './twist.js';
import { BOARD, POLE, DEVIL, WEED, DESERT, weedAt, weedGap, slopeAt } from '../world/desertplan.js';
import { mulberry32, hash3 } from '../world/cavernplan.js';

// reach: how far off (m) the desert may be for any of it to be worked out; boards:
// how far off one is drawn (m) and how many there are room for; poles: how far off
// at each tier (m) and how many; spans: the wires' points between two poles; wireRange:
// how far from the lens a pole has its wires (m); sag: how far a wire hangs at its
// middle (m); devils: how many are drawn at once, how far off
// (m), and the share of their points the middle tier draws; weeds: how many at once;
// wash: how far the frame goes toward the dust's colour in a devil; wood: the poles'
// bleached wood and the billboards' (sRGB); weed: a tumbleweed's twigs (sRGB); dust: a
// dust devil's (sRGB).
export const DESERT_VIEW = {
  reach: 2200,
  boards: { range: 1600, max: 4 },
  poles: { range: { high: 1200, mid: 600, low: 0 }, max: 60 },
  spans: 8,
  wireRange: 400,
  sag: 0.55,
  devils: { max: 3, range: 2000, mid: 0.5 },
  weeds: 6,
  wash: 0.32,
  wood: 0xc2b6a0,
  boardWood: 0x8c8274,
  weed: [0x9a8058, 0x7d6a48, 0xa8916a],
  dust: 0xcfae80,
};

const lin = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

// --- geometry -------------------------------------------------------------------------

// Boxes [cx, cy, cz, sx, sy, sz, colour] into the arrays of a geometry: flat faces, a colour to each box.
function addBoxes(list, pos, nrm, col, idx) {
  for (const [cx, cy, cz, sx, sy, sz, hex] of list) {
    const c = typeof hex === 'number' ? lin(hex) : hex;
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const faces = [
      [[1, 0, 0], [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]], 0.85],
      [[-1, 0, 0], [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]], 0.85],
      [[0, 1, 0], [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]], 1.05],
      [[0, -1, 0], [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]], 0.6],
      [[0, 0, 1], [[hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [-hx, -hy, hz]], 0.95],
      [[0, 0, -1], [[-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz]], 0.95],
    ];
    for (const [n, v, k] of faces) {
      const b = pos.length / 3;
      for (const p of v) {
        pos.push(cx + p[0], cy + p[1], cz + p[2]);
        nrm.push(n[0], n[1], n[2]);
        col.push(c.r * k, c.g * k, c.b * k);
      }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
}

function geometryOf(pos, nrm, col, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// A smooth noise of a square's cells (0 to 1), for where the paint has peeled.
function cellNoise(u, v, seed) {
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const su = fu * fu * (3 - 2 * fu);
  const sv = fv * fv * (3 - 2 * fv);
  const h = (a, b) => hash3(a, b, seed);
  return (h(i, j) * (1 - su) + h(i + 1, j) * su) * (1 - sv) + (h(i, j + 1) * (1 - su) + h(i + 1, j + 1) * su) * sv;
}

// The paint of a billboard's face at (u, v) (0 to 1 across and up): the blocks of colour of an
// advertisement long gone (no letters), faded toward the cream it was laid on, the grey wood
// showing where the paint has come off, and the dirt of years down from its foot.
const CREAM = lin(0xd9ccb0);
const BARE = lin(0x8e8577);
const PAINTS = [
  [lin(0xb4523c), lin(0x3f6d8e), lin(0xd8a43a)],
  [lin(0x4f8a84), lin(0xc0703a), lin(0x7a5a8a)],
];
function boardPaint(face, u, v) {
  const [a, b, c] = PAINTS[face];
  let col = CREAM.clone();
  if (face === 0) {
    if (u < 0.46 && v > 0.28) col = a.clone();
    if (v < 0.2) col = b.clone();
    if (Math.hypot((u - 0.73) * 2, v - 0.6) < 0.22) col = c.clone();
  } else {
    if (v > 0.74) col = a.clone();
    if (u > 0.55 && v < 0.74 && v > 0.12) col = b.clone();
    if (Math.hypot((u - 0.25) * 2, v - 0.42) < 0.18) col = c.clone();
  }
  col.lerp(CREAM, 0.42);
  const peel = 0.65 * cellNoise(u * 7, v * 3.5, 91 + face) + 0.35 * cellNoise(u * 19, v * 9, 92 + face);
  if (peel > 0.6) col.lerp(BARE, Math.min(1, (peel - 0.6) / 0.06));
  const dirt = Math.max(0, 0.28 - v) / 0.28;
  col.multiplyScalar(1 - 0.25 * dirt - 0.08 * cellNoise(u * 40, v * 2, 93 + face));
  return col;
}

// A billboard: two posts, a stringer, and a panel whose two faces are each a grid of
// vertices painted with boardPaint. Its face (0) looks along +z, the other along -z.
function boardGeometry() {
  const B = BOARD;
  const pos = [];
  const nrm = [];
  const col = [];
  const idx = [];
  const wood = DESERT_VIEW.boardWood;
  const top = B.lift + B.height;
  for (const x of [-B.post / 2, B.post / 2]) addBoxes([[x, (top - 0.9) / 2, -0.2, 0.26, top + 0.9, 0.26, wood]], pos, nrm, col, idx);
  addBoxes([[0, B.lift - 0.2, -0.2, B.post + 0.6, 0.16, 0.12, wood]], pos, nrm, col, idx);
  // The panel's edges.
  addBoxes([[0, B.lift + B.height / 2, 0, B.width, B.height, 0.1, wood]], pos, nrm, col, idx);
  // Its two faces, a little proud of the edges.
  const nu = 32;
  const nv = 16;
  for (const face of [0, 1]) {
    const z = face === 0 ? 0.052 : -0.052;
    const base = pos.length / 3;
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const u = i / nu;
        const v = j / nv;
        const x = (face === 0 ? u - 0.5 : 0.5 - u) * B.width;
        pos.push(x, B.lift + v * B.height, z);
        nrm.push(0, 0, face === 0 ? 1 : -1);
        const c = boardPaint(face, u, v);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = base + j * (nu + 1) + i;
        idx.push(a, a + 1, a + nu + 2, a, a + nu + 2, a + nu + 1);
      }
    }
  }
  return geometryOf(pos, nrm, col, idx);
}

// The points a pole's wires hang from, in its own frame (x across the road, y up).
const ARM = [[-1.0, -0.43], [0, 0.16], [1.0, -0.43]];

// A telegraph pole: the post, its crossarm across the road, three insulators.
function poleGeometry() {
  const P = POLE;
  const pos = [];
  const nrm = [];
  const col = [];
  const idx = [];
  const wood = DESERT_VIEW.wood;
  addBoxes([
    [0, (P.tall - 0.8) / 2, 0, 0.24, P.tall + 0.8, 0.24, wood],
    [0, P.tall - 0.55, 0, 2.5, 0.13, 0.13, wood],
  ], pos, nrm, col, idx);
  for (const [x, y] of ARM) addBoxes([[x, P.tall + y - 0.08, 0, 0.09, 0.18, 0.09, 0x7d8a86]], pos, nrm, col, idx);
  return geometryOf(pos, nrm, col, idx);
}

// A tumbleweed: thirty-six dry twigs, each a thin three-sided stick on a chord of a
// ball of WEED.size across. In the block style it is a box.
function weedGeometry() {
  const rand = mulberry32(0x7b11);
  const R = WEED.size / 2;
  const pos = [];
  const nrm = [];
  const col = [];
  const idx = [];
  const onBall = () => {
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z) * R * (0.8 + 0.2 * rand());
    return new THREE.Vector3(Math.cos(a) * r, z * R, Math.sin(a) * r);
  };
  const up = new THREE.Vector3();
  const s1 = new THREE.Vector3();
  const s2 = new THREE.Vector3();
  for (let t = 0; t < 36; t++) {
    const a = onBall();
    const b = onBall();
    const d = b.clone().sub(a).normalize();
    up.set(Math.abs(d.y) < 0.9 ? 0 : 1, Math.abs(d.y) < 0.9 ? 1 : 0, 0);
    s1.crossVectors(d, up).normalize();
    s2.crossVectors(d, s1).normalize();
    const w = 0.016;
    const c = lin(DESERT_VIEW.weed[t % 3]);
    const base = pos.length / 3;
    for (let k = 0; k < 3; k++) {
      const ang = (k / 3) * Math.PI * 2;
      const off = s1.clone().multiplyScalar(Math.cos(ang) * w).addScaledVector(s2, Math.sin(ang) * w);
      for (const end of [a, b]) {
        const p = end.clone().add(off);
        pos.push(p.x, p.y, p.z);
        const n = off.clone().normalize();
        nrm.push(n.x, n.y, n.z);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let k = 0; k < 3; k++) {
      const i0 = base + k * 2;
      const i1 = base + ((k + 1) % 3) * 2;
      idx.push(i0, i0 + 1, i1 + 1, i0, i1 + 1, i1);
    }
  }
  return geometryOf(pos, nrm, col, idx);
}

function weedBoxGeometry() {
  const pos = [];
  const nrm = [];
  const col = [];
  const idx = [];
  addBoxes([[0, 0, 0, WEED.size * 0.85, WEED.size * 0.85, WEED.size * 0.85, DESERT_VIEW.weed[0]]], pos, nrm, col, idx);
  return geometryOf(pos, nrm, col, idx);
}

function litMaterial(key, mark) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  mat.customProgramCacheKey = () => key;
  mat.userData.mark = mark;
  return withSunMask(withAtmosphere(mat), false);
}

function instanced(geometry, material, max, scene, colours = false) {
  const m = new THREE.InstancedMesh(geometry, material, max);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (colours) {
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  m.frustumCulled = false;
  m.castShadow = false;
  m.receiveShadow = false;
  m.count = 0;
  m.visible = false;
  scene.add(m);
  return m;
}

// --- the dust devils' points ------------------------------------------------------------

const DEVILS = DESERT_VIEW.devils.max;
const PER = DEVIL.points;

function devilMaterial() {
  const D = DEVIL;
  const c = lin(DESERT_VIEW.dust);
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      ...twistU,
      uPair: styleU.uPair,
      uPaintInv: styleU.uPaintInv,
      fogParams: atmo.fogParams,
      uBlock: { value: 0 },
      uPx: { value: 700 },
      uShare: { value: 1 },
      uLight: { value: new THREE.Color(1, 1, 1) },
      uDevil: { value: Array.from({ length: DEVILS }, () => new THREE.Vector4()) },
      uAge: { value: Array.from({ length: DEVILS }, () => new THREE.Vector4()) },
    },
    vertexShader: /* glsl */`
${TWIST_PARS}
attribute vec4 aInfo;     // the devil (0 to ${DEVILS - 1}), how far up its column (0 to 1), two draws of its own
uniform vec4 uDevil[${DEVILS}];   // where its foot is (local), and how much of it there is (0: none)
uniform vec4 uAge[${DEVILS}];     // how long it has been going (s), a draw of its own
uniform float uPx;
uniform float uShare;
uniform vec3 fogParams;
varying float vAlpha;
void main() {
  int k = int( aInfo.x + 0.5 );
  vec4 dv = uDevil[ k ];
  vec4 ag = uAge[ k ];
  float hn = pow( aInfo.y, 1.25 );
  float h = hn * ${D.height.toFixed(1)};
  float r = mix( ${D.radius[0].toFixed(2)}, ${D.radius[1].toFixed(2)}, pow( hn, 1.6 ) ) * ( 0.75 + 0.5 * aInfo.z );
  // Faster round at its foot than at its top; its axis swings, more the higher.
  float spin = ag.x * ( 2.6 - 1.5 * hn ) + aInfo.w * 6.2832;
  vec2 sway = vec2( sin( ag.x * 0.37 + ag.y * 6.0 + hn * 2.1 ), cos( ag.x * 0.29 + ag.y * 4.0 + hn * 1.7 ) ) * 3.2 * hn * hn;
  vec3 p = vec3( dv.x + sway.x + cos( spin ) * r, dv.y + h - 0.3, dv.z + sway.y + sin( spin ) * r );
  vec4 mv = viewMatrix * vec4( p, 1.0 );
  gl_Position = projectionMatrix * twistView( mv );
  float d = max( -mv.z, 1.0 );
  float size = mix( 1.3, 4.2, hn ) * ( 0.7 + 0.6 * aInfo.z );
  gl_PointSize = dv.w > 0.0 && aInfo.y <= uShare ? clamp( size * uPx / d, 1.0, 96.0 ) : 0.0;
  vAlpha = dv.w * 0.3 * ( 1.0 - 0.65 * hn ) * exp( -d * fogParams.x * 1.5 );
}`,
    fragmentShader: /* glsl */`
uniform float uPair;
uniform float uPaintInv;
uniform float uBlock;
uniform vec3 uLight;
varying float vAlpha;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float r = length( q );
  float m = 1.0;
  if ( uBlock < 0.5 ) {
    if ( r > 0.5 ) discard;
    m = smoothstep( 0.5, 0.05, r );
    // The painted style's: a flat disc.
    m = mix( m, step( r, 0.4 ) * 0.8, uPair );
  }
  float a = vAlpha * m;
  vec3 c = vec3( ${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)} );
  vec3 lit = mix( c * uLight, c * 0.9 * uPaintInv, uPair );
  gl_FragColor = vec4( lit * a, a );
}`,
  });
}

class Devils {
  constructor(scene) {
    this.scene = scene;
    const geo = new THREE.BufferGeometry();
    const info = new Float32Array(DEVILS * PER * 4);
    const rand = mulberry32(0xd3e1);
    for (let k = 0; k < DEVILS; k++) {
      for (let i = 0; i < PER; i++) {
        const o = (k * PER + i) * 4;
        info[o] = k;
        info[o + 1] = (i + 0.5) / PER;
        info[o + 2] = rand();
        info[o + 3] = rand();
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DEVILS * PER * 3), 3));
    geo.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.material = devilMaterial();
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.points.visible = false;
    scene.add(this.points);
    this.count = 0;
  }

  // list: the devils near (DesertPlan.devilsAt), each with its ground (y, local) and its local x, z.
  set(list, share, light, blocks, px) {
    const u = this.material.uniforms;
    let n = 0;
    for (const e of list) {
      if (n >= DEVILS) break;
      u.uDevil.value[n].set(e.lx, e.y, e.lz, e.fade);
      u.uAge.value[n].set(e.age, hash3(e.d.t0 | 0, 5, 0), 0, 0);
      n++;
    }
    for (let k = n; k < DEVILS; k++) u.uDevil.value[k].w = 0;
    this.count = n;
    u.uShare.value = share;
    u.uLight.value.copy(light);
    u.uBlock.value = blocks;
    u.uPx.value = px;
    this.points.visible = n > 0;
  }

  hide() {
    this.points.visible = false;
    this.count = 0;
  }

  dispose() {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

// --- the whole ----------------------------------------------------------------------------

export class Desert {
  // env: plan (DesertPlan), road, worlds, dust (the tyres' particles, for the twigs), sun and
  // hemi (the atmosphere's lights, for the dust's light); tier: the one to begin with.
  constructor(scene, env, tier = 'high') {
    this.env = env;
    this.scene = scene;
    this.tier = tier;
    this.propMaterial = litMaterial('continuum-desertprops', MARK.built);
    this.weedMaterial = litMaterial('continuum-desertweed', MARK.leaf);
    this.boards = instanced(boardGeometry(), this.propMaterial, DESERT_VIEW.boards.max, scene, true);
    this.poles = instanced(poleGeometry(), this.propMaterial, DESERT_VIEW.poles.max, scene, true);
    this.weeds = instanced(weedGeometry(), this.weedMaterial, DESERT_VIEW.weeds, scene);
    this.weedBoxes = instanced(weedBoxGeometry(), this.weedMaterial, DESERT_VIEW.weeds, scene);
    // The wires: line segments between the poles, three to a span.
    const wires = DESERT_VIEW.poles.max * 3 * DESERT_VIEW.spans * 2;
    const wgeo = new THREE.BufferGeometry();
    wgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wires * 3), 3).setUsage(THREE.DynamicDrawUsage));
    wgeo.setDrawRange(0, 0);
    wgeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.wireMaterial = new THREE.LineBasicMaterial({ color: lin(0x4a4239), fog: true });
    this.wireMaterial.userData.mark = MARK.built;
    // (The haze as everything else has it: the atmosphere's numbers.)
    this.wireMaterial.onBeforeCompile = (shader) => Object.assign(shader.uniforms, atmo);
    this.wireMaterial.customProgramCacheKey = () => 'continuum-desertwires';
    this.wires = new THREE.LineSegments(wgeo, this.wireMaterial);
    this.wires.frustumCulled = false;
    this.wires.visible = false;
    scene.add(this.wires);
    this.devils = new Devils(scene);

    this.on = false;          // the desert is in reach
    this.clock = 0;           // s
    this.haze = 0;            // how much heat haze (0 to 1), before the style's share of it
    this.wash = 0;            // how far the frame is washed toward the dust (0 to the most)
    this.devilsNear = [];         // the dust devils within DESERT_VIEW.devils.range of the lens
    this.boardList = [];      // the billboards drawn
    this.poleList = [];       // the poles drawn
    this.weedList = [];       // the tumbleweeds on their way: { w, t0, met, x, y, z (local) }
    this.met = 0;             // tumbleweeds that have crossed the road near the car
    this.broken = 0;          // tumbleweeds the car has broken
    this.pushes = 0;          // times the car has been in a dust devil
    this._weed = { n: 1, next: null };
    this._push = null;        // { t (s left), k (m/s² to the car's left) }
    this._inDevil = false;
    this._keyB = '';
    this._keyP = '';
    this._dirty = true;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._axis = new THREE.Vector3();
    this._c = new THREE.Color();
    this._light = new THREE.Color();
    this._at = {};
    this._list = [];
    this._seed = env.plan.seed;
  }

  setTier(t) {
    this.tier = t;
    this._dirty = true;
  }

  // The floating origin has moved.
  shift() {
    this._dirty = true;
  }

  // How much of the world under a look ({ a, b, t }) is the desert's.
  static share(at) {
    if (!at || at.a < 0) return 0;
    const t = at.a === at.b ? 0 : at.t;
    return (at.a === DESERT ? 1 - t : 0) + (at.b === DESERT ? t : 0);
  }

  _hide() {
    for (const m of [this.boards, this.poles, this.weeds, this.weedBoxes, this.wires]) m.visible = false;
    this.devils.hide();
    this.boardList = [];
    this.poleList = [];
    this.weedList = [];
    this.devilsNear = [];
    this._keyB = '';
    this._keyP = '';
    this.haze = 0;
  }

  // Every frame. dt: s (0 in the photo mode: the world stands still); camera; ctx: { at (the look
  // under the lens), sCar, car (the car's state, local), blocks (0 to 1: how far the style is the
  // block's), px (the pixels a metre makes at a metre), settle (the world stands still: what is
  // still to be found is found at once) }.
  update(camera, dt, ctx) {
    const plan = this.env.plan;
    const o = this.env.road.origin;
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    this.on = this.env.worlds.reaches(ax, az, DESERT_VIEW.reach, (w) => w.id === 'desert');
    this.clock += dt;
    const tier = this.tier;
    if (!this.on || tier === 'low') {
      if (this.boards.visible || this.poles.visible || this.devils.points.visible || this.weedList.length || this.haze) this._hide();
      this.wash = Math.max(0, this.wash - dt * 2);
      this._push = null;
      this._inDevil = false;
      return;
    }
    if ((this._frames = (this._frames || 0) + 1) % 600 === 0) plan.prune(ctx.sCar, ax, az);
    const settle = !!ctx.settle;
    const share = Desert.share(ctx.at);
    this.haze = share;
    this._boards(camera, ctx.sCar, settle);
    this._poles(camera, ctx.sCar, tier, settle);
    this._devils(camera, dt, ctx, tier);
    this._weeds(camera, dt, ctx, share, settle);
  }

  _boards(camera, sCar, settle) {
    const plan = this.env.plan;
    const o = this.env.road.origin;
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    const E = BOARD.every;
    const have = [];
    let looked = 0;
    for (let k = Math.floor((sCar - 1600) / E); k <= Math.floor((sCar + 1900) / E); k++) {
      if (!settle && !plan.boards.has(k) && looked++ > 0) continue;
      const b = plan.board(k);
      if (b && Math.hypot(b.ax - ax, b.az - az) < DESERT_VIEW.boards.range && have.length < DESERT_VIEW.boards.max) have.push(b);
    }
    const key = have.map((b) => b.k).join(',');
    if (key === this._keyB && !this._dirty) return;
    this._keyB = key;
    const m = this._m;
    const c = this._c;
    have.forEach((b, i) => {
      const yaw = Math.atan2(b.nx, b.nz) + (b.face ? Math.PI : 0);
      this._q.setFromAxisAngle(this._axis.set(0, 1, 0), yaw);
      m.compose(this._v.set(b.ax - o.x, b.y, b.az - o.z), this._q, this._s.set(1, 1, 1));
      this.boards.setMatrixAt(i, m);
      // Faded a little warmer or a little cooler, one from the next.
      c.setRGB(0.92 + 0.08 * b.tint, 0.94, 1.0 - 0.08 * b.tint);
      this.boards.setColorAt(i, c);
    });
    this.boards.count = have.length;
    this.boards.instanceMatrix.needsUpdate = true;
    this.boards.instanceColor.needsUpdate = true;
    this.boards.visible = have.length > 0;
    this.boardList = have;
  }

  _poles(camera, sCar, tier, settle) {
    const plan = this.env.plan;
    const o = this.env.road.origin;
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    const range = DESERT_VIEW.poles.range[tier] || 0;
    const E = POLE.every;
    const have = [];
    let fresh = 0;
    for (let k = Math.floor((sCar - range) / E); k <= Math.ceil((sCar + range) / E); k++) {
      if (!settle && !plan.poles.has(k) && fresh++ > 8) continue;
      const p = plan.pole(k);
      if (p && Math.hypot(p.ax - ax, p.az - az) < range && have.length < DESERT_VIEW.poles.max) have.push(p);
    }
    const key = have.length ? `${have[0].k}-${have[have.length - 1].k}-${have.length}-${tier}` : '';
    if (key === this._keyP && !this._dirty) return;
    this._keyP = key;
    this._dirty = false;
    const m = this._m;
    const c = this._c;
    const pos = this.wires.geometry.attributes.position;
    const arr = pos.array;
    let w = 0;
    const S = DESERT_VIEW.spans;
    const ends = (p, j, out) => {
      // Where wire j hangs from on pole p: its crossarm is square to the road.
      const nx = -Math.sin(p.theta);
      const nz = Math.cos(p.theta);
      out[0] = p.ax - o.x + nx * ARM[j][0];
      out[1] = p.y + POLE.tall + ARM[j][1];
      out[2] = p.az - o.z + nz * ARM[j][0];
      return out;
    };
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    have.forEach((p, i) => {
      // (Its own x, the crossarm, across the road: to the road's left, (-sin, cos) of its heading.)
      this._e.set(p.lean[0], Math.atan2(-Math.cos(p.theta), -Math.sin(p.theta)), p.lean[1], 'YXZ');
      this._q.setFromEuler(this._e);
      m.compose(this._v.set(p.ax - o.x, p.y, p.az - o.z), this._q, this._s.set(1, 1, 1));
      this.poles.setMatrixAt(i, m);
      const g = 0.94 + 0.06 * hash3(p.k, 85, this._seed);
      this.poles.setColorAt(i, c.setRGB(g, g, g));
      const q = have[i + 1];
      if (!q || q.k !== p.k + 1 || q.side !== p.side) return;
      // (A wire is a line a pixel wide however far off it is: only the spans near the lens have them.)
      if (Math.hypot(p.ax - ax, p.az - az) > DESERT_VIEW.wireRange) return;
      for (let j = 0; j < 3; j++) {
        ends(p, j, a);
        ends(q, j, b);
        for (let t = 0; t < S; t++) {
          for (const f of [t / S, (t + 1) / S]) {
            arr[w++] = a[0] + (b[0] - a[0]) * f;
            arr[w++] = a[1] + (b[1] - a[1]) * f - 4 * DESERT_VIEW.sag * f * (1 - f);
            arr[w++] = a[2] + (b[2] - a[2]) * f;
          }
        }
      }
    });
    this.poles.count = have.length;
    this.poles.instanceMatrix.needsUpdate = true;
    if (this.poles.instanceColor) this.poles.instanceColor.needsUpdate = true;
    this.poles.visible = have.length > 0;
    pos.needsUpdate = true;
    this.wires.geometry.setDrawRange(0, w / 3);
    this.wires.visible = w > 0;
    this.poleList = have;
  }

  // The light a dust devil's dust is in (linear), from the sky's and the sun's.
  _dustLight() {
    const L = this._light;
    const sun = this.env.sun;
    const hemi = this.env.hemi;
    L.setRGB(0, 0, 0);
    if (hemi) L.copy(hemi.color).multiplyScalar(hemi.intensity + atmo.uEnvScale.value * 0.8);
    if (sun) {
      const k = sun.intensity * 0.45;
      L.setRGB(L.r + sun.color.r * k, L.g + sun.color.g * k, L.b + sun.color.b * k);
    }
    return L.multiplyScalar(1 / Math.PI);
  }

  _devils(camera, dt, ctx, tier) {
    const plan = this.env.plan;
    const o = this.env.road.origin;
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    const list = plan.devilsAt(this.clock, ax, az, DESERT_VIEW.devils.range, this._list);
    // The nearest first; each on its ground, and the desert's own (drawn by its own draw).
    list.sort((p, q) => (p.x - ax) ** 2 + (p.z - az) ** 2 - ((q.x - ax) ** 2 + (q.z - az) ** 2));
    const shown = [];
    for (const e of list) {
      // (Where the road has since cut the ground under its way, it is not there.)
      if (slopeAt(plan._h, e.x, e.z) >= DEVIL.slope) continue;
      e.y = plan._h(e.x, e.z);
      e.lx = e.x - o.x;
      e.lz = e.z - o.z;
      shown.push(e);
    }
    this.devilsNear = shown;
    this.devils.set(shown, tier === 'mid' ? DESERT_VIEW.devils.mid : 1, this._dustLight(), ctx.blocks || 0, ctx.px || 700);
    // The car in one: the frame washed toward the dust, and a push the way it turns.
    const car = ctx.car;
    let inside = 0;
    let push = 0;
    if (car) {
      const cx = car.x + o.x;
      const cz = car.z + o.z;
      for (const e of shown) {
        const dx = cx - e.x;
        const dz = cz - e.z;
        const d = Math.hypot(dx, dz);
        if (d < DEVIL.reach && e.fade > 0.2) {
          inside = Math.max(inside, e.fade * (1 - d / DEVIL.reach * 0.5));
          // It turns anticlockwise seen from above: the way round at the car, to the car's left or right.
          const tx = -dz / (d || 1);
          const tz = dx / (d || 1);
          push = Math.sign(tx * -Math.sin(car.yaw) + tz * Math.cos(car.yaw)) || 1;
        }
      }
    }
    if (inside > 0 && !this._inDevil) {
      this._push = { t: DEVIL.push[1], k: DEVIL.push[0] * push };
      this.pushes++;
    }
    this._inDevil = inside > 0;
    const want = inside * DESERT_VIEW.wash;
    this.wash += (want - this.wash) * Math.min(1, dt * (want > this.wash ? 6 : 1.6));
    if (dt === 0) this.wash = want;
  }

  // The push of a dust devil on the car, for a step of the physics of dt: the change of its
  // sideways speed (m/s, to its left), or 0.
  pushStep(dt) {
    const p = this._push;
    if (!p) return 0;
    const t = Math.min(dt, p.t);
    p.t -= dt;
    if (p.t <= 0) this._push = null;
    return p.k * t;
  }

  _weeds(camera, dt, ctx, share, settle) {
    const plan = this.env.plan;
    const o = this.env.road.origin;
    const d = this._weed;
    const car = ctx.car;
    // A new one now and then, while the car is in the desert and the world goes on.
    if (d.next === null) d.next = this.clock + weedGap(d.n, this._seed) * 0.5;
    if (!settle && dt > 0 && this.clock >= d.next) {
      if (share >= 0.5 && car && this.weedList.length < DESERT_VIEW.weeds) {
        const w = plan.weed(d.n, ctx.sCar, car.speed || 0);
        if (w) this.weedList.push({ w, t0: this.clock, met: false });
      }
      d.n++;
      d.next = Math.max(d.next + weedGap(d.n, this._seed), this.clock);
    }
    const m = this._m;
    const at = this._at;
    const blocky = (ctx.blocks || 0) > 0.5;
    const mesh = blocky ? this.weeds : this.weedBoxes;
    mesh.visible = false;
    const draw = blocky ? this.weedBoxes : this.weeds;
    let n = 0;
    const keep = [];
    for (const e of this.weedList) {
      weedAt(e.w, this.clock - e.t0, at);
      if (at.done) continue;
      const y = plan._h(at.x, at.z) + at.y;
      e.x = at.x - o.x;
      e.y = y;
      e.z = at.z - o.z;
      // Across the road near the car: met.
      if (!e.met && (this.clock - e.t0) * e.w.speed >= e.w.at && Math.abs(e.w.cross - ctx.sCar) < WEED.met) {
        e.met = true;
        this.met++;
      }
      // Hit: broken into twigs.
      if (car && Math.hypot(car.x - e.x, car.z - e.z) < WEED.hit && Math.abs((car.y || 0) + 0.6 - y) < 1.6) {
        this.broken++;
        if (this.env.dust) {
          const cy = Math.cos(car.yaw);
          const sy = Math.sin(car.yaw);
          this.env.dust.twigs(e.x, y, e.z, car.vx * cy - car.vy * sy, car.vx * sy + car.vy * cy);
        }
        continue;
      }
      keep.push(e);
      this._axis.set(e.w.dz, 0, -e.w.dx);
      this._q.setFromAxisAngle(this._axis, at.roll + e.w.phase * 6.28);
      m.compose(this._v.set(e.x, y, e.z), this._q, this._s.set(1, 1, 1));
      draw.setMatrixAt(n++, m);
    }
    this.weedList = keep;
    draw.count = n;
    draw.instanceMatrix.needsUpdate = true;
    draw.visible = n > 0;
  }

  // The things a car off the road runs into, as [x, z, radius, ...] (absolute) added to out:
  // the billboards' posts and the poles.
  near(ax, az, range, out) {
    for (const b of this.boardList) {
      for (const s of [-0.5, 0.5]) {
        const x = b.ax - b.nz * BOARD.post * s;
        const z = b.az + b.nx * BOARD.post * s;
        if ((x - ax) ** 2 + (z - az) ** 2 < (range + 0.2) ** 2) out.push(x, z, 0.2);
      }
    }
    for (const p of this.poleList) {
      if ((p.ax - ax) ** 2 + (p.az - az) ** 2 < (range + 0.2) ** 2) out.push(p.ax, p.az, 0.18);
    }
    return out;
  }

  // The meshes whose programs are built ahead.
  _meshes() {
    return [this.boards, this.weeds, this.devils.points, this.wires];
  }

  warm(renderer, scene, camera) {
    return compileObjects(renderer, scene, camera, this._meshes());
  }

  stats() {
    return {
      on: this.on, tier: this.tier, haze: this.haze, wash: this.wash, boards: this.boardList.length, poles: this.poleList.length,
      wires: this.wires.visible ? this.wires.geometry.drawRange.count / 2 : 0,
      devils: this.devilsNear.map((e) => ({ x: e.x, z: e.z, fade: e.fade, age: e.age })), devilPoints: this.devils.count,
      weeds: this.weedList.length, met: this.met, broken: this.broken, pushes: this.pushes, clock: this.clock,
    };
  }

  dispose() {
    for (const m of [this.boards, this.poles, this.weeds, this.weedBoxes]) {
      this.scene.remove(m);
      m.geometry.dispose();
      m.dispose();
    }
    this.scene.remove(this.wires);
    this.wires.geometry.dispose();
    this.wireMaterial.dispose();
    this.propMaterial.dispose();
    this.weedMaterial.dispose();
    this.devils.dispose();
  }
}
