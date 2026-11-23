// What a spore pod throws when the car comes up to it: a burst of small points
// that glow dark red, thrown out and then carried slowly up (the world's way up,
// world/upsidefx.js) until each has lasted its time.
//
// A burst is written into a ring of slots once, when it happens (where it
// began, how each is thrown, when it was born and how long it lasts); where a
// point is at any moment, how big and how bright, the vertex shader works out
// from that and the clock, so the CPU does nothing while they drift. The
// slots are the oldest burst's to take when the ring is full.
//
// The tier says how many a pod throws: 20 at the high one, 10 at the mid one,
// none at the low one (the pod is left where it stood).

import * as THREE from 'three';
import { SPORES, sporeBurst } from '../world/upsidefx.js';
import { TWIST_PARS, twistU } from './twist.js';

const PER = { high: SPORES.per, mid: SPORES.per / 2, low: 0 };

const VERTEX = /* glsl */`
${TWIST_PARS}
attribute vec4 aP;       // where it began, and when
attribute vec4 aV;       // how it is thrown (m/s), and how long it lasts
attribute vec2 aS;       // how big it is (m), a number of its own
uniform float uClock;
uniform float uPx;
uniform vec3 uLight;
varying vec3 vLight;
void main() {
  float age = uClock - aP.w;
  vLight = vec3( 0.0 );
  if ( age < 0.0 || age >= aV.w ) {
    gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    gl_PointSize = 0.0;
    return;
  }
  float k = ${SPORES.drag.toFixed(2)};
  float slide = ( 1.0 - exp( - k * age ) ) / k;
  float sway = min( age, 3.0 ) / 3.0 * 0.3;
  vec3 p = aP.xyz + aV.xyz * slide;
  p.y += ${SPORES.rise.toFixed(2)} * ( age - slide );
  p.x += sway * sin( age * 1.3 + aS.y * 6.28 );
  p.z += sway * cos( age * 1.1 + aS.y * 12.5 );
  vec4 mv = viewMatrix * vec4( p, 1.0 );
  gl_Position = projectionMatrix * twistView( mv );
  float depth = max( - twistDrawn.z, 0.1 );
  float life = age / aV.w;
  // In at once, a flicker, out over the last of it.
  float a = smoothstep( 0.0, 0.04, life ) * ( 1.0 - smoothstep( 0.55, 1.0, life ) );
  a *= 0.7 + 0.3 * sin( age * ( 5.0 + 6.0 * aS.y ) + aS.y * 40.0 );
  a *= smoothstep( 0.4, 1.5, depth );
  float px = clamp( aS.x * 2.0 * uPx / depth, 2.0, 14.0 );
  vLight = uLight * a;
  gl_PointSize = px;
}
`;

const FRAGMENT = /* glsl */`
varying vec3 vLight;
void main() {
  float r = length( gl_PointCoord - 0.5 ) * 2.0;
  float a = exp( - r * r * 5.0 );
  gl_FragColor = vec4( vLight * a, 1.0 );
}
`;

export class Spores {
  constructor(scene, tier = 'high') {
    this.scene = scene;
    this.per = PER[tier] === undefined ? PER.high : PER[tier];
    const n = SPORES.max;
    this.aP = new Float32Array(n * 4);
    this.aV = new Float32Array(n * 4);
    this.aS = new Float32Array(n * 2);
    // (Slots no burst has taken have a birth far in the future.)
    for (let i = 0; i < n; i++) this.aP[i * 4 + 3] = 1e9;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    for (const [name, arr, size] of [['aP', this.aP, 4], ['aV', this.aV, 4], ['aS', this.aS, 2]]) {
      const attr = new THREE.BufferAttribute(arr, size);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, attr);
    }
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    const c = new THREE.Color(SPORES.color).multiplyScalar(SPORES.glow);
    this.uniforms = {
      uClock: { value: 0 },
      uPx: { value: 700 },
      uLight: { value: new THREE.Vector3(c.r, c.g, c.b) },
      ...twistU,
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.points.visible = false;
    // (It joins the scene at the first burst: see render/motes.js on why.)
    this.clock = 0;
    this.head = 0;
    this.bursts = 0;           // so many have been made
    this.thrown = 0;           // and so many points thrown by them
    this.alive = 0;            // and so many points are out now
    this._last = 0;            // when the last of what is out ends
    this._bursts = [];         // [{ x, y, z, at }] the last few, for a check
  }

  setTier(tier) {
    if (PER[tier] !== undefined) this.per = PER[tier];
  }

  // A pod bursts at a place of the scene: the points it throws. `seed` makes the same
  // burst for the same pod. Returns how many were thrown.
  burst(x, y, z, seed) {
    if (this.per <= 0) return 0;
    const spec = sporeBurst(seed, this.per);
    const n = SPORES.max;
    for (const s of spec) {
      const i = this.head;
      this.head = (this.head + 1) % n;
      this.aP.set([x, y, z, this.clock], i * 4);
      this.aV.set([s.v[0], s.v[1], s.v[2], s.life], i * 4);
      this.aS.set([s.size, s.seed], i * 2);
      this._last = Math.max(this._last, this.clock + s.life);
    }
    this.points.geometry.attributes.aP.needsUpdate = true;
    this.points.geometry.attributes.aV.needsUpdate = true;
    this.points.geometry.attributes.aS.needsUpdate = true;
    this.bursts++;
    this.thrown += spec.length;
    this._bursts.push({ x, y, z, at: this.clock, seed });
    if (this._bursts.length > 16) this._bursts.shift();
    if (!this.points.parent) this.scene.add(this.points);
    this.points.visible = true;
    return spec.length;
  }

  // The floating origin has moved.
  shift(dx, dz) {
    for (let i = 0; i < SPORES.max; i++) {
      this.aP[i * 4] -= dx;
      this.aP[i * 4 + 2] -= dz;
    }
    for (const b of this._bursts) {
      b.x -= dx;
      b.z -= dz;
    }
    this.points.geometry.attributes.aP.needsUpdate = true;
  }

  // Every frame; px: pixels to the radian at the lens.
  update(dt, px) {
    this.clock += dt;
    this.uniforms.uClock.value = this.clock;
    if (px) this.uniforms.uPx.value = px;
    if (this.points.visible && this.clock > this._last) this.points.visible = false;
  }

  // How many are out now (a check counts them).
  count() {
    let n = 0;
    for (let i = 0; i < SPORES.max; i++) {
      const age = this.clock - this.aP[i * 4 + 3];
      if (age >= 0 && age < this.aV[i * 4 + 3]) n++;
    }
    return n;
  }

  dispose() {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
