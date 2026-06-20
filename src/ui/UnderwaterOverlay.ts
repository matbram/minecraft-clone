// Phase 5/11 — full-screen blue tint shown while the camera eye is underwater.
// Pure DOM. The intensity is driven each frame (depth + actual light level) so the
// veil dims at night and with the surface light, never glowing on its own.

export class UnderwaterOverlay {
  private cur = -1;

  constructor(private readonly el: HTMLElement) {}

  // intensity 0..1 (0 = above water / off). CSS transition smooths the fade.
  setIntensity(intensity: number): void {
    const v = Math.max(0, Math.min(1, intensity));
    if (v === this.cur) return;
    this.cur = v;
    this.el.style.opacity = String(v);
  }
}
