// Phase 11a: persisted user settings. A small plain object saved to localStorage
// (separate from the world save `mc_world_v1`) so quality/textures/sensitivity/
// render-distance/mute/mode survive reloads — the spec's Definition of Done item.
// Storage is best-effort: private mode / quota / corruption all fall back to
// defaults and never throw.

import { DEFAULT_SENSITIVITY, RENDER_DISTANCE_MED } from '../core/constants';

const KEY = 'mc_settings_v1';

export interface SettingsData {
  presetName: string; // 'Low' | 'Medium' | 'Cinematic'
  textureSourceId: string; // TextureSource.id ('procedural' | 'smooth' | ...)
  renderDistance: number; // chunk ring radius (overrides the preset default)
  sensitivity: number; // mouse-look radians per pixel
  muted: boolean;
  survival: boolean; // false = Creative (default); survival mechanics land in 11b
}

export const DEFAULT_SETTINGS: SettingsData = {
  presetName: 'Medium',
  textureSourceId: 'procedural',
  renderDistance: RENDER_DISTANCE_MED,
  sensitivity: DEFAULT_SENSITIVITY,
  muted: false,
  survival: false,
};

export class Settings {
  data: SettingsData;

  constructor() {
    this.data = Settings.load();
  }

  private static load(): SettingsData {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        // Merge over defaults so a stored object missing newer keys still works.
        return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<SettingsData>) };
      }
    } catch {
      /* unavailable / corrupt storage -> defaults */
    }
    return { ...DEFAULT_SETTINGS };
  }

  save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* private mode / quota -> skip silently */
    }
  }
}
