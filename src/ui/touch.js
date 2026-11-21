// The touch controls: a phone driven by hand. They are there while the car is
// in someone's hands (not on the autopilot, in the photo mode or with a menu
// open) and the last thing that gave input was a finger. Fingers go down on
// the canvas, and each one that lands on a place of the screen takes it:
//
//   wide    the left half is the wheel: a finger put down and dragged to
//           either side turns it, FULL px of drag for full lock, and lifted
//           it lets go; the lower part of the right half is two pedals, the
//           right one the throttle, the left one the brake, pressed harder
//           the higher the finger is
//   tall    the bottom third, all across, is the wheel; the two pedals are
//           above it, one at each edge of the screen (brake on the left,
//           throttle on the right), so that the car between them is not
//           under a thumb
//   anywhere  two fingers put down together and lifted at once, in the middle
//           of the screen, are a tap that changes the camera
//
// The places are drawn as faint outlines (#touch in index.html) that light up
// while a finger is on them; they are drawn where they are found, from the
// same rectangles (zonesFor). What the fingers give goes to the Driver
// (core/autopilot.js), which shapes it with the dead zone, the curve and the
// sensitivity of the settings.

export const FULL = 80;                 // px of drag that is full lock
export const PEDAL_MIN = 0.4;           // how hard the bottom edge of a pedal's place presses; the top edge presses 1
export const GAP = 6;                   // px that an outline stands inside its place
export const TAP = { within: 150, hold: 400, slop: 24, centre: 0.2 };   // ms between the two fingers, ms they are down, px they may move, the middle as a share of the width and the height each way

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const inside = (z, x, y) => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h;

// Where the places are on a screen of w by h (px): steer, brake, gas, each
// { x, y, w, h }, and whether the screen is the tall kind.
export function zonesFor(w, h) {
  if (h > w) {
    const base = h * 2 / 3;
    const top = h * 0.4;
    const side = w * 0.3;
    return {
      tall: true,
      steer: { x: 0, y: base, w, h: h - base },
      brake: { x: 0, y: top, w: side, h: base - top },
      gas: { x: w - side, y: top, w: side, h: base - top },
    };
  }
  const top = h * 0.58;
  return {
    tall: false,
    steer: { x: 0, y: 0, w: w / 2, h },
    brake: { x: w / 2, y: top, w: w / 4, h: h - top },
    gas: { x: w * 3 / 4, y: top, w: w / 4, h: h - top },
  };
}

// The wheel for a drag of dx px, -1..1.
export const steerOf = (dx) => clamp(dx / FULL, -1, 1);

// How hard a pedal is pressed by a finger at height y: PEDAL_MIN at the foot of
// its place, 1 at the head.
export const pedalOf = (y, zone) => PEDAL_MIN + (1 - PEDAL_MIN) * clamp((zone.y + zone.h - y) / zone.h, 0, 1);

// Whether a point is in the middle of a screen of w by h.
export const inCentre = (x, y, w, h) => Math.abs(x - w / 2) <= w * TAP.centre && Math.abs(y - h / 2) <= h * TAP.centre;

// Two fingers, down within TAP.within ms of each other, neither moving more
// than TAP.slop px, both up inside TAP.hold ms of the first going down, and
// never a third: a tap. Times are ms.
export class TapGesture {
  constructor() {
    this.reset();
  }

  reset() {
    this.fingers = new Map();
    this.began = 0;
    this.dead = false;
    this.most = 0;
    this.starts = [];
  }

  down(id, x, y, t) {
    if (!this.fingers.size) {
      this.reset();
      this.began = t;
    } else if (t - this.began > TAP.within) {
      this.dead = true;
    }
    this.fingers.set(id, { x0: x, y0: y });
    if (this.starts.length < 2) this.starts.push([x, y]);
    this.most = Math.max(this.most, this.fingers.size);
    if (this.most > 2) this.dead = true;
  }

  move(id, x, y) {
    const f = this.fingers.get(id);
    if (f && Math.hypot(x - f.x0, y - f.y0) > TAP.slop) this.dead = true;
  }

  // The finger is up at t. Returns whether that was the end of a tap, its
  // fingers' middle being where centred(x, y) says.
  up(id, t, centred) {
    if (!this.fingers.has(id)) return false;
    if (t - this.began > TAP.hold) this.dead = true;
    this.fingers.delete(id);
    if (this.fingers.size) return false;
    const [a, b] = this.starts;
    const tap = !this.dead && this.most === 2 && !!b && centred((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    this.reset();
    return tap;
  }

  cancel() {
    this.reset();
  }
}

const touching = (e) => e.pointerType === 'touch' || e.pointerType === 'pen';
const PLACES = ['steer', 'brake', 'gas'];

export class TouchControls {
  // canvas: where the fingers go down. root: #touch, with an element for each
  // place. driver: takes what the fingers give. active(): whether the car is
  // for the fingers now. onCamera(): a tap of two fingers. size(): the
  // screen's [w, h] in px.
  constructor({ canvas, root, driver, active = () => true, onCamera = () => {}, size = () => [innerWidth, innerHeight] }) {
    this.canvas = canvas;
    this.root = root;
    this.driver = driver;
    this.active = active;
    this.onCamera = onCamera;
    this.size = size;
    this.fingers = new Map();       // pointer id -> { place, x0, y0, x, y }
    this.tap = new TapGesture();
    this.taps = 0;                  // two-finger taps so far
    this.shown = false;
    this.els = Object.fromEntries(PLACES.map((p) => [p, root.querySelector('.' + p)]));
    this.zones = zonesFor(...size());
    this.layout();

    canvas.addEventListener('pointerdown', (e) => this._down(e));
    canvas.addEventListener('pointermove', (e) => this._move(e));
    canvas.addEventListener('pointerup', (e) => this._up(e, false));
    canvas.addEventListener('pointercancel', (e) => this._up(e, true));
    canvas.addEventListener('lostpointercapture', (e) => this._up(e, true));
    // A finger held on the throttle is a long press, which some browsers
    // answer with a menu.
    canvas.addEventListener('contextmenu', (e) => {
      if (this.fingers.size || touching(e)) e.preventDefault();
    });
    // A finger anywhere on the page, a button of the bar too, is the touch
    // screen being used.
    addEventListener('pointerdown', (e) => {
      if (touching(e)) this.driver.device = 'touch';
    }, true);
    addEventListener('resize', () => this.layout());
    addEventListener('blur', () => this.release());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.release();
    });
  }

  // The outlines go where the places are, and the rail of a drag is as long as the drag to full lock, both ways.
  layout() {
    this.zones = zonesFor(...this.size());
    this.root.style.setProperty('--full', `${FULL}px`);
    this.root.classList.toggle('tall', this.zones.tall);
    for (const p of PLACES) {
      const z = this.zones[p];
      const s = this.els[p].style;
      s.left = `${z.x + GAP}px`;
      s.top = `${z.y + GAP}px`;
      s.width = `${Math.max(0, z.w - 2 * GAP)}px`;
      s.height = `${Math.max(0, z.h - 2 * GAP)}px`;
    }
  }

  _place(x, y) {
    return PLACES.find((p) => inside(this.zones[p], x, y)) || null;
  }

  _down(e) {
    if (!touching(e)) return;
    this.driver.device = 'touch';
    if (!this.active()) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
    // A place has one finger: a second finger on it does nothing.
    const place = this._place(e.clientX, e.clientY);
    const taken = place && [...this.fingers.values()].some((f) => f.place === place);
    this.fingers.set(e.pointerId, { place: taken ? null : place, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY });
    this.tap.down(e.pointerId, e.clientX, e.clientY, e.timeStamp);
    this._give();
  }

  _move(e) {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    if (!this.active()) {
      this.release();
      return;
    }
    f.x = e.clientX;
    f.y = e.clientY;
    this.tap.move(e.pointerId, f.x, f.y);
    this._give();
  }

  _up(e, cancelled) {
    if (!this.fingers.delete(e.pointerId)) return;
    if (cancelled) {
      this.tap.cancel();
    } else if (this.tap.up(e.pointerId, e.timeStamp, (x, y) => inCentre(x, y, ...this.size()))) {
      this.taps++;
      this.onCamera();
    }
    this._give();
  }

  // What the fingers give, to the driver, and the outlines lit by them.
  _give() {
    const t = this.driver.touch;
    t.steering = false;
    t.steer = 0;
    t.throttle = 0;
    t.brake = 0;
    const z = this.zones;
    const held = {};
    for (const f of this.fingers.values()) {
      if (!f.place) continue;
      held[f.place] = f;
      if (f.place === 'steer') {
        t.steering = true;
        t.steer = steerOf(f.x - f.x0);
      } else if (f.place === 'gas') {
        t.throttle = pedalOf(f.y, z.gas);
      } else {
        t.brake = pedalOf(f.y, z.brake);
      }
    }
    for (const p of PLACES) {
      const el = this.els[p];
      const f = held[p];
      el.classList.toggle('on', !!f);
      if (!f) continue;
      if (p === 'steer') {
        // The drag's rail: its middle where the finger went down, the dot as far along as it has been dragged.
        el.style.setProperty('--x0', `${f.x0 - z.steer.x - GAP}px`);
        el.style.setProperty('--y0', `${f.y0 - z.steer.y - GAP}px`);
        el.style.setProperty('--dx', `${clamp(f.x - f.x0, -FULL, FULL)}px`);
      } else {
        el.style.setProperty('--p', String((pedalOf(f.y, z[p]) - PEDAL_MIN) / (1 - PEDAL_MIN)));
      }
    }
  }

  // Every finger let go of.
  release() {
    const t = this.driver.touch;
    if (!this.fingers.size && !t.steering && !t.throttle && !t.brake) return;
    this.fingers.clear();
    this.tap.cancel();
    this._give();
  }

  // Every frame, and whenever the car changes hands: the places are shown when
  // the car is for the fingers and a finger is what was last used, and a car
  // that is not is let go of.
  refresh() {
    const ready = this.active();
    const show = ready && this.driver.device === 'touch';
    if (!ready) this.release();
    if (show === this.shown) return;
    this.shown = show;
    this.root.hidden = !show;
    document.body.classList.toggle('touch', show);
  }
}
