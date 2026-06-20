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

  constructor(seed: number) {
    this.seed = seed;
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

  // --- player edits (Phase 1 interaction goes through here) ----------------

  editBlock(wx: number, wy: number, wz: number, type: Block): void {
    if (wy < 0 || wy >= CY) return;
    const cx = worldToChunk(wx);
    const cz = worldToChunk(wz);
    const lx = mod(wx, CX);
    const lz = mod(wz, CZ);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return;

    chunk.setBlock(lx, wy, lz, type);

    const key = chunkKey(cx, cz);
    let m = this.edits.get(key);
    if (!m) {
      m = new Map();
      this.edits.set(key, m);
    }
    m.set(idx(lx, wy, lz), type);

    this.queueLightUpdate(wx, wy, wz); // Phase 3 hook (no-op for now)
    this.markDirtyAround(cx, cz, lx, lz);
  }

  // Phase 3 hook: incremental light updates. No-op in Phase 0.
  queueLightUpdate(_wx: number, _wy: number, _wz: number): void {
    /* intentionally empty until Phase 3 */
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
