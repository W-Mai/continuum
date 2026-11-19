// The start of the page: when each step was done, how far on it is, and the
// work left for after the first frame. window.__boot keeps them for the check
// that times the start (tools/cold_check.mjs): marks are [name, ms since the
// page began] in the order the steps were done, progress is 0 to 1 (the dot on
// the start screen), later is what the queue has run and what each piece cost.

function state() {
  const root = typeof window !== 'undefined' ? window : globalThis;
  return root.__boot || (root.__boot = { marks: [], progress: 0, later: [] });
}

export function mark(name) {
  state().marks.push([name, Math.round(performance.now() * 10) / 10]);
}

export function note(key, value) {
  state()[key] = value;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Who is told how far on the first frame is.
let watcher = null;
export function onProgress(fn) {
  watcher = fn;
}

// It only goes forward.
export function progress(p) {
  const s = state();
  if (p > s.progress) {
    s.progress = Math.min(1, p);
    if (watcher) watcher(s.progress);
  }
}

// Work for after the first frame, a little of it a frame. A task is a function,
// or a generator function that gives the frame back between its steps. They
// run in the order they were added until the frame's budget (ms) is spent, one
// step at least, so that all that is queued costs a frame about the budget.
export class Later {
  constructor(budget = 4) {
    this.budget = budget;
    this.queue = [];
    this.frames = 0;
  }

  add(name, task) {
    this.queue.push({ name, task, steps: null, ms: 0, n: 0 });
  }

  get pending() {
    return this.queue.length;
  }

  // One step of the first task.
  _step() {
    const job = this.queue[0];
    const t0 = performance.now();
    let done = true;
    try {
      if (!job.steps) {
        const r = job.task();
        if (r && typeof r.next === 'function') job.steps = r;
      }
      if (job.steps) done = job.steps.next().done;
    } catch (e) {
      console.warn(`continuum: ${job.name} failed:`, e);
    }
    job.ms += performance.now() - t0;
    job.n++;
    if (done) {
      this.queue.shift();
      state().later.push({ name: job.name, ms: Math.round(job.ms * 10) / 10, steps: job.n, frame: this.frames });
    }
  }

  // A frame's share.
  run() {
    this.frames++;
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < this.budget) this._step();
  }

  // All that is left, now (a change of style does not wait).
  flush() {
    while (this.queue.length) this._step();
  }
}
