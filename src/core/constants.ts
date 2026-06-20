// Single source of truth for world dimensions and tuning.
// Imported by BOTH the worker and the main thread, so indexing never diverges.

export const CX = 16; // chunk size in X
export const CZ = 16; // chunk size in Z
export const CY = 256; // chunk height in Y

export const COLS = CX * CZ; // blocks per Y-layer (256)
export const BLOCKS = CX * CZ * CY; // blocks per chunk (65536)

// Block index within a chunk: idx = lx + lz*CX + y*COLS
export function idx(lx: number, y: number, lz: number): number {
  return lx + lz * CX + y * COLS;
}

// Column index within a chunk's heightMap: col = lx + lz*CX
export function colIdx(lx: number, lz: number): number {
  return lx + lz * CX;
}

export const SEA_LEVEL = 62;
export const BEDROCK_Y = 0;

// Streaming / throttle tuning.
export const RENDER_DISTANCE = 8; // chunks (radius)
export const UNLOAD_MARGIN = 2; // keep chunks loaded a bit beyond the ring to avoid thrash
export const MAX_GEN_PER_FRAME = 2; // worker requests dispatched per frame
export const MAX_MESH_PER_FRAME = 2; // chunk meshes (re)built per frame

// World seed (fixed + configurable). Override via `?seed=12345` in the URL.
export const DEFAULT_SEED = 1337;

// World <-> chunk coordinate helpers.
export function worldToChunk(w: number): number {
  return Math.floor(w / CX);
}

// Positive modulo for resolving world coords into local chunk coords.
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

// ---------------------------------------------------------------------------
// Phase 1: physics + interaction. All physics values are applied ONCE per fixed
// step (20 TPS) — there is no dt*20 "ticks" multiplier. Tune by feel.
// ---------------------------------------------------------------------------
export const FIXED_DT = 1 / 20; // 0.05s, 20 ticks/sec
export const MAX_FRAME_DT = 0.25; // clamp frame delta -> no spiral of death
export const MAX_SUBSTEPS = 5; // cap fixed steps simulated per frame

export const PLAYER_HALF_WIDTH = 0.3; // hitbox half-extent in X/Z
export const PLAYER_HEIGHT = 1.8; // feet -> head
export const EYE_HEIGHT = 1.62; // camera offset above feet
export const PLAYER_EPS = 1e-3; // flush-snap epsilon

export const GRAVITY = 28; // blocks/s^2
export const TERMINAL_VY = 55; // max fall speed (blocks/s)
export const JUMP_VELOCITY = 9.2; // ~1.25 block jump (sampled) clears a 1-block ledge

export const WALK_SPEED = 4.3; // target ground speed (blocks/s)
export const SPRINT_MULT = 1.45;
export const SNEAK_MULT = 0.35;
export const GROUND_ACCEL = 40; // approach target velocity on ground
export const AIR_ACCEL = 6; // weaker control mid-air
export const GROUND_DRAG = 0.78; // horiz velocity retained per tick (no input, grounded)
export const AIR_DRAG = 0.96;

export const FLY_SPEED = 18; // noclip fly speed (blocks/s)
export const FLY_SPRINT_MULT = 3;

export const REACH = 5; // block interaction distance
export const INSTANT_BREAK = false; // true = creative instant break
export const BREAK_STAGES = 10; // crack overlay stages
