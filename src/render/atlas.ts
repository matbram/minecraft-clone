// Procedural texture atlas: STRUCTURED canvas tiles (not random static), placed
// at the canonical Tile slots so UVs match any future PNG pack exactly.
//
// Main-thread only (uses <canvas>). Returns one THREE.Texture used by both
// materials.

import * as THREE from 'three';
import { ATLAS_COLS, ATLAS_TILES, Tile } from '../core/BlockTypes';

export const TILE_PX = 16;
export const ATLAS_ROWS = Math.ceil(ATLAS_TILES / ATLAS_COLS);

// Small deterministic PRNG so the generated texture is identical every run.
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

interface RGB {
  r: number;
  g: number;
  b: number;
}

function shade(c: RGB, f: number): RGB {
  return { r: Math.round(c.r * f), g: Math.round(c.g * f), b: Math.round(c.b * f) };
}

type Painter = (ctx: CanvasRenderingContext2D, x0: number, y0: number, rnd: () => number) => void;

// A speckled fill: base color with per-pixel brightness jitter.
function speckle(base: RGB, jitter: number, alpha = 1): Painter {
  return (ctx, x0, y0, rnd) => {
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const f = 1 - jitter / 2 + rnd() * jitter;
        const c = shade(base, f);
        ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${alpha})`;
        ctx.fillRect(x0 + x, y0 + y, 1, 1);
      }
    }
  };
}

function fillFlat(base: RGB, alpha = 1): Painter {
  return (ctx, x0, y0) => {
    ctx.fillStyle = `rgba(${base.r},${base.g},${base.b},${alpha})`;
    ctx.fillRect(x0, y0, TILE_PX, TILE_PX);
  };
}

const PAINTERS: Record<number, Painter> = {
  [Tile.GRASS_TOP]: speckle({ r: 96, g: 158, b: 68 }, 0.35),
  [Tile.DIRT]: speckle({ r: 134, g: 96, b: 67 }, 0.3),
  [Tile.STONE]: speckle({ r: 128, g: 128, b: 132 }, 0.22),
  [Tile.SAND]: speckle({ r: 219, g: 205, b: 158 }, 0.18),
  [Tile.GRAVEL]: speckle({ r: 130, g: 124, b: 120 }, 0.4),
  [Tile.BEDROCK]: speckle({ r: 70, g: 70, b: 74 }, 0.5),
  [Tile.LEAVES]: speckle({ r: 58, g: 120, b: 48 }, 0.4),
  [Tile.SNOW]: speckle({ r: 236, g: 242, b: 250 }, 0.08),
  [Tile.SANDSTONE]: speckle({ r: 214, g: 198, b: 152 }, 0.12),
  [Tile.RED_SAND]: speckle({ r: 190, g: 110, b: 58 }, 0.16),
  [Tile.TERRACOTTA]: speckle({ r: 150, g: 90, b: 60 }, 0.2),
  [Tile.PODZOL]: speckle({ r: 92, g: 64, b: 38 }, 0.3),
  [Tile.CLAY]: speckle({ r: 162, g: 168, b: 178 }, 0.12),
  [Tile.ICE]: speckle({ r: 170, g: 205, b: 235 }, 0.06),

  // Grass side: dirt body with a green cap fading down.
  [Tile.GRASS_SIDE]: (ctx, x0, y0, rnd) => {
    const dirt = { r: 134, g: 96, b: 67 };
    const grass = { r: 96, g: 158, b: 68 };
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const isGrass = y < 4 + Math.floor(rnd() * 2);
        const base = isGrass ? grass : dirt;
        const f = 0.85 + rnd() * 0.3;
        const c = shade(base, f);
        ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
        ctx.fillRect(x0 + x, y0 + y, 1, 1);
      }
    }
  },

  // Water: blue with subtle ripples, semi-transparent (blended pass).
  [Tile.WATER]: (ctx, x0, y0, rnd) => {
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const f = 0.9 + Math.sin((x + y) * 0.9 + rnd()) * 0.06 + rnd() * 0.05;
        const c = shade({ r: 56, g: 110, b: 200 }, f);
        ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},0.72)`;
        ctx.fillRect(x0 + x, y0 + y, 1, 1);
      }
    }
  },

  // Glass: faint tint + border frame, mostly transparent.
  [Tile.GLASS]: (ctx, x0, y0) => {
    ctx.clearRect(x0, y0, TILE_PX, TILE_PX);
    ctx.fillStyle = 'rgba(200,230,240,0.16)';
    ctx.fillRect(x0, y0, TILE_PX, TILE_PX);
    ctx.fillStyle = 'rgba(225,245,255,0.55)';
    ctx.fillRect(x0, y0, TILE_PX, 1);
    ctx.fillRect(x0, y0 + TILE_PX - 1, TILE_PX, 1);
    ctx.fillRect(x0, y0, 1, TILE_PX);
    ctx.fillRect(x0 + TILE_PX - 1, y0, 1, TILE_PX);
  },

  // Log side: vertical bark streaks.
  [Tile.LOG_SIDE]: (ctx, x0, y0, rnd) => {
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const streak = Math.sin(x * 1.6) * 0.12;
        const f = 0.85 + streak + rnd() * 0.1;
        const c = shade({ r: 110, g: 80, b: 50 }, f);
        ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
        ctx.fillRect(x0 + x, y0 + y, 1, 1);
      }
    }
  },

  // Log top: concentric rings.
  [Tile.LOG_TOP]: (ctx, x0, y0, rnd) => {
    const cx = TILE_PX / 2 - 0.5;
    const cy = TILE_PX / 2 - 0.5;
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const d = Math.hypot(x - cx, y - cy);
        const ring = (Math.sin(d * 1.7) + 1) * 0.5;
        const f = 0.8 + ring * 0.3 + rnd() * 0.05;
        const c = shade({ r: 150, g: 116, b: 78 }, f);
        ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
        ctx.fillRect(x0 + x, y0 + y, 1, 1);
      }
    }
  },

  // Glowstone: warm with bright flecks.
  [Tile.GLOWSTONE]: (ctx, x0, y0, rnd) => {
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const bright = rnd() < 0.18 ? 1.25 : 0.85 + rnd() * 0.2;
        const c = shade({ r: 200, g: 165, b: 90 }, bright);
        ctx.fillStyle = `rgb(${Math.min(255, c.r)},${Math.min(255, c.g)},${Math.min(255, c.b)})`;
        ctx.fillRect(x0 + x, y0 + y, 1, 1);
      }
    }
  },

  // --- Phase 12b flora: silhouettes on a TRANSPARENT background (alpha-test cutout) ---

  // Tall grass: a clump of vertical green blades (recoloured per biome via tint).
  [Tile.TALL_GRASS]: (ctx, x0, y0, rnd) => {
    ctx.clearRect(x0, y0, TILE_PX, TILE_PX);
    for (let i = 0; i < 8; i++) {
      const bx = x0 + 1 + i * 2;
      const top = y0 + 3 + Math.floor(rnd() * 6);
      const g = 135 + Math.floor(rnd() * 50);
      ctx.fillStyle = `rgb(72,${g},52)`;
      ctx.fillRect(bx, top, 1, y0 + TILE_PX - top);
    }
  },

  // Fern: shorter, arched fronds.
  [Tile.FERN]: (ctx, x0, y0, rnd) => {
    ctx.clearRect(x0, y0, TILE_PX, TILE_PX);
    for (let i = 0; i < 6; i++) {
      const bx = x0 + 2 + i * 2;
      const top = y0 + 6 + Math.floor(rnd() * 4);
      const g = 120 + Math.floor(rnd() * 40);
      ctx.fillStyle = `rgb(60,${g},48)`;
      ctx.fillRect(bx, top, 1, y0 + TILE_PX - top);
      ctx.fillRect(bx - 1, top + 1, 3, 1); // little frond spread
    }
  },

  // Flowers: green stem + a coloured blossom.
  [Tile.FLOWER_RED]: (ctx, x0, y0) => flower(ctx, x0, y0, { r: 205, g: 55, b: 50 }),
  [Tile.FLOWER_YELLOW]: (ctx, x0, y0) => flower(ctx, x0, y0, { r: 235, g: 210, b: 70 }),

  // Dead bush: a few brown twigs.
  [Tile.DEAD_BUSH]: (ctx, x0, y0, rnd) => {
    ctx.clearRect(x0, y0, TILE_PX, TILE_PX);
    ctx.fillStyle = 'rgb(132,96,52)';
    const cx = x0 + 8;
    ctx.fillRect(cx, y0 + 7, 1, 7); // stem
    for (let i = 0; i < 5; i++) {
      const sx = cx + (Math.floor(rnd() * 7) - 3);
      const sy = y0 + 7 + Math.floor(rnd() * 5);
      ctx.fillRect(Math.min(x0 + 15, Math.max(x0, sx)), sy, 1, 3);
    }
  },

  // Sugar cane: a tall green stalk with node bands.
  [Tile.SUGAR_CANE]: (ctx, x0, y0) => {
    ctx.clearRect(x0, y0, TILE_PX, TILE_PX);
    ctx.fillStyle = 'rgb(126,186,96)';
    ctx.fillRect(x0 + 7, y0, 2, TILE_PX);
    ctx.fillStyle = 'rgb(96,156,74)';
    ctx.fillRect(x0 + 7, y0 + 4, 2, 1);
    ctx.fillRect(x0 + 7, y0 + 10, 2, 1);
  },

  // Kelp: tall olive-green strands.
  [Tile.KELP]: (ctx, x0, y0, rnd) => {
    ctx.clearRect(x0, y0, TILE_PX, TILE_PX);
    for (let i = 0; i < 4; i++) {
      const bx = x0 + 3 + i * 3;
      const g = 110 + Math.floor(rnd() * 40);
      ctx.fillStyle = `rgb(70,${g},55)`;
      ctx.fillRect(bx, y0, 2, TILE_PX);
      ctx.fillRect(bx - 1, y0 + 3 + ((i * 5) % 10), 4, 2); // leafy bulges
    }
  },

  // Seagrass: short bright-green blades.
  [Tile.SEAGRASS]: (ctx, x0, y0, rnd) => {
    ctx.clearRect(x0, y0, TILE_PX, TILE_PX);
    for (let i = 0; i < 7; i++) {
      const bx = x0 + 1 + i * 2;
      const top = y0 + 7 + Math.floor(rnd() * 4);
      ctx.fillStyle = `rgb(60,${150 + Math.floor(rnd() * 50)},90)`;
      ctx.fillRect(bx, top, 1, y0 + TILE_PX - top);
    }
  },

  // Coral: a bright branchy clump (pink/orange).
  [Tile.CORAL]: (ctx, x0, y0, rnd) => {
    ctx.clearRect(x0, y0, TILE_PX, TILE_PX);
    const cols = ['rgb(232,96,140)', 'rgb(240,150,70)', 'rgb(210,90,200)'];
    const cx = x0 + 8;
    ctx.fillStyle = cols[0];
    ctx.fillRect(cx - 1, y0 + 6, 2, 8); // stalk
    for (let i = 0; i < 6; i++) {
      const c = cols[(rnd() * cols.length) | 0];
      ctx.fillStyle = c;
      const bx = cx + (Math.floor(rnd() * 9) - 4);
      const by = y0 + 4 + Math.floor(rnd() * 6);
      ctx.fillRect(Math.max(x0, Math.min(x0 + 15, bx)), by, 2, 3);
    }
  },

  // Fire (Phase 15): a bright flame silhouette on a transparent background. Hot core
  // (white/yellow) low, cooling to orange/red at the tips; bright enough to bloom.
  [Tile.FIRE]: (ctx, x0, y0, rnd) => {
    ctx.clearRect(x0, y0, TILE_PX, TILE_PX);
    const cx = 8;
    for (let y = 0; y < TILE_PX; y++) {
      // Flame tapers toward the top; widest near the base.
      const up = y / (TILE_PX - 1); // 0 base .. 1 top
      const halfW = Math.max(0, (1 - up) * 6 - rnd() * 1.5);
      const hot = 1 - up; // hotter (whiter) low, redder high
      for (let x = 0; x < TILE_PX; x++) {
        if (Math.abs(x - cx) > halfW) continue;
        const r = 255;
        const g = Math.round(80 + hot * 160 + rnd() * 30);
        const b = Math.round(hot * hot * 120 * rnd());
        ctx.fillStyle = `rgb(${r},${Math.min(255, g)},${Math.min(255, b)})`;
        ctx.fillRect(x0 + x, y0 + (TILE_PX - 1 - y), 1, 1);
      }
    }
  },

  // Torch (Phase 15.5/15.7): just the brown stick on a transparent background — the bright
  // flame is now drawn as additive particles by TorchRenderer (matching the held torch), so
  // the painted tile no longer includes a flame blob (it would double up otherwise).
  [Tile.TORCH]: (ctx, x0, y0, rnd) => {
    ctx.clearRect(x0, y0, TILE_PX, TILE_PX);
    const cx = 8;
    // Stick: lower ~9px, 2px wide, brown with a little grain.
    for (let y = 0; y < 9; y++) {
      const f = 0.8 + rnd() * 0.25;
      ctx.fillStyle = `rgb(${Math.round(120 * f)},${Math.round(80 * f)},${Math.round(40 * f)})`;
      ctx.fillRect(x0 + cx - 1, y0 + (TILE_PX - 1 - y), 2, 1);
    }
  },

  // Flare (Phase 15.8): a red/striped stick (the red flame is drawn as additive particles by
  // TorchRenderer). Visually distinct from the brown torch so you can tell the variant apart.
  [Tile.FLARE]: (ctx, x0, y0, rnd) => {
    ctx.clearRect(x0, y0, TILE_PX, TILE_PX);
    const cx = 8;
    for (let y = 0; y < 9; y++) {
      const band = y % 2 === 0; // candy-stripe red / off-white
      const f = 0.85 + rnd() * 0.2;
      ctx.fillStyle = band
        ? `rgb(${Math.round(210 * f)},${Math.round(40 * f)},${Math.round(50 * f)})`
        : `rgb(${Math.round(220 * f)},${Math.round(210 * f)},${Math.round(205 * f)})`;
      ctx.fillRect(x0 + cx - 1, y0 + (TILE_PX - 1 - y), 2, 1);
    }
  },

  // Cactus: opaque green with darker vertical ribs.
  [Tile.CACTUS]: (ctx, x0, y0, rnd) => {
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const rib = x % 5 === 0 ? 0.75 : 1;
        const f = rib * (0.9 + rnd() * 0.15);
        const c = shade({ r: 70, g: 130, b: 60 }, f);
        ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
        ctx.fillRect(x0 + x, y0 + y, 1, 1);
      }
    }
  },
};

// Shared flower painter: green stem + leaves + a coloured blossom on transparent bg.
function flower(ctx: CanvasRenderingContext2D, x0: number, y0: number, petal: RGB): void {
  ctx.clearRect(x0, y0, TILE_PX, TILE_PX);
  const cx = x0 + 8;
  ctx.fillStyle = 'rgb(60,130,50)';
  ctx.fillRect(cx, y0 + 8, 1, 6); // stem
  ctx.fillRect(cx - 2, y0 + 11, 2, 1); // leaves
  ctx.fillRect(cx + 1, y0 + 10, 2, 1);
  ctx.fillStyle = `rgb(${petal.r},${petal.g},${petal.b})`;
  ctx.fillRect(cx - 2, y0 + 4, 5, 4); // blossom
  ctx.fillStyle = 'rgb(245,225,90)';
  ctx.fillRect(cx, y0 + 5, 1, 1); // center
}

// Ore tiles: stone base with colored speckle blobs.
function paintOre(blob: RGB): Painter {
  const stone = speckle({ r: 128, g: 128, b: 132 }, 0.22);
  return (ctx, x0, y0, rnd) => {
    stone(ctx, x0, y0, rnd);
    const blobs = 4 + Math.floor(rnd() * 3);
    for (let i = 0; i < blobs; i++) {
      const bx = 2 + Math.floor(rnd() * (TILE_PX - 4));
      const by = 2 + Math.floor(rnd() * (TILE_PX - 4));
      const s = 1 + Math.floor(rnd() * 2);
      const f = 0.85 + rnd() * 0.3;
      const c = shade(blob, f);
      ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
      ctx.fillRect(x0 + bx, y0 + by, s, s);
    }
  };
}
PAINTERS[Tile.COAL_ORE] = paintOre({ r: 40, g: 40, b: 44 });
PAINTERS[Tile.IRON_ORE] = paintOre({ r: 205, g: 170, b: 140 });
PAINTERS[Tile.GOLD_ORE] = paintOre({ r: 235, g: 200, b: 90 });

// Draw the structured atlas into a canvas (also used by UI for icon crops).
export function buildAtlasCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * TILE_PX;
  canvas.height = ATLAS_ROWS * TILE_PX;
  const ctx = canvas.getContext('2d')!;
  // Transparent background so unused slots / glass read as transparent.
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let t = 0; t < ATLAS_TILES; t++) {
    const col = t % ATLAS_COLS;
    const row = Math.floor(t / ATLAS_COLS);
    const x0 = col * TILE_PX;
    const y0 = row * TILE_PX;
    const painter = PAINTERS[t] ?? fillFlat({ r: 255, g: 0, b: 255 }); // magenta = missing
    painter(ctx, x0, y0, mulberry32(0x1234 + t * 99991));
  }
  return canvas;
}

export interface AtlasResult {
  texture: THREE.Texture;
  canvas: HTMLCanvasElement; // for cropping block icons in the UI
}

export function buildAtlas(): AtlasResult {
  const canvas = buildAtlasCanvas();
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false; // match canvas top-left origin to UV (0,0)
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter; // no mipmaps -> no tile bleeding
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return { texture: tex, canvas };
}
