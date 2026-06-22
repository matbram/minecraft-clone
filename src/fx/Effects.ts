// Orchestrates all Phase 2 "feel" FX. The only object main.ts wires. Interaction
// fires onBreak/onPlace; everything else runs from update(). FX read state and
// mutate only the camera + audio graph — never world/player/interaction — so the
// whole phase is skippable and never load-bearing for correctness.

import * as THREE from 'three';
import { Block } from '../core/BlockTypes';
import {
  EYE_HEIGHT,
  EXPLOSION_FIREBALL_R,
  EXPLOSION_SHAKE_R,
  EXPLOSION_SHOCKWAVE_R,
  EXPLOSION_SHOCKWAVE_SPEED,
  EXPLOSION_POWER_MAX,
  FIRE_FLAME_HEIGHT,
} from '../core/constants';
import type { World } from '../world/World';
import type { Input } from '../player/Input';
import { PlayerMode, type Player } from '../player/Player';
import type { AtlasResult } from '../render/atlas';
import { buildTileColors } from '../render/tileColors';
import { Sfx } from '../audio/Sfx';
import { Particles } from './Particles';
import { BlastParticles } from './BlastParticles';
import { Shockwave } from './Shockwave';
import { ItemDrops } from './ItemDrops';
import { ViewBob } from './ViewBob';
import { CameraFx } from './CameraFx';

const STEP_DIST = 2.2; // blocks traveled per footstep
const SPLASH_COLOR = new THREE.Color(0xbfe6ff); // whitish-blue droplets
// Phase 15: explosion palettes (RGB 0..1). Fire is emissive (additive, stays bright in
// the dark); smoke/dust use the NORMAL-blend pool and are tinted by the world light.
const FIRE_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [1.0, 0.95, 0.7],
  [1.0, 0.75, 0.25],
  [1.0, 0.45, 0.12],
];
const SPARK_PALETTE: ReadonlyArray<readonly [number, number, number]> = [[1.0, 1.0, 0.85]];
const SMOKE_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [0.16, 0.16, 0.16],
  [0.09, 0.09, 0.1],
  [0.22, 0.2, 0.17],
];
const DUST_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [0.55, 0.46, 0.34],
  [0.42, 0.34, 0.24],
];
// Phase 15.5: glowing embers that rise out of the flames and drift up through the smoke.
const EMBER_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [1.2, 0.6, 0.2],
  [1.3, 0.85, 0.35],
];

export class Effects {
  private readonly sfx = new Sfx();
  private readonly particles: Particles;
  private readonly fire: BlastParticles; // Phase 15: additive fireball + sparks
  private readonly smoke: BlastParticles; // Phase 15: normal-blend dust + smoke plume
  private readonly shockwave: Shockwave;
  private readonly drops: ItemDrops;
  private readonly viewBob = new ViewBob();
  private readonly cameraFx: CameraFx;
  private readonly tileColors: THREE.Color[];
  private readonly world: World;
  private readonly player: Player;
  private readonly eye = new THREE.Vector3();
  private readonly fallbackColor = new THREE.Color(0x888888);
  private stepAccum = 0;
  private ambienceStarted = false;
  private lightMul = 1; // current sky-light multiplier (day/night) for tinting FX
  private clock = 0; // seconds accumulated, drives particle curl turbulence
  private readonly flashEl: HTMLElement | null;
  private flashTimer: number | null = null;
  private lowFx = false; // Low preset: skip the shockwave + use fewer particles

  constructor(scene: THREE.Scene, world: World, input: Input, player: Player, atlas: AtlasResult, flashEl?: HTMLElement | null) {
    this.world = world;
    this.player = player;
    this.tileColors = buildTileColors(atlas.canvas);
    this.particles = new Particles(scene);
    this.fire = new BlastParticles(scene, true, 384, 0.4); // gentle curl on embers/fireball
    this.smoke = new BlastParticles(scene, false, 640, 1.1); // strong curl -> billowing smoke
    this.shockwave = new Shockwave(scene);
    this.drops = new ItemDrops(scene, world, atlas.texture);
    this.cameraFx = new CameraFx(input);
    this.flashEl = flashEl ?? null;
  }

  // Low preset turns off the heavier explosion FX (shockwave mesh + denser particles).
  setLowFx(low: boolean): void {
    this.lowFx = low;
  }

  resumeAudio(): void {
    this.sfx.resume();
    if (!this.ambienceStarted) {
      this.sfx.ambience(true);
      this.ambienceStarted = true;
    }
  }

  setMuted(m: boolean): void {
    this.sfx.setMuted(m);
  }

  onBreak(block: Block, x: number, y: number, z: number): void {
    this.sfx.playBreak(block);
    const b = this.world.brightnessAt(x, y, z, this.lightMul);
    this.particles.burst(x + 0.5, y + 0.5, z + 0.5, this.tileColors[block] ?? this.fallbackColor, 10, b);
    this.drops.spawn(block, x + 0.5, y + 0.5, z + 0.5);
  }

  onPlace(block: Block): void {
    this.sfx.playPlace(block);
  }

  // Phase 11b: soft cue when a food item is eaten (reuses the pickup chime).
  onEat(): void {
    this.sfx.playPickup();
  }

  // Phase 12d: feedback when a creature is hit / killed (particle puff + a thud).
  onCreatureHit(pos: THREE.Vector3, color: THREE.Color): void {
    this.particles.burst(pos.x, pos.y, pos.z, color, 6, 1);
    this.sfx.playStep(Block.GRAVEL);
  }
  onCreatureDie(pos: THREE.Vector3, color: THREE.Color): void {
    this.particles.burst(pos.x, pos.y, pos.z, color, 20, 1);
    this.sfx.playBreak(Block.DIRT);
  }

  // Phase 15: a soft grey smoke puff trailing a rocket (tinted by the local light so it
  // doesn't glow in the dark). Called many times per second along the rocket's path.
  explosionTrail(x: number, y: number, z: number): void {
    const b = Math.max(0.25, this.world.brightnessAt(Math.floor(x), Math.floor(y), Math.floor(z), this.lightMul));
    this.smoke.burst(
      x,
      y,
      z,
      SMOKE_PALETTE,
      { count: 1, speed: 0.5, life: 1.1, size: 0.9, endScale: 2.4, alpha: 0.7, gravity: -0.4, up: 0.4, spread: 0.2 },
      b,
    );
  }

  // Phase 15/15.1: the explosion FX at `center`. `distToPlayer` (blocks) drives the
  // flash→boom audio delay + screen shake; `power` (ammo × tuning) scales the whole show.
  // Soft, growing, glowing particles (not squares): fireball shrinks+fades, smoke billows.
  onExplosion(center: THREE.Vector3, distToPlayer: number, power = 1): void {
    const { x, y, z } = center;
    const low = this.lowFx;
    const p = Math.min(EXPLOSION_POWER_MAX, Math.max(0.25, power));
    const pc = Math.min(3, p); // count multiplier (size carries the rest, so we don't spam points)
    const fbR = EXPLOSION_FIREBALL_R * p;

    // Full-screen flash pulse: add 'active' then drop it so the CSS transition fades out.
    if (this.flashEl) {
      this.flashEl.classList.add('active');
      if (this.flashTimer !== null) clearTimeout(this.flashTimer);
      this.flashTimer = window.setTimeout(() => this.flashEl?.classList.remove('active'), 40 + Math.min(120, p * 20));
    }

    // Fireball: big soft additive blobs that shrink + fade (glow + bloom). Bright fast sparks.
    this.fire.burst(x, y, z, FIRE_PALETTE, {
      count: Math.round((low ? 40 : 80) * pc),
      speed: fbR * 1.3,
      life: 0.9,
      size: 1.0 + p * 0.35,
      endScale: 0.4,
      gravity: -2,
      up: 1.5,
      spread: fbR * 0.25,
    });
    this.fire.burst(x, y, z, SPARK_PALETTE, {
      count: Math.round((low ? 10 : 22) * pc),
      speed: 12 + p * 2,
      life: 0.5,
      size: 0.5 + p * 0.1,
      endScale: 0.2,
      gravity: 14,
      up: 2,
    });

    // Dust/ejecta (falls) + a rising, billowing smoke plume — tinted by local light.
    const b = Math.max(0.2, this.world.brightnessAt(Math.floor(x), Math.floor(y), Math.floor(z), this.lightMul));
    this.smoke.burst(
      x,
      y,
      z,
      DUST_PALETTE,
      { count: Math.round((low ? 12 : 26) * pc), speed: 5 + p, life: 1.3, size: 0.8 + p * 0.2, endScale: 1.6, gravity: 9, up: 1, spread: fbR * 0.15 },
      b,
    );
    this.smoke.burst(
      x,
      y + 0.5,
      z,
      SMOKE_PALETTE,
      { count: Math.round((low ? 14 : 30) * pc), speed: 2 + p * 0.5, life: 6, lifeVar: 0.4, size: 1.2 + p * 0.5, endScale: 2.8, alpha: 0.9, gravity: -0.5, up: 2, spread: 1 + p * 0.3 },
      b,
    );

    // Shock ring (outruns the fireball) — scales with power; skipped on Low.
    if (!low) this.shockwave.spawn(x, y, z, EXPLOSION_SHOCKWAVE_R * p, EXPLOSION_SHOCKWAVE_SPEED * Math.sqrt(p));

    // Screen shake: bigger blasts shake harder + from further away.
    const shakeR = EXPLOSION_SHAKE_R * Math.sqrt(p);
    const trauma = Math.max(0, 1 - distToPlayer / shakeR);
    if (trauma > 0) this.cameraFx.addTrauma(Math.min(1, trauma * trauma + 0.12 * pc));

    // Layered boom, delayed by distance (flash precedes boom for far blasts); deeper/longer
    // for bigger warheads.
    this.sfx.playExplosion(distToPlayer, p);
  }

  // Phase 15.2/15.5: ongoing smoke from a burning cell (FireSim drives these via main,
  // distance-culled). Smoke is INTERTWINED with the flame: a thin wisp low inside the flame
  // column + a thicker billowing plume seeded higher up, so smoke threads through the fire
  // (rather than capping it) and the cooling tips become smoke. Curl (in BlastParticles)
  // makes it turbulent. Tinted by local light.
  fireSmoke(x: number, y: number, z: number): void {
    const b = Math.max(0.2, this.world.brightnessAt(Math.floor(x), Math.floor(y), Math.floor(z), this.lightMul));
    // Thin wisp woven low through the flames.
    this.smoke.burst(
      x,
      y + Math.random() * FIRE_FLAME_HEIGHT * 0.5,
      z,
      SMOKE_PALETTE,
      { count: 1, speed: 0.4, life: 1.8, lifeVar: 0.4, size: 0.4, endScale: 2.4, alpha: 0.45, gravity: -0.3, up: 0.9, spread: 0.25 },
      b,
    );
    // Thicker plume rising from the cooling top of the flame upward.
    this.smoke.burst(
      x,
      y + FIRE_FLAME_HEIGHT * (0.6 + Math.random() * 0.6),
      z,
      SMOKE_PALETTE,
      { count: 1, speed: 0.5, life: 3.6, lifeVar: 0.4, size: 0.8, endScale: 3.4, alpha: 0.7, gravity: -0.5, up: 1.4, spread: 0.5 },
      b,
    );
  }

  // Phase 15.5: a tiny glowing ember rising out of the flames and drifting up through the
  // smoke (additive -> blooms). The flame→smoke bridge from the reference.
  fireEmber(x: number, y: number, z: number): void {
    this.fire.burst(
      x,
      y + Math.random() * 0.4,
      z,
      EMBER_PALETTE,
      { count: 1, speed: 0.4, life: 1.5, lifeVar: 0.5, size: 0.13, endScale: 0.5, gravity: -0.8, up: 1.7, spread: 0.2 },
    );
  }

  // Phase 15.5: flamethrower jet FX — a forward cone of additive fire (flies along `dir`)
  // + the occasional smoke puff downstream. Called every frame while firing.
  flameJet(origin: THREE.Vector3, dir: THREE.Vector3, range: number): void {
    const speed = range / 0.32; // particles cover ~range over their ~0.32s life
    const bv: [number, number, number] = [dir.x * speed, dir.y * speed, dir.z * speed];
    this.fire.burst(
      origin.x + dir.x * 0.6,
      origin.y + dir.y * 0.6,
      origin.z + dir.z * 0.6,
      FIRE_PALETTE,
      { count: 4, speed: 1.6, life: 0.35, lifeVar: 0.4, size: 0.4, endScale: 1.5, gravity: -1, up: 0.2, spread: 0.25, baseVel: bv },
    );
    if (Math.random() < 0.6) {
      const d = (0.4 + Math.random() * 0.6) * range;
      const px = origin.x + dir.x * d;
      const py = origin.y + dir.y * d;
      const pz = origin.z + dir.z * d;
      const b = Math.max(0.2, this.world.brightnessAt(Math.floor(px), Math.floor(py), Math.floor(pz), this.lightMul));
      this.smoke.burst(
        px,
        py,
        pz,
        SMOKE_PALETTE,
        { count: 1, speed: 0.5, life: 1.6, size: 0.5, endScale: 2.6, alpha: 0.5, gravity: -0.3, up: 0.7, spread: 0.4, baseVel: [bv[0] * 0.3, bv[1] * 0.3, bv[2] * 0.3] },
        b,
      );
    }
  }

  startFlameroar(): void {
    this.sfx.startFlameroar();
  }
  stopFlameroar(): void {
    this.sfx.stopFlameroar();
  }

  // Phase 11.5 underwater: muffle + ambience swap (safe to call every frame — Sfx
  // dedupes), a splash (sound + droplet burst) on crossing the surface, and bubbles.
  setSubmerged(on: boolean): void {
    this.sfx.setSubmerged(on);
  }
  splash(x: number, y: number, z: number, bright = 1): void {
    this.sfx.playSplash();
    this.particles.burst(x, y, z, SPLASH_COLOR, 16, bright);
  }
  bubble(): void {
    this.sfx.playBubble();
  }

  update(dt: number, camera: THREE.PerspectiveCamera, lightMul: number): void {
    const p = this.player;
    this.lightMul = lightMul;
    this.clock += dt;
    this.particles.update(dt);
    this.fire.update(dt, this.clock);
    this.smoke.update(dt, this.clock);
    this.shockwave.update(dt);

    this.eye.set(p.pos.x, p.pos.y + EYE_HEIGHT, p.pos.z);
    this.drops.update(dt, this.eye, () => this.sfx.playPickup(), lightMul);

    // Footsteps tied to distance traveled (not frames/ticks).
    const hspeed = Math.hypot(p.vel.x, p.vel.z);
    if (p.onGround && p.mode === PlayerMode.WALK && hspeed > 0.5) {
      this.stepAccum += hspeed * dt;
      if (this.stepAccum >= STEP_DIST) {
        this.stepAccum = 0;
        const below = this.world.getBlockWorld(
          Math.floor(p.pos.x),
          Math.floor(p.pos.y - 0.1),
          Math.floor(p.pos.z),
        );
        if (below !== Block.AIR) this.sfx.playStep(below);
      }
    } else {
      this.stepAccum = Math.min(this.stepAccum, STEP_DIST * 0.8);
    }

    this.cameraFx.update(camera, p, dt);
    this.viewBob.apply(camera, p, dt); // last: post-aim cosmetic offset
  }
}
