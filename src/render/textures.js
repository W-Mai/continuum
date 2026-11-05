import * as THREE from 'three';

// Procedural asphalt and paint textures, drawn once into canvases and tiled with
// repeat wrapping. No external assets, and the grain survives close-ups where a
// flat colour turns into a plastic slab.
//
// Wheel tracks are baked into the tile rather than modelled as geometry: they
// have to follow the ribbon's own UVs, which run along arc length.

const TILE = 512;

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

function smoothNoise(rand, size, cell) {
  const g = new Float32Array((cell + 1) * (cell + 1));
  for (let i = 0; i < g.length; i++) g[i] = rand();
  const out = new Float32Array(size * size);
  const scale = cell / size;
  for (let y = 0; y < size; y++) {
    const fy = y * scale;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const wy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < size; x++) {
      const fx = x * scale;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const wx = tx * tx * (3 - 2 * tx);
      const a00 = g[y0 * (cell + 1) + x0];
      const a10 = g[y0 * (cell + 1) + x0 + 1];
      const a01 = g[(y0 + 1) * (cell + 1) + x0];
      const a11 = g[(y0 + 1) * (cell + 1) + x0 + 1];
      const top = a00 + (a10 - a00) * wx;
      const bot = a01 + (a11 - a01) * wx;
      out[y * size + x] = top + (bot - top) * wy;
    }
  }
  return out;
}

export function makeAsphaltCanvas(base = [42, 47, 53]) {
  const c = document.createElement('canvas');
  c.width = c.height = TILE;
  const ctx = c.getContext('2d');
  const rand = mulberry32(0x51ab1e);

  const img = ctx.createImageData(TILE, TILE);
  const coarse = smoothNoise(rand, TILE, 8);
  const mid = smoothNoise(rand, TILE, 32);
  const fine = smoothNoise(rand, TILE, 128);

  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = y * TILE + x;
      const grain = (rand() - 0.5) * 34;
      const patch = (coarse[i] - 0.5) * 26;
      const midv = (mid[i] - 0.5) * 16;
      const micro = (fine[i] - 0.5) * 10;

      // Two worn bands where traffic runs. The ribbon's U spans the full width,
      // so 0.30 / 0.70 land under the wheels.
      const u = x / TILE;
      const trackL = Math.exp(-((u - 0.30) ** 2) / 0.0016);
      const trackR = Math.exp(-((u - 0.70) ** 2) / 0.0016);
      const wear = (trackL + trackR) * 14;

      const v = grain + patch + midv + micro - wear;
      const o = i * 4;
      img.data[o] = Math.max(0, Math.min(255, base[0] + v));
      img.data[o + 1] = Math.max(0, Math.min(255, base[1] + v));
      img.data[o + 2] = Math.max(0, Math.min(255, base[2] + v * 0.94));
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Cracks and seams, drawn at wrapped offsets so the tile stays seamless.
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 26; i++) {
    const x0 = rand() * TILE;
    const y0 = rand() * TILE;
    const len = 14 + rand() * 80;
    const ang = rand() * Math.PI * 2;
    ctx.strokeStyle = rand() > 0.5 ? '#1b1e22' : '#2f343a';
    ctx.lineWidth = 0.6 + rand() * 1.3;
    for (const [dx, dy] of [[0, 0], [0, -TILE], [0, TILE], [-TILE, 0], [TILE, 0]]) {
      ctx.beginPath();
      ctx.moveTo(x0 + dx, y0 + dy);
      ctx.lineTo(x0 + Math.cos(ang) * len + dx, y0 + Math.sin(ang) * len + dy);
      ctx.stroke();
    }
  }

  // Tar patches, glossier than the surrounding aggregate.
  ctx.globalAlpha = 0.28;
  for (let i = 0; i < 9; i++) {
    const x = rand() * TILE;
    const y = rand() * TILE;
    const r = 8 + rand() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, '#12151a');
    g.addColorStop(1, 'rgba(18,21,26,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return c;
}

/** Worn tracks are polished by traffic, so they are smoother than the rest. */
export function makeAsphaltRoughness() {
  const c = document.createElement('canvas');
  c.width = c.height = TILE;
  const ctx = c.getContext('2d');
  const rand = mulberry32(0x9e17c4);
  const img = ctx.createImageData(TILE, TILE);
  const coarse = smoothNoise(rand, TILE, 16);

  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = y * TILE + x;
      const u = x / TILE;
      const track = Math.exp(-((u - 0.30) ** 2) / 0.002) +
        Math.exp(-((u - 0.70) ** 2) / 0.002);
      const v = 210 + (coarse[i] - 0.5) * 30 - track * 70;
      const o = i * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.max(0, Math.min(255, v));
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Painted line: worn and chipped rather than a clean rail. */
export function makeLineCanvas(rgb = [235, 232, 220]) {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 128;
  const ctx = c.getContext('2d');
  const rand = mulberry32(0x77aa33);
  ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  ctx.fillRect(0, 0, 32, 128);
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = rand() > 0.5 ? '#8d8a82' : '#ffffff';
    ctx.fillRect(rand() * 32, rand() * 128, 1 + rand() * 3, 1 + rand() * 6);
  }
  ctx.globalAlpha = 1;
  return c;
}

function toTexture(renderer, canvas, srgb = true) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (renderer) tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

export function asphaltTexture(renderer, base) {
  return toTexture(renderer, makeAsphaltCanvas(base), true);
}

export function roughnessTexture(renderer) {
  return toTexture(renderer, makeAsphaltRoughness(), false);
}

/** Dash tile: opaque for the first part of V, transparent for the rest. */
export function makeDashedCanvas(rgb = [236, 233, 221]) {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 128;
  const ctx = c.getContext('2d');
  const rand = mulberry32(0x5c1e77);
  ctx.clearRect(0, 0, 32, 128);
  ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  ctx.fillRect(0, 0, 32, 72);
  ctx.globalAlpha = 0.3;
  for (let i = 0; i < 22; i++) {
    ctx.fillStyle = rand() > 0.5 ? '#8d8a82' : '#ffffff';
    ctx.fillRect(rand() * 32, rand() * 72, 1 + rand() * 3, 1 + rand() * 5);
  }
  ctx.globalAlpha = 1;
  return c;
}

export function dashedTexture(renderer, rgb) {
  return toTexture(renderer, makeDashedCanvas(rgb), true);
}

export function lineTexture(renderer, rgb) {
  return toTexture(renderer, makeLineCanvas(rgb), true);
}
