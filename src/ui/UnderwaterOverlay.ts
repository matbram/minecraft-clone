// Phase 5 — full-screen blue tint shown while the camera eye is underwater.
// Pure DOM (mirrors the Inventory show/hide pattern); the CSS opacity transition
// gives a soft fade so it doesn't pop at the exact surface line.

export class UnderwaterOverlay {
  private active = false;

  constructor(private readonly el: HTMLElement) {}

  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.el.classList.toggle('active', active);
  }
}
