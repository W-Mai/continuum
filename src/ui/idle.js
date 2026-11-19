// The instrument and the buttons go quiet when nobody is touching anything.
// After half a minute with no input, while the autopilot drives and no menu is
// open, the page gets the class `idle` and the two panels (#hud, #bar) fall to
// a third of their strength (index.html, body.idle). The first input of any
// kind (a key, the mouse, a touch, a gamepad) takes the class off and the
// panels are back in 0.3 s (body.wake, kept while they come back).

export const IDLE_MS = 30000;   // without input before the panels go quiet
export const WAKE_MS = 400;     // how long `wake` stays on: a little over the 0.3 s the panels take to come back
export const POLL_MS = 250;     // how often the clock, the menus and the gamepads are looked at

// The events that are input. Moving a mouse is input; so is a finger or a key.
const INPUT = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart', 'gamepadconnected'];

// Whether a gamepad has a stick moved off centre or a button down.
function padActive() {
  let pads;
  try { pads = navigator.getGamepads ? navigator.getGamepads() : []; } catch { return false; }
  for (const p of pads || []) {
    if (!p) continue;
    if (p.axes.some((a) => Math.abs(a) > 0.2) || p.buttons.some((b) => b.pressed)) return true;
  }
  return false;
}

export class Idle {
  // game: has autoMode. menusOpen(): whether a menu or the settings stand open
  // (nothing goes quiet under a menu). body: where the classes go; target: who
  // hears the input; now(): milliseconds; pads(): whether a gamepad is in use.
  constructor(game, { menusOpen = () => false, body = document.body, target = window, now = () => performance.now(), pads = padActive } = {}) {
    this.game = game;
    this.menusOpen = menusOpen;
    this.body = body;
    this.now = now;
    this.pads = pads;
    this.last = null;       // when the last input was; until the loop first comes here, the page is still being made and has not been left alone
    this.idle = false;
    this.clock = 0;
    this.wakeTimer = 0;
    for (const type of INPUT) target.addEventListener(type, () => this.touch(), { passive: true });
    // Coming back to the tab is not the page left alone.
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => this.touch());
  }

  // Input: the clock starts over, and the panels come back if they were quiet.
  touch() {
    this.last = this.now();
    if (this.idle) this._set(false);
  }

  // Every frame, with the time it took (s).
  update(dt) {
    if (this.last === null) this.last = this.now();
    this.clock += dt;
    if (this.clock < POLL_MS / 1000) return;
    this.clock = 0;
    if (this.pads()) this.last = this.now();
    // A menu open, or the car in the visitor's hands: the half minute starts over.
    if (this.menusOpen() || !this.game.autoMode) this.last = this.now();
    const quiet = this.now() - this.last >= IDLE_MS;
    if (quiet !== this.idle) this._set(quiet);
  }

  _set(idle) {
    this.idle = idle;
    clearTimeout(this.wakeTimer);
    this.body.classList.toggle('idle', idle);
    if (idle) {
      this.body.classList.remove('wake');
    } else {
      this.body.classList.add('wake');
      this.wakeTimer = setTimeout(() => this.body.classList.remove('wake'), WAKE_MS);
    }
  }
}
