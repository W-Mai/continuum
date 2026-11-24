// The high cloud of the real style's sky on the GPU: the tile of world/cirrus.js as a
// texture with its mips, read by the sky (render/atmosphere.js).
//
// The tile is drawn by a worker (render/bakers.js) where there is one, on the page where
// there is none (a headless run, a worker that did not come up). Until it is there the sky
// reads a texel of no cloud, so the sky is drawn from the first frame and the cirrus comes
// in the moment its tile does. A tier that draws none (the low one) makes none.

import * as THREE from 'three';
import { CIRRUS, CIRRUS_BYTES, bakeCirrus } from '../world/cirrus.js';

// The anisotropic filtering of the tile: the sky is seen at a grazing angle.
const ANISOTROPY = 4;

export class Cirrus {
  constructor() {
    this.empty = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
    this.empty.unpackAlignment = 1;
    this.empty.needsUpdate = true;
    // The uniform the sky reads the tile by.
    this.uniforms = { uCirrusTex: { value: this.empty } };
    this.texture = null;      // the tile's, once it is in hand
    this.asked = false;       // a worker has been asked for it
    this.ms = 0;              // time spent making it on the page
    this.page = 0;            // how many times it was made there (0 or 1)
  }

  // The tile is in hand.
  get held() {
    return this.texture !== null;
  }

  // Ask the pool for the tile, once. Returns whether it is in hand.
  request(bakers) {
    if (this.held) return true;
    if (!this.asked && bakers && bakers.ready && !bakers.failed) {
      const id = bakers.post({ type: 'cirrus' }, [], (r) => this.adopt(r.cirrus));
      if (id) this.asked = true;
    }
    return this.held;
  }

  // Make the tile here, on the page.
  make() {
    if (this.held || this.asked) return this.held;
    const t0 = performance.now();
    this.adopt(bakeCirrus());
    this.ms += performance.now() - t0;
    this.page++;
    return true;
  }

  // The tile's bytes (from a worker, or made here) as the sky's texture.
  adopt(bytes) {
    if (this.held || bytes.length !== CIRRUS_BYTES) return;
    const tex = new THREE.DataTexture(bytes, CIRRUS.width, CIRRUS.height, THREE.RedFormat, THREE.UnsignedByteType);
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = ANISOTROPY;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    this.texture = tex;
    this.uniforms.uCirrusTex.value = tex;
  }

  // The bytes the texture holds on the GPU, mips and all.
  get bytes() {
    return this.held ? Math.round(CIRRUS_BYTES * 4 / 3) : 0;
  }

  dispose() {
    if (this.texture) this.texture.dispose();
    this.texture = null;
    this.asked = false;
    this.uniforms.uCirrusTex.value = this.empty;
    this.empty.dispose();
  }
}
