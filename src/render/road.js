import * as THREE from 'three';
import { asphaltTexture, roughnessTexture, lineTexture, dashedTexture } from './textures.js';

// Road surface built from a fixed pool of chunks. When the car moves forward the
// farthest-behind chunk is rewritten in place with the next stretch of road, so
// vertex buffers and draw calls stay constant for the whole session.
//
// Each strip carries UVs: U spans the ribbon width, V runs along arc length, so
// the tiled asphalt and the dashed centre line both follow the road as it bends
// instead of sliding over it.

const CHUNK_SAMPLES = 24;        // x STEP (2 m) = 48 m per chunk
const POOL_SIZE = 34;

const ROAD_TOP = 0.06;
const SHOULDER_W = 2.4;

// Metres of road per texture tile. Small enough that grain is visible under the
// camera, large enough that the repeat does not read as a grid.
const ASPHALT_TILE_M = 6;

export class RoadMesh {
  constructor(track, parent, renderer) {
    this.track = track;
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    parent.add(this.group);

    this.asphaltMap = asphaltTexture(renderer, [40, 45, 51]);
    this.asphaltRough = roughnessTexture(renderer);
    this.lineMap = lineTexture(renderer, [236, 233, 221]);
    this.dashMap = dashedTexture(renderer, [236, 233, 221]);

    this.matRoad = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.asphaltMap,
      roughnessMap: this.asphaltRough,
      roughness: 1.0,
      metalness: 0.0,
      envMapIntensity: 0.35,
    });
    this.matShoulder = new THREE.MeshStandardMaterial({
      color: 0x6a6258,
      roughness: 0.98,
      metalness: 0.0,
      envMapIntensity: 0.2,
    });
    this.matLine = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.lineMap,
      roughness: 0.72,
      metalness: 0.0,
      envMapIntensity: 0.3,
    });
    // Dashed centre line: a second thin strip with an alpha-tested map.
    this.matCentre = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.dashMap,
      roughness: 0.72,
      metalness: 0.0,
      envMapIntensity: 0.3,
      transparent: true,
      alphaTest: 0.5,
    });

    this.chunks = [];
    for (let i = 0; i < POOL_SIZE; i++) this.chunks.push(this._createChunk());
    this.roadWidth = 7.0;
    this.terrainAmp = 260;

    // An unwritten chunk holds all-zero positions, which collapse into huge black
    // triangles. Hide each one until update() has filled it.
    for (const c of this.chunks) {
      for (const m of c.meshes) m.visible = false;
    }

    this._dashPhase = 0;
  }

  _createChunk() {
    const rows = CHUNK_SAMPLES + 1;
    // Road gets more columns so the crown reads and UVs stay square across width.
    const road = this._makeStrip(rows, 7);
    const shoulderL = this._makeStrip(rows, 3);
    const shoulderR = this._makeStrip(rows, 3);
    const lineL = this._makeStrip(rows, 2);
    const lineR = this._makeStrip(rows, 2);
    const centre = this._makeStrip(rows, 2);

    const mRoad = new THREE.Mesh(road.geo, this.matRoad);
    const mL = new THREE.Mesh(shoulderL.geo, this.matShoulder);
    const mR = new THREE.Mesh(shoulderR.geo, this.matShoulder);
    const mLineL = new THREE.Mesh(lineL.geo, this.matLine);
    const mLineR = new THREE.Mesh(lineR.geo, this.matLine);
    const mCentre = new THREE.Mesh(centre.geo, this.matCentre);
    mRoad.receiveShadow = true;
    mL.receiveShadow = true;
    mR.receiveShadow = true;
    for (const m of [mRoad, mL, mR, mLineL, mLineR, mCentre]) this.group.add(m);

    return {
      start: null, road, shoulderL, shoulderR, lineL, lineR, centre,
      meshes: [mRoad, mL, mR, mLineL, mLineR, mCentre],
    };
  }

  _makeStrip(rows, cols) {
    const geo = new THREE.BufferGeometry();
    const n = rows * cols;
    const pos = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const idx = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        // Counter-clockwise seen from above: cross(v1-v0, v2-v0) points +Y.
        idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    // A horizontal ribbon has a constant +Y normal; writing them once avoids
    // recomputing on every chunk rewrite.
    const nrm = new Float32Array(n * 3);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return {
      geo, pos, uv, attr: geo.attributes.position, uvAttr: geo.attributes.uv,
      rows, cols,
    };
  }

  _writeChunk(chunk, sStart) {
    const { road, shoulderL, shoulderR, lineL, lineR, centre } = chunk;
    const halfW = this.roadWidth * 0.5;
    const vTile = ASPHALT_TILE_M;

    // Walk the rows holding the last valid sample: a missing sample used to leave
    // that row's vertices at the origin, which tore a wedge out of the road.
    let p = this.track.at(sStart);
    for (let r = 0; r <= CHUNK_SAMPLES; r++) {
      const s = sStart + r * 2;
      const sample = this.track.at(s);
      if (sample) p = sample;
      if (!p) continue;
      const nx = -Math.sin(p.theta);
      const nz = Math.cos(p.theta);
      const vAcross = s / vTile;
      // The road rides the terrain's own elevation field, so it climbs and dips
      // with the land instead of cutting a level trench through it.
      const yBase = ROAD_TOP;

      for (let c = 0; c < road.cols; c++) {
        const u = c / (road.cols - 1);
        const off = (u * 2 - 1) * halfW;
        const i = (r * road.cols + c) * 3;
        // Slight crown so water would run off and the surface is not a flat plate.
        road.pos[i] = p.x + nx * off;
        road.pos[i + 1] = yBase + 0.035 * (1 - (u * 2 - 1) ** 2);
        road.pos[i + 2] = p.z + nz * off;
        const t = (r * road.cols + c) * 2;
        road.uv[t] = off / vTile;
        road.uv[t + 1] = vAcross;
      }

      // Shoulders fall away from the asphalt, one strip per side.
      for (const [strip, side] of [[shoulderL, -1], [shoulderR, 1]]) {
        for (let c = 0; c < strip.cols; c++) {
          const k = c / (strip.cols - 1);
          const off = halfW + side * SHOULDER_W * k;
          const drop = -1.6 * k * k;
          const i = (r * strip.cols + c) * 3;
          strip.pos[i] = p.x + nx * off;
          strip.pos[i + 1] = yBase + drop;
          strip.pos[i + 2] = p.z + nz * off;
          const t = (r * strip.cols + c) * 2;
          strip.uv[t] = off / vTile;
          strip.uv[t + 1] = vAcross;
        }
      }

      // Solid edge lines, one thin quad per side.
      const LW = 0.15;
      for (const [strip, sgn] of [[lineL, -1], [lineR, 1]]) {
        for (let c = 0; c < 2; c++) {
          const off = sgn * (halfW - 0.22 - c * LW);
          const i = (r * 2 + c) * 3;
          strip.pos[i] = p.x + nx * off;
          strip.pos[i + 1] = yBase + 0.05;
          strip.pos[i + 2] = p.z + nz * off;
          const t = (r * 2 + c) * 2;
          strip.uv[t] = c;
          // One paint-length per 4 m so the scuffs repeat at a believable scale.
          strip.uv[t + 1] = s / 4;
        }
      }

      // Dashed centre line. The dash pattern lives in the texture alpha, so the
      // geometry stays a simple strip; collapsing vertices instead leaves a
      // vertical sheet of paint standing in every gap.
      {
        const cw = 0.075;
        for (let c = 0; c < 2; c++) {
          const off = c === 0 ? -cw : cw;
          const i = (r * 2 + c) * 3;
          centre.pos[i] = p.x + nx * off;
          centre.pos[i + 1] = yBase + 0.012;
          centre.pos[i + 2] = p.z + nz * off;
          const t = (r * 2 + c) * 2;
          centre.uv[t] = c;
          centre.uv[t + 1] = s / 9;
        }
      }
    }

    for (const strip of [road, shoulderL, shoulderR, lineL, lineR, centre]) {
      strip.attr.needsUpdate = true;
      strip.uvAttr.needsUpdate = true;
      strip.geo.computeBoundingSphere();
      strip.geo.computeBoundingBox();
    }
    for (const m of chunk.meshes) m.visible = true;
    chunk.start = sStart;
  }

  setTerrainAmp(amp) {
    this.terrainAmp = amp;
  }

  setBiome(roadHex, lineHex, shoulderHex, width) {
    // The albedo comes from the texture; the biome tints it and drives the paint.
    this.matRoad.color.setHex(roadHex).lerp(new THREE.Color(0xffffff), 0.55);
    this.matShoulder.color.setHex(shoulderHex);
    this.matLine.color.setHex(lineHex);
    this.matCentre.color.setHex(lineHex);
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
