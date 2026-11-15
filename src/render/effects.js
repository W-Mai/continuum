import * as THREE from 'three';
import { twistU, TWIST_PARS } from './twist.js';

// Tyre marks and dust. Both are ring buffers with fixed capacity, so the car can
// brake and slide for hours without allocating anything.

const MARK_SEGMENTS = 360;
const MARK_WIDTH = 0.17;

/**
 * Skid marks as a rolling strip of quads laid on the road.
 *
 * Each frame the two rear contact patches either extend the current strip or
 * drop it when the car stops sliding. Old quads are overwritten in place, so the
 * buffer never grows.
 */
export class SkidMarks {
  constructor(parent) {
    this.max = MARK_SEGMENTS;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.max * 4 * 3);
    const idx = new Uint32Array(this.max * 6);
    for (let i = 0; i < this.max; i++) {
      const v = i * 4;
      idx.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6);
    }
    const col = new Float32Array(this.max * 4 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.geo = geo;
    this.col = col;
    // Normal blending with vertex colours, so a mark darkens whatever it lies on
    // rather than glowing over it.
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    parent.add(this.mesh);

    this.cursor = 0;
    this.live = 0;
    this.prev = [null, null];
    this.fresh = 0;
  }

  _contact(car, lateral) {
    const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
    // Body frame: forward +X, left +Y; the rear axle sits behind the centre.
    const back = 1.5;
    // Ride the road, not y=0: the world is graded, and a fixed height left the
    // marks hanging over a valley or buried under a hill.
    return [
      car.x - cy * back - sy * lateral,
      (car.y || 0) + 0.012,
      car.z - sy * back + cy * lateral,
    ];
  }

  /**
   * @param car  physics state
   * @param slip 0..1 how hard the tyres are sliding
   */
  update(car, slip) {
    const strength = Math.max(0, Math.min(1, slip));
    this.fresh = strength;

    if (strength < 0.08) {
      this.prev[0] = this.prev[1] = null;
      return;
    }

    const sides = [-0.78, 0.78];
    for (let s = 0; s < 2; s++) {
      const p = this._contact(car, sides[s]);
      const prev = this.prev[s];
      if (!prev) {
        this.prev[s] = p;
        continue;
      }

      const dx = p[0] - prev[0];
      const dz = p[2] - prev[2];
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      // A long jump means the car was repositioned, not driven.
      if (len > 4) {
        this.prev[s] = p;
        continue;
      }

      const nx = (-dz / len) * MARK_WIDTH * 0.5;
      const nz = (dx / len) * MARK_WIDTH * 0.5;

      const i = this.cursor;
      const base = i * 4 * 3;
      this.pos[base + 0] = prev[0] - nx; this.pos[base + 1] = prev[1]; this.pos[base + 2] = prev[2] - nz;
      this.pos[base + 3] = prev[0] + nx; this.pos[base + 4] = prev[1]; this.pos[base + 5] = prev[2] + nz;
      this.pos[base + 6] = p[0] - nx; this.pos[base + 7] = p[1]; this.pos[base + 8] = p[2] - nz;
      this.pos[base + 9] = p[0] + nx; this.pos[base + 10] = p[1]; this.pos[base + 11] = p[2] + nz;

      // Harder slides lay darker rubber.
      const shade = 0.02 + (1 - strength) * 0.05;
      const cb = i * 4 * 3;
      for (let v = 0; v < 4; v++) {
        this.col[cb + v * 3] = shade;
        this.col[cb + v * 3 + 1] = shade;
        this.col[cb + v * 3 + 2] = shade * 1.06;
      }

      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;

      this.cursor = (this.cursor + 1) % this.max;
      this.live = Math.min(this.live + 1, this.max);
      this.prev[s] = p;
    }
  }

  clear() {
    this.pos.fill(0);
    this.geo.attributes.position.needsUpdate = true;
    this.cursor = 0;
    this.live = 0;
    this.prev[0] = this.prev[1] = null;
  }
}

// What each world's ground gives up under a car: the colour of it, how much
// the road itself gives (dust blown across it, grit, spray) and how much the
// land does when the car goes off it, and how much of that is hot (embers, ion
// sparkle): [colour, road, land, glow]. Across a border the two blend.
export const KICK = {
  alpine: [0xdfe6ec, 0.05, 0.9, 0],
  hills: [0x8a7556, 0.0, 0.8, 0],
  river: [0x7a6d58, 0.0, 0.8, 0],
  coast: [0xdccaa2, 0.1, 1.0, 0],
  desert: [0xd2ac78, 0.3, 1.2, 0],
  city: [0x8d8d90, 0.03, 0.6, 0],
  cavern: [0x6b5f52, 0.12, 0.7, 0],
  inferno: [0x4a3a32, 0.2, 0.9, 0.5],
  abyss: [0x6b7a74, 0.3, 0.9, 0],
  heaven: [0xffffff, 0.25, 0.8, 0],
  space: [0xcfe2ff, 0.12, 0.0, 0.8],
  upside: [0x5a5f68, 0.18, 0.9, 0.3],
};

/**
 * Dust, sand, snow, silt, spray, ash and sparks, kicked up by what the car is
 * doing and what it is on.
 *
 * Under the tyres when they slide, and, off the road or on a road the wind
 * has covered, behind them all the time: the faster, the more. Afloat, the
 * four pads blow the ground out from under the car in puffs. A landing throws
 * a ring of it. In the worlds with something hot in the ground the particles
 * are in part sparks that glow and burn out. One buffer of points, each with
 * its own colour, drawn with premultiplied alpha so a particle is a puff or a
 * spark by its own numbers.
 */
export class TyreParticles {
  constructor(parent) {
    this.count = 640;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.count * 3);
    this.life = new Float32Array(this.count);
    this.vel = new Float32Array(this.count * 3);
    this.size = new Float32Array(this.count);
    this.grow = new Float32Array(this.count);
    this.col = new Float32Array(this.count * 4);      // colour, and how opaque
    this.glow = new Float32Array(this.count);         // 0 a puff, 1 a spark
    this.age = new Float32Array(this.count);
    this.span = new Float32Array(this.count).fill(1);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(this.glow, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: { ...twistU },
      vertexShader: `
        ${TWIST_PARS}
        attribute float size;
        attribute vec4 aCol;
        attribute float aGlow;
        varying vec4 vCol;
        varying float vGlow;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * twistView(mv);
          gl_PointSize = size * 300.0 / max(-mv.z, 1.0);
          vCol = aCol;
          vGlow = aGlow;
        }
      `,
      fragmentShader: `
        varying vec4 vCol;
        varying float vGlow;
        void main() {
          vec2 d = gl_PointCoord - vec2(0.5);
          float r = length(d);
          if (r > 0.5) discard;
          // A puff is soft at the edge; a spark is a hot point.
          float soft = smoothstep(0.5, 0.0, r);
          soft *= soft;
          float a = soft * vCol.a * 0.55;
          vec3 puff = vCol.rgb * a;
          vec3 spark = vCol.rgb * smoothstep(0.5, 0.04, r) * vCol.a * 2.2;
          // Premultiplied: a spark adds light and covers nothing.
          gl_FragColor = vec4(mix(puff, spark, vGlow), a * (1.0 - vGlow));
        }
      `,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    parent.add(this.points);

    this.geo = geo;
    this.cursor = 0;
    this.rand = mulberry32(0x3f9a);
    this.material = mat;
    this._c = new THREE.Color();
    this.shown = 0;
  }

  spawn(x, y, z, vx, vy, vz, size, life, grow, r, g, b, a, glow = 0) {
    const i = this.cursor;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.span[i] = life;
    this.size[i] = size;
    this.grow[i] = grow;
    this.col[i * 4] = r;
    this.col[i * 4 + 1] = g;
    this.col[i * 4 + 2] = b;
    this.col[i * 4 + 3] = a;
    this.glow[i] = glow;
    this.cursor = (this.cursor + 1) % this.count;
  }

  // One puff or spark kicked up at (x, y, z): its colour from the surface, a
  // little different each time; sparks (glow) where the surface has some.
  _kick(x, y, z, vx, vy, vz, surface, strength, big = 1) {
    const rand = this.rand;
    const spark = surface.glow > 0 && rand() < surface.glow * 0.45;
    if (spark) {
      this.spawn(x, y, z, vx * 0.8 + (rand() - 0.5) * 2.5, vy + 1.5 + rand() * 3, vz * 0.8 + (rand() - 0.5) * 2.5,
        0.05 + rand() * 0.05, 0.4 + rand() * 0.6, 0.0, 1.0, 0.45 + rand() * 0.2, 0.15, 1.0, 1);
      return;
    }
    const v = 0.85 + rand() * 0.3;
    const c = this._c.setHex(surface.color, THREE.SRGBColorSpace);
    this.spawn(x, y, z, vx, vy, vz, (0.26 + rand() * 0.34) * big, 0.8 + rand() * 1.2 * strength, 1.1 + rand() * 0.8,
      c.r * v, c.g * v, c.b * v, Math.min(1, 0.4 + 0.5 * strength));
  }

  // A landing: a ring of what the ground is thrown out from under the car.
  burst(car, force, surface) {
    if (!(surface.amount > 0.02) && !(surface.road > 0.02)) return;
    const n = Math.min(70, Math.round(14 + force * 5));
    const rand = this.rand;
    const k = Math.min(1, force / 12);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const sp = 1.5 + rand() * (2.5 + force * 0.35);
      this._kick(car.x + Math.cos(a) * 1.2, (car.y || 0) + 0.12, car.z + Math.sin(a) * 1.0,
        Math.cos(a) * sp, 0.6 + rand() * 1.8 * k, Math.sin(a) * sp, surface, 0.6 + k, 1.5);
    }
  }

  // surface: { color, amount (how much the ground under the car gives), glow };
  // hover: how far the pads are down, 0..1 (presentation.liftAmount).
  update(dt, car, slip, surface, hover = 0) {
    const s = typeof surface === 'number' ? { color: surface, amount: 0, glow: 0 } : surface;
    const rand = this.rand;
    const cy = Math.cos(car.yaw);
    const sy = Math.sin(car.yaw);
    const speed = Math.hypot(car.vx, car.vy);
    const grounded = !car.airborne;

    // Sliding: the tyres' own smoke and what they throw.
    if (slip > 0.12 && grounded) {
      const n = Math.min(6, Math.ceil(slip * 5));
      for (let k = 0; k < n; k++) {
        const side = k % 2 === 0 ? -0.8 : 0.8;
        const x = car.x - cy * 1.5 - sy * side;
        const z = car.z - sy * 1.5 + cy * side;
        this._kick(
          x + (rand() - 0.5) * 0.4, (car.y || 0) + 0.10 + rand() * 0.1, z + (rand() - 0.5) * 0.4,
          -cy * speed * 0.16 + (rand() - 0.5) * 1.6, 0.7 + rand() * 1.5, -sy * speed * 0.16 + (rand() - 0.5) * 1.6,
          s.amount > 0.05 ? s : { color: 0xb8b0a0, glow: 0 }, 0.8,
        );
      }
    }

    // Driving on what gives: a plume behind, more the faster and the softer.
    if (grounded && s.amount > 0.02 && speed > 3) {
      this._plume = (this._plume || 0) + dt * s.amount * Math.min(1, speed / 25) * 70;
      while (this._plume >= 1) {
        this._plume -= 1;
        const side = rand() < 0.5 ? -0.8 : 0.8;
        const x = car.x - cy * 1.4 - sy * side;
        const z = car.z - sy * 1.4 + cy * side;
        this._kick(x, (car.y || 0) + 0.08, z,
          -cy * speed * 0.2 + (rand() - 0.5) * 1.8, 0.5 + rand() * 1.4, -sy * speed * 0.2 + (rand() - 0.5) * 1.8,
          s, 0.5 + Math.min(1, speed / 30) * 0.7);
      }
    }

    // Afloat, the pads blow the ground out from under the car: low puffs that
    // roll out sideways, where the ground gives at all.
    if (grounded && hover > 0.5 && speed > 4 && s.amount > 0.02) {
      this._pads = (this._pads || 0) + dt * s.amount * 26;
      while (this._pads >= 1) {
        this._pads -= 1;
        const fx = rand() < 0.5 ? 1.35 : -1.35;
        const fz = rand() < 0.5 ? 0.71 : -0.71;
        const x = car.x + cy * fx - sy * fz;
        const z = car.z + sy * fx + cy * fz;
        const out = Math.atan2(fz * cy + fx * sy, fx * cy - fz * sy);
        this._kick(x, (car.y || 0) + 0.06, z, Math.cos(out) * 1.6 - cy * speed * 0.05, 0.25 + rand() * 0.4, Math.sin(out) * 1.6 - sy * speed * 0.05, s, 0.4, 0.8);
      }
    }

    let live = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        continue;
      }
      live++;
      this.life[i] -= dt;
      const gl = this.glow[i];
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      // Air drag, gravity, and expansion as the puff disperses; a spark falls
      // and cools.
      const drag = gl > 0.5 ? 0.6 : 2.4;
      this.vel[i * 3] *= 1 - drag * dt;
      this.vel[i * 3 + 2] *= 1 - drag * dt;
      this.vel[i * 3 + 1] -= (gl > 0.5 ? 6 : 2.2) * dt;
      if (gl < 0.5) this.size[i] *= 1 + this.grow[i] * dt;
      const left = Math.max(0, this.life[i] / this.span[i]);
      // Fades out over the last of its life.
      this.col[i * 4 + 3] = Math.min(this.col[i * 4 + 3], 0.15 + left * 1.4) * (gl > 0.5 ? 1 : 1);
      if (this.life[i] <= 0) this.size[i] = 0;
    }
    this.shown = live;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.aCol.needsUpdate = true;
    this.geo.attributes.aGlow.needsUpdate = true;
  }
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
