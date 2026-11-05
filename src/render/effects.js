import * as THREE from 'three';

// Tyre marks and dust. Both are ring buffers with fixed capacity, so the car can
// brake and slide for hours without allocating anything.

const MARK_SEGMENTS = 360;
const MARK_WIDTH = 0.17;
const DUST_COUNT = 260;

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
    return [
      car.x - cy * back - sy * lateral,
      0.09,
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

/** Dust or spray kicked up behind the tyres. */
export class TyreParticles {
  constructor(parent) {
    this.count = DUST_COUNT;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.count * 3);
    this.life = new Float32Array(this.count);
    this.vel = new Float32Array(this.count * 3);
    this.size = new Float32Array(this.count);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(0xb8b0a0) },
        uOpacity: { value: 1.0 },
      },
      vertexShader: `
        attribute float size;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = size * 300.0 / max(-mv.z, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        void main() {
          vec2 d = gl_PointCoord - vec2(0.5);
          if (length(d) > 0.5) discard;
          float a = smoothstep(0.5, 0.04, length(d)) * 0.45 * uOpacity;
          gl_FragColor = vec4(uColor, a);
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
  }

  spawn(x, y, z, vx, vy, vz, size, life) {
    const i = this.cursor;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.size[i] = size;
    this.cursor = (this.cursor + 1) % this.count;
  }

  update(dt, car, slip, surfaceColor) {
    if (surfaceColor != null) this.material.uniforms.uColor.value.setHex(surfaceColor);

    if (slip > 0.12) {
      const n = Math.min(6, Math.ceil(slip * 5));
      const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
      const speed = Math.hypot(car.vx, car.vy);
      for (let k = 0; k < n; k++) {
        const side = k % 2 === 0 ? -0.8 : 0.8;
        const x = car.x - cy * 1.5 - sy * side;
        const z = car.z - sy * 1.5 + cy * side;
        this.spawn(
          x + (this.rand() - 0.5) * 0.4,
          0.12 + this.rand() * 0.1,
          z + (this.rand() - 0.5) * 0.4,
          -cy * speed * 0.16 + (this.rand() - 0.5) * 1.6,
          0.7 + this.rand() * 1.5,
          -sy * speed * 0.16 + (this.rand() - 0.5) * 1.6,
          0.05 + this.rand() * 0.09,
          0.5 + this.rand() * 0.7,
        );
      }
    }

    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      // Air drag, gravity, and expansion as the puff disperses.
      this.vel[i * 3] *= 1 - 2.4 * dt;
      this.vel[i * 3 + 2] *= 1 - 2.4 * dt;
      this.vel[i * 3 + 1] -= 2.2 * dt;
      this.size[i] *= 1 + 1.5 * dt;
      if (this.life[i] <= 0) this.size[i] = 0;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
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
