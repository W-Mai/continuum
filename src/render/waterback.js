// The frame as it stands when the water is about to be drawn, at half its size, for the water to read: how far off the
// nearest thing is in each texel and how far the farthest of the four pixels the texel stands for (so the water can tell
// how deep it is over what lies under it, and where the shore is), and, where the frame is to be reflected, what the
// frame holds there (its colour).
//
// The frame is taken at the moment the water's mesh is drawn (Water, onBeforeRender): what is behind the water and
// what stands round it is in the frame by then, the water is not, and the scene's own target is neither read nor drawn
// into while it is read (a texture cannot be read and drawn into at once, so the depth the water reads is a copy).
//
// Two draws: the distances (a pass over the scene's depth, at half the size) and the colour (the frame, the four
// pixels of each texel averaged by the filter that reads it). Nothing is drawn where the frame is not taken.

import * as THREE from 'three';
import { FullScreenQuad } from '../../tools/vendor/postprocessing/Pass.js';

// What the distance of the sky is.
export const BACK_SKY = 6.0e4;

const VERTEX = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }';

const DIST = /* glsl */`
  uniform sampler2D tDepth;
  uniform vec2 uNearFar;
  uniform vec2 uFull;

  float linearDepth( float zb ) {
    float n = uNearFar.x;
    float f = uNearFar.y;
    return 2.0 * n * f / ( f + n - ( zb * 2.0 - 1.0 ) * ( f - n ) );
  }

  void main() {
    ivec2 q = ivec2( gl_FragCoord.xy ) * 2;
    ivec2 last = ivec2( uFull ) - 1;
    float lo = ${BACK_SKY.toFixed(1)};
    float hi = 0.0;
    for ( int k = 0; k < 4; k++ ) {
      float zb = texelFetch( tDepth, min( q + ivec2( k & 1, k >> 1 ), last ), 0 ).r;
      float z = zb >= 0.999995 ? ${BACK_SKY.toFixed(1)} : linearDepth( zb );
      lo = min( lo, z );
      hi = max( hi, z );
    }
    gl_FragColor = vec4( lo, hi, 0.0, 1.0 );
  }
`;

const COLOUR = /* glsl */`
  uniform sampler2D tColor;
  uniform vec2 uFull;

  void main() {
    // The middle of the four pixels of a texel: the filter takes their mean.
    vec3 c = texture2D( tColor, gl_FragCoord.xy * 2.0 / uFull ).rgb;
    c = ( c.r >= 0.0 && c.g >= 0.0 && c.b >= 0.0 ) ? min( c, vec3( 64.0 ) ) : vec3( 0.0 );
    gl_FragColor = vec4( c, 1.0 );
  }
`;

export class WaterBack {
  constructor() {
    const slot = (value) => ({ value });
    this.uniforms = {
      tDepth: slot(null),
      tColor: slot(null),
      uNearFar: slot(new THREE.Vector2(0.3, 14000)),
      uFull: slot(new THREE.Vector2(1, 1)),
    };
    const make = (fragmentShader) => new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader, depthTest: false, depthWrite: false,
    });
    this.materials = { dist: make(DIST), colour: make(COLOUR) };
    this.quad = new FullScreenQuad(this.materials.dist);
    // Made at the first frame taken, when the card is known (the distance is kept whole where a 32-bit target can be drawn to).
    this.dist = null;
    this.colour = null;
    this.size = [0, 0];
    this.taken = 0;       // how many frames have been taken, and in how many of them the colour (a check counts them)
    this.coloured = 0;
  }

  _make(renderer) {
    const full = !!(renderer.extensions && renderer.extensions.has('EXT_color_buffer_float'));
    this.dist = new THREE.WebGLRenderTarget(1, 1, {
      type: full ? THREE.FloatType : THREE.HalfFloatType,
      format: full ? THREE.RGFormat : THREE.RGBAFormat,
      depthBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    this.dist.texture.name = 'Water.back.distance';
    // With the smaller copies of it (the mips), for the rougher the water, the blurrier a reflection (render/waterlook.js).
    this.colour = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    });
    this.colour.texture.name = 'Water.back.colour';
  }

  // Half the size of a frame w x h pixels.
  static half(w, h) {
    return [Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(h / 2))];
  }

  // Take the frame `source` (the target the scene is being drawn into: its colour and its depth texture) at this
  // moment, for the lens `camera`; the colour only when `colour`. The target the caller was drawing into is set again.
  take(renderer, source, camera, colour) {
    if (!this.dist) this._make(renderer);
    const [hw, hh] = WaterBack.half(source.width, source.height);
    if (this.size[0] !== hw || this.size[1] !== hh) {
      this.dist.setSize(hw, hh);
      this.colour.setSize(hw, hh);
      this.size = [hw, hh];
    }
    const u = this.uniforms;
    u.tDepth.value = source.depthTexture;
    u.tColor.value = source.texture;
    u.uNearFar.value.set(camera.near, camera.far);
    u.uFull.value.set(source.width, source.height);
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    this._draw(renderer, this.materials.dist, this.dist);
    if (colour) {
      this._draw(renderer, this.materials.colour, this.colour);
      this.coloured++;
    }
    renderer.autoClear = auto;
    renderer.setRenderTarget(source);
    this.taken++;
  }

  // The two programs built ahead, as they are drawn (to a target), in the compiler's threads where the browser has them. Once.
  warm(renderer) {
    if (this._warmed) return this._warmed;
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
    this._warmed = built.then(() => {
      pixel.dispose();
      geometry.dispose();
    });
    return this._warmed;
  }

  _draw(renderer, material, target) {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }

  // How many pixels the two targets hold (for the cost the checks report).
  pixels() {
    return this.dist ? this.size[0] * this.size[1] * 2 : 0;
  }

  dispose() {
    for (const m of Object.values(this.materials)) m.dispose();
    if (this.dist) this.dist.dispose();
    if (this.colour) this.colour.dispose();
    this.dist = null;
    this.colour = null;
    this.size = [0, 0];
  }
}
