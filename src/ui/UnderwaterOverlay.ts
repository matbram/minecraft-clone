// Phase 5/11 — full-screen blue tint shown while the camera eye is underwater.
// Pure DOM. The intensity is driven each frame (depth + actual light level) so the
// veil dims at night and with the surface light, never glowing on its own.

const TINT = 'rgba(28,72,100,0.85)'; // waterline gradient tint (matches the radial veil)

export class UnderwaterOverlay {
  private cur = -1;
  private line = -2; // last waterline split (-1 sentinel for "none")

  constructor(private readonly el: HTMLElement) {}

  // intensity 0..1 (0 = above water / off). CSS transition smooths the fade.
  setIntensity(intensity: number): void {
    const v = Math.max(0, Math.min(1, intensity));
    if (v === this.cur) return;
    this.cur = v;
    this.el.style.opacity = String(v);
  }

  // Phase 11.5: half-submerged waterline. `split` = screen fraction (0..1 from the
  // bottom) that is underwater; null = full veil (deep) — restore the CSS radial.
  setWaterline(split: number | null): void {
    const key = split === null ? -1 : Math.round(split * 100) / 100;
    if (key === this.line) return;
    this.line = key;
    if (split === null) {
      this.el.style.background = ''; // fall back to the CSS radial veil
      return;
    }
    const p = Math.round(split * 100);
    this.el.style.background =
      `linear-gradient(to top, ${TINT} 0%, ${TINT} ${p}%, transparent ${Math.min(100, p + 5)}%, transparent 100%)`;
  }
}
