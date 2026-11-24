// What the city has of its own beside its towers (render/city.js): what stands on the roofs, the
// elevated railway beside the road and its trains (world/cityrail.js), plumes of steam off the
// roofs of some of the tall towers, and low lamps along the paths of the parks. The signs over
// the street floors are drawn by the towers' own shader (render/city.js, SIGN); this sets their
// clock and whether the tier has them.
//
//  - The roofs: water tanks, the boxes of air conditioners, aerials and the machine rooms of
//    lifts (render/city.js works out what stands where as it bakes a tile), drawn within
//    ROOF.reach of the lens, two instanced draws (the boxes and the cylinders; in the block
//    style the cylinders are boxes too). They shrink away over the last tenth of the reach.
//  - The viaduct: a pier at every node of the railway and a span of deck from each to the next,
//    within LIFE.rail of the lens, two instanced draws; the trains, eight carriages each with a
//    row of lit windows down both sides, one more.
//  - The steam: twenty points to a plume, each rising, spreading and thinning over its life,
//    moved in the vertex shader by the clock; one draw.
//  - The lamps of the parks: a halo each (a point a few pixels across at the least, dimmed by
//    the haze, as the road's lamps are), one draw.
//
// Nothing of it is drawn away from the city. The tier: everything at 'high'; at 'mid' the
// roofs within two thirds of the reach, half the plumes and half the lamps; at 'low' none of
// those nor the signs. The viaduct and the trains are drawn at every tier (the towers keep off
// the railway's line whether it is drawn or not).

import * as THREE from 'three';
import { atmo, withAtmosphere } from './atmosphere.js';
import { MARK } from './style.js';
import { Boxes } from './waymarks.js';
import { signU } from './city.js';
import { ROOF } from '../world/cityplan.js';
import { RAIL, TRAIN } from '../world/cityrail.js';

export const LIFE = {
  rail: 2400,            // m from the lens the viaduct is drawn within
  spans: 200,            // spans (and piers) at the most
  steam: { high: 48, mid: 24, low: 0, reach: 1400, points: 20, rise: 30, life: 9 },
  lamps: { high: 640, mid: 320, low: 0, reach: 700, size: 0.7, level: 3.2, color: [1.0, 0.74, 0.44] },
  roofReach: { high: 1, mid: 2 / 3, low: 0 },
  roofs: 1600,           // of each shape, at the most
  relay: 12,             // m the lens moves before the roofs, the plumes and the lamps are laid again
  glow: [1.0, 0.84, 0.6],
};

const CONCRETE = new THREE.Color(0.32, 0.31, 0.3);
const DECK = new THREE.Color(0.24, 0.235, 0.23);
const STEEL = new THREE.Color(0.12, 0.12, 0.13);
const BODY = new THREE.Color(0.42, 0.44, 0.47);
const BAND = new THREE.Color(0.1, 0.11, 0.13);
const WINDOW = new THREE.Color(...LIFE.glow);
// The roofs' things, by shade (0..1): concrete greys, white tanks, dull metal.
const ROOF_SHADES = [[0.52, 0.5, 0.47], [0.66, 0.65, 0.62], [0.36, 0.37, 0.38], [0.45, 0.4, 0.34]].map((c) => new THREE.Color(...c));

// A unit box standing on y = 0, and a unit upright cylinder, as Boxes give them (colour white, no glow).
function unitBox() {
  const b = new Boxes();
  b.box(0, 0.5, 0, 1, 1, 1, 0, new THREE.Color(1, 1, 1));
  return b.done();
}
function unitCylinder(sides = 10) {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, sides, 1, false).toNonIndexed();
  g.translate(0, 0.5, 0);
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  g.setAttribute('aGlow', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  g.deleteAttribute('uv');
  return g;
}

// A pier: a column from the ground (RAIL.deck under the top of the deck, at a scale of 1) to a
// cap across under the deck. The top of the deck is y = 0.
export function pierGeometry() {
  const b = new Boxes();
  const D = RAIL.deck;
  b.box(0, -(D + 1.9) / 2 - 0.5, 0, 2.2, D - 1.9 + 1, 2.2, 0, CONCRETE);
  b.box(0, -1.9 - 0.45, 0, 7.6, 0.9, 2.6, 0, CONCRETE);
  return b.done();
}

// A span of deck, from z = 0 to z = 1 (scaled to the span's length): the slab, a parapet each
// side and the two rails.
export function spanGeometry() {
  const b = new Boxes();
  b.box(0, -0.95, 0.5, 7.2, 1.9, 1.0, 0, DECK);
  b.box(-3.45, 0.45, 0.5, 0.3, 0.9, 1.0, 0, CONCRETE);
  b.box(3.45, 0.45, 0.5, 0.3, 0.9, 1.0, 0, CONCRETE);
  for (const x of [-0.72, 0.72]) b.box(x, 0.08, 0.5, 0.1, 0.16, 1.0, 0, STEEL);
  return b.done();
}

// A carriage, along z, its middle at 0, standing on the rails (y = 0 the top of the deck): a
// body, a dark band down each side and in it a row of lit windows, with a lit end at each end.
export function carriageGeometry() {
  const b = new Boxes();
  const L = TRAIN.car;
  b.box(0, 0.75, 0, 2.6, 0.9, L - 0.6, 0, STEEL);
  b.box(0, 2.45, 0, 3.0, 2.5, L, 0, BODY);
  for (const x of [-1.52, 1.52]) {
    b.box(x, 2.55, 0, 0.04, 1.0, L - 0.8, 0, BAND);
    const n = 11;
    const step = (L - 1.6) / n;
    for (let i = 0; i < n; i++) b.box(x * 1.005, 2.6, -L / 2 + 0.8 + step * (i + 0.5), 0.04, 0.78, step * 0.74, 0, WINDOW, 1);
  }
  for (const z of [-L / 2 - 0.01, L / 2 + 0.01]) b.box(0, 2.6, z, 2.0, 0.8, 0.04, 0, WINDOW, 0.6);
  return b.done();
}

function lifeMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * 2.4;');
  };
  mat.customProgramCacheKey = () => 'continuum-citylife';
  mat.userData.mark = MARK.built;
  return withAtmosphere(mat);
}

const STEAM_VERT = /* glsl */`
attribute vec2 aPuff;     // which of the plume's points (0 to 1) and the plume's own seed
uniform float uTime;
uniform float uHeight;
uniform vec3 fogParams;
varying float vA;
void main() {
  float life = fract( uTime / ${LIFE.steam.life.toFixed(1)} + aPuff.x + aPuff.y * 7.3 );
  float sw = aPuff.y * 6.283 + aPuff.x * 40.0;
  vec3 p = position + vec3( 0.0, life * ${LIFE.steam.rise.toFixed(1)}, 0.0 )
    + vec3( 0.55, 0.0, 0.3 ) * ( life * life * 14.0 ) + vec3( cos( sw ), 0.0, sin( sw ) ) * ( 0.6 + 2.4 * life );
  vec4 mv = modelViewMatrix * vec4( p, 1.0 );
  gl_Position = projectionMatrix * mv;
  float d = max( - mv.z, 1.0 );
  float size = 2.4 + 7.0 * life;
  float px = size * projectionMatrix[ 1 ][ 1 ] * uHeight * 0.5 / d;
  gl_PointSize = clamp( px, 1.0, 96.0 );
  vA = 0.22 * smoothstep( 0.0, 0.08, life ) * pow( 1.0 - life, 1.6 ) * exp( - d * fogParams.x * 1.2 ) * clamp( px / 2.0, 0.0, 1.0 );
}`;

const STEAM_FRAG = /* glsl */`
uniform vec3 uTint;
varying float vA;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = dot( q, q );
  float a = vA * smoothstep( 1.0, 0.15, r );
  gl_FragColor = vec4( uTint * a, a );
}`;

const LAMP_VERT = /* glsl */`
uniform float uHeight;
uniform vec3 fogParams;
uniform vec3 uLamp;       // its size (m), how bright, how far off it is gone
varying float vL;
void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mv;
  float d = max( - mv.z, 1.0 );
  float px = uLamp.x * projectionMatrix[ 1 ][ 1 ] * uHeight * 0.5 / d;
  vL = uLamp.y * clamp( px / 3.0, 0.2, 1.0 ) * exp( - d * fogParams.x * 0.8 ) * ( 1.0 - smoothstep( uLamp.z * 0.85, uLamp.z, d ) );
  gl_PointSize = clamp( px, 3.0, 40.0 );
}`;

const LAMP_FRAG = /* glsl */`
uniform vec3 uTint;
varying float vL;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = length( q );
  float a = exp( - r * r * 7.0 ) + 0.25 * exp( - r * 3.0 ) * ( 1.0 - smoothstep( 0.8, 1.0, r ) );
  gl_FragColor = vec4( uTint * ( vL * a ), 1.0 );
}`;

function points(max, attrs) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage));
  for (const [name, size] of attrs) g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(max * size), size).setUsage(THREE.DynamicDrawUsage));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  g.setDrawRange(0, 0);
  return g;
}

export class CityLife {
  // env: city (render/city.js), rail (world/cityrail.js), road; tier.
  constructor(scene, env, tier = 'high') {
    this.city = env.city;
    this.rail = env.rail;
    this.road = env.road;
    this.tier = tier;
    this.group = new THREE.Group();
    this.group.name = 'citylife';
    this.city.group.add(this.group);
    this.material = lifeMaterial();
    this.geo = { box: unitBox(), cyl: unitCylinder(), pier: pierGeometry(), span: spanGeometry(), car: carriageGeometry() };
    this.boxes = this._instanced(this.geo.box, LIFE.roofs);
    this.cylinders = this._instanced(this.geo.cyl, LIFE.roofs);
    this.piers = this._instanced(this.geo.pier, LIFE.spans + 1);
    this.spans = this._instanced(this.geo.span, LIFE.spans);
    this.cars = this._instanced(this.geo.car, TRAIN.cars * 2);
    this.uniforms = {
      uTime: { value: 0 },
      uHeight: { value: 720 },
      fogParams: atmo.fogParams,
      uTint: { value: new THREE.Vector3(0.62, 0.62, 0.66) },
    };
    const S = LIFE.steam;
    this.steamGeo = points(S.high * S.points, [['aPuff', 2]]);
    this.steam = new THREE.Points(this.steamGeo, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: STEAM_VERT,
      fragmentShader: STEAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    }));
    this.lampU = {
      uHeight: this.uniforms.uHeight,
      fogParams: atmo.fogParams,
      uLamp: { value: new THREE.Vector3(LIFE.lamps.size, LIFE.lamps.level, LIFE.lamps.reach) },
      uTint: { value: new THREE.Vector3(...LIFE.lamps.color) },
    };
    this.lampGeo = points(LIFE.lamps.high, []);
    this.lamps = new THREE.Points(this.lampGeo, new THREE.ShaderMaterial({
      uniforms: this.lampU,
      vertexShader: LAMP_VERT,
      fragmentShader: LAMP_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    for (const p of [this.steam, this.lamps]) {
      p.frustumCulled = false;
      p.visible = false;
      p.renderOrder = 3;
      this.group.add(p);
    }
    this.blocky = false;
    this.counts = { roofs: 0, boxes: 0, cylinders: 0, spans: 0, piers: 0, cars: 0, trains: 0, plumes: 0, lamps: 0, tops: 0, topped: 0 };
    this.trainNear = null;       // the nearest carriage to the lens: { dx, dy, dz, d } (ui/sound.js)
    this.heads = [];             // the fronts of the trains drawn, absolute: [{ n, x, y, z }]
    this._at = { x: NaN, z: NaN, ox: NaN, oz: NaN, rev: -1, tier: '', blocky: null };
    this._railAt = { x: NaN, z: NaN, ox: NaN, oz: NaN, rev: -1 };
    this._d = new THREE.Object3D();
    this._p = {};
    this._q = {};
    this._c = new THREE.Color();
  }

  _instanced(geometry, max) {
    const mesh = new THREE.InstancedMesh(geometry, this.material, max);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.count = 0;
    mesh.visible = false;
    this.group.add(mesh);
    return mesh;
  }

  setTier(t) {
    if (LIFE.roofReach[t] === undefined) return;
    this.tier = t;
  }

  // The block style's cylinders are boxes.
  setBlocky(on) {
    if (on === this.blocky) return;
    this.blocky = on;
    this.cylinders.geometry = on ? this.geo.box : this.geo.cyl;
  }

  setView(height) {
    this.uniforms.uHeight.value = height;
  }

  // camera (local), dt, time (the game's clock, s), sCar, origin (the road's).
  update(camera, dt, time, sCar, origin) {
    this.uniforms.uTime.value = time % 3600;
    signU.uSign.value.set(time % 3600, this.tier === 'low' ? 0 : 1);
    const ax = camera.position.x + origin.x;
    const az = camera.position.z + origin.z;
    const a = this._at;
    if (Math.hypot(ax - a.x, az - a.z) > LIFE.relay || origin.x !== a.ox || origin.z !== a.oz
      || this.city.beaconRev !== a.rev || this.tier !== a.tier || this.blocky !== a.blocky) {
      Object.assign(a, { x: ax, z: az, ox: origin.x, oz: origin.z, rev: this.city.beaconRev, tier: this.tier, blocky: this.blocky });
      this._layRoofs(ax, az, origin);
      this._laySteam(ax, az, origin);
      this._layLamps(ax, az, origin);
    }
    const r = this._railAt;
    if (Math.hypot(ax - r.x, az - r.z) > 40 || origin.x !== r.ox || origin.z !== r.oz || this.rail.rev !== r.rev) {
      Object.assign(r, { x: ax, z: az, ox: origin.x, oz: origin.z, rev: this.rail.rev });
      this._layRail(ax, az, origin);
    }
    this._runTrains(camera, time, sCar, origin);
  }

  _layRoofs(ax, az, origin) {
    const reach = ROOF.reach * LIFE.roofReach[this.tier];
    const d = this._d;
    let nb = 0;
    let nc = 0;
    let tops = 0;
    let topped = 0;
    for (const t of this.city.tiles.values()) {
      if (!t.group.visible || !reach) continue;
      if (Math.abs(t.x0 + 384 - ax) > reach + 560 || Math.abs(t.z0 + 384 - az) > reach + 560) continue;
      for (let i = 0; i < t.tops.length; i += 3) {
        if (Math.hypot(t.tops[i] - ax, t.tops[i + 1] - az) > reach) continue;
        tops++;
        if (t.tops[i + 2] > 0) topped++;
      }
      const g = t.roof;
      for (let i = 0; i < g.length; i += 9) {
        const dist = Math.hypot(g[i] - ax, g[i + 2] - az);
        if (dist > reach) continue;
        const mesh = g[i + 7] ? this.cylinders : this.boxes;
        const n = g[i + 7] ? nc : nb;
        if (n >= LIFE.roofs) continue;
        const k = Math.min(1, (reach - dist) / (reach * 0.1));
        d.position.set(g[i] - origin.x, g[i + 1], g[i + 2] - origin.z);
        d.rotation.set(0, g[i + 6], 0);
        d.scale.set(g[i + 3] * k, g[i + 4] * k, g[i + 5] * k);
        d.updateMatrix();
        mesh.setMatrixAt(n, d.matrix);
        mesh.setColorAt(n, ROOF_SHADES[Math.min(3, Math.floor(g[i + 8] * 4))]);
        if (g[i + 7]) nc++;
        else nb++;
      }
    }
    for (const [mesh, n] of [[this.boxes, nb], [this.cylinders, nc]]) {
      mesh.count = n;
      mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
    Object.assign(this.counts, { roofs: nb + nc, boxes: nb, cylinders: nc, tops, topped });
  }

  _laySteam(ax, az, origin) {
    const S = LIFE.steam;
    const most = S[this.tier] || 0;
    const found = [];
    if (most) {
      for (const t of this.city.tiles.values()) {
        if (!t.group.visible) continue;
        const g = t.steam;
        for (let i = 0; i < g.length; i += 4) {
          const dist = Math.hypot(g[i] - ax, g[i + 2] - az);
          if (dist < S.reach) found.push([dist, g[i], g[i + 1], g[i + 2], g[i + 3]]);
        }
      }
      found.sort((p, q) => p[0] - q[0]);
    }
    const n = Math.min(most, found.length);
    const pos = this.steamGeo.attributes.position;
    const puff = this.steamGeo.attributes.aPuff;
    for (let i = 0; i < n; i++) {
      const [, x, y, z, seed] = found[i];
      for (let j = 0; j < S.points; j++) {
        const at = i * S.points + j;
        pos.setXYZ(at, x - origin.x, y + 0.5, z - origin.z);
        puff.setXY(at, j / S.points, seed);
      }
    }
    pos.needsUpdate = true;
    puff.needsUpdate = true;
    this.steamGeo.setDrawRange(0, n * S.points);
    this.steam.visible = n > 0;
    this.counts.plumes = n;
  }

  _layLamps(ax, az, origin) {
    const L = LIFE.lamps;
    const most = L[this.tier] || 0;
    const found = [];
    if (most) {
      // At the middle tier every second one along a path.
      const every = this.tier === 'high' ? 1 : 2;
      for (const t of this.city.tiles.values()) {
        if (!t.group.visible) continue;
        const g = t.lamps;
        for (let i = 0, m = 0; i < g.length; i += 3, m++) {
          if (m % every) continue;
          const dist = Math.hypot(g[i] - ax, g[i + 2] - az);
          if (dist < L.reach) found.push([dist, g[i], g[i + 1], g[i + 2]]);
        }
      }
      found.sort((p, q) => p[0] - q[0]);
    }
    const n = Math.min(most, found.length);
    const pos = this.lampGeo.attributes.position;
    for (let i = 0; i < n; i++) pos.setXYZ(i, found[i][1] - origin.x, found[i][2], found[i][3] - origin.z);
    pos.needsUpdate = true;
    this.lampGeo.setDrawRange(0, n);
    this.lamps.visible = n > 0;
    this.counts.lamps = n;
  }

  _layRail(ax, az, origin) {
    const rail = this.rail;
    const d = this._d;
    let ns = 0;
    let np = 0;
    const pier = new Set();
    for (let k = rail.k0; k < rail.k1 && ns < LIFE.spans; k++) {
      if (!rail.span(k)) continue;
      const a = rail.nodes.get(k);
      const b = rail.nodes.get(k + 1);
      if (Math.hypot(a.x - ax, a.z - az) > LIFE.rail && Math.hypot(b.x - ax, b.z - az) > LIFE.rail) continue;
      d.position.set(a.x - origin.x, a.y, a.z - origin.z);
      d.scale.set(1, 1, 1);
      d.rotation.set(0, 0, 0);
      d.lookAt(b.x - origin.x, b.y, b.z - origin.z);
      d.scale.set(1, 1, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
      d.updateMatrix();
      this.spans.setMatrixAt(ns++, d.matrix);
      for (const n of [a, b]) {
        if (pier.has(n.k)) continue;
        pier.add(n.k);
        const ground = n.y - RAIL.deck;
        d.position.set(n.x - origin.x, n.y, n.z - origin.z);
        d.rotation.set(0, Math.atan2(b.x - a.x, b.z - a.z), 0);
        d.scale.set(1, (n.y - ground) / RAIL.deck, 1);
        d.updateMatrix();
        if (np <= LIFE.spans) this.piers.setMatrixAt(np++, d.matrix);
      }
    }
    for (const [mesh, n] of [[this.spans, ns], [this.piers, np]]) {
      mesh.count = n;
      mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.counts.spans = ns;
    this.counts.piers = np;
  }

  _runTrains(camera, time, sCar, origin) {
    const rail = this.rail;
    const trains = rail.runTrains(time, sCar);
    const d = this._d;
    const p = this._p;
    const q = this._q;
    const cam = camera.position;
    let n = 0;
    let near = null;
    this.heads.length = 0;
    for (const tr of trains) {
      let drawn = false;
      for (let c = 0; c < TRAIN.cars; c++) {
        // A carriage's front and back on the railway, and it put along the chord between them.
        const f = tr.head + c * (TRAIN.car + TRAIN.gap);
        if (!rail.at(f, p) || !p.ok || !rail.at(f + TRAIN.car, q) || !q.ok) continue;
        if (c === 0) this.heads.push({ n: tr.n, x: p.x, y: p.y, z: p.z });
        const mx = (p.x + q.x) / 2 - origin.x;
        const my = (p.y + q.y) / 2;
        const mz = (p.z + q.z) / 2 - origin.z;
        d.position.set(mx, my, mz);
        d.rotation.set(0, 0, 0);
        d.scale.set(1, 1, 1);
        d.lookAt(q.x - origin.x, q.y, q.z - origin.z);
        d.updateMatrix();
        this.cars.setMatrixAt(n++, d.matrix);
        drawn = true;
        const dd = Math.hypot(mx - cam.x, my - cam.y, mz - cam.z);
        if (!near || dd < near.d) near = { dx: mx - cam.x, dy: my - cam.y, dz: mz - cam.z, d: dd };
      }
      tr.drawn = drawn;
    }
    this.cars.count = n;
    this.cars.visible = n > 0;
    this.cars.instanceMatrix.needsUpdate = true;
    this.counts.cars = n;
    this.counts.trains = trains.filter((t) => t.drawn).length;
    this.trainNear = near;
  }

  // The floating origin has moved: everything is laid again on the next update.
  shift() {
    this._at.x = NaN;
    this._railAt.x = NaN;
  }

  stats() {
    return { ...this.counts, signs: this.tier !== 'low' };
  }

  // The meshes, for the programs to be built ahead of when they are first drawn.
  meshes() {
    return [this.boxes, this.cylinders, this.piers, this.spans, this.cars, this.steam, this.lamps];
  }

  dispose() {
    this.group.removeFromParent();
    for (const m of [this.boxes, this.cylinders, this.piers, this.spans, this.cars]) m.dispose();
    for (const g of Object.values(this.geo)) g.dispose();
    this.steamGeo.dispose();
    this.lampGeo.dispose();
    this.steam.material.dispose();
    this.lamps.material.dispose();
    this.material.dispose();
  }
}
