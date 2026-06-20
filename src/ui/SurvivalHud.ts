// Phase 11b: survival HUD — rows of hearts (health), drumsticks (hunger) and an
// air row shown only underwater. Icons are canvas-drawn (no assets), with
// half-icon granularity for health/hunger. Redrawn only when a value's quantized
// state changes; the whole HUD hides in Creative via setVisible(false).

import { MAX_HEALTH, MAX_HUNGER, MAX_AIR } from '../core/constants';

const ICON = 18; // px per icon
const ICONS = 10; // icons per stat row (each = 2 health/hunger points, or 1 air)

type Fill = 'empty' | 'half' | 'full';

export class SurvivalHud {
  private readonly heartCv: HTMLCanvasElement[] = [];
  private readonly hungerCv: HTMLCanvasElement[] = [];
  private readonly airCv: HTMLCanvasElement[] = [];
  private readonly container: HTMLElement;
  private readonly airRow: HTMLElement;
  private visible = false;
  private lastHealth = -1;
  private lastHunger = -1;
  private lastAir = -1;
  private lastShowAir = false;

  constructor(container: HTMLElement) {
    this.container = container;
    container.innerHTML = '';
    this.airRow = this.makeRow(this.airCv);
    this.airRow.style.display = 'none';
    const stats = document.createElement('div');
    stats.className = 'sv-stats';
    stats.appendChild(this.makeRow(this.heartCv)); // hearts left
    stats.appendChild(this.makeRow(this.hungerCv)); // hunger right
    container.appendChild(this.airRow);
    container.appendChild(stats);
    container.style.display = 'none';
  }

  private makeRow(into: HTMLCanvasElement[]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'sv-row';
    for (let i = 0; i < ICONS; i++) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = ICON;
      row.appendChild(cv);
      into.push(cv);
    }
    return row;
  }

  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    this.container.style.display = v ? 'flex' : 'none';
    // force a full redraw next update when re-shown
    this.lastHealth = this.lastHunger = this.lastAir = -1;
  }

  update(health: number, hunger: number, air: number, showAir: boolean): void {
    if (!this.visible) return;

    if (health !== this.lastHealth) {
      this.lastHealth = health;
      this.paintRow(this.heartCv, health, MAX_HEALTH, drawHeart);
    }
    if (hunger !== this.lastHunger) {
      this.lastHunger = hunger;
      this.paintRow(this.hungerCv, hunger, MAX_HUNGER, drawDrumstick);
    }
    if (showAir !== this.lastShowAir) {
      this.lastShowAir = showAir;
      this.airRow.style.display = showAir ? 'flex' : 'none';
      this.lastAir = -1; // repaint on (re)show
    }
    if (showAir && air !== this.lastAir) {
      this.lastAir = air;
      this.paintRow(this.airCv, air * 2, MAX_AIR * 2, drawBubble); // air is whole-icon
    }
  }

  // Distribute `value` (0..max) across the row's icons; each icon spans 2 units so
  // half-icons are possible (air passes value*2/max*2 so it reads as whole icons).
  private paintRow(
    row: HTMLCanvasElement[],
    value: number,
    max: number,
    draw: (ctx: CanvasRenderingContext2D, s: number, fill: Fill) => void,
  ): void {
    const perIcon = max / ICONS; // = 2 for health/hunger, = 2 for the doubled air
    for (let i = 0; i < ICONS; i++) {
      const lo = i * perIcon;
      const fill: Fill = value >= lo + perIcon ? 'full' : value >= lo + perIcon / 2 ? 'half' : 'empty';
      const ctx = row[i].getContext('2d')!;
      ctx.clearRect(0, 0, ICON, ICON);
      draw(ctx, ICON, fill);
    }
  }
}

// --- icon painters (empty base, then full or left-half colored) ---------------

function withFill(
  ctx: CanvasRenderingContext2D,
  s: number,
  fill: Fill,
  path: (ctx: CanvasRenderingContext2D, s: number) => void,
  emptyColor: string,
  fullColor: string,
): void {
  // empty/base
  ctx.save();
  path(ctx, s);
  ctx.fillStyle = emptyColor;
  ctx.fill();
  ctx.restore();
  if (fill === 'empty') return;
  // colored (clip to the left half for a half icon)
  ctx.save();
  if (fill === 'half') {
    ctx.beginPath();
    ctx.rect(0, 0, s / 2, s);
    ctx.clip();
  }
  path(ctx, s);
  ctx.fillStyle = fullColor;
  ctx.fill();
  ctx.restore();
}

function heartPath(ctx: CanvasRenderingContext2D, s: number): void {
  const x = s / 2;
  const y = s * 0.36;
  const w = s * 0.42;
  ctx.beginPath();
  ctx.moveTo(x, s * 0.86);
  ctx.bezierCurveTo(x - w, y + s * 0.18, x - w, y - s * 0.18, x - w * 0.5, y - s * 0.16);
  ctx.bezierCurveTo(x - w * 0.18, y - s * 0.14, x, y, x, y + s * 0.06);
  ctx.bezierCurveTo(x, y, x + w * 0.18, y - s * 0.14, x + w * 0.5, y - s * 0.16);
  ctx.bezierCurveTo(x + w, y - s * 0.18, x + w, y + s * 0.18, x, s * 0.86);
  ctx.closePath();
}

function drawHeart(ctx: CanvasRenderingContext2D, s: number, fill: Fill): void {
  withFill(ctx, s, fill, heartPath, '#3b1414', '#e23b2e');
}

function drumstickPath(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.beginPath();
  // meat (rounded blob, upper-right)
  ctx.ellipse(s * 0.58, s * 0.42, s * 0.3, s * 0.27, 0, 0, Math.PI * 2);
  // bone (lower-left nub)
  ctx.moveTo(s * 0.46, s * 0.55);
  ctx.lineTo(s * 0.2, s * 0.82);
  ctx.lineTo(s * 0.1, s * 0.72);
  ctx.lineTo(s * 0.36, s * 0.45);
  ctx.closePath();
}

function drawDrumstick(ctx: CanvasRenderingContext2D, s: number, fill: Fill): void {
  withFill(ctx, s, fill, drumstickPath, '#2e2417', '#b06a2e');
}

function bubblePath(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s * 0.34, 0, Math.PI * 2);
}

function drawBubble(ctx: CanvasRenderingContext2D, s: number, fill: Fill): void {
  withFill(ctx, s, fill, bubblePath, 'rgba(120,160,190,0.25)', '#7fd0ee');
  if (fill === 'full') {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(s * 0.4, s * 0.4, s * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
}
