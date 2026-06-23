// Phase 6: Minecraft-style flowing water. Main-thread, no THREE. Owned by World
// (like LightEngine). Cells are scheduled into a bucketed queue; each fixed step
// (20 TPS) the driver floods the due cells AND their cascade to equilibrium within
// that step (Phase 18.3 — instant fill), bounded by the per-tick op cap so a giant
// breach still spreads its cost across ticks instead of freezing the frame.
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
import { levelOf, isFalling, makeFluid } from '../core/fluid';
import { computeFlow } from './flow';
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
  // Phase 18.3: while draining a tick we re-enqueue cascade follow-ups into the CURRENT
  // bucket (delay 0) instead of the next one, so a fill/drain completes within a single
  // fixed step (instant) rather than advancing one ring per tick. Bounded by maxOps.
  private draining = false;

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
    // delay 0 while draining -> the follow-up is processed THIS tick (instant flood);
    // FLUID_TICK_DELAY for external enqueues (edits) -> picked up at the start of next tick.
    this.enqueueKey(`${wx},${wy},${wz}`, this.draining ? 0 : FLUID_TICK_DELAY);
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

  // Drain this tick's bucket AND every follow-up it cascades, so a fill/drain settles
  // within ONE fixed step (instant) — not one ring per tick. updateCell's enqueues land
  // back in this bucket (delay 0 while draining) and the while-loop keeps draining until
  // equilibrium or the op cap. Overflow defers to the next tick, so a giant breach still
  // spreads its cost across ticks (never freezes the frame).
  tick(maxOps: number): void {
    this.tickCounter++;
    const b = this.tickCounter % FLUID_BUCKETS;
    let ops = 0;
    this.draining = true;
    while (this.buckets[b].length > 0 && ops < maxOps) {
      const list = this.buckets[b];
      this.buckets[b] = []; // swap out; cascade enqueues refill it for the next pass
      for (const key of list) {
        this.queued.delete(key);
        if (ops < maxOps) {
          const c = key.split(',');
          this.updateCell(+c[0], +c[1], +c[2]);
          ops++;
        } else {
          this.enqueueKey(key, 1); // overflow -> next tick (explicit delay, not draining)
        }
      }
    }
    this.draining = false;
  }

  // Phase 16/18: horizontal flow direction at a cell = downhill gradient of the water
  // surface (toward lower water / open air). ~0 in a still pool or a flat ocean. Used to
  // push the player along a current. Delegates to the shared pure helper (also used by the
  // meshing worker) via bound samplers (allocated once — flowAt runs every physics tick).
  flowAt(wx: number, wy: number, wz: number, out: { x: number; z: number }): void {
    computeFlow(this.blockSampler, this.fluidSampler, wx, wy, wz, out);
  }

  private readonly blockSampler = (wx: number, wy: number, wz: number): Block =>
    this.world.getBlockWorld(wx, wy, wz);
  private readonly fluidSampler = (wx: number, wy: number, wz: number): number =>
    this.world.getFluidWorld(wx, wy, wz);

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
