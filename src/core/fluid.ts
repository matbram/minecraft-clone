// Phase 6: pure helpers for the per-cell `fluid` byte (see constants.ts).
//
// The byte is only meaningful where the block id is WATER. Use `data` (the block
// id) to answer "is this water?" — never the fluid byte (0 is a valid source).
//   low 3 bits = level: 0 = source/full, 1..7 = decreasing flowing depth
//   bit 0x08   = FALLING: fed from above, renders full height + spreads like a
//                source onto the layer below.

import { Block } from './BlockTypes';
import { FLUID_FALLING, FLUID_LEVEL_MASK, FLUID_HEIGHTS } from './constants';

export function levelOf(f: number): number {
  return f & FLUID_LEVEL_MASK;
}

export function isFalling(f: number): boolean {
  return (f & FLUID_FALLING) !== 0;
}

export function makeFluid(level: number, falling: boolean): number {
  return (level & FLUID_LEVEL_MASK) | (falling ? FLUID_FALLING : 0);
}

// Visual top height (block fraction) of a water cell. Sources, falling water, and
// water with water directly above all render full height (1.0) so columns and the
// sea surface stay flat; flowing water thins by level.
export function fluidSurfaceHeight(block: Block, f: number, waterAbove: boolean): number {
  if (block !== Block.WATER) return 0;
  if (waterAbove || isFalling(f)) return 1.0;
  return FLUID_HEIGHTS[levelOf(f)];
}
