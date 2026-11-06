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

function houseGeo() {
  const parts = [];
  const walls = new THREE.BoxGeometry(9, 6, 7);
  walls.translate(0, 3, 0);
  parts.push(walls);
  // A pitched roof is two boxes leaning against each other; a single prism would
  // need custom geometry for one shape used once.
  for (const s of [-1, 1]) {
    const roof = new THREE.BoxGeometry(5.4, 0.6, 7.4);
    roof.rotateZ(s * 0.62);
    roof.translate(s * 2.2, 7.0, 0);
    parts.push(roof);
  }
  const door = new THREE.BoxGeometry(0.4, 3.2, 1.8);
  door.translate(4.6, 1.6, 0);
  parts.push(door);
  return mergeGeos(parts);
}

function barnGeo() {
  const parts = [];
  const body = new THREE.BoxGeometry(14, 7, 9);
  body.translate(0, 3.5, 0);
  parts.push(body);
  const roof = new THREE.ConeGeometry(8.6, 4.2, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 9.1, 0);
  parts.push(roof);
  return mergeGeos(parts);
}

function billboardGeo() {
  const parts = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.CylinderGeometry(0.22, 0.26, 9, 5);
    leg.translate(s * 3.0, 4.5, 0);
    parts.push(leg);
  }
  const panel = new THREE.BoxGeometry(9.5, 5.0, 0.35);
  panel.translate(0, 10.6, 0);
  parts.push(panel);
  return mergeGeos(parts);
}

function siloGeo() {
  const parts = [];
  const body = new THREE.CylinderGeometry(3.1, 3.1, 15, 10);
  body.translate(0, 7.5, 0);
  parts.push(body);
  const cap = new THREE.SphereGeometry(3.1, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
  cap.translate(0, 15, 0);
  parts.push(cap);
  return mergeGeos(parts);
}

// Small animals: a body, a head and four legs. Deliberately crude, because they
// are read at speed and detail there is wasted.
function quadrupedGeo(bodyLen, bodyH, legH, horned) {
  const parts = [];
  const body = new THREE.BoxGeometry(bodyLen, bodyH, bodyH * 0.78);
  body.translate(0, legH + bodyH * 0.5, 0);
  parts.push(body);
  const head = new THREE.BoxGeometry(bodyH * 0.62, bodyH * 0.6, bodyH * 0.55);
  head.translate(bodyLen * 0.52, legH + bodyH * 0.92, 0);
  parts.push(head);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.BoxGeometry(0.28, legH, 0.28);
      leg.translate(sx * bodyLen * 0.33, legH * 0.5, sz * bodyH * 0.28);
      parts.push(leg);
    }
  }
  if (horned) {
    for (const sz of [-1, 1]) {
      const horn = new THREE.ConeGeometry(0.14, 1.0, 4);
      horn.translate(bodyLen * 0.6, legH + bodyH * 1.35, sz * 0.22);
      parts.push(horn);
    }
  }
  return mergeGeos(parts);
}

function birdGeo() {
  const parts = [];
  const body = new THREE.ConeGeometry(0.5, 2.2, 5);
  body.rotateZ(Math.PI / 2);
  parts.push(body);
  for (const s of [-1, 1]) {
    const wing = new THREE.BoxGeometry(1.1, 0.09, 2.6);
    wing.rotateZ(s * 0.3);
    wing.translate(-0.1, 0.1, s * 1.4);
    parts.push(wing);
  }
  return mergeGeos(parts);
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
  house: houseGeo,
  barn: barnGeo,
  billboard: billboardGeo,
  silo: siloGeo,
  deer: () => quadrupedGeo(2.0, 1.3, 1.1, true),
  sheep: () => quadrupedGeo(1.3, 0.9, 0.6, false),
  bird: birdGeo,
};

export class PropField {
  constructor(parent) {
    this.parent = parent;
    this.geoCache = {};
    this.mat = new THREE.MeshStandardMaterial({
      color: 0x2f5230, roughness: 0.9, metalness: 0.0, flatShading: true,
    });

    // One instanced mesh per prop kind. An InstancedMesh carries a single
    // geometry, so a biome with a mixed roadside (houses, silos, billboards)
    // needs one slot per kind rather than one mesh reused.
    this.slots = new Map();
    this.kinds = ['conifer'];
    this.density = 1;
    this.scale = 1;

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._e = new THREE.Euler();
    this.activeCount = 0;
    this.sampleGround = null;
    // Set by the game when a biome has water, so props stay on dry land.
    this.waterLevel = null;

    this.setKinds(['conifer'], 0x2f5230);
  }

  _geoFor(kind) {
    if (!this.geoCache[kind]) {
      const factory = GEOMS[kind] || GEOMS.conifer;
      this.geoCache[kind] = factory();
    }
    return this.geoCache[kind];
  }

  _slot(kind) {
    let slot = this.slots.get(kind);
    if (!slot) {
      const mesh = new THREE.InstancedMesh(
        this._geoFor(kind), this.mat, MAX_PROPS,
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.parent.add(mesh);
      slot = { mesh, count: 0 };
      this.slots.set(kind, slot);
    }
    return slot;
  }

  // A biome may declare several prop kinds; the count is shared out between them
  // so a mixed roadside appears without any of them thinning out.
  setKinds(kinds, tint) {
    const list = (Array.isArray(kinds) ? kinds : [kinds]).filter((k) => GEOMS[k]);
    this.kinds = list.length ? list : ['conifer'];
    this.mat.color.setHex(tint);

    for (const k of this.kinds) this._slot(k);
    // Slots no longer used by this biome are emptied, not destroyed: the next
    // biome that wants that kind reuses the buffers.
    for (const [kind, slot] of this.slots) {
      if (!this.kinds.includes(kind)) {
        slot.mesh.count = 0;
        slot.count = 0;
      }
    }
  }

  setKind(kind, tint) {
    this.setKinds([kind], tint);
  }

  setDensity(d, scale) {
    this.density = d;
    this.scale = scale;
  }

  // Supplied by the game so props can ask the same elevation field the terrain
  // shader uses. Without it there is no way to place a building on a hillside.
  setGroundSampler(fn) {
    this.sampleGround = fn;
  }

  setWaterLevel(y) {
    this.waterLevel = y;
  }

  // Positions are a pure function of the row index, so a prop stays put while
  // the car approaches it and does not jump when a row is recycled.
  update(track, sCar, window = 700) {
    for (const slot of this.slots.values()) slot.count = 0;

    const first = Math.floor((sCar - 120) / SPACING);
    const last = Math.floor((sCar + window) / SPACING);
    const perKind = Math.max(1, Math.floor(MAX_PROPS / this.kinds.length));

    for (let i = first; i <= last; i++) {
      const r0 = rng(i * 3.1);
      if (r0 > this.density) continue;

      const s = i * SPACING + r0 * SPACING;
      const p = track.at(s);
      if (!p) continue;

      const side = rng(i * 7.7) > 0.5 ? 1 : -1;
      const off = SIDE_MIN + Math.pow(rng(i * 11.3), 0.65) * (SIDE_MAX - SIDE_MIN);
      const nx = -Math.sin(p.theta);
      const nz = Math.cos(p.theta);

      const px = p.x + nx * off * side;
      const pz = p.z + nz * off * side;
      const ground = this.sampleGround ? this.sampleGround(px, pz) : (p.y || 0);

      // Nothing stands in the sea. A building on a drowned hillside reads as
      // floating, and no amount of sinking it fixes that.
      if (this.waterLevel !== null && ground < this.waterLevel + 0.4) continue;

      // Deterministic kind choice, so a given row always grows the same thing.
      const kind = this.kinds[Math.floor(rng(i * 5.3) * this.kinds.length)]
        || this.kinds[0];
      const slot = this.slots.get(kind);
      if (!slot || slot.count >= perKind) continue;

      this._p.set(px, ground - 0.4, pz);
      this._e.set(0, rng(i * 19.1) * Math.PI * 2, 0);
      this._q.setFromEuler(this._e);
      const sc = this.scale * (0.75 + rng(i * 13.9) * 0.6);
      this._s.set(sc, sc * (0.8 + rng(i * 23.7) * 0.5), sc);

      this._m.compose(this._p, this._q, this._s);
      slot.mesh.setMatrixAt(slot.count++, this._m);
    }

    let total = 0;
    for (const slot of this.slots.values()) {
      slot.mesh.count = slot.count;
      slot.mesh.instanceMatrix.needsUpdate = true;
      total += slot.count;
    }
    this.activeCount = total;
  }

  get mesh() {
    // Kept for callers that toggle visibility of the whole field.
    const first = this.slots.values().next().value;
    return first ? first.mesh : null;
  }
}
