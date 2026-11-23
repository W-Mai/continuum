// The ground's normal maps on the page (world/groundtex.js makes the bytes):
// the rock's and the fine ground's, at the size of the tier, and the numbers
// the land's material reads them by. Made once, in a baking worker when there
// is one (render/bakers.js; the page goes on drawing without them, they come in
// a moment after the start) and on the page where there is none, and made again
// at the size of another tier when the tier changes. The low tier has none.

import * as THREE from 'three';
import { makeGround, GROUND_SIZE } from '../world/groundtex.js';

// How far the land's beds are pushed (world/strata.js) at each tier: the
// baked arrays are the same whatever the tier, so the tier scales them.
const BEDS = { high: 1, mid: 1, low: 0 };

// A texture of the ground's normal maps from bytes (n texels to a side), with the whole chain of mips.
function texture(data, n) {
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// What the shader reads while a texture is not there: the slope nothing, open to the sky.
function flat() {
  const tex = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

export class GroundMaps {
  // tier: the one the page begins at.
  constructor(tier = 'high') {
    this.tier = GROUND_SIZE[tier] === undefined ? 'high' : tier;
    this.flat = flat();
    this.rock = null;             // the textures, once they are made
    this.fine = null;
    this.held = null;             // the tier they are made for
    this.pending = null;          // the tier asked of a worker and not back
    this.bytes = 0;               // what they hold, with their mips
    // x: the rock's normal map is laid on, y: the fine ground's, z: how far the
    // land's beds are pushed (0 to 1), w: -.
    this.numbers = new THREE.Vector4(0, 0, BEDS[this.tier], 0);
    this.uniforms = {
      uRockN: { value: this.flat },
      uFineN: { value: this.flat },
      uGroundK: { value: this.numbers },
    };
  }

  // The tier changes: the beds at once, the textures when they are made.
  setTier(tier) {
    if (GROUND_SIZE[tier] === undefined || tier === this.tier) return;
    this.tier = tier;
    this.numbers.z = BEDS[tier];
    if (!GROUND_SIZE[tier]) this._drop();
  }

  // Every frame: the textures of the tier, if they are not yet there. bakers:
  // the pool of workers (render/bakers.js), or null where the page makes them
  // itself; idle: the workers have nothing the page waits for, so that the
  // first frame's land comes before them.
  update(bakers, idle = true) {
    const tier = this.tier;
    if (!GROUND_SIZE[tier] || this.held === tier) return;
    if (!bakers || bakers.failed) {
      this._take(tier, makeGround(tier));
      return;
    }
    if (this.pending === tier || !idle || !bakers.ready) return;
    const id = bakers.post({ type: 'ground', tier }, [], (r) => {
      if (this.pending === r.tier) this.pending = null;
      if (this.tier === r.tier) this._take(r.tier, r.maps);
    });
    if (id) this.pending = tier;
  }

  _take(tier, maps) {
    this._drop();
    this.rock = texture(maps.rock, maps.size.rock);
    this.fine = texture(maps.fine, maps.size.fine);
    this.uniforms.uRockN.value = this.rock;
    this.uniforms.uFineN.value = this.fine;
    this.held = tier;
    this.bytes = Math.round(((maps.size.rock ** 2) + (maps.size.fine ** 2)) * 4 * (4 / 3));
    this.numbers.x = 1;
    this.numbers.y = 1;
  }

  // The textures go, and the shader has the flat one.
  _drop() {
    this.numbers.x = 0;
    this.numbers.y = 0;
    this.held = null;
    this.bytes = 0;
    if (this.rock) this.rock.dispose();
    if (this.fine) this.fine.dispose();
    this.rock = null;
    this.fine = null;
    this.uniforms.uRockN.value = this.flat;
    this.uniforms.uFineN.value = this.flat;
  }

  dispose() {
    this._drop();
    this.flat.dispose();
  }
}
