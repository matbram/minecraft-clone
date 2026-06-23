// THREE-free structural interfaces the chunk meshers read, so the SAME meshing code
// runs both on the main thread (passed the real World/Chunk) and inside the meshing
// Web Worker (passed a lightweight view over the 9 shipped neighbour chunk arrays).
// The concrete World/Chunk satisfy these structurally — no changes needed there.

import type { Block } from '../core/BlockTypes';

export interface MeshChunk {
  readonly cx: number;
  readonly cz: number;
  maxY: number;
  getBlock(lx: number, y: number, lz: number): Block;
  getSky(i: number): number; // index = idx(lx,y,lz)
  getBlockLight(i: number): number; // index = idx(lx,y,lz)
  getFluid(lx: number, y: number, lz: number): number;
  getBiome(lx: number, lz: number): number;
}

export interface MeshWorld {
  getChunk(cx: number, cz: number): MeshChunk | undefined;
}
