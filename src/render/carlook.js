// What the real style does to the car, and only the real style: the paint is a
// metallic base coat with flakes in it under a clear coat, the glass lets the
// cabin be seen and keeps its reflections, the tyres are rubber with lettering
// and a tread, the aero discs are brushed, the lamps are lit by the light of
// the world, and the air behind the thrusters is bent by their heat.
//
// The model and its materials are made in game.js (loadCar) and the car's body
// and wheels are moved in render/presentation.js; this adds to what they have.
// Everything here is read through `real`, the style's own number between 0 and
// 1 (render/style.js), and at 0 every material has the numbers it had before,
// every shader branch is not taken and the heat is not drawn, so that the
// other styles draw the car as they did, bit for bit.
//
// The tiers (render/quality.js): the high and middle tier have all of it; the
// low tier has the clear coat, the glass and the lamps and nothing else (no
// flakes, no lettering, no brushing, no heat), and draws the car for no more than
// the other styles do.

import * as THREE from 'three';
import { FullScreenQuad } from '../../tools/vendor/postprocessing/Pass.js';
import { twistU } from './twist.js';
import { pairProgram } from './style.js';

export const CAR_LOOK = {
  // The paint: the base coat's metal and roughness, the clear coat's roughness (the clear
  // coat itself is 1 in every style), and how much of the sky's light the paint takes
  // (its environment's strength: what the clear coat shows of the sky, and the base coat
  // of what is round it).
  paint: { metalness: 0.5, roughness: 0.35, coatRoughness: 0.04, env: 1.45 },
  // Flakes of metal in the base coat: the normal of each cell of the paint (mm, in the
  // model's own frame, so they stay on the car) is turned by up to `tilt` degrees, and
  // the flakes are gone from `fade[1]` m off, where a pixel is wider than a cell.
  flake: { cell: 0.3, tilt: 4, fade: [1.2, 3] },
  // The glass: how much of what is behind it is held back, and how much of the sky it
  // reflects; its reflections are not held back by the first.
  glass: { opacity: 0.4, env: 1.2 },
  // The cabin's materials are given this many times their own colour as light (what comes
  // in at the windows and off the inside of the roof), by the sky's light the world has: they
  // are leather, suede and carpet, and reflect a hundredth or two of what falls on them.
  cabin: 4,
  // How lit the head lamps are, in daylight and in the dark (the emissive's strength), and how
  // much of its own colour the lens keeps (a clear lens over a dark reflector shows the sky and
  // the sun in it and little of its own colour).
  lamp: { day: 0.06, night: 1.5, lens: 0.12 },
  // The tyre's lettering (mm round the axle: from, to; how many times it is round the
  // tyre), how far it stands out (m) and how much lighter (in linear light) the rubber is
  // where it does: rubber reflects a few thousandths of the light, the letters a few hundredths.
  tyre: { band: [287, 315], repeat: 3, rise: 0.0008, ink: 0.03, text: 'CONTINUUM  265/35R20  PERFORMANCE  ' },
  // The aero discs' brushing: the width of a groove (mm) and how far it turns the normal.
  brush: { cell: 2.0, tilt: 0.2 },
  // The heat of the thrusters: where its middle is (mm, in the model's frame), half its
  // size (m), the distance (m) it is drawn within and fades out over, how far it bends
  // the picture (pixels in a frame 1080 tall), the size of the swirls and how fast they move.
  haze: { at: [-2900, 430, 0], half: [0.75, 0.42], reach: [20, 30], bend: 2, scale: 3, speed: 0.9 },
};

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// A hash of a point of space, three numbers in 0 to 1 (nothing of the screen in it).
const HASH = /* glsl */`
vec3 clHash( vec3 p ) {
  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yxz + 33.33 );
  return fract( ( p.xxy + p.yxx ) * p.zyx );
}`;

// Chain a change of a material's shader onto the ones it has (as render/atmosphere.js
// does), and put it in the key of the program. The program of the paired paints (the
// styles that draw the car in flat paints, render/style.js) is left as it is: it has
// nothing of this to do. The uniforms are given to both programs all the same: three keeps
// the uniforms of the program it made last for a material, whichever of its programs is
// drawn, so a program that has some the other has not would not be given its own.
function patch(material, tag, uniforms, change) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    if (!pairProgram.on) change(shader);
  };
  const below = material.customProgramCacheKey;
  material.customProgramCacheKey = () => (below ? below.call(material) : '') + (pairProgram.on ? '' : '|' + tag);
  // (A material that has been drawn is built again.)
  material.needsUpdate = true;
}

// Put `text` after the first `anchor` of a shader (the anchor is kept); where there is no
// such anchor the shader is left as it is, and it is said.
function after(src, anchor, text, what) {
  if (!src.includes(anchor)) {
    console.warn(`continuum: carlook ${what}: no ${anchor} in the shader`);
    return src;
  }
  return src.replace(anchor, () => `${anchor}\n${text}`);
}

function before(src, anchor, text, what) {
  if (!src.includes(anchor)) {
    console.warn(`continuum: carlook ${what}: no ${anchor} in the shader`);
    return src;
  }
  return src.replace(anchor, () => `${text}\n${anchor}`);
}

// The 5 x 7 letters of the tyre's lettering, a row to a number (the bits are the columns).
const FONT = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  0: [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  2: [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  3: [0x1e, 0x01, 0x01, 0x0e, 0x01, 0x01, 0x1e],
  5: [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  6: [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '/': [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
  ' ': [0, 0, 0, 0, 0, 0, 0],
};
const CELL = 4;      // texels to a pixel of a letter, across and up
const PITCH = 6;     // pixels to a letter, with the gap
const ROWS = 9;      // pixels up the band: a blank one, the seven of a letter, a blank one

// The lettering as a picture, one channel, smooth (a letter's pixels each a blurred block),
// that runs round the tyre `repeat` times: every letter of the text in its place.
export function tyreLettering(text) {
  const n = text.length;
  const w = n * PITCH * CELL;
  const h = ROWS * CELL;
  const a = new Float32Array(w * h);
  for (let i = 0; i < n; i++) {
    const rows = FONT[text[i]] || FONT[' '];
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (!(rows[gy] & (1 << (4 - gx)))) continue;
        // The top of a letter is the high end of the band, which is the outer rim of the tyre.
        const y0 = (1 + (6 - gy)) * CELL;
        const x0 = (i * PITCH + gx) * CELL;
        for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) a[(y0 + y) * w + x0 + x] = 1;
      }
    }
  }
  // Two passes of a box over each way, across the text (which goes round) and up it.
  const b = new Float32Array(w * h);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let d = -1; d <= 1; d++) s += a[y * w + ((x + d + w) % w)];
        b[y * w + x] = s / 3;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let d = -1; d <= 1; d++) s += b[Math.min(h - 1, Math.max(0, y + d)) * w + x];
        a[y * w + x] = s / 3;
      }
    }
  }
  const bytes = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) bytes[i] = Math.round(clamp01(a[i] * 1.6) * 255);
  return { bytes, width: w, height: h };
}

// ---- the paint ----------------------------------------------------------------------

function flakes(material, u) {
  const F = CAR_LOOK.flake;
  const tan = Math.tan((F.tilt * Math.PI) / 180);
  patch(material, 'car-flake', { uFlake: u.uFlake, uFlakeRot: u.uFlakeRot }, (shader) => {
    shader.vertexShader = after(
      after(shader.vertexShader, '#include <common>', 'varying vec3 vFlakeP;', 'flake'),
      '#include <begin_vertex>', 'vFlakeP = position;', 'flake',
    );
    shader.fragmentShader = after(
      after(shader.fragmentShader, '#include <common>', `uniform float uFlake;
uniform mat3 uFlakeRot;
varying vec3 vFlakeP;
${HASH}`, 'flake'),
      '#include <normal_fragment_maps>', `// Flakes of metal in the base coat, under the clear coat (which keeps the normal it had
// before this): each cell of the model is turned a little, to a way of its own.
if ( uFlake > 0.0 ) {
  float flakeK = uFlake * ( 1.0 - smoothstep( ${F.fade[0].toFixed(2)}, ${F.fade[1].toFixed(2)}, length( vViewPosition ) ) );
  if ( flakeK > 0.0 ) {
    vec3 flakeTilt = uFlakeRot * ( clHash( floor( vFlakeP / ${F.cell.toFixed(3)} ) ) * 2.0 - 1.0 );
    flakeTilt -= normal * dot( flakeTilt, normal );
    normal = normalize( normal + flakeTilt * ( ${tan.toFixed(5)} * flakeK ) );
  }
}`, 'flake',
    );
  });
}

// ---- the glass ------------------------------------------------------------------------

// A glass that holds back some of what is behind it lets none of its own reflection
// through with it: the blend takes the glass's colour by its alpha, so the sky in it is
// made brighter by that much (and comes out as it is).
function glass(material, u) {
  patch(material, 'car-glass', { uGlass: u.uGlass }, (shader) => {
    shader.fragmentShader = before(
      after(shader.fragmentShader, '#include <common>', 'uniform float uGlass;', 'glass'),
      '#include <opaque_fragment>', `if ( uGlass > 0.0 ) {
  float glassA = max( diffuseColor.a, 0.05 );
  outgoingLight = mix( outgoingLight, outgoingLight - totalSpecular + totalSpecular / glassA, uGlass );
}`, 'glass',
    );
  });
}

// ---- the tyres and the aero discs ---------------------------------------------------------

// The wheels are drawn with their own frame: the model of a wheel has its axle for the
// origin and its axis for Z, in millimetres. A body part has neither, and is more than
// a wheel's radius from the origin, which is how the two are told apart.
const WHEEL_VERTEX = 'varying vec3 vWheelP;';

function rubber(material, u) {
  const T = CAR_LOOK.tyre;
  patch(material, 'car-tyre', { uTyre: u.uTyre, tTyre: u.tTyre }, (shader) => {
    shader.vertexShader = after(
      after(shader.vertexShader, '#include <common>', WHEEL_VERTEX, 'tyre'),
      '#include <begin_vertex>', 'vWheelP = position;', 'tyre',
    );
    shader.fragmentShader = after(
      after(shader.fragmentShader, '#include <common>', `uniform float uTyre;
uniform sampler2D tTyre;
varying vec3 vWheelP;
// How far the rubber stands out at a point of the wheel (m), and how much of it is
// lettering (0 to 1): the lettering on the sidewall, a few ribs beside it, blocks on the crown.
float tyreRise( vec3 p, out float ink ) {
  float r = length( p.xy );
  float az = abs( p.z );
  float wall = smoothstep( 96.0, 112.0, az ) * ( 1.0 - smoothstep( 345.0, 350.0, r ) );
  float crown = ( 1.0 - smoothstep( 96.0, 112.0, az ) ) * smoothstep( 326.0, 334.0, r ) * ( 1.0 - smoothstep( 345.0, 350.0, r ) );
  float a = atan( p.y, p.x );
  // (The outer face of a left wheel is on the side of z under 0, of a right wheel over it: the lettering reads from outside on both.)
  vec2 uv = vec2( a * ( p.z < 0.0 ? 1.0 : -1.0 ) * ${(T.repeat / (2 * Math.PI)).toFixed(6)}, ( r - ${T.band[0].toFixed(1)} ) / ${(T.band[1] - T.band[0]).toFixed(1)} );
  vec2 dx = dFdx( uv );
  vec2 dy = dFdy( uv );
  // (Where the angle goes from one side of a turn to the other the step is not the picture's.)
  dx.x -= ${T.repeat.toFixed(1)} * floor( dx.x / ${T.repeat.toFixed(1)} + 0.5 );
  dy.x -= ${T.repeat.toFixed(1)} * floor( dy.x / ${T.repeat.toFixed(1)} + 0.5 );
  float band = wall * step( 0.0, uv.y ) * step( uv.y, 1.0 );
  ink = textureGrad( tTyre, uv, dx, dy ).r * band;
  float ribs = wall * ( 0.5 + 0.5 * cos( r * 2.0944 ) ) * (
    smoothstep( 262.0, 270.0, r ) * ( 1.0 - smoothstep( 280.0, 286.0, r ) )
    + smoothstep( 318.0, 322.0, r ) * ( 1.0 - smoothstep( 330.0, 334.0, r ) ) );
  float blocks = crown * ( 0.5 + 0.5 * sin( a * 90.0 ) );
  return ${T.rise.toFixed(5)} * ink + 0.0003 * ribs + 0.0006 * blocks;
}`, 'tyre'),
      '#include <normal_fragment_maps>', `// The rubber's lettering, ribs and tread, as a bump (the height over the pixel's own size)
// and lighter where the letters are.
if ( uTyre > 0.0 ) {
  float tyreInk;
  float tyreH = tyreRise( vWheelP, tyreInk ) * uTyre;
  diffuseColor.rgb += vec3( ${T.ink.toFixed(3)} ) * ( uTyre * tyreInk );
  vec3 tyrePos = - vViewPosition;
  vec3 tyreSx = dFdx( tyrePos );
  vec3 tyreSy = dFdy( tyrePos );
  vec3 tyreR1 = cross( tyreSy, normal );
  vec3 tyreR2 = cross( normal, tyreSx );
  float tyreDet = dot( tyreSx, tyreR1 );
  vec3 tyreGrad = sign( tyreDet ) * ( dFdx( tyreH ) * tyreR1 + dFdy( tyreH ) * tyreR2 );
  normal = normalize( abs( tyreDet ) * normal - tyreGrad );
}`, 'tyre',
    );
  });
}

function brushed(material, u) {
  const B = CAR_LOOK.brush;
  patch(material, 'car-brush', { uBrush: u.uBrush }, (shader) => {
    shader.vertexShader = after(
      after(shader.vertexShader, '#include <common>', WHEEL_VERTEX, 'brush'),
      '#include <begin_vertex>', 'vWheelP = position;', 'brush',
    );
    shader.fragmentShader = after(
      after(shader.fragmentShader, '#include <common>', `uniform float uBrush;
varying vec3 vWheelP;
${HASH}`, 'brush'),
      '#include <normal_fragment_maps>', `// Brushed round the axle: each ring of the disc (a groove wide) has its normal turned
// along the radius, a way of its own, which stretches a highlight across the grooves; the
// grooves are gone from where a pixel is wider than one.
if ( uBrush > 0.0 ) {
  float brushR = length( vWheelP.xy );
  float brushDx = dFdx( brushR );
  float brushDy = dFdy( brushR );
  vec3 brushPos = - vViewPosition;
  vec3 brushSx = dFdx( brushPos );
  vec3 brushSy = dFdy( brushPos );
  float brushFoot = max( length( brushSx ), length( brushSy ) );
  float brushK = uBrush * ( 1.0 - smoothstep( 0.3, 1.0, brushFoot / ${(B.cell / 1000).toFixed(5)} ) ) * ( 1.0 - smoothstep( 345.0, 350.0, brushR ) );
  if ( brushK > 0.0 ) {
    float brushTilt = ( clHash( vec3( floor( brushR / ${B.cell.toFixed(2)} ), 5.0, 9.0 ) ).x * 2.0 - 1.0 ) * ${B.tilt.toFixed(3)} * brushK;
    vec3 brushR1 = cross( brushSy, normal );
    vec3 brushR2 = cross( normal, brushSx );
    vec3 brushG = sign( dot( brushSx, brushR1 ) ) * ( brushDx * brushR1 + brushDy * brushR2 );
    float brushL = length( brushG );
    if ( brushL > 1e-20 ) normal = normalize( normal + brushG * ( brushTilt / brushL ) );
  }
}`, 'brush',
    );
  });
}

// ---- the heat of the thrusters -------------------------------------------------------------

const HAZE_VERTEX = /* glsl */`
uniform vec3 uCenter;
uniform vec3 uRight;
uniform vec3 uUp;
varying vec2 vQuad;
void main() {
  vQuad = position.xy * 2.0;
  vec3 w = uCenter + uRight * vQuad.x + uUp * vQuad.y;
  gl_Position = projectionMatrix * viewMatrix * vec4( w, 1.0 );
}`;

// What the heat does to what is behind it: a patch the size of the plume, facing the lens,
// that draws the frame behind it again, each pixel taken from a place a pixel or two off
// (by two layers of noise that move on, upward and the way the air behind the car goes).
// Where it bends nothing it draws what was there; at its edge it bends nothing.
const HAZE_FRAGMENT = /* glsl */`
uniform sampler2D tCrop;
uniform vec4 uRect;
uniform vec2 uCrop;
uniform float uOn;
uniform float uPower;
uniform float uPx;
uniform vec2 uFlow;
uniform float uTime;
varying vec2 vQuad;
float hzHash( vec2 i ) {
  vec3 p = fract( vec3( i.xyx ) * 0.1031 );
  p += dot( p, p.yzx + 33.33 );
  return fract( ( p.x + p.y ) * p.z );
}
float hzNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hzHash( i ), hzHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( hzHash( i + vec2( 0.0, 1.0 ) ), hzHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
void main() {
  if ( uOn <= 0.0 ) discard;
  float m = 1.0 - smoothstep( 0.3, 1.0, length( vQuad * vec2( 0.85, 1.2 ) ) );
  vec2 q = vQuad * ${CAR_LOOK.haze.scale.toFixed(2)} - uFlow * uTime;
  vec2 d = vec2( hzNoise( q ) * 0.65 + hzNoise( q * 2.1 + 5.3 ) * 0.35, hzNoise( q + 31.7 ) * 0.65 + hzNoise( q * 2.1 + 17.9 ) * 0.35 ) * 2.0 - 1.0;
  vec2 off = d * m * uPower * ${CAR_LOOK.haze.bend.toFixed(2)} * uPx;
  vec3 c = texture2D( tCrop, ( gl_FragCoord.xy + off - uRect.xy ) / uCrop ).rgb;
  gl_FragColor = vec4( c, smoothstep( 0.0, 0.25, m ) );
}`;

const COPY_VERTEX = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }';

// The piece of the frame the patch is over, copied out: from where the patch's rectangle
// starts in the frame, a pixel to a pixel.
const COPY_FRAGMENT = /* glsl */`
uniform sampler2D tFrame;
uniform vec2 uOrigin;
uniform vec2 uFull;
void main() {
  vec3 c = texture2D( tFrame, ( uOrigin + gl_FragCoord.xy ) / uFull ).rgb;
  gl_FragColor = vec4( c, 1.0 );
}`;

const GRAIN = 64;                 // the copy's size is a number of these
const COPY_MAX = [768, 512];      // a patch that is bigger on the screen than this (the lens is at the bumper) is left out
const _c = new THREE.Vector3();
const _p = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _b = new THREE.Vector3();
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

class Haze {
  // parent: what the patch is a child of, the car's own root, so that it is drawn where the car is and is put
  // away with it (the patch is placed from its own numbers, not from its parent's matrix).
  constructor(parent, chain, model) {
    this.chain = chain;
    this.model = model;
    this.power = 0;         // how hot the thrusters are, 0 to 1, as they have come to be (the patch has less of it the further the lens)
    this.taken = 0;         // how many frames the copy was taken for
    this.flow = new THREE.Vector2(0, 0.6);
    const H = CAR_LOOK.haze;
    this.uniforms = {
      tCrop: { value: null },
      uRect: { value: new THREE.Vector4() },
      uCrop: { value: new THREE.Vector2(1, 1) },
      uOn: { value: 0 },
      uPower: { value: 0 },
      uPx: { value: 1 },
      uFlow: { value: this.flow },
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uRight: { value: new THREE.Vector3() },
      uUp: { value: new THREE.Vector3() },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: HAZE_VERTEX,
      fragmentShader: HAZE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.material.name = 'car.haze';
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'car_haze';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
    // (A patch of the air is not a thing a ray can hit: it is placed in the shader, not where the mesh stands.)
    this.mesh.raycast = () => {};
    this.mesh.onBeforeRender = (renderer, scene, camera) => this._before(renderer, camera);
    parent.add(this.mesh);
    this.half = H.half;
    // The copy (made when it is first wanted) and what draws it.
    this.crop = null;
    this.size = [0, 0];
    this.copy = new THREE.ShaderMaterial({
      uniforms: { tFrame: { value: null }, uOrigin: { value: new THREE.Vector2() }, uFull: { value: new THREE.Vector2(1, 1) } },
      vertexShader: COPY_VERTEX,
      fragmentShader: COPY_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.copy);
  }

  // Each frame: how hot the thrusters are (the hover's share and the throttle's) and whether
  // there is any heat to draw.
  update(dt, want, time, off) {
    // Not drawn in a style that is not the real one, or at the low tier, and (where the world is wound over, for the
    // way into the Upside Down, the patch would not be where the car is drawn) not there.
    if (off || twistU.uTwist.value[0] > 0.5) {
      this.power = 0;
      this.uniforms.uPower.value = 0;
      this.mesh.visible = false;
      return;
    }
    this.power += (want - this.power) * Math.min(1, dt * 3);
    this.uniforms.uTime.value = time;
    this.mesh.visible = this.power > 0.01;
  }

  // The patch is about to be drawn: for the frame the chain draws the scene into, find the
  // rectangle of it that the patch is over on the screen, copy that out, and tell the patch
  // where. Drawn for anything else (the shadow map, a map of the sky, a tool that draws the
  // scene again to read its depth) it draws nothing.
  _before(renderer, camera) {
    const u = this.uniforms;
    u.uOn.value = 0;
    const target = renderer.getRenderTarget();
    const c = this.chain && this.chain.composer;
    if (!target || !c || (target !== c.renderTarget1 && target !== c.renderTarget2)) return;
    const H = CAR_LOOK.haze;
    _c.set(H.at[0], H.at[1], H.at[2]).applyMatrix4(this.model.matrixWorld);
    _p.copy(_c).applyMatrix4(camera.matrixWorldInverse);
    if (-_p.z < 1.5) return;
    // Hot as the thrusters are, and less of it the further off it is seen from: none from 30 m.
    const power = this.power * (1 - smooth(H.reach[0], H.reach[1], _c.distanceTo(camera.position)));
    if (power < 0.01) return;
    camera.matrixWorld.extractBasis(_r, _u, _p);
    _r.multiplyScalar(this.half[0]);
    _u.multiplyScalar(this.half[1]);
    const W = target.width;
    const T = target.height;
    const px = T / 1080;
    const margin = Math.ceil(H.bend * px) + 3;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [sx, sy] of CORNERS) {
      _p.copy(_c).addScaledVector(_r, sx).addScaledVector(_u, sy).project(camera);
      const x = (_p.x * 0.5 + 0.5) * W;
      const y = (_p.y * 0.5 + 0.5) * T;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    x0 = Math.max(0, Math.floor(x0 - margin));
    y0 = Math.max(0, Math.floor(y0 - margin));
    x1 = Math.min(W, Math.ceil(x1 + margin));
    y1 = Math.min(T, Math.ceil(y1 + margin));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0 || w > COPY_MAX[0] || h > COPY_MAX[1]) return;
    this._take(renderer, target, x0, y0, w, h);
    // The way the air behind the car goes, on the screen: where the camera sees the car's tail pointing.
    _b.setFromMatrixColumn(this.model.matrixWorld, 0).normalize().negate();
    camera.matrixWorld.extractBasis(_r, _u, _p);
    this.flow.set(_b.dot(_r) * H.speed, _b.dot(_u) * H.speed + 0.6);
    u.uRect.value.set(x0, y0, w, h);
    u.uCrop.value.set(this.size[0], this.size[1]);
    u.uCenter.value.copy(_c);
    u.uRight.value.copy(_r).multiplyScalar(this.half[0]);
    u.uUp.value.copy(_u).multiplyScalar(this.half[1]);
    u.uPx.value = px;
    u.uPower.value = power;
    u.tCrop.value = this.crop.texture;
    u.uOn.value = 1;
  }

  _take(renderer, source, x0, y0, w, h) {
    const cw = Math.ceil(w / GRAIN) * GRAIN;
    const ch = Math.ceil(h / GRAIN) * GRAIN;
    if (!this.crop) {
      this.crop = new THREE.WebGLRenderTarget(cw, ch, { type: THREE.HalfFloatType, depthBuffer: false });
      this.crop.texture.name = 'Car.haze.crop';
      this.size = [cw, ch];
    } else if (cw > this.size[0] || ch > this.size[1]) {
      this.size = [Math.max(cw, this.size[0]), Math.max(ch, this.size[1])];
      this.crop.setSize(this.size[0], this.size[1]);
    }
    const k = this.copy.uniforms;
    k.tFrame.value = source.texture;
    k.uOrigin.value.set(x0, y0);
    k.uFull.value.set(source.width, source.height);
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.crop);
    this.quad.render(renderer);
    renderer.autoClear = auto;
    renderer.setRenderTarget(source);
    this.taken++;
  }

  // Both programs built ahead, as they are drawn (to a target), in the compiler's threads.
  warm(renderer) {
    if (this._warmed) return this._warmed;
    const scene = new THREE.Scene();
    const geometry = new THREE.PlaneGeometry(2, 2);
    scene.add(new THREE.Mesh(geometry, this.copy));
    scene.add(new THREE.Mesh(this.geometry, this.material));
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

  dispose() {
    this.mesh.onBeforeRender = () => {};
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.copy.dispose();
    if (this.crop) this.crop.dispose();
    this.crop = null;
  }
}

// ---- the car --------------------------------------------------------------------------------

// The materials whose numbers are moved between what they were and what the real style
// gives them, and the ones lit as a cabin is (by their own colour).
const CHANGED = ['paint', 'glass', 'head_light'];
const CABIN = ['leather', 'alcantara', 'carpet'];

export class CarLook {
  // renderer, the post chain (render/post.js), the scene, the car's presentation
  // (render/presentation.js) and the tier it is drawn at.
  constructor({ renderer, chain, scene, presentation, tier = 'high' }) {
    this.renderer = renderer;
    this.chain = chain;
    this.scene = scene;
    this.presentation = presentation;
    this.tier = tier;
    this.real = 0;               // how far the real style has the car, 0 to 1, as of the last update
    this.u = {
      uFlake: { value: 0 },
      uFlakeRot: { value: new THREE.Matrix3() },
      uGlass: { value: 0 },
      uTyre: { value: 0 },
      tTyre: { value: null },
      uBrush: { value: 0 },
    };
    this.by = {};                // the materials, by the model's name for them
    this.base = new Map();       // what each had before this
    this.haze = null;
    this.texture = null;
    this.model = null;
    this._m4 = new THREE.Matrix4();
  }

  // The model is in the scene (presentation.attach has joined its parts): its materials
  // are given what the real style adds to them.
  dress(model) {
    this.model = model;
    const seen = new Set();
    const paints = [];
    model.traverse((o) => {
      if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
      const m = o.material;
      if (m.name === 'paint') paints.push(o);
      if (seen.has(m)) return;
      seen.add(m);
      (this.by[m.name] = this.by[m.name] || []).push(m);
      if (CHANGED.includes(m.name)) {
        this.base.set(m, {
          metalness: m.metalness,
          roughness: m.roughness,
          coat: m.clearcoatRoughness,
          opacity: m.opacity,
          env: m.envMapIntensity,
          lamp: m.emissiveIntensity,
          color: m.color.clone(),
        });
      }
    });
    // The paint: the flakes, which stay on the car whichever way the lens turns.
    const rot = this.u.uFlakeRot.value;
    for (const mesh of paints) {
      flakes(mesh.material, this.u);
      mesh.onBeforeRender = (renderer, scene, camera) => {
        const e = this._m4.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld).elements;
        const s = 1 / Math.hypot(e[0], e[1], e[2]);
        rot.set(e[0] * s, e[4] * s, e[8] * s, e[1] * s, e[5] * s, e[9] * s, e[2] * s, e[6] * s, e[10] * s);
      };
    }
    for (const m of this.by.glass || []) glass(m, this.u);
    // The cabin's materials are lit a little of their own colour (nothing at 0).
    for (const name of CABIN) for (const m of this.by[name] || []) m.emissive.copy(m.color);
    // The wheels.
    const tyre = tyreLettering(CAR_LOOK.tyre.text);
    this.texture = new THREE.DataTexture(tyre.bytes, tyre.width, tyre.height, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.name = 'Car.tyre.lettering';
    this.texture.wrapS = THREE.RepeatWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.needsUpdate = true;
    this.u.tTyre.value = this.texture;
    for (const name of ['rubber', 'rubber_side']) for (const m of this.by[name] || []) rubber(m, this.u);
    for (const name of ['gunmetal', 'alu']) for (const m of this.by[name] || []) brushed(m, this.u);
    // The heat.
    this.haze = new Haze(this.presentation ? this.presentation.root : this.scene, this.chain, model);
  }

  setTier(tier) {
    this.tier = tier;
  }

  // Every frame, after the car has been put where it is. f: real (the style's number, 0 to 1),
  // sky (the sky's light this world has: the environment's strength), lamps (how much the
  // car's own lamps are wanted, 0 in daylight to 1 in the dark or in a tunnel), lift (how far
  // the car is afloat, 0 to 1), throttle, time (the game's clock) and blinking (the car is
  // blinking after a reset: its glass is left to that).
  update(dt, f) {
    const k = clamp01(f.real);
    this.real = k;
    const rich = this.tier === 'low' ? 0 : 1;
    const P = CAR_LOOK.paint;
    for (const m of this.by.paint || []) {
      const b = this.base.get(m);
      m.metalness = lerp(b.metalness, P.metalness, k);
      m.roughness = lerp(b.roughness, P.roughness, k);
      m.clearcoatRoughness = lerp(b.coat, P.coatRoughness, k);
      m.envMapIntensity = lerp(b.env, P.env, k);
    }
    this.u.uFlake.value = k * rich;
    this.u.uTyre.value = k * rich;
    this.u.uBrush.value = k * rich;
    const G = CAR_LOOK.glass;
    this.u.uGlass.value = k;
    for (const m of this.by.glass || []) {
      const b = this.base.get(m);
      if (!f.blinking) m.opacity = lerp(b.opacity, G.opacity, k);
      m.envMapIntensity = lerp(b.env, G.env, k);
    }
    const sky = f.sky === undefined ? 1 : Math.min(1.2, Math.max(0, f.sky));
    for (const name of CABIN) for (const m of this.by[name] || []) m.emissiveIntensity = CAR_LOOK.cabin * k * sky;
    const L = CAR_LOOK.lamp;
    for (const m of this.by.head_light || []) {
      const b = this.base.get(m);
      m.emissiveIntensity = lerp(b.lamp, lerp(L.day, L.night, clamp01(f.lamps)), k);
      m.color.copy(b.color).multiplyScalar(lerp(1, L.lens, k));
    }
    if (this.haze) {
      const on = k >= 0.5 && rich;
      this.haze.update(dt, on ? f.lift * (0.35 + 0.65 * clamp01(f.throttle)) : 0, f.time, !on);
    }
  }

  // Built ahead (the programs of the heat), once.
  warm(renderer) {
    return this.haze ? this.haze.warm(renderer) : null;
  }

  // What this holds on the GPU, and what it has done to the car's materials, let go: the car is as it was.
  dispose() {
    if (this.haze) this.haze.dispose();
    this.haze = null;
    if (this.texture) this.texture.dispose();
    this.texture = null;
    this.u.tTyre.value = null;
    this.u.uFlake.value = 0;
    this.u.uTyre.value = 0;
    this.u.uBrush.value = 0;
    this.u.uGlass.value = 0;
    for (const [m, b] of this.base) {
      m.metalness = b.metalness;
      m.roughness = b.roughness;
      if (b.coat !== undefined) m.clearcoatRoughness = b.coat;
      m.opacity = b.opacity;
      m.envMapIntensity = b.env;
      m.emissiveIntensity = b.lamp;
      m.color.copy(b.color);
    }
    for (const name of CABIN) {
      for (const m of this.by[name] || []) {
        m.emissive.setRGB(0, 0, 0);
        m.emissiveIntensity = 1;
      }
    }
    this.by = {};
    this.base.clear();
    this.model = null;
  }
}
