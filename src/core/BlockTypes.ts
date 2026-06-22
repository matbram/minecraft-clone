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
  SNOW, // Phase 12: snowy-biome surface + mountain caps
  // Phase 12·R: geography surfaces.
  SANDSTONE,
  RED_SAND,
  TERRACOTTA,
  PODZOL,
  CLAY,
  ICE,
  // Phase 12b: flora. Cross-billboard plants (non-solid) + cactus (solid column).
  TALL_GRASS,
  FERN,
  FLOWER_RED,
  FLOWER_YELLOW,
  DEAD_BUSH,
  SUGAR_CANE,
  CACTUS,
  // Phase 12d: ocean flora (cross-billboard, live underwater).
  KELP,
  SEAGRASS,
  CORAL,
  // Phase 11b: APPLE is a HELD ITEM, not a world block — never placed, meshed,
  // generated, or saved. It exists only so survival has an edible to refill hunger.
  APPLE,
  // Phase 15: ROCKET_LAUNCHER is a HELD WEAPON item (never placed/meshed — icon is
  // drawn procedurally). FIRE is a temporary, non-solid, light-emitting block placed
  // by explosions; it auto-reverts to AIR after a few seconds.
  ROCKET_LAUNCHER,
  FIRE,
  // Phase 15.5: TORCH is a placeable light source (rendered as a small flame billboard).
  // FLAMETHROWER is a held weapon (never placed/meshed — procedural icon).
  TORCH,
  FLAMETHROWER,
  // Phase 15.8: FLARE — the underwater-capable torch variant (red flame; survives water).
  FLARE,
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
  SNOW: 16,
  SANDSTONE: 17,
  RED_SAND: 18,
  TERRACOTTA: 19,
  PODZOL: 20,
  CLAY: 21,
  ICE: 22,
  TALL_GRASS: 23,
  FERN: 24,
  FLOWER_RED: 25,
  FLOWER_YELLOW: 26,
  DEAD_BUSH: 27,
  SUGAR_CANE: 28,
  CACTUS: 29,
  KELP: 30,
  SEAGRASS: 31,
  CORAL: 32,
  FIRE: 33, // Phase 15: explosion fire (cross-billboard, emissive)
  TORCH: 34, // Phase 15.5: placeable torch (stick only; flame is a particle renderer)
  FLARE: 35, // Phase 15.8: underwater flare (red stick; flame is a particle renderer)
} as const;

export const ATLAS_TILES = 36; // number of distinct tiles (atlas grid is 16 wide -> 3 rows)
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
// Foliage flag (Phase 4a waving-foliage vertex offset). Visual only.
export const IS_FOLIAGE = new Uint8Array(BLOCK_COUNT);
// Phase 12b: cross-billboard plants (rendered as two diagonal cut-out quads, not cubes).
export const IS_CROSS = new Uint8Array(BLOCK_COUNT);
// Cross plants whose colour follows the biome grass tint (vs keeping their own colour).
export const CROSS_TINTED = new Uint8Array(BLOCK_COUNT);

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

  // Leaves wave (also covers the grass decoration, placed as LEAVES).
  IS_FOLIAGE[Block.LEAVES] = 1;

  // Phase 12b flora. Cross plants: non-solid, transparent (don't cull neighbors), wave.
  // Phase 15: FIRE renders as the same cross-billboard (flame silhouette), but emits light.
  for (const p of [Block.TALL_GRASS, Block.FERN, Block.FLOWER_RED, Block.FLOWER_YELLOW, Block.DEAD_BUSH, Block.SUGAR_CANE, Block.KELP, Block.SEAGRASS, Block.CORAL, Block.FIRE]) {
    IS_CROSS[p] = 1;
    IS_SOLID[p] = 0;
    IS_TRANSPARENT[p] = 1;
    IS_FOLIAGE[p] = 1;
  }
  // Fire glows (temporary light source dropped by explosions).
  LIGHT_EMISSION[Block.FIRE] = 14;
  // Grass/fern/sugar cane recolour with the biome; flowers + dead bush keep their tile colour.
  CROSS_TINTED[Block.TALL_GRASS] = 1;
  CROSS_TINTED[Block.FERN] = 1;
  CROSS_TINTED[Block.SUGAR_CANE] = 1;
  // Cactus is a normal solid cube column (opaque).

  // Apple is a held item, never a world block: not solid (never collided/meshed).
  IS_SOLID[Block.APPLE] = 0;
  IS_TRANSPARENT[Block.APPLE] = 1;
  // Rocket launcher + flamethrower are held weapon items (never placed/meshed/collided).
  IS_SOLID[Block.ROCKET_LAUNCHER] = 0;
  IS_TRANSPARENT[Block.ROCKET_LAUNCHER] = 1;
  IS_SOLID[Block.FLAMETHROWER] = 0;
  IS_TRANSPARENT[Block.FLAMETHROWER] = 1;

  // Phase 15.5/15.8: TORCH — placeable light source, rendered as a small cross billboard
  // (just the stick; the flame is particles). Non-solid, transparent, does NOT wave.
  // Phase 15.8: torch light is now a DYNAMIC shader light (matching the held torch), so the
  // baked block emission is 0 (no double-lighting). FLARE is the underwater variant.
  IS_CROSS[Block.TORCH] = 1;
  IS_SOLID[Block.TORCH] = 0;
  IS_TRANSPARENT[Block.TORCH] = 1;
  LIGHT_EMISSION[Block.TORCH] = 0;
  IS_CROSS[Block.FLARE] = 1;
  IS_SOLID[Block.FLARE] = 0;
  IS_TRANSPARENT[Block.FLARE] = 1;
  LIGHT_EMISSION[Block.FLARE] = 0;
})();

// Phase 15.8: torch-like blocks (TORCH + FLARE) share the dynamic-light + particle-flame
// path and the R-switch. FLARE additionally works underwater and survives water.
export const IS_TORCHLIKE = new Uint8Array(BLOCK_COUNT);
(function initTorchlike() {
  IS_TORCHLIKE[Block.TORCH] = 1;
  IS_TORCHLIKE[Block.FLARE] = 1;
})();

// ---------------------------------------------------------------------------
// Phase 11b: edible items. IS_EDIBLE drives "right-click eats instead of places";
// FOOD_RESTORE is hunger points (0..20 scale) restored per item eaten.
// ---------------------------------------------------------------------------
export const IS_EDIBLE = new Uint8Array(BLOCK_COUNT);
export const FOOD_RESTORE = new Float32Array(BLOCK_COUNT);
(function initFood() {
  IS_EDIBLE[Block.APPLE] = 1;
  FOOD_RESTORE[Block.APPLE] = 6;
})();

// Items the player can hold + eat. Listed in the inventory alongside PLACEABLE.
export const EDIBLE: Block[] = [Block.APPLE];

// ---------------------------------------------------------------------------
// Phase 15: weapons. IS_WEAPON drives "left-click fires instead of mines"; the
// item is held like APPLE (never placed). Listed in the inventory so it's equippable.
// ---------------------------------------------------------------------------
export const IS_WEAPON = new Uint8Array(BLOCK_COUNT);
(function initWeapons() {
  IS_WEAPON[Block.ROCKET_LAUNCHER] = 1;
  IS_WEAPON[Block.FLAMETHROWER] = 1;
})();

export const WEAPONS: Block[] = [Block.ROCKET_LAUNCHER, Block.FLAMETHROWER];

// ---------------------------------------------------------------------------
// Phase 15.5: per-material flammability. Every surface can hold a fire (every blast
// always makes some), but materials differ:
//   FLAMMABILITY  0..1  ease of CATCHING from a neighbouring fire (0 = never catches/spreads)
//   SPREAD_MULT   mult on the base spread/consume chance (how fast it propagates/burns away)
//   BURN_SECONDS  how long a fire AT/ON this block burns (bare ground = a brief flare;
//                 grass = short; wood = long). Defaults to NON_FUEL_BURN for everything.
// IS_FLAMMABLE is kept as the derived "FLAMMABILITY > 0" for any simple checks.
// ---------------------------------------------------------------------------
const NON_FUEL_BURN = 3; // seconds a fire flares on bare/non-flammable ground before dying
export const FLAMMABILITY = new Float32Array(BLOCK_COUNT);
export const SPREAD_MULT = new Float32Array(BLOCK_COUNT);
export const BURN_SECONDS = new Float32Array(BLOCK_COUNT);
export const IS_FLAMMABLE = new Uint8Array(BLOCK_COUNT);
(function initFlammability() {
  BURN_SECONDS.fill(NON_FUEL_BURN); // any surface flares briefly even if it can't sustain fire
  // [block, flammability, spreadMult, burnSeconds]
  const F: [Block, number, number, number][] = [
    [Block.LEAVES, 1.0, 1.6, 6],
    [Block.TALL_GRASS, 1.0, 1.5, 4],
    [Block.FERN, 1.0, 1.5, 4],
    [Block.FLOWER_RED, 0.9, 1.3, 4],
    [Block.FLOWER_YELLOW, 0.9, 1.3, 4],
    [Block.DEAD_BUSH, 1.0, 1.7, 3],
    [Block.SUGAR_CANE, 0.8, 1.0, 5],
    [Block.LOG, 0.5, 0.4, 38], // hard to light, slow to spread, burns a long time
    [Block.CACTUS, 0.5, 0.4, 12],
  ];
  for (const [b, fl, sp, bt] of F) {
    FLAMMABILITY[b] = fl;
    SPREAD_MULT[b] = sp;
    BURN_SECONDS[b] = bt;
    IS_FLAMMABLE[b] = 1;
  }
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
  setAllFaces(Block.SNOW, Tile.SNOW);
  setAllFaces(Block.SANDSTONE, Tile.SANDSTONE);
  setAllFaces(Block.RED_SAND, Tile.RED_SAND);
  setAllFaces(Block.TERRACOTTA, Tile.TERRACOTTA);
  setAllFaces(Block.PODZOL, Tile.PODZOL);
  setAllFaces(Block.CLAY, Tile.CLAY);
  setAllFaces(Block.ICE, Tile.ICE);
  setAllFaces(Block.TALL_GRASS, Tile.TALL_GRASS);
  setAllFaces(Block.FERN, Tile.FERN);
  setAllFaces(Block.FLOWER_RED, Tile.FLOWER_RED);
  setAllFaces(Block.FLOWER_YELLOW, Tile.FLOWER_YELLOW);
  setAllFaces(Block.DEAD_BUSH, Tile.DEAD_BUSH);
  setAllFaces(Block.SUGAR_CANE, Tile.SUGAR_CANE);
  setAllFaces(Block.CACTUS, Tile.CACTUS);
  setAllFaces(Block.KELP, Tile.KELP);
  setAllFaces(Block.SEAGRASS, Tile.SEAGRASS);
  setAllFaces(Block.CORAL, Tile.CORAL);
  setAllFaces(Block.FIRE, Tile.FIRE);
  setAllFaces(Block.TORCH, Tile.TORCH);
  setAllFaces(Block.FLARE, Tile.FLARE);
})();

export function tileOf(block: Block, face: number): number {
  return TILE_INDEX[block * 6 + face];
}

// ---------------------------------------------------------------------------
// Phase 1: interaction tables.
// ---------------------------------------------------------------------------

// Mining time in SECONDS (Infinity = unbreakable). Tune by feel.
export const HARDNESS = new Float32Array(BLOCK_COUNT);
(function initHardness() {
  HARDNESS.fill(0.75); // generic default
  HARDNESS[Block.AIR] = 0;
  HARDNESS[Block.WATER] = 0;
  HARDNESS[Block.LEAVES] = 0.2;
  HARDNESS[Block.GLASS] = 0.3;
  HARDNESS[Block.SAND] = 0.5;
  HARDNESS[Block.DIRT] = 0.6;
  HARDNESS[Block.GRASS] = 0.6;
  HARDNESS[Block.GRAVEL] = 0.6;
  HARDNESS[Block.LOG] = 1.5;
  HARDNESS[Block.STONE] = 2.0;
  HARDNESS[Block.COAL_ORE] = 2.0;
  HARDNESS[Block.IRON_ORE] = 2.0;
  HARDNESS[Block.GOLD_ORE] = 2.0;
  HARDNESS[Block.GLOWSTONE] = 2.0;
  HARDNESS[Block.SNOW] = 0.5;
  HARDNESS[Block.SANDSTONE] = 0.8;
  HARDNESS[Block.RED_SAND] = 0.5;
  HARDNESS[Block.TERRACOTTA] = 1.0;
  HARDNESS[Block.PODZOL] = 0.6;
  HARDNESS[Block.CLAY] = 0.6;
  HARDNESS[Block.ICE] = 0.5;
  HARDNESS[Block.TALL_GRASS] = 0;
  HARDNESS[Block.FERN] = 0;
  HARDNESS[Block.FLOWER_RED] = 0;
  HARDNESS[Block.FLOWER_YELLOW] = 0;
  HARDNESS[Block.DEAD_BUSH] = 0;
  HARDNESS[Block.SUGAR_CANE] = 0;
  HARDNESS[Block.CACTUS] = 0.4;
  HARDNESS[Block.KELP] = 0;
  HARDNESS[Block.SEAGRASS] = 0;
  HARDNESS[Block.CORAL] = 0.3;
  HARDNESS[Block.FIRE] = 0; // temporary; instantly clears if targeted
  HARDNESS[Block.TORCH] = 0; // instant break (place freely while exploring)
  HARDNESS[Block.FLARE] = 0; // instant break
  HARDNESS[Block.BEDROCK] = Infinity;
})();

// A block the player can target with the cursor (break / place-against).
export function isSelectable(b: Block): boolean {
  return b !== Block.AIR && b !== Block.WATER;
}

// Blocks the player can hold + place. Excludes AIR, BEDROCK. Water places a
// source block (Phase 6 flow sim takes it from there).
export const PLACEABLE: Block[] = [
  Block.GRASS,
  Block.DIRT,
  Block.STONE,
  Block.SAND,
  Block.WATER,
  Block.GLASS,
  Block.LOG,
  Block.LEAVES,
  Block.GLOWSTONE,
  Block.GRAVEL,
  Block.COAL_ORE,
  Block.IRON_ORE,
  Block.GOLD_ORE,
  Block.SNOW,
  Block.SANDSTONE,
  Block.RED_SAND,
  Block.TERRACOTTA,
  Block.PODZOL,
  Block.CLAY,
  Block.ICE,
  Block.TALL_GRASS,
  Block.FERN,
  Block.FLOWER_RED,
  Block.FLOWER_YELLOW,
  Block.DEAD_BUSH,
  Block.SUGAR_CANE,
  Block.CACTUS,
  Block.KELP,
  Block.SEAGRASS,
  Block.CORAL,
  Block.TORCH,
  Block.FLARE,
];

// Representative atlas tile for a block's inventory/hotbar icon (its top face).
export function representativeTile(b: Block): number {
  return TILE_INDEX[b * 6 + FACE_PY];
}
