// Where the forest grows: a pure function of absolute position and the land
// the road has shaped. The terrain asks it per vertex to paint the forest floor
// near the camera and the canopy far away; the instanced trees ask it per tree.
// Both see the same forest, so the trees thin out exactly where the painted
// canopy takes over, and no tree ever stands in a cutting or on the asphalt.
//
// Alpine pattern: hay meadows on the valley floors, spruce coming in up the
// slopes in stands with ragged edges, thinning into single trees toward the
// tree line, none on cliffs or scree.

import { makeSimplex, fbm, smoothstep } from './noise.js';

export function makeVegetation(land, seed) {
  const nStand = makeSimplex(seed ^ 0x7ee5);
  const nEdge = makeSimplex(seed ^ 0x51d3);
  const treeLine = land.treeLine;

  // 0..1 canopy cover. h: shaped ground height; slope: 1 - normal.y;
  // near: distance to the nearest road centreline; cut/fill: metres the road
  // took away or added here.
  function density(ax, az, h, slope, near, cut, fill) {
    const stand = fbm(nStand, ax / 1100, az / 1100, 3);
    const edge = fbm(nEdge, ax / 160, az / 160, 2);
    // Stands: about half the slopes, with edges broken up at tree scale.
    let d = smoothstep(-0.12, 0.1, stand + 0.22 * edge + 0.05);
    // Meadow on the flats, forest on the slopes (12 to 40 degrees).
    d *= 0.3 + 0.7 * smoothstep(0.015, 0.06, slope);
    d *= 1 - smoothstep(0.17, 0.26, slope + 0.03 * edge);
    // Thinning toward the tree line, a ragged one.
    d *= 1 - smoothstep(treeLine - 170, treeLine + 30, h + 70 * edge);
    // The road's clearing, and nothing on its cuts and fills.
    d *= smoothstep(10, 17, near);
    d *= 1 - smoothstep(0.4, 1.2, cut + fill);
    return d;
  }

  return { density, treeLine };
}
