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

export const ROAD_TOP = 0.06;
const SHOULDER_W = 2.8;

// Metres of road per texture tile. Small enough that grain is visible under the
// camera, large enough that the repeat does not read as a grid.
const ASPHALT_TILE_M = 2.5;

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
    const shoulderL = this._makeStrip(rows, 3, true);
    const shoulderR = this._makeStrip(rows, 3);
    const lineL = this._makeStrip(rows, 2);
    const lineR = this._makeStrip(rows, 2, true);
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

  _makeStrip(rows, cols, flip = false) {
    const geo = new THREE.BufferGeometry();
    const n = rows * cols;
    const pos = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const idx = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        // Winding puts cross(across, forward) on +Y. Strips whose columns run in
        // the -normal direction would come out facing down and get culled, so they
        // ask for the reversed order.
        if (flip) idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
        else idx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    // Normals are per-vertex now: a ribbon on a grade does not face straight up.
    // They are recomputed on every chunk write rather than baked once.
    const nrm = new Float32Array(n * 3);
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
      // The road follows its own elevation channel, so the asphalt climbs and
      // dips with the profile. ROAD_TOP is now an offset above that surface
      // rather than the height of a flat world.
      for (let c = 0; c < road.cols; c++) {
        const u = c / (road.cols - 1);
        const off = (u * 2 - 1) * halfW;
        const i = (r * road.cols + c) * 3;
        const wx = p.x + nx * off;
        const wz = p.z + nz * off;
        // Each vertex takes the ground height at its OWN world position, not the
        // centreline's. The base field slopes about 5.6 cm per metre, so across a
        // 9.6 m road the centreline is half a metre off the verge; carrying one
        // height across the width is what let the terrain cut through.
        const ground = this.track.roadSurfaceAt(s, wx, wz);
        road.pos[i] = wx;
        road.pos[i + 1] = ground + ROAD_TOP + 0.035 * (1 - (u * 2 - 1) ** 2);
        road.pos[i + 2] = wz;
        const t = (r * road.cols + c) * 2;
        road.uv[t] = off / vTile;
        road.uv[t + 1] = vAcross;
      }

      // Shoulders fall away from the asphalt, one strip per side.
      for (const [strip, side] of [[shoulderL, -1], [shoulderR, 1]]) {
        for (let c = 0; c < strip.cols; c++) {
          const k = c / (strip.cols - 1);
          const off = halfW + side * SHOULDER_W * k;
          const i = (r * strip.cols + c) * 3;
          const wx = p.x + nx * off;
          const wz = p.z + nz * off;
          // The verge has to meet the ground it lies on, so it takes the local
          // surface height and only its own fall-off on top. Carrying the
          // centreline height out here is what left a lip the terrain poked through.
          const ground = this.track.roadSurfaceAt(s, wx, wz);
          strip.pos[i] = wx;
          // Sink the outer edge well below the analytic surface. The terrain is a
          // triangulated shader field whose vertices are metres apart while the
          // verge is sampled every 2 m, so the two interpolate differently and a
          // shallow offset shows as a lit seam. Burying the edge hides it.
          strip.pos[i + 1] = ground + ROAD_TOP - 0.04 * k - 0.9 * k * k;
          strip.pos[i + 2] = wz;
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
          const wx = p.x + nx * off;
          const wz = p.z + nz * off;
          const ground = this.track.roadSurfaceAt(s, wx, wz);
          strip.pos[i] = wx;
          strip.pos[i + 1] = ground + ROAD_TOP + 0.05;
          strip.pos[i + 2] = wz;
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
          const wx = p.x + nx * off;
          const wz = p.z + nz * off;
          const ground = this.track.roadSurfaceAt(s, wx, wz);
          centre.pos[i] = wx;
          centre.pos[i + 1] = ground + ROAD_TOP + 0.012;
          centre.pos[i + 2] = wz;
          const t = (r * 2 + c) * 2;
          centre.uv[t] = c;
          centre.uv[t + 1] = s / 9;
        }
      }
    }

    // Derive normals from the sample's heading and grade. The road twists about
    // the travel axis, so tilt is applied in the surface frame.
    for (const strip of [road, shoulderL, shoulderR, lineL, lineR, centre]) {
      const arr = strip.attr.array;
      const nrmArr = strip.geo.attributes.normal.array;
      for (let r = 0; r <= CHUNK_SAMPLES; r++) {
        const sAt = sStart + r * 2;
        const smp = this.track.at(sAt);
        if (!smp) continue;
        const grade = this.track.gradeAt(sAt);
        // Forward direction lifted by the grade, then the up vector is the
        // normal of that forward vector and the lateral axis.
        const fx = Math.cos(smp.theta);
        const fz = Math.sin(smp.theta);
        const inv = 1 / Math.sqrt(1 + grade * grade);
        const upx = -fx * grade * inv;
        const upy = inv;
        const upz = -fz * grade * inv;
        for (let c = 0; c < strip.cols; c++) {
          const k = ((r * strip.cols + c) * 3);
          nrmArr[k] = upx;
          nrmArr[k + 1] = upy;
          nrmArr[k + 2] = upz;
        }
      }
      strip.geo.attributes.normal.needsUpdate = true;
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
