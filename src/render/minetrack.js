// A mine's narrow track beside the road: two rails on sleepers, laid on the ground
// three metres outside the road's verge, for thirty or ninety metres in each
// five hundred, with a cart standing on it.
//
// Where a track runs comes from the plan (world/cavernplan.js). Each piece of it
// (two metres of rails and three sleepers) is one instance of one mesh, laid on the
// ground it stands on, pitched with it along the track and leaning with it across;
// the carts are another, one to a track. Lit as the things that stand by the road
// are, so the painted style gives it its flat paints and the block style (all of it
// boxes) needs nothing.

import * as THREE from 'three';
import { withAtmosphere, withSunMask } from './atmosphere.js';
import { MARK } from './style.js';
import { TRACK } from '../world/cavernplan.js';

// range: how far off a track is drawn (m); max: the pieces and the carts there are room for;
// the rail's and the sleeper's colours, the cart's body, its load and its wheels (sRGB).
export const TRACKS = {
  range: 700,
  pieces: 220,
  carts: 6,
  rail: 0x6d5545,
  sleeper: 0x3b2d20,
  body: 0x6a4a32,
  load: 0x33302c,
  wheel: 0x2a2622,
  solid: 0.9,
};

const lin = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

// Boxes [cx, cy, cz, sx, sy, sz, colour] as one geometry: flat faces, a colour to each box.
function boxes(list) {
  const pos = [];
  const nrm = [];
  const col = [];
  const idx = [];
  for (const [cx, cy, cz, sx, sy, sz, hex] of list) {
    const c = lin(hex);
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const faces = [
      [[1, 0, 0], [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]], 0.8],
      [[-1, 0, 0], [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]], 0.8],
      [[0, 1, 0], [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]], 1.1],
      [[0, -1, 0], [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]], 0.6],
      [[0, 0, 1], [[hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [-hx, -hy, hz]], 0.9],
      [[0, 0, -1], [[-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz]], 0.9],
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
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// A piece of track: along z, two metres, the gauge across x.
function pieceGeometry() {
  const g = TRACK.gauge / 2;
  const u = TRACK.unit;
  const list = [];
  for (const z of [-u / 3, 0, u / 3]) list.push([0, 0.05, z, g * 2 + 0.25, 0.1, 0.16, TRACKS.sleeper]);
  for (const x of [-g, g]) list.push([x, 0.155, 0, 0.07, 0.11, u, TRACKS.rail]);
  return boxes(list);
}

// A cart: a body on four wheels, with a load heaped in it.
function cartGeometry() {
  const list = [
    [0, 0.695, 0, 1.0, 0.75, 1.5, TRACKS.body],
    [0, 1.11, 0, 0.84, 0.24, 1.3, TRACKS.load],
  ];
  for (const x of [-0.46, 0.46]) for (const z of [-0.5, 0.5]) list.push([x, 0.25, z, 0.08, 0.3, 0.3, TRACKS.wheel]);
  return boxes(list);
}

function trackMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.3 });
  mat.customProgramCacheKey = () => 'continuum-minetrack';
  mat.userData.mark = MARK.built;
  return withSunMask(withAtmosphere(mat), false);
}

export class MineTrack {
  // env: plan (CavernPlan), road (origin), origin().
  constructor(scene, env) {
    this.env = env;
    this.scene = scene;
    this.material = trackMaterial();
    this.pieces = new THREE.InstancedMesh(pieceGeometry(), this.material, TRACKS.pieces);
    this.carts = new THREE.InstancedMesh(cartGeometry(), this.material, TRACKS.carts);
    for (const m of [this.pieces, this.carts]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = false;
      m.count = 0;
      m.visible = false;
      scene.add(m);
    }
    this.tracks = [];                // the tracks laid out: { k, t }
    this.cartList = [];              // the carts: [ax, az] (absolute)
    this.count = 0;                  // pieces drawn
    this._key = '';
    this._dirty = true;
    this._m = new THREE.Matrix4();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._x = new THREE.Vector3();
    this._y = new THREE.Vector3();
    this._z = new THREE.Vector3();
  }

  shift() {
    this._dirty = true;
  }

  // The matrix of the piece from point i to the next of a track: its middle on the ground there,
  // along the track, leaning with the ground; stretch: the piece is as long as the points are
  // apart (a cart keeps its own length).
  _piece(t, i, o, out, stretch = true) {
    const p = t.pts;
    const a = this._a.set(p[i * 4] - o.x, p[i * 4 + 1], p[i * 4 + 2] - o.z);
    const b = this._b.set(p[i * 4 + 4] - o.x, p[i * 4 + 5], p[i * 4 + 6] - o.z);
    const z = this._z.copy(b).sub(a);
    const len = z.length();
    z.divideScalar(len || 1);
    // Across: to the right of the way along, turned down by the lean of the ground, which rises
    // to the road's left.
    const lean = (p[i * 4 + 3] + p[i * 4 + 7]) / 2;
    const x = this._x.set(z.z, -lean, -z.x);
    x.addScaledVector(z, -x.dot(z)).normalize();
    const y = this._y.crossVectors(z, x);
    out.makeBasis(x, y, stretch ? z.multiplyScalar(len / TRACK.unit) : z);
    out.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    return out;
  }

  // Every frame in the cavern. tier: 'high' (the only one the track is drawn at), sCar. settle: the clock is
  // standing still (the photo mode): every stretch there is to work out is worked out at once.
  update(camera, on, tier, sCar, shown = true, settle = false) {
    const hide = !on || !shown || tier !== 'high';
    if (hide) {
      if (this.pieces.visible || this.carts.visible) {
        this.pieces.visible = false;
        this.carts.visible = false;
        this.count = 0;
        this.tracks = [];
        this.cartList = [];
        this._key = '';
      }
      return;
    }
    const o = this.env.origin();
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    const E = TRACK.every;
    const have = [];
    let looked = 0;
    for (let k = Math.floor((sCar - 700) / E); k <= Math.floor((sCar + 1200) / E); k++) {
      // (One that is not worked out yet is worked out, one a frame.)
      if (!settle && !this.env.plan.tracks.has(k) && looked++ > 0) continue;
      const t = this.env.plan.track(k);
      if (!t) continue;
      const mid = Math.floor(t.pts.length / 8);
      if (Math.hypot(t.pts[mid * 4] - ax, t.pts[mid * 4 + 2] - az) < TRACKS.range) have.push({ k, t });
    }
    const key = have.map((e) => e.k).join(',');
    if (key === this._key && !this._dirty) return;
    this._key = key;
    this._dirty = false;
    let n = 0;
    let c = 0;
    const cartList = [];
    const m = this._m;
    for (const { t } of have) {
      for (let i = 0; i < t.n && n < TRACKS.pieces; i++) {
        this.pieces.setMatrixAt(n++, this._piece(t, i, o, m));
      }
      if (t.cart >= 0 && c < TRACKS.carts) {
        this.carts.setMatrixAt(c++, this._piece(t, t.cart, o, m, false));
        cartList.push([(t.pts[t.cart * 4] + t.pts[t.cart * 4 + 4]) / 2, (t.pts[t.cart * 4 + 2] + t.pts[t.cart * 4 + 6]) / 2]);
      }
    }
    this.tracks = have;
    this.cartList = cartList;
    this.count = n;
    this.pieces.count = n;
    this.carts.count = c;
    this.pieces.instanceMatrix.needsUpdate = true;
    this.carts.instanceMatrix.needsUpdate = true;
    this.pieces.visible = n > 0;
    this.carts.visible = c > 0;
  }

  // The carts within range of an absolute point, as [x, z, radius, ...] added to out: a car off the
  // road runs into one.
  near(ax, az, range, out) {
    for (const [x, z] of this.cartList) {
      const reach = range + TRACKS.solid;
      if ((x - ax) * (x - ax) + (z - az) * (z - az) < reach * reach) out.push(x, z, TRACKS.solid);
    }
    return out;
  }

  dispose() {
    for (const m of [this.pieces, this.carts]) {
      this.scene.remove(m);
      m.geometry.dispose();
      m.dispose();
    }
    this.material.dispose();
  }
}
