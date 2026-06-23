// Chunk-meshing worker (Phase 18.1). Reconstructs real Chunk objects from the shipped
// neighbour arrays and runs the SAME buildChunkMesh / buildWaterMesh as the main thread
// (so output is byte-identical), then transfers the mesh typed arrays back. THREE-free:
// the mesh import graph is pure data + math (see Phase 18.1a/b).

import { Chunk } from '../core/Chunk';
import { Tunables } from '../core/tunables';
import { chunkKey } from '../world/chunkKey';
import { buildChunkMesh, type MeshArrays } from '../render/ChunkMesh';
import { buildWaterMesh, type WaterMeshArrays } from '../render/water/WaterSurfaceMesh';
import type { MeshWorld } from '../render/meshWorld';
import type { MeshRequest, MeshResponse } from './meshProtocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

// The mesh arrays are always plain (non-shared) -> their .buffer is a real ArrayBuffer.
function pushMesh(into: ArrayBuffer[], m: MeshArrays | null): void {
  if (!m) return;
  for (const a of [m.positions, m.normals, m.light, m.uvs, m.wave, m.tint, m.indices]) {
    into.push(a.buffer as ArrayBuffer);
  }
}
function pushWater(into: ArrayBuffer[], m: WaterMeshArrays | null): void {
  if (!m) return;
  for (const a of [m.positions, m.flow, m.light, m.edge, m.depth, m.indices]) {
    into.push(a.buffer as ArrayBuffer);
  }
}

ctx.onmessage = (e: MessageEvent<MeshRequest>) => {
  const req = e.data;
  Tunables.waterAbsorb = req.waterAbsorb; // the only Tunable meshing reads

  const map = new Map<string, Chunk>();
  for (const c of req.chunks) {
    // heightMap is unused by meshing -> let the ctor default it (zeroed).
    map.set(chunkKey(c.cx, c.cz), new Chunk(c.cx, c.cz, c.data, undefined, c.maxY, c.light, c.fluid, c.biome));
  }
  const world: MeshWorld = { getChunk: (cx, cz) => map.get(chunkKey(cx, cz)) };

  let opaque: MeshArrays | null = null;
  let transparent: MeshArrays | null = null;
  if (req.kind === 'full') {
    const built = buildChunkMesh(world, req.cx, req.cz);
    opaque = built.opaque;
    transparent = built.transparent;
  }
  const water = buildWaterMesh(world, req.cx, req.cz);

  const transfer: ArrayBuffer[] = [];
  pushMesh(transfer, opaque);
  pushMesh(transfer, transparent);
  pushWater(transfer, water);

  const res: MeshResponse = { id: req.id, cx: req.cx, cz: req.cz, kind: req.kind, opaque, transparent, water };
  ctx.postMessage(res, transfer);
};
