// Structures by the road, each world's own: a chalet and a cairn in the
// mountains, windmills and a red barn over the hills, a pavilion by the
// river, a lighthouse on the coast, a pyramid in the desert, timber of a
// mine underground, spires and a gate in the inferno, columns on the sea
// floor, a temple in the sky, dishes and modules drifting by the road in
// space, a ruined house in the Upside Down. The city has its towers
// (render/city.js).
//
// They are laid by the road, not by the camera: the road is cut into cells
// of CELL metres, and a cell has a structure or not, and which, where and
// how it stands, from a hash of its number and the seed, so it is the same
// each time the car comes by. All of one kind are one instanced mesh. A
// structure is solid: a car off the road runs into it (Props.near), and an
// animal goes round it.
//
// The painted style draws the walls and roofs of the farmhouse, the barn and
// the windmill with their detail: rows of tiles, boards, plaster stained at the
// foot, the shade under the eaves, windows, shutters and a door. The geometry
// carries what the detail needs (see Parts.face), and the material works it
// out per pixel, in the structure's own metres; the other styles read none of it.

import * as THREE from 'three';
import { WORLDS } from '../world/worlds.js';
import { GROUND, HALF_FLAT } from '../world/road.js';
import { withAtmosphere, withSunMask } from './atmosphere.js';
import { MARK, pairProgram } from './style.js';

const CELL = 150;
const BEHIND = 160;
const AHEAD = 720;
const MAX = 20;       // of a kind, at a time

const srgb = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

function hash(a, b, seed) {
  let h = (Math.imul(a | 0, 0x8da6b343) ^ Math.imul(b | 0, 0xd8163841) ^ Math.imul(seed | 0, 0x2545f491)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return (h & 0xffffff) / 16777216;
}

// --- parts -------------------------------------------------------------------

// What a face is, for the painted style's detail: the number in a vertex's
// aPart. A face of a structure that is not drawn on (a chimney, a plinth, the
// sails, every face of the other worlds' structures) is trim, and the painted
// style draws it as it is. A wall has windows (a front also a door, in the
// middle of its width); a tower's are fewer and none in the lowest storey;
// boards are a barn's; a blank wall has no window. A roof has its tiles. What
// is hidden is what the painted style draws in its own way: the door and
// windows built into the structure's front, not drawn there.
const PART = { wall: 0, roof: 1, trim: 2, boards: 3, blank: 4, front: 5, tower: 6, towerFront: 7, hidden: 9 };

// The frame of a flat face in metres, for the detail laid on it: how far up
// the face (0 at its foot, or the eave of a roof, to 1 at its top, or the
// ridge) and how far along it from its middle, and the face's width and
// height. Up is the world's up taken into the face's plane, along runs to
// the right as the face is seen. A face that lies flat has none.
function surface(corners, n) {
  const l = Math.hypot(n[0], n[1], n[2]);
  const nx = n[0] / l;
  const ny = n[1] / l;
  const nz = n[2] / l;
  if (Math.abs(ny) > 0.95) return null;
  const ul = Math.hypot(-nx * ny, 1 - ny * ny, -nz * ny);
  const u = [-nx * ny / ul, (1 - ny * ny) / ul, -nz * ny / ul];
  const t = [u[1] * nz - u[2] * ny, u[2] * nx - u[0] * nz, u[0] * ny - u[1] * nx];
  const up = (p) => p[0] * u[0] + p[1] * u[1] + p[2] * u[2];
  const al = (p) => p[0] * t[0] + p[1] * t[1] + p[2] * t[2];
  const ups = corners.map(up);
  const als = corners.map(al);
  const lo = Math.min(...ups);
  const hi = Math.max(...ups);
  const a0 = Math.min(...als);
  const a1 = Math.max(...als);
  if (hi - lo < 1e-3 || a1 - a0 < 1e-3) return null;
  return { up: (p) => (up(p) - lo) / (hi - lo), along: (p) => al(p) - (a0 + a1) / 2, w: a1 - a0, h: hi - lo };
}

// Flat-shaded solids with a colour each; a face may glow (it lights itself),
// and a part may spin about a hub (a windmill's sails). A face may say what it
// is (part: PART), and what is known of it goes in the vertices for the
// painted style: aPart, aUp and aFace (how far up and along the face, in
// metres: its frame), aSize (the face's width and height, and a number of its
// own).
class Parts {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.glow = [];
    this.spin = [];
    this.hub = [];
    this.part = [];
    this.up = [];
    this.along = [];
    this.size = [];
    this.idx = [];
    this.n = 0;
    this.faces = 0;
  }

  face(corners, n, c, k, o = {}) {
    // The corners go round the way the face looks: reversed if they do not.
    const [a, b, d] = corners;
    const cx = (b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]);
    const cy = (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]);
    const cz = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) corners = corners.slice().reverse();
    const base = this.n;
    const want = o.part === undefined ? PART.trim : o.part;
    const frame = want === PART.trim || want === PART.hidden ? null : surface(corners, n);
    const part = frame ? want : want === PART.hidden ? want : PART.trim;
    const id = frame ? ++this.faces : 0;
    for (const p of corners) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(n[0], n[1], n[2]);
      this.col.push(c.r * k, c.g * k, c.b * k);
      this.glow.push(o.glow || 0);
      this.spin.push(o.hub ? 1 : 0);
      this.hub.push(...(o.hub || [0, 0, 0]));
      this.part.push(part);
      this.up.push(frame ? frame.up(p) : 0);
      this.along.push(frame ? frame.along(p) : 0);
      this.size.push(frame ? frame.w : 0, frame ? frame.h : 0, id);
    }
    this.n += corners.length;
    for (let i = 1; i < corners.length - 1; i++) this.idx.push(base, base + i, base + i + 1);
  }

  // A box standing on y0, centred on (cx, cz). Its sides are parts, +x, -x,
  // +z and -z in turn, as walls says (a part for all four, or a list of four);
  // or all six are the part given in o.
  box(cx, y0, cz, sx, sy, sz, hex, k = 1, o = {}) {
    const c = srgb(hex);
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;
    const y1 = y0 + sy;
    const w = o.walls === undefined ? [o.part, o.part, o.part, o.part] : Array.isArray(o.walls) ? o.walls : [o.walls, o.walls, o.walls, o.walls];
    const side = (i) => ({ ...o, part: w[i] });
    this.face([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0], c, k * 0.92, side(0));
    this.face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], c, k * 0.78, side(1));
    this.face([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [0, 1, 0], c, k * 1.08, o);
    this.face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], c, k, side(2));
    this.face([[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], [0, 0, -1], c, k * 0.84, side(3));
    this.face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], c, k * 0.6, o);
  }

  // A frustum of `sides` sides on y0: radius r0 at the foot, r1 at the top
  // (0: a cone); a quarter of a turn about y with `turn`. The side i is the
  // part o.part, or o.sides[i] where that is given.
  prism(cx, y0, cz, r0, r1, h, sides, hex, k = 1, o = {}) {
    const c = srgb(hex);
    const turn = o.turn || 0;
    const at = (i, r, y) => {
      const a = (i / sides) * Math.PI * 2 + turn;
      return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
    };
    for (let i = 0; i < sides; i++) {
      const j = i + 1;
      const am = ((i + 0.5) / sides) * Math.PI * 2 + turn;
      const slope = (r0 - r1) / Math.max(h, 1e-3);
      const n = [Math.cos(am), slope, Math.sin(am)];
      const shade = 0.78 + 0.3 * (0.5 + 0.5 * Math.cos(am - 0.9));
      const side = o.sides && o.sides[i] !== undefined ? { ...o, part: o.sides[i] } : o;
      if (r1 > 1e-4) this.face([at(i, r0, y0), at(j, r0, y0), at(j, r1, y0 + h), at(i, r1, y0 + h)], n, c, k * shade, side);
      else this.face([at(i, r0, y0), at(j, r0, y0), [cx, y0 + h, cz]], n, c, k * shade, side);
    }
    if (r1 > 1e-4) {
      const top = [];
      for (let i = 0; i < sides; i++) top.push(at(i, r1, y0 + h));
      this.face(top, [0, 1, 0], c, k * 1.08, o);
    }
  }

  // A gable roof on y0, ridge along z: sx across at the eaves, sz long, h to
  // the ridge, a little over at each end.
  gable(cx, y0, cz, sx, sz, h, hex, k = 1, o = {}) {
    const c = srgb(hex);
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;
    const ym = y0 + h;
    const sl = h / (sx / 2);
    this.face([[x0, y0, z0], [x0, y0, z1], [cx, ym, z1], [cx, ym, z0]], [-sl, 1, 0], c, k * 0.82, o);
    this.face([[x1, y0, z1], [x1, y0, z0], [cx, ym, z0], [cx, ym, z1]], [sl, 1, 0], c, k * 1.0, o);
    this.face([[x0, y0, z1], [x1, y0, z1], [cx, ym, z1]], [0, 0, 1], c, k * 0.9, o);
    this.face([[x1, y0, z0], [x0, y0, z0], [cx, ym, z0]], [0, 0, -1], c, k * 0.8, o);
  }

  // A hip roof: four slopes up to a point (or a short ridge, along z).
  hip(cx, y0, cz, sx, sz, h, hex, k = 1, ridge = 0) {
    const c = srgb(hex);
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;
    const ym = y0 + h;
    const r0 = cz - ridge / 2;
    const r1 = cz + ridge / 2;
    this.face([[x0, y0, z0], [x0, y0, z1], [cx, ym, r1], [cx, ym, r0]], [-h, sx / 2, 0], c, k * 0.8);
    this.face([[x1, y0, z1], [x1, y0, z0], [cx, ym, r0], [cx, ym, r1]], [h, sx / 2, 0], c, k * 1.0);
    this.face([[x0, y0, z1], [x1, y0, z1], [cx, ym, r1]], [0, sx / 2, h], c, k * 0.92);
    this.face([[x1, y0, z0], [x0, y0, z0], [cx, ym, r0]], [0, sx / 2, -h], c, k * 0.84);
  }

  done() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.glow, 1));
    g.setAttribute('aSpin', new THREE.Float32BufferAttribute(this.spin, 1));
    g.setAttribute('aHub', new THREE.Float32BufferAttribute(this.hub, 3));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 1));
    g.setAttribute('aUp', new THREE.Float32BufferAttribute(this.up, 1));
    g.setAttribute('aFace', new THREE.Float32BufferAttribute(this.along, 1));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(this.size, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// --- the structures ----------------------------------------------------------
//
// Each is built in metres, standing on y = 0 with its front toward +z and
// its middle at the origin; `r` is how far from the middle it is solid.

// A house with a gable roof and a chimney, in the colours it is given. With
// detail, the painted style draws it on (its door and windows are not built
// there, the painted ones are in their place).
function house(wall, roof, trim, glass, detail = false) {
  return () => {
    const p = new Parts();
    const fit = detail ? { part: PART.hidden } : {};
    p.box(0, 0, 0, 7, 3.2, 5.4, wall, 1, detail ? { walls: [PART.wall, PART.wall, PART.front, PART.wall] } : {});
    p.gable(0, 3.2, 0, 8.4, 6.2, 2.8, roof, 1, detail ? { part: PART.roof } : {});
    p.box(1.9, 3.6, -1.2, 0.8, 3.2, 0.8, trim);
    p.box(0, 0, 2.72, 1.1, 2.1, 0.12, trim, 1, fit);
    for (const x of [-2.2, 2.2]) p.box(x, 1.1, 2.72, 1.0, 1.0, 0.1, glass, 1, { glow: 0.35, ...fit });
    p.box(0, 0, 0, 7.3, 0.3, 5.7, trim, 0.8);
    return p.done();
  };
}

function windmill() {
  const p = new Parts();
  // Side 1 of the tower's eight (turned by `turn`) faces +z: the front, where
  // the door is.
  p.prism(0, 0, 0, 3.2, 2.0, 9, 8, 0xe8dfcf, 1, { turn: 0.39, part: PART.tower, sides: { 1: PART.towerFront } });
  p.prism(0, 9, 0, 2.5, 0, 3.4, 8, 0x6b4a34, 1, { turn: 0.39, part: PART.roof });
  p.box(0, 0, 2.7, 1.0, 2.0, 0.2, 0x4a3a2c, 1, { part: PART.hidden });
  const hub = [0, 9.6, 2.5];
  p.box(0, 9.3, 2.0, 0.7, 0.7, 1.4, 0x4a3a2c);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + 0.3;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    // A sail: a long flat blade out from the hub, turned about it.
    const L = 7.2;
    const w = 0.5;
    const c = srgb(0xcfc3a8);
    const quad = (pts, n, k) => p.face(pts.map(([x, y, z]) => [x, y + 9.6, z + 2.7]), n, c, k, { hub });
    const px = -dy * w;
    const py = dx * w;
    quad([[-px * 0.2, -py * 0.2, 0], [dx * L - px * 0.9, dy * L - py * 0.9, 0], [dx * L + px * 0.9, dy * L + py * 0.9, 0], [px * 0.2, py * 0.2, 0]], [0, 0, 1], 1);
    quad([[px * 0.2, py * 0.2, -0.05], [dx * L + px * 0.9, dy * L + py * 0.9, -0.05], [dx * L - px * 0.9, dy * L - py * 0.9, -0.05], [-px * 0.2, -py * 0.2, -0.05]], [0, 0, -1], 0.8);
  }
  return p.done();
}

function barn() {
  const p = new Parts();
  p.box(0, 0, 0, 9, 4.2, 7, 0xa1342a, 1, { walls: PART.boards });
  p.gable(0, 4.2, 0, 9.8, 7.6, 3.2, 0x5a4a44, 1, { part: PART.roof });
  p.box(0, 0, 3.52, 3.2, 3.4, 0.14, 0xf0eadc, 1, { part: PART.boards });
  p.box(0, 0, 3.55, 0.3, 3.4, 0.14, 0xa1342a);
  p.prism(6.2, 0, -1.2, 1.7, 1.7, 9.5, 10, 0xc9c2b4, 1, { part: PART.blank });
  p.prism(6.2, 9.5, -1.2, 1.7, 0, 1.4, 10, 0x6a6a70, 1, { part: PART.roof });
  return p.done();
}

function pavilion() {
  const p = new Parts();
  p.box(0, 0, 0, 6.4, 0.5, 6.4, 0x9a9690);
  for (const x of [-2.3, 2.3]) for (const z of [-2.3, 2.3]) p.prism(x, 0.5, z, 0.22, 0.2, 3.6, 8, 0xa83a2a);
  p.box(0, 4.1, 0, 6.0, 0.35, 6.0, 0x5a2a22);
  p.hip(0, 4.45, 0, 8.6, 8.6, 2.6, 0x3d4348, 1, 0);
  p.prism(0, 7.0, 0, 0.18, 0.04, 0.9, 6, 0xc9a24a);
  return p.done();
}

function lighthouse() {
  const p = new Parts();
  p.box(0, 0, 0, 7, 3.0, 7, 0xe6e1d6);
  p.prism(0, 3, 0, 2.6, 1.7, 5, 12, 0xf2eee6);
  p.prism(0, 8, 0, 1.7, 1.6, 4.5, 12, 0xb23a30);
  p.prism(0, 12.5, 0, 1.6, 1.5, 4, 12, 0xf2eee6);
  p.box(0, 16.5, 0, 3.6, 0.35, 3.6, 0x2c2e32);
  p.prism(0, 16.85, 0, 1.3, 1.3, 1.9, 10, 0xffe9a8, 1, { glow: 1 });
  p.prism(0, 18.75, 0, 1.6, 0, 1.3, 10, 0x2c2e32);
  return p.done();
}

function pyramid() {
  const p = new Parts();
  p.prism(0, 0, 0, 17, 0, 20, 4, 0xcfaa70, 1, { turn: Math.PI / 4 });
  p.prism(0, 0, 0, 17.4, 16.6, 0.8, 4, 0x8a6e45, 1, { turn: Math.PI / 4 });
  p.box(0, 0, 11.7, 3, 3.4, 0.4, 0x2a2018);
  return p.done();
}

function obelisk() {
  const p = new Parts();
  p.box(0, 0, 0, 4.4, 0.8, 4.4, 0xa88c5e);
  p.prism(0, 0.8, 0, 1.45, 0.85, 12, 4, 0xd6b982, 1, { turn: Math.PI / 4 });
  p.prism(0, 12.8, 0, 0.85, 0, 1.4, 4, 0xc9a24a, 1, { turn: Math.PI / 4 });
  return p.done();
}

function cairn() {
  const p = new Parts();
  p.prism(0, 0, 0, 1.6, 1.2, 0.9, 7, 0x8a8c8a);
  p.prism(0.1, 0.9, 0, 1.1, 0.8, 0.8, 6, 0x9a9c98);
  p.prism(0, 1.7, 0.1, 0.7, 0.4, 0.7, 6, 0x7c7e7c);
  p.box(0, 2.4, 0, 0.1, 3.4, 0.1, 0x5a4430);
  p.box(0.5, 4.6, 0, 1.0, 0.6, 0.04, 0xd23c2a, 1);
  return p.done();
}

function mineframe() {
  const p = new Parts();
  for (const x of [-2.2, 2.2]) p.box(x, 0, 0, 0.45, 5.2, 0.45, 0x5a4430);
  p.box(0, 4.8, 0, 5.2, 0.5, 0.5, 0x6a5238);
  for (const x of [-1.7, 1.7]) p.box(x, 3.8, 0, 0.3, 1.2, 0.3, 0x5a4430);
  p.box(0, 3.9, 0, 0.5, 0.8, 0.5, 0xffc060, 1, { glow: 1 });
  p.box(0, 0, 0, 5.4, 0.18, 1.0, 0x3a3430);
  p.box(3.4, 0, 0.6, 1.5, 0.9, 1.0, 0x6a4a32);
  return p.done();
}

function spire() {
  const p = new Parts();
  p.prism(0, 0, 0, 2.6, 0.6, 14, 6, 0x1c1618);
  p.prism(3.4, 0, 1.2, 1.8, 0.3, 9, 5, 0x241a1c);
  p.prism(-2.8, 0, -1.6, 2.0, 0.3, 10.5, 5, 0x1a1416);
  p.prism(0, 0, 0, 2.62, 2.5, 0.6, 6, 0xff5a18, 1, { glow: 1 });
  return p.done();
}

function gate() {
  const p = new Parts();
  for (const x of [-3.2, 3.2]) {
    p.prism(x, 0, 0, 1.0, 0.7, 10, 6, 0x1a1416);
    p.prism(x, 0, 0, 1.02, 1.0, 0.5, 6, 0xff5a18, 1, { glow: 1 });
  }
  p.box(0, 9.4, 0, 9.4, 1.4, 1.5, 0x241a1c);
  p.prism(0, 10.8, 0, 2.2, 0, 3.0, 4, 0x1a1416, 1, { turn: Math.PI / 4 });
  p.box(0, 0.4, 0, 5.4, 0.2, 0.3, 0xff7a20, 1, { glow: 1 });
  return p.done();
}

function columns() {
  const p = new Parts();
  p.box(0, 0, 0, 9, 0.6, 5, 0x6b8076);
  [[-3, 6.5], [0, 3.2], [3, 5.2]].forEach(([x, h], i) => {
    p.prism(x, 0.6, 0, 0.7, 0.62, h, 10, 0x8aa498);
    if (i !== 1) p.box(x, 0.6 + h, 0, 1.7, 0.3, 1.7, 0x6b8076);
  });
  p.prism(-1.5, 0.6, 2.2, 0.7, 0.6, 0.5, 10, 0x5b7a6a);
  p.box(1.2, 0.6, 2.4, 0.9, 0.5, 2.6, 0x7a9488, 0.9);
  return p.done();
}

function temple() {
  const p = new Parts();
  p.box(0, 0, 0, 16, 0.4, 10, 0xece8de);
  p.box(0, 0.4, 0, 14.4, 0.4, 8.8, 0xf4f0e6);
  p.box(0, 0.8, 0, 13, 0.4, 7.6, 0xf8f4ea);
  for (let i = 0; i < 6; i++) {
    const x = -5.5 + i * 2.2;
    for (const z of [-2.8, 2.8]) p.prism(x, 1.2, z, 0.5, 0.45, 5.6, 10, 0xfaf6ec);
  }
  p.box(0, 6.8, 0, 13.4, 0.5, 7.6, 0xe6e1d4);
  p.gable(0, 7.3, 0, 7.6, 14, 2.4, 0xd9c48a, 1);
  return p.done();
}

function dish() {
  const p = new Parts();
  p.prism(0, 0, 0, 0.5, 0.3, 5.5, 8, 0xb8bec6);
  p.box(0, 0, 0, 3.0, 0.4, 3.0, 0x8a919a);
  // The dish: a shallow cone leaning back at the sky.
  p.prism(0, 6.2, -0.8, 3.4, 0.6, 1.1, 14, 0xe8ecf0, 1, { turn: 0 });
  p.box(0, 5.0, -0.8, 0.12, 1.6, 0.12, 0x8a919a);
  p.box(0, 7.2, 0.1, 0.16, 0.16, 0.9, 0xff3a2a, 1, { glow: 1 });
  return p.done();
}

function station() {
  const p = new Parts();
  p.prism(0, 0, 0, 1.8, 1.8, 7, 12, 0xd8dce2, 1, { turn: 0 });
  p.prism(0, 7, 0, 1.8, 1.2, 0.7, 12, 0x9aa2ac);
  p.box(0, 3.4, 1.9, 0.9, 0.9, 0.2, 0xffe9a8, 1, { glow: 1 });
  for (const s of [-1, 1]) {
    p.box(s * 5.2, 2.0, 0, 7, 0.1, 2.6, 0x1c2a5a, 1);
    p.box(s * 1.9, 3.4, 0, 0.5, 0.2, 0.2, 0x8a919a);
  }
  return p.done();
}

function ruin() {
  const p = new Parts();
  p.box(0, 0, -2.3, 7, 3.4, 0.5, 0x3a4048);
  p.box(-3.2, 0, 0, 0.5, 2.4, 4.6, 0x343a42);
  p.box(3.2, 0, 0.6, 0.5, 4.2, 3.4, 0x3a4048);
  p.box(0.3, 0, 2.3, 3.4, 1.0, 0.45, 0x2f353c);
  // What is left of the roof: a pair of rafters, and a beam hanging.
  p.box(-1.6, 3.4, -1.0, 0.25, 0.25, 4.6, 0x2a2420);
  p.box(1.2, 3.8, -1.4, 0.25, 0.25, 3.4, 0x2a2420);
  p.box(0, 3.2, 1.0, 5.4, 0.2, 0.2, 0x2a2420);
  // Vines over it, red where they are alive.
  p.box(1.0, 0, -2.0, 0.3, 3.0, 0.3, 0x7a1c22, 1, { glow: 0.25 });
  p.box(3.0, 0.4, 0.8, 0.28, 3.6, 0.28, 0x6a1820, 1, { glow: 0.25 });
  return p.done();
}

// What each is: the build, how far it is solid, how it stands (in metres
// from the road's edge: lo, hi), how big it may be, whether it floats.
const TYPES = {
  chalet: { build: house(0x8a6a48, 0x4a3a34, 0x3a2e28, 0xffd89a), r: 4.4, lat: [10, 40], size: [0.9, 1.2] },
  farmhouse: { build: house(0xe9e3d4, 0x9a3a2e, 0x6a5a4a, 0xffd89a, true), r: 4.4, lat: [10, 45], size: [0.9, 1.2] },
  hut: { build: house(0xf2f0ea, 0x3a6a9a, 0x6a8aa8, 0xffe9b0), r: 4.0, lat: [10, 35], size: [0.7, 0.95] },
  windmill: { build: windmill, r: 3.6, lat: [14, 50], size: [0.9, 1.3] },
  barn: { build: barn, r: 6.2, lat: [14, 55], size: [0.9, 1.15] },
  pavilion: { build: pavilion, r: 4.8, lat: [10, 40], size: [0.9, 1.2] },
  lighthouse: { build: lighthouse, r: 4.0, lat: [12, 45], size: [0.9, 1.25] },
  pyramid: { build: pyramid, r: 17, lat: [30, 120], size: [0.6, 1.5] },
  obelisk: { build: obelisk, r: 2.6, lat: [10, 50], size: [0.8, 1.3] },
  cairn: { build: cairn, r: 1.8, lat: [8, 30], size: [0.8, 1.5] },
  mineframe: { build: mineframe, r: 3.2, lat: [10, 40], size: [0.9, 1.2] },
  spire: { build: spire, r: 4.4, lat: [12, 60], size: [0.8, 1.7] },
  gate: { build: gate, r: 4.6, lat: [12, 50], size: [0.9, 1.3] },
  columns: { build: columns, r: 4.4, lat: [10, 40], size: [0.9, 1.3] },
  temple: { build: temple, r: 8.4, lat: [16, 60], size: [0.9, 1.2] },
  dish: { build: dish, r: 2.4, lat: [20, 80], size: [1, 2.2], float: true },
  station: { build: station, r: 2.2, lat: [20, 90], size: [1, 2.6], float: true },
  ruin: { build: ruin, r: 4.2, lat: [10, 45], size: [0.9, 1.3] },
};
const KINDS = Object.keys(TYPES);

// What each world has by its road, and how often (the share of cells).
const STANDS = {
  alpine: { share: 0.4, types: ['chalet', 'cairn', 'cairn'] },
  hills: { share: 0.5, types: ['windmill', 'barn', 'farmhouse', 'farmhouse'] },
  river: { share: 0.42, types: ['pavilion', 'farmhouse', 'pavilion'] },
  coast: { share: 0.4, types: ['lighthouse', 'hut', 'hut'] },
  desert: { share: 0.3, types: ['pyramid', 'obelisk', 'obelisk'] },
  cavern: { share: 0.45, types: ['mineframe'] },
  inferno: { share: 0.5, types: ['spire', 'spire', 'gate'] },
  abyss: { share: 0.45, types: ['columns'] },
  heaven: { share: 0.35, types: ['temple'] },
  space: { share: 0.4, types: ['dish', 'station'] },
  upside: { share: 0.5, types: ['ruin'] },
};

// --- the detail of the painted style --------------------------------------------
//
// What a face is drawn with in the painted style is worked out for each pixel
// from where the pixel is on the face, in the structure's own metres (see
// Parts.face): a roof's tiles, a wall's stains and windows, a barn's boards.
// Each kind of detail goes as the pixel gets to be as big as it is, so what is
// too fine to see is not drawn, and not left to flicker. What comes of it is
// the albedo of the face, and the paired paints (render/style.js's stylePair)
// are made of that: the lit paint and the shade paint of a window are its own,
// as those of a wall are. None of it is in the other styles' programs.

// The numbers of it. Metres are the structure's own, a share is of the bays or
// of the structures, a factor multiplies the albedo. Colours are written as
// they look on the screen (sRGB). A pair is the shade side's number and the
// sunlit side's: the painter's curve lays a white wall in the sun flat, and a
// stain or a shadow on it has to be darker than on the same wall in the shade
// to be seen at all.
const DETAIL = {
  // Roofs: rows of tiles up the slope and tiles along a row (each row half a
  // tile along from its neighbour), each tile its own tone and each row its
  // own, a row darker toward its lower edge, where the next row laps it. The
  // size of a tile is kept to what a pixel can hold (tilePx: the metres of a
  // pixel at which a row is 4 pixels), twice as large for each time the pixel
  // is twice that, and the tiles are gone between tileOut octaves of it. The
  // roof's age is a factor from the eave to the ridge; the line of the ridge
  // lighter, the edge of the eave darker; moss low on the slope that is turned
  // from the sun.
  rows: 3.4,
  cols: 2.6,
  tile: [0.9, 1.1],
  rowTone: 0.12,
  rowShade: [0.56, 1.08],
  tilePx: 0.0735,
  tileOut: [1.2, 2.4],
  age: [0.84, 1.1],
  ridge: 0.16,
  eave: 0.38,
  moss: [0.3, 0.34, 0.14],
  mossShare: 0.45,
  // Plaster: a warm foot, whiter up to a share of the wall's height (at most
  // 3.2 m); a stain at the foot with a ragged top; pale streaks down the upper
  // half; a line darker at each corner; and the shade under the eaves where the
  // sun is on the wall (from the eave: dark to under[0], clear at under[1]).
  foot: [0.88, 0.85, 0.78],
  footTo: 0.55,
  stain: [0.6, 0.58, 0.52],
  stainEdge: 0.1,
  streak: [0.08, 0.22],
  streakAcross: 7,
  corner: [0.12, 0.45],
  under: [0.7, 1.2],
  underLit: 0.45,
  // The sun's step on a face: from the shade to the light by the cosine of its
  // angle to the sun.
  sun: [0.02, 0.12],
  // Windows in bays, a storey 3.0 m and a bay 2.4 m, the glass from the dark
  // at the top to the light, a darker wall below the sill; shutters on a share
  // of the structures, in one of three colours; a door with an arched head;
  // boards a barn's.
  storey: 3.0,
  bay: 2.4,
  window: [0.88, 1.24],
  sill: 0.9,
  windows: 0.76,
  towerWindows: 0.4,
  glass: [[0.14, 0.17, 0.24], [0.34, 0.46, 0.58]],
  below: [0.7, 0.45],
  shutters: 0.55,
  shutter: [[0.2, 0.37, 0.27], [0.25, 0.36, 0.52], [0.52, 0.25, 0.17]],
  door: [1.24, 2.24],
  doorColour: [0.3, 0.18, 0.1],
  board: 0.22,
  // Metres of a pixel, between which a window, a door, its mullions, and the
  // thin lines of an edge go.
  fadeWindow: [0.08, 0.14],
  fadeDoor: [0.1, 0.2],
  fadeMullion: [0.02, 0.045],
  fadeEdge: [0.05, 0.14],
};

const num = (x) => x.toFixed(5);
const vec2 = (a) => `vec2( ${num(a[0])}, ${num(a[1])} )`;
const vec3 = (a) => `vec3( ${num(a[0])}, ${num(a[1])}, ${num(a[2])} )`;
// A colour as it looks on the screen, as the linear one the shader works in.
const lin = (c) => { const k = new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace); return vec3([k.r, k.g, k.b]); };
const [lo, hi] = [(a) => num(a[0]), (a) => num(a[1])];

const DETAIL_VERT = `
attribute float aPart;
attribute float aUp;
attribute float aFace;
attribute vec3 aSize;
attribute float aSeed;
varying float vPart;
varying float vUp;
varying float vAlong;
varying vec3 vSize;
varying float vSeed;`;

const DETAIL_VERT_MAIN = `
vPart = aPart;
vUp = aUp;
vAlong = aFace;
vSize = aSize;
vSeed = aSeed;`;

const DETAIL_FRAG = `
#ifdef STYLE_PAIR
varying float vPart;
varying float vUp;
varying float vAlong;
varying vec3 vSize;
varying float vSeed;

// How much of a box (half its size h) a point d from its middle is in, the
// edges as soft as the pixel is big.
float hBox( vec2 d, vec2 h, vec2 px ) {
  vec2 e = 1.0 - smoothstep( h - px, h + px, abs( d ) );
  return e.x * e.y;
}

// The tone of the tiles of a roof at a scale (1: a tile 0.294 m up the slope by
// 0.385 m along it).
float roofTiles( float scale, float upM ) {
  float rows = upM * ${num(DETAIL.rows)} / scale;
  float row = floor( rows );
  float cols = vAlong * ${num(DETAIL.cols)} / scale + 0.5 * mod( row, 2.0 );
  float rnd = stHash( vec3( floor( cols ), row, vSize.z + vSeed * 29.0 + scale ) );
  float rowK = 1.0 + ${num(DETAIL.rowTone)} * ( 2.0 * stHash( vec3( row, vSize.z, vSeed * 17.0 + scale ) ) - 1.0 );
  return rowK * mix( ${lo(DETAIL.tile)}, ${hi(DETAIL.tile)}, rnd ) * mix( ${lo(DETAIL.rowShade)}, ${hi(DETAIL.rowShade)}, smoothstep( 0.0, 0.6, fract( rows ) ) );
}

vec3 houseRoof( vec3 a, float lit, float upM, vec2 px ) {
  float ev = 1.0 - smoothstep( ${lo(DETAIL.fadeEdge)}, ${hi(DETAIL.fadeEdge)}, px.y );
  // Octaves of tile size above the finest a pixel can hold (a tile's width is
  // 1.31 of its height): the pattern of two sizes mixed, and gone when far.
  float oct = max( log2( max( px.y, px.x * 0.765 ) / ${num(DETAIL.tilePx)} ), 0.0 );
  float tone = 1.0;
  if ( oct < ${hi(DETAIL.tileOut)} ) {
    float o0 = floor( oct );
    float t = mix( roofTiles( exp2( o0 ), upM ), roofTiles( exp2( o0 + 1.0 ), upM ), oct - o0 );
    tone = mix( t, 1.0, smoothstep( ${lo(DETAIL.tileOut)}, ${hi(DETAIL.tileOut)}, oct ) );
  }
  float ridge = 1.0 - smoothstep( 0.05, 0.18, ( 1.0 - vUp ) * vSize.y );
  float edge = 1.0 - smoothstep( 0.03, 0.12, upM );
  a *= mix( ${lo(DETAIL.age)}, ${hi(DETAIL.age)}, vUp ) * tone;
  a *= ( 1.0 + ${num(DETAIL.ridge)} * ridge * ev ) * ( 1.0 - ${num(DETAIL.eave)} * edge * ev );
  float low = ( 1.0 - lit ) * ( 1.0 - smoothstep( 0.08, 0.5, vUp ) );
  if ( low > 0.0 ) {
    float moss = low * smoothstep( 0.35, 0.65, stNoise( vec2( vAlong * 1.7, upM * 2.3 ) + vSize.z * 5.0 ) );
    a = mix( a, ${lin(DETAIL.moss)}, moss * ${num(DETAIL.mossShare)} );
  }
  return a;
}

vec3 houseWall( vec3 a, int hp, float lit, float upM, vec2 px ) {
  float W = vSize.x;
  float H = vSize.y;
  if ( hp == 3 ) {
    // Boards: a seam between boards, each board its own tone, a knot now and then.
    float bd = vAlong / ${num(DETAIL.board)};
    float bi = floor( bd );
    float bf = fract( bd );
    float bv = 1.0 - smoothstep( 0.04, 0.12, px.x );
    float seam = 1.0 - smoothstep( 0.0, 0.05 + px.x / ${num(DETAIL.board)}, min( bf, 1.0 - bf ) );
    float bt = stHash( vec3( bi, vSize.z, vSeed * 3.0 ) );
    float knot = step( 0.94, stHash( vec3( bi, floor( upM / 1.1 ), vSize.z ) ) );
    vec2 kd = vec2( ( bf - 0.5 ) * ${num(DETAIL.board)}, fract( upM / 1.1 ) - 0.5 );
    a *= 1.0 - 0.3 * seam * bv;
    a *= mix( 1.0, 0.94 + 0.12 * bt, bv );
    a *= 1.0 - 0.28 * knot * bv * ( 1.0 - smoothstep( 0.02, 0.07, length( kd * vec2( 1.0, 0.25 ) ) ) );
  } else {
    // Plaster: warm at the foot, whiter above.
    a *= mix( ${vec3(DETAIL.foot)}, vec3( 1.0 ), smoothstep( 0.0, ${num(DETAIL.footTo)} * min( H, 3.2 ), upM ) );
  }
  // The foot stained where the rain splashes, with a ragged top.
  float top = 0.45 + 0.35 * stNoise( vec2( vAlong * 1.9 + vSize.z * 3.1, 0.7 ) );
  a *= mix( vec3( 1.0 ), ${vec3(DETAIL.stain)}, 1.0 - smoothstep( top - ${num(DETAIL.stainEdge)}, top, upM ) );
  // Streaks down the upper half.
  if ( vUp > 0.45 ) {
    float streak = smoothstep( 0.45, 0.8, vUp ) * smoothstep( 0.6, 0.78, stNoise( vec2( vAlong * ${num(DETAIL.streakAcross)} + vSize.z, upM * 0.45 ) ) );
    a *= 1.0 - mix( ${lo(DETAIL.streak)}, ${hi(DETAIL.streak)}, lit ) * streak;
  }
  float ev = 1.0 - smoothstep( ${lo(DETAIL.fadeEdge)}, ${hi(DETAIL.fadeEdge)}, px.x );
  a *= 1.0 - mix( ${lo(DETAIL.corner)}, ${hi(DETAIL.corner)}, lit ) * ev * smoothstep( 0.5 * W - 0.25, 0.5 * W - 0.02, abs( vAlong ) );
  // Under the eaves, where the sun is on the wall.
  a *= mix( 1.0, mix( ${num(DETAIL.underLit)}, 1.0, smoothstep( ${lo(DETAIL.under)}, ${hi(DETAIL.under)}, ( 1.0 - vUp ) * H ) ), lit );
  if ( hp == 3 || hp == 4 ) return a;

  // Windows in bays, a row to a storey: on a tower fewer, and none in the
  // lowest storey; a front's middle bay is the door's.
  float nb = max( floor( W / ${num(DETAIL.bay)} + 0.5 ), 1.0 );
  float bw = W / nb;
  float bi = min( floor( ( vAlong + 0.5 * W ) / bw ), nb - 1.0 );
  float dx = vAlong + 0.5 * W - ( bi + 0.5 ) * bw;
  float ns = max( floor( H / ${num(DETAIL.storey)} + 0.5 ), 1.0 );
  float sh = H / ns;
  float si = min( floor( upM / sh ), ns - 1.0 );
  float dy = upM - si * sh - ${num(DETAIL.sill + DETAIL.window[1] / 2)};
  bool tower = hp >= 6;
  bool door = hp == 5 || hp == 7;
  float has = step( stHash( vec3( bi + 3.0 * si, vSize.z, vSeed * 7.0 ) ), tower ? ${num(DETAIL.towerWindows)} : ${num(DETAIL.windows)} );
  if ( tower && si < 0.5 ) has = 0.0;
  if ( door && si < 0.5 && abs( ( bi + 0.5 ) * bw - 0.5 * W ) < 0.9 ) has = 0.0;
  vec2 hs = ${vec2([DETAIL.window[0] / 2, DETAIL.window[1] / 2])};
  vec2 d = vec2( dx, dy );
  float mv = 1.0 - smoothstep( ${lo(DETAIL.fadeMullion)}, ${hi(DETAIL.fadeMullion)}, max( px.x, px.y ) );
  float wv = 1.0 - smoothstep( ${lo(DETAIL.fadeWindow)}, ${hi(DETAIL.fadeWindow)}, max( px.x, px.y ) );
  if ( has > 0.5 && wv > 0.0 ) {
    vec2 pxe = px + 0.01;
    float glassBox = hBox( d, hs, pxe );
    float frameBox = hBox( d, hs + 0.07, pxe );
    vec3 glass = mix( ${lin(DETAIL.glass[1])}, ${lin(DETAIL.glass[0])}, clamp( dy / hs.y * 0.5 + 0.5, 0.0, 1.0 ) );
    float mull = max( 1.0 - smoothstep( 0.015, 0.015 + px.x, abs( dx ) ), 1.0 - smoothstep( 0.015, 0.015 + px.y, abs( dy ) ) );
    glass *= 1.0 - 0.45 * mull * mv;
    // Shutters, on a share of the structures, in one of three colours, with slats.
    float shut = step( stHash( vec3( vSeed, 3.0, 1.0 ) ), ${num(DETAIL.shutters)} );
    float pick = stHash( vec3( vSeed, 5.0, 2.0 ) );
    vec3 sc = pick < 0.3333 ? ${lin(DETAIL.shutter[0])} : pick < 0.6667 ? ${lin(DETAIL.shutter[1])} : ${lin(DETAIL.shutter[2])};
    float sx = abs( dx ) - ( hs.x + 0.07 );
    float panel = ( 1.0 - smoothstep( 0.0, 2.0 * pxe.x, -sx ) ) * ( 1.0 - smoothstep( 0.38 - pxe.x, 0.38 + pxe.x, sx ) ) * ( 1.0 - smoothstep( hs.y - pxe.y, hs.y + pxe.y, abs( dy ) ) );
    float slats = mix( 1.0, 0.84 + 0.16 * smoothstep( 0.35, 0.65, fract( dy / 0.075 ) ), 1.0 - smoothstep( 0.03, 0.07, px.y ) );
    a = mix( a, sc * slats, panel * shut * wv );
    // The wall below the sill, darker where the rain runs off it.
    float sill = hBox( vec2( dx, dy + hs.y + 0.2 ), vec2( hs.x + 0.1, 0.2 ), pxe );
    a *= mix( 1.0, mix( ${lo(DETAIL.below)}, ${hi(DETAIL.below)}, lit ), sill * ( 1.0 - frameBox ) * wv );
    a = mix( a, vec3( 0.2, 0.15, 0.11 ) * ( 0.8 + 0.4 * lit ), frameBox * wv );
    a = mix( a, glass, glassBox * wv );
  }
  float dv = 1.0 - smoothstep( ${lo(DETAIL.fadeDoor)}, ${hi(DETAIL.fadeDoor)}, max( px.x, px.y ) );
  if ( door && si < 0.5 && dv > 0.0 ) {
    // A door of boards with an arched head, in the middle of the face.
    float dw = ${num(DETAIL.door[0] / 2)};
    float dh = ${num(DETAIL.door[1] - DETAIL.door[0] / 2)};
    vec2 pxe = px + 0.01;
    float e = max( pxe.x, pxe.y );
    float body = ( 1.0 - smoothstep( dw - pxe.x, dw + pxe.x, abs( vAlong ) ) ) * ( 1.0 - smoothstep( dh - pxe.y, dh + pxe.y, upM ) );
    float arch = ( 1.0 - smoothstep( dw - e, dw + e, length( vec2( vAlong, upM - dh ) ) ) ) * step( dh, upM );
    float dm = max( body, arch );
    vec3 dc = ${lin(DETAIL.doorColour)};
    float bd = fract( vAlong / 0.2 );
    dc *= 1.0 - 0.25 * ( 1.0 - smoothstep( 0.0, 0.1, min( bd, 1.0 - bd ) ) ) * mv;
    float fr = ( 1.0 - smoothstep( dw + 0.08 - pxe.x, dw + 0.08 + pxe.x, abs( vAlong ) ) ) * ( 1.0 - smoothstep( dh + dw + 0.08 - pxe.y, dh + dw + 0.08 + pxe.y, upM ) );
    a = mix( a, a * 0.6, fr * ( 1.0 - dm ) * dv );
    a = mix( a, dc * ( 0.7 + 0.5 * lit ), dm * dv );
  }
  return a;
}

// The albedo a such a face has: hp is what the face is (PART), lit the sun's
// step on it.
vec3 houseDetail( vec3 a, int hp, float lit ) {
  float upM = vUp * vSize.y;
  vec2 px = vec2( fwidth( vAlong ), fwidth( upM ) ) + 1e-4;
  return hp == 1 ? houseRoof( a, lit, upM, px ) : houseWall( a, hp, lit, upM, px );
}
#endif`;

const DETAIL_FRAG_MAIN = `
#ifdef STYLE_PAIR
if ( uPair > 0.0 ) {
  int hp = int( vPart + 0.5 );
  if ( hp == 9 ) {
    // Built into the structure, and drawn on it in the painted style.
    if ( uPair > 0.5 ) discard;
  } else if ( hp != 2 ) {
    float hlit = smoothstep( ${lo(DETAIL.sun)}, ${hi(DETAIL.sun)}, dot( normalize( vNormal ), uSunDirV ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, houseDetail( diffuseColor.rgb, hp, hlit ), uPair );
  }
}
#endif`;

// --- the material ------------------------------------------------------------

const timeUniform = { value: 0 };

function propMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.02 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPropTime = timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aGlow;
attribute float aSpin;
attribute vec3 aHub;
uniform float uPropTime;
varying float vGlow;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vGlow = aGlow;
if ( aSpin > 0.5 ) {
  // Sails turn slowly about the hub, each its own way round.
  float a = uPropTime * 0.5;
  vec3 q = transformed - aHub;
  transformed = aHub + vec3( q.x * cos( a ) - q.y * sin( a ), q.x * sin( a ) + q.y * cos( a ), q.z );
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * 2.2;');
    // The painted style's detail is in its programs only (withAtmosphere
    // gives them STYLE_PAIR), the others are as they were.
    if (pairProgram.on) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>' + DETAIL_VERT)
        .replace('#include <begin_vertex>', '#include <begin_vertex>' + DETAIL_VERT_MAIN);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <clipping_planes_pars_fragment>', '#include <clipping_planes_pars_fragment>' + DETAIL_FRAG)
        .replace('#include <color_fragment>', '#include <color_fragment>' + DETAIL_FRAG_MAIN);
    }
  };
  mat.customProgramCacheKey = () => 'continuum-props';
  mat.userData.mark = MARK.built;
  return withSunMask(withAtmosphere(mat), false);
}

// --- the lot of them ---------------------------------------------------------

export class Props {
  // env: road, groundAt(x, z), worlds, seed.
  constructor(scene, env) {
    this.env = env;
    this.seed = env.seed || 0;
    this.cells = new Map();     // cell number -> the structure there (or null)
    this.time = 0;
    this.dirty = true;
    this.meshes = {};
    const material = propMaterial();
    for (const id of KINDS) {
      const geometry = TYPES[id].build();
      // Each structure's own number, for what varies from one to the next.
      geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1));
      const mesh = new THREE.InstancedMesh(geometry, material, MAX);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.visible = false;
      scene.add(mesh);
      this.meshes[id] = mesh;
    }
    this.dummy = new THREE.Object3D();
    this.origin = { x: 0, z: 0 };
    this.shown = 0;
  }

  // The floating origin has moved.
  shift() {
    this.dirty = true;
  }

  // A cell's structure, from the road, or none. Absolute coordinates.
  _make(k, o) {
    const env = this.env;
    const road = env.road;
    const s = (k + 0.15 + 0.7 * hash(k, 1, this.seed)) * CELL;
    const p = road.at(s);
    const q = road.at(s + 30);
    const r = road.at(s - 30);
    if (!p || !q || !r) return undefined;     // the road is not laid there yet
    const ax = p.x + o.x;
    const az = p.z + o.z;
    const w = env.worlds ? env.worlds.main(ax, az) : 0;
    const stand = STANDS[WORLDS[w].id];
    if (!stand || hash(k, 2, this.seed) >= stand.share) return null;
    const id = stand.types[Math.floor(hash(k, 3, this.seed) * stand.types.length)];
    const t = TYPES[id];
    if (!t.float && (p.kind !== GROUND || q.kind !== GROUND || r.kind !== GROUND)) return null;
    const side = hash(k, 4, this.seed) < 0.5 ? -1 : 1;
    const lat = HALF_FLAT + t.lat[0] + (t.lat[1] - t.lat[0]) * Math.pow(hash(k, 5, this.seed), 1.5);
    const x = p.x - Math.sin(p.theta) * lat * side;
    const z = p.z + Math.cos(p.theta) * lat * side;
    const scale = t.size[0] + (t.size[1] - t.size[0]) * hash(k, 6, this.seed);
    let y;
    if (t.float) {
      y = p.y + (hash(k, 7, this.seed) - 0.5) * 36;
    } else {
      // Level ground, out of the road's cut and above any water.
      y = env.groundAt(x, z);
      const reach = Math.max(3, t.r * scale * 0.7);
      for (const [dx, dz] of [[reach, 0], [-reach, 0], [0, reach], [0, -reach]]) {
        if (Math.abs(env.groundAt(x + dx, z + dz) - y) > 1.6 + reach * 0.25) return null;
      }
      if (env.waterAt && !(y > env.waterAt(x, z) + 0.3)) return null;
    }
    // Facing the road, a little off square.
    const yaw = Math.atan2(Math.sin(p.theta) * side, -Math.cos(p.theta) * side) + (hash(k, 8, this.seed) - 0.5) * 0.5;
    return { id, ax: x + o.x, az: z + o.z, y, yaw, scale, r: t.r * scale, seed: hash(k, 9, this.seed) };
  }

  // Every frame: the cells round the car are looked at, and what changed is
  // laid in the meshes.
  update(dt, sCar) {
    this.time += dt;
    timeUniform.value = this.time % 3600;
    const o = this.env.road.origin;
    if (o.x !== this.origin.x || o.z !== this.origin.z) {
      this.origin.x = o.x;
      this.origin.z = o.z;
      this.dirty = true;
    }
    const k0 = Math.floor((sCar - BEHIND) / CELL);
    const k1 = Math.floor((sCar + AHEAD) / CELL);
    for (let k = k0; k <= k1; k++) {
      if (this.cells.has(k) && this.cells.get(k) !== undefined) continue;
      const rec = this._make(k, o);
      if (rec === undefined) continue;
      this.cells.set(k, rec);
      this.dirty = true;
    }
    for (const k of this.cells.keys()) {
      if (k < k0 - 1 || k > k1 + 1) {
        this.cells.delete(k);
        this.dirty = true;
      }
    }
    if (!this.dirty) return;
    this.dirty = false;
    const counts = {};
    for (const rec of this.cells.values()) {
      if (!rec) continue;
      const mesh = this.meshes[rec.id];
      const n = counts[rec.id] || 0;
      if (n >= MAX) continue;
      counts[rec.id] = n + 1;
      const d = this.dummy;
      d.position.set(rec.ax - o.x, rec.y, rec.az - o.z);
      d.rotation.set(0, rec.yaw, 0);
      d.scale.setScalar(rec.scale);
      d.updateMatrix();
      mesh.setMatrixAt(n, d.matrix);
      mesh.geometry.attributes.aSeed.setX(n, rec.seed);
    }
    this.shown = 0;
    for (const id of KINDS) {
      const mesh = this.meshes[id];
      mesh.count = counts[id] || 0;
      mesh.visible = mesh.count > 0;
      if (mesh.count) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.geometry.attributes.aSeed.needsUpdate = true;
      }
      this.shown += mesh.count;
    }
  }

  // Whether an absolute point is inside a structure: for a camera deciding
  // where it can stand and what it can see through (Game.solidAt).
  solidAt(ax, y, az) {
    for (const rec of this.cells.values()) {
      if (!rec) continue;
      const dx = rec.ax - ax;
      const dz = rec.az - az;
      const r = rec.r * 0.85;
      if (dx * dx + dz * dz < r * r && y > rec.y - 1 && y < rec.y + 14 * rec.scale && !TYPES[rec.id].float) return true;
    }
    return false;
  }

  // The nearest structure of a kind to an absolute point, among those laid about the car: { d (m, across the
  // ground), x, z (absolute) } in out, or null where there is none.
  nearestOf(id, ax, az, out = {}) {
    let best = Infinity;
    for (const rec of this.cells.values()) {
      if (!rec || rec.id !== id) continue;
      const d = Math.hypot(rec.ax - ax, rec.az - az);
      if (d < best) {
        best = d;
        out.x = rec.ax;
        out.z = rec.az;
      }
    }
    if (best === Infinity) return null;
    out.d = best;
    return out;
  }

  // The structures within range of an absolute point, as [x, z, radius, ...]
  // added to out (not emptied: the trunks are in it).
  near(ax, az, range, out) {
    for (const rec of this.cells.values()) {
      if (!rec) continue;
      const dx = rec.ax - ax;
      const dz = rec.az - az;
      const reach = range + rec.r;
      if (dx * dx + dz * dz < reach * reach && !TYPES[rec.id].float) out.push(rec.ax, rec.az, rec.r);
    }
    return out;
  }
}
