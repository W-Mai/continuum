// Post-processing: scene -> bloom (in linear HDR) -> one final pass that tone
// maps, grades and converts to sRGB. Keeping tone mapping, grade and transfer
// in a single pass means exactly one place knows which space the frame is in.

import * as THREE from 'three';
import { EffectComposer } from '../../tools/vendor/postprocessing/EffectComposer.js';
import { RenderPass } from '../../tools/vendor/postprocessing/RenderPass.js';
import { ShaderPass } from '../../tools/vendor/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../../tools/vendor/postprocessing/UnrealBloomPass.js';

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
    this.final = new ShaderPass(FinalShader);
    this.final.renderToScreen = true;
    this.composer.addPass(this.final);
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
    this.composer.render(dt);
  }
}
