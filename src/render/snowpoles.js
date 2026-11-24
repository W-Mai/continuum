// Snow poles: a pole of red and white by each side of the road, every 25 m of the road that runs
// on the ground in the alpine world, 2.4 m tall, a little outside its verge.
//
// Where they stand the plan says (world/alpineplan.js: POLE), a chunk of 200 m of road at a
// time; this lays the ones within 300 m of the lens as the instances of one mesh, each on the ground at
// its foot and leaning a little. The poles are drawn smaller from 240 m and are gone at 300 m,
// in the vertex shader (so that they shrink with the lens, not in steps as the car goes by).
// The mesh is lit as the things that stand by the road are, so the painted styles give it its
// flat paints; in the block style the poles are square columns, in the others eight-sided ones.
// A tier draws them all (high), every second one (mid), or none (low).

import * as THREE from 'three';
import { withAtmosphere, withSunMask } from './atmosphere.js';
import { MARK } from './style.js';
import { POLE } from '../world/alpineplan.js';

// max: the most poles there are room for; width: a round pole's, a square one's (m); bands: from the foot up, each its
// colour and its height (m); fade: from how far off they shrink to nothing, and how far off they are gone (m).
export const POLES = {
  max: 240,
  width: [0.13, 0.15],
  bands: [[0xe9eef2, 1.2], [0xc8261d, 0.5], [0xe9eef2, 0.2], [0xc8261d, 0.5]],
  fade: [240, 300],
  moved: 5,
};

const lin = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);

// A pole's shape: prisms of `sides` sides stacked on y 0, one to a band, each its colour, with a flat top.
function poleGeometry(sides, width) {
  const pos = [];
  const nrm = [];
  const col = [];
  const idx = [];
  const r = width / (2 * Math.cos(Math.PI / sides));
  const turn = sides === 4 ? Math.PI / 4 : Math.PI / sides;
  let y0 = 0;
  for (const [hex, h] of POLES.bands) {
    const c = lin(hex);
    const y1 = y0 + h;
    for (let i = 0; i < sides; i++) {
      const a0 = turn + (i / sides) * Math.PI * 2;
      const a1 = turn + ((i + 1) / sides) * Math.PI * 2;
      const b = pos.length / 3;
      for (const [a, y] of [[a0, y0], [a1, y0], [a1, y1], [a0, y1]]) {
        pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
        col.push(c.r, c.g, c.b);
        // (A square column is flat, an eight-sided one is shaded as a round one.)
        if (sides === 4) {
          const am = (a0 + a1) / 2;
          nrm.push(Math.cos(am), 0, Math.sin(am));
        } else nrm.push(Math.cos(a), 0, Math.sin(a));
      }
      idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    y0 = y1;
  }
  // The top.
  const c = lin(POLES.bands[POLES.bands.length - 1][0]);
  const t = pos.length / 3;
  for (let i = 0; i < sides; i++) {
    const a = turn + (i / sides) * Math.PI * 2;
    pos.push(Math.cos(a) * r, y0, Math.sin(a) * r);
    nrm.push(0, 1, 0);
    col.push(c.r, c.g, c.b);
  }
  for (let i = 1; i < sides - 1; i++) idx.push(t, t + i + 1, t + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// The height of a pole, m.
export const POLE_HEIGHT = POLES.bands.reduce((s, b) => s + b[1], 0);

function poleMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 });
  const [from, to] = POLES.fade;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  float dPole = length( ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz - cameraPosition );
  transformed *= 1.0 - smoothstep( ${from.toFixed(1)}, ${to.toFixed(1)}, dPole );
}
#endif`);
  };
  mat.customProgramCacheKey = () => 'continuum-snowpole';
  mat.userData.mark = MARK.built;
  return withSunMask(withAtmosphere(mat), false);
}

export class SnowPoles {
  // env: plan (AlpinePlan), origin(), solidAt(ax, y, az) (a thing stands there: optional).
  constructor(scene, env) {
    this.env = env;
    this.scene = scene;
    this.round = poleGeometry(8, POLES.width[0]);
    this.square = poleGeometry(4, POLES.width[1]);
    this.material = poleMaterial();
    this.mesh = new THREE.InstancedMesh(this.round, this.material, POLES.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.count = 0;                // poles drawn
    this.list = [];                // the plan's poles that are drawn: { ax, y, az, ... }
    this.blocky = false;
    this._chunks = '';
    this._at = { x: 1e9, z: 1e9 };
    this._tier = '';
    this._dirty = true;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._yaw = new THREE.Quaternion();
    this._yawAxis = new THREE.Vector3(0, 1, 0);
  }

  shift() {
    this._dirty = true;
  }

  // The block style has square columns.
  setBlocky(on) {
    if (on === this.blocky) return;
    this.blocky = on;
    this.mesh.geometry = on ? this.square : this.round;
  }

  // Every frame in the alpine. tier; sRef: where along the road the lens is (m); settle: the world stands still, so the plan
  // of every chunk is worked out at once.
  update(camera, on, tier, sRef, settle = false) {
    if (!on || tier === 'low') {
      if (this.mesh.visible) {
        this.mesh.visible = false;
        this.count = 0;
        this.list = [];
        this._chunks = '';
      }
      return;
    }
    const o = this.env.origin();
    const ax = camera.position.x + o.x;
    const az = camera.position.z + o.z;
    // The chunks of road that can have poles within range of the lens: a hairpin has the road's other legs near, which are
    // far along it.
    const P = POLE;
    const c0 = Math.floor((sRef - 900) / P.chunk);
    const c1 = Math.floor((sRef + 900) / P.chunk);
    const have = [];
    let worked = 0;
    for (let c = c0; c <= c1; c++) {
      let l = this.env.plan.chunks.get(c);
      if (l === undefined) {
        // (A chunk worked out a frame, or all at once where the world stands still.)
        if (!settle && worked++ >= 2) continue;
        l = this.env.plan.poles(c);
      }
      if (l && l.length) have.push(c);
    }
    const key = have.join(',');
    const moved = Math.hypot(ax - this._at.x, az - this._at.z) >= POLES.moved;
    if (key === this._chunks && !moved && !this._dirty && this._tier === tier) return;
    this._chunks = key;
    this._at.x = ax;
    this._at.z = az;
    this._dirty = false;
    this._tier = tier;
    const reach = POLES.fade[1] + 20;
    const half = tier === 'mid';
    const list = [];
    for (const c of have) {
      for (const q of this.env.plan.chunks.get(c)) {
        if (half && q.key % 2 !== 0) continue;
        if (Math.abs(q.ax - ax) > reach || Math.abs(q.az - az) > reach) continue;
        const d = Math.hypot(q.ax - ax, q.az - az);
        if (d >= reach) continue;
        if (this.env.solidAt && this.env.solidAt(q.ax, q.y + 1, q.az)) continue;
        list.push([d, q]);
      }
    }
    if (list.length > POLES.max) {
      list.sort((a, b) => a[0] - b[0]);
      list.length = POLES.max;
    }
    this.list = list.map((e) => e[1]);
    const m = this._m;
    const e = this._e;
    let n = 0;
    for (const q of this.list) {
      // The lean is about the world's axes, the turn about the pole's own.
      e.set(q.lx, 0, q.lz, 'XYZ');
      this._q.setFromEuler(e);
      this._yaw.setFromAxisAngle(this._yawAxis, -q.yaw);
      this._q.multiply(this._yaw);
      this._v.set(q.ax - o.x, q.y, q.az - o.z);
      m.compose(this._v, this._q, this._s);
      this.mesh.setMatrixAt(n++, m);
    }
    this.count = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (!this.mesh.parent) this.scene.add(this.mesh);
    this.mesh.visible = n > 0;
  }

  meshes() {
    return [this.mesh];
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.round.dispose();
    this.square.dispose();
    this.mesh.dispose();
    this.material.dispose();
  }
}
