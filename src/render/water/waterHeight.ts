// Phase 17 — shared water-surface corner height. Used by BOTH the continuous water
// surface mesh (WaterSurfaceMesh) and the block mesher's water SIDE faces, so the
// cube lip at a cliff/shore/waterfall meets the sheet exactly (watertight). THREE-free.

import { Block } from '../../core/BlockTypes';

// Edges of the water sheet feather DOWN toward air/land so shorelines, flowing-water
// leading edges and waterfall lips taper instead of showing a hard cube wall. A corner
// shared with a non-water (and non one-step-down) column contributes this negative
// offset; the [0,1] clamp means the strongest taper bottoms out at the cell base
// (a zero-thickness edge), so side faces can never invert.
export const WATER_EDGE_FEATHER = -0.15;

export type BlockSampler = (wx: number, wy: number, wz: number) => Block;
export type HeightSampler = (wx: number, wy: number, wz: number) => number;

// Smoothed surface height (offset in [0,1] above the cell base baseY) of corner
// (cx01,cz01 in {0,1}) of the water cell (wx,baseY,wz). Averages the up-to-4 columns
// meeting at the corner: water at baseY -> its height (a taller column reads 1.0); a
// one-step-down water at baseY-1 -> a ramp toward it; anything else -> a feathered edge.
// Sampled from WORLD coords so adjacent cells (and chunks) agree -> one seamless sheet.
export function waterCornerHeight(
  blockAt: BlockSampler,
  waterHeightAt: HeightSampler,
  wx: number,
  baseY: number,
  wz: number,
  cx01: number,
  cz01: number,
): number {
  const sx = cx01 === 1 ? 1 : -1;
  const sz = cz01 === 1 ? 1 : -1;
  let sum = 0;
  for (let k = 0; k < 4; k++) {
    const nx = wx + (k === 1 || k === 3 ? sx : 0);
    const nz = wz + (k === 2 || k === 3 ? sz : 0);
    if (blockAt(nx, baseY, nz) === Block.WATER) {
      sum += waterHeightAt(nx, baseY, nz); // same layer (taller column reads 1.0)
    } else if (blockAt(nx, baseY, nz) === Block.AIR && blockAt(nx, baseY - 1, nz) === Block.WATER) {
      sum += -1 + waterHeightAt(nx, baseY - 1, nz); // one step down -> ramp toward it
    } else {
      sum += WATER_EDGE_FEATHER; // air / land -> taper the edge down
    }
  }
  return Math.max(0, Math.min(1, sum / 4));
}

// Foam factor (0..1) at a corner = fraction of the 4 surrounding columns that are
// neither water nor a one-step-down lip (i.e. shore/air edges) -> drives shoreline foam.
export function waterCornerFoam(
  blockAt: BlockSampler,
  wx: number,
  baseY: number,
  wz: number,
  cx01: number,
  cz01: number,
): number {
  const sx = cx01 === 1 ? 1 : -1;
  const sz = cz01 === 1 ? 1 : -1;
  let edges = 0;
  for (let k = 0; k < 4; k++) {
    const nx = wx + (k === 1 || k === 3 ? sx : 0);
    const nz = wz + (k === 2 || k === 3 ? sz : 0);
    const here = blockAt(nx, baseY, nz);
    const down = here === Block.AIR && blockAt(nx, baseY - 1, nz) === Block.WATER;
    if (here !== Block.WATER && !down) edges++;
  }
  return edges / 4;
}
