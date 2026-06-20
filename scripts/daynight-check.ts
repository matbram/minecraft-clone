// Headless checks for the day/night model and preset cycling.
import { DayNight } from '../src/render/DayNight';
import { Preset, nextPreset, PRESETS } from '../src/render/Quality';

let pass = true;
const check = (name: string, cond: boolean, got: unknown) => {
  console.log(`${cond ? 'OK ' : 'FAIL'}  ${name}  (got ${got})`);
  pass &&= cond;
};

const noon = new DayNight(480, 0.5);
check('noon dayFactor ~ 1', Math.abs(noon.dayFactor - 1) < 0.01, noon.dayFactor.toFixed(2));
check('noon sun above horizon', noon.sunAboveHorizon, noon.sunAboveHorizon);
check('noon sun overhead (dir.y > 0.9)', noon.sunDir.y > 0.9, noon.sunDir.y.toFixed(2));
check('noon horizon == day blue 0x8fc6f0', noon.horizon.getHex() === 0x8fc6f0, noon.horizon.getHexString());
check('noon stars hidden', noon.starOpacity < 0.01, noon.starOpacity.toFixed(2));

const midnight = new DayNight(480, 0.0);
check('midnight dayFactor floor ~ 0.12', Math.abs(midnight.dayFactor - 0.12) < 0.01, midnight.dayFactor.toFixed(2));
check('midnight sun below horizon', !midnight.sunAboveHorizon, midnight.sunAboveHorizon);
check('midnight stars visible', midnight.starOpacity > 0.9, midnight.starOpacity.toFixed(2));

// Cycle advances + wraps.
const d = new DayNight(10, 0.0);
d.update(2.5); // quarter cycle -> dawn-ish
check('cycle advances phase', Math.abs(d.phase - 0.25) < 1e-6, d.phase.toFixed(3));

// Presets cycle Low -> Medium -> Cinematic -> Low.
check('nextPreset LOW->MEDIUM', nextPreset(Preset.LOW) === Preset.MEDIUM, nextPreset(Preset.LOW));
check('nextPreset MEDIUM->CINEMATIC', nextPreset(Preset.MEDIUM) === Preset.CINEMATIC, nextPreset(Preset.MEDIUM));
check('nextPreset CINEMATIC->LOW', nextPreset(Preset.CINEMATIC) === Preset.LOW, nextPreset(Preset.CINEMATIC));
check('Low godrays off, Cinematic on', !PRESETS[Preset.LOW].godRays && PRESETS[Preset.CINEMATIC].godRays, `${PRESETS[Preset.LOW].godRays}/${PRESETS[Preset.CINEMATIC].godRays}`);

console.log(pass ? 'DAYNIGHT: PASS' : 'DAYNIGHT: FAIL');
process.exit(pass ? 0 : 1);
