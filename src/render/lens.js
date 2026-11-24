// The real style's lens at speed: a motion blur of the camera's own motion.
//
// Only the lens moving is blurred, not each thing moving by itself: a pixel is
// put back where the scene's depth says it is in the world, and that point is
// projected with the lens as it was a sixtieth of a second before (its view and
// projection of the last step of the game, Game.update); what is between
// the two on the screen is the way the pixel went. Along it six taps of the frame
// (the linear frame, after the bloom, before the grade), in a target of half the
// frame's size, at most `most` pixels of the frame's own long; the frame at its
// own size is then laid under the half one by how long the way is, so that what
// barely moves keeps its own pixels. The car (marked in the scene's alpha,
// render/style.js MARK: the real style marks while the blur is drawn) is not
// blurred and no tap takes it: its pixels go through as they are.
//
// It comes in with the speed (from `from` to `full` m/s), in the chase lens only,
// in the real style only (by how much of it there is, style.now.real), not in the
// photo mode (the world stands still there), and not where the visitor turned it
// off (the settings' blur, which a system that asks for less motion turns off). A
// cut (a lens put somewhere else at once) is not a motion: the frame after it has
// none. The high and the middle tier draw it; the low does not.

import * as THREE from 'three';
import { Pass, FullScreenQuad } from '../../tools/vendor/postprocessing/Pass.js';
import { MARK_RANGE } from './style.js';

export const BLUR = {
  from: 25,      // m/s: the speed it begins at
  full: 35,      // m/s: where it is all there
  taps: 6,       // along the way
  most: 12,      // px: the longest way a pixel is blurred along, in the frame's pixels at 720 rows
  rows: 720,     // the frame's height `most` is given for (a taller frame has it longer, by as much)
  shutter: 1 / 60, // s: how much of the lens's motion is a way
  cut: 6,        // m, or the speed's step times four if that is more: a lens moved further is a cut
  turn: 0.2,     // rad: and one turned further
  tiers: { high: 1, mid: 1, low: 0 },
};

const VERTEX = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const carLo = MARK_RANGE.car[0].toFixed(2);
const carHi = MARK_RANGE.car[1].toFixed(2);

// Where a pixel of the frame was: from its depth through the inverse of the
// projection and the lens's place now, into the view and projection of the
// step before (uBack, all four in one), in the frame's pixels.
const WAY = /* glsl */`
  uniform mat4 uBack;
  uniform vec2 uFull;
  uniform float uMost;
  uniform float uK;
  vec2 wayAt(vec2 uv, float d) {
    vec4 q = uBack * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vec2 was = q.w > 1e-6 ? q.xy / q.w * 0.5 + 0.5 : uv;
    vec2 px = (uv - was) * uFull * uK;
    float l = length(px);
    return l > uMost ? px * (uMost / l) : px;
  }
  bool isCar(float a) { return a >= ${carLo} && a < ${carHi}; }
`;

// Half size: six taps along the way through the texel, of what is not the car;
// rgb their mean times how many of them were not (a), so that the frame at its
// size reads a bilinear mix of texels by what each had.
const HALF = /* glsl */`
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  varying vec2 vUv;
  ${WAY}
  void main() {
    vec2 uv = vUv;
    float d = texture2D(tDepth, uv).r;
    vec2 way = wayAt(uv, d) / uFull;
    vec3 sum = vec3(0.0);
    float n = 0.0;
    for (int i = 0; i < ${BLUR.taps}; i++) {
      float t = (float(i) + 0.5) / ${BLUR.taps.toFixed(1)} - 0.5;
      vec4 c = texelFetch(tColor, clamp(ivec2((uv + way * t) * uFull), ivec2(0), ivec2(uFull) - 1), 0);
      if (isCar(c.a)) continue;
      sum += min(c.rgb, vec3(64.0));
      n += 1.0;
    }
    gl_FragColor = vec4(n > 0.0 ? sum / ${BLUR.taps.toFixed(1)} : vec3(0.0), n / ${BLUR.taps.toFixed(1)});
  }
`;

// Full size: the car as it is; elsewhere the half layer over the frame by how
// long the pixel's own way is (none under half a pixel, all of it from two).
const LAY = /* glsl */`
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform sampler2D tHalf;
  varying vec2 vUv;
  ${WAY}
  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec4 s = texelFetch(tColor, p, 0);
    gl_FragColor = s;
    if (isCar(s.a)) return;
    float l = length(wayAt(vUv, texelFetch(tDepth, p, 0).r));
    float k = smoothstep(0.5, 2.0, l);
    if (k <= 0.0) return;
    vec4 h = texture2D(tHalf, vUv);
    if (h.a < 0.05) return;
    gl_FragColor = vec4(mix(s.rgb, h.rgb / h.a, k * smoothstep(0.05, 0.3, h.a)), s.a);
  }
`;

export class MotionBlurPass extends Pass {
  constructor(tap, camera) {
    super();
    this.needsSwap = false;
    this.enabled = false;
    this.tap = tap;
    this.camera = camera;
    // How much of it there is (0 to 1), as the game works it out every frame (Game.update: blur).
    this.amount = 0;
    this.ready = false;     // it has drawn this frame: `out` is the frame
    this.size = [1, 1];
    // The lens of the step before: its view and projection, and where it stood.
    this.back = new THREE.Matrix4();
    this.was = null;
    this._m = new THREE.Matrix4();
    this._vp = new THREE.Matrix4();
    this.half = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.half.texture.name = 'Blur.half';
    this.out = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    });
    this.out.texture.name = 'Blur.out';
    const u = {
      tColor: { value: null },
      tDepth: { value: null },
      tHalf: { value: this.half.texture },
      uBack: { value: this.back },
      uFull: { value: new THREE.Vector2(1, 1) },
      uMost: { value: BLUR.most },
      uK: { value: 0 },
    };
    this.uniforms = u;
    const make = (fragmentShader) => new THREE.ShaderMaterial({
      uniforms: u, vertexShader: VERTEX, fragmentShader, depthTest: false, depthWrite: false,
    });
    this.materials = { half: make(HALF), lay: make(LAY) };
    this.quad = new FullScreenQuad(this.materials.half);
  }

  // The lens as the step of the game about to begin finds it (Game.update, before
  // anything moves it): what the next frame's way is measured from.
  remember(camera) {
    camera.updateMatrixWorld();
    const vp = this._vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const at = camera.position;
    const q = camera.quaternion;
    // (One record, kept and written over: a step makes no objects of its own here.)
    const w = this._was || (this._was = { vp: new THREE.Matrix4(), x: 0, y: 0, z: 0, q: new THREE.Quaternion() });
    w.vp.copy(vp);
    w.x = at.x;
    w.y = at.y;
    w.z = at.z;
    w.q.copy(q);
    this.was = w;
  }

  // Whether the lens now is where the one remembered could have moved to in a
  // step of dt at speed: a lens put elsewhere at once is a cut.
  _moved(camera, dt, speed) {
    const w = this.was;
    if (!w) return false;
    const at = camera.position;
    const far = Math.max(BLUR.cut, 4 * speed * dt);
    if (Math.hypot(at.x - w.x, at.y - w.y, at.z - w.z) > far) return false;
    return camera.quaternion.angleTo(w.q) < BLUR.turn;
  }

  setSize(w, h) {
    this.size = [w, h];
    this.fit();
  }

  // Its targets are the frame's size (and half of it) while it is on, a pixel when it is not.
  fit() {
    const [w, h] = this.enabled ? this.size : [1, 1];
    if (this.out.width !== w || this.out.height !== h) this.out.setSize(w, h);
    const hw = Math.max(1, Math.ceil(w / 2));
    const hh = Math.max(1, Math.ceil(h / 2));
    if (this.half.width !== hw || this.half.height !== hh) this.half.setSize(hw, hh);
  }

  // On or off for this frame, with how much: amount (0 to 1), dt the step's
  // length (s) and speed the car's (m/s), for what a cut is.
  set(amount, dt, speed) {
    const on = amount > 0.002 && this._moved(this.camera, dt, speed);
    this.amount = on ? amount : 0;
    this.dt = dt;
    if (on !== this.enabled) {
      this.enabled = on;
      this.fit();
    }
  }

  // Build both programs ahead, as they are drawn (to a target of half floats).
  warm(renderer) {
    const scene = new THREE.Scene();
    const geometry = new THREE.PlaneGeometry(2, 2);
    for (const m of Object.values(this.materials)) scene.add(new THREE.Mesh(geometry, m));
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const pixel = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    const was = renderer.getRenderTarget();
    renderer.setRenderTarget(pixel);
    renderer.compile(scene, camera);
    renderer.setRenderTarget(was);
    pixel.dispose();
    geometry.dispose();
  }

  _draw(renderer, material, target) {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }

  render(renderer, writeBuffer, readBuffer) {
    this.ready = false;
    const depth = this.tap.target ? this.tap.target.depthTexture : null;
    if (!depth || !this.was) return;
    const cam = this.camera;
    const u = this.uniforms;
    cam.updateMatrixWorld();
    // The frame's pixels back to the world (its projection's inverse, then the
    // lens's place now), then into the lens of the step before.
    this.back.multiplyMatrices(this.was.vp, this._m.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse));
    const [w, h] = this.size;
    u.uFull.value.set(w, h);
    u.uMost.value = BLUR.most * h / BLUR.rows;
    // The way of a step of dt as the way of the shutter's time, and how much of it there is.
    u.uK.value = this.amount * BLUR.shutter / Math.max(this.dt || BLUR.shutter, 1e-3);
    u.tColor.value = readBuffer.texture;
    u.tDepth.value = depth;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    this._draw(renderer, this.materials.half, this.half);
    this._draw(renderer, this.materials.lay, this.out);
    renderer.autoClear = auto;
    this.ready = true;
  }

  dispose() {
    for (const m of Object.values(this.materials)) m.dispose();
    this.quad.dispose();
    this.half.dispose();
    this.out.dispose();
  }
}
