// Phase 6/16: pure helpers for the per-cell `fluid` byte (see constants.ts).
//
// The byte is only meaningful where the block id is WATER. Use `data` (the block
// id) to answer "is this water?" — never the fluid byte (0 is a valid source).
//   low 4 bits = level: 0 = source/full, 1..MAX = decreasing flowing depth
//   bit 0x10   = FALLING: fed from above, renders full height + spreads like a
//                source onto the layer below.

import { Block } from './BlockTypes';
import { FLUID_FALLING, FLUID_LEVEL_MASK, FLUID_MAX_LEVEL } from './constants';

export function levelOf(f: number): number {
  return f & FLUID_LEVEL_MASK;
}

export function isFalling(f: number): boolean {
  return (f & FLUID_FALLING) !== 0;
}

export function makeFluid(level: number, falling: boolean): number {
  return (level & FLUID_LEVEL_MASK) | (falling ? FLUID_FALLING : 0);
}

// Visual top height (block fraction) of a water cell, computed continuously from the level
// so finer levels give a smoother slope (the renderer further corner-averages neighbours).
// Sources, falling water, and water with water directly above render full height (1.0) so
// columns and the sea surface stay flat.
export function fluidSurfaceHeight(block: Block, f: number, waterAbove: boolean): number {
  if (block !== Block.WATER) return 0;
  if (waterAbove || isFalling(f)) return 1.0;
  const level = levelOf(f);
  if (level === 0) return 1.0; // source
  return 1.0 - level / (FLUID_MAX_LEVEL + 1); // level 1 -> ~0.91 ... level MAX -> ~0.09
}
