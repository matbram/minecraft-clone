// Procedural world generation. PURE and worker-safe (no DOM / THREE).
//
// generateChunk() produces terrain + caves + ore + a per-column biome map, plus a list
// of deterministic feature DECISIONS (trees). Terrain shape + biomes come from the
// multi-noise / Whittaker model in core/biome.ts. Feature PLACEMENT happens on the main
// thread (see World.placeFeatures) because cross-chunk spillover needs World.pending.

import { BLOCKS, COLS, CX, CZ, CY, SEA_LEVEL, BEDROCK_Y, idx, colIdx } from './constants';
import { Block } from './BlockTypes';
import { fbm3, ridged3 } from './noise/fbm';
import { hash2, hash3 } from './noise/hash';
import {
  worldFields,
  terrainHeight,
  classify,
  BIOMES,
  Biome,
  MOUNTAIN_Y,
  MOUNTAIN_STONE_Y,
  MOUNTAIN_SNOW_Y,
} from './biome';
import { TreeType, type FeatureDecision } from './features';

export interface GenResult {
  data: Uint8Array;
  heightMap: Uint8Array; // highest non-air y + 1 per column (incl. water)
  biomeMap: Uint8Array; // biome id per column (for mesh tint + later spawn rules)
  maxY: number;
  features: FeatureDecision[];
}

const MAX_TERRAIN_Y = CY - 40; // leave headroom for trees/structures

// Convenience height (computes fields internally). Used by tree placement + spawn search.
export function surfaceHeight(wx: number, wz: number, seed: number): number {
  const f = worldFields(wx, wz, seed);
  return terrainHeight(wx, wz, seed, f, MAX_TERRAIN_Y);
}

// Find dry, walkable land near the origin so the player never spawns in the ocean or on a
// peak (with ~30-40% ocean this matters). Spirals outward for a column above the beach line
// and below the mountains; falls back to the origin column.
export function findLandSpawn(seed: number, cx = 8, cz = 8): { x: number; y: number; z: number } {
  for (let r = 0; r <= 256; r += 4) {
    const steps = Math.max(1, r * 2);
    for (let a = 0; a < steps; a++) {
      const ang = (a / steps) * Math.PI * 2;
      const x = Math.floor(cx + Math.cos(ang) * r);
      const z = Math.floor(cz + Math.sin(ang) * r);
      const h = surfaceHeight(x, z, seed);
      if (h >= SEA_LEVEL + 2 && h < MOUNTAIN_Y) return { x: x + 0.5, y: h + 2, z: z + 0.5 };
    }
  }
  const h = surfaceHeight(cx, cz, seed);
  return { x: cx + 0.5, y: Math.max(h, SEA_LEVEL) + 2, z: cz + 0.5 };
}

// --- caves -----------------------------------------------------------------

function isCave(wx: number, y: number, wz: number, seed: number): boolean {
  // Cheese caverns: connected sheets where a low-freq 3D field crosses zero.
  const cheese = fbm3(wx, y, wz, seed + 31, { frequency: 1 / 40, octaves: 2, lacunarity: 2, gain: 0.5 });
  if (Math.abs(cheese) < 0.05) return true;

  // Spaghetti tunnels: intersection of two ridged fields -> 1D winding tunnels.
  const r1 = ridged3(wx, y, wz, seed + 101, 1 / 44);
  const r2 = ridged3(wx, y, wz, seed + 211, 1 / 44);
  if (r1 > 0.9 && r2 > 0.9) return true;

  return false;
}

// --- ore -------------------------------------------------------------------

function oreAt(wx: number, y: number, wz: number, seed: number): Block {
  const r = hash3(wx, y, wz, seed + 909);
  if (y < 16 && r < 0.006) return Block.GOLD_ORE;
  if (y < 40 && r < 0.012) return Block.IRON_ORE;
  if (y < 64 && r < 0.02) return Block.COAL_ORE;
  return Block.STONE;
}

// --- ground plants (inline, single local cells) ----------------------------

function treeTypeForBiome(biome: Biome): TreeType {
  switch (biome) {
    case Biome.TAIGA:
    case Biome.SNOWY_TUNDRA:
    case Biome.MOUNTAIN:
      return TreeType.SPRUCE;
    case Biome.JUNGLE:
      return TreeType.JUNGLE;
    case Biome.SAVANNA:
      return TreeType.ACACIA;
    case Biome.DESERT:
    case Biome.BADLANDS:
      return TreeType.CACTUS;
    default:
      return TreeType.OAK;
  }
}

// Choose a decorative plant for a land column (deterministic). Returns AIR for none.
// Green plants need grassy ground (grass/podzol); dead bush grows on sand/red sand.
function pickPlant(biome: Biome, surface: Block, wx: number, wz: number, seed: number): Block {
  const grassy = surface === Block.GRASS || surface === Block.PODZOL;
  const sandy = surface === Block.SAND || surface === Block.RED_SAND;
  if (!grassy && !sandy) return Block.AIR;
  const r = hash2(wx, wz, seed + 800); // density
  const s = hash2(wx, wz, seed + 801); // selection
  if (grassy) {
    switch (biome) {
      case Biome.PLAINS:
        if (r < 0.22) return s < 0.86 ? Block.TALL_GRASS : s < 0.94 ? Block.FLOWER_RED : Block.FLOWER_YELLOW;
        break;
      case Biome.FOREST:
      case Biome.DARK_FOREST:
        if (r < 0.34) return s < 0.55 ? Block.TALL_GRASS : s < 0.8 ? Block.FERN : s < 0.92 ? Block.FLOWER_RED : Block.FLOWER_YELLOW;
        break;
      case Biome.TAIGA:
        if (r < 0.3) return s < 0.65 ? Block.FERN : Block.TALL_GRASS;
        break;
      case Biome.JUNGLE:
        if (r < 0.5) return s < 0.55 ? Block.FERN : Block.TALL_GRASS;
        break;
      case Biome.SWAMP:
        if (r < 0.32) return s < 0.7 ? Block.TALL_GRASS : Block.FERN;
        break;
      case Biome.SAVANNA:
        if (r < 0.24) return Block.TALL_GRASS;
        break;
      case Biome.MOUNTAIN:
        if (r < 0.12) return s < 0.7 ? Block.TALL_GRASS : Block.FLOWER_YELLOW;
        break;
      case Biome.SNOWY_TUNDRA:
        if (r < 0.06) return Block.TALL_GRASS;
        break;
    }
  } else if (sandy && (biome === Biome.DESERT || biome === Biome.BADLANDS)) {
    if (r < 0.05) return Block.DEAD_BUSH;
  }
  return Block.AIR;
}

// --- feature decisions -----------------------------------------------------

const TREE_CELL = 5; // one candidate tree per 5x5 world-cell -> natural spacing

function collectTreeDecisions(cx: number, cz: number, seed: number, out: FeatureDecision[]): void {
  const minWx = cx * CX;
  const minWz = cz * CZ;
  const g0x = Math.floor(minWx / TREE_CELL) - 1;
  const g1x = Math.floor((minWx + CX - 1) / TREE_CELL) + 1;
  const g0z = Math.floor(minWz / TREE_CELL) - 1;
  const g1z = Math.floor((minWz + CZ - 1) / TREE_CELL) + 1;

  for (let gz = g0z; gz <= g1z; gz++) {
    for (let gx = g0x; gx <= g1x; gx++) {
      const ox = Math.floor(hash2(gx, gz, seed + 556) * TREE_CELL);
      const oz = Math.floor(hash2(gx, gz, seed + 557) * TREE_CELL);
      const wx = gx * TREE_CELL + ox;
      const wz = gz * TREE_CELL + oz;
      // Only emit decisions whose ANCHOR is inside this chunk (avoids double placement).
      if (wx < minWx || wx >= minWx + CX || wz < minWz || wz >= minWz + CZ) continue;

      const f = worldFields(wx, wz, seed);
      const h = terrainHeight(wx, wz, seed, f, MAX_TERRAIN_Y);
      if (h <= SEA_LEVEL + 1) continue; // no trees underwater / on beaches
      const biome = classify(f, h);
      const treeChance = BIOMES[biome].treeChance;
      if (treeChance <= 0 || hash2(gx, gz, seed + 555) > treeChance) continue;
      const variant = Math.floor(hash2(gx, gz, seed + 558) * 5);
      out.push({ wx, wy: h, wz, kind: 'tree', tree: treeTypeForBiome(biome), variant });
    }
  }
}

// --- chunk assembly --------------------------------------------------------

export function generateChunk(cx: number, cz: number, seed: number): GenResult {
  const data = new Uint8Array(BLOCKS);
  const heightMap = new Uint8Array(COLS);
  const biomeMap = new Uint8Array(COLS);
  let maxY = 0;

  for (let lz = 0; lz < CZ; lz++) {
    for (let lx = 0; lx < CX; lx++) {
      const wx = cx * CX + lx;
      const wz = cz * CZ + lz;
      const fields = worldFields(wx, wz, seed);
      const h = terrainHeight(wx, wz, seed, fields, MAX_TERRAIN_Y);
      const biome = classify(fields, h);
      biomeMap[colIdx(lx, lz)] = biome;
      const underwater = h < SEA_LEVEL;

      // Surface + sub-surface blocks from the biome, with terrain-aware specials.
      const def = BIOMES[biome];
      let surfaceBlock = def.top;
      let fillerBlock = def.filler;
      if (underwater) {
        // Ocean/river floor: sandy on the shallow shelf, gravel in the depths.
        const deep = biome === Biome.DEEP_OCEAN || SEA_LEVEL - h > 4;
        surfaceBlock = deep ? Block.GRAVEL : Block.SAND;
        fillerBlock = deep ? Block.GRAVEL : Block.SAND;
      } else if (biome === Biome.MOUNTAIN) {
        if (h >= MOUNTAIN_SNOW_Y) {
          surfaceBlock = Block.SNOW;
          fillerBlock = Block.STONE;
        } else if (h >= MOUNTAIN_STONE_Y) {
          surfaceBlock = Block.STONE;
          fillerBlock = Block.STONE;
        }
      } else if (biome === Biome.TAIGA && hash2(wx, wz, seed + 777) < 0.4) {
        surfaceBlock = Block.PODZOL; // podzol patches
      }

      let columnTop = 0;

      for (let y = 0; y <= h; y++) {
        let b: Block;
        if (y === BEDROCK_Y) {
          b = Block.BEDROCK;
        } else if (y === h) {
          b = surfaceBlock;
        } else if (y > h - 4) {
          b = fillerBlock;
        } else {
          b = oreAt(wx, y, wz, seed);
        }

        // Carve caves out of solid ground (never bedrock, never the very surface).
        if (b !== Block.BEDROCK && y < h && y > BEDROCK_Y && isCave(wx, y, wz, seed)) {
          // Below sea level under the ocean, flooded caverns connect to the sea
          // (aquifer-style ocean caves); land caves above the sea stay dry.
          if (underwater && y < SEA_LEVEL) {
            data[idx(lx, y, lz)] = Block.WATER;
            if (y > columnTop) columnTop = y;
          }
          continue; // otherwise leave as AIR
        }

        data[idx(lx, y, lz)] = b;
        if (y > columnTop) columnTop = y;
      }

      // Fill water from the terrain top up to sea level; cap frozen biomes with ice.
      if (underwater) {
        for (let y = h + 1; y <= SEA_LEVEL; y++) {
          data[idx(lx, y, lz)] = Block.WATER;
        }
        if (biome === Biome.FROZEN_OCEAN || biome === Biome.FROZEN_RIVER) {
          data[idx(lx, SEA_LEVEL, lz)] = Block.ICE;
        }
        columnTop = SEA_LEVEL;
      } else if (h + 1 < CY && data[idx(lx, h + 1, lz)] === Block.AIR) {
        // Decorative ground plant (single local cell — no cross-chunk spill).
        const plant = pickPlant(biome, surfaceBlock, wx, wz, seed);
        if (plant !== Block.AIR) {
          data[idx(lx, h + 1, lz)] = plant;
          columnTop = h + 1;
        }
      }

      const top = columnTop + 1;
      heightMap[colIdx(lx, lz)] = top;
      if (top > maxY) maxY = top;
    }
  }

  const features: FeatureDecision[] = [];
  collectTreeDecisions(cx, cz, seed, features);

  return { data, heightMap, biomeMap, maxY, features };
}
