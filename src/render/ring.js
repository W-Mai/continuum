// The numbers the weather ring is made of, apart from the code that reads
// the worlds, so the sky and the haze (render/atmosphere.js) can have them
// without a cycle (render/weather.js reads the worlds' looks, which read the
// atmosphere's).

export const RING_N = 24;
// How far off the weather is read: about as far as the blend of a border is
// long, so the front is seen as it comes and not a minute before.
export const RING_FAR = 1800;

// Shared by the sky and by every material's haze: the far horizon's colour and
// the sky's cloud cover (H), the far zenith and the stars (Z) and the glow (G)
// in each of the directions, and whether the ring is in use.
export const ringU = {
  uRingH: { value: new Float32Array(RING_N * 4) },
  uRingZ: { value: new Float32Array(RING_N * 4) },
  uRingG: { value: new Float32Array(RING_N * 4) },
  uRingOn: { value: 0 },
};
