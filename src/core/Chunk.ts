// A 16 x 16 x 256 column of blocks plus a parallel light array and a height map.
//
// Worker-safe (no DOM / THREE). The worker fills `data`/`heightMap`/`maxY` and
// transfers them to the main thread; the main thread reconstructs a Chunk around
// those buffers.

import { BLOCKS, COLS, CX, CY, idx, colIdx } from './constants';
import { Block } from './BlockTypes';

export class Chunk {
  readonly cx: number;
  readonly cz: number;

  data: Uint8Array; // length BLOCKS, block id per cell
  // Packed light: high nibble = sky light (0..15), low nibble = block light (0..15).
  // Allocated now; flat-filled in Phase 0 (sky=15). Phase 3 replaces with a BFS.
  light: Uint8Array; // length BLOCKS
  heightMap: Uint8Array; // length COLS: 1 + topmost non-air y per column (0 if empty column)
  maxY: number; // chunk-wide topmost non-air y + 1 (mesh skip-empty bound)

  dirty = true; // needs (re)mesh

  constructor(
    cx: number,
    cz: number,
    data?: Uint8Array,
    heightMap?: Uint8Array,
    maxY?: number,
    light?: Uint8Array,
  ) {
    this.cx = cx;
    this.cz = cz;
    this.data = data ?? new Uint8Array(BLOCKS);
    this.heightMap = heightMap ?? new Uint8Array(COLS);
    this.maxY = maxY ?? 0;
    if (light) {
      this.light = light;
    } else {
      this.light = new Uint8Array(BLOCKS);
      // Phase 0: flat sky light so the baked-light vertex pipeline is exercised.
      this.light.fill(0xf0); // sky=15, block=0
    }
  }

  getBlock(lx: number, y: number, lz: number): Block {
    if (y < 0 || y >= CY) return Block.AIR;
    return this.data[idx(lx, y, lz)] as Block;
  }

  // Sets a block and keeps heightMap/maxY consistent.
  setBlock(lx: number, y: number, lz: number, b: Block): void {
    if (y < 0 || y >= CY) return;
    const i = idx(lx, y, lz);
    const prev = this.data[i];
    if (prev === b) return;
    this.data[i] = b;
    this.updateHeightOnChange(lx, y, lz, b);
  }

  // Fast path for generation: write without recomputing height each call.
  // Caller is responsible for calling recomputeHeights() afterward.
  setBlockRaw(lx: number, y: number, lz: number, b: Block): void {
    this.data[idx(lx, y, lz)] = b;
  }

  private updateHeightOnChange(lx: number, y: number, lz: number, b: Block): void {
    const c = colIdx(lx, lz);
    const topExclusive = this.heightMap[c]; // = highest non-air y + 1
    if (b !== Block.AIR) {
      if (y + 1 > topExclusive) {
        this.heightMap[c] = y + 1;
        if (y + 1 > this.maxY) this.maxY = y + 1;
      }
    } else if (y + 1 === topExclusive) {
      // We removed the current top of this column; scan downward for the new top.
      let ny = y - 1;
      while (ny >= 0 && this.getBlock(lx, ny, lz) === Block.AIR) ny--;
      this.heightMap[c] = ny + 1;
      // maxY may now be stale (too high) but staying high only costs a little extra
      // meshing work, never correctness. We recompute it lazily if needed.
    }
  }

  // Recompute heightMap + maxY from scratch (used after bulk generation).
  recomputeHeights(): void {
    let maxY = 0;
    for (let lz = 0; lz < CX; lz++) {
      for (let lx = 0; lx < CX; lx++) {
        const c = colIdx(lx, lz);
        let top = 0;
        for (let y = CY - 1; y >= 0; y--) {
          if (this.data[idx(lx, y, lz)] !== Block.AIR) {
            top = y + 1;
            break;
          }
        }
        this.heightMap[c] = top;
        if (top > maxY) maxY = top;
      }
    }
    this.maxY = maxY;
  }

  getSky(i: number): number {
    return (this.light[i] >> 4) & 0xf;
  }
  setSky(i: number, v: number): void {
    this.light[i] = (this.light[i] & 0x0f) | ((v & 0xf) << 4);
  }
  getBlockLight(i: number): number {
    return this.light[i] & 0xf;
  }
  setBlockLight(i: number, v: number): void {
    this.light[i] = (this.light[i] & 0xf0) | (v & 0xf);
  }
}
