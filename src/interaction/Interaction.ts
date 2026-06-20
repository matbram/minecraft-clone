// Ties raycast aim to break/place. updateAim() runs per frame (raycast + outline);
// tick() runs per fixed step (mining progress); tryPlace() fires on right-click.

import type * as THREE from 'three';
import { Block, HARDNESS, IS_SOLID, IS_EDIBLE } from '../core/BlockTypes';
import { REACH, INSTANT_BREAK, BREAK_STAGES } from '../core/constants';
import type { World } from '../world/World';
import type { Input } from '../player/Input';
import type { Player } from '../player/Player';
import type { Hotbar } from '../ui/Hotbar';
import type { BlockOutline } from '../render/BlockOutline';
import type { BreakOverlay } from '../render/BreakOverlay';
import { raycastVoxel, type RayHit } from './Raycast';

function sameCell(a: RayHit | null, b: RayHit | null): boolean {
  if (!a || !b) return a === b;
  return a.cell.x === b.cell.x && a.cell.y === b.cell.y && a.cell.z === b.cell.z;
}

export class Interaction {
  target: RayHit | null = null;
  // Fired when a block is broken / placed (wired to FX in main; default no-op so
  // mechanics work standalone and Phase 2 stays fully skippable).
  onBreak: (block: Block, x: number, y: number, z: number) => void = () => {};
  onPlace: (block: Block, x: number, y: number, z: number) => void = () => {};
  // Fired when a held edible is right-clicked; returns whether it was consumed
  // (so a cue can play). Default no-op keeps eating fully optional.
  onEat: (food: Block) => boolean = () => false;
  private breakProgress = 0;
  private paused = false;

  constructor(
    private readonly world: World,
    private readonly input: Input,
    private readonly player: Player,
    private readonly hotbar: Hotbar,
    private readonly outline: BlockOutline,
    private readonly breakOverlay: BreakOverlay,
  ) {}

  setPaused(p: boolean): void {
    this.paused = p;
    if (p) this.resetBreak();
  }

  // Per-frame: raycast from the eye, update the selection outline.
  updateAim(origin: THREE.Vector3, dir: THREE.Vector3): void {
    const hit = this.paused ? null : raycastVoxel(this.world, origin, dir, REACH);
    if (!sameCell(hit, this.target)) this.resetBreak();
    this.target = hit;
    this.outline.setTarget(hit ? hit.cell : null);
    if (!hit) this.breakOverlay.setStage(null, -1);
  }

  // Per fixed step: accrue mining progress while the left button is held.
  tick(dt: number): void {
    if (this.paused || !this.target || !this.input.isMouseDown(0)) {
      this.resetBreak();
      return;
    }
    const hardness = HARDNESS[this.target.block];
    if (!Number.isFinite(hardness)) {
      this.breakOverlay.setStage(null, -1); // unbreakable (bedrock)
      return;
    }
    const breakTime = INSTANT_BREAK ? 0 : hardness;
    this.breakProgress += dt;
    if (breakTime <= 0 || this.breakProgress >= breakTime) {
      const c = this.target.cell;
      const broken = this.target.block;
      this.world.editBlock(c.x, c.y, c.z, Block.AIR);
      this.onBreak(broken, c.x, c.y, c.z);
      this.resetBreak();
      this.target = null; // re-acquired next updateAim
    } else {
      const stage = Math.min(BREAK_STAGES - 1, Math.floor((this.breakProgress / breakTime) * BREAK_STAGES));
      this.breakOverlay.setStage(this.target.cell, stage);
    }
  }

  // Right-click dispatch: a held edible is eaten (no aim target needed), anything
  // else falls through to placing a block.
  tryUse(): void {
    if (this.paused) return;
    const held = this.hotbar.selected();
    if (IS_EDIBLE[held]) {
      this.onEat(held);
      return;
    }
    this.tryPlace();
  }

  // On right-click: place the selected block in the adjacent empty cell.
  tryPlace(): void {
    if (this.paused || !this.target) return;
    const p = this.target.place;
    // Place into any non-solid cell (AIR or WATER) so you can build underwater;
    // a block replaces the water and the fluid sim reflows around it.
    if (IS_SOLID[this.world.getBlockWorld(p.x, p.y, p.z)]) return;
    if (this.intersectsPlayer(p.x, p.y, p.z)) return; // don't place inside yourself
    const type = this.hotbar.selected();
    this.world.editBlock(p.x, p.y, p.z, type);
    this.onPlace(type, p.x, p.y, p.z);
  }

  private resetBreak(): void {
    this.breakProgress = 0;
    this.breakOverlay.setStage(null, -1);
  }

  private intersectsPlayer(x: number, y: number, z: number): boolean {
    const b = this.player.currentAabb();
    return b.minX < x + 1 && b.maxX > x && b.minY < y + 1 && b.maxY > y && b.minZ < z + 1 && b.maxZ > z;
  }
}
