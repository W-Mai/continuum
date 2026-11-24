// Light shafts for the real style: when the sun is in the frame or just out of it, the bright
// places of the sky throw light toward it through the air, and what stands in the way (the
// ridge, the trees, a cloud) leaves streaks in it.
//
// It reads the frame the scene was drawn into and its depth, in three draws on targets a
// quarter of the frame's size each way:
//
//  - source: the sky's light where it is bright. The sky is what has the far plane's depth: of
//    the four taps a texel takes, one that is not sky has none of it. The light is taken as the
//    exposure makes it, over a threshold, and the sun's disc is held to a cap so that it does not
//    make a star of the taps that fall on it;
//  - rays: from each texel, `taps` taps along the way to the sun's place on the screen (where the
//    sun is out of the frame that place is outside the target, and what is outside the target is
//    no light). The first tap is a little way along by a number taken from where the texel's
//    sight goes in the world, not from the screen, so the streaks go with the world as the lens
//    turns; each tap counts a little less than the one before it;
//  - add: the result laid over the frame, in the colour of the sun (half of it), as strong as the
//    air is thick and the sun is in view.
//
// How much of it there is goes by where the sun is: all of it while it is in the frame, less as
// the lens turns from it, none by the time it is far round to the side (and none behind the lens),
// smoothly by the angle between the lens's axis and the sun. It adds to the frame in linear light,
// before the bloom, and does not swap the composer's targets (the scene's, with its depth, stays
// the one the passes after it read the depth of).

import * as THREE from 'three';
import { Pass, FullScreenQuad } from '../../tools/vendor/postprocessing/Pass.js';

export const SHAFTS = {
  taps: { high: 24, mid: 12, low: 0 },   // taps along each ray, by tier
  strength: 0.25,                        // of the rays' light that is laid on the frame
  threshold: [0.45, 1.0],                // the sky's light (exposed) where it begins to be a source and is whole
  cap: 2.5,                              // the most a channel of the source is
  density: 0.92,                         // the share of the way to the sun a ray goes
  decay: 0.965,                          // each tap's weight against the one before's
  reach: [45, 100],                      // the angle (degrees) between the lens's axis and the sun, where the shafts begin to go
                                         // (the frame's half width, a little under it, is 49) and where none is left
  out: [1.5, 3.5],                       // how far the sun is from the middle of the frame, in the frame's half width or height
                                         // (the larger), where the shafts begin to go and where none is left
  length: 0.9,                           // the longest a ray goes, in frame heights (a sun far out of the frame is not marched to)
  air: [0.00006, 0.0004],                // the haze (density) at which the shafts are weakest and strongest, and how much
  airK: [0.55, 1.45],                    // of their strength that is
  sunny: [0.2, 0.8],                     // the sun's share of the light (a grey sky has a third of it) where there are none and where there are all
};

const VERTEX = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';

const SOURCE = /* glsl */`
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 uFull;
  uniform float uExposure;
  uniform vec2 uThreshold;
  uniform float uCap;

  void main() {
    // The four pixels of the middle of the 4 by 4 this texel stands for, each as the mean of two
    // by two, the sky's share of them counted by their depth.
    ivec2 last = ivec2(uFull) - 1;
    vec2 base = floor(gl_FragCoord.xy) * 4.0;
    vec3 sum = vec3(0.0);
    for (int k = 0; k < 4; k++) {
      vec2 o = vec2(1.0 + 2.0 * float(k & 1), 1.0 + 2.0 * float(k >> 1));
      ivec2 p = min(ivec2(base + o - 0.5), last);
      float sky = texelFetch(tDepth, p, 0).r >= 0.999995 ? 1.0 : 0.0;
      sum += texture(tColor, (base + o) / uFull).rgb * sky;
    }
    vec3 c = sum * 0.25;
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722)) * uExposure;
    c *= smoothstep(uThreshold.x, uThreshold.y, lum);
    gl_FragColor = vec4(min(c, vec3(uCap)), 1.0);
  }
`;

const RAYS = /* glsl */`
  uniform sampler2D tSource;
  uniform vec2 uSize;
  uniform vec2 uSun;
  uniform int uTaps;
  uniform float uDensity;
  uniform float uLength;
  uniform float uDecay;
  uniform mat4 uCamWorld;
  uniform vec2 uTan;

  uvec3 pcg3d(uvec3 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    return v;
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / uSize;
    // Where this texel looks in the world, in cells of about its own width: a number for it from that
    // (at a distance of 700 to the radian a cell is 0.0014 of one: a quarter of a pixel of a frame 1080 tall).
    vec3 dir = normalize(mat3(uCamWorld) * vec3((uv * 2.0 - 1.0) * uTan, -1.0));
    float jitter = float(pcg3d(uvec3(ivec3(floor(dir * 700.0) + 4096.0))).x) * (1.0 / 4294967295.0);
    // The way to the sun, a share of it (but not more than uLength frame heights).
    vec2 way = uSun - uv;
    float far = length(way * vec2(uSize.x / uSize.y, 1.0));
    vec2 march = way * (min(far * uDensity, uLength) / max(far, 1e-4) / float(uTaps));
    vec2 at = uv + march * jitter;
    vec3 sum = vec3(0.0);
    float w = 1.0;
    for (int i = 0; i < 32; i++) {
      if (i >= uTaps) break;
      vec2 inside = step(vec2(0.0), at) * step(at, vec2(1.0));
      sum += texture(tSource, at).rgb * (w * inside.x * inside.y);
      w *= uDecay;
      at += march;
    }
    gl_FragColor = vec4(sum / float(uTaps), 1.0);
  }
`;

const ADD = /* glsl */`
  uniform sampler2D tRays;
  uniform vec2 uFull;
  uniform vec3 uTint;
  void main() {
    gl_FragColor = vec4(texture(tRays, gl_FragCoord.xy / uFull).rgb * uTint, 0.0);
  }
`;

// The programs' sources, for the check that the taps are as many as the tiers say.
export const SHAFT_SHADERS = { source: SOURCE, rays: RAYS, add: ADD };

export class ShaftPass extends Pass {
  constructor(renderer, tap, camera) {
    super();
    this.needsSwap = false;
    this.enabled = false;
    this.renderer = renderer;
    this.tap = tap;
    this.camera = camera;
    // Kept off from outside (the check that finds what they add), whatever the style.
    this.off = false;
    this.shafts = 0;
    this.tier = 'high';
    // Where the sun is (a direction in the world), what the haze is (its density at the sea), how far
    // the lens is in a tunnel (0 to 1), and the colour of the sun's light: the game gives these each frame.
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.fog = 0.0002;
    this.inside = 0;
    // How much of the light is the sun's and not a grey sky's (the sun's strength against what its world gives it by day).
    this.sunny = 1;
    this.color = new THREE.Color(1, 1, 1);
    // How far it has come on since it was first drawn (it comes in over half a second).
    this.level = 0;
    // What the last frame did, for the checks: how much of the sun's light, and how many draws.
    this.shown = 0;
    this.draws = 0;
    this.built = false;
    this._warm = null;
    this.size = [1, 1];
    this.quarter = [1, 1];
    const target = () => new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    this.source = target();
    this.rays = target();
    this.source.texture.name = 'Shafts.source';
    this.rays.texture.name = 'Shafts.rays';
    const slot = (value) => ({ value });
    const u = {
      tColor: slot(null),
      tDepth: slot(null),
      tSource: slot(this.source.texture),
      tRays: slot(this.rays.texture),
      uFull: slot(new THREE.Vector2(1, 1)),
      uSize: slot(new THREE.Vector2(1, 1)),
      uSun: slot(new THREE.Vector2(0.5, 1.5)),
      uTaps: slot(SHAFTS.taps.high),
      uDensity: slot(SHAFTS.density),
      uLength: slot(SHAFTS.length),
      uDecay: slot(SHAFTS.decay),
      uExposure: slot(1),
      uThreshold: slot(new THREE.Vector2(SHAFTS.threshold[0], SHAFTS.threshold[1])),
      uCap: slot(SHAFTS.cap),
      uCamWorld: slot(new THREE.Matrix4()),
      uTan: slot(new THREE.Vector2(1, 1)),
      uTint: slot(new THREE.Vector3(0, 0, 0)),
    };
    this.uniforms = u;
    const make = (fragmentShader, uniforms, more = {}) => new THREE.ShaderMaterial({
      uniforms, vertexShader: VERTEX, fragmentShader, depthTest: false, depthWrite: false, ...more,
    });
    this.materials = {
      source: make(SOURCE, { tColor: u.tColor, tDepth: u.tDepth, uFull: u.uFull, uExposure: u.uExposure, uThreshold: u.uThreshold, uCap: u.uCap }),
      rays: make(RAYS, {
        tSource: u.tSource, uSize: u.uSize, uSun: u.uSun, uTaps: u.uTaps, uDensity: u.uDensity, uLength: u.uLength, uDecay: u.uDecay,
        uCamWorld: u.uCamWorld, uTan: u.uTan,
      }),
      // Laid over the frame: the colour added, the alpha as it was.
      add: make(ADD, { tRays: u.tRays, uFull: u.uFull, uTint: u.uTint }, {
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        blendEquationAlpha: THREE.AddEquation,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneFactor,
      }),
    };
    this.quad = new FullScreenQuad(this.materials.source);
    this._view = new THREE.Vector3();
  }

  // The exposure the frame is graded with (the final pass's own uniform): the source's threshold is
  // on the light as it will be on the screen.
  bind(exposure) {
    this.materials.source.uniforms.uExposure = exposure;
  }

  // How the style and the tier have it now: the real style's share (0 to 1). The programs are built
  // the first time it is wanted: ahead, in the compiler's threads, and it comes on when they are (sync:
  // here, at once, for a run that has no page to keep going).
  set(shafts, tier, sync) {
    this.shafts = shafts;
    this.tier = tier;
    const want = this.wants(shafts, tier);
    if (want && !this.built) {
      if (sync) this.build();
      else this.warm();
    }
    if (sync) this.level = 1;
    const on = want && this.built;
    if (on !== this.enabled) {
      this.enabled = on;
      this.fit();
    }
    // (What the last frame did is over when the pass is not drawn.)
    if (!on) {
      this.draws = 0;
      this.shown = 0;
    }
  }

  // Whether a style's share and a tier have it drawn.
  wants(shafts, tier) {
    return shafts > 0 && (SHAFTS.taps[tier] || 0) > 0 && !this.off;
  }

  // Every frame: it comes in over half a second, the first time.
  advance(dt) {
    if (this.enabled && this.level < 1) this.level = Math.min(1, this.level + dt * 2);
  }

  setSize(w, h) {
    this.size = [w, h];
    this.fit();
  }

  // The targets are a quarter of the frame's size each way while the pass is on and a pixel while it is not.
  fit() {
    const [w, h] = this.enabled ? this.size : [1, 1];
    const qw = Math.max(1, Math.ceil(w / 4));
    const qh = Math.max(1, Math.ceil(h / 4));
    for (const t of [this.source, this.rays]) t.setSize(qw, qh);
    this.quarter = [qw, qh];
    this.uniforms.uFull.value.set(w, h);
    this.uniforms.uSize.value.set(qw, qh);
  }

  _warmScene() {
    const scene = new THREE.Scene();
    const geometry = new THREE.PlaneGeometry(2, 2);
    for (const m of Object.values(this.materials)) scene.add(new THREE.Mesh(geometry, m));
    return { scene, geometry, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
  }

  // Build the programs now, as they are drawn (to a target).
  build() {
    if (this.built) return;
    const { scene, geometry, camera } = this._warmScene();
    const pixel = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    const was = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(pixel);
    try {
      this.renderer.compile(scene, camera);
    } finally {
      this.renderer.setRenderTarget(was);
    }
    pixel.dispose();
    geometry.dispose();
    this.built = true;
  }

  // Build them ahead, in the compiler's threads; resolves when they are built. Built once.
  warm() {
    if (this._warm) return this._warm;
    const renderer = this.renderer;
    if (!renderer.compileAsync) {
      this.build();
      return (this._warm = Promise.resolve());
    }
    const { scene, geometry, camera } = this._warmScene();
    const pixel = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    const was = renderer.getRenderTarget();
    renderer.setRenderTarget(pixel);
    let built;
    try {
      built = renderer.compileAsync(scene, camera);
    } finally {
      renderer.setRenderTarget(was);
    }
    this._warm = built.then(() => {
      pixel.dispose();
      geometry.dispose();
      this.built = true;
    });
    return this._warm;
  }

  // How much of the shafts the sun's place gives, 0 to 1, and where it is on the screen (uv): the
  // sun behind the lens, or far enough out of the frame that the shafts have come to nothing, gives none.
  // The sun is a direction (it is far enough off that the lens's place does not move it).
  where(out) {
    const cam = this.camera;
    cam.updateMatrixWorld();
    this._view.copy(this.sunDir).transformDirection(cam.matrixWorldInverse);
    const v = this._view;
    if (v.z > -0.02) return 0;
    const e = cam.projectionMatrix.elements;
    out.set((e[0] * v.x) / -v.z * 0.5 + 0.5, (e[5] * v.y) / -v.z * 0.5 + 0.5);
    // The angle between the axis and the sun, from the lens's own view of it (the axis is -z).
    const angle = Math.acos(Math.min(1, -v.z)) * 180 / Math.PI;
    const [a, b] = SHAFTS.reach;
    const t = Math.min(1, Math.max(0, (angle - a) / (b - a)));
    // And not as the sun is a long way out of the frame, whatever the angle (the lens has a wide field of view).
    const x = Math.abs(out.x * 2 - 1);
    const y = Math.abs(out.y * 2 - 1);
    const [c, d] = SHAFTS.out;
    const o = Math.min(1, Math.max(0, (Math.max(x, y) - c) / (d - c)));
    return (1 - t * t * (3 - 2 * t)) * (1 - o * o * (3 - 2 * o));
  }

  // How much the haze strengthens them: the air's density against where the shafts are weakest and strongest.
  airK() {
    const [a, b] = SHAFTS.air;
    const t = Math.min(1, Math.max(0, (this.fog - a) / (b - a)));
    return SHAFTS.airK[0] + (SHAFTS.airK[1] - SHAFTS.airK[0]) * t * t * (3 - 2 * t);
  }

  _draw(renderer, material, target) {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
    this.draws++;
  }

  render(renderer, writeBuffer, readBuffer) {
    this.shown = 0;
    this.draws = 0;
    const depth = this.tap.target ? this.tap.target.depthTexture : null;
    if (!depth || !(this.shafts * this.level > 0)) return;
    const u = this.uniforms;
    const at = u.uSun.value;
    const k = this.where(at);
    const sun = Math.min(1, Math.max(0, (this.sunny - SHAFTS.sunny[0]) / (SHAFTS.sunny[1] - SHAFTS.sunny[0])));
    const strength = SHAFTS.strength * this.shafts * this.level * k * this.airK() * (1 - this.inside) * sun * sun * (3 - 2 * sun);
    this.shown = strength;
    if (strength < 0.002) return;
    const cam = this.camera;
    const e = cam.projectionMatrix.elements;
    u.tColor.value = readBuffer.texture;
    u.tDepth.value = depth;
    u.uTaps.value = SHAFTS.taps[this.tier] || SHAFTS.taps.mid;
    u.uCamWorld.value.copy(cam.matrixWorld);
    u.uTan.value.set(1 / e[0], 1 / e[5]);
    // The sun's colour in the light the shafts are: a good part of it, the rest the sky's own.
    u.uTint.value.set(0.5 + 0.5 * this.color.r, 0.5 + 0.5 * this.color.g, 0.5 + 0.5 * this.color.b).multiplyScalar(strength);
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    this._draw(renderer, this.materials.source, this.source);
    this._draw(renderer, this.materials.rays, this.rays);
    // Into the frame it is read from, where it stands: nothing of the frame's depth is sampled by this
    // draw, though the target has it attached.
    this._draw(renderer, this.materials.add, readBuffer);
    renderer.autoClear = auto;
  }

  // The bytes of the targets (half floats, four to a texel).
  get targetBytes() {
    return 2 * this.quarter[0] * this.quarter[1] * 8;
  }

  dispose() {
    for (const m of Object.values(this.materials)) m.dispose();
    for (const t of [this.source, this.rays]) t.dispose();
    super.dispose();
  }
}
