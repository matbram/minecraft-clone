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

// ---------------------------------------------------------------------------
// Phase 3: lighting.
// ---------------------------------------------------------------------------
export const MAX_LIGHT = 15;
export const SKY_DEFAULT = 15; // light above the world top
export const MAX_LIGHT_PER_FRAME = 3; // chunks fully (re)lit per frame (throttle)
export const LIGHT_AMBIENT = 0.06; // uAmbient: cave floor so dark != pure black
export const DAY_FACTOR_DEFAULT = 1.0; // uDayFactor: full day (Phase 4a animates)
// Ambient-occlusion brightness by occlusion level (0 = darkest corner .. 3 = open).
export const AO_CURVE = [0.45, 0.65, 0.85, 1.0];

// ---------------------------------------------------------------------------
// Phase 4a: cinematic basics (day/night, post FX, presets).
// ---------------------------------------------------------------------------
export const DAY_CYCLE_SECONDS = 480; // full day/night cycle length
export const DAY_START_PHASE = 0.3; // bright mid-morning on first load
export const DAY_FF_MULT = 60; // hold-to-fast-forward multiplier

export const TONE_EXPOSURE = 1.05; // ACES exposure (OutputPass)
export const BLOOM_THRESHOLD = 0.85;
export const BLOOM_STRENGTH = 0.55;
export const BLOOM_RADIUS = 0.4;

export const GODRAYS_DENSITY = 0.92;
export const GODRAYS_WEIGHT = 0.35;
export const GODRAYS_DECAY = 0.95;
export const GODRAYS_EXPOSURE = 0.5;

export const WIND_STRENGTH = 0.06; // foliage sway amplitude (block units)
export const WIND_SPEED = 1.6;
export const STAR_COUNT = 1400;

export const FOG_DENSITY_DAY = 0.0145;
export const FOG_DENSITY_NIGHT = 0.02;

export const RENDER_DISTANCE_LOW = 5;
export const RENDER_DISTANCE_MED = 8; // == RENDER_DISTANCE (Medium holds 60fps)
export const RENDER_DISTANCE_CINEMATIC = 11;

// ---------------------------------------------------------------------------
// Phase 4b: dynamic sun shadows + reflective water (Cinematic only).
// ---------------------------------------------------------------------------
// Render layers. Opaque chunks live on DEFAULT (+ SHADOW_CASTER so the sun-depth
// pass sees only them); transparent (water/glass) chunks live ONLY on TRANSPARENT
// so the planar-reflection camera (DEFAULT mask) never reflects the water itself.
export const LAYER_DEFAULT = 0;
export const LAYER_TRANSPARENT = 1;
export const LAYER_SHADOW_CASTER = 2;

export const SHADOW_MAP_SIZE = 2048;
export const SHADOW_CASCADE0 = 32; // near cascade box half-extent (blocks) -> crisp
export const SHADOW_CASCADE1 = 96; // far cascade box half-extent (blocks)
export const SHADOW_CAM_DIST = 240; // light cam distance from box center along sunDir
export const SHADOW_DEPTH = 520; // ortho far plane (covers full vertical caster spread)
export const SHADOW_STRENGTH = 0.55; // how dark fully-shadowed sky light gets

export const WATER_SURFACE_Y = SEA_LEVEL + 1; // every water top-face sits here
export const REFLECT_DOWNSCALE = 0.5; // planar reflection render-target scale

// ---------------------------------------------------------------------------
// Phase 5: swimming / water physics. Applied per fixed step (20 TPS), same as
// the land physics above. Tune by feel.
// ---------------------------------------------------------------------------
export const WATER_GRAVITY = 9; // gentle sink (vs GRAVITY 28) -> buoyant feel
export const WATER_VERTICAL_DRAG = 0.8; // per-tick vy damping -> smooth bob
export const WATER_MAX_SINK = 6; // clamp downward swim speed (blocks/s)
export const WATER_MAX_RISE = 6; // clamp upward swim speed (blocks/s)
export const SWIM_UP_ACCEL = 30; // hold Space to rise toward the surface
export const SWIM_DOWN_ACCEL = 24; // hold Shift to dive
export const SWIM_SPEED = 3.0; // horizontal swim speed (vs WALK_SPEED 4.3)
export const SWIM_SPRINT_MULT = 1.35; // sprint-swim multiplier
export const SWIM_ACCEL = 22; // horizontal accel in water
export const WATER_DRAG = 0.8; // horizontal water friction (no input)

export const UNDERWATER_FOG_DENSITY = 0.09; // murky, short view when submerged
export const UNDERWATER_FOG_COLOR = 0x2a5e7a; // deep blue-teal

// ---------------------------------------------------------------------------
// Phase 6: flowing water (Minecraft-style). The flow level lives in a parallel
// `fluid` byte per cell (only meaningful where the block id is WATER):
//   low 3 bits = level (0 = source/full, 1..7 = thinning), bit 0x08 = falling.
// ---------------------------------------------------------------------------
export const FLUID_TICK_DELAY = 5; // ticks before an enqueued cell updates (MC water)
export const MAX_FLUID_OPS_PER_TICK = 256; // cells processed per 20 TPS tick (throttle)
export const FLUID_MAX_LEVEL = 7; // 1..7 flowing; 0 = source
export const FLUID_FALLING = 0x08; // falling-bit in the fluid byte
export const FLUID_LEVEL_MASK = 0x07;
// Level -> visual top height (fraction of a block). Sources/falling render full.
export const FLUID_HEIGHTS = [1.0, 0.875, 0.75, 0.625, 0.5, 0.375, 0.25, 0.125];
