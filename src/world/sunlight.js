// How much of the sun reaches a point, with the mountains in the way.
//
// One soft ray march toward the sun over the natural land. Terrain tiles bake
// it per vertex, road chunks per sample, and the car samples it every frame,
// so the car darkens exactly when it drives into the shadow the ridge casts on
// the valley floor, and a sunlit stretch of road ahead stays sunlit.

export function sunVisibility(land, ax, az, h, sun) {
  const hor = Math.hypot(sun.x, sun.z) || 1;
  const sx = sun.x / hor;
  const sz = sun.z / hor;
  const tanE = sun.y / hor;
  let v = 1;
  let d = 14;
  for (let k = 0; k < 15 && v > 0; k++) {
    const ht = land.heightAtCoarse(ax + sx * d, az + sz * d);
    const ray = h + 1.5 + d * tanE;
    // Penumbra widens with distance, like a real soft shadow from a far ridge.
    v = Math.min(v, Math.max(0, Math.min(1, (ray - ht) / (0.07 * d + 3) + 0.5)));
    d *= 1.45;
  }
  return v;
}
