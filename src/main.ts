// Entry point: wire renderer, world, generation, meshing, and the fly camera,
// then run the throttled render loop.

import * as THREE from 'three';
import {
  DEFAULT_SEED,
  FIXED_DT,
  MAX_FRAME_DT,
  MAX_SUBSTEPS,
  DAY_FF_MULT,
  WIND_STRENGTH,
  LAYER_TRANSPARENT,
  UNDERWATER_FOG_COLOR,
  UNDERWATER_DEEP_COLOR,
  UNDERWATER_COLOR_DEPTH,
  UNDERWATER_PARTICLES,
  MAX_FLUID_OPS_PER_TICK,
  EYE_HEIGHT,
  RESPAWN_FLASH_SECONDS,
  worldToChunk,
} from './core/constants';
import { Tunables } from './core/tunables';
import { Block } from './core/BlockTypes';
import { surfaceHeight } from './core/WorldGen';
import { World } from './world/World';
import { GenScheduler } from './gen/GenScheduler';
import { buildAtlas } from './render/atlas';
import { buildCrackAtlas } from './render/crackAtlas';
import { createMaterials } from './render/materials';
import { ChunkRenderer } from './render/ChunkRenderer';
import { ChunkManager } from './game/ChunkManager';
import { Input } from './player/Input';
import { Player, PlayerMode } from './player/Player';
import { BlockOutline } from './render/BlockOutline';
import { BreakOverlay } from './render/BreakOverlay';
import { Hotbar } from './ui/Hotbar';
import { Inventory } from './ui/Inventory';
import { Interaction } from './interaction/Interaction';
import { Effects } from './fx/Effects';
import { DayNight } from './render/DayNight';
import { Sky } from './render/Sky';
import { SunMoon } from './render/SunMoon';
import { Clouds } from './render/Clouds';
import { Stars } from './render/Stars';
import { Composer } from './render/post/Composer';
import { ShadowMapper } from './render/shadows/ShadowMapper';
import { PlanarReflection } from './render/water/PlanarReflection';
import { Preset, PRESETS, nextPreset, presetByName, type QualitySettings } from './render/Quality';
import { TextureRegistry } from './render/textures/TextureSource';
import { ProceduralTextureSource } from './render/textures/ProceduralTextureSource';
import { ProceduralPackTextureSource } from './render/textures/proceduralPack';
import { UnderwaterOverlay } from './ui/UnderwaterOverlay';
import { UnderwaterParticles } from './render/UnderwaterParticles';
import { Settings } from './ui/Settings';
import { PauseMenu } from './ui/PauseMenu';
import { Survival } from './player/Survival';
import { SurvivalHud } from './ui/SurvivalHud';
import { TuningPanel } from './ui/TuningPanel';

function readSeed(): number {
  const p = new URLSearchParams(location.search).get('seed');
  if (p !== null) {
    const n = Number(p);
    if (Number.isFinite(n)) return n | 0;
  }
  return DEFAULT_SEED;
}

const seed = readSeed();

// Show a clear, actionable message instead of a silent blue screen when the
// browser refuses a WebGL context (GPU acceleration off / GPU blocklisted).
function showFatalError(title: string, bodyHtml: string): void {
  const menuEl = document.getElementById('menu');
  if (menuEl) menuEl.remove();
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(10,20,30,0.92);color:#eaf2ff;font:15px/1.5 system-ui,sans-serif;' +
    'padding:24px;z-index:9999;';
  el.innerHTML =
    `<div style="max-width:560px;background:#16222e;border:1px solid #2c4a63;` +
    `border-radius:12px;padding:24px 28px;">` +
    `<h2 style="margin:0 0 12px;font-size:20px;">${title}</h2>${bodyHtml}</div>`;
  document.body.appendChild(el);
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

// --- renderer + scene ------------------------------------------------------
const app = document.getElementById('app')!;
const skyColor = new THREE.Color(0x8fc6f0);

if (!webglAvailable()) {
  showFatalError(
    'WebGL is unavailable in this browser',
    `<p>This game needs WebGL, but your browser could not create a graphics context
       (the console shows <code>GL_RENDERER = Disabled</code>). The page itself loaded fine —
       this is a browser/GPU setting on your machine.</p>
     <p style="margin-top:12px"><b>To fix it (Chrome):</b></p>
     <ol style="margin:6px 0 0 18px;padding:0">
       <li>Open <code>chrome://settings/system</code> → enable
           <b>“Use graphics acceleration when available”</b> → <b>Relaunch</b>.</li>
       <li>If still off, open <code>chrome://gpu</code> and check the <b>WebGL</b> status.</li>
       <li>As a last resort, open <code>chrome://flags</code>, enable
           <b>“Override software rendering list”</b>, and relaunch.</li>
       <li>Or fully quit &amp; reopen Chrome (the <code>BindToCurrentSequence failed</code>
           error is often transient), or try another browser.</li>
     </ol>`,
  );
  throw new Error('WebGL unavailable');
}

let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: false, // allow software fallback if present
  });
} catch (err) {
  showFatalError(
    'Could not start the 3D renderer',
    `<p>Your browser blocked WebGL context creation. Enable hardware acceleration
       in your browser settings (see <code>chrome://gpu</code>) and reload.</p>
     <p style="margin-top:8px;opacity:0.7">${String(err)}</p>`,
  );
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(skyColor, 1);
app.appendChild(renderer.domElement);

// Surface a later context loss (e.g. GPU reset) instead of freezing silently.
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  showFatalError(
    'WebGL context lost',
    `<p>The GPU context was lost (driver reset or the tab was backgrounded too long).
       Reload the page to continue.</p>`,
  );
});

const scene = new THREE.Scene();
// Sky dome (Phase 4a) replaces the flat background; clear color is a fallback.

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
// Transparent (water/glass) chunks live only on LAYER_TRANSPARENT so the planar
// reflection camera won't reflect the water; the main camera must opt back in.
camera.layers.enable(LAYER_TRANSPARENT);

// --- assets + systems ------------------------------------------------------
const atlas = buildAtlas();
const materials = createMaterials(atlas.texture, skyColor);
const textures = new TextureRegistry([
  new ProceduralTextureSource(atlas),
  new ProceduralPackTextureSource(),
]);

const world = new World(seed);
world.load();

const scheduler = new GenScheduler(seed);
const chunkRenderer = new ChunkRenderer(scene, materials);
const chunkManager = new ChunkManager(world, scheduler, chunkRenderer);

// --- player + interaction --------------------------------------------------
const input = new Input(renderer.domElement);

const spawnX = 8.5;
const spawnZ = 8.5;
const spawnY = surfaceHeight(Math.floor(spawnX), Math.floor(spawnZ), seed) + 2;
const spawnPos = new THREE.Vector3(spawnX, spawnY, spawnZ);
const player = new Player(world, input, spawnPos);
input.pitch = -0.2;

const outline = new BlockOutline(scene);
const breakOverlay = new BreakOverlay(scene, buildCrackAtlas());

const hotbar = new Hotbar(document.getElementById('hotbar')!, atlas.canvas);
const inventory = new Inventory(document.getElementById('inventory')!, atlas.canvas, hotbar);
const interaction = new Interaction(world, input, player, hotbar, outline, breakOverlay);

// --- feel FX (Phase 2) -----------------------------------------------------
const effects = new Effects(scene, world, input, player, atlas);
interaction.onBreak = (b, x, y, z) => effects.onBreak(b, x, y, z);
interaction.onPlace = (b) => effects.onPlace(b);
let audioResumed = false;
const prefs = new Settings();
let muted = prefs.data.muted;
// Phase 11.3: seed the live tuning knobs from the saved settings BEFORE the world
// streams, so the first light/mesh bake already uses the saved values (no rebake).
Object.assign(Tunables, prefs.data.tuning);

// --- survival (Phase 11b) --------------------------------------------------
const survival = new Survival();
const survivalHud = new SurvivalHud(document.getElementById('survival-hud')!);
const deathOverlay = document.getElementById('death-overlay')!;
let deathFlash = 0; // seconds remaining of the red respawn flash
interaction.onEat = (food) => {
  if (!prefs.data.survival) return false; // eating only matters in survival mode
  const ate = survival.eat(food);
  if (ate) effects.onEat();
  return ate;
};
function respawn(): void {
  player.pos.copy(spawnPos);
  player.prevPos.copy(spawnPos);
  player.vel.set(0, 0, 0);
  survival.reset();
  deathFlash = RESPAWN_FLASH_SECONDS;
  deathOverlay.classList.add('active');
}

// --- cinematic (Phase 4a) --------------------------------------------------
let settings: QualitySettings = PRESETS[Preset.MEDIUM];
const dayNight = new DayNight();
const sky = new Sky(scene);
const sunMoon = new SunMoon(scene);
const clouds = new Clouds(scene);
const stars = new Stars(scene);
const composer = new Composer(renderer, scene, camera, settings);
const shadowMapper = new ShadowMapper(materials.shared);
const planarReflection = new PlanarReflection(materials.shared);
const tmpSunUv = new THREE.Vector3();

// Phase 5/7b: underwater tint + fog override + drifting motes. Precompute both
// colorspaces (shallow + deep) so the override matches DayNight's (linear under ACES).
const underwaterOverlay = new UnderwaterOverlay(document.getElementById('underwater-tint')!);
const underwaterParticles = new UnderwaterParticles(scene, UNDERWATER_PARTICLES);
const uwFogColorSRGB = new THREE.Color(UNDERWATER_FOG_COLOR);
const uwFogColorLinear = uwFogColorSRGB.clone().convertSRGBToLinear();
const uwDeepColorSRGB = new THREE.Color(UNDERWATER_DEEP_COLOR);
const uwDeepColorLinear = uwDeepColorSRGB.clone().convertSRGBToLinear();

function applyPreset(p: Preset): void {
  settings = PRESETS[p];
  composer.setPreset(settings);
  chunkManager.setRenderDistance(settings.renderDistance);
  materials.shared.uWind.value = settings.wavingFoliage ? WIND_STRENGTH : 0;
  sky.setVisible(settings.sky);
  sunMoon.setVisible(settings.sun);
  clouds.setVisible(settings.clouds);
  stars.setVisible(settings.stars);
  // Phase 4b: toggling only binds/unbinds maps + strengths -> no rebuild.
  shadowMapper.setActive(settings.shadows);
  planarReflection.setActive(settings.waterReflections);
}
// Phase 11a: apply persisted settings. applyPreset sets the preset's default
// render distance; the saved render-distance override + sensitivity + texture +
// mute are then applied on top so explicit choices survive reloads.
applyPreset(presetByName(prefs.data.presetName));
chunkManager.setRenderDistance(prefs.data.renderDistance);
input.setSensitivity(prefs.data.sensitivity);
materials.shared.uAtlas.value = textures.selectById(prefs.data.textureSourceId).getAtlas();
effects.setMuted(prefs.data.muted);
survivalHud.setVisible(prefs.data.survival);

// --- UI glue ---------------------------------------------------------------
// Settings mutators (shared by the menu controls AND the G/T/M hotkeys) — each
// applies the change live, persists it, and re-syncs the menu controls.
function changePreset(name: string): void {
  applyPreset(presetByName(name));
  prefs.data.presetName = settings.name;
  prefs.data.renderDistance = settings.renderDistance; // switching preset resets distance
  prefs.save();
  menu.refresh();
}
function setTexture(id: string): void {
  materials.shared.uAtlas.value = textures.selectById(id).getAtlas(); // instant, no re-mesh
  prefs.data.textureSourceId = textures.active.id;
  prefs.save();
  menu.refresh();
}
function cycleTexture(): void {
  materials.shared.uAtlas.value = textures.cycle().getAtlas();
  prefs.data.textureSourceId = textures.active.id;
  prefs.save();
  menu.refresh();
}
function setRenderDistance(r: number): void {
  chunkManager.setRenderDistance(r);
  prefs.data.renderDistance = r;
  prefs.save();
}
function setSensitivity(s: number): void {
  input.setSensitivity(s);
  prefs.data.sensitivity = s;
  prefs.save();
}
function setMuted(m: boolean): void {
  muted = m;
  effects.setMuted(m);
  prefs.data.muted = m;
  prefs.save();
  menu.refresh();
}
function setSurvival(s: boolean): void {
  prefs.data.survival = s;
  prefs.save();
  survival.reset(); // start the chosen mode with full bars
  survivalHud.setVisible(s); // Creative hides the HUD entirely
}

const menu = new PauseMenu(document.getElementById('menu')!, prefs, textures.ids, {
  onResume: () => input.requestLock(),
  onPreset: changePreset,
  onTexture: setTexture,
  onRenderDistance: setRenderDistance,
  onSensitivity: setSensitivity,
  onMuted: setMuted,
  onSurvival: setSurvival,
  onTuning: () => tuning.show(),
});

// Phase 11.3: live tuning panel (K). A side panel that leaves the world visible so
// edits show instantly; mirrors the inventory's lock handling so it coexists with the
// pause menu. Heavy knobs rebuild loaded chunks through the throttled queues.
const tuning = new TuningPanel(document.getElementById('tuning')!, {
  onOpen: () => {
    inventory.close();
    input.releaseLock();
    updateMenuVisibility();
  },
  onClose: () => updateMenuVisibility(),
  onChange: () => {
    prefs.data.tuning = { ...Tunables };
    prefs.save();
  },
  onRelight: () => chunkManager.rebuildLighting(),
  onRemesh: () => chunkManager.remeshAll(),
  onTimeOfDay: (p) => dayNight.setPhase(p),
});

// The menu is the start screen (first load) and the pause screen (Esc): shown
// whenever the pointer is unlocked, except while the inventory or tuning overlay is open.
function updateMenuVisibility(): void {
  menu.setVisible(!input.locked && !inventory.open && !tuning.open);
}

input.onLockChange = (locked) => {
  if (locked && !audioResumed) {
    effects.resumeAudio(); // pointer-lock click is the user gesture for WebAudio
    audioResumed = true;
  }
  if (locked && inventory.open) inventory.close(); // clicking back into the game closes inventory
  if (locked && tuning.open) tuning.close();
  updateMenuVisibility();
};
inventory.onOpen = () => {
  tuning.close();
  input.releaseLock();
  interaction.setPaused(true);
  updateMenuVisibility(); // keep the menu hidden while the inventory is open
};
inventory.onClose = () => {
  interaction.setPaused(false);
  updateMenuVisibility(); // pointer still unlocked after closing -> show the menu
};

input.onWheel = (dir) => hotbar.cycle(dir);
input.onMouseDown = (button) => {
  if (button === 2) interaction.tryUse(); // eat a held food, else place a block
};
input.onKeyPress = (code) => {
  if (code === 'Escape') {
    if (inventory.open) inventory.close(); // (when locked, the browser exits lock -> menu)
    else if (tuning.open) tuning.close();
    return;
  }
  if (code === 'KeyE') {
    inventory.toggle();
    return;
  }
  if (code === 'KeyK') {
    tuning.toggle();
    return;
  }
  if (code === 'KeyF') {
    player.toggleMode();
    return;
  }
  if (code === 'KeyM') {
    setMuted(!muted);
    return;
  }
  if (code === 'KeyT') {
    cycleTexture();
    return;
  }
  if (code === 'KeyG') {
    changePreset(PRESETS[nextPreset(settings.preset)].name);
    return;
  }
  if (code === 'KeyP') {
    dayNight.paused = !dayNight.paused;
    return;
  }
  if (code.startsWith('Digit')) {
    const n = Number(code.slice(5));
    if (n >= 1 && n <= 9) hotbar.select(n - 1);
  }
};

// Show the start screen on first load (pointer is unlocked).
updateMenuVisibility();

const hud = document.getElementById('hud')!;

// --- resize ----------------------------------------------------------------
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h, Math.min(window.devicePixelRatio, 2));
  planarReflection.setSize(w, h);
});

// --- persistence -----------------------------------------------------------
const autosave = window.setInterval(() => world.save(), 15000);
window.addEventListener('beforeunload', () => {
  world.save();
  window.clearInterval(autosave);
});

// --- render loop -----------------------------------------------------------
let last = performance.now();
let fpsSmooth = 60;
let hudAccum = 0;
let accumulator = 0;
let physicsStarted = false; // hold physics until the spawn chunk exists
const tmpDir = new THREE.Vector3();

function spawnChunkReady(): boolean {
  return !!world.getChunk(worldToChunk(player.pos.x), worldToChunk(player.pos.z));
}

function frame(now: number): void {
  let frameDt = (now - last) / 1000;
  last = now;
  if (frameDt > MAX_FRAME_DT) frameDt = MAX_FRAME_DT; // clamp -> no spiral of death

  if (!physicsStarted && spawnChunkReady()) physicsStarted = true;

  // Fixed-timestep simulation (20 TPS).
  if (physicsStarted) {
    accumulator += frameDt;
    let steps = 0;
    while (accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      player.prevPos.copy(player.pos);
      player.tick(FIXED_DT);
      interaction.tick(FIXED_DT);
      world.tickFluids(MAX_FLUID_OPS_PER_TICK);
      // Survival (Phase 11b): only when enabled + locked (paused/menu never drains).
      // Reads landingImpact set by player.tick this same step.
      if (prefs.data.survival && input.locked) {
        const headUnderwater =
          world.getBlockWorld(
            Math.floor(player.pos.x),
            Math.floor(player.pos.y + EYE_HEIGHT),
            Math.floor(player.pos.z),
          ) === Block.WATER;
        survival.tick(FIXED_DT, player, headUnderwater);
        if (survival.dead) respawn();
      }
      accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_SUBSTEPS) accumulator = 0; // drop backlog after a stall
  }

  // Advance the day/night cycle (hold N to fast-forward; "Day length" knob stretches
  // it). dayLengthMult > 1 = longer day = slower advance.
  const tScale = input.isDown('KeyN') ? DAY_FF_MULT : 1;
  dayNight.update((frameDt * tScale) / Tunables.dayLengthMult);
  tuning.setPhase(dayNight.phase); // keep the "Time of day" slider tracking the cycle

  // Per-frame (responsive): camera, aim, streaming, render.
  const alpha = physicsStarted ? accumulator / FIXED_DT : 0;
  player.applyToCamera(camera, alpha);
  camera.getWorldDirection(tmpDir);
  interaction.updateAim(camera.position, tmpDir); // aim BEFORE view-bob so the crosshair is steady
  // Sky-light multiplier for tinting world FX (so dropped items / particles / motes
  // match the real light and don't glow in the dark). Mirrors the shader's sky term.
  const fxSkyMul = Math.max(dayNight.dayFactor, dayNight.moonFactor, dayNight.nightAmbient);
  effects.update(frameDt, camera, fxSkyMul); // sets sprint FOV + applies view-bob to camera

  // Underwater state (computed once; camera is final after view-bob). Nothing is
  // hidden: the surface light (sky/sun/moon/stars/clouds + rays) is ABSORBED by the
  // water with depth, so near the surface you see it and deep it fades to dark.
  const submerged =
    world.getBlockWorld(
      Math.floor(camera.position.x),
      Math.floor(camera.position.y),
      Math.floor(camera.position.z),
    ) === Block.WATER;
  // Underwater realism (Phase 11.2): driven by the LOCAL water column above the eye +
  // the light actually present here, NOT absolute depth below sea level. So 2 blocks
  // of water read clear (bright if lit, dark in a cave); only a real deep column
  // darkens + blues out. depthFrac -> colour shift + surface(Snell) fade; uwBright ->
  // how lit it is here (≈0 in an unlit cave, ~1 in a sunlit shallow pool).
  let depthFrac = 0;
  let uwBright = 0;
  if (submerged) {
    const ex = Math.floor(camera.position.x);
    const ey = Math.floor(camera.position.y);
    const ez = Math.floor(camera.position.z);
    const eyeWater = world.waterDepthAbove(ex, ey, ez);
    depthFrac = Math.min(eyeWater / UNDERWATER_COLOR_DEPTH, 1);
    const downwell = Math.exp(-Tunables.waterAbsorb * eyeWater); // open-column darkening
    uwBright = Math.min(world.brightnessAt(ex, ey, ez, fxSkyMul) * downwell, 1);
  }
  const lightFade = depthFrac; // surface light (sky/sun/rays) fades with local depth

  // Survival HUD (Phase 11b): cheap when unchanged (icons redraw only on change);
  // the air row shows while the eye is submerged. Hidden entirely in Creative.
  survivalHud.update(survival.health, survival.hunger, survival.air, submerged);
  if (deathFlash > 0) {
    deathFlash -= frameDt;
    if (deathFlash <= 0) deathOverlay.classList.remove('active');
  }

  sunMoon.setVisible(settings.sun);
  clouds.setVisible(settings.clouds);
  stars.setVisible(settings.stars);

  sky.update(camera.position, dayNight);
  sunMoon.update(camera.position, dayNight);
  clouds.update(camera.position, dayNight, frameDt);
  stars.update(camera.position, dayNight);
  // Absorb the above-water visuals toward the deep water color as the eye descends.
  sky.setUnderwater(lightFade, settings.usePost ? uwDeepColorLinear : uwDeepColorSRGB);
  sunMoon.setUnderwaterFade(lightFade);
  stars.setUnderwaterFade(lightFade);
  clouds.setUnderwaterFade(lightFade);

  materials.shared.uTime.value = now / 1000;
  materials.shared.uDayFactor.value = dayNight.dayFactor;
  materials.shared.uMoonFactor.value = dayNight.moonFactor;
  materials.shared.uNightAmbient.value = dayNight.nightAmbient;
  materials.shared.uFogColor.value.copy(dayNight.fogColor);
  materials.shared.uFogDensity.value = dayNight.fogDensity;
  materials.shared.uSunDir.value.copy(dayNight.sunDir);
  materials.shared.uSkyLightColor.value.copy(dayNight.skyLightColor);

  // Underwater (Phase 5/7b/8b/11.2): override the shared fog (DayNight rewrote it just
  // above, so this auto-clears on surfacing). The veil COLOUR shifts shallow->deep by
  // the local column and is dimmed to the light actually here (dark in a cave, dark at
  // night); the per-meter VISIBILITY is a constant water clarity (the live tuning knob,
  // not depth). In-shader absorption/caustics + the post wobble read uUnderwaterDepth.
  // Reflections are already disabled below the surface.
  if (submerged) {
    const shallow = settings.usePost ? uwFogColorLinear : uwFogColorSRGB;
    const deep = settings.usePost ? uwDeepColorLinear : uwDeepColorSRGB;
    materials.shared.uFogColor.value.copy(shallow).lerp(deep, depthFrac).multiplyScalar(uwBright);
    materials.shared.uFogDensity.value = Tunables.underwaterDensity;
  }
  materials.shared.uUnderwater.value = submerged ? 1 : 0;
  materials.shared.uUnderwaterDepth.value = depthFrac;
  // Screen veil: tunable tint strength, scaled by the real available light here.
  underwaterOverlay.setIntensity(submerged ? Tunables.underwaterTint * uwBright : 0);
  composer.setUnderwater(submerged ? 0.12 + 0.88 * depthFrac : 0, now / 1000);
  composer.setExposure(Tunables.brightness); // live "Brightness" knob (post path)
  underwaterParticles.update(frameDt, camera.position, submerged, world, fxSkyMul);

  chunkManager.update(frameDt, player.pos);

  // Phase 4b (Cinematic): sun-depth pass first so reflected terrain is shadowed
  // too, then the planar water reflection. Both restore render target/override.
  if (settings.shadows) shadowMapper.render(renderer, scene, camera.position, dayNight);
  if (settings.waterReflections) planarReflection.render(renderer, scene, camera);

  if (settings.usePost) {
    if (settings.godRays) {
      // Shafts from whichever disc is up — sun by day (strong), moon by night
      // (faint) — the SAME above and below water (no underwater special-casing).
      let vis: boolean;
      let intensity: number;
      if (dayNight.sunAboveHorizon) {
        vis = sunMoon.sunScreenPos(camera, tmpSunUv);
        intensity = 1 + dayNight.sunGlow * 2;
      } else {
        vis = sunMoon.moonScreenPos(camera, tmpSunUv);
        intensity = 0.5; // dim moonlight shafts
      }
      composer.updateGodRays(tmpSunUv, vis, intensity);
    }
    composer.render();
  } else {
    renderer.render(scene, camera);
  }

  // HUD (throttled to ~5 Hz).
  if (frameDt > 0) fpsSmooth = fpsSmooth * 0.9 + (1 / frameDt) * 0.1;
  hudAccum += frameDt;
  if (hudAccum > 0.2) {
    hudAccum = 0;
    const p = player.pos;
    hud.textContent =
      `fps ${fpsSmooth.toFixed(0)}\n` +
      `pos ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}\n` +
      `chunk ${worldToChunk(p.x)}, ${worldToChunk(p.z)}  ${player.mode === PlayerMode.FLY ? 'FLY' : 'WALK'}${player.onGround ? ' grounded' : ''}${player.inWater ? ' swimming' : ''}\n` +
      `loaded ${chunkManager.loadedCount}  lightQ ${chunkManager.lightQueueLength}  meshQ ${chunkManager.meshQueueLength}\n` +
      `seed ${seed}  ${settings.name}  ${textures.active.id}  day ${dayNight.phase.toFixed(2)}${dayNight.paused ? ' (paused)' : ''}`;
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
