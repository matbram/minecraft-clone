// Builds renderable geometry for a chunk.
//
// - Corrected face-cull rule (same-type faces hidden; different transparent
//   neighbors drawn).
// - Skips empty air above the chunk's maxY.
// - Splits geometry into opaque vs alpha-blended (water/glass) passes.
// - Emits a per-vertex `light` attribute. Phase 0 bakes constant per-FACE shade
//   for shape readability; Phase 3 replaces it with propagated + smooth light
//   WITHOUT changing the vertex layout.

import { CX, CZ, CY, mod, worldToChunk } from '../core/constants';
import { Block, IS_TRANSPARENT, tileOf } from '../core/BlockTypes';
import type { World } from '../world/World';
import { ATLAS_COLS } from '../core/BlockTypes';
import { ATLAS_ROWS, TILE_PX } from './atlas';

export interface MeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  light: Float32Array;
  indices: Uint32Array;
}

export interface BuiltChunk {
  opaque: MeshArrays | null;
  transparent: MeshArrays | null;
}

// Blocks that need real alpha blending (rendered in the transparent pass).
// Leaves are transparent-for-culling but rendered opaque (solid) for simplicity.
const NEEDS_BLEND = new Set<number>([Block.WATER, Block.GLASS]);

interface FaceDef {
  n: [number, number, number];
  shade: number;
  v: [number, number, number][]; // 4 corners (block-min relative)
  uv: [number, number][]; // 4 corner (cu, cv); cv=1 is texture-top
}

// Face order: 0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z
const FACES: FaceDef[] = [
  {
    n: [1, 0, 0],
    shade: 0.6,
    v: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
    uv: [[0, 0], [0, 1], [1, 1], [1, 0]],
  },
  {
    n: [-1, 0, 0],
    shade: 0.6,
    v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    uv: [[0, 0], [1, 0], [1, 1], [0, 1]],
  },
  {
    n: [0, 1, 0],
    shade: 1.0,
    v: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
    uv: [[0, 0], [0, 1], [1, 1], [1, 0]],
  },
  {
    n: [0, -1, 0],
    shade: 0.5,
    v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    uv: [[0, 0], [1, 0], [1, 1], [0, 1]],
  },
  {
    n: [0, 0, 1],
    shade: 0.8,
    v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    uv: [[0, 0], [1, 0], [1, 1], [0, 1]],
  },
  {
    n: [0, 0, -1],
    shade: 0.8,
    v: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
    uv: [[0, 0], [0, 1], [1, 1], [1, 0]],
  },
];

const INSET_U = 0.5 / (ATLAS_COLS * TILE_PX);
const INSET_V = 0.5 / (ATLAS_ROWS * TILE_PX);

export function shouldRenderFace(cur: Block, nbr: Block): boolean {
  if (nbr === Block.AIR) return true;
  if (nbr === cur) return false; // hide shared faces (incl. water-water, glass-glass)
  if (IS_TRANSPARENT[nbr]) return true; // different transparent neighbor -> draw
  return false; // opaque neighbor -> cull
}

interface Accum {
  positions: number[];
  normals: number[];
  uvs: number[];
  light: number[];
  indices: number[];
  count: number;
}

function newAccum(): Accum {
  return { positions: [], normals: [], uvs: [], light: [], indices: [], count: 0 };
}

function finalize(a: Accum): MeshArrays | null {
  if (a.count === 0) return null;
  return {
    positions: new Float32Array(a.positions),
    normals: new Float32Array(a.normals),
    uvs: new Float32Array(a.uvs),
    light: new Float32Array(a.light),
    indices: new Uint32Array(a.indices),
  };
}

export function buildChunkMesh(world: World, cx: number, cz: number): BuiltChunk {
  const self = world.getChunk(cx, cz);
  if (!self) return { opaque: null, transparent: null };

  const cxp = world.getChunk(cx + 1, cz);
  const cxm = world.getChunk(cx - 1, cz);
  const czp = world.getChunk(cx, cz + 1);
  const czm = world.getChunk(cx, cz - 1);

  const baseX = cx * CX;
  const baseZ = cz * CZ;

  // Neighbor-aware block lookup using cached chunk refs (no Map hits inner loop).
  const blockAt = (wx: number, wy: number, wz: number): Block => {
    if (wy < 0 || wy >= CY) return Block.AIR;
    const ccx = worldToChunk(wx);
    const ccz = worldToChunk(wz);
    let chunk;
    if (ccx === cx && ccz === cz) chunk = self;
    else if (ccx === cx + 1) chunk = cxp;
    else if (ccx === cx - 1) chunk = cxm;
    else if (ccz === cz + 1) chunk = czp;
    else if (ccz === cz - 1) chunk = czm;
    else chunk = world.getChunk(ccx, ccz);
    if (!chunk) return Block.AIR;
    return chunk.getBlock(mod(wx, CX), wy, mod(wz, CZ));
  };

  const opaque = newAccum();
  const transparent = newAccum();
  const maxY = self.maxY;

  for (let y = 0; y < maxY; y++) {
    for (let lz = 0; lz < CZ; lz++) {
      for (let lx = 0; lx < CX; lx++) {
        const b = self.getBlock(lx, y, lz);
        if (b === Block.AIR) continue;

        const wx = baseX + lx;
        const wz = baseZ + lz;
        const acc = NEEDS_BLEND.has(b) ? transparent : opaque;

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nb = blockAt(wx + face.n[0], y + face.n[1], wz + face.n[2]);
          if (!shouldRenderFace(b, nb)) continue;

          const tile = tileOf(b, f);
          const col = tile % ATLAS_COLS;
          const row = Math.floor(tile / ATLAS_COLS);
          const u0 = col / ATLAS_COLS + INSET_U;
          const u1 = (col + 1) / ATLAS_COLS - INSET_U;
          const v0 = row / ATLAS_ROWS + INSET_V;
          const v1 = (row + 1) / ATLAS_ROWS - INSET_V;

          const base = acc.count;
          for (let i = 0; i < 4; i++) {
            const vert = face.v[i];
            acc.positions.push(lx + vert[0], y + vert[1], lz + vert[2]);
            acc.normals.push(face.n[0], face.n[1], face.n[2]);
            const cu = face.uv[i][0];
            const cv = face.uv[i][1];
            acc.uvs.push(u0 + cu * (u1 - u0), v0 + (1 - cv) * (v1 - v0));
            acc.light.push(face.shade);
          }
          acc.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          acc.count += 4;
        }
      }
    }
  }

  return { opaque: finalize(opaque), transparent: finalize(transparent) };
}
