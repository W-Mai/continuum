// Which refreshes of the display to draw on.
//
// The car's physics steps sixty times a second, and what is drawn between two
// steps is the same car. A display that refreshes at 120 or 144 Hz would be
// given the same picture twice, for twice the power. So when the display is
// well above the rate the page draws at, it is drawn on every second (or
// third) refresh; a display at 90 or 100 Hz is not quite worth halving, and
// is left alone.
//
// The display's rate is read off the gaps between refreshes: the quickest
// quarter of them, since a slow frame is a long gap and never a short one.
// Only a rate of 55 Hz or more is believed. A lower one may be a machine too
// slow to keep up (every frame a missed refresh), and that is for the quality
// ladder to see to (render/quality.js), not to be taken for the display's own.

const WINDOW = 90;          // gaps kept
const EVERY = 60;           // refreshes between looks at them
const MIN_KNOWN = 55;       // Hz

export class Pacer {
  // cap: the most frames a second to draw; 0 for every refresh.
  constructor(cap = 60) {
    this.cap = cap;
    this.gaps = [];
    this.every = 1;         // draw on every this-many'th refresh
    this.target = 60;       // the frame rate the quality ladder should expect
    this.hz = 0;            // the display's rate, once known
    this._skipped = 0;
    this._last = 0;
    this._since = 0;
  }

  // Draw at most this many frames a second from here on (0: every refresh),
  // read off the gaps already seen when there are enough of them.
  setCap(cap) {
    this.cap = cap;
    this.look();
  }

  // One refresh of the display, at `now` (ms). Returns whether to draw on it.
  refresh(now, hidden = false) {
    const gap = now - this._last;
    this._last = now;
    if (!hidden && gap < 100) {
      this.gaps.push(gap);
      if (this.gaps.length > WINDOW) this.gaps.shift();
      if (++this._since >= EVERY) {
        this._since = 0;
        this.look();
      }
    }
    if (++this._skipped >= this.every) {
      this._skipped = 0;
      return true;
    }
    return false;
  }

  look() {
    if (this.gaps.length < 30) return;
    const sorted = this.gaps.slice().sort((a, b) => a - b);
    const hz = 1000 / Math.max(2, sorted[Math.floor(sorted.length * 0.25)]);
    const known = hz >= MIN_KNOWN;
    this.hz = known ? hz : 0;
    this.every = this.cap > 0 && known ? Math.max(1, Math.floor(hz / (this.cap * 0.9))) : 1;
    this.target = known ? Math.min(60, hz / this.every) : 60;
  }
}
