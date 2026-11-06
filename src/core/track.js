// Infinite track centreline. Curvature is a sum of sines integrated twice, so
// any arc length can be sampled directly without keeping control points around.

export const STEP = 2;
const WINDOW_BACK = 400;
const WINDOW_AHEAD = 1600;
const REBASE_LIMIT = 20000;

// Long-wavelength ground elevation, deliberately a function of world position so
// the asphalt and the land agree by construction: the terrain shader evaluates
// the same expression (see roadElev in sky.js) and can never drift from the road.
// Periods are hundreds of metres, so the road rolls rather than corrugating.
export function baseElevation(x, z) {
  return 16 * Math.sin(x * 0.0035 + 0.7) * Math.cos(z * 0.0031 - 1.1)
    + 7 * Math.sin(x * 0.0105 - 2.3) * Math.cos(z * 0.0091 + 0.4);
}

// Launch ramps. Kept out of baseElevation because the terrain must not follow
// them: a ramp is asphalt rising off the land, which is what makes it read as a
// jump instead of a hill.
const JUMP_SPACING = 640;

function hash01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function jumpLift(s) {
  let lift = 0;
  const i0 = Math.floor((s - 120) / JUMP_SPACING);
  for (let i = i0; i <= i0 + 1; i++) {
    const h = hash01(i * 1.7);
    if (h > 0.62) continue;
    const centre = i * JUMP_SPACING + h * JUMP_SPACING;
    const w = 17 + h * 11;
    const amp = 2.4 + h * 2.6;
    const t = (s - centre) / w;
    if (Math.abs(t) < 3.2) lift += amp * Math.exp(-t * t);
  }
  return lift;
}

// Octaves of (wavelength metres, curvature amplitude 1/m, phase). Total
// amplitude stays below 1/45 m so the tightest radius the car must handle is
// about 45 m.
const BASE_OCTAVES = [
  [520, 0.0062, 0.0],
  [271, 0.0041, 1.7],
  [139, 0.0028, 3.4],
  [71, 0.0016, 5.1],
  [37, 0.0009, 2.2],
];

export class Track {
  constructor() {
    // Live curvature parameters, lerped when the biome changes.
    this.octaves = BASE_OCTAVES.map((o) => o.slice());
    this.targetOctaves = this.octaves.map((o) => o.slice());

    this.samples = new Map();
    this.start = 0;
    this.end = 0;
    this.origin = { x: 0, z: 0 };
    this.rebases = 0;

    // Prime the window around s = 0.
    this.samples.set(0, {
      x: 0, z: 0, theta: 0, kappa: this.curvature(0),
      y: this._elevAt(0, 0, 0),
    });
    this.end = 0;
    this.start = 0;
    this.ensureRange(-WINDOW_BACK, WINDOW_AHEAD);
  }

  curvature(s) {
    let k = 0;
    for (let i = 0; i < this.octaves.length; i++) {
      const [len, amp, phase] = this.octaves[i];
      k += amp * Math.sin((2 * Math.PI * s) / len + phase);
    }
    return k;
  }

  setShape(octaves) {
    this.targetOctaves = octaves.map((o) => o.slice());
  }

  blendShape(t) {
    for (let i = 0; i < this.octaves.length; i++) {
      const a = this.octaves[i];
      const b = this.targetOctaves[i] || a;
      a[0] = a[0] + (b[0] - a[0]) * t;
      a[1] = a[1] + (b[1] - a[1]) * t;
    }
  }

  // Integrate forward/backward from the nearest cached sample so a sample is
  // never recomputed twice.
  ensureRange(sMin, sMax) {
    const iMin = Math.floor(sMin / STEP);
    const iMax = Math.ceil(sMax / STEP);

    if (!this.samples.has(iMin * STEP)) {
      let anchor = null;
      for (const k of this.samples.keys()) {
        if (k >= iMin * STEP) {
          if (anchor === null || k < anchor) anchor = k;
        }
      }
      if (anchor === null) anchor = Math.max(...this.samples.keys());
      this._walkBackward(anchor, iMin * STEP);
    }
    let live = [...this.samples.keys()].sort((a, b) => a - b);
    this._walkForward(live[live.length - 1], iMax * STEP);
  }

  _walkForward(fromS, toS) {
    let s = fromS;
    let cur = this.samples.get(s);
    while (s < toS - 1e-9) {
      const kappa = this.curvature(s);
      const thetaMid = cur.theta + kappa * (STEP * 0.5);
      const x = cur.x + Math.cos(thetaMid) * STEP;
      const z = cur.z + Math.sin(thetaMid) * STEP;
      s += STEP;
      const next = {
        x, z,
        theta: cur.theta + kappa * STEP,
        kappa,
        y: this._elevAt(s, x, z),
      };
      this.samples.set(s, next);
      cur = next;
    }
    this.end = Math.max(this.end, toS);
  }

  // World-space elevation of the driving surface at arc length s. The base term
  // is a function of world position (so it matches the terrain by construction)
  // and the ramp term lifts the asphalt off the land.
  // The road surface is the terrain surface plus a kerb. Terrain is relief * 0.55
  // on top of the same base field, so the road has to carry that term too or the
  // ground pokes through the asphalt.
  _elevAt(s, sampleX, sampleZ) {
    const wx = sampleX + this.origin.x;
    const wz = sampleZ + this.origin.z;
    // Identical to the terrain field, including its downward bias, so the asphalt
    // and the ground can never disagree. The road sits proud of it by ROAD_TOP.
    return baseElevation(wx, wz) + this.surfaceRelief(wx, wz) - 1.2 + jumpLift(s);
  }

  // Set by the game from the active biome; the same shape the terrain shader uses.
  surfaceRelief(wx, wz) {
    if (!this.reliefFn) return 0;
    return this.reliefFn(wx, wz);
  }

  // Height of the land at an arbitrary world point. The road itself follows its
  // own arc length, but geometry that is offset sideways (junction branches)
  // needs the field evaluated where it actually sits.
  surfaceElevationAt(worldX, worldZ) {
    // Must match _elevAt exactly. Returning the bare base field put junction
    // branches tens of metres above or below the road they join.
    return baseElevation(worldX, worldZ) + this.surfaceRelief(worldX, worldZ) - 1.2;
  }

  // Recompute every cached sample's height. Called when the relief shape changes,
  // since the samples cache their y.
  refreshElevation() {
    for (const [s, v] of this.samples) {
      v.y = this._elevAt(s, v.x, v.z);
    }
  }

  elevationAt(s) {
    const p = this.at(s);
    return p ? p.y : 0;
  }

  // Grade along the direction of travel, sampled over a short span so a crest
  // reads as a slope change rather than a step.
  gradeAt(s, span = 6) {
    const a = this.at(s - span);
    const b = this.at(s + span);
    if (!a || !b) return 0;
    return (b.y - a.y) / (2 * span);
  }

  _walkBackward(fromS, toS) {
    let s = fromS;
    let cur = this.samples.get(s);
    if (!cur) return;
    while (s > toS + 1e-9) {
      const kappa = this.curvature(s - STEP * 0.5);
      const px = cur.x - Math.cos(cur.theta - kappa * STEP * 0.5) * STEP;
      const pz = cur.z - Math.sin(cur.theta - kappa * STEP * 0.5) * STEP;
      s -= STEP;
      const prev = {
        x: px, z: pz,
        theta: cur.theta - kappa * STEP,
        kappa,
        y: this._elevAt(s, px, pz),
      };
      this.samples.set(s, prev);
      cur = prev;
    }
    this.start = Math.min(this.start, toS);
  }

  // Called every frame with the car's arc length: keeps the sample window
  // centred on the car and releases everything outside it.
  update(sCar) {
    const sMin = Math.floor((sCar - WINDOW_BACK) / STEP) * STEP;
    const sMax = Math.ceil((sCar + WINDOW_AHEAD) / STEP) * STEP;
    this.ensureRange(sMin, sMax);

    for (const k of this.samples.keys()) {
      if (k < sMin - STEP * 2 || k > sMax + STEP * 2) this.samples.delete(k);
    }
    this.start = sMin;
    this.end = sMax;

    this.blendShape(0.02);
    this._maybeRebase(sCar);
  }

  _maybeRebase(sCar) {
    const p = this.at(sCar);
    if (Math.hypot(p.x - this.origin.x, p.z - this.origin.z) < REBASE_LIMIT) return;

    // Shift the whole window so the car sits near the origin again; this keeps
    // float32 vertex data free of precision jitter on long runs.
    const dx = p.x;
    const dz = p.z;
    for (const v of this.samples.values()) {
      v.x -= dx;
      v.z -= dz;
    }
    this.origin.x += dx;
    this.origin.z += dz;
    this.rebases++;
    return { dx, dz };
  }

  // Interpolated frame at an arbitrary arc length.
  at(s) {
    const lo = Math.floor(s / STEP) * STEP;
    const hi = lo + STEP;
    const a = this.samples.get(lo);
    const b = this.samples.get(hi);
    if (!a) return null;
    if (!b) return { x: a.x, z: a.z, y: a.y, theta: a.theta, kappa: a.kappa };
    const t = (s - lo) / STEP;
    // Angles are unwrapped here because the walk keeps theta continuous.
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      y: a.y + (b.y - a.y) * t,
      theta: a.theta + (b.theta - a.theta) * t,
      kappa: a.kappa + (b.kappa - a.kappa) * t,
    };
  }

  // Closest sample index to a world point, searched over the live window.
  nearestS(x, z, sHint) {
    let best = sHint;
    let bestD = Infinity;
    const from = Math.max(this.start, sHint - 120);
    const to = Math.min(this.end, sHint + 120);
    for (let s = from; s <= to; s += STEP) {
      const p = this.samples.get(s);
      if (!p) continue;
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return { s: best, dist: Math.sqrt(bestD) };
  }

  maxCurvatureAhead(sFrom, span) {
    let m = 0;
    for (let s = sFrom; s <= sFrom + span; s += STEP * 2) {
      const p = this.samples.get(Math.floor(s / STEP) * STEP);
      if (p) m = Math.max(m, Math.abs(p.kappa));
    }
    return m;
  }
}
