import * as THREE from 'three';

// Props are drawn with one InstancedMesh whose geometry is swapped per biome.
// The instance capacity never changes, so a scene change costs a matrix rewrite
// and a colour update, not any allocation.

const MAX_PROPS = 420;
const SPACING = 22;
const SIDE_MIN = 14;
const SIDE_MAX = 190;

function rng(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function mergeGeos(geos) {
  let vCount = 0;
  let iCount = 0;
  for (const g of geos) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of geos) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    pos.set(p.array, vo * 3);
    if (n) nrm.set(n.array, vo * 3);
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.array[i] + vo;
    } else {
      for (let i = 0; i < p.count; i++) idx[io++] = i + vo;
    }
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function coniferGeo() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.5, 0.7, 5, 5);
  trunk.translate(0, 2.5, 0);
  parts.push(trunk);
  for (let i = 0; i < 3; i++) {
    const cone = new THREE.ConeGeometry(3.4 - i * 0.8, 6.5, 6);
    cone.translate(0, 5 + i * 3.4, 0);
    parts.push(cone);
  }
  return mergeGeos(parts);
}

function towerGeo() {
  const g = new THREE.BoxGeometry(11, 60, 11);
  g.translate(0, 30, 0);
  return g;
}

function crystalGeo() {
  const g = new THREE.IcosahedronGeometry(5, 0);
  g.scale(1, 2.2, 1);
  g.translate(0, 9, 0);
  return g;
}

function stalagmiteGeo() {
  const g = new THREE.ConeGeometry(3.2, 26, 7);
  g.translate(0, 13, 0);
  return g;
}

function lavaspireGeo() {
  const parts = [];
  const base = new THREE.ConeGeometry(5, 30, 6);
  base.translate(0, 15, 0);
  parts.push(base);
  const tip = new THREE.ConeGeometry(1.6, 14, 5);
  tip.translate(0, 34, 0);
  parts.push(tip);
  return mergeGeos(parts);
}

function pillarGeo() {
  const parts = [];
  const shaft = new THREE.CylinderGeometry(2.2, 2.4, 34, 8);
  shaft.translate(0, 17, 0);
  parts.push(shaft);
  const cap = new THREE.BoxGeometry(6, 2, 6);
  cap.translate(0, 34, 0);
  parts.push(cap);
  return mergeGeos(parts);
}

function kelpGeo() {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const h = 18 + i * 3;
    const blade = new THREE.CylinderGeometry(0.35, 0.7, h, 5);
    blade.translate(Math.cos(i * 1.7) * 1.6, h * 0.5, Math.sin(i * 1.7) * 1.6);
    parts.push(blade);
  }
  return mergeGeos(parts);
}

function duneGeo() {
  const g = new THREE.SphereGeometry(16, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
  g.scale(1, 0.34, 1);
  return g;
}

const GEOMS = {
  conifer: coniferGeo,
  tower: towerGeo,
  asteroid: crystalGeo,
  stalagmite: stalagmiteGeo,
  lavaspire: lavaspireGeo,
  pillar: pillarGeo,
  kelp: kelpGeo,
  dune: duneGeo,
};

export class PropField {
  constructor(parent) {
    this.geoCache = {};
    this.mat = new THREE.MeshStandardMaterial({
      color: 0x2f5230, roughness: 0.9, metalness: 0.0, flatShading: true,
    });
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1), this.mat, MAX_PROPS,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);

    this.kind = 'conifer';
    this.density = 1;
    this.scale = 1;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._e = new THREE.Euler();
    this.activeCount = 0;
    this.setKind('conifer', 0x2f5230);
  }

  _geoFor(kind) {
    if (!this.geoCache[kind]) {
      const factory = GEOMS[kind] || GEOMS.conifer;
      this.geoCache[kind] = factory();
    }
    return this.geoCache[kind];
  }

  setKind(kind, tint) {
    this.mat.color.setHex(tint);
    if (this.kind === kind && this.mesh.geometry !== undefined
        && this.mesh.geometry.attributes.position.count > 24) {
      return;
    }
    this.kind = kind;
    this.mesh.geometry = this._geoFor(kind);
  }

  setDensity(d, scale) {
    this.density = d;
    this.scale = scale;
  }

  // Positions are a pure function of the row index, so a prop stays put while
  // the car approaches it and does not jump when a row is recycled.
  update(track, sCar, window = 700) {
    let n = 0;
    const first = Math.floor((sCar - 120) / SPACING);
    const last = Math.floor((sCar + window) / SPACING);

    for (let i = first; i <= last && n < MAX_PROPS; i++) {
      const r0 = rng(i * 3.1);
      if (r0 > this.density) continue;

      const s = i * SPACING + r0 * SPACING;
      const p = track.at(s);
      if (!p) continue;

      const side = rng(i * 7.7) > 0.5 ? 1 : -1;
      const off = SIDE_MIN + Math.pow(rng(i * 11.3), 0.65) * (SIDE_MAX - SIDE_MIN);
      const nx = -Math.sin(p.theta);
      const nz = Math.cos(p.theta);

      // Props sit on the land, which follows the road's elevation field.
      this._p.set(p.x + nx * off * side, (p.y || 0) - 0.4, p.z + nz * off * side);
      this._e.set(0, rng(i * 19.1) * Math.PI * 2, 0);
      this._q.setFromEuler(this._e);
      const sc = this.scale * (0.75 + rng(i * 13.9) * 0.6);
      this._s.set(sc, sc * (0.8 + rng(i * 23.7) * 0.5), sc);

      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(n++, this._m);
    }

    this.activeCount = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
