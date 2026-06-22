// DOM hotbar: 9 slots, number keys / wheel select, icons via the shared painter.

import { Block } from '../core/BlockTypes';
import { drawIcon } from './itemIcon';

const DEFAULT_SLOTS: Block[] = [
  Block.GRASS,
  Block.DIRT,
  Block.STONE,
  Block.TORCH, // slot 4 (Phase 15.5): place to light dark places
  Block.WATER, // slot 5: placeable source — flows + fills (LEAVES still in inventory)
  Block.LOG,
  Block.FLAMETHROWER, // slot 7 (Phase 15.5): hold to throw fire
  Block.APPLE, // slot 8: an edible so survival's eat loop is reachable out of the box
  Block.ROCKET_LAUNCHER, // slot 9 (Phase 15): the launcher, equipped by default for play
];

export class Hotbar {
  active = 0;
  slots: Block[] = [...DEFAULT_SLOTS];

  private readonly container: HTMLElement;
  private readonly atlas: HTMLCanvasElement;
  private readonly slotEls: HTMLElement[] = [];

  constructor(container: HTMLElement, atlasCanvas: HTMLCanvasElement) {
    this.container = container;
    this.atlas = atlasCanvas;
    this.build();
    this.refresh();
  }

  private build(): void {
    this.container.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const slot = document.createElement('div');
      slot.className = 'hotbar-slot';
      const cv = document.createElement('canvas');
      cv.width = 40;
      cv.height = 40;
      slot.appendChild(cv);
      const num = document.createElement('span');
      num.className = 'hotbar-num';
      num.textContent = String(i + 1);
      slot.appendChild(num);
      this.container.appendChild(slot);
      this.slotEls.push(slot);
    }
  }

  selected(): Block {
    return this.slots[this.active];
  }
  select(i: number): void {
    if (i >= 0 && i < 9) {
      this.active = i;
      this.refresh();
    }
  }
  cycle(dir: number): void {
    this.active = (this.active + dir + 9) % 9;
    this.refresh();
  }
  setSlot(i: number, b: Block): void {
    this.slots[i] = b;
    this.refresh();
  }

  refresh(): void {
    for (let i = 0; i < 9; i++) {
      const slot = this.slotEls[i];
      slot.classList.toggle('active', i === this.active);
      const cv = slot.querySelector('canvas') as HTMLCanvasElement;
      const ctx = cv.getContext('2d')!;
      drawIcon(ctx, this.slots[i], this.atlas, cv.width);
    }
  }
}
