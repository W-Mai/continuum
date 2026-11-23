// The grain of the road's surfaces on the GPU: the tiles of world/surface.js made
// into textures, five of them (the asphalt's two, the verge's, the concrete's and the
// steel's), each with its mips, laid by the road's materials (render/roadmesh.js).
//
// A tile is drawn by a worker (render/bakers.js) where there is one, on the page
// where there is none (a headless run, a worker that did not come up). Until it is
// there the materials read a flat one (no lean, roughness as the asphalt's own, no
// cavity), so the road is drawn from the first frame and the grain comes in the
// moment its tile does. A tier asks for what it uses (surfacesOf): a pinned low
// tier makes none.

import * as THREE from 'three';
import { SURFACES, SURFACE_NAMES, bakeSurface, mipSizes, surfacesOf } from '../world/surface.js';

// The anisotropic filtering of a tile's textures: the road is seen at a grazing angle.
const ANISOTROPY = 4;

// A tile's bytes as one texture, all its mips from the first.
function texture(bytes, size, channels) {
  const mips = [];
  let at = 0;
  for (const s of mipSizes(size)) {
    mips.push({ data: bytes.subarray(at * channels, (at + s * s) * channels), width: s, height: s });
    at += s * s;
  }
  const tex = new THREE.DataTexture(mips[0].data, size, size, channels === 4 ? THREE.RGBAFormat : THREE.RGFormat, THREE.UnsignedByteType);
  tex.mipmaps = mips;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = ANISOTROPY;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

// A texel that says nothing: no lean (128), about the asphalt's mean roughness, open
// to the sky; for a tile of two bytes, about a stone of the mean tone.
function flat(channels) {
  const data = channels === 4 ? new Uint8Array([128, 128, 220, 255]) : new Uint8Array([102, 128]);
  const tex = new THREE.DataTexture(data, 1, 1, channels === 4 ? THREE.RGBAFormat : THREE.RGFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

// Where each texture of a tile goes: the uniform it is read by.
const SLOTS = {
  asphalt: [['a', 'uSurfAsphaltA', 4], ['b', 'uSurfAsphaltB', 2]],
  verge: [['a', 'uSurfVerge', 4]],
  concrete: [['a', 'uSurfConcrete', 4]],
  steel: [['a', 'uSurfSteel', 4]],
};

export class RoadSurfaces {
  // uniforms: the road's shared uniform objects, to fill; tier: which tiles are wanted.
  constructor(uniforms, tier) {
    this.uniforms = uniforms;
    this.tier = tier;
    this.held = new Map();        // name -> [textures]
    this.asked = new Set();       // names a worker has been asked for
    this.flats = [flat(4), flat(2)];
    for (const slots of Object.values(SLOTS)) {
      for (const [, uniform, channels] of slots) uniforms[uniform].value = this.flats[channels === 4 ? 0 : 1];
    }
    this.ms = 0;                  // time spent making tiles on the page
    this.page = 0;                // how many of them
    this._has();
  }

  // Which tiles the materials read: those the tier wants that are in hand (the order of
  // SURFACE_NAMES: the asphalt's, the verge's, the concrete's, the steel's).
  _has() {
    const want = surfacesOf(this.tier);
    this.uniforms.uSurfHas.value.set(...SURFACE_NAMES.map((n) => (want.includes(n) && this.held.has(n) ? 1 : 0)));
  }

  // The tiles the tier wants that are not in hand and not on their way.
  missing() {
    return surfacesOf(this.tier).filter((n) => !this.held.has(n) && !this.asked.has(n));
  }

  // Tiles still to come: asked of a worker or not yet asked (0 when all that the tier wants are in).
  pending() {
    return surfacesOf(this.tier).filter((n) => !this.held.has(n)).length;
  }

  setTier(tier) {
    this.tier = tier;
    this._has();
  }

  // Ask the pool for what is missing, once. Returns how many tiles are still to come.
  request(bakers) {
    const names = this.missing();
    if (names.length && bakers && bakers.ready && !bakers.failed) {
      const id = bakers.post({ type: 'surface', names }, [], (r) => {
        for (const item of r.surfaces) this.adopt(item);
      });
      if (id) for (const n of names) this.asked.add(n);
    }
    return this.pending();
  }

  // Make a tile here, on the page, from the one that is wanted first.
  make(count = Infinity) {
    const t0 = performance.now();
    let n = 0;
    for (const name of surfacesOf(this.tier)) {
      if (n >= count) break;
      if (this.held.has(name) || this.asked.has(name)) continue;
      this.adopt(bakeSurface(name));
      n++;
    }
    this.ms += performance.now() - t0;
    this.page += n;
    return this.pending();
  }

  // A tile that has come (from a worker, or made here): its textures into the uniforms.
  adopt(item) {
    if (this.held.has(item.name)) return;
    const list = [];
    for (const [key, uniform, channels] of SLOTS[item.name]) {
      const bytes = item[key];
      if (!bytes) continue;
      const tex = texture(bytes, item.size, channels);
      this.uniforms[uniform].value = tex;
      list.push(tex);
    }
    this.held.set(item.name, list);
    this._has();
  }

  // The bytes of the textures held, mips and all.
  get bytes() {
    let n = 0;
    for (const name of this.held.keys()) {
      const { size, two } = SURFACES[name];
      n += mipSizes(size).reduce((a, s) => a + s * s, 0) * (two ? 6 : 4);
    }
    return n;
  }

  // For the game's snapshot: which tiles are in hand, their bytes and their textures.
  summary() {
    return { held: [...this.held.keys()], bytes: this.bytes, textures: this.count };
  }

  // How many textures are in hand (the flat ones are not counted).
  get count() {
    let n = 0;
    for (const list of this.held.values()) n += list.length;
    return n;
  }

  dispose() {
    for (const list of this.held.values()) for (const t of list) t.dispose();
    this.held.clear();
    this.asked.clear();
    this._has();
    for (const t of this.flats) t.dispose();
    for (const slots of Object.values(SLOTS)) for (const [, uniform] of slots) this.uniforms[uniform].value = null;
  }
}
