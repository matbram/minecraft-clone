// Phase 11b: shared hotbar/inventory icon painter. World blocks crop their atlas
// tile (the original behavior); edible items have no world tile, so they're drawn
// procedurally. Keeps Hotbar + Inventory rendering identical and in one place.

import { IS_EDIBLE, ATLAS_COLS, representativeTile, type Block } from '../core/BlockTypes';
import { TILE_PX } from '../render/atlas';

export function drawIcon(
  ctx: CanvasRenderingContext2D,
  block: Block,
  atlas: HTMLCanvasElement,
  size: number,
): void {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, size, size);
  if (IS_EDIBLE[block]) {
    drawApple(ctx, size);
    return;
  }
  const tile = representativeTile(block);
  const col = tile % ATLAS_COLS;
  const row = Math.floor(tile / ATLAS_COLS);
  ctx.drawImage(atlas, col * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX, 0, 0, size, size);
}

// A simple red apple (two lobes + stem + leaf + highlight), centered in `s`x`s`.
function drawApple(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.save();
  const cx = s * 0.5;
  const cy = s * 0.56;
  const r = s * 0.3;
  ctx.fillStyle = '#d23b2e';
  ctx.beginPath();
  ctx.arc(cx - r * 0.45, cy, r * 0.85, 0, Math.PI * 2);
  ctx.arc(cx + r * 0.45, cy, r * 0.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.25, r, r * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  // highlight
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.5, cy - r * 0.35, r * 0.25, r * 0.4, -0.5, 0, Math.PI * 2);
  ctx.fill();
  // stem
  ctx.strokeStyle = '#6b3f1e';
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.7);
  ctx.lineTo(cx + s * 0.04, cy - r * 1.15);
  ctx.stroke();
  // leaf
  ctx.fillStyle = '#4e9b3e';
  ctx.beginPath();
  ctx.ellipse(cx + s * 0.12, cy - r * 1.05, s * 0.1, s * 0.05, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
