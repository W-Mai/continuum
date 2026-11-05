import * as THREE from 'three';

// Road surface built from a fixed pool of chunks. When the car moves forward the
// farthest-behind chunk is rewritten in place with the next stretch of road, so
// vertex buffers and draw calls stay constant for the whole session.

const CHUNK_SAMPLES = 24;        // x STEP (2 m) = 48 m per chunk
const POOL_SIZE = 34;

const ROAD_TOP = 0.06;
const SHOULDER_W = 2.2;

export class RoadMesh {
  constructor(track, parent) {
    this.track = track;
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    parent.add(this.group);

    // Lit like the rest of the world, so the road darkens at dusk and brightens
    // at noon instead of sitting at one fixed value.
    this.matRoad = new THREE.MeshStandardMaterial({
      color: 0x2a2f35, roughness: 0.95, metalness: 0.0, envMapIntensity: 0.25,
    });
    this.matShoulder = new THREE.MeshStandardMaterial({
      color: 0x50575f, roughness: 0.98, metalness: 0.0, envMapIntensity: 0.2,
    });
    this.matLine = new THREE.MeshStandardMaterial({
      color: 0xe8e6dd, roughness: 0.7, metalness: 0.0, envMapIntensity: 0.3,
    });

    this.chunks = [];
    for (let i = 0; i < POOL_SIZE; i++) this.chunks.push(this._createChunk());
    this.roadWidth = 7.0;

    // A chunk that has not been written yet holds all-zero positions, which
    // collapse into huge black triangles across the view. Hide each chunk until
    // update() has actually filled it.
    for (const c of this.chunks) {
      for (const m of c.meshes) m.visible = false;
    }
  }

  _createChunk() {
    const rows = CHUNK_SAMPLES + 1;
    const road = this._makeStrip(rows, 6);
    // One 2-column strip per side. A single strip spanning both sides would
    // have to zig-zag back across the asphalt.
    const shoulderL = this._makeStrip(rows, 2);
    const shoulderR = this._makeStrip(rows, 2);
    const lineL = this._makeStrip(rows, 2);
    const lineR = this._makeStrip(rows, 2);

    const mRoad = new THREE.Mesh(road.geo, this.matRoad);
    const mL = new THREE.Mesh(shoulderL.geo, this.matShoulder);
    const mR = new THREE.Mesh(shoulderR.geo, this.matShoulder);
    const mLineL = new THREE.Mesh(lineL.geo, this.matLine);
    const mLineR = new THREE.Mesh(lineR.geo, this.matLine);
    for (const m of [mRoad, mL, mR, mLineL, mLineR]) this.group.add(m);

    return {
      start: null, road, shoulderL, shoulderR, lineL, lineR,
      meshes: [mRoad, mL, mR, mLineL, mLineR],
    };
  }

  _makeStrip(rows, cols) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(rows * cols * 3);
    const idx = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        // Counter-clockwise seen from above: cross(v1-v0, v2-v0) points +Y.
        idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    // A road ribbon is horizontal, so every normal is +Y; writing them once beats
    // recomputing on each chunk rewrite.
    const nrm = new Float32Array(rows * cols * 3);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return { geo, pos, attr: geo.attributes.position, rows, cols };
  }

  _writeChunk(chunk, sStart) {
    const { road, shoulderL, shoulderR, lineL, lineR } = chunk;
    const halfW = this.roadWidth * 0.5;

    for (let r = 0; r <= CHUNK_SAMPLES; r++) {
      const s = sStart + r * 2;
      const p = this.track.at(s);
      if (!p) continue;
      const nx = -Math.sin(p.theta);
      const nz = Math.cos(p.theta);

      for (let c = 0; c < road.cols; c++) {
        const u = (c / (road.cols - 1)) * 2 - 1;
        const i = (r * road.cols + c) * 3;
        road.pos[i] = p.x + nx * halfW * u;
        road.pos[i + 1] = ROAD_TOP + 0.02 * (1 - u * u);
        road.pos[i + 2] = p.z + nz * halfW * u;
      }

      // Shoulders fall away from the asphalt, one strip per side.
      for (const [strip, side] of [[shoulderL, -1], [shoulderR, 1]]) {
        for (let c = 0; c < 2; c++) {
          const off = halfW + side * SHOULDER_W * c;
          const drop = -1.4 * c * c;
          const i = (r * 2 + c) * 3;
          strip.pos[i] = p.x + nx * off;
          strip.pos[i + 1] = ROAD_TOP + drop;
          strip.pos[i + 2] = p.z + nz * off;
        }
      }

      // One thin quad per edge line: an outer point and an inner point, both at
      // the same station. Spanning them across the road would paint the asphalt.
      const LW = 0.16;
      for (const [strip, sgn] of [[lineL, -1], [lineR, 1]]) {
        for (let c = 0; c < 2; c++) {
          const off = sgn * (halfW - 0.30 - c * LW);
          const i = (r * 2 + c) * 3;
          strip.pos[i] = p.x + nx * off;
          strip.pos[i + 1] = ROAD_TOP + 0.035;
          strip.pos[i + 2] = p.z + nz * off;
        }
      }
    }

    for (const strip of [road, shoulderL, shoulderR, lineL, lineR]) {
      strip.attr.needsUpdate = true;
      strip.geo.computeBoundingSphere();
      strip.geo.computeBoundingBox();
    }
    for (const m of chunk.meshes) m.visible = true;
    chunk.start = sStart;
  }

  setBiome(roadHex, lineHex, shoulderHex, width) {
    this.matRoad.color.setHex(roadHex);
    this.matShoulder.color.setHex(shoulderHex);
    this.matLine.color.setHex(lineHex);
    this.roadWidth = width;
    this.dirty = true;
  }

  // Keep the pool covering [sCar - back, sCar + ahead]. Chunks are rewritten in
  // place, never reallocated.
  update(sCar, back = 90) {
    const chunkLen = CHUNK_SAMPLES * 2;
    const firstNeeded = Math.floor((sCar - back) / chunkLen) * chunkLen;

    for (const chunk of this.chunks) {
      if (chunk.start === null) continue;
      const rel = chunk.start - firstNeeded;
      if (rel < 0 || rel >= chunkLen * POOL_SIZE) {
        chunk.start = null;
        for (const m of chunk.meshes) m.visible = false;
      }
    }

    for (let k = 0; k < POOL_SIZE; k++) {
      const s = firstNeeded + k * chunkLen;
      if (this.chunks.some((c) => c.start === s)) continue;
      const free = this.chunks.find((c) => c.start === null);
      if (!free) break;
      this._writeChunk(free, s);
    }
  }

  liveChunks() {
    let n = 0;
    for (const c of this.chunks) if (c.start !== null) n++;
    return n;
  }
}
