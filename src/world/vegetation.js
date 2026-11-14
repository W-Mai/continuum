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
// Deep sea: kelp in beds on the floor. Nothing grows under water but kelp,
// and kelp nowhere else. Across a border the two patterns blend and the
// kinds of tree mix.

import { makeSimplex, fbm, smoothstep } from './noise.js';
import { WORLDS, makeSkyline } from './worlds.js';

export const FLORA = ['spruce', 'broadleaf', 'pine', 'cactus', 'crystal', 'kelp', 'dead'];

// How tall each kind of tree grows (r a random share, d the stand's density
// there) and how wide its crown is for a height: the same numbers whether a
// tile is planted on the page or in a worker (bakery.js).
export const TREE_SIZE = {
  spruce: { height: (r, d) => (12 + 16 * r * r) * (0.7 + 0.3 * d), width: (h, r) => h * (0.85 + 0.4 * r) },
  broadleaf: { height: (r, d) => (9 + 9 * r * r) * (0.75 + 0.25 * d), width: (h, r) => h * (1.0 + 0.45 * r) },
  pine: { height: (r) => 9 + 7 * r, width: (h, r) => h * (0.95 + 0.35 * r) },
  cactus: { height: (r) => 3.2 + 4 * r, width: (h, r) => h * (0.9 + 0.3 * r) },
  crystal: { height: (r) => 2.5 + 6 * r * r, width: (h, r) => h * (0.85 + 0.4 * r) },
  kelp: { height: (r) => 12 + 16 * r, width: (h, r) => h * (0.2 + 0.12 * r) },
  dead: { height: (r, d) => (8 + 10 * r * r) * (0.75 + 0.25 * d), width: (h, r) => h * (0.75 + 0.4 * r) },
};

// Kelp stands in water at least this deep, so the tallest stays under.
const KELP_DEPTH = 30;

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

  // The Upside Down: a dead wood in stands, thin between them, none on the
  // steep.
  function deadWood(slope, edge, stand) {
    const d = 0.1 + 0.55 * smoothstep(-0.15, 0.2, stand + 0.2 * edge);
    return d * (1 - smoothstep(0.22, 0.32, slope));
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
      case 'cavern': return 0.05 * smoothstep(-0.1, 0.3, stand + 0.3 * edge) * (1 - smoothstep(0.2, 0.35, slope));
      case 'upside': return deadWood(slope, edge, stand);
      case 'abyss': return 0.3 * smoothstep(0.0, 0.3, stand + 0.6 * edge) * (1 - smoothstep(0.18, 0.3, slope));
      case 'inferno':
      case 'space': return 0;
      default: return alpine(h, slope, edge, stand, WORLDS[w].params.treeLine);
    }
  }

  // Whether a world's flora grows at this depth: wet is metres above the
  // liquid's surface (Infinity where there is none).
  const grows = (w, wet) => (WORLDS[w].params.underwater ? wet < -KELP_DEPTH : wet > 0.6);

  // 0..1 canopy cover. h: shaped ground height; slope: 1 - normal.y;
  // near: distance to the nearest road centreline; cut/fill: metres the road
  // took away or added here.
  function density(ax, az, h, slope, near, cut, fill) {
    const stand = fbm(nStand, ax / 1100, az / 1100, 3);
    const edge = fbm(nEdge, ax / 160, az / 160, 2);
    let d;
    if (!worlds) {
      d = alpine(h, slope, edge, stand, treeLine);
      if (land.waterLevel && d > 0 && h < land.waterLevel(ax, az) + 0.6) d = 0;
    } else {
      worlds.at(ax, az, tmp);
      const a = tmp.a;
      const b = tmp.b;
      const t = tmp.t;
      let pa = pattern(a, ax, az, h, slope, edge, stand);
      let pb = t > 1e-4 ? pattern(b, ax, az, h, slope, edge, stand) : 0;
      if ((pa > 0 || pb > 0) && land.waterLevel) {
        const wet = h - land.waterLevel(ax, az);
        if (!grows(a, wet)) pa = 0;
        if (!grows(b, wet)) pb = 0;
      }
      d = t > 1e-4 ? pa + (pb - pa) * t : pa;
    }
    // The road's clearing, and nothing on its cuts and fills.
    d *= smoothstep(10, 17, near);
    d *= 1 - smoothstep(0.4, 1.2, cut + fill);
    return d;
  }

  // Which tree stands here (an index into FLORA): the world's own, mixed
  // across a border by the per-tree roll r. A world that grows nothing
  // leaves its side of the border to the other world's trees. Between the
  // deep sea and a world on land, the ground's height h decides instead:
  // kelp under the water, the land's trees above it.
  function species(ax, az, r, h) {
    if (!worlds) return 0;
    worlds.at(ax, az, tmp);
    const a = FLORA.indexOf(WORLDS[tmp.a].flora);
    const b = FLORA.indexOf(WORLDS[tmp.b].flora);
    if (a < 0) return Math.max(0, b);
    if (b < 0) return a;
    const sa = !!WORLDS[tmp.a].params.underwater;
    if (h !== undefined && sa !== !!WORLDS[tmp.b].params.underwater && land.waterLevel) {
      return (h < land.waterLevel(ax, az)) === sa ? a : b;
    }
    return r < tmp.t ? b : a;
  }

  return { density, species, treeLine };
}
