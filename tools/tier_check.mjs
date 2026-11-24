// The low tier, row by row, in node: no browser, no frame drawn.
//
// The low tier is one configuration (render/quality.js, LOW, and the tables of what
// draws by the tier). This reads those tables and the few functions that apply them
// and asserts each row:
//  - the scene: 0.6 of the canvas counted at a pixel ratio of 1 (0.6 of the canvas's
//    pixels at a ratio of 1, 0.3 at 2), where a pinned ladder starts, and never more
//    at the low tier; the high tier as it was;
//  - the frame rate: 30 at the most when the tier is pinned low (capAt), and a pacer
//    so capped on a display at 60 Hz or 120 Hz draws every second or fourth refresh;
//  - the sun's shadow: one map of 1024 texels, 90 m either way of its centre, no far map;
//  - the trees: the heights on the screen they change over at are 1.6 times the high
//    tier's (the forest is given a detail of 1 / 1.6 at the most);
//  - the land and the city: detail 0.65 at the most, and less where the ladder gives less;
//  - the grass: none (the real style's blades and the painted style's, the block's);
//  - what lies about the ground: within 56 m of the lens, not 84, and 350 of a kind at
//    the most, not 700;
//  - the points in the air: 4000 of 12000;
//  - a style's pass: the painted style lays no strokes, the flat paints of the ink, the cel
//    and the print reach two pixels, the block style is as it is at the others;
//  - the last pass: no edges cleaned and nothing sharpened; a frame drawn smaller than the
//    canvas is only brought up to it (one draw, the Catmull-Rom one);
//  - no bloom; no contact shadow, no occlusion, no reflection on the water, no light
//    shafts, no motion blur;
//  - kept: the lamps on the cars and their halos, the headlights' pool (nothing there
//    reads the tier);
//  - every module of src/render with a setTier( method, found by reading the directory: its
//    tables of { high, mid, low } (and those of the modules it draws through) are none at the
//    low tier, unless it is one of LOW_DRAWS, which say what they draw there and why; a module
//    that says nothing of the low tier fails;
//  - the car at the low tier: its parts joined by material (CAR_LOW), 26 meshes and not 49;
//  - the land at the low tier: the tiles from 256 m drawn through every second vertex (LAND_TIERS);
//  - the ink's far wood laid on the land at every tier, its trees drawn to 400 m (Style.treeReach);
//  - the high tier draws what it drew (each of these is the same at high as before).
//
// Usage: node tools/tier_check.mjs   (npm run check:tier)

import { readdirSync, readFileSync } from 'node:fs';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(s, c, n) { return s === 'three' ? { url: ${JSON.stringify(new URL('./vendor/three.module.js', import.meta.url).href)}, shortCircuit: true } : n(s, c); }`,
));
const at = (m) => import(`../src/render/${m}.js`);
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const { LOW, Quality, lowScale, capAt, landDetail, treeDetail } = await at('quality');
const { Pacer } = await at('pacing');
const { SHADOW } = await at('atmosphere');
const { CLUTTER_TIERS } = await at('clutter');
const { MOTES_TIERS } = await at('motes');
const { CarPresentation, CAR_LOW } = await at('presentation');
const { TerrainField, LAND_TIERS } = await at('terrain');
const THREE = await import('three');
const { GLTFLoader } = await import('./vendor/GLTFLoader.js');
const { POST_LOW } = await at('post');
const { PresentPass } = await at('present');
const { AO } = await at('ao');
const { SHAFTS } = await at('shafts');
const { BLUR } = await at('lens');
const { NIGHT } = await at('nightlight');
const { FOLIAGE_LEVELS } = await at('foliage');

let failed = 0;
let rows = 0;
const check = (ok, text) => {
  rows++;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
};
const near = (a, b) => Math.abs(a - b) < 1e-9;

// --- the scene's size ---------------------------------------------------------
check(LOW.scale === 0.6, `the scene at the low tier: ${LOW.scale} of the canvas at a pixel ratio of 1`);
check(near(lowScale(1, 1), 0.6) && near(lowScale(0.75, 2), 0.3) && near(lowScale(1, 1.5), 0.4),
  `of the canvas's own pixels: ${lowScale(1, 1)} at a ratio of 1, ${lowScale(1, 1.5).toFixed(2)} at 1.5, ${lowScale(0.75, 2)} at 2`);
// The ladder, with a game that only takes what it is told.
const fakeGame = (ratio) => ({
  renderer: { getPixelRatio: () => ratio },
  post: { pixelLevel: 0 },
  atmosphere: { setShadowSize() {} },
  setRenderScale(s) { this.scale = s; },
  setDetail(d) { this.detail = d; },
  setTier(t) { this.tier = t; },
});
{
  const g = fakeGame(2);
  const q = new Quality(g, 0.75, 60, 'low');
  check(near(q.scale, 0.3), `pinned low at a pixel ratio of 2: the ladder starts at ${q.scale} of the canvas (0.6 at a ratio of 1)`);
  q.set(4);
  check(near(q.scale, 0.15) && near(g.scale, 0.15), `and steps down from there (${q.scale} at its last step)`);
  q.pin(null);
  check(near(q.scale, 0.3) && g.tier === 'low', `let go at the last step, the ladder's own low: ${q.scale} (its 0.5 of 0.75 would be 0.75 of the canvas at a ratio of 1, more than 0.6)`);
  const a = new Quality(fakeGame(2), 0.75, 60, null);
  a.set(4);
  check(a.tier === 'low' && near(a.scale, 0.3), `the ladder's own low at a ratio of 2 is ${a.scale}: never more than the low tier's size`);
  const b = new Quality(fakeGame(1), 1, 60, null);
  b.set(4);
  check(near(b.scale, 0.5), `at a ratio of 1 it is ${b.scale}, as it was`);
  const h = new Quality(fakeGame(2), 0.75, 60, 'high');
  check(near(h.scale, 0.75), `pinned high: ${h.scale}, as it was`);
  const p = new Quality(fakeGame(1), 1, 60, 'high');
  p.pin('low');
  check(near(p.scale, 0.6) && near(p.game.scale, 0.6), `pinned low from high in a page: the scene goes to ${p.game.scale}`);
  p.pin('mid');
  check(near(p.game.scale, 1), `and back to ${p.game.scale} pinned mid`);
}
check(/this\.renderScale = this\._tier === 'low' \? this\.lowScale : this\.baseScale/.test(source('src/game.js')),
  'a page with no ladder (headless) at the low tier draws the scene at that size too (Game)');

// --- the frame rate -------------------------------------------------------------
check(LOW.fps === 30 && capAt(60, 'low') === 30 && capAt(0, 'low') === 30 && capAt(24, 'low') === 24,
  `the frame cap pinned low: 60 -> ${capAt(60, 'low')}, every refresh -> ${capAt(0, 'low')}, 24 -> ${capAt(24, 'low')}`);
check(capAt(60, 'high') === 60 && capAt(0, 'mid') === 0 && capAt(60, 'auto') === 60, 'any other tier keeps the cap it has');
for (const hz of [60, 120]) {
  const pacer = new Pacer(capAt(60, 'low'));
  // (It draws every refresh until it has seen enough of them to know the display's rate: the second half is counted.)
  let drawn = 0;
  const n = 4 * hz;
  for (let i = 0; i < n; i++) if (pacer.refresh(i * 1000 / hz) && i >= n / 2) drawn++;
  const fps = drawn / (n / 2 / hz);
  check(Math.abs(fps - 30) < 0.5 && Math.abs(pacer.target - 30) < 0.01, `a ${hz} Hz display pinned low: ${fps.toFixed(1)} frames a second, the ladder aims at ${pacer.target.toFixed(1)}`);
}
check(/new Pacer\(capAt\(/.test(source('index.html')) && /pacer\.setCap\(capAt\(/.test(source('index.html')),
  'the page gives the pacer the cap through capAt, at the start and as the tier or the cap is set');

// --- the sun's shadow -----------------------------------------------------------
check(SHADOW.aloneSize === 1024 && SHADOW.alone === 90, `the sun's shadow: one map of ${SHADOW.aloneSize} texels, ${SHADOW.alone} m either way`);
check(/const alone = this\._shadowTier === 'low';/.test(source('src/render/atmosphere.js'))
  && /this\._farOn = !alone && !this\._blocky;/.test(source('src/render/atmosphere.js')), 'and no far map');

// --- the trees, the land, the city ----------------------------------------------
check(near(1 / treeDetail(1, 'low'), LOW.trees) && LOW.trees === 1.6,
  `the trees change over at ${(1 / treeDetail(1, 'low')).toFixed(2)} times the heights on the screen`);
check(treeDetail(0.5, 'low') === 0.5 && treeDetail(1, 'high') === 1 && treeDetail(0.65, 'mid') === 0.65, 'less where the ladder gives less; the other tiers as the ladder has it');
check(landDetail(1, 'low') === 0.65 && landDetail(0.5, 'low') === 0.5 && landDetail(1, 'high') === 1 && landDetail(0.8, 'mid') === 0.8,
  `the land and the city: detail ${landDetail(1, 'low')} at the most`);
{
  const g = source('src/game.js');
  check(/this\.terrain\.setDetail\(landDetail\(f, this\._tier\)\)/.test(g) && /this\.forest\.setDetail\(treeDetail\(f, this\._tier\)\)/.test(g)
    && /this\.city\.setDetail\(landDetail\(f, this\._tier\)\)/.test(g) && /this\.setDetail\(opts\.detail \|\| 1\)/.test(g)
    && /this\.presentation\.setTier\(t\);\n\s+this\.setDetail\(this\.detail\);/.test(g),
  'Game.setDetail hands them on by the tier, from the start and again as the tier changes');
}
check(FOLIAGE_LEVELS.low.near === 1 && FOLIAGE_LEVELS.low.cell <= FOLIAGE_LEVELS.high.cell, `the real style's near trees: the middle build, pictures of ${FOLIAGE_LEVELS.low.cell}`);

// --- the grass --------------------------------------------------------------------
{
  const g = source('src/render/grass.js');
  check(/const painted = !!kind && !this\.off && tier !== 'low';/.test(g) && /if \(tier === 'low'\) return;/.test(g),
    'the grass: none at the low tier (the blades, the flowers and the ground map are not drawn or built)');
}

// --- on the ground, in the air ----------------------------------------------------
check(CLUTTER_TIERS.radius.low === 56 && CLUTTER_TIERS.radius.high === 84 && CLUTTER_TIERS.radius.mid === 84,
  `what lies about the ground: within ${CLUTTER_TIERS.radius.low} m (${CLUTTER_TIERS.radius.high} at the others)`);
check(CLUTTER_TIERS.max.low === 350 && CLUTTER_TIERS.max.high === 700, `${CLUTTER_TIERS.max.low} of a kind at the most (${CLUTTER_TIERS.max.high})`);
check(MOTES_TIERS.low === 4000 && MOTES_TIERS.high === 12000 && MOTES_TIERS.mid === 12000, `the points in the air: ${MOTES_TIERS.low} of ${MOTES_TIERS.high}`);

// --- a style's pass ---------------------------------------------------------------
{
  const s = source('src/render/style.js');
  check(/u\.uPaint\.value = this\.tier === 'low' \? 0 : c\.paint;/.test(s), 'the painted style lays no strokes');
  check(/u\.uFlatN\.value = this\.tier === 'high' \? 3 : 2;/.test(s), 'the flat paints (the ink, the cel, the print) reach two pixels either side');
  check(/return w\[0\] > 0\.5 \? w\[4\] : 0;/.test(s) && /styleU\.uInkWood\.value\.set\(c\.inkWood\[0\],/.test(s),
    'the ink\'s far wood is laid on the land at the low tier too, and its trees are drawn to where the land takes them over');
}

// --- the last pass, the bloom --------------------------------------------------------
check(POST_LOW.aa === 0 && POST_LOW.sharp === 0 && POST_LOW.bloom === false, 'the last pass cleans no edges and sharpens nothing; no bloom');
{
  const p = new PresentPass();
  p.aa = POST_LOW.aa;
  p.sharp = POST_LOW.sharp;
  p.setSize(768, 346);
  p.outSize.set(1280, 577);
  const drawn = [];
  const renderer = { setRenderTarget() {}, render(mesh) { drawn.push(mesh.material === p.up.material ? 'up' : mesh.material === p.clean.material ? 'clean' : '?'); } };
  p.render(renderer, null, { texture: null });
  check(p.needed && drawn.join() === 'up', `a frame drawn at 0.6 is brought up to the canvas and nothing else: ${drawn.join(', ')}`);
  p.setSize(1280, 577);
  check(!p.needed, 'one drawn at the canvas\'s size is not touched (the pass is not drawn)');
  p.dispose();
  const post = source('src/render/post.js');
  check(/c\.bloom > 0\.5 && \(!low \|\| POST_LOW\.bloom\)/.test(post) && /p\.aa = low \? POST_LOW\.aa : c\.aa;/.test(post) && /p\.sharp = low \? POST_LOW\.sharp : c\.sharp;/.test(post),
    'the chain takes them at the low tier, and the style\'s own at the others');
}

// --- what the real style added -------------------------------------------------------
check(/this\.post\.setContact\(t === 'high'\)/.test(source('src/game.js')), 'no contact shadow (the high tier alone has it)');
check(AO.slices.low === 0 && AO.slices.high > 0, `no ambient occlusion (directions: ${AO.slices.high}, ${AO.slices.mid}, ${AO.slices.low})`);
check(/this\.uniforms\.uSeaDry\.value > 0\.5 \|\| this\.tier === 'low'\) return;/.test(source('src/render/water.js')), 'no reflection on the water (what is behind it is not taken)');
check(SHAFTS.taps.low === 0 && SHAFTS.taps.high > 0, `no light shafts (taps: ${SHAFTS.taps.high}, ${SHAFTS.taps.mid}, ${SHAFTS.taps.low})`);
check(BLUR.tiers.low === 0 && BLUR.tiers.high > 0, 'no motion blur');

// --- kept ---------------------------------------------------------------------------
check(NIGHT.cars.low > 0, `kept: the lamps of ${NIGHT.cars.low} cars and their halos`);
check(!/tier/i.test(source('src/render/headbeam.js')), 'kept: the headlights\' pool (it reads no tier)');

// --- the car -----------------------------------------------------------------------------
{
  // (The car's glow under a folded wheel is drawn on a canvas: in node, one that draws nothing.)
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => ({ addColorStop() {} })), set: (o, k, v) => { o[k] = v; return true; } });
  globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  const glb = readFileSync(new URL('../out/car.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
  const p = new CarPresentation(new THREE.Scene());
  p.attach(gltf.scene, 0.001);
  const high = p.meshes();
  const tris = (ms) => ms.reduce((a, m) => a + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0);
  p.setTier('low');
  const low = p.meshes();
  const names = new Set(low.map((m) => m.material.name));
  const lit = ['head_light', 'tail_light', 'tail_light_off', 'emitter', 'glass', 'paint'].every((n) => names.has(n));
  check(low.length < high.length && low.length === 26 && Math.round(tris(low)) === Math.round(tris(high)) && lit,
    `the car at the low tier: ${low.length} meshes, not ${high.length} (CAR_LOW: ${CAR_LOW.body.length} groups on the body, ${CAR_LOW.wheel.length} on each wheel), the same ${Math.round(tris(low))} triangles, the lamps, the glass, the paint and the hover rings their own`);
  p.setTier('mid');
  const back = p.meshes();
  check(back.length === high.length && back.every((m, i) => m === high[i]), `at the middle tier the ${back.length} parts as they were`);
  p.dispose();
  check(p.meshes().length === high.length, 'dispose() lets the joined parts go and leaves the model as it was');
}

// --- the land -------------------------------------------------------------------------------
{
  const t = { indexCache: new Map() };
  const full = TerrainField.prototype._indices.call(t, 1).count / 3;
  const coarse = TerrainField.prototype._indices.call(t, 2).count / 3;
  check(LAND_TIERS.coarseFrom.low === 1 && LAND_TIERS.coarseFrom.high === Infinity && LAND_TIERS.coarseFrom.mid === Infinity && coarse === 2 * 32 * 32 + 4 * 32 * 4 && full === 2 * 64 * 64 + 4 * 64 * 4,
    `the land at the low tier: tiles of 256 m and more through every second vertex, ${coarse} triangles of ${full} (a quarter of the grid, half of the skirts); none at the other tiers`);
}

// --- every module that draws by the tier ------------------------------------------------
// Not a list written by hand: every module of src/render that has a setTier( method is found, and what it
// draws at each tier is read from its tables, objects of the form { high: …, mid: …, low: … }, its own and
// those of the modules it imports that have no setTier of their own (it hands them the tier as they are
// drawn). Each such module must say what the low tier is (a table, or a branch on 'low'); every number of
// its tables at the low tier must be none (0, false, null, an array of 0), unless it is in LOW_DRAWS, the
// modules that draw something at the low tier on purpose, each with why. A new module with no table and no
// branch, or with something at the low tier and not in LOW_DRAWS, fails here.
const LOW_DRAWS = {
  atmosphere: 'the sky, the sun and its one shadow map, the clouds with fewer taps',
  carlook: 'the car\'s clear coat, its glass and its lamps',
  clutter: 'what lies about the ground, within 56 m and half as many',
  forest: 'the trees, changing over at 1.6 times the heights on the screen',
  foliage: 'the real style\'s trees, the middle build near and pictures of 128',
  motes: 'the points in the air, 4000 of them',
  nightlight: 'the lamps of three cars and their halos, the lamps of the road',
  presentation: 'the car, its parts joined by material',
  roadmesh: 'the road, with no grain, no wet and no lamps in it',
  surfaces: 'the road\'s surfaces as the road asks (none at the low tier)',
  terrain: 'the land, the tiles from 256 m through every second vertex',
  water: 'the water, with no veils and no reflection',
  traffic: 'the other cars and the animals on the road',
  upside: 'the wound world itself; it hands the tier to its waymarks, its strike and its spores',
  heaven: 'the piers going white into the cloud (a number of the land\'s shader) and the bell (a sound), neither drawn by itself',
  citylife: 'the trains on the viaduct',
};
const isNone = (v) => /^(0|0\.0+|false|null|\[\s*0(\s*,\s*0)*\s*\])$/.test(v.trim());
const TABLE = /\{\s*high:\s*([^,{}]+?),\s*mid:\s*([^,{}]+?),\s*low:\s*([^,{}]+?)\s*[,}]/g;
const LOW_BRANCH = /(\btier\b|\bt\b|this\.tier|this\._tier|tier\(\))\s*[!=]==\s*'low'/;
{
  const dir = new URL('../src/render/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  const text = Object.fromEntries(files.map((f) => [f.slice(0, -3), readFileSync(new URL(f, dir), 'utf8')]));
  const tiered = Object.keys(text).filter((m) => /^\s+setTier\(/m.test(text[m]));
  const found = [];
  for (const m of tiered) {
    const children = [...text[m].matchAll(/from '\.\/([a-z0-9]+)\.js'/g)].map((x) => x[1])
      .filter((c) => text[c] && !tiered.includes(c));
    const tables = [];
    const branch = [m, ...children].some((c) => LOW_BRANCH.test(text[c]));
    for (const c of [m, ...children]) for (const t of text[c].matchAll(TABLE)) tables.push({ where: c, high: t[1], low: t[3] });
    const some = tables.filter((t) => !isNone(t.low));
    const why = LOW_DRAWS[m];
    const said = tables.length > 0 || branch;
    // Where a table's numbers are written out, the low tier's is no more than the high one's.
    const more = tables.filter((t) => /^[\d.]+$/.test(t.low.trim()) && /^[\d.]+$/.test(t.high.trim()) && Number(t.low) > Number(t.high));
    const ok = (said || !!why) && !more.length && (why ? true : !some.length);
    found.push(m);
    check(ok, `${m}: ${!said ? 'says nothing of the low tier (no table, no branch on \'low\')'
      : why ? `draws at the low tier: ${why}` : `nothing at the low tier (${tables.length} table${tables.length === 1 ? '' : 's'}${branch ? ', a branch on \'low\'' : ''})`}`
      + (some.length && !why ? `; drawn: ${some.map((t) => `${t.where} low: ${t.low.trim()}`).join(', ')}` : '')
      + (more.length ? `; more at low than at high: ${more.map((t) => `${t.where} ${t.low.trim()} > ${t.high.trim()}`).join(', ')}` : ''));
  }
  const stale = Object.keys(LOW_DRAWS).filter((m) => !found.includes(m));
  check(!stale.length && found.length >= 25, `${found.length} modules draw by the tier${stale.length ? `; LOW_DRAWS names some that do not: ${stale.join(', ')}` : ''}`);
}

console.log(failed ? `\n${failed} of ${rows} rows failed` : `\nall ${rows} rows hold`);
process.exit(failed ? 1 : 0);
