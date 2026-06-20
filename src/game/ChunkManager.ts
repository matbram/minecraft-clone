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
  worldToChunk,
} from '../core/constants';
import { Chunk } from '../core/Chunk';
import { World } from '../world/World';
import { chunkKey, parseKey } from '../world/chunkKey';
import { GenScheduler } from '../gen/GenScheduler';
import type { GenResponse } from '../gen/workerProtocol';
import { ChunkRenderer } from '../render/ChunkRenderer';
import { buildChunkMesh } from '../render/ChunkMesh';

const RENDER_RADIUS = RENDER_DISTANCE;
const GEN_RADIUS = RENDER_DISTANCE + 1;
const UNLOAD_RADIUS = GEN_RADIUS + UNLOAD_MARGIN;

export class ChunkManager {
  private readonly world: World;
  private readonly scheduler: GenScheduler;
  private readonly renderer: ChunkRenderer;

  private meshDirty = new Set<string>();
  private pcx = Number.NaN;
  private pcz = Number.NaN;

  constructor(world: World, scheduler: GenScheduler, renderer: ChunkRenderer) {
    this.world = world;
    this.scheduler = scheduler;
    this.renderer = renderer;

    this.scheduler.onChunk = (resp) => this.onChunk(resp);
    this.world.onDirty = (cx, cz) => this.meshDirty.add(chunkKey(cx, cz));
  }

  get loadedCount(): number {
    return this.world.chunks.size;
  }
  get meshQueueLength(): number {
    return this.meshDirty.size;
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
    this.processMeshQueue(MAX_MESH_PER_FRAME);
  }

  private refreshRings(): void {
    // Unload chunks well outside the ring.
    for (const key of [...this.world.chunks.keys()]) {
      const [cx, cz] = parseKey(key);
      const dx = cx - this.pcx;
      const dz = cz - this.pcz;
      if (dx * dx + dz * dz > UNLOAD_RADIUS * UNLOAD_RADIUS) {
        this.scheduler.cancel(cx, cz);
        this.renderer.removeChunk(cx, cz);
        this.world.removeChunk(cx, cz);
        this.meshDirty.delete(key);
      }
    }

    // Request missing chunks inside the generation ring (nearest first).
    for (let dz = -GEN_RADIUS; dz <= GEN_RADIUS; dz++) {
      for (let dx = -GEN_RADIUS; dx <= GEN_RADIUS; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > GEN_RADIUS * GEN_RADIUS) continue;
        const cx = this.pcx + dx;
        const cz = this.pcz + dz;
        if (!this.world.getChunk(cx, cz) && !this.scheduler.isRequested(cx, cz)) {
          this.scheduler.request(cx, cz, d2);
        }
      }
    }

    // Ensure loaded-but-unrendered chunks within render radius get (re)meshed.
    for (let dz = -RENDER_RADIUS; dz <= RENDER_RADIUS; dz++) {
      for (let dx = -RENDER_RADIUS; dx <= RENDER_RADIUS; dx++) {
        if (dx * dx + dz * dz > RENDER_RADIUS * RENDER_RADIUS) continue;
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
    const chunk = new Chunk(resp.cx, resp.cz, data, heightMap, resp.maxY);

    this.world.addChunk(chunk);
    this.world.applyEdits(chunk); // 1. player deltas win over generation
    this.world.drainPending(chunk); // 2. features other chunks queued into this one
    this.world.placeFeatures(chunk, resp.features); // 3. this chunk's features (spill -> pending/neighbor)

    chunk.dirty = true;
    if (this.withinRender(resp.cx, resp.cz)) {
      this.meshDirty.add(chunkKey(resp.cx, resp.cz));
    }
    // Existing neighbors re-mesh their seams against the new chunk.
    this.world.markNeighbors(resp.cx, resp.cz);
  }

  private withinRender(cx: number, cz: number): boolean {
    const dx = cx - this.pcx;
    const dz = cz - this.pcz;
    return dx * dx + dz * dz <= RENDER_RADIUS * RENDER_RADIUS;
  }

  private neighborsReady(cx: number, cz: number): boolean {
    return (
      !!this.world.getChunk(cx + 1, cz) &&
      !!this.world.getChunk(cx - 1, cz) &&
      !!this.world.getChunk(cx, cz + 1) &&
      !!this.world.getChunk(cx, cz - 1)
    );
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
