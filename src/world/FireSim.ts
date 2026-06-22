// Phase 15.2: living fire. Main-thread, no THREE. Owned by World (like FluidSim /
// LightEngine). A fire cell occupies an AIR block (rendered as a temporary FIRE block),
// flames for its life while spreading to + consuming flammable neighbours, then SMOLDERS
// (smoke only, no block) for a while and goes out. Cells are scheduled into a delayed
// queue; each fixed step the driver processes a capped number of due cells, so even a
// forest fire spreads its cost across ticks. Everything is bounded by MAX_FIRES +
// MAX_FIRE_OPS_PER_TICK + the tick delay + spread probability.
//
// Persistence: FIRE blocks are written with persist=false (they'd otherwise reload as
// permanent, un-ticked fire); consuming a flammable solid removes it permanently (AIR),
// so burned forests stay burned. Fire next to WATER is doused.

import {
  CY,
  FIXED_DT,
  FIRE_TICK_DELAY,
  MAX_FIRES,
  FIRE_SPREAD_CHANCE,
  FIRE_CONSUME_CHANCE,
  FIRE_SMOLDER_SECONDS,
  worldToChunk,
} from '../core/constants';
import { Block, IS_FLAMMABLE } from '../core/BlockTypes';
import type { World } from './World';

interface FireState {
  x: number;
  y: number;
  z: number;
  age: number; // seconds since ignition
  life: number; // seconds of flaming before smoldering
  flaming: boolean; // true = active flame (FIRE block present); false = smoldering smoke
}

const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export class FireSim {
  private readonly world: World;
  private readonly pending = new Map<string, number>(); // cellKey -> dueTick
  private readonly fires = new Map<string, FireState>();
  private tickCounter = 0;

  constructor(world: World) {
    this.world = world;
  }

  get count(): number {
    return this.fires.size;
  }

  private loaded(wx: number, wz: number): boolean {
    return !!this.world.getChunk(worldToChunk(wx), worldToChunk(wz));
  }

  // Light a fire in an AIR cell (places a temporary FIRE block). No-op if the cell isn't
  // air, the chunk isn't loaded, we're at the global cap, or it borders water.
  ignite(wx: number, wy: number, wz: number, life: number): void {
    if (wy < 0 || wy >= CY) return;
    if (this.fires.size >= MAX_FIRES) return;
    if (!this.loaded(wx, wz)) return;
    const key = `${wx},${wy},${wz}`;
    if (this.fires.has(key)) return;
    if (this.world.getBlockWorld(wx, wy, wz) !== Block.AIR) return;
    if (this.bordersWater(wx, wy, wz)) return;
    this.world.editBlock(wx, wy, wz, Block.FIRE, false); // temporary (not persisted)
    this.fires.set(key, { x: wx, y: wy, z: wz, age: 0, life, flaming: true });
    this.pending.set(key, this.tickCounter + FIRE_TICK_DELAY);
  }

  // Process up to maxOps fire cells whose delay has elapsed.
  tick(maxOps: number): void {
    this.tickCounter++;
    const ready: string[] = [];
    for (const [key, due] of this.pending) {
      if (due <= this.tickCounter) {
        ready.push(key);
        if (ready.length >= maxOps) break;
      }
    }
    for (const key of ready) {
      this.pending.delete(key);
      this.updateCell(key);
    }
  }

  private updateCell(key: string): void {
    const f = this.fires.get(key);
    if (!f) return;
    f.age += FIRE_TICK_DELAY * FIXED_DT;

    if (f.flaming) {
      // The FIRE block was removed out from under us (player mined it, water flowed in,
      // chunk unloaded) -> stop tracking it.
      if (this.world.getBlockWorld(f.x, f.y, f.z) !== Block.FIRE) {
        this.fires.delete(key);
        return;
      }
      // Water put it out.
      if (this.bordersWater(f.x, f.y, f.z)) {
        this.douse(f);
        this.fires.delete(key);
        return;
      }
      this.world.onFireSample(f.x + 0.5, f.y + 0.5, f.z + 0.5, true);
      this.spread(f);
      if (f.age >= f.life) {
        this.douse(f); // flames die: remove the block, keep smoldering (smoke only)
        f.flaming = false;
      }
      this.pending.set(key, this.tickCounter + FIRE_TICK_DELAY);
    } else {
      // Smoldering: emit smoke until the smolder window closes, then forget the cell.
      this.world.onFireSample(f.x + 0.5, f.y + 0.5, f.z + 0.5, false);
      if (f.age >= f.life + FIRE_SMOLDER_SECONDS) {
        this.fires.delete(key);
        return;
      }
      this.pending.set(key, this.tickCounter + FIRE_TICK_DELAY);
    }
  }

  // Consume flammable solids next to the flame (permanent) and spread into fuel-adjacent
  // air. The vacated air from a consumed block gets ignited a tick later by an adjacent
  // flame, so a blaze walks through a tree: log -> air -> fire -> ... Throttled by chance.
  private spread(f: FireState): void {
    for (const [dx, dy, dz] of DIRS) {
      const nx = f.x + dx;
      const ny = f.y + dy;
      const nz = f.z + dz;
      if (ny < 0 || ny >= CY) continue;
      const b = this.world.getBlockWorld(nx, ny, nz);
      if (IS_FLAMMABLE[b]) {
        if (Math.random() < FIRE_CONSUME_CHANCE) this.world.editBlock(nx, ny, nz, Block.AIR, true); // burn away (permanent)
      } else if (b === Block.AIR) {
        if (
          this.fires.size < MAX_FIRES &&
          Math.random() < FIRE_SPREAD_CHANCE &&
          this.bordersFuel(nx, ny, nz) &&
          !this.bordersWater(nx, ny, nz)
        ) {
          this.ignite(nx, ny, nz, f.life);
        }
      }
    }
  }

  private douse(f: FireState): void {
    if (this.world.getBlockWorld(f.x, f.y, f.z) === Block.FIRE) {
      this.world.editBlock(f.x, f.y, f.z, Block.AIR, false); // remove transient fire
    }
  }

  private bordersWater(wx: number, wy: number, wz: number): boolean {
    for (const [dx, dy, dz] of DIRS) {
      if (this.world.getBlockWorld(wx + dx, wy + dy, wz + dz) === Block.WATER) return true;
    }
    return false;
  }

  private bordersFuel(wx: number, wy: number, wz: number): boolean {
    for (const [dx, dy, dz] of DIRS) {
      if (IS_FLAMMABLE[this.world.getBlockWorld(wx + dx, wy + dy, wz + dz)]) return true;
    }
    return false;
  }
}
