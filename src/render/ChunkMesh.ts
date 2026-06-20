// Builds renderable geometry for a chunk.
//
// - Corrected face-cull rule (same-type faces hidden; different transparent
//   neighbors drawn).
// - Skips empty air above the chunk's maxY.
// - Splits geometry into opaque vs alpha-blended (water/glass) passes.
// - Bakes SMOOTH lighting + ambient occlusion per vertex into a vec3 `light`
//   attribute: (skyLight 0..1, blockLight 0..1, ao 0..1). The shader combines
//   them as max(block, sky*day)*ao.

import { CX, CZ, CY, mod, worldToChunk, AO_CURVE, SKY_DEFAULT, SEA_LEVEL } from '../core/constants';
import { Block, IS_TRANSPARENT, IS_FOLIAGE, tileOf, ATLAS_COLS } from '../core/BlockTypes';
import type { Chunk } from '../core/Chunk';
import { idx } from '../core/constants';
import type { World } from '../world/World';
import { ATLAS_ROWS, TILE_PX } from './atlas';

export interface MeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  light: Float32Array; // 3 floats/vertex: sky, block, ao
  uvs: Float32Array;
  wave: Float32Array; // 1 float/vertex: 1 = foliage (waves), 0 = static
  refl: Float32Array; // 1 float/vertex: 1 = reflective water top face, 0 = other
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
  u: [number, number, number]; // in-plane axis A
  v: [number, number, number]; // in-plane axis B
  corners: [number, number, number][]; // 4 block-min-relative corner offsets
  uv: [number, number][]; // 4 corner (cu, cv); cv=1 is texture-top
}

// Face order: 0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z
const FACES: FaceDef[] = [
  { n: [1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], uv: [[0, 0], [0, 1], [1, 1], [1, 0]] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], uv: [[0, 0], [0, 1], [1, 1], [1, 0]] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { n: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], uv: [[0, 0], [0, 1], [1, 1], [1, 0]] },
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
  light: number[];
  uvs: number[];
  wave: number[];
  refl: number[];
  indices: number[];
  count: number;
}

function newAccum(): Accum {
  return { positions: [], normals: [], light: [], uvs: [], wave: [], refl: [], indices: [], count: 0 };
}

function finalize(a: Accum): MeshArrays | null {
  if (a.count === 0) return null;
  return {
    positions: new Float32Array(a.positions),
    normals: new Float32Array(a.normals),
    light: new Float32Array(a.light),
    uvs: new Float32Array(a.uvs),
    wave: new Float32Array(a.wave),
    refl: new Float32Array(a.refl),
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

  // Neighbor-aware chunk lookup (cached refs for the 4 orthogonal neighbors;
  // diagonal corners fall back to a Map hit).
  const chunkAt = (wx: number, wz: number): Chunk | undefined => {
    const ccx = worldToChunk(wx);
    const ccz = worldToChunk(wz);
    if (ccx === cx && ccz === cz) return self;
    if (ccx === cx + 1 && ccz === cz) return cxp;
    if (ccx === cx - 1 && ccz === cz) return cxm;
    if (ccx === cx && ccz === cz + 1) return czp;
    if (ccx === cx && ccz === cz - 1) return czm;
    return world.getChunk(ccx, ccz);
  };

  const blockAt = (wx: number, wy: number, wz: number): Block => {
    if (wy < 0 || wy >= CY) return Block.AIR;
    const chunk = chunkAt(wx, wz);
    return chunk ? chunk.getBlock(mod(wx, CX), wy, mod(wz, CZ)) : Block.AIR;
  };
  const opaqueAt = (wx: number, wy: number, wz: number): boolean => !IS_TRANSPARENT[blockAt(wx, wy, wz)];
  const skyAt = (wx: number, wy: number, wz: number): number => {
    if (wy >= CY) return SKY_DEFAULT;
    if (wy < 0) return 0;
    const chunk = chunkAt(wx, wz);
    return chunk ? chunk.getSky(idx(mod(wx, CX), wy, mod(wz, CZ))) : SKY_DEFAULT;
  };
  const blockLightAt = (wx: number, wy: number, wz: number): number => {
    if (wy < 0 || wy >= CY) return 0;
    const chunk = chunkAt(wx, wz);
    return chunk ? chunk.getBlockLight(idx(mod(wx, CX), wy, mod(wz, CZ))) : 0;
  };

  const opaque = newAccum();
  const transparent = newAccum();
  const maxY = self.maxY;

  // Scratch for one corner's sample.
  const sky4: number[] = [];
  const block4: number[] = [];

  for (let y = 0; y < maxY; y++) {
    for (let lz = 0; lz < CZ; lz++) {
      for (let lx = 0; lx < CX; lx++) {
        const b = self.getBlock(lx, y, lz);
        if (b === Block.AIR) continue;

        const wx = baseX + lx;
        const wz = baseZ + lz;
        const acc = NEEDS_BLEND.has(b) ? transparent : opaque;
        const waveFlag = IS_FOLIAGE[b] ? 1 : 0;

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nbx = wx + face.n[0];
          const nby = y + face.n[1];
          const nbz = wz + face.n[2];
          if (!shouldRenderFace(b, blockAt(nbx, nby, nbz))) continue;

          // Reflective only for the exposed water top-face at the sea-level
          // surface (face 2 = +Y, y === SEA_LEVEL -> top at WATER_SURFACE_Y).
          // Any other water (sides / future off-plane water) stays flat.
          const reflFlag = b === Block.WATER && f === 2 && y === SEA_LEVEL ? 1 : 0;

          const tile = tileOf(b, f);
          const col = tile % ATLAS_COLS;
          const row = Math.floor(tile / ATLAS_COLS);
          const u0 = col / ATLAS_COLS + INSET_U;
          const u1 = (col + 1) / ATLAS_COLS - INSET_U;
          const v0 = row / ATLAS_ROWS + INSET_V;
          const v1 = (row + 1) / ATLAS_ROWS - INSET_V;

          const base = acc.count;
          const aoLevel: number[] = [0, 0, 0, 0];

          for (let i = 0; i < 4; i++) {
            const cor = face.corners[i];
            // Corner sign along the two in-plane axes (corner coords are 0/1).
            const su = cor[0] * face.u[0] + cor[1] * face.u[1] + cor[2] * face.u[2] >= 1 ? 1 : -1;
            const sv = cor[0] * face.v[0] + cor[1] * face.v[1] + cor[2] * face.v[2] >= 1 ? 1 : -1;

            // Sampling cells on the OUTWARD side of the face.
            const cX = nbx;
            const cY = nby;
            const cZ = nbz;
            const s1x = cX + su * face.u[0], s1y = cY + su * face.u[1], s1z = cZ + su * face.u[2];
            const s2x = cX + sv * face.v[0], s2y = cY + sv * face.v[1], s2z = cZ + sv * face.v[2];
            const dgx = s1x + sv * face.v[0], dgy = s1y + sv * face.v[1], dgz = s1z + sv * face.v[2];

            const o1 = opaqueAt(s1x, s1y, s1z) ? 1 : 0;
            const o2 = opaqueAt(s2x, s2y, s2z) ? 1 : 0;
            const oc = opaqueAt(dgx, dgy, dgz) ? 1 : 0;
            const level = o1 && o2 ? 0 : 3 - (o1 + o2 + oc);
            aoLevel[i] = level;

            // Smooth light: average non-opaque cells touching this corner.
            sky4.length = 0;
            block4.length = 0;
            sky4.push(skyAt(cX, cY, cZ)); // center (always non-opaque: face is visible)
            block4.push(blockLightAt(cX, cY, cZ));
            if (!o1) {
              sky4.push(skyAt(s1x, s1y, s1z));
              block4.push(blockLightAt(s1x, s1y, s1z));
            }
            if (!o2) {
              sky4.push(skyAt(s2x, s2y, s2z));
              block4.push(blockLightAt(s2x, s2y, s2z));
            }
            if (!(o1 && o2) && !oc) {
              sky4.push(skyAt(dgx, dgy, dgz));
              block4.push(blockLightAt(dgx, dgy, dgz));
            }
            let sSum = 0;
            let bSum = 0;
            for (let j = 0; j < sky4.length; j++) {
              sSum += sky4[j];
              bSum += block4[j];
            }
            const sky = sSum / sky4.length / 15;
            const blk = bSum / block4.length / 15;
            const ao = AO_CURVE[level];

            const vert = face.corners[i];
            acc.positions.push(lx + vert[0], y + vert[1], lz + vert[2]);
            acc.normals.push(face.n[0], face.n[1], face.n[2]);
            acc.light.push(sky, blk, ao);
            const cu = face.uv[i][0];
            const cv = face.uv[i][1];
            acc.uvs.push(u0 + cu * (u1 - u0), v0 + (1 - cv) * (v1 - v0));
            acc.wave.push(waveFlag);
            acc.refl.push(reflFlag);
          }

          // Flip the quad diagonal to avoid AO interpolation artifacts.
          if (aoLevel[0] + aoLevel[2] < aoLevel[1] + aoLevel[3]) {
            acc.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
          } else {
            acc.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
          acc.count += 4;
        }
      }
    }
  }

  return { opaque: finalize(opaque), transparent: finalize(transparent) };
}
