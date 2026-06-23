// Message protocol for the chunk-meshing worker pool (Phase 18.1). The target chunk
// plus its present neighbours are sent as Uint8Arrays via STRUCTURED CLONE (no transfer
// list) so the live main-thread chunk arrays are copied, not detached. The worker returns
// the finished mesh typed arrays TRANSFERRED back (zero-copy).

import type { MeshArrays } from '../render/ChunkMesh';
import type { WaterMeshArrays } from '../render/water/WaterSurfaceMesh';

export type MeshKind = 'full' | 'water'; // full = opaque+transparent+water; water = water only

// One chunk's data for the worker. data/light/fluid are required (face cull + seam
// light/water). maxY + biome are only meaningful for the target chunk (loop bound + tint).
export interface MeshChunkData {
  cx: number;
  cz: number;
  data: Uint8Array;
  light: Uint8Array;
  fluid: Uint8Array;
  maxY: number;
  biome?: Uint8Array;
}

export interface MeshRequest {
  id: number;
  cx: number;
  cz: number;
  kind: MeshKind;
  waterAbsorb: number; // Tunables.waterAbsorb snapshot at dispatch (the only Tunable meshing reads)
  chunks: MeshChunkData[]; // target + present neighbours (up to 9)
}

export interface MeshResponse {
  id: number;
  cx: number;
  cz: number;
  kind: MeshKind;
  opaque: MeshArrays | null; // null for water-only jobs
  transparent: MeshArrays | null;
  water: WaterMeshArrays | null;
}
