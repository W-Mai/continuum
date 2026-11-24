// The valley's solid things in one mesh: the gravel bars, the decks of the piers and the boats.
//
// Each of them is a few hundred triangles of flat-shaded faces with a colour to each, drawn with
// the one material (render/valleypier.js, structureMaterial), so they are baked into one buffer
// and drawn at once. A rebuild puts the set that is in reach into it (when the set changes, or
// the floating origin has moved); between rebuilds only a boat's vertices are written again,
// as it rides the water.

import * as THREE from 'three';

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

// vertices, indices: the room there is for them. (Eight bars, three piers and their boats come to about 15 000 and 17 000.)
export const STRUCT = { vertices: 20000, indices: 30000 };

export class Merged {
  constructor(scene, material) {
    this.scene = scene;
    this.pos = new Float32Array(STRUCT.vertices * 3);
    this.nrm = new Float32Array(STRUCT.vertices * 3);
    this.col = new Float32Array(STRUCT.vertices * 3);
    this.idx = new Uint32Array(STRUCT.indices);
    const g = new THREE.BufferGeometry();
    this._attrs = [['position', this.pos], ['normal', this.nrm], ['color', this.col]].map(([name, array]) => {
      const a = new THREE.BufferAttribute(array, 3);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      return a;
    });
    this._index = new THREE.BufferAttribute(this.idx, 1);
    this._index.setUsage(THREE.DynamicDrawUsage);
    g.setIndex(this._index);
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.nv = 0;          // vertices in use
    this.ni = 0;          // indices in use
    this.full = false;    // something did not fit
  }

  // A new set is to be put in: what was there is let go.
  begin() {
    this.nv = 0;
    this.ni = 0;
    this.full = false;
  }

  // The set is in: what is held is drawn.
  end() {
    this.mesh.geometry.setDrawRange(0, this.ni);
    for (const a of this._attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.nv * 3);
      a.needsUpdate = true;
    }
    this._index.clearUpdateRanges();
    this._index.addUpdateRange(0, this.ni);
    this._index.needsUpdate = true;
  }

  // Appends a geometry (indexed or not, with position, normal and colour) put through the matrix `m`, its normals through the
  // matrix's inverse transpose. Returns its place in the buffers ({ geo, v0, count }), or null where it did not fit.
  add(geo, m) {
    const p = geo.getAttribute('position');
    const index = geo.getIndex();
    const count = p.count;
    const nIdx = index ? index.count : count;
    if (this.nv + count > STRUCT.vertices || this.ni + nIdx > STRUCT.indices) {
      this.full = true;
      return null;
    }
    const part = { geo, v0: this.nv, count };
    const c = geo.getAttribute('color');
    for (let i = 0; i < count; i++) {
      const w = (part.v0 + i) * 3;
      this.col[w] = c.getX(i);
      this.col[w + 1] = c.getY(i);
      this.col[w + 2] = c.getZ(i);
    }
    this._put(part, m);
    for (let i = 0; i < nIdx; i++) this.idx[this.ni + i] = part.v0 + (index ? index.getX(i) : i);
    this.nv += count;
    this.ni += nIdx;
    return part;
  }

  // The vertices of a part written again, put through `m`: a boat that has moved.
  pose(part, m) {
    if (!part) return;
    this._put(part, m);
    for (let k = 0; k < 2; k++) {
      const a = this._attrs[k];
      a.addUpdateRange(part.v0 * 3, part.count * 3);
      a.needsUpdate = true;
    }
  }

  _put(part, m) {
    const p = part.geo.getAttribute('position');
    const n = part.geo.getAttribute('normal');
    _nm.getNormalMatrix(m);
    for (let i = 0; i < part.count; i++) {
      _p.fromBufferAttribute(p, i).applyMatrix4(m);
      _n.fromBufferAttribute(n, i).applyMatrix3(_nm).normalize();
      const w = (part.v0 + i) * 3;
      this.pos[w] = _p.x;
      this.pos[w + 1] = _p.y;
      this.pos[w + 2] = _p.z;
      this.nrm[w] = _n.x;
      this.nrm[w + 1] = _n.y;
      this.nrm[w + 2] = _n.z;
    }
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
  }
}
