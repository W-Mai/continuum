import * as THREE from 'three';

// Props are drawn with one InstancedMesh whose geometry is swapped per biome.
// The instance capacity never changes, so a scene change costs a matrix rewrite
// and a colour update, not any allocation.

const MAX_PROPS = 420;
const SPACING = 12;
const SIDE_MIN = 9;
const SIDE_MAX = 34;

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

// Lit windows as a separate thin box in front of each face. A texture would need
// per-instance UV variation, and a texture on an InstancedMesh with 400 instances
// still needs a shader; this is a handful of triangles and reads correctly at
// night.
function towerWindowsGeo() {
  const parts = [];
  const floors = 14;
  const cols = 4;
  for (const [ax, az, ry] of [[0, 5.56, 0], [0, -5.56, 0], [5.56, 0, Math.PI / 2], [-5.56, 0, Math.PI / 2]]) {
    for (let f = 0; f < floors; f++) {
      for (let c = 0; c < cols; c++) {
        // Skip a deterministic subset so the tower is not a uniform grid.
        if (((f * 7 + c * 13 + Math.round(ax + az)) % 5) < 1) continue;
        const w = 1.5, h = 1.1;
        const pane = new THREE.PlaneGeometry(w, h);
        pane.rotateY(ry);
        const off = (c - (cols - 1) / 2) * 2.3;
        if (ry === 0) pane.translate(off, 4 + f * 4.0, az * 1.02);
        else pane.translate(ax * 1.02, 4 + f * 4.0, off);
        parts.push(pane);
      }
    }
  }
  return mergeGeos(parts);
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

// Base scale per kind. The geometries are authored at true metre size, so this is
// a multiplier for variety, not a correction. One shared factor made a 14 m barn
// and a 5 m tree the same apparent size.
const KIND_SCALE = {
  conifer: 1.0, house: 0.62, barn: 0.52, silo: 0.70, billboard: 0.85,
  tower: 1.0, asteroid: 1.0, stalagmite: 0.8, lavaspire: 0.8, pillar: 0.9,
  kelp: 1.0, dune: 1.0, deer: 0.9, sheep: 0.9, bird: 1.0,
};

const GEOMS = {
  conifer: coniferGeo,
  tower: towerGeo,
  tower_windows: towerWindowsGeo,
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
  // `seed` offsets every placement hash, so a fresh launch grows a different
  // roadside instead of the same houses at the same metre marks.
  constructor(parent, seed = 0) {
    this.parent = parent;
    this.seed = seed;
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

  // Props are placed by their centre, then spun to a random yaw, so a long building
  // can reach back over the shoulder no matter where its centre sits. The bounding
  // sphere is the only size that holds for every rotation.
  _radius(kind) {
    this._radii = this._radii || new Map();
    let r = this._radii.get(kind);
    if (r === undefined) {
      const geo = this._geoFor(kind);
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const base = KIND_SCALE[kind] !== undefined ? KIND_SCALE[kind] : 1;
      r = geo.boundingSphere ? geo.boundingSphere.radius * base * this.scale * 1.15 : 0;
      this._radii.set(kind, r);
    }
    return r;
  }

  _slot(kind) {
    let slot = this.slots.get(kind);
    if (!slot) {
      const mesh = new THREE.InstancedMesh(
        this._geoFor(kind), this._matFor(kind), MAX_PROPS,
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
    this.tint = tint;
    for (const k of this.kinds) {
      const m = this._matFor(k);
      m.color.setHex(this._kindColour(k, tint));
    }

    for (const k of this.kinds) this._slot(k);
    if (this.kinds.includes('tower')) this._slot('tower_windows');
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

  // Buildings are not vegetation: giving them the biome's plant tint turned every
  // farmhouse into another bush. Each kind has its own palette, blended toward the
  // biome tint so it still belongs to the scene.
  _kindColour(kind, tint) {
    const base = {
      tower_windows: 0xffd890,
      house: 0xb8a894, barn: 0x8a5a44, silo: 0xa8a8a0,
      billboard: 0xd8d4c8, tower: 0x2b3340,
      conifer: 0x2f5230, kelp: 0x2a7a66, dune: 0xd8b374,
      deer: 0x8a5a34, sheep: 0xe4e0d4, bird: 0x4a4a52,
      asteroid: 0x39404f, stalagmite: 0x54402e,
      lavaspire: 0xff4a00, pillar: 0xd8d0c4,
    }[kind];
    if (base === undefined) return tint;
    const c = new THREE.Color(base);
    return c.lerp(new THREE.Color(tint), 0.25).getHex();
  }

  _matFor(kind) {
    if (!this.mats) this.mats = new Map();
    let m = this.mats.get(kind);
    if (!m) {
      if (kind === 'tower_windows') {
        // Unlit: a window is a light source, not a lit surface.
        m = new THREE.MeshBasicMaterial({ color: 0xffd890, fog: true });
      } else {
        m = this.mat.clone();
        m.color.setHex(this._kindColour(kind, this.tint || 0x2f5230));
      }
      this.mats.set(kind, m);
    }
    return m;
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
      const r0 = rng(i * 3.1 + this.seed * 0.013);
      if (r0 > this.density) continue;

      const s = i * SPACING + r0 * SPACING;
      const p = track.at(s);
      if (!p) continue;

      const side = rng(i * 7.7 + this.seed * 0.017) > 0.5 ? 1 : -1;

      // Deterministic kind choice, so a given row always grows the same thing.
      const kind = this.kinds[Math.floor(rng(i * 5.3 + this.seed * 0.019) * this.kinds.length)]
        || this.kinds[0];
      const slot = this.slots.get(kind);
      if (!slot || slot.count >= perKind) continue;

      const off = SIDE_MIN + this._radius(kind)
        + Math.pow(rng(i * 11.3 + this.seed * 0.023), 0.65) * (SIDE_MAX - SIDE_MIN);
      const nx = -Math.sin(p.theta);
      const nz = Math.cos(p.theta);

      const px = p.x + nx * off * side;
      const pz = p.z + nz * off * side;
      const ground = this.sampleGround ? this.sampleGround(px, pz) : (p.y || 0);

      // Nothing stands in the sea. A building on a drowned hillside reads as
      // floating, and no amount of sinking it fixes that.
      if (this.waterLevel !== null && ground < this.waterLevel + 0.4) continue;

      this._p.set(px, ground - 0.4, pz);
      this._e.set(0, rng(i * 19.1) * Math.PI * 2, 0);
      this._q.setFromEuler(this._e);
      const base = KIND_SCALE[kind] !== undefined ? KIND_SCALE[kind] : 1;
      const sc = this.scale * base * (0.85 + rng(i * 13.9) * 0.3);
      // Height varies only a little: stretching it sheared pitched roofs apart.
      this._s.set(sc, sc * (0.94 + rng(i * 23.7) * 0.12), sc);

      this._m.compose(this._p, this._q, this._s);
      slot.mesh.setMatrixAt(slot.count++, this._m);

      // A tower carries its lit windows with it: same transform, emissive material.
      if (kind === 'tower') {
        const wslot = this.slots.get('tower_windows');
        if (wslot && wslot.count < perKind) {
          wslot.mesh.setMatrixAt(wslot.count++, this._m);
        }
      }
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
