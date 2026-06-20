// Phase 11a: the start / pause overlay. Shown whenever the pointer is unlocked
// (and the inventory isn't open) — it is the start screen on first load and the
// pause screen on Esc. Holds the Play button, the controls cheatsheet, and live
// settings controls. Changes call back into main.ts (which applies + persists),
// and `refresh()` re-syncs the controls when a hotkey (G/T/M) changes a value.

import {
  RENDER_DISTANCE_MIN,
  RENDER_DISTANCE_MAX,
  SENSITIVITY_MIN,
  SENSITIVITY_MAX,
} from '../core/constants';
import type { Settings } from './Settings';

export interface MenuHandlers {
  onResume(): void;
  onPreset(name: string): void;
  onTexture(id: string): void;
  onRenderDistance(r: number): void;
  onSensitivity(s: number): void;
  onMuted(muted: boolean): void;
  onSurvival(survival: boolean): void;
}

// Friendlier labels for the texture-source ids.
const TEXTURE_LABELS: Record<string, string> = {
  procedural: 'Faithful',
  smooth: 'Smooth',
  pack: 'Texture pack',
};

// Map sensitivity (radians/px) <-> an integer slider position for a nice feel.
const SENS_STEPS = 100;
function sensToSlider(s: number): number {
  const t = (s - SENSITIVITY_MIN) / (SENSITIVITY_MAX - SENSITIVITY_MIN);
  return Math.round(Math.min(1, Math.max(0, t)) * SENS_STEPS);
}
function sliderToSens(v: number): number {
  return SENSITIVITY_MIN + (v / SENS_STEPS) * (SENSITIVITY_MAX - SENSITIVITY_MIN);
}

export class PauseMenu {
  private readonly container: HTMLElement;
  private readonly settings: Settings;
  private readonly handlers: MenuHandlers;
  private readonly textureIds: string[];

  // Control refs kept for refresh().
  private playBtn!: HTMLButtonElement;
  private presetSel!: HTMLSelectElement;
  private textureSel!: HTMLSelectElement;
  private rdSlider!: HTMLInputElement;
  private rdValue!: HTMLSpanElement;
  private sensSlider!: HTMLInputElement;
  private sensValue!: HTMLSpanElement;
  private modeSel!: HTMLSelectElement;
  private muteChk!: HTMLInputElement;
  private firstShow = true;

  constructor(
    container: HTMLElement,
    settings: Settings,
    textureIds: string[],
    handlers: MenuHandlers,
  ) {
    this.container = container;
    this.settings = settings;
    this.handlers = handlers;
    this.textureIds = textureIds;
    this.build();
    this.refresh();
  }

  private build(): void {
    this.container.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'menu-panel';

    const title = document.createElement('div');
    title.className = 'menu-title';
    title.textContent = 'Minecraft Clone';
    panel.appendChild(title);

    this.playBtn = document.createElement('button');
    this.playBtn.className = 'menu-btn';
    this.playBtn.textContent = 'Play';
    this.playBtn.addEventListener('click', () => this.handlers.onResume());
    panel.appendChild(this.playBtn);

    const settingsHdr = document.createElement('div');
    settingsHdr.className = 'menu-section';
    settingsHdr.textContent = 'Settings';
    panel.appendChild(settingsHdr);

    // Quality preset.
    this.presetSel = this.addSelect(panel, 'Quality', ['Low', 'Medium', 'Cinematic'], (v) =>
      this.handlers.onPreset(v),
    );

    // Texture source.
    this.textureSel = this.addSelect(
      panel,
      'Textures',
      this.textureIds.map((id) => ({ value: id, label: TEXTURE_LABELS[id] ?? id })),
      (v) => this.handlers.onTexture(v),
    );

    // Render distance slider.
    {
      const { input, value } = this.addSlider(
        panel,
        'Render distance',
        RENDER_DISTANCE_MIN,
        RENDER_DISTANCE_MAX,
        1,
        (v) => {
          this.rdValue.textContent = `${v}`;
          this.handlers.onRenderDistance(v);
        },
      );
      this.rdSlider = input;
      this.rdValue = value;
    }

    // Sensitivity slider.
    {
      const { input, value } = this.addSlider(panel, 'Sensitivity', 0, SENS_STEPS, 1, (v) => {
        const s = sliderToSens(v);
        this.sensValue.textContent = `${Math.round((v / SENS_STEPS) * 100)}%`;
        this.handlers.onSensitivity(s);
      });
      this.sensSlider = input;
      this.sensValue = value;
    }

    // Creative / Survival mode.
    this.modeSel = this.addSelect(
      panel,
      'Mode',
      [
        { value: 'creative', label: 'Creative' },
        { value: 'survival', label: 'Survival' },
      ],
      (v) => this.handlers.onSurvival(v === 'survival'),
    );

    // Mute checkbox.
    {
      const row = document.createElement('label');
      row.className = 'menu-row menu-check';
      const span = document.createElement('span');
      span.textContent = 'Mute sound';
      this.muteChk = document.createElement('input');
      this.muteChk.type = 'checkbox';
      this.muteChk.addEventListener('change', () => this.handlers.onMuted(this.muteChk.checked));
      row.appendChild(span);
      row.appendChild(this.muteChk);
      panel.appendChild(row);
    }

    // Controls cheatsheet.
    const controlsHdr = document.createElement('div');
    controlsHdr.className = 'menu-section';
    controlsHdr.textContent = 'Controls';
    panel.appendChild(controlsHdr);
    const controls = document.createElement('div');
    controls.className = 'menu-controls';
    controls.innerHTML =
      'WASD move · Space jump / swim up · Ctrl sprint · Shift sneak / dive<br />' +
      'LMB break · RMB place · 1–9 select · Wheel cycle · E inventory · F fly<br />' +
      'T textures · G quality · M mute · N fast-forward time · P pause time · Esc menu';
    panel.appendChild(controls);

    this.container.appendChild(panel);
    this.container.style.display = 'none';
  }

  // --- small DOM builders --------------------------------------------------

  private addSelect(
    parent: HTMLElement,
    label: string,
    options: string[] | { value: string; label: string }[],
    onChange: (value: string) => void,
  ): HTMLSelectElement {
    const row = document.createElement('div');
    row.className = 'menu-row';
    const span = document.createElement('span');
    span.textContent = label;
    const sel = document.createElement('select');
    for (const opt of options) {
      const o = document.createElement('option');
      if (typeof opt === 'string') {
        o.value = opt;
        o.textContent = opt;
      } else {
        o.value = opt.value;
        o.textContent = opt.label;
      }
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => onChange(sel.value));
    row.appendChild(span);
    row.appendChild(sel);
    parent.appendChild(row);
    return sel;
  }

  private addSlider(
    parent: HTMLElement,
    label: string,
    min: number,
    max: number,
    step: number,
    onInput: (value: number) => void,
  ): { input: HTMLInputElement; value: HTMLSpanElement } {
    const row = document.createElement('div');
    row.className = 'menu-row';
    const span = document.createElement('span');
    span.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = `${min}`;
    input.max = `${max}`;
    input.step = `${step}`;
    const value = document.createElement('span');
    value.className = 'menu-val';
    input.addEventListener('input', () => onInput(Number(input.value)));
    row.appendChild(span);
    row.appendChild(input);
    row.appendChild(value);
    parent.appendChild(row);
    return { input, value };
  }

  // --- visibility + sync ---------------------------------------------------

  // Re-read settings into the controls (after a hotkey change or on first build).
  refresh(): void {
    const d = this.settings.data;
    this.presetSel.value = d.presetName;
    this.textureSel.value = d.textureSourceId;
    this.rdSlider.value = `${d.renderDistance}`;
    this.rdValue.textContent = `${d.renderDistance}`;
    this.sensSlider.value = `${sensToSlider(d.sensitivity)}`;
    this.sensValue.textContent = `${Math.round(
      ((sensToSlider(d.sensitivity)) / SENS_STEPS) * 100,
    )}%`;
    this.modeSel.value = d.survival ? 'survival' : 'creative';
    this.muteChk.checked = d.muted;
  }

  setVisible(visible: boolean): void {
    if (visible) this.refresh();
    this.container.style.display = visible ? 'flex' : 'none';
    if (visible && this.firstShow) {
      this.firstShow = false;
    } else if (visible) {
      this.playBtn.textContent = 'Resume';
    }
  }
}
