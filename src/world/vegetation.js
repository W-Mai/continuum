// Where the forest grows, and what kind: a pure function of absolute position
// and the land the road has shaped. The terrain asks it per vertex to paint the
// forest floor near the camera and the canopy far away; the instanced trees ask
// it per tree. Both see the same forest, so the trees thin out exactly where
// the painted canopy takes over, and no tree ever stands in a cutting, on the
// asphalt or in the water.
//
// Each world grows its own pattern. Alpine: hay meadows on the valley floors,
// spruce coming in up the slopes in stands with ragged edges, thinning into
// single trees toward the tree line, none on cliffs or scree. Hills: woods in
// patches and hedgerows between the fields. River: a line of trees along the
// water, woods on the higher ground. Coast: stone pines scattered over the
// headlands, none on the beach. Desert: a cactus here and there on the flats.
// Across a border the two patterns blend and the kinds of tree mix.

import { makeSimplex, fbm, smoothstep } from './noise.js';
import { WORLDS, makeSkyline } from './worlds.js';

export const FLORA = ['spruce', 'broadleaf', 'pine', 'cactus'];

export function makeVegetation(land, seed) {
  const nStand = makeSimplex(seed ^ 0x7ee5);
  const nEdge = makeSimplex(seed ^ 0x51d3);
  const nHedge = makeSimplex(seed ^ 0x4e7d);
  const worlds = land.worlds || null;
  const treeLine = land.treeLine;
  const tmp = { a: 0, b: 0, t: 0, u: 0 };

  function alpine(h, slope, edge, stand, tl) {
    // Stands: about half the slopes, with edges broken up at tree scale.
    let d = smoothstep(-0.12, 0.1, stand + 0.22 * edge + 0.05);
    // Meadow on the flats, forest on the slopes (12 to 40 degrees).
    d *= 0.3 + 0.7 * smoothstep(0.015, 0.06, slope);
    d *= 1 - smoothstep(0.17, 0.26, slope + 0.03 * edge);
    // Thinning toward the tree line, a ragged one.
    d *= 1 - smoothstep(tl - 170, tl + 30, h + 70 * edge);
    return d;
  }

  function woods(ax, az, slope, edge, stand) {
    let d = smoothstep(0.0, 0.16, stand + 0.2 * edge - 0.1);
    d *= 1 - smoothstep(0.2, 0.3, slope);
    // Hedgerows: a tree or two wide, along the zero lines of a slow noise.
    const line = Math.abs(fbm(nHedge, ax / 420, az / 420, 2));
    const hedge = (1 - smoothstep(0.006, 0.016, line)) * 0.75 * smoothstep(-0.3, 0.1, edge)
      * (1 - smoothstep(0.12, 0.2, slope));
    return Math.max(d, hedge);
  }

  function riverside(h, slope, edge, stand, water) {
    const above = h - water;
    const bank = smoothstep(0.6, 1.6, above) * (1 - smoothstep(3.5, 8, above + 3 * edge));
    const high = smoothstep(0.05, 0.2, stand + 0.2 * edge - 0.05) * smoothstep(10, 28, above)
      * (1 - smoothstep(0.2, 0.3, slope));
    return Math.max(bank * 0.8, high);
  }

  function pines(h, slope, edge, stand, water) {
    let d = 0.3 * smoothstep(-0.05, 0.25, stand + 0.15 * edge);
    d *= smoothstep(3.5, 7, h - water);
    d *= 1 - smoothstep(0.25, 0.35, slope);
    return d;
  }

  function cacti(slope, stand) {
    return 0.018 * smoothstep(-0.2, 0.2, stand) * (1 - smoothstep(0.08, 0.15, slope));
  }

  // City: trees only in the parks, where no tower stands (render/city.js
  // keeps out of the same parks).
  const skyline = makeSkyline(seed);
  function parks(ax, az, edge) {
    return 0.55 * skyline.park(ax, az) * smoothstep(-0.3, 0.2, edge);
  }

  function pattern(w, ax, az, h, slope, edge, stand) {
    const water = WORLDS[w].params.water === null ? 0 : WORLDS[w].params.water;
    switch (WORLDS[w].id) {
      case 'hills': return woods(ax, az, slope, edge, stand);
      case 'river': return Math.max(riverside(h, slope, edge, stand, water), 0.6 * woods(ax, az, slope, edge, stand - 0.1));
      case 'coast': return pines(h, slope, edge, stand, water);
      case 'desert': return cacti(slope, stand);
      case 'city': return parks(ax, az, edge);
      case 'heaven': return 1.4 * pines(h, slope * 0.6, edge, stand + 0.15, water);
      case 'inferno':
      case 'abyss':
      case 'space': return 0;
      default: return alpine(h, slope, edge, stand, WORLDS[w].params.treeLine);
    }
  }

  // 0..1 canopy cover. h: shaped ground height; slope: 1 - normal.y;
  // near: distance to the nearest road centreline; cut/fill: metres the road
  // took away or added here.
  function density(ax, az, h, slope, near, cut, fill) {
    const stand = fbm(nStand, ax / 1100, az / 1100, 3);
    const edge = fbm(nEdge, ax / 160, az / 160, 2);
    let d;
    if (!worlds) d = alpine(h, slope, edge, stand, treeLine);
    else {
      worlds.at(ax, az, tmp);
      const a = tmp.a;
      const b = tmp.b;
      const t = tmp.t;
      d = pattern(a, ax, az, h, slope, edge, stand);
      if (t > 1e-4) d += (pattern(b, ax, az, h, slope, edge, stand) - d) * t;
    }
    // The road's clearing, and nothing on its cuts and fills.
    d *= smoothstep(10, 17, near);
    d *= 1 - smoothstep(0.4, 1.2, cut + fill);
    if (land.waterLevel && d > 0 && h < land.waterLevel(ax, az) + 0.6) d = 0;
    return d;
  }

  // Which tree stands here (an index into FLORA): the world's own, mixed
  // across a border by the per-tree roll r.
  function species(ax, az, r) {
    if (!worlds) return 0;
    worlds.at(ax, az, tmp);
    const w = r < tmp.t ? tmp.b : tmp.a;
    return Math.max(0, FLORA.indexOf(WORLDS[w].flora));
  }

  return { density, species, treeLine };
}
