// The hands: a touch screen to drive with, a gamepad that rumbles, and the
// feel of the wheel.
//
// In node, without a browser:
//  - the wheel's feel: a stick or a finger inside the dead zone steers exactly
//    nothing, past it the curve (linear, or the push to the 1.6th power) and the
//    sensitivity (0.6 to 1.4, never past full lock); the keys are as they have
//    always been (-1, 0, 1 at once) unless an ease is asked for, which takes
//    them to full lock and back in the seconds it says; the settings' defaults
//    are the driver's;
//  - the places of the touch screen, for a dozen sizes of screen, wide and
//    tall: all on the screen, the wheel the left half (wide) or the bottom third
//    (tall), the pedals on the right (wide) or at the two edges above the wheel
//    (tall, with the middle left free for the car and the tap), the brake left
//    of the throttle, none over another, each as big as a finger needs; 80 px of
//    drag is full lock; a pedal presses harder the higher the finger is;
//  - the tap of two fingers: down together, up together, still, in the middle,
//    and nothing else (a late second finger, a long hold, a drag, a third
//    finger, the edge of the screen);
//  - the rumble: each of the five events (the weak and the strong motor, how
//    long), the sustained ones renewed every 100 ms, a
//    landing or a hit not cut short by them, nothing when the setting is off,
//    on the autopilot, with the keys in hand or with no motors, and what a phone
//    gets (40 ms for a landing, 80 ms for a hit, nothing else);
//  - the settings of the feel and the rumble: defaults, what is kept, the
//    address bar, a headless run, and what "reduce motion" does to the rumble.
//
// In the real page, in Chrome, with the touches, the mouse and the keys sent
// over the DevTools protocol, and a gamepad made in the page (navigator
// .getGamepads is replaced; its vibrationActuator writes down each playEffect;
// navigator.vibrate writes down each buzz):
//  - on a phone (390 x 844, touch, then turned to 844 x 390): while the
//    autopilot drives the places are not there (hidden) and a finger on the
//    canvas does nothing; a tap on the autopilot button with a finger gives the
//    car over, and the three places come up where they were worked out to be,
//    with their words, in both languages, on the screen, the bar and the menus
//    out of the way of the thumbs;
//  - a finger put down on the left and dragged 40 px right gives
//    Driver.read().steer of 0.5 to the power of 1.6 (0.33), and 0.5 on the
//    linear curve; let go, it is 0; a finger on the throttle gives more than
//    0.5, the harder the higher, and let go the pedal is 0 in the same event
//    (the limit is 0.2 s); the brake the same; the wheel and a pedal at once;
//  - a car driven so, by the page's own loop, speeds up and turns the way it
//    was told;
//  - two fingers tapped in the middle change the camera, in the hands of the
//    driver only; a drag or a third finger do not;
//  - the instrument lets a finger through to the canvas (and not while the
//    autopilot drives); an open menu takes the finger and the car is let go; in
//    the photo mode the places go and a finger turns the lens;
//  - the quiet instrument comes back at a touch;
//  - the right button of the mouse still looks round the car, with the places
//    up and the touch screen about;
//  - the gamepad: the dead zone, a landing of 4 m/s is one playEffect with the
//    strong motor at 0.5, a hit, an animal, the road left behind and a hard
//    brake are rumbles of their own, none of it on the autopilot, with the
//    keys in hand, or with the setting off; a phone buzzes 40 ms for a landing
//    and 80 for a hit; with the system asking for less motion nothing rumbles
//    or buzzes (and the setting can be turned on against it);
//  - the settings panel has the rumble, the dead zone, the curve, the
//    sensitivity and the keys, each takes hold and is kept, the address bar
//    locks them, 390 x 844 holds all of it with everything to touch 40 x 40 or
//    more, in both languages with no Chinese in the English.
//
// Usage: node tools/input_check.mjs [--node] [--only=phone,gamepad,motion,panel]
//   --node  only what needs no browser
//   --only  of the pages, only these (the phone, the gamepad, the system asking for less motion, the settings panel)
// PORT=8206 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Driver, FEEL, CURVES, EASES, EASE_DEFAULT } from '../src/core/autopilot.js';
import { Haptics, RUMBLE, BUZZ } from '../src/core/haptics.js';
import { zonesFor, steerOf, pedalOf, inCentre, TapGesture, FULL, PEDAL_MIN, TAP, GAP } from '../src/ui/touch.js';
import { Settings, KEYS, DEADZONE, SENS } from '../src/ui/settings.js';
import { TABLES } from '../src/ui/strings.js';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
// Headless WebGL fails on Linux while DISPLAY is set.
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8205;
const ROOT = new URL('..', import.meta.url).pathname;
const OUT = (process.env.OUT || ROOT + 'out/input').replace(/\/?$/, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CJK = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/;

let failed = 0;
const say = (ok, text) => {
  if (!ok) failed++;
  console.error(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
};
const results = {};
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const f3 = (n) => (Math.round(n * 1000) / 1000).toString();

// --- in node ------------------------------------------------------------------

// A page's window, as far as a Driver listens to one.
function windowStub() {
  const on = {};
  return { on, addEventListener: (type, fn) => { on[type] = fn; } };
}

// navigator, as far as the Driver and the rumble read it: the pads it has now
// and whether it can buzz.
function withNavigator(nav, fn) {
  const was = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
  try { return fn(); } finally {
    if (was) Object.defineProperty(globalThis, 'navigator', was); else delete globalThis.navigator;
  }
}

const padOf = (stick, rt = 0, lt = 0) => ({
  connected: true, axes: [stick, 0, 0, 0],
  buttons: Array.from({ length: 17 }, (_, i) => ({ value: i === 7 ? rt : i === 6 ? lt : 0, pressed: false })),
});

function feel() {
  // What the keys gave before there was any feel to set, for every set of keys held.
  const KEYSET = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];
  let same = 0;
  let total = 0;
  for (let mask = 0; mask < 256; mask++) {
    const win = windowStub();
    const d = new Driver(win);
    const held = KEYSET.filter((_, i) => mask & (1 << i));
    for (const code of held) win.on.keydown({ code, preventDefault() {} });
    const has = (a, b) => held.includes(a) || held.includes(b);
    const want = { steer: (has('KeyA', 'ArrowLeft') ? -1 : 0) + (has('KeyD', 'ArrowRight') ? 1 : 0), throttle: has('KeyW', 'ArrowUp') ? 1 : 0, brake: has('KeyS', 'ArrowDown') ? 1 : 0 };
    const got = withNavigator({}, () => d.read(1 / 120));
    total++;
    if (got.steer === want.steer && got.throttle === want.throttle && got.brake === want.brake && !Object.is(got.steer, -0)) same++;
  }
  say(same === total && EASE_DEFAULT === 'instant' && EASES.instant.join() === '0,0',
    `with no ease asked for the keys give -1, 0, 1, throttle and brake at once for each of the ${total} sets of keys held, as they always did (the ease is "${EASE_DEFAULT}")`);

  const d = new Driver(windowStub());
  say(d.feel.deadzone === FEEL.deadzone && FEEL.deadzone === 0.08 && FEEL.curve === 'soft' && CURVES.soft === 1.6 && CURVES.linear === 1 && d.feel.exponent === 1.6 && d.feel.sens === 1,
    `the wheel's feel to begin with: dead zone ${FEEL.deadzone}, the curve "${FEEL.curve}" (the push to the power ${CURVES.soft}), sensitivity ${FEEL.sens}`);

  // A stick as the page reads it from a gamepad.
  const stick = (x, set = {}) => {
    const dr = new Driver(windowStub());
    dr.setFeel(set);
    return withNavigator({ getGamepads: () => [padOf(x)] }, () => dr.read(1 / 120));
  };
  const inside = [0, 0.03, -0.05, 0.08, -0.08].map((x) => stick(x).steer);
  say(inside.every((v) => Object.is(v, 0)), `a stick inside the dead zone steers exactly 0 (at 0, 0.03, -0.05 and the edge itself, 0.08: ${inside.map((v) => Object.is(v, 0) ? '0' : Object.is(v, -0) ? '-0' : v)})`);
  const soft = [0.081, 0.25, 0.5, 0.75, 1].map((x) => stick(x).steer);
  say(soft.every((v, i) => near(v, [0.081, 0.25, 0.5, 0.75, 1][i] ** 1.6, 1e-12)) && near(soft[2], 0.5 ** 1.6, 1e-12) && stick(-0.5).steer === -stick(0.5).steer,
    `on the default curve a stick at half is ${f3(soft[2])} (0.5 to the 1.6th), at a quarter ${f3(soft[1])}, full is 1, and left is right turned round`);
  const lin = [0.3, 0.5, 1].map((x) => stick(x, { curve: 'linear' }).steer);
  say(lin.join() === '0.3,0.5,1', `on the linear curve the push is the steering (${lin})`);
  const sens = [stick(0.5, { curve: 'linear', sens: 1.4 }).steer, stick(0.5, { curve: 'linear', sens: 0.6 }).steer, stick(0.9, { curve: 'linear', sens: 1.4 }).steer, stick(0.9, { sens: 99 }).steer];
  say(near(sens[0], 0.7, 1e-12) && near(sens[1], 0.3, 1e-12) && sens[2] === 1 && sens[3] <= 1 * 2 && stick(1, { sens: 99 }).steer <= 1,
    `the sensitivity multiplies the steering (0.5 pushed, 1.4: ${f3(sens[0])}, 0.6: ${f3(sens[1])}) and never takes it past full lock (0.9 at 1.4: ${sens[2]})`);
  const dz = [stick(0.2, { deadzone: 0.25 }).steer, stick(0.3, { deadzone: 0.25 }).steer, stick(0.05, { deadzone: 0 }).steer, stick(0.2, { deadzone: -3 }).steer];
  say(dz[0] === 0 && dz[1] > 0 && dz[2] > 0 && dz[3] > 0, `the dead zone is what the settings say (0.2 inside 0.25 is ${dz[0]}, 0.3 is ${f3(dz[1])}; none: 0.05 steers ${f3(dz[2])})`);
  const mixed = withNavigator({ getGamepads: () => [padOf(0.04)] }, () => {
    const win = windowStub();
    const dr = new Driver(win);
    win.on.keydown({ code: 'KeyD', preventDefault() {} });
    return dr.read(1 / 120).steer;
  });
  say(mixed === 1, 'a stick inside the dead zone leaves the wheel to the keys');

  // The ease of the keys.
  const eased = (name, down, up) => {
    const win = windowStub();
    const dr = new Driver(win);
    dr.setEase(name);
    const dt = 1 / 120;
    win.on.keydown({ code: 'KeyD', preventDefault() {} });
    let rose = null;
    let v = 0;
    for (let i = 1; i <= 240 && rose === null; i++) {
      v = dr.read(dt).steer;
      if (v >= 1) rose = i * dt;
    }
    const half = (() => {
      const w2 = windowStub();
      const d2 = new Driver(w2);
      d2.setEase(name);
      w2.on.keydown({ code: 'KeyD', preventDefault() {} });
      let x = 0;
      for (let i = 0; i < Math.round(down / 2 / dt); i++) x = d2.read(dt).steer;
      return x;
    })();
    win.on.keyup({ code: 'KeyD' });
    let fell = null;
    for (let i = 1; i <= 240 && fell === null; i++) {
      v = dr.read(dt).steer;
      if (v <= 0) fell = i * dt;
    }
    const left = (() => {
      const w3 = windowStub();
      const d3 = new Driver(w3);
      d3.setEase(name);
      w3.on.keydown({ code: 'KeyA', preventDefault() {} });
      let x = 0;
      for (let i = 0; i < 240; i++) x = d3.read(dt).steer;
      return x;
    })();
    return { rose, fell, half, left, ok: near(rose, down, 2 * dt) && near(fell, up, 2 * dt) && near(half, 0.5, 0.02) && left === -1 };
  };
  const soft1 = eased('soft', 0.18, 0.12);
  const softer = eased('softer', 0.35, 0.25);
  say(soft1.ok && softer.ok,
    `"soft" takes the keys to full lock in ${f3(soft1.rose)} s (0.18) and back in ${f3(soft1.fell)} s (0.12), "softer" in ${f3(softer.rose)} s (0.35) and ${f3(softer.fell)} s (0.25), half way at half the time (${f3(soft1.half)}), left the same way`);
  const turn = (() => {
    const win = windowStub();
    const dr = new Driver(win);
    dr.setEase('soft');
    win.on.keydown({ code: 'KeyA', preventDefault() {} });
    for (let i = 0; i < 60; i++) dr.read(1 / 120);
    win.on.keyup({ code: 'KeyA' });
    win.on.keydown({ code: 'KeyD', preventDefault() {} });
    const through = [];
    for (let i = 0; i < 80; i++) through.push(dr.read(1 / 120).steer);
    return { start: through[0], zeroAt: through.findIndex((v) => v >= 0) + 1, end: through[79] };
  })();
  say(turn.start < -0.9 && turn.zeroAt > 15 && turn.zeroAt < 25 && turn.end === 1, `from full left to right the wheel goes through the middle at the pace of the rise (${turn.zeroAt} steps of 1/120 s to the middle), and ends at 1`);
  const noDt = (() => {
    const win = windowStub();
    const dr = new Driver(win);
    dr.setEase('softer');
    win.on.keydown({ code: 'KeyD', preventDefault() {} });
    return dr.read().steer;
  })();
  say(noDt === 1, 'read() with no time given (a check that drives it by hand) gives the keys at once, ease or no');
  const bad = new Driver(windowStub());
  bad.setFeel({ deadzone: NaN, curve: 'wavy', sens: 'a' });
  bad.setEase('bogus');
  say(bad.feel.deadzone === 0.08 && bad.feel.exponent === 1.6 && bad.feel.sens === 1 && bad.ease === EASES.instant, 'a value that is not one is left as it was');
  // The gamepad's own deadzone as it was: 0.12, linear.
  results.feel = { soft: soft1, softer, soft_half: soft[2] };
}

function places() {
  const sizes = [[390, 844], [844, 390], [667, 375], [375, 667], [1180, 820], [820, 1180], [1920, 1080], [320, 568], [568, 320], [1024, 1366], [360, 740], [915, 412]];
  const bad = [];
  const rows = [];
  for (const [w, h] of sizes) {
    const z = zonesFor(w, h);
    const names = ['steer', 'brake', 'gas'];
    const inScreen = names.every((n) => z[n].x >= 0 && z[n].y >= 0 && z[n].x + z[n].w <= w + 1e-9 && z[n].y + z[n].h <= h + 1e-9);
    const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const apart = !overlap(z.steer, z.brake) && !overlap(z.steer, z.gas) && !overlap(z.brake, z.gas);
    const big = names.every((n) => z[n].w - 2 * GAP >= 40 && z[n].h - 2 * GAP >= 40);
    const brakeLeft = z.brake.x + z.brake.w <= z.gas.x + 1e-9;
    let shape;
    if (h > w) {
      shape = z.tall && z.steer.x === 0 && z.steer.w === w && near(z.steer.y, h * 2 / 3, 1e-9) && near(z.steer.y + z.steer.h, h, 1e-9)
        && z.brake.y + z.brake.h <= z.steer.y + 1e-9 && z.gas.y + z.gas.h <= z.steer.y + 1e-9
        && z.brake.x === 0 && near(z.gas.x + z.gas.w, w, 1e-9) && near(z.brake.w, w * 0.3, 1e-9) && near(z.gas.w, w * 0.3, 1e-9)
        && z.gas.x - (z.brake.x + z.brake.w) >= 0.39 * w;
    } else {
      shape = !z.tall && z.steer.x === 0 && z.steer.y === 0 && near(z.steer.w, w / 2, 1e-9) && z.steer.h === h
        && z.brake.x >= w / 2 - 1e-9 && z.gas.x + z.gas.w <= w + 1e-9 && near(z.gas.y + z.gas.h, h, 1e-9) && near(z.brake.y + z.brake.h, h, 1e-9);
    }
    // The middle of the screen is for the tap, and for the car: none of the places is there, wide or tall.
    const middle = !names.some((n) => z[n].x <= w / 2 && w / 2 < z[n].x + z[n].w && z[n].y <= h / 2 && h / 2 < z[n].y + z[n].h);
    rows.push({ screen: `${w}x${h}`, wheel: `${Math.round(z.steer.w)}x${Math.round(z.steer.h)}`, pedal: `${Math.round(z.gas.w)}x${Math.round(z.gas.h)}` });
    if (!(inScreen && apart && big && brakeLeft && shape && middle)) bad.push(`${w}x${h}: ${JSON.stringify({ inScreen, apart, big, brakeLeft, shape, middle })}`);
  }
  say(!bad.length, `the three places, for ${sizes.length} sizes of screen (wide and tall, a phone to a tablet): on the screen, the wheel the left half (wide) or the bottom third across (tall), the pedals right (wide) or at the two edges over the wheel (tall), brake left of throttle, none over another or at the middle of the screen, each 40 x 40 or more inside its outline${bad.length ? ' (' + bad.join('; ') + ')' : ''}`);
  results.places = rows;

  const wide = zonesFor(844, 390);
  const tall = zonesFor(390, 844);
  say(wide.steer.w === 422 && wide.gas.x === 633 && near(wide.gas.y, 390 * 0.58, 1e-9) && tall.steer.h > 281 && tall.steer.h < 282 && near(tall.gas.x, 273, 1e-9) && near(tall.gas.w, 117, 1e-9) && near(tall.gas.y, 844 * 0.4, 1e-9),
    `a phone: wide the wheel is 422 x 390, the throttle starts at x ${wide.gas.x} and y ${Math.round(wide.gas.y)}; tall the wheel is the bottom ${Math.round(tall.steer.h)} px of 844 and each pedal is ${Math.round(tall.gas.w)} px wide at its own edge, from y ${Math.round(tall.gas.y)}`);

  const drag = [steerOf(0), steerOf(40), steerOf(FULL), steerOf(200), steerOf(-40), steerOf(-1e9)];
  say(FULL === 80 && drag.join() === '0,0.5,1,1,-0.5,-1', `a drag of 80 px is full lock, 40 px is half, past it stays full, either way (${drag})`);
  const zone = zonesFor(844, 390).gas;
  const press = [pedalOf(zone.y + zone.h, zone), pedalOf(zone.y + zone.h / 2, zone), pedalOf(zone.y, zone), pedalOf(zone.y - 500, zone), pedalOf(zone.y + zone.h + 500, zone)];
  const mono = [0, 0.25, 0.5, 0.75, 1].map((t) => pedalOf(zone.y + zone.h * (1 - t), zone));
  say(PEDAL_MIN === 0.4 && press[0] === 0.4 && near(press[1], 0.7, 1e-12) && press[2] === 1 && press[3] === 1 && press[4] === 0.4 && mono.every((v, i) => i === 0 || v > mono[i - 1]),
    `a pedal presses ${press[0]} at its foot, ${f3(press[1])} half way up and ${press[2]} at its head, harder the higher the finger is (${mono.map(f3)}), and a finger past either end presses as at the end`);

  // The two-finger tap.
  const w = 844;
  const h = 390;
  const centred = (x, y) => inCentre(x, y, w, h);
  const tap = (steps) => {
    const g = new TapGesture();
    let out = false;
    for (const s of steps) {
      if (s[0] === 'd') g.down(s[1], s[2], s[3], s[4]);
      else if (s[0] === 'm') g.move(s[1], s[2], s[3]);
      else out = g.up(s[1], s[2], centred) || out;
    }
    return out;
  };
  const mid = [w / 2 - 30, h / 2];
  const mid2 = [w / 2 + 30, h / 2];
  const base = [['d', 1, ...mid, 1000], ['d', 2, ...mid2, 1050], ['u', 1, 1200], ['u', 2, 1210]];
  const cases = [
    ['two fingers down 50 ms apart, up in 200 ms, still, in the middle', base, true],
    ['the same, the second finger lifted first', [base[0], base[1], ['u', 2, 1200], ['u', 1, 1230]], true],
    ['a second finger 200 ms late', [['d', 1, ...mid, 1000], ['d', 2, ...mid2, 1200], ['u', 1, 1300], ['u', 2, 1310]], false],
    ['held half a second', [['d', 1, ...mid, 1000], ['d', 2, ...mid2, 1050], ['u', 1, 1500], ['u', 2, 1510]], false],
    ['dragged 30 px', [base[0], base[1], ['m', 1, mid[0] + 30, mid[1]], base[2], base[3]], false],
    ['moved 20 px, under the slop', [base[0], base[1], ['m', 1, mid[0] + 20, mid[1]], base[2], base[3]], true],
    ['one finger', [['d', 1, ...mid, 1000], ['u', 1, 1100]], false],
    ['three fingers', [['d', 1, ...mid, 1000], ['d', 2, ...mid2, 1020], ['d', 3, w / 2, h / 2 + 20, 1040], ['u', 1, 1100], ['u', 2, 1110], ['u', 3, 1120]], false],
    ['at the edge of the screen', [['d', 1, 20, 20, 1000], ['d', 2, 60, 20, 1050], ['u', 1, 1200], ['u', 2, 1210]], false],
    ['in the lower corner, on the pedals', [['d', 1, w - 90, h - 60, 1000], ['d', 2, w - 40, h - 60, 1050], ['u', 1, 1200], ['u', 2, 1210]], false],
  ];
  const wrong = cases.filter(([, steps, want]) => tap(steps) !== want).map(([name]) => name);
  say(!wrong.length, `a tap of two fingers is two fingers down within ${TAP.within} ms of each other, up inside ${TAP.hold} ms, moved less than ${TAP.slop} px, in the middle: ${cases.length} cases${wrong.length ? ' (wrong: ' + wrong.join('; ') + ')' : ''}`);
  const g = new TapGesture();
  g.down(1, ...mid, 0);
  g.down(2, ...mid2, 900);
  g.up(1, 1000, centred);
  g.up(2, 1010, centred);
  const after = [['d', 1, ...mid, 5000], ['d', 2, ...mid2, 5050], ['u', 1, 5200], ['u', 2, 5210]];
  const g2 = g;
  let ok = false;
  for (const s of after) {
    if (s[0] === 'd') g2.down(s[1], s[2], s[3], s[4]); else ok = g2.up(s[1], s[2], centred) || ok;
  }
  say(ok, 'a tap that failed leaves nothing behind: the next one is a tap');
  const box = [inCentre(w / 2, h / 2, w, h), inCentre(w * 0.7, h * 0.7, w, h), inCentre(w * 0.8, h / 2, w, h), inCentre(w / 2, h * 0.9, w, h)];
  say(TAP.centre === 0.2 && box.join() === 'true,true,false,false', `the middle is the fifth of the width and of the height either side of the centre of the screen (${box})`);
}

// A gamepad's motors, writing down what it is asked.
function motors() {
  const log = [];
  const resets = [];
  const actuator = {
    playEffect: (type, params) => { log.push({ type, ...params }); return Promise.resolve('complete'); },
    reset: () => { resets.push(1); return Promise.resolve('complete'); },
  };
  const buzzes = [];
  let device = 'pad';
  let has = actuator;
  const make = () => {
    const h = new Haptics({ actuator: () => has, device: () => device, buzz: (ms) => buzzes.push(ms) });
    h.driving = true;
    return h;
  };
  const reset = () => { log.length = 0; resets.length = 0; buzzes.length = 0; device = 'pad'; has = actuator; };
  const last = () => log[log.length - 1];

  withNavigator({ vibrate: () => true }, () => {
    let h = make();
    h.land(4);
    say(log.length === 1 && last().type === 'dual-rumble' && last().weakMagnitude === 0.3 && near(last().strongMagnitude, 0.5, 1e-12) && last().duration === 180 && last().startDelay === 0,
      `a landing of 4 m/s is one dual-rumble of weak ${last().weakMagnitude}, strong ${last().strongMagnitude} (4 / 8), ${last().duration} ms`);
    reset();
    h = make();
    h.land(16);
    h.land(1);
    say(log.length === 2 && log[0].strongMagnitude === 1 && near(log[1].strongMagnitude, 0.125, 1e-12), `a harder fall rumbles the strong motor harder and no more than 1 (16 m/s: ${log[0].strongMagnitude}, 1 m/s: ${f3(log[1].strongMagnitude)})`);
    reset();
    h = make();
    h.hit(6);
    h.hit(40);
    say(log.length === 2 && log[0].weakMagnitude === 0.6 && near(log[0].strongMagnitude, 0.5, 1e-12) && log[0].duration === 250 && log[1].strongMagnitude === 1,
      `a hit at 6 m/s is weak ${log[0].weakMagnitude}, strong ${log[0].strongMagnitude} (6 / 12), ${log[0].duration} ms; at 40 the strong motor is full`);
    reset();
    h = make();
    h.animal();
    say(log.length === 1 && last().weakMagnitude === 0.4 && last().strongMagnitude === 0.5 && last().duration === 120, `an animal struck is weak ${last().weakMagnitude}, strong ${last().strongMagnitude}, ${last().duration} ms`);

    // What goes on: off the road, sliding, and both.
    reset();
    h = make();
    for (let i = 0; i < 60; i++) h.update(1 / 60, { off: true, speed: 15 });
    say(log.length >= 9 && log.length <= 11 && log.every((c) => near(c.weakMagnitude, 0.25, 1e-12) && c.strongMagnitude === 0 && c.duration === RUMBLE.last),
      `off the road at 15 m/s, a second of frames is ${log.length} rumbles (one every 100 ms), each weak ${f3(log[0].weakMagnitude)} (0.15 + 0.2 x 15 / 30), strong 0, ${RUMBLE.last} ms, so that they run into one another`);
    reset();
    h = make();
    for (let i = 0; i < 60; i++) h.update(1 / 60, { off: true, speed: 30 });
    const fast = log[0].weakMagnitude;
    reset();
    h = make();
    for (let i = 0; i < 60; i++) h.update(1 / 60, { off: true, speed: 0.5 });
    say(near(fast, 0.35, 1e-12) && log.length === 0, `the faster off the road the stronger (30 m/s: ${f3(fast)}), and a car that is hardly moving has nothing under it to rumble (0.5 m/s: ${log.length})`);
    reset();
    h = make();
    for (let i = 0; i < 60; i++) h.update(1 / 60, { slip: 0.5, speed: 15 });
    say(log.length >= 9 && log.length <= 11 && log.every((c) => c.weakMagnitude === 0.25 && c.strongMagnitude === 0), `tyres sliding is weak 0.25, strong 0, every 100 ms (${log.length} in a second)`);
    reset();
    h = make();
    for (let i = 0; i < 60; i++) h.update(1 / 60, { slip: 0.5, off: true, speed: 30 });
    say(log.every((c) => near(c.weakMagnitude, 0.35, 1e-12)), 'off the road and sliding both, the stronger of the two is felt (not the sum)');
    reset();
    h = make();
    for (let i = 0; i < 30; i++) h.update(1 / 60, { slip: 0.05, off: false, speed: 15 });
    for (let i = 0; i < 30; i++) h.update(1 / 60, { slip: 0.9, off: true, air: true, speed: 15 });
    say(log.length === 0, 'a slide too small to leave a mark, and a car in the air, rumble nothing');

    // A landing or a hit is not cut short by what goes on.
    reset();
    h = make();
    h.update(1 / 60, { off: true, speed: 15 });
    const before = log.length;
    h.hit(10);
    const times = [];
    for (let i = 0; i < 40; i++) {
      const n = log.length;
      h.update(1 / 60, { off: true, speed: 15 });
      if (log.length > n) times.push(i);
    }
    say(before === 1 && log[1].duration === 250 && times[0] >= 14 && times[0] <= 16,
      `what goes on does not cut a hit short: the next renewal comes ${times[0]} frames (about ${f3(times[0] / 60)} s) after it, 250 ms later (a frame 1/60 s)`);

    // Nothing, when nothing is to be felt.
    reset();
    h = make();
    h.on = false;
    h.land(8);
    h.hit(8);
    h.animal();
    for (let i = 0; i < 30; i++) h.update(1 / 60, { off: true, speed: 20, slip: 1 });
    const off = log.length;
    reset();
    h = make();
    h.driving = false;
    h.land(8);
    h.hit(8);
    h.animal();
    for (let i = 0; i < 30; i++) h.update(1 / 60, { off: true, speed: 20, slip: 1 });
    const auto = log.length;
    reset();
    h = make();
    device = 'key';
    h.land(8);
    h.hit(8);
    h.animal();
    for (let i = 0; i < 30; i++) h.update(1 / 60, { off: true, speed: 20, slip: 1 });
    const keys = log.length + buzzes.length;
    reset();
    h = make();
    has = null;
    h.land(8);
    h.hit(8);
    for (let i = 0; i < 30; i++) h.update(1 / 60, { off: true, speed: 20, slip: 1 });
    const none = log.length;
    say(off === 0 && auto === 0 && keys === 0 && none === 0, `no rumble with the setting off (${off}), on the autopilot (${auto}), with the keys in hand (${keys}), or with no motors in the gamepad (${none})`);

    // Let go of.
    reset();
    h = make();
    for (let i = 0; i < 12; i++) h.update(1 / 60, { off: true, speed: 15 });
    h.stop();
    h.stop();
    say(resets.length === 1, `the motors are let go of once when the car is given back to the autopilot or the setting is turned off (${resets.length} reset for two stops)`);
    reset();
    h = make();
    for (let i = 0; i < 12; i++) h.update(1 / 60, { off: true, speed: 15 });
    h.driving = false;
    h.update(1 / 60, {});
    say(resets.length === 1, 'and when the car goes to the autopilot, on its own');

    // A phone.
    reset();
    device = 'touch';
    h = make();
    h.land(4);
    h.hit(9);
    h.animal();
    for (let i = 0; i < 30; i++) h.update(1 / 60, { off: true, speed: 20, slip: 1 });
    say(buzzes.join() === `${BUZZ.land},${BUZZ.hit}` && BUZZ.land === 40 && BUZZ.hit === 80 && log.length === 0,
      `a phone buzzes ${BUZZ.land} ms for a landing and ${BUZZ.hit} ms for a hit and for nothing else (an animal, the road left behind and a slide are nothing to it): ${buzzes}`);
    reset();
    device = 'touch';
    h = make();
    h.on = false;
    h.land(4);
    h.driving = false;
    h.hit(9);
    say(buzzes.length === 0, 'the setting off, or the autopilot, and a phone does not buzz');
  });
  withNavigator({}, () => {
    reset();
    device = 'touch';
    const h = make();
    h.land(4);
    say(buzzes.length === 0 && log.length === 0, 'a phone that cannot vibrate does not');
  });
}

function setting() {
  const mem = (init = {}) => {
    const m = new Map(Object.entries(init));
    return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
  };
  const make = (query = '', o = {}) => new Settings({ params: new URLSearchParams(query), languages: ['en-US'], ...o });
  const s = make('', { storage: mem() });
  say(s.get('haptics') === true && s.get('deadzone') === FEEL.deadzone && s.get('curve') === FEEL.curve && s.get('sens') === FEEL.sens && s.get('keys') === EASE_DEFAULT
    && ['haptics', 'deadzone', 'curve', 'sens', 'keys'].every((k) => !s.locked(k)),
  `the settings start at the driver's own: rumble on, dead zone ${s.get('deadzone')}, curve ${s.get('curve')}, sensitivity ${s.get('sens')}, keys ${s.get('keys')}`);
  say(make('', { reduceMotion: true }).get('haptics') === false && make('', { reduceMotion: true, storage: mem({ [KEYS.haptics]: '1' }) }).get('haptics') === true
    && make('', { reduceMotion: true, run: true }).get('haptics') === true && make('', { reduceMotion: true }).get('motion') === false,
  'the system asking for less motion turns the rumble off, as it does the lens\'s shake; what was chosen is over it');
  const stored = mem({ [KEYS.haptics]: '0', [KEYS.deadzone]: '0.15', [KEYS.curve]: 'linear', [KEYS.sens]: '1.25', [KEYS.keys]: 'softer' });
  const c = make('', { storage: stored });
  say(c.get('haptics') === false && c.get('deadzone') === 0.15 && c.get('curve') === 'linear' && c.get('sens') === 1.25 && c.get('keys') === 'softer', 'what was chosen is read back');
  const wild = make('', { storage: mem({ [KEYS.deadzone]: '9', [KEYS.sens]: '-3', [KEYS.curve]: 'wavy', [KEYS.keys]: '', [KEYS.haptics]: 'yes' }) });
  say(wild.get('deadzone') === DEADZONE[1] && wild.get('sens') === SENS[0] && wild.get('curve') === FEEL.curve && wild.get('keys') === EASE_DEFAULT && wild.get('haptics') === true,
    `a dead zone and a sensitivity out of their range are held to it (0 to ${DEADZONE[1]}, ${SENS[0]} to ${SENS[1]}), and a name that is none is no value`);
  const bare = make('', { storage: mem({ [KEYS.deadzone]: '', [KEYS.sens]: 'a' }) });
  say(bare.get('deadzone') === FEEL.deadzone && bare.get('sens') === FEEL.sens, 'an empty or a non-number in the store is no value');
  const u = make('haptics=0&deadzone=0.2&curve=LINEAR&sens=1.2&keys=soft', { storage: stored });
  say(u.get('haptics') === false && u.get('deadzone') === 0.2 && u.get('curve') === 'linear' && u.get('sens') === 1.2 && u.get('keys') === 'soft'
    && ['haptics', 'deadzone', 'curve', 'sens', 'keys'].every((k) => u.locked(k)) && u.set('deadzone', 0.1) === false && u.set('curve', 'soft') === false,
  'the address bar (haptics=, deadzone=, curve=, sens=, keys=) is over what was chosen, and locks them');
  const nope = make('haptics=maybe&deadzone=&curve=wavy&sens=lots&keys=');
  say(['haptics', 'deadzone', 'curve', 'sens', 'keys'].every((k) => !nope.locked(k)) && nope.get('deadzone') === FEEL.deadzone, 'an address that names none of them locks none of them');
  const k = make('', { storage: mem() });
  const told = [];
  k.onChange((key, v) => told.push([key, v]));
  const changed = [k.set('haptics', false), k.set('haptics', false), k.set('deadzone', 0.12), k.set('deadzone', 'a'), k.set('curve', 'linear'), k.set('curve', 'wavy'),
    k.set('sens', 0.9), k.set('sens', 9), k.set('keys', 'soft'), k.set('keys', 'x')];
  say(changed.join() === 'true,false,true,false,true,false,true,true,true,false' && told.length === 6 && k.get('sens') === SENS[1],
    `each change is told once and kept; a repeat and a value that is not one are not (${told.length} told); a sensitivity past its end is held to it`);
  const m = k.storage;
  say(m.getItem('continuum.haptics') === '0' && m.getItem('continuum.deadzone') === '0.12' && m.getItem('continuum.curve') === 'linear' && m.getItem('continuum.sens') === '1.4' && m.getItem('continuum.keys') === 'soft',
    'and kept as continuum.haptics, continuum.deadzone, continuum.curve, continuum.sens and continuum.keys');
  const run = make('', { run: true, storage: mem({ [KEYS.deadzone]: '0.2', [KEYS.haptics]: '0' }) });
  say(run.get('deadzone') === FEEL.deadzone && run.get('haptics') === true && make('curve=linear', { run: true }).get('curve') === 'linear', 'a headless run takes the address and the defaults only');
  const need = ['set.haptics', 'set.deadzone', 'set.curve', 'set.curveLinear', 'set.curveSoft', 'set.sens', 'set.keys', 'set.keysInstant', 'set.keysSoft', 'set.keysSofter',
    'touch.steer', 'touch.brake', 'touch.gas', 'hint.first.touch'];
  say(need.every((key) => TABLES.zh[key] && TABLES.en[key] && !CJK.test(TABLES.en[key])), `the ${need.length} lines of the touch controls and the settings of the feel are in both languages, and the English has no Chinese`);
}

// --- the page ------------------------------------------------------------------

function serve() {
  return spawn('node', [ROOT + 'tools/serve.mjs', String(PORT), ROOT], { stdio: ['ignore', 'ignore', 'inherit'] });
}

async function waitForServer(tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) return true;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  return false;
}

const open = new Set();
const profiles = [];

// Run in each new document before the page's own: a gamepad that is not there
// until it is asked for, whose motors write down what they are asked, and a
// vibrator that writes down its buzzes.
const FAKES = `window.__rumbles = [];
window.__resets = 0;
window.__buzzes = [];
window.__pad = null;
Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__pad] });
navigator.vibrate = (p) => { window.__buzzes.push(p); return true; };
window.__makePad = (axis = 0, rt = 0, lt = 0) => ({
  id: 'fake pad', index: 0, connected: true, mapping: 'standard', timestamp: 0,
  axes: [axis, 0, 0, 0],
  buttons: Array.from({ length: 17 }, (_, i) => ({ value: i === 7 ? rt : i === 6 ? lt : 0, pressed: false })),
  vibrationActuator: {
    type: 'dual-rumble',
    playEffect: (type, params) => { window.__rumbles.push({ type, ...params }); return Promise.resolve('complete'); },
    reset: () => { window.__resets++; return Promise.resolve('complete'); },
  },
});`;

// In the page: how many pointer events of a finger it has heard, of each kind.
const COUNT = `window.__touch = { down: 0, move: 0, up: 0 };
for (const [type, key] of [['pointerdown', 'down'], ['pointermove', 'move'], ['pointerup', 'up'], ['pointercancel', 'up']]) {
  addEventListener(type, (e) => { if (e.pointerType === 'touch') window.__touch[key]++; }, true);
}
0`;

// A page in Chrome, driven over the DevTools protocol. touch: the browser made
// a phone of (a touch screen, mobile, this size); size: [w, h]; languages: what
// the browser says; reduceMotion: the system's preference; fakes: the gamepad and the
// vibrator above.
async function openPage({ size = [1280, 720], touch = false, languages = ['zh-CN'], reduceMotion = false, fakes = false } = {}) {
  const profile = mkdtempSync(`${tmpdir()}/continuum-input-`);
  profiles.push(profile);
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', `--window-size=${size[0]},${size[1]}`, '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], env: CHROME_ENV });
  const devtools = await new Promise((resolve, reject) => {
    let text = '';
    chrome.stderr.on('data', (d) => {
      text += d;
      const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(text);
      if (m) resolve(new URL(m[1]));
    });
    chrome.on('exit', () => reject(new Error('chrome exited: ' + text.slice(-400))));
  });
  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    const list = await (await fetch(`http://${devtools.host}/json/list`)).json();
    target = list.find((x) => x.type === 'page');
    if (!target) await sleep(100);
  }
  const tidy = async () => {
    const list = await (await fetch(`http://${devtools.host}/json/list`)).json();
    for (const x of list) {
      if (x.type !== 'page' || x.id === target.id) continue;
      await fetch(`http://${devtools.host}/json/close/${x.id}`);
    }
    await fetch(`http://${devtools.host}/json/activate/${target.id}`);
  };
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const [resolve, reject] = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}`)); else resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      const text = msg.params.args.map((a) => a.value ?? a.description).join(' ');
      if (!/Failed to load resource/.test(text)) errors.push(text);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(() => { pending.delete(n); reject(new Error(`${method}: no answer in 120 s`)); }, 120000);
    pending.set(n, [(v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); }]);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator, 'languages', { get: () => ${JSON.stringify(languages)} });
      Object.defineProperty(navigator, 'language', { get: () => ${JSON.stringify(languages[0])} });
      ${fakes ? FAKES : ''}`,
  });
  if (reduceMotion) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  // The phone first, so that the page is made on one: the browser says it has a touch screen (and a coarse pointer) as it is made.
  if (touch) {
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: true });
  }

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  // The fingers on the screen now, by id: [x, y].
  const down = new Map();
  const points = (map = down) => [...map].map(([pid, [x, y]]) => ({ x, y, id: pid }));
  const page = {
    ev,
    send,
    errors,
    run: (fn, arg) => ev(`(${fn})(${JSON.stringify(arg === undefined ? null : arg)})`),
    front: tidy,
    async goto(query) {
      await tidy();
      await send('Page.navigate', { url: `http://localhost:${PORT}/index.html?${query}` });
      const t0 = Date.now();
      for (let n = 0; ; n++) {
        await sleep(500);
        const up = await ev('(window.game && game.carLoaded && game.frame > 2 && window.ui) ? "up" : (document.title.startsWith("GAME_FAIL") ? document.title : (document.hidden ? "hidden" : "no"))').catch(() => 'no');
        if (up === 'up') break;
        if (String(up).startsWith('GAME_FAIL')) throw new Error(up);
        if (up === 'hidden' || n % 20 === 19) await tidy().catch(() => 0);
        if (Date.now() - t0 > 240000) throw new Error('the page never came up');
      }
      await ev(COUNT);
    },
    // Fingers. A finger put down, moved or lifted is waited for until the page has heard it (the browser hands the
    // moves of a finger to the page a frame at a time, and a frame of a page drawn in software is a long one).
    // down and up take one finger (id, x, y) or several ([[id, x, y], ...]) in a single event.
    finger: {
      async _send(type, pts, kind, n) {
        if (!n) return;
        const before = await ev(`window.__touch.${kind}`);
        await send('Input.dispatchTouchEvent', { type, touchPoints: pts });
        for (const t0 = Date.now(); (await ev(`window.__touch.${kind}`)) < before + n && Date.now() - t0 < 120000;) await sleep(40);
      },
      async down(a, x, y) {
        const fs = Array.isArray(a) ? a : [[a, x, y]];
        for (const [pid, px, py] of fs) down.set(pid, [px, py]);
        await page.finger._send('touchStart', points(), 'down', fs.length);
      },
      async move(a, x, y) {
        const fs = Array.isArray(a) ? a : [[a, x, y]];
        let moved = 0;
        for (const [pid, px, py] of fs) {
          const was = down.get(pid);
          if (!was || was[0] !== px || was[1] !== py) moved++;
          down.set(pid, [px, py]);
        }
        await page.finger._send('touchMove', points(), 'move', moved);
      },
      async up(a) {
        const ids = (Array.isArray(a) ? a : [a]).filter((pid) => down.has(pid));
        const lifted = ids.map((pid) => ({ x: down.get(pid)[0], y: down.get(pid)[1], id: pid }));
        for (const pid of ids) down.delete(pid);
        await page.finger._send('touchEnd', lifted, 'up', lifted.length);
      },
      async all() {
        await page.finger.up([...down.keys()]);
      },
      // Fingers put down together and lifted ms later, both events sent without waiting for the page in between:
      // the browser stamps each as it gets it, so a page slow to draw does not make the tap long.
      async tap(fs, ms = 60) {
        const pts = fs.map(([pid, x, y]) => ({ x, y, id: pid }));
        const [d, u] = await ev('[window.__touch.down, window.__touch.up]');
        const a = send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [...points(), ...pts] });
        await sleep(ms);
        const b = send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: pts });
        await Promise.all([a, b]);
        for (const t0 = Date.now(); Date.now() - t0 < 120000;) {
          const [d2, u2] = await ev('[window.__touch.down, window.__touch.up]');
          if (d2 >= d + fs.length && u2 >= u + fs.length) break;
          await sleep(40);
        }
      },
      // The same, and the fingers go from where they went down to where they are to go (dragged) before they are lifted.
      async swipe(fs, to, ms = 60) {
        const pts = fs.map(([pid, x, y]) => ({ x, y, id: pid }));
        const end = fs.map(([pid], i) => ({ x: to[i][0], y: to[i][1], id: pid }));
        const [d, u] = await ev('[window.__touch.down, window.__touch.up]');
        const a = send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [...points(), ...pts] });
        await sleep(ms);
        const b = send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [...points(), ...end] });
        await sleep(ms);
        const c = send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: end });
        await Promise.all([a, b, c]);
        for (const t0 = Date.now(); Date.now() - t0 < 120000;) {
          const [d2, u2] = await ev('[window.__touch.down, window.__touch.up]');
          if (d2 >= d + fs.length && u2 >= u + fs.length) break;
          await sleep(40);
        }
      },
    },
    // A finger on the middle of what the selector finds (a button, scrolled into view if the panel holding it scrolls), a tap.
    async tapOn(selector, pid = 1) {
      const at = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return r.width && r.height ? [r.left + r.width / 2, r.top + r.height / 2] : null; })()`);
      if (!at) throw new Error(`nothing to tap at ${selector}`);
      await page.finger.tap([[pid, at[0], at[1]]]);
    },
    // A click of the mouse at the middle of what the selector finds (scrolled into view if the panel holding it scrolls).
    async click(selector) {
      const at = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return r.width && r.height ? [r.left + r.width / 2, r.top + r.height / 2] : null; })()`);
      if (!at) throw new Error(`nothing to click at ${selector}`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at[0], y: at[1] });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at[0], y: at[1], button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at[0], y: at[1], button: 'left', clickCount: 1 });
    },
    mouse: (type, x, y, button = 'none', buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: type === 'mouseMoved' ? 0 : 1 }),
    async key(code, key, vk) {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    },
    // The window put to this size, as a phone is turned: a few frames waited for.
    async size(w, h) {
      await tidy();
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: touch });
      const from = await ev('game.frame');
      for (const t0 = Date.now(); (await ev('game.frame')) < from + 3 && Date.now() - t0 < 90000;) await sleep(300);
    },
    // Frames of the page's own loop waited for (of the photo mode's, with counter 'game.photo.frames').
    async frames(n, counter = 'game.frame') {
      const from = await ev(counter);
      for (const t0 = Date.now(); (await ev(counter)) < from + n && Date.now() - t0 < 120000;) await sleep(100);
    },
    // An expression waited for to come true.
    async until(expression, what, ms = 120000) {
      for (const t0 = Date.now(); Date.now() - t0 < ms;) {
        if (await ev(expression)) return true;
        await sleep(100);
      }
      throw new Error(`never came true: ${what || expression}`);
    },
    async shot(name) {
      await tidy();
      mkdirSync(OUT, { recursive: true });
      const r = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(OUT + name, Buffer.from(r.data, 'base64'));
    },
    close() {
      open.delete(page);
      try { ws.close(); } catch { /* gone */ }
      chrome.kill();
    },
  };
  open.add(page);
  return page;
}

// --- functions that run in the page ---------------------------------------------

// The places as the page has them: shown or not, where, and what they say.
function placesNow() {
  const root = document.getElementById('touch');
  const shown = (e) => {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const box = (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };
  const one = (name) => {
    const e = root.querySelector('.' + name);
    return { ...box(e), shown: shown(e), on: e.classList.contains('on'), text: e.querySelector('.lab').textContent.trim() };
  };
  const bar = document.getElementById('bar').getBoundingClientRect();
  const rect = (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };
  return {
    labels: { steer: rect(root.querySelector('.steer .lab')), brake: rect(root.querySelector('.brake .lab')), gas: rect(root.querySelector('.gas .lab')) },
    hudBox: rect(document.getElementById('hud')), brand: rect(document.getElementById('brand')),
    z: { touch: Number(getComputedStyle(root).zIndex), hud: Number(getComputedStyle(document.getElementById('hud')).zIndex) },
    hidden: root.hidden, display: getComputedStyle(root).display, shown: shown(root), body: document.body.classList.contains('touch'),
    steer: one('steer'), brake: one('brake'), gas: one('gas'), screen: [innerWidth, innerHeight],
    bar: { x: bar.left, y: bar.top, w: bar.width, h: bar.height },
    foot: (() => {
      const at = document.elementFromPoint(innerWidth / 2, innerHeight - 40);
      return at ? (at.closest('#hud') ? 'hud' : at.id || at.tagName) : null;
    })(),
    device: game.driver.device, auto: game.autoMode,
  };
}

// The wheel and the pedals as the driver reads them, with no time given.
const read = `JSON.stringify(game.driver.read())`;

// What is to touch, shown now, with its size.
function smallThings() {
  const shown = (e) => {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const things = [...document.querySelectorAll('#bar button, #bar a, #settings button, #settings input')].filter(shown);
  const small = things.map((e) => [e, e.getBoundingClientRect()]).filter(([, r]) => r.width < 39.5 || r.height < 39.5)
    .map(([e, r]) => `${e.id || e.className || e.tagName} ${e.textContent.trim().slice(0, 12)} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`);
  const out = ['bar', 'settings'].map((id) => document.getElementById(id)).filter(shown)
    .filter((e) => { const r = e.getBoundingClientRect(); return r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5; })
    .map((e) => e.id);
  const rect = (id) => {
    const r = document.getElementById(id).getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };
  return { count: things.length, small, out, bar: rect('bar'), settings: rect('settings') };
}

// The Chinese characters in the places of the touch screen and the settings of the feel.
function cjkIn() {
  const CJKRE = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/;
  const found = [];
  for (const sel of ['#touch', '#settings']) {
    const walk = document.createTreeWalker(document.querySelector(sel), NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if (CJKRE.test(n.nodeValue)) found.push(n.nodeValue.trim());
    for (const el of document.querySelectorAll(sel + ' [title], ' + sel + ' [aria-label]')) {
      for (const a of ['title', 'aria-label']) if (el.getAttribute(a) && CJKRE.test(el.getAttribute(a))) found.push(el.getAttribute(a));
    }
  }
  return found;
}

// The settings panel's rows of the feel, as they show.
function feelRows() {
  const out = {};
  for (const row of document.querySelectorAll('#settings .row[data-key="haptics"], #settings .row[data-key="curve"], #settings .row[data-key="keys"]')) {
    const buttons = [...row.querySelectorAll('button[data-v]')];
    out[row.dataset.key] = {
      options: buttons.map((b) => b.dataset.v), chosen: buttons.filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.dataset.v),
      text: buttons.map((b) => b.textContent.trim()), disabled: buttons.filter((b) => b.disabled).length, label: row.querySelector('.lab').textContent.trim(),
      note: !row.querySelector('.byurl').hidden,
    };
  }
  for (const row of document.querySelectorAll('#settings .row[data-range]')) {
    const input = row.querySelector('input');
    out[row.dataset.range] = {
      value: Number(input.value), min: Number(input.min), max: Number(input.max), step: Number(input.step), disabled: input.disabled,
      text: row.querySelector('.val').textContent, label: row.querySelector('.lab').textContent.trim(), note: !row.querySelector('.byurl').hidden,
    };
  }
  return out;
}

// --- the scenarios --------------------------------------------------------------

// The car set in the air over the road, a hair above it, falling at v m/s.
const DROP = (v) => `(() => {
  game.setAuto(false);
  const g0 = game._groundFor(game.car.x, game.car.z);
  game.car.vx = 0; game.car.vy = 0; game.car.r = 0;
  game.car.airborne = true; game.car.y = g0 + 0.01; game.car.vyWorld = -${v - 0.05};
  return g0;
})()`;

// A place's rectangle, with the outline inside it.
const outline = (z) => ({ x: z.x + GAP, y: z.y + GAP, w: z.w - 2 * GAP, h: z.h - 2 * GAP });
const meets = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Whether the three places are where zonesFor puts them for a screen of w by h, and on it.
function laidOut(now, w, h) {
  const zones = zonesFor(w, h);
  const names = ['steer', 'brake', 'gas'];
  const drawn = names.every((n) => ['x', 'y', 'w', 'h'].every((k) => near(now[n][k], outline(zones[n])[k], 1.01)));
  const onScreen = names.every((n) => now[n].x >= -0.5 && now[n].y >= -0.5 && now[n].x + now[n].w <= w + 0.5 && now[n].y + now[n].h <= h + 0.5);
  return drawn && onScreen;
}

const hit = (n) => Math.round(n * 1000) / 1000;

async function phone() {
  const page = await openPage({ size: [390, 844], touch: true, fakes: true });
  try {
    await page.goto('seed=7&tier=low');
    const W = 390;
    const H = 844;
    await page.until(`!!document.getElementById('firsthint')`, 'the hint of a first visit');
    const line = await page.ev(`document.getElementById('firsthint').textContent`);
    say(line === TABLES.zh['hint.first.touch'], `on a screen whose pointer is a finger the hint of a first visit says "${line}", not "${TABLES.zh['hint.first']}"`);
    const canvasRule = await page.ev(`getComputedStyle(document.getElementById('view')).touchAction`);
    say(canvasRule === 'none', `the canvas takes no gesture of the browser's (touch-action ${canvasRule}), so a finger on it is the car's`);

    // The autopilot drives: nothing to touch.
    const auto = await page.run(placesNow);
    say(auto.auto && auto.hidden && auto.display === 'none' && !auto.shown && !auto.steer.shown && !auto.brake.shown && !auto.gas.shown && !auto.body,
      `with the autopilot driving the touch controls are not there: #touch is hidden (display ${auto.display}), none of the three places has a size on the screen`);
    say(auto.foot === 'hud', `...and the instrument stands where it is, to be read (what is at the foot of the screen: ${auto.foot})`);
    await page.finger.down(1, 100, 700);
    await page.finger.move(1, 140, 700);
    const idle = JSON.parse(await page.ev(`JSON.stringify({ touch: game.driver.touch, fingers: ui.touch.fingers.size, auto: game.autoMode })`));
    await page.finger.up(1);
    say(!idle.touch.steering && idle.touch.steer === 0 && idle.fingers === 0 && idle.auto, `...and a finger dragged on the canvas gives the car nothing (steering ${idle.touch.steering}, ${idle.fingers} fingers held)`);

    // A finger on the autopilot button gives the car over.
    await page.tapOn('#btnAuto');
    await page.frames(2);
    const hands = await page.run(placesNow);
    say(!hands.auto && hands.shown && hands.body && !hands.hidden && hands.device === 'touch',
      `a tap of a finger on the autopilot button gives the car over, and the three places come up (device ${hands.device})`);
    say(laidOut(hands, W, H) && hands.steer.w >= 370 && near(hands.steer.y, 2 * H / 3 + GAP, 1.01) && hands.brake.x < hands.gas.x,
      `tall (390 x 844) the wheel is the bottom third across (${Math.round(hands.steer.w)} x ${Math.round(hands.steer.h)} from y ${Math.round(hands.steer.y)}), the pedals above it at the edges, brake left, throttle right, all as worked out and on the screen`);
    say(hands.steer.text === TABLES.zh['touch.steer'] && hands.brake.text === TABLES.zh['touch.brake'] && hands.gas.text === TABLES.zh['touch.gas'],
      `the places say ${hands.steer.text}, ${hands.brake.text}, ${hands.gas.text}`);
    const clear = (now) => ['steer', 'brake', 'gas'].every((n) => !meets(now.labels[n], now.hudBox) && !meets(now.labels[n], now.brand) && !meets(now.labels[n], now.bar)
      && now.labels[n].x >= 0 && now.labels[n].y >= 0 && now.labels[n].x + now.labels[n].w <= now.screen[0] && now.labels[n].y + now.labels[n].h <= now.screen[1]);
    say(hands.z.touch > hands.z.hud && clear(hands),
      `the places are drawn over the instrument (z ${hands.z.touch} over ${hands.z.hud}, so that the line of a drag is seen where the thumb is), and their words are on the screen and clear of the instrument, the brand and the bar`);
    say(hands.foot === 'view' && hands.bar.y + hands.bar.h < H / 2 && !meets(hands.bar, hands.brake) && !meets(hands.bar, hands.gas),
      `a finger through the instrument reaches the canvas (at the foot of the screen: ${hands.foot}), and the bar is up top (y ${Math.round(hands.bar.y)}), clear of the pedals and the thumbs`);
    await page.shot('phone-tall.png');

    // The wheel.
    await page.finger.down(1, 100, 720);
    await page.finger.move(1, 140, 720);
    const half = JSON.parse(await page.ev(read));
    const raw = JSON.parse(await page.ev(`JSON.stringify({ ...game.driver.touch, lit: document.querySelector('#touch .steer').classList.contains('on') })`));
    say(near(half.steer, 0.5 ** 1.6, 0.03) && raw.steer === 0.5 && raw.lit,
      `a finger put down on the left and dragged 40 px right gives steer ${f3(half.steer)} (0.5 to the 1.6th is ${f3(0.5 ** 1.6)}, +-0.03), the drag itself 0.5; the wheel's place is lit`);
    await page.finger.move(1, 80, 720);
    const left = JSON.parse(await page.ev(read));
    await page.finger.move(1, 400, 720);
    const full = JSON.parse(await page.ev(read));
    say(near(left.steer, -((20 / 80) ** 1.6), 0.03) && full.steer === 1, `20 px left of where it went down is ${f3(left.steer)}, and a drag of far over 80 px is full lock (${full.steer})`);
    await page.finger.up(1);
    const let0 = JSON.parse(await page.ev(`JSON.stringify({ read: game.driver.read(), touch: game.driver.touch, lit: document.querySelector('#touch .steer').classList.contains('on') })`));
    say(let0.read.steer === 0 && !let0.touch.steering && !let0.lit && !let0.read.anyInput, 'let go, the wheel is 0 and the place goes dark');
    await page.ev(`ui.settings.set('curve', 'linear'); 0`);
    await page.finger.down(1, 100, 720);
    await page.finger.move(1, 140, 720);
    const lin = JSON.parse(await page.ev(read));
    await page.finger.up(1);
    say(lin.steer >= 0.45 && lin.steer <= 0.55, `on the linear curve the same 40 px gives ${f3(lin.steer)} (0.45 to 0.55)`);
    await page.ev(`ui.settings.set('curve', 'soft'); 0`);
    const inside = [];
    for (const dx of [3, 6]) {
      await page.finger.down(1, 100, 720);
      await page.finger.move(1, 100 + dx, 720);
      inside.push(JSON.parse(await page.ev(read)).steer);
      await page.finger.up(1);
    }
    say(inside.every((v) => v === 0), `a finger that has moved 3 or 6 px (the dead zone is 8% of 80, 6.4 px) is steering 0 (${inside})`);

    // The pedals.
    const zones = zonesFor(W, H);
    const gas = zones.gas;
    const brake = zones.brake;
    await page.finger.down(2, gas.x + gas.w / 2, gas.y + gas.h / 2);
    const mid = JSON.parse(await page.ev(read));
    const lit = await page.ev(`document.querySelector('#touch .gas').classList.contains('on')`);
    await page.finger.move(2, gas.x + gas.w / 2, gas.y + 4);
    const top = JSON.parse(await page.ev(read));
    await page.finger.move(2, gas.x + gas.w / 2, gas.y + gas.h - 4);
    const foot = JSON.parse(await page.ev(read));
    say(mid.throttle > 0.5 && near(mid.throttle, 0.7, 0.01) && top.throttle > mid.throttle && top.throttle > 0.95 && foot.throttle < mid.throttle && foot.throttle >= 0.4 && lit && mid.brake === 0,
      `a finger held on the throttle gives more than 0.5 (half way up ${f3(mid.throttle)}), the higher the harder (head ${f3(top.throttle)}, foot ${f3(foot.throttle)}), and lights the place`);
    // Let go: the pedal is 0 by the time the page has heard the finger go (and the limit is 0.2 s of that).
    await page.ev(`(() => {
      window.__up = null;
      addEventListener('pointerup', () => { window.__t0 = performance.now(); }, true);
      addEventListener('pointerup', () => { window.__up = { throttle: game.driver.read().throttle, after: performance.now() - window.__t0 }; });
      return 0;
    })()`);
    await page.finger.up(2);
    const gone = await page.ev('window.__up');
    const after = JSON.parse(await page.ev(read));
    say(gone && gone.throttle === 0 && gone.after < 200 && after.throttle === 0,
      `let go, the throttle is 0 when the page has the finger-up (${gone && gone.after.toFixed(1)} ms into it; the limit is 200)`);
    await page.finger.down(3, brake.x + brake.w / 2, brake.y + brake.h / 2);
    const br = JSON.parse(await page.ev(read));
    await page.finger.up(3);
    say(br.brake > 0.5 && br.throttle === 0, `a finger on the brake gives ${f3(br.brake)} (more than 0.5)`);
    // Both hands.
    await page.finger.down(1, 100, 720);
    await page.finger.move(1, 120, 720);
    await page.finger.down(2, gas.x + gas.w / 2, gas.y + gas.h / 2);
    const both = JSON.parse(await page.ev(read));
    await page.shot('phone-tall-lit.png');
    await page.finger.up(1);
    const oneLeft = JSON.parse(await page.ev(read));
    await page.finger.up(2);
    say(both.steer > 0 && both.throttle > 0.5 && oneLeft.steer === 0 && oneLeft.throttle > 0.5,
      `the wheel and the throttle at once (steer ${f3(both.steer)}, throttle ${f3(both.throttle)}); the wheel let go, the throttle holds (${f3(oneLeft.throttle)})`);
    // A second finger on a place that has one does nothing.
    await page.finger.down(1, 100, 720);
    await page.finger.move(1, 140, 720);
    await page.finger.down(2, 300, 720);
    await page.finger.move(2, 380, 720);
    const second = JSON.parse(await page.ev(read));
    await page.finger.all();
    say(near(second.steer, 0.5 ** 1.6, 0.03), `a second finger on the wheel does nothing (steer ${f3(second.steer)})`);

    // A car driven so, by the page's own loop: the throttle held, then the wheel dragged to the right, then to the left.
    await page.ev(`(() => { game.resetToRoad(true); game.car.vx = 3; window.__yaw0 = game.car.yaw; return 0; })()`);
    await page.finger.down(2, gas.x + gas.w / 2, gas.y + 20);
    const v0 = await page.ev('game.car.vx');
    await page.ev(`(() => { for (let i = 0; i < 150; i++) game.update(1 / 60); return 0; })()`);
    const fast = JSON.parse(await page.ev(`JSON.stringify({ speed: game.car.speed, throttle: game.car.throttle, lateral: game.road.lateralOf(game.sCar, game.car.x, game.car.z) })`));
    await page.finger.down(1, 100, 720);
    await page.finger.move(1, 140, 720);
    const turns = [];
    for (const [x, name, steps] of [[140, 'right', 40], [60, 'left', 120]]) {
      await page.finger.move(1, x, 720);
      const r = JSON.parse(await page.ev(`(() => { const y0 = game.car.yaw; for (let i = 0; i < ${steps}; i++) game.update(1 / 60); return JSON.stringify({ turned: game.car.yaw - y0, wheel: game.car.steer }); })()`));
      turns.push({ name, ...r });
    }
    await page.finger.all();
    say(fast.speed > v0 + 3 && fast.throttle > 0.9 && turns[0].turned > 0.02 && turns[0].wheel > 0.1 && turns[1].turned < -0.02 && turns[1].wheel < -0.1,
      `driven by the fingers: the throttle held for 2.5 s of the game takes the car from ${f3(v0)} to ${f3(fast.speed)} m/s (throttle ${f3(fast.throttle)}); the wheel dragged right turns it ${f3(turns[0].turned)} rad in 0.7 s with the wheel at ${f3(turns[0].wheel)}, dragged left the wheel goes to ${f3(turns[1].wheel)} and it turns back ${f3(turns[1].turned)} rad in 2 s`);
    await page.ev(`(() => { game.resetToRoad(true); for (let i = 0; i < 60; i++) game.update(1 / 60); return 0; })()`);

    // Two fingers in the middle.
    const cam0 = await page.ev('game.chase.framing');
    await page.finger.tap([[1, W / 2 - 30, H / 2], [2, W / 2 + 30, H / 2]]);
    const cam1 = await page.ev('game.chase.framing');
    const taps1 = await page.ev('ui.touch.taps');
    await page.finger.swipe([[1, W / 2 - 30, H / 2], [2, W / 2 + 30, H / 2]], [[W / 2 + 10, H / 2], [W / 2 + 140, H / 2]]);
    const cam2 = await page.ev('game.chase.framing');
    await page.finger.tap([[1, 40, 80], [2, 80, 80]]);
    const cam3 = await page.ev('game.chase.framing');
    const taps3 = await page.ev('ui.touch.taps');
    say(cam0 === 'chase' && cam1 !== cam0 && taps1 === 1 && cam2 === cam1 && cam3 === cam1 && taps3 === 1,
      `two fingers tapped in the middle change the camera (${cam0} to ${cam1}); two dragged apart (${cam2}) or tapped at the corner (${cam3}) do not`);
    await page.ev(`game.setCamera('chase'); 0`);

    // What the phone feels.
    await page.ev(`window.__buzzes.length = 0; window.__rumbles.length = 0; ${DROP(5)}; 0`);
    await page.ev(`(() => { for (let i = 0; i < 20; i++) game.update(1 / 60); return 0; })()`);
    const landBuzz = await page.ev('window.__buzzes.slice()');
    await page.ev(`(() => {
      const was = game.collisions.update.bind(game.collisions);
      game.collisions.update = () => { game.collisions.update = was; return { kind: 'impact', speed: 9, oncoming: false, car: {}, s: 0, lat: 0 }; };
      game.update(1 / 60);
      return 0;
    })()`);
    const hitBuzz = await page.ev('window.__buzzes.slice()');
    await page.ev(`(() => { for (let i = 0; i < 300; i++) game.update(1 / 60); window.__buzzes.length = 0; game.critters.knocked++; for (let i = 0; i < 20; i++) game.update(1 / 60); return 0; })()`);
    const animalBuzz = await page.ev('window.__buzzes.slice()');
    say(landBuzz.join() === '40' && hitBuzz.join() === '40,80' && animalBuzz.length === 0 && (await page.ev('window.__rumbles.length')) === 0,
      `on the phone a landing of 5 m/s buzzes ${landBuzz} ms, a hit ${hitBuzz.slice(1)} ms, an animal struck nothing (${animalBuzz.length}); there is no gamepad to rumble`);
    await page.ev(`game.setAuto(false); 0`);

    // A menu opened with a finger on the throttle takes the car out of the hand.
    await page.finger.down(2, gas.x + gas.w / 2, gas.y + 20);
    const holding = JSON.parse(await page.ev(read)).throttle;
    // (A second finger down does not make a click of a tap in the browser, so the menu is opened from the page, as a key or a link would.)
    await page.ev(`document.getElementById('btnSettings').click(); 0`);
    await page.frames(2);
    const menu = JSON.parse(await page.ev(`JSON.stringify({ open: !document.getElementById('settings').hidden, hidden: document.getElementById('touch').hidden, read: game.driver.read(), fingers: ui.touch.fingers.size })`));
    await page.shot('phone-tall-settings.png');
    await page.finger.all();
    // A finger outside the panel (the panel is most of the screen) closes it, and the places come back.
    await page.finger.tap([[1, 30, 20]]);
    await page.frames(2);
    const shut = JSON.parse(await page.ev(`JSON.stringify({ open: !document.getElementById('settings').hidden, hidden: document.getElementById('touch').hidden })`));
    say(holding > 0.5 && menu.open && menu.hidden && menu.read.throttle === 0 && menu.fingers === 0 && !shut.open && !shut.hidden,
      `a menu opened with the throttle held lets the car go (throttle ${f3(holding)} to ${menu.read.throttle}, ${menu.fingers} fingers held) and the places go (hidden ${menu.hidden}); a finger outside it closes it, and they are back (hidden ${shut.hidden})`);

    // The quiet instrument: a touch is input.
    await page.ev(`game.setAuto(true); 0`);
    await page.frames(2);
    await page.ev(`(() => { ui.idle.last = ui.idle.now() - 40000; ui.idle.clock = 1; ui.idle.update(0.3); })()`);
    const quiet = await page.ev(`document.body.classList.contains('idle')`);
    // (The class that brings the panels back lasts 0.4 s of the page's clock, which a slow page may have gone past by the time this side looks.)
    await page.ev(`(() => { window.__wake = false; new MutationObserver(() => { if (document.body.classList.contains('wake')) window.__wake = true; }).observe(document.body, { attributes: true, attributeFilter: ['class'] }); return 0; })()`);
    await page.finger.tap([[1, 200, 400]]);
    const woke = await page.ev(`({ idle: document.body.classList.contains('idle'), wake: window.__wake })`);
    say(quiet && !woke.idle && woke.wake, `after 40 s with nothing touched the instrument is quiet (${quiet}, the autopilot driving); a finger on the canvas brings it back (idle ${woke.idle}, the class that brings the panels back ${woke.wake})`);
    await page.ev(`game.setAuto(false); 0`);
    await page.frames(2);

    // The right button of the mouse, with the places up.
    await page.ev(`window.__menus = []; addEventListener('contextmenu', (e) => __menus.push(e.defaultPrevented)); game.chase.snapTo(game.car, game.car.y); 0`);
    await page.mouse('mouseMoved', 100, 200);
    await page.mouse('mousePressed', 100, 200, 'right', 2);
    for (let i = 1; i <= 10; i++) await page.mouse('mouseMoved', 100 + 30 * i, 200, 'right', 2);
    await page.until('Math.abs(game.chase.view.yaw * 180 / Math.PI - 90) < 0.5', 'the look round the car');
    const round = await page.ev('({ yaw: game.chase.view.yaw * 180 / Math.PI, held: game.chase.view.held, fingers: ui.touch.fingers.size, steering: game.driver.touch.steering })');
    await page.mouse('mouseReleased', 400, 200, 'right', 0);
    await page.ev(`game.chase.snapTo(game.car, game.car.y); game.chase.view.yaw = 0; game.chase.view.pitch = 0; game.chase.letGo(true); 0`);
    say(near(round.yaw, 90, 0.5) && round.held && round.fingers === 0 && !round.steering,
      `the right button dragged 300 px on the canvas looks round the car by ${round.yaw.toFixed(1)} degrees (90), with the places up and the touch screen about, and steers nothing`);

    // The photo mode.
    await page.ev(`ui.photoBar.enter(); 0`);
    await page.frames(3, 'game.photo.frames');
    const photo = await page.run(placesNow);
    const yaw0 = await page.ev('game.photo.lens.yaw');
    await page.finger.down(1, 100, 300);
    await page.finger.move(1, 200, 300);
    await page.finger.up(1);
    const yaw1 = await page.ev('game.photo.lens.yaw');
    const idleHands = JSON.parse(await page.ev(`JSON.stringify(game.driver.touch)`));
    say(photo.hidden && !photo.shown && photo.display === 'none' && yaw1 !== yaw0 && !idleHands.steering,
      `in the photo mode the places are gone (hidden ${photo.hidden}) and a finger turns the lens (${f3(yaw0)} to ${f3(yaw1)}), not the wheel`);
    await page.ev(`game.photo.exit(); 0`);
    await page.until(`game.photo.state === 'off'`, 'the photo mode to end');
    await page.frames(2);
    const out = await page.run(placesNow);
    say(out.shown && !out.auto, 'out of it, the places are back');

    // Turned on its side.
    await page.size(844, 390);
    const wide = await page.run(placesNow);
    say(laidOut(wide, 844, 390) && near(wide.steer.w, 422 - 2 * GAP, 1.01) && wide.steer.h > 370 && wide.brake.x >= 422 && wide.gas.x > wide.brake.x && wide.gas.y > 390 * 0.5,
      `turned to 844 x 390 the wheel is the left half (${Math.round(wide.steer.w)} x ${Math.round(wide.steer.h)}), the pedals the right half's foot (brake ${Math.round(wide.brake.w)} x ${Math.round(wide.brake.h)} from x ${Math.round(wide.brake.x)}, throttle from x ${Math.round(wide.gas.x)}), as worked out and on the screen`);
    say(clear(wide), 'and their words are clear of the instrument, the brand and the bar there too');
    say(wide.bar.y < 40 && !meets(wide.bar, wide.brake) && !meets(wide.bar, wide.gas) && wide.bar.x + wide.bar.w <= 844 + 0.5 && wide.foot === 'view',
      `the bar is up top there too (y ${Math.round(wide.bar.y)}, from x ${Math.round(wide.bar.x)}), clear of the pedals; a finger through the instrument reaches the canvas (${wide.foot})`);
    await page.finger.down(1, 200, 300);
    await page.finger.move(1, 240, 300);
    await page.finger.down(2, wide.gas.x + wide.gas.w / 2, wide.gas.y + wide.gas.h / 2);
    const side = JSON.parse(await page.ev(read));
    await page.shot('phone-wide-lit.png');
    await page.finger.all();
    say(near(side.steer, 0.5 ** 1.6, 0.03) && side.throttle > 0.5, `on its side the same: 40 px is steer ${f3(side.steer)}, the throttle ${f3(side.throttle)}`);
    await page.shot('phone-wide.png');
    await page.tapOn('#btnSettings');
    await page.frames(2);
    await page.shot('phone-wide-settings.png');
    const sideSmall = await page.run(smallThings);
    say(!sideSmall.small.length && !sideSmall.out.length, `on its side everything to touch is 40 x 40 or more and the bar and the panel are on the screen (${sideSmall.count} things)${sideSmall.small.length ? ' (small: ' + sideSmall.small.slice(0, 3) + ')' : ''}`);
    // The next finger on the canvas (the left half is free of the panel here) closes the menu and steers nothing.
    await page.finger.down(1, 200, 300);
    await page.finger.move(1, 240, 300);
    const closed = JSON.parse(await page.ev(`JSON.stringify({ open: !document.getElementById('settings').hidden, read: game.driver.read(), fingers: ui.touch.fingers.size })`));
    await page.finger.all();
    await page.frames(2);
    const back = await page.ev(`document.getElementById('touch').hidden`);
    say(!closed.open && closed.read.steer === 0 && closed.fingers === 0 && back === false,
      `a finger put down on the left with a menu open closes it and steers nothing (steer ${closed.read.steer}, ${closed.fingers} fingers held), and the places come back (hidden ${back})`);

    results.phone = { hands, wide };
    say(!page.errors.length, `the phone's console is clean${page.errors.length ? ' (' + page.errors.slice(0, 2) + ')' : ''}`);
  } finally {
    page.close();
  }
}

// The gamepad, on a wide screen with a keyboard and a mouse: a pad made in the page.
async function gamepad() {
  const page = await openPage({ size: [1280, 720], fakes: true });
  try {
    await page.goto('seed=7&world=hills&tier=low');
    await page.ev(`game.setAuto(false); window.__pad = __makePad(0.05); game.driver.read(); 0`);
    const dead = await page.ev(`(() => { const out = []; for (const a of [0, 0.03, -0.07, 0.08]) { window.__pad = __makePad(a); out.push(Object.is(game.driver.read().steer, 0)); } return out; })()`);
    say(dead.every(Boolean), `a stick inside the dead zone gives steer 0 exactly, in the page (at 0, 0.03, -0.07 and 0.08: ${dead})`);
    const sticks = JSON.parse(await page.ev(`(() => { const out = []; for (const a of [0.5, -0.5, 1]) { window.__pad = __makePad(a, 0.6, 0.3); const r = game.driver.read(); out.push([r.steer, r.throttle, r.brake]); } return JSON.stringify(out); })()`));
    say(near(sticks[0][0], 0.5 ** 1.6, 1e-9) && sticks[1][0] === -sticks[0][0] && sticks[2][0] === 1 && near(sticks[0][1], 0.6, 1e-9) && near(sticks[0][2], 0.3, 1e-9),
      `a stick at half gives ${f3(sticks[0][0])}, at half the other way ${f3(sticks[1][0])}, full 1; the right trigger is the throttle (${sticks[0][1]}), the left the brake (${sticks[0][2]})`);
    const dev = await page.ev('game.driver.device');
    say(dev === 'pad', `the last thing to give input is the gamepad (${dev})`);

    // A landing of 4 m/s.
    await page.ev(`window.__pad = __makePad(0.5); window.__rumbles.length = 0; window.__resets = 0; ${DROP(4)}; 0`);
    await page.ev(`(() => { for (let i = 0; i < 6; i++) game.update(1 / 60); return 0; })()`);
    const land = await page.ev('({ rumbles: window.__rumbles, landed: game._lastLand, lands: game.lands })');
    const r0 = land.rumbles[0] || {};
    say(land.rumbles.length === 1 && r0.type === 'dual-rumble' && r0.strongMagnitude >= 0.45 && r0.strongMagnitude <= 0.55 && r0.weakMagnitude === 0.3 && r0.duration === 180,
      `a landing of ${f3(land.landed)} m/s is ${land.rumbles.length} playEffect: weak ${r0.weakMagnitude}, strong ${hit(r0.strongMagnitude)} (0.45 to 0.55), ${r0.duration} ms`);
    await page.ev(`(() => { for (let i = 0; i < 90; i++) game.update(1 / 60); return 0; })()`);
    const quiet = await page.ev('window.__rumbles.length');
    say(quiet === 1, `and on the road, with the tyres gripping, nothing follows it (${quiet} in all, a second and a half later)`);

    // A hit and an animal, as the game meets them.
    await page.ev(`window.__rumbles.length = 0; (() => {
      const was = game.collisions.update.bind(game.collisions);
      game.collisions.update = () => { game.collisions.update = was; return { kind: 'impact', speed: 9, oncoming: false, car: {}, s: 0, lat: 0 }; };
      game.update(1 / 60);
      return 0;
    })()`);
    const struck = await page.ev('window.__rumbles.filter((r) => r.duration === 250)');
    say(struck.length === 1 && struck[0].weakMagnitude === 0.6 && near(struck[0].strongMagnitude, 0.75, 1e-9), `a hit at 9 m/s rumbles weak ${struck[0] && struck[0].weakMagnitude}, strong ${struck[0] && struck[0].strongMagnitude} (9 / 12), 250 ms`);
    await page.ev(`(() => { for (let i = 0; i < 200; i++) game.update(1 / 60); window.__rumbles.length = 0; game.critters.knocked++; game.update(1 / 60); return 0; })()`);
    const animal = await page.ev('window.__rumbles.filter((r) => r.duration === 120 && r.strongMagnitude === 0.5)');
    say(animal.length === 1 && animal[0].weakMagnitude === 0.4, `an animal struck rumbles weak ${animal[0] && animal[0].weakMagnitude}, strong ${animal[0] && animal[0].strongMagnitude}, 120 ms`);

    // Off the road.
    await page.ev(`window.__pad = __makePad(0, 0.35, 0); window.__rumbles.length = 0; (() => {
      const p = game.road.at(game.sCar);
      const x0 = p.x + Math.sin(p.theta) * 16;
      const z0 = p.z - Math.cos(p.theta) * 16;
      game.car.reset(x0, z0, p.theta, game.groundAt(x0, z0));
      window.__off = { steps: 0, off: 0, speed: 0 };
      for (let i = 0; i < 120; i++) {
        if (game.car.vx < 8) game.car.vx = 8;
        game.update(1 / 60);
        window.__off.steps++;
        if (game.offRoad) window.__off.off++;
        window.__off.speed += game.car.speed;
      }
      return 0;
    })()`);
    const off = JSON.parse(await page.ev('JSON.stringify({ rumbles: window.__rumbles.filter((r) => r.strongMagnitude === 0), ...window.__off })'));
    say(off.off >= 100 && off.rumbles.length >= 5 && off.rumbles.every((r) => r.weakMagnitude >= 0.15 && r.weakMagnitude <= 0.6 && r.duration === 120),
      `two seconds off the road (${off.off} of ${off.steps} steps) at about ${f3(off.speed / off.steps)} m/s is ${off.rumbles.length} sustained rumbles (the first weak ${off.rumbles[0] && f3(off.rumbles[0].weakMagnitude)}, strong 0)`);

    // A hard brake.
    await page.ev(`window.__pad = __makePad(0, 0, 1); window.__rumbles.length = 0; (() => {
      game.resetToRoad(true);
      game.car.vx = 9;
      for (let i = 0; i < 40; i++) game.update(1 / 60);
      return 0;
    })()`);
    const slide = JSON.parse(await page.ev('JSON.stringify({ rumbles: window.__rumbles.filter((r) => r.strongMagnitude === 0 && r.weakMagnitude === 0.25), speed: game.car.speed })'));
    say(slide.rumbles.length >= 2, `braking hard from 9 m/s, with the tyres sliding, is ${slide.rumbles.length} sustained rumbles of weak 0.25, strong 0`);

    // Nothing, with the car on its autopilot, with the keys in hand, or with the setting off.
    const nothing = {};
    for (const [name, setup] of [
      ['autopilot', `game.setAuto(false); window.__pad = __makePad(0.5); game.driver.read(); game.setAuto(true)`],
      ['keys', `window.__pad = null; game.setAuto(false); game.driver.device = 'key'`],
      ['setting', `window.__pad = __makePad(0.5); game.driver.read(); ui.settings.set('haptics', false)`],
    ]) {
      await page.ev(`${setup}; window.__rumbles.length = 0; 0`);
      await page.ev(`${DROP(5).replace('game.setAuto(false);', name === 'autopilot' ? 'game.car.vx = 0;' : 'game.setAuto(false);')}; 0`);
      await page.ev(`(() => { for (let i = 0; i < 20; i++) game.update(1 / 60); return 0; })()`);
      nothing[name] = await page.ev('window.__rumbles.length');
    }
    say(nothing.autopilot === 0 && nothing.keys === 0 && nothing.setting === 0,
      `a landing of 5 m/s rumbles nothing with the car on its autopilot (${nothing.autopilot}), with the keys in hand (${nothing.keys}), or with the rumble turned off in the settings (${nothing.setting})`);
    await page.ev(`ui.settings.set('haptics', true); 0`);
    say(!page.errors.length, `the console is clean${page.errors.length ? ' (' + page.errors.slice(0, 2) + ')' : ''}`);
  } finally {
    page.close();
  }
}

// With the system asking for less motion: nothing rumbles and nothing buzzes.
async function lessMotion() {
  const page = await openPage({ size: [390, 844], touch: true, fakes: true, reduceMotion: true });
  try {
    await page.goto('seed=7&tier=low');
    const set = await page.ev(`({ haptics: ui.settings.get('haptics'), shaking: game.chase.shaking, on: game.haptics.on })`);
    say(set.haptics === false && set.on === false && set.shaking === false, `with "reduce motion" on, the rumble is off (${set.haptics}), as is the lens's shake (${set.shaking})`);
    await page.ev(`window.__pad = null; window.__buzzes.length = 0; window.__rumbles.length = 0; ${DROP(5)}; game.driver.device = 'touch'; 0`);
    await page.ev(`(() => { for (let i = 0; i < 20; i++) game.update(1 / 60); return 0; })()`);
    const buzz = await page.ev('window.__buzzes.length');
    await page.ev(`window.__pad = __makePad(0.5); game.driver.read(); window.__buzzes.length = 0; window.__rumbles.length = 0; ${DROP(5)}; 0`);
    await page.ev(`(() => { for (let i = 0; i < 20; i++) game.update(1 / 60); return 0; })()`);
    const pad = await page.ev('({ rumbles: window.__rumbles.length, buzzes: window.__buzzes.length, device: game.driver.device })');
    say(buzz === 0 && pad.rumbles === 0 && pad.buzzes === 0 && pad.device === 'pad', `a landing of 5 m/s is no vibrate on the phone (${buzz}), and no playEffect or vibrate with the gamepad (${pad.rumbles}, ${pad.buzzes})`);
    // Turned on against what the system asks, it works.
    await page.tapOn('#btnSettings');
    await page.frames(2);
    await page.tapOn('#settings [data-key="haptics"] [data-v="1"]');
    const on = await page.ev(`({ on: game.haptics.on, kept: localStorage.getItem('continuum.haptics') })`);
    await page.ev(`window.__buzzes.length = 0; window.__rumbles.length = 0; ${DROP(5)}; 0`);
    await page.ev(`(() => { for (let i = 0; i < 20; i++) game.update(1 / 60); return 0; })()`);
    const now = await page.ev('({ rumbles: window.__rumbles.length })');
    await page.ev(`window.__pad = null; game.driver.device = 'touch'; window.__buzzes.length = 0; ${DROP(5)}; 0`);
    await page.ev(`(() => { for (let i = 0; i < 20; i++) game.update(1 / 60); return 0; })()`);
    const phoneNow = await page.ev('window.__buzzes.slice()');
    say(on.on === true && on.kept === '1' && now.rumbles === 1 && phoneNow.join() === '40',
      `and turned on in the panel against what the system asks, it does (a landing: ${now.rumbles} rumble; on the phone: ${phoneNow} ms)`);
    await page.ev(`localStorage.removeItem('continuum.haptics'); 0`);
    say(!page.errors.length, `the console is clean${page.errors.length ? ' (' + page.errors.slice(0, 2) + ')' : ''}`);
  } finally {
    page.close();
  }
}

// The settings of the feel, in the panel: each is there, takes hold, is kept, and the address bar locks it.
async function panel(lang) {
  const zh = lang === 'zh';
  const T = TABLES[lang];
  const page = await openPage({ size: [1280, 720], languages: zh ? ['zh-CN'] : ['en-US', 'en'] });
  try {
    await page.goto('seed=7&tier=low');
    await page.until(`!!document.getElementById('firsthint')`, 'the hint of a first visit');
    const line = await page.ev(`document.getElementById('firsthint').textContent`);
    say(line === T['hint.first'], `${lang}: with a mouse and a keyboard the hint of a first visit says "${line}"`);
    await page.click('#btnSettings');
    const rows = await page.run(feelRows);
    const names = ['haptics', 'deadzone', 'curve', 'sens', 'keys'];
    say(names.every((k) => rows[k]) && rows.haptics.chosen.join() === '1' && rows.deadzone.value === 0.08 && rows.curve.chosen.join() === 'soft' && rows.sens.value === 1 && rows.keys.chosen.join() === 'instant',
      `${lang}: the panel has the rumble (${rows.haptics && rows.haptics.chosen}), the dead zone (${rows.deadzone && rows.deadzone.text}), the curve (${rows.curve && rows.curve.chosen}), the sensitivity (${rows.sens && rows.sens.text}) and the keys (${rows.keys && rows.keys.chosen}), at the defaults`);
    say(rows.haptics.label === T['set.haptics'] && rows.deadzone.label === T['set.deadzone'] && rows.curve.label === T['set.curve'] && rows.sens.label === T['set.sens'] && rows.keys.label === T['set.keys']
      && rows.curve.text.join() === [T['set.curveLinear'], T['set.curveSoft']].join() && rows.keys.text.join() === [T['set.keysInstant'], T['set.keysSoft'], T['set.keysSofter']].join()
      && rows.haptics.text.join() === [T['set.on'], T['set.off']].join(),
    `${lang}: they say ${rows.haptics.label}, ${rows.deadzone.label}, ${rows.curve.label} (${rows.curve.text}), ${rows.sens.label}, ${rows.keys.label} (${rows.keys.text})`);
    say(rows.deadzone.min === 0 && rows.deadzone.max === 0.3 && rows.sens.min === 0.6 && rows.sens.max === 1.4, `${lang}: the dead zone goes from 0 to 0.3 and the sensitivity from 0.6 to 1.4`);
    const cjk = await page.run(cjkIn);
    if (!zh) say(!cjk.length, `${lang}: no Chinese in the touch places or the settings panel${cjk.length ? ' (' + cjk.slice(0, 3) + ')' : ''}`);

    await page.click('#settings [data-key="curve"] [data-v="linear"]');
    const curve = await page.ev(`({ exponent: game.driver.feel.exponent, kept: localStorage.getItem('continuum.curve') })`);
    await page.ev(`(() => { const r = document.getElementById('rngDeadzone'); r.value = '0.15'; r.dispatchEvent(new Event('input', { bubbles: true })); return 0; })()`);
    const dz = await page.ev(`({ deadzone: game.driver.feel.deadzone, kept: localStorage.getItem('continuum.deadzone'), text: document.querySelector('#settings [data-range="deadzone"] .val').textContent })`);
    await page.ev(`(() => { const r = document.getElementById('rngSens'); r.value = '1.25'; r.dispatchEvent(new Event('input', { bubbles: true })); return 0; })()`);
    const sens = await page.ev(`({ sens: game.driver.feel.sens, kept: localStorage.getItem('continuum.sens'), text: document.querySelector('#settings [data-range="sens"] .val').textContent })`);
    await page.click('#settings [data-key="keys"] [data-v="soft"]');
    const keys = await page.ev(`({ ease: game.driver.ease, kept: localStorage.getItem('continuum.keys') })`);
    await page.click('#settings [data-key="haptics"] [data-v="0"]');
    const rumble = await page.ev(`({ on: game.haptics.on, kept: localStorage.getItem('continuum.haptics') })`);
    say(curve.exponent === 1 && curve.kept === 'linear' && dz.deadzone === 0.15 && dz.kept === '0.15' && dz.text === '15%' && sens.sens === 1.25 && sens.kept === '1.25' && sens.text === '1.25×'
      && keys.ease.join() === '0.18,0.12' && keys.kept === 'soft' && rumble.on === false && rumble.kept === '0',
    `${lang}: each takes hold as it is changed and is kept (curve linear, dead zone ${dz.text}, sensitivity ${sens.text}, keys soft ${keys.ease}, rumble off)`);

    // After the page is opened again they are as they were left.
    await page.goto('seed=7&tier=low');
    await page.click('#btnSettings');
    const again = await page.run(feelRows);
    const held = await page.ev('({ exponent: game.driver.feel.exponent, deadzone: game.driver.feel.deadzone, sens: game.driver.feel.sens, ease: game.driver.ease, on: game.haptics.on })');
    say(again.curve.chosen.join() === 'linear' && again.deadzone.value === 0.15 && again.sens.value === 1.25 && again.keys.chosen.join() === 'soft' && again.haptics.chosen.join() === '0'
      && held.exponent === 1 && held.deadzone === 0.15 && held.sens === 1.25 && held.ease.join() === '0.18,0.12' && held.on === false,
    `${lang}: opened again, the panel and the game are as they were left`);

    // The address bar is over it, and locks it.
    await page.goto('seed=7&tier=low&deadzone=0.2&curve=soft&sens=1.2&keys=softer&haptics=1');
    await page.click('#btnSettings');
    const url = await page.run(feelRows);
    const forced = await page.ev(`({ exponent: game.driver.feel.exponent, deadzone: game.driver.feel.deadzone, sens: game.driver.feel.sens, ease: game.driver.ease, on: game.haptics.on, kept: localStorage.getItem('continuum.deadzone') })`);
    say(url.deadzone.disabled && url.sens.disabled && url.deadzone.note && url.sens.note && url.curve.disabled === 2 && url.keys.disabled === 3 && url.haptics.disabled === 2 && url.curve.note && url.keys.note && url.haptics.note
      && forced.exponent === 1.6 && forced.deadzone === 0.2 && forced.sens === 1.2 && forced.ease.join() === '0.35,0.25' && forced.on === true && forced.kept === '0.15',
    `${lang}: with deadzone=0.2&curve=soft&sens=1.2&keys=softer&haptics=1 in the address the game takes them (${forced.deadzone}, ${forced.exponent}, ${forced.sens}, ${forced.ease}, rumble ${forced.on}), the panel shows them, greyed, "${T['set.byUrl']}", and what was kept (${forced.kept}) is left alone`);
    await page.ev(`for (const k of ['haptics', 'deadzone', 'curve', 'sens', 'keys']) localStorage.removeItem('continuum.' + k); 0`);

    // On a phone: all of it on the screen, everything to touch 40 x 40.
    await page.goto('seed=7&tier=low');
    await page.size(390, 844);
    await page.click('#btnSettings');
    const small = await page.run(smallThings);
    const box = await page.ev(`(() => { const r = document.getElementById('settings').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, scroll: document.getElementById('settings').scrollHeight, client: document.getElementById('settings').clientHeight }; })()`);
    await page.shot(`panel-${lang}-phone.png`);
    say(!small.small.length && !small.out.length && box.scroll <= box.client + 1 && !meets(small.bar, small.settings),
      `${lang}: on a phone (390 x 844) the panel with its fourteen rows is on the screen without scrolling (${Math.round(box.top)} to ${Math.round(box.bottom)}) and clear of the bar (which ends at ${Math.round(small.bar.y + small.bar.h)}), everything to touch is 40 x 40 or more (${small.count} things)${small.small.length ? ' (small: ' + small.small.slice(0, 3) + ')' : ''}`);
    say(!page.errors.length, `${lang}: the console is clean${page.errors.length ? ' (' + page.errors.slice(0, 2) + ')' : ''}`);
  } finally {
    page.close();
  }
}

async function main() {
  const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
  feel();
  places();
  motors();
  setting();
  if (process.argv.includes('--node')) return;
  const server = serve();
  try {
    if (!(await waitForServer())) throw new Error('server did not start');
    for (const [name, run] of [['phone', phone], ['gamepad', gamepad], ['motion', lessMotion], ['panel', async () => { await panel('zh'); await panel('en'); }]]) {
      if (!only.length || only.includes(name)) await run();
    }
  } finally {
    server.kill();
  }
}
await main();
for (const p of open) p.close();
await sleep(800);
for (const dir of profiles) rmSync(dir, { recursive: true, force: true });
if (failed) {
  console.error(`\n${failed} problem${failed > 1 ? 's' : ''}`);
  process.exit(1);
}
console.error('\nOK');
process.exit(0);
