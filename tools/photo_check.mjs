// The photo mode (render/photo.js, ui/photo.js): the world stands still, the
// lens is let go of, and a picture is taken of the frame at twice the size.
//
// In node, without a browser, the lens and the picture's size and name:
//  - the keys take it where they should, as fast as they should (12 m/s, four
//    times that with Shift, not faster along a diagonal), it comes to its speed
//    and stops in a fraction of a second after the key is let go, and the
//    same keys held the same time take it as far at 30, 60 and 144 frames a
//    second; a frame that took five seconds moves it as far as one of a tenth;
//  - Z and X roll it 30 degrees either way of the roll it began with and no
//    further, the wheel changes the field of view between 20 and 100 degrees,
//    it looks up and down by at most 88, and a drag turns it so that the
//    picture goes where the pointer goes;
//  - held to a made-up ground and a car, it is never under the ground by 0.3 m
//    and never further than 400 m from the car, whatever it is pushed with;
//  - a picture is twice the canvas's pixels in a frame of at most 3840 x 2160
//    (and of what the card can make), of the canvas's shape; its name is
//    continuum-<world>-<style>-<chainage>.png;
//  - the aperture is one of 22 f-numbers, thirds of a stop from f/1.4 to f/16, the
//    compensation at most 2 stops either way; the disc of a point is none at the
//    focus, positive behind it and negative before, goes by the f-number's inverse
//    and the frame's height, is larger for a narrower field and a nearer focus, and
//    is never beyond the largest; at f/2 what is 300 m away is blurred all the way and
//    what is within 1.5 m of the focus is not, and at f/16 the background is not;
//    a disc of the depth of field is sixteen taps.
//
// In the real page, headless, in Chrome (seed 7), driven by the page's own
// entry (Game.photo) where a frame is to be read, and over the DevTools
// protocol with real keys and a real mouse where the keys and the mouse are:
//  - after going in, two frames a second of the wall's clock apart are the same
//    pixels, in the real style and the painted one, in the hills and in the
//    river's valley (clouds, grass and water); the game's own clock, frame and
//    car do not move meanwhile; and a second of the world going on does change
//    the frame (the equality is not for want of anything to move);
//  - the same, on a canvas of 480 x 270 and a page for each, in each of the
//    twelve worlds at the place tools/look.mjs has for it (real, and painted
//    too in the city, heaven, space and the upside), and in the hills under
//    each of the three skies a day world has (sky= in the address), real and
//    painted: each frame has something in it, and a second of the world going
//    on changes it;
//  - the lens is pushed into the land, the road and the water (each in its
//    own place) and does not go under their surface by 0.3 m, and is pushed
//    out from the car and stays within 400 m of it;
//  - in a bore the lens is held by the road under it and the vault over it (not by
//    the hill over the vault) and the frame's light is the bore's where the lens
//    is, at once and not kept; under the cavern's roof it stops under the roof; in
//    the deep sea the surface of the water is not the floor;
//  - the picture: its size is twice the canvas's, it is a PNG of that size,
//    not black, and brought down to the canvas's size it is within 30 dB (PSNR)
//    of the frame on the screen; nothing is drawn to the canvas to make it and
//    no size is written to it; its name is the one the words give;
//  - going in, moving, taking a picture and going out leaves the world as a
//    run that never went in: after 60 steps every field of Game.snapshot but
//    the lens is the same, but the counts of what has been drawn and built on
//    the way (geometries, draw calls, triangles; after a long way off the
//    trees and the small things on the ground too), which go by where the
//    lens has been, and are told, not held; the lens is back where it began
//    0.6 s after going out, to 5 cm and half a degree; the car is where the
//    world stopped and goes on from there;
//  - with real keys: K goes in and out, P C R N H do nothing in it (and
//    each does what it did outside it), W A S D do not drive, Q E Z X and the
//    mouse and the wheel move the lens and nothing else, Enter takes a
//    picture and saves it under its name, Esc goes out, the wallpaper and the
//    photo mode are one or the other; the canvas keeps its size, and no frame
//    of another size is shown, while the picture is taken; a K before the page
//    is ready does nothing;
//  - with a real mouse on the buttons: the camera button of the page's bar
//    goes in, the switch of the photo bar puts the car away (the frame loses
//    the car and what it casts and nothing else) and brings it back (the frame
//    is the one it was), the exit button goes out and the car is drawn again,
//    the style button changes the style with the world standing and the frame
//    still when it is done, the shutter button takes the picture;
//  - the depth of field and the exposure compensation, in the real style and the
//    painted one, on the chase camera's frame in the hills: off, nothing is drawn for
//    them (the frame is the one it was, the draw count the same, none of their
//    programs built); asked for, the depth of field is built ahead (compileAsync) and
//    comes on when its programs are, drawing six times a frame; two frames a second
//    apart with it on are the same pixels; a tap on the car focuses at the distance
//    of the car's body (3%), a tap on the far hills at theirs, a tap on the bar not
//    at all, a press that is dragged not at all, and a mark stands where the tap was
//    and goes; at f/2 on the car, the car's own detail is kept (0.9 of what it had)
//    and what is 300 m away has less than 0.4 of what it had, and the line across
//    the car's edge is no lighter than both its sides and no darker than both (3%);
//    the exposure compensation of +1 and -1 EV makes the light of the frame twice
//    and half what it was (the uniform exactly; in the painted style, where the
//    curve is a line below 0.62, the mean of the frame's linear light too, 5%, over
//    what is not over-exposed); put off again, the frame is the one it was;
//  - the picture, with the depth of field on at f/2 and half a stop of compensation
//    over, is twice the canvas and within 30 dB of the frame on the screen, in the
//    real style and the painted, and the canvas is not touched;
//  - with a real mouse and real keys: the depth of field's switch turns it on, the
//    sliders (the arrow keys) set the aperture and the compensation, a tap on the
//    frame focuses it and a mark fades in 0.8 s, a tap on the bar, a drag, and a
//    tap of the right button do not, and going out puts all of it back.
//
// A card that cannot make the picture (a target a texel wider than its largest
// texture does not make a complete frame buffer; it gives errors and no
// exception): the chain throws and does not hand over a picture of nothing, and is
// as it was after; a picture the page takes with the largest size failing comes
// at the next size and says so, and with every size failing it is not taken and
// the page says that, and takes the next one as it always did.
//
// Usage: node tools/photo_check.mjs [--gpu]
// --gpu runs the export part on the real GPU instead (ANGLE as tools/look.mjs --gpu
//   has it; ANGLE=gl, or a list, overrides the backends tried), on a canvas of
//   1920 x 1080 so that the picture is the full 3840 x 2160, in the real style and the
//   painted: the size, the PSNR, that the canvas is not touched, the errors the card
//   gave and any context lost, and the time it took (told, not held). A run that
//   ends up on the software renderer (SwiftShader) fails, with status 2. The picture is taken
//   again with the depth of field on at f/2 and half a stop of compensation over, and is the
//   full size or the next that the card can make, said to be smaller, and gives no error.
// PORT=8204 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser. Pictures go to out/photo (OUT=dir).
// PICTURE=640x360 makes the canvas of the two frames whose pictures are kept smaller.
// ONLY=keys,river runs the scenarios whose names have these in them (hills, river, card,
//   every, left, under, keys, depth, glass).

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';

const CHROME = process.env.CHROME || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome-stable');
// Headless WebGL fails on Linux while DISPLAY is set.
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8204;
const ROOT = new URL('..', import.meta.url).pathname;
const OUT = (process.env.OUT || ROOT + 'out/photo').replace(/\/?$/, '/');
// The canvas of the two frames whose pictures are kept to be looked at (the hills,
// real and painted); the others are taken on a canvas of 640 x 360.
const PICTURE = (process.env.PICTURE || '960x540').split('x').map(Number);
// --gpu: the export part of the check on the real GPU, through ANGLE as tools/look.mjs --gpu
// has it (ANGLE=gl, or a list, vulkan,gl, overrides the backends tried), at a canvas of
// 1920 x 1080, so that the picture is the full 3840 x 2160. A run that ends up on the
// software renderer (SwiftShader) fails, it does not stand in for the GPU.
const GPU = process.argv.includes('--gpu');
const ANGLES = process.env.ANGLE ? process.env.ANGLE.split(',')
  : { darwin: ['metal'], linux: ['vulkan', 'gl'], win32: ['d3d11'] }[process.platform] || ['gl'];
let angle = null;
const noGPU = (why) => Object.assign(new Error(`no GPU to draw on, ${why}; not running on the software renderer in its place`), { noGPU: true });
// The renderer a context in an empty page has, and the one the game has.
const RENDERER = `(() => { const gl = document.createElement('canvas').getContext('webgl2'); const d = gl && gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : ''; })()`;
const GAME_RENDERER = `(() => { const gl = game.renderer.getContext(); const d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : ''; })()`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEG = Math.PI / 180;

let failed = 0;
const say = (ok, text) => {
  if (!ok) failed++;
  console.error(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
};
const results = {};
const f = (x, n = 2) => (Number.isFinite(x) ? x.toFixed(n) : String(x));

// --- in node ------------------------------------------------------------------

async function inNode() {
  const three = new URL('./vendor/three.module.js', import.meta.url).href;
  register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, n) { return s === 'three' ? { url: ${JSON.stringify(three)}, shortCircuit: true } : n(s, c); }`,
  ));
  const THREE = await import('./vendor/three.module.js');
  const P = await import('../src/render/photo.js');
  const { Lens, exportSize, pictureSizes, fileName, SPEED, FAST, ROLL, FOV, REACH, CLEAR } = P;

  // The size of a picture.
  const sizes = [[640, 360, [1280, 720]], [1920, 1080, [3840, 2160]], [2560, 1440, [3840, 2160]], [3000, 1000, [3840, 1280]],
    [1000, 3000, [720, 2160]], [1281, 721, [2562, 1442]], [3840, 2160, [3840, 2160]], [1, 1, [2, 2]]];
  const wrong = sizes.filter(([w, h, want]) => exportSize(w, h).join() !== want.join());
  say(!wrong.length, `a picture is twice the canvas's pixels, in at most 3840 x 2160, of its shape (${sizes.map(([w, h, s]) => `${w}x${h}→${s.join('x')}`).join(' ')})${wrong.length ? ' (wrong: ' + wrong.map(([w, h]) => `${w}x${h}→${exportSize(w, h)}`) + ')' : ''}`);
  const small = exportSize(1920, 1080, 2048);
  say(small.join() === '2048,1152', `...and no larger than the card can make (a limit of 2048: ${small.join(' x ')})`);
  const shape = [[2557, 1439], [1366, 768], [390, 844]].map(([w, h]) => { const [a, b] = exportSize(w, h); return Math.abs(a / b - w / h) < 2e-3; });
  say(shape.every(Boolean), 'the picture has the canvas\'s shape to a part in five hundred, where the cap cuts it');

  // The sizes it is tried at where the card cannot make the largest: three quarters of it, then half.
  const ladders = [[1920, 1080, Infinity, [[3840, 2160], [2880, 1620], [1920, 1080]]], [960, 540, Infinity, [[1920, 1080], [1440, 810], [960, 540]]],
    [2560, 1440, Infinity, [[3840, 2160], [2880, 1620], [1920, 1080]]], [1920, 1080, 2048, [[2048, 1152], [1536, 864], [1024, 576]]], [1, 1, Infinity, [[2, 2], [1, 1]]]];
  const off = ladders.filter(([w, h, limit, want]) => JSON.stringify(pictureSizes(w, h, limit)) !== JSON.stringify(want));
  say(!off.length, `a card that cannot make the largest picture is asked for three quarters of its size and then for half (${ladders.map(([w, h, , l]) => `${w}x${h}→${l.map((x) => x.join('x')).join(',')}`).join(' ')})${off.length ? ' (wrong: ' + off.map(([w, h, limit]) => `${w}x${h}→${JSON.stringify(pictureSizes(w, h, limit))}`) + ')' : ''}`);

  // Its name.
  const names = [fileName('山间', '写实', 6827.4), fileName('Alpine', 'Real', 12.5), fileName('A/B', 'x y', 3.2), fileName('Hills', 'Paint', 0.4)];
  say(names.join() === 'continuum-山间-写实-6827.png,continuum-Alpine-Real-13.png,continuum-AB-xy-3.png,continuum-Hills-Paint-0.png',
    `a picture is called continuum-<world>-<style>-<chainage to the metre>.png, with what a file name cannot hold left out (${names.join(', ')})`);

  // The lens.
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.3, 14000);
  camera.position.set(0, 5, 0);
  camera.rotateZ(0.04);
  camera.updateMatrixWorld();
  const begin = (lens = new Lens()) => {
    lens.from(camera.position, camera.quaternion, camera.fov);
    return lens;
  };
  const run = (lens, seconds, fps = 60) => {
    for (let i = 0; i < Math.round(seconds * fps); i++) lens.step(1 / fps);
  };

  const w = begin();
  w.press('KeyW');
  run(w, 3);
  const d = begin();
  d.press('KeyD');
  run(d, 3);
  const up = begin();
  up.press('KeyE');
  run(up, 3);
  say(w.p.z < -30 && Math.abs(w.p.x) < 1e-9 && Math.abs(w.v.length() - SPEED) < 0.01 * SPEED && d.p.x > 30 && Math.abs(d.p.z) < 1e-9 && up.p.y > 5 + 30 && Math.abs(up.p.x) + Math.abs(up.p.z) < 1e-9,
    `W takes the lens ahead (-z with no turn) at ${f(w.v.length(), 2)} m/s, D to the right, E up; none of them sideways of itself`);
  const turned = begin();
  turned.drag(0, 0, 0);
  turned.yaw = Math.PI / 2;
  turned.press('KeyW');
  run(turned, 3);
  say(turned.p.x < -30 && Math.abs(turned.p.z) < 1e-6, 'ahead goes where the lens looks (turned a quarter to the left, W goes to -x)');
  const diag = begin();
  diag.press('KeyW');
  diag.press('KeyD');
  run(diag, 3);
  const fast = begin();
  fast.press('KeyW');
  fast.press('ShiftLeft');
  run(fast, 3);
  say(Math.abs(Math.hypot(diag.v.x, diag.v.z) - SPEED) < 0.01 * SPEED && Math.abs(fast.v.length() - SPEED * FAST) < 0.01 * SPEED * FAST,
    `a diagonal is no faster (${f(Math.hypot(diag.v.x, diag.v.z), 2)} m/s), and Shift is ${FAST} times as fast (${f(fast.v.length(), 1)} m/s)`);

  // Let go of: it stops.
  const stop = begin();
  stop.press('KeyW');
  run(stop, 2);
  stop.release('KeyW');
  const at = stop.p.z;
  run(stop, 1);
  const glide = at - stop.p.z;
  const rest = stop.v.length();
  const at2 = stop.p.z;
  run(stop, 1);
  say(rest < 0.01 && Math.abs(stop.p.z - at2) < 1e-3 && glide < SPEED * 0.2,
    `let go of, it glides ${f(glide, 2)} m (at most ${f(SPEED * 0.2, 1)}), is at ${f(rest * 1000, 1)} mm/s a second on and does not move in the second after (${f(Math.abs(stop.p.z - at2) * 1000, 3)} mm)`);

  // By the wall's clock, whatever the frames.
  const far = [30, 60, 144].map((fps) => {
    const l = begin();
    l.press('KeyD');
    l.press('KeyW');
    run(l, 2, fps);
    l.release('KeyD');
    run(l, 1, fps);
    return l.p.clone();
  });
  const spread = Math.max(far[0].distanceTo(far[1]), far[1].distanceTo(far[2]));
  const slow = begin();
  slow.press('KeyD');
  slow.step(5);
  const tenth = begin();
  tenth.press('KeyD');
  tenth.step(0.1);
  say(spread < 1e-6 && Math.abs(slow.p.x - tenth.p.x) < 1e-12,
    `the same keys held the same time take the lens to the same place at 30, 60 and 144 frames a second (${f(spread * 1e6, 3)} µm apart); a frame of five seconds moves it as far as one of a tenth`);

  // Roll, field of view, pitch, drag.
  const r = begin();
  const roll0 = r.roll;
  r.press('KeyZ');
  run(r, 10);
  const plus = r.roll - roll0;
  r.release('KeyZ');
  r.press('KeyX');
  run(r, 20);
  const minus = r.roll - roll0;
  r.release('KeyX');
  say(Math.abs(plus - ROLL) < 1e-3 && Math.abs(minus + ROLL) < 1e-3 && Math.abs(ROLL - 30 * DEG) < 1e-12,
    `Z and X roll it ${f(plus / DEG, 2)} and ${f(minus / DEG, 2)} degrees of the roll it began with (${f(roll0 / DEG, 2)}) and no further`);
  const z = begin();
  z.zoom(-50);
  run(z, 6);
  const out = z.fov;
  z.zoom(50);
  run(z, 8);
  say(Math.abs(out - FOV[0]) < 1e-9 && Math.abs(z.fov - FOV[1]) < 1e-9 && FOV.join() === '20,100', `the wheel keeps the field of view between ${FOV[0]} and ${FOV[1]} degrees (${f(out, 3)} and ${f(z.fov, 3)} after as much as it can be turned)`);
  const dr = begin();
  dr.drag(0, 1e6, 0.01);
  const high = dr.pitch;
  dr.drag(0, -2e6, 0.01);
  const low = dr.pitch;
  const turnedBy = begin();
  turnedBy.drag(100, 50, 0.001);
  const cam2 = new THREE.PerspectiveCamera();
  turnedBy.write(cam2);
  const look = cam2.getWorldDirection(new THREE.Vector3());
  say(Math.abs(high - 88 * DEG) < 1e-9 && Math.abs(low + 88 * DEG) < 1e-9 && look.x < 0 && look.y > 0 && turnedBy.yaw > 0 && turnedBy.pitch > 0,
    `it looks up and down by 88 degrees at most; a drag right and down turns it left and up, so that the picture goes where the pointer goes`);

  // Held to a ground and a car.
  const car = { x: 0, y: 2, z: 0 };
  const ground = (x, z) => 3 + 0.02 * x + 2 * Math.sin(z / 40);
  const held = (lens) => {
    lens.limit = (p, v) => {
      for (let i = 0; i < 6; i++) {
        let moved = false;
        const dx = p.x - car.x;
        const dy = p.y - car.y;
        const dz = p.z - car.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > REACH - 0.05) {
          const k = (REACH - 0.05) / dist;
          p.set(car.x + dx * k, car.y + dy * k, car.z + dz * k);
          moved = true;
        }
        const floor = ground(p.x, p.z) + CLEAR;
        if (p.y < floor) {
          p.y = floor;
          if (v && v.y < 0) v.y = 0;
          moved = true;
        }
        if (!moved) break;
      }
    };
    return lens;
  };
  let low2 = Infinity;
  let far2 = 0;
  let seed = 12345;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const walk = held(begin());
  const pool = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft'];
  for (let i = 0; i < 60 * 240; i++) {
    if (i % 90 === 0) {
      walk.clear();
      for (const k of pool) if (rand() < 0.4) walk.press(k);
      walk.yaw += (rand() - 0.5) * 3;
    }
    walk.step(1 / 60);
    low2 = Math.min(low2, walk.p.y - ground(walk.p.x, walk.p.z));
    far2 = Math.max(far2, Math.hypot(walk.p.x - car.x, walk.p.y - car.y, walk.p.z - car.z));
  }
  const placed = held(begin());
  placed.place(1e5, -1e4, 3e4);
  say(low2 >= CLEAR - 1e-9 && far2 <= REACH && Math.hypot(placed.p.x - car.x, placed.p.y - car.y, placed.p.z - car.z) <= REACH
    && placed.p.y - ground(placed.p.x, placed.p.z) >= CLEAR - 1e-9,
  `walked at random for 4 minutes over a made-up ground the lens was never lower than ${f(low2, 3)} m above it (at least ${CLEAR}) nor further than ${f(far2, 3)} m from the car (at most ${REACH}); put a hundred kilometres off and under it, it is put back within both`);

  // The glass: the apertures the lens is set to, the compensation it is given, the
  // discs of a point it makes, and the depth of field's taps.
  const { APERTURES, APERTURE, EV, TAP } = P;
  const Post = await import('../src/render/post.js');
  const { LENS, discRadius, DOF_SHADERS } = Post;
  const thirds = APERTURES.slice(1).map((a, i) => a / APERTURES[i]);
  say(APERTURES.length === 22 && APERTURES[0] === 1.4 && APERTURES[21] === 16 && APERTURES.includes(2) && APERTURE === 2.8 && APERTURES.includes(APERTURE)
    && thirds.every((r) => r > 1.07 && r < 1.19) && EV === 2 && TAP.px > 0 && TAP.ms > 0,
  `the aperture is one of ${APERTURES.length} f-numbers, thirds of a stop from f/${APERTURES[0]} to f/${APERTURES[APERTURES.length - 1]} (each ${f(Math.min(...thirds), 3)} to ${f(Math.max(...thirds), 3)} times the one before; f/${APERTURE} until it is set), the compensation is at most ${EV} stops either way, and a tap is a press of under ${TAP.px} pixels and ${TAP.ms} ms`);
  const disc = (d, s = 7, n = 2.8, fov = 55, frame = 1080) => discRadius(d, s, n, fov, frame);
  const laws = [
    ['no disc at the focus', disc(7) === 0],
    ['positive behind the focus, negative in front of it', disc(300) > 0 && disc(3) < 0 && Math.abs(disc(300) + disc(1 / (2 / 7 - 1 / 300))) < 1e-9],
    ['as the f-number\'s inverse', Math.abs(disc(300, 7, 2) / disc(300, 7, 2.8) - 1.4) < 1e-9],
    ['a frame twice as tall has discs twice as large', Math.abs(disc(300, 7, 2.8, 55, 2160) / disc(300) - 2) < 1e-9],
    ['a narrower field larger ones, a wider one smaller', disc(300, 7, 2.8, 30) > disc(300) && disc(300) > disc(300, 7, 2.8, 100)],
    ['a nearer focus larger ones', disc(300, 3) > disc(300, 7)],
    ['none beyond the largest', disc(0.3, 1e6, 1.4, 20) === -LENS.max * 1080 && disc(1e5, 0.5, 1.4, 20) === LENS.max * 1080],
  ];
  const broken = laws.filter(([, ok]) => !ok).map(([what]) => what);
  say(!broken.length, `the disc of a point (the radius, in pixels of the frame): ${laws.map(([what]) => what).join('; ')}${broken.length ? ' (BROKEN: ' + broken + ')' : ''}`);
  const zone = LENS.zone.map((z) => z * 1080);
  const body = [5.5, 8.5].map((d) => Math.abs(disc(d, 7, 2)));
  say(disc(300, 7, 2) >= zone[1] && Math.max(...body) < zone[0] && disc(1e4, 7, 16) < zone[0],
    `at f/2 in a frame 1080 pixels tall, a field of 55 degrees, focused at 7 m, what is 300 m away is a disc of ${f(disc(300, 7, 2), 2)} px (all of it blurred from ${f(zone[1], 2)}) and what is within 1.5 m of the focus ${body.map((x) => f(x, 2)).join(' and ')} px (nothing blurred under ${f(zone[0], 2)}); at f/16 the background is ${f(disc(1e4, 7, 16), 2)} px, and none of it is blurred`);
  const count = (src, what) => src.split(what).length - 1;
  say(DOF_SHADERS.taps === 16 && count(DOF_SHADERS.base, 'texelFetch(tBase, clamp(p + ivec2(floor(') === 16 && count(DOF_SHADERS.near, 'texelFetch(tNear, clamp(p + ivec2(at)') === 16,
    `a disc of the depth of field is ${DOF_SHADERS.taps} taps: the base layer's gather has ${count(DOF_SHADERS.base, 'texelFetch(tBase, clamp(p + ivec2(floor(')}, the near layer's ${count(DOF_SHADERS.near, 'texelFetch(tNear, clamp(p + ivec2(at)')}`);
  results.node = { names, sizes, glide, spread, low: low2, far: far2 };
}

// --- the page -----------------------------------------------------------------

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

// On the GPU: the first of the system's ANGLE backends that draws on something
// other than SwiftShader, kept for the pages after; none, and the run fails
// rather than stand in for the GPU with the software renderer. Returns the
// name of the card.
async function pickAngle() {
  const tried = [];
  for (const a of ANGLES) {
    let page = null;
    try {
      page = await openPage({ size: [320, 180], on: a });
      const name = String(await page.ev(RENDERER));
      if (name && !/SwiftShader/i.test(name)) {
        angle = a;
        return name;
      }
      tried.push(`${a}: ${name || 'no renderer'}`);
    } catch (e) {
      tried.push(`${a}: ${e.message}`);
    } finally {
      if (page) page.close();
    }
  }
  throw noGPU(`on ${process.platform} (--use-angle=${tried.join('; ')})`);
}

// Run in each new document before the page's own: what the checks read the
// page with, and the saving of a file turned into a note of its name.
const PRELUDE = `
window.__saved = [];
{
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) { window.__saved.push({ name: this.download, href: this.href }); return; }
    return click.call(this);
  };
}
window.__t = {
  // The canvas as it is: its bytes.
  screen() {
    const c = document.createElement('canvas');
    c.width = game.canvas.width;
    c.height = game.canvas.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(game.canvas, 0, 0);
    return x.getImageData(0, 0, c.width, c.height).data;
  },
  // How many pixels differ, and by how much at most.
  diff(a, b) {
    let n = 0;
    let max = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      if (d) {
        n++;
        if (d > max) max = d;
      }
    }
    return { differing: n, of: a.length / 4, max };
  },
  // Where the pixels that differ are: the box they are in, and how many in each
  // cell of a grid of 4 across and 3 down.
  where(a, b) {
    const w = game.canvas.width;
    const h = game.canvas.height;
    const box = [w, h, -1, -1];
    const grid = new Array(12).fill(0);
    for (let i = 0; i < a.length; i += 4) {
      if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) continue;
      const x = (i / 4) % w;
      const y = Math.floor(i / 4 / w);
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x);
      box[3] = Math.max(box[3], y);
      grid[Math.min(2, Math.floor(y * 3 / h)) * 4 + Math.min(3, Math.floor(x * 4 / w))]++;
    }
    return { box, grid };
  },
  // Two frames and where they differ (in white, on black), side by side, as a PNG.
  sheet(a, b) {
    const w = game.canvas.width;
    const h = game.canvas.height;
    const c = document.createElement('canvas');
    c.width = w * 3;
    c.height = h;
    const x = c.getContext('2d');
    const draw = (data, at) => x.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), at, 0);
    draw(a, 0);
    draw(b, w);
    const d = new Uint8ClampedArray(a.length);
    for (let i = 0; i < a.length; i += 4) {
      const on = a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2];
      d[i] = d[i + 1] = d[i + 2] = on ? 255 : 0;
      d[i + 3] = 255;
    }
    draw(d, 2 * w);
    return c.toDataURL('image/png');
  },
  // A frame as a PNG.
  png(data) {
    const w = game.canvas.width;
    const h = game.canvas.height;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
    return c.toDataURL('image/png');
  },
  // The mean of a frame's luma and how far it spreads (its standard deviation), 0 to 255.
  stats(data) {
    let n = 0;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < data.length; i += 4) {
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      sum += l;
      sq += l * l;
      n++;
    }
    const mean = sum / n;
    return { mean, spread: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
  },
  // The snapshot of the game, the lens left out.
  snap() {
    const s = game.snapshot();
    delete s.lens;
    return s;
  },
  car() {
    const c = game.car;
    return [c.x, c.y || 0, c.z, c.vx, game.sCar, game.simTime, game.frame];
  },
  // Counts what is drawn to the canvas itself (the default framebuffer) and the
  // sizes written to it, until stop().
  watch() {
    const gl = game.renderer.getContext();
    const names = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements', 'clear'];
    const seen = { onCanvas: 0, draws: 0, writes: [], setSize: 0, setPixelRatio: 0 };
    for (const n of names) {
      const was = gl[n];
      gl[n] = function (...args) {
        seen.draws++;
        if (gl.getParameter(gl.FRAMEBUFFER_BINDING) === null) seen.onCanvas++;
        return was.apply(this, args);
      };
    }
    const cv = game.canvas;
    for (const k of ['width', 'height']) {
      const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, k);
      Object.defineProperty(cv, k, { configurable: true, get() { return d.get.call(this); }, set(v) { seen.writes.push([k, v]); d.set.call(this, v); } });
    }
    const r = game.renderer;
    const wrap = (k) => {
      const was = r[k];
      r[k] = function (...args) { seen[k]++; return was.apply(this, args); };
    };
    wrap('setSize');
    wrap('setPixelRatio');
    return {
      stop() {
        for (const n of names) delete gl[n];
        for (const k of ['width', 'height']) delete cv[k];
        delete r.setSize;
        delete r.setPixelRatio;
        return seen;
      },
    };
  },
};
// What the checks of the depth of field read the page's world with, apart from the
// chain: where a pixel of the canvas looks at the car's body and at the land.
window.__g = {
  THREE: null,
  async init() {
    if (!this.THREE) this.THREE = await import('three');
    return true;
  },
  // The ray through the middle of the canvas's pixel (x, y) (from the top left), and how
  // far along the lens's axis a point is for each unit along the ray.
  ray(x, y) {
    const T = this.THREE;
    const cam = game.camera;
    cam.updateMatrixWorld();
    const raycaster = new T.Raycaster();
    raycaster.setFromCamera(new T.Vector2((x + 0.5) / game.canvas.width * 2 - 1, 1 - (y + 0.5) / game.canvas.height * 2), cam);
    return { raycaster, along: raycaster.ray.direction.dot(cam.getWorldDirection(new T.Vector3())) };
  },
  // How far along the lens's axis the car's body is at that pixel (what is opaque of it), or null.
  car(x, y) {
    const { raycaster, along } = this.ray(x, y);
    const solid = (h) => {
      const m = h.object.material;
      return h.object.visible && !(Array.isArray(m) ? m.some((k) => k.transparent) : m && m.transparent);
    };
    const hits = raycaster.intersectObject(game.presentation.root, true).filter(solid);
    return hits.length ? hits[0].distance * along : null;
  },
  // The pixels of the canvas the car covers, in a box of it ([x0, y0, x1, y1]): where the ray through the
  // middle of a pixel (one in 3 across and down, and the square of 3 it stands for the same) meets a part of
  // the car that is shown and is not a glow: its body and its glass, not its shadow, nor what its lamps
  // light of the road.
  mask(box) {
    const T = this.THREE;
    const W = game.canvas.width;
    const H = game.canvas.height;
    const out = new Uint8Array(W * H);
    const one = (k) => k.blending !== T.AdditiveBlending && !(k.transparent && k.opacity < 0.05);
    const shown = (h) => {
      const m = h.object.material;
      return h.object.visible && (Array.isArray(m) ? m.every(one) : !m || one(m));
    };
    for (let y = Math.max(0, box[1]); y < Math.min(H, box[3]); y += 3) {
      for (let x = Math.max(0, box[0]); x < Math.min(W, box[2]); x += 3) {
        const { raycaster } = this.ray(x + 1, y + 1);
        if (!raycaster.intersectObject(game.presentation.root, true).some(shown)) continue;
        for (let j = 0; j < 3 && y + j < H; j++) {
          for (let i = 0; i < 3 && x + i < W; i++) out[(y + j) * W + x + i] = 1;
        }
      }
    }
    return out;
  },
  // How far along the lens's axis the land (and the water) is there, found by walking the ray
  // to where it goes under the ground, or null where it never does.
  land(x, y) {
    const { raycaster, along } = this.ray(x, y);
    const d = raycaster.ray.direction;
    const c = game.camera.position;
    const o = game.road.origin;
    const under = (s) => {
      const qx = c.x + d.x * s;
      const qz = c.z + d.z * s;
      const h = game.corridor.heightAt(qx + o.x, qz + o.z);
      const w = game.land.waterLevel(qx + o.x, qz + o.z);
      return c.y + d.y * s < (Number.isFinite(w) ? Math.max(h, w) : h);
    };
    let before = 1;
    for (let s = 20; s < 14000; s *= 1.004) {
      if (under(s)) {
        let lo = before;
        let hi = s;
        for (let i = 0; i < 40; i++) {
          const m = (lo + hi) / 2;
          if (under(m)) hi = m; else lo = m;
        }
        return hi * along;
      }
      before = s;
    }
    return null;
  },
};`;

const KEYS = {
  KeyK: { key: 'k', windowsVirtualKeyCode: 75 }, KeyP: { key: 'p', windowsVirtualKeyCode: 80 }, KeyC: { key: 'c', windowsVirtualKeyCode: 67 },
  KeyR: { key: 'r', windowsVirtualKeyCode: 82 }, KeyN: { key: 'n', windowsVirtualKeyCode: 78 }, KeyH: { key: 'h', windowsVirtualKeyCode: 72 },
  KeyW: { key: 'w', windowsVirtualKeyCode: 87 }, KeyA: { key: 'a', windowsVirtualKeyCode: 65 }, KeyS: { key: 's', windowsVirtualKeyCode: 83 },
  KeyD: { key: 'd', windowsVirtualKeyCode: 68 }, KeyQ: { key: 'q', windowsVirtualKeyCode: 81 }, KeyE: { key: 'e', windowsVirtualKeyCode: 69 },
  KeyZ: { key: 'z', windowsVirtualKeyCode: 90 }, KeyX: { key: 'x', windowsVirtualKeyCode: 88 }, Enter: { key: 'Enter', windowsVirtualKeyCode: 13 },
  Escape: { key: 'Escape', windowsVirtualKeyCode: 27 },
  ArrowLeft: { key: 'ArrowLeft', windowsVirtualKeyCode: 37 }, ArrowRight: { key: 'ArrowRight', windowsVirtualKeyCode: 39 },
};
const open = new Set();
const profiles = [];
let opened = 0;

// A page in Chrome, driven over the DevTools protocol.
// on: the ANGLE backend to draw on the GPU with (as tools/look.mjs does); none, the software renderer.
async function openPage({ size = [640, 360], languages = ['zh-CN'], on = GPU ? angle : null } = {}) {
  const profile = `${tmpdir()}/continuum-photo-${process.pid}-${++opened}`;
  profiles.push(profile);
  const how = on
    ? ['--ignore-gpu-blocklist', '--enable-gpu', `--use-angle=${on}`, '--disable-gpu-vsync', '--disable-frame-rate-limit']
    : ['--disable-gpu', '--enable-unsafe-swiftshader'];
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', ...how, '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', `--window-size=${size[0]},${size[1] + (on ? 143 : 0)}`, '--remote-debugging-port=0',
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
  // A page in a tab that is not in front is hidden and draws no frames.
  const tidy = async () => {
    const list = await (await fetch(`http://${devtools.host}/json/list`)).json();
    for (const x of list) {
      if (x.type === 'page' && x.id !== target.id) await fetch(`http://${devtools.host}/json/close/${x.id}`);
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
    const timer = setTimeout(() => { pending.delete(n); reject(new Error(`${method}: no answer in 600 s`)); }, 600000);
    pending.set(n, [(v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); }]);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  // The page is this size, exactly (a window of this size has less room in it than that).
  await send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(navigator, 'languages', { get: () => ${JSON.stringify(languages)} });
      Object.defineProperty(navigator, 'language', { get: () => ${JSON.stringify(languages[0])} });
      ${PRELUDE}`,
  });

  // In the page: a value (JSON), or an error thrown.
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const page = {
    ev,
    errors,
    // The page in front, and no other tab of the browser: a page that is not
    // is hidden and draws no frames.
    front: tidy,
    // A function of the page's own, with an argument: its answer.
    run: (fn, arg) => ev(`(${fn})(${JSON.stringify(arg === undefined ? null : arg)})`),
    async goto(query, ready = 'window.game && game.carLoaded && game.frame > 2 && window.ui') {
      const before = await ev('performance.timeOrigin').catch(() => 0);
      await tidy();
      await send('Page.navigate', { url: `http://localhost:${PORT}/index.html?${query}` });
      const t0 = Date.now();
      for (let n = 0; ; n++) {
        await sleep(500);
        const up = await ev('(performance.timeOrigin !== ' + before + ' && ' + ready + ') ? "up" : (document.title.startsWith("GAME_FAIL") ? document.title : (document.hidden ? "hidden" : "no"))').catch(() => 'no');
        if (up === 'up') break;
        if (String(up).startsWith('GAME_FAIL')) throw new Error(up);
        if (up === 'hidden' || n % 20 === 19) await tidy().catch(() => 0);
        if (Date.now() - t0 > 300000) throw new Error('the page never came up');
      }
      // On the GPU, the page is drawn by one: a page the software renderer drew is no answer.
      if (GPU) {
        page.gpu = String(await ev(GAME_RENDERER).catch(() => ''));
        if (!page.gpu || /SwiftShader/i.test(page.gpu)) throw noGPU(`the page was drawn by ${page.gpu || 'no renderer'}`);
      }
    },
    // The page of a headless run: it is up when it says it is done.
    goRun(query) {
      return page.goto(query, 'window.game && document.title === "GAME_DONE"');
    },
    async keyDown(code, modifiers = 0) {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...KEYS[code], nativeVirtualKeyCode: KEYS[code].windowsVirtualKeyCode, code, modifiers });
    },
    async keyUp(code, modifiers = 0) {
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEYS[code], nativeVirtualKeyCode: KEYS[code].windowsVirtualKeyCode, code, modifiers });
    },
    async key(code, modifiers = 0) {
      await page.keyDown(code, modifiers);
      await page.keyUp(code, modifiers);
    },
    async mouse(type, x, y, extra = {}) {
      await send('Input.dispatchMouseEvent', { type, x, y, ...extra });
    },
    // Where the canvas's middle is, in the page's own pixels.
    async middle() {
      return ev(`(() => { const r = game.canvas.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    },
    async shot(name) {
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

// --- functions that run in the page -------------------------------------------

// Going in: where the world stands, the frame on the screen, and what the
// page does about it.
function goIn() {
  const g = game;
  const t = window.__t;
  const before = { car: t.car(), cam: g.camera.position.toArray(), fov: g.camera.fov };
  const entered = g.photo.enter();
  g.photo.frame(1 / 60);
  window.__a = t.screen();
  const hidden = ['#hud', '#bar', '#brand', '#worldname', '#firsthint'].map((s) => document.querySelector(s)).filter(Boolean)
    .filter((e) => getComputedStyle(e).visibility !== 'hidden').map((e) => e.id);
  const bar = document.getElementById('photobar').getBoundingClientRect();
  return {
    entered, state: g.photo.state, before, size: [g.canvas.width, g.canvas.height], shownStill: hidden,
    barShown: getComputedStyle(document.getElementById('photobar')).display !== 'none' && bar.width > 0,
    bodyClass: document.body.classList.contains('photo'),
  };
}

// The car put on the road at s and run for two and a half seconds, in a style, and
// the lens by it, as tools/look.mjs puts the car at a place (the other cars and
// the animals are left in the frame here).
function putAtPlace(arg) {
  const g = game;
  if (g.style.id !== arg.style) {
    g.style.set(arg.style, true);
    g.style.applyScene();
  }
  const p = g.road.at(arg.s);
  if (!p) return { missing: true };
  g.autoMode = true;
  g.sCar = arg.s;
  g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(arg.s, 1.9) + 0.3);
  g.car.vx = 22;
  g.setCamera('chase');
  g.chase.shaking = false;
  g.chase.lead = false;
  g.chase.snapTo(g.car, g.car.y || 0);
  g.style.wind[0] = 1000;
  g.style.wind[1] = 400;
  g.atmosphere.uniforms.uTime.value = 100;
  for (let i = 0; i < 150; i++) {
    g.pilot.vMax = 22;
    g.update(1 / 60);
  }
  g.post.setStyle(g.style);
  g.atmosphere.bakeEnvironment();
  return { style: g.style.id, world: g.worldHere().id, sky: g.worldHere().sky, s: Math.round(g.sCar) };
}

// The frame the lens stood at on going in: as a picture, and how much is in it.
function theFrame() {
  const t = window.__t;
  return { url: t.png(window.__a), ...t.stats(window.__a) };
}

// A second of the wall's clock on: the same frame, and the game's own clock where it was.
function aSecondOn() {
  const g = game;
  const t = window.__t;
  const p = g.photo;
  const was = t.car();
  p.frame(1.0);
  const b = t.screen();
  const same = t.diff(window.__a, b);
  p.frame(0.05);
  const c = t.screen();
  const apart = same.differing ? { ...t.where(window.__a, b), sheet: t.sheet(window.__a, b) } : null;
  return { same, again: t.diff(b, c), stood: t.car().join() === was.join(), car: t.car(), was, frames: p.frames, apart };
}

// The world's own second: out, and the world going for 60 steps. The frame
// is not the one it stood at.
function theWorldGoesOn() {
  const g = game;
  const t = window.__t;
  const p = g.photo;
  p.exit();
  for (let i = 0; i < 20 && p.active; i++) p.frame(0.1);
  for (let i = 0; i < 60; i++) g.update(1 / 60);
  g.render();
  const moved = t.diff(window.__a, t.screen());
  return { moved, active: p.active };
}

// The lens pushed down into the land, the road and the water. (The lens is
// stepped and not drawn: what is read is where it is let be.)
function pushedDown(arg) {
  const g = game;
  const p = g.photo;
  const o = g.road.origin;
  const out = {};
  const hold = (x, y, z, key, frames) => {
    p.lens.place(x, y, z);
    p.lens.press(key);
    for (let i = 0; i < frames; i++) p.lens.step(1 / 60);
    p.lens.release(key);
    return p.lens.p.y;
  };
  if (arg.where === 'land') {
    const pt = g.road.at(g.sCar + 30);
    const x = pt.x - Math.sin(pt.theta) * 40;
    const z = pt.z + Math.cos(pt.theta) * 40;
    const ground = g.corridor.heightAt(x + o.x, z + o.z);
    const sea = g.land.waterLevel(x + o.x, z + o.z);
    out.ground = ground;
    out.wet = Number.isFinite(sea) && sea > ground;
    out.held = hold(x, ground + 6, z, 'KeyQ', 120);
    out.asked = ground - 90;
    p.lens.place(x, out.asked, z);
    p.lens.step(1 / 60);
    out.put = p.lens.p.y;
    out.floor = Math.max(ground, Number.isFinite(sea) ? sea : -Infinity);
  } else if (arg.where === 'road') {
    const s = g.sCar + 20;
    const pt = g.road.at(s);
    const surface = g.road.surfaceAt(s, 0);
    const ground = g.corridor.heightAt(pt.x + o.x, pt.z + o.z);
    out.kind = pt.kind;
    // The road's surface and the land's, the higher; in a bore (kind 2) the road alone.
    out.floor = pt.kind === 2 ? surface : Math.max(surface, ground);
    out.ground = ground;
    out.held = hold(pt.x, surface + 4, pt.z, 'KeyQ', 120);
    out.asked = surface - 60;
    p.lens.place(pt.x, out.asked, pt.z);
    p.lens.step(1 / 60);
    out.put = p.lens.p.y;
  } else {
    // Water: somewhere round the car where the surface stands over the bed.
    let spot = null;
    for (let r = 10; r <= 300 && !spot; r += 10) {
      for (let a = 0; a < 360 && !spot; a += 10) {
        const x = g.car.x + r * Math.cos(a * Math.PI / 180);
        const z = g.car.z + r * Math.sin(a * Math.PI / 180);
        const sea = g.land.waterLevel(x + o.x, z + o.z);
        const ground = g.corridor.heightAt(x + o.x, z + o.z);
        const near = g.road.nearestS(x, z, g.sCar, 800);
        if (Number.isFinite(sea) && sea > ground + 1 && near.dist > 12) spot = { x, z, sea, ground };
      }
    }
    if (!spot) return { found: false };
    out.found = true;
    out.sea = spot.sea;
    out.ground = spot.ground;
    out.floor = spot.sea;
    out.held = hold(spot.x, spot.sea + 6, spot.z, 'KeyQ', 120);
    out.asked = spot.ground - 20;
    p.lens.place(spot.x, out.asked, spot.z);
    p.lens.step(1 / 60);
    out.put = p.lens.p.y;
  }
  return out;
}

// Pushed out from the car, along the road and across it, and let go of at a
// great distance.
function pushedOut() {
  const g = game;
  const p = g.photo;
  const c = g.car;
  const dist = () => Math.hypot(p.lens.p.x - c.x, p.lens.p.y - (c.y || 0), p.lens.p.z - c.z);
  let most = 0;
  const walk = (keys, frames) => {
    for (const k of keys) p.lens.press(k);
    for (let i = 0; i < frames; i++) {
      p.lens.step(1 / 30);
      most = Math.max(most, dist());
    }
    for (const k of keys) p.lens.release(k);
  };
  p.lens.place(c.x, (c.y || 0) + 3, c.z);
  walk(['KeyW', 'ShiftLeft'], 360);
  const ahead = dist();
  walk(['KeyS', 'ShiftLeft'], 720);
  const behind = dist();
  walk(['KeyE', 'ShiftLeft'], 360);
  const above = dist();
  p.lens.place(c.x + 5000, (c.y || 0) + 900, c.z - 7000);
  p.lens.step(1 / 60);
  return { ahead, behind, above, put: dist(), most };
}

// A picture of the frame: against the frame on the screen, and what was drawn
// to make it.
async function aPicture(arg) {
  const g = game;
  const t = window.__t;
  const p = g.photo;
  p.frame(0);
  const screen = t.screen();
  const w = g.canvas.width;
  const h = g.canvas.height;
  // The watch is tried on a frame first: it must see the canvas drawn.
  const tried = t.watch();
  g.render(0);
  const control = tried.stop();
  // A picture, and how long it took: all of it, and the chain drawn at that size
  // and read back (the card has done its part when the pixels are in hand).
  const gl = g.renderer.getContext();
  const timed = async () => {
    const real = g.post.capture;
    let drawn = 0;
    g.post.capture = function (...a) {
      const t0 = performance.now();
      try { return real.apply(this, a); } finally { drawn = performance.now() - t0; }
    };
    const t0 = performance.now();
    try {
      const made = await p.capture({ download: false });
      return { made, ms: performance.now() - t0, drawn };
    } finally {
      g.post.capture = real;
    }
  };
  // On the card: the first picture of the page, with nothing yet made at that size.
  const first = arg && arg.gpu ? await timed() : null;
  while (gl.getError() !== gl.NO_ERROR);
  const watch = t.watch();
  const taken = await timed();
  const seen = watch.stop();
  const shot = taken.made;
  const errors = [];
  for (let e = gl.getError(); e !== gl.NO_ERROR && errors.length < 8; e = gl.getError()) errors.push(e);
  const again = arg && arg.gpu ? await timed() : null;
  const bytes = new Uint8Array(await shot.blob.arrayBuffer());
  const sig = [...bytes.slice(0, 8)].join();
  const dv = new DataView(bytes.buffer);
  const header = [dv.getUint32(16), dv.getUint32(20)];
  const bmp = await createImageBitmap(shot.blob, { colorSpaceConversion: 'none' });
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0);
  const big = x.getImageData(0, 0, c.width, c.height).data;
  // Brought down to the canvas's size: each pixel the mean of the 4 over it.
  let sq = 0;
  let lit = 0;
  let sum = 0;
  const W = bmp.width;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = (j * w + i) * 4;
      let e = 0;
      for (let ch = 0; ch < 3; ch++) {
        const m = (big[((2 * j) * W + 2 * i) * 4 + ch] + big[((2 * j) * W + 2 * i + 1) * 4 + ch]
          + big[((2 * j + 1) * W + 2 * i) * 4 + ch] + big[((2 * j + 1) * W + 2 * i + 1) * 4 + ch]) / 4;
        e += (m - screen[k + ch]) ** 2;
        sum += m;
      }
      sq += e / 3;
      if (big[((2 * j) * W + 2 * i) * 4] + big[((2 * j) * W + 2 * i) * 4 + 1] + big[((2 * j) * W + 2 * i) * 4 + 2] > 24) lit++;
    }
  }
  const mse = sq / (w * h);
  const after = [g.canvas.width, g.canvas.height];
  // For a look at them: the two pictures.
  const toUrl = (data, dw, dh) => {
    const q = document.createElement('canvas');
    q.width = dw;
    q.height = dh;
    q.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), dw, dh), 0, 0);
    return q.toDataURL('image/png');
  };
  return {
    canvas: [w, h], after, picture: [shot.width, shot.height], bitmap: [bmp.width, bmp.height], header, sig, size: shot.size, name: shot.name,
    psnr: mse > 0 ? 10 * Math.log10(255 * 255 / mse) : Infinity, lit: lit / (w * h), mean: sum / (3 * w * h),
    seen, control, sCar: Math.round(g.sCar), wanted: shot.wanted, smaller: shot.smaller,
    errors, lost: gl.isContextLost(), events: window.__lost || [],
    ms: arg && arg.gpu ? { first: [first.ms, first.drawn], again: [again.ms, again.drawn] } : null,
    urls: arg && arg.keep ? { screen: toUrl(screen, w, h), picture: await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(shot.blob); }) } : null,
  };
}

// A picture the card cannot make: asked for one a texel wider than the card has
// as the most of a texture, the targets are not complete, as they are not where
// there is no memory for them. The card gives errors and no exception; what is
// wanted is that the chain says so (throws), is as it was after, and does not
// hand over a picture of nothing.
function pictureThatCannotBe() {
  const g = game;
  const t = window.__t;
  const p = g.photo;
  p.enter();
  p.frame(0);
  const gl = g.renderer.getContext();
  const before = t.screen();
  const chain = () => [g.post.size.x, g.post.size.y, g.post.scale, g.post.zoom, !!g.post._shot];
  const was = chain();
  const limit = g.renderer.capabilities.maxTextureSize;
  while (gl.getError() !== gl.NO_ERROR);
  let threw = null;
  let blank = null;
  try {
    const r = g.post.capture(limit + 1, 64);
    blank = !r.pixels.some((v) => v);
  } catch (e) {
    threw = String(e.message || e).slice(0, 200);
  }
  const errors = [];
  for (let e = gl.getError(); e !== gl.NO_ERROR && errors.length < 8; e = gl.getError()) errors.push(e);
  p.frame(0);
  const same = t.diff(before, t.screen());
  p.exit();
  return { limit, threw, blank, errors, was, now: chain(), same, lost: gl.isContextLost() };
}

// A picture of the page's own, with the largest size made to fail (and then all of
// them): it comes smaller and says so, or says that it could not be taken.
async function pictureThatComesSmaller() {
  const g = game;
  const p = g.photo;
  p.enter();
  p.frame(0);
  const canvas = [g.canvas.width, g.canvas.height];
  const real = g.post.capture;
  const note = () => document.getElementById('photonote').textContent;
  const out = { canvas };
  const fail = (when) => function (w, h) {
    out.asked.push([w, h]);
    if (when(out.asked.length)) throw new Error('simulated: no memory for the targets');
    return real.call(this, w, h);
  };
  out.asked = [];
  g.post.capture = fail((n) => n === 1);
  try {
    const shot = await p.shoot();
    out.first = { size: [shot.width, shot.height], wanted: shot.wanted, smaller: shot.smaller, name: shot.name };
  } catch (e) {
    out.first = { error: e.message };
  }
  out.firstNote = note();
  out.firstAsked = out.asked;
  out.asked = [];
  g.post.capture = fail(() => true);
  try {
    await p.shoot();
    out.all = { made: true };
  } catch (e) {
    out.all = { error: e.message };
  }
  out.allNote = note();
  out.allAsked = out.asked;
  g.post.capture = real;
  const again = await p.capture({ download: false });
  out.again = { size: [again.width, again.height], smaller: again.smaller };
  out.busy = p.busy;
  p.exit();
  return out;
}

// The world run on 60 steps with the lens never let go of: what to be held to.
function control() {
  const g = game;
  const t = window.__t;
  for (let i = 0; i < 60; i++) g.update(1 / 60);
  g.render();
  return { snap: t.snap(), car: t.car() };
}

// The same, with the lens let go of in the middle: moved, a picture taken,
// and let back.
async function viaThePhotoMode(arg) {
  const g = game;
  const t = window.__t;
  const p = g.photo;
  const cam = g.camera;
  const home = { p: cam.position.toArray(), q: cam.quaternion.toArray(), fov: cam.fov };
  const stopped = t.car();
  p.enter();
  const seenIn = t.car();
  p.lens.press('KeyW');
  for (let i = 0; i < 12; i++) p.frame(1 / 60);
  p.lens.release('KeyW');
  p.lens.drag(80, -30, 0.002);
  p.lens.press('KeyZ');
  for (let i = 0; i < 12; i++) p.frame(1 / 60);
  p.lens.release('KeyZ');
  let far = null;
  if (arg.far) {
    // Three hundred metres along the road, and up.
    const pt = g.road.at(g.sCar + 300);
    p.lens.place(pt.x, g.photoFloor(pt.x, pt.z) + 25, pt.z);
    for (let i = 0; i < 10; i++) p.frame(0.1);
    far = p.lens.p.toArray();
  } else {
    // A picture is no change to the world either.
    await p.capture({ download: false });
  }
  const seenOut = t.car();
  p.exit();
  const half = [];
  let elapsed = 0;
  while (p.active && elapsed < 1.5) {
    p.frame(0.1);
    elapsed += 0.1;
    if (half.length < 4) half.push(cam.position.distanceTo({ x: home.p[0], y: home.p[1], z: home.p[2], isVector3: true }));
  }
  const q0 = cam.quaternion.clone();
  q0.set(home.q[0], home.q[1], home.q[2], home.q[3]);
  const back = {
    elapsed,
    metres: Math.hypot(cam.position.x - home.p[0], cam.position.y - home.p[1], cam.position.z - home.p[2]),
    degrees: 2 * Math.acos(Math.min(1, Math.abs(cam.quaternion.dot(q0)))) * 180 / Math.PI,
    fov: Math.abs(cam.fov - home.fov),
    active: p.active,
  };
  const afterExit = t.car();
  const bodyClass = document.body.classList.contains('photo');
  for (let i = 0; i < 60; i++) g.update(1 / 60);
  g.render();
  return { snap: t.snap(), car: t.car(), stopped, seenIn, seenOut, afterExit, back, half, far, bodyClass };
}

// A bore in the road the page has surveyed: where it begins, and how long it is
// (at least 120 m).
function findBore() {
  const road = game.road;
  let start = null;
  for (let s = 160; s < road.end; s += 10) {
    const p = road.at(s);
    if (!p) break;
    if (p.kind === 2) {
      if (start === null) start = s;
      if (s - start >= 120) return { start, length: s - start };
    } else {
      start = null;
    }
  }
  return null;
}

// In the bore, with the car in it: the lens is held by the road under it and the
// vault over it (not by the hill over the vault), the frame's light is the
// bore's where the lens is in it and the open air's where it is not, and none of
// it is kept (the eye and the car's own light are as they were).
function inTheBore() {
  const g = game;
  const p = g.photo;
  const o = g.road.origin;
  const kept = { camIn: g.camInTunnel, eye: g.eye, carIn: g.inTunnel };
  p.enter();
  const look = g.atmosphere.look;
  const s = g.sCar;
  const pt = g.road.at(s);
  const surface = g.road.surfaceAt(s, 0);
  const vault = g.ceilingAt(pt.x, pt.z);
  const hill = g.corridor.heightAt(pt.x + o.x, pt.z + o.z);
  const light = () => ({ sun: g.atmosphere.sun.intensity / look.sunIntensity, exposure: g.post.exposure / (look.exposure || 1) });
  const out = { surface, vault, hill, kind: pt.kind, shut: g.ceilingAt(g.camera.position.x, g.camera.position.z) !== null, within: light() };
  const hold = (y, key, frames) => {
    p.lens.place(pt.x, y, pt.z);
    p.lens.press(key);
    for (let i = 0; i < frames; i++) p.lens.step(1 / 30);
    p.lens.release(key);
    return p.lens.p.y;
  };
  out.down = hold(surface + 2, 'KeyQ', 120);
  out.up = hold(surface + 2, 'KeyE', 120);
  // Over the hill, in the open air: the frame is the open air's.
  p.lens.place(pt.x, hill + 12, pt.z);
  p.frame(0);
  out.over = { y: p.lens.p.y, ...light() };
  // Back in the bore, drawn once more: the bore's light again.
  p.lens.place(pt.x, surface + 2, pt.z);
  p.frame(0);
  out.again = light();
  out.kept = { camIn: g.camInTunnel === kept.camIn, eye: g.eye === kept.eye, carIn: g.inTunnel === kept.carIn };
  return out;
}

// Under the cavern's roof: pushed up as far as it will go, the lens stops
// under the roof.
function underTheRoof() {
  const g = game;
  const p = g.photo;
  const o = g.road.origin;
  p.enter();
  p.lens.place(g.car.x, (g.car.y || 0) + 3, g.car.z);
  p.lens.press('KeyE');
  p.lens.press('ShiftLeft');
  for (let i = 0; i < 300; i++) p.lens.step(1 / 30);
  const roof = g.ceiling.roofAt(p.lens.p.x + o.x, p.lens.p.z + o.z);
  return { y: p.lens.p.y, roof, reach: p.lens.p.y - (g.car.y || 0) };
}

// In the deep sea, where the car is under the surface: the surface is not the
// ground for the lens, and it stops over the sea bed when it is pushed down.
function underTheSea() {
  const g = game;
  const p = g.photo;
  const o = g.road.origin;
  p.enter();
  const level = g.land.waterLevel(g.car.x + o.x, g.car.z + o.z);
  p.lens.place(g.car.x, (g.car.y || 0) + 3, g.car.z);
  p.lens.press('KeyQ');
  for (let i = 0; i < 120; i++) p.lens.step(1 / 60);
  p.lens.release('KeyQ');
  const x = p.lens.p.x;
  const z = p.lens.p.z;
  return { wet: p.wet, level, y: p.lens.p.y, bed: g.photoFloor(x, z, false), ground: g.groundAt(x, z), carY: g.car.y };
}

// --- the depth of field and the exposure compensation ---------------------------

// One page in the photo mode, at the chase camera's place in the hills (seed 7): the
// frame with nothing laid on it and the car's place in it (what the rays of the lens meet
// of the car, and what changes when it is put away); the same frame at +1 and -1 EV; then
// the depth of field, built and turned on, a tap on the car at f/2, and what that does to
// the car, to what is far away and to the line across the car's edge; the same line with a
// narrower field, where more of what is round the car is blurred; a tap on the far hills,
// on the bar and a press that is dragged; and the frame with it off again. It returns what
// it read.
async function depthTrials() {
  const g = game;
  const t = window.__t;
  const p = g.photo;
  const post = g.post;
  await window.__g.init();
  const W = g.canvas.width;
  const H = g.canvas.height;
  const N = W * H;
  const out = { style: g.style.id, size: [W, H] };
  const frame = () => {
    p.frame(0);
    return t.screen();
  };
  const calls = () => g.renderer.info.render.calls;
  const programs = () => g.renderer.info.programs.length;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const lin = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    lin[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  // OKLab's L of each pixel (as tools/look.mjs reads a frame), and the mean size of its
  // Laplacian within a mask, where a pixel counts when it and its four neighbours are in it (look.mjs: micro).
  const lightness = (d) => {
    const L = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const r = lin[d[i * 4]];
      const gr = lin[d[i * 4 + 1]];
      const b = lin[d[i * 4 + 2]];
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * gr + 0.0514459929 * b);
      const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * gr + 0.1073969566 * b);
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * gr + 0.6299787005 * b);
      L[i] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    }
    return L;
  };
  const micro = (L, mask) => {
    let sum = 0;
    let n = 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (!mask[i] || !mask[i - 1] || !mask[i + 1] || !mask[i - W] || !mask[i + W]) continue;
        sum += Math.abs(4 * L[i] - L[i - 1] - L[i + 1] - L[i - W] - L[i + W]);
        n++;
      }
    }
    return n > 200 ? { micro: sum / n, pixels: n } : null;
  };
  const lum = (d, i) => 0.2126 * lin[d[i * 4]] + 0.7152 * lin[d[i * 4 + 1]] + 0.0722 * lin[d[i * 4 + 2]];
  const luma = (d, x, y) => {
    const i = y * W + x;
    return 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
  };
  const erode = (mask, times) => {
    let m = mask;
    for (let k = 0; k < times; k++) {
      const e = new Uint8Array(N);
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          e[i] = m[i] && m[i - 1] && m[i + 1] && m[i - W] && m[i + W] ? 1 : 0;
        }
      }
      m = e;
    }
    return m;
  };
  const percentile = (v, q) => {
    const s = [...v].sort((a, b) => a - b);
    return s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] : null;
  };
  // (The bar is there once the mode is on.)
  const barBox = () => document.getElementById('photobar').getBoundingClientRect();
  const underTheBar = (x, y) => {
    const bar = barBox();
    return x >= bar.left - 2 && x <= bar.right + 2 && y >= bar.top - 2 && y <= bar.bottom + 2;
  };
  // The car in a frame (drawn with the depth of field off): the frame, and the frame with the car put away,
  // tell where it changes the picture; the rays of the lens, where its body and glass are (not its shadow, not
  // the light its lamps throw on the road, which change the picture too). The pixels both say are the car's;
  // the core is those with their neighbours; the pixel to tap is a point of the opaque body nearest the middle.
  const theCar = (off) => {
    p.hideCar(true);
    const gone = frame();
    p.hideCar(false);
    frame();
    const changed = new Uint8Array(N);
    let moved = 0;
    let x0 = W;
    let y0 = H;
    let x1 = 0;
    let y1 = 0;
    for (let i = 0; i < N; i++) {
      if (off[i * 4] === gone[i * 4] && off[i * 4 + 1] === gone[i * 4 + 1] && off[i * 4 + 2] === gone[i * 4 + 2]) continue;
      changed[i] = 1;
      moved++;
      x0 = Math.min(x0, i % W);
      x1 = Math.max(x1, i % W);
      y0 = Math.min(y0, Math.floor(i / W));
      y1 = Math.max(y1, Math.floor(i / W));
    }
    const result = { moved, pixels: 0, mask: null, core: null, at: null };
    if (moved < 400) return result;
    const rays = window.__g.mask([x0 - 4, y0 - 4, x1 + 5, y1 + 5]);
    const mask = new Uint8Array(N);
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < N; i++) {
      if (!(rays[i] && changed[i])) continue;
      mask[i] = 1;
      result.pixels++;
      sx += i % W;
      sy += Math.floor(i / W);
    }
    if (result.pixels < 400) return result;
    const core = erode(mask, 2);
    const candidates = [];
    for (let i = 0; i < N; i++) if (core[i]) candidates.push([Math.hypot(i % W - sx / result.pixels, Math.floor(i / W) - sy / result.pixels), i]);
    candidates.sort((a, b) => a[0] - b[0]);
    for (const [, i] of candidates.slice(0, 600)) {
      const x = i % W;
      const y = Math.floor(i / W);
      if (underTheBar(x, y) || window.__g.car(x, y) === null) continue;
      result.at = [x, y];
      break;
    }
    result.mask = mask;
    result.core = core;
    return result;
  };
  // The line across the car's edge, from each pixel outside the car that has the car next to it: the
  // car's side of it is what is 3 to 8 pixels in, the background's what is 6 to 12 out, and it has
  // overshot where, from 2 pixels in to 5 out, it is lighter than both or darker than both. The lines
  // are those that run straight from the car out into what is not the car.
  const edgeLines = (mask) => {
    const inCar = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;
    const lines = [];
    for (let y = 12; y < H - 12; y += 2) {
      for (let x = 12; x < W - 12; x += 2) {
        if (inCar(x, y)) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!inCar(x + dx, y + dy)) continue;
          const ox = -dx;
          const oy = -dy;
          let straight = true;
          for (let s = 3; s <= 8 && straight; s++) straight = inCar(x - ox * s, y - oy * s);
          for (let s = 0; s <= 12 && straight; s++) straight = !inCar(x + ox * s, y + oy * s);
          if (straight) lines.push([x, y, ox, oy]);
          break;
        }
      }
    }
    return lines;
  };
  const overshoot = (d, x, y, ox, oy) => {
    let carLo = Infinity;
    let carHi = -Infinity;
    let bgLo = Infinity;
    let bgHi = -Infinity;
    for (let s = 3; s <= 8; s++) {
      const v = luma(d, x - ox * s, y - oy * s);
      carLo = Math.min(carLo, v);
      carHi = Math.max(carHi, v);
    }
    for (let s = 6; s <= 12; s++) {
      const v = luma(d, x + ox * s, y + oy * s);
      bgLo = Math.min(bgLo, v);
      bgHi = Math.max(bgHi, v);
    }
    const lo = Math.min(carLo, bgLo);
    const hi = Math.max(carHi, bgHi);
    let worst = 0;
    for (let s = -2; s <= 5; s++) {
      const v = luma(d, x + ox * s, y + oy * s);
      worst = Math.max(worst, v - hi, lo - v);
    }
    return worst / 255;
  };
  // The lines whose background the depth of field changed (what is 4 to 12 pixels out is two levels of luma
  // different, on the mean, from the frame without it): where it has blurred what is next to the car.
  const haloOf = (off, on, lines) => {
    const was = lines.map(([x, y, ox, oy]) => overshoot(off, x, y, ox, oy));
    const now = lines.map(([x, y, ox, oy]) => overshoot(on, x, y, ox, oy));
    const blurred = [];
    lines.forEach(([x, y, ox, oy], k) => {
      let sum = 0;
      for (let s = 4; s <= 12; s++) sum += Math.abs(luma(on, x + ox * s, y + oy * s) - luma(off, x + ox * s, y + oy * s));
      if (sum / 9 >= 2) blurred.push(k);
    });
    return {
      lines: lines.length, blurred: blurred.length,
      off: [percentile(was, 0.95), Math.max(...was)], on: [percentile(now, 0.95), Math.max(...now)],
      blurredOff: blurred.length ? [percentile(blurred.map((i) => was[i]), 0.95), Math.max(...blurred.map((i) => was[i]))] : null,
      blurredOn: blurred.length ? [percentile(blurred.map((i) => now[i]), 0.95), Math.max(...blurred.map((i) => now[i]))] : null,
    };
  };
  p.enter();
  out.lens = { fov: g.camera.fov };

  // Nothing laid on the frame.
  const off = frame();
  out.off = { calls: calls(), programs: programs(), enabled: post.dof.enabled, ev: post.ev };
  const exposure = () => post.final.uniforms.uExposure.value;
  const base = exposure();

  const car = theCar(off);
  out.car = { moved: car.moved, pixels: car.pixels, at: car.at };
  if (!car.at) return out;
  const [px, py] = car.at;
  out.car.underTheBar = underTheBar(px, py);

  // The exposure compensation: +1 and -1 EV, the frame lit by twice and by half the light.
  p.setEv(1);
  const up = frame();
  const exposed = exposure();
  p.setEv(-1);
  const down = frame();
  const dimmed = exposure();
  p.setEv(0);
  frame();
  // The share of the frame's linear light after over before, over the pixels that are not over-exposed (none
  // of whose channels is over 250 of 255), as it is shown.
  const light = (a, b, keep) => {
    let sa = 0;
    let sb = 0;
    let n = 0;
    for (let i = 0; i < N; i++) {
      if (!keep(i)) continue;
      sa += lum(a, i);
      sb += lum(b, i);
      n++;
    }
    return { ratio: sb / sa, pixels: n / N };
  };
  const over = (d, i) => Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) > 250;
  // The same with what the final pass did undone, in the order it did it: the vignette, the tint (which goes
  // with the pixel's own light: cool in the shadows, warm in the lights; render/post.js, FinalShader), the contrast,
  // the saturation, and the sRGB curve: what is left is the light the tone curve gave out. Where the curve is
  // the painted style's (a line under 0.62), the light of the pixels under that is the light the pass was
  // given, times the exposure; with ACES, undone as well (Narkowicz's fit is a quadratic that is solved), it is
  // that for every pixel that is not at the top.
  const g1 = post.final.uniforms;
  const smooth = (a, b, x) => {
    const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return k * k * (3 - 2 * k);
  };
  const srgb = (v) => (v <= 0.04045 ? v / 12.92 : ((Math.max(v, 0) + 0.055) / 1.055) ** 2.4);
  const tone = (d) => {
    const out3 = new Float32Array(N * 3);
    const contrast = g1.uContrast.value;
    const saturation = g1.uSaturation.value;
    for (let i = 0; i < N; i++) {
      const x = (i % W + 0.5) / W - 0.5;
      const y = (Math.floor(i / W) + 0.5) / H - 0.5;
      const v = 255 * (1 - g1.uVignette.value * (x * x + y * y) * 2);
      const r = d[i * 4] / v;
      const gr = d[i * 4 + 1] / v;
      const b = d[i * 4 + 2] / v;
      let l = 0.2126 * r + 0.7152 * gr + 0.0722 * b;
      let r1 = r;
      let g1c = gr;
      let b1 = b;
      for (let it = 0; it < 6; it++) {
        const k = smooth(0.15, 0.85, l);
        r1 = (r / (0.96 + 0.07 * k) - 0.5) / contrast + 0.5;
        g1c = (gr / (0.99 + 0.02 * k) - 0.5) / contrast + 0.5;
        b1 = (b / (1.04 - 0.07 * k) - 0.5) / contrast + 0.5;
        l = 0.2126 * r1 + 0.7152 * g1c + 0.0722 * b1;
      }
      out3[i * 3] = srgb(l + (r1 - l) / saturation);
      out3[i * 3 + 1] = srgb(l + (g1c - l) / saturation);
      out3[i * 3 + 2] = srgb(l + (b1 - l) / saturation);
    }
    return out3;
  };
  const aces = (y) => {
    const A = 2.51;
    const B = 0.03;
    const C = 2.43;
    const D = 0.59;
    const E = 0.14;
    const qa = C * y - A;
    const qb = D * y - B;
    const qc = E * y;
    return qa === 0 ? -qc / qb : (-qb - Math.sqrt(Math.max(0, qb * qb - 4 * qa * qc))) / (2 * qa);
  };
  const painted = g1.uCurve.value >= 0.5;
  const top = painted ? 0.62 : 0.97;
  const toned = (a, b, ref) => {
    let sa = 0;
    let sb = 0;
    let n = 0;
    for (let i = 0; i < N; i++) {
      if (Math.max(ref[i * 3], ref[i * 3 + 1], ref[i * 3 + 2]) > top) continue;
      const f = (y3, ch) => (painted ? y3[i * 3 + ch] : aces(y3[i * 3 + ch]));
      sa += 0.2126 * f(a, 0) + 0.7152 * f(a, 1) + 0.0722 * f(a, 2);
      sb += 0.2126 * f(b, 0) + 0.7152 * f(b, 1) + 0.0722 * f(b, 2);
      n++;
    }
    return { ratio: sb / sa, pixels: n / N };
  };
  const y0 = tone(off);
  const yUp = tone(up);
  const yDown = tone(down);
  out.ev = {
    raw: { up: light(off, up, (i) => !over(up, i)), down: light(off, down, (i) => !over(off, i)) },
    tone: { curve: painted ? 'painted' : 'ACES', up: toned(y0, yUp, yUp), down: toned(y0, yDown, y0) },
    uniform: [exposed / base, dimmed / base],
    back: exposure() / base,
    pictures: { up: t.png(up), down: t.png(down) },
  };

  // The depth of field: asked for, it is built before it is on.
  const before = programs();
  const asked = p.setDepth(true);
  out.warm = { atOnce: post.dof.enabled };
  out.live = await asked;
  out.warm.after = post.dof.enabled;
  out.warm.built = programs() - before;
  out.first = { focus: p.focus, car: window.__g.car(px, py) };

  // What is how far, from picks on a grid over the frame.
  const cols = 32;
  const rows = 18;
  const grid = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) grid.push(post.pickDistance((i + 0.5) / cols, 1 - (j + 0.5) / rows));
  }
  out.depth = { read: grid.filter(Number.isFinite).length, of: grid.length };
  // What is between 300 m and 3 km away (the cells of the grid).
  const faraway = new Uint8Array(N);
  let farCells = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const d = grid[j * cols + i];
      if (!(d >= 300 && d <= 3000)) continue;
      farCells++;
      for (let y = Math.floor(j * H / rows); y < Math.floor((j + 1) * H / rows); y++) {
        for (let x = Math.floor(i * W / cols); x < Math.floor((i + 1) * W / cols); x++) faraway[y * W + x] = 1;
      }
    }
  }
  out.depth.cells = farCells;

  // f/2, a tap on the car, and the frame.
  p.setAperture(2);
  const mark = document.getElementById('focusmark');
  const took = p.tap(px + 0.5, py + 0.5);
  out.tap = {
    took, focus: p.focus, want: window.__g.car(px, py), marked: mark.classList.contains('show'),
    at: [parseFloat(mark.style.left), parseFloat(mark.style.top)],
  };
  const on = frame();
  out.on = { calls: calls(), enabled: post.dof.enabled, ready: post.dof.ready, aperture: post.dof.aperture, focus: post.dof.focus };

  // What it does to the car and to what is far away.
  const Loff = lightness(off);
  const Lon = lightness(on);
  out.micro = { car: [micro(Loff, car.core), micro(Lon, car.core)], far: [micro(Loff, faraway), micro(Lon, faraway)] };
  const lines = edgeLines(car.mask);
  const halo = haloOf(off, on, lines);
  out.halo = { lines: halo.lines, blurred: halo.blurred, off: halo.off, on: halo.on, blurredOff: halo.blurredOff, blurredOn: halo.blurredOn };
  out.pictures = { off: t.png(off), on: t.png(on) };
  // The same at the other apertures (told): what the car keeps and what is far away has, of what they had.
  out.ladder = {};
  for (const n of [1.4, 2.8, 16]) {
    p.setAperture(n);
    const L = lightness(frame());
    out.ladder[n] = { car: micro(L, car.core).micro / out.micro.car[0].micro, far: micro(L, faraway).micro / out.micro.far[0].micro };
  }
  p.setAperture(2);
  frame();

  // Two frames a second apart with it on.
  p.frame(1.0);
  const later = t.screen();
  p.frame(0.05);
  out.frozen = { same: t.diff(on, later), again: t.diff(later, t.screen()) };

  // A tap on the far hills, on the bar, a press dragged, and a tap of the right button.
  let farCell = -1;
  for (let k = 0; k < grid.length; k++) {
    if (Number.isFinite(grid[k]) && grid[k] < 13000 && (farCell < 0 || grid[k] > grid[farCell])) farCell = k;
  }
  if (farCell >= 0) {
    const fx = Math.floor(((farCell % cols) + 0.5) / cols * W);
    const fy = Math.floor((Math.floor(farCell / cols) + 0.5) / rows * H);
    const tookFar = p.tap(fx + 0.5, fy + 0.5);
    out.far = { took: tookFar, focus: p.focus, grid: grid[farCell], want: window.__g.land(fx, fy), at: [fx, fy] };
  }
  p.tap(px + 0.5, py + 0.5);
  const kept = p.focus;
  const bar = barBox();
  out.bar = { took: p.tap(bar.left + bar.width / 2, bar.top + bar.height / 2), same: p.focus === kept, width: bar.width };
  // The mark stood where the tap was, and is gone after a little while.
  await pause(1500);
  out.tap.gone = !mark.classList.contains('show');
  out.tap.opacity = parseFloat(getComputedStyle(mark).opacity);

  // Off again: the frame is the one it was, and it draws what it drew.
  await p.setDepth(false);
  const offAgain = frame();
  out.offAgain = { same: t.diff(off, offAgain), calls: calls(), enabled: post.dof.enabled, ready: post.dof.ready, depthOn: p.depthOn };

  // A narrower field (35 degrees): the car is smaller and more of what is round it is blurred at f/2,
  // which is where a halo would be, if the blur had one.
  p.lens.fov = 35;
  p.lens.fovTo = 35;
  const narrow = frame();
  const car35 = theCar(narrow);
  out.narrow = { fov: g.camera.fov, moved: car35.moved, pixels: car35.pixels };
  if (car35.at) {
    await p.setDepth(true);
    p.setAperture(2);
    p.tap(car35.at[0] + 0.5, car35.at[1] + 0.5);
    const narrowOn = frame();
    const h = haloOf(narrow, narrowOn, edgeLines(car35.mask));
    out.narrow.halo = { lines: h.lines, blurred: h.blurred, off: h.off, on: h.on, blurredOff: h.blurredOff, blurredOn: h.blurredOn };
    out.narrow.micro = { car: [micro(lightness(narrow), car35.core), micro(lightness(narrowOn), car35.core)] };
    await p.setDepth(false);
  }
  return out;
}

// The glass on, in a page that is in the photo mode: the depth of field at the aperture given (on the car)
// and the exposure compensation; resolves when the depth of field is on.
async function glassOn(arg) {
  const g = game;
  const p = g.photo;
  p.enter();
  p.frame(0);
  await p.setDepth(true);
  p.setAperture(arg.aperture);
  p.setEv(arg.ev);
  p.frame(0);
  return { on: g.post.dof.enabled, aperture: g.post.dof.aperture, focus: p.focus, ev: g.post.ev };
}

// The glass off again.
async function glassOff() {
  const p = game.photo;
  await p.setDepth(false);
  p.setEv(0);
  p.setAperture(2.8);
  p.frame(0);
  return { enabled: game.post.dof.enabled, ev: game.post.ev };
}

// --- the scenarios ------------------------------------------------------------

const WORLD_ZH = { hills: '丘陵', river: '河谷' };
const WORLD_EN = { hills: 'Hills', river: 'River' };
const STYLE_ZH = { real: '写实', paint: '手绘' };
const STYLE_EN = { real: 'Real', paint: 'Paint' };

// A world, a style, run as a headless page does, and let go of: the frames, the
// lens's limits, the picture.
async function standing(world, style, { lang = 'zh', limits = [], keep = false, gpu = false, glass = false } = {}) {
  const tag = gpu ? `gpu-${world}-${style}` : `${world}-${style}`;
  const page = await openPage({ size: gpu ? [1920, 1080] : keep ? PICTURE : [640, 360] });
  try {
    await page.goRun(`seed=7&world=${world}&style=${style}&cam=chase&lang=${lang}&run=120`);
    await page.ev(`(() => { window.__lost = []; for (const k of ['webglcontextlost', 'webglcontextrestored']) game.canvas.addEventListener(k, () => window.__lost.push(k)); })()`);
    const inn = await page.run(goIn);
    say(inn.entered && inn.state === 'on' && inn.bodyClass && inn.barShown && !inn.shownStill.length,
      `${tag}: the photo mode goes in (the lens on the canvas ${inn.size.join(' x ')}), the bar is up and the instrument, the buttons, the brand, the name and the hint stand aside${inn.shownStill.length ? ' (still shown: ' + inn.shownStill + ')' : ''}`);
    await sleep(1000);
    const on = await page.run(aSecondOn);
    say(on.same.differing === 0 && on.again.differing === 0 && on.stood,
      `${tag}: a second apart (the wall's clock, a second by the page's own and by the frame's) two frames are the same pixels (${on.same.differing} of ${on.same.of} differ, by ${on.same.max} at most; the frame after, ${on.again.differing}); the game's own clock, frame and car stand (simTime ${f(on.car[5], 3)}, frame ${on.car[6]}, ${on.stood ? 'the car where it was' : 'THE CAR MOVED'})`);
    results[`frozen-${tag}`] = { same: on.same, again: on.again };

    // The picture, of the frame the lens stands at.
    const sh = await page.run(aPicture, { keep: keep || gpu, gpu });
    const expect =`continuum-${lang === 'zh' ? WORLD_ZH[world] : WORLD_EN[world]}-${lang === 'zh' ? STYLE_ZH[style] : STYLE_EN[style]}-${sh.sCar}.png`;
    say(sh.picture[0] === sh.canvas[0] * 2 && sh.picture[1] === sh.canvas[1] * 2 && sh.bitmap.join() === sh.picture.join() && sh.header.join() === sh.picture.join()
      && sh.sig === '137,80,78,71,13,10,26,10',
    `${tag}: the picture is a PNG of ${sh.picture.join(' x ')}, twice the canvas (${sh.canvas.join(' x ')}) (${(sh.size / 1024).toFixed(0)} KiB)`);
    say(sh.lit > 0.5 && sh.mean > 20, `${tag}: and it is not black (${f(sh.lit * 100, 1)}% of it lit, mean ${f(sh.mean, 1)} of 255)`);
    say(sh.psnr >= 30, `${tag}: brought down to the canvas's size it is ${f(sh.psnr, 2)} dB (PSNR) from the frame on the screen (30 at least)`);
    say(sh.after.join() === sh.canvas.join() && !sh.seen.writes.length && !sh.seen.setSize && !sh.seen.setPixelRatio && sh.seen.onCanvas === 0 && sh.seen.draws > 20 && sh.control.onCanvas > 0,
      `${tag}: making it, nothing is drawn to the canvas (${sh.seen.onCanvas} of ${sh.seen.draws} draws; a frame drawn the usual way shows ${sh.control.onCanvas} on it, so the watch sees) and no size is written to it (${sh.seen.writes.length} writes, ${sh.seen.setSize} setSize, ${sh.seen.setPixelRatio} setPixelRatio; the canvas is ${sh.after.join(' x ')} after)`);
    say(sh.name === expect, `${tag}: it is called ${sh.name}${sh.name === expect ? '' : ' (wanted ' + expect + ')'}`);
    results[`picture-${tag}`] = { canvas: sh.canvas, picture: sh.picture, psnr: sh.psnr, lit: sh.lit, size: sh.size, name: sh.name, watch: sh.seen, ms: sh.ms, errors: sh.errors, events: sh.events };
    if (gpu) {
      // On the card: the full size at the first try, nothing wrong with the card, and what it took (told, not held).
      const ms = (x) => Math.round(x);
      say(sh.picture.join() === [3840, 2160].join() && !sh.smaller,
        `${tag}: on ${page.gpu}, the picture is the full ${sh.picture.join(' x ')} (twice the ${sh.canvas.join(' x ')} canvas), made at the first try and not at a smaller size than wanted (${sh.wanted.join(' x ')})`);
      say(!sh.errors.length && !sh.lost && !sh.events.length && !page.errors.length,
        `${tag}: the card gave no error (${sh.errors.length ? 'GL errors ' + sh.errors : 'none'}) and lost no context (${sh.lost || sh.events.length ? 'LOST: ' + sh.events : 'not lost, no event'}), the console is clean${page.errors.length ? ' (' + page.errors.slice(0, 2) + ')' : ''}`);
      console.error(`      took, told and not held: the first picture of the page ${ms(sh.ms.first[0])} ms (${ms(sh.ms.first[1])} ms to draw the chain at that size and read it back), the next ${ms(sh.ms.again[0])} ms (${ms(sh.ms.again[1])} ms)`);
    }
    if ((keep || gpu) && sh.urls) {
      mkdirSync(OUT, { recursive: true });
      for (const [k, url] of Object.entries(sh.urls)) writeFileSync(`${OUT}${tag}-${k}.png`, Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64'));
    }
    // The same picture with the depth of field and the compensation on.
    if (glass) await glassPicture(page, tag, { mean: sh.mean, draws: sh.seen.draws }, { gpu, keep });

    // The lens in the land, the road and the water.
    for (const where of limits) {
      const r = await page.run(pushedDown, { where });
      if (r.found === false) {
        say(false, `${tag}: no place with water over its bed within 300 m of the car to push the lens into`);
        continue;
      }
      const lowest = r.floor + 0.3;
      const high = r.held - lowest;
      say(r.held >= lowest - 1e-3 && high < 0.02 && r.put >= lowest - 1e-3 && r.put - lowest < 0.02,
        `${tag}: pushed down into the ${where === 'land' ? 'land' : where === 'road' ? 'road (a ' + ['ground', 'bridge', 'tunnel'][r.kind] + ')' : 'water'} the lens stops ${f(r.held - r.floor, 3)} m over its surface (at least 0.3; ${f(r.floor, 2)} m there) and, put ${f(r.floor - r.asked, 1)} m under it, is brought to ${f(r.put - r.floor, 3)} m over it`);
      results[`push-${tag}-${where}`] = r;
    }
    if (limits.length && limits[0] !== 'water') {
      const r = await page.run(pushedOut);
      say(r.most <= 400 && r.ahead <= 400 && r.behind <= 400 && r.above <= 400 && r.put <= 400 && r.ahead > 399 && r.behind > 399,
        `${tag}: taken out from the car ahead (${f(r.ahead, 2)} m), behind it (${f(r.behind, 2)}) and up (${f(r.above, 2)}) at the Shift's pace for as long as it takes, and put 9 km off (${f(r.put, 2)}), it is never over 400 m from it (${f(r.most, 3)} at most)`);
      results[`reach-${tag}`] = r;
    }

    // And the world going on does move the frame.
    const go = await page.run(theWorldGoesOn);
    say(go.moved.differing > go.moved.of * 0.005 && !go.active,
      `${tag}: out again, a second of the world going on has changed ${f(go.moved.differing / go.moved.of * 100, 1)}% of the pixels of the frame (so the two equal frames were not for want of anything to move)`);
    say(!page.errors.length, `${tag}: the console is clean${page.errors.length ? ' (' + page.errors.slice(0, 2) + ')' : ''}`);
  } finally {
    page.close();
  }
}

// The picture again with the depth of field on at f/2 and half a stop of compensation over: twice the
// canvas, a PNG, not black, within 30 dB of the frame on the screen (which has both too), the
// depth of field drawn into it and the canvas not touched; on the card, the full size or the next
// that it can make (the picture says that it was smaller), and no error from the card.
async function glassPicture(page, tag, plain, { gpu = false, keep = false } = {}) {
  const what = `${tag} with the depth of field at f/2 and +0.5 EV`;
  const on = await page.run(glassOn, { aperture: 2, ev: 0.5 });
  const sh = await page.run(aPicture, { keep: keep || gpu, gpu });
  const twice = sh.picture[0] === sh.canvas[0] * 2 && sh.picture[1] === sh.canvas[1] * 2;
  say(on.on && on.aperture === 2 && on.ev === 0.5 && (gpu || twice) && sh.bitmap.join() === sh.picture.join() && sh.sig === '137,80,78,71,13,10,26,10',
    `${what}: the depth of field is on (f/${on.aperture}, focused at ${f(on.focus, 2)} m) and the picture is a PNG of ${sh.picture.join(' x ')}${twice ? ', twice the canvas (' + sh.canvas.join(' x ') + ')' : ''} (${(sh.size / 1024).toFixed(0)} KiB)`);
  say(sh.lit > 0.5 && sh.mean > plain.mean * 1.05,
    `${what}: it is not black (${f(sh.lit * 100, 1)}% of it lit) and it is lighter than the picture without the compensation (mean ${f(sh.mean, 1)} against ${f(plain.mean, 1)} of 255)`);
  say(sh.psnr >= 30, `${what}: brought down to the canvas's size it is ${f(sh.psnr, 2)} dB (PSNR) from the frame on the screen, which has the depth of field and the compensation too (30 at least)`);
  say(sh.seen.draws >= plain.draws + 6 && sh.after.join() === sh.canvas.join() && !sh.seen.writes.length && !sh.seen.setSize && !sh.seen.setPixelRatio && sh.seen.onCanvas === 0,
    `${what}: the depth of field is drawn into the picture (${sh.seen.draws} draws, ${plain.draws} without it) and nothing is drawn to the canvas (${sh.seen.onCanvas} of them) or written to its size`);
  results[`picture-${tag}-glass`] = { canvas: sh.canvas, picture: sh.picture, psnr: sh.psnr, lit: sh.lit, mean: sh.mean, size: sh.size, watch: sh.seen, ms: sh.ms, errors: sh.errors, smaller: sh.smaller, wanted: sh.wanted };
  if (gpu) {
    const sizes = [[3840, 2160], [2880, 1620], [1920, 1080]];
    const made = sh.picture.join();
    say((made === sizes[0].join() && !sh.smaller) || (sh.smaller && sizes.slice(1).some((s) => s.join() === made)),
      `${what}: on ${page.gpu}, the picture is ${made === sizes[0].join() ? 'the full ' + made : 'SMALLER: ' + made + ', the full ' + sizes[0].join(' x ') + ' could not be made, and the next size that could was made and said to be (smaller: ' + sh.smaller + ')'}`);
    say(!sh.errors.length && !sh.lost && !sh.events.length && !page.errors.length,
      `${what}: the card gave no error (${sh.errors.length ? 'GL errors ' + sh.errors : 'none'}) and lost no context (${sh.lost || sh.events.length ? 'LOST: ' + sh.events : 'not lost, no event'}), the console is clean${page.errors.length ? ' (' + page.errors.slice(0, 2) + ')' : ''}`);
    console.error(`      took, told and not held: ${Math.round(sh.ms.first[0])} ms for the first (${Math.round(sh.ms.first[1])} ms of it to draw the chain at that size and read it back), the next ${Math.round(sh.ms.again[0])} ms (${Math.round(sh.ms.again[1])} ms)`);
  }
  if ((keep || gpu) && sh.urls) {
    mkdirSync(OUT, { recursive: true });
    for (const [k, url] of Object.entries(sh.urls)) writeFileSync(`${OUT}${tag}-glass-${k}.png`, Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64'));
  }
  await page.run(glassOff);
}

// The depth of field and the exposure compensation, in a page of one style: what depthTrials
// read, held to what is asked of them.
async function theGlass(style) {
  const tag = `glass-${style}`;
  const page = await openPage({ size: PICTURE });
  try {
    await page.goRun(`seed=7&world=hills&style=${style}&cam=chase&run=120`);
    const r = await page.run(depthTrials);
    const pct = (x) => `${f(x * 100, 1)}%`;
    const rel = (a, b) => (b ? Math.abs(a / b - 1) : Infinity);
    say(r.car.pixels > 400 && !!r.car.at && !!r.depth,
      `${tag}: the car is in the frame (a field of ${f(r.lens.fov, 1)} degrees; ${r.car.pixels} pixels of its body and glass by the rays of the lens, ${r.car.moved} change when it is put away; a point of its body at ${r.car.at}) and the frame can be read for how far each place is (${r.depth && r.depth.read} of ${r.depth && r.depth.of} places)`);
    if (!r.depth) return;
    results[tag] = { ...r, ev: { ...r.ev, pictures: undefined }, pictures: undefined };
    mkdirSync(OUT, { recursive: true });
    for (const [k, url] of [['off', r.pictures.off], ['dof', r.pictures.on], ['ev+1', r.ev.pictures.up], ['ev-1', r.ev.pictures.down]]) {
      writeFileSync(`${OUT}${tag}-${k}.png`, Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64'));
    }

    // Off, there is nothing of it; asked for, it is built before it is on, and draws six times.
    say(r.off.enabled === false && r.off.ev === 0 && r.warm.atOnce === false && r.live === true && r.warm.after === true && r.warm.built === 6,
      `${tag}: off, the depth of field is not in the frame; asked for, it is not on at once (${r.warm.atOnce}), its ${r.warm.built} programs are built ahead (compileAsync, none before), and it is on when they are (${r.warm.after})`);
    say(r.on.calls - r.off.calls === 6 && r.on.enabled && r.on.ready && r.offAgain.calls === r.off.calls && !r.offAgain.enabled && !r.offAgain.ready && !r.offAgain.depthOn,
      `${tag}: on, a frame is drawn ${r.on.calls - r.off.calls} times more (${r.off.calls} draws, ${r.on.calls} with it); put off again, ${r.offAgain.calls} draws, as before`);
    say(r.offAgain.same.differing === 0,
      `${tag}: and with the depth of field put off again (after the exposure was moved to +1 and -1 EV and back, and the car put away and back) the frame is the one it was (${r.offAgain.same.differing} of ${r.offAgain.same.of} pixels differ)`);

    // Taps.
    say(!!r.first.car && rel(r.first.focus, r.first.car) <= 0.15,
      `${tag}: the first focus is on the car (${f(r.first.focus, 2)} m; the car's body at the pixel the car's middle is at ${f(r.first.car, 2)} m)`);
    say(r.tap.took && rel(r.tap.focus, r.tap.want) <= 0.03 && r.tap.marked && Math.abs(r.tap.at[0] - (r.car.at[0] + 0.5)) < 1 && Math.abs(r.tap.at[1] - (r.car.at[1] + 0.5)) < 1 && r.tap.gone,
      `${tag}: a tap on the car focuses at ${f(r.tap.focus, 3)} m, the distance of the car's body there along the lens's axis (${f(r.tap.want, 3)} m, ${pct(rel(r.tap.focus, r.tap.want))} off, 3% at most); a mark comes where the tap was (${r.tap.at.map((x) => f(x, 1))}) and is gone after a moment (${r.tap.gone ? 'gone' : 'STILL THERE'}; its opacity ${f(r.tap.opacity, 2)})`);
    say(!!r.far && r.far.took && !!r.far.want && rel(r.far.focus, r.far.want) <= 0.08,
      `${tag}: a tap on the far hills (${r.far && r.far.at}) focuses at ${f(r.far && r.far.focus, 0)} m, the distance of the land there (${f(r.far && r.far.want, 0)} m by walking the ray over the ground, ${pct(rel(r.far && r.far.focus, r.far && r.far.want))} off, 8% at most; the grid read ${f(r.far && r.far.grid, 0)} m)`);
    say(r.bar.width > 0 && r.bar.took === false && r.bar.same, `${tag}: a tap on the bar does not focus (it says ${r.bar.took}, and the focus is ${r.bar.same ? 'where it was' : 'MOVED'})`);

    // What it does.
    const carBefore = r.micro.car[0];
    const carAfter = r.micro.car[1];
    const farBefore = r.micro.far[0];
    const farAfter = r.micro.far[1];
    say(!!carBefore && !!carAfter && carAfter.micro >= 0.9 * carBefore.micro,
      `${tag}: at f/2 on the car, the car keeps its detail: ${f(carAfter && carAfter.micro, 5)} against ${f(carBefore && carBefore.micro, 5)} (micro, the mean size of the Laplacian of L; ${f(carAfter && carAfter.micro / carBefore.micro, 3)}, at least 0.9; ${carBefore && carBefore.pixels} pixels)`);
    const ladder = Object.entries(r.ladder).map(([n, v]) => `f/${n}: the car ${f(v.car, 3)}, far ${f(v.far, 3)}`).join('; ');
    say(!!farBefore && !!farAfter && farAfter.micro <= 0.4 * farBefore.micro,
      `${tag}: and what is between 300 m and 3 km away (${r.depth.cells} of the ${r.depth.of} places) has ${f(farAfter && farAfter.micro, 5)} against ${f(farBefore && farBefore.micro, 5)}: ${f(farAfter && farAfter.micro / farBefore.micro, 3)} of it, at most 0.4 (${farBefore && farBefore.pixels} pixels); at the other apertures (told) ${ladder}`);
    // The line across the car's edge: how far it goes over both its sides. The sharp frame has some of that
    // (the car's own edge has a dark trim), so what is held is what the depth of field adds to it.
    const h = r.halo;
    const n = r.narrow && r.narrow.halo;
    say(h.lines >= 40 && h.on[0] <= 0.03 + h.off[0] && !!n && n.blurred >= 8 && n.blurredOn[0] <= 0.03 + n.blurredOff[0] && n.blurredOn[1] <= 0.03 + n.blurredOff[1],
      `${tag}: the line across the car's edge goes over both its sides by ${pct(h.on[0])} of the range at the 95th percentile (most ${pct(h.on[1])}; ${h.lines} lines, ${h.blurred} of which have their background blurred) against ${pct(h.off[0])} (most ${pct(h.off[1])}) without the depth of field; with a field of ${n ? f(r.narrow.fov, 0) : '?'} degrees, which blurs the background of ${n ? n.blurred : '?'} of ${n ? n.lines : '?'} lines, ${n && n.blurred ? pct(n.blurredOn[0]) + ' (most ' + pct(n.blurredOn[1]) + ') against ' + pct(n.blurredOff[0]) + ' (most ' + pct(n.blurredOff[1]) + ')' : 'none'}: the depth of field adds at most 3% to what the sharp frame has, so it makes no halo (the sharp frame has its own: the car's edge is darker than the road and the car beside it${style === 'paint' ? ', and in this style an ink line round it' : ''})`);
    say(r.frozen.same.differing === 0 && r.frozen.again.differing === 0,
      `${tag}: with the depth of field on, two frames a second apart are the same pixels (${r.frozen.same.differing} of ${r.frozen.same.of} differ; the frame after, ${r.frozen.again.differing})`);

    // The compensation.
    const e = r.ev;
    say(Math.abs(e.uniform[0] - 2) < 1e-9 && Math.abs(e.uniform[1] - 0.5) < 1e-9 && e.back === 1,
      `${tag}: the compensation of +1 and -1 EV makes the light the final pass has twice and half (${e.uniform.map((x) => f(x, 6)).join(' and ')}), and back at 0 it is as it was (${e.back})`);
    // As it is shown, the grade bends the light (a contrast about the middle, a tint that goes with the light) and the tone
    // curve is not a line, so the mean of the frame's linear light does not come to 2 and 0.5 of itself; with both undone it does.
    const shown = `as it is shown, over what is not over-exposed, ${f(e.raw.up.ratio, 3)} times at +1 EV (${pct(e.raw.up.pixels)} of the frame) and ${f(e.raw.down.ratio, 3)} times at -1 EV (${pct(e.raw.down.pixels)})`;
    const undone = `with the vignette, tint, contrast and saturation undone${style === 'paint' ? ' and over what is under the knee of the painted curve (0.62, a line)' : ', and the ACES curve undone'}, ${f(e.tone.up.ratio, 3)} times at +1 EV (${pct(e.tone.up.pixels)}) and ${f(e.tone.down.ratio, 3)} times at -1 EV (${pct(e.tone.down.pixels)})`;
    if (style === 'paint') {
      say(Math.abs(e.tone.up.ratio - 2) <= 0.1 && Math.abs(e.tone.down.ratio - 0.5) <= 0.025,
        `${tag}: the frame's mean linear light, ${undone}: 2 and 0.5 within 5% (${shown})`);
    } else {
      // The curve here is ACES: what is shown does not come to 2 and 0.5 (told, and held to a wide range); undone it does.
      say(e.raw.up.ratio > 1.25 && e.raw.up.ratio < 2.1 && e.raw.down.ratio > 0.45 && e.raw.down.ratio < 0.8,
        `${tag}: the frame's mean linear light, ${shown}, which is not 2 and 0.5 (the tone curve is not a line; held to 1.25 to 2.1 and 0.45 to 0.8, with the light the pass has held exactly); ${undone}`);
    }
    say(!page.errors.length, `${tag}: the console is clean${page.errors.length ? ' (' + page.errors.slice(0, 2) + ')' : ''}`);
  } finally {
    page.close();
  }
}

// Where, on the canvas (in pixels from the top left), the car's body is nearest the middle of the
// car's place in the frame: found by looking along the ray of each pixel round it. Null if there is none.
async function carPixel() {
  await window.__g.init();
  const g = game;
  const T = window.__g.THREE;
  const c = g.presentation.root.getWorldPosition(new T.Vector3());
  c.y += 0.7;
  c.project(g.camera);
  const x0 = Math.round((c.x + 1) / 2 * g.canvas.width - 0.5);
  const y0 = Math.round((1 - c.y) / 2 * g.canvas.height - 0.5);
  const bar = document.getElementById('photobar').getBoundingClientRect();
  for (let r = 0; r < 120; r += 2) {
    for (let a = 0; a < 360; a += r ? 30 : 360) {
      const x = Math.round(x0 + r * Math.cos(a * Math.PI / 180));
      const y = Math.round(y0 + r * Math.sin(a * Math.PI / 180));
      if (x < 0 || y < 0 || x >= g.canvas.width || y >= g.canvas.height) continue;
      if (x >= bar.left - 2 && x <= bar.right + 2 && y >= bar.top - 2 && y <= bar.bottom + 2) continue;
      const d = window.__g.car(x, y);
      if (d !== null) return { at: [x, y], distance: d };
    }
  }
  return null;
}

// The glass with a real mouse and real keys on a live page: the switch turns the depth of field
// on (built first, then on), a tap on the frame focuses it (not with it off, not on the bar, not
// by a drag or a tap of the right button) and a mark stands where the tap was and fades, the
// sliders, by their keys, set the aperture and the compensation, and going out puts it all back.
async function byTheGlass() {
  const page = await openPage({ size: [960, 540] });
  try {
    await page.goto('seed=7&auto=0&tier=low');
    await page.front();
    const frames = async (n) => {
      const from = await page.ev('game.photo.frames');
      for (const t0 = Date.now(); (await page.ev('game.photo.frames')) < from + n && Date.now() - t0 < 120000;) {
        await page.front();
        await sleep(150);
      }
    };
    const until = async (expression, ms = 180000) => {
      for (const t0 = Date.now(); Date.now() - t0 < ms;) {
        if (await page.ev(expression)) return true;
        await page.front();
        await sleep(250);
      }
      return false;
    };
    const centre = (selector) => page.ev(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    const press = async (x, y, { button = 'left', buttons = 1, to = null } = {}) => {
      await page.mouse('mouseMoved', x, y);
      await page.mouse('mousePressed', x, y, { button, clickCount: 1, buttons });
      if (to) await page.mouse('mouseMoved', to[0], to[1], { button, buttons });
      await page.mouse('mouseReleased', to ? to[0] : x, to ? to[1] : y, { button, clickCount: 1 });
    };
    const read = () => page.ev(`(() => {
      const $ = (id) => document.getElementById(id);
      const p = game.photo;
      const m = $('focusmark');
      return {
        state: p.state, on: p.depthOn, enabled: game.post.dof.enabled, focus: p.focus, postFocus: game.post.dof.focus,
        f: p.aperture, postF: game.post.dof.aperture, ev: p.ev, postEv: game.post.ev,
        exposure: game.post.final.uniforms.uExposure.value, base: game.post._base,
        pressed: $('btnPhotoDepth').getAttribute('aria-pressed'), disabled: $('rngAperture').disabled, apertureAt: $('rngAperture').value,
        apertureText: $('outAperture').textContent, evAt: $('rngEv').value, evText: $('outEv').textContent,
        mark: { shown: m.classList.contains('show'), at: [parseFloat(m.style.left), parseFloat(m.style.top)] },
        note: $('photonote').textContent, marked: ui.photoBar.marked.length, yaw: p.lens.yaw,
      };
    })()`);

    await page.key('KeyK');
    await frames(3);
    const car = await page.run(carPixel);
    const s0 = await read();
    say(s0.state === 'on' && !s0.on && !s0.enabled && s0.focus === null && s0.disabled && s0.apertureText === 'f/2.8' && s0.evText === '0.0 EV' && s0.pressed === 'false' && !!car,
      `a live page, in the photo mode (the car's body is at ${car && car.at} of the canvas, ${car && f(car.distance, 2)} m): the depth of field is off (the switch ${s0.pressed}, the aperture slider dim and still, f/2.8), the compensation is 0.0 EV`);

    // A tap with the depth of field off does nothing.
    await press(car.at[0] + 0.5, car.at[1] + 0.5);
    await frames(1);
    const s1 = await read();
    say(s1.focus === null && s1.marked === 0 && !s1.mark.shown, `a tap on the car with the depth of field off focuses nothing (focus ${s1.focus}, ${s1.marked} marks)`);

    // The switch.
    const [bx, by] = await centre('#btnPhotoDepth');
    await page.mouse('mouseMoved', bx, by);
    await page.mouse('mousePressed', bx, by, { button: 'left', clickCount: 1, buttons: 1 });
    await page.mouse('mouseReleased', bx, by, { button: 'left', clickCount: 1 });
    const early = await read();
    const live = await until('game.post.dof.enabled');
    await frames(2);
    const s2 = await read();
    say(early.on && early.pressed === 'true' && !early.disabled && live && s2.enabled && s2.focus !== null && s2.note === '点一下画面对焦',
      `the switch (a click) turns the depth of field on: at once the switch is pressed and the aperture slider is free (${early.pressed}, ${early.disabled ? 'dim' : 'free'}), the programs are built and it is on a little after (${live}); the first focus is ${f(s2.focus, 2)} m (the car's body ${car && f(car.distance, 2)} m), and the bar says "${s2.note}"`);

    // A tap on the car.
    await press(car.at[0] + 0.5, car.at[1] + 0.5);
    await frames(1);
    const s3 = await read();
    say(Math.abs(s3.focus / car.distance - 1) <= 0.03 && s3.postFocus === s3.focus && s3.mark.shown && Math.abs(s3.mark.at[0] - (car.at[0] + 0.5)) < 1 && Math.abs(s3.mark.at[1] - (car.at[1] + 0.5)) < 1,
      `a tap with the mouse on the car focuses at ${f(s3.focus, 3)} m (the car's body there ${f(car.distance, 3)} m: ${f(Math.abs(s3.focus / car.distance - 1) * 100, 1)}% off, 3 at most), the chain has it (${f(s3.postFocus, 3)}), and the mark stands at the tap (${s3.mark.at})`);
    await sleep(1600);
    const s4 = await read();
    const faded = await page.ev(`parseFloat(getComputedStyle(document.getElementById('focusmark')).opacity)`);
    say(!s4.mark.shown && faded < 0.05, `the mark is gone a moment after (opacity ${f(faded, 2)}; 0.8 s it stays, and then it fades)`);

    // What does not focus: the bar (but a tap just over it does), a drag, the right button.
    const bar = await page.ev(`(() => { const r = document.getElementById('photobar').getBoundingClientRect(); return [r.left + r.width / 2, r.top + 2, r.top]; })()`);
    await press(bar[0], bar[1]);
    await frames(1);
    const s5 = await read();
    await press(bar[0], bar[2] - 10);
    await frames(1);
    const s6 = await read();
    say(s5.focus === s3.focus && s5.marked === s3.marked && Math.abs(s6.focus - s3.focus) > 1e-6 && s6.marked === s3.marked + 1,
      `a tap on the bar does not focus (${f(s5.focus, 3)} m as before, ${s5.marked - s3.marked} new marks); a tap just over it does (${f(s6.focus, 3)} m, ${s6.marked - s3.marked} new mark)`);
    await press(car.at[0] + 0.5, car.at[1] + 0.5);
    await frames(1);
    const s7 = await read();
    await press(car.at[0] + 0.5, car.at[1] + 0.5, { to: [car.at[0] + 60, car.at[1] + 25] });
    await frames(1);
    const s8 = await read();
    await press(car.at[0] + 0.5, car.at[1] + 0.5, { button: 'right', buttons: 2 });
    await frames(1);
    const s9 = await read();
    say(s8.focus === s7.focus && s8.marked === s7.marked && s8.yaw !== s7.yaw && s9.focus === s7.focus && s9.marked === s7.marked,
      `a press that is dragged turns the lens and does not focus (the focus ${f(s8.focus, 3)} as before, ${s8.marked - s7.marked} marks), nor does a tap of the right button (${s9.marked - s7.marked} marks)`);

    // A tap on the sky focuses at the far plane.
    await press(320, 12);
    await frames(1);
    const s10 = await read();
    say(s10.focus > 10000, `a tap on the sky focuses at ${f(s10.focus, 0)} m, the far plane's`);

    // The sliders, by the keys.
    await page.ev(`document.getElementById('rngAperture').focus()`);
    await page.key('ArrowRight');
    await frames(1);
    const a1 = await read();
    await page.key('ArrowLeft');
    await page.key('ArrowLeft');
    await frames(1);
    const a2 = await read();
    await page.ev(`document.getElementById('rngEv').focus()`);
    for (let i = 0; i < 3; i++) await page.key('ArrowRight');
    await frames(2);
    const e1 = await read();
    say(a1.f === 3.2 && a1.postF === 3.2 && a1.apertureText === 'f/3.2' && a2.f === 2.5 && a2.postF === 2.5 && a2.apertureText === 'f/2.5',
      `the aperture slider, by the arrow keys, goes from f/2.8 to ${a1.apertureText} and, two steps back, to ${a2.apertureText}, and the chain has it (${a1.postF}, ${a2.postF})`);
    say(e1.ev === 0.3 && e1.postEv === 0.3 && e1.evText === '+0.3 EV' && Math.abs(e1.exposure / e1.base - 2 ** 0.3) < 1e-9,
      `the compensation slider, three steps on, is ${e1.evText} and the light the final pass has is ${f(e1.exposure / e1.base, 5)} times what it was (2 to the 0.3 is ${f(2 ** 0.3, 5)})`);

    // Out, all of it is put back.
    await page.key('Escape');
    for (const t0 = Date.now(); (await page.ev('game.photo.active')) && Date.now() - t0 < 120000;) {
      await page.front();
      await sleep(200);
    }
    const z = await read();
    say(z.state === 'off' && !z.on && !z.enabled && z.focus === null && z.f === 2.8 && z.postF === 2.8 && z.ev === 0 && z.postEv === 0 && z.exposure === z.base
      && z.disabled && z.apertureText === 'f/2.8' && z.evText === '0.0 EV' && z.evAt === '0' && z.pressed === 'false' && !z.mark.shown,
      `out, all of it is put back: the depth of field off (${z.on}, the chain's ${z.enabled}), f/${z.postF}, ${z.evText}, the light the final pass has is the world's again (${z.exposure === z.base}), the bar says so`);
    say(!page.errors.length, `the live page's console is clean${page.errors.length ? ' (' + page.errors.slice(0, 2) + ')' : ''}`);
  } finally {
    page.close();
  }
}

// The places of tools/look.mjs (seed 7): a world, and how far along the road in it
// (m); and the worlds that are drawn painted there as well as real.
const PLACES = [['alpine', 900], ['hills', 5000], ['river', 3600], ['coast', 900], ['desert', 2200], ['city', 2200],
  ['cavern', 2200], ['inferno', 2200], ['abyss', 2200], ['heaven', 2200], ['space', 2200], ['upside', 2200]];
const PAINTED = ['city', 'heaven', 'space', 'upside'];

// One world at its place, in a style, and under a sky where the address holds it to
// one, on a canvas of 480 x 270, in a page of its own: in the photo mode two frames a
// second apart are the same pixels. Where they are not, where they differ is kept as a
// picture. Returns [tag, pixels that differ, pixels that differ in the frame after], or
// nothing where the place was not to be had.
async function frozenAt({ world, s, style, sky = null }) {
  const tag = `${world}-${style}${sky ? '-' + sky : ''}`;
  const page = await openPage({ size: [480, 270] });
  try {
    await page.goRun(`seed=7&world=${world}&s=${s}&cam=chase&style=real${sky ? '&sky=' + sky : ''}&run=60`);
    const put = await page.run(putAtPlace, { s, style });
    if (put.missing || put.style !== style || put.world !== world || (sky && put.sky !== sky)) {
      say(false, `${tag}: the car could not be put at ${s} m (${JSON.stringify(put)})`);
      return null;
    }
    const inn = await page.run(goIn);
    const look = await page.run(theFrame);
    await sleep(1000);
    const on = await page.run(aSecondOn);
    // The world going on does change the frame, and the frame has something in it:
    // the equality is not for want of anything to draw or to move.
    const go = await page.run(theWorldGoesOn);
    const same = on.same.differing === 0 && on.again.differing === 0 && on.stood && inn.entered && inn.state === 'on';
    const alive = look.spread > 5 && go.moved.differing > go.moved.of * 0.005 && !go.active;
    const where = on.apart ? `; they differ in the box ${on.apart.box.join(' ')} of ${inn.size.join(' x ')}, by cell (4 across, 3 down) ${on.apart.grid.join(' ')}` : '';
    say(same && alive, `${tag} (${s} m${sky ? ', the ' + put.sky + ' sky' : ''}): in the photo mode two frames a second apart (the wall's, a second by the frame's) are ${same ? 'the same pixels' : 'NOT the same pixels'} (${on.same.differing} of ${on.same.of} differ, by ${on.same.max} at most; the frame after, ${on.again.differing})${where}; the game's clock, frame and car ${on.stood ? 'stand' : 'MOVE'} (simTime ${f(on.car[5], 3)}); the frame has something in it (luma ${f(look.mean, 0)}, spread ${f(look.spread, 0)}) and a second of the world going on changes ${f(go.moved.differing / go.moved.of * 100, 1)}% of it; the console is ${page.errors.length ? 'NOT clean (' + page.errors.slice(0, 1) + ')' : 'clean'}`);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}frozen-${tag}-frame.png`, Buffer.from(look.url.replace(/^data:image\/png;base64,/, ''), 'base64'));
    if (on.apart) writeFileSync(`${OUT}frozen-${tag}.png`, Buffer.from(on.apart.sheet.replace(/^data:image\/png;base64,/, ''), 'base64'));
    results[`frozen-${tag}`] = { same: on.same, again: on.again, box: on.apart && on.apart.box, grid: on.apart && on.apart.grid, luma: look.mean, spread: look.spread, goes: go.moved.differing / go.moved.of };
    return [tag, on.same.differing, on.again.differing];
  } catch (e) {
    say(false, `${tag}: ${e.message}`);
    return null;
  } finally {
    page.close();
  }
}

// What the places gave: which are the same pixels, and which are not.
function frozenTable(table) {
  const alike = table.filter((r) => !r[1] && !r[2]).map((r) => r[0]);
  const unlike = table.filter((r) => r[1] || r[2]).map((r) => `${r[0]} (${r[1]})`);
  console.error(`      the same pixels in ${alike.length} of ${table.length}: ${alike.join(' ')}${unlike.length ? '; not in ' + unlike.join(' ') : ''}`);
}

// Each of the twelve worlds at its place (real, and painted for 4 of them),
// one world at a time.
async function everyWorld() {
  const table = [];
  for (const [world, s] of PLACES) {
    for (const style of PAINTED.includes(world) ? ['real', 'paint'] : ['real']) {
      const row = await frozenAt({ world, s, style });
      if (row) table.push(row);
    }
  }
  frozenTable(table);
}

// A day world has one of three skies, held by sky= in the address: the hills at their
// place under each of them, real and painted.
async function everySky() {
  const table = [];
  for (const sky of ['noon', 'golden', 'grey']) {
    for (const style of ['real', 'paint']) {
      const row = await frozenAt({ world: 'hills', s: 5000, style, sky });
      if (row) table.push(row);
    }
  }
  frozenTable(table);
}

// The card cannot make the picture: what the chain does, and what the page does.
async function theCardRunsOut() {
  const page = await openPage({ size: [480, 270] });
  try {
    await page.goRun('seed=7&world=hills&style=real&cam=chase&run=60');
    const r = await page.run(pictureThatCannotBe);
    say(!!r.threw && r.blank === null && !r.lost,
      `asked for a picture a texel wider than the card's largest texture (${r.limit}), the chain throws and does not hand over a picture of nothing (${r.threw ? '"' + r.threw + '"' : r.blank ? 'IT HANDED OVER A BLACK PICTURE' : 'it made one'}); the card is not lost`);
    say(r.was.join() === r.now.join() && r.same.differing === 0 && !r.errors.length,
      `...and the chain is as it was after (size ${r.now.slice(0, 2).join(' x ')}, scale ${r.now[2]}, zoom ${r.now[3]}), the frame is the same pixels (${r.same.differing} of ${r.same.of} differ), no error is left on the card${r.errors.length ? ' (' + r.errors + ')' : ''}`);
    results.cannot = r;

    const s = await page.run(pictureThatComesSmaller);
    const [w, h] = s.canvas;
    const ladder = [[2 * w, 2 * h], [Math.round(1.5 * w), Math.round(1.5 * h)], [w, h]];
    say(JSON.stringify(s.firstAsked) === JSON.stringify(ladder.slice(0, 2)) && s.first.smaller && JSON.stringify(s.first.size) === JSON.stringify(ladder[1])
      && JSON.stringify(s.first.wanted) === JSON.stringify(ladder[0]),
    `the largest size failing, the picture comes at the next (asked ${s.firstAsked.map((x) => x.join('x')).join(' then ')}; made ${s.first.size ? s.first.size.join('x') : s.first.error}, smaller than the ${s.first.wanted ? s.first.wanted.join('x') : '?'} that was wanted)`);
    say(s.firstNote.includes(`${ladder[1][0]}×${ladder[1][1]}`) && s.firstNote.includes('已保存') && s.firstNote.includes(s.first.name),
      `...and the bar says it was smaller ("${s.firstNote}")`);
    say(!!s.all.error && JSON.stringify(s.allAsked) === JSON.stringify(ladder) && s.allNote === '没拍成',
      `every size failing, the sizes are tried one after the other (${s.allAsked.map((x) => x.join('x')).join(', ')}), the picture is not made (${s.all.error || 'IT WAS MADE'}) and the bar says so ("${s.allNote}")`);
    say(JSON.stringify(s.again.size) === JSON.stringify(ladder[0]) && !s.again.smaller && !s.busy,
      `...and the next picture is the full size again (${s.again.size.join('x')}), the page is not left busy`);
    results.smaller = s;
    // (The page says it to the console when no size could be made: the failures made on purpose are not stray ones.)
    const stray = page.errors.filter((e) => !/simulated: no memory/.test(e));
    say(!stray.length, `the console is clean${stray.length ? ' (' + stray.slice(0, 2) + ')' : ''}`);
  } finally {
    page.close();
  }
}

// The same stretch run twice, once with the lens let go of in the middle.
async function unchanged() {
  const query = 'seed=7&world=hills&style=real&cam=chase&run=90';
  const pages = [];
  const run = async (fn, arg) => {
    const page = await openPage({ size: [480, 270] });
    pages.push(page);
    await page.goRun(query);
    return page.run(fn, arg);
  };
  try {
    const plain = await run(control);
    const near = await run(viaThePhotoMode, { far: false });
    const faraway = await run(viaThePhotoMode, { far: true });
    // What is the world's, and what is what has been drawn or built on the way.
    const DRAWN = ['drawCalls', 'triangles', 'geometries'];
    const CACHES = ['trees', 'clutter'];
    const differ = (a, b, skip) => Object.keys(a).filter((k) => !skip.includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    const keys = Object.keys(plain.snap).length;
    for (const [name, run2, skip] of [['the lens moved a little, a picture taken', near, DRAWN], ['the lens sent 300 m along the road and up', faraway, [...DRAWN, ...CACHES]]]) {
      const bad = differ(plain.snap, run2.snap, skip);
      say(!bad.length && run2.car.join() === plain.car.join(),
        `${name}, then out and 60 steps: the snapshot is the one of the run that never went in, in all but the lens${skip.length ? ' and what has been drawn and built on the way (' + skip.join(', ') + ')' : ''} (${keys - skip.length - 1} of ${keys} fields)${bad.length ? ' (differ: ' + bad.map((k) => `${k} ${JSON.stringify(plain.snap[k])} / ${JSON.stringify(run2.snap[k])}`).join('; ') + ')' : ''}; the car is at ${run2.car.slice(0, 3).map((x) => f(x, 3)).join(' ')} as it is in the run that never went in`);
      const drawn = differ(plain.snap, run2.snap, Object.keys(plain.snap).filter((k) => ![...DRAWN, ...CACHES].includes(k)));
      results[`snapshot-${name.slice(0, 12)}`] = { differ: bad, drawnDiffer: drawn };
      console.error(`      told, not held: ${drawn.length ? drawn.map((k) => `${k} ${JSON.stringify(plain.snap[k])} / ${JSON.stringify(run2.snap[k])}`).join('; ') : 'what has been drawn and built is the same too'}`);
    }
    say(near.stopped.join() === near.seenIn.join() && near.seenIn.join() === near.seenOut.join() && near.afterExit.join() === near.stopped.join()
      && near.afterExit[5] === near.stopped[5] && near.afterExit[6] === near.stopped[6],
    `the car, the game's clock and its frame stand where the world stopped (${near.stopped.slice(0, 3).map((x) => f(x, 3)).join(' ')}, ${f(near.stopped[5], 3)} s) while the lens is let go of, a picture is taken, and on the way back`);
    for (const [name, r] of [['near', near], ['far', faraway]]) {
      say(r.back.metres <= 0.05 && r.back.degrees <= 0.5 && r.back.fov <= 0.01 && !r.back.active && r.back.elapsed >= 0.6 - 1e-9 && r.back.elapsed <= 0.71 && !r.bodyClass,
        `${name}: the lens is back where it began in ${f(r.back.elapsed, 2)} s of the wall's clock (to ${f(r.back.metres * 100, 2)} cm, ${f(r.back.degrees, 3)} degrees, ${f(r.back.fov, 4)} of field of view) and the world is going on`);
    }
    const mid = near.half;
    say(mid.length >= 3 && mid[0] > 0.01 && mid[1] < mid[0] && mid[2] < mid[1], `on the way back it goes smoothly, not at once (${mid.map((x) => f(x, 2)).join(', ')} m from home at 0.1 s steps)`);
    say(plain.car[5] === near.car[5] && plain.car[6] === near.car[6], `the game's clock after the 60 steps is the same with the mode and without (${f(near.car[5], 3)} s, frame ${near.car[6]})`);
  } finally {
    for (const p of pages) p.close();
  }
}

// Where the ground is not simply the land's: in a bore (the road is the floor and
// the vault the roof, the hill over it is neither, and the frame's light is the
// bore's where the lens is), under the cavern's roof, and in the deep sea (the
// surface of the water is not the floor for a lens that began under it).
async function underneath() {
  // A bore: found in the road a page surveys at the start, and a page opened with the car in it.
  const finder = await openPage({ size: [480, 270] });
  let bore = null;
  try {
    await finder.goRun('seed=7&cam=chase&run=2');
    bore = await finder.run(findBore);
  } finally {
    finder.close();
  }
  if (!bore) {
    say(false, 'no bore of 120 m or more in the road a page surveys at the start of seed 7');
  } else {
    const page = await openPage({ size: [480, 270] });
    try {
      await page.goRun(`seed=7&s=${Math.round(bore.start + 60)}&cam=chase&run=30`);
      const r = await page.run(inTheBore);
      say(r.kind === 2 && r.shut && r.down >= r.surface + 0.3 - 1e-3 && r.down - (r.surface + 0.3) < 0.02 && r.hill > r.vault + 1
        && r.up <= r.vault - 0.3 + 1e-3 && r.vault - 0.3 - r.up < 0.02,
      `in a bore of ${f(bore.length, 0)} m (the vault ${f(r.vault - r.surface, 2)} m over the road, the hill ${f(r.hill - r.surface, 1)} m): pushed down the lens stops ${f(r.down - r.surface, 3)} m over the road (not lifted to the hill) and pushed up ${f(r.vault - r.up, 3)} m under the vault`);
      say(Math.abs(r.within.sun - 0.03) < 1e-3 && Math.abs(r.within.exposure - 1.5) < 1e-3 && Math.abs(r.over.sun - 1) < 1e-3 && Math.abs(r.over.exposure - 1) < 1e-3
        && Math.abs(r.again.sun - 0.03) < 1e-3 && r.kept.camIn && r.kept.eye && r.kept.carIn,
      `the frame's light is the bore's where the lens is in it (the sun at ${f(r.within.sun * 100, 1)}% and the exposure ${f(r.within.exposure, 2)} times), the open air's over the hill (${f(r.over.sun * 100, 1)}%, ${f(r.over.exposure, 2)} times) and the bore's again in it (${f(r.again.sun * 100, 1)}%), at once, and the eye and the car's own light are as they were (${Object.values(r.kept).every(Boolean) ? 'kept' : 'NOT KEPT'})`);
      results.bore = r;
      say(!page.errors.length, `the bore's page console is clean${page.errors.length ? ' (' + page.errors.slice(0, 2) + ')' : ''}`);
    } finally {
      page.close();
    }
  }

  const cave = await openPage({ size: [480, 270] });
  try {
    await cave.goRun('seed=7&world=cavern&cam=chase&run=30');
    const c = await cave.run(underTheRoof);
    say(Number.isFinite(c.roof) && c.reach > 30 && c.y <= c.roof - 0.3 + 1e-3 && c.roof - c.y - 0.3 < 0.02,
      `in the cavern, pushed up at the Shift's pace for ten seconds the lens rises ${f(c.reach, 1)} m and stops ${f(c.roof - c.y, 3)} m under the roof (at least 0.3)`);
    results.cavern = c;
  } finally {
    cave.close();
  }

  const deep = await openPage({ size: [480, 270] });
  try {
    await deep.goRun('seed=7&world=abyss&cam=chase&run=30');
    const d = await deep.run(underTheSea);
    say(d.wet === false && d.y < d.level && Math.abs(d.y - (d.bed + 0.3)) < 0.02,
      `in the deep sea (the surface ${f(d.level, 1)} m, the car at ${f(d.carY, 1)} m) the surface does not hold the lens up, and pushed down it stops ${f(d.y - d.bed, 3)} m over the bed (at least 0.3)`);
    results.deep = d;
  } finally {
    deep.close();
  }
}

// Real keys and a real mouse on a live page.
async function withKeys() {
  const page = await openPage({ size: [480, 360] });
  try {
    await page.goto('seed=7&auto=0&tier=low');
    await page.front();
    const state = () => page.ev(`({
      photo: game.photo.state, body: document.body.classList.contains('photo'), wall: document.body.classList.contains('wallpaper'),
      auto: game.autoMode, framing: game.chase.framing, turns: game.turns || 0, sim: game.simTime, frame: game.frame,
      car: [game.car.x, game.car.z, game.car.vx, game.car.speed], lens: game.camera.position.toArray(), look: [game.photo.lens.yaw, game.photo.lens.pitch, game.photo.lens.roll],
      fovTo: game.photo.lens.fovTo, view: [game.chase.view.yaw, game.chase.view.pitch, game.chase.view.held], frames: game.photo.frames,
      saved: window.__saved.length, hudSeen: getComputedStyle(document.getElementById('hud')).visibility,
    })`);
    const frames = async (n) => {
      const from = await page.ev('game.photo.frames');
      for (const t0 = Date.now(); (await page.ev('game.photo.frames')) < from + n && Date.now() - t0 < 120000;) {
        await page.front();
        await sleep(150);
      }
    };
    // A click of the mouse on a button of the page, in the middle of it.
    const click = async (selector) => {
      const [x, y] = await page.ev(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
      await page.mouse('mouseMoved', x, y);
      await page.mouse('mousePressed', x, y, { button: 'left', clickCount: 1, buttons: 1 });
      await page.mouse('mouseReleased', x, y, { button: 'left', clickCount: 1 });
    };
    const inactive = async () => {
      for (const t0 = Date.now(); (await page.ev('game.photo.active')) && Date.now() - t0 < 120000;) {
        await page.front();
        await sleep(200);
      }
    };
    const s0 = await state();

    // A page that has not its first frame yet does not go in at a K.
    const early = await page.ev(`(() => {
      const was = window.__ready;
      window.__ready = false;
      ui.photoBar.key({ code: 'KeyK' });
      const state = game.photo.state;
      window.__ready = was;
      return { was, state };
    })()`);
    say(early.was === true && early.state === 'off', `a K before the page is ready does nothing (the mode is ${early.state}; the page is ready now: ${early.was})`);

    // Outside the mode, the keys do what they did.
    await page.key('KeyP');
    const p1 = await state();
    await page.key('KeyP');
    await page.key('KeyC');
    const c1 = await state();
    await page.ev(`game.setCamera('chase')`);
    say(p1.auto === !s0.auto && c1.framing !== s0.framing && c1.photo === 'off', `outside the photo mode P toggles the autopilot (${s0.auto}→${p1.auto}) and C changes the camera (${s0.framing}→${c1.framing}), as they did`);

    // K goes in.
    await page.key('KeyK');
    const inn = await state();
    say(inn.photo === 'on' && inn.body, 'K goes into the photo mode (the page says so)');
    await frames(3);

    // The car put away, with the switch of the bar (a click of the mouse): the
    // frame loses the car, what it casts and what its lamps light, and the sky
    // is as it was; put back, it is the frame it was. (A page that has just
    // come up is still being built: the pieces of the land arrive over a few
    // frames and then stand, so what is read waits for two frames the same.)
    const still = async () => {
      let quiet = 0;
      for (const t0 = Date.now(); quiet < 3 && Date.now() - t0 < 120000;) {
        const d = await page.ev(`(() => { game.photo.frame(0); const a = __t.screen(); game.photo.frame(0.05); return __t.diff(a, __t.screen()).differing; })()`);
        quiet = d === 0 ? quiet + 1 : 0;
        await page.front();
        await sleep(300);
      }
      return quiet >= 3;
    };
    const stood = await still();
    say(stood, 'in the live page, once the world has been built round the lens, two frames in the photo mode are the same pixels (three times in a row)');
    await page.ev(`(() => { game.photo.frame(0); window.__with = __t.screen(); window.__lamp = game.headlight.intensity; })()`);
    await click('#btnPhotoCar');
    await still();
    const away = await page.ev(`(() => {
      game.photo.frame(0);
      const a = window.__with;
      const b = __t.screen();
      const w = game.canvas.width;
      const h = game.canvas.height;
      const count = { all: 0, car: 0, sky: 0 };
      for (let i = 0; i < a.length; i += 4) {
        if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) continue;
        const x = (i / 4) % w;
        const y = Math.floor(i / 4 / w);
        count.all++;
        if (x > w * 0.3 && x < w * 0.7 && y > h * 0.45 && y < h * 0.85) count.car++;
        if (y < h * 0.15) count.sky++;
      }
      return { count, size: [w, h], hidden: game.photo.hidden, shown: game.presentation.root.visible, lamp: game.headlight.intensity,
        pressed: document.getElementById('btnPhotoCar').getAttribute('aria-pressed') };
    })()`);
    await click('#btnPhotoCar');
    await still();
    const returned = await page.ev(`(() => {
      game.photo.frame(0);
      const d = __t.diff(window.__with, __t.screen());
      return { ...d, hidden: game.photo.hidden, shown: game.presentation.root.visible, lamp: game.headlight.intensity, was: window.__lamp,
        pressed: document.getElementById('btnPhotoCar').getAttribute('aria-pressed') };
    })()`);
    const area = away.size[0] * away.size[1];
    say(away.hidden && !away.shown && away.lamp === 0 && away.pressed === 'true' && away.count.car > 500 && away.count.sky === 0 && away.count.all < area * 0.3,
      `the switch puts the car away: it is not drawn and its lamps are out; ${away.count.all} pixels of the frame change (${(away.count.all / area * 100).toFixed(1)}%), ${away.count.car} of them where the car stood, none in the sky`);
    say(!returned.hidden && returned.shown && returned.differing === 0 && returned.lamp === returned.was && returned.pressed === 'false',
      `and it brings the car back: the frame is the one it was (${returned.differing} of ${returned.of} pixels differ) and the lamps are as they were (${f(returned.lamp, 2)})`);

    // None of the world's keys is any use in it.
    const before = await state();
    for (const k of ['KeyP', 'KeyC', 'KeyN', 'KeyH', 'KeyR']) await page.key(k);
    await frames(2);
    const after = await state();
    say(after.auto === before.auto && after.framing === before.framing && after.turns === before.turns && !after.wall && after.car.join() === before.car.join() && after.sim === before.sim && after.frame === before.frame,
      `in the mode P, C, N, H and R do nothing (autopilot ${before.auto}→${after.auto}, camera ${before.framing}→${after.framing}, worlds turned ${before.turns}→${after.turns}, wallpaper ${after.wall}, the car ${after.car.join() === before.car.join() ? 'where it was' : 'MOVED'})`);

    // W A S D do not drive: held, they move the lens and nothing of the car.
    await page.keyDown('KeyW');
    await sleep(1500);
    await frames(2);
    await page.keyUp('KeyW');
    const w = await state();
    const moved = Math.hypot(w.lens[0] - after.lens[0], w.lens[1] - after.lens[1], w.lens[2] - after.lens[2]);
    say(moved > 0.5 && w.car.join() === after.car.join() && w.sim === after.sim && w.frame === after.frame && w.car[3] === before.car[3],
      `W held a second and a half moves the lens ${f(moved, 2)} m and drives nothing (the car's speed ${f(w.car[3], 3)} m/s as it was, the game's clock ${w.sim === after.sim ? 'still' : 'MOVED'}; the autopilot is off, so on the road these would steer it)`);
    await page.keyDown('KeyQ');
    await sleep(600);
    await page.keyUp('KeyQ');
    await page.keyDown('KeyZ');
    await sleep(1500);
    await frames(2);
    await page.keyUp('KeyZ');
    await frames(3);
    const rolled = await state();
    say(rolled.look[2] !== w.look[2] && Math.abs(rolled.look[2] - w.look[2]) <= 30 * DEG + 1e-6 && rolled.lens[1] < w.lens[1] + 1e-9,
      `Q takes it down and Z rolls it (by ${f((rolled.look[2] - w.look[2]) / DEG, 1)} degrees)`);

    // The mouse: a drag with the left button turns the lens, a drag with the right the same,
    // and the right button's look round the car (chase) does not hear it.
    const [mx, my] = await page.middle();
    const turn0 = (await state()).look;
    await page.mouse('mouseMoved', mx, my);
    await page.mouse('mousePressed', mx, my, { button: 'left', clickCount: 1, buttons: 1 });
    await page.mouse('mouseMoved', mx + 60, my + 20, { button: 'left', buttons: 1 });
    await page.mouse('mouseMoved', mx + 120, my + 30, { button: 'left', buttons: 1 });
    await page.mouse('mouseReleased', mx + 120, my + 30, { button: 'left', clickCount: 1 });
    await frames(2);
    const dragged = await state();
    await page.mouse('mouseMoved', mx, my);
    await page.mouse('mousePressed', mx, my, { button: 'right', clickCount: 1, buttons: 2 });
    await page.mouse('mouseMoved', mx - 80, my, { button: 'right', buttons: 2 });
    await page.mouse('mouseReleased', mx - 80, my, { button: 'right', clickCount: 1 });
    await frames(2);
    const right = await state();
    say(dragged.look[0] > turn0[0] + 0.05 && dragged.look[1] > turn0[1] && right.look[0] < dragged.look[0] - 0.02 && right.view.join() === s0.view.join(),
      `a drag of the mouse turns the lens (the picture goes where the pointer goes: right and down turns it left, ${f((dragged.look[0] - turn0[0]) / DEG, 1)} degrees, and up, ${f((dragged.look[1] - turn0[1]) / DEG, 1)}), the right button too, and the right button's look round the car is not told of it (${right.view})`);
    await page.mouse('mouseWheel', mx, my, { deltaX: 0, deltaY: -400 });
    await frames(3);
    const zoomed = await state();
    await page.mouse('mouseWheel', mx, my, { deltaX: 0, deltaY: -100000 });
    await frames(3);
    const zoomedMore = await state();
    await page.mouse('mouseWheel', mx, my, { deltaX: 0, deltaY: 200000 });
    await frames(3);
    const wide = await state();
    say(zoomed.fovTo < 55 && Math.abs(zoomedMore.fovTo - 20) < 1e-9 && Math.abs(wide.fovTo - 100) < 1e-9,
      `the wheel changes the field of view (${f(zoomed.fovTo, 1)} degrees after a turn, ${f(zoomedMore.fovTo, 1)} at the most, ${f(wide.fovTo, 1)} the other way)`);

    // Enter takes a picture and the page saves it.
    await page.key('Enter');
    for (const t0 = Date.now(); (await page.ev('window.__saved.length')) < 1 && Date.now() - t0 < 120000;) {
      await page.front();
      await sleep(200);
    }
    const saved = await page.ev(`(async () => {
      const s = window.__saved[0];
      if (!s) return null;
      const bytes = new Uint8Array(await (await fetch(s.href)).arrayBuffer());
      const dv = new DataView(bytes.buffer);
      return { name: s.name, size: bytes.length, wh: [dv.getUint32(16), dv.getUint32(20)], canvas: [game.canvas.width, game.canvas.height], sCar: Math.round(game.sCar), world: game.worldHere().name,
        away: game.photo.hidden, focus: document.activeElement && document.activeElement.id };
    })()`);
    say(!!saved && saved.wh[0] === saved.canvas[0] * 2 && saved.wh[1] === saved.canvas[1] * 2 && saved.name === `continuum-${saved.world}-${STYLE_ZH.real}-${saved.sCar}.png` && !saved.away,
      `Enter takes a picture and hands it to the browser as ${saved && saved.name} (${saved && saved.wh.join(' x ')}, ${saved && (saved.size / 1024).toFixed(0)} KiB), and the button that has the focus (${saved && saved.focus || 'none'}) is not clicked by it`);
    const note = await page.ev(`document.getElementById('photonote').textContent`);
    say(!!saved && note.includes('continuum-') && note.includes('已保存'), `and the bar says so ("${note}")`);

    // The canvas is not touched while a picture is taken, and no frame of another size is shown.
    await page.ev(`(() => {
      window.__probe = { widths: [], stop: false, writes: [] };
      const cv = game.canvas;
      for (const k of ['width', 'height']) {
        const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, k);
        Object.defineProperty(cv, k, { configurable: true, get() { return d.get.call(this); }, set(v) { window.__probe.writes.push([k, v]); d.set.call(this, v); } });
      }
      const loop = () => { window.__probe.widths.push([cv.width, cv.height]); if (!window.__probe.stop) requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    })()`);
    await frames(2);
    await page.key('Enter');
    for (const t0 = Date.now(); (await page.ev('window.__saved.length')) < 2 && Date.now() - t0 < 120000;) {
      await page.front();
      await sleep(200);
    }
    await frames(2);
    const probe = await page.ev(`(() => { window.__probe.stop = true; const p = window.__probe; delete game.canvas.width; delete game.canvas.height; return { n: p.widths.length, distinct: [...new Set(p.widths.map((w) => w.join('x')))], writes: p.writes.length }; })()`);
    say(probe.n > 3 && probe.distinct.length === 1 && probe.writes === 0,
      `taking a picture, the canvas keeps its size at every frame the page draws (${probe.n} frames, all ${probe.distinct.join(', ')}) and none is written to it (${probe.writes} writes)`);
    await page.front();
    await page.shot('keys-photo.png');

    // Esc goes out (the game's clock is read at the moment it is told that the
    // world goes on, before the first step of it); K goes in again and out;
    // the wallpaper mode and the photo mode are one or the other.
    await page.ev(`(() => {
      const was = game.photo.onChange;
      game.photo.onChange = (s) => {
        if (s === 'off') window.__off = { sim: game.simTime, frame: game.frame, car: [game.car.x, game.car.z] };
        was(s);
      };
    })()`);
    const stoodAt = await state();
    await page.key('Escape');
    for (const t0 = Date.now(); (await page.ev('game.photo.active')) && Date.now() - t0 < 120000;) {
      await page.front();
      await sleep(200);
    }
    const off = await page.ev('window.__off');
    for (const t0 = Date.now(); off && (await page.ev('game.simTime')) <= off.sim && Date.now() - t0 < 60000;) {
      await page.front();
      await sleep(200);
    }
    const gone = await state();
    say(gone.photo === 'off' && !gone.body && gone.hudSeen === 'visible' && !!off && off.sim === stoodAt.sim && off.frame === stoodAt.frame
      && off.car.join() === stoodAt.car.slice(0, 2).join() && gone.sim > off.sim,
    `Esc goes out: the lens comes back, the page is the page again, and the world goes on from where it stopped (the game's clock was ${f(stoodAt.sim, 3)} s when it stood and when it was let go, and ${f(gone.sim, 3)} s a moment on)`);
    await page.key('KeyH');
    await page.key('KeyK');
    const wall = await state();
    await page.key('KeyH');
    await page.key('KeyK');
    const photoAgain = await state();
    await page.key('KeyH');
    const photoWall = await state();
    await page.key('KeyK');
    for (const t0 = Date.now(); (await page.ev('game.photo.active')) && Date.now() - t0 < 120000;) {
      await page.front();
      await sleep(200);
    }
    say(wall.wall && wall.photo === 'off' && !photoAgain.wall && photoAgain.photo === 'on' && !photoWall.wall && photoWall.photo === 'on',
      `the wallpaper mode and the photo mode are one or the other: K does nothing in the wallpaper mode (${wall.photo}), H does nothing in the photo mode (wallpaper ${photoWall.wall})`);

    // The buttons, clicked with the mouse. The one in the page's bar goes in; the
    // car put away with the switch is back when the exit button has gone out.
    await click('#btnPhoto');
    const byButton = await state();
    await frames(3);
    await click('#btnPhotoCar');
    await click('#btnPhotoExit');
    await inactive();
    const out = await page.ev(`({ state: game.photo.state, body: document.body.classList.contains('photo'), away: game.photo.hidden, shown: game.presentation.root.visible })`);
    say(byButton.photo === 'on' && byButton.body && out.state === 'off' && !out.body && !out.away && out.shown,
      `the camera button of the page's bar goes in (${byButton.photo}); the exit button goes out (${out.state}) and takes the car that was put away with it, back (${out.shown ? 'drawn' : 'NOT DRAWN'})`);

    // The style button changes the style as the world stands (the game's clock and frame do not
    // move); the change over, two frames a second apart are the same pixels. The shutter takes a
    // picture of that style.
    await click('#btnPhoto');
    await frames(3);
    const st0 = await page.ev(`({ id: game.style.id, label: document.querySelector('#btnPhotoStyle .txt').textContent, sim: game.simTime, frame: game.frame })`);
    await click('#btnPhotoStyle');
    for (const t0 = Date.now(); (await page.ev('game.style.moving')) && Date.now() - t0 < 180000;) {
      await page.front();
      await sleep(200);
    }
    await frames(4);
    const st1 = await page.ev(`(() => {
      const p = game.photo;
      p.frame(0.05);
      const a = __t.screen();
      p.frame(1.0);
      const b = __t.screen();
      return { id: game.style.id, label: document.querySelector('#btnPhotoStyle .txt').textContent, sim: game.simTime, frame: game.frame, same: __t.diff(a, b) };
    })()`);
    say(st1.id !== st0.id && st1.label !== st0.label && st1.sim === st0.sim && st1.frame === st0.frame && st1.same.differing === 0,
      `the style button changes the style (${st0.id} ${st0.label} to ${st1.id} ${st1.label}) and the world stands through it (the game's clock and frame as they were); the change over, two frames a second apart are the same pixels (${st1.same.differing} of ${st1.same.of})`);
    const was = await page.ev('window.__saved.length');
    await click('#btnShutter');
    for (const t0 = Date.now(); (await page.ev('window.__saved.length')) <= was && Date.now() - t0 < 180000;) {
      await page.front();
      await sleep(200);
    }
    const shot = await page.ev(`({ name: window.__saved[window.__saved.length - 1].name, sCar: Math.round(game.sCar), world: game.worldHere().name, note: document.getElementById('photonote').textContent })`);
    say(shot.name === `continuum-${shot.world}-${STYLE_ZH[st1.id]}-${shot.sCar}.png` && shot.note.includes(shot.name),
      `the shutter button takes the picture, in the style that is now (${shot.name}), and the bar says so`);
    await click('#btnPhotoExit');
    await inactive();
    say(!page.errors.length, `the live page's console is clean${page.errors.length ? ' (' + page.errors.slice(0, 2) + ')' : ''}`);
  } finally {
    page.close();
  }
}

// --- run ----------------------------------------------------------------------

if (!GPU) await inNode();
const kill = () => { for (const p of open) p.close(); };
process.on('SIGINT', () => { kill(); process.exit(130); });

const server = serve();
let card = '';
let noCard = null;
try {
  if (!(await waitForServer())) throw new Error('server did not start');
  if (GPU) card = await pickAngle();
  // One scenario that breaks does not stop the others from being read.
  const scenarios = GPU ? [
    // The export part on the card, at a canvas of 1920 x 1080: the picture is the full 3840 x 2160.
    ['the export on the GPU, real', () => standing('hills', 'real', { gpu: true, glass: true })],
    ['the export on the GPU, painted', () => standing('hills', 'paint', { gpu: true, glass: true })],
  ] : [
    ['the hills, real', () => standing('hills', 'real', { limits: ['land', 'road'], keep: true, glass: true })],
    ['the hills, painted', () => standing('hills', 'paint', { keep: true, glass: true })],
    ['the river, real', () => standing('river', 'real', { limits: ['water'] })],
    ['the river, painted, in English', () => standing('river', 'paint', { lang: 'en' })],
    ['a picture the card cannot make', theCardRunsOut],
    ['every world frozen', everyWorld],
    ['every sky frozen', everySky],
    ['the world left as it was', unchanged],
    ['under the ground: a bore, the cavern, the deep sea', underneath],
    ['real keys and a real mouse', withKeys],
    ['the depth of field, real', () => theGlass('real')],
    ['the depth of field, painted', () => theGlass('paint')],
    ['the glass by hand', byTheGlass],
  ];
  const only = (process.env.ONLY || '').split(',').filter(Boolean);
  for (const [name, scenario] of scenarios) {
    if (only.length && !only.some((o) => name.includes(o))) continue;
    try {
      await scenario();
    } catch (e) {
      if (e.noGPU) throw e;
      say(false, `${name}: ${e.message}`);
      console.error(e.stack);
    }
  }
} catch (e) {
  if (e.noGPU) {
    noCard = e;
  } else {
    console.error(`FAIL: ${e.stack || e.message}`);
    failed++;
  }
} finally {
  kill();
  server.kill();
  // The browsers have gone; their profiles go with them.
  await sleep(800);
  for (const dir of profiles) rmSync(dir, { recursive: true, force: true });
}
try {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(OUT + 'photo_check.json', JSON.stringify(results, null, 2));
} catch { /* the pictures are what is wanted */ }
if (noCard) {
  console.error(`\n--gpu: ${noCard.message}`);
  process.exit(2);
}
if (failed) {
  console.error(`\n${failed} problem${failed > 1 ? 's' : ''}`);
  process.exit(1);
}
if (GPU) {
  console.error(`\nOK: on ${card}, the picture of a canvas of 1920 x 1080 is the full 3840 x 2160, in the real style and the painted, and the card gave no error`);
  process.exit(0);
}
console.error('\nOK: the world stands still in the photo mode, the lens goes where it is let and no further, a picture is the frame at twice the size and takes nothing from the screen, and going out leaves the world as it was');
process.exit(0);
