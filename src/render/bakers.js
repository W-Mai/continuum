// Workers that bake terrain and forest tiles off the page.
//
// On the page a tile is baked a slice at a time within each frame's budget
// (render/terrain.js, render/forest.js): a fine land tile takes 5-10 ms, a
// forest tile 2-3. The workers run the same bakery (world/bakery.js) on the
// same land, so a tile comes out the same either way; the page only prepares
// the road's corridor for the tile, sends it out, and builds the mesh from
// the arrays that come back.
//
// A worker cannot use the page's import map (tools/stamp.mjs), so the page
// resolves the stamped URL of each module the bakery needs and hands them
// over (world/bakeworker.js). Until a worker is up, after one fails, in
// headless runs and where there are no module workers, the page bakes.

const MODULES = ['noise', 'landform', 'worlds', 'sunlight', 'surveyor', 'road', 'corridor', 'vegetation', 'bakery'];
const DEPTH = 2;            // jobs out per worker at a time, so the newest wishes go first

// What the workers' land needs of the page's world map: where the road set
// out and which way, and the schedule of worlds.
function mapState(m) {
  return {
    ox: m.ox, oz: m.oz, dx: m.dx, dz: m.dz, shift: m.shift, ready: m.ready,
    len: m.len, blend: m.blend, first: m.first, version: m.version,
    loop: m.loop.slice(),
    segs: m.segs.map((s) => ({ u: s.u, w: s.w, blend: s.blend, asked: s.asked })),
  };
}

export class Bakers {
  // land: the page's (makeWorldLand), made from seed and opts.
  constructor(land, seed, opts, count) {
    this.map = land.worlds;
    this.version = this.map.version;
    this.workers = [];
    this.jobs = new Map();       // id -> { done, w }
    this.nextId = 1;
    this.failed = false;
    this.baked = 0;              // jobs back, and the workers' time on them
    this.ms = 0;
    const urls = Object.fromEntries(MODULES.map((m) => [m + '.js', import.meta.resolve(`../world/${m}.js`)]));
    const init = { type: 'init', urls, seed, opts, map: mapState(this.map) };
    const entry = import.meta.resolve('../world/bakeworker.js');
    // The URLs the workers load, for tools/bake_check.mjs to see stamped.
    this.urls = { 'bakeworker.js': entry, ...urls };
    for (let k = 0; k < count; k++) {
      const w = { worker: new Worker(entry, { type: 'module' }), ready: false, load: 0 };
      w.worker.onmessage = (e) => this._message(w, e.data);
      w.worker.onerror = (e) => this._fail((e && e.message) || 'the worker did not start');
      w.worker.postMessage(init);
      this.workers.push(w);
    }
  }

  // Some worker is up.
  get ready() {
    return !this.failed && this.workers.some((w) => w.ready);
  }

  // Some worker is up and has room for a job.
  get free() {
    return !this.failed && this.workers.some((w) => w.ready && w.load < DEPTH);
  }

  // Send a job (bakeworker.js) to the least busy worker, handing over the
  // buffers in transfer; done(result) is called when it is back. Returns its
  // id, or 0 when no worker has room.
  post(job, transfer, done) {
    if (this.map.version !== this.version) {
      // The schedule of worlds changed: the workers see it before any job
      // sent from now on.
      this.version = this.map.version;
      const msg = { type: 'map', map: mapState(this.map) };
      for (const w of this.workers) w.worker.postMessage(msg);
    }
    let best = null;
    for (const w of this.workers) {
      if (w.ready && w.load < DEPTH && (!best || w.load < best.load)) best = w;
    }
    if (this.failed || !best) return 0;
    const id = this.nextId++;
    job.id = id;
    this.jobs.set(id, { done, w: best });
    best.load++;
    best.worker.postMessage(job, transfer);
    return id;
  }

  _message(w, msg) {
    if (msg.type === 'ready') {
      w.ready = true;
      return;
    }
    if (msg.type === 'error') {
      this._fail(msg.message);
      return;
    }
    const job = this.jobs.get(msg.id);
    if (!job) return;
    this.jobs.delete(msg.id);
    w.load--;
    if (msg.type === 'failed') {
      this._fail(msg.message);
      return;
    }
    this.baked++;
    this.ms += msg.ms;
    job.done(msg.r);
  }

  // Back to baking on the page, for good.
  _fail(message) {
    if (this.failed) return;
    this.failed = true;
    console.warn('continuum: tiles are baked on the page, a worker failed:', message);
    for (const w of this.workers) w.worker.terminate();
    this.jobs.clear();
  }
}

// A pool for the page's land, or null where module workers cannot run.
export function makeBakers(land, seed, opts) {
  if (typeof Worker === 'undefined' || typeof import.meta.resolve !== 'function') return null;
  const count = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
  try {
    return new Bakers(land, seed, opts, count);
  } catch (e) {
    console.warn('continuum: tiles are baked on the page:', e);
    return null;
  }
}
