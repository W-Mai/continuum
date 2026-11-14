// What lies about the ground: the small things that make a place a place.
// Tufts and flowers on the meadows of the hills, reeds at the river, shells
// and driftwood on the coast, dry brush, bones and rocks in the desert,
// crystals and stalagmites underground, black shards and embers in the
// inferno, coral and weed on the sea floor, puffs of cloud in the sky,
// plates of broken metal on the moon road, spore pods, bones and gnarled
// roots in the Upside Down.
//
// The land is cut into cells of CELL metres in absolute coordinates, and a
// cell has the same things in the same places each time the car comes by (a
// hash of its number and the seed). Cells within RADIUS of the lens are laid
// a few a frame as it moves, and dropped behind; all of one kind are one
// instanced mesh, rebuilt when the set changes. Nothing stands on the road,
// in the water (but for what grows there) or in a bore.

import * as THREE from 'three';
import { WORLDS } from '../world/worlds.js';
import { HALF_FLAT } from '../world/road.js';
import { withAtmosphere, withSunMask } from './atmosphere.js';

const CELL = 10;
const RADIUS = 84;
const FADE = 22;
const MAX = 700;               // of a kind, at a time
const PER_FRAME = 8;           // cells laid a frame
const DENSITY = 1.7;           // how thick the kits lie, for the whole of them

const srgb = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

function hash(a, b, seed) {
  let h = (Math.imul(a | 0, 0x8da6b343) ^ Math.imul(b | 0, 0xd8163841) ^ Math.imul(seed | 0, 0x2545f491)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- shapes ------------------------------------------------------------------
//
// A kind is built from a few solids with a colour each (white for what is to
// take the instance's own colour), flat shaded: a blob, a cone, a blade, a
// box. In the block style every solid is a box.

class Bits {
  constructor(blocky) {
    this.blocky = blocky;
    this.p = [];
    this.n = [];
    this.c = [];
    this.g = [];
  }

  tri(a, b, c, col, k = 1, glow = 0, flip = false) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    const s = flip ? -1 : 1;
    nx = (nx / l) * s;
    ny = (ny / l) * s;
    nz = (nz / l) * s;
    const pts = flip ? [a, c, b] : [a, b, c];
    for (const q of pts) {
      this.p.push(q[0], q[1], q[2]);
      this.n.push(nx, ny, nz);
      this.c.push(col.r * k, col.g * k, col.b * k);
      this.g.push(glow);
    }
  }

  // A triangle that faces away from `from`.
  out(a, b, c, from, col, k, glow) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const m = [(a[0] + b[0] + c[0]) / 3 - from[0], (a[1] + b[1] + c[1]) / 3 - from[1], (a[2] + b[2] + c[2]) / 3 - from[2]];
    this.tri(a, b, c, col, k, glow, nx * m[0] + ny * m[1] + nz * m[2] < 0);
  }

  box(cx, y0, cz, sx, sy, sz, col, k = 1, glow = 0, yaw = 0) {
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const P = (x, y, z) => [cx + x * cs - z * sn, y0 + y, cz + x * sn + z * cs];
    const hx = sx / 2;
    const hz = sz / 2;
    const v = [P(-hx, 0, -hz), P(hx, 0, -hz), P(hx, 0, hz), P(-hx, 0, hz), P(-hx, sy, -hz), P(hx, sy, -hz), P(hx, sy, hz), P(-hx, sy, hz)];
    const c = [cx, y0 + sy / 2, cz];
    const f = [[0, 1, 2, 3, 0.6], [4, 7, 6, 5, 1.1], [0, 4, 5, 1, 0.8], [1, 5, 6, 2, 0.9], [2, 6, 7, 3, 0.8], [3, 7, 4, 0, 0.9]];
    for (const [a, b, d, e, s] of f) {
      this.out(v[a], v[b], v[d], c, col, k * s, glow);
      this.out(v[a], v[d], v[e], c, col, k * s, glow);
    }
  }

  // A rough ball, radii (rx, ry, rz) about (cx, cy, cz); a box in the block style.
  blob(cx, cy, cz, rx, ry, rz, col, k = 1, seed = 1, jitter = 0.2, glow = 0, detail = 0) {
    if (this.blocky) {
      this.box(cx, cy - ry * 0.9, cz, rx * 1.6, ry * 1.8, rz * 1.6, col, k, glow, seed);
      return;
    }
    const g = new THREE.IcosahedronGeometry(1, detail);
    const a = g.attributes.position.array;
    const jit = (x, y, z) => 1 + (((Math.sin((x + seed) * 12.9898 + (y - seed) * 78.233 + z * 37.719) * 43758.5453) % 1 + 1) % 1 - 0.5) * 2 * jitter;
    const at = (i) => {
      const x = a[i * 3];
      const y = a[i * 3 + 1];
      const z = a[i * 3 + 2];
      const j = jit(Math.round(x * 50) / 50, Math.round(y * 50) / 50, Math.round(z * 50) / 50);
      return [cx + x * rx * j, cy + y * ry * j, cz + z * rz * j];
    };
    for (let i = 0; i < a.length / 9; i++) {
      const p0 = at(i * 3);
      const p1 = at(i * 3 + 1);
      const p2 = at(i * 3 + 2);
      const shade = 0.78 + 0.3 * ((p0[1] + p1[1] + p2[1]) / 3 - cy + ry) / (2 * ry);
      this.out(p0, p1, p2, [cx, cy, cz], col, k * shade, glow);
    }
  }

  // A cone (or, r1 > 0, a frustum) on y0, leaning by `lean` metres toward +x.
  cone(cx, y0, cz, r0, h, sides, col, k = 1, glow = 0, r1 = 0, lean = 0, yaw = 0) {
    if (this.blocky) {
      this.box(cx + lean / 2, y0, cz, r0 * 1.5, h, r0 * 1.5, col, k, glow, yaw);
      return;
    }
    const ring = (r, y, dx) => Array.from({ length: sides }, (_, i) => {
      const t = (i / sides) * Math.PI * 2 + yaw;
      return [cx + dx + Math.cos(t) * r, y, cz + Math.sin(t) * r];
    });
    const lo = ring(r0, y0, 0);
    const hi = r1 > 0 ? ring(r1, y0 + h, lean) : null;
    const tip = [cx + lean, y0 + h, cz];
    const mid = [cx + lean / 2, y0 + h / 2, cz];
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const shade = 0.8 + 0.3 * Math.cos(((i + 0.5) / sides) * Math.PI * 2 - 0.9);
      if (hi) {
        this.out(lo[i], lo[j], hi[j], mid, col, k * shade, glow);
        this.out(lo[i], hi[j], hi[i], mid, col, k * shade, glow);
      } else {
        this.out(lo[i], lo[j], tip, mid, col, k * shade, glow);
      }
    }
    if (hi) for (let i = 1; i < sides - 1; i++) this.out(hi[0], hi[i], hi[i + 1], [cx, y0, cz], col, k * 1.1, glow);
  }

  // A blade of grass: a thin triangle (or box) standing at (x, z), bending by `lean`.
  blade(x, z, h, w, lean, yaw, col, k = 1, glow = 0) {
    if (this.blocky) {
      this.box(x + lean * 0.5 * Math.cos(yaw), 0, z + lean * 0.5 * Math.sin(yaw), Math.max(w * 2, 0.06), h, Math.max(w * 2, 0.06), col, k, glow, yaw);
      return;
    }
    const dx = Math.cos(yaw + Math.PI / 2) * w;
    const dz = Math.sin(yaw + Math.PI / 2) * w;
    const tx = x + Math.cos(yaw) * lean;
    const tz = z + Math.sin(yaw) * lean;
    this.tri([x - dx, 0, z - dz], [x + dx, 0, z + dz], [tx, h, tz], col, k, glow);
    this.tri([x + dx, 0, z + dz], [x - dx, 0, z - dz], [tx, h, tz], col, k * 0.8, glow);
  }

  done() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.g, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const W = new THREE.Color(1, 1, 1);
const dark = (hex) => srgb(hex);

// What each kind is built of, at a unit size (a metre or so).
const BUILD = {
  rock(b) {
    b.blob(0, 0.28, 0, 0.55, 0.38, 0.5, W, 1, 1, 0.22);
    b.blob(0.42, 0.14, 0.2, 0.3, 0.2, 0.28, W, 0.92, 2, 0.2);
  },
  snowrock(b) {
    b.blob(0, 0.3, 0, 0.55, 0.4, 0.5, W, 0.85, 3, 0.22);
    b.blob(0, 0.52, 0, 0.4, 0.15, 0.36, srgb(0xf4f8fc), 1.1, 4, 0.1);
  },
  tuft(b) {
    for (let i = 0; i < 7; i++) {
      const t = (i / 7) * Math.PI * 2;
      b.blade(Math.cos(t) * 0.07, Math.sin(t) * 0.07, 0.38 + 0.2 * ((i * 37) % 5) / 5, 0.035, 0.14, t, W, 0.85 + 0.25 * (i % 3) / 2);
    }
  },
  flower(b) {
    const green = srgb(0x4f7a35);
    b.blade(0, 0, 0.32, 0.012, 0.03, 0.4, green, 1);
    b.blob(0.02, 0.34, 0, 0.07, 0.035, 0.07, W, 1.2, 5, 0.1);
    b.blob(0.02, 0.37, 0, 0.03, 0.02, 0.03, srgb(0xf0c030), 1.1, 6, 0.1);
    b.blade(0.1, 0.05, 0.2, 0.03, 0.08, 1.9, green, 0.9);
    b.blade(-0.08, -0.06, 0.22, 0.03, 0.08, 4.0, green, 0.85);
  },
  bush(b) {
    b.blob(0, 0.4, 0, 0.62, 0.42, 0.6, W, 0.9, 7, 0.2, 0, 1);
    b.blob(0.35, 0.3, 0.2, 0.42, 0.3, 0.4, W, 1.05, 8, 0.22);
    b.blob(-0.3, 0.32, -0.2, 0.4, 0.32, 0.4, W, 0.95, 9, 0.22);
    b.blob(0, 0.72, 0, 0.35, 0.24, 0.34, W, 1.15, 10, 0.2);
  },
  log(b) {
    b.cone(0, 0, 0, 0.17, 1.8, 7, W, 0.9, 0, 0.15);
  },
  mushroom(b) {
    b.cone(0, 0, 0, 0.05, 0.2, 6, srgb(0xe8e0cc), 1, 0, 0.04);
    b.blob(0, 0.22, 0, 0.14, 0.07, 0.14, W, 1.1, 11, 0.06);
  },
  reed(b) {
    const brown = srgb(0x5a3a22);
    for (let i = 0; i < 6; i++) {
      const t = (i / 6) * Math.PI * 2;
      const h = 1.2 + 0.7 * ((i * 53) % 7) / 7;
      b.blade(Math.cos(t) * 0.12, Math.sin(t) * 0.12, h, 0.03, 0.18, t, W, 0.9);
      if (i % 2 === 0) b.cone(Math.cos(t) * 0.12 + Math.cos(t) * 0.1, h * 0.8, Math.sin(t) * 0.12 + Math.sin(t) * 0.1, 0.035, 0.22, 5, brown, 1, 0, 0.03);
    }
  },
  shell(b) {
    b.blob(0, 0.04, 0, 0.1, 0.04, 0.09, W, 1.1, 12, 0.12);
    b.blob(0.09, 0.03, 0.04, 0.06, 0.025, 0.05, W, 0.95, 13, 0.12);
  },
  driftwood(b) {
    b.cone(0, 0, 0, 0.1, 1.6, 6, W, 0.85, 0, 0.07);
    b.cone(0, 0.8, 0, 0.04, 0.45, 5, W, 0.8, 0, 0.02, 0.2);
  },
  dry(b) {
    for (let i = 0; i < 10; i++) {
      const t = (i / 10) * Math.PI * 2;
      b.blade(0, 0, 0.5 + 0.2 * ((i * 31) % 5) / 5, 0.03, 0.34, t, W, 0.8 + 0.3 * (i % 3) / 2);
    }
    b.blob(0, 0.2, 0, 0.2, 0.16, 0.2, W, 0.7, 14, 0.3);
  },
  bone(b) {
    const bone = srgb(0xe6dfcc);
    b.blob(0, 0.07, 0, 0.14, 0.09, 0.17, bone, 1, 15, 0.1);
    b.blob(0, 0.04, 0.13, 0.08, 0.05, 0.08, bone, 0.95, 16, 0.1);
    b.box(0.0, 0.1, 0.17, 0.1, 0.03, 0.02, dark(0x18140f), 1);
    // Ribs: arcs of boxes.
    for (let i = 0; i < 4; i++) {
      b.box(0.5 + i * 0.1, 0, 0.0, 0.03, 0.2, 0.5, bone, 0.9 + 0.05 * i, 0, 0.1 * i);
    }
    b.box(0.7, 0.18, 0.0, 0.7, 0.03, 0.04, bone, 1);
  },
  cactusSmall(b) {
    const g = srgb(0x5d7a3a);
    b.cone(0, 0, 0, 0.12, 0.5, 6, g, 1, 0, 0.1);
    b.cone(0.15, 0.2, 0, 0.06, 0.28, 5, g, 1, 0, 0.05, 0.12);
  },
  litter(b) {
    b.box(0, 0, 0, 0.45, 0.3, 0.35, W, 1, 0, 0.3);
    b.box(0.5, 0, 0.2, 0.2, 0.12, 0.2, W, 0.8, 0, 1.0);
    b.cone(-0.5, 0, 0.2, 0.12, 0.4, 6, srgb(0xe8741f), 1, 0, 0.04);
  },
  stalagmite(b) {
    b.cone(0, 0, 0, 0.3, 1.2, 6, W, 0.9, 0, 0.05, 0.04);
    b.cone(0.28, 0, 0.1, 0.16, 0.6, 5, W, 0.8, 0, 0, 0.0);
  },
  crystal(b) {
    for (let i = 0; i < 4; i++) {
      const t = (i / 4) * Math.PI * 2;
      const h = 0.4 + 0.5 * ((i * 41) % 5) / 5;
      b.cone(Math.cos(t) * 0.12, 0, Math.sin(t) * 0.12, 0.07, h, 6, W, 1.05, 0.9, 0.0, 0.08 * Math.cos(t));
    }
    b.cone(0, 0, 0, 0.1, 0.75, 6, W, 1.15, 1.1);
  },
  shard(b) {
    b.cone(0, 0, 0, 0.18, 0.9, 5, W, 0.7, 0, 0, 0.1);
    b.cone(0.2, 0, 0.08, 0.1, 0.5, 4, W, 0.6, 0, 0, -0.06);
    b.cone(0, 0.84, 0, 0.012, 0.06, 4, srgb(0xff5a1c), 1, 1.4);
  },
  ember(b) {
    b.blob(0, 0.05, 0, 0.1, 0.07, 0.1, srgb(0xff6a1c), 1, 17, 0.2, 1.2);
    b.blob(0.14, 0.03, 0.05, 0.06, 0.04, 0.06, srgb(0xff9a3a), 1, 18, 0.2, 1.4);
  },
  coral(b) {
    for (let i = 0; i < 5; i++) {
      const t = (i / 5) * Math.PI * 2;
      b.cone(Math.cos(t) * 0.12, 0, Math.sin(t) * 0.12, 0.07, 0.4 + 0.3 * ((i * 29) % 4) / 4, 5, W, 0.9 + 0.1 * (i % 2), 0.15, 0.03, 0.1 * Math.cos(t));
    }
    b.blob(0, 0.3, 0, 0.18, 0.14, 0.18, W, 1.05, 19, 0.25, 0.1);
  },
  weed(b) {
    for (let i = 0; i < 9; i++) {
      const t = (i / 9) * Math.PI * 2;
      b.blade(Math.cos(t) * 0.1, Math.sin(t) * 0.1, 1.0 + 1.0 * ((i * 43) % 6) / 6, 0.05, 0.3, t, W, 0.75 + 0.3 * (i % 3) / 2, 0.05);
    }
  },
  puff(b) {
    b.blob(0, 0.35, 0, 0.7, 0.45, 0.65, W, 1, 20, 0.12, 0.08, 1);
    b.blob(0.55, 0.28, 0.2, 0.45, 0.32, 0.42, W, 1, 21, 0.12, 0.08, 1);
    b.blob(-0.5, 0.3, -0.15, 0.48, 0.34, 0.44, W, 1, 22, 0.12, 0.08, 1);
  },
  plate(b) {
    b.box(0, 0, 0, 0.9, 0.06, 0.6, W, 1, 0, 0.3);
    b.box(0.3, 0.06, 0.1, 0.4, 0.05, 0.3, W, 0.85, 0, 1.0);
    b.box(-0.4, 0, -0.3, 0.05, 0.4, 0.05, W, 0.9);
  },
  spore(b) {
    b.cone(0, 0, 0, 0.05, 0.55, 5, srgb(0x2a1a1c), 1, 0, 0.025, 0.05);
    b.blob(0.05, 0.62, 0, 0.14, 0.17, 0.14, W, 1, 23, 0.1, 1.3);
    b.blob(0.05, 0.62, 0, 0.07, 0.09, 0.07, srgb(0xffd890), 1, 24, 0.1, 1.6);
    for (let i = 0; i < 3; i++) b.cone(Math.cos(i * 2.1) * 0.12, 0, Math.sin(i * 2.1) * 0.12, 0.025, 0.2, 4, srgb(0x2a1a1c), 1, 0, 0, 0.04);
  },
  gnarl(b) {
    b.cone(0, 0, 0, 0.14, 0.7, 5, W, 0.8, 0, 0.05, 0.25);
    b.cone(0.1, 0.5, 0, 0.07, 0.6, 4, W, 0.85, 0, 0.02, -0.3, 1.0);
    b.cone(-0.05, 0.3, 0.05, 0.06, 0.55, 4, W, 0.75, 0, 0.02, 0.3, 2.0);
    b.blob(0, 0.05, 0, 0.22, 0.1, 0.22, W, 0.7, 25, 0.3);
  },
};
// These lie down: built standing, turned over onto their sides.
const LYING = new Set(['log', 'driftwood']);

// What lies where, and in what colours: [kind, how many a cell, [colours]].
const KITS = {
  alpine: [['tuft', 0.9, [0x52632f, 0x6b7a3c, 0x77744a]], ['rock', 0.7, [0x8a8173, 0x6f6a60, 0x958e82]], ['snowrock', 0.3, [0x8a8173, 0x7a7468]],
    ['flower', 0.3, [0xf2e6a0, 0xf0f0ff, 0xb08adf]], ['bush', 0.2, [0x3f5a2c, 0x4b6a33]], ['log', 0.05, [0x5a4632, 0x6a5a48]]],
  hills: [['tuft', 1.5, [0x5c7334, 0x7a9a3c, 0x8a9a4a]], ['flower', 1.0, [0xf4d03a, 0xf2f2ee, 0xe86a8a, 0x9a7ae0, 0xff8a3a]], ['bush', 0.45, [0x3d5a2a, 0x4e7a30, 0x6a8a3a]],
    ['rock', 0.3, [0x948a78, 0x7a7264]], ['mushroom', 0.12, [0xd24a3a, 0xe8d8b0]], ['log', 0.06, [0x5a4632]]],
  river: [['reed', 0.7, [0x8a8a4a, 0x6f8040]], ['tuft', 1.0, [0x4f6b30, 0x6a7a3a]], ['rock', 0.5, [0x7f7a6e, 0x6a665c]], ['flower', 0.4, [0xf0e6a0, 0xe8f0f0]],
    ['bush', 0.35, [0x2f4a26, 0x3d5a2a]], ['log', 0.08, [0x5a4632]]],
  coast: [['shell', 0.45, [0xf4e9dc, 0xf0c8b0, 0xe8e4d0]], ['rock', 0.5, [0xb4a78e, 0x9a8f7a]], ['tuft', 0.6, [0x7b7d45, 0x8f8552]],
    ['driftwood', 0.15, [0xb8a890, 0x9a8a74]], ['bush', 0.15, [0x4a5a30, 0x5a6a38]]],
  desert: [['rock', 0.6, [0xb4744a, 0x9a6a48, 0xc28c5f]], ['dry', 0.7, [0x8a7a4a, 0x9a8a5a]], ['bone', 0.07, [0xffffff]], ['cactusSmall', 0.2, [0x5d7a3a]], ['tuft', 0.2, [0xa89a5a]]],
  city: [['litter', 0.5, [0x8a8a90, 0xc8472f, 0xd4a537, 0x3a6ea5]], ['tuft', 0.4, [0x56604a, 0x5f6352]], ['rock', 0.12, [0x7b7974]], ['bush', 0.15, [0x3a4a30]]],
  cavern: [['stalagmite', 0.55, [0x5c5249, 0x4b4139]], ['crystal', 0.4, [0x3ae0c8, 0xffb070, 0x7a9aff, 0xff6ab0]], ['rock', 0.7, [0x5c5249, 0x4b4139]], ['mushroom', 0.25, [0x7ae0b0, 0xa0c0ff]]],
  inferno: [['shard', 0.6, [0x15100e, 0x241814]], ['rock', 0.5, [0x3b2b25, 0x2c231f]], ['ember', 0.3, [0xffffff]]],
  abyss: [['coral', 0.6, [0xe8607a, 0xf0a050, 0x5ac8c0, 0xb06ae0]], ['weed', 0.9, [0x4a7a52, 0x5a8a40, 0x3a6a5a]], ['rock', 0.5, [0x42504f, 0x38443f]], ['shell', 0.3, [0xf0c8b0, 0xe8e4d0]]],
  heaven: [['puff', 0.5, [0xc4d4ec, 0xe6d8cc, 0xf4ece4]], ['tuft', 0.5, [0x8d9868, 0xa09c76]], ['flower', 0.5, [0xffffff, 0xfff0b0]], ['rock', 0.2, [0xd6d0c4, 0xc8c1b3]]],
  space: [['plate', 0.4, [0x6a6e76, 0x8a8f96, 0xc8ccd2]], ['rock', 0.5, [0x55575c, 0x4a4c50]], ['crystal', 0.1, [0xcfe2ff, 0x9ac0ff]]],
  upside: [['spore', 0.5, [0xff6a2a, 0xff9a3a]], ['bone', 0.14, [0xffffff]], ['rock', 0.5, [0x3a4148, 0x2e353b]], ['gnarl', 0.45, [0x1a1416, 0x241a1c]],
    ['dry', 0.5, [0x3a2f2c, 0x2e2624]], ['mushroom', 0.2, [0x6a2a30, 0x4a3a4a]]],
};
// The size a kind is drawn at, from the smallest to the largest.
const SIZE = {
  rock: [0.6, 2.4], snowrock: [0.8, 2.6], tuft: [1.0, 2.0], flower: [1.3, 2.3], bush: [0.9, 2.2], log: [1.0, 2.2], mushroom: [1.2, 2.4], reed: [1.0, 1.7],
  shell: [1.2, 2.2], driftwood: [0.9, 2.0], dry: [1.0, 2.0], bone: [1.0, 1.8], cactusSmall: [0.9, 1.8], litter: [0.9, 1.4], stalagmite: [0.7, 2.6], crystal: [0.6, 2.0],
  shard: [0.7, 2.6], ember: [1.0, 2.0], coral: [1.0, 2.4], weed: [0.9, 1.7], puff: [1.4, 4.2], plate: [0.8, 2.0], spore: [1.0, 2.2], gnarl: [1.0, 2.4],
};
// Where a kind may stand: in the water too (reeds, weed, coral, shells, the
// sea of cloud's puffs) or not.
const WET = new Set(['reed', 'weed', 'coral', 'shell', 'puff']);

const KINDS = Object.keys(BUILD);

function clutterMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * 1.6;');
  };
  mat.customProgramCacheKey = () => 'continuum-clutter';
  return withSunMask(withAtmosphere(mat), false);
}

export class Clutter {
  // env: road, sCar() (where the car is on it), heightAt(ax, az) (absolute),
  // waterAt(ax, az), worlds, seed.
  constructor(scene, env) {
    this.env = env;
    this.seed = env.seed || 0;
    this.scene = scene;
    this.material = clutterMaterial();
    this.cells = new Map();
    this.blocky = false;
    this.meshes = new Map();
    this.counts = {};
    this.dirty = true;
    this.shown = 0;
    this._last = { x: 1e9, z: 1e9 };
    this._w = { a: 0, b: 0, t: 0, u: 0 };
    this._dummy = new THREE.Object3D();
    this._color = new THREE.Color();
    this._q = new THREE.Quaternion();
  }

  // The block style's are all boxes.
  setBlocky(on) {
    if (on === this.blocky) return;
    this.blocky = on;
    for (const m of this.meshes.values()) m.visible = false;
    this.dirty = true;
  }

  shift() {
    this.dirty = true;
  }

  _mesh(kind) {
    const key = `${kind}:${this.blocky ? 'b' : 's'}`;
    let m = this.meshes.get(key);
    if (!m) {
      const bits = new Bits(this.blocky);
      BUILD[kind](bits);
      const geo = bits.done();
      if (LYING.has(kind)) {
        // Built standing, laid down along -x, and put with its middle at the origin.
        geo.rotateZ(Math.PI / 2);
        geo.translate(0.9, 0.14, 0);
      }
      m = new THREE.InstancedMesh(geo, this.material, MAX);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = true;
      m.count = 0;
      this.scene.add(m);
      this.meshes.set(key, m);
      m.userData.kind = kind;
    }
    return m;
  }

  // The things in one cell.
  _lay(cx, cz) {
    const env = this.env;
    const rand = mulberry32(hash(cx, cz, this.seed));
    const ax = (cx + 0.5) * CELL;
    const az = (cz + 0.5) * CELL;
    const w = env.worlds ? env.worlds.at(ax, az, this._w) : { a: 0, b: 0, t: 0 };
    const A = KITS[WORLDS[w.a].id] || [];
    const B = KITS[WORLDS[w.b].id] || A;
    const total = (kit) => kit.reduce((s, e) => s + e[1], 0);
    const dens = (total(A) * (1 - w.t) + total(B) * w.t) * DENSITY;
    const n = Math.floor(dens + rand());
    const items = [];
    const o = env.road.origin;
    for (let i = 0; i < n; i++) {
      const x = (cx + rand()) * CELL;
      const z = (cz + rand()) * CELL;
      const kit = rand() < w.t ? B : A;
      let r = rand() * total(kit);
      let pick = kit[0];
      for (const e of kit) {
        r -= e[1];
        if (r <= 0) {
          pick = e;
          break;
        }
      }
      const [kind, , colours] = pick;
      const lx = x - o.x;
      const lz = z - o.z;
      const near = env.road.nearestS(lx, lz, env.sCar(), 140);
      if (near.dist < HALF_FLAT + 1.8) continue;
      let y = env.heightAt(x, z);
      const water = env.waterAt(x, z);
      const sunk = (WORLDS[w.a].params.underwater && w.t < 0.5) || (WORLDS[w.b].params.underwater && w.t >= 0.5);
      let tilt = (rand() - 0.5) * 0.2;
      if (kind === 'plate') {
        // Broken metal drifts about a road that floats, at its height.
        const p = env.road.at(near.s);
        if (!p) continue;
        y = p.y + (rand() - 0.5) * 16;
        tilt = (rand() - 0.5) * 1.2;
      } else if (!sunk && !WET.has(kind) && y < water + 0.3) continue;
      else if (!sunk && WET.has(kind) && kind !== 'shell') {
        // Reeds stand in the shallows; the clouds' puffs lie on the sea of cloud.
        if (kind === 'puff') y = Math.max(y, water) + 0.5;
        else if (y < water - 0.4 || y > water + 1.4) continue;
      }
      if (env.solidAt && env.solidAt(x, y + 0.6, z)) continue;
      const lo = SIZE[kind][0];
      const hi = SIZE[kind][1];
      items.push({
        kind, x, z, y,
        yaw: rand() * Math.PI * 2,
        size: lo + (hi - lo) * Math.pow(rand(), 1.6),
        colour: colours[Math.floor(rand() * colours.length) % colours.length],
        tilt,
      });
    }
    return items;
  }

  update(camera, dt) {
    const o = this.env.road.origin;
    const cam = camera.position;
    const ax = cam.x + o.x;
    const az = cam.z + o.z;
    const c0x = Math.floor((ax - RADIUS) / CELL);
    const c1x = Math.floor((ax + RADIUS) / CELL);
    const c0z = Math.floor((az - RADIUS) / CELL);
    const c1z = Math.floor((az + RADIUS) / CELL);
    // Lay the nearest cells that are missing, a few a frame; drop the far ones.
    const want = [];
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const dx = (cx + 0.5) * CELL - ax;
        const dz = (cz + 0.5) * CELL - az;
        if (dx * dx + dz * dz > RADIUS * RADIUS) continue;
        const key = cx * 100003 + cz;
        if (!this.cells.has(key)) want.push([dx * dx + dz * dz, cx, cz, key]);
      }
    }
    want.sort((p, q) => p[0] - q[0]);
    for (let i = 0; i < Math.min(PER_FRAME, want.length); i++) {
      const [, cx, cz, key] = want[i];
      this.cells.set(key, { cx, cz, items: this._lay(cx, cz) });
      this.dirty = true;
    }
    if (this.cells.size > 260) {
      for (const [key, cell] of this.cells) {
        const dx = (cell.cx + 0.5) * CELL - ax;
        const dz = (cell.cz + 0.5) * CELL - az;
        if (dx * dx + dz * dz > (RADIUS + CELL * 2) * (RADIUS + CELL * 2)) {
          this.cells.delete(key);
          this.dirty = true;
        }
      }
    }
    // Written again when the set has changed, or the lens has moved on far
    // enough for the fade at the edge to show.
    if (Math.hypot(ax - this._last.x, az - this._last.z) > 3) this.dirty = true;
    if (this.dirty) this._write(ax, az, o);
  }

  _write(ax, az, o) {
    this.dirty = false;
    this._last.x = ax;
    this._last.z = az;
    const counts = {};
    const d = this._dummy;
    d.rotation.order = 'YXZ';
    for (const m of this.meshes.values()) m.count = 0;
    for (const cell of this.cells.values()) {
      for (const it of cell.items) {
        const dist = Math.hypot(it.x - ax, it.z - az);
        const fade = 1 - Math.min(1, Math.max(0, (dist - (RADIUS - FADE)) / FADE));
        if (fade <= 0.02) continue;
        const m = this._mesh(it.kind);
        const i = m.count;
        if (i >= MAX) continue;
        d.position.set(it.x - o.x, it.y - 0.04, it.z - o.z);
        d.rotation.set(it.tilt, it.yaw, it.tilt * 0.7);
        d.scale.setScalar(it.size * fade);
        d.updateMatrix();
        m.setMatrixAt(i, d.matrix);
        this._color.setHex(it.colour, THREE.SRGBColorSpace);
        m.instanceColor.setXYZ(i, this._color.r, this._color.g, this._color.b);
        m.count = i + 1;
        counts[it.kind] = (counts[it.kind] || 0) + 1;
      }
    }
    let shown = 0;
    for (const m of this.meshes.values()) {
      const isNow = m.userData.kind && this.meshes.get(`${m.userData.kind}:${this.blocky ? 'b' : 's'}`) === m;
      if (!isNow) m.count = 0;
      m.visible = isNow && m.count > 0;
      if (m.visible) {
        m.instanceMatrix.needsUpdate = true;
        m.instanceColor.needsUpdate = true;
        shown += m.count;
      }
    }
    this.counts = counts;
    this.shown = shown;
  }
}
