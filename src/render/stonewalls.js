// The hills' dry-stone walls: a wall of pieces six metres long along the verge, two metres outside it, on one side
// or the other for a run of road and then not for a while.
//
// Where a piece stands comes from the plan (world/hillsplan.js), the road laid in chunks of 60 m a frame. Each is one
// instance of one mesh (stones laid in two courses with a cope on top), put on the ground it stands on, turned along
// the road and pitched with the ground, a little longer or shorter to meet the next. They are solid: a car off the
// road runs into the circles along each (`near`), as it does into a trunk. The tier says how far they are drawn: 340 m
// at the high tier, half that at the mid one, none at the low one.

import * as THREE from 'three';
import { WALL } from '../world/hillsplan.js';
import { wallGeometry } from './farmparts.js';

const LEVELS = { high: 2, mid: 1, low: 0 };
const MAX = 220;

export class StoneWalls {
  // env: plan (HillsPlan), road; material: the one the poles have too.
  constructor(scene, env, material) {
    this.env = env;
    this.scene = scene;
    this.mesh = new THREE.InstancedMesh(wallGeometry(), material, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    this.mesh.visible = false;
    // (The mesh joins the scene when the first piece is laid, so that a game that never comes to the hills has
    // nothing of it: no program, nothing to draw.)
    this.pieces = [];             // what is laid now
    this.count = 0;
    this._key = '';
    this._at = { x: 1e9, z: 1e9 };
    this._dirty = true;
    this._d = new THREE.Object3D();
    this._d.rotation.order = 'YXZ';
    this._c = new THREE.Color();
    this._ring = [];
  }

  shift() {
    this._dirty = true;
  }

  // How far a piece is drawn at a tier, in metres.
  static range(tier) {
    return WALL.range * (LEVELS[tier] >= 2 ? 1 : LEVELS[tier] === 1 ? 0.5 : 0);
  }

  // Every frame the hills are in reach. camera, tier, sCar (where the car is along the road); settle: all that is to
  // be worked out is, now, not a chunk a frame.
  update(camera, on, tier, sCar, settle) {
    const range = StoneWalls.range(tier);
    if (!on || range <= 0) {
      if (this.mesh.visible) {
        this.mesh.visible = false;
        this.count = 0;
        this.pieces = [];
        this._key = '';
      }
      return;
    }
    const o = this.env.road.origin;
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    const plan = this.env.plan;
    const reach = range + WALL.chunk * 2;
    let worked = 0;
    const have = [];
    for (let k = Math.floor((sCar - reach) / WALL.chunk); k <= Math.floor((sCar + reach) / WALL.chunk); k++) {
      if (!settle && !plan.chunks.has(k) && worked++ > 0) continue;
      const w = plan.walls(k);
      if (w && w.length) have.push(k);
    }
    const key = have.join(',') + '|' + range;
    const moved = Math.hypot(ax - this._at.x, az - this._at.z) > 6;
    if (key === this._key && !this._dirty && !moved) return;
    this._key = key;
    this._dirty = false;
    this._at.x = ax;
    this._at.z = az;
    this._lay(have, ax, az, range, o);
  }

  _lay(have, ax, az, range, o) {
    const d = this._d;
    const m = this.mesh;
    const list = [];
    const plan = this.env.plan;
    let n = 0;
    for (const k of have) {
      for (const p of plan.walls(k)) {
        const dist = Math.hypot(p.ax - ax, p.az - az);
        if (dist > range || n >= MAX) continue;
        const dx = p.x1 - p.x0;
        const dz = p.z1 - p.z0;
        const dy = p.y1 - p.y0;
        const flat = Math.hypot(dx, dz);
        const fade = 1 - THREE.MathUtils.smoothstep(dist, range - 60, range);
        d.position.set(p.ax - o.x, (p.y0 + p.y1) / 2, p.az - o.z);
        d.rotation.set(-Math.atan2(dy, flat), p.yaw, 0);
        d.scale.set(1, (0.94 + 0.14 * p.seed) * Math.max(fade, 0.001), Math.hypot(flat, dy) / WALL.unit);
        d.updateMatrix();
        m.setMatrixAt(n, d.matrix);
        const tone = 0.9 + 0.2 * ((p.seed * 7.31) % 1);
        this._c.setRGB(tone, tone, tone);
        m.setColorAt(n, this._c);
        list.push(p);
        n++;
      }
    }
    this.pieces = list;
    this.count = n;
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor.needsUpdate = true;
    if (n > 0 && !m.parent) this.scene.add(m);
    m.visible = n > 0;
  }

  // The circles of the walls within range of an absolute point, [x, z, radius, ...] added to out: a car off the
  // road runs into one.
  near(ax, az, range, out) {
    const reach = range + WALL.unit / 2 + WALL.solid;
    const ring = this._ring;
    for (const p of this.pieces) {
      if (Math.abs(p.ax - ax) > reach || Math.abs(p.az - az) > reach) continue;
      ring.length = 0;
      this.env.plan.ring(p, ring);
      for (let i = 0; i < ring.length; i += 3) {
        const r = range + ring[i + 2];
        if ((ring[i] - ax) ** 2 + (ring[i + 1] - az) ** 2 < r * r) out.push(ring[i], ring[i + 1], ring[i + 2]);
      }
    }
    return out;
  }

  dispose() {
    if (this.mesh.parent) this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}
