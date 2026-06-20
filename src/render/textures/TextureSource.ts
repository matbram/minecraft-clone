// Abstraction so the engine never knows where textures come from. Both sources
// honor the canonical TILE_INDEX, so swapping is a single uniform change (no
// re-mesh). 4b can add normal/specular atlases via the optional methods.

import type * as THREE from 'three';

export interface TextureSource {
  readonly id: string;
  getAtlas(): THREE.Texture;
  getCanvas?(): HTMLCanvasElement; // for UI icons / particle colors
  getNormalAtlas?(): THREE.Texture; // 4b hook
  getSpecularAtlas?(): THREE.Texture; // 4b hook
}

export class TextureRegistry {
  private idx = 0;
  constructor(private readonly sources: TextureSource[]) {}

  get active(): TextureSource {
    return this.sources[this.idx];
  }

  cycle(): TextureSource {
    this.idx = (this.idx + 1) % this.sources.length;
    return this.active;
  }
}
