// Phase 17 — the water SURFACE as a dedicated continuous heightfield mesh, decoupled
// from the per-cell cube water tops (which ChunkMesh no longer emits). One quad per
// exposed water-top cell, but corner heights come from shared world-coord sampling
// (waterCornerHeight), so adjacent cells AND chunks agree on each corner -> a single
// seamless sheet. Edges feather down toward air/shore, so standing water, flowing
// water, rivers, waterfalls and a filling crater all read as one continuous fluid with
// tapered (not cube-stepped) edges. THREE-free typed-array math (mirrors ChunkMesh) so
// it runs on the main thread with no worker boundary.

import { CX, CZ, CY, mod, worldToChunk, SKY_DEFAULT } from '../../core/constants';
import { idx } from '../../core/constants';
import { Block } from '../../core/BlockTypes';
import { fluidSurfaceHeight } from '../../core/fluid';
import type { Chunk } from '../../core/Chunk';
import type { World } from '../../world/World';
import { waterCornerHeight, waterCornerFoam } from './waterHeight';

export interface WaterMeshArrays {
  positions: Float32Array; // 3/vertex (chunk-local x/z + absolute y)
  flow: Float32Array; // 2/vertex: horizontal flow direction (rivers/waterfalls show direction)
  light: Float32Array; // 2/vertex: sky, block (0..1) — dims water at night / in caves
  edge: Float32Array; // 1/vertex: shoreline foam factor (0..1)
  depth: Float32Array; // 1/vertex: water-column thickness below (blocks) — baked depth colour
  indices: Uint32Array;
}

const DEPTH_CAP = 24; // blocks of water thickness to sample for the depth-colour hint

export function buildWaterMesh(world: World, cx: number, cz: number): WaterMeshArrays | null {
  const self = world.getChunk(cx, cz);
  if (!self) return null;

  const cxp = world.getChunk(cx + 1, cz);
  const cxm = world.getChunk(cx - 1, cz);
  const czp = world.getChunk(cx, cz + 1);
  const czm = world.getChunk(cx, cz - 1);
  const baseX = cx * CX;
  const baseZ = cz * CZ;

  const chunkAt = (wx: number, wz: number): Chunk | undefined => {
    const ccx = worldToChunk(wx);
    const ccz = worldToChunk(wz);
    if (ccx === cx && ccz === cz) return self;
    if (ccx === cx + 1 && ccz === cz) return cxp;
    if (ccx === cx - 1 && ccz === cz) return cxm;
    if (ccx === cx && ccz === cz + 1) return czp;
    if (ccx === cx && ccz === cz - 1) return czm;
    return world.getChunk(ccx, ccz);
  };
  const blockAt = (wx: number, wy: number, wz: number): Block => {
    if (wy < 0 || wy >= CY) return Block.AIR;
    const chunk = chunkAt(wx, wz);
    return chunk ? chunk.getBlock(mod(wx, CX), wy, mod(wz, CZ)) : Block.AIR;
  };
  const fluidAt = (wx: number, wy: number, wz: number): number => {
    if (wy < 0 || wy >= CY) return 0;
    const chunk = chunkAt(wx, wz);
    return chunk ? chunk.getFluid(mod(wx, CX), wy, mod(wz, CZ)) : 0;
  };
  const skyAt = (wx: number, wy: number, wz: number): number => {
    if (wy >= CY) return SKY_DEFAULT;
    if (wy < 0) return 0;
    const chunk = chunkAt(wx, wz);
    return chunk ? chunk.getSky(idx(mod(wx, CX), wy, mod(wz, CZ))) : SKY_DEFAULT;
  };
  const blockLightAt = (wx: number, wy: number, wz: number): number => {
    if (wy < 0 || wy >= CY) return 0;
    const chunk = chunkAt(wx, wz);
    return chunk ? chunk.getBlockLight(idx(mod(wx, CX), wy, mod(wz, CZ))) : 0;
  };
  const waterHeightAt = (wx: number, wy: number, wz: number): number =>
    fluidSurfaceHeight(Block.WATER, fluidAt(wx, wy, wz), blockAt(wx, wy + 1, wz) === Block.WATER);

  const positions: number[] = [];
  const flow: number[] = [];
  const light: number[] = [];
  const edge: number[] = [];
  const depth: number[] = [];
  const indices: number[] = [];
  let count = 0;

  const flowOut = { x: 0, z: 0 };
  const maxY = self.maxY;

  for (let y = 0; y < maxY; y++) {
    for (let lz = 0; lz < CZ; lz++) {
      for (let lx = 0; lx < CX; lx++) {
        if (self.getBlock(lx, y, lz) !== Block.WATER) continue;
        const wx = baseX + lx;
        const wz = baseZ + lz;
        // Only the TRUE water surface (water meets AIR) gets a quad. Water capped by a
        // non-air block — a flooded ocean-cave ceiling, a terrain overhang, sea ice, or a
        // seabed plant — is NOT a surface; emitting there paved a chaotic submerged second
        // sheet across the seabed (the shoreline shards + the night foam outlines).
        if (blockAt(wx, y + 1, wz) !== Block.AIR) continue;

        // Shared corner heights (and foam) -> seamless with neighbours + the cube lip.
        const h00 = waterCornerHeight(blockAt, waterHeightAt, wx, y, wz, 0, 0);
        const h01 = waterCornerHeight(blockAt, waterHeightAt, wx, y, wz, 0, 1);
        const h11 = waterCornerHeight(blockAt, waterHeightAt, wx, y, wz, 1, 1);
        const h10 = waterCornerHeight(blockAt, waterHeightAt, wx, y, wz, 1, 0);
        const f00 = waterCornerFoam(blockAt, wx, y, wz, 0, 0);
        const f01 = waterCornerFoam(blockAt, wx, y, wz, 0, 1);
        const f11 = waterCornerFoam(blockAt, wx, y, wz, 1, 1);
        const f10 = waterCornerFoam(blockAt, wx, y, wz, 1, 0);

        // Flow direction (downhill gradient) — biases the ripple normal + foam streaks.
        world.flowDir(wx, y, wz, flowOut);
        const fx = flowOut.x;
        const fz = flowOut.z;

        // Incoming light from the air just above the surface (dims at night / in caves).
        const sky = skyAt(wx, y + 1, wz) / 15;
        const blk = blockLightAt(wx, y + 1, wz) / 15;

        // Water-column thickness below this surface -> baked depth colour (Low/Medium).
        let thick = 0;
        for (let yy = y; yy >= 0 && thick < DEPTH_CAP && blockAt(wx, yy, wz) === Block.WATER; yy--) thick++;

        // Vertices in XZ order c0=(0,0) c1=(0,1) c2=(1,1) c3=(1,0) (matches the block
        // +Y winding so FrontSide shows from above).
        const verts: [number, number, number, number][] = [
          [0, 0, h00, f00],
          [0, 1, h01, f01],
          [1, 1, h11, f11],
          [1, 0, h10, f10],
        ];
        const base = count;
        for (const [vx, vz, vh, vf] of verts) {
          positions.push(lx + vx, y + vh, lz + vz);
          flow.push(fx, fz);
          light.push(sky, blk);
          edge.push(vf);
          depth.push(thick);
        }
        // Flip the quad diagonal toward the flatter pair so slopes don't crease.
        if (Math.abs(h00 - h11) > Math.abs(h01 - h10)) {
          indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
        } else {
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
        count += 4;
      }
    }
  }

  if (count === 0) return null;
  return {
    positions: new Float32Array(positions),
    flow: new Float32Array(flow),
    light: new Float32Array(light),
    edge: new Float32Array(edge),
    depth: new Float32Array(depth),
    indices: new Uint32Array(indices),
  };
}
