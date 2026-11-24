// The coast's swash in the shaders: the one place that says where the waterline is, which the sea's shader
// (render/water.js) and the land's (render/terrain.js) both read, so that the water that comes up the beach and the sand
// it wets are of the same clock.
//
// The sea's surface is lifted by `amp * sin(phase)` metres near the lens (amp: the world's `liquid.swash`, in the palette,
// blended across a border like any of its numbers), the phase a round of SWASH.period seconds long and a fifth of a round
// further on for each SWASH.apart metres along the shore (world/coastplan.js has the same in numbers). The waterline,
// where the sea meets the ground, walks up the beach as it rises and back as it falls, as far as the beach is flat. The
// land reads the same phase: ground the water has covered since the last time (counted back by the sine, which is
// solved, not stepped) is wet, and the sand it has just left is darker, and shines, and has a lace of foam on it that
// thins out as it dries.

import * as THREE from 'three';
import { SWASH } from '../world/coastplan.js';
import { WORLDS } from '../world/worlds.js';

// x: the clock as a share of a round (0 to 1), y: how much of the swash is drawn (0 none, 1 all of it: a world's
// tier, and whether a world that has one is in reach), z: 1 where the sand keeps the lace of foam the water leaves.
export const swashU = { uSwash: { value: new THREE.Vector3(0, 0, 0) } };

// How much the swash is to the world that has most of it (m): the share of the blend its own lift is of.
export const SWASH_FULL = Math.max(0, ...WORLDS.map((w) => (w.liquid && w.liquid.swash) || 0));

// The sand: how dark it is while it is wet (of its dry colour), the ground that is always under water (of its colour: as it was),
// how rough wet sand is and how much of the sky it gives back (of what the roughness says), and the lace's: how wide a crease of it
// is when the sand is dry and how much wider when it is wet,
// how far off it is seen (m, from whole to gone), and its colour (linear, as the foam of the sea is).
export const WET = { dark: 0.4, bed: 0.6, rough: 0.2, sheen: 0.4, lace: [0.012, 0.13], fade: [60, 190], foam: [0.82, 0.86, 0.88] };

const f = (x) => {
  const s = String(x);
  return /[.e]/.test(s) ? s : `${s}.0`;
};

// Every shader that reads the swash: the clock and the sea's lift. (The words of the real sea's own code are not in it:
// the plain programs of the sea carry none of that.)
export const SWASH_PARS = /* glsl */`
uniform vec3 uSwash;
// The phase of the swash at a point (absolute x, z), in radians: the clock, and the way along the shore.
float swashPhase( vec2 p ) {
  float along = dot( p - uWorldAxis.xy, uWorldAxis.zw );
  return 6.2831853 * fract( uSwash.x + along / ${f(SWASH.along)} );
}
// The height of the swash here (m), as the world's blend of the palette has it, and as much of it as the tier draws;
// worldAt has been called.
float swashAmp() {
  return worldPar( 5 ).y * uSwash.y;
}
float swashLift( vec2 p, float amp ) {
  return amp * sin( swashPhase( p ) );
}
`;

// What the sea's shader does with it: the surface is lifted (before the swells move it).
export const SWASH_VERTEX = /* glsl */`
if ( uSwash.y > 0.0 && uSeaDry < 0.5 && uTwist.x < 0.5 ) {
  vec2 swp = ( modelMatrix * vec4( transformed, 1.0 ) ).xz + uOffset;
  worldAt( swp );
  float swa = swashAmp();
  if ( swa > 0.0 ) transformed.y += swashLift( swp, swa );
}
`;

// Only the declaration, for the fragment shader of the real sea, which reads the swash's tier and not its lift.
export const SWASH_FRAGMENT = 'uniform vec3 uSwash;';

// The land: how wet the ground at `alt` m over the still water is (1 while the swash is over it, falling to 0 over
// SWASH.dry seconds after it has left, 0 where it does not come), and what the land does with that.
export const SWASH_TERRAIN = /* glsl */`
float tWet = 0.0;
float tBed = 0.0;
// How wet the ground is, alt m over the still water, for a swash amp m high, at the point p.
float swashWet( float alt, float amp, vec2 p ) {
  float u = alt / amp;
  if ( u >= 1.0 ) return 0.0;
  if ( u <= -1.0 ) return 1.0;
  float th = swashPhase( p );
  // The water is over it while the sine is over u: from a to pi - a.
  float a = asin( u );
  if ( mod( th - a, 6.2831853 ) < 3.1415927 - 2.0 * a ) return 1.0;
  float since = mod( th - ( 3.1415927 - a ), 6.2831853 ) * ${f(SWASH.period)} / 6.2831853;
  return 1.0 - smoothstep( 0.0, ${f(SWASH.dry)}, since );
}
// The ground's dark under the water, from what it was (under: 0 dry, 1 as dark as the bed under the water is) to what the
// swash makes of it: the bed that is always under water as it was, the ground the water comes to as dark as its wetness (set
// in tWet), the rest dry. n: a draw of the ground's, 0 to 1, to break the edge of what is wet up a little.
float swashUnder( float under, float alt, float n, vec2 p ) {
  tWet = 0.0;
  tBed = 0.0;
  float amp = swashAmp();
  if ( amp <= 0.0 ) return under;
  float k = clamp( amp / ${f(Math.max(SWASH_FULL, 1e-3))}, 0.0, 1.0 );
  float a = alt + ( n - 0.5 ) * 0.02;
  // Ground over the top of the swash is dry, which is most of the land.
  if ( a >= amp ) return mix( under, 0.0, k );
  float wet = swashWet( a, amp, p );
  float bed = 1.0 - smoothstep( -amp - 0.06, -amp, a );
  tWet = wet * ( 1.0 - bed ) * k;
  tBed = bed * k;
  return mix( under, max( ${f((1 - WET.dark) / (1 - WET.bed))} * wet * ( 1.0 - bed ), bed ), k );
}
// The lace of foam the water leaves on the sand as it goes: the creases of a fine noise, as much of the sand as the
// sand is wet. dist: how far the lens is.
float swashLace( float wet, vec2 p, float dist ) {
  if ( uSwash.z < 0.5 || wet <= 0.0 ) return 0.0;
  float seen = 1.0 - smoothstep( ${f(WET.fade[0])}, ${f(WET.fade[1])}, dist );
  if ( seen <= 0.0 ) return 0.0;
  float n = texture2D( uDetail, p / 3.1 ).g * 0.55 + texture2D( uDetail, p / 1.3 + 0.37 ).g * 0.45;
  float crease = abs( 2.0 * n - 1.0 );
  float w = ${f(WET.lace[0])} + ${f(WET.lace[1])} * wet * wet;
  return ( 1.0 - smoothstep( w - 0.015, w + 0.015, crease ) ) * wet * seen;
}
`;

// Every frame: the swash's clock (s), whether a world that has one is in reach, and the tier (render/quality.js). It comes
// and goes over a second, so that the sea does not jump where it begins.
export function setSwash(clock, near, tier, dt = 1 / 60) {
  const u = swashU.uSwash.value;
  u.x = (clock % SWASH.period) / SWASH.period;
  const want = near && tier !== 'low' ? 1 : 0;
  u.y = want > u.y ? Math.min(want, u.y + dt) : Math.max(want, u.y - dt);
  u.z = near && tier === 'high' ? 1 : 0;
}
