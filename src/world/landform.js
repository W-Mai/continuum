// Natural land: what the ground would be if nobody had built a road.
//
// A landform is a pure function of absolute world position. The road planner
// surveys it to decide where to go, the corridor carves the road into it, and
// the terrain tiles bake it into geometry. Nothing here knows about the road.

import { makeSimplex, fbm, ridged, smoothstep } from './noise.js';

// Alpine: warped massifs with sharp crests on the high ground and flat-floored
// valleys between them. Metres above the valley datum; peaks reach about 1 km.
export function makeAlpine(seed) {
  const nBase = makeSimplex(seed ^ 0x51a7e);
  const nWarp = makeSimplex(seed ^ 0x2b0f1);
  const nCrest = makeSimplex(seed ^ 0x7c3d9);
  const nGully = makeSimplex(seed ^ 0x6a11e);

  function field(x, z, octaves, crestOctaves, gullies) {
    const wx = x + 600 * fbm(nWarp, x * 0.00025, z * 0.00025, 2);
    const wz = z + 600 * fbm(nWarp, x * 0.00025 + 7.7, z * 0.00025 - 3.9, 2);
    const n = fbm(nBase, wx / 3800, wz / 3800, octaves, 2.0, 0.45);
    const t = n + 0.12;
    // Below the datum the land flattens into valley floors; above it the slopes
    // steepen with height, so peaks read as peaks rather than domes.
    let h = t > 0 ? 1250 * Math.pow(t, 1.25) : 190 * t;
    if (crestOctaves > 0 && h > 150) {
      const r = ridged(nCrest, wx / 2400, wz / 2400, crestOctaves, 2.0, 0.5, 1.0);
      h += 380 * r * r * smoothstep(150, 600, h);
    }
    // Spurs and gullies on the mountainsides, a few hundred metres apart and
    // up to twenty deep: what erosion carves, and what catches the light on a
    // face two kilometres away. Valley floors are left smooth.
    if (gullies && h > 50) {
      const g = ridged(nGully, wx / 430, wz / 430, 3, 2.1, 0.5, 1.0);
      h += (g - 0.36) * 46 * smoothstep(50, 420, h);
    }
    return h;
  }

  return {
    id: 'alpine',
    heightAt: (x, z) => field(x, z, 8, 4, true),
    // The planner's long-range survey and the sun-shadow march only need the
    // big shapes. Six base and four crest octaves stay within ~16 m of the full
    // field (plus the gullies, which no route search should steer by); two
    // crest octaves strayed by 130 m and the road ran into ridges the planner
    // could not see.
    heightAtCoarse: (x, z) => field(x, z, 6, 4, false),
    // Far terrain tiles: the big shapes with the gullies, so distant faces
    // keep their relief.
    heightAtFar: (x, z) => field(x, z, 6, 4, true),
    snowLine: 720,
    treeLine: 520,
  };
}
