// The city's towers: boxes on a street grid that runs the way the road set
// out, instanced per 768 m tile out to 3.6 km from the camera.
//
// A lot every 46 m; most hold a building, parks hold none (the trees grow
// there, world/vegetation.js). Heights rise toward the downtown clusters and
// shrink to nothing across the city's borders, so the skyline grows out of
// the plain as the road comes in. No building stands within reach of the
// road: every corner of a footprint is checked against the road's own
// corridor (world/corridor.js). Tall towers carry a setback crown.
//
// Windows are drawn in the shader from where a pixel is on the facade, in
// metres, so they line up with each building's edges at any size: a grid of
// floors and bays, some lit warm, some cool, the street floor lit as shops.
// Where a window would be smaller than a few pixels the grid gives way to its
// average, so a far skyline is a soft glow and not a shimmer.

import * as THREE from 'three';
import { withAtmosphere } from './atmosphere.js';
import { MARK, pairProgram } from './style.js';
import { nightU } from './nightlight.js';
import { hash2 } from '../world/noise.js';
import { WORLD_INDEX, makeSkyline } from '../world/worlds.js';
import { SIGN, NO_SIGN, RAIL_CLEAR, STEAM_SHARE, PARK_LAMP, signOf, roofOf } from '../world/cityplan.js';

const TILE = 768;
const FAR = 3600;
const LOT = 46;
const CITY = WORLD_INDEX.city;
const MAST = 6;                  // m: the mast the light of a tall tower is on, over its top
const lotKey = (i, j) => (i + 1048576) * 2097152 + (j + 1048576);

const srgb = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
const FACADES = [0x8e8b85, 0x9b8f7c, 0x3a4652, 0x4d6177, 0x7c5848, 0xb6b2a9, 0x5f6266, 0x2e3640].map(srgb);

// A unit box standing on y = 0, without a floor.
function boxGeometry() {
  const pos = [];
  const nrm = [];
  const idx = [];
  const face = (corners, n) => {
    const b = pos.length / 3;
    for (const c of corners) {
      pos.push(...c);
      nrm.push(...n);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const h = 0.5;
  face([[-h, 0, h], [h, 0, h], [h, 1, h], [-h, 1, h]], [0, 0, 1]);
  face([[h, 0, -h], [-h, 0, -h], [-h, 1, -h], [h, 1, -h]], [0, 0, -1]);
  face([[h, 0, h], [h, 0, -h], [h, 1, -h], [h, 1, h]], [1, 0, 0]);
  face([[-h, 0, -h], [-h, 0, h], [-h, 1, h], [-h, 1, -h]], [-1, 0, 0]);
  face([[-h, 1, h], [h, 1, h], [h, 1, -h], [-h, 1, -h]], [0, 1, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

export const windowGlow = { value: 1.25 };

// The windows of the painted style: three colours (two warm, one cool), each a
// flat block, as they come out on the screen (linear). A window is a block
// from a bay of 6 pixels across; under 2.5 pixels it is the mean of the three,
// so that a far skyline is a soft tone and not a shimmer. Whether a window is
// lit, and in which colour, is a hash of the building's seed, its face and the
// bay: the seed and the face's normal are taken flat (the same exactly across a
// face), because the last bits of an interpolated number are scattered from
// pixel to pixel, and a hash made of them is a noise.
const WINDOW_COLOURS = {
  warmA: [0.64, 0.46, 0.19],
  warmB: [0.70, 0.30, 0.10],
  cool: [0.36, 0.50, 0.72],
  // How many of the lit windows are each (a draw under the first, between the two).
  shares: [0.42, 0.76],
};
const glsl3 = (a) => `vec3(${a.map((x) => x.toFixed(3)).join(', ')})`;
const glsl3n = (a) => `vec3( ${a.map((x) => x.toFixed(3)).join(', ')} )`;
// The real style's night windows: the bay widths in pixels (as a share of a bay in a pixel) a pane is
// seen at: whole (a window and not the mean of the panes) from the first to the second number, a
// room from the first to the second; the colours of a room's light (and how many of them are each:
// the draws that end each), the mean of them, how bright a pane is that is not a room, how deep a
// room is (m, from to), how bright its lamp is, how bright the light of a room is against a pane's (room), and how
// light its side walls and its floor are against its back wall.
const NIGHT_WIN = {
  detail: [0.12, 0.30],
  rooms: [0.05, 0.10],
  moods: [[1.0, 0.62, 0.30], [1.0, 0.80, 0.52], [0.50, 0.68, 1.0], [0.95, 0.45, 0.62]],
  shares: [0.40, 0.67, 0.87],
  mean: [0.894, 0.659, 0.541],
  pane: 0.6,
  room: 0.8,
  wall: 0.5,
  floor: 0.25,
  depth: [3.6, 5.8],
  lamp: 1.0,
};
const WINDOWS_PAINTED = `#include <map_fragment>
{
  float roof = step(0.5, vBoxN.y);
  // Metres across the face and up it, and in bays.
  vec2 fc = vec2(abs(vBoxN.x) > 0.5 ? (vBox.z + 0.5) * vSize.z : (vBox.x + 0.5) * vSize.x, vBox.y * vSize.y);
  vec2 bc = fc / vec2(3.2, 3.6);
  vec2 cell = floor(bc);
  vec2 f = bc - cell;
  vec2 w = fwidth(bc) * 0.75 + 1e-4;
  float win = smoothstep(0.16 - w.x, 0.16 + w.x, f.x) * (1.0 - smoothstep(0.84 - w.x, 0.84 + w.x, f.x))
    * smoothstep(0.24 - w.y, 0.24 + w.y, f.y) * (1.0 - smoothstep(0.86 - w.y, 0.86 + w.y, f.y));
  float detail = 1.0 - smoothstep(0.12, 0.30, max(w.x, w.y));
  win = mix(0.42, win, detail);
  vec3 sd = vec3(cell, dot(vBoxNF, vec3(1.7, 0.0, 2.3)) + vBldF.x * 37.0);
  float h = stHash(sd);
  float lit = mix(vBldF.y, step(h, vBldF.y), detail);
  float pick = stHash(sd + vec3(11.7, 3.1, 5.3));
  vec3 warmA = ${glsl3(WINDOW_COLOURS.warmA)};
  vec3 warmB = ${glsl3(WINDOW_COLOURS.warmB)};
  vec3 cool = ${glsl3(WINDOW_COLOURS.cool)};
  vec3 wc = pick < ${WINDOW_COLOURS.shares[0].toFixed(2)} ? warmA : pick < ${WINDOW_COLOURS.shares[1].toFixed(2)} ? warmB : cool;
  vec3 mean = warmA * ${WINDOW_COLOURS.shares[0].toFixed(2)} + warmB * ${(WINDOW_COLOURS.shares[1] - WINDOW_COLOURS.shares[0]).toFixed(2)} + cool * ${(1 - WINDOW_COLOURS.shares[1]).toFixed(2)};
  float street = (1.0 - step(4.2, fc.y)) * step(0.6, fc.y) * (1.0 - roof);
  float parapet = step(vSize.y - 2.2, fc.y);
  win *= (1.0 - roof) * (1.0 - parapet) * step(4.2, fc.y);
  // The street floor is shop glass, bay by bay, lit warm.
  float shop = street * step(0.07, f.x) * step(f.x, 0.93) * step(0.3, fract(h * 3.7));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.025, 0.03, 0.04), max(win, street) * 0.8);
  tGlass = max(win, street);
  tGlow = (mix(mean, wc, detail) * win * lit + warmA * shop * 0.5) * uPaintInv;
}`;

// The real style's windows by night: a pane with a room behind it. From a window up to a few
// tens of metres in a hundred and fifty (a bay wider than about eight pixels), the room is seen as a
// box through the pane (the ray from the lens is followed to a back wall, two side walls, a ceiling
// or a floor), each room with its own tone, its own furniture and, in some, a blind half down; a
// bay of three to eight pixels is a pane of its room's tone; narrower than that, the mean of the
// panes, so that a far skyline is a soft glow and does not crawl. Whether a pane is lit and of what
// tone is a hash of the building's seed, its face and the bay (taken flat, the same exactly across
// a face). Panes are edged by the width of a pixel, not stepped.
const WINDOWS_NIGHT = `
void windowsNight( const in vec3 dc0, out vec3 dc, out float glass, out vec3 glow ) {
  float roof = step( 0.5, vBoxN.y );
  vec2 fc = vec2( abs( vBoxN.x ) > 0.5 ? ( vBox.z + 0.5 ) * vSize.z : ( vBox.x + 0.5 ) * vSize.x, vBox.y * vSize.y );
  vec2 bc = fc / vec2( 3.2, 3.6 );
  vec2 cell = floor( bc );
  vec2 f = bc - cell;
  vec2 w = fwidth( bc ) * 0.75 + 1e-4;
  float px = max( fwidth( bc.x ), fwidth( bc.y ) );
  float win = smoothstep( 0.16 - w.x, 0.16 + w.x, f.x ) * ( 1.0 - smoothstep( 0.84 - w.x, 0.84 + w.x, f.x ) )
    * smoothstep( 0.24 - w.y, 0.24 + w.y, f.y ) * ( 1.0 - smoothstep( 0.86 - w.y, 0.86 + w.y, f.y ) );
  float detail = 1.0 - smoothstep( ${NIGHT_WIN.detail[0].toFixed(2)}, ${NIGHT_WIN.detail[1].toFixed(2)}, px );
  float rooms = uNightRoom > 0.0 ? 1.0 - smoothstep( ${NIGHT_WIN.rooms[0].toFixed(2)}, ${NIGHT_WIN.rooms[1].toFixed(2)}, px / uNightRoom ) : 0.0;
  win = mix( 0.42, win, detail );
  vec3 sd = vec3( cell, dot( vBoxNF, vec3( 1.7, 0.0, 2.3 ) ) + vBldF.x * 37.0 );
  float h = stHash( sd );
  float lit = mix( vBldF.y, step( h, vBldF.y ), detail );
  float street = ( 1.0 - step( 4.2, fc.y ) ) * step( 0.6, fc.y ) * ( 1.0 - roof );
  float parapet = step( vSize.y - 2.2, fc.y );
  win *= ( 1.0 - roof ) * ( 1.0 - parapet ) * step( 4.2, fc.y );
  float pm = stHash( sd + vec3( 11.7, 3.1, 5.3 ) );
  vec3 mood = pm < ${NIGHT_WIN.shares[0].toFixed(2)} ? ${glsl3n(NIGHT_WIN.moods[0])} : pm < ${NIGHT_WIN.shares[1].toFixed(2)} ? ${glsl3n(NIGHT_WIN.moods[1])}
    : pm < ${NIGHT_WIN.shares[2].toFixed(2)} ? ${glsl3n(NIGHT_WIN.moods[2])} : ${glsl3n(NIGHT_WIN.moods[3])};
  vec3 col = mix( ${glsl3n(NIGHT_WIN.mean)}, mood, detail ) * ${NIGHT_WIN.pane.toFixed(2)};
  if ( rooms > 0.0 && lit > 0.5 && win > 0.01 ) {
    vec3 dl = normalize( vViewL );
    float dA = abs( vBoxNF.x ) > 0.5 ? dl.z : dl.x;
    float dD = max( - dot( dl, vBoxNF ), 0.02 );
    float a0 = f.x * 3.2;
    float u0 = f.y * 3.6;
    float depth = ${NIGHT_WIN.depth[0].toFixed(1)} + ${(NIGHT_WIN.depth[1] - NIGHT_WIN.depth[0]).toFixed(1)} * stHash( sd + vec3( 2.3, 9.1, 4.7 ) );
    float tx = dA > 0.0 ? ( 3.2 - a0 ) / dA : ( dA < 0.0 ? - a0 / dA : 1e4 );
    float ty = dl.y > 0.0 ? ( 3.6 - u0 ) / dl.y : ( dl.y < 0.0 ? - u0 / dl.y : 1e4 );
    float tz = depth / dD;
    float t = min( min( tx, ty ), tz );
    float ha = a0 + dA * t;
    float hu = u0 + dl.y * t;
    float hd = dD * t;
    float h2 = stHash( sd + vec3( 7.7, 1.3, 8.9 ) );
    vec3 surf;
    if ( t == tz ) {
      // The back wall, with a piece of furniture standing against it.
      surf = mood * ( 0.5 + 0.4 * h2 );
      float fa = 0.2 + 2.0 * stHash( sd + vec3( 3.1, 6.2, 1.7 ) );
      float fw = 0.7 + 1.1 * h2;
      float fh = 0.5 + 1.0 * stHash( sd + vec3( 5.3, 2.9, 9.4 ) );
      surf = mix( surf, mood * 0.1, step( fa, ha ) * step( ha, fa + fw ) * step( hu, fh ) );
      // A second piece, tall and narrow, and the wall shaded up it.
      float fb = 0.3 + 2.4 * stHash( sd + vec3( 6.6, 0.7, 3.8 ) );
      float fc2 = 0.4 + 0.5 * stHash( sd + vec3( 1.9, 5.5, 7.1 ) );
      float fe = 1.2 + 0.8 * stHash( sd + vec3( 9.3, 2.2, 4.4 ) );
      surf = mix( surf, mood * 0.07, step( fb, ha ) * step( ha, fb + fc2 ) * step( hu, fe ) );
      surf *= 0.7 + 0.3 * clamp( hu / 3.0, 0.0, 1.0 );
    } else if ( t == ty ) {
      // The ceiling, with the lamp, or the floor.
      surf = dl.y > 0.0 ? mood * 0.9 + mood * ${NIGHT_WIN.lamp.toFixed(2)} * ( 1.0 - smoothstep( 0.25, 0.9, length( vec2( ha - 1.6, hd - depth * 0.5 ) ) ) ) : mood * ${NIGHT_WIN.floor.toFixed(2)};
    } else {
      // A side wall, with a shelf or a row of pictures along it.
      float sh = step( 0.6, fract( hd * 0.9 + 0.35 * stHash( sd + vec3( 0.3, 8.8, 2.1 ) ) ) ) * step( 0.9, hu ) * step( hu, 2.7 );
      surf = mood * ${NIGHT_WIN.wall.toFixed(2)} * ( 1.0 - 0.45 * sh );
    }
    surf *= ${NIGHT_WIN.room.toFixed(2)} / ( 1.0 + 0.04 * t * t );
    // A blind let half down from the top of the pane, in some of them.
    float bt = 0.86 - 0.62 * ( 0.3 + 0.6 * stHash( sd + vec3( 8.2, 4.4, 2.6 ) ) );
    float blind = step( stHash( sd + vec3( 4.4, 1.1, 3.3 ) ), 0.22 ) * step( bt, f.y );
    // In front of the room: a bar of the frame in some panes, a transom in others, curtains drawn back at the sides in a few.
    float hq = stHash( sd + vec3( 2.2, 7.7, 1.4 ) );
    float frame = max( step( hq, 0.35 ) * ( 1.0 - smoothstep( 0.012 + w.x, 0.03 + 2.0 * w.x, abs( f.x - 0.5 ) ) ),
      step( 0.35, hq ) * step( hq, 0.55 ) * ( 1.0 - smoothstep( 0.012 + w.y, 0.03 + 2.0 * w.y, abs( f.y - 0.62 ) ) ) );
    float curtain = step( 0.55, hq ) * step( hq, 0.8 ) * ( 1.0 - smoothstep( 0.1, 0.12 + 2.0 * w.x, min( f.x - 0.16, 0.84 - f.x ) ) );
    surf = mix( surf, mood.bgr * 0.45, curtain );
    surf = mix( surf, mood * 0.04, frame );
    col = mix( col, mix( surf, mood * 0.5, blind ), rooms );
  }
  vec3 warm = vec3( 1.0, 0.62, 0.3 );
  float shop = street * step( 0.07, f.x ) * step( f.x, 0.93 ) * step( 0.3, fract( h * 3.7 ) );
  dc = mix( dc0, vec3( 0.025, 0.03, 0.04 ), max( win, street ) * 0.8 );
  glass = max( win, street );
  glow = ( col * win * lit + warm * shop * 0.14 ) * uWindow;
}`;

// The signs' clock (s) and whether the tier has them (render/citylife.js sets both).
export const signU = { uSign: { value: new THREE.Vector2(0, 1) } };
const glslRows = (rows) => rows.map((c) => glsl3n(c)).join(', ');
const SIGN_GLSL = (painted) => `
// A sign's glow at this pixel, and how much of the pixel is its panel (cover).
vec3 signGlow( out float cover ) {
  cover = 0.0;
  if ( vSignA.x < -0.5 || uSign.y <= 0.0 ) return vec3( 0.0 );
  vec3 fn = vSignA.x < 1.5 ? vec3( vSignA.x < 0.5 ? 1.0 : -1.0, 0.0, 0.0 ) : vec3( 0.0, 0.0, vSignA.x < 2.5 ? 1.0 : -1.0 );
  if ( dot( fn, vBoxNF ) < 0.5 ) return vec3( 0.0 );
  float near = 1.0 - smoothstep( ${(SIGN.reach - SIGN.fade).toFixed(1)}, ${SIGN.reach.toFixed(1)}, vSignD );
  if ( near <= 0.0 ) return vec3( 0.0 );
  vec2 fc = vec2( abs( vBoxN.x ) > 0.5 ? ( vBox.z + 0.5 ) * vSize.z : ( vBox.x + 0.5 ) * vSize.x, vBox.y * vSize.y );
  // Metres across the panel from its middle and up it from its bottom.
  vec2 q = vec2( fc.x - vSignA.y, fc.y - vSignA.z );
  vec2 hw = vec2( vSignA.w, vSignB.x ) * 0.5;
  vec2 pq = q - vec2( 0.0, hw.y );
  vec2 px = fwidth( fc ) + 1e-3;
  vec2 e = hw - abs( pq );
  float inside = smoothstep( - px.x, px.x, e.x ) * smoothstep( - px.y, px.y, e.y );
  if ( inside <= 0.0 ) return vec3( 0.0 );
  cover = inside * near;
  int ci = int( vSignB.z + 0.5 );
  vec3 cols[ 4 ] = vec3[ 4 ]( ${glslRows(painted ? SIGN.painted : SIGN.colours)} );
  vec3 col = cols[ ci ];
  // The edge, a tenth of a metre in from the panel's own.
  float edge = 1.0 - smoothstep( 0.1 - px.x, 0.1 + px.x, min( e.x, e.y ) );
  // The shapes: n slots across, each a square of the panel's height less a margin.
  float n = 3.0 + step( 0.5, fract( vSignB.y * 7.31 ) );
  float sw = ( 2.0 * hw.x - 0.4 ) / n;
  float si = clamp( floor( ( pq.x + hw.x - 0.2 ) / sw ), 0.0, n - 1.0 );
  float sz = min( sw, 2.0 * hw.y - 0.4 ) * 0.5;
  vec2 p = vec2( pq.x + hw.x - 0.2 - ( si + 0.5 ) * sw, pq.y ) / sz;
  float pk = fract( sin( vSignB.y * 91.7 + si * 13.13 ) * 43758.5453 );
  float d;
  if ( pk < 0.34 ) d = length( p ) - 0.62;
  else if ( pk < 0.67 ) { vec2 b = abs( p ) - vec2( 0.78, 0.24 ); d = length( max( b, 0.0 ) ) + min( max( b.x, b.y ), 0.0 ); }
  else { vec2 t = vec2( abs( p.x ), p.y + 0.2 ); d = max( t.x * 0.866 + t.y * 0.5 - 0.42, - t.y - 0.42 ); }
  float pw = max( px.x, px.y ) / sz;
  float shape = 1.0 - smoothstep( - pw, pw, d );
  // Out for a moment, once a period, in those that blink.
  float on = vSignB.w > 0.0 ? step( ${SIGN.off.toFixed(2)} / vSignB.w, fract( uSign.x / vSignB.w + vSignB.y * 5.7 ) ) : 1.0;
  float lit = max( shape, edge * 0.55 ) * on;
  return col * ( lit * cover ${painted ? '' : `* ${SIGN.glow.toFixed(2)} + 0.02 * cover`} );
}`;
const SIGN_APPLY = (painted) => `
  {
    float sCover;
    vec3 sGlow = signGlow( sCover )${painted ? ' * uPaintInv' : ''};
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.02, 0.022, 0.026 ), sCover );
    tGlass *= 1.0 - sCover;
    tGlow = tGlow * ( 1.0 - sCover ) + sGlow;
  }`;

function makeMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.05 });
  mat.onBeforeCompile = (shader) => {
    const paintOn = pairProgram.on;
    shader.uniforms.uWindow = windowGlow;
    shader.uniforms.uSign = signU.uSign;
    // (Both kinds of program take the same uniforms: three keeps those of the program built last for the material.)
    Object.assign(shader.uniforms, nightU);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aBld;
attribute vec4 aSignA;
attribute vec4 aSignB;
flat varying vec4 vSignA;
flat varying vec4 vSignB;
varying float vSignD;
varying vec3 vBox;
varying vec3 vBoxN;
varying vec3 vSize;
varying vec2 vBld;
flat varying vec2 vBldF;
flat varying vec3 vBoxNF;${paintOn ? '' : '\nvarying vec3 vViewL;'}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vBox = position;
vBoxN = normal;
vBld = aBld;
vBldF = aBld;
vBoxNF = normal;
vSignA = aSignA;
vSignB = aSignB;
vSignD = length( ( modelMatrix * instanceMatrix * vec4( position, 1.0 ) ).xyz - cameraPosition );
vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));${paintOn ? '' : `
// From the lens to the point, in the building's own frame (its rotation, in metres): the way a pane looks into its room.
vViewL = ( modelMatrix * instanceMatrix * vec4( position, 1.0 ) ).xyz - cameraPosition;
vViewL = vViewL * mat3( instanceMatrix[0].xyz / vSize.x, instanceMatrix[1].xyz / vSize.y, instanceMatrix[2].xyz / vSize.z );`}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uWindow;
uniform vec2 uSign;
flat varying vec4 vSignA;
flat varying vec4 vSignB;
varying float vSignD;
varying vec3 vBox;
varying vec3 vBoxN;
varying vec3 vSize;
varying vec2 vBld;
flat varying vec2 vBldF;
flat varying vec3 vBoxNF;
vec3 tGlow;
float tGlass;
${SIGN_GLSL(paintOn)}${paintOn ? '' : `
varying vec3 vViewL;
uniform float uNightK;
uniform float uNightRoom;
${WINDOWS_NIGHT}`}`)
      .replace('#include <map_fragment>', paintOn ? WINDOWS_PAINTED.replace(/\}$/, `${SIGN_APPLY(true)}\n}`) : `#include <map_fragment>
{
  vec3 dc0 = diffuseColor.rgb;
  tGlass = 0.0;
  tGlow = vec3( 0.0 );
  if ( uNightK < 1.0 ) {
    float roof = step(0.5, vBoxN.y);
    // Metres across the face and up it.
    vec2 fc = vec2(abs(vBoxN.x) > 0.5 ? (vBox.z + 0.5) * vSize.z : (vBox.x + 0.5) * vSize.x, vBox.y * vSize.y);
    vec2 bay = vec2(3.2, 3.6);
    vec2 cell = floor(fc / bay);
    vec2 f = fract(fc / bay);
    float win = step(0.16, f.x) * step(f.x, 0.84) * step(0.24, f.y) * step(f.y, 0.86);
    float px = max(fwidth(fc.x / bay.x), fwidth(fc.y / bay.y));
    float detail = 1.0 - smoothstep(0.3, 0.7, px);
    win = mix(0.42, win, detail);
    float faceSeed = dot(vBoxN, vec3(1.7, 0.0, 2.3)) + vBld.x * 37.0;
    float h = fract(sin(dot(cell + faceSeed, vec2(12.9898, 78.233))) * 43758.5453);
    float lit = mix(vBld.y, step(h, vBld.y), detail);
    float street = (1.0 - step(4.2, fc.y)) * step(0.6, fc.y) * (1.0 - roof);
    float parapet = step(vSize.y - 2.2, fc.y);
    win *= (1.0 - roof) * (1.0 - parapet) * step(4.2, fc.y);
    vec3 warm = vec3(1.0, 0.62, 0.3);
    vec3 cool = vec3(0.62, 0.78, 1.0);
    vec3 wc = mix(warm, cool, step(0.72, fract(h * 7.31)));
    // The street floor is shop glass, bay by bay, dimly lit.
    float shop = street * step(0.07, f.x) * step(f.x, 0.93) * step(0.3, fract(h * 3.7));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.025, 0.03, 0.04), max(win, street) * 0.8);
    tGlass = max(win, street);
    // A lit room is brighter toward its ceiling.
    float room = 0.55 + 0.45 * smoothstep(0.24, 0.86, f.y);
    tGlow = (wc * win * lit * mix(0.8, room, detail) + warm * shop * 0.14) * uWindow;
  }
  if ( uNightK > 0.0 ) {
    vec3 dcN;
    float gN;
    vec3 wN;
    windowsNight( dc0, dcN, gN, wN );
    diffuseColor.rgb = mix( diffuseColor.rgb, dcN, uNightK );
    tGlass = mix( tGlass, gN, uNightK );
    tGlow = mix( tGlow, wN, uNightK );
  }
${SIGN_APPLY(false)}
}`)
      .replace('#include <roughnessmap_fragment>', paintOn ? '#include <roughnessmap_fragment>' : `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.18, tGlass);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += tGlow;`);
  };
  mat.customProgramCacheKey = () => 'continuum-city' + (pairProgram.on ? '-painted' : '');
  mat.userData.mark = MARK.built;
  return withAtmosphere(mat);
}

// A tile's buildings go: the geometry and the matrices and colours the instances hold on the GPU
// (three.js lets those go with the mesh, not with the geometry).
function release(mesh) {
  mesh.geometry.dispose();
  mesh.dispose();
}

export class City {
  constructor(scene, land, corridor, seed, opts = {}) {
    this.land = land;
    this.corridor = corridor;
    this.seed = seed;
    this.worlds = land.worlds;
    this.skyline = makeSkyline(seed);
    this.group = new THREE.Group();
    this.group.name = 'city';
    scene.add(this.group);
    this.origin = { x: 0, z: 0 };
    this.far = FAR;              // how far towers are built and drawn (setDetail)
    this.geo = boxGeometry();
    this.material = makeMaterial();
    this.tiles = new Map();
    // Every baked building by its lot, in grid coordinates, so a camera can
    // ask whether a point is inside one: [along, lat, half along, half lat,
    // bottom, top] for the block and its crown.
    this.lots = new Map();
    this.budgetMs = opts.budgetMs || 2;
    this.rail = opts.rail || null;   // the railway the towers keep off (world/cityrail.js)
    this.baking = null;
    this.stale = new Set();      // tiles to build again, drawn until then (markStale)
    this.holdStale = false;
    this.buildings = 0;
    this.beaconRev = 0;          // changes when the lights on the towers that are drawn do
    this._out = {};
    this._w = { a: 0, b: 0, t: 0, u: 0 };
    this._uv = { along: 0, lat: 0 };
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  // A tower as a tile draws it (instanced, coloured, casting and taking shadows), for the programs of the
  // towers to be built ahead (Game._warmAhead): nothing is drawn with it, and it holds nothing on the GPU.
  warmMesh() {
    const mesh = new THREE.InstancedMesh(this.geo, this.material, 1);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  setOrigin(x, z) {
    this.origin.x = x;
    this.origin.z = z;
    for (const t of this.tiles.values()) t.group.position.set(t.x0 - x, 0, t.z0 - z);
  }

  // How much of a point is city, 0..1.
  share(ax, az) {
    const w = this.worlds.at(ax, az, this._w);
    return (w.a === CITY ? 1 - w.t : 0) + (w.b === CITY ? w.t : 0);
  }

  // Whether an absolute point is inside a building. Every building stands
  // inside its own lot, so one lot is all there is to look at.
  solidAt(ax, y, az) {
    if (!this.lots.size) return false;
    const uv = this.worlds.axisUV(ax, az, this._uv);
    const boxes = this.lots.get(lotKey(Math.floor(uv.along / LOT), Math.floor(uv.lat / LOT)));
    if (!boxes) return false;
    for (const b of boxes) {
      if (y > b[4] && y < b[5] && Math.abs(uv.along - b[0]) < b[2] && Math.abs(uv.lat - b[1]) < b[3]) return true;
    }
    return false;
  }

  *_bake(ix, iz) {
    const x0 = ix * TILE;
    const z0 = iz * TILE;
    const tile = { x0, z0, group: new THREE.Group(), count: 0, mesh: null, lots: [], beacons: [], roof: [], tops: [], steam: [], signs: [], lamps: [] };
    tile.group.position.set(x0 - this.origin.x, 0, z0 - this.origin.z);
    // Most of the map is not city: test the corners and centre first.
    let any = 0;
    for (const [fx, fz] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) any = Math.max(any, this.share(x0 + fx * TILE, z0 + fz * TILE));
    if (any < 0.02) return tile;
    yield;

    const map = this.worlds;
    const dx = map.dx;
    const dz = map.dz;
    const angle = -Math.atan2(dz, dx);
    // The tile's corners in grid coordinates (along, across the city's axis).
    const uv = this._uv;
    let a0 = Infinity;
    let a1 = -Infinity;
    let l0 = Infinity;
    let l1 = -Infinity;
    for (const [cx, cz] of [[x0, z0], [x0 + TILE, z0], [x0, z0 + TILE], [x0 + TILE, z0 + TILE]]) {
      map.axisUV(cx, cz, uv);
      a0 = Math.min(a0, uv.along);
      a1 = Math.max(a1, uv.along);
      l0 = Math.min(l0, uv.lat);
      l1 = Math.max(l1, uv.lat);
    }
    const ctx = this.corridor.prepare(x0 - 40, z0 - 40, TILE + 80, 32);
    const out = this._out;
    const mats = [];
    const cols = [];
    const blds = [];
    const signA = [];
    const signB = [];
    const seed = this.seed;
    const rail = this.rail;
    let ymax = 0;
    const put = (cx, cy, cz, w, h, d, rot, col, bseed, lit, sign = NO_SIGN) => {
      this._p.set(cx - x0, cy, cz - z0);
      this._q.setFromAxisAngle(this._up, rot);
      this._s.set(w, h, d);
      this._m.compose(this._p, this._q, this._s);
      mats.push(...this._m.elements);
      cols.push(col.r, col.g, col.b);
      blds.push(bseed, lit);
      signA.push(sign[0], sign[1], sign[2], sign[3]);
      signB.push(sign[4], sign[5], sign[6], sign[7]);
      ymax = Math.max(ymax, cy + h);
    };
    for (let i = Math.floor(a0 / LOT); i <= Math.ceil(a1 / LOT); i++) {
      for (let j = Math.floor(l0 / LOT); j <= Math.ceil(l1 / LOT); j++) {
        // The lot's centre, back in absolute coordinates.
        const ga = (i + 0.5) * LOT + (hash2(i, j, seed + 11) - 0.5) * 6;
        const gl = (j + 0.5) * LOT + (hash2(i, j, seed + 12) - 0.5) * 6;
        const cx = map.ox + ga * dx - gl * dz;
        const cz = map.oz + ga * dz + gl * dx;
        if (cx < x0 || cx >= x0 + TILE || cz < z0 || cz >= z0 + TILE) continue;
        const share = this.share(cx, cz);
        if (share < 0.05 || hash2(i, j, seed + 13) > 0.9) continue;
        if (this.skyline.park(cx, cz) > 0.25) continue;
        const r1 = hash2(i, j, seed + 14);
        const r2 = hash2(i, j, seed + 15);
        const r3 = hash2(i, j, seed + 16);
        const r4 = hash2(i, j, seed + 17);
        const w = 16 + 22 * r1;
        const d = 16 + 22 * r2;
        const core = this.skyline.core(cx, cz);
        const tower = core * core * (50 + 170 * r4 * r4) * (0.75 + 0.25 * this.skyline.block(cx, cz));
        const h = (9 + 26 * r3 * r3 + Math.max(0, tower)) * share;
        if (h < 4) continue;
        // Clear of the railway's viaduct (world/cityrail.js), by its half width and a little.
        if (rail && rail.near(cx, cz, 48) < 0.5 * Math.hypot(w, d) + RAIL_CLEAR) continue;
        // Clear of the road at every corner, with room to spare at the centre.
        const rot = angle + (r3 > 0.85 ? Math.PI / 2 : 0);
        const cr = Math.cos(rot);
        const sr = Math.sin(rot);
        let clear = true;
        let base = Infinity;
        for (const [ox, oz] of [[0, 0], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
          const px = cx + (ox * w) * cr + (oz * d) * sr;
          const pz = cz - (ox * w) * sr + (oz * d) * cr;
          this.corridor.shape(ctx, px, pz, this.land.heightAt(px, pz), out);
          if (out.near < (ox === 0 && oz === 0 ? 30 : 13)) {
            clear = false;
            break;
          }
          base = Math.min(base, out.h);
        }
        if (!clear) continue;
        const col = FACADES[Math.floor(hash2(i, j, seed + 18) * FACADES.length)];
        const bseed = hash2(i, j, seed + 19);
        const lit = 0.18 + 0.4 * hash2(i, j, seed + 20);
        // A sign over the street floor of three in ten (on one face, put where it is in metres).
        const sign = hash2(i, j, seed + 21) < SIGN.share ? signOf(i, j, seed, w, d, this._toward(cx, cz, cr, sr)) : NO_SIGN;
        put(cx, base - 0.6, cz, w, h + 0.6, d, rot, col, bseed, lit, sign);
        if (sign !== NO_SIGN) {
          // Its middle, and the way its face looks, in absolute coordinates (for the checks: signsInView).
          const f = sign[0];
          const fw = f < 2 ? d : w;
          const across = sign[1] - fw / 2;
          const lx = f < 2 ? (f === 0 ? w / 2 : -w / 2) : across;
          const lz = f < 2 ? across : (f === 2 ? d / 2 : -d / 2);
          const nx = f < 2 ? (f === 0 ? 1 : -1) : 0;
          const nz = f < 2 ? 0 : (f === 2 ? 1 : -1);
          tile.signs.push(cx + lx * cr + lz * sr, base - 0.6 + sign[2] + sign[4] / 2, cz - lx * sr + lz * cr, nx * cr + nz * sr, -nx * sr + nz * cr);
        }
        // A crown: a setback storey block on the taller towers.
        const crown = h * (0.06 + 0.1 * r1);
        const tall = h > 60;
        // What stands on the roof (render/citylife.js draws it), on the crown's where there is one.
        tile.tops.push(cx, cz, roofOf(tile.roof, i, j, seed, cx, base + h + (tall ? crown : 0), cz, tall ? w * 0.68 : w, tall ? d * 0.68 : d, rot));
        // A plume of steam off one in ten of the tall towers.
        if (tall && hash2(i, j, seed + 22) < STEAM_SHARE) tile.steam.push(cx, base + h + crown, cz, hash2(i, j, seed + 23));
        if (h > 60) {
          put(cx, base + h, cz, w * 0.68, crown, d * 0.68, rot, col, bseed + 0.5, lit * 0.8);
          // The red light on a mast over the top of it (render/nightlight.js).
          tile.beacons.push(cx, base + h + crown + MAST, cz);
        }
        // The same boxes for the cameras, in grid coordinates: the block's
        // width runs along the grid unless it is turned a quarter.
        const ha = (r3 > 0.85 ? d : w) / 2;
        const hl = (r3 > 0.85 ? w : d) / 2;
        const boxes = [[ga, gl, ha, hl, base - 0.6, base + h]];
        if (h > 60) boxes.push([ga, gl, ha * 0.68, hl * 0.68, base + h, base + h + crown]);
        tile.lots.push([lotKey(i, j), boxes]);
      }
      yield;
    }
    // The lamps along the paths of the parks: the lines of the street grid where they cross a park,
    // a lamp every PARK_LAMP.every metres along them, off the road and the railway.
    const lampAt = (ga, gl) => {
      const px = map.ox + ga * dx - gl * dz;
      const pz = map.oz + ga * dz + gl * dx;
      if (px < x0 || px >= x0 + TILE || pz < z0 || pz >= z0 + TILE) return;
      if (this.skyline.park(px, pz) < PARK_LAMP.park || this.share(px, pz) < 0.6) return;
      if (rail && rail.near(px, pz, 20) < 12) return;
      this.corridor.shape(ctx, px, pz, this.land.heightAt(px, pz), out);
      if (out.near < 16) return;
      tile.lamps.push(px, out.h + PARK_LAMP.height, pz);
    };
    const E = PARK_LAMP.every;
    for (let i = Math.floor(a0 / LOT); i <= Math.ceil(a1 / LOT); i++) {
      for (let gl = Math.ceil(l0 / E) * E; gl <= l1; gl += E) lampAt(i * LOT, gl);
    }
    for (let j = Math.floor(l0 / LOT); j <= Math.ceil(l1 / LOT); j++) {
      for (let ga = Math.ceil(a0 / E) * E; ga <= a1; ga += E) lampAt(ga, j * LOT);
    }
    yield;
    const n = blds.length / 2;
    tile.count = n;
    if (n) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', this.geo.getAttribute('position'));
      geo.setAttribute('normal', this.geo.getAttribute('normal'));
      geo.setIndex(this.geo.getIndex());
      geo.setAttribute('aBld', new THREE.InstancedBufferAttribute(new Float32Array(blds), 2));
      geo.setAttribute('aSignA', new THREE.InstancedBufferAttribute(new Float32Array(signA), 4));
      geo.setAttribute('aSignB', new THREE.InstancedBufferAttribute(new Float32Array(signB), 4));
      const mesh = new THREE.InstancedMesh(geo, this.material, n);
      mesh.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(mats), 16);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cols), 3);
      const sphere = new THREE.Sphere(new THREE.Vector3(TILE / 2, ymax / 2, TILE / 2), Math.hypot(TILE / 2, TILE / 2, ymax / 2) + 40);
      mesh.boundingSphere = sphere;
      geo.boundingSphere = sphere;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      tile.group.add(mesh);
      tile.mesh = mesh;
      this.buildings += n;
    }
    for (const [key, boxes] of tile.lots) this.lots.set(key, boxes);
    this.group.add(tile.group);
    return tile;
  }

  update(camAbsX, camAbsZ, sync = false) {
    const r = Math.ceil(this.far / TILE) + 1;
    const cx = Math.floor(camAbsX / TILE);
    const cz = Math.floor(camAbsZ / TILE);
    const missing = [];
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        const ix = cx + i;
        const iz = cz + j;
        const d = Math.hypot((ix + 0.5) * TILE - camAbsX, (iz + 0.5) * TILE - camAbsZ);
        if (d > this.far + TILE * 0.7) continue;
        const key = ix + ':' + iz;
        if (!this.tiles.has(key) || (!this.holdStale && this.stale.has(key))) missing.push([d, ix, iz, key]);
      }
    }
    missing.sort((a, b) => a[0] - b[0]);
    const t0 = performance.now();
    const ready = (key) => this.tiles.has(key) && (this.holdStale || !this.stale.has(key));
    // A tile baked again replaces the old one; the new one has already put
    // its lots in, so only the old lots it no longer has are taken out.
    const put = (key, tile) => {
      const old = this.tiles.get(key);
      if (old) {
        this.group.remove(old.group);
        if (old.mesh) release(old.mesh);
        const kept = new Set(tile.lots.map(([k]) => k));
        for (const [k] of old.lots) if (!kept.has(k)) this.lots.delete(k);
        this.buildings -= old.count;
      }
      this.stale.delete(key);
      this.tiles.set(key, tile);
      this.beaconRev++;
    };
    if (sync) {
      this.baking = null;
      for (const [, ix, iz, key] of missing) {
        const gen = this._bake(ix, iz);
        let res = gen.next();
        while (!res.done) res = gen.next();
        put(key, res.value);
      }
    } else {
      if (this.baking && !missing.some((m) => m[3] === this.baking.key)) this.baking = null;
      let next = 0;
      while (performance.now() - t0 < this.budgetMs) {
        if (!this.baking) {
          while (next < missing.length && ready(missing[next][3])) next++;
          if (next >= missing.length) break;
          const [, ix, iz, key] = missing[next++];
          this.baking = { key, gen: this._bake(ix, iz) };
        }
        const res = this.baking.gen.next();
        if (res.done) {
          put(this.baking.key, res.value);
          this.baking = null;
        }
      }
    }
    for (const [key, t] of this.tiles) {
      const d = Math.hypot(t.x0 + TILE / 2 - camAbsX, t.z0 + TILE / 2 - camAbsZ);
      if (d > FAR + TILE * 2) {
        this.group.remove(t.group);
        if (t.mesh) release(t.mesh);
        for (const [k] of t.lots) this.lots.delete(k);
        this.buildings -= t.count;
        this.tiles.delete(key);
        this.stale.delete(key);
        this.beaconRev++;
        continue;
      }
      const shown = d <= this.far + TILE * 0.7;
      if (t.group.visible !== shown) {
        t.group.visible = shown;
        this.beaconRev++;
      }
    }
  }

  // The tops of the towers that carry a light, [x, y, z, ...] in absolute coordinates, of the tiles that are
  // drawn, into `out`.
  beacons(out) {
    out.length = 0;
    for (const t of this.tiles.values()) {
      if (!t.group.visible) continue;
      for (let i = 0; i < t.beacons.length; i++) out.push(t.beacons[i]);
    }
    return out;
  }

  // Which face of a building (its middle cx, cz, turned by cos cr, sin sr) looks most toward the
  // nearest point of the road within SIGN.reach of it (0 +x, 1 -x, 2 +z, 3 -z), or -1 if none is so near.
  _toward(cx, cz, cr, sr) {
    const road = this.corridor.road;
    let best = SIGN.reach * SIGN.reach;
    let bx = 0;
    let bz = 0;
    road.forEachSegmentNear(cx, cz, SIGN.reach, (i) => {
      const q = road.samples.get(i);
      const dd = q ? (q.ax - cx) ** 2 + (q.az - cz) ** 2 : Infinity;
      if (dd < best) {
        best = dd;
        bx = q.ax - cx;
        bz = q.az - cz;
      }
    });
    if (!bx && !bz) return -1;
    // The way to it in the building's own frame: x along (cr, -sr), z along (sr, cr).
    const lx = bx * cr - bz * sr;
    const lz = bx * sr + bz * cr;
    return Math.abs(lx) > Math.abs(lz) ? (lx > 0 ? 0 : 1) : (lz > 0 ? 2 : 3);
  }

  // The signs of the tiles that are drawn within r (m) of an absolute point, [x, y, z, nx, nz, ...]
  // (the middle of each and the way its face looks), into out.
  signsNear(ax, az, r, out) {
    out.length = 0;
    for (const t of this.tiles.values()) {
      if (!t.group.visible) continue;
      const g = t.signs;
      for (let i = 0; i < g.length; i += 5) if (Math.hypot(g[i] - ax, g[i + 2] - az) < r) out.push(g[i], g[i + 1], g[i + 2], g[i + 3], g[i + 4]);
    }
    return out;
  }

  // Mark the tiles test(x0, z0, size) picks to be built again, drawn as
  // they are until then (as the terrain's, see TerrainField.markStale).
  markStale(test) {
    for (const [key, t] of this.tiles) if (test(t.x0, t.z0, TILE)) this.stale.add(key);
    if (this.baking) {
      const [ix, iz] = this.baking.key.split(':').map(Number);
      if (test(ix * TILE, iz * TILE, TILE)) this.baking = null;
    }
  }

  // At lower quality the skyline is drawn less far (to 60% of the full
  // 3.6 km); tiles already built stay, hidden, in case it comes back.
  setDetail(f) {
    this.far = FAR * Math.max(0.6, Math.min(1, f));
  }
}
