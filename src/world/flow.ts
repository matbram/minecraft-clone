// Pure horizontal water-flow direction (downhill gradient of the water surface),
// THREE-free and World-free so it runs in the meshing worker. Shared by FluidSim
// (player current push) and buildWaterMesh (ripple/foam direction) — one source of
// truth. Operates entirely through caller-supplied block/fluid samplers.

import { Block } from '../core/BlockTypes';
import { fluidSurfaceHeight } from '../core/fluid';

type BlockSampler = (wx: number, wy: number, wz: number) => Block;
type FluidSampler = (wx: number, wy: number, wz: number) => number;

const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function surfaceHeight(blockAt: BlockSampler, fluidAt: FluidSampler, wx: number, wy: number, wz: number): number {
  const above = blockAt(wx, wy + 1, wz) === Block.WATER;
  return fluidSurfaceHeight(Block.WATER, fluidAt(wx, wy, wz), above);
}

// Writes the normalized downhill flow (toward lower water / open air) into `out`;
// ~0 in a still pool / flat ocean (all sources at height 1.0).
export function computeFlow(
  blockAt: BlockSampler,
  fluidAt: FluidSampler,
  wx: number,
  wy: number,
  wz: number,
  out: { x: number; z: number },
): void {
  out.x = 0;
  out.z = 0;
  if (blockAt(wx, wy, wz) !== Block.WATER) return;
  const h = surfaceHeight(blockAt, fluidAt, wx, wy, wz);
  for (const [dx, dz] of DIRS) {
    const nb = blockAt(wx + dx, wy, wz + dz);
    if (nb !== Block.AIR && nb !== Block.WATER) continue; // wall: no flow that way
    const nh = nb === Block.AIR ? 0 : surfaceHeight(blockAt, fluidAt, wx + dx, wy, wz + dz);
    const drop = h - nh;
    if (drop > 0) {
      out.x += dx * drop;
      out.z += dz * drop;
    }
  }
  const len = Math.hypot(out.x, out.z);
  if (len > 1e-4) {
    out.x /= len;
    out.z /= len;
  } else {
    out.x = 0;
    out.z = 0;
  }
}
