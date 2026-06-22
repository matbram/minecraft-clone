// Phase 11.3: live, mutable runtime config the engine reads each frame (uniforms)
// or each bake (light/mesh). The in-game Tuning panel mutates these; Settings seeds
// them at startup and persists changes. Seeded from the constants so the defaults
// match the shipped 11.2 realism look.
//
// Apply paths (see ChunkManager): `brightness`, `dayLengthMult`, `underwaterDensity`,
// `underwaterTint` are LIVE (picked up next frame). `waterAbsorb` feeds the mesh bake
// (REMESH loaded chunks on change). `skySideCost` feeds the light BFS (RELIGHT + remesh).

import {
  TONE_EXPOSURE,
  SKY_SIDE_COST,
  WATER_LIGHT_ABSORB,
  UNDERWATER_VISIBILITY_DENSITY,
  UW_VEIL_BASE,
  WATER_SURFACE_VISIBILITY,
} from './constants';

export interface TunableValues {
  brightness: number; // ACES exposure (post path)
  skySideCost: number; // sky-light side cost ("cave darkness"); RELIGHT on change
  waterAbsorb: number; // light lost per water block of depth; REMESH on change
  underwaterDensity: number; // per-meter underwater view fog (clarity / visibility)
  underwaterTint: number; // screen veil strength underwater
  waterSurface: number; // visibility of the surface ceiling seen from below (0 = off)
  dayLengthMult: number; // day/night speed multiplier (1 = default)
  explosionPower: number; // Phase 15.1: rocket blast size/damage multiplier (live)
}

export const TUNABLE_DEFAULTS: Readonly<TunableValues> = {
  brightness: TONE_EXPOSURE,
  skySideCost: SKY_SIDE_COST,
  waterAbsorb: WATER_LIGHT_ABSORB,
  underwaterDensity: UNDERWATER_VISIBILITY_DENSITY,
  underwaterTint: UW_VEIL_BASE,
  waterSurface: WATER_SURFACE_VISIBILITY,
  dayLengthMult: 1,
  explosionPower: 1,
};

export const Tunables: TunableValues = { ...TUNABLE_DEFAULTS };

export function resetTunables(): void {
  Object.assign(Tunables, TUNABLE_DEFAULTS);
}
