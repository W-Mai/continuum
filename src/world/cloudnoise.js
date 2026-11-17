// The noise the baked clouds' surface is pushed out by (render/clouds.js):
// round bumps, a dome to a cell, laid in a cube that repeats, 64 texels to a
// side and four cells across. Read at three sizes, it gives a heap its big
// swellings, its lumps and its cauliflower grain.
//
// Pure arithmetic, no three: the same bytes come out wherever it runs.

export const CLOUD_NOISE_N = 64;
const CELLS = 4;

function hash(x, y, z, k) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(k + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// The point of a cell, 0.15 to 0.85 across it.
function feature(cx, cy, cz, out) {
  const wrap = (v) => ((v % CELLS) + CELLS) % CELLS;
  const x = wrap(cx);
  const y = wrap(cy);
  const z = wrap(cz);
  out[0] = cx + 0.15 + 0.7 * hash(x, y, z, 0);
  out[1] = cy + 0.15 + 0.7 * hash(x, y, z, 1);
  out[2] = cz + 0.15 + 0.7 * hash(x, y, z, 2);
}

// Fill the slices z0 to z1 (exclusive) of an n by n by n field of bytes: 255
// at the middle of a dome, 0 where one ends.
export function fillCloudNoise(data, n, z0, z1) {
  const f = [0, 0, 0];
  const cell = n / CELLS;
  for (let z = z0; z < z1; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const px = (x + 0.5) / cell;
        const py = (y + 0.5) / cell;
        const pz = (z + 0.5) / cell;
        const bx = Math.floor(px);
        const by = Math.floor(py);
        const bz = Math.floor(pz);
        let best = 4;
        for (let k = -1; k <= 1; k++) {
          for (let j = -1; j <= 1; j++) {
            for (let i = -1; i <= 1; i++) {
              feature(bx + i, by + j, bz + k, f);
              const dx = f[0] - px;
              const dy = f[1] - py;
              const dz = f[2] - pz;
              const d = dx * dx + dy * dy + dz * dz;
              if (d < best) best = d;
            }
          }
        }
        // A dome of radius 0.8 of a cell, flat where it is out of reach.
        const u = Math.min(1, best / 0.64);
        data[(z * n + y) * n + x] = Math.round(255 * Math.sqrt(1 - u));
      }
    }
  }
}

export function makeCloudNoise(n = CLOUD_NOISE_N) {
  const data = new Uint8Array(n * n * n);
  fillCloudNoise(data, n, 0, n);
  return data;
}
