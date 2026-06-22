// Phase 11b: shared hotbar/inventory icon painter. World blocks crop their atlas
// tile (the original behavior); edible items have no world tile, so they're drawn
// procedurally. Keeps Hotbar + Inventory rendering identical and in one place.

import { Block, IS_EDIBLE, IS_WEAPON, ATLAS_COLS, representativeTile } from '../core/BlockTypes';
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
  if (IS_WEAPON[block]) {
    if (block === Block.FLAMETHROWER) drawFlamethrower(ctx, size);
    else drawLauncher(ctx, size);
    return;
  }
  const tile = representativeTile(block);
  const col = tile % ATLAS_COLS;
  const row = Math.floor(tile / ATLAS_COLS);
  ctx.drawImage(atlas, col * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX, 0, 0, size, size);
}

// A shoulder-fired rocket launcher: a dark tube angled up-right, a pistol grip,
// a small sight on top, and an orange warhead poking out the muzzle.
function drawLauncher(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.save();
  ctx.translate(s * 0.5, s * 0.5);
  ctx.rotate(-0.32); // slight up-tilt
  // Main tube.
  ctx.fillStyle = '#3a4048';
  ctx.fillRect(-s * 0.42, -s * 0.09, s * 0.8, s * 0.18);
  // Rear blast cone (widens at the back).
  ctx.fillStyle = '#23272c';
  ctx.beginPath();
  ctx.moveTo(-s * 0.42, -s * 0.09);
  ctx.lineTo(-s * 0.5, -s * 0.16);
  ctx.lineTo(-s * 0.5, s * 0.16);
  ctx.lineTo(-s * 0.42, s * 0.09);
  ctx.fill();
  // Warhead at the muzzle.
  ctx.fillStyle = '#d2502e';
  ctx.beginPath();
  ctx.moveTo(s * 0.38, -s * 0.09);
  ctx.lineTo(s * 0.5, 0);
  ctx.lineTo(s * 0.38, s * 0.09);
  ctx.fill();
  // Sight on top.
  ctx.fillStyle = '#54606b';
  ctx.fillRect(s * 0.02, -s * 0.18, s * 0.06, s * 0.09);
  // Pistol grip below.
  ctx.fillStyle = '#2b2f34';
  ctx.fillRect(-s * 0.08, s * 0.09, s * 0.08, s * 0.2);
  ctx.restore();
}

// A flamethrower: red fuel tank, dark barrel + nozzle, pistol grip, and a flame at the tip.
function drawFlamethrower(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.save();
  ctx.translate(s * 0.5, s * 0.5);
  ctx.rotate(-0.16);
  // Fuel tank.
  ctx.fillStyle = '#b5483a';
  ctx.fillRect(-s * 0.42, -s * 0.15, s * 0.24, s * 0.32);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(-s * 0.38, -s * 0.13, s * 0.05, s * 0.28); // highlight
  // Barrel.
  ctx.fillStyle = '#3a4048';
  ctx.fillRect(-s * 0.18, -s * 0.06, s * 0.52, s * 0.12);
  // Nozzle.
  ctx.fillStyle = '#54606b';
  ctx.fillRect(s * 0.32, -s * 0.08, s * 0.06, s * 0.16);
  // Pistol grip.
  ctx.fillStyle = '#2b2f34';
  ctx.fillRect(-s * 0.12, s * 0.06, s * 0.08, s * 0.2);
  // Flame at the muzzle.
  ctx.fillStyle = '#ffcc33';
  ctx.beginPath();
  ctx.moveTo(s * 0.38, -s * 0.09);
  ctx.lineTo(s * 0.52, 0);
  ctx.lineTo(s * 0.38, s * 0.09);
  ctx.fill();
  ctx.fillStyle = '#ff7a1e';
  ctx.beginPath();
  ctx.moveTo(s * 0.4, -s * 0.05);
  ctx.lineTo(s * 0.5, 0);
  ctx.lineTo(s * 0.4, s * 0.05);
  ctx.fill();
  ctx.restore();
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
