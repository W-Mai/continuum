// The sky of the space world, as numbers: where the band of the galaxy runs,
// where the two nebulae stand, the planet's ring, the light the planet gives
// back, and when the meteors fall and where the satellites are.
//
// Pure functions of the world's axis (the way the road leaves) and of a time,
// with no three.js in them: the sky shader (render/atmosphere.js, built on
// render/spacesky.js) has the same numbers written into it, and the check
// (tools/world_space_check.mjs) works the same things out here and finds them
// in the frame. The sky is laid out from the axis, as the baked clouds are
// (world/cloudsets.js), so that the band, the nebulae, the meteors and the
// satellites are in the sky ahead of the car whichever way a seed's road
// leaves; the planet keeps its place by the sun.

import { hash1 } from './noise.js';

export const D2R = Math.PI / 180;

// A direction in the sky from the road's axis: az to the right of it, el above
// the horizon (radians), as a unit vector of the world (x, y up, z). `axis` is
// the angle of the axis in the ground plane, atan2(dz, dx).
export function skyDir(axis, az, el, out = [0, 0, 0]) {
  const ce = Math.cos(el);
  const fx = Math.cos(axis);
  const fz = Math.sin(axis);
  // Right of the axis, looking along it with y up.
  out[0] = fx * ce * Math.cos(az) - fz * ce * Math.sin(az);
  out[1] = Math.sin(el);
  out[2] = fz * ce * Math.cos(az) + fx * ce * Math.sin(az);
  return out;
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// --- the galaxy -------------------------------------------------------------

// The band is a great circle through a point ahead of the road (GALAXY.at), tilted
// to the horizon by GALAXY.tilt there, so that it crosses the sky in front of the
// car from low on one side to high on the other. The stars on it are GALAXY.stars
// times as many as in the rest of the sky up to GALAXY.core off it and thin to the
// ordinary number by GALAXY.edge; the glow under them is about 25 degrees across.
export const GALAXY = {
  at: [4 * D2R, 15 * D2R],      // az, el of the point of the band it is centred on
  tilt: 28 * D2R,               // the angle of the band to the horizon there
  stars: 4,                     // the density of the stars on the band's middle, against the rest of the sky
  core: 0.14,                   // radians off the band to where that begins to thin (8 degrees)
  edge: 0.28,                   // and to where it is the sky's own (16 degrees)
  glow: 0.0075,                 // the light of the band where it is brightest (linear, added to the sky)
};

// How many times the sky's own number of stars there are at an angle b (radians)
// off the band: the same function is in the shader.
export function starDensity(b) {
  const t = Math.min(Math.max((Math.abs(b) - GALAXY.core) / (GALAXY.edge - GALAXY.core), 0), 1);
  const s = t * t * (3 - 2 * t);
  return 1 + (GALAXY.stars - 1) * (1 - s);
}

// The three vectors of the band for a world axis: c, the point of it that its
// longitude is counted from; e, along it; n, its pole (the band is where d . n is
// 0, and the angle off it is asin(d . n)).
export function galaxyFrame(axis) {
  const c = skyDir(axis, GALAXY.at[0], GALAXY.at[1]);
  // The horizontal (to the right) and the vertical (up) tangents at c.
  const up = [0, 1, 0];
  const h = norm(cross(c, up));
  const v = cross(h, c);
  const t = GALAXY.tilt;
  const e = norm([h[0] * Math.cos(t) + v[0] * Math.sin(t), h[1] * Math.cos(t) + v[1] * Math.sin(t), h[2] * Math.cos(t) + v[2] * Math.sin(t)]);
  const n = norm(cross(c, e));
  return { c, e, n };
}

// The angle (radians, signed) of a direction off the band.
export function galaxyLatitude(frame, d) {
  return Math.asin(Math.min(Math.max(dot(d, frame.n), -1), 1));
}

// --- the nebulae ---------------------------------------------------------------

// Two, thirty degrees across, in the colours they are laid in (linear, added to the
// sky: the colour is the nebula where it is thickest, `gain` the share of it that is
// added, which is what keeps them faint).
export const NEBULAE = [
  { at: [-24 * D2R, 14 * D2R], size: 15 * D2R, color: [0.10, 0.04, 0.14], gain: 0.30 },
  { at: [33 * D2R, 8 * D2R], size: 15 * D2R, color: [0.02, 0.08, 0.12], gain: 0.30 },
];

export function nebulaDirs(axis) {
  return NEBULAE.map((n) => skyDir(axis, n.at[0], n.at[1]));
}

// --- the planet and its ring -----------------------------------------------

// The planet hangs a quarter turn round from the sun, a little over the horizon
// (render/atmosphere.js has the same two lines): its direction, and the frame the
// shader works its disc in, the way a viewer sees it: x to the right, y up, z
// toward the eye.
export const PLANET = { r: 0.15, lift: 0.2 };

export function planetFrame(sun) {
  const p = norm([-sun[2], PLANET.lift, sun[0]]);
  const x = norm(cross(p, [0, 1, 0]));
  const y = cross(x, p);
  const z = [-p[0], -p[1], -p[2]];
  return { p, x, y, z };
}

// The ring is in a plane the eye is `tilt` (radians) above, so that it is seen
// as an ellipse a little under a third as high as it is wide, from the side the
// sun lights; `roll` turns it on the screen. Radii in the planet's own radii; the
// gap is the lane in the middle that has no ring in it.
export const RING = {
  inner: 1.4,
  outer: 2.3,
  gap: [1.78, 1.88],
  tilt: 18 * D2R,
  roll: -16 * D2R,
};

// The plane's normal in the planet's frame (x right, y up, z to the eye).
export function ringNormal() {
  return [-Math.sin(RING.roll) * Math.cos(RING.tilt), Math.cos(RING.roll) * Math.cos(RING.tilt), Math.sin(RING.tilt)];
}

// Where a point of the ring is on the screen, in the planet's radii from its
// centre (x right, y up): the ring at radius rho, an angle a round it.
export function ringPoint(rho, a) {
  const n = ringNormal();
  // Two axes in the plane: the one along the screen's x turned by the roll,
  // and the one across.
  const u = norm(cross([0, 0, 1], n));
  const w = cross(n, u);
  return [rho * (Math.cos(a) * u[0] + Math.sin(a) * w[0]), rho * (Math.cos(a) * u[1] + Math.sin(a) * w[1]), rho * (Math.cos(a) * u[2] + Math.sin(a) * w[2])];
}

// The light the planet gives back (what the sun leaves on it, the way a moon
// lights a night): from where it hangs, in its own mean colour (the mean of the
// shader's bands), SHINE.share of the sun's strength.
export const SHINE = { share: 0.06, color: [0.40, 0.46, 0.54] };

// --- meteors -----------------------------------------------------------------

// One every METEOR.every seconds, put a little out of its place by up to
// METEOR.jitter (so no two are less than every - 2 jitter apart nor more than
// every + 2 jitter), a streak of METEOR.life seconds. The first is METEOR.first
// seconds in. Each has its own place in the sky ahead (az, el), the way it runs
// across it (dir, radians from the right, up positive) and its length.
export const METEOR = {
  every: 30,
  jitter: 5,
  first: 18,
  life: 0.6,
  az: 35 * D2R,                       // up to this far to either side of the axis
  el: [11 * D2R, 22 * D2R],           // where it starts
  dir: [200 * D2R, 340 * D2R],        // falling: from the left, down, to the right
  len: [8 * D2R, 20 * D2R],
};

export function meteorStart(k) {
  return METEOR.first + METEOR.every * k + METEOR.jitter * (2 * hash1(k, 0x3e7) - 1);
}

export function meteor(k) {
  const h = (i) => hash1(k * 8 + i, 0x5a17);
  return {
    k,
    start: meteorStart(k),
    az: (2 * h(0) - 1) * METEOR.az,
    el: METEOR.el[0] + (METEOR.el[1] - METEOR.el[0]) * h(1),
    dir: METEOR.dir[0] + (METEOR.dir[1] - METEOR.dir[0]) * h(2),
    len: METEOR.len[0] + (METEOR.len[1] - METEOR.len[0]) * h(3),
  };
}

// The meteor that is falling at time t (seconds), with how far along it is (0
// to 1), or null.
export function meteorAt(t) {
  const k0 = Math.round((t - METEOR.first) / METEOR.every);
  for (let k = Math.max(0, k0 - 1); k <= k0 + 1; k++) {
    const m = meteor(k);
    const age = t - m.start;
    if (age >= 0 && age < METEOR.life) return { ...m, progress: age / METEOR.life };
  }
  return null;
}

// How many meteors begin in [t0, t1).
export function meteorCount(t0, t1) {
  let n = 0;
  for (let k = Math.max(0, Math.floor((t0 - METEOR.first) / METEOR.every) - 1); meteorStart(k) < t1; k++) if (meteorStart(k) >= t0) n++;
  return n;
}

// --- satellites ----------------------------------------------------------------

// Slowly across the sky ahead, each at its own height and pace, one way or the
// other, a point that is bright for a moment every SATELLITES.blink seconds and
// dim between. az runs over `span` radians either side of the axis and comes
// round (it fades at the two ends).
export const SATELLITES = {
  span: 70 * D2R,
  blink: 4,
  flash: 0.35,                // seconds of the bright part
  list: [
    { el: 12 * D2R, bob: 1.2 * D2R, rate: 1.1 * D2R, az0: 20 * D2R, phase: 0 },
    { el: 19 * D2R, bob: 1.6 * D2R, rate: -0.8 * D2R, az0: 55 * D2R, phase: 1.3 },
    { el: 7 * D2R, bob: 0.8 * D2R, rate: 1.5 * D2R, az0: 95 * D2R, phase: 2.7 },
  ],
};

// The az and el (radians, from the axis) of satellite i at time t, and how
// bright it is (0 to 1).
export function satellite(i, t) {
  const s = SATELLITES.list[i];
  const w = 2 * SATELLITES.span;
  let a = (s.az0 + s.rate * t) % w;
  if (a < 0) a += w;
  const az = a - SATELLITES.span;
  const el = s.el + s.bob * Math.sin(t * 0.07 + i * 2.1);
  const f = ((t + s.phase) % SATELLITES.blink) / SATELLITES.flash;
  const flash = f < 1 ? Math.sin(f * Math.PI) : 0;
  const ends = Math.min(Math.max((SATELLITES.span - Math.abs(az)) / (10 * D2R), 0), 1);
  return { az, el, bright: (0.05 + 0.95 * flash) * ends };
}
