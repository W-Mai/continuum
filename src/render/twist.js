// The road wound into a corkscrew, for the way into the Upside Down (world
// 'upside') and the way out of it.
//
// Where the road crosses the border the world is wound a half turn about the
// way the road runs there, over the length of a stretch of it (the zone:
// render/upside.js finds it and lays the numbers here). The winding is in the
// world, not on the screen: how far a point is turned depends only on how far
// along the zone's line it stands, so the road ahead is seen going up the
// side and over, the land with it, and what is past the zone hangs the other
// way up. The car drives on along it and goes over with it.
//
// It is drawn from the car's side of things. The car is the anchor: what
// stands level with it along the line is drawn where it is, and everything
// else is turned by its angle less the car's. The line it is turned about
// runs through the lens (and the lens is rolled by the car's angle,
// render/turn.js), so the land is always seen from above its own surface, and
// nothing is swung through the lens. The same picture as a world wound up and
// a car and a camera gone round with it.
//
// This is done where a vertex is projected: after the view-space position is
// made, it is turned about the zone's line. The lighting, the haze and the
// shadows are read from the position as it was, so a surface is lit as it
// was and only drawn somewhere else. With no zone near, uTwist.x is 0 and
// the shaders return at once.

import * as THREE from 'three';

// How far past the end, as a share of the half turn, the winding goes before
// it comes back: the last of it, a hair.
const OVER = 0.02;
const PEAK = 666;              // 1 / the top of f^18 (1 - f)^2

export const twistU = {
  // Typed arrays, not Vector4s: three clones a vector for each material it
  // builds from its own shaders, and keeps a typed array as the one it was
  // given, so every material reads the same numbers.
  // x: on; y: the angle before the zone, less the car's; z: the angle the zone
  // adds (a half turn); w: 1 / the zone's length.
  uTwist: { value: new Float32Array(4) },
  // xyz: the way the zone runs, in view space; w: how far along it the lens is.
  uTwistAxis: { value: new Float32Array(4) },
  // x, y: nothing is taken to be nearer the zone's start than this, or
  // further (the reach each way from the car).
  uTwistLim: { value: new Float32Array(4) },
};

// GLSL for a shader of our own that has no <common>: declarations and
// twistView(), the view-space position as it is drawn. A vertex shader of a
// built-in material gets both through <common> (patched below) and the
// projection through <project_vertex>.
export const TWIST_PARS = /* glsl */`
uniform vec4 uTwist;
uniform vec4 uTwistAxis;
uniform vec4 uTwistLim;
float twistAngle( float u ) {
  float f = clamp( clamp( u, uTwistLim.x, uTwistLim.y ) * uTwist.w, 0.0, 1.0 );
  float g = 1.0 - f;
  float e = f * f * f * ( 10.0 + f * ( 6.0 * f - 15.0 ) ) + ${(OVER * PEAK).toFixed(2)} * pow( f, 18.0 ) * g * g;
  return uTwist.y + uTwist.z * e;
}
vec3 twistTurn( vec3 p, float a ) {
  vec3 d = uTwistAxis.xyz;
  float c = cos( a );
  return p * c + cross( d, p ) * sin( a ) + d * ( dot( d, p ) * ( 1.0 - c ) );
}
vec4 twistView( vec4 mv ) {
  if ( uTwist.x < 0.5 ) return mv;
  return vec4( twistTurn( mv.xyz, twistAngle( dot( mv.xyz, uTwistAxis.xyz ) + uTwistAxis.w ) ), mv.w );
}
// The sky has no distance: ahead along the zone it is the sky of what is
// furthest ahead, behind it the sky of what is furthest behind, and between
// the two it is wound from one to the other.
vec4 twistSky( vec4 mv ) {
  if ( uTwist.x < 0.5 ) return mv;
  float s = dot( normalize( mv.xyz ), uTwistAxis.xyz );
  float a = mix( twistAngle( uTwistLim.x ), twistAngle( uTwistLim.y ), smoothstep( -0.5, 0.5, s ) );
  return vec4( twistTurn( mv.xyz, a ), mv.w );
}
`;

// Every built-in material: <common> carries the declarations (the fragment
// shaders get them too, unused), and the vertex is projected from the turned
// position. A shadow map is drawn through an orthographic camera and is not
// turned. The position the lighting and the haze read is the one before.
THREE.ShaderChunk.common += TWIST_PARS;
THREE.ShaderChunk.project_vertex = THREE.ShaderChunk.project_vertex.replace(
  'gl_Position = projectionMatrix * mvPosition;',
  'gl_Position = projectionMatrix * ( projectionMatrix[ 3 ][ 3 ] < 0.5 ? twistView( mvPosition ) : mvPosition );',
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

// How far the winding has got, 0 to 1, a share f of the way through the zone:
// at rest at both ends, quickest in the middle, a hair past the end and back.
export function twistEase(f) {
  f = Math.min(1, Math.max(0, f));
  return f * f * f * (10 + f * (6 * f - 15)) + OVER * PEAK * Math.pow(f, 18) * (1 - f) * (1 - f);
}

const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();

// Lay the numbers for a frame. zone: where the winding is (p: its start, in
// the scene's coordinates; d: the way it runs, a level unit vector; len; lo:
// the angle before it; span: the angle it adds). camera: as it is drawn.
// uCar: how far along the zone's line the car is; reach: how far from the
// car, each way, the winding is followed (past that, all is as at the reach).
// Returns whether anything in reach is turned.
export function setTwist(zone, camera, uCar, reach) {
  const t = twistU.uTwist.value;
  const lim = twistU.uTwistLim.value;
  if (!zone || uCar - reach >= zone.len || uCar + reach <= 0) {
    t[0] = 0;
    return false;
  }
  const ref = zone.lo + zone.span * twistEase(uCar / zone.len);
  t[0] = 1;
  t[1] = zone.lo - ref;
  t[2] = zone.span;
  t[3] = 1 / zone.len;
  _axis.set(zone.d.x, 0, zone.d.z).applyQuaternion(_q.copy(camera.quaternion).invert());
  const a = twistU.uTwistAxis.value;
  a[0] = _axis.x;
  a[1] = _axis.y;
  a[2] = _axis.z;
  a[3] = (camera.position.x - zone.p.x) * zone.d.x + (camera.position.z - zone.p.z) * zone.d.z;
  lim[0] = uCar - reach;
  lim[1] = uCar + reach;
  return true;
}

export function clearTwist() {
  twistU.uTwist.value[0] = 0;
}

// The angle a point is turned by, u along the zone's line (as the shader
// reads it): 0 where the car is.
export function twistAngle(u) {
  const t = twistU.uTwist.value;
  const lim = twistU.uTwistLim.value;
  if (t[0] < 0.5) return 0;
  return t[1] + t[2] * twistEase(Math.min(Math.max(u, lim[0]), lim[1]) * t[3]);
}

// A view-space point as it is drawn (as the shader does it), in place.
export function twistPoint(v) {
  const t = twistU.uTwist.value;
  if (t[0] < 0.5) return v;
  const a = twistU.uTwistAxis.value;
  _axis.set(a[0], a[1], a[2]);
  return v.applyAxisAngle(_axis, twistAngle(v.dot(_axis) + a[3]));
}
