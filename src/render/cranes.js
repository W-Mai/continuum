// Cranes over the heaven's sea of cloud: skeins of 5 to 9 in a V, each flying
// straight and slow 40 to 120 m over the sea, the wings beating slowly
// (world/heavenplan.js, CRANES). Nothing is kept on the CPU, as with the birds
// (render/critters.js): each skein has its place in a box that rides with the
// lens, wrapped in absolute coordinates, and the vertex shader carries it on
// its way and puts each crane in its place in the V. One instanced draw.
//
// A crane is white, with the black of the back of its wings and its neck, and
// the red of its crown; the haze takes it as it takes the birds. It marks itself
// in the frame's alpha as the birds do (MARK.life), so a style that inks them
// inks it too.

import * as THREE from 'three';
import { atmo } from './atmosphere.js';
import { styleU, MARK } from './style.js';
import { twistU, TWIST_PARS } from './twist.js';
import { CRANES, skein, placeInSkein } from '../world/heavenplan.js';

// A crane a unit across the wings, nose at +z, flying level: a long body, the
// neck and head out in front, the legs trailing behind, broad wings. aWing says
// how far a vertex flaps (0 at the body, 1 at a wingtip); aCol its colour.
function craneGeometry() {
  const P = [];
  const wing = [];
  const col = [];
  const idx = [];
  const WHITE = [0.95, 0.95, 0.93];
  const BLACK = [0.08, 0.08, 0.1];
  const RED = [0.75, 0.1, 0.08];
  const GREY = [0.45, 0.45, 0.46];
  const add = (x, y, z, w, c) => {
    P.push(x, y, z);
    wing.push(w);
    col.push(...c);
    return P.length / 3 - 1;
  };
  // Body: a long diamond.
  const nb = add(0, 0.01, 0.16, 0, WHITE);
  const lb = add(-0.05, 0, 0, 0, WHITE);
  const rb = add(0.05, 0, 0, 0, WHITE);
  const tb = add(0, 0.005, -0.2, 0, WHITE);
  const ub = add(0, 0.04, -0.02, 0, WHITE);
  idx.push(nb, lb, ub, nb, ub, rb, lb, tb, ub, ub, tb, rb, nb, rb, lb, lb, rb, tb);
  // Neck, out in front and black, the head at its end with its red crown and a grey bill.
  const n0 = add(-0.018, 0.01, 0.14, 0, BLACK);
  const n1 = add(0.018, 0.01, 0.14, 0, BLACK);
  const n2 = add(0, 0.02, 0.42, 0, BLACK);
  idx.push(n0, n2, n1);
  const h0 = add(-0.02, 0.02, 0.42, 0, RED);
  const h1 = add(0.02, 0.02, 0.42, 0, RED);
  const h2 = add(0, 0.03, 0.47, 0, RED);
  idx.push(h0, h2, h1);
  const b0 = add(-0.008, 0.02, 0.46, 0, GREY);
  const b1 = add(0.008, 0.02, 0.46, 0, GREY);
  const b2 = add(0, 0.015, 0.56, 0, GREY);
  idx.push(b0, b2, b1);
  // Legs trailing past the tail.
  const l0 = add(-0.02, -0.005, -0.18, 0, GREY);
  const l1 = add(0.02, -0.005, -0.18, 0, GREY);
  const l2 = add(0, -0.01, -0.46, 0, GREY);
  idx.push(l0, l1, l2);
  // Wings: white in front, the black of the trailing feathers behind, out to the tip.
  for (const s of [-1, 1]) {
    const f = add(s * 0.04, 0.005, 0.08, 0, WHITE);
    const k = add(s * 0.04, 0.005, -0.1, 0, WHITE);
    const m1 = add(s * 0.26, 0.01, 0.06, 0.5, WHITE);
    const m2 = add(s * 0.26, 0.01, -0.08, 0.5, WHITE);
    const k2 = add(s * 0.04, 0.0, -0.17, 0, BLACK);
    const m3 = add(s * 0.26, 0.0, -0.16, 0.5, BLACK);
    const tipF = add(s * 0.5, 0.02, 0.0, 1, WHITE);
    const tipB = add(s * 0.48, 0.015, -0.14, 1, BLACK);
    idx.push(f, k, m2, f, m2, m1, k, k2, m3, k, m3, m2, m1, m2, tipB, m1, tipB, tipF, m2, m3, tipB);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

const BOX = CRANES.box;
const VERTEX = /* glsl */`
${TWIST_PARS}
attribute float aWing;
attribute vec3 aCol;
attribute vec4 aSkein;   // where the skein starts in the box (xz, 0..1), its height over the sea (m), the way it flies (rad)
attribute vec4 aCrane;   // where the crane is from its leader (m back, m to the right), its own phase, 1 if it flies
uniform vec3 uCam;
uniform vec3 uCamMod;
uniform float uTime;
uniform float uLevel;
uniform float uSize;
uniform float uShown;
uniform vec3 fogParams;
uniform vec3 uFogCol;
varying vec3 vCol;
void main() {
  vCol = vec3( 0.0 );
  if ( aCrane.w < 0.5 || uShown <= 0.0 ) {
    gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    return;
  }
  vec2 dir = vec2( cos( aSkein.w ), sin( aSkein.w ) );
  vec2 right = vec2( -dir.y, dir.x );
  // The leader, carried on its way through the box and wrapped in it; the others from it.
  vec2 lead = mod( aSkein.xy * ${BOX.toFixed(1)} + dir * ${CRANES.speed.toFixed(1)} * uTime - uCamMod.xz, ${BOX.toFixed(1)} ) - ${(BOX / 2).toFixed(1)};
  float edge = smoothstep( ${(BOX / 2).toFixed(1)}, ${(BOX * 0.36).toFixed(1)}, length( lead ) );
  vec2 p = lead - dir * aCrane.x + right * aCrane.y;
  float ph = aCrane.z * 6.2832;
  vec3 c = vec3( uCam.x + p.x, uLevel + aSkein.z + 1.2 * sin( uTime * 0.21 + ph ), uCam.z + p.y );
  vec3 fwd = vec3( dir.x, 0.0, dir.y );
  vec3 side = vec3( right.x, 0.0, right.y );
  vec3 up = vec3( 0.0, 1.0, 0.0 );
  float beat = sin( uTime * ${(CRANES.beat * 2 * Math.PI).toFixed(3)} + ph );
  vec3 lp = position;
  lp.y += aWing * 0.32 * beat;
  lp.x *= 1.0 - 0.1 * aWing * ( 0.5 + 0.5 * beat );
  float far = smoothstep( 12.0, 30.0, length( c - uCam ) );
  float size = uSize * edge * far * uShown;
  vec3 wp = c + ( side * lp.x + up * lp.y + fwd * lp.z ) * size;
  vec4 mv = viewMatrix * vec4( wp, 1.0 );
  gl_Position = projectionMatrix * twistView( mv );
  float d = -mv.z;
  vCol = mix( aCol, uFogCol, 1.0 - exp( -max( d, 0.0 ) * fogParams.x * 0.9 ) );
}
`;
const FRAGMENT = /* glsl */`
uniform float uStyleMark;
varying vec3 vCol;
void main() {
  gl_FragColor = vec4( vCol, mix( 1.0, ${MARK.life}, uStyleMark ) );
}
`;

export class Cranes {
  constructor(scene, tier = 'high') {
    const max = CRANES.skeins.high;
    const per = CRANES.count[1];
    const sk = new Float32Array(max * per * 4);
    const cr = new Float32Array(max * per * 4);
    this.skeins = [];
    for (let f = 0; f < max; f++) {
      const s = skein(f);
      this.skeins.push(s);
      for (let i = 0; i < per; i++) {
        const k = f * per + i;
        const at = placeInSkein(s, i);
        sk.set([s.at[0], s.at[1], s.height, s.heading], k * 4);
        cr.set([at.back, at.side, (s.phase + i * 0.137) % 1, i < s.n ? 1 : 0], k * 4);
      }
    }
    this.per = per;
    this.geometry = craneGeometry();
    this.geometry.setAttribute('aSkein', new THREE.InstancedBufferAttribute(sk, 4));
    this.geometry.setAttribute('aCrane', new THREE.InstancedBufferAttribute(cr, 4));
    this.uniforms = {
      uCam: { value: new THREE.Vector3() },
      uCamMod: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uSize: { value: CRANES.span },
      uShown: { value: 0 },
      uFogCol: { value: new THREE.Color() },
      uStyleMark: styleU.uStyleMark,
      fogParams: atmo.fogParams,
      ...twistU,
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.name = 'cranes';
    scene.add(this.mesh);
    this.shown = 0;
    this.setTier(tier);
  }

  setTier(t) {
    this.tier = t;
    this.geometry.instanceCount = (CRANES.skeins[t] || 0) * this.per;
  }

  // How many cranes fly now: the skeins of the tier, each its own number.
  count() {
    const k = CRANES.skeins[this.tier] || 0;
    return this.skeins.slice(0, k).reduce((a, s) => a + s.n, 0);
  }

  // share: how much of the lens's world is the heaven (0..1); level: the sea's height (local).
  update(dt, camera, share, level, fogColor, origin) {
    const u = this.uniforms;
    const on = share > 0.01 && this.geometry.instanceCount > 0;
    this.mesh.visible = on;
    this.shown = on ? this.count() : 0;
    u.uTime.value = (u.uTime.value + dt) % 7200;
    if (!on) return;
    u.uShown.value = Math.min(1, share * 1.5);
    const c = camera.position;
    u.uCam.value.copy(c);
    const wrap = (v) => ((v % BOX) + BOX) % BOX;
    u.uCamMod.value.set(wrap(c.x + origin.x), 0, wrap(c.z + origin.z));
    u.uLevel.value = level;
    u.uFogCol.value.copy(fogColor);
  }

  // Where crane i of skein f is now (local, for the checks): as the vertex shader puts it.
  where(f, i, camera, origin) {
    const s = this.skeins[f];
    const u = this.uniforms;
    const dir = [Math.cos(s.heading), Math.sin(s.heading)];
    const right = [-dir[1], dir[0]];
    const m = (v) => v - BOX * Math.floor(v / BOX);
    const wrap = (v) => ((v % BOX) + BOX) % BOX;
    const c = camera.position;
    const cm = [wrap(c.x + origin.x), wrap(c.z + origin.z)];
    const lead = [0, 1].map((k) => m(s.at[k] * BOX + dir[k] * CRANES.speed * u.uTime.value - cm[k]) - BOX / 2);
    const at = placeInSkein(s, i);
    const ph = ((s.phase + i * 0.137) % 1) * 6.2832;
    return {
      x: c.x + lead[0] - dir[0] * at.back + right[0] * at.side,
      y: u.uLevel.value + s.height + 1.2 * Math.sin(u.uTime.value * 0.21 + ph),
      z: c.z + lead[1] - dir[1] * at.back + right[1] * at.side,
    };
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
