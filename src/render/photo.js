// The photo mode. The world stands still and the lens is let go of: it goes
// where the keys and the mouse take it, anywhere within 400 m of the car and
// not into the ground, and a picture of the frame is taken at twice the
// canvas's size and handed over as a PNG.
//
// What stands still is everything the clock moves. Game.update is not called
// while the mode is on; Game.photoUpdate is, which brings what goes by where
// the lens is (the land, the trees, the sea, the sky about it, the small
// things in the air) to where the lens is and gives none of it any time. The
// lens itself goes by the wall's clock, the frame's own time, not the game's.
// Going out, the lens goes back to where it began in 0.6 s with the world
// still standing, and only then does the world go on, from the moment it
// stopped.
//
// W A S D move the lens (Shift 4 times as fast), Q and E take it down and
// up, a drag of the mouse turns it, the wheel changes the field of view
// (20 to 100 degrees), Z and X roll it (30 degrees either way), Enter takes
// the picture and Esc goes out.

import * as THREE from 'three';

const DEG = Math.PI / 180;

export const SPEED = 12;            // m/s, with W A S D Q E
export const FAST = 4;              // times that, with Shift
export const EASE = 0.12;           // s: the time the lens takes to come to what is asked of it, and to stop
export const ROLL = 30 * DEG;       // rad, how far Z and X roll the lens either way from the roll it began with
export const ROLL_RATE = 40 * DEG;  // rad/s
export const PITCH = 88 * DEG;      // rad, up and down
export const FOV = [20, 100];       // degrees
export const REACH = 400;           // m, from the car
export const CLEAR = 0.3;           // m, over the ground
export const BACK = 0.6;            // s, for the lens to go back where it began
export const SHOT = { scale: 2, width: 3840, height: 2160 };
export const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyZ', 'KeyX', 'ShiftLeft', 'ShiftRight'];

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// The size of the picture of a canvas: twice its pixels, in a frame of at
// most 3840 by 2160 (and of what the graphics card can make), with the shape
// the canvas has.
export function exportSize(width, height, limit = Infinity) {
  const k = Math.min(SHOT.scale, SHOT.width / width, SHOT.height / height, limit / width, limit / height);
  return [Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k))];
}

// The sizes a picture is tried at, the largest first: the one above, and, for
// a card that has no memory left for the targets of a frame that size, three
// quarters of it and then half.
export function pictureSizes(width, height, limit = Infinity) {
  const first = exportSize(width, height, limit);
  const sizes = [first];
  for (const k of [0.75, 0.5]) {
    const size = first.map((x) => Math.max(1, Math.round(x * k)));
    const last = sizes[sizes.length - 1];
    if (size[0] < last[0] || size[1] < last[1]) sizes.push(size);
  }
  return sizes;
}

// continuum-<world>-<style>-<chainage>.png, the chainage to the metre; what
// a file name cannot have is left out of the words.
export function fileName(world, style, chainage) {
  const clean = (s) => String(s).replace(/[\\/:*?"<>|\s]+/g, '');
  return `continuum-${clean(world)}-${clean(style)}-${Math.round(chainage)}.png`;
}

// The frame, upside down as the card hands it over, as a PNG.
function encode({ width, height, pixels }) {
  const row = width * 4;
  const swap = new Uint8Array(row);
  for (let a = 0, b = height - 1; a < b; a++, b--) {
    swap.set(pixels.subarray(a * row, (a + 1) * row));
    pixels.copyWithin(a * row, b * row, (b + 1) * row);
    pixels.set(swap, b * row);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.length), width, height), 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('the picture could not be made into a PNG'))), 'image/png');
  });
}

// Handed to the browser to keep.
function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// The lens: where it is, which way it looks, how wide, and what it is being
// asked to do. It comes to what is asked in EASE s, and goes on only as long
// as it is asked.
export class Lens {
  constructor() {
    this.p = new THREE.Vector3();
    this.v = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.roll0 = 0;        // the roll it began with: the roll is held to 30 degrees either way of it
    this.rollTo = 0;
    this.fov = 55;
    this.fovTo = 55;
    this.keys = new Set();
    // Puts the lens where it may be: (position, velocity).
    this.limit = null;
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  // Begin from a lens as it is drawn.
  from(position, quaternion, fov) {
    this.p.copy(position);
    this.v.set(0, 0, 0);
    this._e.setFromQuaternion(quaternion, 'YXZ');
    this.pitch = this._e.x;
    this.yaw = this._e.y;
    this.roll = this._e.z;
    this.roll0 = this.roll;
    this.rollTo = this.roll;
    this.fov = fov;
    this.fovTo = fov;
    this.keys.clear();
  }

  press(code) {
    this.keys.add(code);
  }

  release(code) {
    this.keys.delete(code);
  }

  clear() {
    this.keys.clear();
  }

  // Turn by a drag of dx, dy pixels, each worth perPixel rad: the picture
  // goes where the pointer goes.
  drag(dx, dy, perPixel) {
    this.yaw += dx * perPixel;
    this.pitch = clamp(this.pitch + dy * perPixel, -PITCH, PITCH);
  }

  // The field of view by this much of a factor (the log of it).
  zoom(amount) {
    this.fovTo = clamp(this.fovTo * Math.exp(amount), FOV[0], FOV[1]);
  }

  // Put the lens at a place; where it may be is seen to.
  place(x, y, z) {
    this.p.set(x, y, z);
    this.v.set(0, 0, 0);
    if (this.limit) this.limit(this.p, this.v);
  }

  // dt: seconds of the wall's clock.
  step(dt) {
    dt = clamp(dt, 0, 0.1);
    const decay = Math.exp(-dt / EASE);
    const k = 1 - decay;
    const held = (code) => (this.keys.has(code) ? 1 : 0);
    let right = held('KeyD') - held('KeyA');
    let ahead = held('KeyW') - held('KeyS');
    const up = held('KeyE') - held('KeyQ');
    const flat = Math.hypot(right, ahead);
    if (flat > 1) {
      right /= flat;
      ahead /= flat;
    }
    const speed = SPEED * (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? FAST : 1);
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // The lens looks along -z at no turn: ahead is (-sin, -cos), right (cos, -sin).
    // The speed comes to the one asked for as a decay, and the way covered in
    // the frame is the integral of that, so that the same keys held for the
    // same time take the lens as far at any frame rate.
    const v = this.v;
    const glide = EASE * k;
    const wantX = (right * cos - ahead * sin) * speed;
    const wantY = up * speed;
    const wantZ = (-right * sin - ahead * cos) * speed;
    this.p.x += wantX * dt + (v.x - wantX) * glide;
    this.p.y += wantY * dt + (v.y - wantY) * glide;
    this.p.z += wantZ * dt + (v.z - wantZ) * glide;
    v.x = wantX + (v.x - wantX) * decay;
    v.y = wantY + (v.y - wantY) * decay;
    v.z = wantZ + (v.z - wantZ) * decay;
    // Let go of, it stops: what is left of the glide is nothing.
    if (!right && !ahead && !up && v.lengthSq() < 1e-6) v.set(0, 0, 0);
    this.rollTo = clamp(this.rollTo + (held('KeyZ') - held('KeyX')) * ROLL_RATE * dt, this.roll0 - ROLL, this.roll0 + ROLL);
    this.roll += (this.rollTo - this.roll) * k;
    this.fov += (this.fovTo - this.fov) * k;
    if (this.limit) this.limit(this.p, v);
  }

  // The camera as the lens has it.
  write(camera) {
    camera.position.copy(this.p);
    camera.quaternion.setFromEuler(this._e.set(this.pitch, this.yaw, this.roll, 'YXZ'));
    if (Math.abs(camera.fov - this.fov) > 1e-6) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
  }
}

export class Photo {
  constructor(game) {
    this.game = game;
    this.lens = new Lens();
    this.lens.limit = (p, v) => this._limit(p, v);
    // off, on, or leaving: the lens on its way back, the world still standing.
    this.state = 'off';
    this.home = null;          // the lens as it was drawn when the mode began
    this.back = null;          // the way back: where it set out from, and how far along
    this.wet = true;           // whether the surface of the water holds the lens up (not where it began under it)
    this.hidden = false;       // the car put away
    this.busy = false;
    this.frames = 0;           // photo frames drawn (the game's own count does not move)
    this.last = null;          // the last picture taken
    this.drag = null;
    // For the interface: told when the state changes (state), and when a
    // picture is made (info) or cannot be (null, error). label() gives the
    // words of the file's name: { world, style }.
    this.onChange = null;
    this.onShot = null;
    this.label = () => ({ world: game.worldHere().id, style: game.style.id });
    this._headlight = 0;
    this._bind();
  }

  // Whether the world is standing still (the lens on its way back counts).
  get active() {
    return this.state !== 'off';
  }

  // The world stops and the lens is let go of, from where it is. Returns
  // whether it did anything.
  enter() {
    if (this.state === 'on') return false;
    const g = this.game;
    const cam = g.camera;
    if (this.state === 'leaving') {
      // Asked for again on the way back: the lens goes on from where it is.
      this.back = null;
      this.lens.from(cam.position, cam.quaternion, cam.fov);
      this._set('on');
      return true;
    }
    this.home = { p: cam.position.clone(), q: cam.quaternion.clone(), fov: cam.fov };
    this.lens.from(cam.position, cam.quaternion, cam.fov);
    // The surface of the water is the ground for a lens that began above it.
    const level = g.land.waterLevel(cam.position.x + g.road.origin.x, cam.position.z + g.road.origin.z);
    this.wet = !(cam.position.y < level);
    // A cut in the middle of a dissolve is taken at once: what was held is a lens that is no more.
    g.post.fadeLength = 0;
    g.post.fade = 0;
    this.drag = null;
    this._set('on');
    // Two frames, so that what a frame leans on the one before it for (the
    // grass's ground map reads the shadows of the frame before) has settled:
    // the first frame the lens shows is the one it will go on showing.
    this.frame(0);
    this.frame(0);
    return true;
  }

  // The lens goes back to where it began, in BACK s; then the world goes on.
  exit() {
    if (this.state !== 'on') return false;
    this.lens.clear();
    this.drag = null;
    this.hideCar(false);
    const cam = this.game.camera;
    this.back = { p: cam.position.clone(), q: cam.quaternion.clone(), fov: cam.fov, t: 0 };
    this._set('leaving');
    return true;
  }

  _set(state) {
    this.state = state;
    if (this.onChange) this.onChange(state);
  }

  // One frame of the photo mode: the lens goes where it is asked, what
  // follows it follows it, and the frame is drawn. dt: seconds of the wall's
  // clock.
  frame(dt) {
    if (!this.active) return;
    const g = this.game;
    const cam = g.camera;
    if (this.state === 'on') {
      this.lens.step(dt);
      this.lens.write(cam);
    } else {
      this._goBack(dt);
    }
    g.photoUpdate(dt);
    g.render(0);
    this.frames++;
    if (this.state === 'leaving' && this.back.t >= 1) {
      this.back = null;
      this._set('off');
    }
  }

  // The lens on its way back: a smooth step from where it set out to where it began.
  _goBack(dt) {
    const b = this.back;
    const cam = this.game.camera;
    b.t = Math.min(1, b.t + clamp(dt, 0, 0.1) / BACK);
    if (b.t >= 1) {
      cam.position.copy(this.home.p);
      cam.quaternion.copy(this.home.q);
      cam.fov = this.home.fov;
      cam.updateProjectionMatrix();
      return;
    }
    const k = b.t * b.t * b.t * (b.t * (b.t * 6 - 15) + 10);
    cam.position.lerpVectors(b.p, this.home.p, k);
    cam.quaternion.slerpQuaternions(b.q, this.home.q, k);
    cam.fov = b.fov + (this.home.fov - b.fov) * k;
    cam.updateProjectionMatrix();
  }

  // Where the lens may be: within REACH of the car, and over the ground (the
  // land's, the road's, the water's, whichever is highest) by CLEAR; in a
  // bore or under the cavern's roof, under the vault. Each is put right in
  // turn, a few times over, for the two can be at odds (a slope the car's
  // reach cuts across); the ground wins.
  _limit(p, v) {
    const g = this.game;
    const car = g.car;
    const cy = car.y || 0;
    const reach = REACH - 0.05;
    for (let i = 0; i < 6; i++) {
      let moved = false;
      const dx = p.x - car.x;
      const dy = p.y - cy;
      const dz = p.z - car.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > reach) {
        const k = reach / d;
        p.set(car.x + dx * k, cy + dy * k, car.z + dz * k);
        moved = true;
      }
      const floor = g.photoFloor(p.x, p.z, this.wet, p.y) + CLEAR;
      const roof = g.photoCeiling(p.x, p.z, p.y) - CLEAR;
      if (p.y > roof && roof > floor) {
        p.y = roof;
        if (v && v.y > 0) v.y = 0;
        moved = true;
      }
      if (p.y < floor) {
        p.y = floor;
        if (v && v.y < 0) v.y = 0;
        moved = true;
      }
      if (!moved) break;
    }
  }

  // The car put away (for a picture of the road), or brought back. Its lamps
  // go with it.
  hideCar(on) {
    if (on === this.hidden) return;
    const g = this.game;
    this.hidden = on;
    g.presentation.setVisible(!on);
    if (on) {
      this._headlight = g.headlight.intensity;
      g.headlight.intensity = 0;
    } else {
      g.headlight.intensity = this._headlight;
    }
  }

  // --- the pictures ---------------------------------------------------------

  // The frame as it stands, at twice the canvas's size (3840 by 2160 at most),
  // drawn again into a target of its own, so that the canvas is not touched
  // and nothing is seen to change on the screen, and made into a PNG. A card
  // that cannot make the largest size makes the next (pictureSizes), and the
  // picture says so (smaller). It is saved by the browser unless download is
  // false. Resolves with { name, width, height, wanted, smaller, size, blob }.
  async capture({ download = true } = {}) {
    if (this.state !== 'on') throw new Error('the lens is not let go of');
    if (this.busy) throw new Error('a picture is being made');
    this.busy = true;
    try {
      const g = this.game;
      const sizes = pictureSizes(g.canvas.width, g.canvas.height, g.renderer.capabilities.maxTextureSize);
      let frame = null;
      let error = null;
      for (const [width, height] of sizes) {
        try {
          frame = g.post.capture(width, height);
          break;
        } catch (e) {
          error = e;
          console.warn(`continuum: a picture of ${width} x ${height} could not be made:`, e.message);
          if (g.renderer.getContext().isContextLost()) break;
        }
      }
      if (!frame) throw error;
      const blob = await encode(frame);
      const label = this.label();
      const name = fileName(label.world, label.style, g.sCar);
      if (download) save(blob, name);
      this.last = { name, width: frame.width, height: frame.height, wanted: sizes[0], smaller: frame.width !== sizes[0][0], size: blob.size, blob };
      return this.last;
    } finally {
      this.busy = false;
    }
  }

  // The bytes of the last picture, the PNG as it was saved.
  async bytes() {
    if (!this.last) throw new Error('no picture has been taken');
    return new Uint8Array(await this.last.blob.arrayBuffer());
  }

  // A picture, and the interface told how it went.
  shoot() {
    return this.capture().then((info) => {
      if (this.onShot) this.onShot(info);
      return info;
    }, (error) => {
      if (this.onShot) this.onShot(null, error);
      throw error;
    });
  }

  // --- the keys and the mouse -----------------------------------------------

  _bind() {
    const canvas = this.game.canvas;
    addEventListener('keydown', (e) => {
      if (this.state !== 'on' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (KEYS.includes(e.code)) {
        this.lens.press(e.code);
        e.preventDefault();
      } else if (e.code === 'Enter') {
        // (A button with the focus would take it for a click too.)
        e.preventDefault();
        if (!e.repeat) this.shoot().catch(() => {});
      } else if (e.code === 'Escape') {
        this.exit();
      }
    });
    addEventListener('keyup', (e) => this.lens.release(e.code));
    addEventListener('blur', () => this.lens.clear());
    // The canvas's own pointer listeners (the right button that looks round
    // the car) do not hear what is for the lens: its events are taken first, and
    // only those of a drag that began in the mode.
    const mine = (e) => this.drag && e.pointerId === this.drag.id;
    addEventListener('pointerdown', (e) => {
      if (this.state !== 'on' || e.target !== canvas) return;
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      if (canvas.setPointerCapture) {
        try { canvas.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
      }
      e.stopImmediatePropagation();
      e.preventDefault();
    }, true);
    addEventListener('pointermove', (e) => {
      if (!mine(e)) return;
      const perPixel = (this.lens.fov * DEG) / Math.max(1, canvas.clientHeight);
      this.lens.drag(e.clientX - this.drag.x, e.clientY - this.drag.y, perPixel);
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      e.stopImmediatePropagation();
    }, true);
    const up = (e) => {
      if (!mine(e)) return;
      this.drag = null;
      e.stopImmediatePropagation();
    };
    addEventListener('pointerup', up, true);
    addEventListener('pointercancel', up, true);
    addEventListener('lostpointercapture', up, true);
    canvas.addEventListener('contextmenu', (e) => {
      if (this.active) e.preventDefault();
    });
    canvas.addEventListener('wheel', (e) => {
      if (this.state !== 'on') return;
      e.preventDefault();
      const pixels = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      this.lens.zoom(pixels * 0.0012);
    }, { passive: false });
  }
}
