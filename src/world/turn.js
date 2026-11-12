// Turning toward another world on the way. The road up to about a kilometre
// ahead of the car stays as built; past that it is dropped, the border is
// laid just beyond the last of the road that stays, and the road is surveyed
// again into the new world (Road.cut). Shared by the game (Game._turn, which
// also rebuilds what was drawn over the old road and the old land) and by
// tools/switch_check.mjs.

import { STEP } from './road.js';

export const TURN_AHEAD = 1000;   // metres of road ahead of the car that stay as built
const MARGIN = 60;                // the band a road shapes the land in, and some

// change(uFrom) rewrites the schedule (WorldMap.ask, next, setLoop) so that
// nothing before progress uFrom changes, and returns the progress from which
// the land does change, or null if nothing did. Returns null, or
// { cut, dropped, from }: the sample kept last (-1 when no cut was needed),
// the dropped samples' absolute positions (x, z, x, z...), and that progress.
export function turnWorlds(road, map, sCar, change) {
  const i = road.cutPoint(sCar + TURN_AHEAD);
  // Everything that stays was built for the land as it is, the road's own
  // band of cuts and fills included: the new land starts past all of it.
  // Without a place to cut, that is the whole of the road planned so far.
  const last = i >= 0 ? i : road.planned;
  let uFrom = -Infinity;
  for (let k = Math.max(road.first, Math.floor(sCar / STEP) - 100); k <= last; k++) {
    const p = road.samples.get(k);
    if (p) uFrom = Math.max(uFrom, map.u(p.ax, p.az));
  }
  const from = change(uFrom + MARGIN);
  if (from === null) return null;
  const dropped = i >= 0 ? road.cut(i) : [];
  return { cut: i, dropped, from };
}

// The usual changes, as change() functions for turnWorlds.
export const turnNext = (map) => (u) => {
  const ub = map.next(u);
  return ub === null ? null : ub - map.blend;
};
export const turnTo = (map, w) => (u) => {
  const ub = map.ask(w, u);
  return ub === null ? null : ub - map.blend;
};
export const turnLoop = (map, list) => (u) => map.setLoop(list, u);
