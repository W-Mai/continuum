// The last pass: what is drawn, made clean and crisp, then brought up to the
// size of the canvas.
//
// The scene is drawn into targets of its own (render/post.js), so the canvas's
// own multisampling never saw a triangle, and every edge came out as stairs.
// And on a screen with more pixels than the scene is drawn at, the browser
// stretched the canvas as a plain bilinear blow-up. This pass takes both:
//
//  - Edges. FXAA 3.11's search: a pixel whose neighbours differ by an eighth
//    of the brightest of them is on an edge; the edge is followed to both of
//    its ends, and the pixel is moved along the normal to where the edge's
//    own coverage says it should be. It works on the graded frame (sRGB, where
//    the eye is), after a style's pass, so the lines a style draws are
//    smoothed too. A point (one pixel, or two side by side, with everything
//    around it dimmer or brighter by half the range: a star, a spark) is left
//    as it is; the search would only dim it.
//  - Detail. A pixel that is not on an edge is sharpened the way AMD's CAS
//    does it: the four neighbours that surround it, weighted by how much room
//    the colour has before it clips, so shadows and highlights do not burn.
//    An edge is left to the search, so nothing is sharpened into a halo.
//  - Size. When the scene is drawn smaller than the canvas, the cleaned frame
//    is brought up with a Catmull-Rom filter (five taps), which keeps what a
//    bilinear blow-up smears; a style of hard blocks is brought up by
//    nearest, so its blocks stay blocks.
//
// A style sets how much of each (render/style.js: aa, sharp). With neither,
// and no change of size, the pass is not drawn at all, and the frame goes to
// the canvas as the pass before it left it.

import * as THREE from 'three';
import { Pass, FullScreenQuad } from '../../tools/vendor/postprocessing/Pass.js';

const VERTEX = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const WARM_CAMERA = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const CLEAN = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;
  uniform float uAA;
  uniform float uSharp;
  varying vec2 vUv;

  float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  // How far each step along an edge goes, in pixels (one, then growing), so
  // eight taps reach twenty-odd pixels.
  const float REACH[8] = float[8](1.0, 1.5, 2.0, 2.0, 2.0, 2.0, 4.0, 8.0);

  void main() {
    vec2 uv = vUv;
    vec2 t = uTexel;
    vec3 cM = texture2D(tDiffuse, uv).rgb;
    vec3 cN = texture2D(tDiffuse, uv + vec2(0.0, t.y)).rgb;
    vec3 cS = texture2D(tDiffuse, uv - vec2(0.0, t.y)).rgb;
    vec3 cE = texture2D(tDiffuse, uv + vec2(t.x, 0.0)).rgb;
    vec3 cW = texture2D(tDiffuse, uv - vec2(t.x, 0.0)).rgb;
    float lM = lum(cM);
    float lN = lum(cN);
    float lS = lum(cS);
    float lE = lum(cE);
    float lW = lum(cW);
    float lMax = max(lM, max(max(lN, lS), max(lE, lW)));
    float lMin = min(lM, min(min(lN, lS), min(lE, lW)));
    float range = lMax - lMin;
    vec3 col = cM;

    if (range >= max(0.0312, lMax * 0.125)) {
      // On an edge.
      if (uAA > 0.0) {
        float lNW = lum(texture2D(tDiffuse, uv + vec2(-t.x, t.y)).rgb);
        float lNE = lum(texture2D(tDiffuse, uv + vec2(t.x, t.y)).rgb);
        float lSW = lum(texture2D(tDiffuse, uv + vec2(-t.x, -t.y)).rgb);
        float lSE = lum(texture2D(tDiffuse, uv + vec2(t.x, -t.y)).rgb);
        // A point: one pixel, or two side by side, that all the rest of the
        // eight around it are dimmer than by half the range (a star, a spark,
        // a glint on snow), or all brighter than. It is drawn to be a point,
        // and the search would only dim it by the neighbours it mixed it
        // with. (A thin line has two neighbours of its own kind, and is not
        // one.)
        float h = 0.5 * range;
        float below = step(h, lM - lN) + step(h, lM - lS) + step(h, lM - lE) + step(h, lM - lW)
          + step(h, lM - lNW) + step(h, lM - lNE) + step(h, lM - lSW) + step(h, lM - lSE);
        float above = step(h, lN - lM) + step(h, lS - lM) + step(h, lE - lM) + step(h, lW - lM)
          + step(h, lNW - lM) + step(h, lNE - lM) + step(h, lSW - lM) + step(h, lSE - lM);
        bool lone = below >= 7.0 || above >= 7.0;
        if (!lone) {
          // A single pixel at odds with the rest (not a point): how far it is
          // from the mean of its 3x3, which is how much of a blur it is owed.
          float lA = (2.0 * (lN + lS + lE + lW) + lNW + lNE + lSW + lSE) * (1.0 / 12.0);
          float sc = clamp(abs(lA - lM) / range, 0.0, 1.0);
          float subpix = sc * sc * (3.0 - 2.0 * sc);
          subpix = subpix * subpix * 0.2;
          // Which way the edge runs.
          float edgeH = abs(lNW + lSW - 2.0 * lW) + 2.0 * abs(lN + lS - 2.0 * lM) + abs(lNE + lSE - 2.0 * lE);
          float edgeV = abs(lNW + lNE - 2.0 * lN) + 2.0 * abs(lW + lE - 2.0 * lM) + abs(lSW + lSE - 2.0 * lS);
          bool horz = edgeH >= edgeV;
          // The side the edge is on: the neighbour across it that differs most.
          float l1 = horz ? lS : lW;
          float l2 = horz ? lN : lE;
          float g1 = abs(l1 - lM);
          float g2 = abs(l2 - lM);
          bool first = g1 >= g2;
          float gradient = max(g1, g2) * 0.25;
          float lAvg = 0.5 * ((first ? l1 : l2) + lM);
          float across = horz ? t.y : t.x;
          across = first ? -across : across;
          vec2 edge = uv;
          if (horz) edge.y += across * 0.5;
          else edge.x += across * 0.5;
          // Follow the edge both ways until the brightness along it has left
          // the average of the two sides.
          vec2 along = horz ? vec2(t.x, 0.0) : vec2(0.0, t.y);
          vec2 pN = edge - along * REACH[0];
          vec2 pP = edge + along * REACH[0];
          float eN = lum(texture2D(tDiffuse, pN).rgb) - lAvg;
          float eP = lum(texture2D(tDiffuse, pP).rgb) - lAvg;
          bool doneN = abs(eN) >= gradient;
          bool doneP = abs(eP) >= gradient;
          for (int i = 1; i < 8; i++) {
            if (doneN && doneP) break;
            if (!doneN) {
              pN -= along * REACH[i];
              eN = lum(texture2D(tDiffuse, pN).rgb) - lAvg;
              doneN = abs(eN) >= gradient;
            }
            if (!doneP) {
              pP += along * REACH[i];
              eP = lum(texture2D(tDiffuse, pP).rgb) - lAvg;
              doneP = abs(eP) >= gradient;
            }
          }
          float dN = horz ? uv.x - pN.x : uv.y - pN.y;
          float dP = horz ? pP.x - uv.x : pP.y - uv.y;
          bool towardN = dN < dP;
          float dist = min(dN, dP);
          float span = dN + dP;
          // The end it ran to must be on the other side of the average from
          // this pixel, or the edge ends here and there is nothing to move to.
          bool good = ((towardN ? eN : eP) < 0.0) != (lM - lAvg < 0.0);
          float shift = good ? 0.5 - dist / span : 0.0;
          shift = max(shift, subpix);
          vec2 at = uv;
          if (horz) at.y += shift * across;
          else at.x += shift * across;
          col = mix(cM, texture2D(tDiffuse, at).rgb, uAA);
        }
      }
    } else if (uSharp > 0.0) {
      // Not on an edge: CAS.
      vec3 mn = min(min(min(cN, cW), min(cM, cE)), cS);
      vec3 mx = max(max(max(cN, cW), max(cM, cE)), cS);
      vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(0.02)), 0.0, 1.0));
      vec3 w = amp * (-0.2 * uSharp);
      col = clamp((w * (cN + cW + cE + cS) + cM) / (1.0 + 4.0 * w), 0.0, 1.0);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Catmull-Rom by five bilinear taps: the sixteen texels that bicubic filtering
// weighs, the middle four taken as two reads each and the corners (whose
// weights are small and negative) left out.
const UP = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform vec2 uSize;
  uniform float uNearest;
  varying vec2 vUv;

  vec3 tap(vec2 p) { return texture2D(tDiffuse, p / uSize).rgb; }

  void main() {
    vec2 pos = vUv * uSize;
    if (uNearest > 0.5) {
      gl_FragColor = vec4(tap(floor(pos) + 0.5), 1.0);
      return;
    }
    vec2 c1 = floor(pos - 0.5) + 0.5;
    vec2 f = pos - c1;
    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    vec2 w3 = f * f * (-0.5 + 0.5 * f);
    vec2 w12 = w1 + w2;
    vec2 c12 = c1 + w2 / w12;
    vec2 c0 = c1 - 1.0;
    vec2 c3 = c1 + 2.0;
    vec3 sum = tap(vec2(c12.x, c0.y)) * (w12.x * w0.y)
      + tap(vec2(c0.x, c12.y)) * (w0.x * w12.y)
      + tap(c12) * (w12.x * w12.y)
      + tap(vec2(c3.x, c12.y)) * (w3.x * w12.y)
      + tap(vec2(c12.x, c3.y)) * (w12.x * w3.y);
    float wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
    gl_FragColor = vec4(clamp(sum / wsum, 0.0, 1.0), 1.0);
  }
`;

export class PresentPass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    // How much of each, from the style in force (render/style.js).
    this.aa = 1;
    this.sharp = 0;
    // The scene's size and the canvas's, in pixels: the pass brings one to
    // the other.
    this.inSize = new THREE.Vector2(1, 1);
    this.outSize = new THREE.Vector2(1, 1);
    this.nearest = false;
    // The pass whose own target it reads, when that pass is on (post.js).
    this.after = null;
    this.clean = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uAA: { value: 1 },
        uSharp: { value: 0 },
      },
      vertexShader: VERTEX,
      fragmentShader: CLEAN,
      depthTest: false, depthWrite: false,
    }));
    this.up = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uSize: { value: new THREE.Vector2(1, 1) }, uNearest: { value: 0 } },
      vertexShader: VERTEX,
      fragmentShader: UP,
      depthTest: false, depthWrite: false,
    }));
    // The cleaned frame, when it has to be brought up afterwards: display
    // colour in eight bits is all it is.
    this.mid = new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    this.mid.texture.name = 'Present.mid';
  }

  // Whether the frame is the size of the canvas (to a pixel or two).
  get scaled() {
    return Math.abs(this.inSize.x - this.outSize.x) > 1.5 || Math.abs(this.inSize.y - this.outSize.y) > 1.5;
  }

  // Whether there is anything for the pass to do.
  get needed() {
    return this.scaled || this.aa > 0.001 || this.sharp > 0.001;
  }

  // Build both of its programs now, not at the first frame that needs them:
  // a step down in quality brings the second one in, in the middle of a drive.
  warm(renderer) {
    renderer.compile(this.clean._mesh, WARM_CAMERA);
    renderer.compile(this.up._mesh, WARM_CAMERA);
  }

  setSize(w, h) {
    this.inSize.set(w, h);
    this.mid.setSize(w, h);
  }

  render(renderer, writeBuffer, readBuffer) {
    // What the pass before it drew: a style's pass draws into a target of its
    // own, anything else into the composer's.
    if (this.after && this.after.enabled) readBuffer = this.after.out;
    const cleans = this.aa > 0.001 || this.sharp > 0.001;
    const scaled = this.scaled;
    const cu = this.clean.material.uniforms;
    cu.tDiffuse.value = readBuffer.texture;
    cu.uTexel.value.set(1 / this.inSize.x, 1 / this.inSize.y);
    cu.uAA.value = this.aa;
    // A frame brought up from a smaller one has lost more of its detail, and
    // is given more of it back: a style's number is for a frame the canvas's
    // own size.
    const shrunk = Math.max(0, 1 - this.inSize.x / this.outSize.x);
    cu.uSharp.value = Math.min(0.8, this.sharp * (1 + 5 * shrunk));
    if (cleans && !scaled) {
      renderer.setRenderTarget(null);
      this.clean.render(renderer);
      return;
    }
    let source = readBuffer;
    if (cleans) {
      renderer.setRenderTarget(this.mid);
      this.clean.render(renderer);
      source = this.mid;
    }
    const uu = this.up.material.uniforms;
    uu.tDiffuse.value = source.texture;
    uu.uSize.value.copy(this.inSize);
    uu.uNearest.value = this.nearest ? 1 : 0;
    renderer.setRenderTarget(null);
    this.up.render(renderer);
  }

  dispose() {
    this.clean.material.dispose();
    this.up.material.dispose();
    this.mid.dispose();
  }
}
