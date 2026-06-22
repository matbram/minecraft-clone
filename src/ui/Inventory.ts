// DOM inventory overlay: a grid of all placeable blocks. Click one to assign it
// to the active hotbar slot. Opening releases pointer lock (handled via onOpen).

import { PLACEABLE, EDIBLE, WEAPONS, type Block } from '../core/BlockTypes';
import { drawIcon } from './itemIcon';
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
    for (const block of [...PLACEABLE, ...WEAPONS, ...EDIBLE]) {
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
    drawIcon(ctx, block, this.atlas, cv.width);
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
