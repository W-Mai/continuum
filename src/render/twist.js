// The view turned over, for the Upside Down (world 'upside').
//
// Entering it, the road ahead twists about the line of sight, a corkscrew,
// and once the car is in, the whole world is the other way up. This is done
// where a vertex is projected: after the view-space position is made, its x
// and y are turned about the view axis by an angle that depends on how far
// off the vertex is (the table below), so what is further down the road is
// turned further. Depth is unchanged by a turn about the view axis, so the
// depth buffer stays right; the lighting, the haze and the shadows are read
// from the position as it was, so a surface is lit as it was and only drawn
// somewhere else, which is what a camera that rolled would see.
//
// The table holds the angle at 16 depths (the first at 0 m, the last at
// TWIST_FAR, the spacing closer where it is near), laid by Game from the
// share of the Upside Down in the world at each. All zero is the world as it
// is: uTwist.x is 0 and the shaders return at once.

import * as THREE from 'three';

export const TWIST_FAR = 1200;
export const TWIST_N = 16;
const TWIST_POW = 1.7;

export const twistU = {
  // x: on. A typed array, not a Vector4: three clones a vector for each
  // material it builds from its own shaders, and keeps a typed array as the
  // one it was given, so every material reads the same numbers.
  uTwist: { value: new Float32Array(4) },
  uTwistTab: { value: new Float32Array(TWIST_N) },
};

// GLSL for a shader of our own that has no <common>: declarations and
// twistView(), the view-space position as it is drawn. A vertex shader of a
// built-in material gets both through <common> (patched below) and the
// projection through <project_vertex>.
export const TWIST_PARS = /* glsl */`
uniform vec4 uTwist;
uniform float uTwistTab[${TWIST_N}];
vec4 twistView( vec4 mv ) {
  if ( uTwist.x < 0.5 ) return mv;
  float f = pow( min( max( -mv.z, 0.0 ) / ${TWIST_FAR}.0, 1.0 ), ${(1 / TWIST_POW).toFixed(5)} ) * ${TWIST_N - 1}.0;
  int i = int( min( floor( f ), ${TWIST_N - 2}.0 ) );
  float a = mix( uTwistTab[i], uTwistTab[i + 1], f - float( i ) );
  float c = cos( a );
  float s = sin( a );
  return vec4( c * mv.x - s * mv.y, s * mv.x + c * mv.y, mv.z, mv.w );
}
// The sky, at an infinite depth: the angle of the last of the table.
vec4 twistSky( vec4 mv ) {
  if ( uTwist.x < 0.5 ) return mv;
  float a = uTwistTab[${TWIST_N - 1}];
  float c = cos( a );
  float s = sin( a );
  return vec4( c * mv.x - s * mv.y, s * mv.x + c * mv.y, mv.z, mv.w );
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

// The depth, in metres, of table entry i.
export function twistDepth(i) {
  return TWIST_FAR * Math.pow(i / (TWIST_N - 1), TWIST_POW);
}

// The angle the table gives at a depth (as the shader reads it).
export function twistAngle(depth, tab = twistU.uTwistTab.value) {
  const f = Math.pow(Math.min(Math.max(depth, 0) / TWIST_FAR, 1), 1 / TWIST_POW) * (TWIST_N - 1);
  const i = Math.min(Math.floor(f), TWIST_N - 2);
  return tab[i] + (tab[i + 1] - tab[i]) * (f - i);
}

// Lay a table of angles (TWIST_N of them). Returns whether the view is turned
// at all.
export function setTwist(angles) {
  const tab = twistU.uTwistTab.value;
  let most = 0;
  for (let i = 0; i < TWIST_N; i++) {
    tab[i] = angles[i];
    most = Math.max(most, Math.abs(angles[i]));
  }
  twistU.uTwist.value[0] = most > 1e-4 ? 1 : 0;
  return most > 1e-4;
}
