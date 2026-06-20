// Real texture-pack source (stub for now): bakes PNGs dropped into
// public/textures/ into the canonical Tile layout. Missing files fall back to a
// provided canvas, so it never breaks when the folder is empty. Drop files named
// after the Tile keys (e.g. grass_top.png, stone.png) to light it up.

import * as THREE from 'three';
import { ATLAS_COLS, Tile } from '../../core/BlockTypes';
import { TILE_PX } from '../atlas';
import type { TextureSource } from './TextureSource';

export class PackTextureSource implements TextureSource {
  readonly id = 'pack';
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: THREE.CanvasTexture;

  constructor(basePath: string, fallback: HTMLCanvasElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = fallback.width;
    this.canvas.height = fallback.height;
    const ctx = this.canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(fallback, 0, 0); // start from the procedural look

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.flipY = false;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.needsUpdate = true;

    // Async-load each tile; redraw + needsUpdate as they arrive. 404s are ignored.
    for (const [name, slot] of Object.entries(Tile)) {
      const img = new Image();
      img.onload = () => {
        const x0 = (slot % ATLAS_COLS) * TILE_PX;
        ctx.clearRect(x0, 0, TILE_PX, TILE_PX);
        ctx.drawImage(img, x0, 0, TILE_PX, TILE_PX);
        this.texture.needsUpdate = true;
      };
      img.onerror = () => {}; // keep fallback tile
      img.src = `${basePath}${name.toLowerCase()}.png`;
    }
  }

  getAtlas(): THREE.Texture {
    return this.texture;
  }
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }
}
