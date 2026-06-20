// Main-thread authority over world state. No THREE import.
//
// Owns the loaded chunk map, the player edit deltas, and the cross-chunk
// pending-feature queue. Persistence stores ONLY (seed + edits): the world is
// deterministic, so a reload regenerates from the seed and replays edits.

import { CX, CZ, CY, COLS, idx, mod, worldToChunk } from '../core/constants';
import { Block } from '../core/BlockTypes';
import { Chunk } from '../core/Chunk';
import { templateFor, type FeatureDecision } from '../core/features';
import { chunkKey } from './chunkKey';
import { LightEngine } from './LightEngine';
import { FluidSim } from './FluidSim';

interface PendingBlock {
  lx: number;
  y: number;
  lz: number;
  type: Block;
}

const SAVE_KEY = 'mc_world_v1';

export class World {
  readonly seed: number;
  chunks = new Map<string, Chunk>();
  edits = new Map<string, Map<number, Block>>(); // chunkKey -> (blockIndex -> blockType)
  pending = new Map<string, PendingBlock[]>(); // chunkKey -> blocks queued INTO it

  // Set by ChunkManager: notified whenever a (loaded) chunk needs re-meshing.
  onDirty: (cx: number, cz: number) => void = () => {};

  private readonly lightEngine = new LightEngine(this);
  private readonly fluidSim = new FluidSim(this);

  constructor(seed: number) {
    this.seed = seed;
  }

  // Compute light for a freshly generated chunk (sets chunk.lit, marks dirty).
  lightChunk(chunk: Chunk): void {
    this.lightEngine.initChunkLight(chunk);
  }

  getChunkKey = chunkKey;

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  addChunk(chunk: Chunk): void {
    this.chunks.set(chunkKey(chunk.cx, chunk.cz), chunk);
  }

  removeChunk(cx: number, cz: number): void {
    this.chunks.delete(chunkKey(cx, cz));
  }

  getBlockWorld(wx: number, wy: number, wz: number): Block {
    if (wy < 0 || wy >= CY) return Block.AIR;
    const chunk = this.getChunk(worldToChunk(wx), worldToChunk(wz));
    if (!chunk) return Block.AIR;
    return chunk.getBlock(mod(wx, CX), wy, mod(wz, CZ));
  }

  // Effective baked-light brightness 0..1 at a cell, for tinting world FX (dropped
  // items, particles, motes) so they don't glow in the dark: max(blockLight,
  // skyLight * skyMul). No fake floor — pitch black where there's no real light.
  brightnessAt(wx: number, wy: number, wz: number, skyMul: number): number {
    if (wy >= CY) return skyMul; // open sky above the world
    if (wy < 0) return 0;
    const chunk = this.getChunk(worldToChunk(wx), worldToChunk(wz));
    if (!chunk) return 0;
    const i = idx(mod(wx, CX), wy, mod(wz, CZ));
    const sky = chunk.getSky(i) / 15;
    const block = chunk.getBlockLight(i) / 15;
    return Math.max(block, sky * skyMul);
  }

  // Phase 11.2: blocks of water directly above (and including) a cell, up to the
  // first non-water = how deep the eye sits below its LOCAL water surface. Drives
  // underwater darkening/color from the real column, not absolute depth below sea
  // level (so a shallow pond deep underground reads shallow). Capped for cost.
  waterDepthAbove(wx: number, wy: number, wz: number, cap = 30): number {
    let n = 0;
    for (let y = wy; y < CY && n < cap; y++) {
      if (this.getBlockWorld(wx, y, wz) !== Block.WATER) break;
      n++;
    }
    return n;
  }

  getFluidWorld(wx: number, wy: number, wz: number): number {
    if (wy < 0 || wy >= CY) return 0;
    const chunk = this.getChunk(worldToChunk(wx), worldToChunk(wz));
    if (!chunk) return 0;
    return chunk.getFluid(mod(wx, CX), wy, mod(wz, CZ));
  }

  // --- flowing water (Phase 6) ---------------------------------------------

  // Write a (block, fluid) pair from the simulation. Skips the light BFS (AIR and
  // WATER are both transparent non-emitters, so air<->water never changes light)
  // and only remeshes when the rendered cell actually changed (the equilibrium
  // no-op guard that prevents an endless remesh storm). NOT persisted.
  setFluidBlock(wx: number, wy: number, wz: number, block: Block, fluid: number): boolean {
    if (wy < 0 || wy >= CY) return false;
    const cx = worldToChunk(wx);
    const cz = worldToChunk(wz);
    const lx = mod(wx, CX);
    const lz = mod(wz, CZ);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return false;
    const newFluid = block === Block.WATER ? fluid : 0;
    if (chunk.getBlock(lx, wy, lz) === block && chunk.getFluid(lx, wy, lz) === newFluid) return false;
    chunk.setBlock(lx, wy, lz, block);
    chunk.setFluid(lx, wy, lz, newFluid);
    this.markDirtyAround(cx, cz, lx, lz);
    return true;
  }

  tickFluids(maxOps: number): void {
    this.fluidSim.tick(maxOps);
  }

  // After a chunk's persisted edits are replayed, re-derive its fluid state: water
  // cells recompute their true level (flowing reloads as a source-level 0 until
  // re-simulated) or drain, and dug-out AIR cells let neighboring water flow back
  // in. Worldgen-only chunks (no edits) need nothing — they're at equilibrium.
  rehydrateFluids(chunk: Chunk): void {
    const m = this.edits.get(chunkKey(chunk.cx, chunk.cz));
    if (!m) return;
    const baseX = chunk.cx * CX;
    const baseZ = chunk.cz * CZ;
    for (const blockIndex of m.keys()) {
      const y = Math.floor(blockIndex / COLS);
      const rem = blockIndex % COLS;
      const lz = Math.floor(rem / CX);
      const lx = rem % CX;
      this.fluidSim.enqueueAround(baseX + lx, y, baseZ + lz);
    }
  }

  // --- player edits (Phase 1 interaction goes through here) ----------------

  editBlock(wx: number, wy: number, wz: number, type: Block): void {
    if (wy < 0 || wy >= CY) return;
    const cx = worldToChunk(wx);
    const cz = worldToChunk(wz);
    const lx = mod(wx, CX);
    const lz = mod(wz, CZ);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return;

    const oldB = chunk.getBlock(lx, wy, lz); // capture BEFORE the change for lighting
    chunk.setBlock(lx, wy, lz, type);
    if (type === Block.WATER) chunk.setFluid(lx, wy, lz, 0); // player-placed water is a source

    const key = chunkKey(cx, cz);
    let m = this.edits.get(key);
    if (!m) {
      m = new Map();
      this.edits.set(key, m);
    }
    m.set(idx(lx, wy, lz), type);

    this.queueLightUpdate(wx, wy, wz, oldB, type);
    this.markDirtyAround(cx, cz, lx, lz);
    // Let water flow into / around the change (bounded; most cells resolve to no-ops).
    this.fluidSim.enqueueAround(wx, wy, wz);
  }

  // Incremental light update on a block edit (remove + add for sky and block).
  queueLightUpdate(wx: number, wy: number, wz: number, oldB: Block, newB: Block): void {
    this.lightEngine.onBlockChange(wx, wy, wz, oldB, newB);
  }

  // --- finalize helpers (run when a freshly generated chunk arrives) -------

  // Replay persisted player edits onto a newly generated chunk.
  applyEdits(chunk: Chunk): void {
    const m = this.edits.get(chunkKey(chunk.cx, chunk.cz));
    if (!m) return;
    for (const [blockIndex, type] of m) {
      const y = Math.floor(blockIndex / COLS);
      const rem = blockIndex % COLS;
      const lz = Math.floor(rem / CX);
      const lx = rem % CX;
      chunk.setBlock(lx, y, lz, type);
    }
  }

  // Apply blocks other chunks queued INTO this chunk, then clear its queue.
  drainPending(chunk: Chunk): void {
    const key = chunkKey(chunk.cx, chunk.cz);
    const list = this.pending.get(key);
    if (!list) return;
    for (const p of list) {
      if (chunk.getBlock(p.lx, p.y, p.lz) === Block.AIR) {
        chunk.setBlock(p.lx, p.y, p.lz, p.type);
      }
    }
    this.pending.delete(key);
  }

  private queuePending(cx: number, cz: number, lx: number, y: number, lz: number, type: Block): void {
    const key = chunkKey(cx, cz);
    let list = this.pending.get(key);
    if (!list) {
      list = [];
      this.pending.set(key, list);
    }
    list.push({ lx, y, lz, type });
  }

  // Expand each feature decision into block writes. In-chunk blocks are written
  // directly; blocks spilling into a neighbor are written if it's loaded
  // (marking it dirty) or queued into pending if it isn't.
  placeFeatures(chunk: Chunk, decisions: FeatureDecision[]): void {
    const dirtyNeighbors = new Set<string>();

    for (const d of decisions) {
      const tpl = templateFor(d);
      for (const off of tpl.blocks) {
        const wx = d.wx + off.dx;
        const wy = d.wy + off.dy;
        const wz = d.wz + off.dz;
        if (wy < 0 || wy >= CY) continue;

        const tcx = worldToChunk(wx);
        const tcz = worldToChunk(wz);
        const lx = mod(wx, CX);
        const lz = mod(wz, CZ);

        if (tcx === chunk.cx && tcz === chunk.cz) {
          if (chunk.getBlock(lx, wy, lz) === Block.AIR) chunk.setBlock(lx, wy, lz, off.type);
          continue;
        }

        const neighbor = this.getChunk(tcx, tcz);
        if (neighbor) {
          if (neighbor.getBlock(lx, wy, lz) === Block.AIR) {
            neighbor.setBlock(lx, wy, lz, off.type);
            dirtyNeighbors.add(chunkKey(tcx, tcz));
          }
        } else {
          this.queuePending(tcx, tcz, lx, wy, lz, off.type);
        }
      }
    }

    for (const key of dirtyNeighbors) {
      const c = this.chunks.get(key);
      if (c) {
        c.dirty = true;
        this.onDirty(c.cx, c.cz);
      }
    }
  }

  // --- dirty marking -------------------------------------------------------

  markDirty(cx: number, cz: number): void {
    const c = this.getChunk(cx, cz);
    if (c) {
      c.dirty = true;
      this.onDirty(cx, cz);
    }
  }

  // Mark a chunk and any neighbor it could affect at a seam (edge-aware).
  markDirtyAround(cx: number, cz: number, lx: number, lz: number): void {
    this.markDirty(cx, cz);
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CX - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CZ - 1) this.markDirty(cx, cz + 1);
  }

  // Requeue the 4 edge neighbors of a chunk (used after a new chunk loads so
  // existing neighbors re-mesh their seams against it).
  markNeighbors(cx: number, cz: number): void {
    this.markDirty(cx - 1, cz);
    this.markDirty(cx + 1, cz);
    this.markDirty(cx, cz - 1);
    this.markDirty(cx, cz + 1);
  }

  // --- persistence ---------------------------------------------------------

  save(): void {
    const out: Record<string, [number, number][]> = {};
    for (const [k, m] of this.edits) {
      if (m.size > 0) out[k] = [...m.entries()];
    }
    const payload = { seed: this.seed, edits: out };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.warn('World.save failed', e);
    }
  }

  load(): void {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as { seed: number; edits: Record<string, [number, number][]> };
      // Only restore edits if the seed matches (otherwise edits map onto a
      // different world). For Phase 0 the seed is fixed so this always matches.
      if (data.seed !== this.seed) return;
      for (const [k, pairs] of Object.entries(data.edits)) {
        this.edits.set(k, new Map(pairs));
      }
    } catch (e) {
      console.warn('World.load failed', e);
    }
  }
}
