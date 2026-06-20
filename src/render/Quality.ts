// Quality presets. Plain data (no THREE import) so the render pipeline just
// reads flags. Every expensive effect is gated here so none is load-bearing.

import {
  RENDER_DISTANCE_LOW,
  RENDER_DISTANCE_MED,
  RENDER_DISTANCE_CINEMATIC,
} from '../core/constants';

export enum Preset {
  LOW,
  MEDIUM,
  CINEMATIC,
}

export interface QualitySettings {
  preset: Preset;
  name: string;
  usePost: boolean; // false on LOW -> direct renderer.render
  bloom: boolean;
  godRays: boolean; // Cinematic only
  wavingFoliage: boolean;
  sky: boolean;
  sun: boolean;
  clouds: boolean;
  stars: boolean;
  renderDistance: number;
}

export const PRESETS: Record<Preset, QualitySettings> = {
  [Preset.LOW]: {
    preset: Preset.LOW,
    name: 'Low',
    usePost: false,
    bloom: false,
    godRays: false,
    wavingFoliage: false,
    sky: true,
    sun: true,
    clouds: false,
    stars: false,
    renderDistance: RENDER_DISTANCE_LOW,
  },
  [Preset.MEDIUM]: {
    preset: Preset.MEDIUM,
    name: 'Medium',
    usePost: true,
    bloom: true,
    godRays: false,
    wavingFoliage: true,
    sky: true,
    sun: true,
    clouds: true,
    stars: true,
    renderDistance: RENDER_DISTANCE_MED,
  },
  [Preset.CINEMATIC]: {
    preset: Preset.CINEMATIC,
    name: 'Cinematic',
    usePost: true,
    bloom: true,
    godRays: true,
    wavingFoliage: true,
    sky: true,
    sun: true,
    clouds: true,
    stars: true,
    renderDistance: RENDER_DISTANCE_CINEMATIC,
  },
};

export function nextPreset(p: Preset): Preset {
  return p === Preset.LOW ? Preset.MEDIUM : p === Preset.MEDIUM ? Preset.CINEMATIC : Preset.LOW;
}
