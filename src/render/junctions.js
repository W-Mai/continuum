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

const SPACING = 320;
// A junction needs a straight-ish stretch or the branch mouth cannot meet the
// carriageway squarely. Rather than reject a site on a curve, the site slides
// along the road to the straightest point within the search radius.
const SEARCH = 40;
const MAX_CURVATURE = 0.012;

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
    const fourWay = h > 0.45;
    out.push({ s, fourWay, side: h > 0.5 ? 1 : -1, seed: i });
  }
  return out;
}

// A single junction's geometry: the side road, its mouth fillets, and a give-way
// line across the branch.
function buildJunction(track, j, roadHalfWidth) {
  const p = track.at(j.s);
  if (!p) return null;

  const branchLen = 46;
  const branchHalf = 5.2;
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

  // Apron across the mouth: the quad where the two surfaces meet, in a lighter
  // tone. Without it a branch is the same black as the verge and the junction is
  // invisible, which is exactly what it was.
  const apos = [];
  const aidx = [];
  {
    const ROWS = 4;
    const COLS = 7;
    const span = roadHalfWidth + 1.0;
    const half = Math.min(roadHalfWidth * 0.62, 5.0);
    for (const side of sides) {
      const nx2 = -Math.sin(p.theta) * side;
      const nz2 = Math.cos(p.theta) * side;
      const fx2 = Math.cos(p.theta);
      const fz2 = Math.sin(p.theta);
      const start = apos.length / 3;
      for (let r = 0; r < ROWS; r++) {
        const t = r / (ROWS - 1);
        const out = t * span;
        for (let c = 0; c < COLS; c++) {
          const u = c / (COLS - 1);
          const across = (u * 2 - 1) * half;
          const x = p.x + nx2 * out + fx2 * across;
          const z = p.z + nz2 * out + fz2 * across;
          apos.push(x, (p.y || 0) + 0.062, z);
        }
      }
      for (let r = 0; r < ROWS - 1; r++) {
        for (let c = 0; c < COLS - 1; c++) {
          const a = start + r * COLS + c;
          aidx.push(a, a + 1, a + COLS, a + 1, a + COLS + 1, a + COLS);
        }
      }
    }
  }
  let apronGeo = null;
  if (apos.length) {
    apronGeo = new THREE.BufferGeometry();
    apronGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(apos), 3));
    const an = new Float32Array(apos.length);
    for (let i = 1; i < an.length; i += 3) an[i] = 1;
    apronGeo.setAttribute('normal', new THREE.BufferAttribute(an, 3));
    apronGeo.setIndex(aidx);
  }

  return { geo, lineGeo, apronGeo, s: j.s, fourWay: j.fourWay };
}

// One signal head per approach. The lamp state is a pure function of time and the
// junction's own seed, so every client agrees without any shared state.
function lightState(seed, time) {
  // Mostly green. A 50% red on a 14 s cycle means the car waits up to 7 s at a
  // signal, and with a junction every 210 m that turns a driving game into a
  // queueing game. Red is short and the car rarely meets one.
  const cycle = 20.0;
  const phase = ((time + seed * 3.7) % cycle) / cycle;
  if (phase < 0.80) return 'green';
  if (phase < 0.86) return 'amber';
  return 'red';
}

export class JunctionField {
  constructor(parent, track) {
    this.track = track;
    this.parent = parent;
    this.group = new THREE.Group();
    parent.add(this.group);

    // Assigned by setMaterial() from the road, so a branch is literally the same
    // surface as the carriageway rather than an approximation of it.
    // Branches get their own material, not the carriageway's: the road's is almost
    // black under a night sky and the junction disappeared into the verge.
    this.matAsphalt = new THREE.MeshStandardMaterial({
      color: 0x3a3a40, roughness: 0.88, metalness: 0.0, envMapIntensity: 0.5,
    });
    // The apron is the lit crossing surface: noticeably lighter than any asphalt
    // so the junction is legible at a glance, day or night.
    this.matApron = new THREE.MeshStandardMaterial({
      color: 0x6a6a72, roughness: 0.82, metalness: 0.0, envMapIntensity: 0.7,
    });

    this.built = new Map();
    this.pool = [];

    // Signal lamps: one instanced pair of discs per approach, plus the pole.
    this.signalMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.signalHeads = new Map();
    this.matPole = new THREE.MeshBasicMaterial({ color: 0x2a2a2e });
    this.signals = new THREE.Group();
    this.signals.name = 'signals';
    parent.add(this.signals);
  }

  update(sCar, halfWidth, window = 900, time = 0) {
    this.halfWidth = halfWidth;
    const wanted = junctionsIn(sCar - 120, sCar + window, this.track);
    const wantKeys = new Set(wanted.map((j) => j.seed));

    for (const [key, entry] of this.built) {
      if (!wantKeys.has(key)) {
        // Pooled, not disposed: the next build overwrites the geometry.
        entry.mesh.visible = false;
        entry.lines.visible = false;
        entry.apron.visible = false;
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
        entry.apron.visible = !!built.apronGeo;
        if (built.apronGeo) {
          entry.apron.geometry.dispose();
          entry.apron.geometry = built.apronGeo;
        }
        if (built.lineGeo) {
          entry.lines.geometry.dispose();
          entry.lines.geometry = built.lineGeo;
        }
      } else {
        const mesh = new THREE.Mesh(built.geo, this.matAsphalt);
        mesh.receiveShadow = true;
        this.group.add(mesh);
        const apron = new THREE.Mesh(
          built.apronGeo || new THREE.BufferGeometry(), this.matApron,
        );
        apron.receiveShadow = true;
        apron.visible = !!built.apronGeo;
        this.group.add(apron);
        const lines = new THREE.Mesh(
          built.lineGeo || new THREE.BufferGeometry(),
          this.matLine || new THREE.MeshBasicMaterial({ color: 0xffffff }),
        );
        lines.visible = !!built.lineGeo;
        this.group.add(lines);
        entry = { mesh, lines, apron };
      }
      entry.junction = j;
      this.built.set(j.seed, entry);
    }

    this._syncSignals(time);
  }

  // Both surfaces come from the road: the branch gets the carriageway's asphalt
  // material and the same paint material its edge lines use.
  // A signal head is a pole plus a lamp block. The three aspects are separate
  // meshes so their materials can be switched independently; merging them into one
  // would force a single colour on all three.
  _signalParts() {
    if (this._sigParts) return this._sigParts;

    const pole = new THREE.CylinderGeometry(0.11, 0.13, 5.6, 6);
    pole.translate(0, 2.8, 0);

    const head = new THREE.BoxGeometry(0.34, 1.15, 0.30);
    head.translate(0, 5.5, 0);

    const lamps = [5.86, 5.5, 5.14].map((y) => {
      const d = new THREE.CircleGeometry(0.115, 10);
      d.rotateY(Math.PI / 2);
      d.translate(0.18, y, 0);
      return d;
    });

    this._sigParts = { pole, head, lamps };
    return this._sigParts;
  }

  // Rebuild the signal heads for the junctions currently in view. Poles are pooled
  // with the junction they belong to, so a recycled junction reuses them.
  // Signals are built once per junction and then only recoloured. Rebuilding the
  // meshes every frame allocated hundreds of materials per second and the lamps
  // still never changed colour, because the fresh materials were never updated.
  _syncSignals(time) {
    const want = new Set();
    for (const [seed] of this.built) want.add(seed);

    // Drop heads for junctions that left the window.
    for (const [seed, head] of this.signalHeads || []) {
      if (want.has(seed)) continue;
      this.signals.remove(head.root);
      head.root.traverse((o) => {
        if (o.isMesh) o.material.dispose();
      });
      this.signalHeads.delete(seed);
    }
    if (!this.signalHeads) this.signalHeads = new Map();

    const parts = this._signalParts();

    for (const [seed, entry] of this.built) {
      if (!this.signalHeads.has(seed)) {
        const j = entry.junction;
        const p = this.track.at(j.s);
        if (!p) continue;

        const nx = -Math.sin(p.theta);
        const nz = Math.cos(p.theta);
        const px = p.x + nx * (this.halfWidth + 1.4);
        const pz = p.z + nz * (this.halfWidth + 1.4);

        const root = new THREE.Group();
        root.position.set(px, p.y || 0, pz);
        root.rotation.y = -p.theta;

        root.add(new THREE.Mesh(parts.pole, this.matPole));
        root.add(new THREE.Mesh(parts.head, this.matPole));

        const lamps = parts.lamps.map((geo) => {
          const m = new THREE.MeshBasicMaterial({ color: 0x101010 });
          const mesh = new THREE.Mesh(geo, m);
          root.add(mesh);
          return m;
        });

        this.signals.add(root);
        this.signalHeads.set(seed, { root, lamps });
      }

      // Recolour in place: this is the part that was missing.
      const head = this.signalHeads.get(seed);
      const state = lightState(seed, time);
      head.lamps[0].color.setHex(state === 'red' ? 0xff2a1a : 0x2a0906);
      head.lamps[1].color.setHex(state === 'amber' ? 0xffb020 : 0x2a1c00);
      head.lamps[2].color.setHex(state === 'green' ? 0x22ff66 : 0x06280f);
    }
  }

  // What the autopilot needs at a given arc length: how far to the next junction and
  // whether its signal says stop.
  signalAt(sCar, time) {
    let best = null;
    let bestD = Infinity;
    for (const [seed, entry] of this.built) {
      const d = entry.junction.s - sCar;
      if (d < -6 || d > 130) continue;
      if (Math.abs(d) < Math.abs(bestD)) {
        bestD = d;
        best = { distance: d, state: lightState(seed, time) };
      }
    }
    return best;
  }

  // Which way to go at the next junction. Straight by default; a turn is chosen
  // deterministically per junction so the car commits instead of dithering.
  routeAt(sCar, turnBias = 0.35) {
    let best = null;
    for (const [seed, entry] of this.built) {
      const d = entry.junction.s - sCar;
      if (d < -8 || d > 160) continue;
      if (!best || Math.abs(d) < Math.abs(best.distance)) {
        best = { distance: d, junction: entry.junction, seed };
      }
    }
    if (!best) return null;

    const h = Math.abs(Math.sin(best.seed * 12.9898) * 43758.5453) % 1;
    return {
      distance: best.distance,
      turn: h < turnBias,
      side: best.junction.side,
      fourWay: best.junction.fourWay,
      s: best.junction.s,
    };
  }

  setMaterial(mat, lineMat) {
    if (lineMat) this.matLine = lineMat;
    for (const entry of this.built.values()) {
      if (this.matLine) entry.lines.material = this.matLine;
    }
  }

  get liveCount() {
    return this.built.size;
  }
}
