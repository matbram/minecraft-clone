// The original speckled "faithful" procedural atlas.

import type * as THREE from 'three';
import { buildAtlas, type AtlasResult } from '../atlas';
import type { TextureSource } from './TextureSource';

export class ProceduralTextureSource implements TextureSource {
  readonly id = 'procedural';
  private readonly atlas: AtlasResult;

  constructor(atlas?: AtlasResult) {
    this.atlas = atlas ?? buildAtlas();
  }

  getAtlas(): THREE.Texture {
    return this.atlas.texture;
  }
  getCanvas(): HTMLCanvasElement {
    return this.atlas.canvas;
  }
}
