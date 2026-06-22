// Phase 11.3: live, plain-language tuning panel. A compact side panel (does NOT dim
// the world) you open with K (or the pause-menu button) to adjust light/water by hand
// and watch it change. Each row is a lay-term label + slider + live value + a one-line
// description. Most knobs are instant (per-frame uniforms); the two that feed baked
// data apply on release (relight / remesh). Values live in Tunables; persistence is
// handled by the caller via onChange.

import { Tunables, resetTunables } from '../core/tunables';

export interface TuningCallbacks {
  onOpen: () => void; // release pointer lock, hide pause menu (mirrors inventory)
  onClose: () => void;
  onChange: () => void; // persist Tunables -> Settings (called after any edit)
  onRelight: () => void; // rebuild light+mesh of loaded chunks (cave darkness)
  onRemesh: () => void; // rebuild mesh of loaded chunks (water depth-darkening)
  onTimeOfDay: (phase: number) => void; // 0..1 -> DayNight.setPhase
}

type Heavy = 'relight' | 'remesh' | undefined;

interface Knob {
  label: string;
  desc: string;
  group: 'Lighting' | 'Water' | 'Combat';
  min: number;
  max: number;
  step: number;
  heavy: Heavy;
  get: () => number; // slider position from current state
  set: (s: number) => void; // apply slider position
  fmt: (s: number) => string; // value readout
}

// Slider <-> value maps are chosen so "more to the right" reads naturally for each.
function makeKnobs(time: { phase: number }): Knob[] {
  return [
    {
      label: 'Brightness',
      desc: 'Overall picture brightness.',
      group: 'Lighting',
      min: 60,
      max: 160,
      step: 5,
      heavy: undefined,
      get: () => Math.round(Tunables.brightness * 100),
      set: (s) => (Tunables.brightness = s / 100),
      fmt: (s) => `${s}%`,
    },
    {
      label: 'Cave darkness',
      desc: 'How quickly daylight fades inside caves. Right = darker.',
      group: 'Lighting',
      min: 1,
      max: 6,
      step: 1,
      heavy: 'relight',
      get: () => Tunables.skySideCost,
      set: (s) => (Tunables.skySideCost = s),
      fmt: (s) => `${s}`,
    },
    {
      label: 'Time of day',
      desc: 'Move the sun and moon to set the time.',
      group: 'Lighting',
      min: 0,
      max: 1439,
      step: 10,
      heavy: undefined,
      get: () => Math.round(time.phase * 1440) % 1440,
      set: (s) => {
        time.phase = s / 1440;
      },
      fmt: (s) => {
        const h = Math.floor(s / 60);
        const m = s % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      },
    },
    {
      label: 'Day length',
      desc: 'How long a full day-night cycle lasts.',
      group: 'Lighting',
      min: 25,
      max: 400,
      step: 25,
      heavy: undefined,
      get: () => Math.round(Tunables.dayLengthMult * 100),
      set: (s) => (Tunables.dayLengthMult = s / 100),
      fmt: (s) => `${(s / 100).toFixed(2)}×`,
    },
    {
      label: 'Underwater visibility',
      desc: 'How far you can see underwater. Right = clearer.',
      group: 'Water',
      min: 0,
      max: 100,
      step: 5,
      heavy: undefined,
      // density 0.16 (murky) .. 0.02 (clear); slider 0..100 = murky..clear
      get: () => Math.round(((0.16 - Tunables.underwaterDensity) / 0.14) * 100),
      set: (s) => (Tunables.underwaterDensity = 0.16 - 0.14 * (s / 100)),
      fmt: (s) => `${s}%`,
    },
    {
      label: 'Underwater haze',
      desc: 'Strength of the blue tint while submerged.',
      group: 'Water',
      min: 0,
      max: 100,
      step: 5,
      heavy: undefined,
      get: () => Math.round(Tunables.underwaterTint * 100),
      set: (s) => (Tunables.underwaterTint = s / 100),
      fmt: (s) => `${s}%`,
    },
    {
      label: 'Water darkens with depth',
      desc: 'How fast water gets dark as you dive deeper. Right = faster.',
      group: 'Water',
      min: 5,
      max: 40,
      step: 1,
      heavy: 'remesh',
      get: () => Math.round(Tunables.waterAbsorb * 100),
      set: (s) => (Tunables.waterAbsorb = s / 100),
      fmt: (s) => `${s}`,
    },
    {
      label: 'Water surface',
      desc: 'How visible the water surface is when you look up from underwater. 0 = off.',
      group: 'Water',
      min: 0,
      max: 100,
      step: 5,
      heavy: undefined,
      get: () => Math.round(Tunables.waterSurface * 100),
      set: (s) => (Tunables.waterSurface = s / 100),
      fmt: (s) => `${s}%`,
    },
    {
      label: 'Explosion power',
      desc: 'Rocket blast size & damage, on top of the ammo type. Right = bigger.',
      group: 'Combat',
      min: 25,
      max: 300,
      step: 25,
      heavy: undefined,
      get: () => Math.round(Tunables.explosionPower * 100),
      set: (s) => (Tunables.explosionPower = s / 100),
      fmt: (s) => `${(s / 100).toFixed(2)}×`,
    },
  ];
}

export class TuningPanel {
  open = false;
  private readonly root: HTMLElement;
  private readonly cb: TuningCallbacks;
  private readonly knobs: Knob[];
  private readonly rows: { knob: Knob; input: HTMLInputElement; value: HTMLElement }[] = [];
  // Local mirror of the day phase so "Time of day" reads the live cycle and scrubs it.
  private readonly time = { phase: 0 };

  constructor(container: HTMLElement, cb: TuningCallbacks) {
    this.root = container;
    this.cb = cb;
    this.knobs = makeKnobs(this.time);
    this.build();
    this.root.style.display = 'none';
  }

  private build(): void {
    this.root.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'tune-title';
    title.textContent = 'Tuning';
    this.root.appendChild(title);

    let currentGroup = '';
    for (const knob of this.knobs) {
      if (knob.group !== currentGroup) {
        currentGroup = knob.group;
        const h = document.createElement('div');
        h.className = 'tune-group';
        h.textContent = knob.group;
        this.root.appendChild(h);
      }
      this.root.appendChild(this.buildRow(knob));
    }

    const reset = document.createElement('button');
    reset.className = 'tune-reset';
    reset.textContent = 'Reset to defaults';
    reset.addEventListener('click', () => this.reset());
    this.root.appendChild(reset);

    const hint = document.createElement('div');
    hint.className = 'tune-hint';
    hint.textContent = 'Press K to close';
    this.root.appendChild(hint);
  }

  private buildRow(knob: Knob): HTMLElement {
    const row = document.createElement('div');
    row.className = 'tune-row';

    const head = document.createElement('div');
    head.className = 'tune-head';
    const label = document.createElement('span');
    label.textContent = knob.label;
    const value = document.createElement('span');
    value.className = 'tune-value';
    head.append(label, value);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(knob.min);
    input.max = String(knob.max);
    input.step = String(knob.step);

    const desc = document.createElement('div');
    desc.className = 'tune-desc';
    desc.textContent = knob.desc;

    // Live edits on input; heavy rebuilds on release (change).
    input.addEventListener('input', () => {
      const s = Number(input.value);
      knob.set(s);
      value.textContent = knob.fmt(s);
      if (knob.label === 'Time of day') this.cb.onTimeOfDay(this.time.phase);
      this.cb.onChange();
    });
    input.addEventListener('change', () => {
      if (knob.heavy === 'relight') this.cb.onRelight();
      else if (knob.heavy === 'remesh') this.cb.onRemesh();
    });

    row.append(head, input, desc);
    this.rows.push({ knob, input, value });
    return row;
  }

  // Pull current values into every slider (on open + after reset).
  private syncFromState(): void {
    for (const { knob, input, value } of this.rows) {
      const s = knob.get();
      input.value = String(s);
      value.textContent = knob.fmt(s);
    }
  }

  private reset(): void {
    resetTunables();
    this.syncFromState();
    this.cb.onChange();
    this.cb.onRelight(); // cave darkness back to default
    this.cb.onRemesh(); // water darkening back to default
  }

  // Called each frame with the live cycle phase so "Time of day" tracks it when the
  // user isn't dragging.
  setPhase(phase: number): void {
    this.time.phase = phase;
    if (!this.open) return;
    const row = this.rows.find((r) => r.knob.label === 'Time of day');
    if (row && document.activeElement !== row.input) {
      const s = row.knob.get();
      row.input.value = String(s);
      row.value.textContent = row.knob.fmt(s);
    }
  }

  toggle(): void {
    this.open ? this.close() : this.show();
  }
  show(): void {
    if (this.open) return;
    this.open = true;
    this.syncFromState();
    this.root.style.display = 'block';
    this.cb.onOpen();
  }
  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.style.display = 'none';
    this.cb.onClose();
  }
}
