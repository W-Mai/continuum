// The weather round the lens: what the air is in each direction a few
// kilometres off.
//
// The sky, the haze and the light were one number each, the world the camera
// was in, mixed across a border by how far across it was. The land is not: it
// is drawn per pixel, so a world ahead was already there to see, in the colours
// of its own ground, under the sky and in the haze of the one behind. A
// desert showed up green-grey in a hills' haze, a city came up the road in
// full daylight and turned to dusk only as the car drove in.
//
// Now the camera has a ring of directions, and in each the look of the
// world FAR metres off, mixed across the borders as the map says. The sky takes
// it low down, toward the horizon, where a sky is far off, and its own look
// overhead; the haze takes it for what is far from the lens. So a front is
// seen coming: the horizon ahead warms or darkens a few kilometres before the
// border, while overhead and behind it is still the weather the car is in,
// and the ground and the air agree. Colours are mixed in linear light, as the
// looks are everywhere else.

import { worldLook, mixLooks } from './worldlook.js';
import { RING_N, RING_FAR, ringU } from './ring.js';

export { RING_N, RING_FAR, ringU };

export class WeatherRing {
  // worlds: the map of the worlds (world/worlds.js), whose at() gives the two
  // worlds at a point and how far across a border it is.
  constructor(worlds) {
    this.worlds = worlds;
    this._w = { a: 0, b: 0, t: 0, u: 0 };
    this._look = {};
    this._baked = new Float32Array(RING_N * 4);
    this.ready = false;
  }

  // Read the ring for a camera at an absolute point.
  update(ax, az) {
    const H = ringU.uRingH.value;
    const Z = ringU.uRingZ.value;
    const G = ringU.uRingG.value;
    for (let i = 0; i < RING_N; i++) {
      // The sky's direction number runs round from -pi at 0 to pi at 1.
      const ang = ((i + 0.5) / RING_N - 0.5) * Math.PI * 2;
      const w = this.worlds.at(ax + Math.cos(ang) * RING_FAR, az + Math.sin(ang) * RING_FAR, this._w);
      const l = mixLooks(this._look, worldLook(w.a), worldLook(w.b), w.t);
      H[i * 4] = l.horizon.r;
      H[i * 4 + 1] = l.horizon.g;
      H[i * 4 + 2] = l.horizon.b;
      H[i * 4 + 3] = l.clouds;
      Z[i * 4] = l.zenith.r;
      Z[i * 4 + 1] = l.zenith.g;
      Z[i * 4 + 2] = l.zenith.b;
      Z[i * 4 + 3] = l.stars || 0;
      G[i * 4] = l.glow.r;
      G[i * 4 + 1] = l.glow.g;
      G[i * 4 + 2] = l.glow.b;
      G[i * 4 + 3] = 0;
    }
    ringU.uRingOn.value = 1;
    this.ready = true;
  }

  // How far the horizon now is from the one the light was last baked in (the
  // environment map is drawn from the sky): the most any direction's colour
  // has moved, in linear light.
  drift() {
    const H = ringU.uRingH.value;
    let most = 0;
    for (let i = 0; i < RING_N; i++) {
      const d = Math.abs(H[i * 4] - this._baked[i * 4]) + Math.abs(H[i * 4 + 1] - this._baked[i * 4 + 1])
        + Math.abs(H[i * 4 + 2] - this._baked[i * 4 + 2]);
      if (d > most) most = d;
    }
    return most;
  }

  // The light has been baked in this ring.
  bake() {
    this._baked.set(ringU.uRingH.value);
  }
}
