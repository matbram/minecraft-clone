// Sky + block light propagation (BFS), incremental edit updates, and cross-chunk
// seeding. Operates on the World via WORLD-coordinate light get/set so light
// crosses chunk borders transparently. Main-thread only (no THREE).
//
// Opacity for light uses IS_TRANSPARENT (air/water/glass/leaves pass light,
// costing 1 per step), NOT IS_SOLID.

import { CX, CZ, CY, COLS, idx, worldToChunk, mod, SKY_DEFAULT } from '../core/constants';
import { IS_TRANSPARENT, LIGHT_EMISSION } from '../core/BlockTypes';
import { chunkKey, parseKey } from './chunkKey';
import type { Chunk } from '../core/Chunk';
import type { World } from './World';

interface LNode {
  x: number;
  y: number;
  z: number;
  v: number;
}

const N6: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export class LightEngine {
  private readonly world: World;
  private skyAdd: LNode[] = [];
  private blockAdd: LNode[] = [];
  private rem: LNode[] = [];
  private touched = new Set<string>();

  constructor(world: World) {
    this.world = world;
  }

  // --- world-coord light accessors ----------------------------------------

  private getSkyW(wx: number, wy: number, wz: number): number {
    if (wy >= CY) return SKY_DEFAULT;
    if (wy < 0) return 0;
    const c = this.world.getChunk(worldToChunk(wx), worldToChunk(wz));
    return c ? c.getSky(idx(mod(wx, CX), wy, mod(wz, CZ))) : 0;
  }

  private getBlockW(wx: number, wy: number, wz: number): number {
    if (wy < 0 || wy >= CY) return 0;
    const c = this.world.getChunk(worldToChunk(wx), worldToChunk(wz));
    return c ? c.getBlockLight(idx(mod(wx, CX), wy, mod(wz, CZ))) : 0;
  }

  // Returns true only if the cell was actually written (chunk loaded).
  private setSkyW(wx: number, wy: number, wz: number, v: number): boolean {
    if (wy < 0 || wy >= CY) return false;
    const cx = worldToChunk(wx);
    const cz = worldToChunk(wz);
    const c = this.world.getChunk(cx, cz);
    if (!c) return false;
    const lx = mod(wx, CX);
    const lz = mod(wz, CZ);
    c.setSky(idx(lx, wy, lz), v);
    this.markTouched(cx, cz, lx, lz);
    return true;
  }

  private setBlockW(wx: number, wy: number, wz: number, v: number): boolean {
    if (wy < 0 || wy >= CY) return false;
    const cx = worldToChunk(wx);
    const cz = worldToChunk(wz);
    const c = this.world.getChunk(cx, cz);
    if (!c) return false;
    const lx = mod(wx, CX);
    const lz = mod(wz, CZ);
    c.setBlockLight(idx(lx, wy, lz), v);
    this.markTouched(cx, cz, lx, lz);
    return true;
  }

  private isOpaque(wx: number, wy: number, wz: number): boolean {
    return !IS_TRANSPARENT[this.world.getBlockWorld(wx, wy, wz)];
  }

  // --- dirty tracking ------------------------------------------------------

  private markTouched(cx: number, cz: number, lx: number, lz: number): void {
    this.touched.add(chunkKey(cx, cz));
    if (lx === 0) this.touched.add(chunkKey(cx - 1, cz));
    else if (lx === CX - 1) this.touched.add(chunkKey(cx + 1, cz));
    if (lz === 0) this.touched.add(chunkKey(cx, cz - 1));
    else if (lz === CZ - 1) this.touched.add(chunkKey(cx, cz + 1));
  }

  private flushTouched(): void {
    for (const key of this.touched) {
      const [cx, cz] = parseKey(key);
      this.world.markDirty(cx, cz);
    }
    this.touched.clear();
  }

  // --- BFS propagation -----------------------------------------------------

  private propagateSky(): void {
    const q = this.skyAdd;
    let head = 0;
    while (head < q.length) {
      const n = q[head++];
      const level = n.v;
      if (level <= 0) continue;
      for (let k = 0; k < 6; k++) {
        const d = N6[k];
        const nx = n.x + d[0];
        const ny = n.y + d[1];
        const nz = n.z + d[2];
        if (ny < 0 || ny >= CY) continue;
        if (this.isOpaque(nx, ny, nz)) continue;
        // Straight-down from a full-strength cell costs nothing (vertical sunlight).
        const target = d[1] === -1 && level === 15 ? 15 : level - 1;
        if (target <= 0) continue;
        if (this.getSkyW(nx, ny, nz) < target) {
          if (this.setSkyW(nx, ny, nz, target)) q.push({ x: nx, y: ny, z: nz, v: target });
        }
      }
    }
    q.length = 0;
  }

  private propagateBlock(): void {
    const q = this.blockAdd;
    let head = 0;
    while (head < q.length) {
      const n = q[head++];
      const level = n.v;
      if (level <= 1) continue;
      for (let k = 0; k < 6; k++) {
        const d = N6[k];
        const nx = n.x + d[0];
        const ny = n.y + d[1];
        const nz = n.z + d[2];
        if (ny < 0 || ny >= CY) continue;
        if (this.isOpaque(nx, ny, nz)) continue;
        const target = level - 1;
        if (this.getBlockW(nx, ny, nz) < target) {
          if (this.setBlockW(nx, ny, nz, target)) q.push({ x: nx, y: ny, z: nz, v: target });
        }
      }
    }
    q.length = 0;
  }

  // Remove-then-add for one channel. Refill sources are pushed to the add queue.
  private remove(sky: boolean, wx: number, wy: number, wz: number): void {
    const getW = sky ? this.getSkyW.bind(this) : this.getBlockW.bind(this);
    const setW = sky ? this.setSkyW.bind(this) : this.setBlockW.bind(this);
    const addQ = sky ? this.skyAdd : this.blockAdd;

    const old = getW(wx, wy, wz);
    if (old === 0) return;
    setW(wx, wy, wz, 0);
    this.rem.length = 0;
    this.rem.push({ x: wx, y: wy, z: wz, v: old });

    let head = 0;
    while (head < this.rem.length) {
      const n = this.rem[head++];
      const lv = n.v;
      for (let k = 0; k < 6; k++) {
        const d = N6[k];
        const nx = n.x + d[0];
        const ny = n.y + d[1];
        const nz = n.z + d[2];
        if (ny < 0 || ny >= CY) continue;
        const nl = getW(nx, ny, nz);
        if (nl === 0) continue;
        // "Was lit by us": darker child, or a vertical free-fall child (sky 15 below 15).
        const removable = nl < lv || (sky && d[1] === -1 && lv === 15 && nl === 15);
        if (removable) {
          if (setW(nx, ny, nz, 0)) this.rem.push({ x: nx, y: ny, z: nz, v: nl });
        } else {
          // nl >= lv: independent source -> refill the hole.
          addQ.push({ x: nx, y: ny, z: nz, v: nl });
        }
      }
    }
    this.rem.length = 0;
  }

  // --- public: initial chunk lighting -------------------------------------

  initChunkLight(chunk: Chunk): void {
    // The chunk's own light is changing; its mesh and border neighbors re-mesh.
    this.touched.add(chunkKey(chunk.cx, chunk.cz));
    this.touched.add(chunkKey(chunk.cx - 1, chunk.cz));
    this.touched.add(chunkKey(chunk.cx + 1, chunk.cz));
    this.touched.add(chunkKey(chunk.cx, chunk.cz - 1));
    this.touched.add(chunkKey(chunk.cx, chunk.cz + 1));

    this.fillSkyColumns(chunk);
    this.seedEmitters(chunk);
    this.seedFromNeighbors(chunk);
    this.propagateBlock();
    this.propagateSky();

    chunk.lit = true;
    this.flushTouched();
  }

  private fillSkyColumns(chunk: Chunk): void {
    const baseX = chunk.cx * CX;
    const baseZ = chunk.cz * CZ;
    const data = chunk.data;
    const light = chunk.light;
    const maxY = chunk.maxY;
    for (let lz = 0; lz < CZ; lz++) {
      for (let lx = 0; lx < CX; lx++) {
        for (let y = CY - 1; y >= 0; y--) {
          const i = idx(lx, y, lz);
          if (!IS_TRANSPARENT[data[i]]) break; // first opaque -> column stops
          light[i] = (light[i] & 0x0f) | 0xf0; // sky = 15 (free vertical fall)
          if (y <= maxY) this.skyAdd.push({ x: baseX + lx, y, z: baseZ + lz, v: 15 });
        }
      }
    }
  }

  private seedEmitters(chunk: Chunk): void {
    const baseX = chunk.cx * CX;
    const baseZ = chunk.cz * CZ;
    const data = chunk.data;
    for (let i = 0; i < data.length; i++) {
      const e = LIGHT_EMISSION[data[i]];
      if (e > 0) {
        chunk.setBlockLight(i, e);
        const y = Math.floor(i / COLS);
        const rem = i % COLS;
        const lz = Math.floor(rem / CX);
        const lx = rem % CX;
        this.blockAdd.push({ x: baseX + lx, y, z: baseZ + lz, v: e });
      }
    }
  }

  // Push border cells of already-lit neighbors so their light floods into this
  // chunk (and the BFS spills this chunk's light back where the neighbor is darker).
  private seedFromNeighbors(chunk: Chunk): void {
    const cx = chunk.cx;
    const cz = chunk.cz;
    const dirs: ReadonlyArray<readonly [number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dcx, dcz] of dirs) {
      const nb = this.world.getChunk(cx + dcx, cz + dcz);
      if (!nb || !nb.lit) continue;
      const yMax = Math.min(CY - 1, Math.max(chunk.maxY, nb.maxY) + 1);
      const nbx = (cx + dcx) * CX;
      const nbz = (cz + dcz) * CZ;
      for (let w = 0; w < CX; w++) {
        for (let y = 0; y <= yMax; y++) {
          // Local coords of the neighbor cell adjacent to the shared border.
          let lx: number;
          let lz: number;
          let wx: number;
          let wz: number;
          if (dcx === 1) {
            lx = 0;
            lz = w;
            wx = nbx;
            wz = nbz + w;
          } else if (dcx === -1) {
            lx = CX - 1;
            lz = w;
            wx = nbx + CX - 1;
            wz = nbz + w;
          } else if (dcz === 1) {
            lx = w;
            lz = 0;
            wx = nbx + w;
            wz = nbz;
          } else {
            lx = w;
            lz = CZ - 1;
            wx = nbx + w;
            wz = nbz + CZ - 1;
          }
          const li = idx(lx, y, lz);
          const s = nb.getSky(li);
          const b = nb.getBlockLight(li);
          if (s > 0) this.skyAdd.push({ x: wx, y, z: wz, v: s });
          if (b > 0) this.blockAdd.push({ x: wx, y, z: wz, v: b });
        }
      }
    }
  }

  // --- public: incremental edit (the real queueLightUpdate) ----------------

  onBlockChange(wx: number, wy: number, wz: number, oldB: number, newB: number): void {
    const oldOpaque = !IS_TRANSPARENT[oldB];
    const newOpaque = !IS_TRANSPARENT[newB];

    // ----- block light -----
    this.remove(false, wx, wy, wz); // clear any block light at the cell + queue refills
    const e = LIGHT_EMISSION[newB];
    // Emitters seed their own cell even if opaque (glowstone/lava are solid but glow).
    if (e > 0) {
      this.setBlockW(wx, wy, wz, e);
      this.blockAdd.push({ x: wx, y: wy, z: wz, v: e });
    }
    if (!newOpaque) {
      for (let k = 0; k < 6; k++) {
        const d = N6[k];
        const nl = this.getBlockW(wx + d[0], wy + d[1], wz + d[2]);
        if (nl > 1) this.blockAdd.push({ x: wx + d[0], y: wy + d[1], z: wz + d[2], v: nl });
      }
    }
    this.propagateBlock();

    // ----- sky light (only opacity flips change sky propagation) -----
    if (oldOpaque !== newOpaque) {
      if (newOpaque) {
        this.remove(true, wx, wy, wz); // removes cell + free-fall column below
        this.propagateSky();
      } else {
        for (let k = 0; k < 6; k++) {
          const d = N6[k];
          const ns = this.getSkyW(wx + d[0], wy + d[1], wz + d[2]);
          if (ns > 0) this.skyAdd.push({ x: wx + d[0], y: wy + d[1], z: wz + d[2], v: ns });
        }
        this.propagateSky();
      }
    }

    this.flushTouched();
  }
}
