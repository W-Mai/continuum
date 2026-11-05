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

    this.matRoad = new THREE.MeshStandardMaterial({
      color: 0x2b2f33, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide,
    });
    this.matShoulder = new THREE.MeshStandardMaterial({
      color: 0x4a5158, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide,
    });
    this.matLine = new THREE.MeshStandardMaterial({
      color: 0xe8e6dd, roughness: 0.6, metalness: 0.0, side: THREE.DoubleSide,
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
    const line = this._makeStrip(rows, 2);

    const mRoad = new THREE.Mesh(road.geo, this.matRoad);
    const mL = new THREE.Mesh(shoulderL.geo, this.matShoulder);
    const mR = new THREE.Mesh(shoulderR.geo, this.matShoulder);
    const mLine = new THREE.Mesh(line.geo, this.matLine);
    for (const m of [mRoad, mL, mR, mLine]) this.group.add(m);

    return {
      start: null, road, shoulderL, shoulderR, line,
      meshes: [mRoad, mL, mR, mLine],
    };
  }

  _makeStrip(rows, cols) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(rows * cols * 3);
    const idx = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return { geo, pos, attr: geo.attributes.position, rows, cols };
  }

  _writeChunk(chunk, sStart) {
    const { road, shoulderL, shoulderR, line } = chunk;
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

      for (let c = 0; c < line.cols; c++) {
        const side = c === 0 ? -1 : 1;
        const off = side * (halfW - 0.35);
        const i = (r * line.cols + c) * 3;
        line.pos[i] = p.x + nx * off;
        line.pos[i + 1] = ROAD_TOP + 0.035;
        line.pos[i + 2] = p.z + nz * off;
      }
    }

    for (const strip of [road, shoulderL, shoulderR, line]) {
      strip.attr.needsUpdate = true;
      // The strips carry positions only. With winding (row, row+1, col) the
      // computed normals point down, so force them up: the road is horizontal
      // and only ever lit from above.
      strip.geo.computeVertexNormals();
      const nrm = strip.geo.attributes.normal;
      for (let i = 0; i < nrm.count; i++) {
        nrm.setXYZ(i, 0, 1, 0);
      }
      nrm.needsUpdate = true;
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
