// The headlamps' beam in the real style: the pattern a dipped beam throws, laid on the
// scene's one spot light.
//
// A dipped beam is not a round pool. Its top is a line, a hand lower on the side of the
// oncoming lane and a step higher toward the verge, so that it lights the road and what
// stands on it and keeps out of the eyes that face it; below the line it is brightest just
// under it and thins toward the car, and across it is widest to the verge. The spot light
// is the same one for every style (render/atmosphere.js lights the scene with it); this
// patch changes what the unpaired programs make of it: the light's colour is multiplied by
// the pattern, by a function of the direction the point lies in from the lamp, in the
// frame of the car (to its right, up, along the ground). The paired programs (the painted
// style and what is laid on it) do not have the patch in them, and with the real style's
// share at 0 the others take the light as it was.
//
// The road is lit by a light that grazes it, which a Lambert surface takes badly: a lamp
// 0.75 m over the road throws its light at 3 degrees to it. A rough road takes it better than
// that (its stones stand in each other's way and the light falls on their sides), and the
// asphalt's shader adds that, as if the light came down more steeply, as much as `road`
// of it (render/roadmesh.js).

import * as THREE from 'three';

// The beam, by the numbers the pattern and the spot light take. Angles are tangents.
export const BEAM = {
  boost: 12,             // the spot light's intensity, times what it is in the other styles
  angle: 0.62,           // its cone's half angle, and how soft its edge is (the pattern shapes the rest)
  penumbra: 0.3,
  decay: 1.4,
  distance: 170,         // m
  cut: [-0.012, 0.035],  // the top of the beam on the oncoming lane's side, and on the verge's
  kick: [0.02, 0.14],    // across which the top steps up from one to the other
  sigma: [0.20, 0.28],   // how wide it is on each side (a lobe's width, as a tangent)
  lobe: 0.06,            // the two lamps' lobes stand this far either side of the middle
  tail: [0.07, 0.25],    // below the top: how fast it thins toward the car, and what it thins to
  stray: 0.012,          // what is thrown above the top
  near: [1.0, 5.0],      // m: the beam starts from the lamp (nothing of it on the car's own nose)
  road: 3,               // the road takes the beam as if it came down this much more steeply (a cosine)
  sat: 6,                // and no more than this of it (as the light that falls on a square metre of it), where it is near
};

// What the programs read: the real style's share of the pattern (0: the light as the
// other styles have it), the frame of the car in view space (to its right, up, along the
// ground), and the pattern's numbers.
export const beamU = {
  uBeamK: { value: 0 },
  uBeamRoad: { value: 0 },
  uBeamLevel: { value: 1 },
  uBeamSat: { value: 1 },
  uBeamR: { value: new THREE.Vector3(1, 0, 0) },
  uBeamU: { value: new THREE.Vector3(0, 1, 0) },
  uBeamF: { value: new THREE.Vector3(0, 0, -1) },
  uBeamA: { value: new THREE.Vector4(BEAM.cut[0], BEAM.cut[1], BEAM.kick[0], BEAM.kick[1]) },
  uBeamB: { value: new THREE.Vector4(BEAM.sigma[0], BEAM.sigma[1], BEAM.lobe, BEAM.tail[0]) },
  uBeamC: { value: new THREE.Vector4(BEAM.tail[1], BEAM.near[0], BEAM.near[1], BEAM.stray) },
};

const BEAM_PARS = /* glsl */`
uniform float uBeamK;
uniform float uBeamRoad;
uniform float uBeamLevel;
uniform float uBeamSat;
uniform vec3 uBeamR;
uniform vec3 uBeamU;
uniform vec3 uBeamF;
uniform vec4 uBeamA;
uniform vec4 uBeamB;
uniform vec4 uBeamC;
// How much of the beam a direction has (v: from the lamp to the point, a unit vector in
// view space; dist: how far that is, in metres): 1 in the brightest part of it.
float beamPattern( const in vec3 v, const in float dist ) {
  float z = max( dot( v, uBeamF ), 0.02 );
  float x = dot( v, uBeamR );
  float u = x / z;
  float w = dot( v, uBeamU ) / max( length( vec2( x, z ) ), 0.02 );
  float top = mix( uBeamA.x, uBeamA.y, smoothstep( uBeamA.z, uBeamA.w, u ) );
  float d = top - w;
  float tail = uBeamC.x + ( 1.0 - uBeamC.x ) * exp( - max( d, 0.0 ) / uBeamB.w );
  float sig = u < 0.0 ? uBeamB.x : uBeamB.y;
  float a = u + uBeamB.z;
  float b = u - uBeamB.z;
  float wide = max( exp( - a * a / ( 2.0 * sig * sig ) ), exp( - b * b / ( 2.0 * sig * sig ) ) );
  return ( smoothstep( 0.0, 0.015, d ) * tail + uBeamC.w ) * wide * smoothstep( uBeamC.y, uBeamC.z, dist );
}
`;

const HOOK = 'light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );';
const PATTERN = `
\t\t\tif ( uBeamK > 0.0 ) light.color *= mix( 1.0, beamPattern( - light.direction, lightDistance ), uBeamK );`;

// A fragment shader with the beam in its spot light: the chunk that defines the spot
// light's function, with the pattern on its colour (nothing else of it is touched).
export function patchBeam(fs) {
  const chunk = THREE.ShaderChunk.lights_pars_begin;
  if (!fs.includes('#include <lights_pars_begin>')) return fs;
  if (!chunk.includes(HOOK)) throw new Error('headbeam: the spot light of this three.js is not the one the beam is laid on');
  return fs.replace('#include <lights_pars_begin>', () => BEAM_PARS + chunk.replace(HOOK, () => HOOK + PATTERN));
}

// The car's lamps and what they throw, each frame. k: how much of the pattern there is (the real
// style's share, by how much the lamps are lit); boost: how much of the brighter beam (the same,
// but not in a tunnel by day, where the lamps of the vault are the light); light: the car's spot light,
// base the intensity it has in the other styles; fx, fz: the way the car points along the ground; exposure: the world's.
const heading = new THREE.Vector3(0, 0, -1);
export function setBeam(light, k, boost, fx, fz, base, exposure = 2) {
  const u = beamU;
  u.uBeamK.value = k;
  // (A world exposed for more than the city's takes less of it: its dark is a dark the eye is opened up for.)
  const scale = Math.min(1.5, Math.max(0.4, 2 / exposure));
  u.uBeamLevel.value = 1 + (BEAM.boost * scale - 1) * boost;
  u.uBeamRoad.value = BEAM.road * scale ** 1.5 * boost;
  u.uBeamSat.value = BEAM.sat * scale;
  light.intensity = base * u.uBeamLevel.value;
  light.angle = 0.55 + (BEAM.angle - 0.55) * k;
  light.penumbra = 0.5 + (BEAM.penumbra - 0.5) * k;
  light.decay = 1.4 + (BEAM.decay - 1.4) * k;
  light.distance = 140 + (BEAM.distance - 140) * k;
  if (k > 0) heading.set(fx, 0, fz).normalize();
}

// The car's frame in the view space of the lens the frame is drawn with (once the lens is where
// it is drawn), and the pattern's numbers.
export function viewBeam(camera) {
  const u = beamU;
  if (u.uBeamK.value <= 0) return;
  camera.updateMatrixWorld();
  const m = camera.matrixWorldInverse;
  u.uBeamF.value.copy(heading).transformDirection(m);
  u.uBeamR.value.set(-heading.z, 0, heading.x).transformDirection(m);
  u.uBeamU.value.set(0, 1, 0).transformDirection(m);
  u.uBeamA.value.set(BEAM.cut[0], BEAM.cut[1], BEAM.kick[0], BEAM.kick[1]);
  u.uBeamB.value.set(BEAM.sigma[0], BEAM.sigma[1], BEAM.lobe, BEAM.tail[0]);
  u.uBeamC.value.set(BEAM.tail[1], BEAM.near[0], BEAM.near[1], BEAM.stray);
}
