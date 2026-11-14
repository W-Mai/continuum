// Game: assembles the world and runs the loop.
//
// The world is generated in this order, and nothing downstream ever disagrees
// with anything upstream: the land (a pure function of position), the road
// surveyed across it, the land re-shaped by the road (cuts, fills, bridges,
// tunnels), then the meshes baked from those. Physics, autopilot, traffic and
// camera read the same road and the same ground the meshes were built from.

import * as THREE from 'three';
import { GLTFLoader } from '../tools/vendor/GLTFLoader.js';
import { toCreasedNormals } from '../tools/utils/BufferGeometryUtils.js';

import { makeWorldLand, WORLDS, WORLD_INDEX } from './world/worlds.js';
import { Road, HALF_PAVED, HALF_FLAT, TUNNEL, STEP } from './world/road.js';
import { Corridor, TUNNEL_H, REACH } from './world/corridor.js';
import { turnWorlds, turnNext, turnTo, turnLoop } from './world/turn.js';
import { Car } from './core/car.js';
import { Autopilot, Driver } from './core/autopilot.js';
import { Collisions } from './core/collisions.js';
import { CarPresentation, ChaseCamera } from './render/presentation.js';
import { Director } from './render/director.js';
import { Atmosphere, ALPINE_LOOK, atmo, withAtmosphere, withSunMask, withSkyScale, sunMask, boreSky, carSky } from './render/atmosphere.js';
import { bindWorlds, syncWorlds, worldLook, mixLooks, setWorldOrigin } from './render/worldlook.js';
import { Water } from './render/water.js';
import { City } from './render/city.js';
import { Ceiling } from './render/ceiling.js';
import { sunVisibility } from './world/sunlight.js';
import { TerrainField } from './render/terrain.js';
import { Forest } from './render/forest.js';
import { makeBakers } from './render/bakers.js';
import { makeVegetation } from './world/vegetation.js';
import { RoadRenderer } from './render/roadmesh.js';
import { PostChain } from './render/post.js';
import { Quality } from './render/quality.js';
import { Traffic } from './render/traffic.js';
import { SkidMarks, TyreParticles } from './render/effects.js';
import { Motes } from './render/motes.js';
import { Fish } from './render/fish.js';
import { Critters } from './render/critters.js';
import { Style } from './render/style.js';

const FIXED_DT = 1 / 120;
const MAX_FRAME_DT = 0.1;
const CROWN = 0.045;
const TUNNEL_LAMP = new THREE.Color(0xffcf9a);
const TUNNEL_FLOOR = new THREE.Color(0x3a3128);

export class Game {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: opts.antialias !== false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, opts.maxPixelRatio || 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Count every pass of a frame (shadow map, scene, bloom, grade), not only
    // the last full-screen quad.
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.3, 14000);
    this.post = new PostChain(this.renderer, this.scene, this.camera);
    // How the world is drawn (render/style.js): as it is, unless asked.
    this.style = new Style(opts.style);
    this.style.applyScene();
    this._styleBake = 0;

    this.seed = opts.seed !== undefined ? opts.seed : Math.floor(Math.random() * 1e6);
    this.land = makeWorldLand(this.seed, { start: opts.world, len: opts.worldLen, loop: opts.loop });
    this.land.debug = !!opts.terrainDebug;
    this.worlds = this.land.worlds;
    this.road = new Road(this.land, this.seed);
    bindWorlds(this.worlds);
    syncWorlds(this.worlds, this.road.origin.x, this.road.origin.z);
    // Start further down the road (showcase captures): survey up to there first,
    // so everything below is built around the right place.
    this.sCar = opts.start > 160 ? opts.start : 160;
    if (this.sCar > 160) this.road.update(this.sCar, Infinity);
    this.corridor = new Corridor(this.road, this.land);
    this.vegetation = makeVegetation(this.land, this.seed);

    // The sky and light of the world the camera is in, mixed across borders.
    this._look = mixLooks({}, worldLook(0), worldLook(0), 0);
    this._lookAt = { a: -1, b: -1, t: -1, ba: -1, bb: -1, bt: 0, pair: '', clock: 0 };
    this.atmosphere = new Atmosphere(this.renderer, this.scene, ALPINE_LOOK);
    const s0 = this.road.at(this.sCar);
    if (s0) this._updateLook(s0.x, s0.z, 0, true);
    if (opts.noShadow) {
      this.renderer.shadowMap.enabled = false;
      this.atmosphere.sun.castShadow = false;
    }
    this.terrain = new TerrainField(this.scene, this.land, this.corridor,
      ALPINE_LOOK, { vegetation: this.vegetation });
    this.terrain.setSun(this.atmosphere.sunDir);
    this.forest = new Forest(this.scene, this.land, this.corridor, this.vegetation, this.seed);
    this.forest.setSun(this.atmosphere.sunDir);
    // Land and trees are baked in workers once they are up (render/bakers.js);
    // headless runs bake every tile on the page, in the frame that needs it.
    this.bakers = opts.syncWorld || opts.bakers === false ? null
      : makeBakers(this.land, this.seed, { start: opts.world, len: opts.worldLen, loop: opts.loop });
    this.terrain.bakers = this.bakers;
    this.forest.bakers = this.bakers;
    this.water = new Water(this.scene, 0);
    this.city = new City(this.scene, this.land, this.corridor, this.seed);
    this.ceiling = new Ceiling(this.scene, this.worlds);
    this.roadMesh = new RoadRenderer(this.scene, this.road, this.corridor, this.renderer);
    this.roadMesh.setSun(this.atmosphere.sunDir);
    if (opts.detail) this.setDetail(opts.detail);
    this._applyOrigin();

    this.car = new Car();
    const start = this.road.at(this.sCar);
    this.car.reset(start.x, start.z, start.theta, this.road.surfaceAt(this.sCar, 1.9) + CROWN);
    this.car.x += -Math.sin(start.theta) * 1.9;
    this.car.z += Math.cos(start.theta) * 1.9;

    this.pilot = new Autopilot(this.road);
    this.driver = new Driver(opts.inputTarget || window);
    this.traffic = new Traffic(this.scene, this.road, this.seed,
      withSunMask(withAtmosphere(new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.45 })), false));
    this.collisions = new Collisions(this.car, this.road);

    this.presentation = new CarPresentation(this.scene);
    this.chase = new ChaseCamera(this.camera);
    this.director = new Director(this.camera, {
      road: this.road,
      seed: this.seed,
      post: this.post,
      sunDir: this.atmosphere.sunDir,
      groundAt: (x, z) => this.groundAt(x, z),
      terrainAt: (x, z) => this.corridor.heightAt(x + this.road.origin.x, z + this.road.origin.z),
      ceilingAt: (x, z, s) => this.ceilingAt(x, z, s),
      treesAt: (x, z, near) => this.treesAt(x, z, near),
      solidAt: (x, y, z) => this.solidAt(x, y, z),
      surfaceAt: (x, z) => this.land.waterLevel(x + this.road.origin.x, z + this.road.origin.z),
    });
    this.skids = new SkidMarks(this.scene);
    this.dust = new TyreParticles(this.scene);
    this.motes = new Motes(this.scene);
    this.fish = new Fish(this.scene);
    // Small animals, in the styles that have them (render/critters.js).
    this.critters = new Critters(this.scene, {
      road: this.road,
      seed: this.seed,
      groundAt: (x, z) => this.groundAt(x, z),
      waterAt: (x, z) => this.land.waterLevel(x + this.road.origin.x, z + this.road.origin.z),
      treesAt: (x, z, near) => this.treesAt(x, z, near),
      // Trunks round a point, in local coordinates: [x, z, radius, ...].
      trunks: (x, z, range, out) => {
        const o = this.road.origin;
        this.forest.trunksNear(x + o.x, z + o.z, range, out);
        for (let k = 0; k < out.length; k += 3) {
          out[k] -= o.x;
          out[k + 1] -= o.z;
        }
        return out;
      },
    });
    this._bufferSize = new THREE.Vector2();

    // Headlights, and the low beam pool they throw: only seen in tunnels and
    // in deep shade.
    this.headlight = new THREE.SpotLight(0xfff1d8, 0, 140, 0.55, 0.5, 1.4);
    this.scene.add(this.headlight);
    this.scene.add(this.headlight.target);

    this.autoMode = opts.auto !== false;
    // Headless runs step a fixed 1/60 s, so there is nothing to adapt to.
    this.quality = opts.syncWorld || opts.adaptive === false
      ? null : new Quality(this, Math.min(devicePixelRatio, opts.maxPixelRatio || 1.5));
    this.accumulator = 0;
    this.frame = 0;
    this.simTime = 0;
    this.fps = 60;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this.inTunnel = 0;      // the car: its own sun and headlights
    this.camInTunnel = 0;   // the lens: the light of the whole frame
    this.eye = 0;           // how far the eye has opened up for the dark
    this.carLoaded = false;
    this.wrecks = 0;
    this.stats = { maxSpeed: 0, frames: 0 };

    this._bindKeys();
  }

  _applyOrigin() {
    const o = this.road.origin;
    this.terrain.setOrigin(o.x, o.z);
    this.forest.setOrigin(o.x, o.z);
    this.roadMesh.setOrigin(o.x, o.z);
    this.water.setOrigin(o.x, o.z);
    this.city.setOrigin(o.x, o.z);
    this.style.setOrigin(o.x, o.z);
    setWorldOrigin(o.x, o.z);
  }

  // The world the camera is in: mix the two looks across a border and hand
  // them to the atmosphere. The sky's environment map is drawn again when
  // the light has changed by a few percent since it was last drawn, at most
  // four times a second, and once more when it settles. Crossing from one
  // pair of worlds to the next (the end of a border is the start of the next
  // world) changes nothing, so it draws nothing.
  _updateLook(x, z, dt, force = false) {
    const w = this.worlds.at(x + this.road.origin.x, z + this.road.origin.z);
    const L = this._lookAt;
    L.clock += dt;
    const pair = w.a + ':' + w.b;
    const moved = force || pair !== L.pair || Math.abs(w.t - L.t) >= 1e-3;
    if (moved) mixLooks(this._look, worldLook(w.a), worldLook(w.b), w.t);
    // How much of the light now is not the light the map was drawn in: each
    // world's share then against its share now.
    const share = (i, a, b, t) => (i === a ? 1 - t : 0) + (i === b ? t : 0);
    let drift = 0;
    for (const i of [w.a, w.b, L.ba, L.bb]) {
      if (i < 0) continue;
      drift = Math.max(drift, Math.abs(share(i, w.a, w.b, w.t) - share(i, L.ba, L.bb, L.bt)));
    }
    const rebake = force || (drift > 0.02 && L.clock > 0.25) || (drift > 1e-3 && L.clock > 1);
    if (moved || rebake) this.atmosphere.apply(this._look, rebake);
    if (rebake) {
      L.ba = w.a;
      L.bb = w.b;
      L.bt = w.t;
      L.clock = 0;
    }
    L.pair = pair;
    L.a = w.a;
    L.b = w.b;
    L.t = w.t;
  }

  // How much geometry to draw, 1 at full quality (render/quality.js lowers
  // it on a slow GPU): the land's fine tiles, the full trees, the skyline.
  setDetail(f) {
    this.detail = f;
    this.terrain.setDetail(f);
    this.forest.setDetail(f);
    this.city.setDetail(f);
  }

  // Where the camera is among the worlds, for the interface.
  worldHere() {
    const L = this._lookAt;
    const main = L.t < 0.5 ? L.a : L.b;
    return { id: WORLDS[main].id, name: WORLDS[main].name, from: WORLDS[L.a].name, to: WORLDS[L.b].name, t: L.t };
  }

  // --- turning toward another world ------------------------------------------

  // The next world in the loop, a world by id, or a new loop of worlds by id
  // (WorldMap.next, ask, setLoop). Each starts about a kilometre ahead and
  // comes in as any border does. Returns whether anything changed.
  nextWorld() {
    return this._turn(turnNext(this.worlds));
  }

  goToWorld(id) {
    const w = WORLD_INDEX[id];
    return w !== undefined && this._turn(turnTo(this.worlds, w));
  }

  setLoop(ids) {
    return this._turn(turnLoop(this.worlds, ids));
  }

  // The worlds in the loop, by id, and the world the road turns into next
  // with how far ahead that border is along the road (null past the road
  // laid so far).
  worldPlan() {
    const map = this.worlds;
    const road = this.road;
    const here = map.main(this.car.x + road.origin.x, this.car.z + road.origin.z);
    let next = null;
    for (let i = Math.ceil(this.sCar / STEP); i <= road.classified; i += 10) {
      const p = road.samples.get(i);
      if (!p) continue;
      const w = map.main(p.ax, p.az);
      if (w !== here) {
        next = { id: WORLDS[w].id, name: WORLDS[w].name, ahead: i * STEP - this.sCar };
        break;
      }
    }
    return { loop: map.loop.map((w) => WORLDS[w].id), here: WORLDS[here].id, next };
  }

  _turn(change) {
    const r = turnWorlds(this.road, this.worlds, this.sCar, change);
    if (!r) return false;
    if (r.cut >= 0) this.roadMesh.cutFrom(r.cut);
    // Rebuild what stood on the old road or on the old land: tiles a dropped
    // stretch of road ran through, and tiles reaching into progress whose
    // land has changed. They go on being drawn until the new ones are ready,
    // which waits until the road is laid again, to be carved by it.
    const pts = r.dropped;
    const map = this.worlds;
    const test = (pad) => (x0, z0, size) => {
      for (let k = 0; k < pts.length; k += 20) {
        const x = pts[k];
        const z = pts[k + 1];
        if (x > x0 - pad && x < x0 + size + pad && z > z0 - pad && z < z0 + size + pad) return true;
      }
      let hi = -Infinity;
      for (const [fx, fz] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) hi = Math.max(hi, map.u(x0 + fx * size, z0 + fz * size));
      // The warp bends progress across a tile: a margin for what the corners miss.
      return hi + 0.15 * size + 100 >= r.from;
    };
    this.terrain.markStale(test(REACH + 30));
    this.forest.markStale(test(60));
    this.city.markStale(test(60));
    this.turns = (this.turns || 0) + 1;
    return true;
  }

  // Build everything the first frame needs, synchronously.
  warmUp() {
    const cam = this.camera.position;
    this.roadMesh.update(this.sCar, -1);
    this.terrain.update(cam.x + this.road.origin.x, cam.z + this.road.origin.z, true);
    this.forest.update(cam.x + this.road.origin.x, cam.z + this.road.origin.z, true);
  }

  async loadCar(url = './out/car.glb') {
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = gltf.scene;
    // GLTFLoader hands every mesh that uses a material the same object. The
    // shader hooks below chain onto a material, so a shared one must be hooked
    // once: hooked once per wheel, the wheel materials declared their uniforms
    // four times, failed to compile, and the wheels never drew at all.
    const hooked = new Set();
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      // The exporter writes one normal per face, which bands curved paint into
      // stripes. Smooth across gentle angles, keep real creases sharp.
      o.geometry = toCreasedNormals(o.geometry, THREE.MathUtils.degToRad(34));
      const m = o.material;
      if (!m || hooked.has(m)) return;
      if (m.name === 'paint') {
        o.material = new THREE.MeshPhysicalMaterial({
          color: m.color, metalness: 0.2, roughness: 0.38,
          clearcoat: 1.0, clearcoatRoughness: 0.06, envMapIntensity: 0.85,
        });
      } else if (m.name === 'glass') {
        o.material = new THREE.MeshPhysicalMaterial({
          color: 0x0b0e12, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.72,
          envMapIntensity: 1.6, depthWrite: false,
        });
      } else if (m.name === 'head_light') {
        m.emissive = new THREE.Color(0xfff3e0);
        m.emissiveIntensity = 1.5;
      } else if (m.name === 'tail_light') {
        m.emissive = new THREE.Color(0xff1a10);
        m.emissiveIntensity = 2.0;
        this.tailLight = m;
      } else if (m.name === 'emitter' || m.name === 'thruster') {
        // The hover rings: dim on the road, lit when the car is afloat.
        m.emissive = new THREE.Color(0xff6a3d);
        m.emissiveIntensity = 0.15;
        if (m.name === 'emitter') this.emitterMat = m;
        else this.thrusterMat = m;
      }
      // The car marks itself for a style that draws it apart (render/style.js);
      // the glass shows what is behind it.
      o.material.userData.styleMark = !o.material.transparent;
      withSunMask(withAtmosphere(o.material), false);
      withSkyScale(o.material, carSky);
      hooked.add(o.material);
    });
    this.presentation.attach(model, 0.001);
    this.carModel = model;
    this.carLoaded = true;
    this.chase.snapTo(this.car, this.car.y);
    return model;
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP') this.setAuto(!this.autoMode);
      if (e.code === 'KeyC') this.cycleCamera();
      if (e.code === 'KeyR' && !this.autoMode) this.resetToRoad(true);
    });
  }

  // The autopilot on or off. It keeps to the road, so a car taken off it is
  // put back first.
  setAuto(on) {
    if (on && this.offRoad) this.resetToRoad(true);
    this.autoMode = on;
  }

  cycleCamera() {
    const name = this.chase.cycle();
    if (this.onCameraChange) this.onCameraChange(name);
    return name;
  }

  setCamera(name) {
    this.chase.setFraming(name);
    if (this.onCameraChange) this.onCameraChange(this.chase.framing);
    return this.chase.framing;
  }

  // Draw the world in another style (render/style.js), turning into it over
  // a second and a half. Returns whether anything changed.
  setStyle(id) {
    const changed = this.style.set(id);
    if (changed && this.onStyleChange) this.onStyleChange(id);
    return changed;
  }

  nextStyle() {
    return this.setStyle(this.style.next());
  }

  // Ground under a local point: the road surface on the road's platform (and
  // always inside a tunnel or on a bridge), the shaped land everywhere else.
  groundAt(x, z) {
    const near = this.road.nearestS(x, z, this.sCar, 80);
    const p = this.road.at(near.s);
    if (p && near.dist < HALF_FLAT + 1.5) {
      const lat = this.road.lateralOf(near.s, x, z);
      const r = this.road.surfaceAt(near.s, lat);
      if (p.kind !== 0) return r;
      return Math.max(r, this.corridor.heightAt(x + this.road.origin.x, z + this.road.origin.z));
    }
    return this.corridor.heightAt(x + this.road.origin.x, z + this.road.origin.z);
  }

  // The vault above a local point, if it is inside a tunnel. sHint is a road
  // position near the point, for points far from the car.
  ceilingAt(x, z, sHint = this.sCar) {
    const near = this.road.nearestS(x, z, sHint, 60);
    const p = this.road.at(near.s);
    if (!p || p.kind !== TUNNEL || near.dist > 5.5) return null;
    return this.road.surfaceAt(near.s, this.road.lateralOf(near.s, x, z)) + TUNNEL_H;
  }

  // Forest cover at a local point that stands `near` metres from the road, for a
  // camera deciding where it can stand without a tree in front of the lens.
  treesAt(x, z, near) {
    const ax = x + this.road.origin.x;
    const az = z + this.road.origin.z;
    const h = this.corridor.heightAt(ax, az);
    const dx = this.corridor.heightAt(ax + 3, az) - h;
    const dz = this.corridor.heightAt(ax, az + 3) - h;
    const slope = 1 - 3 / Math.hypot(dx, 3, dz);
    return this.vegetation.density(ax, az, h, slope, near, 0, 0);
  }

  // Whether a local point is inside something a camera cannot see through
  // that the land's height does not know about: a building, the rock over
  // the cavern's roof, or a liquid away from the deep sea.
  solidAt(x, y, z) {
    const ax = x + this.road.origin.x;
    const az = z + this.road.origin.z;
    return y > this.ceiling.roofAt(ax, az) || this.city.solidAt(ax, y, az) || this.land.submerged(ax, y, az);
  }

  resetToRoad(quiet = false) {
    const p = this.road.at(this.sCar);
    if (!p) return;
    const lat = this.pilot.lane;
    this.car.reset(p.x - Math.sin(p.theta) * lat, p.z + Math.cos(p.theta) * lat, p.theta,
      this.road.surfaceAt(this.sCar, lat) + CROWN);
    this.car.vx = 8;
    this.collisions.reset();
    this.traffic.clearNear(this.sCar, 60);
    this.resetting = true;
    this.resetFade = 1;
    if (!quiet) this.wrecks++;
  }

  stepPhysics(dt) {
    const shift = this.road.update(this.sCar);
    if (shift) this._shiftWorld(shift);

    this.sCar = this.road.nearestS(this.car.x, this.car.z, this.sCar).s;
    const p = this.road.at(this.sCar);
    this.offRoad = false;
    if (p) {
      const lat = this.road.lateralOf(this.sCar, this.car.x, this.car.z);
      if (this.autoMode || Math.abs(lat) < HALF_FLAT + 1.5) {
        const crown = Math.abs(lat) < HALF_PAVED ? CROWN * (1 - (lat / HALF_PAVED) ** 2) : 0;
        this.car.groundY = this.road.surfaceAt(this.sCar, lat) + crown;
        this.car.groundVy = p.grade * Math.max(0, this.car.vx);
        this.car.pitchSlope = Math.atan(p.grade);
        this.bank = p.bank;
        this.car.surfaceGrip = 1;
        this.car.rollMul = 1;
      } else {
        this._landUnder(this.car);
      }
    }

    let cmd;
    if (this.autoMode) {
      const lead = this.traffic.nearestAhead(this.sCar, 1, 140);
      cmd = this.pilot.drive(dt, {
        s: this.sCar, x: this.car.x, z: this.car.z, yaw: this.car.yaw, speed: this.car.speed,
        leadGap: lead ? lead.distance : null, leadSpeed: lead ? lead.car.speed : null,
      });
    } else {
      const d = this.driver.read();
      cmd = { steer: d.steer, throttle: d.throttle, brake: d.brake };
    }
    const prev = this._prev || (this._prev = { x: 0, z: 0, yaw: 0 });
    prev.x = this.car.x;
    prev.z = this.car.z;
    prev.yaw = this.car.yaw;
    this.car.step(dt, cmd);
    if (this.offRoad) {
      // Up a slope the car slows, down it speeds up; the ground, not the
      // road's own numbers, is what it rides.
      if (!this.car.airborne) this.car.vx -= 9.81 * Math.sin(Math.atan(this._slope || 0)) * dt * 0.85;
      this._obstacles(this.car, prev);
    }

    const hit = this.collisions.update(dt, this.sCar, this.traffic, this.simTime);
    if (hit && hit.kind === 'impact') {
      this.car.applyImpact(hit.speed, hit.oncoming);
      this.hits = (this.hits || 0) + 1;
    }
    if (this.car.wrecked && this.car.wreckTimer > 1.6 && !this.resetting) this.resetToRoad();
    this.simTime += dt;
  }

  // Under a car that has left the road's platform: the land (the road's own
  // numbers hold on the platform and all the while the autopilot drives, which
  // keeps to it). The car rides the ground, up its hills and down its
  // ditches, tilting to it; it grips less on grass and sand, and rolls harder.
  _landUnder(car) {
    this.offRoad = true;
    const fx = Math.cos(car.yaw);
    const fz = Math.sin(car.yaw);
    const L = 1.4;
    const W = 0.9;
    const gF = this.groundAt(car.x + fx * L, car.z + fz * L);
    const gB = this.groundAt(car.x - fx * L, car.z - fz * L);
    const gLeft = this.groundAt(car.x - fz * W, car.z + fx * W);
    const gRight = this.groundAt(car.x + fz * W, car.z - fx * W);
    const slope = Math.max(-1.2, Math.min(1.2, (gF - gB) / (2 * L)));
    this._slope = slope;
    car.groundY = this.groundAt(car.x, car.z);
    car.groundVy = slope * car.vx;
    car.pitchSlope = Math.atan(slope);
    this.bank = (gRight - gLeft) / (2 * W);
    const sand = WORLDS[this._lookAt.t < 0.5 ? this._lookAt.a : this._lookAt.b].id === 'desert';
    car.surfaceGrip = sand ? 0.55 : 0.7;
    car.rollMul = sand ? 6 : 4;
  }

  // What a car off the road runs into: a trunk (it stops against it, and the
  // harder it was going the harder it is hurt), a building, deep water, or a
  // slope too steep to climb (the car is put back where it was and bounces
  // off).
  _obstacles(car, prev) {
    const o = this.road.origin;
    const fx = Math.cos(car.yaw);
    const fz = Math.sin(car.yaw);
    const buf = this._trunkBuf || (this._trunkBuf = []);
    let severity = 0;
    let side = 1;
    for (const off of [-1.4, 0, 1.4]) {
      const cx = car.x + fx * off;
      const cz = car.z + fz * off;
      this.forest.trunksNear(cx + o.x, cz + o.z, 1.3, buf);
      for (let k = 0; k < buf.length; k += 3) {
        const dx = cx - (buf[k] - o.x);
        const dz = cz - (buf[k + 1] - o.z);
        const d = Math.hypot(dx, dz) || 1e-3;
        const pen = 0.95 + buf[k + 2] - d;
        if (pen <= 0) continue;
        const nx = dx / d;
        const nz = dz / d;
        car.x += nx * pen;
        car.z += nz * pen;
        let wx = car.vx * fx - car.vy * fz;
        let wz = car.vx * fz + car.vy * fx;
        const vn = wx * nx + wz * nz;
        if (vn >= 0) continue;
        wx -= vn * nx;
        wz -= vn * nz;
        car.vx = wx * fx + wz * fz;
        car.vy = -wx * fz + wz * fx;
        const nl = -nx * fz + nz * fx;
        car.r += off * nl * -vn * 0.06;
        if (-vn > severity) {
          severity = -vn;
          side = nl > 0 ? 1 : -1;
        }
      }
    }
    // A building, deep water, a wall of a slope: back to where it was.
    let blocked = false;
    const y = car.y + 1;
    for (const [a, b] of [[2.2, 0], [-2.2, 0], [0, 0.9], [0, -0.9], [1.6, 0.8], [1.6, -0.8]]) {
      const px = car.x + fx * a - fz * b;
      const pz = car.z + fz * a + fx * b;
      if (this.city.solidAt(px + o.x, y, pz + o.z)) blocked = true;
    }
    const lvl = this.land.waterLevel(car.x + o.x, car.z + o.z);
    if (lvl - car.groundY > 0.55 || Math.abs(this._slope || 0) > 1.0) blocked = true;
    if (blocked) {
      severity = Math.max(severity, Math.abs(car.vx));
      car.x = prev.x;
      car.z = prev.z;
      car.yaw = prev.yaw;
      car.vx *= -0.25;
      car.vy *= 0.3;
    }
    if (severity > 2.5 && (this._hitCool || 0) <= 0) {
      this._hitCool = 0.5;
      car.applyImpact(severity * 0.9, side > 0);
    }
    this._hitCool = (this._hitCool || 0) - FIXED_DT;
  }

  _shiftWorld(d) {
    this.car.x -= d.dx;
    this.car.z -= d.dz;
    this.chase.posX.value -= d.dx;
    this.chase.posZ.value -= d.dz;
    this.chase.lookX.value -= d.dx;
    this.chase.lookZ.value -= d.dz;
    if (this.chase._dronePos) {
      this.chase._dronePos.x -= d.dx;
      this.chase._dronePos.z -= d.dz;
    }
    this.director.shift(d.dx, d.dz);
    this.critters.shift(d.dx, d.dz);
    this._applyOrigin();
  }

  update(dt) {
    // One round of road a frame past what the car needs now (Road.update):
    // a road cut to be surveyed again comes back without a stall.
    this.road.budget = 1;
    if (this.quality) this.quality.update(dt);
    const clamped = Math.min(dt, MAX_FRAME_DT);
    this.accumulator += clamped;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < 12) {
      this.stepPhysics(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps++;
    }

    this.roadMesh.update(this.sCar, this.opts.syncWorld ? -1 : 3);
    this.traffic.update(clamped, this.sCar, this.car.speed);

    const car = this.car;
    const fx = Math.cos(car.yaw);
    const fz = Math.sin(car.yaw);
    const lat = this.road.lateralOf(this.sCar, car.x, car.z);
    // The wheels' hubs: on the road its surface at each axle, off it the land's.
    const hubF = this.offRoad ? this.groundAt(car.x + fx * 1.35, car.z + fz * 1.35) + 0.34
      : this.road.surfaceAt(this.sCar + 1.35, lat) + CROWN + 0.34;
    const hubR = this.offRoad ? this.groundAt(car.x - fx * 1.35, car.z - fz * 1.35) + 0.34
      : this.road.surfaceAt(this.sCar - 1.35, lat) + CROWN + 0.34;
    this.presentation.update(clamped, car, {
      bump: 0.25, roadY: car.y, airborne: car.airborne, hubF, hubR, bank: this.bank || 0,
    });

    const slip = Math.max(0, Math.min(1, Math.max(
      (Math.abs(car.slipAngle) - 0.07) * 3.2, ((car.brake || 0) - 0.6) * 2.4,
    ))) * (car.speed > 5 ? 1 : 0);
    // Afloat, there is no tyre on the road to mark it or throw dust.
    const onRoad = 1 - this.presentation.liftAmount;
    this.skids.update(car, slip * (onRoad > 0.5 ? 1 : 0));
    this.dust.update(clamped, car, slip * onRoad, 0x8a8170);

    this.chase.update(clamped, car, {
      bump: 0.25, roadY: car.y, airborne: car.airborne,
      groundAt: (gx, gz) => this.groundAt(gx, gz),
      ceilingAt: (gx, gz) => this.ceilingAt(gx, gz),
      solidAt: (gx, gy, gz) => this.solidAt(gx, gy, gz),
      terrainAt: (gx, gz) => this.corridor.heightAt(gx + this.road.origin.x, gz + this.road.origin.z),
      sees: (a, b) => this.director.sees(a, b),
      post: this.post,
    });
    this.director.update(clamped, car, this.sCar, this.chase);

    // Terrain and forest follow the camera; tiles are built a few per frame.
    // Tiles to build again after a turn wait until the road is laid again.
    const cam = this.camera.position;
    syncWorlds(this.worlds, cam.x + this.road.origin.x, cam.z + this.road.origin.z);
    const relaying = this.road.relaying(this.sCar);
    this.terrain.holdStale = relaying;
    this.forest.holdStale = relaying;
    this.city.holdStale = relaying;
    this.terrain.update(cam.x + this.road.origin.x, cam.z + this.road.origin.z, !!this.opts.syncWorld);
    this.terrain.setPortals(this.roadMesh.portalsNear(cam.x + this.road.origin.x, cam.z + this.road.origin.z, 8));
    this.forest.update(cam.x + this.road.origin.x, cam.z + this.road.origin.z, !!this.opts.syncWorld);
    this.forest.animate(clamped);
    this.city.update(cam.x + this.road.origin.x, cam.z + this.road.origin.z, !!this.opts.syncWorld);
    this.water.update(clamped, this.camera);
    this.ceiling.update(this.camera, cam.x + this.road.origin.x, cam.z + this.road.origin.z);
    this._updateLook(cam.x, cam.z, clamped);
    const bufferH = this.renderer.getDrawingBufferSize(this._bufferSize).y;
    this.motes.update(clamped, this.camera, this._lookAt, this.road.origin, bufferH);
    this.fish.update(clamped, this.camera, this._lookAt, this.road.origin);
    this.critters.update(clamped, {
      camera: this.camera, car, sCar: this.sCar, style: this.style.cur, at: this._lookAt,
      origin: this.road.origin, ground: car.groundY || 0, fogColor: this.scene.fog.color,
    });
    // The block style's trees are built of blocks.
    this.forest.setBlocky(this.style.cur.blocks > 0.5);
    this.roadMesh.setViewHeight(bufferH);

    // Tunnels. The frame's light follows the lens: inside a bore the sun and
    // sky go out, the lamps take over and the haze thins, and the eye opens
    // up (below). The car's own light follows the car. With the lens outside
    // and the car inside (a camera at the tunnel mouth), the bore and the car
    // keep only a little of the sky.
    const p = this.road.at(this.sCar);
    const want = p && p.kind === TUNNEL ? 1 : 0;
    this.inTunnel += (want - this.inTunnel) * Math.min(1, clamped * 2.5);
    const ceil = this.ceilingAt(cam.x, cam.z, this.director.active ? this.director.camS : this.sCar);
    const camWant = ceil !== null && cam.y < ceil + 0.5 ? 1 : 0;
    this.camInTunnel += (camWant - this.camInTunnel) * Math.min(1, clamped * 2.5);
    const look = this.atmosphere.look;
    const tin = this.camInTunnel;
    this.atmosphere.sun.intensity = look.sunIntensity * (1 - tin * 0.97);
    this.atmosphere.hemi.intensity = look.hemiIntensity + (0.3 - look.hemiIntensity) * tin;
    this.atmosphere.hemi.color.set(look.skyLight).lerp(TUNNEL_LAMP, tin);
    this.atmosphere.hemi.groundColor.set(look.groundLight).lerp(TUNNEL_FLOOR, tin);
    atmo.uEnvScale.value = look.envIntensity * (1 - tin * 0.85);
    // A drawn style may thin the haze (render/style.js; 1 as it is).
    atmo.fogParams.value.x = look.fogDensity * (1 - tin * 0.9) * this.style.cur.fog;
    // The eye opens up in the dark of a bore and closes again outside, more
    // slowly than the light changes: the mouth ahead burns white, and for a
    // moment out in the open everything is too bright.
    this.eye += (tin - this.eye) * Math.min(1, clamped * (tin > this.eye ? 0.9 : 1.2));
    this.post.exposure = (look.exposure || 1) * (1 + this.eye * 0.5);
    // Daylight outside: the sun's strength in this world, before the bore
    // takes it away.
    this.roadMesh.setInside(tin, Math.min(1, Math.max(0, (look.sunIntensity - 1) / 2.5)));
    boreSky.value = 1 - 0.88 * (1 - tin);
    carSky.value = 1 - 0.8 * this.inTunnel * (1 - tin);
    // The car is lit by whatever sun gets past the ridges to where it is.
    const ax = car.x + this.road.origin.x;
    const az = car.z + this.road.origin.z;
    const vis = sunVisibility(this.land, ax, az, car.y || 0, this.atmosphere.sunDir);
    sunMask.value += (vis * (1 - this.inTunnel) - sunMask.value) * Math.min(1, clamped * 4);
    // Headlights: on in tunnels, and in a world where the sun is low.
    const dark = 1 - Math.min(1, Math.max(0, (look.sunIntensity - 1.5) / 2));
    this.headlight.intensity = 30 * (0.15 + Math.max(this.inTunnel, dark * 0.7));
    this.headlight.position.set(car.x + fx * 1.8, car.y + 0.75, car.z + fz * 1.8);
    this.headlight.target.position.set(car.x + fx * 30, car.y - 0.6, car.z + fz * 30);
    if (this.tailLight) this.tailLight.emissiveIntensity = (car.brake || 0) > 0.05 ? 6 : 2;
    const pres = this.presentation;
    if (this.emitterMat) this.emitterMat.emissiveIntensity = 0.15 + 2.6 * pres.foldAmount;
    if (this.thrusterMat) {
      this.thrusterMat.emissiveIntensity = 0.15 + pres.liftAmount * (0.8 + 2.4 * (car.throttle || 0));
    }

    this.atmosphere.update(clamped, this.camera, { x: car.x, y: car.y, z: car.z });

    // A change of style moves the sky too: its environment map is drawn again
    // as it goes, and once it has arrived.
    if (this.style.update(clamped)) {
      this.style.applyScene();
      this._styleBake -= clamped;
      if (this._styleBake <= 0 || !this.style.moving) {
        this.atmosphere._envDirty = true;
        this._styleBake = 0.12;
      }
    }
    this.style.tick(clamped);

    if (this.resetting) {
      this.resetFade = Math.max(0, this.resetFade - clamped * 1.5);
      const pulse = this.resetFade > 0 ? 0.35 + 0.65 * Math.abs(Math.sin(this.resetFade * Math.PI * 7)) : 1;
      this.presentation.setBlink(this.resetFade > 0 ? pulse : null);
      if (this.resetFade <= 0) this.resetting = false;
    }

    this.stats.frames++;
    this.stats.maxSpeed = Math.max(this.stats.maxSpeed, car.speed);
    this._fpsAccum += clamped;
    this._fpsFrames++;
    if (this._fpsAccum > 0.5) {
      this.fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0;
      this._fpsFrames = 0;
    }
    this.frame++;
  }

  resize(w, h) {
    this.size = [w, h];
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
  }

  render(dt = 1 / 60) {
    this.renderer.info.reset();
    this.post.setStyle(this.style);
    this.post.render(dt);
  }

  snapshot() {
    const p = this.road.at(this.sCar);
    return {
      frame: this.frame,
      simTime: +this.simTime.toFixed(2),
      distance: +this.sCar.toFixed(1),
      speedKmh: +this.car.speedKmh.toFixed(1),
      altitude: +(this.car.y || 0).toFixed(1),
      structure: p ? ['ground', 'bridge', 'tunnel'][p.kind] : '',
      autoMode: this.autoMode,
      fps: +this.fps.toFixed(1),
      exposure: +this.post.exposure.toFixed(2),
      pixelRatio: +this.renderer.getPixelRatio().toFixed(2),
      quality: this.quality ? this.quality.level : 0,
      tiles: this.terrain.rendered.size,
      buried: this.terrain.buried,
      ceilingShown: this.ceiling.mesh.visible,
      motes: this.motes.points.visible ? this.motes.shown : 0,
      fish: this.fish.mesh.visible ? this.fish.shown : 0,
      critters: this.critters.shown,
      flyers: this.critters.birds.shown + this.critters.butterflies.shown,
      trees: this.forest.trees,
      buildings: this.city.buildings,
      roadChunks: this.roadMesh.chunks.size,
      lamps: this.roadMesh.lamps,
      envBakes: this.atmosphere.bakes || 0,
      style: this.style.id,
      styleT: +this.style.t.toFixed(3),
      styled: this.post.stylePass.enabled,
      world: this.worldHere(),
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      carLoaded: this.carLoaded,
      hits: this.hits || 0,
      wrecks: this.wrecks,
      road: this.road.stats,
    };
  }
}
