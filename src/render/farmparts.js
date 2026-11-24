// What the hills' dry-stone walls and utility poles are made of: stones, boards and glass, as flat-shaded
// boxes and prisms with a colour each, and the materials they and the wires are drawn with (render/stonewalls.js,
// render/powerlines.js).
//
// The block style has them as boxes: a wall of stones is boxes already, a pole is a square post.

import * as THREE from 'three';
import { WALL, POLE } from '../world/hillsplan.js';
import { withAtmosphere, withSunMask } from './atmosphere.js';
import { MARK } from './style.js';

const srgb = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

// The stones of a wall (sRGB): grey and tan limestone, some darker, some lighter.
const STONES = [0x8d887d, 0x9b9484, 0x7b776d, 0xa39a86, 0x6f6c63, 0xb0a891];
const WOOD = 0x6b5239;
const ARM = 0x4d3a28;
const GLASS = 0x93a3ad;

// A small deterministic random run, for the same stones each time.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pieces of one geometry: each has a colour, and a face is lit a little more or less by where it faces.
class Parts {
  constructor() {
    this.p = [];
    this.n = [];
    this.c = [];
  }

  face(a, b, c, d, nrm, col, k) {
    for (const q of [a, b, c, a, c, d]) {
      this.p.push(q[0], q[1], q[2]);
      this.n.push(nrm[0], nrm[1], nrm[2]);
      this.c.push(col.r * k, col.g * k, col.b * k);
    }
  }

  // A box about (cx, cy, cz), x by y by z, turned by yaw about y and then by tilt about z (x to y), without a bottom.
  box(cx, cy, cz, sx, sy, sz, hex, yaw = 0, tilt = 0, bottom = false) {
    const col = srgb(hex);
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const cy1 = Math.cos(yaw);
    const sy1 = Math.sin(yaw);
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    const at = (x, y, z) => {
      const x1 = x * ct - y * st;
      const y1 = x * st + y * ct;
      return [cx + x1 * cy1 + z * sy1, cy + y1, cz - x1 * sy1 + z * cy1];
    };
    const dir = (x, y, z) => {
      const x1 = x * ct - y * st;
      const y1 = x * st + y * ct;
      return [x1 * cy1 + z * sy1, y1, -x1 * sy1 + z * cy1];
    };
    const v = (x, y, z) => at(x * hx, y * hy, z * hz);
    const faces = [
      [[1, 0, 0], [v(1, -1, -1), v(1, 1, -1), v(1, 1, 1), v(1, -1, 1)], 0.8],
      [[-1, 0, 0], [v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1), v(-1, -1, -1)], 0.8],
      [[0, 1, 0], [v(-1, 1, -1), v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1)], 1.12],
      [[0, 0, 1], [v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)], 0.9],
      [[0, 0, -1], [v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1)], 0.9],
    ];
    if (bottom) faces.push([[0, -1, 0], [v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1)], 0.6]);
    for (const [nrm, q, k] of faces) this.face(q[0], q[1], q[2], q[3], dir(...nrm), col, k);
  }

  // A tapered prism of `sides` sides standing on y0, r0 wide at the foot and r1 at the top, with a cap.
  prism(cx, y0, cz, r0, r1, h, sides, hex) {
    const col = srgb(hex);
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const lo0 = [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0];
      const lo1 = [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0];
      const hi0 = [cx + Math.cos(a0) * r1, y0 + h, cz + Math.sin(a0) * r1];
      const hi1 = [cx + Math.cos(a1) * r1, y0 + h, cz + Math.sin(a1) * r1];
      this.face(lo1, lo0, hi0, hi1, [Math.cos(am), 0.05, Math.sin(am)], col, 0.8 + 0.3 * Math.cos(am - 0.9));
      this.p.push(cx, y0 + h, cz, hi1[0], hi1[1], hi1[2], hi0[0], hi0[1], hi0[2]);
      for (let k = 0; k < 3; k++) {
        this.n.push(0, 1, 0);
        this.c.push(col.r * 1.1, col.g * 1.1, col.b * 1.1);
      }
    }
  }

  done() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

// A piece of wall: along z, `unit` m long, its foot 15 cm into the ground (y = 0), 1.1 m high and half a metre across, laid
// in two courses of stones, each broken over the joints of the one under it, with a cope of stones stood on edge along the top.
export function wallGeometry() {
  const U = WALL.unit;
  const T = WALL.thick;
  const rand = seeded(0x57a11);
  const b = new Parts();
  // A course of n stones from y0 up h, each a little different in length, height and width.
  const course = (n, y0, h, width) => {
    let z = -U / 2;
    for (let i = 0; i < n; i++) {
      const len = (U / n) * (0.9 + 0.2 * rand());
      const run = Math.min(len, U / 2 - z);
      if (run <= 0.1) break;
      const hh = h * (0.92 + 0.16 * rand());
      const w = width * (0.9 + 0.2 * rand());
      b.box((rand() - 0.5) * 0.05, y0 + hh / 2, z + run / 2, w, hh, run * 0.985, STONES[Math.floor(rand() * STONES.length)], (rand() - 0.5) * 0.06);
      z += run;
    }
  };
  course(5, -0.15, 0.6, T);
  course(6, 0.4, 0.45, T * 0.92);
  // The cope: stones on edge, a little wider than the wall, each leaning a bit.
  for (let i = 0; i < 8; i++) {
    const len = U / 8;
    const h = 0.28 + 0.08 * rand();
    b.box((rand() - 0.5) * 0.04, 0.78 + h / 2, -U / 2 + len * (i + 0.5), T * (0.82 + 0.2 * rand()), h, len * 0.86, STONES[Math.floor(rand() * STONES.length)], (rand() - 0.5) * 0.1, (rand() - 0.5) * 0.12);
  }
  return b.done();
}

// A pole, 8 m of wood on y = 0 with a cross-arm near the top, two braces, and a glass insulator at each wire; its arm along x, the
// line along z. A square post in the block style.
export function poleGeometry(blocky = false) {
  const b = new Parts();
  const H = POLE.height;
  if (blocky) b.box(0, H / 2, 0, 0.3, H, 0.3, WOOD, 0, 0, true);
  else b.prism(0, 0, 0, 0.2, 0.13, H, 8, WOOD);
  const a = POLE.arm;
  b.box(0, a, 0, 2.3, 0.14, 0.16, ARM);
  b.box(0.55, a - 0.45, 0, 0.07, 1.0, 0.07, ARM, 0, -0.62);
  b.box(-0.55, a - 0.45, 0, 0.07, 1.0, 0.07, ARM, 0, 0.62);
  for (const [x, y] of POLE.wires) b.box(x, y - 0.1, 0, 0.1, 0.2, 0.1, GLASS);
  return b.done();
}

// The material of the walls and the poles: flat-shaded stone and wood, lit as what stands by the road is, so that the
// painted style gives it its flat paints.
export function farmMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  mat.customProgramCacheKey = () => 'continuum-farm';
  mat.userData.mark = MARK.built;
  return withSunMask(withAtmosphere(mat), false);
}

// The wires: a ribbon along each, across the way the lens looks at it, at least `px` pixels wide whatever the distance, so that it
// is a line and not a dotted one. The line is drawn in the scene's own coordinates; its width, and how it thins away toward the end of
// the range the poles are drawn to, are worked out in the vertex shader. A wire that is a pixel across is a good deal more than it is
// across, so far off it is laid in the colour of the air between (uWireAir: its colour, from where, to where, how much of it), as a
// wire that thin is seen, and the three of a span, a pixel or two apart there, are one (uWireJoin: from where, to where, how much of the
// way to the middle of the three): a line, not a lattice.
export const wireUniforms = {
  uWirePx: { value: 700 },
  uWire: { value: new THREE.Vector2(1.3, 0.016) },
  uWireRange: { value: POLE.range },
  uWireAir: { value: new THREE.Vector4(0.2, 0.22, 0.25, 0.8) },
  uWireFade: { value: new THREE.Vector2(40, 260) },
  uWireJoin: { value: new THREE.Vector3(70, 170, 0.9) },
};

export function wireMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x4a4743, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, wireUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 aDir;
attribute vec3 aMid;
attribute float aSide;
uniform float uWirePx;
uniform vec2 uWire;
uniform float uWireRange;
uniform vec2 uWireFade;
uniform vec3 uWireJoin;
varying float vWireAir;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec3 toEye = cameraPosition - position;
  float depth = max( - ( viewMatrix * vec4( position, 1.0 ) ).z, 0.1 );
  float w = max( uWire.y, uWire.x * depth / uWirePx );
  w *= 1.0 - smoothstep( uWireRange - 70.0, uWireRange, length( toEye.xz ) );
  vec3 across = cross( aDir, toEye );
  transformed = mix( transformed, aMid, uWireJoin.z * smoothstep( uWireJoin.x, uWireJoin.y, depth ) );
  transformed += normalize( across + vec3( 1e-6 ) ) * ( aSide * 0.5 * w );
  vWireAir = smoothstep( uWireFade.x, uWireFade.y, depth );
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec4 uWireAir;
varying float vWireAir;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  diffuseColor.rgb = mix( diffuseColor.rgb, uWireAir.rgb, uWireAir.a * vWireAir );`);
  };
  mat.customProgramCacheKey = () => 'continuum-wire';
  mat.userData.mark = MARK.built;
  return withSunMask(withAtmosphere(mat), false);
}
