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
// Phase 11.0/11.1 removed the dayFactor floor (strict source-only light): at deep
// midnight the directional day factor is 0 and the faint skyglow floor lives in
// nightAmbient instead, so moon shadows can darken below it.
check('midnight dayFactor 0 (no floor)', midnight.dayFactor < 0.01, midnight.dayFactor.toFixed(2));
check('midnight nightAmbient floor ~ 0.1', Math.abs(midnight.nightAmbient - 0.1) < 0.01, midnight.nightAmbient.toFixed(2));
check('midnight sun below horizon', !midnight.sunAboveHorizon, midnight.sunAboveHorizon);
check('midnight stars visible', midnight.starOpacity > 0.9, midnight.starOpacity.toFixed(2));

// Cycle advances + wraps.
const d = new DayNight(10, 0.0);
d.update(2.5); // quarter cycle -> dawn-ish
check('cycle advances phase', Math.abs(d.phase - 0.25) < 1e-6, d.phase.toFixed(3));

// Phase 12.5: visual moon phase. moonLightDir is a unit vector lighting the moon
// sphere; at full moon (moonPhase 0.5) the lit hemisphere faces the viewer (-moonDir),
// at new moon (0.0) it faces away (+moonDir). Stable regardless of time of day.
const mp = new DayNight(480, 0.0);
mp.moonPhase = 0.5;
mp.update(0); // recompute with the set phase
check('moonLightDir is unit', Math.abs(mp.moonLightDir.length() - 1) < 1e-3, mp.moonLightDir.length().toFixed(3));
check('full moon: lit faces viewer', mp.moonLightDir.dot(mp.moonDir) < -0.99, mp.moonLightDir.dot(mp.moonDir).toFixed(2));
mp.moonPhase = 0.0;
mp.update(0);
check('new moon: lit faces away', mp.moonLightDir.dot(mp.moonDir) > 0.99, mp.moonLightDir.dot(mp.moonDir).toFixed(2));

// Presets cycle Low -> Medium -> Cinematic -> Low.
check('nextPreset LOW->MEDIUM', nextPreset(Preset.LOW) === Preset.MEDIUM, nextPreset(Preset.LOW));
check('nextPreset MEDIUM->CINEMATIC', nextPreset(Preset.MEDIUM) === Preset.CINEMATIC, nextPreset(Preset.MEDIUM));
check('nextPreset CINEMATIC->LOW', nextPreset(Preset.CINEMATIC) === Preset.LOW, nextPreset(Preset.CINEMATIC));
check('Low godrays off, Cinematic on', !PRESETS[Preset.LOW].godRays && PRESETS[Preset.CINEMATIC].godRays, `${PRESETS[Preset.LOW].godRays}/${PRESETS[Preset.CINEMATIC].godRays}`);

console.log(pass ? 'DAYNIGHT: PASS' : 'DAYNIGHT: FAIL');
process.exit(pass ? 0 : 1);
