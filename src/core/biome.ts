// Deterministic biome map. PURE and worker-safe (no DOM / THREE) so BOTH the gen
// worker (terrain height, surface blocks, decoration density) and the main-thread
// mesher (grass/leaf colour tint) derive biomes from the same seeded noise.
//
// Continuous fields (temp/humidity/mountainousness) drive terrain HEIGHT so biome
// borders never make cliffs; the discrete biome id only drives surface block choice,
// colour tint, and decoration density.

import { SEA_LEVEL } from './constants';
import { Block } from './BlockTypes';
import { fbm2 } from './noise/fbm';

export enum Biome {
  PLAINS = 0,
  FOREST = 1,
  DESERT = 2,
  SNOWY = 3,
  MOUNTAIN = 4,
}

export interface BiomeFields {
  temp: number; // ~[-1,1]
  humid: number; // ~[-1,1]
  mount: number; // ~[-1,1] "mountainousness"
}

const BIOME_FREQ = 1 / 512; // large regions

export function biomeFields(wx: number, wz: number, seed: number): BiomeFields {
  const temp = fbm2(wx, wz, seed + 1000, { frequency: BIOME_FREQ, octaves: 2, lacunarity: 2, gain: 0.5 });
  const humid = fbm2(wx, wz, seed + 2000, { frequency: BIOME_FREQ, octaves: 2, lacunarity: 2, gain: 0.5 });
  const mount = fbm2(wx, wz, seed + 3000, { frequency: BIOME_FREQ * 0.7, octaves: 2, lacunarity: 2, gain: 0.5 });
  return { temp, humid, mount };
}

// 0..1 mountainousness, used to scale the ridged peak amplitude in surfaceHeight.
export function mountainAmount(mount: number): number {
  const t = Math.max(0, Math.min(1, (mount - 0.12) / (0.5 - 0.12)));
  return t * t * (3 - 2 * t); // smoothstep
}

export function classify(f: BiomeFields, h: number): Biome {
  if (mountainAmount(f.mount) > 0.5 && h > SEA_LEVEL + 12) return Biome.MOUNTAIN;
  if (f.temp < -0.2) return Biome.SNOWY;
  if (f.temp > 0.22 && f.humid < 0.0) return Biome.DESERT;
  if (f.humid > 0.12) return Biome.FOREST;
  return Biome.PLAINS;
}

export interface BiomeDef {
  top: Block; // surface block on land (above the beach line)
  filler: Block; // the few blocks beneath the surface
  // Multiplicative tint on the grass-top / leaf textures (≈1 = unchanged). Plains is
  // the baseline (1,1,1) so today's look is preserved; others shift hue gently.
  grassTint: [number, number, number];
  foliageTint: [number, number, number];
  treeChance: number; // fraction of tree-grid cells that host a tree (0 = none)
}

export const BIOMES: Record<Biome, BiomeDef> = {
  [Biome.PLAINS]: {
    top: Block.GRASS,
    filler: Block.DIRT,
    grassTint: [1.0, 1.0, 1.0],
    foliageTint: [1.0, 1.0, 1.0],
    treeChance: 0.06,
  },
  [Biome.FOREST]: {
    top: Block.GRASS,
    filler: Block.DIRT,
    grassTint: [0.8, 0.92, 0.72],
    foliageTint: [0.74, 0.9, 0.66],
    treeChance: 0.55,
  },
  [Biome.DESERT]: {
    top: Block.SAND,
    filler: Block.SAND,
    grassTint: [0.86, 0.8, 0.5],
    foliageTint: [0.8, 0.76, 0.48],
    treeChance: 0.0,
  },
  [Biome.SNOWY]: {
    top: Block.SNOW,
    filler: Block.DIRT,
    grassTint: [0.82, 0.94, 0.92],
    foliageTint: [0.78, 0.92, 0.88],
    treeChance: 0.1,
  },
  [Biome.MOUNTAIN]: {
    top: Block.GRASS, // grassy lower slopes; rock + snow handled by elevation in WorldGen
    filler: Block.DIRT,
    grassTint: [0.78, 0.88, 0.66],
    foliageTint: [0.72, 0.84, 0.62],
    treeChance: 0.04,
  },
};

// Elevation bands for mountain surfaces (world Y).
export const MOUNTAIN_STONE_Y = 96; // above this, bare rock instead of grass
export const MOUNTAIN_SNOW_Y = 122; // above this, snow-capped peaks
