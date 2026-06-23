// A SECOND procedural style ("smooth") used as the demo texture pack: gradients
// + bevels + soft ore blobs instead of speckle. Paints the SAME canonical Tile
// slots as the faithful atlas, so UVs are identical and the T toggle is a single
// uniform swap.

import type * as THREE from 'three';
import { ATLAS_COLS, ATLAS_TILES, Tile } from '../../core/BlockTypes';
import { TILE_PX, configureBlockTexture } from '../atlas';
import type { AtlasResult } from '../atlas';
import type { TextureSource } from './TextureSource';

type RGBA = [number, number, number, number];

const BASE: Record<number, RGBA> = {
  [Tile.GRASS_TOP]: [110, 172, 82, 1],
  [Tile.GRASS_SIDE]: [140, 104, 72, 1], // dirt body; green cap drawn on top
  [Tile.DIRT]: [142, 102, 72, 1],
  [Tile.STONE]: [142, 142, 148, 1],
  [Tile.SAND]: [226, 212, 168, 1],
  [Tile.WATER]: [58, 120, 210, 0.72],
  [Tile.GLASS]: [210, 235, 245, 0.16],
  [Tile.LOG_SIDE]: [122, 90, 58, 1],
  [Tile.LOG_TOP]: [162, 128, 88, 1],
  [Tile.LEAVES]: [72, 138, 62, 1],
  [Tile.GLOWSTONE]: [228, 198, 122, 1],
  [Tile.BEDROCK]: [80, 80, 86, 1],
  [Tile.GRAVEL]: [142, 136, 130, 1],
  [Tile.COAL_ORE]: [142, 142, 148, 1],
  [Tile.IRON_ORE]: [142, 142, 148, 1],
  [Tile.GOLD_ORE]: [142, 142, 148, 1],
};

const ORE_BLOB: Record<number, RGBA> = {
  [Tile.COAL_ORE]: [40, 40, 44, 1],
  [Tile.IRON_ORE]: [205, 170, 140, 1],
  [Tile.GOLD_ORE]: [235, 200, 90, 1],
};

function clamp(n: number): number {
  return Math.max(0, Math.min(255, n));
}

function paintSmooth(ctx: CanvasRenderingContext2D, x0: number, y0: number, c: RGBA): void {
  const [r, g, b, a] = c;
  const grad = ctx.createLinearGradient(0, y0, 0, y0 + TILE_PX);
  grad.addColorStop(0, `rgba(${clamp(r + 22)},${clamp(g + 22)},${clamp(b + 22)},${a})`);
  grad.addColorStop(1, `rgba(${clamp(r - 18)},${clamp(g - 18)},${clamp(b - 18)},${a})`);
  ctx.fillStyle = grad;
  ctx.fillRect(x0, y0, TILE_PX, TILE_PX);
  // Bevel: light top/left, dark bottom/right.
  ctx.fillStyle = `rgba(255,255,255,${0.12 * a})`;
  ctx.fillRect(x0, y0, TILE_PX, 1);
  ctx.fillRect(x0, y0, 1, TILE_PX);
  ctx.fillStyle = `rgba(0,0,0,${0.18 * a})`;
  ctx.fillRect(x0, y0 + TILE_PX - 1, TILE_PX, 1);
  ctx.fillRect(x0 + TILE_PX - 1, y0, 1, TILE_PX);
}

export function buildSmoothAtlas(anisotropy = 0): AtlasResult {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * TILE_PX;
  canvas.height = TILE_PX; // single row (ATLAS_ROWS == 1)
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let t = 0; t < ATLAS_TILES; t++) {
    const x0 = (t % ATLAS_COLS) * TILE_PX;
    const y0 = 0;
    const base = BASE[t] ?? [255, 0, 255, 1];
    if (t === Tile.GLASS) {
      paintSmooth(ctx, x0, y0, base);
      ctx.fillStyle = 'rgba(235,250,255,0.6)';
      ctx.fillRect(x0, y0, TILE_PX, 1);
      ctx.fillRect(x0, y0 + TILE_PX - 1, TILE_PX, 1);
      ctx.fillRect(x0, y0, 1, TILE_PX);
      ctx.fillRect(x0 + TILE_PX - 1, y0, 1, TILE_PX);
      continue;
    }
    paintSmooth(ctx, x0, y0, base);
    if (t === Tile.GRASS_SIDE) {
      const cap = 5;
      const cg = ctx.createLinearGradient(0, y0, 0, y0 + cap);
      cg.addColorStop(0, 'rgba(120,182,90,1)');
      cg.addColorStop(1, 'rgba(104,164,78,1)');
      ctx.fillStyle = cg;
      ctx.fillRect(x0, y0, TILE_PX, cap);
    }
    const blob = ORE_BLOB[t];
    if (blob) {
      let seed = 0x77 + t * 131;
      const rnd = () => {
        seed = (Math.imul(seed ^ (seed >>> 13), 0x2c1b3c6d) + 1) >>> 0;
        return seed / 4294967296;
      };
      for (let i = 0; i < 5; i++) {
        const bx = x0 + 2 + Math.floor(rnd() * (TILE_PX - 5));
        const by = y0 + 2 + Math.floor(rnd() * (TILE_PX - 5));
        const r = 1 + Math.floor(rnd() * 2);
        const grd = ctx.createRadialGradient(bx, by, 0, bx, by, r + 1);
        grd.addColorStop(0, `rgba(${blob[0]},${blob[1]},${blob[2]},1)`);
        grd.addColorStop(1, `rgba(${blob[0]},${blob[1]},${blob[2]},0)`);
        ctx.fillStyle = grd;
        ctx.fillRect(bx - r - 1, by - r - 1, (r + 1) * 2, (r + 1) * 2);
      }
    }
  }

  return { texture: configureBlockTexture(canvas, anisotropy), canvas };
}

export class ProceduralPackTextureSource implements TextureSource {
  readonly id = 'smooth';
  private readonly atlas: AtlasResult;
  constructor(anisotropy = 0) {
    this.atlas = buildSmoothAtlas(anisotropy);
  }
  getAtlas(): THREE.Texture {
    return this.atlas.texture;
  }
  getCanvas(): HTMLCanvasElement {
    return this.atlas.canvas;
  }
}
