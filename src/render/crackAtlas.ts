// Procedural crack texture: a horizontal strip of BREAK_STAGES tiles, each with
// progressively denser dark cracks. Same recipe as atlas.ts (deterministic PRNG,
// Nearest filtering, flipY=false, no mipmaps).

import * as THREE from 'three';
import { BREAK_STAGES } from '../core/constants';

const TILE = 16;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildCrackAtlas(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = BREAK_STAGES * TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let s = 0; s < BREAK_STAGES; s++) {
    const x0 = s * TILE;
    const rnd = mulberry32(0xc4ac + s * 7919);
    const cracks = 1 + s; // grow with stage
    ctx.strokeStyle = `rgba(12,12,12,${0.4 + s * 0.05})`;
    ctx.lineWidth = 1;
    for (let l = 0; l < cracks; l++) {
      let px = x0 + Math.floor(rnd() * TILE);
      let py = Math.floor(rnd() * TILE);
      ctx.beginPath();
      ctx.moveTo(px + 0.5, py + 0.5);
      const segs = 3 + Math.floor(rnd() * 4);
      for (let k = 0; k < segs; k++) {
        px += Math.round((rnd() - 0.5) * 8);
        py += Math.round((rnd() - 0.5) * 8);
        px = Math.max(x0, Math.min(x0 + TILE - 1, px));
        py = Math.max(0, Math.min(TILE - 1, py));
        ctx.lineTo(px + 0.5, py + 0.5);
      }
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
