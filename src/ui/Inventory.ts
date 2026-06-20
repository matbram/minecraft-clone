// DOM inventory overlay: a grid of all placeable blocks. Click one to assign it
// to the active hotbar slot. Opening releases pointer lock (handled via onOpen).

import { ATLAS_COLS, PLACEABLE, representativeTile, type Block } from '../core/BlockTypes';
import { TILE_PX } from '../render/atlas';
import type { Hotbar } from './Hotbar';

export class Inventory {
  open = false;
  onOpen: () => void = () => {};
  onClose: () => void = () => {};

  private readonly container: HTMLElement;
  private readonly atlas: HTMLCanvasElement;
  private readonly hotbar: Hotbar;

  constructor(container: HTMLElement, atlasCanvas: HTMLCanvasElement, hotbar: Hotbar) {
    this.container = container;
    this.atlas = atlasCanvas;
    this.hotbar = hotbar;
    this.build();
  }

  private build(): void {
    this.container.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'inv-panel';
    const title = document.createElement('div');
    title.className = 'inv-title';
    title.textContent = 'Blocks — click to put in your hand (Esc / E to close)';
    panel.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'inv-grid';
    for (const block of PLACEABLE) {
      grid.appendChild(this.makeCell(block));
    }
    panel.appendChild(grid);
    this.container.appendChild(panel);
    this.container.style.display = 'none';
  }

  private makeCell(block: Block): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'inv-cell';
    const cv = document.createElement('canvas');
    cv.width = 48;
    cv.height = 48;
    const ctx = cv.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const tile = representativeTile(block);
    const col = tile % ATLAS_COLS;
    const row = Math.floor(tile / ATLAS_COLS);
    ctx.drawImage(this.atlas, col * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX, 0, 0, cv.width, cv.height);
    cell.appendChild(cv);
    cell.addEventListener('click', () => {
      this.hotbar.setSlot(this.hotbar.active, block);
      this.close();
    });
    return cell;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.openInventory();
  }

  private openInventory(): void {
    this.open = true;
    this.container.style.display = 'flex';
    this.onOpen();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.container.style.display = 'none';
    this.onClose();
  }
}
