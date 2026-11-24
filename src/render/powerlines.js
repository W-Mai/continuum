// The hills' line of poles: 8 m poles of wood every 45 m along one side of the road, three wires hung from each, and where the
// side changes the wires cross the road.
//
// Where a pole stands comes from the plan (world/hillsplan.js), the road laid in runs of 900 m. The poles are one
// instanced mesh (a post, a cross-arm, two braces and three glass insulators); the wires are one mesh of ribbons, a
// run of points along each span in the shape of a hanging chain, each at least a pixel and a quarter wide however far it is
// (render/farmparts.js: not a line primitive, which has a width of one pixel or none), thinning away at the end of the range. No
// pole stands on a bridge or in a tunnel, or by a bend of under 60 m: the line is not there.
//
// The tier says how far they are drawn: 500 m at the high tier, half that at the mid one, none at the low one.

import * as THREE from 'three';
import { POLE, hang } from '../world/hillsplan.js';
import { poleGeometry, wireMaterial, wireUniforms } from './farmparts.js';

const LEVELS = { high: 2, mid: 1, low: 0 };
const MAX_POLES = 56;
const MAX_SPANS = 52;
// How many pieces a span's wire is laid in, at the most.
const SEGS = 10;

export class PowerLines {
  // env: plan (HillsPlan), road; material: the one the walls have too.
  constructor(scene, env, material) {
    this.env = env;
    this.scene = scene;
    this.material = material;
    this.blocky = false;
    this.poles = this._poles(false);
    // The wires: MAX_SPANS spans of three, each (SEGS + 1) points of two vertices.
    const verts = MAX_SPANS * 3 * (SEGS + 1) * 2;
    const geo = new THREE.BufferGeometry();
    this._pos = new Float32Array(verts * 3);
    this._dir = new Float32Array(verts * 3);
    this._side = new Float32Array(verts);
    this._mid = new Float32Array(verts * 3);
    const up = new Float32Array(verts * 3);
    for (let i = 0; i < verts; i++) up[i * 3 + 1] = 1;
    const idx = new Uint32Array(MAX_SPANS * 3 * SEGS * 6);
    geo.setAttribute('position', new THREE.BufferAttribute(this._pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aDir', new THREE.BufferAttribute(this._dir, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSide', new THREE.BufferAttribute(this._side, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aMid', new THREE.BufferAttribute(this._mid, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(up, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    geo.setDrawRange(0, 0);
    this.wireMaterial = wireMaterial();
    this.wires = new THREE.Mesh(geo, this.wireMaterial);
    this.wires.frustumCulled = false;
    this.wires.castShadow = false;
    this.wires.receiveShadow = false;
    this.wires.visible = false;
    this.list = [];             // the poles laid now
    this.spans = 0;
    this.count = 0;
    this._key = '';
    this._at = { x: 1e9, z: 1e9 };
    this._dirty = true;
    this._d = new THREE.Object3D();
    this._ring = [];
  }

  _poles(blocky) {
    const mesh = new THREE.InstancedMesh(poleGeometry(blocky), this.material, MAX_POLES);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.count = 0;
    mesh.visible = false;
    return mesh;
  }

  shift() {
    this._dirty = true;
  }

  // The block style's poles are square posts.
  setBlocky(on) {
    if (on === this.blocky) return;
    this.blocky = on;
    const old = this.poles;
    if (old.parent) this.scene.remove(old);
    old.geometry.dispose();
    old.dispose();
    this.poles = this._poles(on);
    this._dirty = true;
    this._key = '';
  }

  static range(tier) {
    return POLE.range * (LEVELS[tier] >= 2 ? 1 : LEVELS[tier] === 1 ? 0.5 : 0);
  }

  // Every frame the hills are in reach. px: pixels to the radian at the lens, for the width of the wires.
  update(camera, on, tier, sCar, settle, px) {
    const range = PowerLines.range(tier);
    if (px) wireUniforms.uWirePx.value = px;
    wireUniforms.uWireRange.value = range || POLE.range;
    if (!on || range <= 0) {
      if (this.poles.visible || this.wires.visible) {
        this.poles.visible = false;
        this.wires.visible = false;
        this.list = [];
        this.spans = 0;
        this.count = 0;
        this._key = '';
      }
      return;
    }
    const o = this.env.road.origin;
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    const plan = this.env.plan;
    const reach = range + POLE.run;
    let worked = 0;
    const have = [];
    for (let r = Math.floor((sCar - reach) / POLE.run); r <= Math.floor((sCar + reach) / POLE.run); r++) {
      if (!settle && !plan.runs.has(r) && worked++ > 0) continue;
      const list = plan.poleRun(r);
      if (list && list.length) have.push(r);
    }
    const key = have.join(',') + '|' + range;
    const moved = Math.hypot(ax - this._at.x, az - this._at.z) > 6;
    if (key === this._key && !this._dirty && !moved) return;
    this._key = key;
    this._dirty = false;
    this._at.x = ax;
    this._at.z = az;
    this._lay(have, ax, az, range, o, tier);
  }

  _lay(have, ax, az, range, o, tier) {
    const plan = this.env.plan;
    // The poles in range, in order along the road, with the ones next to the range's end that the wires reach.
    const all = [];
    for (const r of have) for (const p of plan.poleRun(r)) all.push(p);
    all.sort((a, b) => a.s - b.s);
    const d = this._d;
    d.rotation.order = 'YXZ';
    const near = new Array(all.length);
    let n = 0;
    const kept = [];
    for (let i = 0; i < all.length; i++) {
      const p = all[i];
      const dist = Math.hypot(p.ax - ax, p.az - az);
      near[i] = dist;
      if (dist > range || n >= MAX_POLES) continue;
      const fade = 1 - THREE.MathUtils.smoothstep(dist, range - 70, range);
      d.position.set(p.ax - o.x, p.y, p.az - o.z);
      d.rotation.set(0, p.yaw, 0);
      d.scale.set(1, Math.max(fade, 0.001), 1);
      d.updateMatrix();
      this.poles.setMatrixAt(n, d.matrix);
      kept.push(p);
      n++;
    }
    this.poles.count = n;
    this.poles.instanceMatrix.needsUpdate = true;
    this.list = kept;
    this.count = n;
    // The wires: a span from each pole to the next along the road, when it is as long as a span is (a pole left out by a bridge or a
    // bend breaks the line there), if either end is in range.
    const segs = tier === 'high' ? SEGS : 6;
    let spans = 0;
    let vi = 0;
    let ii = 0;
    const P = POLE;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const ma = new THREE.Vector3();
    const mb = new THREE.Vector3();
    const pos = this._pos;
    const dir = this._dir;
    const side = this._side;
    const mid = this._mid;
    const idx = this.wires.geometry.index.array;
    for (let i = 0; i + 1 < all.length && spans < MAX_SPANS; i++) {
      const p = all[i];
      const q = all[i + 1];
      if (q.s - p.s > 90 || (near[i] > range && near[i + 1] > range)) continue;
      const chord = Math.hypot(q.ax - p.ax, q.az - p.az);
      if (chord < P.reach[0] || chord > P.reach[1]) continue;
      const sag = P.sag * (chord / P.every) ** 2;
      // Where the three wires come together far off (the shader joins them there): the middle of their hanging points at each end.
      ma.set(0, 0, 0);
      mb.set(0, 0, 0);
      for (const [x, y] of P.wires) {
        ma.x += p.ax - o.x + x * Math.cos(p.yaw);
        ma.y += p.y + y;
        ma.z += p.az - o.z - x * Math.sin(p.yaw);
        mb.x += q.ax - o.x + x * Math.cos(q.yaw);
        mb.y += q.y + y;
        mb.z += q.az - o.z - x * Math.sin(q.yaw);
      }
      ma.multiplyScalar(1 / P.wires.length);
      mb.multiplyScalar(1 / P.wires.length);
      for (const [x, y] of P.wires) {
        // The wire's two ends: this pole's hanging point and the next's (the arm across x, turned by the pole's yaw).
        a.set(p.ax - o.x + x * Math.cos(p.yaw), p.y + y, p.az - o.z - x * Math.sin(p.yaw));
        b.set(q.ax - o.x + x * Math.cos(q.yaw), q.y + y, q.az - o.z - x * Math.sin(q.yaw));
        const len = a.distanceTo(b);
        const base = vi;
        for (let k = 0; k <= segs; k++) {
          const t = k / segs;
          const px = a.x + (b.x - a.x) * t;
          const py = a.y + (b.y - a.y) * t - hang((t - 0.5) * len, len, sag);
          const pz = a.z + (b.z - a.z) * t;
          // (Its way along, from the points either side of it.)
          const t0 = Math.max(0, k - 1) / segs;
          const t1 = Math.min(segs, k + 1) / segs;
          let tx = (b.x - a.x) * (t1 - t0);
          let tz = (b.z - a.z) * (t1 - t0);
          let ty = (b.y - a.y) * (t1 - t0) - (hang((t1 - 0.5) * len, len, sag) - hang((t0 - 0.5) * len, len, sag));
          const tl = Math.hypot(tx, ty, tz) || 1;
          tx /= tl;
          ty /= tl;
          tz /= tl;
          const hg = hang((t - 0.5) * len, len, sag);
          for (let e = 0; e < 2; e++) {
            pos[vi * 3] = px;
            pos[vi * 3 + 1] = py;
            pos[vi * 3 + 2] = pz;
            mid[vi * 3] = ma.x + (mb.x - ma.x) * t;
            mid[vi * 3 + 1] = ma.y + (mb.y - ma.y) * t - hg;
            mid[vi * 3 + 2] = ma.z + (mb.z - ma.z) * t;
            dir[vi * 3] = tx;
            dir[vi * 3 + 1] = ty;
            dir[vi * 3 + 2] = tz;
            side[vi] = e === 0 ? -1 : 1;
            vi++;
          }
        }
        for (let k = 0; k < segs; k++) {
          const v = base + k * 2;
          idx[ii++] = v;
          idx[ii++] = v + 1;
          idx[ii++] = v + 3;
          idx[ii++] = v;
          idx[ii++] = v + 3;
          idx[ii++] = v + 2;
        }
      }
      spans++;
    }
    const g = this.wires.geometry;
    g.setDrawRange(0, ii);
    for (const name of ['position', 'aDir', 'aSide', 'aMid']) g.attributes[name].needsUpdate = true;
    g.index.needsUpdate = true;
    this.spans = spans;
    if (n > 0 && !this.poles.parent) this.scene.add(this.poles);
    if (spans > 0 && !this.wires.parent) this.scene.add(this.wires);
    this.poles.visible = n > 0;
    this.wires.visible = spans > 0;
  }

  // The poles within range of an absolute point, as [x, z, radius, ...] added to out: a car off the road runs into one.
  near(ax, az, range, out) {
    const reach = range + POLE.solid;
    for (const p of this.list) {
      if (Math.abs(p.ax - ax) > reach || Math.abs(p.az - az) > reach) continue;
      if ((p.ax - ax) ** 2 + (p.az - az) ** 2 < reach * reach) out.push(p.ax, p.az, POLE.solid);
    }
    return out;
  }

  // The meshes it draws with, for building their programs ahead.
  meshes() {
    return [this.poles, this.wires];
  }

  dispose() {
    for (const m of [this.poles, this.wires]) {
      if (m.parent) this.scene.remove(m);
      m.geometry.dispose();
    }
    this.poles.dispose();
    this.wireMaterial.dispose();
  }
}
