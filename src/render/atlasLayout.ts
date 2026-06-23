// THREE-free atlas layout constants. Lives apart from atlas.ts (which imports THREE
// for the <canvas>/CanvasTexture) so the chunk MESHERS — and the meshing Web Worker
// (Phase 18.1) — can import the layout without pulling THREE into the worker bundle.

import { ATLAS_COLS, ATLAS_TILES } from '../core/BlockTypes';

export const TILE_PX = 16; // px per tile in the atlas canvas
export const ATLAS_ROWS = Math.ceil(ATLAS_TILES / ATLAS_COLS); // rows needed for all tiles
