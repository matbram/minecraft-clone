// Input + camera-look controller. Raw Pointer Lock for locking only; yaw/pitch
// tracked manually. Holds key + mouse-button state and exposes edge callbacks.
// Owns NO movement — the Player reads state from here and moves itself.

import { DEFAULT_SENSITIVITY } from '../core/constants';

export class Input {
  yaw = 0;
  pitch = 0;
  locked = false;

  onLockChange: (locked: boolean) => void = () => {};
  onWheel: (dir: number) => void = () => {}; // +1 / -1
  onMouseDown: (button: number) => void = () => {}; // 0 left, 2 right (only while locked)
  onMouseUp: (button: number) => void = () => {};
  onKeyPress: (code: string) => void = () => {}; // key-down edge (no auto-repeat)

  private readonly dom: HTMLElement;
  private readonly keys = new Set<string>();
  private readonly mouse = new Set<number>();
  private sensitivity = DEFAULT_SENSITIVITY; // settable via the settings menu

  constructor(dom: HTMLElement) {
    this.dom = dom;

    dom.addEventListener('click', () => {
      if (!this.locked) this.requestLock();
    });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      if (!this.locked) {
        this.keys.clear();
        this.mouse.clear();
      }
      this.onLockChange(this.locked);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch -= e.movementY * this.sensitivity;
      const lim = Math.PI / 2 - 0.01;
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    });

    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return; // the lock-acquiring click must not act in-game
      this.mouse.add(e.button);
      this.onMouseDown(e.button);
    });
    document.addEventListener('mouseup', (e) => {
      this.mouse.delete(e.button);
      this.onMouseUp(e.button);
    });

    dom.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        e.preventDefault();
        this.onWheel(Math.sign(e.deltaY));
      },
      { passive: false },
    );

    document.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // While playing (pointer locked), F5 is a game key (third-person toggle), not the
      // browser refresh — stop the reload so the camera mode cycles instead.
      if (this.locked && e.code === 'F5') e.preventDefault();
      this.keys.add(e.code);
      this.onKeyPress(e.code);
    });
    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }
  isMouseDown(button: number): boolean {
    return this.mouse.has(button);
  }
  setSensitivity(s: number): void {
    this.sensitivity = s;
  }
  requestLock(): void {
    this.dom.requestPointerLock();
  }
  releaseLock(): void {
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
  }
}
