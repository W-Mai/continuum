// What the sky of the space world has besides its stars and its planet: the
// band of the galaxy with the dust in it, two nebulae, a ring round the planet
// that the planet and the ring shade each other with, meteors, satellites, and
// the light the planet gives back to what the sun does not reach.
//
// It is all drawn by the sky dome (render/atmosphere.js), in four more
// programs of it that only a sky with stars or a planet in view is drawn with
// (SKY_SPACE): the other worlds' programs are the ones they were, so they have
// none of this code, and none of its cost. The numbers (where the band runs,
// the sizes, the colours of the planet's light, when a meteor falls) are in
// world/skyspace.js, which has no three.js in it, so that a check can find them
// in the frame; this has what goes to the shader and the shader's code.
//
// The noise of the band and of the nebulae is not worked out for every pixel: it is
// worked out once, into two small textures (world/skymaps.js, bakeMaps), when the sky
// first has the space world in view, and each layer of it is one texture read.
//
// A tier says how much of it is drawn: high all of it; mid the band without its
// second layer, a ring that shades nothing, the meteors and two satellites; low
// none (the sky is drawn with the programs it had).
//
// The planet's light is not a light of the scene (one more light would be in
// every world's programs). It is laid in the environment map the sky is baked
// into: a wide glow round the planet, in its colour, that the map's diffuse
// light has, so that every surface that faces the planet has a little of its
// cold light, and the ones that face away from the sun have a cold edge.

import * as THREE from 'three';
import {
  GALAXY, NEBULAE, PLANET, RING, SHINE,
  galaxyFrame, nebulaDirs, ringNormal, skyDir, satellite, meteorAt, meteorCount,
} from '../world/skyspace.js';
import { SkyMaps, GALAXY_MAP, NEBULA_MAP } from '../world/skymaps.js';

const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(+x.toFixed(6)));
const v3 = (a) => `vec3(${a.map(f).join(', ')})`;

export const SPACE_TIERS = { high: 2, mid: 1, low: 0 };

// How wide the planet's glow is in the environment (radians off its direction
// to where it is gone), and how much of it the map's diffuse light keeps: the map
// is blurred at its widest by a kernel much wider than the glow, so a surface that
// faces the planet has this share of the glow's radiance of it (as light: the
// glow's radiance is set so that it is the share of the sun's that SHINE says,
// measured on a white sphere against a directional light of that strength).
const SHINE_REACH = 0.7;
const SHINE_KEPT = 0.24;

// The most light (the sky's own units: linear, before the exposure the space world has, 1.7) that a pixel
// of the sky has once the band and the nebulae are added to it. A pixel of the sky's blue is at a
// lightness of 0.2 (OKLab) on the screen a little under it, so what these add to the black part of the
// sky is seen and what they add to the lit blue band at the horizon is not, and the share of the frame
// that is black (under 0.2) stays within a point of what it was.
const SKY_ROOM = 0.0095;

// --- the sky's code --------------------------------------------------------

export const SPACE_UNIFORMS = /* glsl */`
#ifdef SKY_SPACE
uniform float uSpaceT;
uniform float uSpaceBake;
uniform vec3 uSpaceF;
uniform vec3 uGalC;
uniform vec3 uGalE;
uniform vec3 uGalN;
uniform vec3 uNebA;
uniform vec3 uNebB;
uniform vec4 uMeteorA;
uniform float uMeteorL;
uniform vec4 uSat[3];
uniform vec3 uShine;
uniform sampler2D uSkyGal;
uniform sampler2D uSkyNeb;
#endif
`;

const RING_N = ringNormal();

// The functions of it: in the sky's fragment shader, after hash, vnoise and fbm.
export const SPACE_FUNCS = /* glsl */`
#ifdef SKY_SPACE
// How much of the sky is the old sky's and how much the painted night's, where the sky has a painted night.
#ifdef SKY_NIGHT
#define SP_OLD OLD_SKY
#define SP_PAINT PAINTED_NIGHT
#else
#define SP_OLD 1.0
#define SP_PAINT 0.0
#endif
const vec3 RING_N = ${v3(RING_N)};
#define RING_IN ${f(RING.inner)}
#define RING_OUT ${f(RING.outer)}
#define RING_G0 ${f(RING.gap[0])}
#define RING_G1 ${f(RING.gap[1])}

// A direction in the sky from the road's axis (az to the right, el up).
vec3 spAxisDir(float az, float el) {
  float ce = cos(el);
  return uSpaceF * (ce * cos(az)) + vec3(-uSpaceF.z, 0.0, uSpaceF.x) * (ce * sin(az)) + vec3(0.0, sin(el), 0.0);
}

// How many times the sky's own number of stars there are at the angle b off the band.
float spStarK(float b) {
  float t = clamp((abs(b) - ${f(GALAXY.core)}) / ${f(GALAXY.edge - GALAXY.core)}, 0.0, 1.0);
  return 1.0 + ${f(GALAXY.stars - 1)} * (1.0 - t * t * (3.0 - 2.0 * t));
}

// The star density multiplier in the direction d: the sky's own number off the band, where the
// sine of the angle off it is over that of the band's edge (0.28 radians: a sine of 0.277).
float spStarsAt(vec3 d) {
  float sb = dot(d, uGalN);
  return abs(sb) < 0.29 ? spStarK(asin(sb)) : 1.0;
}

// The band's glow (0 to about 1) at l along the band and the angle b off it, and the
// dust in it (0 to 1, the dark lane down the middle, in patches). The noise of its
// layers is in the map uSkyGal (world/skymaps.js), one read: r the first layer, g the
// same in three octaves (the painted night has that), b the second layer, a the finer
// layer the dust is cut from. The mid tier has no second layer.
float spGalaxy(float l, float b, out float dust) {
  float core = exp(-b * b / 0.0098);
  float halo = exp(-b * b / 0.0512);
  vec4 m = texture2D(uSkyGal, vec2(l * ${f(1 / (2 * Math.PI))} + 0.5, (b + ${f(GALAXY_MAP.bmax)}) * ${f(0.5 / GALAXY_MAP.bmax)}));
  float f1 = SP_PAINT > 0.0 ? m.g : m.r;
  float f2 = uSpaceT > 1.5 ? m.b : 0.5;
  float glow = core * (0.25 + 1.0 * f1) + halo * 0.45 * (0.35 + 0.8 * f2);
  float lb = (b - 0.018 * sin(l * 2.0 + 1.0)) / 0.028;
  float lane = exp(-lb * lb);
  dust = lane * smoothstep(0.3, 0.62, m.a);
  return glow * (1.0 - 0.85 * dust);
}

// How thick a nebula (the unit vector c, its radius, which of the two it is: 0 or 1) is in the
// direction d: 0 to 1. Its noise is in the map uSkyNeb (world/skymaps.js), one read, by where
// d is on the plane the nebula faces, in its radii: r in the first layer's five octaves, g in three
// (the painted night's).
float spNebula(vec3 d, vec3 c, float size, float side) {
  float th2 = 2.0 * (1.0 - dot(d, c));
  if (th2 > 1.2 * size * size) return 0.0;
  float edge = 1.0 - smoothstep(0.30 * size, size, sqrt(max(th2, 0.0)));
  vec3 e1 = normalize(cross(c, vec3(0.0, 1.0, 0.0)));
  vec3 e2 = cross(e1, c);
  vec2 p = vec2(dot(d, e1), dot(d, e2)) / size;
  vec2 q = clamp(p * ${f(0.5 / NEBULA_MAP.reach)} + 0.5, vec2(${f(0.5 / NEBULA_MAP.n)}), vec2(${f(1 - 0.5 / NEBULA_MAP.n)}));
  vec2 m = texture2D(uSkyNeb, vec2((q.x + side) * 0.5, q.y)).rg;
  return edge * smoothstep(0.30, 0.85, SP_PAINT > 0.0 ? m.g : m.r);
}

// The meteor in the direction d: how much of its streak is over d (0 to 1).
// sharp: a hard edge a few pixels wide, not a soft line.
float spMeteor(vec3 d, float pxAng, float sharp) {
  if (uMeteorA.w < 0.0) return 0.0;
  vec3 ms = spAxisDir(uMeteorA.x, uMeteorA.y);
  if (dot(d, ms) < 0.88) return 0.0;
  vec3 eh = normalize(cross(ms, vec3(0.0, 1.0, 0.0)));
  vec3 ev = cross(eh, ms);
  vec3 dp = d - ms * dot(d, ms);
  vec2 uv = vec2(dot(dp, eh), dot(dp, ev));
  vec2 c = vec2(cos(uMeteorA.z), sin(uMeteorA.z));
  float s = dot(uv, c);
  float w = dot(uv, vec2(-c.y, c.x));
  float prog = uMeteorA.w;
  float head = uMeteorL * prog;
  float tail = max(head - 0.5 * uMeteorL, 0.0);
  float tr = clamp((s - tail) / max(head - tail, 1e-4), 0.0, 1.0);
  float along = step(tail, s) * (1.0 - smoothstep(head - pxAng, head + pxAng, s));
  float fade = smoothstep(0.0, 0.12, prog) * (1.0 - smoothstep(0.72, 1.0, prog));
  if (sharp > 0.5) {
    float wd = max(pxAng * 1.3, 0.0012) * (0.35 + 0.65 * tr);
    return along * (1.0 - smoothstep(wd - pxAng * 0.7, wd + pxAng * 0.7, abs(w))) * step(0.04, fade);
  }
  float sig = max(pxAng * 0.9, 0.0008) * (0.5 + 0.5 * tr);
  float line = exp(-w * w / (2.0 * sig * sig));
  float hd = exp(-((s - head) * (s - head) + w * w) / (4.0 * sig * sig));
  return (along * tr * tr * line * 0.85 + hd) * fade;
}

// A satellite at the unit vector p, as bright as b (0 to 1): a point, a pixel or so wide.
float spSatellite(vec3 d, vec3 p, float b, float pxAng) {
  float da = 1.0 - dot(d, p);
  float r = max(pxAng * 1.1, 0.0009);
  return b * (1.0 - smoothstep(0.18 * r * r, r * r, da));
}

// How much the ring there is at the radius rho (the planet's radii), edges e wide.
float spRingCover(float rho, float e) {
  float edge = max(e * 3.0, 0.012);
  float inner = smoothstep(RING_IN - edge, RING_IN + edge, rho);
  float outer = 1.0 - smoothstep(RING_OUT - edge, RING_OUT + edge, rho);
  float gap = smoothstep(RING_G0 - edge, RING_G0 + edge, rho) * (1.0 - smoothstep(RING_G1 - edge, RING_G1 + edge, rho));
  return inner * outer * (1.0 - gap);
}

// How much the ring is between a point P of the planet's surface and the sun (sd, the
// sun in the planet's frame): the ring's cover where the line to the sun crosses its plane.
float spRingShade(vec3 P, vec3 sd) {
  float k = dot(RING_N, sd);
  if (abs(k) < 0.02) return 0.0;
  float s = -dot(RING_N, P) / k;
  if (s <= 0.0) return 0.0;
  return spRingCover(length(P + sd * s), 0.01);
}

// How much the planet is between a point Q of the ring's plane and the sun: 1 in its
// shadow (a cylinder a radius across, behind it from the sun), soft by w.
float spPlanetShade(vec3 Q, vec3 sd, float w) {
  float along = dot(Q, sd);
  if (along >= 0.0) return 0.0;
  float perp = length(Q - sd * along);
  return (1.0 - smoothstep(1.0 - w, 1.0 + w, perp)) * smoothstep(0.0, -0.06, along);
}

// The ring in the pixel at pq (the planet's radii from its centre, x right, y up; e is
// a pixel in those radii), the sun sd in the planet's frame, on how much of the pixel
// the planet's disc covers. rgb is the ring's colour, a how much of the pixel it covers.
// painted: flat tones with hard edges; uPaintInv takes them to what the screen has.
vec4 spRing(vec2 pq, float e, vec3 sd, float on, float painted) {
  float tz = -(RING_N.x * pq.x + RING_N.y * pq.y) / RING_N.z;
  float rho = sqrt(dot(pq, pq) + tz * tz);
  float cover = spRingCover(rho, painted > 0.5 ? e * 0.34 : e);
  if (cover <= 0.0) return vec4(0.0);
  // (Behind the planet where its disc is.)
  float vis = tz > 0.0 ? 1.0 : 1.0 - on;
  // The planet's shadow on the ring, and whether the face the eye sees is the face the sun lights.
  float shade = uSpaceT > 1.5 ? spPlanetShade(vec3(pq, tz), sd, max(e * 1.5, 0.02)) : 0.0;
  float face = smoothstep(-0.02, 0.22, dot(RING_N, sd));
  vec3 rgb;
  if (painted > 0.5) {
    float outer = smoothstep(RING_G1 - 0.004, RING_G1 + 0.004, rho);
    vec3 lit = mix(vec3(0.86, 0.78, 0.60), vec3(0.72, 0.69, 0.66), outer);
    rgb = mix(lit * 0.16, lit, face);
    rgb = mix(rgb, lit * vec3(0.10, 0.12, 0.30), step(0.5, shade));
    rgb *= uPaintInv;
  } else {
    // A ring is not one grey: bands of its own, a little warm and a little cold.
    float tone = vnoise(vec2(rho * 11.0, 7.0));
    float dens = 0.62 + 0.38 * vnoise(vec2(rho * 27.0, 3.1));
    vec3 albedo = mix(vec3(0.74, 0.66, 0.52), vec3(0.52, 0.56, 0.66), tone) * dens;
    rgb = albedo * (0.025 + 0.85 * face) * (1.0 - 0.97 * shade);
    cover *= 0.5 + 0.5 * dens;
  }
  return vec4(rgb, cover * vis * (painted > 0.5 ? 1.0 : 0.94));
}

// The band of the galaxy with the dust in it, and the two nebulae, under the stars: added
// to the sky as light (k is how much of the old sky is here, and so how much of it).
void spBackdrop(inout vec3 col, vec3 d, float y, float k) {
  // What is added is what the sky leaves room for: no pixel is taken over the light at which a
  // sky stops being black (SKY_ROOM) by it, and a sky that is lit more than that is not added to
  // (and so not worked out).
  float room = ${f(SKY_ROOM)} - dot(col, vec3(0.2126, 0.7152, 0.0722));
  if (room <= 0.0) return;
  float sb = dot(d, uGalN);
  vec3 add = vec3(0.0);
  if (abs(sb) < 0.33) {
    float l = atan(dot(d, uGalE), dot(d, uGalC));
    float dust;
    float gl = spGalaxy(l, asin(sb), dust);
    vec3 tint = mix(vec3(0.50, 0.60, 0.95), vec3(1.0, 0.82, 0.62), 0.45 * exp(-l * l / 0.5));
    add += tint * gl * ${f(GALAXY.glow)};
  }
  float na = spNebula(d, uNebA, ${f(NEBULAE[0].size)}, 0.0);
  if (na > 0.0) add += ${v3(NEBULAE[0].color)} * na * ${f(NEBULAE[0].gain)};
  float nb = spNebula(d, uNebB, ${f(NEBULAE[1].size)}, 1.0);
  if (nb > 0.0) add += ${v3(NEBULAE[1].color)} * nb * ${f(NEBULAE[1].gain)};
  add *= k * smoothstep(-0.02, 0.04, y);
  float lit = dot(add, vec3(0.2126, 0.7152, 0.0722));
  col += lit > room ? add * (room / lit) : add;
}

// The meteor and the satellites over everything in the sky, and the planet's light in
// the environment map.
void spAfter(inout vec3 col, vec3 d, float y, float pxAng, float stars) {
  if (uSpaceBake < 0.5) {
    float k = min(stars, 1.0) * smoothstep(-0.02, 0.03, y);
    if (k > 0.0) {
      float m = spMeteor(d, pxAng, step(0.5, SP_PAINT));
      float s = 0.0;
      for (int i = 0; i < 3; i++) s = max(s, spSatellite(d, uSat[i].xyz, uSat[i].w, pxAng));
#ifdef SKY_NIGHT
      col = mix(col, vec3(1.0, 0.97, 0.9) * uPaintInv, min(m, 1.0) * k * SP_PAINT);
      col = mix(col, vec3(1.0, 0.95, 0.85) * 0.9 * uPaintInv, s * k * SP_PAINT);
#endif
      col += (vec3(1.0, 0.93, 0.80) * 4.0 * m + vec3(1.0, 0.95, 0.85) * 1.3 * s) * k * SP_OLD * (1.0 - step(0.5, SP_PAINT));
    }
  } else if (uShine.x + uShine.y + uShine.z > 0.0) {
    // (Where the planet hangs: the line the planet's disc has in the sky.)
    vec3 pd = normalize(vec3(-uSunDir.z, ${f(PLANET.lift)}, uSunDir.x));
    col += uShine * (1.0 - smoothstep(0.0, ${f(SHINE_REACH)}, acos(clamp(dot(d, pd), -1.0, 1.0))));
  }
}

#ifdef SKY_NIGHT
// A painted night's band and nebulae: flat tones with a hard edge, the dust a cut of the
// sky's own colour. k is how much of the painted night is here.
void spPaintedBackdrop(inout vec3 col, vec3 d, float y, float pxAng, float k) {
  float sb = dot(d, uGalN);
  float horizon = smoothstep(0.0, 0.05, y) * k;
  float na = spNebula(d, uNebA, ${f(NEBULAE[0].size)}, 0.0);
  if (na > 0.0) {
    float w = max(fwidth(na), 0.01);
    col = mix(col, vec3(0.026, 0.018, 0.074) * uPaintInv, smoothstep(0.20, 0.20 + w, na) * horizon);
    col = mix(col, vec3(0.042, 0.024, 0.100) * uPaintInv, smoothstep(0.52, 0.52 + w, na) * horizon);
  }
  float nb = spNebula(d, uNebB, ${f(NEBULAE[1].size)}, 1.0);
  if (nb > 0.0) {
    float w = max(fwidth(nb), 0.01);
    col = mix(col, vec3(0.011, 0.034, 0.070) * uPaintInv, smoothstep(0.20, 0.20 + w, nb) * horizon);
    col = mix(col, vec3(0.016, 0.056, 0.092) * uPaintInv, smoothstep(0.52, 0.52 + w, nb) * horizon);
  }
  if (abs(sb) < 0.31) {
    float dust;
    float gl = spGalaxy(atan(dot(d, uGalE), dot(d, uGalC)), asin(sb), dust);
    float w = max(fwidth(gl), 0.01);
    col = mix(col, vec3(0.026, 0.032, 0.100) * uPaintInv, smoothstep(0.30, 0.30 + w, gl) * horizon);
    col = mix(col, vec3(0.040, 0.048, 0.135) * uPaintInv, smoothstep(0.66, 0.66 + w, gl) * horizon);
    // (The lane: the sky it is cut out of.)
    float wd = max(fwidth(dust), 0.01);
    col = mix(col, vec3(0.012, 0.016, 0.052) * uPaintInv, smoothstep(0.55, 0.55 + wd, dust) * smoothstep(0.30, 0.30 + w, gl + 0.3 * dust) * horizon);
  }
}

// More stars on the band, flat dots on a finer grid than the night's own (the cells
// of a twentieth of a radian): where the band's star density is over the sky's, that
// share of a cell more has a dot.
void spPaintedStars(inout vec3 col, vec3 d, float y, float pxAng, float k) {
  float sb = dot(d, uGalN);
  if (abs(sb) > 0.29) return;
  float more = (spStarK(asin(sb)) - 1.0) / ${f(GALAXY.stars - 1)};
  if (more <= 0.0) return;
  float el = asin(clamp(y, -1.0, 1.0));
  float row = floor(el / 0.05);
  float rowEl = (row + 0.5) * 0.05;
  float cols = max(floor(6.2832 * cos(rowEl) / 0.05), 1.0);
  float az = atan(d.z, d.x) + 3.14159;
  float colN = min(floor(az / 6.2832 * cols), cols - 1.0);
  vec2 cid = vec2(colN, row) + 51.0;
  if (hash(cid + 7.1) < 0.34 * more) {
    vec2 at = vec2((colN + 0.15 + 0.7 * hash(cid + 13.7)) / cols * 6.2832 - 3.14159, (row + 0.15 + 0.7 * hash(cid + 29.3)) * 0.05);
    float da = mod(az - 3.14159 - at.x + 3.14159, 6.2832) - 3.14159;
    float dist = length(vec2(da * cos(el), el - at.y));
    float r = pxAng * 1.5;
    float dot_ = 1.0 - smoothstep(r - pxAng * 0.6, r + pxAng * 0.6, dist);
    vec3 sc = mix(vec3(0.75, 0.85, 1.1), vec3(1.1, 0.95, 0.8), step(0.8, hash(cid + 41.9)));
    col = mix(col, sc * (0.5 + 0.4 * hash(cid + 3.3)) * uPaintInv, dot_ * smoothstep(0.03, 0.2, y) * k);
  }
}
#endif
#endif
`;

// --- what goes to the shader ------------------------------------------------

export class SpaceSky {
  // axis: the angle of the world's axis, atan2(dz, dx); tier: high, mid or low.
  constructor({ axis = 0, tier = 'high' } = {}) {
    this.axis = axis;
    this.level = SPACE_TIERS[tier] === undefined ? 2 : SPACE_TIERS[tier];
    // The meteors that have begun since this was made (the check counts them).
    this.meteors = 0;
    this._lastTime = 0;
    this._materials = [];
    // The noise of the band and the nebulae, worked out into two small textures when the sky first
    // has them in view (bakeMaps), and let go of once it has been without them for a while.
    this._maps = null;
    this._textures = [];
    this.uniforms = {
      uSpaceT: { value: this.level },
      uSpaceBake: { value: 0 },
      uSpaceF: { value: new THREE.Vector3() },
      uGalC: { value: new THREE.Vector3() },
      uGalE: { value: new THREE.Vector3() },
      uGalN: { value: new THREE.Vector3() },
      uNebA: { value: new THREE.Vector3() },
      uNebB: { value: new THREE.Vector3() },
      uMeteorA: { value: new THREE.Vector4(0, 0, 0, -1) },
      uMeteorL: { value: 0 },
      uSat: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
      uShine: { value: new THREE.Vector3() },
      uSkyGal: { value: null },
      uSkyNeb: { value: null },
    };
    this.setAxis(axis);
  }

  // The sky is laid out from the axis (world/skyspace.js).
  setAxis(axis) {
    this.axis = axis;
    const u = this.uniforms;
    u.uSpaceF.value.set(Math.cos(axis), 0, Math.sin(axis));
    const g = galaxyFrame(axis);
    u.uGalC.value.fromArray(g.c);
    u.uGalE.value.fromArray(g.e);
    u.uGalN.value.fromArray(g.n);
    const n = nebulaDirs(axis);
    u.uNebA.value.fromArray(n[0]);
    u.uNebB.value.fromArray(n[1]);
  }

  setTier(tier) {
    this.level = SPACE_TIERS[tier] === undefined ? this.level : SPACE_TIERS[tier];
    this.uniforms.uSpaceT.value = this.level;
  }

  // Whether any of it is drawn at the tier.
  get on() {
    return this.level > 0;
  }

  // The programs that were made for it (so that they go with it).
  own(material) {
    this._materials.push(material);
    return material;
  }

  // Whether the noise of the band and the nebulae is in its textures.
  get mapsReady() {
    return this._textures.length > 0;
  }

  // Works out the noise of the band and the nebulae (world/skymaps.js) and lays it in two small
  // textures, 0.5 MB of them: about `units` hashes of it in a call (a page does a slice a frame, so that
  // no frame is held for it; the whole of it, with Infinity, is some tens of milliseconds). Returns
  // whether they are there. They are the same for every axis (the shader finds its way in them
  // by the band's and the nebulae's own coordinates).
  bakeMaps(units = Infinity) {
    if (this._textures.length) return true;
    if (!this._maps) this._maps = new SkyMaps();
    if (!this._maps.step(units)) return false;
    const make = (data, w, h, format, wrapS) => {
      const t = new THREE.DataTexture(data, w, h, format, THREE.UnsignedByteType);
      t.wrapS = wrapS;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      this._textures.push(t);
      return t;
    };
    this.uniforms.uSkyGal.value = make(this._maps.galaxy, GALAXY_MAP.w, GALAXY_MAP.h, THREE.RGBAFormat, THREE.RepeatWrapping);
    this.uniforms.uSkyNeb.value = make(this._maps.nebula, NEBULA_MAP.n * 2, NEBULA_MAP.n, THREE.RGFormat, THREE.ClampToEdgeWrapping);
    this._maps = null;
    return true;
  }

  // Lets go of the textures (the sky is not the space world's any longer); bakeMaps makes them again.
  releaseMaps() {
    for (const t of this._textures) t.dispose();
    this._textures.length = 0;
    this._maps = null;
    this.uniforms.uSkyGal.value = null;
    this.uniforms.uSkyNeb.value = null;
  }

  // The meteor falling at the sky's time t (seconds), and where the satellites
  // are.
  update(t) {
    const u = this.uniforms;
    if (this.level === 0) {
      u.uMeteorA.value.w = -1;
      for (const s of u.uSat.value) s.w = 0;
      this._lastTime = t;
      return;
    }
    // A meteor that began since the last time is counted (more than one in a
    // step, if the step is long, is as many).
    if (t > this._lastTime) this.meteors += meteorCount(this._lastTime, t);
    this._lastTime = t;
    const m = meteorAt(t);
    if (m) {
      u.uMeteorA.value.set(m.az, m.el, m.dir, m.progress);
      u.uMeteorL.value = m.len;
    } else {
      u.uMeteorA.value.w = -1;
    }
    const sats = u.uSat.value;
    for (let i = 0; i < 3; i++) {
      // The mid tier has two of them.
      if (i >= 2 && this.level < 2) {
        sats[i].w = 0;
        continue;
      }
      const s = satellite(i, t);
      const d = skyDir(this.axis, s.az, s.el);
      sats[i].set(d[0], d[1], d[2], s.bright);
    }
  }

  // The radiance of the glow that carries the planet's light in the environment map, for a
  // look (the planet's share of the look; the sun's strength; how much the map's light is
  // scaled): the light a surface that faces the planet has from the map's diffuse part is
  // `SHINE.share` of the sun's, in the colour of the planet.
  shine(look) {
    const k = SHINE.share * (look.sunIntensity || 0) * (look.planet || 0)
      / (Math.PI * SHINE_KEPT * Math.max(look.envIntensity || 0, 1e-3));
    return this.level > 0 && k > 0 ? SHINE.color.map((c) => c * k) : null;
  }

  // Drawing the environment map: none of the sky's own (the band, the meteors) in it, and the glow.
  bake(on, shine = null) {
    const u = this.uniforms;
    u.uSpaceBake.value = on ? 1 : 0;
    if (shine) u.uShine.value.set(shine[0], shine[1], shine[2]);
    else u.uShine.value.set(0, 0, 0);
  }

  dispose() {
    for (const m of this._materials) m.dispose();
    this._materials.length = 0;
    this.releaseMaps();
  }
}
