// Procedural world generation. PURE and worker-safe (no DOM / THREE).
//
// generateChunk() produces terrain + caves + ore and a list of deterministic
// feature DECISIONS (trees / grass). Feature PLACEMENT happens on the main
// thread (see World.placeFeatures) because cross-chunk spillover needs the
// shared World.pending map.

import { BLOCKS, COLS, CX, CZ, CY, SEA_LEVEL, BEDROCK_Y, idx, colIdx } from './constants';
import { Block } from './BlockTypes';
import { fbm2, fbm3, ridged3 } from './noise/fbm';
import { hash2, hash3 } from './noise/hash';
import type { FeatureDecision } from './features';

export interface GenResult {
  data: Uint8Array;
  heightMap: Uint8Array; // highest non-air y + 1 per column (incl. water)
  maxY: number;
  features: FeatureDecision[];
}

// --- terrain shaping -------------------------------------------------------

const MAX_TERRAIN_Y = CY - 40; // leave headroom for trees/structures

export function surfaceHeight(wx: number, wz: number, seed: number): number {
  // Broad continents + rolling hills + fine detail. Biased above sea level so
  // most of the world is walkable land with water pooling in the valleys.
  const continental = fbm2(wx, wz, seed, { frequency: 1 / 384, octaves: 3, lacunarity: 2, gain: 0.5 });
  const hills = fbm2(wx, wz, seed + 7, { frequency: 1 / 96, octaves: 4, lacunarity: 2, gain: 0.5 });
  const detail = fbm2(wx, wz, seed + 13, { frequency: 1 / 32, octaves: 2, lacunarity: 2, gain: 0.5 });
  let h = SEA_LEVEL + 8 + continental * 30 + hills * 18 + detail * 5;
  h = Math.round(h);
  if (h < 1) h = 1;
  if (h > MAX_TERRAIN_Y) h = MAX_TERRAIN_Y;
  return h;
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
  // Scattered ore with depth gating (single-cell for P0; blob veins are a polish item).
  const r = hash3(wx, y, wz, seed + 909);
  if (y < 16 && r < 0.006) return Block.GOLD_ORE;
  if (y < 40 && r < 0.012) return Block.IRON_ORE;
  if (y < 64 && r < 0.02) return Block.COAL_ORE;
  return Block.STONE;
}

// --- feature decisions -----------------------------------------------------

const TREE_CELL = 5; // one candidate tree per 5x5 world-cell -> natural spacing

function collectTreeDecisions(cx: number, cz: number, seed: number, out: FeatureDecision[]): void {
  // Iterate the grid cells that can have an anchor inside this chunk.
  const minWx = cx * CX;
  const minWz = cz * CZ;
  const g0x = Math.floor(minWx / TREE_CELL) - 1;
  const g1x = Math.floor((minWx + CX - 1) / TREE_CELL) + 1;
  const g0z = Math.floor(minWz / TREE_CELL) - 1;
  const g1z = Math.floor((minWz + CZ - 1) / TREE_CELL) + 1;

  for (let gz = g0z; gz <= g1z; gz++) {
    for (let gx = g0x; gx <= g1x; gx++) {
      if (hash2(gx, gz, seed + 555) > 0.32) continue; // ~32% of cells host a tree
      // Anchor position within the cell, hashed.
      const ox = Math.floor(hash2(gx, gz, seed + 556) * TREE_CELL);
      const oz = Math.floor(hash2(gx, gz, seed + 557) * TREE_CELL);
      const wx = gx * TREE_CELL + ox;
      const wz = gz * TREE_CELL + oz;
      // Only emit decisions whose ANCHOR is inside this chunk (avoids double placement).
      if (wx < minWx || wx >= minWx + CX || wz < minWz || wz >= minWz + CZ) continue;

      const h = surfaceHeight(wx, wz, seed);
      if (h <= SEA_LEVEL) continue; // no trees underwater / on beaches
      const variant = Math.floor(hash2(gx, gz, seed + 558) * 3);
      out.push({ wx, wy: h, wz, kind: 'tree', variant });
    }
  }
}

// --- chunk assembly --------------------------------------------------------

export function generateChunk(cx: number, cz: number, seed: number): GenResult {
  const data = new Uint8Array(BLOCKS);
  const heightMap = new Uint8Array(COLS);
  let maxY = 0;

  for (let lz = 0; lz < CZ; lz++) {
    for (let lx = 0; lx < CX; lx++) {
      const wx = cx * CX + lx;
      const wz = cz * CZ + lz;
      const h = surfaceHeight(wx, wz, seed);
      const underwater = h < SEA_LEVEL;

      const surfaceBlock = underwater ? Block.SAND : h <= SEA_LEVEL + 1 ? Block.SAND : Block.GRASS;

      let columnTop = 0;

      for (let y = 0; y <= h; y++) {
        let b: Block;
        if (y === BEDROCK_Y) {
          b = Block.BEDROCK;
        } else if (y === h) {
          b = surfaceBlock;
        } else if (y > h - 4) {
          b = underwater ? Block.SAND : Block.DIRT;
        } else {
          b = oreAt(wx, y, wz, seed);
        }

        // Carve caves out of solid ground (never bedrock, never the very surface).
        if (b !== Block.BEDROCK && y < h && y > BEDROCK_Y && isCave(wx, y, wz, seed)) {
          continue; // leave as AIR
        }

        data[idx(lx, y, lz)] = b;
        if (y > columnTop) columnTop = y;
      }

      // Fill water from the terrain top up to sea level.
      if (h < SEA_LEVEL) {
        for (let y = h + 1; y <= SEA_LEVEL; y++) {
          data[idx(lx, y, lz)] = Block.WATER;
        }
        columnTop = SEA_LEVEL;
      }

      const top = columnTop + 1;
      heightMap[colIdx(lx, lz)] = top;
      if (top > maxY) maxY = top;
    }
  }

  const features: FeatureDecision[] = [];
  collectTreeDecisions(cx, cz, seed, features);

  return { data, heightMap, maxY, features };
}
