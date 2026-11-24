// The light of a night in the real style, besides what the scene is lit by: the haze a lamp
// throws down and a car's beam throws ahead, the glare of a car's lamps and the red lights on
// the tops of the towers. Each is made of soft additive shapes drawn in the scene's linear frame,
// before the bloom: the bloom takes up what is bright in them.
//
//  - A shaft is a triangle from where a light starts out along its way, turned about that way
//    to face the lens, bright along the middle and gone at its edges and its far end. One
//    instanced draw for all of a kind.
//  - A halo is a point that keeps a few pixels however far off it is, dimmed by the haze.
//    It may flash (the lights on a tower: one flash in two seconds).
//
// Nothing of this is in the other styles' frames: every share of it goes by how much the
// real style is on and how much the lamps are lit (game.js), and nothing is drawn at 0.

import * as THREE from 'three';
import { atmo } from './atmosphere.js';
import { twistU, TWIST_PARS } from './twist.js';

// What the real style's night reads: how much of it there is (0 in every other style and by
// day), and how far a window is a room (render/city.js): the tier's share of it.
export const nightU = {
  uNightK: { value: 0 },
  uNightRoom: { value: 1 },
};

// The numbers of the lights, by tier where there is a tier.
export const NIGHT = {
  // How many shafts a lamp-lit road has, and how far off the nearest are laid (m), by tier.
  lampShafts: { high: 12, mid: 6, low: 0 },
  lampReach: 230,
  // How many cars' beams and halos, by tier.
  cars: { high: 8, mid: 4, low: 3 },
  carBeams: { high: 8, mid: 3, low: 0 },
  // How far the windows are rooms (render/city.js), by tier: the share of the high tier's reach, none at the low.
  rooms: { high: 1, mid: 0.6, low: 0 },
  // A lamp's shaft: how long it is (from the lamp's head to the road), how wide at the road, how bright (of the lamp's glare).
  lamp: { length: 9, half: 6, k: 0.035 },
  // A car's: how long, how wide at its end, how bright.
  beam: { length: 60, half: 5.5, k: 0.05, down: 0.012 },
  // The lights on a tower (one on each that has a crown, 60 m and over): its size (m), its colour, how bright, its period (s),
  // and how far off they are drawn (m).
  beacon: { size: 2, color: [1.0, 0.035, 0.02], level: 5, period: 2, reach: 2400 },
  // A car's lamps: the head lamps' and tail lamps' size (m), colour and level.
  head: { size: 0.5, color: [1.0, 0.94, 0.80], level: 7 },
  tail: { size: 0.38, color: [1.0, 0.07, 0.04], level: 5 },
  // How bright the wet road throws a car's lamps back (the road's own lamps are 8).
  reflect: { head: 3, tail: 1.2 },
  // How much haze a shaft needs: a clear night's share, and what a density of the air adds to it.
  haze: [0.4, 400, 0.8],
};

// The drawing buffer's height (sizes the halos), the game's clock (the flashes) and the share of
// the air a shaft shows in: shared by the materials.
const viewU = {
  uHeight: { value: 720 },
  uTime: { value: 0 },
  uHaze: { value: 0.5 },
};

const SHAFT_VERT = /* glsl */`
${TWIST_PARS}
attribute vec3 aStart;
attribute vec3 aAxis;
attribute vec2 aSize;
attribute vec4 aTint;
uniform vec3 fogParams;
varying float vAcross;
varying float vAlong;
varying vec4 vC;
varying float vFog;
void main() {
  vec3 mid = aStart + aAxis * ( aSize.x * 0.5 );
  vec3 side = cross( aAxis, cameraPosition - mid );
  float sl = length( side );
  side = sl > 1e-4 ? side / sl : vec3( 1.0, 0.0, 0.0 );
  vec3 p = aStart + aAxis * ( aSize.x * position.y ) + side * ( aSize.y * position.x );
  vec4 mv = viewMatrix * vec4( p, 1.0 );
  gl_Position = projectionMatrix * twistView( mv );
  vAcross = position.x;
  vAlong = position.y;
  vC = aTint;
  vFog = exp( - max( - mv.z, 1.0 ) * fogParams.x * 0.8 );
}`;

const SHAFT_FRAG = /* glsl */`
uniform float uHaze;
varying float vAcross;
varying float vAlong;
varying vec4 vC;
varying float vFog;
void main() {
  float t = max( vAlong, 1e-3 );
  float q = vAcross / t;
  float across = exp( - 3.2 * q * q );
  // A lamp's shaft is brightest at its head and thins to the road; a car's beam thins from its lamps outward.
  float lamp = pow( 1.0 - 0.85 * vAlong, 2.0 ) * ( 1.0 - smoothstep( 0.8, 1.0, vAlong ) );
  float beam = pow( 1.0 - vAlong, 2.0 ) * smoothstep( 0.0, 0.04, vAlong );
  float along = mix( lamp, beam, vC.w );
  gl_FragColor = vec4( vC.rgb * ( across * along * vFog * uHaze ), 1.0 );
}`;

function shaftMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { fogParams: atmo.fogParams, uHaze: viewU.uHaze, ...twistU },
    vertexShader: SHAFT_VERT,
    fragmentShader: SHAFT_FRAG,
  });
}

const HALO_VERT = /* glsl */`
${TWIST_PARS}
attribute vec3 aTint;
attribute float aSize;
attribute vec2 aBlink;
uniform float uHeight;
uniform float uTime;
uniform vec3 fogParams;
varying vec3 vTint;
// One flash in a period: up in a few hundredths of it, down over a fifth.
float flash( float p ) {
  return smoothstep( 0.0, 0.05, p ) * ( 1.0 - smoothstep( 0.08, 0.26, p ) );
}
void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * twistView( mv );
  float d = max( - mv.z, 1.0 );
  float px = aSize * projectionMatrix[ 1 ][ 1 ] * uHeight * 0.5 / d;
  float on = aBlink.x > 0.0 ? flash( fract( uTime / aBlink.x + aBlink.y ) ) : 1.0;
  vTint = aTint * on * clamp( px / 3.0, 0.2, 1.0 ) * exp( - d * fogParams.x * 0.8 );
  gl_PointSize = clamp( px, 3.0, 64.0 );
}`;

const HALO_FRAG = /* glsl */`
varying vec3 vTint;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot( q, q );
  if ( r2 > 1.0 ) discard;
  gl_FragColor = vec4( vTint * exp( - r2 * 5.0 ), 1.0 );
}`;

function haloMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uHeight: viewU.uHeight, uTime: viewU.uTime, fogParams: atmo.fogParams, ...twistU },
    vertexShader: HALO_VERT,
    fragmentShader: HALO_FRAG,
  });
}

// A set of shafts, up to `max`: laid out again each frame (clear, add, flush).
export class Shafts {
  constructor(parent, max) {
    this.parent = parent;
    this.max = max;
    const geo = new THREE.InstancedBufferGeometry();
    // (across, along): the triangle's point and its two far corners.
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -1, 1, 0, 1, 1, 0], 3));
    const make = (n) => new THREE.InstancedBufferAttribute(new Float32Array(max * n), n).setUsage(THREE.DynamicDrawUsage);
    this.start = make(3);
    this.axis = make(3);
    this.size = make(2);
    this.tint = make(4);
    geo.setAttribute('aStart', this.start);
    geo.setAttribute('aAxis', this.axis);
    geo.setAttribute('aSize', this.size);
    geo.setAttribute('aTint', this.tint);
    geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(geo, shaftMaterial());
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    parent.add(this.mesh);
    this.count = 0;
  }

  clear() {
    this.count = 0;
  }

  // A shaft from (x, y, z) along the unit vector (ax, ay, az), `length` m, `half` m across at its end,
  // the colour (r, g, b), the way it thins (0 a lamp's, 1 a car's).
  add(x, y, z, ax, ay, az, length, half, r, g, b, way) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.start.setXYZ(i, x, y, z);
    this.axis.setXYZ(i, ax, ay, az);
    this.size.setXY(i, length, half);
    this.tint.setXYZW(i, r, g, b, way);
  }

  flush() {
    const n = this.count;
    this.mesh.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) for (const a of [this.start, this.axis, this.size, this.tint]) a.needsUpdate = true;
  }

  dispose() {
    this.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// A set of halos, up to `max`.
export class Halos {
  constructor(parent, max) {
    this.parent = parent;
    this.max = max;
    const geo = new THREE.BufferGeometry();
    const make = (n) => new THREE.BufferAttribute(new Float32Array(max * n), n).setUsage(THREE.DynamicDrawUsage);
    this.pos = make(3);
    this.tint = make(3);
    this.size = make(1);
    this.blink = make(2);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('aTint', this.tint);
    geo.setAttribute('aSize', this.size);
    geo.setAttribute('aBlink', this.blink);
    geo.setDrawRange(0, 0);
    this.mesh = new THREE.Points(geo, haloMaterial());
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    parent.add(this.mesh);
    this.count = 0;
  }

  clear() {
    this.count = 0;
  }

  // A halo at (x, y, z), the colour (r, g, b) as bright as it is at its middle, `size` m across
  // as a disc; flashing once in `period` s, `phase` of the way into it (period 0: lit).
  add(x, y, z, r, g, b, size, period = 0, phase = 0) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos.setXYZ(i, x, y, z);
    this.tint.setXYZ(i, r, g, b);
    this.size.setX(i, size);
    this.blink.setXY(i, period, phase);
  }

  flush() {
    const n = this.count;
    this.mesh.geometry.setDrawRange(0, n);
    this.mesh.visible = n > 0;
    if (n > 0) for (const a of [this.pos, this.tint, this.size, this.blink]) a.needsUpdate = true;
  }

  dispose() {
    this.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// What the lens sees of the air in the lights: how much a shaft shows, from how thick the haze is
// round the lens (a clear night has some; fog has more).
function hazeOf(density) {
  const [lo, k, hi] = NIGHT.haze;
  return Math.min(hi, lo + density * k);
}

// The world's lights: the haze under the lamps of the road, and the lights on the towers. share:
// how much of it there is (the real style's, by how much the lamps are lit; 0 draws nothing).
export class NightLight {
  // opts: road (the road's mesh, which knows its lamps), city (which knows its towers), tier.
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.road = opts.road;
    this.city = opts.city;
    this.tier = opts.tier || 'high';
    this.shafts = new Shafts(scene, 16);
    this.halos = new Halos(scene, 384);
    this.share = 0;
    this._rev = -1;
    this._org = [NaN, NaN];
    this._at = [NaN, NaN];
    this._all = [];
    this._beacons = [];
    this._pick = [];
    this._dist = [];
    this.stat = { lamps: 0, beacons: 0 };
    this.setTier(this.tier);
  }

  setTier(t) {
    this.tier = t;
    nightU.uNightRoom.value = NIGHT.rooms[t] === undefined ? 1 : NIGHT.rooms[t];
  }

  // The height of the drawing buffer, in pixels (it sizes the halos), and the game's clock.
  setView(px) {
    viewU.uHeight.value = px;
  }

  update(camera, st) {
    const k = st.share;
    this.share = k;
    viewU.uTime.value = st.time;
    viewU.uHaze.value = hazeOf(atmo.fogParams.value.x);
    this.shafts.clear();
    if (k <= 0.002) {
      this.shafts.flush();
      this.halos.clear();
      this.halos.flush();
      this.stat.lamps = this.stat.beacons = 0;
      this._rev = -1;
      return;
    }
    this._lamps(camera, k);
    this._towers(camera, st.origin, k);
  }

  // A shaft from the head of each of the lamps nearest the lens.
  _lamps(camera, k) {
    const want = NIGHT.lampShafts[this.tier] || 0;
    const heads = this.road ? this.road.lampHeads() : [];
    const p = camera.position;
    const pick = this._pick;
    const dist = this._dist;
    pick.length = 0;
    dist.length = 0;
    const reach2 = NIGHT.lampReach * NIGHT.lampReach;
    for (let i = 0; i < heads.length && want > 0; i++) {
      const h = heads[i];
      const d2 = (h.x - p.x) ** 2 + (h.y - p.y) ** 2 + (h.z - p.z) ** 2;
      if (d2 > reach2) continue;
      // Kept in order of nearness, as many as are wanted.
      let j = pick.length;
      if (j >= want && d2 >= dist[j - 1]) continue;
      if (j < want) {
        pick.push(i);
        dist.push(d2);
      } else {
        j = want - 1;
      }
      while (j > 0 && dist[j - 1] > d2) {
        pick[j] = pick[j - 1];
        dist[j] = dist[j - 1];
        j--;
      }
      pick[j] = i;
      dist[j] = d2;
    }
    const L = NIGHT.lamp;
    for (let n = 0; n < pick.length; n++) {
      const h = heads[pick[n]];
      const fade = 1 - THREE.MathUtils.smoothstep(Math.sqrt(dist[n]), NIGHT.lampReach * 0.6, NIGHT.lampReach);
      const s = L.k * k * fade;
      this.shafts.add(h.x, h.y, h.z, 0, -1, 0, L.length, L.half, h.c[0] * s, h.c[1] * s, h.c[2] * s, 0);
    }
    this.shafts.flush();
    this.stat.lamps = pick.length;
  }

  // The red lights on the towers nearest the lens: the nearest HALOS of those within the reach of them, picked again
  // when the towers drawn or the origin change and when the lens has gone 30 m, each flashing in its own time, lit by the share.
  _towers(camera, origin, k) {
    const city = this.city;
    if (!city) return;
    const B = NIGHT.beacon;
    const p = camera.position;
    const rev = city.beaconRev;
    const moved = (p.x + origin.x - this._at[0]) ** 2 + (p.z + origin.z - this._at[1]) ** 2;
    if (rev !== this._rev || origin.x !== this._org[0] || origin.z !== this._org[1] || moved > 900) {
      if (rev !== this._rev) this._all = city.beacons(this._all);
      this._rev = rev;
      this._org = [origin.x, origin.z];
      this._at = [p.x + origin.x, p.z + origin.z];
      const all = this._all;
      const cx = p.x + origin.x;
      const cz = p.z + origin.z;
      const near = [];
      for (let i = 0; i < all.length; i += 3) {
        const d2 = (all[i] - cx) ** 2 + (all[i + 2] - cz) ** 2;
        if (d2 < B.reach * B.reach) near.push([d2, i]);
      }
      near.sort((a, b) => a[0] - b[0]);
      if (near.length > this.halos.max) near.length = this.halos.max;
      const out = this._beacons;
      out.length = 0;
      // (Each tower flashes in its own time: a phase from where it stands.)
      for (const [, i] of near) {
        out.push(all[i], all[i + 1], all[i + 2], ((Math.sin(all[i] * 12.9898 + all[i + 2] * 78.233) * 43758.5453) % 1 + 1) % 1);
      }
      this.stat.beacons = out.length / 4;
    }
    const h = this.halos;
    h.clear();
    const list = this._beacons;
    const lit = B.level * k;
    for (let i = 0; i < list.length; i += 4) {
      h.add(list[i] - origin.x, list[i + 1], list[i + 2] - origin.z, B.color[0] * lit, B.color[1] * lit, B.color[2] * lit, B.size, B.period, list[i + 3]);
    }
    h.flush();
  }

  dispose() {
    this.shafts.dispose();
    this.halos.dispose();
  }
}

// A car's lamps and what they throw: halos at the lamps, a beam out of the head lamps. They are
// the traffic's (the traffic hides them with its cars, render/traffic.js).
export class CarLights {
  constructor(parent, tier = 'high') {
    this.tier = tier;
    this.halos = new Halos(parent, 64);
    this.shafts = new Shafts(parent, 16);
    this._near = new Map();
    this._keep = new Set();
    this._beams = new Set();
    this._shown = new Set();
    this._first = new Map();
    // The lamps of the nearest cars that a wet road throws back, as the road takes them (render/roadmesh.js).
    this.reflections = [];
    this.stat = { cars: 0, beams: 0 };
  }

  setTier(t) {
    this.tier = t;
  }

  // lamps: the traffic's lamps now (x, y, z, the way they point, whether they are head lamps, the car's
  // number), count of them, camera: the lens, share: how much of it there is.
  update(lamps, count, camera, share) {
    const halos = this.halos;
    const shafts = this.shafts;
    halos.clear();
    shafts.clear();
    this.reflections.length = 0;
    if (share <= 0.002 || count === 0) {
      halos.flush();
      shafts.flush();
      this.stat.cars = this.stat.beams = 0;
      return;
    }
    const p = camera.position;
    // How near each car is, by its nearest lamp.
    const near = this._near;
    near.clear();
    for (let i = 0; i < count; i++) {
      const l = lamps[i];
      const d2 = (l.x - p.x) ** 2 + (l.y - p.y) ** 2 + (l.z - p.z) ** 2;
      const was = near.get(l.car);
      if (was === undefined || d2 < was) near.set(l.car, d2);
    }
    // The nearest cars, as many as the tier has, and of them the nearest that have a beam.
    const order = [...near.entries()].sort((a, b) => a[1] - b[1]);
    const keep = this._keep;
    const beams = this._beams;
    keep.clear();
    beams.clear();
    order.forEach(([car], n) => {
      if (n < (NIGHT.cars[this.tier] || 0)) keep.add(car);
      if (n < (NIGHT.carBeams[this.tier] || 0)) beams.add(car);
    });
    const H = NIGHT.head;
    const T = NIGHT.tail;
    const B = NIGHT.beam;
    const shown = this._shown;
    shown.clear();
    const first = this._first;
    first.clear();
    for (let i = 0; i < count; i++) {
      const l = lamps[i];
      if (keep.has(l.car) && !first.has(l.car)) first.set(l.car, l);
      if (!keep.has(l.car)) continue;
      const d = Math.sqrt((l.x - p.x) ** 2 + (l.y - p.y) ** 2 + (l.z - p.z) ** 2);
      if (d > 700) continue;
      const fade = share * (1 - THREE.MathUtils.smoothstep(d, 450, 700));
      if (l.head) {
        const s = H.level * fade;
        halos.add(l.x, l.y, l.z, H.color[0] * s, H.color[1] * s, H.color[2] * s, H.size);
        // One beam to a car, from the middle of its two lamps.
        if (beams.has(l.car) && !shown.has(l.car)) {
          shown.add(l.car);
          const k = B.k * fade;
          shafts.add(l.mx, l.my, l.mz, l.fx, l.fy - B.down, l.fz, B.length, B.half, H.color[0] * k, H.color[1] * k, H.color[2] * k, 1);
        }
      } else {
        const s = T.level * fade;
        halos.add(l.x, l.y, l.z, T.color[0] * s, T.color[1] * s, T.color[2] * s, T.size);
      }
    }
    halos.flush();
    shafts.flush();
    // What the road throws back, of the nearest cars: their head lamps when they face the lens and their tail lamps when
    // they do not, one to a car.
    for (const [car] of order) {
      const l = first.get(car);
      if (!l || this.reflections.length >= 4) continue;
      const toLens = (p.x - l.mx) * l.fx + (p.y - l.my) * l.fy + (p.z - l.mz) * l.fz;
      if (l.hasHead && (toLens > 0 || !l.hasTail)) {
        this.reflections.push({ x: l.mx, y: l.my, z: l.mz, i: NIGHT.reflect.head * share, c: H.color });
      } else if (l.hasTail) {
        this.reflections.push({ x: l.tx, y: l.ty, z: l.tz, i: NIGHT.reflect.tail * share, c: T.color });
      }
    }
    this.stat.cars = keep.size;
    this.stat.beams = shown.size;
  }

  dispose() {
    this.halos.dispose();
    this.shafts.dispose();
  }
}
