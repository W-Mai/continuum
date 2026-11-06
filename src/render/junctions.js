// T-junctions and crossroads.
//
// These are decorations on the endless corridor, not a change to its topology.
// The player's road is a single open curve, so branching it would mean rewriting
// the track, the autopilot and the chunk stream. Instead a junction is a side
// road that leaves the main carriageway perpendicular, laid on the same
// elevation field so it meets the asphalt exactly.
//
// Junction sites are a pure function of arc length, so they are stable as chunks
// recycle: the same s always produces the same junction.

import * as THREE from 'three';

const SPACING = 420;
// A junction needs a straight-ish stretch or the branch mouth cannot meet the
// carriageway squarely. Rather than reject a site on a curve, the site slides
// along the road to the straightest point within the search radius.
const SEARCH = 70;
const MAX_CURVATURE = 0.005;

function hash01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// Slide a nominal site to the straightest point nearby. Deterministic, so the
// same seed always yields the same junction as chunks recycle.
function settleSite(track, nominal) {
  let best = null;
  let bestK = Infinity;
  for (let d = -SEARCH; d <= SEARCH; d += 7) {
    const p = track.at(nominal + d);
    if (!p) continue;
    const k = Math.abs(p.kappa);
    if (k < bestK) { bestK = k; best = nominal + d; }
  }
  if (best === null) return null;
  for (let d = -7; d <= 7; d += 1) {
    const p = track.at(best + d);
    if (!p) continue;
    const k = Math.abs(p.kappa);
    if (k < bestK) { bestK = k; best = best + d; }
  }
  if (bestK > MAX_CURVATURE) return null;
  return best;
}

// Enumerate junctions in [sFrom, sTo]. Deterministic: the same window always
// yields the same list.
export function junctionsIn(sFrom, sTo, track) {
  const out = [];
  const i0 = Math.floor(sFrom / SPACING) - 1;
  const i1 = Math.ceil(sTo / SPACING) + 1;
  for (let i = i0; i <= i1; i++) {
    const h = hash01(i * 2.3);
    const nominal = i * SPACING + h * SPACING * 0.45;
    const s = track ? settleSite(track, nominal) : nominal;
    if (s === null || s < sFrom || s > sTo) continue;
    const fourWay = h > 0.66;
    out.push({ s, fourWay, side: h > 0.5 ? 1 : -1, seed: i });
  }
  return out;
}

// A single junction's geometry: the side road, its mouth fillets, and a give-way
// line across the branch.
function buildJunction(track, j, roadHalfWidth) {
  const p = track.at(j.s);
  if (!p) return null;

  const branchLen = 34;
  const branchHalf = 4.2;
  const sides = j.fourWay ? [1, -1] : [j.side];

  const positions = [];
  const normals = [];
  const indices = [];
  let vo = 0;

  const push = (x, y, z) => {
    positions.push(x, y, z);
    normals.push(0, 1, 0);
    return vo++;
  };

  for (const side of sides) {
    const nx = -Math.sin(p.theta) * side;
    const nz = Math.cos(p.theta) * side;
    const fx = Math.cos(p.theta);
    const fz = Math.sin(p.theta);

    // The mouth starts a little inside the carriageway so the two surfaces
    // overlap instead of meeting edge-to-edge, which would show a hairline gap
    // once the main road's own crown and verge are accounted for.
    const mouthInset = roadHalfWidth - 1.4;
    const baseX = p.x + nx * mouthInset;
    const baseZ = p.z + nz * mouthInset;

    // The junction sits on the road's own surface height at this station, which
    // includes the ramp lift. Terrain elevation alone would drop the mouth below
    // the asphalt wherever a ramp is present.
    const mouthY = p.y + 0.05;

    // Sampled along the branch so the side road follows the land instead of
    // floating. Near the mouth it is held flat at the road's height so the join
    // is seamless; further out it blends onto the terrain field.
    const ROWS = 18;
    const COLS = 7;
    const startRow = positions.length / 3;
    for (let r = 0; r <= ROWS; r++) {
      const t = r / ROWS;
      const dist = t * branchLen;
      for (let c = 0; c < COLS; c++) {
        const u = c / (COLS - 1);
        // Widen toward the outer end so it reads as a road mouth, not a nozzle.
        const across = (u * 2 - 1) * branchHalf * (0.9 + 0.28 * t);
        const x = baseX + fx * across + nx * dist;
        const z = baseZ + fz * across + nz * dist;
        const terrainY = track.surfaceElevationAt(x, z);
        const blend = Math.min(1, Math.max(0, (t - 0.10) / 0.55));
        const y = mouthY * (1 - blend) + (terrainY + 0.05) * blend;
        push(x, y, z);
      }
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS - 1; c++) {
        const a = startRow + r * COLS + c;
        indices.push(a, a + 1, a + COLS, a + 1, a + COLS + 1, a + COLS);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
  geo.setIndex(indices);

  // Edge stripes down both sides of the branch, inset the same way the main
  // road's are, so the two surfaces share a language.
  const lpos = [];
  const lidx = [];
  let lvo = 0;
  for (const side of sides) {
    const nx = -Math.sin(p.theta) * side;
    const nz = Math.cos(p.theta) * side;
    const fx = Math.cos(p.theta);
    const fz = Math.sin(p.theta);
    const mouthInset = roadHalfWidth - 1.4;
    const baseX = p.x + nx * mouthInset;
    const baseZ = p.z + nz * mouthInset;
    const mouthY = p.y + 0.05;
    const LW = 0.14;

    for (const edge of [-1, 1]) {
      const start = lvo;
      const ROWS = 18;
      for (let r = 0; r <= ROWS; r++) {
        const t = r / ROWS;
        const dist = t * branchLen;
        const halfAt = branchHalf * (0.9 + 0.28 * t);
        for (let c = 0; c < 2; c++) {
          const across = edge * (halfAt - 0.30 - c * LW);
          const x = baseX + fx * across + nx * dist;
          const z = baseZ + fz * across + nz * dist;
          const terrainY = track.surfaceElevationAt(x, z);
          const blend = Math.min(1, Math.max(0, (t - 0.10) / 0.55));
          const y = mouthY * (1 - blend) + (terrainY + 0.05) * blend;
          lpos.push(x, y + 0.008, z);
          lvo++;
        }
      }
      for (let r = 0; r < ROWS; r++) {
        const a = start + r * 2;
        lidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }

  let lineGeo = null;
  if (lpos.length) {
    lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lpos), 3));
    lineGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(lpos.length), 3));
    lineGeo.setIndex(lidx);
  }

  return { geo, lineGeo, s: j.s, fourWay: j.fourWay };
}

export class JunctionField {
  constructor(parent, track) {
    this.track = track;
    this.parent = parent;
    this.group = new THREE.Group();
    parent.add(this.group);

    // Assigned by setMaterial() from the road, so a branch is literally the same
    // surface as the carriageway rather than an approximation of it.
    this.matAsphalt = null;

    this.built = new Map();
    this.pool = [];
  }

  update(sCar, halfWidth, window = 900) {
    const wanted = junctionsIn(sCar - 120, sCar + window, this.track);
    const wantKeys = new Set(wanted.map((j) => j.seed));

    for (const [key, entry] of this.built) {
      if (!wantKeys.has(key)) {
        // Pooled, not disposed: the next build overwrites the geometry.
        entry.mesh.visible = false;
        entry.lines.visible = false;
        this.pool.push(entry);
        this.built.delete(key);
      }
    }

    for (const j of wanted) {
      if (this.built.has(j.seed)) continue;
      const built = buildJunction(this.track, j, halfWidth);
      if (!built) continue;

      let entry = this.pool.pop();
      if (entry) {
        entry.mesh.geometry.dispose();
        entry.mesh.geometry = built.geo;
        entry.mesh.visible = true;
        entry.lines.visible = !!built.lineGeo;
        if (built.lineGeo) {
          entry.lines.geometry.dispose();
          entry.lines.geometry = built.lineGeo;
        }
      } else {
        const mesh = new THREE.Mesh(built.geo, this.matAsphalt);
        mesh.receiveShadow = true;
        this.group.add(mesh);
        const lines = new THREE.Mesh(
          built.lineGeo || new THREE.BufferGeometry(),
          this.matLine || new THREE.MeshBasicMaterial({ color: 0xffffff }),
        );
        lines.visible = !!built.lineGeo;
        this.group.add(lines);
        entry = { mesh, lines };
      }
      this.built.set(j.seed, entry);
    }
  }

  // Both surfaces come from the road: the branch gets the carriageway's asphalt
  // material and the same paint material its edge lines use.
  setMaterial(mat, lineMat) {
    this.matAsphalt = mat;
    if (lineMat) this.matLine = lineMat;
    for (const entry of this.built.values()) {
      entry.mesh.material = mat;
      if (this.matLine) entry.lines.material = this.matLine;
    }
    for (const entry of this.pool) {
      entry.mesh.material = mat;
      if (this.matLine) entry.lines.material = this.matLine;
    }
  }

  get liveCount() {
    return this.built.size;
  }
}
