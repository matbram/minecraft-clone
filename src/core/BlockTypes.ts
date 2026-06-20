// Block type definitions + flat lookup tables.
//
// Everything here is worker-safe (no DOM / no THREE). Lookup tables are plain
// typed arrays indexed by Block id for cache-friendly, allocation-free access.
//
// Use a PLAIN enum (not `const enum`) for esbuild/isolatedModules safety.

export enum Block {
  AIR = 0,
  STONE,
  DIRT,
  GRASS,
  SAND,
  WATER,
  GLASS,
  LOG,
  LEAVES,
  GLOWSTONE,
  BEDROCK,
  GRAVEL,
  COAL_ORE,
  IRON_ORE,
  GOLD_ORE,
  COUNT,
}

export const BLOCK_COUNT = Block.COUNT;

// Canonical face order. Used by both the mesher and the atlas/UV mapping.
//   0:+X (east)  1:-X (west)  2:+Y (top)  3:-Y (bottom)  4:+Z (south)  5:-Z (north)
export const FACE_PX = 0;
export const FACE_NX = 1;
export const FACE_PY = 2;
export const FACE_NY = 3;
export const FACE_PZ = 4;
export const FACE_NZ = 5;

// ---------------------------------------------------------------------------
// Atlas tile slots (canonical TILE_INDEX anchor).
//
// LOAD-BEARING: both the procedural atlas generator AND any future PNG texture
// pack must place each tile at the SAME slot number. That keeps mesh UVs
// identical for either source, so switching textures is a single uniform swap.
// ---------------------------------------------------------------------------
export const Tile = {
  GRASS_TOP: 0,
  GRASS_SIDE: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WATER: 5,
  GLASS: 6,
  LOG_SIDE: 7,
  LOG_TOP: 8,
  LEAVES: 9,
  GLOWSTONE: 10,
  BEDROCK: 11,
  GRAVEL: 12,
  COAL_ORE: 13,
  IRON_ORE: 14,
  GOLD_ORE: 15,
} as const;

export const ATLAS_TILES = 16; // number of distinct tiles (also the atlas grid is 16 wide)
export const ATLAS_COLS = 16; // tiles per atlas row

// ---------------------------------------------------------------------------
// Flat lookup tables, indexed by Block id.
// ---------------------------------------------------------------------------

// Transparency drives the face-cull rule AND (later) light propagation.
// A block is "transparent" if it does not fully occlude the neighbor face.
export const IS_TRANSPARENT = new Uint8Array(BLOCK_COUNT);
// Solidity drives collision (Phase 1) and is also used by the mesher's cull.
export const IS_SOLID = new Uint8Array(BLOCK_COUNT);
// Light emission (0..15). Hook for Phase 3 block-light BFS.
export const LIGHT_EMISSION = new Uint8Array(BLOCK_COUNT);

(function initBlockFlags() {
  // Default: opaque, solid, no emission.
  for (let b = 0; b < BLOCK_COUNT; b++) {
    IS_TRANSPARENT[b] = 0;
    IS_SOLID[b] = 1;
    LIGHT_EMISSION[b] = 0;
  }

  // Air: transparent, not solid.
  IS_TRANSPARENT[Block.AIR] = 1;
  IS_SOLID[Block.AIR] = 0;

  // Water: transparent, not solid (no collision in P0/P1 swim handling deferred).
  IS_TRANSPARENT[Block.WATER] = 1;
  IS_SOLID[Block.WATER] = 0;

  // Glass + leaves: transparent but solid.
  IS_TRANSPARENT[Block.GLASS] = 1;
  IS_TRANSPARENT[Block.LEAVES] = 1;

  // Glowstone emits full light (Phase 3 hook).
  LIGHT_EMISSION[Block.GLOWSTONE] = 15;
})();

// ---------------------------------------------------------------------------
// Per-face tile mapping: TILE_INDEX[block*6 + face] -> atlas tile slot.
// ---------------------------------------------------------------------------
export const TILE_INDEX = new Uint16Array(BLOCK_COUNT * 6);

function setAllFaces(b: Block, tile: number): void {
  for (let f = 0; f < 6; f++) TILE_INDEX[b * 6 + f] = tile;
}
function setFaces(b: Block, top: number, bottom: number, side: number): void {
  TILE_INDEX[b * 6 + FACE_PX] = side;
  TILE_INDEX[b * 6 + FACE_NX] = side;
  TILE_INDEX[b * 6 + FACE_PY] = top;
  TILE_INDEX[b * 6 + FACE_NY] = bottom;
  TILE_INDEX[b * 6 + FACE_PZ] = side;
  TILE_INDEX[b * 6 + FACE_NZ] = side;
}

(function initTiles() {
  setAllFaces(Block.STONE, Tile.STONE);
  setAllFaces(Block.DIRT, Tile.DIRT);
  setFaces(Block.GRASS, Tile.GRASS_TOP, Tile.DIRT, Tile.GRASS_SIDE);
  setAllFaces(Block.SAND, Tile.SAND);
  setAllFaces(Block.WATER, Tile.WATER);
  setAllFaces(Block.GLASS, Tile.GLASS);
  setFaces(Block.LOG, Tile.LOG_TOP, Tile.LOG_TOP, Tile.LOG_SIDE);
  setAllFaces(Block.LEAVES, Tile.LEAVES);
  setAllFaces(Block.GLOWSTONE, Tile.GLOWSTONE);
  setAllFaces(Block.BEDROCK, Tile.BEDROCK);
  setAllFaces(Block.GRAVEL, Tile.GRAVEL);
  setAllFaces(Block.COAL_ORE, Tile.COAL_ORE);
  setAllFaces(Block.IRON_ORE, Tile.IRON_ORE);
  setAllFaces(Block.GOLD_ORE, Tile.GOLD_ORE);
})();

export function tileOf(block: Block, face: number): number {
  return TILE_INDEX[block * 6 + face];
}
