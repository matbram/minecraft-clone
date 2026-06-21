// Orchestrates all Phase 2 "feel" FX. The only object main.ts wires. Interaction
// fires onBreak/onPlace; everything else runs from update(). FX read state and
// mutate only the camera + audio graph — never world/player/interaction — so the
// whole phase is skippable and never load-bearing for correctness.

import * as THREE from 'three';
import { Block } from '../core/BlockTypes';
import { EYE_HEIGHT } from '../core/constants';
import type { World } from '../world/World';
import type { Input } from '../player/Input';
import { PlayerMode, type Player } from '../player/Player';
import type { AtlasResult } from '../render/atlas';
import { buildTileColors } from '../render/tileColors';
import { Sfx } from '../audio/Sfx';
import { Particles } from './Particles';
import { ItemDrops } from './ItemDrops';
import { ViewBob } from './ViewBob';
import { CameraFx } from './CameraFx';

const STEP_DIST = 2.2; // blocks traveled per footstep
const SPLASH_COLOR = new THREE.Color(0xbfe6ff); // whitish-blue droplets

export class Effects {
  private readonly sfx = new Sfx();
  private readonly particles: Particles;
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

  constructor(scene: THREE.Scene, world: World, input: Input, player: Player, atlas: AtlasResult) {
    this.world = world;
    this.player = player;
    this.tileColors = buildTileColors(atlas.canvas);
    this.particles = new Particles(scene);
    this.drops = new ItemDrops(scene, world, atlas.texture);
    this.cameraFx = new CameraFx(input);
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
