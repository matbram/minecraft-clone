// Averaged representative color per block, sampled once from the atlas canvas.
// Used to tint break-particle puffs so they match the block that shattered.

import * as THREE from 'three';
import { BLOCK_COUNT, ATLAS_COLS, representativeTile, type Block } from '../core/BlockTypes';
import { TILE_PX } from './atlas';

const FALLBACK = 0x888888;

export function buildTileColors(atlasCanvas: HTMLCanvasElement): THREE.Color[] {
  const ctx = atlasCanvas.getContext('2d')!;
  const colors: THREE.Color[] = [];

  for (let b = 0; b < BLOCK_COUNT; b++) {
    const tile = representativeTile(b as Block);
    const col = tile % ATLAS_COLS;
    const row = Math.floor(tile / ATLAS_COLS);
    let img: ImageData;
    try {
      img = ctx.getImageData(col * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX);
    } catch {
      colors.push(new THREE.Color(FALLBACK));
      continue;
    }
    const d = img.data;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let sa = 0;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      sr += d[i] * a;
      sg += d[i + 1] * a;
      sb += d[i + 2] * a;
      sa += a;
    }
    if (sa === 0) {
      colors.push(new THREE.Color(FALLBACK));
      continue;
    }
    const c = new THREE.Color();
    // Atlas pixels are sRGB; convert so particle color matches the rendered tile.
    c.setRGB(sr / sa / 255, sg / sa / 255, sb / sa / 255, THREE.SRGBColorSpace);
    colors.push(c);
  }
  return colors;
}
