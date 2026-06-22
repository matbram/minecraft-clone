// Orchestrates chunk streaming: maintains the load ring around the player,
// drives throttled off-thread generation, finalizes arriving chunks, and meshes
// a capped number of chunks per frame.
//
// Generates a ring of radius R+1 but only MESHES within radius R, so every
// rendered chunk has its 4 edge neighbors available for correct seam culling.

import * as THREE from 'three';
import {
  RENDER_DISTANCE,
  UNLOAD_MARGIN,
  MAX_GEN_PER_FRAME,
  MAX_MESH_PER_FRAME,
  MAX_LIGHT_PER_FRAME,
  worldToChunk,
} from '../core/constants';
import { Chunk } from '../core/Chunk';
import { World } from '../world/World';
import { chunkKey, parseKey } from '../world/chunkKey';
import { GenScheduler } from '../gen/GenScheduler';
import type { GenResponse } from '../gen/workerProtocol';
import { ChunkRenderer } from '../render/ChunkRenderer';
import { buildChunkMesh } from '../render/ChunkMesh';

export class ChunkManager {
  private readonly world: World;
  private readonly scheduler: GenScheduler;
  private readonly renderer: ChunkRenderer;

  // Render distance is runtime-adjustable (quality presets). Generation ring is
  // one chunk wider so every rendered chunk has neighbors for seams + lighting.
  private renderRadius = RENDER_DISTANCE;
  private get genRadius(): number {
    return this.renderRadius + 1;
  }
  private get unloadRadius(): number {
    return this.genRadius + UNLOAD_MARGIN;
  }

  private meshDirty = new Set<string>();
  private lightDirty = new Set<string>(); // chunks whose light needs computing
  private pcx = Number.NaN;
  private pcz = Number.NaN;

  constructor(world: World, scheduler: GenScheduler, renderer: ChunkRenderer) {
    this.world = world;
    this.scheduler = scheduler;
    this.renderer = renderer;

    this.scheduler.onChunk = (resp) => this.onChunk(resp);
    this.world.onDirty = (cx, cz) => this.meshDirty.add(chunkKey(cx, cz));
    // Phase 15.1: bulk edits (explosion craters) ask for a full relight + remesh per chunk.
    this.world.onRelight = (cx, cz) => this.queueRelight(cx, cz);
  }

  // Drop a chunk's baked light and queue it for relight + remesh (spread over frames by
  // the throttled queues). Used by World.bulkEdit so a huge crater never freezes the page.
  private queueRelight(cx: number, cz: number): void {
    const chunk = this.world.getChunk(cx, cz);
    if (!chunk) return;
    chunk.clearLight();
    chunk.dirty = true;
    this.lightDirty.add(chunkKey(cx, cz));
    this.meshDirty.add(chunkKey(cx, cz));
  }

  get loadedCount(): number {
    return this.world.chunks.size;
  }
  get meshQueueLength(): number {
    return this.meshDirty.size;
  }
  get lightQueueLength(): number {
    return this.lightDirty.size;
  }

  // Quality presets call this; forcing pcx/pcz to NaN re-runs refreshRings,
  // which loads/unloads chunks to match the new ring radius.
  setRenderDistance(r: number): void {
    if (r === this.renderRadius) return;
    this.renderRadius = r;
    this.pcx = Number.NaN;
    this.pcz = Number.NaN;
  }

  // Phase 11.3 tuning: a knob that feeds the MESH bake (e.g. water depth-darkening)
  // changed — rebuild every loaded chunk's geometry through the throttled queue.
  remeshAll(): void {
    for (const chunk of this.world.chunks.values()) {
      chunk.dirty = true;
      this.meshDirty.add(chunkKey(chunk.cx, chunk.cz));
    }
  }

  // Phase 11.3 tuning: a knob that feeds the LIGHT BFS (cave darkness) changed —
  // drop all baked light and recompute + remesh every loaded chunk via the queues.
  rebuildLighting(): void {
    for (const chunk of this.world.chunks.values()) {
      chunk.clearLight();
      chunk.dirty = true;
      this.lightDirty.add(chunkKey(chunk.cx, chunk.cz));
      this.meshDirty.add(chunkKey(chunk.cx, chunk.cz));
    }
  }

  update(_dt: number, playerPos: THREE.Vector3): void {
    const cx = worldToChunk(playerPos.x);
    const cz = worldToChunk(playerPos.z);
    if (cx !== this.pcx || cz !== this.pcz) {
      this.pcx = cx;
      this.pcz = cz;
      this.refreshRings();
    }

    this.scheduler.pump(MAX_GEN_PER_FRAME);
    this.processLightQueue(MAX_LIGHT_PER_FRAME); // light BEFORE meshing
    this.processMeshQueue(MAX_MESH_PER_FRAME);
  }

  private refreshRings(): void {
    // Unload chunks well outside the ring.
    for (const key of [...this.world.chunks.keys()]) {
      const [cx, cz] = parseKey(key);
      const dx = cx - this.pcx;
      const dz = cz - this.pcz;
      if (dx * dx + dz * dz > this.unloadRadius * this.unloadRadius) {
        this.scheduler.cancel(cx, cz);
        this.renderer.removeChunk(cx, cz);
        this.world.removeChunk(cx, cz);
        this.meshDirty.delete(key);
      }
    }

    // Request missing chunks inside the generation ring (nearest first).
    for (let dz = -this.genRadius; dz <= this.genRadius; dz++) {
      for (let dx = -this.genRadius; dx <= this.genRadius; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > this.genRadius * this.genRadius) continue;
        const cx = this.pcx + dx;
        const cz = this.pcz + dz;
        const existing = this.world.getChunk(cx, cz);
        if (!existing && !this.scheduler.isRequested(cx, cz)) {
          this.scheduler.request(cx, cz, d2);
        } else if (existing && !existing.lit) {
          this.lightDirty.add(chunkKey(cx, cz)); // safety net: ensure it gets lit
        }
      }
    }

    // Ensure loaded-but-unrendered chunks within render radius get (re)meshed.
    for (let dz = -this.renderRadius; dz <= this.renderRadius; dz++) {
      for (let dx = -this.renderRadius; dx <= this.renderRadius; dx++) {
        if (dx * dx + dz * dz > this.renderRadius * this.renderRadius) continue;
        const cx = this.pcx + dx;
        const cz = this.pcz + dz;
        const chunk = this.world.getChunk(cx, cz);
        if (chunk && (chunk.dirty || !this.renderer.has(cx, cz))) {
          this.meshDirty.add(chunkKey(cx, cz));
        }
      }
    }
  }

  private onChunk(resp: GenResponse): void {
    const data = new Uint8Array(resp.data);
    const heightMap = new Uint8Array(resp.heightMap);
    const biomeMap = new Uint8Array(resp.biomeMap);
    const chunk = new Chunk(resp.cx, resp.cz, data, heightMap, resp.maxY, undefined, undefined, biomeMap);

    this.world.addChunk(chunk);
    this.world.applyEdits(chunk); // 1. player deltas win over generation
    this.world.rehydrateFluids(chunk); // re-derive flow levels around replayed edits
    this.world.drainPending(chunk); // 2. features other chunks queued into this one
    this.world.placeFeatures(chunk, resp.features); // 3. this chunk's features (spill -> pending/neighbor)

    chunk.dirty = true;
    // Light every loaded chunk (gen-ring chunks must be lit so render-ring
    // neighbors can mesh). initChunkLight marks the chunk dirty -> meshing.
    this.lightDirty.add(chunkKey(resp.cx, resp.cz));
    // Existing neighbors re-mesh their seams against the new chunk's blocks.
    this.world.markNeighbors(resp.cx, resp.cz);
  }

  private withinRender(cx: number, cz: number): boolean {
    const dx = cx - this.pcx;
    const dz = cz - this.pcz;
    return dx * dx + dz * dz <= this.renderRadius * this.renderRadius;
  }

  private neighborsReady(cx: number, cz: number): boolean {
    return (
      !!this.world.getChunk(cx + 1, cz) &&
      !!this.world.getChunk(cx - 1, cz) &&
      !!this.world.getChunk(cx, cz + 1) &&
      !!this.world.getChunk(cx, cz - 1)
    );
  }

  // Smooth lighting samples neighbor light at borders, so a chunk only meshes
  // once it AND its 4 neighbors are lit.
  private neighborsLit(cx: number, cz: number): boolean {
    const a = this.world.getChunk(cx + 1, cz);
    const b = this.world.getChunk(cx - 1, cz);
    const c = this.world.getChunk(cx, cz + 1);
    const d = this.world.getChunk(cx, cz - 1);
    return !!a?.lit && !!b?.lit && !!c?.lit && !!d?.lit;
  }

  private processLightQueue(max: number): void {
    let done = 0;
    for (const key of [...this.lightDirty]) {
      if (done >= max) break;
      const [cx, cz] = parseKey(key);
      const chunk = this.world.getChunk(cx, cz);
      if (!chunk) {
        this.lightDirty.delete(key);
        continue;
      }
      if (chunk.lit) {
        this.lightDirty.delete(key);
        continue;
      }
      // No neighbor gate: initChunkLight seeds from whatever lit neighbors exist;
      // light from later-loaded neighbors floods back in when they are lit.
      this.world.lightChunk(chunk);
      this.lightDirty.delete(key);
      done++;
    }
  }

  private processMeshQueue(max: number): void {
    let built = 0;
    for (const key of [...this.meshDirty]) {
      if (built >= max) break;
      const [cx, cz] = parseKey(key);
      const chunk = this.world.getChunk(cx, cz);
      if (!chunk) {
        this.meshDirty.delete(key);
        continue;
      }
      if (!this.withinRender(cx, cz)) {
        this.meshDirty.delete(key);
        continue;
      }
      if (!this.neighborsReady(cx, cz)) {
        continue; // retry next frame once neighbors generate
      }
      if (!chunk.lit || !this.neighborsLit(cx, cz)) {
        continue; // wait until this chunk + neighbors are lit (smooth lighting)
      }
      if (!chunk.dirty && this.renderer.has(cx, cz)) {
        this.meshDirty.delete(key);
        continue;
      }
      const builtMesh = buildChunkMesh(this.world, cx, cz);
      this.renderer.setChunk(cx, cz, builtMesh);
      chunk.dirty = false;
      this.meshDirty.delete(key);
      built++;
    }
  }
}
