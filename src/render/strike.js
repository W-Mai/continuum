// A flash that comes down to the ground: a bolt from the cloud to a place on the
// land ahead of the car, and a scorch left there that cools and goes in 20 s.
//
// The sky draws the lightning that stays in the cloud and goes down to the
// horizon (render/atmosphere.js: it has no distance). This one has a place in the
// world, so it is drawn in the world, as a ribbon laid along a line that wanders
// the way the sky's does (world/upsidefx.js), one end on the ground at the place
// and the other as high over it as the cloud looks from the lens, with the same
// white core and red halo and the same branch; it goes through the winding as
// everything does, hides behind a hill that is in front of it, and is where the
// scorch is. The scorch is a ragged disc laid over the ground there, black with a
// heat in its middle that is gone in a few seconds, thinner and thinner to nothing.
//
// All of it lives in two meshes made once and written into for each flash. The
// tier says how much: the high one draws the bolt with its branch, the mid one
// the bolt alone, the low one nothing (the flash is the sky's).

import * as THREE from 'three';
import { STRIKE, boltPath, forkPath } from '../world/upsidefx.js';
import { TWIST_PARS, twistU } from './twist.js';

const LEVELS = { high: 2, mid: 1, low: 0 };
const N = STRIKE.nodes;
// The branch: as many nodes as it reaches.
const FORK_N = Math.round(STRIKE.forkReach * (N - 1)) + 1;
const RINGS = [0.35, 0.7, 1];
const SEGS = 16;
// How wide the ribbon is over the bolt's core: the halo is in the rest of it.
const HALO = 9;

const BOLT_VERTEX = /* glsl */`
${TWIST_PARS}
attribute vec4 aN;      // which side of the line (-1 or 1), how far down it, how wide the core is, how bright
attribute vec3 aD;      // the way the line runs
varying vec2 vUv;
varying float vK;
void main() {
  vec4 mv = viewMatrix * vec4( position, 1.0 );
  vec3 tv = mat3( viewMatrix ) * aD;
  // Across the line, in the plane of the screen.
  vec3 side = cross( tv, vec3( 0.0, 0.0, -1.0 ) );
  side = side / max( length( side ), 1e-4 );
  mv.xyz += side * aN.x * aN.z * ${(HALO / 2).toFixed(2)};
  gl_Position = projectionMatrix * twistView( mv );
  vUv = vec2( aN.x, aN.y );
  vK = aN.w;
}
`;

const BOLT_FRAGMENT = /* glsl */`
uniform float uFlash;
varying vec2 vUv;
varying float vK;
void main() {
  float u = vUv.x;
  float core = exp( - u * u * ${(HALO * HALO * 0.25).toFixed(1)} );
  float halo = exp( - abs( u ) * 5.0 ) * 0.3;
  vec3 col = mix( vec3( 1.0, 0.55, 0.45 ), vec3( 1.0, 0.92, 0.9 ), core ) * ( core + halo );
  gl_FragColor = vec4( col * 6.0 * uFlash * vK * smoothstep( 0.0, 0.03, vUv.y ), 1.0 );
}
`;

const SCORCH_VERTEX = /* glsl */`
${TWIST_PARS}
attribute float aR;
varying float vR;
void main() {
  vR = aR;
  gl_Position = projectionMatrix * twistView( viewMatrix * vec4( position, 1.0 ) );
}
`;

const SCORCH_FRAGMENT = /* glsl */`
uniform float uHeat;
uniform float uSoot;
varying float vR;
void main() {
  float soot = ( 1.0 - smoothstep( 0.5, 1.0, vR ) ) * uSoot;
  float heat = exp( - vR * 3.2 ) * uHeat;
  vec3 col = vec3( 0.014, 0.011, 0.013 ) + vec3( 1.0, 0.27, 0.07 ) * heat * 2.4;
  gl_FragColor = vec4( col, clamp( soot + heat * 0.6, 0.0, 1.0 ) );
}
`;

export class Strike {
  // env: groundAt(x, z), for the scorch to lie on the land.
  constructor(scene, env, tier = 'high') {
    this.env = env;
    this.scene = scene;
    this.level = LEVELS[tier] === undefined ? 2 : LEVELS[tier];
    // The bolt: a ribbon along the line, and one along the branch.
    const nv = (N + FORK_N) * 2;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(nv * 3);
    this.dir = new Float32Array(nv * 3);
    this.aN = new Float32Array(nv * 4);
    const idx = [];
    for (let i = 0; i < N - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 3, i * 2, i * 2 + 3, i * 2 + 2);
    for (let i = 0; i < FORK_N - 1; i++) {
      const b = (N + i) * 2;
      idx.push(b, b + 1, b + 3, b, b + 3, b + 2);
    }
    geo.setIndex(idx);
    for (const [name, arr, size] of [['position', this.pos, 3], ['aD', this.dir, 3], ['aN', this.aN, 4]]) {
      const attr = new THREE.BufferAttribute(arr, size);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, attr);
    }
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.boltUniforms = { uFlash: { value: 0 }, ...twistU };
    this.boltMaterial = new THREE.ShaderMaterial({
      uniforms: this.boltUniforms,
      vertexShader: BOLT_VERTEX,
      fragmentShader: BOLT_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // (A transparent two-sided material is drawn in two passes, the back faces and then the
      // front, and its program is built twice: the ribbon adds light and writes no depth, so one
      // pass is the same picture, for half the draws and one program. The scorch's the same.)
      forceSinglePass: true,
      blending: THREE.AdditiveBlending,
    });
    this.bolt = new THREE.Mesh(geo, this.boltMaterial);
    this.bolt.frustumCulled = false;
    this.bolt.renderOrder = 4;
    this.bolt.visible = false;

    // The scorch: a fan out to three rings, laid on the ground where a flash came down.
    const sg = new THREE.BufferGeometry();
    this.sPos = new Float32Array((1 + RINGS.length * SEGS) * 3);
    const sR = new Float32Array(1 + RINGS.length * SEGS);
    for (let r = 0; r < RINGS.length; r++) for (let s = 0; s < SEGS; s++) sR[1 + r * SEGS + s] = RINGS[r];
    const sIdx = [];
    for (let s = 0; s < SEGS; s++) sIdx.push(0, 1 + s, 1 + ((s + 1) % SEGS));
    for (let r = 1; r < RINGS.length; r++) {
      for (let s = 0; s < SEGS; s++) {
        const a = 1 + (r - 1) * SEGS + s;
        const b = 1 + (r - 1) * SEGS + ((s + 1) % SEGS);
        sIdx.push(a, a + SEGS, b + SEGS, a, b + SEGS, b);
      }
    }
    sg.setIndex(sIdx);
    const sAttr = new THREE.BufferAttribute(this.sPos, 3);
    sAttr.setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('position', sAttr);
    sg.setAttribute('aR', new THREE.BufferAttribute(sR, 1));
    sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.scorchUniforms = { uHeat: { value: 0 }, uSoot: { value: 0 }, ...twistU };
    this.scorchMaterial = new THREE.ShaderMaterial({
      uniforms: this.scorchUniforms,
      vertexShader: SCORCH_VERTEX,
      fragmentShader: SCORCH_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      // Over what is there, and what it says of itself (the alpha) kept.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.scorch = new THREE.Mesh(sg, this.scorchMaterial);
    this.scorch.frustumCulled = false;
    this.scorch.renderOrder = 2;
    this.scorch.visible = false;
    // (Both join the scene at the first flash that comes down: see render/motes.js on why.)
    this.age = Infinity;        // s since the last flash came down
    this.hits = 0;
    // Where the last one came down (the scene's coordinates), how far the lens was.
    this.at = { x: 0, y: 0, z: 0, dist: 0, height: 0 };
  }

  setTier(tier) {
    if (LEVELS[tier] !== undefined) this.level = LEVELS[tier];
  }

  get on() {
    return this.level > 0;
  }

  // A flash comes down at (x, y, z) of the scene, seen from `cam` (a position), its
  // cloud as high as `top` radians over the horizon from there, its number and so its
  // shape `seed`.
  hit(x, y, z, cam, top, seed) {
    if (this.level <= 0) return false;
    const dx = x - cam.x;
    const dz = z - cam.z;
    const dist = Math.max(30, Math.hypot(dx, dz));
    const height = Math.min(1500, Math.max(150, dist * Math.tan(top) + (cam.y - y)));
    // The lens's way to it, and across that: the line wanders across it, so that its
    // bends are seen.
    const ax = dx / dist;
    const az = dz / dist;
    const bx = -az;
    const bz = ax;
    const path = boltPath(seed, dist, height);
    const pos = this.pos;
    const dir = this.dir;
    const an = this.aN;
    const node = (k, px, py, pz, wide, bright, t, tx, ty, tz) => {
      for (const side of [-1, 1]) {
        const v = (k * 2 + (side > 0 ? 1 : 0));
        pos[v * 3] = px;
        pos[v * 3 + 1] = py;
        pos[v * 3 + 2] = pz;
        dir[v * 3] = tx;
        dir[v * 3 + 1] = ty;
        dir[v * 3 + 2] = tz;
        an[v * 4] = side;
        an[v * 4 + 1] = t;
        an[v * 4 + 2] = wide;
        an[v * 4 + 3] = bright;
      }
    };
    const at = (across, along, up) => [x + bx * across + ax * along, y + up, z + bz * across + az * along];
    const pts = [];
    for (let i = 0; i < N; i++) pts.push(at(path.across[i], path.along[i], path.up[i]));
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(N - 1, i + 1)];
      let tx = b[0] - a[0];
      let ty = b[1] - a[1];
      let tz = b[2] - a[2];
      const l = Math.hypot(tx, ty, tz) || 1;
      tx /= l;
      ty /= l;
      tz /= l;
      const w = STRIKE.width[0] + (STRIKE.width[1] - STRIKE.width[0]) * t;
      node(i, pts[i][0], pts[i][1], pts[i][2], w, 1, t, tx, ty, tz);
    }
    // The branch, at the high tier; at the mid one it is not drawn (it is folded to a point).
    const fork = this.level >= 2 ? forkPath(seed, dist, path) : [];
    const fp = fork.map((f) => at(f.across, f.along, f.up));
    for (let j = 0; j < FORK_N; j++) {
      const f = fork[Math.min(j, fork.length - 1)];
      const p = fp.length ? fp[Math.min(j, fp.length - 1)] : pts[0];
      const a = fp[Math.max(0, Math.min(j, fp.length - 1) - 1)] || p;
      const b = fp[Math.min(fp.length - 1, Math.min(j, fp.length - 1) + 1)] || p;
      let tx = b[0] - a[0];
      let ty = b[1] - a[1];
      let tz = b[2] - a[2];
      const l = Math.hypot(tx, ty, tz) || 1;
      tx /= l;
      ty /= l;
      tz /= l;
      const t = f ? f.i / (N - 1) : 0;
      node(N + j, p[0], p[1], p[2], f ? STRIKE.width[1] * 0.7 : 0, f ? f.fade * 0.7 : 0, t, tx, ty, tz);
    }
    const g = this.bolt.geometry.attributes;
    g.position.needsUpdate = true;
    g.aD.needsUpdate = true;
    g.aN.needsUpdate = true;
    // The scorch, laid over the ground.
    const sp = this.sPos;
    const lift = 0.4;
    sp[0] = x;
    sp[1] = this.env.groundAt(x, z) + lift;
    sp[2] = z;
    for (let r = 0; r < RINGS.length; r++) {
      for (let s = 0; s < SEGS; s++) {
        const a = (s / SEGS) * Math.PI * 2;
        // A ragged edge, from the flash's number and the place round it.
        const rag = r === RINGS.length - 1 ? 0.82 + 0.36 * (((Math.sin(seed * 12.9898 + s * 78.233) * 43758.5453) % 1 + 1) % 1) : 1;
        const rad = STRIKE.radius * RINGS[r] * rag;
        const px = x + Math.cos(a) * rad;
        const pz = z + Math.sin(a) * rad;
        const v = 1 + r * SEGS + s;
        sp[v * 3] = px;
        sp[v * 3 + 1] = this.env.groundAt(px, pz) + lift;
        sp[v * 3 + 2] = pz;
      }
    }
    this.scorch.geometry.attributes.position.needsUpdate = true;
    this.at = { x, y, z, dist, height };
    this.age = 0;
    this.hits++;
    if (!this.bolt.parent) this.scene.add(this.bolt, this.scorch);
    this.bolt.visible = true;
    this.scorch.visible = true;
    return true;
  }

  // The floating origin has moved.
  shift(dx, dz) {
    for (const arr of [this.pos, this.sPos]) {
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] -= dx;
        arr[i + 2] -= dz;
      }
    }
    this.at.x -= dx;
    this.at.z -= dz;
    this.bolt.geometry.attributes.position.needsUpdate = true;
    this.scorch.geometry.attributes.position.needsUpdate = true;
  }

  // Every frame: flash is the sky's (render/upside.js), the bolt is as bright as it.
  update(dt, flash) {
    if (!(this.age < STRIKE.life)) {
      if (this.bolt.visible || this.scorch.visible) {
        this.bolt.visible = false;
        this.scorch.visible = false;
      }
      return;
    }
    this.age += dt;
    this.boltUniforms.uFlash.value = flash;
    this.bolt.visible = flash > 0.004 && this.age < 1.6;
    const a = this.age;
    // The heat is bright for a blink and is out in a few seconds; the soot stays a while, then thins.
    this.scorchUniforms.uHeat.value = Math.exp(-a / 4.5) * (1 + 3 * flash);
    this.scorchUniforms.uSoot.value = 1 - Math.min(1, Math.max(0, (a - 8) / (STRIKE.life - 8)));
    if (this.age >= STRIKE.life) {
      this.bolt.visible = false;
      this.scorch.visible = false;
    }
  }

  dispose() {
    for (const m of [this.bolt, this.scorch]) {
      this.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
  }
}
