// Post-processing: scene -> bloom (in linear HDR) -> one final pass that tone
// maps, grades and converts to sRGB. Keeping tone mapping, grade and transfer
// in a single pass means exactly one place knows which space the frame is in.

import * as THREE from 'three';
import { EffectComposer } from '../../tools/vendor/postprocessing/EffectComposer.js';
import { RenderPass } from '../../tools/vendor/postprocessing/RenderPass.js';
import { ShaderPass } from '../../tools/vendor/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../../tools/vendor/postprocessing/UnrealBloomPass.js';
import { Pass, FullScreenQuad } from '../../tools/vendor/postprocessing/Pass.js';
import { STYLE_PASS } from './style.js';

// Notes which target the scene was drawn into, for a later pass that wants
// its depth: the composer swaps its two targets, so it is not always the same.
class TapPass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    this.target = null;
  }

  render(renderer, writeBuffer, readBuffer) {
    this.target = readBuffer;
  }
}

// A style's pass, reading the depth of the scene the tap saw drawn.
class StylePass extends ShaderPass {
  constructor(tap) {
    super(STYLE_PASS);
    this.tap = tap;
    this.material.depthTest = false;
    this.material.depthWrite = false;
  }

  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    this.uniforms.tDepth.value = this.tap.target ? this.tap.target.depthTexture : null;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}

// The final grade. Drawn into a target (when a style's pass comes after it)
// it does not clear the target first: it covers every pixel anyway, and
// during a dissolve that target is the one the scene was drawn into, whose
// depth the style's pass still has to read. Three clears depth as well as
// colour before it draws, and a frame of ink went blank paper.
class FinalPass extends ShaderPass {
  constructor(shader) {
    super(shader);
    this.material.depthTest = false;
    this.material.depthWrite = false;
  }

  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    if (this.renderToScreen) {
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
      return;
    }
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    renderer.autoClear = auto;
  }
}

// A cut between two camera positions, softened: the last frame of the old shot
// is held and dissolved into the new one. Works on the linear HDR frame, before
// tone mapping, so the mix is a mix of light.
class DissolvePass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    this.held = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.copy = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }',
      depthTest: false, depthWrite: false,
    }));
    this.blend = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tHeld: { value: this.held.texture }, uMix: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D tHeld; uniform float uMix; varying vec2 vUv;
        void main() { gl_FragColor = mix(texture2D(tDiffuse, vUv), texture2D(tHeld, vUv), uMix); }`,
      depthTest: false, depthWrite: false,
    }));
    this.capture = false;   // copy this frame into the hold
    this.valid = false;     // the hold has a frame in it
    this.mix = 0;
  }

  setSize(w, h) {
    this.held.setSize(w, h);
    this.valid = false;
  }

  render(renderer, writeBuffer, readBuffer) {
    if (this.capture) {
      this.copy.material.uniforms.tDiffuse.value = readBuffer.texture;
      renderer.setRenderTarget(this.held);
      this.copy.render(renderer);
      this.capture = false;
      this.valid = true;
    }
    this.needsSwap = this.mix > 0 && this.valid;
    if (!this.needsSwap) return;
    this.blend.material.uniforms.tDiffuse.value = readBuffer.texture;
    this.blend.material.uniforms.uMix.value = this.mix;
    renderer.setRenderTarget(writeBuffer);
    this.blend.render(renderer);
  }
}

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: 1.0 },
    uSaturation: { value: 1.08 },
    uVignette: { value: 0.22 },
    uContrast: { value: 1.06 },
    // 1: hand the scene's alpha on (the car's mark, for a style's pass).
    uPassAlpha: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uExposure;
    uniform float uSaturation;
    uniform float uVignette;
    uniform float uContrast;
    uniform float uPassAlpha;
    varying vec2 vUv;

    // ACES filmic fit (Narkowicz).
    vec3 aces(vec3 x) {
      const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }

    vec3 toSRGB(vec3 c) {
      return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
    }

    void main() {
      vec4 t = texture2D(tDiffuse, vUv);
      vec3 c = aces(t.rgb * uExposure);
      // Grade in display (sRGB) space, where 0.5 really is mid-grey: a touch
      // more contrast, cool shadows, warm highlights. Doing this on linear
      // values pivoted round 0.5 crushed everything darker than sRGB 46 to black.
      c = toSRGB(c);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      c = (c - 0.5) * uContrast + 0.5;
      c *= mix(vec3(0.96, 0.99, 1.04), vec3(1.03, 1.01, 0.97), smoothstep(0.15, 0.85, l));
      vec2 d = vUv - 0.5;
      c *= 1.0 - uVignette * dot(d, d) * 2.0;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), uPassAlpha > 0.5 ? t.a : 1.0);
    }
  `,
};

export class PostChain {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.camera = camera;
    // The scene's targets carry a depth texture, for the lines a style draws.
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(size.x, size.y),
    });
    target.texture.name = 'EffectComposer.rt1';
    this.composer = new EffectComposer(renderer, target);
    // Its second target is a copy of the first, and a copied depth texture
    // shares the first one's image, so three gives both the same texture on
    // the GPU: drawing into one cleared the scene's depth in the other. Each
    // gets its own.
    this.composer.renderTarget2.depthTexture = new THREE.DepthTexture(size.x, size.y);
    this.composer.addPass(new RenderPass(scene, camera));
    this.tap = new TapPass();
    this.composer.addPass(this.tap);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.6, 1.1);
    this._glow = 0;
    // Bloom adds light, and leaves the alpha alone: a style reads the car's
    // mark from it.
    const blend = this.bloom.blendMaterial;
    blend.blending = THREE.CustomBlending;
    blend.blendEquation = THREE.AddEquation;
    blend.blendSrc = THREE.SrcAlphaFactor;
    blend.blendDst = THREE.OneFactor;
    blend.blendEquationAlpha = THREE.AddEquation;
    blend.blendSrcAlpha = THREE.ZeroFactor;
    blend.blendDstAlpha = THREE.OneFactor;
    this.composer.addPass(this.bloom);
    this.dissolvePass = new DissolvePass();
    this.composer.addPass(this.dissolvePass);
    this.final = new FinalPass(FinalShader);
    this.final.renderToScreen = true;
    this.composer.addPass(this.final);
    // A style's own pass (render/style.js), last when there is one.
    this.stylePass = new StylePass(this.tap);
    this.stylePass.enabled = false;
    this.composer.addPass(this.stylePass);
    this.fade = 0;          // seconds into the current dissolve
    this.fadeLength = 0;
  }

  // Keep the frame about to be drawn, for a dissolve out of it.
  hold() {
    this.dissolvePass.capture = true;
    this.dissolvePass.valid = false;
  }

  // Dissolve from the held frame into whatever is drawn next. Returns false when
  // nothing was held (a headless run steps without drawing), which is a cut.
  dissolve(seconds) {
    if (!this.dissolvePass.valid) return false;
    this.fade = 0;
    this.fadeLength = seconds;
    return true;
  }

  setSize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  set exposure(v) {
    this.final.uniforms.uExposure.value = v;
  }

  get exposure() {
    return this.final.uniforms.uExposure.value;
  }

  setBloom(on) {
    this.bloom.enabled = on;
  }

  // Draw in a style (render/style.js): its last pass on when it has one,
  // and the scene's alpha handed on to it when the car marks itself.
  setStyle(style) {
    const on = style.drawn;
    // A soft glow round what is bright, for a style that wants one.
    const glow = style.cur.glow || 0;
    if (glow !== this._glow) {
      this._glow = glow;
      this.bloom.strength = 0.22 + 0.4 * glow;
      this.bloom.radius = 0.6 + 0.25 * glow;
      this.bloom.threshold = 1.1 - 0.2 * glow;
    }
    this.stylePass.enabled = on;
    this.final.uniforms.uPassAlpha.value = on && style.cur.mark > 0.5 ? 1 : 0;
    if (!on) return;
    const u = this.stylePass.uniforms;
    const size = this.renderer.getDrawingBufferSize(this._size || (this._size = new THREE.Vector2()));
    u.uRes.value.copy(size);
    u.uNearFar.value.set(this.camera.near, this.camera.far);
    this.camera.updateMatrixWorld();
    u.uInvProj.value.copy(this.camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(this.camera.matrixWorld);
    // World to screen, for the blocks' texels to find where they are in the frame.
    const inv = this._viewInv || (this._viewInv = new THREE.Matrix4());
    inv.copy(this.camera.matrixWorld).invert();
    u.uViewProj.value.multiplyMatrices(this.camera.projectionMatrix, inv);
    style.applyPass(u, size.y);
  }

  render(dt) {
    const d = this.dissolvePass;
    if (this.fadeLength > 0) {
      this.fade += dt;
      const t = Math.min(1, this.fade / this.fadeLength);
      d.mix = 1 - t * t * (3 - 2 * t);
      if (t >= 1) this.fadeLength = 0;
    } else {
      d.mix = 0;
    }
    this.composer.render(dt);
  }
}
