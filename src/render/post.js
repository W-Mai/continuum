// Post-processing chain: one final pass that tone maps, converts to sRGB and
// applies the look. Keeping all three in a single pass means exactly one place
// knows which colour space the frame is in.

import * as THREE from 'three';
import { EffectComposer } from '../../tools/vendor/postprocessing/EffectComposer.js';
import { RenderPass } from '../../tools/vendor/postprocessing/RenderPass.js';
import { ShaderPass } from '../../tools/vendor/postprocessing/ShaderPass.js';

// Final pass. Tone mapping, the sRGB transfer and the look all happen here, in
// that order, so exactly one place knows which space the frame is in. Running
// the grade as its own earlier pass meant guessing whether its input was linear
// or display-referred, and that guess blackened the frame.
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: 1.0 },
    uSaturation: { value: 1.12 },
    uVignette: { value: 0.30 },
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
    varying vec2 vUv;

    // ACES filmic fit (Narkowicz): three lines instead of the full matrix fit,
    // and at these exposures the difference is invisible.
    vec3 aces(vec3 x) {
      const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }

    vec3 toSRGB(vec3 c) {
      return mix(c * 12.92,
                 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055,
                 step(0.0031308, c));
    }

    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb * uExposure;
      c = aces(c);

      // Grade in display space, where mid-grey is really ~0.5.
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      c *= mix(vec3(0.95, 0.98, 1.05), vec3(1.04, 1.01, 0.98),
               smoothstep(0.1, 0.8, l));

      vec2 d = vUv - 0.5;
      c *= 1.0 - uVignette * dot(d, d);

      gl_FragColor = vec4(toSRGB(clamp(c, 0.0, 1.0)), 1.0);
    }
  `,
};

export class PostChain {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    this.enabled = true;
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.final = new ShaderPass(FinalShader);
    // The last pass must write to the canvas. EffectComposer sets this itself,
    // but only for a pass that swaps buffers, so state it explicitly.
    this.final.renderToScreen = true;
    this.composer.addPass(this.final);
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
  }

  // The lowest tier renders straight to the canvas instead of paying for an
  // offscreen buffer and a copy.
  setQuality(level) {
    this.enabled = level < 2;
    this.final.uniforms.uVignette.value = level === 0 ? 0.30 : 0.20;
  }

  applyLook(preset) {
    this.final.uniforms.uSaturation.value = preset.saturation;
    this.final.uniforms.uVignette.value = preset.vignette;
  }

  render(dt) {
    if (!this.enabled) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.composer.render(dt);
  }
}
