// Post-processing: scene -> ambient occlusion (the real style's, laid over the
// linear frame) -> light shafts (the real style's, added to it) -> bloom (in linear HDR) -> one final pass that tone
// maps, grades and converts to sRGB. Keeping tone mapping, grade and transfer
// in a single pass means exactly one place knows which space the frame is in.
// In the photo mode a depth of field sits between the bloom and the final
// pass, on the linear frame, and an exposure compensation is laid on the
// exposure the final pass has.

import * as THREE from 'three';
import { EffectComposer } from '../../tools/vendor/postprocessing/EffectComposer.js';
import { RenderPass } from '../../tools/vendor/postprocessing/RenderPass.js';
import { ShaderPass } from '../../tools/vendor/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../../tools/vendor/postprocessing/UnrealBloomPass.js';
import { Pass, FullScreenQuad } from '../../tools/vendor/postprocessing/Pass.js';
import { STYLE_PASS, FLAT_PASS, PIXEL_PASS, skyStyle, pixelLevel, pixelGrid, styleU } from './style.js';
import { PresentPass } from './present.js';
import { AoPass } from './ao.js';
import { ShaftPass } from './shafts.js';

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

// --- contact shadow ---------------------------------------------------------
//
// The real style's: where a face that looks at the sun has something close to it
// toward the sun (a car's side at its foot, a stone, a post, a clump of grass) the
// shadow map is too coarse to say, the pixel is darkened by how close. It works on
// the linear frame, before the bloom, from the scene's depth: the pixel's place and
// the face it lies in (the shorter way across in each direction, so that an edge
// does not turn it), then `steps` taps along the sun's way for `ray` m, each a thing
// when the depth there is nearer the lens than the tap by more than a little (more, the lower
// the face is to the lens) and less than `thick` (what the lens sees of a thing is its front only). Only what is within
// `reach` m of the lens; a face turned from the sun by more than `facing` (the cosine)
// is in its own shade. The nearer the thing is along the ray, the darker; `dark` is
// what is left of the light where it stands against the pixel.
const CONTACT = { reach: 30, ray: 0.5, steps: 8, dark: 0.55, facing: 0.1, thick: 0.4, lift: 0.02 };

const CONTACT_FRAGMENT = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform vec2 uRes;
  uniform vec2 uNearFar;
  uniform mat4 uProj;
  uniform mat4 uInvProj;
  uniform vec3 uSun;
  uniform float uStrength;
  varying vec2 vUv;

  vec3 viewAt( ivec2 p, float d ) {
    vec4 q = uInvProj * vec4( ( vec2( p ) + 0.5 ) / uRes * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 );
    return q.xyz / q.w;
  }
  float depthAt( ivec2 p ) {
    return texelFetch( tDepth, clamp( p, ivec2( 0 ), ivec2( uRes ) - 1 ), 0 ).r;
  }
  float distanceOf( float d ) {
    return 2.0 * uNearFar.x * uNearFar.y / ( uNearFar.y + uNearFar.x - ( d * 2.0 - 1.0 ) * ( uNearFar.y - uNearFar.x ) );
  }

  void main() {
    vec4 src = texture2D( tDiffuse, vUv );
    gl_FragColor = src;
    ivec2 p = ivec2( gl_FragCoord.xy );
    float d = depthAt( p );
    if ( d >= 1.0 ) return;
    float z = distanceOf( d );
    float fade = 1.0 - smoothstep( ${(CONTACT.reach * 0.6).toFixed(1)}, ${CONTACT.reach.toFixed(1)}, z );
    if ( fade <= 0.0 ) return;
    vec3 P = viewAt( p, d );
    vec3 R = viewAt( p + ivec2( 1, 0 ), depthAt( p + ivec2( 1, 0 ) ) );
    vec3 L = viewAt( p - ivec2( 1, 0 ), depthAt( p - ivec2( 1, 0 ) ) );
    vec3 U = viewAt( p + ivec2( 0, 1 ), depthAt( p + ivec2( 0, 1 ) ) );
    vec3 D = viewAt( p - ivec2( 0, 1 ), depthAt( p - ivec2( 0, 1 ) ) );
    vec3 dx = abs( R.z - P.z ) < abs( P.z - L.z ) ? R - P : P - L;
    vec3 dy = abs( U.z - P.z ) < abs( P.z - D.z ) ? U - P : P - D;
    vec3 N = normalize( cross( dx, dy ) );
    if ( dot( N, P ) > 0.0 ) N = -N;
    if ( dot( N, uSun ) < ${CONTACT.facing.toFixed(2)} ) return;
    float hit = 0.0;
    // How far a tap may be behind what the lens sees there and still be in front of it: the depth is
    // that of the middle of a pixel, and a face at a low angle changes by this much across one.
    float bias = 0.02 + 0.004 * z + 1.5 * max( abs( dx.z ), abs( dy.z ) );
    float before = 0.0;
    for ( int i = 0; i < ${CONTACT.steps}; i++ ) {
      float t = ( float( i ) + 0.5 ) * ${(CONTACT.ray / CONTACT.steps).toFixed(5)};
      vec3 Q = P + N * ${CONTACT.lift.toFixed(3)} + uSun * t;
      vec4 c = uProj * vec4( Q, 1.0 );
      if ( c.w <= 0.0 ) break;
      vec2 uv = c.xy / c.w * 0.5 + 0.5;
      if ( uv.x < 0.0 || uv.y < 0.0 || uv.x >= 1.0 || uv.y >= 1.0 ) break;
      float ds = depthAt( ivec2( uv * uRes ) );
      if ( ds >= 1.0 ) {
        before = 0.0;
        continue;
      }
      float behind = - Q.z - distanceOf( ds );
      if ( behind > bias && behind < ${CONTACT.thick.toFixed(2)} ) {
        // Where along the way it was crossed, between this tap and the last.
        float back = max( t - ${(CONTACT.ray / CONTACT.steps).toFixed(5)}, 0.0 );
        float f = clamp( ( bias - before ) / ( behind - before ), 0.0, 1.0 );
        hit = 1.0 - ( back + f * ( t - back ) ) * ${(1 / CONTACT.ray).toFixed(3)};
        break;
      }
      before = min( behind, bias );
    }
    gl_FragColor.rgb = src.rgb * ( 1.0 - hit * fade * uStrength * ${(1 - CONTACT.dark).toFixed(3)} );
  }
`;

class ContactPass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.enabled = false;
    this.strength = 0;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uNearFar: { value: new THREE.Vector2(0.3, 14000) },
        uProj: { value: camera.projectionMatrix },
        uInvProj: { value: camera.projectionMatrixInverse },
        uSun: styleU.uSunDirV,
        uStrength: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: CONTACT_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  render(renderer, writeBuffer, readBuffer) {
    const depth = readBuffer.depthTexture;
    this.needsSwap = !!depth && this.strength > 0;
    if (!this.needsSwap) return;
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = depth;
    u.uRes.value.set(readBuffer.width, readBuffer.height);
    u.uNearFar.value.set(this.camera.near, this.camera.far);
    u.uStrength.value = this.strength;
    renderer.setRenderTarget(writeBuffer);
    // (Every pixel is drawn over, and the depth of the target is not wanted: nothing to clear.)
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    this.quad.render(renderer);
    renderer.autoClear = auto;
  }

  // Build the program ahead, as it is drawn (to a target of half floats, as the others of the chain are).
  warm(renderer) {
    const scene = new THREE.Scene();
    const geometry = new THREE.PlaneGeometry(2, 2);
    scene.add(new THREE.Mesh(geometry, this.material));
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const pixel = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    const was = renderer.getRenderTarget();
    renderer.setRenderTarget(pixel);
    renderer.compile(scene, camera);
    renderer.setRenderTarget(was);
    pixel.dispose();
    geometry.dispose();
  }

  dispose() {
    this.material.dispose();
    this.quad.dispose();
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

// The pixel style's pass (render/style.js, PIXEL_PASS): the frame as cells, one fragment to a
// cell, drawn into a target of the grid's size; the last pass (render/present.js) lays the
// cells out on the canvas, a block of pixels each. A style's own pass that is drawn as well
// (a change from or to a style that has one) is read in place of the graded frame, and the
// marks in the graded frame's alpha are still the car's.
class PixelPass extends Pass {
  constructor(tap, style) {
    super();
    this.needsSwap = false;
    this.tap = tap;
    this.style = style;
    this.uniforms = PIXEL_PASS.uniforms;
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: PIXEL_PASS.vertexShader,
      fragmentShader: PIXEL_PASS.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
    this.out = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.out.texture.name = 'Pixel.out';
    this.enabled = false;
    this.grid = null;
  }

  // The grid of cells (render/style.js, pixelGrid), or null for none: the target is
  // as large as the grid, a pixel when there is none.
  fit(grid) {
    this.grid = grid;
    const w = grid ? grid.cols : 1;
    const h = grid ? grid.rows : 1;
    if (this.out.width !== w || this.out.height !== h) this.out.setSize(w, h);
    if (grid) {
      this.uniforms.uGrid.value.set(grid.cols, grid.rows);
      this.uniforms.uK.value = grid.k;
    }
  }

  // Build the program ahead, onto a one-pixel target, as it is drawn.
  warm(renderer) {
    const scene = new THREE.Scene();
    const geometry = new THREE.PlaneGeometry(2, 2);
    scene.add(new THREE.Mesh(geometry, this.material));
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const pixel = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    const was = renderer.getRenderTarget();
    renderer.setRenderTarget(pixel);
    renderer.compile(scene, camera);
    renderer.setRenderTarget(was);
    pixel.dispose();
    geometry.dispose();
  }

  render(renderer, writeBuffer, readBuffer) {
    const depth = this.tap.target ? this.tap.target.depthTexture : null;
    if (!depth) return;
    const u = this.uniforms;
    u.tDepth.value = depth;
    u.tDiffuse.value = readBuffer.texture;
    const styled = this.style.enabled;
    u.uStyled.value = styled ? 1 : 0;
    u.tStyled.value = styled ? this.style.out.texture : readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : this.out);
    this.quad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.quad.dispose();
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
    // The pass that makes the frame this one grades in a target of its own
    // (the depth of field), when it is on: its picture, and not the composer's.
    this.source = null;
  }

  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    if (this.source && this.source.enabled && this.source.ready) readBuffer = this.source.out;
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
    // (Every pixel is drawn over: what is not cleared is the depth, which is the scene's when the target is
    // the one it was drawn into, as it is after a pass before this one has swapped.)
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    this.blend.render(renderer);
    renderer.autoClear = auto;
  }
}

// How much the final grade darkens the corners of a frame (a style says how much of it it keeps: finalVignette).
const FINAL_VIGNETTE = 0.22;

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: 1.0 },
    uSaturation: { value: 1.08 },
    uVignette: { value: FINAL_VIGNETTE },
    uContrast: { value: 1.06 },
    // How hard the darkest tones are pressed down (render/style.js's darks): the exponent they take is 1 + this.
    uDarks: { value: 0 },
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
    uniform float uDarks;
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
      // The real style's darks pressed down: a channel under about 0.22 takes the exponent
      // 1 + uDarks, none over 0.36, a step between.
      if (uDarks > 0.0) c = pow(c, vec3(1.0) + uDarks * (vec3(1.0) - smoothstep(0.22, 0.36, c)));
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

// --- depth of field --------------------------------------------------------
//
// The lens it is made with: a thin lens on a sheet of film `sensor` metres
// tall, of the focal length that gives the frame's field of view, open to an
// f-number N and focused at a distance s. A point at distance d is a disc on
// the film, and as a radius in the pixels of a frame P pixels tall it is
//
//     K (1/s - 1/d),    K = P sensor / (8 N tan^2(fov / 2)),
//
// positive behind the focus, negative in front of it. A narrower field, a
// wider aperture and a nearer focus make a bigger disc. The disc is a share of
// the frame's height, so a picture of the frame at twice the size has discs
// twice as many pixels across: it is the frame on the screen, drawn finer.
export const LENS = {
  sensor: 0.2,             // m: the height of the film
  max: 0.0185,             // of the frame's height: the largest radius a disc has
  zone: [0.0024, 0.005],   // of the frame's height: under the first radius nothing is blurred, over the second all of it is
};

// K above, for a frame `frame` pixels tall, the tangent of half its field of view
// and the f-number n.
export const lensK = (frame, tan, n) => frame * LENS.sensor / (8 * n * tan * tan);

// The radius, in pixels, of the disc of a point at distance d (m, along the
// lens's axis) for a lens focused at s (m), open to f-number n, with a field of
// view fov (degrees, from the bottom of the frame to the top), in a frame `frame`
// pixels tall: as the shader has it.
export function discRadius(d, s, n, fov, frame) {
  const most = LENS.max * frame;
  return Math.max(-most, Math.min(most, lensK(frame, Math.tan(fov * Math.PI / 360), n) * (1 / s - 1 / d)));
}

// The pass works on the linear frame, after the bloom and before the grade and
// the style's pass: a style draws its strokes and lines on the blurred frame, in
// the screen's pixels, and nothing blurs them. It reads the depth the scene was
// drawn with (the target the scene went to carries it, for the lines a style
// draws) and makes the frame from layers at half its size:
//
//  - the base layer has what is in focus and what is behind the focus. A texel
//    behind the focus is blurred by taps of the texels that are as far behind it as
//    it is or farther (a sharper thing in front of it does not leak into it). Where
//    the frame has only what is in front of the focus the layer is filled in from
//    round it, so that under a blurred foreground there is the background and not
//    the foreground's own sharp pixels;
//  - the near layer has what is in front of the focus: a disc round each texel, of
//    its radius, and how much of the texel the discs cover, so that a blurred
//    foreground has a soft edge over what is sharp behind it. How far a texel looks
//    for such discs is the largest radius in the tiles about it;
//  - the frame at its own size is what is in focus. The base layer is laid over it
//    by how far from the focus each pixel is, and the near layer over that by how
//    much of the pixel it covers.
//
// A disc is sixteen taps on a spiral. What the frame carries in its alpha (the
// marks of render/style.js) is its own, and goes through as it is.
const TAPS = 16;
const SPIRAL = Array.from({ length: TAPS }, (_, k) => {
  const r = Math.sqrt((k + 0.5) / TAPS);
  const a = k * 2.399963229728653;
  return [r * Math.cos(a), r * Math.sin(a)];
});
const spiral = (body) => SPIRAL.map(([x, y]) => `{ ${body(`vec2(${x.toFixed(5)}, ${y.toFixed(5)})`)} }`).join('\n    ');

// The distance a pick packs into four bytes, over which the packing is a share.
const PACK = 16384;

const DOF_VERTEX = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

// How far, in metres along the lens's axis, a point is, from the depth buffer's
// value; and the radius of its disc in the frame's pixels.
const DOF_DEPTH = /* glsl */`
  float viewDepth(float zb) {
    float n = uNearFar.x;
    float f = uNearFar.y;
    return 2.0 * n * f / (f + n - (zb * 2.0 - 1.0) * (f - n));
  }
`;
const DOF_DISC = /* glsl */`
  float discAt(float zb) {
    return clamp(uLens.x * (uLens.y - 1.0 / viewDepth(zb)), -uLens.z, uLens.z);
  }
`;

// Full size to half: the base layer (rgb the colour of the pixels of the four that
// are in focus or behind it, a the radius of their discs in the half-size texel's pixels,
// positive behind the focus) and the near layer (rgb the colour of the pixels in front
// of the focus, a the radius of theirs, 0 where there is none). A texel that is
// wholly in front of the focus has nothing in the base layer: its alpha is NONE less
// the radius to fill it to. Light is weighed as 1 / (1 + luma), so that one very
// bright pixel does not make a sixteenth of a disc of itself.
const DOF_PREFILTER = /* glsl */`
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 uFull;
  uniform vec2 uNearFar;
  uniform vec4 uLens;
  uniform vec2 uZone;
  uniform float uLayer;
  varying vec2 vUv;
  const float NONE = -100.0;
  ${DOF_DEPTH}
  ${DOF_DISC}

  void main() {
    ivec2 h = ivec2(gl_FragCoord.xy);
    ivec2 last = ivec2(uFull) - 1;
    bool wantNear = uLayer > 0.5;
    vec3 sum = vec3(0.0);
    float wsum = 0.0;
    float rsum = 0.0;
    float nsum = 0.0;
    float ncount = 0.0;
    for (int k = 0; k < 4; k++) {
      ivec2 q = min(h * 2 + ivec2(k % 2, k / 2), last);
      vec3 c = texelFetch(tColor, q, 0).rgb;
      c = (c.r >= 0.0 && c.g >= 0.0 && c.b >= 0.0) ? min(c, vec3(32.0)) : vec3(0.0);
      float r = discAt(texelFetch(tDepth, q, 0).r);
      bool isNear = r < -uZone.x;
      if (isNear) {
        nsum -= r;
        ncount += 1.0;
      }
      if (isNear == wantNear) {
        float w = 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722)));
        sum += c * w;
        wsum += w;
        rsum += (wantNear ? -r : r) * w;
      }
    }
    if (wsum > 0.0) gl_FragColor = vec4(sum / wsum, 0.5 * rsum / wsum);
    else if (wantNear) gl_FragColor = vec4(0.0);
    else gl_FragColor = vec4(0.0, 0.0, 0.0, NONE - 0.5 * nsum / ncount);
  }
`;

// The largest radius of the near layer in each square of four by four texels.
const DOF_TILES = /* glsl */`
  uniform sampler2D tNear;
  uniform vec2 uHalf;

  void main() {
    ivec2 t = ivec2(gl_FragCoord.xy) * 4;
    ivec2 last = ivec2(uHalf) - 1;
    float m = 0.0;
    for (int y = 0; y < 4; y++) {
      for (int x = 0; x < 4; x++) m = max(m, texelFetch(tNear, min(t + ivec2(x, y), last), 0).a);
    }
    gl_FragColor = vec4(m, 0.0, 0.0, 1.0);
  }
`;

// The base layer, blurred: a texel behind the focus is the mean of the sixteen
// taps of a disc of its own radius, of the texels that are as far from the focus
// as it is (from a third of its radius to nine tenths of it, a tap counts for more
// and more), and one that has nothing of the base is the mean of the texels about it
// that have. Its alpha is its radius, negative where it was filled in; NONE where
// there was nothing to fill it with.
const DOF_BASE = /* glsl */`
  uniform sampler2D tBase;
  uniform vec2 uHalf;
  uniform vec2 uZone;
  const float NONE = -100.0;

  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    ivec2 last = ivec2(uHalf) - 1;
    vec4 c = texelFetch(tBase, p, 0);
    bool empty = c.a < -50.0;
    float R = empty ? NONE - c.a : c.a;
    if (!empty && R < 0.5 * uZone.x) {
      gl_FragColor = c;
      return;
    }
    vec3 sum = vec3(0.0);
    float wsum = 0.0;
    ${spiral((o) => `
      vec4 t = texelFetch(tBase, clamp(p + ivec2(floor(${o} * R + 0.5)), ivec2(0), last), 0);
      float w = t.a < -50.0 ? 0.0 : (empty ? 1.0 : smoothstep(0.35 * R, 0.9 * R, t.a));
      sum += t.rgb * w;
      wsum += w;`)}
    if (wsum > 1e-4) gl_FragColor = vec4(sum / wsum, empty ? -R : c.a);
    else gl_FragColor = empty ? vec4(0.0, 0.0, 0.0, c.a) : c;
  }
`;

// The near layer, blurred: round each texel the taps of a disc as large as the
// largest radius there is within reach of it (the tiles round it), and a tap
// that is in front of the focus counts as far as its own disc reaches the texel.
// What comes out is the colour of those, and how much of the texel they cover (the
// area of each one's disc over the area of the discs the taps stand for, less what
// the discs have not grown past the zone's first radius), as premultiplied colour.
const DOF_NEAR = /* glsl */`
  uniform sampler2D tNear;
  uniform sampler2D tTiles;
  uniform vec2 uHalf;
  uniform vec2 uTiles;
  uniform vec4 uLens;
  uniform vec2 uZone;

  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    ivec2 last = ivec2(uHalf) - 1;
    ivec2 lastTile = ivec2(uTiles) - 1;
    ivec2 tp = p / 4;
    float D = 0.0;
    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) D = max(D, texelFetch(tTiles, clamp(tp + ivec2(x, y), ivec2(0), lastTile), 0).r);
    }
    D = min(D, 0.5 * uLens.z);
    if (D < 0.5) {
      gl_FragColor = vec4(0.0);
      return;
    }
    vec3 sum = vec3(0.0);
    float wsum = 0.0;
    float cover = 0.0;
    float radii = 0.0;
    ${spiral((o) => `
      vec2 at = floor(${o} * D + 0.5);
      vec4 t = texelFetch(tNear, clamp(p + ivec2(at), ivec2(0), last), 0);
      float reach = t.a > 0.0 ? clamp(t.a - length(at) + 1.0, 0.0, 1.0) : 0.0;
      sum += t.rgb * reach;
      wsum += reach;
      radii += t.a * reach;
      cover += reach / max(t.a * t.a, 1.0);`)}
    // The discs come in as they grow from the zone's first radius to its second, as what is
    // behind the focus does (the base layer is laid over a pixel by the pixel's own radius).
    float fade = smoothstep(0.5 * uZone.x, 0.5 * uZone.y, wsum > 1e-4 ? radii / wsum : 0.0);
    float alpha = clamp(cover * D * D * ${(1 / TAPS).toFixed(5)}, 0.0, 1.0) * fade;
    vec3 col = wsum > 1e-4 ? sum / wsum : vec3(0.0);
    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

// The frame, with the layers over it. A pixel that is not in focus has the base layer
// laid over it by how far from the focus it is, the base taken from the four texels
// about it by how near each is to the pixel in the bilinear way and in how far from the
// focus it is (a pixel next to a sharp one in front of it does not take the sharp one's
// texels); the near layer is then laid over that, twice as hard as it covers, so that
// the silhouette of a blurred foreground is in the foreground and its soft edge is
// outside it.
const DOF_COMPOSE = /* glsl */`
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform sampler2D tFar;
  uniform sampler2D tNearBlur;
  uniform vec2 uHalf;
  uniform vec2 uNearFar;
  uniform vec4 uLens;
  uniform vec2 uZone;
  varying vec2 vUv;
  ${DOF_DEPTH}
  ${DOF_DISC}

  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec4 s = texelFetch(tColor, p, 0);
    float disc = discAt(texelFetch(tDepth, p, 0).r);
    vec3 col = s.rgb;
    // A texel of the half-size layers is two pixels across: its middle is between two pixels.
    vec2 hp = (vec2(p) - 0.5) * 0.5;
    float w = smoothstep(uZone.x, uZone.y, abs(disc));
    if (w > 0.0) {
      vec2 f0 = floor(hp);
      vec2 fr = hp - f0;
      ivec2 i0 = ivec2(f0);
      ivec2 last = ivec2(uHalf) - 1;
      float want = 0.5 * disc;
      vec3 bsum = vec3(0.0);
      float bw = 0.0;
      vec3 psum = vec3(0.0);
      float pw = 0.0;
      for (int k = 0; k < 4; k++) {
        ivec2 d = ivec2(k % 2, k / 2);
        vec4 t = texelFetch(tFar, clamp(i0 + d, ivec2(0), last), 0);
        if (t.a < -50.0) continue;
        float b = (d.x == 1 ? fr.x : 1.0 - fr.x) * (d.y == 1 ? fr.y : 1.0 - fr.y);
        float dq = t.a - want;
        float like = b * exp(-dq * dq * 0.15);
        bsum += t.rgb * like;
        bw += like;
        psum += t.rgb * b;
        pw += b;
      }
      if (bw > 1e-4) col = mix(col, bsum / bw, w);
      else if (pw > 1e-4) col = mix(col, psum / pw, w);
    }
    vec4 nb = texture2D(tNearBlur, (hp + 0.5) / uHalf);
    if (nb.a > 0.002) col = mix(col, nb.rgb / nb.a, clamp(nb.a * 2.0, 0.0, 1.0));
    gl_FragColor = vec4(col, s.a);
  }
`;

// What is at a point of the frame: the distance of it, as packed into the four
// bytes of a pixel.
const DOF_PICK = /* glsl */`
  uniform sampler2D tDepth;
  uniform vec2 uAt;
  uniform vec2 uNearFar;
  varying vec2 vUv;
  ${DOF_DEPTH}

  vec4 pack(float v) {
    vec4 e = fract(v * vec4(1.0, 255.0, 65025.0, 16581375.0));
    e -= e.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
    return e;
  }

  void main() {
    gl_FragColor = pack(clamp(viewDepth(texture2D(tDepth, uAt).r) / ${PACK.toFixed(1)}, 0.0, 0.99999));
  }
`;

// The programs' sources, for the check that the discs are sixteen taps.
export const DOF_SHADERS = {
  prefilter: DOF_PREFILTER, tiles: DOF_TILES, base: DOF_BASE, near: DOF_NEAR, compose: DOF_COMPOSE, pick: DOF_PICK, taps: TAPS,
};

class DofPass extends Pass {
  constructor(tap, camera) {
    super();
    this.needsSwap = false;
    this.enabled = false;
    this.tap = tap;
    this.camera = camera;
    this.focus = 7;          // m, along the lens's axis
    this.aperture = 2.8;     // the f-number
    this.want = false;       // asked for: it begins when its programs are built
    this.ready = false;      // it has drawn this frame: `out` is the frame
    this.size = [1, 1];      // the frame's, in pixels
    const layer = (filter) => new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, depthBuffer: false, minFilter: filter, magFilter: filter,
    });
    this.nearIn = layer(THREE.NearestFilter);
    this.baseIn = layer(THREE.NearestFilter);
    this.tiles = layer(THREE.NearestFilter);
    this.baseOut = layer(THREE.NearestFilter);
    this.nearOut = layer(THREE.LinearFilter);
    // The frame with the layers over it, at the frame's size: what the final pass grades.
    this.out = layer(THREE.NearestFilter);
    this.nearIn.texture.name = 'Dof.nearIn';
    this.baseIn.texture.name = 'Dof.baseIn';
    this.tiles.texture.name = 'Dof.tiles';
    this.baseOut.texture.name = 'Dof.baseOut';
    this.nearOut.texture.name = 'Dof.nearOut';
    this.out.texture.name = 'Dof.out';
    // A pick reads one pixel of eight bits.
    this.pixel = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.pixel.texture.name = 'Dof.pick';
    this.bytes = new Uint8Array(4);
    const slot = (value) => ({ value });
    const u = {
      tColor: slot(null),
      tDepth: slot(null),
      uFull: slot(new THREE.Vector2(1, 1)),
      uHalf: slot(new THREE.Vector2(1, 1)),
      uTiles: slot(new THREE.Vector2(1, 1)),
      uNearFar: slot(new THREE.Vector2(0.3, 14000)),
      // K, 1 / the focus distance, the largest radius (pixels)
      uLens: slot(new THREE.Vector4(0, 1 / 7, 20, 0)),
      uZone: slot(new THREE.Vector2(1, 3)),
      uLayer: slot(0),
    };
    this.uniforms = u;
    const make = (fragmentShader, uniforms) => new THREE.ShaderMaterial({
      uniforms, vertexShader: DOF_VERTEX, fragmentShader, depthTest: false, depthWrite: false,
    });
    this.at = slot(new THREE.Vector2(0.5, 0.5));
    this.materials = {
      prefilter: make(DOF_PREFILTER, { tColor: u.tColor, tDepth: u.tDepth, uFull: u.uFull, uNearFar: u.uNearFar, uLens: u.uLens, uZone: u.uZone, uLayer: u.uLayer }),
      tiles: make(DOF_TILES, { tNear: slot(this.nearIn.texture), uHalf: u.uHalf }),
      base: make(DOF_BASE, { tBase: slot(this.baseIn.texture), uHalf: u.uHalf, uZone: u.uZone }),
      near: make(DOF_NEAR, { tNear: slot(this.nearIn.texture), tTiles: slot(this.tiles.texture), uHalf: u.uHalf, uTiles: u.uTiles, uLens: u.uLens, uZone: u.uZone }),
      compose: make(DOF_COMPOSE, {
        tColor: u.tColor, tDepth: u.tDepth, tFar: slot(this.baseOut.texture), tNearBlur: slot(this.nearOut.texture),
        uHalf: u.uHalf, uNearFar: u.uNearFar, uLens: u.uLens, uZone: u.uZone,
      }),
      pick: make(DOF_PICK, { tDepth: u.tDepth, uAt: this.at, uNearFar: u.uNearFar }),
    };
    this.quad = new FullScreenQuad(this.materials.prefilter);
    this._warm = null;
  }

  setSize(w, h) {
    this.size = [w, h];
    this.fit();
  }

  // The layers are the frame's size (and half of it) while the pass is on, and a
  // pixel when it is not: they are half-float frames (16 MB at 1080p, and twice that
  // again for the layers), and a pass that is off has no use for them.
  fit() {
    const [w, h] = this.enabled ? this.size : [1, 1];
    const hw = Math.max(1, Math.ceil(w / 2));
    const hh = Math.max(1, Math.ceil(h / 2));
    const tw = Math.max(1, Math.ceil(hw / 4));
    const th = Math.max(1, Math.ceil(hh / 4));
    this.out.setSize(w, h);
    for (const t of [this.nearIn, this.baseIn, this.baseOut, this.nearOut]) t.setSize(hw, hh);
    this.tiles.setSize(tw, th);
    this.uniforms.uFull.value.set(w, h);
    this.uniforms.uHalf.value.set(hw, hh);
    this.uniforms.uTiles.value.set(tw, th);
  }

  // Build the programs ahead, as they are drawn (to a target), in the compiler's
  // threads; resolves when they are built. Built once.
  warm(renderer) {
    if (this._warm) return this._warm;
    const scene = new THREE.Scene();
    const geometry = new THREE.PlaneGeometry(2, 2);
    for (const m of Object.values(this.materials)) scene.add(new THREE.Mesh(geometry, m));
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const pixel = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    const was = renderer.getRenderTarget();
    renderer.setRenderTarget(pixel);
    let built;
    try {
      built = renderer.compileAsync ? renderer.compileAsync(scene, camera) : (renderer.compile(scene, camera), Promise.resolve());
    } finally {
      renderer.setRenderTarget(was);
    }
    this._warm = built.then(() => {
      pixel.dispose();
      geometry.dispose();
    });
    return this._warm;
  }

  _draw(renderer, material, target) {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }

  render(renderer, writeBuffer, readBuffer) {
    this.ready = false;
    const depth = this.tap.target ? this.tap.target.depthTexture : null;
    if (!depth) return;
    const u = this.uniforms;
    const cam = this.camera;
    const m = this.materials;
    const frame = this.size[1];
    u.uLens.value.set(lensK(frame, 1 / cam.projectionMatrix.elements[5], Math.max(this.aperture, 0.1)), 1 / Math.max(this.focus, 0.05), LENS.max * frame, 0);
    u.uZone.value.set(LENS.zone[0] * frame, LENS.zone[1] * frame);
    u.uNearFar.value.set(cam.near, cam.far);
    u.tColor.value = readBuffer.texture;
    u.tDepth.value = depth;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    u.uLayer.value = 1;
    this._draw(renderer, m.prefilter, this.nearIn);
    u.uLayer.value = 0;
    this._draw(renderer, m.prefilter, this.baseIn);
    this._draw(renderer, m.tiles, this.tiles);
    this._draw(renderer, m.base, this.baseOut);
    this._draw(renderer, m.near, this.nearOut);
    this._draw(renderer, m.compose, this.out);
    renderer.autoClear = auto;
    this.ready = true;
  }

  // The distance, in metres along the lens's axis, of what is at (u, v) of the
  // frame last drawn (0 to 1, from its lower left corner); NaN where there is none.
  pick(renderer, u, v) {
    const depth = this.tap.target ? this.tap.target.depthTexture : null;
    if (!depth || !(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return NaN;
    this.uniforms.tDepth.value = depth;
    this.uniforms.uNearFar.value.set(this.camera.near, this.camera.far);
    this.at.value.set(Math.min(u, 0.999999), Math.min(v, 0.999999));
    const was = renderer.getRenderTarget();
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    this._draw(renderer, this.materials.pick, this.pixel);
    renderer.readRenderTargetPixels(this.pixel, 0, 0, 1, 1, this.bytes);
    renderer.setRenderTarget(was);
    renderer.autoClear = auto;
    const [a, b, c, d] = this.bytes;
    return (a / 255 + b / 65025 + c / 16581375 + d / 4228250625) * PACK;
  }

  dispose() {
    for (const m of Object.values(this.materials)) m.dispose();
    for (const t of [this.nearIn, this.baseIn, this.tiles, this.baseOut, this.nearOut, this.out, this.pixel]) t.dispose();
  }
}

// What a card gives when it cannot make a target: out of memory, a frame
// buffer that is not complete, a context that is gone. The errors it has
// given since the last call, by these names (the others are let go).
const CARD_FAILED = new Map([[0x0505, 'out of memory'], [0x0506, 'frame buffer not complete'], [0x9242, 'context lost']]);

function cardErrors(gl) {
  const told = [];
  for (let n = 0, e = gl.getError(); e !== gl.NO_ERROR && n < 32; n++, e = gl.getError()) {
    const name = CARD_FAILED.get(e);
    if (name && !told.includes(name)) told.push(name);
  }
  return told;
}

// Whether anything has been drawn in a picture's pixels (a frame buffer that
// is not complete leaves them as they were made, zero): a sample of them.
function lit(pixels) {
  for (let i = 0; i < pixels.length; i += 4 * 251 + 1) {
    if (pixels[i] | pixels[i + 1] | pixels[i + 2] | pixels[i + 3]) return true;
  }
  return false;
}

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
    // While a picture is made (capture): how many pixels the frame has,
    // instead of the canvas's, and how many times as tall as the frame on the
    // screen it is, which the style's widths in pixels go by.
    this._shot = null;
    this.zoom = 1;
    this._style = null;
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
    // The real style's ambient occlusion (render/ao.js): not in the chain in every other style
    // and in the low tier; where it is on it darkens the frame where it stands, before the bloom.
    this.ao = new AoPass(renderer, this.tap, camera);
    this.composer.addPass(this.ao);
    // The contact shadow (the real style's, in the high tier), on the linear frame.
    this.contact = new ContactPass(camera);
    this.composer.addPass(this.contact);
    this.contactOn = true;
    this.contactLight = 1;
    // The real style's light shafts (render/shafts.js): nothing is drawn for them while the sun is
    // far out of the frame, in every other style and in the low tier; where they are on they add
    // light to the frame where the sun's glare is, before the bloom.
    this.shafts = new ShaftPass(renderer, this.tap, camera);
    this.composer.addPass(this.shafts);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.6, 1.1);
    this.ao.bloom = this.bloom;
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
    // The depth of field (the photo mode's): not in the frame at all while it is
    // off, nothing built and nothing drawn for it. On, it draws the frame into a
    // target of its own and the final pass grades that (render/photo.js).
    this.dof = new DofPass(this.tap, camera);
    this.composer.addPass(this.dof);
    this.final = new FinalPass(FinalShader);
    this.final.source = this.dof;
    this.final.renderToScreen = true;
    this.composer.addPass(this.final);
    this.ao.bind(this.final.uniforms.uExposure);
    this.shafts.bind(this.final.uniforms.uExposure);
    // A style's own pass (render/style.js), last when there is one.
    this.stylePass = new StylePass(this.tap);
    this.stylePass.enabled = false;
    this.composer.addPass(this.stylePass);
    // The pixel style's pass, after a style's own (a change to or from it has both on),
    // and what its frame is made of: how far into the style the frame is, in steps (the
    // scene is a different size at each), and its grid of cells when there is one.
    this.pixelPass = new PixelPass(this.tap, this.stylePass);
    this.composer.addPass(this.pixelPass);
    this._level = 0;
    this._rows = 180;
    this._grid = null;
    this._canvas = new THREE.Vector2();
    this._probe = new THREE.Vector2();
    // The last of all (render/present.js): clean edges, crisp detail, and the
    // frame brought up to the canvas's size when it was drawn smaller.
    this.present = new PresentPass();
    this.present.after = [this.pixelPass, this.stylePass];
    this.present.enabled = false;
    this.composer.addPass(this.present);
    this._bloomOn = true;
    this._frames = 0;
    this.deferWarm = false; // the style pass's programs are built by someone else, later
    this.fade = 0;          // seconds into the current dissolve
    this.fadeLength = 0;
    // The light the final pass multiplies by is the world's exposure and the
    // style's (_base), and over it the lens's compensation (ev, in stops).
    this._base = this.final.uniforms.uExposure.value;
    this._ev = 0;
    this.comp = 1;
    // The share of the world's exposure the real style takes (the look's
    // realExpose, written by the game with the light of each frame).
    this.realExpose = 1;
    // Whether a frame has been drawn since the chain last changed size: the
    // depth a pick reads is that frame's.
    this._drawn = false;
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
    this._drawn = false;
    // The canvas's own pixels, and the scene's: a fraction of them, or in the pixel
    // style k of them to each cell of its grid, across and up.
    const out = this._shot || this.renderer.getDrawingBufferSize(this._out);
    this.present.outSize.copy(out);
    const grid = this._gridOn(out);
    this._grid = grid;
    if (grid) this.size.set(grid.cols * grid.k, grid.rows * grid.k);
    else this.size.set(Math.max(1, Math.round(out.x * this.scale)), Math.max(1, Math.round(out.y * this.scale)));
    this.composer.setSize(this.size.x, this.size.y);
    // The frame the last pass lays out is the grid's, not the scene's.
    this.pixelPass.fit(grid);
    if (grid) this.present.inSize.set(grid.cols, grid.rows);
    this.present.block = grid ? grid.block : 0;
  }

  // The pixel style's grid on a frame `out` pixels across: the screen's own, from the
  // canvas (render/style.js, pixelGrid), and in a picture of the frame the same cells in
  // as many pixels more.
  _gridOn(out, level = this._level, rows = this._rows) {
    if (level <= 0) return null;
    const cv = this.renderer.getDrawingBufferSize(this._canvas);
    const grid = pixelGrid(cv.x, cv.y, rows, level);
    if (!this._shot) return grid;
    const block = Math.max(1, Math.round(grid.block * out.y / cv.y));
    return { block, cols: Math.ceil(out.x / block), rows: Math.ceil(out.y / block), k: Math.min(2, block) };
  }

  // How far into the pixel style the frame is, in steps (0: none).
  get pixelLevel() {
    return this._level;
  }

  // The height the scene is drawn at under a style's numbers, which is what setStyle makes of
  // the chain at the end of a frame: for what is worked out before that, such as the pixels the
  // small things in the air are sized in and the trees' levels of detail. A style put on at
  // once, as a tool does, has not reached the chain yet, and the chain's own height is still
  // that of the style before.
  heightFor(style) {
    const c = style.now;
    const out = this._shot || this.renderer.getDrawingBufferSize(this._probe);
    const level = pixelLevel(c.pixel);
    if (level <= 0) return Math.max(1, Math.round(out.y * this.scale));
    const grid = this._gridOn(out, level, c.rows);
    return grid.rows * grid.k;
  }

  // Draw the scene at this fraction (0 to 1) of the canvas's size.
  setScale(s) {
    this.scale = s;
    if (this._css[0]) this.setSize(this._css[0], this._css[1]);
  }

  // The world's exposure; a style's own (expose) is laid on it in setStyle.
  set exposure(v) {
    this._exposure = v;
    this._lit(v * (this._expose || 1));
  }

  get exposure() {
    return this._exposure === undefined ? this._base : this._exposure;
  }

  // The light the final pass multiplies the frame by: what the world and the
  // style give (base), and the lens's compensation over it.
  _lit(base) {
    this._base = base;
    this.final.uniforms.uExposure.value = base * this.comp;
  }

  // The lens's exposure compensation, in stops: the frame is made with 2 to the
  // EV times the light. It is laid on what the world's light is each frame
  // (Game._light writes the exposure after it), and not on the painted sky's
  // own (which is divided by the exposure, so that it comes out as written):
  // the sky takes the compensation as everything else does.
  set ev(v) {
    this._ev = v;
    this.comp = 2 ** v;
    this.final.uniforms.uExposure.value = this._base * this.comp;
  }

  get ev() {
    return this._ev;
  }

  setBloom(on) {
    this._bloomOn = on;
    this.bloom.enabled = on;
  }

  // The contact shadow on or off (the high tier has it).
  setContact(on) {
    this.contactOn = !!on;
  }

  // Draw in a style (render/style.js): its last pass on when it has one,
  // and the scene's alpha handed on to it when the car marks itself.
  setStyle(style) {
    // The style's numbers as this world has them: some of them go by how
    // much of a painted sky the world has (render/style.js, night).
    style.sync();
    this._style = style;
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
    this._expose = c.expose * (1 + (this.realExpose - 1) * c.real);
    const expo = (this._exposure === undefined ? this._base : this._exposure) * this._expose;
    this._lit(expo);
    this.final.uniforms.uCurve.value = c.curve;
    this.final.uniforms.uVignette.value = FINAL_VIGNETTE * c.finalVignette;
    this.final.uniforms.uDarks.value = c.darks;
    this.ao.set(c.real, style.tier, !this.deferWarm);
    this.shafts.set(c.shafts, style.tier, !this.deferWarm);
    skyStyle.uPaintInv.value = 1 / expo;
    this.stylePass.enabled = on;
    this.contact.strength = this.contactOn ? c.real * this.contactLight : 0;
    this.contact.enabled = this.contact.strength > 0.002;
    this.stylePass.setFlat(c.flat > 0);
    // The pixel style: how far into it, in steps, and the scene at the size of that step.
    const level = pixelLevel(c.pixel);
    if (level !== this._level || c.rows !== this._rows) {
      this._level = level;
      this._rows = c.rows;
      if (this._css[0]) this.setSize(this._css[0], this._css[1]);
    }
    this.pixelPass.enabled = level > 0;
    if (level > 0) {
      const pu = this.pixelPass.uniforms;
      pu.uPixel.value = c.pixel;
      pu.uDitherK.value = c.ditherK;
      pu.uSat.value = c.pixelSat;
      pu.uNearFar.value.set(this.camera.near, this.camera.far);
    }
    this.bloom.enabled = this._bloomOn && c.bloom > 0.5;
    this.final.uniforms.uPassAlpha.value = (on && (c.mark > 0.5 || c.bokashi > 0.5)) || level > 0 ? 1 : 0;
    // How clean and how crisp, and whether the last pass has anything to do.
    const p = this.present;
    p.aa = c.aa;
    p.sharp = c.sharp;
    p.enabled = p.needed || level > 0;
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
    const zoom = this.zoom;
    style.applyPass(u, zoom === 1 ? size.y : size.y / zoom, this.camera.fov);
    if (zoom !== 1) {
      // A picture of the frame on the screen at more pixels: what the style
      // gives in pixels (a stroke's reach, the flat colour's, a line's width)
      // is the screen's, as many times over as the frame is taller,
      // so that the picture is the screen's frame, finer, and not a frame
      // of finer strokes.
      u.uPaintR.value *= zoom;
      u.uFlatR.value *= zoom;
      u.uLineW.value *= zoom;
      u.uCunPx.value *= zoom;
      u.uInkLine.value.w *= zoom;
      u.uRegist.value *= zoom;
      u.uSnapR.value *= zoom;
    }
  }

  // The frame as it was last drawn, drawn again at width by height pixels into
  // a target of its own and read back: RGBA, eight bits, the bottom row
  // first. The canvas is not touched: what each pass that ends the chain draws
  // to the canvas goes to the target. For the length of the call the chain is
  // the size of the picture (the scene at its full size, whatever the screen's
  // was) and then it is as it was. A card that cannot make the targets (a
  // size past what a texture may be, no memory left for them) gives errors and
  // frame buffers that are not complete, and no exception; this throws then,
  // and not a picture of nothing.
  capture(width, height) {
    const style = this._style;
    if (!style) throw new Error('no frame has been drawn');
    const renderer = this.renderer;
    const gl = renderer.getContext();
    const target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false });
    target.texture.name = 'Post.capture';
    const pixels = new Uint8Array(width * height * 4);
    const was = { css: this._css, scale: this.scale, zoom: this.zoom, shot: this._shot, tall: this.size.y };
    const setTarget = renderer.setRenderTarget;
    cardErrors(gl);
    try {
      this._shot = new THREE.Vector2(width, height);
      this.scale = 1;
      this.zoom = height / was.tall;
      this.setSize(was.css[0], was.css[1]);
      this.setStyle(style);
      renderer.setRenderTarget = (to, ...rest) => setTarget.call(renderer, to === null ? target : to, ...rest);
      this.composer.render(0);
      renderer.setRenderTarget = setTarget;
      renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
      const failed = cardErrors(gl);
      if (gl.isContextLost() && !failed.includes('context lost')) failed.push('context lost');
      if (failed.length) throw new Error(`a picture of ${width} x ${height} could not be made (${failed.join(', ')})`);
      if (!lit(pixels)) throw new Error(`a picture of ${width} x ${height} came back empty`);
    } finally {
      renderer.setRenderTarget = setTarget;
      renderer.setRenderTarget(null);
      this._shot = was.shot;
      this.scale = was.scale;
      this.zoom = was.zoom;
      this.setSize(was.css[0], was.css[1]);
      target.dispose();
    }
    return { width, height, pixels };
  }

  render(dt) {
    // The style pass's programs and the pixel style's, built ahead a moment after
    // the first frames (the scene's own are built then too, at the second). A page
    // that has a queue for after its first frame does it there (Game.settle).
    if (++this._frames === 3 && !this.deferWarm) {
      this.stylePass.warm(this.renderer);
      this.pixelPass.warm(this.renderer);
    }
    const d = this.dissolvePass;
    if (this.fadeLength > 0) {
      this.fade += dt;
      const t = Math.min(1, this.fade / this.fadeLength);
      d.mix = 1 - t * t * (3 - 2 * t);
      if (t >= 1) this.fadeLength = 0;
    } else {
      d.mix = 0;
    }
    this.ao.advance(dt);
    this.shafts.advance(dt);
    this.composer.render(dt);
    this._drawn = true;
  }

  // The depth of field on or off. Coming on the first time, its programs are
  // built ahead (compileAsync) and it begins when they are, so that no frame
  // waits for them. Resolves with whether it is on.
  async setDof(on) {
    const d = this.dof;
    d.want = !!on;
    if (!d.want) {
      d.enabled = false;
      d.ready = false;
      d.fit();
      return false;
    }
    if (d.enabled) return true;
    let timer = 0;
    const late = new Promise((resolve) => { timer = setTimeout(resolve, 10000); });
    try {
      await Promise.race([d.warm(this.renderer), late]);
    } finally {
      clearTimeout(timer);
    }
    if (!d.want) return false;
    d.enabled = true;
    d.fit();
    return true;
  }

  // How far, in metres along the lens's axis, what is at (u, v) of the frame last
  // drawn is (0 to 1 from its lower left corner); NaN where there is no such
  // frame (the chain has changed size since, or none has been drawn).
  pickDistance(u, v) {
    return this._drawn ? this.dof.pick(this.renderer, u, v) : NaN;
  }
}
