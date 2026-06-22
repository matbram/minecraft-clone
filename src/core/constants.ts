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
export const LIGHT_AMBIENT = 0.0; // no fake floor: unlit caves/interiors are black (need a light)
export const DAY_FACTOR_DEFAULT = 1.0; // uDayFactor: full day (Phase 4a animates)
// Phase 11.2: sky-light spread cost for every NON-sunbeam step (horizontal / up /
// attenuated-down). A straight-down step from a full (15) cell stays free (a real
// sunbeam down a shaft); everything else costs this, so daylight dies ~5 blocks into
// caves instead of bleeding 15. Higher = darker caves. (Default for Tunables.skySideCost.)
export const SKY_SIDE_COST = 3;
// Ambient-occlusion brightness by occlusion level (0 = darkest corner .. 3 = open).
export const AO_CURVE = [0.45, 0.65, 0.85, 1.0];

// ---------------------------------------------------------------------------
// Phase 4a: cinematic basics (day/night, post FX, presets).
// ---------------------------------------------------------------------------
export const DAY_CYCLE_SECONDS = 1200; // full day/night cycle (20 min; gradual twilight)
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

// Phase 7a: moonlight. Night directional light from the moon (= -sunDir), a faint
// unshadowed skyglow floor (so moon shadows aren't pitch black), and a cool tint.
export const MOON_LIGHT_STRENGTH = 0.22; // moonlit sky-light vs full day (1.0)
export const MOON_SHADOW_STRENGTH = 0.35; // softer than the sun's SHADOW_STRENGTH
export const NIGHT_AMBIENT = 0.1; // unshadowed night skyglow floor
export const MOON_TINT = 0xb3ccff; // cool blue cast applied to moonlit surfaces

// ---------------------------------------------------------------------------
// Phase 12.5: space layer. Flying very high transitions the flat world to space
// (sky → black, stars in by day, fog opens up) with physical 3D sun/moon and a
// curved planet backdrop. altT = smoothstep(SPACE_START_Y, SPACE_FULL_Y, camY);
// at altT=0 (ground) every space effect is a no-op so the surface look is unchanged.
// ---------------------------------------------------------------------------
export const SPACE_START_Y = 320; // altitude where the space transition begins (above the build top)
export const SPACE_FULL_Y = 1500; // altitude of full space (black sky, full stars, planet visible)
export const CAMERA_NEAR = 0.25; // near plane (nudged up from 0.1 for z-precision with the big far)
export const CAMERA_FAR = 12000; // far plane (was 1000) so the distant sun/moon + planet fit in clip space
// Physical sun/moon: real 3D spheres at a large finite offset from the camera
// (they read as distant bodies; sizes tuned so the ground-level apparent size ≈ the old sprites).
export const SUN_DIST = 4000;
export const MOON_DIST = 3800;
export const SUN_RADIUS = 175;
export const MOON_RADIUS = 150;
export const SUN_GLOW_SCALE = 1300; // additive halo sprite size (atmospheric glow; fades in vacuum)
export const MOON_GLOW_SCALE = 750;
export const MOON_SYNODIC_DAYS = 8; // in-game days for one full lunar phase cycle (visual only)
// Planet backdrop (Stage 12.5b).
export const PLANET_R = 6000; // planet sphere radius (surface aligned near sea level below the camera)
export const PLANET_ATMOSPHERE = 1.035; // atmosphere shell radius as a multiple of PLANET_R

export const RENDER_DISTANCE_LOW = 5;
export const RENDER_DISTANCE_MED = 8; // == RENDER_DISTANCE (Medium holds 60fps)
export const RENDER_DISTANCE_CINEMATIC = 11;

// Phase 11a: user-settable look sensitivity (radians of yaw per pixel of mouse
// movement). Default mirrors the old hardcoded Input value; the settings menu
// lets the player tune it and persists the choice.
export const DEFAULT_SENSITIVITY = 0.0025;
export const SENSITIVITY_MIN = 0.0008;
export const SENSITIVITY_MAX = 0.006;
// Render-distance slider bounds (chunk ring radius). Min keeps the world coherent;
// max is generous for strong machines (presets stay 5/8/11).
export const RENDER_DISTANCE_MIN = 3;
export const RENDER_DISTANCE_MAX = 16;

// ---------------------------------------------------------------------------
// Phase 11b: survival (health / hunger / air, fall damage, drowning, hunger,
// death/respawn). Only active when the Survival setting is on (default Creative).
// Tune by feel. Health/hunger are 0..20 (10 icons, half-icon granularity), air 0..10.
// ---------------------------------------------------------------------------
export const MAX_HEALTH = 20;
export const MAX_HUNGER = 20;
export const MAX_AIR = 10;

export const SAFE_FALL_BLOCKS = 3; // free fall up to this many blocks; damage = blocks beyond
export const AIR_SECONDS = 15; // seconds of breath underwater before air runs out
export const DROWN_DPS = 2; // health lost per second once air hits 0
export const AIR_REFILL_DPS = 5; // air regained per second above water

export const HUNGER_DRAIN_BASE = 0.06; // hunger lost per second standing still
export const HUNGER_DRAIN_MOVE = 0.18; // extra hunger/sec while moving (scaled by sprint)
export const REGEN_HUNGER = 18; // health regenerates while hunger is at/above this
export const REGEN_DPS = 1; // health regained per second when well-fed
export const REGEN_HUNGER_COST = 0.4; // hunger spent per second of regen
export const STARVE_DPS = 1; // health lost per second at 0 hunger
export const STARVE_FLOOR = 1; // starvation never drops health below this (not lethal)

export const FOOD_RESTORE_APPLE = 6; // hunger restored per apple eaten
export const RESPAWN_FLASH_SECONDS = 1; // red death-flash duration before/while respawning

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

export const UNDERWATER_FOG_DENSITY = 0.04; // shallow: clear & sunlit, see a good distance
export const UNDERWATER_FOG_COLOR = 0x3f86a0; // lit cyan near the surface (not a black void)

// Phase 7b/9: underwater. Murk/darkening ramps with how deep the eye is below
// WATER_SURFACE_Y (over UNDERWATER_MAX_DEPTH): clear & shaft-lit shallow -> moody
// dark deep. Plus caustics, a scattered ambient fill, and drifting motes.
export const UNDERWATER_DEEP_COLOR = 0x0a2230; // near-black blue at depth
export const UNDERWATER_SURFACE_COLOR = 0x3a7a8c; // lit teal toward the surface (looking up)
export const UNDERWATER_DEEP_FOG_DENSITY = 0.16; // denser/darker the deeper you go
export const UNDERWATER_MAX_DEPTH = 32; // blocks below surface for full murk (gradual)
export const CAUSTIC_STRENGTH = 0.22; // rippling-light highlight amount (less spotlighting)
export const WATER_LIGHT_ABSORB = 0.15; // sky light lost per water block above a surface (baked)
export const UNDERWATER_LIGHT_DEPTH = 20; // blocks over which surface light (sky/sun/rays) fades

// Phase 11.2: underwater realism is driven by the LOCAL water column above the eye
// (waterDepthAbove) + the baked light actually present there — NOT absolute depth
// below sea level. So 2 blocks of water reads clear (bright if lit, dark in a cave),
// and only a real deep column darkens/blues out. These are the Tunables defaults.
export const UNDERWATER_COLOR_DEPTH = 16; // water-above (blocks) for full deep-color + sky fade
export const UNDERWATER_VISIBILITY_DENSITY = 0.05; // constant per-meter view fog (clarity)
export const UW_VEIL_BASE = 0.45; // screen-tint veil strength (scaled by available light)
export const UNDERWATER_PARTICLES = 160; // drifting motes/plankton count
export const WATER_SURFACE_VISIBILITY = 0.85; // how visible the surface ceiling is from below (tunable)
export const WATER_CEILING_CYAN = 0x6fd0e8; // bright lit cyan of the surface seen from below
export const WATER_CEILING_EDGE = 0x0b3a55; // ocean-blue toward grazing/edges (built-in vignette)

// ---------------------------------------------------------------------------
// Phase 15: rocket launcher + Michael-Bay explosions. 1 block = 1 m; times in
// seconds. Numbers tuned for a "big satisfying rocket" (web-researched real
// blast falloff translated to game feel) — see the rocket research design note.
// ---------------------------------------------------------------------------
export const ROCKET_SPEED = 45; // rocket flight speed (blocks/s): fast but trackable
export const ROCKET_GRAVITY = 4; // gentle drop so the rocket arcs a little over range
export const ROCKET_MAX_RANGE = 160; // air-burst / despawn distance (blocks)
export const ROCKET_TRAIL_DT = 0.02; // seconds between smoke-trail puffs along the path
export const ROCKET_COOLDOWN = 0.8; // seconds between shots
export const ROCKET_RADIUS = 0.18; // visual rocket half-size

export const SPEED_OF_SOUND = 343; // m/s -> flash→boom delay = dist_blocks / 343

// Blast model (all radii in blocks). Force/overpressure fall off as ~1/r^2 (capped).
export const EXPLOSION_CRATER_R = 4; // permanent crater radius (bowl: full ≤ inner, partial to R)
export const EXPLOSION_CRATER_INNER = 3; // full-removal core radius
export const EXPLOSION_DAMAGE_R = 8; // AoE damage outer edge
export const EXPLOSION_DAMAGE_INNER = 2.5; // lethal / full-damage inner radius (self-damage zone)
export const EXPLOSION_MAX_DAMAGE = 20; // half-hearts at the center (== MAX_HEALTH -> lethal)
export const EXPLOSION_KNOCKBACK_R = 12; // you feel the push past the damage edge
export const EXPLOSION_KNOCKBACK = 30; // peak impulse (blocks/s) at the center
export const EXPLOSION_KNOCKBACK_UP = 0.4; // extra upward fraction of the impulse
export const EXPLOSION_SHAKE_R = 25; // screen-shake (camera trauma) falloff radius
export const EXPLOSION_FIREBALL_R = 6; // Bay-exaggerated fireball radius
export const EXPLOSION_SHOCKWAVE_SPEED = 40; // ring expansion (blocks/s) — outruns the fireball
export const EXPLOSION_SHOCKWAVE_R = 15; // ring fades out by here
export const EXPLOSION_FIRE_COUNT = 6; // temporary FIRE blocks dropped in the crater
export const FIRE_LIFETIME_MIN = 4; // seconds a placed FIRE block lasts (min)
export const FIRE_LIFETIME_MAX = 8; // seconds a placed FIRE block lasts (max)

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
