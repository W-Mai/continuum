// The road laid in pieces is the road laid whole. No renderer, no browser.
//
// Road.update lays a round (plan, fit, commit, classify) a few milliseconds at
// a time, putting it down between two pieces of work and taking it up a frame
// later; Road.ensure and a headless run lay a round in one go. A road is a
// number of rounds in order, so it must come out the same bit for bit however
// the rounds were cut up. Here the same seed is driven by the frame, 0.4 m of
// road a frame, once a round at a time (the reference) and once for each of
// several budgets, from one piece of work a frame to most of a round and more,
// the clock being a fake one that counts a millisecond a look, so that where a
// frame's work stops does not depend on the machine:
//  - what is classified is what the reference has classified, sample for
//    sample, field for field, the moment it is classified, and the road
//    ahead of the car never falls short of MIN_AHEAD;
//  - at every kilometre, the round in progress finished, the samples, the
//    working elevations (solution), the segment cells and the surveyor's own
//    state are the reference's;
//  - the worlds turned on the way (Game._turn) at places chosen by what the
//    laying is doing: at each of several frames after a round begins, and
//    inside a route search or the design of a serpentine put down half done.
//    The cut, the border and the dropped samples are the reference's, the
//    road right after the turn is, and so is all of it when the road has been
//    laid again;
//  - a car that is put 6 km on in a frame, a round half laid: MIN_AHEAD is laid
//    in full, whatever it costs, and the road is the reference's after.
// With --against, the reference is another tree's code (a commit exported with
// git archive): the way to hold a change to the road to "not a bit different".
// And one run with the real clock, told and not held: how long the dearest
// call of Road.update takes at 2 ms a frame, and with a round at a time.
//
// Usage: node tools/survey_check.mjs [--against 目录] [seed ...]

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const at = args.indexOf('--against');
const against = at >= 0 ? resolve(args[at + 1]) : null;
if (at >= 0) args.splice(at, 2);
const SEEDS = args.length ? args.map(Number) : [7, 1, 42];
const HERE = new URL('..', import.meta.url).pathname;
const load = (root, file) => import(pathToFileURL(resolve(root, file)).href);
const modules = async (root) => {
  const [worlds, road, surveyor, turn] = await Promise.all(['worlds', 'road', 'surveyor', 'turn'].map((m) => load(root, `src/world/${m}.js`)));
  return { ...worlds, ...road, ...surveyor, ...turn };
};
const NEW = await modules(HERE);
const OLD = against ? await modules(against) : NEW;
const MIN_AHEAD = NEW.MIN_AHEAD || 600;

const WORLD_LEN = 2500;          // a world's length, so that borders come in 12 km
const KM = 12;
const FRAME = 0.4;               // metres of road a frame (24 m/s at 60 frames a second)
const CHECK_EVERY = 1000;        // metres between full comparisons
// How many looks at the clock (a millisecond each) a frame's work gets, and so
// about how many pieces of it: 0.5 is one, 3.5 is four, 40 and 5000 are most of
// a round and several.
const BUDGETS = [0.5, 3.5, 40, 5000];
// Where, past S_TURN, the worlds are turned: this many frames after a round
// begins, and this many frames into the first, second and third stretch of
// work that is more than one plain sample.
const AFTER_BEGIN = [0, 1, 4, 16, 40, 80, 120, 160, 200, 240, 280, 340];
const INSIDE = [[0, 0], [0, 10], [1, 0], [1, 10], [2, 5]];
const S_TURN = 2400;
const LAID_AGAIN = 4000;         // metres driven on after a turn: the road is laid again in under half

const problems = [];
const fail = (text) => {
  problems.push(text);
  console.log(`FAIL ${text}`);
};
const lines = [];
const same = (a, b) => Object.is(a, b);

// What differs between two samples, or null.
function sampleDiff(a, b) {
  const ka = Object.keys(a);
  if (ka.join() !== Object.keys(b).join()) return `fields ${ka} against ${Object.keys(b)}`;
  for (const k of ka) if (!same(a[k], b[k])) return `${k} ${a[k]} against ${b[k]}`;
  return null;
}

// What differs between two maps of samples (or of numbers, or of lists of numbers), or null.
function mapDiff(name, ma, mb) {
  if (ma.size !== mb.size) return `${name}: ${ma.size} entries against ${mb.size}`;
  const ea = [...ma.keys()];
  const eb = [...mb.keys()];
  for (let i = 0; i < ea.length; i++) if (ea[i] !== eb[i]) return `${name}: the ${i}th key ${ea[i]} against ${eb[i]}`;
  for (const [k, va] of ma) {
    const vb = mb.get(k);
    let d;
    if (Array.isArray(va)) d = va.length === vb.length && va.every((x, i) => same(x, vb[i])) ? null : `${va} against ${vb}`;
    else if (va && typeof va === 'object') d = sampleDiff(va, vb);
    else d = same(va, vb) ? null : `${va} against ${vb}`;
    if (d) return `${name}[${k}]: ${d}`;
  }
  return null;
}

// What differs between two roads in all that the next round reads, or null.
function roadDiff(a, b) {
  for (const k of ['planned', 'committed', 'classified', 'first', 'cuts', 'cutAt', 'rebases']) {
    if (!same(a[k], b[k])) return `${k}: ${a[k]} against ${b[k]}`;
  }
  if (!same(a.origin.x, b.origin.x) || !same(a.origin.z, b.origin.z)) return 'the origin';
  const d = mapDiff('samples', a.samples, b.samples) || mapDiff('solution', a.solution, b.solution) || mapDiff('cells', a.cells, b.cells);
  if (d) return d;
  const sa = a.surveyor;
  const sb = b.surveyor;
  for (const k of ['ax', 'az', 'theta', 'kappa', 's', 'yPlan', 'u', 'routeDist', 'nextDecision', 'lastStackEnd', 'theta0', 'mode', 'thetaTarget']) {
    if (!same(sa[k], sb[k])) return `surveyor.${k}: ${sa[k]} against ${sb[k]}`;
  }
  for (const k of ['rx', 'rz', 'rd']) {
    if (sa[k].length !== sb[k].length || !sa[k].every((x, i) => same(x, sb[k][i]))) return `surveyor.${k}`;
  }
  if (sa._hist && !sa._hist.every((x, i) => same(x, sb._hist[i]))) return 'surveyor._hist';
  const st = sampleDiff({ ...sa.stats }, { ...sb.stats });
  return st ? `surveyor.stats: ${st}` : null;
}

// A clock that moves a millisecond each time it is looked at.
function counter() {
  let t = 0;
  return () => ++t;
}

// A road on a land of its own.
function build(M, seed, clock) {
  const land = M.makeWorldLand(seed, { len: WORLD_LEN });
  const road = new M.Road(land, seed, clock ? { clock } : {});
  return { land, road, map: land.worlds };
}

// Drive a pair along the road by the frame: the reference a round a frame (as a
// headless run lays it), the other `budgetMs` a frame. Stops, giving the metre
// it stopped at, when stopWhen(s, run) says so; calls marks(s) at every
// CHECK_EVERY metres; and holds what is classified to be the reference's the
// moment it is.
function drive(ref, run, budgetMs, from, to, { marks, stopWhen } = {}) {
  let compared = run.road.classified;
  let short = 0;
  let nextMark = from - (from % CHECK_EVERY) + CHECK_EVERY;
  let s = from;
  for (; s <= to; s += FRAME) {
    ref.road.budget = 1;
    ref.road.update(s);
    run.road.budgetMs = budgetMs;
    run.road.update(s);
    if (run.road.classified * NEW.STEP <= s + MIN_AHEAD) short++;
    if (run.road.classified !== compared) {
      for (let i = compared + 1; i <= run.road.classified; i++) {
        const a = ref.road.samples.get(i);
        const b = run.road.samples.get(i);
        const d = a && b ? sampleDiff(a, b) : `missing (${!!a}, ${!!b})`;
        if (d) return { error: `at ${s.toFixed(1)} m, the sample ${i} as it was classified: ${d}`, short, s };
      }
      compared = run.road.classified;
    }
    if (marks && s >= nextMark) {
      nextMark += CHECK_EVERY;
      const d = marks(s);
      if (d) return { error: d, short, s };
    }
    if (stopWhen && stopWhen(s, run)) return { error: null, short, s };
  }
  return { error: null, short, s: to };
}

// The round in progress finished, the pair compared whole.
function settled(ref, run, s) {
  run.road.settle();
  const d = roadDiff(ref.road, run.road);
  return d ? `at ${s.toFixed(1)} m, the round finished: ${d}` : null;
}

// Where to turn the worlds: n frames after a round begins; and k frames into
// the j-th stretch of work that is not one plain sample (a piece of the
// surveyor's put down between its pieces: a route search, a serpentine).
function afterBegin(n) {
  let began = -1;
  let frames = 0;
  return (s, run) => {
    if (s < S_TURN) return false;
    if (began < 0 && run.road._round) began = frames;
    frames++;
    return began >= 0 && frames - 1 - began >= n;
  };
}
function inside(j, k) {
  let last = null;
  let seen = -1;
  let frames = 0;
  return (s, run) => {
    if (s < S_TURN) return false;
    const piece = run.road._piece;
    if (piece && piece !== last) {
      last = piece;
      seen++;
      frames = 0;
    }
    if (!piece || seen < j) return false;
    return frames++ >= k;
  };
}

for (const seed of SEEDS) {
  // --- driving on -------------------------------------------------------------
  for (const budgetMs of BUDGETS) {
    const ref = build(OLD, seed);
    const run = build(NEW, seed, counter());
    const r = drive(ref, run, budgetMs, 0, KM * 1000, { marks: (s) => settled(ref, run, s) });
    const tag = `seed ${seed}, ${budgetMs} ms a frame`;
    if (r.error) fail(`${tag}: ${r.error}`);
    else if (r.short) fail(`${tag}: the road was short of MIN_AHEAD ${r.short} times`);
    else lines.push(`ok   ${tag}: ${KM} km, the road is the reference's at every round and every kilometre, never short of MIN_AHEAD`);
  }
  // --- turning the worlds -------------------------------------------------------
  const where = [...AFTER_BEGIN.map((n) => [`${n} frames after a round began`, afterBegin(n)]),
    ...INSIDE.map(([j, k]) => [`${k} frames into piece ${j + 1} of the work larger than a sample`, inside(j, k)])];
  const stages = {};
  let turned = 0;
  let ok = true;
  for (const [what, stopWhen] of where) {
    const ref = build(OLD, seed);
    const run = build(NEW, seed, counter());
    let r = drive(ref, run, 0.5, 0, 12000, { stopWhen });
    if (r.error) {
      fail(`seed ${seed}, turned ${what}: ${r.error}`);
      ok = false;
      continue;
    }
    if (r.s >= 12000) {
      lines.push(`note seed ${seed}: never came to a place to turn ${what}`);
      continue;
    }
    const sTurn = r.s;
    const stage = run.road._piece ? 'a route search or a serpentine' : run.road._round ? ['the plan', 'the fit', 'the commit'][run.road._round.stage] : 'no round';
    stages[stage] = (stages[stage] || 0) + 1;
    const a = OLD.turnWorlds(ref.road, ref.map, sTurn, OLD.turnNext(ref.map));
    const b = NEW.turnWorlds(run.road, run.map, sTurn, NEW.turnNext(run.map));
    const here = `seed ${seed}, turned ${what} (${sTurn.toFixed(1)} m, in ${stage})`;
    if (!!a !== !!b || (a && (a.cut !== b.cut || a.from !== b.from || a.dropped.length !== b.dropped.length || !a.dropped.every((x, i) => same(x, b.dropped[i]))))) {
      fail(`${here}: the cut, the border or the dropped road differ (cut ${a && a.cut}, border ${a && a.from}, ${a && a.dropped.length / 2} samples dropped; against ${b && b.cut}, ${b && b.from}, ${b && b.dropped.length / 2})`);
      ok = false;
      continue;
    }
    if (!a) continue;
    turned++;
    const d0 = roadDiff(ref.road, run.road);
    if (d0) {
      fail(`${here}: right after the turn: ${d0}`);
      ok = false;
      continue;
    }
    r = drive(ref, run, 0.5, sTurn + FRAME, sTurn + LAID_AGAIN, {});
    const d = r.error || settled(ref, run, sTurn + LAID_AGAIN);
    if (d) {
      fail(`${here}: ${d}`);
      ok = false;
    } else if (r.short) {
      fail(`${here}: the road was short of MIN_AHEAD ${r.short} times`);
      ok = false;
    }
  }
  // --- a car put well ahead of the road ----------------------------------------------
  {
    const ref = build(OLD, seed);
    const run = build(NEW, seed, counter());
    let r = drive(ref, run, 0.5, 0, 12000, { stopWhen: (s, now) => s >= S_TURN && !!now.road._round });
    const tag = `seed ${seed}, a car put 6 km on in a frame`;
    if (r.error) {
      fail(`${tag}: ${r.error}`);
    } else {
      const s1 = r.s + 6000;
      ref.road.budget = 1;
      ref.road.update(s1);
      run.road.budgetMs = 0.5;
      run.road.update(s1);
      if (run.road.classified * NEW.STEP <= s1 + MIN_AHEAD) fail(`${tag}: the road was short of MIN_AHEAD after it (${run.road.classified * NEW.STEP - s1} m ahead)`);
      r = drive(ref, run, 0.5, s1 + FRAME, s1 + 3000, {});
      const d = r.error || settled(ref, run, s1 + 3000);
      if (d) fail(`${tag}: ${d}`);
      else lines.push(`ok   ${tag}, a round half laid: MIN_AHEAD is laid at once and the road is the reference's`);
    }
  }
  if (!stages['the plan'] || !stages['the fit'] || !stages['a route search or a serpentine']) {
    fail(`seed ${seed}: the turns did not come with a round in each of its stages (${JSON.stringify(stages)})`);
    ok = false;
  }
  if (ok) {
    lines.push(`ok   seed ${seed}: the worlds turned at ${turned} places, with a round in ${Object.entries(stages).map(([k, v]) => `${k} ${v}`).join(', ')}: the cut, the road right after it and the road laid again are the reference's`);
  }
}

// --- the machine's clock: told, not held ---------------------------------------------

{
  const seed = SEEDS[0];
  const timed = (budgetMs) => {
    const { road } = build(NEW, seed);
    const calls = [];
    for (let s = 0; s <= KM * 1000; s += FRAME) {
      road.budget = budgetMs === Infinity ? 1 : Infinity;
      road.budgetMs = budgetMs;
      const t0 = performance.now();
      road.update(s);
      calls.push(performance.now() - t0);
    }
    calls.sort((x, y) => x - y);
    const q = (p) => calls[Math.min(calls.length - 1, Math.floor(calls.length * p))];
    return { max: q(1), p999: q(0.999) };
  };
  timed(2);                       // the code warm
  const whole = timed(Infinity);
  const piece = timed(2);
  lines.push(`note seed ${seed}, ${KM} km, the dearest call of Road.update: ${whole.max.toFixed(1)} ms with a round at a time, ${piece.max.toFixed(1)} ms at 2 ms a frame (99.9th percentile ${whole.p999.toFixed(2)} and ${piece.p999.toFixed(2)})`);
}

for (const l of lines) console.log(l);
if (problems.length) {
  console.error(`\nFAILED: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`\nOK: the road laid in pieces is the road laid whole${against ? `, and the road of ${against}` : ''}`);
