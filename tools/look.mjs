// The look of a frame, in numbers.
//
// The other checks ask whether a thing is there and behaves. This one
// measures what a frame looks like, so that "more like a painted background",
// "the far land without speckle" or "no dearer to draw" can be said as a
// number, compared with the build before and with a reference picture, and
// held to a limit.
//
// It runs the real page headless at a list of fixed places (SHOTS), and for
// each one reads three things out of the page:
//  - the frame, as drawn;
//  - what each pixel is (sky, ground, tree, road, car, ...) and how far off:
//    the scene's depth, and the depth of each kind of thing drawn alone; a
//    pixel is of the kind whose depth it has;
//  - what the frame cost: draw calls, triangles, milliseconds;
//  - with a style that marks, the scene's alpha: what each thing marked
//    itself for the style's last pass, against the map (marks);
//  - with a style that paints strokes, the same frame with the strokes and
//    without them, before the last pass of all, for what the strokes leave
//    alone: the share of the sky's, the car's and the animals' pixels that
//    are the same either way (strokes);
//  - with a style that marks, the lines inside the car, between its parts,
//    and whether there are lines where the ground stands over it (lines);
//  - with a style that lays ink (ink, print), how thick the ink is laid: the
//    tone of each pixel between the paper and the ink, for the frame (frame.ink:
//    the paper left blank, the five tones of ink) and for each region (ink,
//    white), with the page's vignette taken off first (inkLab).
// and works the numbers out here, a region at a time (measure/region below).
// A picture from elsewhere (a reference) is measured the same way, its
// regions given as rectangles.
//
// Usage:
//   node tools/look.mjs                         every shot, real and paint, to out/look.json
//   node tools/look.mjs --shots hills,coast --styles real,paint,ink
//   node tools/look.mjs --write tools/look/baseline.json [--merge]
//   node tools/look.mjs --check tools/look/targets.json [--against tools/look/baseline.json]
//                                               a rule may say over: 'real' (this style's number less that style's,
//                                               in the same shot), less: 'ground.far.ink' (this number less that
//                                               one, of the same shot and style), mean: 15 (the mean over that many shots, held
//                                               once), optional: true (none to measure passes), gpu: true
//                                               (for a run with --gpu; the others are for a run without),
//                                               dist: ['trees.L', 'trees.a', 'trees.b'] with maxDist (how far
//                                               from the baseline those numbers are, together)
//   node tools/look.mjs --styles ink --check tools/look/targets-ink.json    the ink's tones (npm run check:ink)
//   node tools/look.mjs --shots alpine,valley,wood,hills,river,coast,desert,heaven,card --styles real
//                       --check tools/look/targets-real.json        the real style's day (npm run check:real)
//   node tools/look.mjs --dump [--out out/before/grass]  also write each frame and its map (to out/look/),
//                                               and the numbers to look.json beside them (for tools/sheet.mjs)
//   node tools/look.mjs --pinned out/pinned       also write the two frames of each frame.pinned over 0.09
//   node tools/look.mjs --tier low              at a tier (high, mid, low: render/quality.js); high when not given,
//                                               the page's address then as it always was
//   node tools/look.mjs --sky golden            every day world under that sky (noon, golden or grey: sky= in the
//                                               page's address); not given, the address has none, and a world has
//                                               the sky of its lap (the first lap, noon)
//   node tools/look.mjs --query a=b&c=d        more of the page's address, after the tier's and the sky's
//   node tools/look.mjs --gpu [--times 60]      on the real GPU, 1920x1080: for the cost, in milliseconds;
//                                               with no GPU to be had (SwiftShader) it fails, it does not
//                                               measure the software renderer instead
//   node tools/look.mjs --switch --gpu          the dearest frame in turning from the real style to each other
//                                               style, the first time, in a page that has drawn nothing else
//                                               (switch.max in ms; a rule over it has the shot 'switch:ink')
//   node tools/look.mjs --shots card --styles real   a grey card and a white ball by the road, read for the light (card.*, see SHOTS)
//   node tools/look.mjs --shots hills --scout 900,2200,3600,5000   looking for a place: a sheet of frames
//   node tools/look.mjs --image ref.png --regions "sky=0,0,1920,250;ground_near=0,800,1920,280" [--name ref]
// PORT=8189 moves the server it starts, to run beside another check.
// CHROME=/path/to/chrome overrides the browser; ANGLE=vulkan,gl the backends --gpu tries.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { deflateSync, inflateSync } from 'node:zlib';

const CHROME = process.env.CHROME || ({
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
}[process.platform] || '/usr/bin/google-chrome-stable');
// The GPU through ANGLE, by system, in the order they are tried: the first
// that gives a renderer other than SwiftShader is kept.
// ANGLE=gl (or a list, vulkan,gl) overrides them.
const ANGLES = process.env.ANGLE ? process.env.ANGLE.split(',')
  : { darwin: ['metal'], linux: ['vulkan', 'gl'], win32: ['d3d11'] }[process.platform] || ['gl'];
// Headless WebGL fails on Linux while DISPLAY is set.
const CHROME_ENV = { ...process.env };
delete CHROME_ENV.DISPLAY;
const PORT = Number(process.env.PORT) || 8183;
const ROOT = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The places: seed 7, a world and how far along the road in it (m), behind
// the car. A place is chosen for having in view what the numbers are about:
// sky, ground close by, land far off, and what the world is known by. The car
// is put on the road there and run for two and a half seconds at 22 m/s, in
// each style in turn, so every style is measured from the same spot.
// A place is measured the same whichever places and styles were asked for:
// a world's page always goes through all of its places and all the styles in
// the same order, putting the car down at each, and only stops to measure
// where it was asked to. (Add a place and the ones after it in its world move
// a little: measure that world's baseline again.) A place that has a page of
// its own (page: a name) is gone through with the places that have the same
// page, not with those of its world, so it moves none of them and none moves
// it: for a place that has to lie before the last place of its world, because
// what it is about is nowhere past it. Besides that, the lens is
// snapped behind the car, the clocks the clouds and their shadows go by are
// set, and the other cars and the animals are not drawn (life: true keeps
// them, for a place that is about them).
export const SHOTS = {
  alpine: { world: 'alpine', s: 900 },          // a hairpin under the peaks: sky, forest, rock, meadow
  valley: { world: 'alpine', s: 5000 },         // a valley in haze and a viaduct far off: the air
  hills: { world: 'hills', s: 5000 },           // open meadow, hills behind hills
  wood: { world: 'hills', s: 3600, pop: true }, // broadleaf trees close by, a house, a cutting (and trees changing over, drive)
  river: { world: 'river', s: 3600 },           // the river below, a wood, a cut slope
  coast: { world: 'coast', s: 900 },            // sea and sand on one side, pines on the other
  desert: { world: 'desert', s: 2200 },         // mesas, dunes
  city: { world: 'city', s: 2200 },             // a park, the skyline, lamps
  cavern: { world: 'cavern', s: 2200 },         // crystals, columns, lamps
  inferno: { world: 'inferno', s: 2200 },       // the lava river, a spire
  abyss: { world: 'abyss', s: 2200 },           // kelp, coral
  heaven: { world: 'heaven', s: 2200 },         // an island over the sea of cloud
  space: { world: 'space', s: 2200 },
  upside: { world: 'upside', s: 2200 },
  // The car stood still, seen from low by the road: grass in front of the
  // lens, and nothing moving but what the wind moves (shimmer, at rest).
  // The lens is put down by hand (eye: metres to the left of the road's middle,
  // above the ground there, behind the car; it looks at the car).
  meadow: { world: 'hills', s: 5055, still: true, eye: { side: -9, up: 1.7, back: 18 } },
  // A farmhouse by the road in the chase lens, close (7% of the frame) and from
  // far off (half of 1%): what the detail drawn on a building is about. The hills
  // have no house near the road past the last of their places, so these two have
  // a page of their own.
  farm: { world: 'hills', s: 3773, page: 'farm' },
  farmfar: { world: 'hills', s: 3730, page: 'farm' },
  // The other cars and the animals kept in the frame (life: true): in the
  // painted style's frame a box van goes by close to the lens. (The traffic
  // goes on while the page puts the car down once for each style, so it is in
  // the frame of that one.) The last of the hills' places, so that none of
  // theirs moves.
  life: { world: 'hills', s: 5300, life: true },
  // The light as a camera reads it: an 18 % grey card lying on the road in the
  // sun, another in the shadow of a disc held over it, and a white ball, put in
  // the scene for this place alone (CARD) and measured where they are in the
  // frame (card.lit, card.shade, card.ballLit, card.ballShade: OKLab L). It has a
  // page of its own and is measured in the real style only, the lens put by hand
  // a little above the road. rig: where each thing stands, in metres along the
  // road from the car and across it (to the right of the middle), the card's
  // side, the ball's radius, how high the disc is held and how wide it is.
  card: {
    world: 'hills', s: 5000, page: 'card', only: ['real'], eye: { side: -3.5, up: 4.5, back: 11 },
    rig: { size: 1.8, lit: [6, -2.2], ball: [6, 1.8], shade: [12, -2.2], radius: 0.5, hold: 4.5, disc: 1.8 },
  },
};
export const STYLES = ['real', 'paint', 'ink', 'cel', 'print', 'pixel', 'block'];

// What a pixel can be. The order is the order they are tried in: a later
// kind takes a pixel an earlier one also has the depth of (a tuft of grass
// stands on the ground; level ground at the height of a liquid's disc is ground).
export const KINDS = ['sky', 'water', 'terrain', 'road', 'built', 'forest', 'ground', 'life', 'car', 'other'];

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

// The page, headless, and a way to run code in it.
// angle: the ANGLE backend to draw on the GPU with; none, the software renderer.
async function openPage(query, angle = null) {
  const gpu = !!angle;
  const profile = `${tmpdir()}/continuum-look-${process.pid}-${Date.now()}`;
  const how = gpu
    ? ['--ignore-gpu-blocklist', '--enable-gpu', `--use-angle=${angle}`, '--disable-gpu-vsync', '--disable-frame-rate-limit']
    : ['--disable-gpu', '--enable-unsafe-swiftshader'];
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', ...how, '--mute-audio',
    '--hide-scrollbars', `--window-size=${gpu ? '1920,1223' : '1280,720'}`, '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    `http://localhost:${PORT}/index.html?${query}`], { stdio: ['ignore', 'ignore', 'pipe'], env: CHROME_ENV });
  const devtools = await new Promise((resolve) => {
    let text = '';
    chrome.stderr.on('data', (d) => {
      text += d;
      const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(text);
      if (m) resolve(new URL(m[1]));
    });
  });
  let page = null;
  for (let i = 0; i < 100 && !page; i++) {
    const list = await (await fetch(`http://${devtools.host}/json/list`)).json();
    page = list.find((t) => t.type === 'page' && t.url.includes('index.html'));
    if (!page) await sleep(200);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      logs.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    }
    if (msg.method === 'Runtime.exceptionThrown') logs.push(String(msg.params.exceptionDetails.text).slice(0, 300));
    if (pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  });
  ws.send(JSON.stringify({ id: 9999, method: 'Runtime.enable' }));
  const ev = (expression) => new Promise((resolve) => {
    pending.set(++id, (r) => resolve(r && r.result ? (r.result.value !== undefined ? r.result.value : r.result.description) : r));
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  });
  const close = () => {
    chrome.kill();
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
  };
  let title = '';
  for (let i = 0; i < 900; i++) {
    title = await ev('document.title');
    if (title === 'GAME_DONE' || String(title).startsWith('GAME_FAIL')) break;
    await sleep(500);
  }
  if (title !== 'GAME_DONE') {
    close();
    throw new Error(`page: ${title}`);
  }
  return {
    logs,
    run: async (body) => {
      const out = await ev(`(async () => { const g = game; ${body} })().then((v) => JSON.stringify(v), (e) => JSON.stringify({ error: e.message + ' ' + (e.stack || '').slice(0, 400) }))`);
      return JSON.parse(out);
    },
    close,
  };
}

// In the page: draw in a style, the car put on the road at s and run for two
// and a half seconds; the sky's light baked again for the style.
const PLACE = (s, style, cam = 'chase', still = false, eye = null, life = false) => `
  if (g.style.id !== ${JSON.stringify(style)}) {
    g.style.set(${JSON.stringify(style)}, true);
    g.style.applyScene();
  }
  const p = g.road.at(${s});
  if (!p) return { missing: true };
  g.autoMode = true;
  g.sCar = ${s};
  g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(${s}, 1.9) + 0.3);
  g.car.vx = ${still ? 0 : 22};
  g.setCamera(${JSON.stringify(cam)});
  // These are frames of a place, not of a drive: the lens points where the car does, and keeps still.
  g.chase.shaking = false;
  g.chase.lead = false;
  g.chase.snapTo(g.car, g.car.y || 0);
  g.style.wind[0] = 1000;
  g.style.wind[1] = 400;
  g.atmosphere.uniforms.uTime.value = 100;
  for (let i = 0; i < 150; i++) { g.pilot.vMax = ${still ? 0 : 22}; g.update(1 / 60); }
  g.post.setStyle(g.style);
  g.atmosphere.bakeEnvironment();
  window.__lookLife = ${life ? 'true' : 'false'};
  const eye = ${JSON.stringify(eye)};
  // Called before every frame drawn here: update() has put the lens back.
  window.__lookEye = eye ? () => {
    const q = g.road.at(g.sCar - eye.back);
    const x = q.x - Math.sin(q.theta) * eye.side, z = q.z + Math.cos(q.theta) * eye.side;
    g.camera.position.set(x, g.groundAt(x, z) + eye.up, z);
    g.camera.up.set(0, 1, 0);
    g.camera.lookAt(g.car.x, g.car.y + 0.7, g.car.z);
    g.camera.updateMatrixWorld();
  } : null;
  return { style: g.style.id };
`;

// In the page: a frame drawn as the shot is (the lens put where the shot
// has it, the other cars and the animals out of sight: update() shows them
// again, so they are put away before every frame drawn here); and the same
// moment with the lens turned (TURN degrees about the world's vertical, then
// raised RAISE about its own horizontal axis), for frame.pinned: everything
// in the world, the sky and the far land too, moves some thirty pixels on
// the screen, and what is pinned to the screen does not. The lens is put
// back as it was after.
const TURN = 2.5;
const RAISE = 1.2;
const DRAW = `
  const canvas = document.getElementById('view');
  const lifeRoots = [];
  if (!window.__lookLife) {
    const seen = new Set();
    const walk = (v, d) => {
      if (!v || typeof v !== 'object' || seen.has(v) || ArrayBuffer.isView(v)) return;
      seen.add(v);
      if (v.isObject3D) { let o = v; while (o.parent && o.parent !== g.scene) o = o.parent; if (o.parent === g.scene) lifeRoots.push(o); return; }
      if (d <= 0) return;
      if (v instanceof Map || v instanceof Set) { for (const x of v.values()) walk(x, d - 1); return; }
      if (Array.isArray(v)) { for (const x of v) walk(x, d - 1); return; }
      for (const k of Object.keys(v)) walk(v[k], d - 1);
    };
    walk(g.traffic, 2);
    walk(g.critters, 2);
  }
  const draw = () => {
    if (window.__lookEye) window.__lookEye();
    for (const o of lifeRoots) o.visible = false;
    g.render();
  };
  const drawTurned = () => {
    const c = g.camera;
    if (window.__lookEye) window.__lookEye();
    for (const o of lifeRoots) o.visible = false;
    const was = c.quaternion.clone();
    const yaw = c.quaternion.clone().setFromAxisAngle(c.up.clone().set(0, 1, 0), ${TURN} * Math.PI / 180);
    c.quaternion.premultiply(yaw);
    c.rotateX(${RAISE} * Math.PI / 180);
    c.updateMatrixWorld();
    g.render();
    c.quaternion.copy(was);
    c.updateMatrixWorld();
  };
`;

// In the page: the real style's frame and its turned frame, where the real
// style is only the reference for another style's frame.pinned.
const REFERENCE = `
  ${DRAW}
  draw();
  const frame = canvas.toDataURL('image/png');
  drawTurned();
  const turned = canvas.toDataURL('image/png');
  draw();
  return { frame, turned };
`;

// In the page: the card shot's things stood by the road where the car is (rig,
// SHOTS.card): two 18 % grey cards lying on it, one in the sun and one under the
// shadow of a disc held over it where the sun's rays through the disc come down on
// the card, and a white ball. They are of the game's own materials (so they are
// lit by its sun, its sky and its shadows as what is in the scene is) and in none of
// the groups a frame is told apart in: the map calls them 'other'.
const CARD = (rig) => `
  const THREE = await import('three');
  const { withAtmosphere } = await import('./src/render/atmosphere.js');
  const rig = ${JSON.stringify(rig)};
  const grey = (v) => new THREE.Color().setRGB(v, v, v);
  const make = (geometry, albedo) => {
    const o = new THREE.Mesh(geometry, withAtmosphere(new THREE.MeshStandardMaterial({ color: grey(albedo), roughness: 1, metalness: 0 })));
    o.castShadow = true;
    o.receiveShadow = true;
    g.scene.add(o);
    return o;
  };
  const s0 = g.sCar;
  const spot = (ds, lat) => {
    const p = g.road.at(s0 + ds);
    return new THREE.Vector3(p.x - Math.sin(p.theta) * lat, g.road.surfaceAt(s0 + ds, lat), p.z + Math.cos(p.theta) * lat);
  };
  // A card: its centre stands on the road's highest corner and lies flat, its top face the card.
  const card = (at) => {
    const c = spot(at[0], at[1]);
    const half = rig.size / 2;
    const top = Math.max(c.y, g.road.surfaceAt(s0 + at[0] + half, at[1] - half), g.road.surfaceAt(s0 + at[0] - half, at[1] + half)) + 0.05;
    const o = make(new THREE.BoxGeometry(rig.size, 0.04, rig.size), 0.18);
    o.position.set(c.x, top - 0.02, c.z);
    o.updateMatrixWorld();
    const p = g.road.at(s0 + at[0]);
    o.rotation.y = -p.theta;
    o.updateMatrixWorld();
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(a * half, 0.02, b * half).applyMatrix4(o.matrixWorld));
    return { at: c.clone().setY(top), corners };
  };
  const lit = card(rig.lit);
  const shade = card(rig.shade);
  const ball = make(new THREE.SphereGeometry(rig.radius, 48, 24), 0.9);
  const bc = spot(rig.ball[0], rig.ball[1]);
  ball.position.set(bc.x, bc.y + rig.radius + 0.02, bc.z);
  ball.updateMatrixWorld();
  // The disc is where the sun's ray to the shade card's centre meets the height it is held at.
  const sun = g.atmosphere.sunDir;
  const disc = make(new THREE.CylinderGeometry(rig.disc, rig.disc, 0.04, 48), 0.3);
  disc.position.set(shade.at.x + rig.hold * sun.x / sun.y, shade.at.y + rig.hold, shade.at.z + rig.hold * sun.z / sun.y);
  disc.updateMatrixWorld();
  window.__lookCard = { lit, shade, ball: { c: ball.position.clone(), r: rig.radius } };
  return { sun: sun.toArray(), lit: lit.at.toArray(), shade: shade.at.toArray(), ball: ball.position.toArray(), disc: disc.position.toArray() };
`;

// In the page: the frame, the frame a sixtieth of a second on, the map of
// what each pixel is and how far, and what it cost to draw.
const CAPTURE = `
  const THREE = await import('three');
  const { FullScreenQuad } = await import('./tools/vendor/postprocessing/Pass.js');
  const r = g.renderer, scene = g.scene, cam = g.camera;
  const gl = r.getContext();
  ${DRAW}
  draw();
  const frame = canvas.toDataURL('image/png');
  const cost = { calls: r.info.render.calls, triangles: r.info.render.triangles,
    geometries: r.info.memory.geometries, textures: r.info.memory.textures,
    programs: r.info.programs ? r.info.programs.length : null };
  const times = [];
  const px1 = new Uint8Array(4);
  // On a GPU the frames a page draws first are dear, for a second or more
  // after it has loaded (blocks of sixty read 8, 11, then 4.1 ms from 1.4 s
  // on, in three places), and the first style timed in a page read up to
  // twice what it read anywhere else in the order. So frames are drawn first
  // and not timed (--gpu only; in software a frame costs the same whenever
  // it is drawn): for two seconds at least, and until three blocks of thirty
  // in a row have medians within 4 % of each other, eight seconds at most.
  if (${'${WARM}'}) {
    const w0 = performance.now();
    let before = -1, calm = 0;
    while (performance.now() - w0 < 8000 && (performance.now() - w0 < 2000 || calm < 2)) {
      const block = [];
      for (let i = 0; i < 30; i++) {
        const t0 = performance.now();
        draw();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
        block.push(performance.now() - t0);
      }
      block.sort((a, b) => a - b);
      calm = Math.abs(block[15] - before) <= 0.04 * Math.max(block[15], before) ? calm + 1 : 0;
      before = block[15];
    }
  }
  for (let i = 0; i < ${'${TIMES}'}; i++) {
    // Reading a pixel back waits for the frame to be drawn; finish() alone
    // does not, across the browser's processes.
    const t0 = performance.now();
    draw();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  cost.ms = times.length ? times[times.length >> 1] : null;
  cost.ms95 = times.length ? times[Math.min(times.length - 1, Math.floor(times.length * 0.95))] : null;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  cost.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '';
  // The same moment, the lens turned.
  drawTurned();
  const turned = canvas.toDataURL('image/png');
  draw();

  // With a style that paints strokes: this same frame drawn twice more, with
  // the strokes and without them, and without what the last pass of all does
  // (render/present.js: it smooths an edge from the pixels along it), so that
  // the two are what the strokes' pass left, for what it leaves alone.
  let on = null, off = null;
  if (g.style.cur.paint > 0) {
    const c = g.style.cur;
    const was = [c.paint, c.aa, c.sharp];
    c.aa = 0; c.sharp = 0;
    draw();
    on = canvas.toDataURL('image/png');
    c.paint = 0;
    draw();
    off = canvas.toDataURL('image/png');
    [c.paint, c.aa, c.sharp] = was;
    draw();
  }

  // What each thing marked itself in the scene's alpha (render/style.js's
  // MARK), with a style that marks: the target the scene was drawn into,
  // read back in sixteen bits (rows top down, as the map's), and the ranges
  // a mark is read in.
  let alpha = null, markRange = null;
  if (g.style.cur.mark > 0.5 && g.post.tap.target) {
    markRange = (await import('./src/render/style.js')).MARK_RANGE;
    const sw = g.post.size.x, sh = g.post.size.y;
    const aenc = new THREE.WebGLRenderTarget(sw, sh);
    const aquad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tA: { value: g.post.tap.target.texture } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: [
        'precision highp float;',
        'uniform sampler2D tA; varying vec2 vUv;',
        'void main() {',
        '  float a = floor(clamp(texture2D(tA, vUv).a, 0.0, 1.0) * 65535.0 + 0.5);',
        '  gl_FragColor = vec4(mod(a, 256.0) / 255.0, floor(a / 256.0) / 255.0, 0.0, 1.0);',
        '}'].join('\\n'),
      depthTest: false, depthWrite: false }));
    r.setRenderTarget(aenc);
    aquad.render(r);
    const abuf = new Uint8Array(sw * sh * 4);
    r.readRenderTargetPixels(aenc, 0, 0, sw, sh, abuf);
    r.setRenderTarget(null);
    aenc.dispose(); aquad.dispose();
    const acv = document.createElement('canvas');
    acv.width = sw; acv.height = sh;
    const acx = acv.getContext('2d');
    const aim = acx.createImageData(sw, sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const s = ((sh - 1 - y) * sw + x) * 4, o = (y * sw + x) * 4;
      aim.data[o] = abuf[s]; aim.data[o + 1] = abuf[s + 1]; aim.data[o + 2] = 0; aim.data[o + 3] = 255;
    }
    acx.putImageData(aim, 0, 0);
    alpha = acv.toDataURL('image/png');
  }

  // The map. Each kind of thing has its roots among the scene's children.
  const top = (o) => { while (o.parent && o.parent !== scene) o = o.parent; return o.parent === scene ? o : null; };
  const taken = new Set();
  const rootsOf = (owner, depth = 3) => {
    const out = new Set();
    const seen = new Set();
    const walk = (v, d) => {
      if (!v || typeof v !== 'object' || seen.has(v) || ArrayBuffer.isView(v)) return;
      seen.add(v);
      if (v.isObject3D) { const t = top(v); if (t && !taken.has(t)) out.add(t); return; }
      if (d <= 0) return;
      if (v instanceof Map || v instanceof Set) { for (const x of v.values()) walk(x, d - 1); return; }
      if (Array.isArray(v)) { for (const x of v) walk(x, d - 1); return; }
      for (const k of Object.keys(v)) walk(v[k], d - 1);
    };
    walk(owner, depth);
    for (const o of out) taken.add(o);
    return out;
  };
  const one = (o) => { const s = new Set(); if (o && o.parent === scene) { s.add(o); taken.add(o); } return s; };
  const join = (...sets) => { const s = new Set(); for (const x of sets) for (const o of x) s.add(o); return s; };
  // In the order of KINDS, less the sky (what has no depth) and 'other'.
  const kinds = [
    join(one(g.water && g.water.mesh), one(g.ceiling && g.ceiling.mesh)),
    join(one(g.terrain && g.terrain.group)),
    join(one(g.roadMesh && g.roadMesh.group)),
    join(one(g.city && g.city.group), rootsOf(g.props, 2)),
    join(one(g.forest && g.forest.group)),
    join(rootsOf(g.clutter, 2), g.grass ? rootsOf(g.grass, 2) : new Set()),
    join(rootsOf(g.traffic, 2), rootsOf(g.critters, 2)),
    join(rootsOf(g.presentation, 2)),
  ];
  const w = g.post.size.x, h = g.post.size.y;
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(w, h) });
  const enc = new THREE.WebGLRenderTarget(w, h);
  const quad = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { tDepth: { value: rt.depthTexture }, uNF: { value: new THREE.Vector2(cam.near, cam.far) } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: [
      'precision highp float;',
      'uniform sampler2D tDepth; uniform vec2 uNF; varying vec2 vUv;',
      'void main() {',
      '  float d = texture2D(tDepth, vUv).r;',
      '  float z = uNF.x * uNF.y / (uNF.y - d * (uNF.y - uNF.x));',
      '  float v = d >= 0.999995 ? 1.0 : clamp(log2(1.0 + z) / log2(1.0 + uNF.y), 0.0, 0.99998);',
      '  float a = floor(v * 65535.0 + 0.5);',
      '  gl_FragColor = vec4(mod(a, 256.0) / 255.0, floor(a / 256.0) / 255.0, 0.0, 1.0);',
      '}'].join('\\n'),
    depthTest: false, depthWrite: false }));
  const kids = scene.children.slice();
  const vis = kids.map((k) => k.visible);
  const auto = r.shadowMap.autoUpdate;
  r.shadowMap.autoUpdate = false;
  // What each kind costs to draw, alone: its draw calls and its triangles.
  const spent = [];
  const depthOf = (roots) => {
    kids.forEach((k, i) => { k.visible = vis[i] && (!roots || k.isLight || roots.has(k)); });
    r.setRenderTarget(rt);
    r.clear();
    r.info.reset();
    r.render(scene, cam);
    spent.push([r.info.render.calls, r.info.render.triangles]);
    r.setRenderTarget(enc);
    quad.render(r);
    const buf = new Uint8Array(w * h * 4);
    r.readRenderTargetPixels(enc, 0, 0, w, h, buf);
    const out = new Uint16Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = buf[i * 4] | (buf[i * 4 + 1] << 8);
    return out;
  };
  const all = depthOf(null);
  const kind = new Uint8Array(w * h).fill(${'${OTHER}'});
  for (let i = 0; i < w * h; i++) if (all[i] === 65535) kind[i] = 0;
  kinds.forEach((roots, k) => {
    if (!roots.size) return;
    const d = depthOf(roots);
    for (let i = 0; i < w * h; i++) if (d[i] !== 65535 && d[i] === all[i]) kind[i] = k + 1;
  });
  kids.forEach((k, i) => { k.visible = vis[i]; });
  r.shadowMap.autoUpdate = auto;
  r.setRenderTarget(null);
  rt.depthTexture.dispose(); rt.dispose(); enc.dispose(); quad.dispose();
  // The map as a picture (rows top down): red the kind, green and blue the depth.
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  const im = cx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (h - 1 - y) * w + x, o = (y * w + x) * 4;
    im.data[o] = kind[s]; im.data[o + 1] = all[s] & 255; im.data[o + 2] = all[s] >> 8; im.data[o + 3] = 255;
  }
  cx.putImageData(im, 0, 0);
  const map = cv.toDataURL('image/png');

  // A sixtieth of a second on: what shimmers.
  g.update(1 / 60);
  draw();
  const next = canvas.toDataURL('image/png');

  // With the car stood still, the lens moved on half a metre at a time along
  // its view, sixteen times: of the pixels that are a tree in either of two
  // neighbouring frames and 60 m or more from the lens (nearer, a half metre
  // moves the edges of the trees several pixels, which is no swap), how many
  // change by more than 24 of 255 in a channel, as a share of all the frame's.
  // The most of the sixteen and their mean. Trees going over from one level
  // of detail to the next, and what is drawn of them being made again, show
  // here; so would a tree that comes and goes. On how many of the seventeen
  // frames the culling of the land was found again (it holds for a metre of the
  // lens's going) is counted too: cull.fresh.
  let pop = null;
  if (${'${POP}'}) {
    const pixels = async () => {
      const im = new Image();
      im.src = canvas.toDataURL('image/png');
      await im.decode();
      const c2 = document.createElement('canvas');
      c2.width = im.width;
      c2.height = im.height;
      const x2 = c2.getContext('2d');
      x2.drawImage(im, 0, 0);
      return x2.getImageData(0, 0, c2.width, c2.height).data;
    };
    // How far off each pixel of a tree is along the view, in metres (0 where
    // there is none): the depth of the scene's solid things, and of the trees
    // alone, as the lens sees them (rows from the bottom).
    const distances = () => {
      const rt2 = new THREE.WebGLRenderTarget(w, h);
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      const own = new Set();
      g.forest.group.traverse((o) => own.add(o));
      const put = [];
      scene.traverse((o) => {
        if (o.isMesh) {
          put.push([o, o.material, o.visible]);
          o.material = depth;
        } else if (o.isPoints || o.isLine || o.isSprite) {
          put.push([o, null, o.visible]);
          o.visible = false;
        }
      });
      const was = r.shadowMap.autoUpdate;
      r.shadowMap.autoUpdate = false;
      const read = () => {
        r.setRenderTarget(rt2);
        r.setClearColor(0xffffff, 1);
        r.clear();
        r.render(scene, cam);
        const buf = new Uint8Array(w * h * 4);
        r.readRenderTargetPixels(rt2, 0, 0, w, h, buf);
        const d = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) d[i] = buf[i * 4] / 4294967296 + buf[i * 4 + 1] / 16777216 + buf[i * 4 + 2] / 65536 + buf[i * 4 + 3] / 256;
        return d;
      };
      const all = read();
      for (const [o, , vis] of put) if (o.isMesh && !own.has(o)) o.visible = false;
      const mine = read();
      r.setRenderTarget(null);
      r.shadowMap.autoUpdate = was;
      for (const [o, m, vis] of put) {
        if (m) o.material = m;
        o.visible = vis;
      }
      rt2.dispose();
      depth.dispose();
      const out = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) {
        if (mine[i] < 0.999995 && Math.abs(mine[i] - all[i]) < 1e-6) out[i] = (cam.near * cam.far) / (cam.far - mine[i] * (cam.far - cam.near));
      }
      return out;
    };
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    const home = cam.position.clone();
    let before = null;
    const got = [];
    const culls0 = g._culled ? g._culled.n : 0;
    for (let k = 0; k <= 16; k++) {
      cam.position.copy(home).addScaledVector(fwd, 0.5 * k);
      cam.updateMatrixWorld();
      draw();
      const z = distances();
      const p = await pixels();
      if (before) {
        let changed = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const m = (h - 1 - y) * w + x;
            if (z[m] < 60 && before.z[m] < 60) continue;
            if (Math.abs(p[i] - before.p[i]) > 24 || Math.abs(p[i + 1] - before.p[i + 1]) > 24 || Math.abs(p[i + 2] - before.p[i + 2]) > 24) changed++;
          }
        }
        got.push(changed / (w * h));
      }
      before = { z, p };
    }
    const cull = g._culled ? { fresh: g._culled.n - culls0, frames: 17 } : null;
    cam.position.copy(home);
    cam.updateMatrixWorld();
    draw();
    pop = { max: Math.max(...got), mean: got.reduce((a, b) => a + b, 0) / got.length, cull };
  }
  // The paper and the ink of a style that lays ink (ink, print), for frame.ink.
  const sc = g.style.cur;
  const ink = sc.ink > 0 || sc.print > 0 ? { paper: sc.paper.slice(), col: sc.inkCol.slice(), vignette: sc.vignette } : null;
  // The card shot's things where they are in the frame (pixels from the top left).
  let card = null;
  if (window.__lookCard) {
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const px = (v) => { const q = v.clone().project(cam); return [(q.x + 1) / 2 * canvas.width, (1 - q.y) / 2 * canvas.height]; };
    const k = window.__lookCard;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const bc = px(k.ball.c);
    const be = px(k.ball.c.clone().addScaledVector(right, k.ball.r));
    card = {
      lit: k.lit.corners.map(px), shade: k.shade.corners.map(px),
      ball: { c: bc, r: Math.hypot(be[0] - bc[0], be[1] - bc[1]) },
    };
  }
  return { frame, turned, next, on, off, map, alpha, markRange, cost, far: cam.far, style: g.style.id, speed: g.car.speed, sCar: g.sCar,
    kinds: kinds.map((s) => s.size), spent, pop, ink, world: g.snapshot && g.snapshot().world, tier: g.tier, card };
`;

// In the page: turn from the real style to a style, drawing the frames of its
// 1.4 s as a player would see them (the page's own time goes on between them,
// so what is built in the background gets its turn), and time each.
const SWITCH = (style) => `
  const gl = g.renderer.getContext();
  const px = new Uint8Array(4);
  const draw = () => {
    const t0 = performance.now();
    g.render(1 / 60);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return performance.now() - t0;
  };
  // A few seconds of the real style first, as before a player's first change.
  for (let i = 0; i < 150; i++) { g.update(1 / 60); draw(); await new Promise((r) => setTimeout(r, 16)); }
  g.setStyle(${JSON.stringify(style)});
  const times = [];
  for (let i = 0; i < 100; i++) {
    g.update(1 / 60);
    times.push(draw());
    await new Promise((r) => setTimeout(r, 16));
  }
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return { times, style: g.style.id, moving: g.style.moving, gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '' };
`;

// In the page: the name of what draws.
const RENDERER = `
  const gl = g.renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '';
`;

// An 8-bit RGB or RGBA PNG, as canvas.toDataURL (or sips) writes one, to RGBA bytes.
function decodePNG(buf) {
  let p = 8;
  let w = 0;
  let h = 0;
  let bpp = 4;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0 || (data[9] !== 6 && data[9] !== 2)) throw new Error('unexpected PNG format');
      bpp = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  let line = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1);
    const f = raw[o];
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = raw[o + 1 + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const q = a + b - c;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - b);
        const pc = Math.abs(q - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[i] = line[x * bpp];
      out[i + 1] = line[x * bpp + 1];
      out[i + 2] = line[x * bpp + 2];
      out[i + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    [prev, line] = [line, prev];
  }
  return { w, h, data: out };
}

// RGBA bytes to a PNG, for a picture of the map.
function encodePNG(w, h, rgba) {
  const crcTable = encodePNG.t || (encodePNG.t = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  const crc = (b) => {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const fromURL = (url) => decodePNG(Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64'));

// --- the numbers ---------------------------------------------------------------

const LIN = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

// A picture in OKLab (L 0..1, a green-red, b blue-yellow): distances in it
// are about what the eye makes of them.
function toLab(img) {
  const n = img.w * img.h;
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  const d = img.data;
  for (let i = 0; i < n; i++) {
    const r = LIN[d[i * 4]];
    const g = LIN[d[i * 4 + 1]];
    const b = LIN[d[i * 4 + 2]];
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    L[i] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    A[i] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    B[i] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  }
  return { w: img.w, h: img.h, n, L, A, B };
}

const round = (v, k = 4) => (v === null || v === undefined || Number.isNaN(v) ? null : +v.toFixed(k));
const pct = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] : null);
const hue = (a, b) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;

// What a style that lays ink (ink, print) has on the page: its paper and its
// ink (colours as the page has them, 0..1, in sRGB) in OKLab. The ink of a
// pixel is t = (the paper's L less its L) over (the paper's L less the ink's),
// kept between 0 and 1: 0 the paper, 1 the ink laid on thick. The last pass
// darkens the page toward its corners (the vignette), the paper too: the
// ink is read from the frame with that taken off again (inkLab).
function inkRef(page) {
  if (!page) return null;
  const lab = ([r, g, b]) => {
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    return { L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s };
  };
  const paper = lab(page.paper);
  const ink = lab(page.col);
  return { paper, ink, span: paper.L - ink.L, vignette: page.vignette || 0 };
}
const inkT = (L, ref) => Math.min(1, Math.max(0, (ref.paper.L - L) / ref.span));

// A frame in OKLab with the vignette taken off (each pixel divided by what the
// last pass multiplied it by, 1 less the vignette's share of the pixel's
// squared distance from the middle).
function inkLab(img, ref) {
  const { w, h } = img;
  const data = new Uint8ClampedArray(img.data);
  if (ref.vignette > 0) {
    for (let y = 0; y < h; y++) {
      const dy = (y + 0.5) / h - 0.5;
      for (let x = 0; x < w; x++) {
        const dx = (x + 0.5) / w - 0.5;
        const k = 1 / (1 - ref.vignette * (dx * dx + dy * dy) * 2);
        const i = (y * w + x) * 4;
        data[i] = Math.round(data[i] * k);
        data[i + 1] = Math.round(data[i + 1] * k);
        data[i + 2] = Math.round(data[i + 2] * k);
      }
    }
  }
  return toLab({ w, h, data });
}

// The ink a region has: its mean t, and the share of it that is left white
// (t under 0.1).
function inkOf(lab, mask, ref) {
  let count = 0;
  let sum = 0;
  let white = 0;
  for (let i = 0; i < lab.n; i++) {
    if (!mask[i]) continue;
    const t = inkT(lab.L[i], ref);
    count++;
    sum += t;
    if (t < 0.1) white++;
  }
  return count ? { ink: round(sum / count), white: round(white / count) } : { ink: null, white: null };
}

// The ink of a frame, the pixels in skip (the car, kept in its colours) left
// out. paper: the share within 0.04 of the paper's colour in OKLab; tone: the
// mean t; bands: of the pixels that are not paper, the share in each of the
// five tones of ink, t from 0.1 to 0.3 (qing, 清), to 0.5 (dan, 淡), to 0.7
// (zhong, 重), to 0.9 (nong, 浓) and from 0.9 (jiao, 焦); bandMin: the thinnest
// of the five.
function inkFrame(lab, ref, skip) {
  const bands = [0, 0, 0, 0, 0];
  let kept = 0;
  let paper = 0;
  let sum = 0;
  for (let i = 0; i < lab.n; i++) {
    if (skip && skip[i]) continue;
    kept++;
    const t = inkT(lab.L[i], ref);
    sum += t;
    if (Math.hypot(lab.L[i] - ref.paper.L, lab.A[i] - ref.paper.a, lab.B[i] - ref.paper.b) < 0.04) {
      paper++;
      continue;
    }
    if (t >= 0.1) bands[Math.min(4, Math.floor((t - 0.1) / 0.2))]++;
  }
  const inked = kept - paper;
  const share = (v) => (inked > 0 ? round(v / inked) : null);
  return {
    paper: kept ? round(paper / kept) : null,
    tone: kept ? round(sum / kept) : null,
    bands: { qing: share(bands[0]), dan: share(bands[1]), zhong: share(bands[2]), nong: share(bands[3]), jiao: share(bands[4]) },
    bandMin: share(Math.min(...bands)),
  };
}

// One region of a picture (mask: 1 where it is).
//  share    how much of the frame it is
//  L, a, b  its mean colour; C its chroma, h its hue (degrees: 30 red, 110
//           yellow, 140 green, 250 blue)
//  L01..L99 its darkest and lightest hundredth, and its middle
//  tones    how many colours it takes to paint nine tenths of it (the colours
//           being cells 0.04 of L and 0.03 of a and b across): few is flat,
//           painted; many is a photograph
//  micro    how much it changes from a pixel to the next but one (the mean
//           size of L's Laplacian, inside the region): speckle
//  flat     the share of it that is flat colour (a pixel within 0.008 of L of
//           each of its four neighbours): a painted tone, a facet
//  grain    how far its marks run one way (0: every way, a noise; 1: all one
//           way, hatching), in squares of 24 px, the busier counting for more
//  ink, white   with a style that lays ink (opt.ink): the mean of its pixels' t, the
//           ink between the paper (0) and the ink (1), and the share of them
//           left white (t under 0.1)
//  lit, shade, step, turn, shadeC, dA, dB   its light part and its dark part
//           (the two means its L falls into): their L, the dark over the
//           light, how far round the hue has gone in the dark (degrees,
//           toward blue is positive for a green or a yellow), the dark's
//           chroma over the light's, and the dark's a and b less the light's
//           (dB below zero: the shade is bluer, whatever the colour; a grey
//           has no hue to turn)
function region(lab, mask, opt = {}) {
  const { w, h, n, L, A, B } = lab;
  let count = 0;
  let sl = 0;
  let sa = 0;
  let sb = 0;
  const ls = [];
  const cells = new Map();
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    count++;
    sl += L[i];
    sa += A[i];
    sb += B[i];
    if (count % 3 === 0) ls.push(L[i]);
    const key = ((L[i] / 0.04) | 0) * 4096 + (((A[i] + 0.5) / 0.03) | 0) * 64 + (((B[i] + 0.5) / 0.03) | 0);
    cells.set(key, (cells.get(key) || 0) + 1);
  }
  if (count < Math.max(400, n * 0.004)) return null;
  ls.sort((x, y) => x - y);
  const counts = [...cells.values()].sort((x, y) => y - x);
  let tones = 0;
  for (let acc = 0; acc < count * 0.9; tones++) acc += counts[tones];
  let lap = 0;
  let lapN = 0;
  let gx = 0;
  let gy = 0;
  let edges = 0;
  let flat = 0;
  // The structure tensor, summed in squares of 24 px.
  const S = 24;
  const bw = Math.ceil(w / S);
  const bh = Math.ceil(h / S);
  const jxx = new Float32Array(bw * bh);
  const jyy = new Float32Array(bw * bh);
  const jxy = new Float32Array(bw * bh);
  const jn = new Uint16Array(bw * bh);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i] || !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) continue;
      lap += Math.abs(4 * L[i] - L[i - 1] - L[i + 1] - L[i - w] - L[i + w]);
      const sx = (L[i + 1] - L[i - 1]) * 0.5;
      const sy = (L[i + w] - L[i - w]) * 0.5;
      const dx = Math.abs(sx);
      const dy = Math.abs(sy);
      gx += dx;
      gy += dy;
      if (dx > 0.03) edges++;
      if (Math.abs(L[i] - L[i - 1]) < 0.008 && Math.abs(L[i] - L[i + 1]) < 0.008
        && Math.abs(L[i] - L[i - w]) < 0.008 && Math.abs(L[i] - L[i + w]) < 0.008) flat++;
      const bi = ((y / S) | 0) * bw + ((x / S) | 0);
      jxx[bi] += sx * sx;
      jyy[bi] += sy * sy;
      jxy[bi] += sx * sy;
      jn[bi]++;
      lapN++;
    }
  }
  let grainSum = 0;
  let grainW = 0;
  for (let b = 0; b < bw * bh; b++) {
    if (jn[b] < S * S * 0.6) continue;
    const e = jxx[b] + jyy[b];
    // A square with next to nothing in it has no grain to speak of.
    if (e / jn[b] < 2e-5) continue;
    grainSum += Math.hypot(jxx[b] - jyy[b], 2 * jxy[b]);
    grainW += e;
  }
  // The light part and the dark part: two means of L.
  let lo = pct(ls, 0.25);
  let hi = pct(ls, 0.75);
  let split = (lo + hi) / 2;
  for (let it = 0; it < 8; it++) {
    let a = 0;
    let an = 0;
    let b = 0;
    let bn = 0;
    for (const v of ls) {
      if (v < split) { a += v; an++; } else { b += v; bn++; }
    }
    if (!an || !bn) break;
    lo = a / an;
    hi = b / bn;
    split = (lo + hi) / 2;
  }
  const part = [[0, 0, 0, 0], [0, 0, 0, 0]];
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const p = part[L[i] < split ? 0 : 1];
    p[0]++;
    p[1] += L[i];
    p[2] += A[i];
    p[3] += B[i];
  }
  const dark = part[0];
  const light = part[1];
  const two = dark[0] > count * 0.05 && light[0] > count * 0.05 && hi - lo > 0.04;
  const cD = Math.hypot(dark[2], dark[3]) / Math.max(dark[0], 1);
  const cL = Math.hypot(light[2], light[3]) / Math.max(light[0], 1);
  let turn = hue(dark[2], dark[3]) - hue(light[2], light[3]);
  turn = ((turn + 540) % 360) - 180;
  const ma = sa / count;
  const mb = sb / count;
  const out = {
    share: round(count / n),
    L: round(sl / count), a: round(ma), b: round(mb), C: round(Math.hypot(ma, mb)), h: round(hue(ma, mb), 1),
    L01: round(pct(ls, 0.01)), L50: round(pct(ls, 0.5)), L99: round(pct(ls, 0.99)),
    tones,
    micro: lapN > 200 ? round(lap / lapN, 5) : null,
    flat: lapN > 200 ? round(flat / lapN, 3) : null,
    grain: grainW > 0 ? round(grainSum / grainW, 3) : null,
    lit: two ? round(light[1] / light[0]) : null,
    shade: two ? round(dark[1] / dark[0]) : null,
    step: two ? round(dark[1] / dark[0] / (light[1] / light[0])) : null,
    turn: two && cD > 0.02 && cL > 0.02 ? round(turn, 1) : null,
    shadeC: two && cL > 0.01 ? round(cD / cL, 3) : null,
    shadeShare: two ? round(dark[0] / count, 3) : null,
    dA: two ? round(dark[2] / dark[0] - light[2] / light[0]) : null,
    dB: two ? round(dark[3] / dark[0] - light[3] / light[0]) : null,
  };
  if (opt.blades) {
    // Blades of grass: more change across than up and down, and thin
    // upright edges in it.
    out.upright = lapN > 200 ? round(gx / Math.max(gy, 1e-6), 3) : null;
    out.edges = lapN > 200 ? round(edges / lapN, 4) : null;
  }
  // The ink of a style that lays ink: its mean t and the share left white.
  if (opt.ink) Object.assign(out, inkOf(opt.ink.lab, mask, opt.ink.ref));
  return out;
}

// The sky: how much of it is cloud (a pixel of low chroma, or very light,
// where the clear sky has a colour), the biggest cloud's share of it, and the
// cloud's own light and shade. The clear sky's colour is what is left.
function sky(lab, mask) {
  const { w, h, n, L, A, B } = lab;
  const cloud = new Uint8Array(n);
  const clear = new Uint8Array(n);
  let skyN = 0;
  let cloudN = 0;
  const cs = [];
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    skyN++;
    if (skyN % 5 === 0) cs.push(Math.hypot(A[i], B[i]));
  }
  cs.sort((x, y) => x - y);
  // The clear sky's chroma: what the most coloured twentieth of the sky has. A
  // sky with none (a haze, a night, a page left blank) has no cloud to tell
  // from it: all of it is "clear".
  const ref = pct(cs, 0.95) || 0;
  const coloured = ref >= 0.05;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const c = Math.hypot(A[i], B[i]);
    if (coloured && c < 0.5 * ref && L[i] > 0.5) {
      cloud[i] = 1;
      cloudN++;
    } else {
      clear[i] = 1;
    }
  }
  if (skyN < n * 0.02) return null;
  // The biggest cloud, on a grid a quarter the size.
  const gw = w >> 2;
  const gh = h >> 2;
  const grid = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) grid[y * gw + x] = cloud[(y * 4 + 1) * w + x * 4 + 1];
  let biggest = 0;
  const stack = [];
  for (let s = 0; s < gw * gh; s++) {
    if (grid[s] !== 1) continue;
    let size = 0;
    stack.push(s);
    grid[s] = 2;
    while (stack.length) {
      const i = stack.pop();
      size++;
      const x = i % gw;
      if (x > 0 && grid[i - 1] === 1) { grid[i - 1] = 2; stack.push(i - 1); }
      if (x < gw - 1 && grid[i + 1] === 1) { grid[i + 1] = 2; stack.push(i + 1); }
      if (i >= gw && grid[i - gw] === 1) { grid[i - gw] = 2; stack.push(i - gw); }
      if (i < gw * (gh - 1) && grid[i + gw] === 1) { grid[i + gw] = 2; stack.push(i + gw); }
    }
    biggest = Math.max(biggest, size);
  }
  // How hard the cloud's edge is: the step in L from a cloud pixel to the
  // clear sky beside it, over the difference between the two on the whole.
  const cl = region(lab, cloud);
  const sk = region(lab, clear);
  let edge = 0;
  let edgeN = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!cloud[i]) continue;
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (clear[j]) { edge += Math.abs(L[i] - L[j]); edgeN++; }
      }
    }
  }
  return {
    share: round(skyN / n),
    c95: round(ref, 4), coloured, cloud: coloured ? round(cloudN / skyN, 3) : null,
    biggest: coloured ? round(Math.min(1, (biggest * 16) / skyN), 3) : null,
    cloudLit: cl && cl.lit, cloudShade: cl && cl.shade, cloudShadeShare: cl && cl.shadeShare, cloudTones: cl && cl.tones,
    cloudShadeB: cl ? round(cl.b, 4) : null,
    edge: cl && sk && edgeN > 50 ? round(edge / edgeN / Math.max(0.02, Math.abs(cl.L99 - sk.L50)), 3) : null,
    clearL: sk && sk.L, clearC: sk && sk.C, clearH: sk && sk.h, clearTones: sk && sk.tones, clearMicro: sk && sk.micro,
  };
}

// Small things that stand out of the ground they are on: flowers, stones.
// Pixels far in colour (0.1) from the mean of the 17 px square about them,
// in groups of 2 to 80: how many groups to a hundred thousand pixels of ground.
function specks(lab, mask) {
  const { w, h, n, L, A, B } = lab;
  const R = 8;
  const W = w + 1;
  const sum = (src) => {
    const t = new Float64Array(W * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        row += mask[i] ? src[i] : 0;
        t[(y + 1) * W + x + 1] = t[y * W + x + 1] + row;
      }
    }
    return t;
  };
  const one = new Float32Array(n).fill(1);
  const tn = sum(one);
  const tl = sum(L);
  const ta = sum(A);
  const tb = sum(B);
  const box = (t, x, y) => {
    const x0 = Math.max(0, x - R);
    const x1 = Math.min(w, x + R + 1);
    const y0 = Math.max(0, y - R);
    const y1 = Math.min(h, y + R + 1);
    return t[y1 * W + x1] - t[y0 * W + x1] - t[y1 * W + x0] + t[y0 * W + x0];
  };
  const odd = new Uint8Array(n);
  let ground = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      ground++;
      const k = box(tn, x, y);
      if (k < 60) continue;
      const dl = L[i] - box(tl, x, y) / k;
      const da = A[i] - box(ta, x, y) / k;
      const db = B[i] - box(tb, x, y) / k;
      if (dl * dl + da * da + db * db > 0.01) odd[i] = 1;
    }
  }
  if (ground < n * 0.01) return null;
  let groups = 0;
  const stack = [];
  for (let s = 0; s < n; s++) {
    if (odd[s] !== 1) continue;
    let size = 0;
    stack.push(s);
    odd[s] = 2;
    while (stack.length) {
      const i = stack.pop();
      size++;
      const x = i % w;
      if (x > 0 && odd[i - 1] === 1) { odd[i - 1] = 2; stack.push(i - 1); }
      if (x < w - 1 && odd[i + 1] === 1) { odd[i + 1] = 2; stack.push(i + 1); }
      if (i >= w && odd[i - w] === 1) { odd[i - w] = 2; stack.push(i - w); }
      if (i < n - w && odd[i + w] === 1) { odd[i + w] = 2; stack.push(i + w); }
    }
    if (size >= 2 && size <= 80) groups++;
  }
  return round((groups * 100000) / ground, 1);
}

// A line drawn round a thing: of the pixels of it that touch what is not it,
// the share with something darker than L 0.38 on them or beside them.
function outline(lab, mask) {
  const { w, h, L } = lab;
  let edge = 0;
  let inked = 0;
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if (!mask[i] || (mask[i - 1] && mask[i + 1] && mask[i - w] && mask[i + w])) continue;
      edge++;
      let dark = 1;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) dark = Math.min(dark, L[i + dy * w + dx]);
      if (dark < 0.38) inked++;
    }
  }
  return edge > 60 ? round(inked / edge, 3) : null;
}

// The whole frame, as tools/style_check.mjs measures one: how much colour
// (HSV), how much fine texture (the median of luma's Laplacian), and with
// them how many colours paint nine tenths of it, how dark the darkest
// hundredth is, how much of it is darker than L 0.2 (black, to a painter)
// and how much is lighter than L 0.985 (burnt out).
function whole(img, lab, skip) {
  const { w, h, data } = img;
  const n = w * h;
  let sat = 0;
  let cnt = 0;
  const sats = [];
  const luma = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    luma[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    if (skip && skip[i]) continue;
    const mx = Math.max(r, g, b);
    const s = mx > 1e-3 ? (mx - Math.min(r, g, b)) / mx : 0;
    sat += s;
    cnt++;
    if (i % 7 === 0) sats.push(s);
  }
  const laps = [];
  for (let y = 1; y < h - 1; y += 3) {
    for (let x = 1; x < w - 1; x += 3) {
      const i = y * w + x;
      laps.push(Math.abs(4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - w] - luma[i + w]));
    }
  }
  sats.sort((a, b) => a - b);
  laps.sort((a, b) => a - b);
  const keep = new Uint8Array(n);
  let darkN = 0;
  let whiteN = 0;
  for (let i = 0; i < n; i++) {
    keep[i] = skip && skip[i] ? 0 : 1;
    if (keep[i] && lab.L[i] < 0.2) darkN++;
    if (keep[i] && lab.L[i] > 0.985) whiteN++;
  }
  const all = region(lab, keep);
  return {
    sat: round(sat / Math.max(cnt, 1), 3), sat95: round(pct(sats, 0.95), 3), texture: round(laps[laps.length >> 1], 4),
    tones: all && all.tones, flat: all && all.flat, L01: all && all.L01, L50: all && all.L50, L99: all && all.L99,
    dark: round(darkN / Math.max(cnt, 1), 4), white: round(whiteN / Math.max(cnt, 1), 4),
  };
}

// How much a region changes in a sixtieth of a second: the mean size of the
// change in L. Far off, where nothing has had time to move a pixel, it is
// what shimmers.
function shimmer(a, b, mask) {
  let s = 0;
  let c = 0;
  for (let i = 0; i < a.n; i++) {
    if (!mask[i]) continue;
    s += Math.abs(a.L[i] - b.L[i]);
    c++;
  }
  return c > 400 ? round(s / c, 5) : null;
}

// A frame's fine detail: its luma (0-255, whole numbers) less the mean of
// the 5 by 5 pixels round it. (As tools/style_check.mjs has it.)
function fine(img) {
  const { w, h, data } = img;
  const l = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) l[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let j = -2; j <= 2; j++) {
        const yy = Math.min(h - 1, Math.max(0, y + j)) * w;
        for (let i = -2; i <= 2; i++) s += l[yy + Math.min(w - 1, Math.max(0, x + i))];
      }
      out[y * w + x] = l[y * w + x] - Math.round(s / 25);
    }
  }
  return out;
}

// A pattern fixed to the screen (tools/style_check.mjs's measure): two real
// frames, the shot's and the same moment with the lens turned (DRAW), pick
// out where the scene is smooth in both (no fine detail in either); there,
// fine detail that the style's two frames share at the same pixels stayed
// put while the whole world moved on the screen. Their correlation: about 0
// when nothing in the style is fixed to the screen, a paper grain laid on it
// 0.1-0.2. Of the real style itself, nothing (it has no detail where it is
// smooth).
function pinned(realA, realB, styleA, styleB) {
  if (realA.w !== styleA.w || realA.h !== styleA.h) return null;
  const [ra, rb, sa, sb] = [realA, realB, styleA, styleB].map(fine);
  let n = 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < ra.length; i++) {
    if (ra[i] !== 0 || rb[i] !== 0) continue;
    n++;
    mx += sa[i];
    my += sb[i];
  }
  if (n < 400) return null;
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < ra.length; i++) {
    if (ra[i] !== 0 || rb[i] !== 0) continue;
    sxy += (sa[i] - mx) * (sb[i] - my);
    sxx += (sa[i] - mx) ** 2;
    syy += (sb[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? round(sxy / Math.sqrt(sxx * syy)) : null;
}

// The distances the ground is read at (m): near, where a blade of grass is a
// blade; the middle, where a stroke is a stroke; far, where the land is
// shapes of colour; and the far ranges.
export const ZONES = { near: [0, 40], mid: [40, 300], far: [300, 1500], range: [1500, 1e9] };

// The kinds a style's last pass can tell by their mark in the scene's alpha
// (render/style.js's MARK), and the range each is read in there. The liquids
// are drawn blended and have no mark.
export const MARKED = { forest: 'leaf', ground: 'leaf', built: 'built', car: 'car', life: 'life' };

// marks: of each kind's pixels in the map, the share whose alpha (the scene's,
// read back) is in the kind's range; null for a kind with too few pixels to
// say (as region). Read only with a style that marks.
function marks(alpha, map, range) {
  if (alpha.w !== map.w || alpha.h !== map.h) throw new Error(`marks: alpha ${alpha.w}x${alpha.h}, map ${map.w}x${map.h}`);
  const n = map.w * map.h;
  const K = Object.fromEntries(KINDS.map((k, i) => [k, i]));
  const out = {};
  for (const [kind, mark] of Object.entries(MARKED)) {
    const [lo, hi] = range[mark];
    let count = 0;
    let hit = 0;
    for (let i = 0; i < n; i++) {
      if (map.data[i * 4] !== K[kind]) continue;
      count++;
      const a = (alpha.data[i * 4] | (alpha.data[i * 4 + 1] << 8)) / 65535;
      if (a >= lo && a < hi) hit++;
    }
    out[kind] = count < Math.max(400, n * 0.004) ? null : round(hit / count, 3);
  }
  return out;
}

// The scene's alpha (what each thing marked itself, read back in sixteen
// bits) at the pixels of a frame of w by h.
function markPlane(alpha, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const my = Math.min(alpha.h - 1, Math.floor(((y + 0.5) * alpha.h) / h));
    for (let x = 0; x < w; x++) {
      const mx = Math.min(alpha.w - 1, Math.floor(((x + 0.5) * alpha.w) / w));
      const o = (my * alpha.w + mx) * 4;
      out[y * w + x] = (alpha.data[o] | (alpha.data[o + 1] << 8)) / 65535;
    }
  }
  return out;
}

// The lines of a figure, read from the marks. parts: of the places inside the
// car where the mark changes from one pixel to the next (between its body,
// its wheels, its lamps, its trim and its glass), the share with a line (a
// pixel darker than L 0.38) within 2 px of either. covered: of the places
// where the ground stands over the car (a ground pixel beside a car pixel and
// nearer than it by a fiftieth: the edge is the ground's, so no line is wanted
// there), the share with a line on them: a pixel of the pair darker than L 0.38
// and darker by 0.1 than the pixel beside it further from the edge, a dark
// ridge, not just a dark part of the car (a tyre under a blade of grass).
// partsN and coveredN are how many places there were; null for a count too
// small to say (under 60 and under 20).
function figureLines(lab, kind, dist, mark, K) {
  const { w, h, L } = lab;
  const dark = (i) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (L[i + dy * w + dx] < 0.38) return true;
    return false;
  };
  // A line at i, whose neighbour outward from the edge is o (a step of one
  // pixel, away from the other pixel of the pair).
  const ridge = (i, o) => L[i] < 0.38 && L[i] < L[i + o] - 0.1;
  let parts = 0;
  let partsInked = 0;
  let covered = 0;
  let coveredInked = 0;
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      for (const j of [i + 1, i + w]) {
        const a = kind[i];
        const b = kind[j];
        if (a === K.car && b === K.car) {
          if (Math.abs(mark[i] - mark[j]) < 0.02) continue;
          parts++;
          if (dark(i) || dark(j)) partsInked++;
        } else if ((a === K.ground && b === K.car) || (a === K.car && b === K.ground)) {
          const g = a === K.ground ? i : j;
          const c = a === K.ground ? j : i;
          if (!(dist[g] < dist[c] * 0.98)) continue;
          covered++;
          if (ridge(g, g - c) || ridge(c, c - g)) coveredInked++;
        }
      }
    }
  }
  return {
    parts: parts >= 60 ? round(partsInked / parts, 3) : null, partsN: parts,
    covered: covered >= 20 ? round(coveredInked / covered, 3) : null, coveredN: covered,
  };
}

// The card shot's things in the frame, as the page found them (CAPTURE: the four
// corners of each card's top face and the ball's disc, in pixels from the top left):
// lit and shade, the middle (median) L of the middle of each card's face (its corners
// brought in by half toward its centre, where they are the card and not its edge); and,
// of the ball, the L of the lightest and of the darkest tenth of the pixels of the middle
// 85 % of its disc (the lit side and the side the sun does not reach); and how many
// pixels each is of.
function measureCard(lab, found) {
  const { w, h, L } = lab;
  const inner = (corners) => {
    const cx = corners.reduce((a, c) => a + c[0], 0) / 4;
    const cy = corners.reduce((a, c) => a + c[1], 0) / 4;
    const q = corners.map(([x, y]) => [cx + (x - cx) * 0.5, cy + (y - cy) * 0.5]);
    // The corners are in the order round the face: a pixel is in when it is on the one side of all four edges.
    const area = q.reduce((a, c, i) => a + (c[0] * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * c[1]), 0);
    const sign = area >= 0 ? 1 : -1;
    const xs = q.map((c) => c[0]);
    const ys = q.map((c) => c[1]);
    const vals = [];
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(h - 1, Math.ceil(Math.max(...ys))); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(w - 1, Math.ceil(Math.max(...xs))); x++) {
        let side = true;
        for (let i = 0; i < 4 && side; i++) {
          const a = q[i];
          const b = q[(i + 1) % 4];
          side = sign * ((b[0] - a[0]) * (y + 0.5 - a[1]) - (b[1] - a[1]) * (x + 0.5 - a[0])) >= 0;
        }
        if (side) vals.push(L[y * w + x]);
      }
    }
    return vals;
  };
  const middle = (vals) => (vals.length ? round(vals.slice().sort((a, b) => a - b)[vals.length >> 1]) : null);
  const lit = inner(found.lit);
  const shade = inner(found.shade);
  const [bx, by] = found.ball.c;
  const br = found.ball.r * 0.85;
  const disc = [];
  for (let y = Math.max(0, Math.floor(by - br)); y <= Math.min(h - 1, Math.ceil(by + br)); y++) {
    for (let x = Math.max(0, Math.floor(bx - br)); x <= Math.min(w - 1, Math.ceil(bx + br)); x++) {
      if (Math.hypot(x + 0.5 - bx, y + 0.5 - by) <= br) disc.push(L[y * w + x]);
    }
  }
  disc.sort((a, b) => a - b);
  const tenth = Math.max(1, Math.floor(disc.length / 10));
  const mean = (vs) => (vs.length ? round(vs.reduce((a, b) => a + b, 0) / vs.length) : null);
  return {
    lit: middle(lit), shade: middle(shade),
    ballLit: mean(disc.slice(disc.length - tenth)), ballShade: mean(disc.slice(0, tenth)),
    pixels: { lit: lit.length, shade: shade.length, ball: disc.length },
  };
}

// A frame from the page, with its map, to numbers.
function measureShot(cap) {
  const img = fromURL(cap.frame);
  const nxt = fromURL(cap.next);
  const map = fromURL(cap.map);
  const { w, h } = img;
  const n = w * h;
  // The map is the scene's size; the frame is the canvas's.
  const kind = new Uint8Array(n);
  const dist = new Float32Array(n);
  const lf = Math.log2(1 + cap.far);
  for (let y = 0; y < h; y++) {
    const my = Math.min(map.h - 1, Math.floor(((y + 0.5) * map.h) / h));
    for (let x = 0; x < w; x++) {
      const mx = Math.min(map.w - 1, Math.floor(((x + 0.5) * map.w) / w));
      const o = (my * map.w + mx) * 4;
      kind[y * w + x] = map.data[o];
      const code = map.data[o + 1] | (map.data[o + 2] << 8);
      dist[y * w + x] = code === 65535 ? Infinity : Math.pow(2, (code / 65535) * lf) - 1;
    }
  }
  const lab = toLab(img);
  const lab2 = toLab(nxt);
  const ink = inkRef(cap.ink);
  const labInk = ink ? inkLab(img, ink) : null;
  const inkOpt = ink ? { ref: ink, lab: labInk } : null;
  const K = Object.fromEntries(KINDS.map((k, i) => [k, i]));
  const mask = (fn) => {
    const m = new Uint8Array(n);
    for (let i = 0; i < n; i++) m[i] = fn(kind[i], dist[i]) ? 1 : 0;
    return m;
  };
  const isGround = (k) => k === K.terrain || k === K.ground;
  const car = mask((k) => k === K.car || k === K.life);
  const out = { size: [w, h], cost: { calls: cap.cost.calls, triangles: cap.cost.triangles, ms: round(cap.cost.ms, 2), ms95: round(cap.cost.ms95, 2), gpu: cap.cost.gpu,
    geometries: cap.cost.geometries, textures: cap.cost.textures, programs: cap.cost.programs } };
  // The scene alone (no shadow pass, no passes after it), and each kind of
  // thing in it: [draw calls, triangles]. Kinds with nothing in the scene
  // were not drawn and have no entry.
  if (cap.spent) {
    const names = ['scene', ...KINDS.slice(1, -1).filter((_, i) => cap.kinds[i] > 0)];
    out.cost.kinds = Object.fromEntries(cap.spent.map((v, i) => [names[i], v]));
  }
  out.frame = whole(img, lab, car);
  if (ink) out.frame.ink = inkFrame(labInk, ink, car);
  const skyMask = mask((k) => k === K.sky);
  out.sky = sky(lab, skyMask);
  if (ink && out.sky) Object.assign(out.sky, inkOf(labInk, skyMask, ink));
  out.ground = {};
  const zm = {};
  for (const [z, [d0, d1]] of Object.entries(ZONES)) {
    zm[z] = mask((k, d) => isGround(k) && d >= d0 && d < d1);
    out.ground[z] = region(lab, zm[z], { blades: z === 'near', ink: inkOpt });
    if (out.ground[z]) out.ground[z].shimmer = shimmer(lab, lab2, zm[z]);
  }
  const close = mask((k, d) => isGround(k) && d < 120);
  out.ground.specks = specks(lab, close);
  // The air between here and the far land: how far the ground's colour has
  // gone toward the clear sky's by the far zone and the ranges, lighter
  // (dL), bluer (db below zero), and how much of its chroma it keeps.
  const g0 = out.ground.near || out.ground.mid;
  for (const z of ['far', 'range']) {
    const g1 = out.ground[z];
    if (g0 && g1) out.ground[z].air = { dL: round(g1.L - g0.L), db: round(g1.b - g0.b), keep: round(g1.C / Math.max(g0.C, 1e-3), 3) };
  }
  out.trees = region(lab, mask((k) => k === K.forest), { ink: inkOpt });
  if (out.trees && cap.pop) {
    out.trees.pop = round(cap.pop.max, 5);
    out.trees.popMean = round(cap.pop.mean, 5);
    out.cull = cap.pop.cull;
  }
  out.treesNear = region(lab, mask((k, d) => k === K.forest && d < 190), { ink: inkOpt });
  out.road = region(lab, mask((k, d) => k === K.road && d < 150), { ink: inkOpt });
  // A building the car passes moves across the frame, and what is drawn on it
  // goes with it: its shimmer is mostly the motion of its edges.
  const builtMask = mask((k) => k === K.built);
  out.built = region(lab, builtMask, { ink: inkOpt });
  if (out.built) out.built.shimmer = shimmer(lab, lab2, builtMask);
  out.water = region(lab, mask((k) => k === K.water), { ink: inkOpt });
  out.life = region(lab, mask((k) => k === K.life));
  const carOnly = mask((k) => k === K.car);
  out.car = region(lab, carOnly);
  if (out.car) out.car.outline = outline(lab, carOnly);
  if (out.life) out.life.outline = outline(lab, mask((k) => k === K.life));
  // What the strokes leave as it was: the share of the sky's pixels, of the
  // car's and of the animals' (class by class, as drawn) that are the same
  // with the strokes off, before the last pass of all.
  if (cap.off) {
    const onImg = fromURL(cap.on);
    const offImg = fromURL(cap.off);
    const same = (i) => onImg.data[i * 4] === offImg.data[i * 4] && onImg.data[i * 4 + 1] === offImg.data[i * 4 + 1] && onImg.data[i * 4 + 2] === offImg.data[i * 4 + 2];
    const share = (k) => {
      let count = 0;
      let hit = 0;
      for (let i = 0; i < n; i++) {
        if (kind[i] !== K[k]) continue;
        count++;
        if (same(i)) hit++;
      }
      return count < Math.max(400, n * 0.004) ? null : round(hit / count, 4);
    };
    out.strokes = { sky: share('sky'), car: share('car'), life: share('life') };
    // Where they are not: the frame, with those pixels in magenta (for --dump).
    out.strokesAt = new Uint8Array(img.data);
    for (let i = 0; i < n; i++) {
      if (kind[i] !== K.sky && kind[i] !== K.car && kind[i] !== K.life) continue;
      if (!same(i)) { out.strokesAt[i * 4] = 255; out.strokesAt[i * 4 + 1] = 0; out.strokesAt[i * 4 + 2] = 255; }
    }
  }
  if (cap.card) out.card = measureCard(lab, cap.card);
  out.marks = cap.alpha ? marks(fromURL(cap.alpha), map, cap.markRange) : null;
  out.lines = cap.alpha ? figureLines(lab, kind, dist, markPlane(fromURL(cap.alpha), w, h), K) : null;
  return { out, img, kind, dist };
}

// A picture from elsewhere: its regions are rectangles, named as the
// regions of a shot are (sky, ground_near, ground_mid, ground_far,
// ground_range, trees, treesNear, road, built, water).
function measureImage(img, rects) {
  const lab = toLab(img);
  const { w, h } = img;
  const n = w * h;
  const out = { size: [w, h], frame: whole(img, lab, null), ground: {} };
  for (const [name, [x0, y0, rw, rh]] of Object.entries(rects)) {
    const m = new Uint8Array(n);
    for (let y = Math.max(0, y0); y < Math.min(h, y0 + rh); y++) for (let x = Math.max(0, x0); x < Math.min(w, x0 + rw); x++) m[y * w + x] = 1;
    if (name === 'sky') out.sky = sky(lab, m);
    else if (name.startsWith('ground_')) {
      const z = name.slice(7);
      out.ground[z] = region(lab, m, { blades: z === 'near' });
      if (z === 'near' || z === 'mid') out.ground['specks_' + z] = specks(lab, m);
    } else out[name] = region(lab, m);
  }
  const g0 = out.ground.near || out.ground.mid;
  for (const z of ['far', 'range']) {
    const g1 = out.ground[z];
    if (g0 && g1) g1.air = { dL: round(g1.L - g0.L), db: round(g1.b - g0.b), keep: round(g1.C / Math.max(g0.C, 1e-3), 3) };
  }
  return out;
}

// A picture of the map, to look at: each kind a colour, darker with distance.
function mapPicture(w, h, kind, dist) {
  const tint = [[90, 150, 230], [60, 110, 200], [120, 170, 80], [90, 90, 100], [200, 140, 90], [30, 110, 50], [200, 220, 90], [230, 120, 200], [240, 80, 40], [255, 0, 255]];
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const t = tint[kind[i]] || tint[9];
    const k = kind[i] === 0 ? 1 : 0.45 + 0.55 * Math.exp(-dist[i] / 600);
    out[i * 4] = t[0] * k;
    out[i * 4 + 1] = t[1] * k;
    out[i * 4 + 2] = t[2] * k;
    out[i * 4 + 3] = 255;
  }
  return encodePNG(w, h, out);
}

// --- limits -------------------------------------------------------------------

const dig = (o, path) => path.split('.').reduce((v, k) => (v === null || v === undefined ? undefined : v[k]), o);

// A list of limits: { shot: 'hills:paint', metric: 'sky.cloud', min, max },
// or against the same number in another run: { ..., of: 'baseline',
// minRatio, maxRatio, maxAdd }. A shot may be '*:paint' or 'hills:*'.
function check(results, rules, against, onGPU = false) {
  const failures = [];
  let passed = 0;
  for (const rule of rules) {
    // A rule with gpu: true is for a run with --gpu (milliseconds on a real
    // GPU), every other for a run without.
    if (!!rule.gpu !== onGPU) continue;
    const [ws, ss] = rule.shot.split(':');
    const ids = Object.keys(results).filter((id) => {
      const [w, s] = id.split(':');
      return (ws === '*' || ws === w) && (ss === '*' || ss === s);
    });
    const value = (id) => {
      let v = dig(results[id], rule.metric);
      // over: the same shot in another style (say real) taken off it, for what
      // one style costs over the other.
      if (rule.over) {
        const other = dig(results[`${id.split(':')[0]}:${rule.over}`], rule.metric);
        v = typeof v === 'number' && typeof other === 'number' ? round(v - other) : null;
      }
      // less: another number of the same shot taken off it (the near ground's
      // ink less the far ground's).
      if (rule.less) {
        const other = dig(results[id], rule.less);
        v = typeof v === 'number' && typeof other === 'number' ? round(v - other) : null;
      }
      return v;
    };
    // dist: how far this run's numbers are from the baseline's, as a distance
    // across the metrics it lists (a colour: L, a and b), at most maxDist.
    if (rule.dist) {
      for (const id of ids) {
        const here = rule.dist.map((m) => dig(results[id], m));
        const base = against && against[id] ? rule.dist.map((m) => dig(against[id], m)) : null;
        if (!base || here.concat(base).some((v) => typeof v !== 'number')) continue;
        const v = round(Math.hypot(...here.map((x, i) => x - base[i])));
        const ok = v <= rule.maxDist;
        const text = `${id} ${rule.dist.join(' ')} from the baseline = ${v}, at most ${rule.maxDist}${rule.why ? ` (${rule.why})` : ''}`;
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
        if (ok) passed++;
        else failures.push(text);
      }
      continue;
    }
    // mean: one number for the rule, the mean over the shots it names, which
    // the noise of one frame's time does not move as it moves each of them.
    // Its value is how many shots that is: a run of fewer is not held to it.
    if (rule.mean) {
      const vs = ids.map(value).filter((v) => typeof v === 'number');
      if (vs.length < rule.mean) continue;
      const v = round(vs.reduce((a, b) => a + b, 0) / vs.length);
      const ok = (rule.min === undefined || v >= rule.min) && (rule.max === undefined || v <= rule.max);
      const text = `${rule.shot} ${rule.metric}, the mean of ${vs.length} shots = ${v}${rule.min !== undefined ? `, at least ${rule.min}` : ''}${rule.max !== undefined ? `, at most ${rule.max}` : ''}${rule.why ? ` (${rule.why})` : ''}`;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
      if (ok) passed++;
      else failures.push(text);
      continue;
    }
    for (const id of ids) {
      let v = value(id);
      let lo = rule.min;
      let hi = rule.max;
      if (rule.of) {
        const base = against && against[id] ? dig(against[id], rule.metric) : undefined;
        if (base === undefined || base === null) continue;
        if (rule.minRatio !== undefined) lo = base * rule.minRatio;
        if (rule.maxRatio !== undefined) hi = base * rule.maxRatio;
        if (rule.maxAdd !== undefined) hi = base + rule.maxAdd;
        if (rule.minAdd !== undefined) lo = base + rule.minAdd;
      }
      // optional: a shot where there is none of the thing measured (no sky
      // to speak of: null) is passed over.
      if (rule.optional && (v === null || v === undefined)) continue;
      const ok = v !== null && v !== undefined && (lo === undefined || v >= lo) && (hi === undefined || v <= hi);
      const text = `${id} ${rule.metric}${rule.less ? ` less ${rule.less}` : ''} = ${v}${lo !== undefined ? `, at least ${round(lo)}` : ''}${hi !== undefined ? `, at most ${round(hi)}` : ''}${rule.why ? ` (${rule.why})` : ''}`;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
      if (ok) passed++;
      else failures.push(text);
    }
  }
  return { passed, failures };
}

// --- main ---------------------------------------------------------------------

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const has = (name) => args.includes(name);

if (has('--image')) {
  // A picture from elsewhere. sips (macOS) makes a PNG of what is not one.
  const file = opt('--image');
  let buf = readFileSync(file);
  if (buf[0] !== 137) {
    const tmp = `${tmpdir()}/continuum-look-${process.pid}.png`;
    await new Promise((resolve, reject) => {
      const p = spawn('sips', ['-s', 'format', 'png', file, '--out', tmp], { stdio: 'ignore' });
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('sips could not read ' + file))));
      p.on('error', reject);
    });
    buf = readFileSync(tmp);
    rmSync(tmp, { force: true });
  }
  const rects = Object.fromEntries((opt('--regions', '') || '').split(';').filter(Boolean).map((r) => {
    const [name, v] = r.split('=');
    return [name, v.split(',').map(Number)];
  }));
  const out = { [opt('--name', 'image')]: measureImage(decodePNG(buf), rects) };
  if (has('--write')) writeFileSync(opt('--write'), JSON.stringify(out, null, 1) + '\n');
  else console.log(JSON.stringify(out, null, 1));
  process.exit(0);
}

// In the page: the car put on the road at s and run for two and a half
// seconds; the frame, kept in the page for a sheet of them.
const SCOUT = (s) => `
  const p = g.road.at(${s});
  if (!p) return { missing: true };
  g.autoMode = true;
  g.sCar = ${s};
  g.car.reset(p.x - Math.sin(p.theta) * 1.9, p.z + Math.cos(p.theta) * 1.9, p.theta, g.road.surfaceAt(${s}, 1.9) + 0.3);
  g.car.vx = 22;
  for (let i = 0; i < 150; i++) g.update(1 / 60);
  g.render();
  (window.__scout = window.__scout || []).push([${s}, document.getElementById('view').toDataURL('image/png')]);
  return { world: g.snapshot().world, kind: g.snapshot().structure };
`;
const SHEET = `
  const list = window.__scout || [];
  const cols = 2, rows = Math.ceil(list.length / cols);
  const W = 1280, cw = W / cols, ch = Math.round(cw * 577 / 1280);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = ch * rows;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#000'; cx.fillRect(0, 0, cv.width, cv.height);
  for (let k = 0; k < list.length; k++) {
    const img = new Image(); img.src = list[k][1]; await img.decode();
    const x = (k % cols) * cw, y = Math.floor(k / cols) * ch;
    cx.drawImage(img, x, y, cw, ch);
    cx.fillStyle = '#fff'; cx.font = '20px sans-serif'; cx.fillText('s=' + list[k][0], x + 10, y + 26);
  }
  return cv.toDataURL('image/jpeg', 0.85);
`;

const shots = (opt('--shots', Object.keys(SHOTS).join(','))).split(',').filter((s) => SHOTS[s]);
const styles = (opt('--styles', 'real,paint')).split(',').filter((s) => STYLES.includes(s));
const dump = has('--dump');
const outDir = (opt('--out', ROOT + 'out/look')).replace(/\/?$/, '/');
const gpu = has('--gpu');
// --tier low|mid|high: the page at that tier. Not given, the address is as it
// was before there were tiers, and the page draws high.
const tier = opt('--tier', null);
if (tier !== null && !['high', 'mid', 'low'].includes(tier)) {
  console.error(`--tier: high, mid or low, not ${tier}`);
  process.exit(2);
}
const tierQuery = tier ? `&tier=${tier}` : '';
// --sky noon|golden|grey: the page held to that sky.
const skyHeld = opt('--sky', null);
if (skyHeld !== null && !['noon', 'golden', 'grey'].includes(skyHeld)) {
  console.error(`--sky: noon, golden or grey, not ${skyHeld}`);
  process.exit(2);
}
const skyQuery = skyHeld ? `&sky=${skyHeld}` : '';
// --query a=b&c=d: more of the page's address.
const moreQuery = opt('--query', null) ? '&' + opt('--query').replace(/^&/, '') : '';
// --pinned <dir>: a frame and its turned frame, for each frame.pinned over 0.09.
const pinDir = has('--pinned') ? opt('--pinned').replace(/\/?$/, '/') : null;
const times = Number(opt('--times', gpu ? 30 : 3));
const results = {};

// On the GPU: the first of the system's ANGLE backends that draws on
// something other than SwiftShader, kept for the pages after; none, and the
// run fails rather than measure the software renderer as if it were a GPU.
let angle = null;
const noGPU = (why) => Object.assign(new Error(`no GPU to draw on, ${why}; not measuring the software renderer in its place`), { noGPU: true });
async function open(query) {
  if (!gpu) return openPage(query);
  const tried = [];
  for (const a of angle ? [angle] : ANGLES) {
    let page;
    try {
      page = await openPage(query, a);
    } catch (e) {
      tried.push(`${a}: ${e.message}`);
      continue;
    }
    const name = String(await page.run(RENDERER));
    if (name && !/SwiftShader/i.test(name)) {
      angle = a;
      return page;
    }
    tried.push(`${a}: ${name || 'no renderer'}`);
    page.close();
  }
  throw noGPU(`on ${process.platform} (--use-angle=${tried.join('; ')})`);
}

const server = serve();
try {
  if (!(await waitForServer())) throw new Error('the dev server did not come up');
  if (dump || has('--scout')) mkdirSync(outDir, { recursive: true });
  if (has('--scout')) {
    // Looking for a place: a sheet of frames along the road in each world.
    const at = opt('--scout').split(',').map(Number);
    for (const name of shots) {
      for (const style of styles) {
        const page = await open(`seed=7&world=${SHOTS[name].world}&s=${at[0]}&cam=chase&style=${style}&run=60${tierQuery}${skyQuery}${moreQuery}`);
        try {
          for (const s of at) console.log(name, style, s, JSON.stringify(await page.run(SCOUT(s))));
          const sheet = await page.run(SHEET);
          writeFileSync(`${outDir}scout-${name}-${style}.jpg`, Buffer.from(sheet.replace(/^data:image\/jpeg;base64,/, ''), 'base64'));
        } finally {
          page.close();
        }
      }
    }
    server.kill();
    process.exit(0);
  }
  if (has('--switch')) {
    for (const style of styles.filter((st) => st !== 'real')) {
      const page = await open(`seed=7&world=hills&s=900&cam=chase&style=real&run=60${tierQuery}${skyQuery}${moreQuery}`);
      try {
        const r = await page.run(SWITCH(style));
        if (r.error) throw new Error(`${style}: ${r.error}`);
        if (gpu && /SwiftShader/i.test(r.gpu || '')) throw noGPU(`the frame was drawn by ${r.gpu}`);
        const sorted = r.times.slice().sort((a, b) => a - b);
        const out = { first: round(r.times[0]), max: round(sorted[sorted.length - 1]), median: round(sorted[sorted.length >> 1]) };
        results[`switch:${style}`] = { switch: out };
        console.log(`switch:${style.padEnd(6)} first ${out.first} ms  dearest ${out.max} ms  median ${out.median} ms`);
      } finally {
        page.close();
      }
    }
    server.kill();
    if (has('--write')) writeFileSync(opt('--write'), JSON.stringify(results, null, 1) + '\n');
    if (has('--check')) {
      const rules = JSON.parse(readFileSync(opt('--check'), 'utf8'));
      const mine = (rules.rules || rules).filter((r) => r.shot.startsWith('switch:'));
      const { passed, failures } = check(results, mine, null, gpu);
      console.log(failures.length ? `\nFAILED: ${failures.length} limit(s), ${passed} held` : `\nOK: ${passed} limit(s) held`);
      process.exit(failures.length ? 1 : 0);
    }
    process.exit(0);
  }
  // A page for each world; in it each of the world's places in turn, further
  // and further along (the road behind is let go of), and at each place
  // every style, in the one order, asked for or not. The real style comes
  // first at every place: its frame and its turned frame are kept, for the
  // other styles' frame.pinned.
  const pageOf = (n) => SHOTS[n].page || SHOTS[n].world;
  const pages = [...new Set(shots.map(pageOf))];
  for (const pg of pages) {
    const here = Object.keys(SHOTS).filter((n) => pageOf(n) === pg)
      .sort((a, b) => SHOTS[a].s - SHOTS[b].s || (SHOTS[a].still ? 1 : -1));
    const world = SHOTS[here[0]].world;
    const wanted = (n, st) => shots.includes(n) && styles.includes(st);
    const todo = [];
    // A place that is measured in some styles only (only) is not put down in the others.
    for (const name of here) for (const style of STYLES) if (!SHOTS[name].only || SHOTS[name].only.includes(style)) todo.push([name, style]);
    while (todo.length && !wanted(...todo[todo.length - 1])) todo.pop();
    const page = await open(`seed=7&world=${world}&s=${SHOTS[here[0]].s}&cam=chase&style=real&run=60${tierQuery}${skyQuery}${moreQuery}`);
    try {
      let real = null;
      for (const [name, style] of todo) {
        const id = `${name}:${style}`;
        const sh = SHOTS[name];
        const want = wanted(name, style);
        const put = await page.run(PLACE(sh.s, style, sh.cam, sh.still, sh.eye, sh.life));
        if (put.error || put.missing || put.style !== style) throw new Error(`${id}: ${JSON.stringify(put)}`);
        if (!want) {
          // The real style, as the reference for the styles measured here.
          if (style === 'real' && styles.some((st) => st !== 'real' && wanted(name, st))) {
            const ref = await page.run(REFERENCE);
            if (ref.error) throw new Error(`${id}: ${ref.error}`);
            real = { at: name, a: fromURL(ref.frame), b: fromURL(ref.turned) };
          }
          // Measuring a place steps the world once more (for the frame a
          // sixtieth of a second on): a place passed over is stepped the same,
          // so what comes after it is as it would be in a run of them all.
          await page.run('g.update(1 / 60); return 0;');
          continue;
        }
        if (sh.rig) {
          const rig = await page.run(CARD(sh.rig));
          if (rig.error) throw new Error(`${id}: ${rig.error}`);
        }
        const cap = await page.run(CAPTURE.replace('${WARM}', gpu ? 'true' : 'false').replace('${TIMES}', String(times)).replace('${OTHER}', String(KINDS.length - 1)).replace('${POP}', sh.pop ? 'true' : 'false'));
        if (cap.error) throw new Error(`${id}: ${cap.error}`);
        if (gpu && /SwiftShader/i.test(cap.cost.gpu || '')) throw noGPU(`the frame was drawn by ${cap.cost.gpu}`);
        const { out, img, kind, dist } = measureShot(cap);
        const turned = fromURL(cap.turned);
        if (style === 'real') real = { at: name, a: img, b: turned };
        out.frame.pinned = real && real.at === name ? pinned(real.a, real.b, img, turned) : null;
        if (pinDir && out.frame.pinned !== null && out.frame.pinned > 0.09) {
          mkdirSync(pinDir, { recursive: true });
          writeFileSync(`${pinDir}${name}-${style}.png`, Buffer.from(cap.frame.replace(/^data:image\/png;base64,/, ''), 'base64'));
          writeFileSync(`${pinDir}${name}-${style}-turned.png`, Buffer.from(cap.turned.replace(/^data:image\/png;base64,/, ''), 'base64'));
        }
        out.at = { world: cap.world && cap.world.id, s: round(cap.sCar, 0), speed: round(cap.speed, 1), sky: cap.world && cap.world.sky };
        out.tier = cap.tier || 'high';
        if (out.tier !== (tier || 'high')) throw new Error(`${id}: the page drew at tier ${out.tier}, not ${tier || 'high'}`);
        if (page.logs.length) out.errors = page.logs.slice(0, 3);
        const at = out.strokesAt;
        delete out.strokesAt;
        results[id] = out;
        if (dump) {
          writeFileSync(`${outDir}${name}-${style}.png`, Buffer.from(cap.frame.replace(/^data:image\/png;base64,/, ''), 'base64'));
          writeFileSync(`${outDir}${name}-${style}-map.png`, mapPicture(img.w, img.h, kind, dist));
          if (at) writeFileSync(`${outDir}${name}-${style}-strokes.png`, encodePNG(img.w, img.h, at));
        }
        const g = out.ground;
        console.log(`${id.padEnd(15)} ${String(out.cost.calls).padStart(4)} calls ${(out.cost.triangles / 1e6).toFixed(2)} M tris ${String(out.cost.ms).padStart(7)} ms`
          + `  sat ${out.frame.sat} tones ${out.frame.tones} L01 ${out.frame.L01} pinned ${out.frame.pinned}`
          + `  sky ${out.sky ? `${out.sky.share} cloud ${out.sky.cloud} big ${out.sky.biggest}` : '-'}`
          + `  near ${g.near ? `micro ${g.near.micro} upright ${g.near.upright}` : '-'}`
          + `  far ${g.far ? `micro ${g.far.micro} shimmer ${g.far.shimmer}` : '-'}`
          + `  trees ${out.trees ? `tones ${out.trees.tones} step ${out.trees.step}` : '-'}`);
      }
    } finally {
      page.close();
    }
  }
} catch (e) {
  if (!e.noGPU) throw e;
  console.error(`\n--gpu: ${e.message}`);
  server.kill();
  await sleep(700);
  process.exit(2);
} finally {
  server.kill();
}
if (dump) {
  writeFileSync(`${outDir}look.json`, JSON.stringify(results, null, 1) + '\n');
  console.log(`written: ${outDir}look.json`);
}

const file = opt('--write', ROOT + 'out/look.json');
if (!has('--check') || has('--write')) {
  // --merge keeps what the file already holds of other shots and styles.
  let keep = {};
  if (has('--merge')) {
    try { keep = JSON.parse(readFileSync(file, 'utf8')); } catch { /* nothing to keep */ }
  }
  writeFileSync(file, JSON.stringify({ ...keep, ...results }, null, 1) + '\n');
  console.log(`\nwritten: ${file}`);
}
if (has('--check')) {
  const rules = JSON.parse(readFileSync(opt('--check'), 'utf8'));
  const against = has('--against') ? JSON.parse(readFileSync(opt('--against'), 'utf8')) : null;
  const { passed, failures } = check(results, rules.rules || rules, against, gpu);
  if (failures.length) {
    console.error(`\nFAILED: ${failures.length} limit(s), ${passed} held`);
    process.exit(1);
  }
  console.log(`\nOK: ${passed} limit(s) held`);
}
