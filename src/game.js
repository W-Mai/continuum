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

import { makeWorldLand, WORLDS } from './world/worlds.js';
import { Road, HALF_PAVED, HALF_FLAT, TUNNEL } from './world/road.js';
import { Corridor, TUNNEL_H } from './world/corridor.js';
import { Car } from './core/car.js';
import { Autopilot, Driver } from './core/autopilot.js';
import { Collisions } from './core/collisions.js';
import { CarPresentation, ChaseCamera } from './render/presentation.js';
import { Director } from './render/director.js';
import { Atmosphere, ALPINE_LOOK, atmo, withAtmosphere, withSunMask, withSkyScale, sunMask, boreSky, carSky } from './render/atmosphere.js';
import { bindWorlds, worldLook, mixLooks, setWorldOrigin } from './render/worldlook.js';
import { Water } from './render/water.js';
import { City } from './render/city.js';
import { Ceiling } from './render/ceiling.js';
import { sunVisibility } from './world/sunlight.js';
import { TerrainField } from './render/terrain.js';
import { Forest } from './render/forest.js';
import { makeVegetation } from './world/vegetation.js';
import { RoadRenderer } from './render/roadmesh.js';
import { PostChain } from './render/post.js';
import { Quality } from './render/quality.js';
import { Traffic } from './render/traffic.js';
import { SkidMarks, TyreParticles } from './render/effects.js';

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

    this.seed = opts.seed !== undefined ? opts.seed : Math.floor(Math.random() * 1e6);
    this.land = makeWorldLand(this.seed, { start: opts.world, len: opts.worldLen });
    this.land.debug = !!opts.terrainDebug;
    this.worlds = this.land.worlds;
    this.road = new Road(this.land, this.seed);
    bindWorlds(this.worlds);
    // Start further down the road (showcase captures): survey up to there first,
    // so everything below is built around the right place.
    this.sCar = opts.start > 160 ? opts.start : 160;
    if (this.sCar > 160) this.road.update(this.sCar);
    this.corridor = new Corridor(this.road, this.land);
    this.vegetation = makeVegetation(this.land, this.seed);

    // The sky and light of the world the camera is in, mixed across borders.
    this._look = mixLooks({}, worldLook(0), worldLook(0), 0);
    this._lookAt = { a: -1, b: -1, t: -1, baked: -1, pair: '', clock: 0 };
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
    this.water = new Water(this.scene, 0);
    this.city = new City(this.scene, this.land, this.corridor, this.seed);
    this.ceiling = new Ceiling(this.scene);
    this.roadMesh = new RoadRenderer(this.scene, this.road, this.corridor, this.renderer);
    this.roadMesh.setSun(this.atmosphere.sunDir);
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
    });
    this.skids = new SkidMarks(this.scene);
    this.dust = new TyreParticles(this.scene);

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
    setWorldOrigin(o.x, o.z);
  }

  // The world the camera is in: mix the two looks across a border and hand
  // them to the atmosphere. The sky's environment map is re-rendered only
  // when the mix has moved on by a few percent, at most three times a second.
  _updateLook(x, z, dt, force = false) {
    const w = this.worlds.at(x + this.road.origin.x, z + this.road.origin.z);
    const L = this._lookAt;
    L.clock += dt;
    const pair = w.a + ':' + w.b;
    if (!force && pair === L.pair && Math.abs(w.t - L.t) < 1e-3) return;
    mixLooks(this._look, worldLook(w.a), worldLook(w.b), w.t);
    const rebake = force || pair !== L.pair || (Math.abs(w.t - L.baked) > 0.03 && L.clock > 0.33);
    this.atmosphere.apply(this._look, rebake);
    if (rebake) {
      L.baked = w.t;
      L.clock = 0;
    }
    L.pair = pair;
    L.a = w.a;
    L.b = w.b;
    L.t = w.t;
  }

  // Where the camera is among the worlds, for the interface.
  worldHere() {
    const L = this._lookAt;
    const main = L.t < 0.5 ? L.a : L.b;
    return { id: WORLDS[main].id, name: WORLDS[main].name, from: WORLDS[L.a].name, to: WORLDS[L.b].name, t: L.t };
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
      if (e.code === 'KeyP') this.autoMode = !this.autoMode;
      if (e.code === 'KeyC') this.cycleCamera();
    });
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

  resetToRoad() {
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
    this.wrecks++;
  }

  stepPhysics(dt) {
    const shift = this.road.update(this.sCar);
    if (shift) this._shiftWorld(shift);

    this.sCar = this.road.nearestS(this.car.x, this.car.z, this.sCar).s;
    const p = this.road.at(this.sCar);
    if (p) {
      const lat = this.road.lateralOf(this.sCar, this.car.x, this.car.z);
      const crown = Math.abs(lat) < HALF_PAVED ? CROWN * (1 - (lat / HALF_PAVED) ** 2) : 0;
      this.car.groundY = this.road.surfaceAt(this.sCar, lat) + crown;
      this.car.groundVy = p.grade * Math.max(0, this.car.vx);
      this.car.pitchSlope = Math.atan(p.grade);
      this.bank = p.bank;
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
    this.car.step(dt, cmd);

    const hit = this.collisions.update(dt, this.sCar, this.traffic, this.simTime);
    if (hit && hit.kind === 'impact') {
      this.car.applyImpact(hit.speed, hit.oncoming);
      this.hits = (this.hits || 0) + 1;
    }
    if (this.car.wrecked && this.car.wreckTimer > 1.6 && !this.resetting) this.resetToRoad();
    this.simTime += dt;
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
    this._applyOrigin();
  }

  update(dt) {
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
    const hubF = this.road.surfaceAt(this.sCar + 1.35, lat) + CROWN + 0.34;
    const hubR = this.road.surfaceAt(this.sCar - 1.35, lat) + CROWN + 0.34;
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
    });
    this.director.update(clamped, car, this.sCar, this.chase);

    // Terrain and forest follow the camera; tiles are built a few per frame.
    const cam = this.camera.position;
    this.terrain.update(cam.x + this.road.origin.x, cam.z + this.road.origin.z, !!this.opts.syncWorld);
    this.forest.update(cam.x + this.road.origin.x, cam.z + this.road.origin.z, !!this.opts.syncWorld);
    this.city.update(cam.x + this.road.origin.x, cam.z + this.road.origin.z, !!this.opts.syncWorld);
    this.water.update(clamped, this.camera);
    this.ceiling.update(this.camera);
    this._updateLook(cam.x, cam.z, clamped);

    // Tunnels. The frame's light follows the lens: inside a bore the sun and
    // sky go out, the lamps take over, the haze thins and the exposure opens a
    // little, as an eye does. The car's own light follows the car. With the
    // lens outside and the car inside (a camera at the tunnel mouth), the bore
    // and the car keep only a little of the sky.
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
    atmo.fogParams.value.x = look.fogDensity * (1 - tin * 0.9);
    this.post.exposure = (look.exposure || 1) * (1 + tin * 0.4);
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
      pixelRatio: +this.renderer.getPixelRatio().toFixed(2),
      quality: this.quality ? this.quality.level : 0,
      tiles: this.terrain.rendered.size,
      trees: this.forest.trees,
      buildings: this.city.buildings,
      roadChunks: this.roadMesh.chunks.size,
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
