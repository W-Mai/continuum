// A worker that bakes terrain and forest tiles for the page
// (render/bakers.js): the same bakery (world/bakery.js) on the same land,
// so a tile comes out as it would have on the page.
//
// It imports nothing by itself. The page's import map, which stamps every
// module's URL with its content (tools/stamp.mjs), does not reach into a
// worker, and modules imported here by their plain URLs could come out of
// the browser's cache a release apart. So the page hands over the stamped
// URL of each module the bakery needs; the worker fetches them all, points
// each one's imports at the others and loads them from blobs.
//
// In: init { urls, seed, opts, map }, map { map } (the page's world map
// changed), land { id, level, ix, iz, ctx, sun }, trees { id, ix, iz, ctx,
// sun, seed }. Out: ready, error { message }, done { id, r }, failed { id,
// message }.

// Static imports and re-exports, as tools/stamp.mjs finds them.
const SPEC = /((?:^|[;\s])(?:import|export)\s*(?:[\w*{}\s,$]*?\s*from\s*)?)(['"])([^'"]+)\2/g;

// The modules as blob URLs, each importing the others' blobs. Every import
// among them is a sibling ('./x.js'), and there is no cycle.
async function load(urls) {
  const src = {};
  await Promise.all(Object.entries(urls).map(async ([name, url]) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    src[name] = await res.text();
  }));
  const blobs = {};
  const open = new Set();
  const make = (name) => {
    if (blobs[name]) return blobs[name];
    if (!(name in src)) throw new Error(`no URL for ${name}`);
    if (open.has(name)) throw new Error(`import cycle through ${name}`);
    open.add(name);
    const code = src[name].replace(SPEC, (all, head, q, spec) => {
      if (!spec.startsWith('./')) throw new Error(`${name} imports ${spec}`);
      return head + q + make(spec.slice(2)) + q;
    });
    blobs[name] = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    return blobs[name];
  };
  for (const name of Object.keys(src)) make(name);
  return blobs;
}

let land = null;
let env = null;
let bakery = null;

// The page's world map as it is now: where the road set out and which way,
// and the schedule of worlds (render/bakers.js, mapState).
function setMap(state) {
  const m = land.worlds;
  for (const k of ['ox', 'oz', 'dx', 'dz', 'shift', 'ready', 'len', 'blend', 'first', 'version']) m[k] = state[k];
  m.loop = state.loop;
  m.segs = state.segs;
  m._hint = 0;
}

async function start(msg) {
  const blobs = await load(msg.urls);
  const [worlds, corridor, vegetation, b] = await Promise.all(
    ['worlds.js', 'corridor.js', 'vegetation.js', 'bakery.js'].map((n) => import(blobs[n])),
  );
  for (const url of Object.values(blobs)) URL.revokeObjectURL(url);
  land = worlds.makeWorldLand(msg.seed, msg.opts);
  setMap(msg.map);
  // The corridor only shapes the land here, from what the page prepared.
  env = { land, corridor: new corridor.Corridor(null, land), veg: vegetation.makeVegetation(land, msg.seed) };
  bakery = b;
}

// Every typed array's buffer in a result, to hand back without a copy.
function buffers(o, out = new Set()) {
  if (ArrayBuffer.isView(o)) out.add(o.buffer);
  else if (o && typeof o === 'object') for (const v of Object.values(o)) buffers(v, out);
  return out;
}

function handle(msg) {
  if (msg.type === 'map') {
    setMap(msg.map);
    return;
  }
  try {
    const t0 = performance.now();
    const gen = msg.type === 'land'
      ? bakery.bakeLand(env, msg.level, msg.ix, msg.iz, msg.ctx, msg.sun)
      : bakery.plantTrees(env, msg.ix, msg.iz, msg.ctx, msg.sun, msg.seed);
    let r = gen.next();
    while (!r.done) r = gen.next();
    const ms = performance.now() - t0;
    self.postMessage({ type: 'done', id: msg.id, r: r.value, ms }, [...buffers(r.value)]);
  } catch (e) {
    self.postMessage({ type: 'failed', id: msg.id, message: String((e && e.stack) || e) });
  }
}

// Messages are handled in the order they came, the first ones once the
// modules are loaded.
let boot = null;
self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    boot = start(msg).then(
      () => {
        self.postMessage({ type: 'ready' });
        return true;
      },
      (err) => {
        self.postMessage({ type: 'error', message: String((err && err.stack) || err) });
        return false;
      },
    );
    return;
  }
  boot.then((ok) => ok && handle(msg));
};
