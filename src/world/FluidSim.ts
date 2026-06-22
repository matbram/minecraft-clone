// Phase 6: Minecraft-style flowing water. Main-thread, no THREE. Owned by World
// (like LightEngine). Cells are scheduled into a delayed queue; each fixed step
// (20 TPS) the driver processes a capped number of due cells. Each cell update is
// O(1) and ENQUEUES follow-ups rather than recursing, so a flow naturally spreads
// its cost across ticks and respects the per-tick op cap.
//
// Rules (per cell):
//  - AIR with water above -> becomes FALLING water (full height).
//  - AIR fed horizontally   -> flowing water at min(neighbor level)+1, or a new
//                              SOURCE if >=2 source neighbors AND solid below.
//  - WATER source           -> never drains itself; keeps feeding neighbors.
//  - WATER flowing/falling  -> recompute level from neighbors; DRAIN to air if it
//                              has no feeder (and isn't fed from above).
// Water prefers to fall: it only spreads horizontally when it can't go down.

import { CY, worldToChunk, FLUID_MAX_LEVEL, FLUID_TICK_DELAY, FLUID_BUCKETS } from '../core/constants';
import { Block, IS_SOLID } from '../core/BlockTypes';
import { levelOf, isFalling, makeFluid, fluidSurfaceHeight } from '../core/fluid';
import type { World } from './World';

export class FluidSim {
  private readonly world: World;
  // Phase 16: bucketed due-tick scheduler — a ring of FLUID_BUCKETS cell lists indexed by
  // (dueTick % FLUID_BUCKETS). enqueue is O(1) and each tick drains the current bucket (a
  // whole flow wave) up to maxOps, deferring overflow to the next tick. `queued` dedups so a
  // cell sits in at most one bucket. updateCell is idempotent + the setFluidBlock "changed"
  // guard means re-processing is harmless (no remesh storm). Fast + smooth vs the old delay.
  private readonly buckets: string[][] = Array.from({ length: FLUID_BUCKETS }, () => []);
  private readonly queued = new Set<string>();
  private tickCounter = 0;

  constructor(world: World) {
    this.world = world;
  }

  private loaded(wx: number, wz: number): boolean {
    return !!this.world.getChunk(worldToChunk(wx), worldToChunk(wz));
  }

  private enqueueKey(key: string, delay: number): void {
    if (this.queued.has(key)) return;
    this.queued.add(key);
    this.buckets[(this.tickCounter + delay) % FLUID_BUCKETS].push(key);
  }

  enqueue(wx: number, wy: number, wz: number): void {
    if (wy < 0 || wy >= CY) return;
    if (!this.loaded(wx, wz)) return; // resumes when the chunk loads (rehydrate)
    this.enqueueKey(`${wx},${wy},${wz}`, FLUID_TICK_DELAY);
  }

  enqueueAround(wx: number, wy: number, wz: number): void {
    this.enqueue(wx, wy, wz);
    this.enqueue(wx + 1, wy, wz);
    this.enqueue(wx - 1, wy, wz);
    this.enqueue(wx, wy + 1, wz);
    this.enqueue(wx, wy - 1, wz);
    this.enqueue(wx, wy, wz + 1);
    this.enqueue(wx, wy, wz - 1);
  }

  // Drain this tick's bucket: process up to maxOps cells, defer the rest to next tick.
  tick(maxOps: number): void {
    this.tickCounter++;
    const b = this.tickCounter % FLUID_BUCKETS;
    const list = this.buckets[b];
    this.buckets[b] = []; // swap out so updateCell's new enqueues don't grow this list
    let ops = 0;
    for (const key of list) {
      this.queued.delete(key);
      if (ops < maxOps) {
        const c = key.split(',');
        this.updateCell(+c[0], +c[1], +c[2]);
        ops++;
      } else {
        this.enqueueKey(key, 1); // overflow -> next tick
      }
    }
  }

  // Phase 16: horizontal flow direction at a cell = downhill gradient of the water surface
  // height across the 4 neighbours (toward lower water / open air). ~0 in a still pool or a
  // flat ocean (all sources at height 1.0). Used to push the player along a current.
  flowAt(wx: number, wy: number, wz: number, out: { x: number; z: number }): void {
    out.x = 0;
    out.z = 0;
    if (this.world.getBlockWorld(wx, wy, wz) !== Block.WATER) return;
    const h = this.surfaceHeightAt(wx, wy, wz);
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dz] of dirs) {
      const nb = this.world.getBlockWorld(wx + dx, wy, wz + dz);
      if (nb !== Block.AIR && nb !== Block.WATER) continue; // wall: no flow that way
      const nh = nb === Block.AIR ? 0 : this.surfaceHeightAt(wx + dx, wy, wz + dz);
      const drop = h - nh;
      if (drop > 0) {
        out.x += dx * drop;
        out.z += dz * drop;
      }
    }
    const len = Math.hypot(out.x, out.z);
    if (len > 1e-4) {
      out.x /= len;
      out.z /= len;
    } else {
      out.x = 0;
      out.z = 0;
    }
  }

  private surfaceHeightAt(wx: number, wy: number, wz: number): number {
    const above = this.world.getBlockWorld(wx, wy + 1, wz) === Block.WATER;
    return fluidSurfaceHeight(Block.WATER, this.world.getFluidWorld(wx, wy, wz), above);
  }

  // Min incoming level (neighbor level + 1) over horizontal water neighbors, and
  // the count of horizontal SOURCE neighbors. lmin > FLUID_MAX_LEVEL => no feeder.
  private horizontalFeed(wx: number, wy: number, wz: number): { lmin: number; sources: number } {
    let lmin = Infinity;
    let sources = 0;
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dz] of dirs) {
      const nx = wx + dx;
      const nz = wz + dz;
      if (this.world.getBlockWorld(nx, wy, nz) !== Block.WATER) continue;
      const nf = this.world.getFluidWorld(nx, wy, nz);
      const nlvl = isFalling(nf) ? 0 : levelOf(nf);
      if (nlvl + 1 < lmin) lmin = nlvl + 1;
      if (nf === 0) sources++; // fluid byte 0 == source (level 0, not falling)
    }
    return { lmin, sources };
  }

  private solidBelow(wx: number, wy: number, wz: number): boolean {
    return IS_SOLID[this.world.getBlockWorld(wx, wy - 1, wz)] !== 0;
  }

  // Re-examine WATER neighbors (relevel / drain propagation). Called only when a
  // cell actually changed, so stable cells never reschedule (no equilibrium loop).
  private enqueueWaterNeighbors(wx: number, wy: number, wz: number): void {
    if (this.world.getBlockWorld(wx + 1, wy, wz) === Block.WATER) this.enqueue(wx + 1, wy, wz);
    if (this.world.getBlockWorld(wx - 1, wy, wz) === Block.WATER) this.enqueue(wx - 1, wy, wz);
    if (this.world.getBlockWorld(wx, wy, wz + 1) === Block.WATER) this.enqueue(wx, wy, wz + 1);
    if (this.world.getBlockWorld(wx, wy, wz - 1) === Block.WATER) this.enqueue(wx, wy, wz - 1);
    if (this.world.getBlockWorld(wx, wy + 1, wz) === Block.WATER) this.enqueue(wx, wy + 1, wz);
    if (this.world.getBlockWorld(wx, wy - 1, wz) === Block.WATER) this.enqueue(wx, wy - 1, wz);
  }

  // Fill AIR cells this water can reach: prefer falling (don't spread sideways
  // while the column can still descend), else spread horizontally into air. Only
  // AIR targets are enqueued, so re-running this on a settled cell with no open
  // air is a no-op (terminates).
  private spreadIntoAir(wx: number, wy: number, wz: number, level: number): void {
    const belowB = this.world.getBlockWorld(wx, wy - 1, wz);
    if (wy - 1 >= 0 && belowB === Block.AIR) {
      this.enqueue(wx, wy - 1, wz); // falls; no sideways spread while descending
      return;
    }
    if (belowB === Block.WATER && isFalling(this.world.getFluidWorld(wx, wy - 1, wz))) {
      return; // a falling column is still going down -> don't spread its sides
    }
    if (level < FLUID_MAX_LEVEL) {
      if (this.world.getBlockWorld(wx + 1, wy, wz) === Block.AIR) this.enqueue(wx + 1, wy, wz);
      if (this.world.getBlockWorld(wx - 1, wy, wz) === Block.AIR) this.enqueue(wx - 1, wy, wz);
      if (this.world.getBlockWorld(wx, wy, wz + 1) === Block.AIR) this.enqueue(wx, wy, wz + 1);
      if (this.world.getBlockWorld(wx, wy, wz - 1) === Block.AIR) this.enqueue(wx, wy, wz - 1);
    }
  }

  private updateCell(wx: number, wy: number, wz: number): void {
    if (!this.loaded(wx, wz)) return;
    const here = this.world.getBlockWorld(wx, wy, wz);
    const waterAbove = this.world.getBlockWorld(wx, wy + 1, wz) === Block.WATER;

    // Determine the cell's target water state (or null = should be air).
    let target: number | null; // fluid byte, or null to mean "no water here"
    if (waterAbove) {
      target = makeFluid(0, true); // fed from above -> falling, full height
    } else {
      const { lmin, sources } = this.horizontalFeed(wx, wy, wz);
      if (sources >= 2 && this.solidBelow(wx, wy, wz)) {
        target = makeFluid(0, false); // infinite-source rule
      } else if (lmin <= FLUID_MAX_LEVEL) {
        target = makeFluid(lmin, false); // flowing, fed horizontally
      } else {
        target = null; // unsupported
      }
    }

    // A SOURCE here is permanent (worldgen lakes, player-placed); only an explicit
    // edit removes it. Keep it a source regardless of the pull result.
    if (here === Block.WATER && this.world.getFluidWorld(wx, wy, wz) === 0) {
      this.spreadIntoAir(wx, wy, wz, 0); // keep feeding open air
      return;
    }

    if (target === null) {
      if (here === Block.WATER) {
        this.world.setFluidBlock(wx, wy, wz, Block.AIR, 0); // drain
        this.enqueueAround(wx, wy, wz); // neighbors recompute / refill
      }
      return; // air staying air: schedule nothing
    }

    // Phase 15.8: water flowing into a TORCH cell extinguishes/destroys it (Minecraft),
    // then fills the cell. FLARE survives water (treated as solid below), so it lights
    // underwater. editBlock removes the torch from the registry + relights.
    if (here === Block.TORCH) {
      this.world.editBlock(wx, wy, wz, Block.AIR);
    } else if (here !== Block.AIR && here !== Block.WATER) {
      return; // solid (incl. FLARE): don't replace
    }

    const changed = this.world.setFluidBlock(wx, wy, wz, Block.WATER, target);
    this.spreadIntoAir(wx, wy, wz, levelOf(target)); // fill reachable air (prefer down)
    if (changed) this.enqueueWaterNeighbors(wx, wy, wz); // relevel/drain propagation
  }
}
