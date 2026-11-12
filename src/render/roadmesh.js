// The built road: asphalt, verges, guardrails, viaduct decks and piers, tunnel
// tubes and portals, generated in 64 m chunks from committed samples.
//
// Committed samples never change, so a chunk is built once and only moved when
// the floating origin moves. Paint is drawn by the asphalt shader from the
// lateral coordinate, so a line can never sink under the crown of the road.

import * as THREE from 'three';
import {
  STEP, HALF_PAVED, HALF_FLAT, DECK_DEPTH, GROUND, BRIDGE, TUNNEL,
} from '../world/road.js';
import { TUNNEL_H } from '../world/corridor.js';
import { withAtmosphere, withSunMask, withSkyScale, boreSky } from './atmosphere.js';
import { worldUniforms, WORLD_GLSL, PAL } from './worldlook.js';
import { sunVisibility } from '../world/sunlight.js';
import { asphaltTexture } from './textures.js';

const CHUNK = 32;                 // samples per chunk: 64 m
const AHEAD = 3600;
const BEHIND = 320;
const EDGE_LINE = 3.75;           // centre of the solid edge line
const PIER_EVERY = 36;            // metres between piers on a viaduct
const MAX_PIERS = 1200;

// --- materials ----------------------------------------------------------------

// The verge is the gravel of the world it is in, the colour the terrain gives
// its own verge beyond it (render/terrain.js), so in a world of black basalt
// or cave dust it is not a band of alpine grit.
function vergeMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, worldUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vVergeXZ;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vVergeXZ = (modelMatrix * vec4(transformed, 1.0)).xz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vVergeXZ;
${WORLD_GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
worldAt(vVergeXZ + uWorldOrigin);
diffuseColor.rgb = worldPal(${PAL.gravel}) * 0.9;`);
  };
  mat.customProgramCacheKey = () => 'continuum-verge';
  return mat;
}

function asphaltMaterial(renderer) {
  const map = asphaltTexture(renderer, [74, 73, 71]);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0, envMapIntensity: 0.5 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uAsphalt = { value: map };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 aRoad;
varying vec3 vRoad;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vRoad = aRoad;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uAsphalt;
varying vec3 vRoad;
float paint;
float wheel;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
// vRoad: x = lateral metres, y = arc length metres, z = 1 where the centre
// line is solid (bends, bridges, tunnels), plus 2 inside a tunnel.
float lat = vRoad.x;
float s = vRoad.y;
float tunnelRoad = step(1.5, vRoad.z);
float solidLine = step(0.5, mod(vRoad.z, 2.0));
vec3 base = texture2D(uAsphalt, vec2(lat, s) / 3.2).rgb;
base = mix(base, texture2D(uAsphalt, vec2(lat, s) / 17.0).rgb, 0.35);
// The grain reads at a metre; further out it is just a fine, even grey.
base = mix(vec3(0.062, 0.061, 0.060), base, 0.6);
// Polished wheel paths in each lane: a little darker and smoother.
wheel = 0.0;
for (int i = 0; i < 4; i++) {
  float c = (float(i) - 1.5) * 1.9;
  wheel = max(wheel, 1.0 - smoothstep(0.25, 0.65, abs(lat - c)));
}
base *= 1.0 - 0.12 * wheel;
float aa = fwidth(lat) * 1.2 + 0.004;
float edge = 1.0 - smoothstep(0.075 - aa, 0.075 + aa, abs(abs(lat) - ${EDGE_LINE.toFixed(2)}));
float dash = step(fract(s / 9.0), 0.36);
float centre = 1.0 - smoothstep(0.06 - aa, 0.06 + aa, abs(abs(lat) - (solidLine > 0.5 ? 0.12 : 0.0)));
centre *= solidLine > 0.5 ? 1.0 : dash;
paint = max(edge, centre);
diffuseColor.rgb = mix(base, vec3(0.86, 0.85, 0.80), paint * 0.92);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
// In a tunnel the vault lamps, one every 7 m, throw pools on the carriageway.
float pool = 0.72 + 0.28 * cos(6.2832 * s / 7.0);
totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.82, 0.6) * tunnelRoad * pool * 0.6;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(0.94, 0.8, wheel * 0.5);
roughnessFactor = mix(roughnessFactor, 0.6, paint);`);
  };
  mat.customProgramCacheKey = () => 'continuum-asphalt';
  return withSkyScale(withAtmosphere(mat), boreSky, 'tunnelRoad');
}

function tunnelMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xbab4a6, roughness: 0.82, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aTube;
varying vec2 vTube;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vTube = aTube;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vTube;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
// vTube: x = position round the profile (0 at the road edge, 1 at the crown),
// y = arc length. A row of lamps on each shoulder of the vault, and darker
// panels along the lower wall.
float lamp = smoothstep(0.035, 0.0, abs(vTube.x - 0.62)) * step(fract(vTube.y / 7.0), 0.42);
totalEmissiveRadiance += vec3(1.0, 0.78, 0.48) * lamp * 9.0;
diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.14, 0.18, vTube.x));
// The lamps wash the vault and walls around them.
float wash = (0.4 + 0.6 * smoothstep(0.55, 0.0, abs(vTube.x - 0.62))) * (0.8 + 0.2 * cos(6.2832 * vTube.y / 7.0));
totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.83, 0.62) * wash * 0.22;`);
  };
  mat.customProgramCacheKey = () => 'continuum-tunnel';
  return withSkyScale(withAtmosphere(mat), boreSky);
}

// --- geometry helpers -----------------------------------------------------------

class Builder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.extra = [];
    this.sun = [];
    this.idx = [];
    this.n = 0;
    // Sun visibility stamped on every vertex made until it is changed.
    this.sunNow = 1;
  }

  vert(x, y, z, nx, ny, nz, e0 = 0, e1 = 0, e2 = 0) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.extra.push(e0, e1, e2);
    this.sun.push(this.sunNow);
    return this.n++;
  }

  quad(a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  }

  geometry(extraName = null, extraSize = 3) {
    if (!this.n) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aSun', new THREE.Float32BufferAttribute(this.sun, 1));
    if (extraName) {
      const e = extraSize === 3 ? this.extra : this.extra.filter((_, i) => i % 3 < extraSize);
      g.setAttribute(extraName, new THREE.Float32BufferAttribute(e, extraSize));
    }
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// A frame per sample: position relative to the chunk anchor, forward and left
// unit vectors, the running surface height and its bank, and how much sun
// reaches it past the mountains (none inside a tunnel).
function frames(road, i0, i1, ax0, az0, land, sun) {
  const out = [];
  for (let i = i0; i <= i1; i++) {
    const p = road.samples.get(i);
    const fx = Math.cos(p.theta);
    const fz = Math.sin(p.theta);
    out.push({
      i, s: i * STEP, x: p.ax - ax0, z: p.az - az0, y: p.y,
      fx, fz, lx: -fz, lz: fx, bank: p.bank, kind: p.kind, kappa: p.kappa,
      gl: p.gl, gr: p.gr,
      sun: p.kind === TUNNEL ? 0 : sunVisibility(land, p.ax, p.az, p.y, sun),
    });
  }
  return out;
}

// Height of the running surface at a lateral offset.
const surf = (f, lat) => f.y - f.bank * lat;

// Extrude a cross-section (lat, up) along a run of frames. The profile is
// listed with the solid on its right, so each edge's outward normal is
// (-du, dl). Every edge gets its own vertices so corners stay crisp; `mirror`
// repeats the section on the other side of the centreline.
function extrude(b, fr, profile, mirror, tag) {
  for (const side of mirror ? [1, -1] : [1]) {
    for (let e = 0; e < profile.length - 1; e++) {
      const [l0, u0] = profile[e];
      const [l1, u1] = profile[e + 1];
      const dl = l1 - l0;
      const du = u1 - u0;
      const len = Math.hypot(dl, du) || 1;
      const nLat = (-du / len) * side;
      const nUp = dl / len;
      let pa = -1;
      let pb = -1;
      for (const f of fr) {
        b.sunNow = f.sun;
        const la = l0 * side;
        const lb = l1 * side;
        const nx = f.lx * nLat;
        const nz = f.lz * nLat;
        const ta = tag ? tag(e, 0) : 0;
        const tb = tag ? tag(e, 1) : 0;
        const a = b.vert(f.x + f.lx * la, surf(f, la) + u0, f.z + f.lz * la, nx, nUp, nz, ta, f.s);
        const c = b.vert(f.x + f.lx * lb, surf(f, lb) + u1, f.z + f.lz * lb, nx, nUp, nz, tb, f.s);
        if (pa >= 0) {
          if (side > 0) b.quad(pa, pb, c, a);
          else b.quad(pa, a, c, pb);
        }
        pa = a;
        pb = c;
      }
    }
  }
}

// The tunnel's inner section, from the road edge up the wall and over the vault
// to the crown, listed so the solid (the rock) is on the right.
function tunnelProfile() {
  const P = HALF_PAVED;
  const prof = [[P + 0.05, 0.0], [P + 0.45, 0.25], [P + 0.55, 1.1], [5.45, 4.1]];
  for (let k = 1; k <= 8; k++) {
    const t = (k / 8) * Math.PI * 0.5;
    prof.push([5.45 * Math.cos(t), 4.1 + (TUNNEL_H - 4.1) * Math.sin(t)]);
  }
  return prof.reverse();
}
const TUBE = tunnelProfile();

// --- the renderer ------------------------------------------------------------

export class RoadRenderer {
  constructor(scene, road, corridor, renderer) {
    this.road = road;
    this.corridor = corridor;
    this.group = new THREE.Group();
    this.group.name = 'road';
    scene.add(this.group);
    this.origin = { x: 0, z: 0 };
    this.chunks = new Map();        // chunk index -> { group, ax, az }

    const ds = { side: THREE.DoubleSide };
    const lit = (m) => withSunMask(withAtmosphere(m), true);
    this.mat = {
      asphalt: withSunMask(asphaltMaterial(renderer), true),
      verge: lit(vergeMaterial()),
      concrete: lit(new THREE.MeshStandardMaterial({ color: 0xa3a097, roughness: 0.88 })),
      concreteDark: lit(new THREE.MeshStandardMaterial({ color: 0x7a776f, roughness: 0.92 })),
      portal: lit(new THREE.MeshStandardMaterial({ color: 0x9c988e, roughness: 0.9, ...ds })),
      rail: lit(new THREE.MeshStandardMaterial({ color: 0xc2c6ca, roughness: 0.32, metalness: 0.85, ...ds })),
      post: lit(new THREE.MeshStandardMaterial({ color: 0x8e9296, roughness: 0.5, metalness: 0.6, ...ds })),
      pier: lit(new THREE.MeshStandardMaterial({ color: 0xa3a097, roughness: 0.88 })),
      tunnel: withSunMask(tunnelMaterial(), true),
    };
    // The tube is seen from inside; rendering both faces keeps it closed
    // whichever way a stretch of it was wound.
    this.mat.tunnel.side = THREE.DoubleSide;
    this.land = corridor.land;
    this.sunDir = new THREE.Vector3(0.5, 0.6, 0.5).normalize();

    // Piers: one unit-tall wall pier instanced and stretched to the ground.
    const pierGeo = new THREE.BoxGeometry(2.0, 1, 5.2);
    pierGeo.translate(0, -0.5, 0);
    this.pierSun = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PIERS).fill(1), 1);
    pierGeo.setAttribute('aSun', this.pierSun);
    this.piers = new THREE.InstancedMesh(pierGeo, this.mat.pier, MAX_PIERS);
    this.piers.count = 0;
    this.piers.castShadow = true;
    this.piers.receiveShadow = true;
    this.piers.frustumCulled = false;
    this.group.add(this.piers);
    this.pierList = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._sc = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  setOrigin(x, z) {
    this.origin.x = x;
    this.origin.z = z;
    for (const c of this.chunks.values()) c.group.position.set(c.ax - x, 0, c.az - z);
    this._syncPiers();
  }

  // Keep chunks built from just behind the car to far ahead. budget < 0 builds
  // everything at once (start-up and headless captures).
  update(sCar, budget = 3) {
    const road = this.road;
    const first = Math.max(Math.ceil(road.first / CHUNK) + 1, Math.floor((sCar - BEHIND) / STEP / CHUNK));
    const last = Math.min(Math.floor(road.classified / CHUNK) - 1, Math.floor((sCar + AHEAD) / STEP / CHUNK));
    const near = Math.floor(sCar / STEP / CHUNK);
    const order = [];
    for (let c = first; c <= last; c++) if (!this.chunks.has(c)) order.push(c);
    order.sort((a, b) => Math.abs(a - near) - Math.abs(b - near));
    let built = 0;
    for (const c of order) {
      if (budget >= 0 && built >= budget) break;
      this._build(c);
      built++;
    }
    let dropped = false;
    for (const [c, chunk] of this.chunks) {
      if (c >= first - 1 && c <= last + 1) continue;
      this.group.remove(chunk.group);
      chunk.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      this.chunks.delete(c);
      dropped = true;
    }
    if (built || dropped) {
      this.pierList = this.pierList.filter((p) => this.chunks.has(p.chunk));
      this._syncPiers();
    }
    return order.length - built;
  }

  _build(c) {
    const road = this.road;
    const i0 = c * CHUNK;
    const i1 = i0 + CHUNK;
    const a0 = road.samples.get(i0);
    const ax0 = a0.ax;
    const az0 = a0.az;
    const fr = frames(road, i0, i1, ax0, az0, this.land, this.sunDir);
    const group = new THREE.Group();
    group.position.set(ax0 - this.origin.x, 0, az0 - this.origin.z);

    // Asphalt across the whole chunk, whatever it stands on, with a crown.
    const asphalt = new Builder();
    const COLS = [-HALF_PAVED, -3.9, -2.6, -1.3, 0, 1.3, 2.6, 3.9, HALF_PAVED];
    let rowPrev = null;
    for (const f of fr) {
      asphalt.sunNow = f.sun;
      const solid = (Math.abs(f.kappa) > 1 / 220 || f.kind !== GROUND ? 1 : 0) + (f.kind === TUNNEL ? 2 : 0);
      const row = COLS.map((lat) => asphalt.vert(
        f.x + f.lx * lat, surf(f, lat) + 0.045 * (1 - (lat / HALF_PAVED) ** 2), f.z + f.lz * lat,
        0, 1, 0, lat, f.s, solid,
      ));
      if (rowPrev) {
        for (let k = 0; k < COLS.length - 1; k++) asphalt.quad(rowPrev[k], rowPrev[k + 1], row[k + 1], row[k]);
      }
      rowPrev = row;
    }
    const ag = asphalt.geometry('aRoad');
    ag.computeVertexNormals();
    const am = new THREE.Mesh(ag, this.mat.asphalt);
    am.receiveShadow = true;
    group.add(am);

    // Runs of one structure kind. A run includes the first frame of the next
    // kind, so the pieces meet without a gap.
    const runs = [];
    let start = 0;
    for (let k = 1; k <= fr.length; k++) {
      if (k === fr.length || fr[k].kind !== fr[start].kind) {
        runs.push([start, Math.min(k, fr.length - 1), fr[start].kind]);
        start = k;
      }
    }

    const verge = new Builder();
    const concrete = new Builder();
    const dark = new Builder();
    const portal = new Builder();
    const rail = new Builder();
    const post = new Builder();
    const tube = new Builder();

    for (const [a, b, kind] of runs) {
      const run = fr.slice(a, b + 1);
      if (run.length < 2) continue;
      if (kind === GROUND) {
        // Verge: gravel from the asphalt edge down under the shaped ground.
        extrude(verge, run, [[HALF_PAVED, -0.02], [5.3, -0.14], [HALF_FLAT, -0.3], [HALF_FLAT + 0.8, -0.85]], true);
        // Guardrails where the land falls away, and round the outside of
        // every hairpin.
        for (const side of [1, -1]) {
          const needs = run.map((f) => {
            // gr is the natural ground at +HALF_PAVED along the left normal.
            const drop = surf(f, side * HALF_PAVED) - (side > 0 ? f.gr : f.gl);
            const outer = Math.abs(f.kappa) > 1 / 40 && Math.sign(f.kappa) === -side;
            return drop > 2.2 || outer;
          });
          let k = 0;
          while (k < run.length) {
            if (!needs[k]) {
              k++;
              continue;
            }
            let e = k;
            while (e + 1 < run.length && needs[e + 1]) e++;
            if (e > k) this._guardrail(rail, post, run.slice(k, e + 1), side, i1);
            k = e + 1;
          }
        }
      } else if (kind === BRIDGE) {
        const P = HALF_PAVED;
        // Parapet and deck edge, then the box girder underneath.
        extrude(concrete, run, [
          [P - 0.01, 0.0], [P + 0.22, 0.06], [P + 0.36, 0.32], [P + 0.42, 0.95],
          [P + 0.66, 0.95], [P + 0.72, 0.0], [P + 0.72, -0.42],
        ], true);
        extrude(dark, run, [[P + 0.72, -0.42], [3.5, -DECK_DEPTH], [0, -DECK_DEPTH]], true);
        this._piers(run, c, i1);
      } else if (kind === TUNNEL) {
        extrude(tube, run, TUBE, true, (e, end) => 1 - (e + end) / (TUBE.length - 1));
      }
    }

    // Portals wherever a tunnel meets open road inside this chunk.
    for (let k = 0; k < fr.length - 1; k++) {
      const f = fr[k];
      if (f.kind !== TUNNEL) continue;
      const before = road.samples.get(f.i - 1);
      const after = road.samples.get(f.i + 1);
      if (before && before.kind !== TUNNEL) this._portal(portal, f, -1);
      if (after && after.kind !== TUNNEL) this._portal(portal, f, 1);
    }

    const add = (builder, mat, extra = null, size = 3, cast = true) => {
      const g = builder.geometry(extra, size);
      if (!g) return;
      const m = new THREE.Mesh(g, mat);
      m.castShadow = cast;
      m.receiveShadow = true;
      group.add(m);
    };
    add(verge, this.mat.verge, null, 3, false);
    add(concrete, this.mat.concrete);
    add(dark, this.mat.concreteDark);
    add(portal, this.mat.portal);
    add(rail, this.mat.rail);
    add(post, this.mat.post);
    add(tube, this.mat.tunnel, 'aTube', 2);

    this.group.add(group);
    this.chunks.set(c, { group, ax: ax0, az: az0 });
  }

  _guardrail(rail, post, run, side, iEnd) {
    const lat = side * (HALF_PAVED + 0.55);
    // W-beam: a folded steel strip 0.32 m tall on posts every 4 m.
    const prof = [[0, 0.52], [-0.06, 0.6], [0, 0.68], [-0.06, 0.76], [0, 0.84]];
    for (let e = 0; e < prof.length - 1; e++) {
      let pa = -1;
      let pb = -1;
      for (const f of run) {
        rail.sunNow = f.sun;
        const l0 = lat + prof[e][0] * side;
        const l1 = lat + prof[e + 1][0] * side;
        const nx = -f.lx * side;
        const nz = -f.lz * side;
        const a = rail.vert(f.x + f.lx * l0, surf(f, lat) + prof[e][1], f.z + f.lz * l0, nx, 0, nz);
        const b = rail.vert(f.x + f.lx * l1, surf(f, lat) + prof[e + 1][1], f.z + f.lz * l1, nx, 0, nz);
        if (pa >= 0) rail.quad(pa, a, b, pb);
        pa = a;
        pb = b;
      }
    }
    for (const f of run) {
      if (f.i % 2 !== 0 || f.i >= iEnd) continue;
      post.sunNow = f.sun;
      const cx = f.x + f.lx * (lat + side * 0.12);
      const cz = f.z + f.lz * (lat + side * 0.12);
      const y0 = surf(f, lat) - 0.3;
      const y1 = surf(f, lat) + 0.8;
      const w = 0.07;
      const corners = [[-w, -w], [w, -w], [w, w], [-w, w]].map(([u, v]) => [
        cx + f.fx * u + f.lx * v, cz + f.fz * u + f.lz * v,
      ]);
      for (let k = 0; k < 4; k++) {
        const [x0, z0] = corners[k];
        const [x1, z1] = corners[(k + 1) % 4];
        const l = Math.hypot(z1 - z0, x1 - x0) || 1;
        const nx = (z1 - z0) / l;
        const nz = -(x1 - x0) / l;
        const a = post.vert(x0, y0, z0, nx, 0, nz);
        const b = post.vert(x1, y0, z1, nx, 0, nz);
        const c2 = post.vert(x1, y1, z1, nx, 0, nz);
        const d = post.vert(x0, y1, z0, nx, 0, nz);
        post.quad(a, b, c2, d);
      }
    }
  }

  // Piers at fixed arc-length stations, so the same viaduct always stands on
  // the same piers; skipped where another level of road runs underneath.
  _piers(run, chunk, iEnd) {
    const road = this.road;
    for (const f of run) {
      if (f.i >= iEnd || f.kind !== BRIDGE || f.s % PIER_EVERY !== 0) continue;
      const smp = road.samples.get(f.i);
      // In a world where the road floats (space), no piers at all.
      if (this.land.floats && this.land.floats(smp.ax, smp.az)) continue;
      const top = f.y - DECK_DEPTH + 0.05;
      const ground = this.corridor.heightAt(smp.ax, smp.az);
      if (top - ground < 1.5) continue;
      let blocked = false;
      road.forEachSegmentNear(smp.ax, smp.az, 9, (j) => {
        if (blocked || Math.abs(j - f.i) < 40) return;
        const o = road.samples.get(j);
        if (Math.hypot(o.ax - smp.ax, o.az - smp.az) < 8 && o.y < top - 2) blocked = true;
      });
      if (blocked) continue;
      // Sun on the pier: taken halfway down, where most of it is seen.
      const sun = sunVisibility(this.land, smp.ax, smp.az, (top + ground) * 0.5, this.sunDir);
      this.pierList.push({ x: smp.ax, z: smp.az, top, bottom: ground - 1.5, theta: smp.theta, chunk, sun });
    }
  }

  // A portal: a concrete headwall around the opening, built as pillars either
  // side, a lintel over the crown and fans filling the corners above the vault.
  _portal(b, f, dir) {
    const W = 7.2;
    const H = TUNNEL_H + 1.6;
    const P = 5.6;
    const nx = f.fx * dir;
    const nz = f.fz * dir;
    const smp = this.road.samples.get(f.i);
    b.sunNow = sunVisibility(this.land, smp.ax + Math.cos(smp.theta) * dir * 3,
      smp.az + Math.sin(smp.theta) * dir * 3, f.y + 3, this.sunDir);
    const at = (lat, up, off) => [
      f.x + f.lx * lat + f.fx * off, surf(f, lat) + up, f.z + f.lz * lat + f.fz * off,
    ];
    const face = (pts, off) => {
      const ids = pts.map(([lat, up]) => {
        const [x, y, z] = at(lat, up, off);
        return b.vert(x, y, z, nx, 0, nz);
      });
      for (let k = 1; k < ids.length - 1; k++) b.idx.push(ids[0], ids[k], ids[k + 1]);
    };
    for (const off of [0.2 * dir, -1.4 * dir]) {
      face([[-W, -0.3], [-P, -0.3], [-P, H], [-W, H]], off);
      face([[P, -0.3], [W, -0.3], [W, H], [P, H]], off);
      face([[-P, TUNNEL_H + 0.2], [P, TUNNEL_H + 0.2], [P, H], [-P, H]], off);
      // Corners between the vault and the lintel.
      for (const s of [1, -1]) {
        const fan = [[s * P, TUNNEL_H + 0.2]];
        for (let k = 0; k <= 8; k++) {
          const t = (k / 8) * Math.PI * 0.5;
          fan.push([s * 5.45 * Math.cos(t), 4.1 + (TUNNEL_H - 4.1) * Math.sin(t)]);
        }
        fan.push([s * P, 4.1]);
        face(fan, off);
      }
    }
  }

  _syncPiers() {
    const m = this.piers;
    let n = 0;
    for (const p of this.pierList) {
      if (n >= MAX_PIERS) break;
      const h = p.top - p.bottom;
      // Tall piers are thicker, like the real ones.
      const w = 1 + Math.min(1.2, h / 90);
      this._v.set(p.x - this.origin.x, p.top, p.z - this.origin.z);
      this._q.setFromAxisAngle(this._up, -p.theta);
      this._sc.set(w, h, Math.min(1, 0.55 + h / 60));
      this._m.compose(this._v, this._q, this._sc);
      this.pierSun.setX(n, p.sun);
      m.setMatrixAt(n++, this._m);
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    this.pierSun.needsUpdate = true;
  }

  setSun(dir) {
    this.sunDir.copy(dir).normalize();
  }
}
