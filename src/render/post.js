// Post-processing: scene -> bloom (in linear HDR) -> one final pass that tone
// maps, grades and converts to sRGB. Keeping tone mapping, grade and transfer
// in a single pass means exactly one place knows which space the frame is in.

import * as THREE from 'three';
import { EffectComposer } from '../../tools/vendor/postprocessing/EffectComposer.js';
import { RenderPass } from '../../tools/vendor/postprocessing/RenderPass.js';
import { ShaderPass } from '../../tools/vendor/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../../tools/vendor/postprocessing/UnrealBloomPass.js';
import { Pass, FullScreenQuad } from '../../tools/vendor/postprocessing/Pass.js';

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
      vec3 c = aces(texture2D(tDiffuse, vUv).rgb * uExposure);
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
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

export class PostChain {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.6, 1.1);
    this.composer.addPass(this.bloom);
    this.dissolvePass = new DissolvePass();
    this.composer.addPass(this.dissolvePass);
    this.final = new ShaderPass(FinalShader);
    this.final.renderToScreen = true;
    this.composer.addPass(this.final);
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
