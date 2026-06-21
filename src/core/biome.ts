// Real-world-grounded biome + terrain-shaping model. PURE and worker-safe (no DOM /
// THREE) so BOTH the gen worker (height, blocks, decoration) and the main-thread mesher
// (grass/leaf tint) derive everything from the same seeded noise.
//
// Approach (à la modern multi-noise terrain + the Whittaker biome scheme):
//   continentalness C -> base height (ocean basins / shelves / coasts / inland)
//   erosion E         -> relief amplitude (flat plains/plateaus vs rugged mountains)
//   weirdness W       -> peaks & valleys ridge (mountain ranges / valleys)
//   temperature T     -> "latitude" MINUS an elevation lapse (mountains stay cold)
//   humidity H        -> precipitation (Whittaker x-axis)
//   river             -> domain-warped winding channels carved to sea level in lowlands
// Continuous fields drive HEIGHT (no cliffs at biome borders); the discrete biome id
// drives surface block, colour tint, and decoration density only.

import { SEA_LEVEL } from './constants';
import { Block } from './BlockTypes';
import { fbm2, ridged2 } from './noise/fbm';
import { spline } from './noise/spline';

export enum Biome {
  DEEP_OCEAN = 0,
  OCEAN = 1,
  FROZEN_OCEAN = 2,
  BEACH = 3,
  SNOWY_BEACH = 4,
  STONY_SHORE = 5,
  RIVER = 6,
  FROZEN_RIVER = 7,
  SNOWY_TUNDRA = 8,
  TAIGA = 9,
  PLAINS = 10,
  FOREST = 11,
  DARK_FOREST = 12,
  SWAMP = 13,
  JUNGLE = 14,
  SAVANNA = 15,
  DESERT = 16,
  BADLANDS = 17,
  MOUNTAIN = 18,
}
export const BIOME_COUNT = 19;

export interface WorldFields {
  C: number; // continentalness ~[-1,1]
  E: number; // erosion ~[-1,1]
  W: number; // weirdness ~[-1,1]
  T: number; // base temperature ~[-1,1] (before elevation lapse)
  H: number; // humidity ~[-1,1]
  river: number; // 0..1 river strength (1 = channel centre)
}

// --- tuning ----------------------------------------------------------------
const CONTINENT_BIAS = 0.05; // shifts the sea crossover; tuned for ~40% ocean.
const RIVER_WIDTH = 0.045; // noise units; larger = wider rivers
const RIVER_MAX_LAND = 18; // only carve rivers where the land base is below SEA_LEVEL+this
const LAPSE = 0.005; // temperature drop per block of elevation above sea (≈ real lapse)
export const MOUNTAIN_Y = 98; // surface at/above this Y reads as MOUNTAIN biome
export const MOUNTAIN_STONE_Y = 106; // bare rock above this
export const MOUNTAIN_SNOW_Y = 118; // snow-capped above this

// continentalness -> base land/sea height. Crossover (= SEA_LEVEL) sits near C≈0 so ~40%
// of the map is ocean. Ocean side drops DEEP (real basins) while keeping shallow sandy
// shelves near coasts; inland base stays moderate (mountains come from the ridge term).
const C_XS = [-1.0, -0.6, -0.35, -0.18, -0.06, 0.08, 0.35, 0.65, 1.0];
const C_YS = [12, 24, 40, 54, 60, 66, 77, 88, 96];
// erosion -> mountain ridge amplitude (low erosion = tall ranges; high = flat plains).
const E_XS = [-1.0, -0.4, 0.0, 0.4, 1.0];
const E_YS = [130, 80, 42, 14, 4];
// Abyssal trenches: a sparse ridged field gouges open-ocean floors toward bedrock.
const TRENCH_DEPTH = 42;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function clamp1(x: number): number {
  return Math.max(-1, Math.min(1, x));
}

export function worldFields(wx: number, wz: number, seed: number): WorldFields {
  const C = fbm2(wx, wz, seed + 1000, { frequency: 1 / 1100, octaves: 3, lacunarity: 2, gain: 0.5 });
  const E = fbm2(wx, wz, seed + 2000, { frequency: 1 / 900, octaves: 3, lacunarity: 2, gain: 0.5 });
  const W = fbm2(wx, wz, seed + 3000, { frequency: 1 / 700, octaves: 3, lacunarity: 2, gain: 0.5 });
  // Widen temp/humidity so the full Whittaker space is used (raw fbm clusters near 0,
  // which would make almost everything temperate-forest).
  const T = clamp1(fbm2(wx, wz, seed + 4000, { frequency: 1 / 1400, octaves: 2, lacunarity: 2, gain: 0.5 }) * 1.8 + 0.06);
  const H = clamp1(fbm2(wx, wz, seed + 5000, { frequency: 1 / 1200, octaves: 2, lacunarity: 2, gain: 0.5 }) * 1.8);

  // River: domain-warped winding noise; strength peaks at its zero-crossing.
  const warpX = fbm2(wx, wz, seed + 6000, { frequency: 1 / 220, octaves: 2 }) * 45;
  const warpZ = fbm2(wx, wz, seed + 6100, { frequency: 1 / 220, octaves: 2 }) * 45;
  const r = fbm2(wx + warpX, wz + warpZ, seed + 6200, { frequency: 1 / 650, octaves: 2 });
  const river = 1 - smoothstep(0, RIVER_WIDTH, Math.abs(r));

  return { C, E, W, T, H, river };
}

// Base height purely from continentalness (where land vs ocean basins sit).
export function continentBase(C: number): number {
  return spline(C + CONTINENT_BIAS, C_XS, C_YS);
}

// Full terrain height: continental base + gentle rolling hills (signed) + upward-only
// mountain ridges (so oceans stay where continentalness says; ranges rise on land where
// erosion is low). Carves rivers to sea level in lowlands. Integer Y, clamped.
export function terrainHeight(wx: number, wz: number, seed: number, f: WorldFields, maxY: number): number {
  const base = continentBase(f.C);
  const hills = fbm2(wx, wz, seed + 7, { frequency: 1 / 110, octaves: 4, lacunarity: 2, gain: 0.5 }) * 10;
  const land = base + hills;

  // Mountains: a ridged field added UPWARD, scaled by erosion's amplitude, and masked to
  // land so the sea floor isn't pushed up. Squared ridge -> sharper, clustered ranges.
  const mAmp = spline(f.E, E_XS, E_YS);
  const landMask = smoothstep(SEA_LEVEL - 6, SEA_LEVEL + 12, land);
  // ridged2 already squares per octave (~[0,0.65]); use it directly (no extra square).
  const ridge = ridged2(wx, wz, seed + 4000, { frequency: 1 / 230, octaves: 4, lacunarity: 2, gain: 0.5 });
  const mountains = ridge * mAmp * landMask;

  const detail = fbm2(wx, wz, seed + 13, { frequency: 1 / 40, octaves: 2, lacunarity: 2, gain: 0.5 }) * 3;
  let h = land + mountains + detail;

  // Abyssal trenches: gouge open-ocean floors (low landMask) toward bedrock where a sparse
  // ridged field peaks -> dramatic deeps. Squared gate keeps them rare/localized.
  if (landMask < 0.5) {
    const tr = ridged2(wx, wz, seed + 5000, { frequency: 1 / 300, octaves: 3, lacunarity: 2, gain: 0.5 });
    const trench = smoothstep(0.5, 0.85, tr);
    h -= trench * trench * TRENCH_DEPTH * (1 - landMask);
  }

  // Rivers: carve a channel toward sea level, but only in lowland land (not mountains),
  // so they connect to the ocean instead of floating on peaks.
  if (f.river > 0.5 && base < SEA_LEVEL + RIVER_MAX_LAND) {
    const carve = (f.river - 0.5) * 2; // 0..1
    h += (SEA_LEVEL - 1 - h) * carve;
  }

  h = Math.round(h);
  if (h < 1) h = 1;
  if (h > maxY) h = maxY;
  return h;
}

// Effective temperature: latitude proxy minus elevation lapse (higher = colder).
export function effTemp(f: WorldFields, h: number): number {
  return f.T - LAPSE * Math.max(0, h - SEA_LEVEL);
}

export function classify(f: WorldFields, h: number): Biome {
  const teff = effTemp(f, h);
  const oceanBase = continentBase(f.C); // sea vs land by continent (ignores river carving)

  // Water bodies.
  if (h < SEA_LEVEL) {
    const frozen = teff < -0.33;
    // A carved channel sitting in otherwise-land continent reads as a river.
    if (oceanBase >= SEA_LEVEL && f.river > 0.5) return frozen ? Biome.FROZEN_RIVER : Biome.RIVER;
    if (frozen) return Biome.FROZEN_OCEAN;
    return h < SEA_LEVEL - 12 ? Biome.DEEP_OCEAN : Biome.OCEAN;
  }

  // Coastline (land within a couple blocks of the sea).
  if (h <= SEA_LEVEL + 2) {
    if (teff < -0.25) return Biome.SNOWY_BEACH;
    if (f.E < -0.4) return Biome.STONY_SHORE; // rugged, rocky coast
    return Biome.BEACH;
  }

  // High elevation -> mountains (rocky / snow handled by Y in WorldGen).
  if (h >= MOUNTAIN_Y) return Biome.MOUNTAIN;

  // Whittaker land by (temperature, humidity).
  if (teff < -0.25) {
    return f.H < -0.1 ? Biome.SNOWY_TUNDRA : Biome.TAIGA; // cold
  }
  if (teff < 0.15) {
    // temperate
    if (f.H < -0.15) return Biome.PLAINS;
    if (f.H < 0.15) return Biome.FOREST;
    if (f.H < 0.4) return Biome.DARK_FOREST;
    return Biome.SWAMP; // very wet, low temperate
  }
  // hot
  if (f.H < -0.1) return f.E > 0.2 ? Biome.BADLANDS : Biome.DESERT; // eroded hot+dry = mesa
  if (f.H < 0.12) return Biome.SAVANNA;
  return Biome.JUNGLE; // hot + not-dry (tropics are wet)
}

export interface BiomeDef {
  top: Block;
  filler: Block;
  // Multiplicative tint on grass-top / leaf textures (≈1 = unchanged; plains baseline).
  grassTint: [number, number, number];
  foliageTint: [number, number, number];
  treeChance: number; // fraction of tree-grid cells with a tree (0 = none)
}

const NONE: [number, number, number] = [1, 1, 1];

export const BIOMES: Record<Biome, BiomeDef> = {
  [Biome.DEEP_OCEAN]: { top: Block.GRAVEL, filler: Block.GRAVEL, grassTint: NONE, foliageTint: NONE, treeChance: 0 },
  [Biome.OCEAN]: { top: Block.SAND, filler: Block.SAND, grassTint: NONE, foliageTint: NONE, treeChance: 0 },
  [Biome.FROZEN_OCEAN]: { top: Block.GRAVEL, filler: Block.GRAVEL, grassTint: NONE, foliageTint: NONE, treeChance: 0 },
  [Biome.BEACH]: { top: Block.SAND, filler: Block.SAND, grassTint: NONE, foliageTint: NONE, treeChance: 0 },
  [Biome.SNOWY_BEACH]: { top: Block.SNOW, filler: Block.SAND, grassTint: NONE, foliageTint: NONE, treeChance: 0 },
  [Biome.STONY_SHORE]: { top: Block.GRAVEL, filler: Block.STONE, grassTint: NONE, foliageTint: NONE, treeChance: 0 },
  [Biome.RIVER]: { top: Block.SAND, filler: Block.SAND, grassTint: NONE, foliageTint: NONE, treeChance: 0 },
  [Biome.FROZEN_RIVER]: { top: Block.SAND, filler: Block.SAND, grassTint: NONE, foliageTint: NONE, treeChance: 0 },
  [Biome.SNOWY_TUNDRA]: { top: Block.SNOW, filler: Block.DIRT, grassTint: [0.8, 0.86, 0.78], foliageTint: [0.75, 0.83, 0.72], treeChance: 0.04 },
  [Biome.TAIGA]: { top: Block.GRASS, filler: Block.DIRT, grassTint: [0.62, 0.78, 0.62], foliageTint: [0.5, 0.68, 0.5], treeChance: 0.45 },
  [Biome.PLAINS]: { top: Block.GRASS, filler: Block.DIRT, grassTint: NONE, foliageTint: NONE, treeChance: 0.05 },
  [Biome.FOREST]: { top: Block.GRASS, filler: Block.DIRT, grassTint: [0.82, 0.94, 0.7], foliageTint: [0.74, 0.9, 0.62], treeChance: 0.5 },
  [Biome.DARK_FOREST]: { top: Block.GRASS, filler: Block.DIRT, grassTint: [0.62, 0.78, 0.5], foliageTint: [0.45, 0.62, 0.36], treeChance: 0.7 },
  [Biome.SWAMP]: { top: Block.GRASS, filler: Block.DIRT, grassTint: [0.55, 0.62, 0.42], foliageTint: [0.5, 0.6, 0.4], treeChance: 0.25 },
  [Biome.JUNGLE]: { top: Block.GRASS, filler: Block.DIRT, grassTint: [0.36, 0.74, 0.28], foliageTint: [0.3, 0.66, 0.24], treeChance: 0.75 },
  [Biome.SAVANNA]: { top: Block.GRASS, filler: Block.DIRT, grassTint: [0.78, 0.74, 0.38], foliageTint: [0.72, 0.7, 0.36], treeChance: 0.08 },
  [Biome.DESERT]: { top: Block.SAND, filler: Block.SANDSTONE, grassTint: [0.86, 0.8, 0.5], foliageTint: [0.8, 0.76, 0.48], treeChance: 0.06 },
  [Biome.BADLANDS]: { top: Block.RED_SAND, filler: Block.TERRACOTTA, grassTint: [0.86, 0.7, 0.45], foliageTint: [0.8, 0.66, 0.42], treeChance: 0.05 },
  [Biome.MOUNTAIN]: { top: Block.GRASS, filler: Block.DIRT, grassTint: [0.7, 0.82, 0.62], foliageTint: [0.6, 0.74, 0.54], treeChance: 0.06 },
};
