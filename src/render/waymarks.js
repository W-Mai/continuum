// The markers on the winding that turns the road into the Upside Down over: a
// pole by each side of the road every 10 m with a red lamp on it, and an arch
// over the road every 25 m with a lamp at its crown, for the length of the
// stretch of road that is wound (render/upside.js finds it) and 60 m before it
// and after it.
//
// They stand as they would on a road that was not wound: where the road is, at
// its edge, level with it. The winding is in the shaders (render/twist.js), by
// where a thing stands, so the poles and the arches go over with the road they
// are on, each a little further round than the one before, and from far off the
// two rows of red lamps are two spirals that show how the road turns. The lamps
// are points drawn at least a few pixels across, so they are seen from as far off
// as they are laid out (MARKS.sees); a pulse runs along them toward the far end.
//
// What there is of it goes by the tier: all of it at the high one, every second
// pole at the mid one, none at the low one.

import * as THREE from 'three';
import { HALF_PAVED, BRIDGE, TUNNEL } from '../world/road.js';
import { MARKS, markLayout } from '../world/upsidefx.js';
import { withAtmosphere, withSunMask } from './atmosphere.js';
import { MARK } from './style.js';
import { TWIST_PARS, twistU } from './twist.js';

// A stretch is 500 m at the most: 50 poles a side on it and 6 at each end of it, 20
// arches on it and 2 at each end.
const MAX_POLES = 2 * (50 + 12) + 8;
const MAX_ARCHES = 20 + 4 + 4;
// The poles stand 1.5 m outside the asphalt's edge, on a bridge on the parapet; the
// legs of an arch 0.95 m outside it (0.6 m on a bridge), a little nearer the road.
const POLE_AT = HALF_PAVED + 1.5;
const POLE_DECK = HALF_PAVED + 0.54;
const ARCH_AT = HALF_PAVED + 0.95;
const ARCH_DECK = HALF_PAVED + 0.6;
// The parapet of a viaduct is this high, and the poles stand on it.
const PARAPET = 0.95;
// The verge falls away by this much by the pole (render/roadmesh.js: VERGE).
const VERGE_DROP = 0.22;
const LEVELS = { high: 2, mid: 1, low: 0 };

// --- the shapes ------------------------------------------------------------------------

const STEEL = new THREE.Color(0.06, 0.05, 0.065);
const LAMP = new THREE.Color(1.0, 0.045, 0.02);

// Boxes of a shape, flat shaded: each has a place, a size, an angle about z and
// a colour, and a glow (1 for what shines of its own).
export class Boxes {
  constructor() {
    this.p = [];
    this.n = [];
    this.c = [];
    this.g = [];
  }

  box(cx, cy, cz, sx, sy, sz, rz, col, glow = 0) {
    const cs = Math.cos(rz);
    const sn = Math.sin(rz);
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const at = (x, y, z) => [cx + x * cs - y * sn, cy + x * sn + y * cs, cz + z];
    const dir = (x, y, z) => [x * cs - y * sn, x * sn + y * cs, z];
    const faces = [
      [[1, 0, 0], [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]]],
      [[-1, 0, 0], [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]]],
      [[0, 1, 0], [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]]],
      [[0, -1, 0], [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]]],
      [[0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]],
      [[0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]],
    ];
    for (const [nrm, quad] of faces) {
      const w = dir(...nrm);
      // Two triangles a face, a quad's corners 0 1 2 and 0 2 3.
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const q = at(...quad[k]);
        this.p.push(q[0], q[1], q[2]);
        this.n.push(w[0], w[1], w[2]);
        this.c.push(col.r, col.g, col.b);
        this.g.push(glow);
      }
    }
  }

  done() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.g, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// A pole, a metre and a fifth tall, on y 0: a post, and a housing with a lamp in it.
export function poleGeometry() {
  const b = new Boxes();
  const h = MARKS.height;
  b.box(0, (h - 0.22) / 2, 0, 0.12, h - 0.22, 0.12, 0, STEEL);
  b.box(0, h - 0.17, 0, 0.2, 0.1, 0.2, 0, STEEL);
  b.box(0, h - 0.07, 0, 0.14, 0.14, 0.14, 0, LAMP, 1);
  return b.done();
}

// An arch over the road, across x, on y 0: two legs and a crown that is half an
// ellipse of beams, with a light along the under side of it.
export function archGeometry() {
  const b = new Boxes();
  const span = ARCH_AT;
  const base = MARKS.crown - 1.9;
  const leg = 0.34;
  b.box(-span, (base - 1.6) / 2, 0, leg, base + 1.6, leg, 0, STEEL);
  b.box(span, (base - 1.6) / 2, 0, leg, base + 1.6, leg, 0, STEEL);
  const SEG = 12;
  const pt = (i) => {
    const a = Math.PI - (Math.PI * i) / SEG;
    return [span * Math.cos(a), base + 1.9 * Math.sin(a)];
  };
  for (let i = 0; i < SEG; i++) {
    const [x0, y0] = pt(i);
    const [x1, y1] = pt(i + 1);
    const len = Math.hypot(x1 - x0, y1 - y0);
    const rz = Math.atan2(y1 - y0, x1 - x0);
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    b.box(mx, my, 0, len + 0.04, leg, leg, rz, STEEL);
    // The light along under the beam.
    b.box(mx + Math.sin(rz) * (leg / 2 + 0.02), my - Math.cos(rz) * (leg / 2 + 0.02), 0, len * 0.9, 0.04, 0.05, rz, LAMP, 0.4);
  }
  return b.done();
}

// --- the materials ---------------------------------------------------------------------

function markMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.45 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * 2.0;');
  };
  mat.customProgramCacheKey = () => 'continuum-waymark';
  mat.userData.mark = MARK.built;
  return withSunMask(withAtmosphere(mat), false);
}

const LAMPS_VERTEX = /* glsl */`
${TWIST_PARS}
attribute vec3 aLamp;     // how far along the stretch it is (0 to 1), how big it is (m), how bright
uniform float uTime;
uniform float uPx;
uniform float uMax;
uniform float uFade;
varying vec3 vLight;
void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * twistView( mv );
  float depth = max( - twistDrawn.z, 0.1 );
  float px = clamp( aLamp.y * uPx / depth, 4.0, uMax );
  // A pulse runs along them, toward the far end of the stretch.
  float pulse = 0.64 + 0.36 * sin( aLamp.x * 18.0 - uTime * 4.0 );
  // Lights show through the haze, a little the less for it.
  float air = exp( - depth * 0.00018 );
  vLight = vec3( 1.0, 0.045, 0.02 ) * aLamp.z * pulse * air * uFade * smoothstep( 0.4, 1.6, depth );
  gl_PointSize = px;
}
`;

const LAMPS_FRAGMENT = /* glsl */`
varying vec3 vLight;
void main() {
  float r = length( gl_PointCoord - 0.5 ) * 2.0;
  float a = exp( - r * r * 9.0 ) + 0.28 * exp( - r * 3.2 ) * ( 1.0 - smoothstep( 0.8, 1.0, r ) );
  gl_FragColor = vec4( vLight * a, 1.0 );
}
`;

function lampMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: LAMPS_VERTEX,
    fragmentShader: LAMPS_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// --- the markers -------------------------------------------------------------------------

export class Waymarks {
  // scene; env: road; tier: high, mid or low.
  constructor(scene, env, tier = 'high') {
    this.env = env;
    this.scene = scene;
    this.level = LEVELS[tier] === undefined ? 2 : LEVELS[tier];
    this.material = markMaterial();
    this.poles = this._instanced(poleGeometry(), MAX_POLES);
    this.arches = this._instanced(archGeometry(), MAX_ARCHES);
    this.uniforms = {
      uTime: { value: 0 },
      uPx: { value: 700 },
      uMax: { value: 30 },
      uFade: { value: 1 },
      ...twistU,
    };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((MAX_POLES + MAX_ARCHES) * 3), 3));
    geo.setAttribute('aLamp', new THREE.BufferAttribute(new Float32Array((MAX_POLES + MAX_ARCHES) * 3), 3));
    geo.attributes.position.setUsage(THREE.DynamicDrawUsage);
    geo.attributes.aLamp.setUsage(THREE.DynamicDrawUsage);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    geo.setDrawRange(0, 0);
    this.lampMaterial = lampMaterial(this.uniforms);
    this.lamps = new THREE.Points(geo, this.lampMaterial);
    this.lamps.frustumCulled = false;
    this.lamps.renderOrder = 3;
    this.lamps.visible = false;
    // (The meshes join the scene when the first of the markers is laid, so that a game that
    // never comes to the Upside Down has nothing of theirs: no program, nothing to draw.)
    this.dummy = new THREE.Object3D();
    // What stands now: the stretch it was laid for, the origin it was laid at,
    // and how many of each (those of the stretch itself, and all of them).
    this.zone = null;
    this._ox = NaN;
    this._oz = NaN;
    this._level = -1;
    this.dirty = true;
    this.counts = { poles: 0, arches: 0, onPoles: 0, onArches: 0, lamps: 0 };
    this.shown = false;
    // Some of the road they stand on is not laid yet: they are laid again soon.
    this._missing = false;
    this._retry = 0;
  }

  _instanced(geometry, max) {
    const mesh = new THREE.InstancedMesh(geometry, this.material, max);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.count = 0;
    mesh.visible = false;
    return mesh;
  }

  setTier(tier) {
    if (LEVELS[tier] === undefined) return;
    this.level = LEVELS[tier];
  }

  // The floating origin has moved: the markers are laid again.
  shift() {
    this.dirty = true;
  }

  // Every frame. zone: the wound stretch nearest the car (render/upside.js) or
  // null; sCar: how far along the road the car is; px: pixels to the radian at the lens.
  update(dt, zone, sCar, px) {
    const u = this.uniforms;
    u.uTime.value = (u.uTime.value + dt) % 3600;
    if (px) u.uPx.value = px;
    const s0 = zone ? zone.s - zone.run / 2 : 0;
    const s1 = zone ? zone.s + zone.run / 2 : 0;
    const gap = zone ? Math.max(s0 - sCar, sCar - s1, 0) : Infinity;
    const near = zone && this.level > 0 && gap < MARKS.sees;
    if (!near) {
      if (this.shown) this._hide();
      return;
    }
    const o = this.env.road.origin;
    if (this._missing && (this._retry -= dt) <= 0) this.dirty = true;
    if (zone !== this.zone || this.dirty || o.x !== this._ox || o.z !== this._oz || this.level !== this._level) {
      this.zone = zone;
      this._ox = o.x;
      this._oz = o.z;
      this._level = this.level;
      this.dirty = false;
      this._lay(zone, s0);
    }
    // The lamps come up over the last 500 m of their range, not all at once.
    const k = Math.min(1, Math.max(0, (gap - (MARKS.sees - 500)) / 500));
    u.uFade.value = 1 - k * k * (3 - 2 * k);
    if (!this.shown) {
      this.shown = true;
      this.poles.visible = this.poles.count > 0;
      this.arches.visible = this.arches.count > 0;
      this.lamps.visible = this.counts.lamps > 0;
    }
  }

  _hide() {
    this.shown = false;
    this.poles.visible = false;
    this.arches.visible = false;
    this.lamps.visible = false;
    this.zone = null;
  }

  // Lay the poles, the arches and their lamps along the road from s0, for a
  // stretch of zone.run m of it.
  _lay(zone, s0) {
    if (!this.lamps.parent) this.scene.add(this.poles, this.arches, this.lamps);
    const road = this.env.road;
    const lay = markLayout(zone.run);
    const d = this.dummy;
    const pos = this.lamps.geometry.attributes.position;
    const lamp = this.lamps.geometry.attributes.aLamp;
    let np = 0;
    let na = 0;
    let nl = 0;
    let onPoles = 0;
    let onArches = 0;
    let missing = false;
    const along = (off) => Math.min(1, Math.max(0, off / zone.run));
    const put = (mesh, n, x, y, z, yaw) => {
      d.position.set(x, y, z);
      d.rotation.set(0, yaw, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      mesh.setMatrixAt(n, d.matrix);
    };
    const light = (x, y, z, off, size, bright) => {
      pos.setXYZ(nl, x, y, z);
      lamp.setXYZ(nl, along(off), size, bright);
      nl++;
    };
    // Poles: both sides at each place; at the mid tier every second.
    const step = this.level >= 2 ? 1 : 2;
    const poles = [...lay.poles.map((o) => [o, true]), ...lay.lead.map((o) => [o, false])];
    poles.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < poles.length; i += step) {
      const [off, onStretch] = poles[i];
      const s = s0 + off;
      const p = road.at(s);
      if (!p) missing = true;
      if (!p || p.kind === TUNNEL) continue;
      const deck = p.kind === BRIDGE;
      const lat = deck ? POLE_DECK : POLE_AT;
      for (const side of [-1, 1]) {
        if (np >= MAX_POLES) break;
        const l = lat * side;
        const x = p.x - Math.sin(p.theta) * l;
        const z = p.z + Math.cos(p.theta) * l;
        const y = road.surfaceAt(s, l) + (deck ? PARAPET : -VERGE_DROP);
        put(this.poles, np++, x, y, z, -p.theta - Math.PI / 2);
        light(x, y + MARKS.height - 0.07, z, off, 0.2, 1.0);
        if (onStretch) onPoles++;
      }
    }
    // Arches: over the road, across it, their legs outside the poles.
    for (const [off, onStretch] of [...lay.arches.map((o) => [o, true]), ...lay.leadArches.map((o) => [o, false])]) {
      if (na >= MAX_ARCHES) break;
      const s = s0 + off;
      const p = road.at(s);
      if (!p) missing = true;
      if (!p || p.kind === TUNNEL) continue;
      const deck = p.kind === BRIDGE;
      const lat = deck ? ARCH_DECK : ARCH_AT;
      // Level with the lower of the two legs' feet.
      const y = Math.min(road.surfaceAt(s, lat), road.surfaceAt(s, -lat)) + (deck ? PARAPET : -VERGE_DROP);
      const yaw = -p.theta - Math.PI / 2;
      // (The shape is made with its legs ARCH_AT out; on a deck it is scaled across.)
      d.position.set(p.x, y, p.z);
      d.rotation.set(0, yaw, 0);
      d.scale.set(lat / ARCH_AT, 1, 1);
      d.updateMatrix();
      this.arches.setMatrixAt(na++, d.matrix);
      light(p.x, y + MARKS.crown + 0.3, p.z, off, 0.3, 1.5);
      if (onStretch) onArches++;
    }
    this.poles.count = np;
    this.arches.count = na;
    this.poles.instanceMatrix.needsUpdate = true;
    this.arches.instanceMatrix.needsUpdate = true;
    pos.needsUpdate = true;
    lamp.needsUpdate = true;
    this.lamps.geometry.setDrawRange(0, nl);
    this.counts = { poles: np, arches: na, onPoles, onArches, lamps: nl };
    this._missing = missing;
    this._retry = 1.5;
    if (this.shown) {
      this.poles.visible = np > 0;
      this.arches.visible = na > 0;
      this.lamps.visible = nl > 0;
    }
  }

  // The lamps of the stretch itself, where they are (the scene's coordinates), for
  // a check: [x, y, z, off] of each.
  lampList() {
    const pos = this.lamps.geometry.attributes.position;
    const lamp = this.lamps.geometry.attributes.aLamp;
    const out = [];
    for (let i = 0; i < this.counts.lamps; i++) out.push([pos.getX(i), pos.getY(i), pos.getZ(i), lamp.getX(i)]);
    return out;
  }

  // The meshes it draws with, for building their programs ahead.
  meshes() {
    return [this.poles, this.arches, this.lamps];
  }

  dispose() {
    for (const m of [this.poles, this.arches]) {
      this.scene.remove(m);
      m.geometry.dispose();
      m.dispose();
    }
    this.scene.remove(this.lamps);
    this.lamps.geometry.dispose();
    this.lampMaterial.dispose();
    this.material.dispose();
  }
}
