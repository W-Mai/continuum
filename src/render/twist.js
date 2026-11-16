// The world wound over, for the way into the Upside Down (world 'upside') and
// the way out of it: the road into a corkscrew, and the land folded over
// with it.
//
// Where the road crosses the border the world is wound a half turn about the
// way the road runs there (the zone: render/upside.js finds it and lays the
// numbers here). The winding is in the world, not on the screen: how far a
// point is turned depends only on where it stands.
//
//  - The road is wound over the zone's own length, a few hundred metres. The
//    car drives on along it and goes over with it.
//  - What stands away from the road is wound over more: LEN_K metres for
//    each metre it is from the zone's line, up to LEN_MAX. So the land is not
//    a wall across the road but a fold kilometres long: it stands up on one
//    side, goes over the top and comes down on the other, and the world past
//    it hangs the other way up. It can be seen from as far off as the land
//    is drawn.
//  - Near the zone's line a point is wound by how far along the line it is.
//    Far from it, by how far past the border of the worlds it is: the border
//    is not a ruler line, and a road that comes up to it aslant runs beside
//    the zone's line for a long way and never beside the border.
//  - It is all turned about one line that stays where it is in the world:
//    the zone's own, HEART m over the road. Only a lens within NEAR m of
//    that line takes the line with it, so that from the road the land is
//    always seen from above its own surface and nothing is swung through
//    the lens; from further off the fold holds still as the lens moves.
//
// It is drawn from the car's side of things. The car is the anchor: what
// stands where it does is drawn where it is, and everything else is turned
// by its own angle less the car's; the lens is rolled by the car's angle
// (render/turn.js). The same picture as a world wound up and a car and a
// camera gone round with it.
//
// The car's angle is the road's, by how far along the road it is: nothing
// before the wound stretch, a half turn past it, wherever the road goes. A
// road is not a straight line, and where it bends away from the zone's the
// land's own angle under it is some other: so what is within CAR[0] m of the
// car is turned as the car is, and from there out to CAR[1] less and less
// so. On a straight road through the stretch that changes nothing; on a
// winding one the car still has the road under its wheels.
//
// This is done where a vertex is projected: after the view-space position is
// made, it is turned about the line. The lighting, the haze and the shadows
// are read from the position as it was, so a surface is lit as it was and
// only drawn somewhere else; what the fold lifts off the ground and into the
// sky thins out into the sky (the haze, render/atmosphere.js). With no zone
// in reach, uTwist.x is 0 and the shaders return at once.

import * as THREE from 'three';
import { WARP_AMP, WARP_SCALE } from '../world/worlds.js';

// How far past the end, as a share of the half turn, the winding goes before
// it comes back: the last of it, a hair.
const OVER = 0.02;
// What is rho from the zone's line is wound over hypot(len, min(LEN_K * rho,
// LEN_MAX)) of it.
export const LEN_K = 3;
export const LEN_MAX = 3000;
// The line the world is turned about is the zone's own, HEART m over the
// road; it goes with the lens while the lens is within NEAR m of that.
export const HEART = 4;
export const NEAR = 60;
// Within BY_LINE[0] m of the zone's line a point is wound by how far along
// the line it is; from BY_LINE[1] m off, by how far past the border of the
// worlds it is (their progress, the same number the ground changes colour
// by).
export const BY_LINE = [60, 200];
// What is this near the car is turned as the car is; from the second on, as
// the land is.
export const CAR = [150, 600];
const PEAK = 666;              // 1 / the top of f^18 (1 - f)^2

export const twistU = {
  // Typed arrays, not Vector4s: three clones a vector for each material it
  // builds from its own shaders, and keeps a typed array as the one it was
  // given, so every material reads the same numbers.
  // x: on; y: the angle before the zone, less the car's; z: the angle the zone
  // adds (a half turn); w: the zone's length.
  uTwist: { value: new Float32Array(4) },
  // xyz: the way the zone runs, in view space; w: how far along it the lens is.
  uTwistAxis: { value: new Float32Array(4) },
  // xyz: a point the line the world is turned about goes through, in view
  // space (the lens, while the lens is near the zone's own line).
  uTwistAt: { value: new Float32Array(4) },
  // xyz: level and across the zone, in view space; w: how far to that side
  // of the zone's line the lens is.
  uTwistSide: { value: new Float32Array(4) },
  // xyz: the car, in view space; w: the car's angle less the land's under it.
  uTwistCar: { value: new Float32Array(4) },
  // The worlds' progress past the border, for a view-space point: xyz dotted
  // with it and w added give the straight part; uFoldQx, uFoldQz the same
  // way give its absolute x and z over the warp's scale, for the warp.
  uFoldLin: { value: new Float32Array(4) },
  uFoldQx: { value: new Float32Array(4) },
  uFoldQz: { value: new Float32Array(4) },
};

// The sky dome's (render/atmosphere.js; render/upside.js lays them).
// uSkyTurn: x: the angle the dome is turned by, less the car's; y: how much
// the other sky shows under the horizon whichever way the lens looks (1 by
// the zone); z, w: the level direction the fold is in, in the dome's own
// frame: toward it the other sky shows under the horizon from any distance.
// uSkyAxis: the way the zone runs, in the scene's coordinates.
export const skyTurnU = {
  uSkyTurn: { value: new Float32Array(4) },
  uSkyAxis: { value: new Float32Array(4) },
};

// GLSL for a shader of our own that has no <common>: declarations and
// twistView(), the view-space position as it is drawn. A vertex shader of a
// built-in material gets both through <common> (patched below) and the
// projection through <project_vertex>.
export const TWIST_PARS = /* glsl */`
uniform vec4 uTwist;
uniform vec4 uTwistAxis;
uniform vec4 uTwistAt;
uniform vec4 uTwistSide;
uniform vec4 uTwistCar;
uniform vec4 uFoldLin;
uniform vec4 uFoldQx;
uniform vec4 uFoldQz;
// Where twistView last put a vertex, in view space, for the haze to read.
vec3 twistDrawn;
// The same integer hash as world/worlds.js's lattice and worldlook.js's.
float foldLattice( ivec2 p ) {
  uint h = ( uint( p.x ) * 0x8da6b343u ) ^ ( uint( p.y ) * 0xd8163841u );
  h ^= h >> 13u;
  h *= 0x5bd1e995u;
  h ^= h >> 15u;
  return float( h & 0xffffffu ) / 16777216.0;
}
// How far past the border a view-space point is, in the worlds' progress.
float foldPast( vec3 p ) {
  vec2 q = vec2( dot( p, uFoldQx.xyz ) + uFoldQx.w, dot( p, uFoldQz.xyz ) + uFoldQz.w );
  vec2 i = floor( q );
  vec2 f = q - i;
  f = f * f * ( 3.0 - 2.0 * f );
  ivec2 c = ivec2( i );
  float a = foldLattice( c );
  float b = foldLattice( c + ivec2( 1, 0 ) );
  float d = foldLattice( c + ivec2( 0, 1 ) );
  float e = foldLattice( c + ivec2( 1, 1 ) );
  float v = a + ( b - a ) * f.x + ( d + ( e - d ) * f.x - ( a + ( b - a ) * f.x ) ) * f.y;
  return dot( p, uFoldLin.xyz ) + uFoldLin.w + ( v - 0.5 ) * ${(2 * WARP_AMP).toFixed(1)};
}
// The angle a view-space point is turned by, less the car's.
float twistAngle( vec3 p ) {
  float u = dot( p, uTwistAxis.xyz ) + uTwistAxis.w;
  float rho = abs( dot( p, uTwistSide.xyz ) + uTwistSide.w );
  float along = mix( u - 0.5 * uTwist.w, foldPast( p ), smoothstep( ${BY_LINE[0].toFixed(1)}, ${BY_LINE[1].toFixed(1)}, rho ) );
  float w = min( ${LEN_K.toFixed(1)} * rho, ${LEN_MAX.toFixed(1)} );
  float f = clamp( along / sqrt( uTwist.w * uTwist.w + w * w ) + 0.5, 0.0, 1.0 );
  float g = 1.0 - f;
  float e = f * f * f * ( 10.0 + f * ( 6.0 * f - 15.0 ) ) + ${(OVER * PEAK).toFixed(2)} * pow( f, 18.0 ) * g * g;
  return uTwist.y + uTwist.z * e
    + uTwistCar.w * ( 1.0 - smoothstep( ${CAR[0].toFixed(1)}, ${CAR[1].toFixed(1)}, distance( p, uTwistCar.xyz ) ) );
}
vec3 twistTurn( vec3 p, float a ) {
  vec3 d = uTwistAxis.xyz;
  float c = cos( a );
  return p * c + cross( d, p ) * sin( a ) + d * ( dot( d, p ) * ( 1.0 - c ) );
}
vec4 twistView( vec4 mv ) {
  twistDrawn = mv.xyz;
  if ( uTwist.x < 0.5 ) return mv;
  twistDrawn = twistTurn( mv.xyz - uTwistAt.xyz, twistAngle( mv.xyz ) ) + uTwistAt.xyz;
  return vec4( twistDrawn, mv.w );
}
// The sky has no distance, so it cannot be wound by where it is: the whole
// dome is turned by one angle, a (render/upside.js says which), and it is
// the sky's own shader that lays the sky of the other side of the winding
// under its horizon (render/atmosphere.js).
vec4 twistSky( vec4 mv, float a ) {
  if ( uTwist.x < 0.5 ) return mv;
  return vec4( twistTurn( mv.xyz, a ), mv.w );
}
`;

// Every built-in material: <common> carries the declarations (the fragment
// shaders get them too: the haze reads uTwist), and the vertex
// is projected from the turned position. A shadow map is drawn through an
// orthographic camera and is not turned. The position the lighting and the
// haze read is the one before.
THREE.ShaderChunk.common += TWIST_PARS;
THREE.ShaderChunk.project_vertex = THREE.ShaderChunk.project_vertex.replace(
  'gl_Position = projectionMatrix * mvPosition;',
  `twistDrawn = mvPosition.xyz;
gl_Position = projectionMatrix * ( projectionMatrix[ 3 ][ 3 ] < 0.5 ? twistView( mvPosition ) : mvPosition );`,
);
// A sprite has a vertex shader of its own: the light's glare, a flare.
THREE.ShaderLib.sprite.vertexShader = THREE.ShaderLib.sprite.vertexShader.replace(
  'gl_Position = projectionMatrix * mvPosition;',
  'gl_Position = projectionMatrix * twistView( mvPosition );',
);
// The uniforms ride on every material three builds from its own shaders, not
// only the ones a hook of ours has passed through: a glow laid on the road, a
// mark on the asphalt, anything. (The shadow's depth materials are left out:
// a shadow map is not a view.)
for (const id of ['basic', 'lambert', 'phong', 'standard', 'physical', 'toon', 'matcap', 'points', 'dashed', 'normal', 'sprite']) {
  const lib = THREE.ShaderLib[id];
  if (lib) Object.assign(lib.uniforms, twistU);
}

// How far the winding has got, 0 to 1, a share f of the way through: at rest
// at both ends, quickest in the middle, a hair past the end and back.
export function twistEase(f) {
  f = Math.min(1, Math.max(0, f));
  return f * f * f * (10 + f * (6 * f - 15)) + OVER * PEAK * Math.pow(f, 18) * (1 - f) * (1 - f);
}

// How far the winding has got (0 to 1) at a place: u along the zone's line,
// rho from it, past: its progress past the worlds' border. As twistAngle in
// the shader.
export function twistShare(zone, u, rho, past) {
  let k = (rho - BY_LINE[0]) / (BY_LINE[1] - BY_LINE[0]);
  k = k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k);
  const along = k > 0 ? (u - zone.len / 2) * (1 - k) + past * k : u - zone.len / 2;
  return twistEase(along / Math.hypot(zone.len, Math.min(LEN_K * rho, LEN_MAX)) + 0.5);
}

// What setTwist laid last: the zone, the lens, the worlds and the scene's
// origin, the car's angle and place, and the car's angle less the land's
// under it.
const laid = { zone: null, camera: null, worlds: null, ox: 0, oz: 0, ref: 0, off: 0, cx: 0, cy: 0, cz: 0 };

// The zone's line as laid last, in the scene's coordinates, for the sea's
// disc to be held on (render/water.js).
export const twistLine = { x: 0, z: 0, dx: 1, dz: 0, len: 0 };

const _axis = new THREE.Vector3();
const _side = new THREE.Vector3();
const _at = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _w = new THREE.Vector3();

// How far round the road itself is, s along it: the wound stretch is
// zone.run of the road about zone.s.
export function twistRoad(zone, s) {
  return zone.lo + zone.span * twistEase((s - zone.s) / zone.run + 0.5);
}

// How far over the land is wound at a place of the scene, as laid last: the
// zone's angle before it (lo) to that and its span. 0 with nothing laid.
export function twistAt(x, z) {
  const zone = laid.zone;
  if (!zone) return 0;
  const rx = x - zone.p.x;
  const rz = z - zone.p.z;
  const rho = Math.abs(rx * -zone.d.z + rz * zone.d.x);
  // The worlds are asked only where the answer counts.
  const past = rho > BY_LINE[0] ? laid.worlds.rawU(x + laid.ox, z + laid.oz) - zone.ub : 0;
  return zone.lo + zone.span * twistShare(zone, rx * zone.d.x + rz * zone.d.z, rho, past);
}

// What is added to that by the car, at a point of the scene: all of the
// car's angle less the land's under it by the car, none far from it.
export function twistNear(x, y, z) {
  if (!laid.zone || laid.off === 0) return 0;
  const d = Math.hypot(x - laid.cx, y - laid.cy, z - laid.cz);
  if (d >= CAR[1]) return 0;
  const k = d <= CAR[0] ? 0 : (d - CAR[0]) / (CAR[1] - CAR[0]);
  return laid.off * (1 - k * k * (3 - 2 * k));
}

// Lay the numbers for a frame. zone: where the winding is (p: its start, in
// the scene's coordinates; y: the road's height at its middle; d: the way it
// runs, a level unit vector; len; s, run: its middle on the road and how
// much of the road it is; lo: the angle before it; span: the angle it adds;
// ub: the worlds' progress at its middle). camera: as it is drawn. car:
// where the car is, sCar: how far along the road. worlds: the schedule
// (world/worlds.js), origin: the scene's. Returns whether anything is turned.
export function setTwist(zone, camera, car, sCar, worlds, origin) {
  const t = twistU.uTwist.value;
  if (!zone) {
    t[0] = 0;
    laid.zone = null;
    return false;
  }
  laid.zone = zone;
  laid.camera = camera;
  laid.worlds = worlds;
  laid.ox = origin.x;
  laid.oz = origin.z;
  laid.ref = twistRoad(zone, sCar);
  laid.off = laid.ref - twistAt(car.x, car.z);
  laid.cx = car.x;
  laid.cy = car.y;
  laid.cz = car.z;
  t[0] = 1;
  t[1] = zone.lo - laid.ref;
  t[2] = zone.span;
  t[3] = zone.len;
  twistLine.x = zone.p.x;
  twistLine.z = zone.p.z;
  twistLine.dx = zone.d.x;
  twistLine.dz = zone.d.z;
  twistLine.len = zone.len;
  _q.copy(camera.quaternion).invert();
  const cx = camera.position.x - zone.p.x;
  const cz = camera.position.z - zone.p.z;
  _axis.set(zone.d.x, 0, zone.d.z).applyQuaternion(_q);
  const a = twistU.uTwistAxis.value;
  a[0] = _axis.x;
  a[1] = _axis.y;
  a[2] = _axis.z;
  a[3] = cx * zone.d.x + cz * zone.d.z;
  // Across the zone, level; and how far to that side of its line the lens is.
  const cl = cx * -zone.d.z + cz * zone.d.x;
  _side.set(-zone.d.z, 0, zone.d.x).applyQuaternion(_q);
  const sd = twistU.uTwistSide.value;
  sd[0] = _side.x;
  sd[1] = _side.y;
  sd[2] = _side.z;
  sd[3] = cl;
  // The car, as the lens sees it.
  _side.set(car.x, car.y, car.z).sub(camera.position).applyQuaternion(_q);
  const tc = twistU.uTwistCar.value;
  tc[0] = _side.x;
  tc[1] = _side.y;
  tc[2] = _side.z;
  tc[3] = laid.off;
  // The line it is all turned about: through the lens while the lens is
  // within NEAR of the zone's own line (HEART over the road), and NEAR from
  // that line toward the lens when the lens is further.
  const cv = camera.position.y - (zone.y || 0) - HEART;
  const cn = Math.hypot(cl, cv);
  const k = cn > NEAR ? 1 - NEAR / cn : 0;
  _at.set(-zone.d.z * cl, cv, zone.d.x * cl).multiplyScalar(-k).applyQuaternion(_q);
  const at = twistU.uTwistAt.value;
  at[0] = _at.x;
  at[1] = _at.y;
  at[2] = _at.z;
  // The worlds' progress past the border: the straight part from the lens,
  // and the lens's absolute place over the warp's scale.
  const ax = camera.position.x + origin.x;
  const az = camera.position.z + origin.z;
  const lin = twistU.uFoldLin.value;
  _side.set(worlds.dx, 0, worlds.dz).applyQuaternion(_q);
  lin[0] = _side.x;
  lin[1] = _side.y;
  lin[2] = _side.z;
  lin[3] = worlds.rawU(ax, az) - worlds.warp(ax, az) - zone.ub;
  const qx = twistU.uFoldQx.value;
  _side.set(1 / WARP_SCALE, 0, 0).applyQuaternion(_q);
  qx[0] = _side.x;
  qx[1] = _side.y;
  qx[2] = _side.z;
  qx[3] = ax / WARP_SCALE;
  const qz = twistU.uFoldQz.value;
  _side.set(0, 0, 1 / WARP_SCALE).applyQuaternion(_q);
  qz[0] = _side.x;
  qz[1] = _side.y;
  qz[2] = _side.z;
  qz[3] = az / WARP_SCALE;
  return true;
}

export function clearTwist() {
  twistU.uTwist.value[0] = 0;
  laid.zone = null;
}

// The car's angle, as laid last, and that less the land's under it.
export function twistRef() {
  return laid.zone ? laid.ref : 0;
}
export function twistOff() {
  return laid.zone ? laid.off : 0;
}

// A view-space point of something wound over by `angle` (twistAt of where it
// stands, and twistNear), as it is drawn: turned by that less the car's,
// about the line. In place.
export function twistTurned(v, angle) {
  if (!laid.zone) return v;
  const a = twistU.uTwistAxis.value;
  const at = twistU.uTwistAt.value;
  _axis.set(a[0], a[1], a[2]);
  _at.set(at[0], at[1], at[2]);
  return v.sub(_at).applyAxisAngle(_axis, angle - laid.ref).add(_at);
}

// How far a view-space point is from the line it is all turned about.
export function twistReach(v) {
  const a = twistU.uTwistAxis.value;
  const at = twistU.uTwistAt.value;
  const x = v.x - at[0];
  const y = v.y - at[1];
  const z = v.z - at[2];
  const along = x * a[0] + y * a[1] + z * a[2];
  return Math.sqrt(Math.max(0, x * x + y * y + z * z - along * along));
}

// A view-space point as it is drawn (as the shader does it), in place.
export function twistPoint(v) {
  if (twistU.uTwist.value[0] < 0.5 || !laid.zone) return v;
  _w.copy(v).applyMatrix4(laid.camera.matrixWorld);
  return twistTurned(v, twistAt(_w.x, _w.z) + twistNear(_w.x, _w.y, _w.z));
}
