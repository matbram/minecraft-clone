// Orchestrates all Phase 2 "feel" FX. The only object main.ts wires. Interaction
// fires onBreak/onPlace; everything else runs from update(). FX read state and
// mutate only the camera + audio graph — never world/player/interaction — so the
// whole phase is skippable and never load-bearing for correctness.

import * as THREE from 'three';
import { Block } from '../core/BlockTypes';
import { EYE_HEIGHT, EXPLOSION_FIREBALL_R, EXPLOSION_SHAKE_R } from '../core/constants';
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
const SMOKE_COLOR = new THREE.Color(0x6b6b6b); // grey rocket-trail puff (small pool)
const FIRE_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [1.0, 0.95, 0.7],
  [1.0, 0.75, 0.25],
  [1.0, 0.45, 0.12],
];
const SPARK_PALETTE: ReadonlyArray<readonly [number, number, number]> = [[1.0, 1.0, 0.85]];
const SMOKE_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [0.32, 0.32, 0.32],
  [0.22, 0.22, 0.22],
  [0.42, 0.4, 0.38],
];
const DUST_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [0.55, 0.46, 0.34],
  [0.42, 0.34, 0.24],
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
  private readonly flashEl: HTMLElement | null;
  private flashTimer: number | null = null;
  private lowFx = false; // Low preset: skip the shockwave + use fewer particles

  constructor(scene: THREE.Scene, world: World, input: Input, player: Player, atlas: AtlasResult, flashEl?: HTMLElement | null) {
    this.world = world;
    this.player = player;
    this.tileColors = buildTileColors(atlas.canvas);
    this.particles = new Particles(scene);
    this.fire = new BlastParticles(scene, true, 0.7, 360);
    this.smoke = new BlastParticles(scene, false, 0.9, 360);
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

  // Phase 15: a grey smoke puff trailing a rocket (tinted by the local light so it
  // doesn't glow in the dark). Called many times per second along the rocket's path.
  explosionTrail(x: number, y: number, z: number): void {
    const b = this.world.brightnessAt(Math.floor(x), Math.floor(y), Math.floor(z), this.lightMul);
    this.particles.burst(x, y, z, SMOKE_COLOR, 2, Math.max(0.25, b));
  }

  // Phase 15: the explosion FX at `center`. `distToPlayer` (blocks) drives the
  // flash→boom audio delay + screen shake. Looks Bay (bright fireball, sparks, lingering
  // smoke) but borrows reality's hard impulse, an outrunning shock ring, and dust/ejecta.
  onExplosion(center: THREE.Vector3, distToPlayer: number): void {
    const { x, y, z } = center;
    const low = this.lowFx;

    // Full-screen flash pulse: add 'active' then drop it so the CSS transition fades out.
    if (this.flashEl) {
      this.flashEl.classList.add('active');
      if (this.flashTimer !== null) clearTimeout(this.flashTimer);
      this.flashTimer = window.setTimeout(() => this.flashEl?.classList.remove('active'), 40);
    }

    // Fireball: emissive, buoyant (rises), spreads to ~the fireball radius. Bright core
    // + fast sparks on top.
    this.fire.burst(x, y, z, FIRE_PALETTE, {
      count: low ? 40 : 90,
      speed: EXPLOSION_FIREBALL_R * 1.4,
      life: 0.9,
      gravity: -2,
      up: 1.5,
      spread: 0.8,
    });
    this.fire.burst(x, y, z, SPARK_PALETTE, { count: low ? 12 : 26, speed: 16, life: 0.5, gravity: 14, up: 2 });

    // Dust/ejecta (falls) + a rising smoke plume — tinted by the local light so they
    // read dark in caves / at night.
    const b = Math.max(0.25, this.world.brightnessAt(Math.floor(x), Math.floor(y), Math.floor(z), this.lightMul));
    this.smoke.burst(x, y, z, DUST_PALETTE, { count: low ? 14 : 30, speed: 7, life: 1.2, gravity: 10, up: 1 }, b);
    this.smoke.burst(
      x,
      y + 0.5,
      z,
      SMOKE_PALETTE,
      { count: low ? 16 : 34, speed: 2.5, life: 6, lifeVar: 0.4, gravity: -0.5, up: 2, spread: 1 },
      b,
    );

    // Shock ring (outruns the fireball) — skipped on Low.
    if (!low) this.shockwave.spawn(x, y, z);

    // Screen shake falls off with distance; small floor so even far blasts register.
    const trauma = Math.max(0, 1 - distToPlayer / EXPLOSION_SHAKE_R);
    if (trauma > 0) this.cameraFx.addTrauma(Math.min(1, trauma * trauma + 0.12));

    // Layered boom, delayed by distance (flash precedes boom for far blasts).
    this.sfx.playExplosion(distToPlayer);
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
    this.particles.update(dt);
    this.fire.update(dt);
    this.smoke.update(dt);
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
