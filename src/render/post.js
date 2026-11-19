// Post-processing: scene -> bloom (in linear HDR) -> one final pass that tone
// maps, grades and converts to sRGB. Keeping tone mapping, grade and transfer
// in a single pass means exactly one place knows which space the frame is in.

import * as THREE from 'three';
import { EffectComposer } from '../../tools/vendor/postprocessing/EffectComposer.js';
import { RenderPass } from '../../tools/vendor/postprocessing/RenderPass.js';
import { ShaderPass } from '../../tools/vendor/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../../tools/vendor/postprocessing/UnrealBloomPass.js';
import { Pass, FullScreenQuad } from '../../tools/vendor/postprocessing/Pass.js';
import { STYLE_PASS, FLAT_PASS, skyStyle } from './style.js';
import { PresentPass } from './present.js';

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

// A style's pass, reading the depth of the scene the tap saw drawn. A style
// with flat colour (flat above 0) draws it with the program that has the code
// for it, after a pass that does the rows of it into a target of its own; the
// others draw with the program that has not.
class StylePass extends ShaderPass {
  constructor(tap) {
    super(STYLE_PASS);
    this.tap = tap;
    this.material.depthTest = false;
    this.material.depthWrite = false;
    this.plain = this.material;
    this.flat = new THREE.ShaderMaterial({
      defines: { FLAT: 1 },
      uniforms: this.uniforms,
      vertexShader: STYLE_PASS.vertexShader,
      fragmentShader: STYLE_PASS.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.wantFlat = false;
    this.size = [1, 1];
    // The rows of the flat colour, with the weight each took.
    this.rows = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rows.texture.name = 'Style.rows';
    this.uniforms.tFlat.value = this.rows.texture;
    const u = this.uniforms;
    this.rowMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, tDepth: u.tDepth, uRes: u.uRes, uNearFar: u.uNearFar, uFlatR: u.uFlatR, uFlatN: u.uFlatN, uSkyEps: u.uSkyEps,
      },
      vertexShader: FLAT_PASS.vertexShader,
      fragmentShader: FLAT_PASS.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.rowQuad = new FullScreenQuad(this.rowMaterial);
    // Where it draws when the last pass comes after it. Not the composer's
    // targets: one of those holds the scene's depth, which this pass reads,
    // and a texture cannot be read and drawn into at once.
    this.needsSwap = false;
    this.out = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.out.texture.name = 'Style.out';
  }

  setSize(w, h) {
    this.out.setSize(w, h);
    this.size = [w, h];
    this.fitRows();
  }

  // Whether the style drawn flattens. The rows' target is the frame's size
  // only while one does, and a pixel otherwise: it is a half-float frame
  // (16 MB at 1080p), and a style that does not flatten, come to from one
  // that does, has no use for it.
  setFlat(on) {
    this.wantFlat = on;
    this.fitRows();
  }

  fitRows() {
    const [w, h] = this.wantFlat ? this.size : [1, 1];
    if (this.rows.width !== w || this.rows.height !== h) this.rows.setSize(w, h);
  }

  // Build both programs ahead, as they will be drawn with (to the canvas
  // when this is the last pass, to a target when another comes after it).
  // The target is one pixel of its own: a program is keyed by whether it
  // draws to a target, not by which, and setting this pass's own would have
  // the renderer make it, a frame of half floats that the real style never
  // draws into.
  warm(renderer) {
    const scene = new THREE.Scene();
    const geometry = new THREE.PlaneGeometry(2, 2);
    for (const m of [this.plain, this.flat, this.rowMaterial]) scene.add(new THREE.Mesh(geometry, m));
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const pixel = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    const was = renderer.getRenderTarget();
    for (const target of [pixel, null]) {
      renderer.setRenderTarget(target);
      renderer.compile(scene, camera);
    }
    renderer.setRenderTarget(was);
    pixel.dispose();
    geometry.dispose();
  }

  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    const depth = this.tap.target ? this.tap.target.depthTexture : null;
    this.uniforms.tDepth.value = depth;
    const flat = this.wantFlat && !!depth;
    this.material = flat ? this.flat : this.plain;
    if (flat) {
      this.rowMaterial.uniforms.tDiffuse.value = readBuffer.texture;
      renderer.setRenderTarget(this.rows);
      this.rowQuad.render(renderer);
    }
    if (this.renderToScreen) {
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
      return;
    }
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.fsQuad.material = this.material;
    renderer.setRenderTarget(this.out);
    this.fsQuad.render(renderer);
  }

  dispose() {
    this.flat.dispose();
    this.rowMaterial.dispose();
    this.rowQuad.dispose();
    this.rows.dispose();
    this.out.dispose();
    super.dispose();
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
    // 0 to 1: how far the painter's curve stands in for ACES (render/style.js's curve).
    uCurve: { value: 0 },
    // 1: hand the scene's alpha on (the car's mark, for a style's pass; the sky's cloud marked for a print).
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
    uniform float uCurve;
    uniform float uPassAlpha;
    varying vec2 vUv;

    // ACES filmic fit (Narkowicz).
    vec3 aces(vec3 x) {
      const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }

    // Straight up to 0.62, so a colour written in a palette is the colour
    // on the screen, then pressed slowly toward 1: a white does not burn.
    vec3 painter(vec3 x) {
      x = max(x, vec3(0.0));
      return min(x, vec3(0.62)) + 0.2 * (1.0 - exp(-max(x - 0.62, 0.0) / 0.2));
    }

    vec3 toSRGB(vec3 c) {
      return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
    }

    void main() {
      vec4 t = texture2D(tDiffuse, vUv);
      vec3 c;
      if (uCurve >= 1.0) {
        c = painter(t.rgb * uExposure);
      } else {
        c = aces(t.rgb * uExposure);
        if (uCurve > 0.0) c = mix(c, painter(t.rgb * uExposure), uCurve);
      }
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
    // The size the scene is drawn at, in pixels, and what fraction of the
    // canvas's that is (setScale): the scene's targets are this size, and the
    // last pass brings the frame up to the canvas.
    this.scale = 1;
    this.size = new THREE.Vector2(1, 1);
    this._out = new THREE.Vector2();
    this._css = [0, 0];
    // The scene's targets carry a depth texture, for the lines a style draws.
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.size.copy(size);
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(size.x, size.y),
    });
    target.texture.name = 'EffectComposer.rt1';
    this.composer = new EffectComposer(renderer, target);
    // Sizes are given to it in pixels (setSize below), not as a canvas's.
    this.composer.setPixelRatio(1);
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
    // The last of all (render/present.js): clean edges, crisp detail, and the
    // frame brought up to the canvas's size when it was drawn smaller.
    this.present = new PresentPass();
    this.present.after = this.stylePass;
    this.present.enabled = false;
    this.composer.addPass(this.present);
    this._frames = 0;
    this.deferWarm = false; // the style pass's programs are built by someone else, later
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
    this._css = [w, h];
    // The canvas's own pixels, and the scene's: a fraction of them.
    const out = this.renderer.getDrawingBufferSize(this._out);
    this.present.outSize.copy(out);
    this.size.set(Math.max(1, Math.round(out.x * this.scale)), Math.max(1, Math.round(out.y * this.scale)));
    this.composer.setSize(this.size.x, this.size.y);
  }

  // Draw the scene at this fraction (0 to 1) of the canvas's size.
  setScale(s) {
    this.scale = s;
    if (this._css[0]) this.setSize(this._css[0], this._css[1]);
  }

  // The world's exposure; a style's own (expose) is laid on it in setStyle.
  set exposure(v) {
    this._exposure = v;
    this.final.uniforms.uExposure.value = v * (this._expose || 1);
  }

  get exposure() {
    return this._exposure === undefined ? this.final.uniforms.uExposure.value : this._exposure;
  }

  setBloom(on) {
    this.bloom.enabled = on;
  }

  // Draw in a style (render/style.js): its last pass on when it has one,
  // and the scene's alpha handed on to it when the car marks itself.
  setStyle(style) {
    // The style's numbers as this world has them: some of them go by how
    // much of a painted sky the world has (render/style.js, night).
    style.sync();
    const c = style.now;
    const on = style.drawn;
    // A soft glow round what is bright, for a style that wants one.
    const glow = c.glow || 0;
    if (glow !== this._glow) {
      this._glow = glow;
      this.bloom.strength = 0.22 + 0.4 * glow;
      this.bloom.radius = 0.6 + 0.25 * glow;
      this.bloom.threshold = 1.1 - 0.2 * glow;
    }
    // The style's exposure on the world's, and its tone curve; the sky that
    // is painted in colours of its own is drawn before the exposure and
    // divided by it, so that it comes out as written.
    this._expose = c.expose;
    const expo = (this._exposure === undefined ? this.final.uniforms.uExposure.value : this._exposure) * this._expose;
    this.final.uniforms.uExposure.value = expo;
    this.final.uniforms.uCurve.value = c.curve;
    skyStyle.uPaintInv.value = 1 / expo;
    this.stylePass.enabled = on;
    this.stylePass.setFlat(c.flat > 0);
    this.final.uniforms.uPassAlpha.value = on && (c.mark > 0.5 || c.bokashi > 0.5) ? 1 : 0;
    // How clean and how crisp, and whether the last pass has anything to do.
    const p = this.present;
    p.aa = c.aa;
    p.sharp = c.sharp;
    p.nearest = c.pixel > 0.5;
    p.enabled = p.needed;
    if (!on) return;
    const u = this.stylePass.uniforms;
    const size = this.size;
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
    // The style pass's programs, built ahead a moment after the first frames
    // (the scene's own are built then too, at the second). A page that has a
    // queue for after its first frame does it there (Game.settle).
    if (++this._frames === 3 && !this.deferWarm) this.stylePass.warm(this.renderer);
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
