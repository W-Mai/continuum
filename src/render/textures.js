import * as THREE from 'three';

// The road's one texture of its own: the marks of a brush, for the painted style.
// (The grain of the road's surfaces in the other styles is world/surface.js, made
// into textures in render/surfaces.js.)

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The marks of a brush on a road, one channel: strokes that lie along the
 * road (texture v), broad soft patches, narrower strokes and small dabs, each
 * lighter or darker than the ground by a part of the way to white or black.
 * Drawn at wrapped offsets, so it tiles, and stretched so that the 2nd to the
 * 98th percentile of it fills 0 to 1 (0.5 where nothing was laid), which lets
 * the shader say how many percent of tone a stroke is.
 */
export function makeRoadStrokeTexture(seed = 0x4e0ad5, N = 256) {
  const rand = mulberry32(seed);
  const v = new Float32Array(N * N).fill(0.5);
  const lay = (cx, cy, a, b, target, opacity) => {
    // a runs along v, b across it; a little off true, as a hand is.
    const ang = Math.PI / 2 + (rand() - 0.5) * 0.3;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const R = Math.ceil(Math.max(a, b)) + 1;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const u = (dx * ca + dy * sa) / a;
        const w = (-dx * sa + dy * ca) / b;
        const q = Math.sqrt(u * u + w * w);
        if (q >= 1) continue;
        const e = Math.min(1, (1 - q) * Math.min(a, b));
        const x = (((Math.floor(cx) + dx) % N) + N) % N;
        const y = (((Math.floor(cy) + dy) % N) + N) % N;
        const k = y * N + x;
        v[k] += (target - v[k]) * opacity * e;
      }
    }
  };
  const lays = (count, la, lb, opacity) => {
    for (let i = 0; i < count; i++) {
      lay(rand() * N, rand() * N, la[0] + rand() * (la[1] - la[0]), lb[0] + rand() * (lb[1] - lb[0]), rand() < 0.5 ? 0 : 1, opacity);
    }
  };
  lays(34, [50, 100], [14, 34], 0.5);
  lays(160, [18, 55], [4, 11], 0.65);
  lays(420, [3, 9], [1.5, 3.5], 0.8);
  const sorted = Float32Array.from(v).sort();
  const lo = sorted[Math.floor(N * N * 0.02)];
  const hi = sorted[Math.floor(N * N * 0.98)];
  const data = new Uint8Array(N * N);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.max(0, Math.min(255, Math.round((0.5 + (v[i] - (lo + hi) / 2) / (hi - lo)) * 255)));
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}
